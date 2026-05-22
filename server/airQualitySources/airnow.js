// EPA AirNow source — closes the US-side gap in the badge's coverage
// chain. AirNow is the official cooperative air-quality network run
// by the EPA + state/local agencies + tribes; the API is free with a
// per-account key (rate-limited at 500 calls/hour, generous for our
// 30-min polling cadence). This module only fires when the user has
// configured `airNowApiKey` in settings.json — without a key the
// `tryAqi` call returns null silently and the orchestrator falls
// through to the next source as if AirNow weren't installed.
//
// Response shape: a JSON array with one record per pollutant present
// at the nearest reporting area (typically O3 + PM2.5 + PM10). EPA's
// AQI methodology defines the worst-case across pollutants as the
// reported value, so we pick `max(AQI)` across the records.
//
// `kind: "nowcast"` is technically the most accurate label: AirNow
// reports the NowCast 12-hour weighted average for PM2.5/PM10 and
// 1-hour averages for O3, both of which are EPA's official "current
// observation" methodology rather than an instantaneous spot value.
// The badge's tooltip surfaces "NowCast" so the user knows the
// number is real-time-ish but not raw-instantaneous.

const axios = require("axios").default;
const { recordServiceCall } = require("../serviceStatus");
const { increment } = require("../requestCounter");
const { TIMEOUT_MS, haversineKm, categoryForEpaAqi } = require("./_shared");

const SERVICE_NAME = "EPA AirNow";
const ENDPOINT = "https://www.airnowapi.org/aq/observation/latLong/current/";
const SEARCH_RADIUS_MI = 50;            // AirNow's `distance` parameter is in MILES (≈ 80 km); 50 mi is the maximum the API accepts and what EPA recommends
const TTL_MS = 30 * 60 * 1000;          // 30 min — AirNow updates hourly; halving smooths repeats without staleness
const US_BBOX = { latMin: 17, latMax: 72, lonMin: -180, lonMax: -65 }; // continental + AK + HI + PR/VI

const cache = new Map();                // cacheKey → { payload, expiresAt }

/**
 * 0.1° rounded grid for cache keys (~11 km cells). AirNow's
 * 50 mi (~80 km) search radius smooths out fine local variation
 * already, so two polls 5 km apart legitimately share a cached reading.
 *
 * @param {Number} lat
 * @param {Number} lon
 * @returns {String}
 */
function cacheKey(lat, lon) {
  return `${lat.toFixed(1)},${lon.toFixed(1)}`;
}

/**
 * @param {Number} lat
 * @param {Number} lon
 * @returns {Boolean}
 */
function pointInUSBox(lat, lon) {
  return lat >= US_BBOX.latMin && lat <= US_BBOX.latMax
      && lon >= US_BBOX.lonMin && lon <= US_BBOX.lonMax;
}

/**
 * Pick the highest-AQI record across the pollutants AirNow returned
 * for this reporting area. EPA's official "current AQI" is defined
 * as the worst-case across pollutants, so reproducing that here
 * keeps us aligned with the value the user would see on `airnow.gov`.
 *
 * @param {Array<Object>} records AirNow JSON array
 * @returns {Object|null}
 */
function pickWorstRecord(records) {
  let worst = null;
  for (const r of records) {
    const aqi = Number(r?.AQI);
    if (!isFinite(aqi) || aqi < 0) continue;
    if (!worst || aqi > Number(worst.AQI)) worst = r;
  }
  return worst;
}

/**
 * Try to resolve an AQI value at (lat, lon) via AirNow. Returns the
 * normalised orchestrator-shape payload, or null when the user has
 * no API key configured / point is outside US coverage / upstream
 * returned an empty list.
 *
 * @param {Number} lat
 * @param {Number} lon
 * @param {Object} [options]
 * @param {String} [options.airNowApiKey] User's AirNow API key — without this, the source skips silently
 * @returns {Promise<Object|null>}
 */
async function tryAqi(lat, lon, options = {}) {
  const apiKey = options.airNowApiKey;
  if (!apiKey) return null;
  if (!pointInUSBox(lat, lon)) return null;

  const key = cacheKey(lat, lon);
  const cached = cache.get(key);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.payload;
  }

  const params = new URLSearchParams({
    format: "application/json",
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    distance: String(SEARCH_RADIUS_MI),
    API_KEY: apiKey,
  });

  let resp;
  try {
    resp = await axios.get(`${ENDPOINT}?${params}`, { timeout: TIMEOUT_MS });
  } catch (err) {
    recordServiceCall(SERVICE_NAME, err?.response?.status || 500, "fetch failed");
    return null;
  }

  const records = Array.isArray(resp.data) ? resp.data : [];
  if (!records.length) {
    cache.set(key, { payload: null, expiresAt: Date.now() + TTL_MS });
    recordServiceCall(SERVICE_NAME, 200, `no active monitor within ${SEARCH_RADIUS_MI} mi (~80 km)`);
    return null;
  }

  const worst = pickWorstRecord(records);
  if (!worst) {
    recordServiceCall(SERVICE_NAME, 200, "all records had invalid AQI");
    return null;
  }

  const value = Number(worst.AQI);
  const category = categoryForEpaAqi(value);
  if (category == null) return null;

  // AirNow returns the reporting area's centroid lat/lon, not a
  // specific station. Distance is approximate but consistent with
  // how the other sources report it (centroid-of-coverage rather
  // than literal monitor coordinates in some cases).
  const stationLat = Number(worst.Latitude);
  const stationLon = Number(worst.Longitude);
  const stationDistanceKm = (isFinite(stationLat) && isFinite(stationLon))
    ? Math.round(haversineKm(lat, lon, stationLat, stationLon))
    : null;

  const stationName = [worst.ReportingArea, worst.StateCode]
    .filter(Boolean)
    .join(", ") || "AirNow";

  const payload = {
    value,
    category,
    source: "AirNow",
    scale: "epa",
    kind: "nowcast",
    stationName,
    stationDistanceKm,
    pollutant: worst.ParameterName || null, // surface which pollutant drove the worst-case so the Debug panel can show it
  };
  cache.set(key, { payload, expiresAt: Date.now() + TTL_MS });
  recordServiceCall(SERVICE_NAME, 200, `${stationName} aqi=${value} (${worst.ParameterName}, ${stationDistanceKm} km)`);
  increment("airnow", "current");
  return payload;
}

module.exports = { tryAqi, SERVICE_NAME };
