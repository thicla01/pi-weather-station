// Radar analyzer — samples the RainViewer radar at 32 points around a given
// location (8 directions × 4 distances), at 3 timestamps (now, -15min, -45min),
// and returns a compact textual summary suitable for inclusion in a Claude
// prompt. The point of the textual representation is to let the model reason
// about precipitation movement and arrival time without trying to interpret
// raw map images.
//
// Tiles are fetched from the same RainViewer endpoint the client uses for
// the radar layer. We cache tile PNGs across requests and cache the final
// analysis text per-location for a few minutes.

const axios = require("axios").default;
const { PNG } = require("pngjs");
const { recordServiceCall } = require("./serviceStatus");
const { increment } = require("./requestCounter");
const compressionStats = require("./compressionStats");

const ANALYSIS_CACHE_TTL = 5 * 60 * 1000;   // analysis text cached 5 min per location
const TILE_CACHE_TTL = 12 * 60 * 1000;      // tile PNGs cached 12 min (RainViewer refreshes every 10 min)
const FETCH_TIMEOUT_MS = 8 * 1000;
// Retry delays between fetchRadarFrames attempts. Two retries (3 total
// attempts) with exponential backoff. Targets transient packet loss /
// brief link spikes on marginal residential links — observed May 5 2026
// on a Pi behind a building-to-building EAP-215 bridge where the
// `weather-maps.json` fetch occasionally timed out for a 4-min window
// then self-healed. The link itself was fine (0 % packet loss in 20
// pings, ~130 ms RTT), just spike-prone. Worst case (RainViewer fully
// down): ~26 s before we surface the 500 — non-fatal because the AI
// summary degrades gracefully without the radar paragraph and the
// poller retries on the 5-min cadence.
const FETCH_RETRY_DELAYS_MS = [500, 1500];
const ZOOM = 7;                             // RainViewer's max native zoom — best detail
const TILE_SIZE = 512;
const TARGET_OFFSETS_MIN = [0, -15, -45];   // now, 15 min ago, 45 min ago

// Sampling geometry per distance unit. Values are expressed in the user's
// chosen unit (km or mi); the great-circle math multiplies by KM_PER_UNIT
// when computing offsets, and the textual format echoes the unit label.
// Dense layout (May 2026 retune): 10 sample distances per ring per unit,
// every 5 km (3 mi) — 481 total points when extendedRadius is on. Earlier
// sparser geometry (4 + 3 distances at 8 + 16 directions = 57 points)
// missed cells drifting between sample positions; the denser grid greatly
// improves both the per-sample dot overlay's spatial fidelity and the
// trend-detection signal-to-noise ratio.
//
// Must stay in sync with client/src/components/WeatherMap/index.js so the
// dots rendered on the map land on the points the analyzer actually reads.
const KM_PER_UNIT = { km: 1, mi: 1.609344 };
const RADAR_GEOMETRY = {
  km: {
    inner: [5, 10, 15, 20, 25, 30, 35, 40, 45, 50],
    outer: [55, 60, 65, 70, 75, 80, 85, 90, 95, 100],
  },
  mi: {
    inner: [3, 6, 9, 12, 15, 18, 21, 24, 27, 30],
    outer: [33, 36, 39, 42, 45, 48, 51, 54, 57, 60],
  },
};

// 16-point compass for the inner ring — every 22.5°. Standard names so
// the AI summary can reason naturally ("vent du nord-est").
const COMPASS_16 = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
                    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const INNER_DIRECTIONS = COMPASS_16.map((name, i) => ({ name, bearing: i * 22.5 }));

// 32-point compass for the outer ring — every 11.25°. Where the bearing
// matches one of the 16 inner cardinals, we re-use the compass name so
// formatSnapshot can group inner + outer samples on that bearing into
// one direction block (denser radial profile, easier movement read for
// the AI). For the 16 in-between bearings we use the bearing value
// itself as the name (e.g. "11.25", "33.75") — the standard NbE/NEbN/…
// names are obscure enough that they bloat the prompt without helping.
const OUTER_DIRECTIONS = Array.from({ length: 32 }, (_, i) => {
  const bearing = i * 11.25;
  return {
    name: i % 2 === 0 ? COMPASS_16[i / 2] : bearing.toString(),
    bearing,
  };
});

// Display order for formatSnapshot — bearing-sorted with compass names
// interleaved with the half-bearing degree labels: C, N, 11.25, NNE,
// 33.75, NE, 56.25, ENE, …
const DIRECTION_ORDER = ["C", ...OUTER_DIRECTIONS.map((d) => d.name)];

// RainViewer color scheme 6 (NEXRAD Level III) — the same palette the client
// already shows in the radar legend. Each entry is the canonical RGB for that
// intensity level; pixels are matched against these by nearest-neighbour in
// RGB space, which absorbs the anti-aliasing wiggle at level boundaries.
const INTENSITY_PALETTE = [
  { level: 1, label: "very light", r:   0, g: 208, b: 208 },
  { level: 2, label: "light",      r:   0, g: 200, b:   0 },
  { level: 3, label: "moderate",   r: 240, g: 230, b:   0 },
  { level: 4, label: "heavy",      r: 240, g: 130, b:   0 },
  { level: 5, label: "very heavy", r: 230, g:   0, b:   0 },
  { level: 6, label: "extreme",    r: 120, g:   0, b: 180 },
];
const INTENSITY_LABELS = ["clear", "very light", "light", "moderate", "heavy", "very heavy", "extreme"];
const ALPHA_THRESHOLD = 32;       // pixels with alpha < this are considered transparent (no precipitation)
const MAX_COLOR_DIST_SQ = 14000;  // squared RGB distance above which we still report "clear"
                                  // (avoids pulling random anti-aliasing pixels into level 1)

// In-memory caches — a Map keyed by deterministic strings.
const tileCache = new Map();      // key "framePath:tileX:tileY" → { png, expiresAt }
const analysisCache = new Map();  // key "lat3:lon3"            → { text, expiresAt }
const riskCache = new Map();      // key "lat3:lon3:ext"         → { result, expiresAt }

// Risk-level mapping for the dashed circles around the user. Worst-case
// approach (max intensity sampled in the ring), aligned with WMO /
// Météo-France / NWS conventions where intensity drives the colour.
//   0       → no echoes, ring stays neutral
//   1-3     → very light to moderate, watch (jaune)
//   4       → heavy, warning  (orange)
//   5-6     → very heavy / extreme, severe (rouge)
const RISK_LEVELS = ["calm", "yellow", "yellow", "yellow", "orange", "red", "red"];

// Per-ring hysteresis on the tier-deciding intensity. Instead of using the
// single highest sample on the ring (which lets one rogue pixel from radar
// noise or a tile-boundary artefact decide the displayed tier), the tier is
// computed from the N-th highest sample. Yesterday morning's screenshot
// captured the failure mode: a single sample at intensity 4 right inside
// the 50 km zone painted the inner ring orange even though the visible
// cells were 80-100 km out. With N=2, that lone pixel is treated as noise:
// the ring needs at least two samples sustaining the tier-defining
// intensity before the colour escalates.
//
// Why N=2 (and not 3+ or a percentage):
//   - Inner ring has 161 samples (1 + 16×10), outer has 320 (32×10) — at
//     these densities, requiring just 2 samples is already a meaningful
//     filter (1.2 % / 0.6 % of the ring) without being so strict that real
//     compact cells get suppressed.
//   - A real precipitation cell large enough to matter typically covers
//     several adjacent sample points on the dense grid; if only one sample
//     reads heavy and all neighbours read calm, that's much more likely to
//     be sampling noise than a 5 km-wide cell sitting between samples.
const TIER_HYSTERESIS_N = 2;

/**
 * Return the n-th highest intensity in a sample array (1-indexed: n=1 is
 * the max, n=2 is the second-highest, etc.). Returns 0 when fewer than n
 * samples exist or when the n-th sample's intensity is 0.
 *
 * @param {Array<{intensity: Number}>} samples
 * @param {Number} n 1-based rank
 * @returns {Number} The n-th highest intensity, or 0 when not enough samples
 */
function nthHighestIntensity(samples, n) {
  if (!samples || samples.length < n) return 0;
  const sorted = samples.map((s) => s.intensity).sort((a, b) => b - a);
  return sorted[n - 1] || 0;
}

/**
 * Compute a destination lat/lon from a starting point, distance, and bearing.
 * Uses the standard great-circle formula; accurate enough for our 5-100 km range.
 *
 * @param {Number} lat starting latitude (deg)
 * @param {Number} lon starting longitude (deg)
 * @param {Number} distanceKm distance in kilometres
 * @param {Number} bearingDeg bearing clockwise from north (deg)
 * @returns {{lat: Number, lon: Number}} destination point
 */
function offsetLatLon(lat, lon, distanceKm, bearingDeg) {
  const R = 6371;
  const bearing = bearingDeg * Math.PI / 180;
  const lat1 = lat * Math.PI / 180;
  const lon1 = lon * Math.PI / 180;
  const d = distanceKm / R;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(bearing));
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * Math.sin(d) * Math.cos(lat1),
    Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
  );
  return {
    lat: lat2 * 180 / Math.PI,
    lon: ((lon2 * 180 / Math.PI) + 540) % 360 - 180,
  };
}

/**
 * Convert a lat/lon to (tile coordinates, pixel offset within the tile)
 * for the given zoom and tile size, using the standard Web Mercator scheme.
 *
 * @param {Number} lat latitude in degrees
 * @param {Number} lon longitude in degrees
 * @returns {{tileX: Number, tileY: Number, pixelX: Number, pixelY: Number}}
 */
function latLonToTilePixel(lat, lon) {
  const n = Math.pow(2, ZOOM);
  const xWorld = ((lon + 180) / 360) * n;
  const latRad = lat * Math.PI / 180;
  const yWorld = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n;
  const tileX = Math.floor(xWorld);
  const tileY = Math.floor(yWorld);
  return {
    tileX,
    tileY,
    pixelX: Math.min(TILE_SIZE - 1, Math.max(0, Math.floor((xWorld - tileX) * TILE_SIZE))),
    pixelY: Math.min(TILE_SIZE - 1, Math.max(0, Math.floor((yWorld - tileY) * TILE_SIZE))),
  };
}

/**
 * Map a single RGBA pixel to a discrete RainViewer intensity level (0-6).
 * Returns 0 (clear) when the pixel is transparent or far from any palette entry.
 *
 * @param {Number} r
 * @param {Number} g
 * @param {Number} b
 * @param {Number} a
 * @returns {Number} intensity level
 */
function pixelToIntensity(r, g, b, a) {
  if (a < ALPHA_THRESHOLD) return 0;
  let best = 0;
  let bestDistSq = MAX_COLOR_DIST_SQ;
  for (const p of INTENSITY_PALETTE) {
    const dr = r - p.r;
    const dg = g - p.g;
    const db = b - p.b;
    const distSq = dr * dr + dg * dg + db * db;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = p.level;
    }
  }
  return best;
}

/**
 * Fetch the latest list of past radar frames from RainViewer. Retries
 * up to FETCH_RETRY_DELAYS_MS.length times on transient failure, with
 * exponential backoff between attempts. Each attempt uses the standard
 * FETCH_TIMEOUT_MS axios timeout. Throws the last error after the final
 * attempt fails, so the caller's existing try/catch still surfaces a
 * 500 to the Debug panel when RainViewer is genuinely unreachable.
 *
 * @returns {Promise<Array<{time: Number, path: String}>>}
 */
async function fetchRadarFrames() {
  let lastErr = null;
  for (let attempt = 0; attempt <= FETCH_RETRY_DELAYS_MS.length; attempt++) {
    try {
      const r = await axios.get("https://api.rainviewer.com/public/weather-maps.json", {
        timeout: FETCH_TIMEOUT_MS,
      });
      return r.data?.radar?.past || [];
    } catch (err) {
      lastErr = err;
      if (attempt < FETCH_RETRY_DELAYS_MS.length) {
        await new Promise((resolve) => setTimeout(resolve, FETCH_RETRY_DELAYS_MS[attempt]));
      }
    }
  }
  throw lastErr;
}

/**
 * Find the past frame closest to a target timestamp.
 *
 * @param {Array} frames
 * @param {Number} targetMs
 * @returns {Object|null} closest frame, or null when input is empty
 */
function findFrameNear(frames, targetMs) {
  if (!frames.length) return null;
  let closest = frames[0];
  let bestDelta = Math.abs(frames[0].time * 1000 - targetMs);
  for (let i = 1; i < frames.length; i++) {
    const d = Math.abs(frames[i].time * 1000 - targetMs);
    if (d < bestDelta) {
      bestDelta = d;
      closest = frames[i];
    }
  }
  return closest;
}

async function fetchTile(framePath, tileX, tileY) {
  const url = `https://tilecache.rainviewer.com${framePath}/${TILE_SIZE}/${ZOOM}/${tileX}/${tileY}/6/1_1.png`;
  const r = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: FETCH_TIMEOUT_MS,
  });
  return PNG.sync.read(Buffer.from(r.data));
}

async function getTile(framePath, tileX, tileY) {
  const key = `${framePath}:${tileX}:${tileY}`;
  const cached = tileCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.png;
  const png = await fetchTile(framePath, tileX, tileY);
  tileCache.set(key, { png, expiresAt: Date.now() + TILE_CACHE_TTL });
  return png;
}

/**
 * Read a 3×3 pixel neighbourhood around (x, y) and return the worst-case
 * intensity. Single-pixel sampling on RainViewer tiles is noisy: a probe
 * sitting between two precipitation bands, on an anti-aliased edge
 * (alpha < ALPHA_THRESHOLD), or in a tiny gap inside a band would report
 * "clear" even though the surrounding ~100 m clearly shows rain to the
 * naked eye. Sampling 3×3 (~9 reads, negligible cost) absorbs that noise
 * while only diluting spatial precision by ±1 pixel — at zoom 7 that's
 * roughly ±100 m on the ground, well below the geometry's resolution.
 *
 * @param {Object} png Decoded PNG buffer
 * @param {Number} x Centre pixel X within the tile
 * @param {Number} y Centre pixel Y within the tile
 * @returns {Number} Max intensity (0–6) across the 3×3 window
 */
function readPixelIntensity(png, x, y) {
  let max = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const px = x + dx;
      const py = y + dy;
      if (px < 0 || px >= png.width || py < 0 || py >= png.height) continue;
      const idx = (py * png.width + px) * 4;
      const intensity = pixelToIntensity(png.data[idx], png.data[idx + 1], png.data[idx + 2], png.data[idx + 3]);
      if (intensity > max) max = intensity;
    }
  }
  return max;
}

/**
 * Build a single sampling grid (one timestamp): for every (direction, distance)
 * pair, returns the precipitation intensity at that point.
 *
 * @param {Number} lat
 * @param {Number} lon
 * @param {String} framePath the RainViewer path for the desired frame
 * @param {Array<{direction: String, distance: Number, bearing: Number, distanceKm: Number}>} points
 *   Pre-built list of (direction, distance, bearing, distanceKm) tuples — distance
 *   is the value in the user's chosen unit (used for display); distanceKm is the
 *   same value in km (used for the great-circle offset).
 * @returns {Promise<Array<{direction: String, distance: Number, intensity: Number}>>}
 */
async function buildSnapshot(lat, lon, framePath, points) {
  const samples = [];
  // Group by tile to minimize fetches
  const tileMap = new Map(); // "tileX:tileY" → list of pending samples
  for (const { direction, distance, bearing, distanceKm } of points) {
    const point = offsetLatLon(lat, lon, distanceKm, bearing);
    const { tileX, tileY, pixelX, pixelY } = latLonToTilePixel(point.lat, point.lon);
    const key = `${tileX}:${tileY}`;
    if (!tileMap.has(key)) tileMap.set(key, []);
    tileMap.get(key).push({ direction, distance, pixelX, pixelY });
  }
  // Fetch each tile once, then collect intensities
  for (const [key, pending] of tileMap.entries()) {
    const [tileXStr, tileYStr] = key.split(":");
    const png = await getTile(framePath, parseInt(tileXStr, 10), parseInt(tileYStr, 10));
    for (const p of pending) {
      samples.push({
        direction: p.direction,
        distance: p.distance,
        intensity: readPixelIntensity(png, p.pixelX, p.pixelY),
      });
    }
  }
  return samples;
}

/**
 * "Naive full-grid" baseline formatter — always lists every direction
 * with all its distance entries, with no short-circuit and no rollup.
 * This is the conceptual baseline the user describes as "always 481
 * points": the size the prompt WOULD have if we sent every sample
 * unconditionally. The format that actually shipped before d061126
 * also had an all-clear short-circuit, but using THAT as the baseline
 * would credit calm-day polls with 0 % compression even though the
 * real win of the hierarchical refactor IS to also handle the storm
 * cases. The naive baseline is consistent across scenarios and gives
 * intuitive numbers: ~99 % on a calm radar, dropping toward ~10 % on
 * radar-wide systems where there's nothing to roll up.
 *
 * Used purely as a measurement baseline; never sent to Claude. Kept in
 * lockstep with `formatSnapshot`'s entry/label vocabulary so the only
 * source of length difference is the rollup logic itself.
 *
 * @param {Array} samples Same shape as for formatSnapshot.
 * @param {String} label "now" / "-15 min" / "-45 min".
 * @param {String} unit "km" or "mi".
 * @returns {String} Naive-baseline block.
 */
function formatSnapshotLegacy(samples, label, unit) {
  const byDir = new Map();
  for (const dirName of DIRECTION_ORDER) byDir.set(dirName, []);
  for (const s of samples) {
    if (!byDir.has(s.direction)) byDir.set(s.direction, []);
    byDir.get(s.direction).push(s);
  }
  const fmtDist = (d) => `${d}${unit}`;
  const lines = [];
  for (const dirName of DIRECTION_ORDER) {
    const dirSamples = byDir.get(dirName);
    if (!dirSamples || !dirSamples.length) continue;
    dirSamples.sort((a, b) => a.distance - b.distance);
    const parts = dirSamples.map(
      (s) => `${fmtDist(s.distance)} ${INTENSITY_LABELS[s.intensity]}`,
    );
    lines.push(`  ${dirName.padEnd(6)} : ${parts.join(", ")}`);
  }
  return `${label}:\n${lines.join("\n")}`;
}

/**
 * Format a snapshot as a compact human-readable block for inclusion in a
 * prompt. Hierarchical compression versus listing every sample:
 *
 *   1. Whole radar empty → one line ("clear within Xkm").
 *   2. Radial rollup → walk inward and outward to find the largest fully-
 *      clear inner core and the smallest fully-clear outer band, then list
 *      only the active annulus between them. A storm 80 km away on the W
 *      side compresses to "Clear within 70km. Active 75-100km: …" without
 *      ever listing the 16 inner directions × 10 distances that are all 0.
 *   3. Per-direction rollup inside the active annulus → directions with no
 *      precipitation in the annulus are omitted entirely (saves ~10 chars
 *      per direction × all-clear count).
 *   4. Within each active direction, ONLY the non-zero samples are listed
 *      — clear distances inside an active direction are implied by the
 *      "Active X-Y" header convention (declared explicitly in the
 *      aiSummaryCtrl preamble so Claude reads "N : 45km light" as
 *      "north has light precipitation at 45km AND clear precipitation at
 *      every other sampled distance in this annulus"). Was the biggest
 *      lever for the 0-25 % bucket of the compression-stats report:
 *      mid-cluttered radar geometries used to emit ~5000 chars because
 *      every direction listed all 10 of its annulus distances; with this
 *      tier 4 they emit only the actually-precipitating samples (~30-40 %
 *      of points on a typical varied frame).
 *
 * Storms covering the entire radar (>180°) degrade gracefully — every
 * direction is active, and within each direction the non-zero filter still
 * helps (active directions rarely have ALL their annulus distances above 0).
 *
 * @param {Array} samples
 * @param {String} label e.g. "now", "-15 min", "-45 min"
 * @param {String} unit "km" or "mi" — distance unit used in the sample values
 * @returns {String|null}
 */
function formatSnapshot(samples, label, unit) {
  // Group by direction. Display order is "C" (centre) first, then bearings
  // 0° → 348.75° (alternating compass names and degree labels — see
  // OUTER_DIRECTIONS naming).
  const byDir = new Map();
  for (const dirName of DIRECTION_ORDER) byDir.set(dirName, []);
  for (const s of samples) {
    if (!byDir.has(s.direction)) byDir.set(s.direction, []);
    byDir.get(s.direction).push(s);
  }
  for (const list of byDir.values()) list.sort((a, b) => a.distance - b.distance);

  const fmtDist = (d) => `${d}${unit}`;
  const maxDist = samples.reduce((m, s) => Math.max(m, s.distance), 0);

  // Tier 1: whole-radar empty.
  const anyHit = samples.some((s) => s.intensity > 0);
  if (!anyHit) return `${label}: clear (no precipitation within ${fmtDist(maxDist)})`;

  // Tier 2: radial rollup. Walk the sorted distinct distances and find
  // the largest fully-clear inner core (innerClearMax) and the smallest
  // fully-clear outer band (outerClearMin). innerClearMax === -1 means
  // the centre itself has rain so no inner core is clear; outerClearMin
  // === Infinity means the outermost sample has rain so no outer band
  // is clear. Whatever ends up between innerClearMax and outerClearMin
  // is the active annulus and is the only zone the per-direction listing
  // needs to enumerate.
  const distSet = new Set(samples.map((s) => s.distance));
  const distances = [...distSet].sort((a, b) => a - b);
  const maxIntAtDist = new Map(distances.map((d) => [d, 0]));
  for (const s of samples) {
    if (s.intensity > maxIntAtDist.get(s.distance)) {
      maxIntAtDist.set(s.distance, s.intensity);
    }
  }

  let innerClearMax = -1;
  for (const d of distances) {
    if (maxIntAtDist.get(d) === 0) innerClearMax = d;
    else break;
  }
  let outerClearMin = Infinity;
  for (let i = distances.length - 1; i >= 0; i--) {
    const d = distances[i];
    if (maxIntAtDist.get(d) === 0) outerClearMin = d;
    else break;
  }

  const lines = [`${label}:`];
  // Inner-core rollup. Only emit when at least one ring distance is in
  // the clear core — innerClearMax === 0 means "only centre is clear,
  // everything else has rain", which doesn't merit a rollup line because
  // the per-direction listing of the active block will report C : clear
  // anyway (and "Clear within 0km" reads as a typo).
  if (innerClearMax > 0) {
    lines.push(`  Clear within ${fmtDist(innerClearMax)}.`);
  }
  // Outer-band rollup. Emit even when only the outermost sample is clear
  // (a cleared 100 km ring across 32 outer directions = 32 entries saved,
  // worth the rollup line) — but skip when outerClearMin === Infinity
  // (no outer band cleared at all).
  if (outerClearMin < Infinity) {
    lines.push(`  Clear beyond ${fmtDist(outerClearMin)}.`);
  }

  // Active annulus = strict interior between the two cleared boundaries.
  // When innerClearMax === -1, the centre is included (d > -1 is true
  // for d === 0). When outerClearMin === Infinity, every distance up to
  // the maximum is included.
  const activeDistances = distances.filter(
    (d) => d > innerClearMax && d < outerClearMin,
  );
  if (!activeDistances.length) {
    // Defensive: shouldn't reach here because anyHit was true, but if
    // it does (rounding edge?), fall through with a single line.
    return lines.join("\n");
  }
  const activeStart = activeDistances[0];
  const activeEnd = activeDistances[activeDistances.length - 1];
  lines.push(`  Active ${fmtDist(activeStart)}-${fmtDist(activeEnd)}:`);

  // Tiers 3 & 4: per-direction listing inside the active annulus.
  // Tier 3 — fully-clear directions are omitted entirely (Claude reads
  // their absence as "no precipitation along that bearing in the active
  // range", per the convention declared in the aiSummaryCtrl preamble).
  // Tier 4 — within an active direction, only non-zero samples are
  // listed; the clear distances are implied by the same convention
  // header. Together these are the biggest lever for the 0-25 % bucket
  // identified in the compression-stats reports: mid-cluttered frames
  // used to spend ~12 chars per sample × ~10 distances × ~30 directions
  // even when most of those samples were zero.
  for (const dirName of DIRECTION_ORDER) {
    const dirSamples = byDir.get(dirName);
    if (!dirSamples || !dirSamples.length) continue;
    const activeNonZero = dirSamples.filter(
      (s) => s.distance >= activeStart && s.distance <= activeEnd && s.intensity > 0,
    );
    if (!activeNonZero.length) continue;
    const parts = activeNonZero.map(
      (s) => `${fmtDist(s.distance)} ${INTENSITY_LABELS[s.intensity]}`,
    );
    lines.push(`    ${dirName.padEnd(6)} : ${parts.join(", ")}`);
  }

  return lines.join("\n");
}

/**
 * Run the full analysis for a location. Returns a multi-line string ready to
 * paste into a Claude prompt, or null if RainViewer data is unavailable.
 *
 * @param {Number} lat
 * @param {Number} lon
 * @param {Object} [options] Analysis options
 * @param {Boolean} [options.extendedRadius] Sample the outer ring in addition
 *   to the inner one — adds 32 directions × 10 distances when on
 * @param {String}  [options.distanceUnit] "km" (default) or "mi" — drives
 *   sampling distances, the circle radius, and the unit label in the prompt
 * @returns {Promise<String|null>}
 */
async function analyzeRadar(lat, lon, options = {}) {
  const unit = options.distanceUnit === "mi" ? "mi" : "km";
  const geometry = RADAR_GEOMETRY[unit];
  const kmPerUnit = KM_PER_UNIT[unit];

  // Build the (direction, distance, bearing, distanceKm) tuples to sample.
  // First sample is at the user's exact location (direction "C", distance 0).
  // Inner ring is 16 directions × 10 distances (160 points); outer ring
  // (if enabled) is 32 directions × 10 distances (320 points). The
  // doubleOuterPoints advanced setting is no longer consulted — outer is
  // always the dense 32-direction grid when extendedRadius is on, because
  // the May 2026 retune showed the previous sparser geometry missed real
  // approaching cells.
  const points = [{ direction: "C", distance: 0, bearing: 0, distanceKm: 0 }];
  for (const dir of INNER_DIRECTIONS) {
    for (const distance of geometry.inner) {
      points.push({ direction: dir.name, distance, bearing: dir.bearing, distanceKm: distance * kmPerUnit });
    }
  }
  if (options.extendedRadius) {
    for (const dir of OUTER_DIRECTIONS) {
      for (const distance of geometry.outer) {
        points.push({ direction: dir.name, distance, bearing: dir.bearing, distanceKm: distance * kmPerUnit });
      }
    }
  }

  // Cache key encodes the geometry mode AND the unit system so toggling
  // extendedRadius never returns a stale snapshot built with a different
  // sample set. The trailing format-version tag is bumped whenever the
  // text emitted by formatSnapshot changes shape — guarantees a fresh
  // analysis runs after a deploy that rewrites the prompt block, instead
  // of users seeing the previous format until the 5-min TTL expires.
  const radiusTag = options.extendedRadius ? "x" : "s";
  const FORMAT_VERSION = "v2"; // hierarchical rollup (May 2026)
  const cacheKey = `${lat.toFixed(3)}:${lon.toFixed(3)}:${radiusTag}:${unit}:${FORMAT_VERSION}`;
  const cached = analysisCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.text;

  let frames;
  try {
    frames = await fetchRadarFrames();
  } catch (err) {
    recordServiceCall("RainViewer (analyzer)", err?.response?.status || 500, "fetch frames failed");
    return null;
  }
  if (!frames.length) {
    recordServiceCall("RainViewer (analyzer)", 200, "no frames available");
    return null;
  }

  const now = Date.now();
  const sections = [];
  for (const offsetMin of TARGET_OFFSETS_MIN) {
    const targetMs = now + offsetMin * 60 * 1000;
    const frame = findFrameNear(frames, targetMs);
    if (!frame) continue;
    const label = offsetMin === 0 ? "now" : `${offsetMin} min`;
    try {
      const samples = await buildSnapshot(lat, lon, frame.path, points);
      const compressed = formatSnapshot(samples, label, unit);
      if (compressed) {
        // Run the legacy formatter alongside the compressed one. Two roles:
        //   1) Measure compression ratio (recorded in compressionStats).
        //   2) Fallback target — when the hierarchical "compressed" output
        //      is actually longer than the naive baseline (rare, but
        //      observed: per-direction headers + sparse rollup overhead can
        //      tip past savings on certain mid-cluttered radar geometries),
        //      send the legacy block to Claude instead. We never pay for
        //      the surcharge.
        const legacy = formatSnapshotLegacy(samples, label, unit);
        const block = compressed.length < legacy.length ? compressed : legacy;
        sections.push(block);
        compressionStats.record(legacy.length, block.length);
      }
    } catch (err) {
      // One snapshot failed — keep going with whatever we have
      recordServiceCall("RainViewer (analyzer)", err?.response?.status || 500, `snapshot ${label} failed`);
    }
  }

  if (!sections.length) return null;

  const text = sections.join("\n\n");
  analysisCache.set(cacheKey, { text, expiresAt: Date.now() + ANALYSIS_CACHE_TTL });
  recordServiceCall("RainViewer (analyzer)", 200, "OK");
  increment("rainviewer", "analyzer");
  return text;
}

// Tier-bump table. Used by trend-aware risk colouring (v2): when a
// precipitation band on a given ring is moving inward fast enough to
// reach the user within ~30 minutes, the ring's tier is bumped one
// notch — operational meteorology treats imminence as part of the
// warning, not just raw intensity. Red stays red (already max).
const TIER_BUMP = { calm: "yellow", yellow: "orange", orange: "red", red: "red" };

/**
 * Compute the per-direction trend, peak intensity, and confidence score by
 * comparing the radial intensity profile across the captured frames. For
 * each direction returns:
 *   - trend — one of:
 *       "approaching" — strongest-intensity sample shifted inward by more
 *         than the unit-aware threshold over the window AND projected
 *         arrival at the centre is under 60 minutes (widened from 30 in
 *         May 2026 after the Sorel false-leaving case where a very heavy
 *         band 50 km out approaching at ~50 km/h had ETA 57 min and was
 *         classified "stable", letting a weak dispersing band on the
 *         opposite bearing dictate the ring summary).
 *       "leaving" — strongest-intensity sample shifted outward by more
 *         than the same threshold.
 *       "stable" — neither (drift below the threshold, or no signal in
 *         this direction in either the latest or oldest frame).
 *   - peakIntensityNow — the strongest sample's intensity in the latest
 *     frame for this direction. Used by `summarizeRingTrend` to weight by
 *     intensity (the band that defines the ring's tier dictates the ring
 *     trend, not a weak band on a different bearing).
 *   - confidence — 0-100 score of how strongly the data supports the
 *     trend label. Built from three factors (max 100):
 *       (a) magnitude of inward shift relative to threshold (up to 60),
 *       (b) monotonicity — does the mid frame agree with the direction?
 *           (up to 25),
 *       (c) intensity persistence — both endpoints ≥ 2 (light precip or
 *           stronger), so the band is real, not transient noise (up to 15).
 *     For "stable", confidence = inverse of evidence for movement
 *     (1 − |shift|/threshold).
 *
 * Same threshold is used for both directions of motion so the "leaving"
 * label is held to the same evidence bar as "approaching" — same logic
 * we already trust to bump the displayed tier.
 *
 * Returns an empty Map when there's not enough data (single frame, or
 * empty oldest/latest snapshot) so callers can short-circuit cleanly.
 *
 * @param {Array<Array<{direction: String, distance: Number, intensity: Number}>>} framesSamples
 *   Per-frame samples ordered newest → oldest (snapshots[0] = now, [1] = -15, [2] = -45).
 * @param {String} unit "km" or "mi" — selects the unit-aware threshold.
 * @param {"inner" | "outer"} ring Which ring is being analysed — outer
 *   uses a proportionally larger threshold so a 5 km drift on the 100 km
 *   ring isn't mistaken for sampling noise (~5 % of the radius vs ~10 %
 *   on the inner ring).
 * @returns {Map<String, {trend: String, peakIntensityNow: Number, confidence: Number}>}
 */
function computePerDirectionTrends(framesSamples, unit, ring) {
  const map = new Map();
  if (!framesSamples || framesSamples.length < 2) return map;
  const oldest = framesSamples[framesSamples.length - 1];
  const latest = framesSamples[0];
  if (!oldest?.length || !latest?.length) return map;

  // Spans the time window between the oldest and the latest snapshot, in
  // minutes. TARGET_OFFSETS_MIN is [0, -15, -45], so the typical span is
  // 45 min; using the actual array length keeps us correct if the window
  // ever changes (e.g. dropping the -45 frame on RainViewer hiccups).
  const spanMin = Math.abs(TARGET_OFFSETS_MIN[framesSamples.length - 1] || 0) || 45;

  // Inward-shift threshold tuned empirically and now ring-aware. Inner
  // ring (5-50 km) uses 5 km / 3 mi — a band crossing this much in 45 min
  // is moving fast enough that the next 30 min matter. Outer ring (55-
  // 100 km) uses 8 km / 5 mi — proportional to the larger radius so we
  // don't get false positives from sampling noise on the wider ring.
  const innerThreshold = unit === "mi" ? 3 : 5;
  const outerThreshold = unit === "mi" ? 5 : 8;
  const inwardThreshold = ring === "outer" ? outerThreshold : innerThreshold;
  const arrivalLimitMin = 60;

  // Per direction: find the distance of the strongest sample in each
  // frame (intensity ≥ 1, lowered after May 2026 retune so light-precip
  // approaches get caught). The denser 16/32-direction grid absorbs the
  // extra noise — a transient single-pixel bloom on one bearing won't
  // survive the per-direction shift requirement.
  const directions = [...new Set(latest.map((s) => s.direction))];
  for (const dir of directions) {
    if (dir === "C") continue; // centre point has no radial movement
    const peaks = framesSamples.map((snap) => {
      let bestI = 0;
      let bestDist = null;
      for (const s of snap) {
        if (s.direction === dir && s.intensity >= 1 && s.intensity >= bestI) {
          bestI = s.intensity;
          bestDist = s.distance;
        }
      }
      return { intensity: bestI, distance: bestDist };
    });
    const peakNow = peaks[0];
    const peakOld = peaks[peaks.length - 1];
    const peakMid = peaks.length >= 3 ? peaks[1] : null;
    const peakIntensityNow = peakNow.intensity;

    // No signal at either endpoint → record as stable with full confidence
    // (we're confident there's nothing happening here).
    if (peakNow.distance == null || peakOld.distance == null) {
      map.set(dir, { trend: "stable", peakIntensityNow, confidence: 100 });
      continue;
    }

    const inwardShift = peakOld.distance - peakNow.distance;
    let trend = "stable";
    if (inwardShift >= inwardThreshold) {
      // Project arrival: how long until this band reaches the centre at
      // the current inward speed?
      const speedPerMin = inwardShift / spanMin;
      if (speedPerMin > 0 && peakNow.distance / speedPerMin < arrivalLimitMin) {
        trend = "approaching";
      }
    } else if (inwardShift <= -inwardThreshold) {
      trend = "leaving";
    }

    const confidence = computeTrendConfidence({
      trend, inwardShift, threshold: inwardThreshold,
      peakNow, peakOld, peakMid,
    });

    map.set(dir, { trend, peakIntensityNow, confidence });
  }
  return map;
}

/**
 * Score how strongly the per-direction data supports the assigned trend
 * label. Returns 0-100. Three factors for "approaching"/"leaving":
 *   (a) magnitude — |inwardShift| relative to threshold, up to 60 pts
 *       at 2× threshold.
 *   (b) monotonicity — when a mid frame is available and its peak distance
 *       lies between old and now in the expected direction, +25 pts.
 *   (c) intensity persistence — both endpoint peaks ≥ 2 (i.e. light precip
 *       or stronger, not single-pixel noise), +15 pts.
 * For "stable", confidence is the inverse of evidence-for-movement
 * (1 − min(1, |shift|/threshold)) so a direction sitting well below the
 * threshold reads as "definitely stable" while a direction right at the
 * threshold but blocked by the ETA gate reads as "barely stable".
 *
 * @param {Object} input
 * @param {String} input.trend Assigned trend label
 * @param {Number} input.inwardShift Signed shift (positive = approaching)
 * @param {Number} input.threshold Unit-aware threshold for this ring
 * @param {Object} input.peakNow {intensity, distance} for the latest frame
 * @param {Object} input.peakOld {intensity, distance} for the oldest frame
 * @param {Object|null} input.peakMid {intensity, distance} or null
 * @returns {Number} Confidence score, 0-100
 */
function computeTrendConfidence({ trend, inwardShift, threshold, peakNow, peakOld, peakMid }) {
  if (trend === "stable") {
    const ratio = Math.min(1, Math.abs(inwardShift) / threshold);
    return Math.round((1 - ratio) * 100);
  }
  let score = 0;
  // (a) Magnitude — at threshold = 30 pts, at 2× threshold = 60 pts, capped.
  const magnitudeRatio = Math.abs(inwardShift) / threshold;
  score += Math.min(60, magnitudeRatio * 30);
  // (b) Monotonicity — does the mid frame confirm direction?
  if (peakMid && peakMid.distance != null) {
    const monotonic = trend === "approaching"
      ? (peakMid.distance < peakOld.distance && peakMid.distance > peakNow.distance)
      : (peakMid.distance > peakOld.distance && peakMid.distance < peakNow.distance);
    if (monotonic) score += 25;
  }
  // (c) Intensity persistence — both endpoints have light-or-stronger precip
  if (peakNow.intensity >= 2 && peakOld.intensity >= 2) score += 15;
  return Math.min(100, Math.round(score));
}

/**
 * Collapse a per-direction trend map into a single ring-level label
 * weighted by intensity. The dominant direction (highest peakIntensityNow)
 * dictates the ring's trend — same band that drives the displayed tier.
 * Tie-breaker on equal intensity: approaching > leaving > stable.
 *
 * Why intensity-weighted? Before May 2026 the rule was "any approaching
 * wins, then any leaving wins, else stable". This let a weak dispersing
 * band on one bearing override an intense stable/approaching band on
 * another (Sorel case: WNW very-heavy at 45 km classified stable due to
 * the old 30-min ETA gate, while a SW light band moving outward flipped
 * the ring summary to "leaving" — banner read "Précipitations sévères
 * mais s'éloignent" while the very-heavy threat sat on the doorstep).
 * Intensity weighting closes that loophole: the band that defines the
 * tier also dictates the trend.
 *
 * Also returns the chosen direction's confidence score (0-100), so the
 * banner / debug surface can hedge wording when the data only weakly
 * supports the label.
 *
 * @param {Map<String, {trend: String, peakIntensityNow: Number, confidence: Number}>} perDirMap
 *   Map produced by computePerDirectionTrends
 * @returns {{trend: String, confidence: Number}} Ring-level trend + confidence
 */
function summarizeRingTrend(perDirMap) {
  if (!perDirMap || perDirMap.size === 0) return { trend: "stable", confidence: 0 };
  const trendRank = { approaching: 2, leaving: 1, stable: 0 };
  let dominant = null;
  for (const entry of perDirMap.values()) {
    if (!dominant) { dominant = entry; continue; }
    if (entry.peakIntensityNow > dominant.peakIntensityNow) {
      dominant = entry;
    } else if (entry.peakIntensityNow === dominant.peakIntensityNow
        && trendRank[entry.trend] > trendRank[dominant.trend]) {
      dominant = entry;
    }
  }
  return { trend: dominant.trend, confidence: dominant.confidence };
}

/**
 * Down-weight a sample's intensity by one tier when its direction is
 * trending "leaving". Symmetric to the existing tier-bump on approaching
 * rings: just as we treat an inbound band as more dangerous than its raw
 * intensity suggests, we treat an outbound one as less dangerous. Used
 * by the per-ring tier decision so a heavy sample at NE-leaving counts
 * the same as a moderate sample at NE-stable, while an equally-heavy
 * sample at NW-approaching keeps full weight.
 *
 * Caps below 0 — a sample with no precipitation stays clear regardless.
 *
 * @param {{direction: String, intensity: Number}} sample
 * @param {Map<String, String>} perDirMap
 * @returns {Number} The effective intensity for tier decisions
 */
function effectiveIntensityFor(sample, perDirMap) {
  if (!sample || sample.intensity <= 0) return 0;
  const entry = perDirMap.get(sample.direction);
  if (entry?.trend === "leaving") return Math.max(0, sample.intensity - 1);
  return sample.intensity;
}

/**
 * Compact "a→A/l→L/s→S" string for the per-direction trend distribution
 * — used in the diagnostic log so grep on "leaving" or "dirs=a" can pull
 * the relevant samples without parsing JSON.
 *
 * @param {Map<String, String>} perDirMap
 * @returns {String}
 */
function trendDistribution(perDirMap) {
  let a = 0, l = 0, s = 0;
  for (const entry of perDirMap.values()) {
    const t = entry?.trend;
    if (t === "approaching") a++;
    else if (t === "leaving") l++;
    else s++;
  }
  return `a${a}/l${l}/s${s}`;
}

/**
 * Compute current radar-risk levels for the inner and (optionally) outer
 * sampling rings around a location. Reuses the same sampling pipeline as
 * analyzeRadar — and now also reuses its 3-frame sequence (now / -15 min /
 * -45 min) so the tier can be bumped one notch when a band is moving
 * inward fast enough to reach the user within ~30 min ("trend-aware
 * risk colouring", roadmap v2).
 *
 * Returns an object the WeatherMap consumes to colour its dashed circles.
 * Both rings carry the (possibly tier-bumped) worst-case intensity sampled
 * on that ring (see RISK_LEVELS), plus a `trend` label for diagnostics
 * and future UI. When the outer ring isn't requested or its samples all
 * fail, the outer field is null and the client just doesn't tint its
 * outer circle.
 *
 * @param {Number} lat
 * @param {Number} lon
 * @param {Object} [options]
 * @param {Boolean} [options.extendedRadius] Also evaluate the outer ring
 * @param {String}  [options.distanceUnit] "km" (default) or "mi" — selects
 *   the geometry table so the same radii are sampled the client draws
 * @returns {Promise<{
 *   inner: { level: String, maxIntensity: Number, trend: String, samples: Array },
 *   outer: { level: String, maxIntensity: Number, trend: String, samples: Array } | null,
 *   timestamp: Number
 * } | null>} null when RainViewer is unreachable
 */
async function getRiskLevels(lat, lon, options = {}) {
  const unit = options.distanceUnit === "mi" ? "mi" : "km";
  const geometry = RADAR_GEOMETRY[unit];
  const kmPerUnit = KM_PER_UNIT[unit];

  // Cache key encodes geometry mode + extended flag — same shape as the
  // analyzer cache key so the two stay aligned.
  const cacheKey = `${lat.toFixed(3)}:${lon.toFixed(3)}:${unit}:${options.extendedRadius ? "x" : "s"}`;
  const cached = riskCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.result;

  let frames;
  try {
    frames = await fetchRadarFrames();
  } catch (err) {
    recordServiceCall("RainViewer (risk)", err?.response?.status || 500, "fetch frames failed");
    return null;
  }
  if (!frames.length) {
    recordServiceCall("RainViewer (risk)", 200, "no frames available");
    return null;
  }

  // Build sample geometry once — same direction × distance grid is sampled
  // on every frame in the trend window. First inner point is the user's
  // exact location so a small cell sitting on the marker still bumps the
  // inner-ring max-intensity score; centre point is excluded from trend
  // analysis since "movement toward the centre" doesn't apply to it.
  const innerPoints = [{ direction: "C", distance: 0, bearing: 0, distanceKm: 0 }];
  for (const dir of INNER_DIRECTIONS) {
    for (const distance of geometry.inner) {
      innerPoints.push({ direction: dir.name, distance, bearing: dir.bearing, distanceKm: distance * kmPerUnit });
    }
  }
  const outerPoints = [];
  if (options.extendedRadius) {
    for (const dir of OUTER_DIRECTIONS) {
      for (const distance of geometry.outer) {
        outerPoints.push({ direction: dir.name, distance, bearing: dir.bearing, distanceKm: distance * kmPerUnit });
      }
    }
  }

  // Capture the same 3-frame sequence the AI summary uses (now, -15 min,
  // -45 min). Building all three snapshots in parallel keeps the latency
  // close to a single-frame fetch since most tile reads will hit the
  // shared tile cache (the analyzer for the AI summary already populated
  // them on its 5-minute schedule).
  const now = Date.now();
  const frameJobs = TARGET_OFFSETS_MIN.map((offsetMin) => {
    const targetMs = now + offsetMin * 60 * 1000;
    const frame = findFrameNear(frames, targetMs);
    if (!frame) return Promise.resolve(null);
    return Promise.all([
      buildSnapshot(lat, lon, frame.path, innerPoints),
      outerPoints.length
        ? buildSnapshot(lat, lon, frame.path, outerPoints)
        : Promise.resolve([]),
    ])
      .then(([inner, outer]) => ({ frame, inner, outer }))
      .catch(() => null);
  });

  let snapshots;
  try {
    snapshots = (await Promise.all(frameJobs)).filter(Boolean);
  } catch (err) {
    recordServiceCall("RainViewer (risk)", err?.response?.status || 500, "snapshot failed");
    return null;
  }
  if (!snapshots.length) {
    recordServiceCall("RainViewer (risk)", 200, "no snapshots");
    return null;
  }

  // snapshots[0] is the latest frame (TARGET_OFFSETS_MIN[0] = 0). The
  // displayed tier and the per-sample dot colours both come from this
  // frame; the older frames feed only the trend computation.
  const latest = snapshots[0];
  const innerSamples = latest.inner;
  const outerSamples = latest.outer;
  const innerMax = innerSamples.reduce((m, s) => Math.max(m, s.intensity), 0);
  const outerMax = outerSamples.reduce((m, s) => Math.max(m, s.intensity), 0);

  // Per-direction trend maps drive both the ring-level trend label AND
  // the directional-weighting refinement: a sample whose direction is
  // trending "leaving" is downgraded one intensity tier when computing
  // the tier-deciding intensity. Symmetric to the existing tier-bump on
  // approaching rings — same evidence bar (the unit-aware threshold over
  // the 45-minute window) on both sides of the inbound/outbound axis.
  const innerDirTrends = computePerDirectionTrends(snapshots.map((s) => s.inner), unit, "inner");
  const outerDirTrends = outerPoints.length
    ? computePerDirectionTrends(snapshots.map((s) => s.outer), unit, "outer")
    : new Map();
  const innerSummary = summarizeRingTrend(innerDirTrends);
  const outerSummary = outerPoints.length ? summarizeRingTrend(outerDirTrends) : { trend: "stable", confidence: 0 };
  const innerTrend = innerSummary.trend;
  const outerTrend = outerSummary.trend;
  const innerTrendConfidence = innerSummary.confidence;
  const outerTrendConfidence = outerSummary.confidence;

  // Tier-deciding intensity uses the N-th highest sample
  // (TIER_HYSTERESIS_N = 2) so a lone rogue pixel can't single-handedly
  // escalate the ring (D, May 2026). Building on top: each sample is
  // mapped to its effective intensity (E, May 2026) so directionally-
  // departing cells contribute less weight than directionally-incoming
  // ones at the same raw intensity. maxIntensity stays untouched as the
  // diagnostic ground truth.
  const innerEffective = innerSamples.map((s) => ({
    ...s, intensity: effectiveIntensityFor(s, innerDirTrends),
  }));
  const outerEffective = outerSamples.map((s) => ({
    ...s, intensity: effectiveIntensityFor(s, outerDirTrends),
  }));
  const innerTierIntensity = nthHighestIntensity(innerEffective, TIER_HYSTERESIS_N);
  const outerTierIntensity = nthHighestIntensity(outerEffective, TIER_HYSTERESIS_N);

  // Bump tier one notch when the ring trend is "approaching" and the
  // tier-deciding (i.e. hysteretic, post-down-weighting) intensity is
  // ≥ 2. Light-precip approaches (raw intensity 1) don't warrant raising
  // the banner tier — the AI summary still mentions them in its
  // narrative when relevant. Past data showed ~25 % of bumps were max=1
  // events that read as alarmist for what was essentially drizzle.
  const innerBaseLevel = RISK_LEVELS[innerTierIntensity];
  const outerBaseLevel = RISK_LEVELS[outerTierIntensity];
  const BUMP_MIN_INTENSITY = 2;
  const innerLevel = innerTrend === "approaching" && innerTierIntensity >= BUMP_MIN_INTENSITY
    ? TIER_BUMP[innerBaseLevel] : innerBaseLevel;
  const outerLevel = outerTrend === "approaching" && outerTierIntensity >= BUMP_MIN_INTENSITY
    ? TIER_BUMP[outerBaseLevel] : outerBaseLevel;

  // `bumped` is exposed directly so the AlertBanner doesn't have to
  // reverse-engineer it from `level vs naturalTier(maxIntensity)` — that
  // derivation breaks once hysteresis decouples the displayed tier from
  // raw max intensity (a max=4 / tier=2 ring bumped to orange by trend
  // would compare equal to naturalTier(max=4)=orange and the client
  // would miss the bump). The client reads `bumped` and picks the softer
  // "alert.approaching" wording when set.
  const innerBumped = innerLevel !== innerBaseLevel;
  const outerBumped = outerLevel !== outerBaseLevel;

  // Per-sample intensities ride along with the ring summary so the
  // WeatherMap can colour each visible sampling-point dot by its own
  // intensity (same tier mapping as the ring stroke). Each sample is
  // {direction, distance, intensity}; the client matches them to its
  // own buildSamplingPoints output by `${direction}:${distance}` key.
  const result = {
    inner: {
      level: innerLevel, maxIntensity: innerMax,
      trend: innerTrend, trendConfidence: innerTrendConfidence,
      bumped: innerBumped, samples: innerSamples,
    },
    outer: outerPoints.length
      ? {
        level: outerLevel, maxIntensity: outerMax,
        trend: outerTrend, trendConfidence: outerTrendConfidence,
        bumped: outerBumped, samples: outerSamples,
      }
      : null,
    timestamp: latest.frame.time,
  };

  // Diagnostic line — every server-side risk computation gets logged
  // with the decision values so post-mortem on a "why did the banner
  // fire then?" question can use journalctl. Compact one-line format
  // for grep-friendly analysis. Surfaces:
  //   - raw max AND hysteretic tier intensity (so a "why did the banner
  //     stay quiet?" question confirms hysteresis fired: max ≥ 4 but
  //     tier < 4 → ring stayed yellow).
  //   - per-direction trend distribution (so "why did the tier drop?"
  //     can confirm the per-direction down-weighting on leaving cells:
  //     a→2/l→4/s→10 means 2 dirs approaching, 4 leaving, 10 stable).
  const innerBumpMark = innerBumped ? "↑" : "·";
  const outerBumpMark = outerBumped ? "↑" : "·";
  const innerDist = trendDistribution(innerDirTrends);
  const outerDist = trendDistribution(outerDirTrends);
  const outerLog = outerPoints.length
    ? `outer=${outerLevel}${outerBumpMark}(max=${outerMax},tier=${outerTierIntensity},trend=${outerTrend}@${outerTrendConfidence}%,dirs=${outerDist})`
    : "outer=n/a";
  console.log(`[risk] ${cacheKey}: inner=${innerLevel}${innerBumpMark}(max=${innerMax},tier=${innerTierIntensity},trend=${innerTrend}@${innerTrendConfidence}%,dirs=${innerDist}) ${outerLog}`);

  riskCache.set(cacheKey, { result, expiresAt: Date.now() + ANALYSIS_CACHE_TTL });
  recordServiceCall("RainViewer (risk)", 200, "OK");
  increment("rainviewer", "risk");
  return result;
}

module.exports = { analyzeRadar, getRiskLevels };
