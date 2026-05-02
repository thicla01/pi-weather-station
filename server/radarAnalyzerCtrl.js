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

const ANALYSIS_CACHE_TTL = 5 * 60 * 1000;   // analysis text cached 5 min per location
const TILE_CACHE_TTL = 12 * 60 * 1000;      // tile PNGs cached 12 min (RainViewer refreshes every 10 min)
const FETCH_TIMEOUT_MS = 8 * 1000;
const ZOOM = 7;                             // RainViewer's max native zoom — best detail
const TILE_SIZE = 512;
const TARGET_OFFSETS_MIN = [0, -15, -45];   // now, 15 min ago, 45 min ago

// Sampling geometry per distance unit. Values are expressed in the user's
// chosen unit (km or mi); the great-circle math multiplies by KM_PER_UNIT
// when computing offsets, and the textual format echoes the unit label.
// Both rings keep 4 + 3 sample distances so the analyzer's behaviour and
// prompt size stay constant — only the spacing changes between unit modes.
//
// Must stay in sync with client/src/components/WeatherMap/index.js so the
// dots rendered on the map land on the points the analyzer actually reads.
const KM_PER_UNIT = { km: 1, mi: 1.609344 };
const RADAR_GEOMETRY = {
  km: {
    inner: [5, 15, 30, 50],
    outer: [65, 80, 100],
  },
  mi: {
    inner: [3, 10, 20, 30],
    outer: [40, 50, 60],
  },
};

const INNER_DIRECTIONS = [
  { name: "N",  bearing: 0   },
  { name: "NE", bearing: 45  },
  { name: "E",  bearing: 90  },
  { name: "SE", bearing: 135 },
  { name: "S",  bearing: 180 },
  { name: "SW", bearing: 225 },
  { name: "W",  bearing: 270 },
  { name: "NW", bearing: 315 },
];
// 16-point compass — the 8 cardinals interleaved with the 8 half-bearings
// (NNE/ENE/ESE/SSE/SSW/WSW/WNW/NNW). Used on the outer ring when
// doubleOuterPoints is on.
const OUTER_DIRECTIONS_DOUBLED = [
  { name: "N",   bearing: 0     },
  { name: "NNE", bearing: 22.5  },
  { name: "NE",  bearing: 45    },
  { name: "ENE", bearing: 67.5  },
  { name: "E",   bearing: 90    },
  { name: "ESE", bearing: 112.5 },
  { name: "SE",  bearing: 135   },
  { name: "SSE", bearing: 157.5 },
  { name: "S",   bearing: 180   },
  { name: "SSW", bearing: 202.5 },
  { name: "SW",  bearing: 225   },
  { name: "WSW", bearing: 247.5 },
  { name: "W",   bearing: 270   },
  { name: "WNW", bearing: 292.5 },
  { name: "NW",  bearing: 315   },
  { name: "NNW", bearing: 337.5 },
];

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
 * Fetch the latest list of past radar frames from RainViewer.
 *
 * @returns {Promise<Array<{time: Number, path: String}>>}
 */
async function fetchRadarFrames() {
  const r = await axios.get("https://api.rainviewer.com/public/weather-maps.json", {
    timeout: FETCH_TIMEOUT_MS,
  });
  return r.data?.radar?.past || [];
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

function readPixelIntensity(png, x, y) {
  if (x < 0 || x >= png.width || y < 0 || y >= png.height) return 0;
  const idx = (y * png.width + x) * 4;
  return pixelToIntensity(png.data[idx], png.data[idx + 1], png.data[idx + 2], png.data[idx + 3]);
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
 * Format a snapshot as a compact human-readable table for inclusion in a prompt.
 * Only directions that have at least one non-zero reading are listed, to keep
 * the prompt short when conditions are calm. Returns null when the entire grid
 * is clear (no precipitation anywhere within the sampled radius).
 *
 * @param {Array} samples
 * @param {String} label e.g. "now", "-15 min", "-45 min"
 * @param {String} unit "km" or "mi" — distance unit used in the sample values
 * @returns {String|null}
 */
function formatSnapshot(samples, label, unit) {
  // Group by direction. The display order follows the 16-point compass so
  // both 8-direction (inner-only) and 16-direction (with doubled outer)
  // snapshots come out sorted N → NNE → NE → … → NNW.
  const byDir = new Map();
  for (const dir of OUTER_DIRECTIONS_DOUBLED) byDir.set(dir.name, []);
  for (const s of samples) {
    if (!byDir.has(s.direction)) byDir.set(s.direction, []);
    byDir.get(s.direction).push(s);
  }

  // Sample distances are already expressed in the user's unit; the formatter
  // just appends the label.
  const fmtDist = (d) => `${d}${unit}`;

  let anyHit = false;
  const lines = [];
  for (const dir of OUTER_DIRECTIONS_DOUBLED) {
    const dirSamples = byDir.get(dir.name).sort((a, b) => a.distance - b.distance);
    if (!dirSamples.length) continue;
    const parts = dirSamples.map((s) => {
      if (s.intensity > 0) anyHit = true;
      return `${fmtDist(s.distance)} ${INTENSITY_LABELS[s.intensity]}`;
    });
    lines.push(`  ${dir.name.padEnd(3)} : ${parts.join(", ")}`);
  }

  // Largest sampled distance, used to phrase the "no precipitation" line
  // honestly (mode-aware: "within 50 km" vs "within 100 km" vs "within 30 mi").
  const maxDist = samples.reduce((m, s) => Math.max(m, s.distance), 0);
  if (!anyHit) return `${label}: clear (no precipitation within ${fmtDist(maxDist)})`;
  return `${label}:\n${lines.join("\n")}`;
}

/**
 * Run the full analysis for a location. Returns a multi-line string ready to
 * paste into a Claude prompt, or null if RainViewer data is unavailable.
 *
 * @param {Number} lat
 * @param {Number} lon
 * @param {Object} [options] Analysis options
 * @param {Boolean} [options.extendedRadius] Sample the outer ring in addition
 *   to the inner one — adds three extra distances per direction
 * @param {Boolean} [options.doubleOuterPoints] When extendedRadius is on, use
 *   16 directions (every 22.5°) on the outer ring instead of 8, to keep the
 *   point density per km² roughly uniform across both rings
 * @param {String}  [options.distanceUnit] "km" (default) or "mi" — drives
 *   sampling distances, the circle radius, and the unit label in the prompt
 * @returns {Promise<String|null>}
 */
async function analyzeRadar(lat, lon, options = {}) {
  const unit = options.distanceUnit === "mi" ? "mi" : "km";
  const geometry = RADAR_GEOMETRY[unit];
  const kmPerUnit = KM_PER_UNIT[unit];

  // Build the (direction, distance, bearing, distanceKm) tuples to sample.
  // Inner ring is always 8 directions; outer ring (if enabled) is 8 or 16
  // directions. distance carries the user-unit value (used for display);
  // distanceKm is the same value converted to km for the great-circle math.
  const points = [];
  for (const dir of INNER_DIRECTIONS) {
    for (const distance of geometry.inner) {
      points.push({ direction: dir.name, distance, bearing: dir.bearing, distanceKm: distance * kmPerUnit });
    }
  }
  if (options.extendedRadius) {
    const outerDirs = options.doubleOuterPoints
      ? OUTER_DIRECTIONS_DOUBLED
      : INNER_DIRECTIONS;
    for (const dir of outerDirs) {
      for (const distance of geometry.outer) {
        points.push({ direction: dir.name, distance, bearing: dir.bearing, distanceKm: distance * kmPerUnit });
      }
    }
  }

  // Cache key encodes the geometry mode AND the unit system so toggling any
  // flag never returns a stale snapshot built with a different sample set
  // or different unit text.
  let radiusTag = "s";
  if (options.extendedRadius) radiusTag = options.doubleOuterPoints ? "x2" : "x";
  const cacheKey = `${lat.toFixed(3)}:${lon.toFixed(3)}:${radiusTag}:${unit}`;
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
      const block = formatSnapshot(samples, label, unit);
      if (block) sections.push(block);
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

/**
 * Compute current radar-risk levels for the inner and (optionally) outer
 * sampling rings around a location. Reuses the same sampling pipeline as
 * analyzeRadar but only on the most recent frame — risk colouring is a
 * "right now" concern, not a trend (trend support is on the roadmap).
 *
 * Returns an object the WeatherMap consumes to colour its dashed circles.
 * Both rings carry the worst-case intensity sampled on that ring (see
 * RISK_LEVELS). When the outer ring isn't requested or its samples all
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
 *   inner: { level: String, maxIntensity: Number },
 *   outer: { level: String, maxIntensity: Number } | null,
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

  // Latest frame only — risk colouring reads "right now". The 3-frame
  // sequence the analyzer uses is for the AI prompt's movement reasoning.
  const frame = findFrameNear(frames, Date.now());
  if (!frame) return null;

  // Build inner sample points (always evaluated when this endpoint is hit).
  const innerPoints = [];
  for (const dir of INNER_DIRECTIONS) {
    for (const distance of geometry.inner) {
      innerPoints.push({ direction: dir.name, distance, bearing: dir.bearing, distanceKm: distance * kmPerUnit });
    }
  }
  const outerPoints = [];
  if (options.extendedRadius) {
    for (const dir of INNER_DIRECTIONS) {
      for (const distance of geometry.outer) {
        outerPoints.push({ direction: dir.name, distance, bearing: dir.bearing, distanceKm: distance * kmPerUnit });
      }
    }
  }

  let innerMax = 0;
  let outerMax = 0;
  try {
    const innerSamples = await buildSnapshot(lat, lon, frame.path, innerPoints);
    innerMax = innerSamples.reduce((m, s) => Math.max(m, s.intensity), 0);
    if (outerPoints.length) {
      const outerSamples = await buildSnapshot(lat, lon, frame.path, outerPoints);
      outerMax = outerSamples.reduce((m, s) => Math.max(m, s.intensity), 0);
    }
  } catch (err) {
    recordServiceCall("RainViewer (risk)", err?.response?.status || 500, "snapshot failed");
    return null;
  }

  const result = {
    inner: { level: RISK_LEVELS[innerMax], maxIntensity: innerMax },
    outer: outerPoints.length
      ? { level: RISK_LEVELS[outerMax], maxIntensity: outerMax }
      : null,
    timestamp: frame.time,
  };

  riskCache.set(cacheKey, { result, expiresAt: Date.now() + ANALYSIS_CACHE_TTL });
  recordServiceCall("RainViewer (risk)", 200, "OK");
  increment("rainviewer", "risk");
  return result;
}

module.exports = { analyzeRadar, getRiskLevels };
