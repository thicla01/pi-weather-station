// Indoor temperature integration with Homebridge (Config UI X REST API).
// Polls the /api/accessories endpoint, filters for the configured sensor by
// serviceName, and exposes the latest valid reading via /api/indoor-temperature.
//
// Activated only when settings.json contains:
//   {
//     "indoorTemperature": {
//       "enabled": true,
//       "homebridgeUrl": "http://192.168.6.212:8581",
//       "username": "admin",
//       "password": "...",
//       "sensorName": "Purificateur bureau"
//     }
//   }
//
// Users who don't configure it see no change to the app — the polling loop
// never starts, the endpoint returns 404, and the UI component renders nothing.

const axios = require("axios").default;
const { getSettingsData } = require("./settingsCtrl");
const { recordServiceCall } = require("./serviceStatus");
const { increment } = require("./requestCounter");

const POLL_INTERVAL_MS = 5 * 60 * 1000;     // 5 min between fetches
const STALE_THRESHOLD_MS = 30 * 60 * 1000;  // mark cached reading as stale after this
const TOKEN_REFRESH_MARGIN_MS = 60 * 1000;  // re-login this long before token expiry
const API_TIMEOUT_MS = 10 * 1000;
const TEMP_MIN = 5;       // °C — anything outside this is rejected as invalid (offline / sensor fault)
const TEMP_MAX = 40;
const HUMIDITY_MIN = 0;
const HUMIDITY_MAX = 100;
const AIR_QUALITY_MIN = 1;  // HomeKit AirQuality: 0=Unknown (rejected), 1=Excellent..5=Poor
const AIR_QUALITY_MAX = 5;

let cache = null;          // { value, humidity, airQuality, sensorName, lastUpdatedMs }
let token = null;
let tokenExpiresAt = 0;
let pollTimer = null;

function isValidTemperature(t) {
  return typeof t === "number" && t >= TEMP_MIN && t <= TEMP_MAX;
}

function isValidHumidity(h) {
  return typeof h === "number" && h >= HUMIDITY_MIN && h <= HUMIDITY_MAX;
}

function isValidAirQuality(v) {
  return Number.isInteger(v) && v >= AIR_QUALITY_MIN && v <= AIR_QUALITY_MAX;
}

async function login(homebridgeUrl, username, password) {
  const r = await axios.post(
    `${homebridgeUrl}/api/auth/login`,
    { username, password },
    { timeout: API_TIMEOUT_MS }
  );
  token = r.data.access_token;
  // expires_in is seconds; refresh slightly before it actually expires
  tokenExpiresAt = Date.now() + (r.data.expires_in * 1000) - TOKEN_REFRESH_MARGIN_MS;
}

async function fetchAccessoriesWithRetry(homebridgeUrl, username, password) {
  if (!token || Date.now() > tokenExpiresAt) {
    await login(homebridgeUrl, username, password);
  }
  try {
    return await axios.get(`${homebridgeUrl}/api/accessories`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: API_TIMEOUT_MS,
    });
  } catch (err) {
    // If the token was rejected (e.g. Homebridge restarted and rotated the JWT
    // secret), force a fresh login and try once more.
    if (err?.response?.status === 401) {
      token = null;
      tokenExpiresAt = 0;
      await login(homebridgeUrl, username, password);
      return await axios.get(`${homebridgeUrl}/api/accessories`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: API_TIMEOUT_MS,
      });
    }
    throw err;
  }
}

async function pollOnce() {
  let cfg;
  try {
    const settings = await getSettingsData();
    cfg = settings?.indoorTemperature;
  } catch {
    return; // No settings file or unreadable — nothing to do
  }

  if (!cfg?.enabled || !cfg.homebridgeUrl || !cfg.username || !cfg.password || !cfg.sensorName) {
    return;
  }

  try {
    const r = await fetchAccessoriesWithRetry(cfg.homebridgeUrl, cfg.username, cfg.password);
    const matching = (r.data || []).filter((a) => a?.serviceName === cfg.sensorName);

    // A single sensor name may correspond to multiple service objects (e.g. a
    // Dyson exposes both TemperatureSensor and HumiditySensor under the same
    // name) — pick the relevant value from each.
    const tempSvc = matching.find((a) => isValidTemperature(a?.values?.CurrentTemperature));
    const humSvc  = matching.find((a) => isValidHumidity(a?.values?.CurrentRelativeHumidity));
    const aqSvc   = matching.find((a) => isValidAirQuality(a?.values?.AirQuality));

    increment("homebridge", "accessories");

    if (!tempSvc) {
      // Sensor offline / out of range / not yet reporting — keep last valid cache
      recordServiceCall("Homebridge", 200, "No valid temperature reading");
      return;
    }

    cache = {
      value: tempSvc.values.CurrentTemperature,
      humidity: humSvc ? humSvc.values.CurrentRelativeHumidity : null,
      airQuality: aqSvc ? aqSvc.values.AirQuality : null,
      sensorName: cfg.sensorName,
      lastUpdatedMs: Date.now(),
    };
    recordServiceCall("Homebridge", 200, "OK");
  } catch (err) {
    const status = err?.response?.status || 500;
    // Record an error CODE only (e.g. "ECONNREFUSED"), never err.message:
    // axios messages embed the target — "connect ECONNREFUSED 10.0.0.5:8581",
    // "getaddrinfo ENOTFOUND homebridge.local" — and this comment is surfaced
    // verbatim by GET /api/health, which is not localhost-gated. Leaking the
    // internal Homebridge host:port would violate the same host-stripping
    // invariant that GET /settings enforces (see REMOTE_HIDDEN_KEYS). The bare
    // code carries all the diagnostic value the status code doesn't already.
    const message = err?.code || "Homebridge unreachable";
    recordServiceCall("Homebridge", status, String(message).slice(0, 100));
  }
}

/**
 * Starts the polling loop if the feature is enabled in settings.
 * Safe to call multiple times — clears any existing timer first.
 *
 * @returns {Promise<void>}
 */
async function initIndoorTemperature() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  let settings;
  try {
    settings = await getSettingsData();
  } catch {
    return;
  }

  if (!settings?.indoorTemperature?.enabled) {
    return;
  }

  // Initial fetch, then schedule
  pollOnce();
  pollTimer = setInterval(pollOnce, POLL_INTERVAL_MS);
  console.log("[indoor-temp] polling started");
}

/**
 * Express handler for GET /api/indoor-temperature.
 * Returns the cached reading, or 404 when the feature is not enabled.
 *
 * @param {Object} req
 * @param {Object} res
 */
async function getIndoorTemperature(req, res) {
  let settings;
  try {
    settings = await getSettingsData();
  } catch {
    return res.status(500).json("Could not read settings").end();
  }

  const cfg = settings?.indoorTemperature;
  if (!cfg?.enabled) {
    // 200 + { enabled: false } instead of 404. The 404 was logged by
    // browser devtools as a noisy network error on every poll for
    // users without Homebridge configured (default state). Clients
    // already inspect `data.enabled`, so 200 carries the same signal
    // without polluting the console.
    return res.status(200).json({ enabled: false }).end();
  }

  if (!cache) {
    return res.status(200).json({
      enabled: true,
      value: null,
      humidity: null,
      airQuality: null,
      sensorName: cfg.sensorName,
      lastUpdated: null,
      isStale: true,
    }).end();
  }

  const isStale = (Date.now() - cache.lastUpdatedMs) > STALE_THRESHOLD_MS;
  return res.status(200).json({
    enabled: true,
    value: cache.value,
    humidity: cache.humidity,
    airQuality: cache.airQuality,
    sensorName: cache.sensorName,
    lastUpdated: new Date(cache.lastUpdatedMs).toISOString(),
    isStale,
  }).end();
}

module.exports = { initIndoorTemperature, getIndoorTemperature };
