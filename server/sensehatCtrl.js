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
const { getSettingsData } = require("./settingsCtrl");
const { weatherCache }    = require("./proxyCtrl");

const API_TIMEOUT_MS   = 10_000;
const SUN_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const LOCAL_HTTPS_PORT = 8443;

/** Reusable HTTPS agent for internal localhost calls (self-signed cert). */
const _localAgent = new https.Agent({ rejectUnauthorized: false });

/** In-process sunrise/sunset cache — {data, key, expiry}. */
let _sunCache    = null;
let _sunCacheKey = null;
let _sunExpiry   = 0;

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

  const lat = settings.startingLat;
  const lon = settings.startingLon;

  if (lat == null || lon == null) {
    return res.status(503).json({
      error: "No location configured — set startingLat/startingLon in Settings",
    });
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

  return res.json({
    weatherCode:       values.weatherCode       ?? null,
    precipitationType: values.precipitationType ?? 0,
    cloudCover:        values.cloudCover        ?? 0,
    temperature:       values.temperature       ?? null,
    isDay,
  });
}

module.exports = { getSenseHatData };
