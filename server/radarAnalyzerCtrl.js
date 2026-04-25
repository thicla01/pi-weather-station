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

const SAMPLE_DISTANCES_KM = [5, 15, 30, 45];
const SAMPLE_DIRECTIONS = [
  { name: "N",  bearing: 0   },
  { name: "NE", bearing: 45  },
  { name: "E",  bearing: 90  },
  { name: "SE", bearing: 135 },
  { name: "S",  bearing: 180 },
  { name: "SW", bearing: 225 },
  { name: "W",  bearing: 270 },
  { name: "NW", bearing: 315 },
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

/**
 * Compute a destination lat/lon from a starting point, distance, and bearing.
 * Uses the standard great-circle formula; accurate enough for our 5-45 km range.
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
 * @returns {Promise<Array<{direction: String, distance: Number, intensity: Number}>>}
 */
async function buildSnapshot(lat, lon, framePath) {
  const samples = [];
  // Group by tile to minimize fetches
  const tileMap = new Map(); // "tileX:tileY" → list of pending samples
  for (const dir of SAMPLE_DIRECTIONS) {
    for (const distance of SAMPLE_DISTANCES_KM) {
      const point = offsetLatLon(lat, lon, distance, dir.bearing);
      const { tileX, tileY, pixelX, pixelY } = latLonToTilePixel(point.lat, point.lon);
      const key = `${tileX}:${tileY}`;
      if (!tileMap.has(key)) tileMap.set(key, []);
      tileMap.get(key).push({ direction: dir.name, distance, pixelX, pixelY });
    }
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
 * is clear (no precipitation anywhere within 45 km).
 *
 * @param {Array} samples
 * @param {String} label e.g. "now", "-15 min", "-45 min"
 * @returns {String|null}
 */
function formatSnapshot(samples, label) {
  // Group by direction, keep order
  const byDir = new Map();
  for (const dir of SAMPLE_DIRECTIONS) byDir.set(dir.name, []);
  for (const s of samples) byDir.get(s.direction).push(s);

  let anyHit = false;
  const lines = [];
  for (const dir of SAMPLE_DIRECTIONS) {
    const dirSamples = byDir.get(dir.name).sort((a, b) => a.distance - b.distance);
    const parts = dirSamples.map((s) => {
      if (s.intensity > 0) anyHit = true;
      return `${s.distance}km ${INTENSITY_LABELS[s.intensity]}`;
    });
    lines.push(`  ${dir.name.padEnd(2)} : ${parts.join(", ")}`);
  }

  if (!anyHit) return `${label}: clear (no precipitation within 45 km)`;
  return `${label}:\n${lines.join("\n")}`;
}

/**
 * Run the full analysis for a location. Returns a multi-line string ready to
 * paste into a Claude prompt, or null if RainViewer data is unavailable.
 *
 * @param {Number} lat
 * @param {Number} lon
 * @returns {Promise<String|null>}
 */
async function analyzeRadar(lat, lon) {
  const cacheKey = `${lat.toFixed(3)}:${lon.toFixed(3)}`;
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
      const samples = await buildSnapshot(lat, lon, frame.path);
      const block = formatSnapshot(samples, label);
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

module.exports = { analyzeRadar };
