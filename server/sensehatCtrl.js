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
const { weatherCache, getCacheKey, CURRENT_FIELDS_HASH } = require("./proxyCtrl");
const { getActiveAlertsAt }  = require("./govAlertsCtrl");
const { getKioskLocation }   = require("./kioskLocationCtrl");
const { resolveMode, resolveRadarBrightness } = require("./sensehatModeCtrl");
const { getRiskLevels, buildRadarGrid } = require("./radarAnalyzerCtrl");

// Severity tiers that warrant overriding the SenseHat display with an
// alert pulse. "red" covers extreme + severe (tornado, hurricane,
// severe thunderstorm); "orange" covers moderate (winter storm
// warning, freeze warning). "yellow" (minor advisories) is below the
// override threshold — alerts at that level are routine and would
// just spam the LED matrix.
const SENSEHAT_ALERT_TIERS = new Set(["red", "orange"]);

// Modes whose renderer consumes the radar grid. Weather/clock modes never
// light the radar, so we skip the (cached, but non-free) getRiskLevels call
// for them and omit the `radar` field entirely.
const RADAR_GRID_MODES = new Set(["radar", "auto"]);

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
 * The key MUST be built with proxyCtrl's getCacheKey — the schema gained a
 * fieldsHash segment in 2026-05 and a hand-rolled legacy key silently
 * misses the cache forever (each /api/sensehat poll then burns a
 * Tomorrow.io call through the localhost fallback). Same bug class
 * already hit aiSummaryCtrl; see test/sensehatWeatherKey.test.js.
 *
 * @param {number} lat
 * @param {number} lon
 * @returns {object|null} Raw Tomorrow.io current payload, or null on miss.
 */
function _weatherFromCache(lat, lon) {
  const key   = getCacheKey("current", CURRENT_FIELDS_HASH, lat, lon);
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
  // Resolution order:
  //   1. Kiosk in-memory cache (`/api/kiosk-location` POSTed by the
  //      client when the user pans the map). Follows what's on screen.
  //   2. `settings.json` `startingLat` / `startingLon` (user-chosen
  //      persistent default).
  //   3. ipapi.co IP-based fallback (last-resort coarse location).
  //
  // The kiosk cache takes precedence so the Sense HAT alert override
  // tracks the user's current view — same alerts the AlertBanner is
  // showing on the kiosk get reflected on the LED matrix without the
  // user having to also save them as the persistent default.
  let lat;
  let lon;

  const kioskLoc = getKioskLocation();
  if (kioskLoc) {
    lat = kioskLoc.lat;
    lon = kioskLoc.lon;
  }

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
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    lat = parseFloat(settings.startingLat);
    lon = parseFloat(settings.startingLon);
  }

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
  // Best-effort, NEVER fail-fast. The alert override (step 5) is the most
  // critical Sense HAT signal — a gov-alert tier-red pulse must reach the
  // LED matrix even when Tomorrow.io is rate-limiting us. Previously this
  // block returned `502 "Could not fetch current weather"` on any axios
  // failure, which aborted the whole response — including the alert that
  // would have been fetched two steps below. Observed live 2026-05-28 on
  // the Saskatoon kiosk: Tomorrow.io 429 → no payload → Sense HAT stopped
  // pulsing red despite the heat warning still being active.
  //
  // With this change, a weather fetch failure leaves `weatherData = null`,
  // which propagates through the `values = weatherData?.…?.values ?? {}`
  // unwrap at step 4 and produces null/zero defaults in the response. The
  // Python script's `classify(weather_code, ...)` already treats
  // `weather_code = null` as 1000 (Clear) via `wc = weather_code or 1000`,
  // so the worst case on a Tomorrow.io outage is "wrong weather animation
  // for a few minutes" — much better than "alert pulse silently drops".
  let weatherData = _weatherFromCache(lat, lon);
  if (!weatherData) {
    try {
      const r = await axios.get(
        `https://localhost:${LOCAL_HTTPS_PORT}/api/weather/current?lat=${lat}&lon=${lon}`,
        { timeout: API_TIMEOUT_MS, httpsAgent: _localAgent }
      );
      weatherData = r.data;
    } catch (err) {
      console.warn("[sensehat] weather fetch failed:", err.message);
      weatherData = null;
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

  // ── 6. Radar grid (radar / auto modes only) ─────────────────────────────
  // A coarse 8×8 top-down view of precipitation around the user. Computed
  // only when the selected mode will actually render it. getRiskLevels is
  // the same 5-min-cached pipeline the map's risk endpoint uses, so this
  // rarely triggers a fresh tile fetch. Best-effort: on failure we omit the
  // field and the script falls back (radar mode → centre dot, auto → glyph).
  const mode = resolveMode(settings);
  let radarField;
  if (RADAR_GRID_MODES.has(mode)) {
    try {
      const extendedRadius = Boolean(settings?.advanced?.ai?.extendedRadius);
      const risk = await getRiskLevels(lat, lon, { extendedRadius, distanceUnit: "km" });
      if (risk) {
        const samples = [...(risk.inner?.samples || []), ...(risk.outer?.samples || [])];
        const { grid, litCells, radiusKm } = buildRadarGrid(samples, { distanceUnit: "km" });
        radarField = { grid, litCells, radiusKm };
      }
    } catch (err) {
      console.warn("[sensehat] radar grid failed:", err.message);
    }
  }

  return res.json({
    weatherCode:       values.weatherCode       ?? null,
    precipitationType: values.precipitationType ?? 0,
    cloudCover:        values.cloudCover        ?? 0,
    temperature:       values.temperature       ?? null,
    isDay,
    sunriseTs,
    sunsetTs,
    mode,
    radarBrightness: resolveRadarBrightness(settings),
    ...(radarField ? { radar: radarField } : {}),
    ...(alertField ? { alert: alertField } : {}),
  });
}

module.exports = {
  getSenseHatData,
  // Exported for regression testing only — guards the shared-cache key
  // contract with proxyCtrl (see test/sensehatWeatherKey.test.js).
  __test: { _weatherFromCache },
};
