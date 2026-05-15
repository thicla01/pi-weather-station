const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const axios = require("axios").default;
const { getSettingsData } = require("./settingsCtrl");
const { recordServiceCall } = require("./serviceStatus");
const { increment } = require("./requestCounter");

/**
 * Field-set signature for a Tomorrow.io request. Used inside the cache
 * key so that when the list of requested fields changes between
 * releases (as it did in 2.14.2 when temperatureMax / temperatureMin /
 * weatherCodeMax / precipitationProbabilityMax were added for the v3
 * 5-day column strip), cached entries built against the old field set
 * become unreachable — the next lookup misses, refetches, and stores
 * a fresh entry with the new shape. Without this, the disk cache file
 * (loaded on startup) silently served old-shape responses for hours
 * after an upgrade. The HMIRaspi kiosk hit this on 2.14.4 → 2.14.5
 * upgrade and only recovered after a manual `rm weather-cache.json`
 * plus a coord change that rebuilt the cache entry.
 *
 * @param {string[]} fields — array of field names (the same array we
 *   feed to the Tomorrow.io `fields=` URL parameter)
 * @returns {string} short 8-hex-char SHA1 of the joined field list
 */
function hashFields(fields) {
  return crypto.createHash("sha1").update(fields.join(",")).digest("hex").slice(0, 8);
}

const ALLOWED_STYLES = ["dark-v10", "dark-v11", "light-v10", "light-v11", "navigation-day-v1", "streets-v12"];

/**
 * Custom Mapbox Studio styles (Protected visibility).
 * Maps a short style name to its full "username/style-id" path.
 * Tiles are served with the end-user's own Mapbox API key.
 */
const CUSTOM_STYLES = {
  "custom-light": "thicla01/cmoc9fbfs00c801s833rub3b7",
};

const API_TIMEOUT_MS = 10 * 1000;

const WEATHER_CACHE_TTL = {
  current: 15 * 60 * 1000,
  hourly:  30 * 60 * 1000,
  daily:    6 * 60 * 60 * 1000,
};

/**
 * Tomorrow.io field lists per timestep granularity. Pulled out to
 * module scope so we can hash them once at startup (see hashFields).
 * The hash becomes part of every cache key, so adding/removing a
 * field in any of these arrays automatically invalidates the
 * corresponding cached entries — no need to manually rm the disk
 * cache after an upgrade that changes the request shape.
 *
 *   - Current adds uvIndex + epaIndex on top of the common subset
 *     because they're real-time read-outs in the InfoPanel, not
 *     values we chart over time.
 *   - Daily includes the Max/Min variants used by the v3 5-day
 *     column strip (DailyForecastColumns) on top of the avg fields
 *     the v2 Chart.js DailyChart still consumes.
 */
const CURRENT_FIELDS = [
  "temperature", "humidity", "windSpeed", "precipitationIntensity",
  "precipitationType", "precipitationProbability", "cloudCover",
  "weatherCode", "uvIndex", "epaIndex",
];
const HOURLY_FIELDS = [
  "temperature", "precipitationProbability", "precipitationIntensity", "windSpeed",
  // weatherCode added in 2.14.41 to render the icon column in
  // HourlyForecastColumns (the third view in the 24h tab cycle).
  // Adding to the list bumps HOURLY_FIELDS_HASH, which orphans every
  // cached hourly entry and forces a fresh fetch on next request — see
  // the cache-versioning rationale at the top of this file.
  "weatherCode",
];
const DAILY_FIELDS = [
  "temperature", "temperatureMax", "temperatureMin",
  "precipitationProbability", "precipitationProbabilityMax",
  "precipitationIntensity", "windSpeed", "weatherCodeMax",
];

// Computed once at module load. Used in every cache key — see
// getCacheKey() for the rationale.
const CURRENT_FIELDS_HASH = hashFields(CURRENT_FIELDS);
const HOURLY_FIELDS_HASH = hashFields(HOURLY_FIELDS);
const DAILY_FIELDS_HASH = hashFields(DAILY_FIELDS);

const CACHE_FILE = path.join(__dirname, "weather-cache.json");

const weatherCache = {};
let cacheHits = 0;
let cacheMisses = 0;

function loadCacheFromDisk() {
  try {
    const raw = fs.readFileSync(CACHE_FILE, "utf8");
    const saved = JSON.parse(raw);
    const now = Date.now();
    let loaded = 0;
    let skipped = 0;
    for (const [key, entry] of Object.entries(saved)) {
      // Legacy entries (pre-2.14.6) had 3 colon-separated parts:
      // `type:lat:lon`. Current entries have 4: `type:hash:lat:lon`.
      // Skip the legacy shape so we don't serve cached responses that
      // were built against an obsolete field list — the lookup paths
      // below all generate 4-part keys now, so old entries would never
      // be hit anyway, but dropping them explicitly keeps the on-disk
      // file clean and the startup log honest.
      if (key.split(":").length !== 4) {
        skipped++;
        continue;
      }
      if (entry.expiresAt > now) {
        weatherCache[key] = entry;
        loaded++;
      }
    }
    if (loaded > 0) console.log(`[cache] Loaded ${loaded} entries from disk`);
    if (skipped > 0) console.log(`[cache] Skipped ${skipped} legacy entries (pre-2.14.6 schema)`);
  } catch {
    // File missing or unreadable — start with empty cache
  }
}

function saveCacheToDisk() {
  try {
    const now = Date.now();
    const toSave = {};
    for (const [key, entry] of Object.entries(weatherCache)) {
      if (entry.expiresAt > now) toSave[key] = entry;
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(toSave), "utf8");
  } catch (err) {
    console.error("[cache] Failed to save cache to disk:", err.message);
  }
}

loadCacheFromDisk();
setInterval(saveCacheToDisk, 5 * 60 * 1000).unref();

/**
 * @param {string} type — `current` / `hourly` / `daily`
 * @param {string} fieldsHash — 8-char field-set signature (see hashFields)
 * @param {number} lat — latitude (4-decimal precision in the key)
 * @param {number} lon — longitude
 * @returns {string} cache key
 */
function getCacheKey(type, fieldsHash, lat, lon) {
  return `${type}:${fieldsHash}:${lat.toFixed(4)}:${lon.toFixed(4)}`;
}

function getFromCache(key) {
  const entry = weatherCache[key];
  if (!entry) {
    cacheMisses++;
    console.log(`[cache] MISS  ${key}`);
    return null;
  }
  if (Date.now() > entry.expiresAt) {
    delete weatherCache[key];
    cacheMisses++;
    console.log(`[cache] EXPIRED ${key}`);
    return null;
  }
  cacheHits++;
  const remainingSec = Math.round((entry.expiresAt - Date.now()) / 1000);
  console.log(`[cache] HIT  ${key} (expires in ${remainingSec}s)`);
  return entry.data;
}

function getCacheStats() {
  const total = cacheHits + cacheMisses;
  return {
    hits: cacheHits,
    misses: cacheMisses,
    rate: total > 0 ? Math.round((100 * cacheHits) / total) : null,
  };
}

function setInCache(key, data, ttl) {
  weatherCache[key] = { data, expiresAt: Date.now() + ttl };
  console.log(`[cache] SET  ${key} (ttl ${ttl / 1000}s)`);
}

/**
 * Proxy: reverse geocode via LocationIQ, keeping the API key server-side
 *
 * @param {Object} req
 * @param {Object} req.query
 * @param {String} req.query.lat
 * @param {String} req.query.lon
 * @param {Object} res
 */
async function reverseGeocode(req, res) {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);

  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return res.status(400).json("Invalid coordinates").end();
  }

  let settings;
  try {
    settings = await getSettingsData();
  } catch {
    return res.status(500).json("Could not read settings").end();
  }

  if (!settings.reverseGeoApiKey) {
    return res.status(503).json("Reverse geocoding API key not configured").end();
  }

  try {
    const result = await axios.get(
      `https://us1.locationiq.com/v1/reverse.php?key=${settings.reverseGeoApiKey}&lat=${lat}&lon=${lon}&format=json`,
      { timeout: API_TIMEOUT_MS }
    );
    increment("locationiq", "geocode");
    recordServiceCall("LocationIQ", 200, "OK");
    return res.status(200).json(result.data).end();
  } catch (err) {
    const status = err?.response?.status || 500;
    const message = err?.response?.data?.error || "Reverse geocoding failed";
    increment("locationiq", "geocode");
    recordServiceCall("LocationIQ", status, message);
    return res.status(500).json("Reverse geocoding failed").end();
  }
}

/**
 * Proxy: Mapbox map tiles, keeping the API key server-side
 *
 * @param {Object} req
 * @param {Object} req.params
 * @param {String} req.params.style  Mapbox style (dark-v10 or light-v10)
 * @param {String} req.params.z      Zoom level
 * @param {String} req.params.x      Tile x coordinate
 * @param {String} req.params.y      Tile y coordinate
 * @param {Object} res
 */
async function mapTile(req, res) {
  const { style, z, x, y } = req.params;

  if (!ALLOWED_STYLES.includes(style) && !CUSTOM_STYLES[style]) {
    return res.status(400).json("Invalid map style").end();
  }

  const zNum = parseInt(z, 10);
  const xNum = parseInt(x, 10);
  const yNum = parseInt(y, 10);

  if ([zNum, xNum, yNum].some(isNaN) || zNum < 0 || zNum > 22) {
    return res.status(400).json("Invalid tile coordinates").end();
  }

  let settings;
  try {
    settings = await getSettingsData();
  } catch {
    return res.status(500).json("Could not read settings").end();
  }

  if (!settings.mapApiKey) {
    return res.status(503).json("Map API key not configured").end();
  }

  const stylePath = CUSTOM_STYLES[style] ?? `mapbox/${style}`;
  // Custom styles require an explicit tile size; built-in mapbox styles work without it.
  const tileUrl = CUSTOM_STYLES[style]
    ? `https://api.mapbox.com/styles/v1/${stylePath}/tiles/256/${zNum}/${xNum}/${yNum}?access_token=${settings.mapApiKey}`
    : `https://api.mapbox.com/styles/v1/${stylePath}/tiles/${zNum}/${xNum}/${yNum}?access_token=${settings.mapApiKey}`;

  try {
    const result = await axios.get(
      tileUrl,
      { responseType: "arraybuffer", timeout: API_TIMEOUT_MS }
    );

    const contentType = result.headers["content-type"];
    const cacheControl = result.headers["cache-control"];
    if (contentType) res.setHeader("Content-Type", contentType);
    if (cacheControl) res.setHeader("Cache-Control", cacheControl);

    increment("mapbox", "tiles");
    recordServiceCall("Mapbox", 200, "OK");
    return res.status(200).send(Buffer.from(result.data));
  } catch (err) {
    const status = err?.response?.status || 500;
    const message = err?.response?.data || "Could not fetch map tile";
    increment("mapbox", "tiles");
    recordServiceCall("Mapbox", status, String(message).slice(0, 100));
    return res.status(500).json("Could not fetch map tile").end();
  }
}

/**
 * Proxy: Tomorrow.io current weather, keeping the API key server-side
 *
 * @param {Object} req
 * @param {Object} req.query
 * @param {String} req.query.lat
 * @param {String} req.query.lon
 * @param {Object} res
 */
async function weatherCurrent(req, res) {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);

  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return res.status(400).json("Invalid coordinates").end();
  }

  let settings;
  try {
    settings = await getSettingsData();
  } catch {
    return res.status(500).json("Could not read settings").end();
  }

  if (!settings.weatherApiKey) {
    return res.status(503).json("Weather API key not configured").end();
  }

  const fields = CURRENT_FIELDS.join("%2c");
  const cacheKey = getCacheKey("current", CURRENT_FIELDS_HASH, lat, lon);
  const cached = getFromCache(cacheKey);
  if (cached) return res.status(200).json(cached).end();

  try {
    const result = await axios.get(
      `https://api.tomorrow.io/v4/timelines?location=${lat}%2C${lon}&fields=${fields}&timesteps=current&apikey=${settings.weatherApiKey}`,
      { timeout: API_TIMEOUT_MS }
    );
    setInCache(cacheKey, result.data, WEATHER_CACHE_TTL.current);
    increment("tomorrow.io", "current");
    recordServiceCall("Tomorrow.io (current)", 200, "OK");
    return res.status(200).json(result.data).end();
  } catch (err) {
    const status = err?.response?.status || 500;
    const message = err?.response?.data?.message || err?.response?.data || "Weather request failed";
    increment("tomorrow.io", "current");
    recordServiceCall("Tomorrow.io (current)", status, String(message).slice(0, 100));
    return res.status(status).json(message).end();
  }
}

/**
 * Proxy: Tomorrow.io hourly weather, keeping the API key server-side
 *
 * @param {Object} req
 * @param {Object} req.query
 * @param {String} req.query.lat
 * @param {String} req.query.lon
 * @param {Object} res
 */
async function weatherHourly(req, res) {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);

  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return res.status(400).json("Invalid coordinates").end();
  }

  let settings;
  try {
    settings = await getSettingsData();
  } catch {
    return res.status(500).json("Could not read settings").end();
  }

  if (!settings.weatherApiKey) {
    return res.status(503).json("Weather API key not configured").end();
  }

  const fields = HOURLY_FIELDS.join("%2c");
  const endTime = new Date(Date.now() + 60 * 60 * 23 * 1000).toISOString();

  const cacheKey = getCacheKey("hourly", HOURLY_FIELDS_HASH, lat, lon);
  const cached = getFromCache(cacheKey);
  if (cached) return res.status(200).json(cached).end();

  try {
    const result = await axios.get(
      `https://api.tomorrow.io/v4/timelines?location=${lat}%2C${lon}&fields=${fields}&timesteps=1h&apikey=${settings.weatherApiKey}&endTime=${endTime}`,
      { timeout: API_TIMEOUT_MS }
    );
    setInCache(cacheKey, result.data, WEATHER_CACHE_TTL.hourly);
    increment("tomorrow.io", "hourly");
    recordServiceCall("Tomorrow.io (hourly)", 200, "OK");
    return res.status(200).json(result.data).end();
  } catch (err) {
    const status = err?.response?.status || 500;
    const message = err?.response?.data?.message || err?.response?.data || "Weather request failed";
    increment("tomorrow.io", "hourly");
    recordServiceCall("Tomorrow.io (hourly)", status, String(message).slice(0, 100));
    return res.status(status).json(message).end();
  }
}

/**
 * Proxy: Tomorrow.io daily weather, keeping the API key server-side
 *
 * @param {Object} req
 * @param {Object} req.query
 * @param {String} req.query.lat
 * @param {String} req.query.lon
 * @param {Object} res
 */
async function weatherDaily(req, res) {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);

  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return res.status(400).json("Invalid coordinates").end();
  }

  let settings;
  try {
    settings = await getSettingsData();
  } catch {
    return res.status(500).json("Could not read settings").end();
  }

  if (!settings.weatherApiKey) {
    return res.status(503).json("Weather API key not configured").end();
  }

  const fields = DAILY_FIELDS.join("%2c");
  const endTime = new Date(Date.now() + 4 * 60 * 60 * 24 * 1000).toISOString();

  const cacheKey = getCacheKey("daily", DAILY_FIELDS_HASH, lat, lon);
  const cached = getFromCache(cacheKey);
  if (cached) return res.status(200).json(cached).end();

  try {
    const result = await axios.get(
      `https://api.tomorrow.io/v4/timelines?location=${lat}%2C${lon}&fields=${fields}&timesteps=1d&apikey=${settings.weatherApiKey}&endTime=${endTime}`,
      { timeout: API_TIMEOUT_MS }
    );
    setInCache(cacheKey, result.data, WEATHER_CACHE_TTL.daily);
    increment("tomorrow.io", "daily");
    recordServiceCall("Tomorrow.io (daily)", 200, "OK");
    return res.status(200).json(result.data).end();
  } catch (err) {
    const status = err?.response?.status || 500;
    const message = err?.response?.data?.message || err?.response?.data || "Weather request failed";
    increment("tomorrow.io", "daily");
    recordServiceCall("Tomorrow.io (daily)", status, String(message).slice(0, 100));
    return res.status(status).json(message).end();
  }
}

/**
 * Proxy: sunrise-sunset.org, avoiding mixed-content issues and enabling service tracking
 *
 * @param {Object} req
 * @param {Object} req.query
 * @param {String} req.query.lat
 * @param {String} req.query.lon
 * @param {Object} res
 */
async function sunriseSunset(req, res) {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);

  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return res.status(400).json("Invalid coordinates").end();
  }

  try {
    const result = await axios.get(
      `https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lon}&formatted=0`,
      { timeout: API_TIMEOUT_MS }
    );
    recordServiceCall("sunrise-sunset.org", 200, "OK");
    return res.status(200).json(result.data).end();
  } catch (err) {
    const status = err?.response?.status || 500;
    const message = err?.response?.data?.status || "Sunrise/sunset request failed";
    recordServiceCall("sunrise-sunset.org", status, String(message).slice(0, 100));
    return res.status(500).json("Sunrise/sunset request failed").end();
  }
}

module.exports = {
  reverseGeocode, mapTile, weatherCurrent, weatherHourly, weatherDaily,
  sunriseSunset, weatherCache, saveCacheToDisk, getCacheStats,
  // Exposed so aiSummaryCtrl can read entries from the shared in-memory
  // cache using the SAME versioned key schema proxyCtrl writes with.
  // Before this export the controller had its own 3-part lookup helpers
  // (`hourly:<lat>:<lon>`) which silently missed every entry after the
  // 2026-05-13 schema bump to `type:fieldsHash:lat:lon` — paragraph 2 of
  // the AI summary disappeared as a result (no hourly data → no forecast
  // section → no daily fallback either). Keep these in sync if the
  // proxyCtrl cache key shape ever changes again.
  getCacheKey, CURRENT_FIELDS_HASH, HOURLY_FIELDS_HASH, DAILY_FIELDS_HASH,
};
