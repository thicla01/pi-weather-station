const axios = require("axios").default;
const { getSettingsData } = require("./settingsCtrl");
const { recordServiceCall } = require("./serviceStatus");
const { increment } = require("./requestCounter");

const ALLOWED_STYLES = ["dark-v10", "light-v10"];

const WEATHER_CACHE_TTL = {
  current: 15 * 60 * 1000,
  hourly:  30 * 60 * 1000,
  daily:    6 * 60 * 60 * 1000,
};

const weatherCache = {};

function getCacheKey(type, lat, lon) {
  return `${type}:${lat.toFixed(4)}:${lon.toFixed(4)}`;
}

function getFromCache(key) {
  const entry = weatherCache[key];
  if (!entry) {
    console.log(`[cache] MISS  ${key}`);
    return null;
  }
  if (Date.now() > entry.expiresAt) {
    delete weatherCache[key];
    console.log(`[cache] EXPIRED ${key}`);
    return null;
  }
  const remainingSec = Math.round((entry.expiresAt - Date.now()) / 1000);
  console.log(`[cache] HIT  ${key} (expires in ${remainingSec}s)`);
  return entry.data;
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
      `https://us1.locationiq.com/v1/reverse.php?key=${settings.reverseGeoApiKey}&lat=${lat}&lon=${lon}&format=json`
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

  if (!ALLOWED_STYLES.includes(style)) {
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

  try {
    const result = await axios.get(
      `https://api.mapbox.com/styles/v1/mapbox/${style}/tiles/${zNum}/${xNum}/${yNum}?access_token=${settings.mapApiKey}`,
      { responseType: "arraybuffer" }
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

  const fields = ["temperature", "humidity", "windSpeed", "precipitationIntensity",
    "precipitationType", "precipitationProbability", "cloudCover", "weatherCode"].join("%2c");

  const cacheKey = getCacheKey("current", lat, lon);
  const cached = getFromCache(cacheKey);
  if (cached) return res.status(200).json(cached).end();

  try {
    const result = await axios.get(
      `https://api.tomorrow.io/v4/timelines?location=${lat}%2C${lon}&fields=${fields}&timesteps=current&apikey=${settings.weatherApiKey}`
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

  const fields = ["temperature", "precipitationProbability", "precipitationIntensity", "windSpeed"].join("%2c");
  const endTime = new Date(Date.now() + 60 * 60 * 23 * 1000).toISOString();

  const cacheKey = getCacheKey("hourly", lat, lon);
  const cached = getFromCache(cacheKey);
  if (cached) return res.status(200).json(cached).end();

  try {
    const result = await axios.get(
      `https://api.tomorrow.io/v4/timelines?location=${lat}%2C${lon}&fields=${fields}&timesteps=1h&apikey=${settings.weatherApiKey}&endTime=${endTime}`
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

  const fields = ["temperature", "precipitationProbability", "precipitationIntensity", "windSpeed"].join("%2c");
  const endTime = new Date(Date.now() + 4 * 60 * 60 * 24 * 1000).toISOString();

  const cacheKey = getCacheKey("daily", lat, lon);
  const cached = getFromCache(cacheKey);
  if (cached) return res.status(200).json(cached).end();

  try {
    const result = await axios.get(
      `https://api.tomorrow.io/v4/timelines?location=${lat}%2C${lon}&fields=${fields}&timesteps=1d&apikey=${settings.weatherApiKey}&endTime=${endTime}`
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

module.exports = { reverseGeocode, mapTile, weatherCurrent, weatherHourly, weatherDaily, weatherCache };
