"use strict";

/**
 * sensehatCtrl.js — GET /api/sensehat
 *
 * Returns a lightweight JSON payload for the Sense HAT display script.
 * Pulls current weather from the shared in-process weatherCache (populated
 * by proxyCtrl) so no extra Tomorrow.io quota is consumed.  Falls back to
 * an internal HTTPS call to /api/weather/current when the cache is cold.
 * Sunrise/sunset is fetched from sunrise-sunset.org and cached in-process
 * for one hour (it changes slowly and has no API key requirement).
 */

const axios = require("axios");
const https = require("https");
const { getSettingsData }    = require("./settingsCtrl");
const { weatherCache }       = require("./proxyCtrl");
const { getActiveAlertsAt }  = require("./govAlertsCtrl");

// Severity tiers that warrant overriding the SenseHat display with an
// alert pulse. "red" covers extreme + severe (tornado, hurricane,
// severe thunderstorm); "orange" covers moderate (winter storm
// warning, freeze warning). "yellow" (minor advisories) is below the
// override threshold — alerts at that level are routine and would
// just spam the LED matrix.
const SENSEHAT_ALERT_TIERS = new Set(["red", "orange"]);

const API_TIMEOUT_MS   = 10_000;
const SUN_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const GEO_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const LOCAL_HTTPS_PORT = 8443;

/** Reusable HTTPS agent for internal localhost calls (self-signed cert). */
const _localAgent = new https.Agent({ rejectUnauthorized: false });

/** In-process sunrise/sunset cache — {data, key, expiry}. */
let _sunCache    = null;
let _sunCacheKey = null;
let _sunExpiry   = 0;

/** In-process ipapi.co geolocation cache — used when settings has no coordinates. */
let _geoCache   = null; // { lat, lon }
let _geoExpiry  = 0;

/**
 * Read current weather from the shared in-memory weatherCache.
 *
 * @param {number} lat
 * @param {number} lon
 * @returns {object|null} Raw Tomorrow.io current payload, or null on miss.
 */
function _weatherFromCache(lat, lon) {
  const key   = `current:${lat.toFixed(4)}:${lon.toFixed(4)}`;
  const entry = weatherCache[key];
  return entry && Date.now() < entry.expiresAt ? entry.data : null;
}

/**
 * Determine whether the current time is between sunrise and sunset.
 *
 * @param {string} sunrise ISO 8601 UTC string
 * @param {string} sunset  ISO 8601 UTC string
 * @returns {boolean}
 */
function _computeIsDay(sunrise, sunset) {
  const now = Date.now();
  return now >= new Date(sunrise).getTime() && now < new Date(sunset).getTime();
}

/**
 * GET /api/sensehat
 *
 * Returns aggregated weather state for the Sense HAT display script.
 *
 * Response fields:
 *   weatherCode       {number|null}  Tomorrow.io weather code
 *   precipitationType {number}       0=none 1=rain 2=snow 3=freezingRain 4=ice
 *   cloudCover        {number}       0–100 %
 *   temperature       {number|null}  °C
 *   isDay             {boolean}      true between sunrise and sunset
 *
 * @param {import("express").Request}  req
 * @param {import("express").Response} res
 * @returns {Promise<void>}
 */
async function getSenseHatData(req, res) {
  // ── 1. Location ─────────────────────────────────────────────────────────────
  let settings;
  try {
    settings = await getSettingsData();
  } catch {
    return res.status(500).json({ error: "Could not read settings" });
  }

  // Coerce to Number — settings.json stores startingLat/Lon as strings
  // ("45.5" / "" / null depending on whether the user filled the
  // Advanced → Custom location field or cleared it). parseFloat("")
  // returns NaN, and Number.isFinite(NaN) is false — so the guard
  // below catches both "no value" and "garbage value" uniformly.
  let lat = parseFloat(settings.startingLat);
  let lon = parseFloat(settings.startingLon);

  // ── Fallback to IP-based geolocation when no location is configured ──────
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    if (_geoCache && Date.now() < _geoExpiry) {
      ({ lat, lon } = _geoCache);
    } else {
      try {
        const r = await axios.get("https://ipapi.co/json/", { timeout: API_TIMEOUT_MS });
        lat = r.data.latitude;
        lon = r.data.longitude;
        _geoCache  = { lat, lon };
        _geoExpiry = Date.now() + GEO_CACHE_TTL_MS;
      } catch {
        return res.status(503).json({
          error: "No location configured and IP geolocation failed — set startingLat/startingLon in Settings",
        });
      }
    }
  }

  // ── 2. Current weather (shared cache → local HTTPS fallback) ─────────────
  let weatherData = _weatherFromCache(lat, lon);
  if (!weatherData) {
    try {
      const r = await axios.get(
        `https://localhost:${LOCAL_HTTPS_PORT}/api/weather/current?lat=${lat}&lon=${lon}`,
        { timeout: API_TIMEOUT_MS, httpsAgent: _localAgent }
      );
      weatherData = r.data;
    } catch {
      return res.status(502).json({ error: "Could not fetch current weather" });
    }
  }

  // ── 3. Sunrise/sunset (1-hour in-process cache) ──────────────────────────
  const sunKey = `${lat.toFixed(4)}:${lon.toFixed(4)}`;
  let sunData = null;

  if (_sunCacheKey === sunKey && Date.now() < _sunExpiry) {
    sunData = _sunCache;
  } else {
    try {
      const r = await axios.get(
        `https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lon}&formatted=0`,
        { timeout: API_TIMEOUT_MS }
      );
      sunData      = r.data;
      _sunCache    = sunData;
      _sunCacheKey = sunKey;
      _sunExpiry   = Date.now() + SUN_CACHE_TTL_MS;
    } catch {
      // Fall through to hour-based heuristic below
    }
  }

  // ── 4. Extract values from Tomorrow.io payload ───────────────────────────
  const values = weatherData?.data?.timelines?.[0]?.intervals?.[0]?.values ?? {};

  const isDay = (sunData?.results?.sunrise && sunData?.results?.sunset)
    ? _computeIsDay(sunData.results.sunrise, sunData.results.sunset)
    : (new Date().getHours() >= 6 && new Date().getHours() < 20);

  const sunriseTs = sunData?.results?.sunrise ? new Date(sunData.results.sunrise).getTime() : null;
  const sunsetTs  = sunData?.results?.sunset  ? new Date(sunData.results.sunset).getTime()  : null;

  // ── 5. Government alert (best-effort) ───────────────────────────────────
  // Hits the same ECCC + NWS orchestration the AlertBanner uses. Each
  // source has a 5 min internal cache so polling at the LED-script
  // cadence (60 s) only triggers an upstream fetch once per cache
  // window. Failure here is non-fatal — we just omit the alert field
  // and the script keeps rendering weather.
  let alertField;
  try {
    const alerts = await getActiveAlertsAt(lat, lon);
    const top = alerts.find((a) => SENSEHAT_ALERT_TIERS.has(a.tier));
    if (top) {
      alertField = {
        tier:     top.tier,     // "red" | "orange"
        severity: top.severity, // "extreme" | "severe" | "moderate"
        source:   top.source,   // "ECCC" | "NWS"
        event:    top.event,    // short event name e.g. "Tornado Warning"
      };
    }
  } catch {
    // Upstream errored — leave alertField undefined, no override.
  }

  return res.json({
    weatherCode:       values.weatherCode       ?? null,
    precipitationType: values.precipitationType ?? 0,
    cloudCover:        values.cloudCover        ?? 0,
    temperature:       values.temperature       ?? null,
    isDay,
    sunriseTs,
    sunsetTs,
    ...(alertField ? { alert: alertField } : {}),
  });
}

module.exports = { getSenseHatData };
