// EPA AirNow source — closes the US-side gap in the badge's coverage
// chain. AirNow is the official cooperative air-quality network run
// by the EPA + state/local agencies + tribes; the API is free with a
// per-account key (rate-limited at 500 calls/hour, generous for our
// 30-min polling cadence). This module only fires when the user has
// configured `airNowApiKey` in settings.json — without a key the
// `tryAqi` call returns null silently and the orchestrator falls
// through to the next source as if AirNow weren't installed.
//
// We hit the raw station endpoint (`/aq/data/`) rather than the
// reporting-area endpoint (`/aq/observation/latLong/current/`). The
// reporting-area endpoint was returning empty for plenty of US
// locations that DO have an active AirNow-fed station nearby — e.g.
// Decatur, AL where the "reporting area" is offline but the DECATUR
// station 7 km away still publishes hourly readings. OpenAQ ingests
// the same raw AirNow station data and was filling the gap; switching
// to `/aq/data/` lets us pick that up directly without round-tripping
// through OpenAQ.
//
// Response shape: a JSON array with one record PER STATION PER
// POLLUTANT PER HOUR over the requested time window. We group by
// station, keep the latest reading per pollutant, find the closest
// station to the query point, then take `max(AQI)` across its
// pollutants — EPA's official "current AQI" methodology.
//
// `kind: "nowcast"` is technically the most accurate label: AirNow
// reports the NowCast 12-hour weighted average for PM2.5/PM10 and
// 1-hour averages for O3, both of which are EPA's official "current
// observation" methodology rather than an instantaneous spot value.

const axios = require("axios").default;
const { recordServiceCall } = require("../serviceStatus");
const { increment } = require("../requestCounter");
const { TIMEOUT_MS, haversineKm, categoryForEpaAqi } = require("./_shared");

const SERVICE_NAME = "EPA AirNow";
const ENDPOINT = "https://www.airnowapi.org/aq/data/";
const BBOX_HALF_DEG = 0.72;             // ~80 km half-side at typical US latitudes — matches the old /current/ endpoint's 50 mi radius
const LOOKBACK_HOURS = 3;               // window for /aq/data/ time range; AirNow data is typically 1-2 h delayed by QA processing
const PARAMETERS = "OZONE,PM25,PM10";   // EPA-defined AQI pollutants we recognise; NO2/SO2/CO are rarely the worst-case
const TTL_MS = 30 * 60 * 1000;          // 30 min — AirNow updates hourly; halving smooths repeats without staleness
const US_BBOX = { latMin: 17, latMax: 72, lonMin: -180, lonMax: -65 }; // continental + AK + HI + PR/VI

const cache = new Map();                // cacheKey → { payload, expiresAt }

/**
 * 0.1° rounded grid for cache keys (~11 km cells). AirNow's ~80 km
 * search window smooths out fine local variation already, so two
 * polls 5 km apart legitimately share a cached reading.
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
 * Format a UTC hour for AirNow's `startDate`/`endDate` params. The
 * /aq/data/ endpoint accepts hour-precision ISO timestamps
 * (e.g. "2026-05-22T04"); minutes/seconds are not used.
 *
 * @param {Date} d
 * @returns {String}
 */
function fmtUtcHour(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}`;
}

/**
 * Short, English, log-friendly age formatter for the Debug panel
 * service-status line. Client-side rendering uses the localised
 * `formatAge` helper.
 *
 * @param {String} observedAtIso ISO 8601 timestamp
 * @returns {String} e.g. "5m", "1h 20m", "3d"
 */
function formatAgeShort(observedAtIso) {
  const ms = Date.now() - new Date(observedAtIso).getTime();
  if (!isFinite(ms) || ms < 0) return "?";
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  const days = Math.floor(mins / 1440);
  return `${days}d`;
}

/**
 * `/aq/data/` returns multiple records per station (one per pollutant
 * per hour over the time window). Group them by station, keep the
 * latest reading per pollutant — that gives us the same "current
 * snapshot per station" the reporting-area endpoint used to return,
 * but station-level instead of aggregated.
 *
 * Station identity uses lat/lon as the composite key (rounded to 4
 * decimals to dedupe tiny floating-point variations across hours).
 * Some stations omit `SiteName`, so the coordinate-based key is the
 * only robust identifier.
 *
 * @param {Array<Object>} records Raw /aq/data/ response array
 * @returns {Map<String, {lat:Number, lon:Number, siteName:String|null, byParameter: Map<String, Object>}>}
 */
function groupByStation(records) {
  const stations = new Map();
  for (const r of records) {
    const lat = Number(r.Latitude);
    const lon = Number(r.Longitude);
    const parameter = r.Parameter;
    const utc = r.UTC;
    if (!isFinite(lat) || !isFinite(lon) || !parameter || !utc) continue;

    const stationKey = `${lat.toFixed(4)},${lon.toFixed(4)}`;
    let s = stations.get(stationKey);
    if (!s) {
      s = { lat, lon, siteName: r.SiteName || null, byParameter: new Map() };
      stations.set(stationKey, s);
    }
    const prev = s.byParameter.get(parameter);
    if (!prev || (prev.UTC || "") < utc) {
      s.byParameter.set(parameter, r);
    }
  }
  return stations;
}

/**
 * Among the stations returned within the bbox, find the one closest
 * to the query point that has at least one valid AQI reading.
 *
 * @param {Map} stations Output of groupByStation
 * @param {Number} lat
 * @param {Number} lon
 * @returns {{station: Object, distanceKm: Number}|null}
 */
function findClosestStation(stations, lat, lon) {
  let best = null;
  let bestKm = Infinity;
  for (const s of stations.values()) {
    // Skip stations that have no valid AQI in any pollutant
    let hasAqi = false;
    for (const rec of s.byParameter.values()) {
      const aqi = Number(rec.AQI);
      if (isFinite(aqi) && aqi >= 0) { hasAqi = true; break; }
    }
    if (!hasAqi) continue;
    const km = haversineKm(lat, lon, s.lat, s.lon);
    if (km < bestKm) { bestKm = km; best = s; }
  }
  return best ? { station: best, distanceKm: bestKm } : null;
}

/**
 * From a single station's latest readings, pick the pollutant with
 * the worst AQI. EPA's official "current AQI" is the worst-case
 * across pollutants, so this matches what `airnow.gov` shows.
 *
 * @param {Object} station Output of groupByStation per-station entry
 * @returns {Object|null} The worst-case record
 */
function pickWorstRecord(station) {
  let worst = null;
  for (const rec of station.byParameter.values()) {
    const aqi = Number(rec.AQI);
    if (!isFinite(aqi) || aqi < 0) continue;
    if (!worst || aqi > Number(worst.AQI)) worst = rec;
  }
  return worst;
}

/**
 * Try to resolve an AQI value at (lat, lon) via AirNow. Returns the
 * normalised orchestrator-shape payload, or null when the user has
 * no API key configured / point is outside US coverage / upstream
 * returned an empty list / nothing within the bbox had a valid AQI.
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

  // Build bbox + time window for /aq/data/
  const lonMin = (lon - BBOX_HALF_DEG).toFixed(4);
  const latMin = (lat - BBOX_HALF_DEG).toFixed(4);
  const lonMax = (lon + BBOX_HALF_DEG).toFixed(4);
  const latMax = (lat + BBOX_HALF_DEG).toFixed(4);
  const now = new Date();
  const start = new Date(now.getTime() - LOOKBACK_HOURS * 3600 * 1000);

  const params = new URLSearchParams({
    startDate: fmtUtcHour(start),
    endDate: fmtUtcHour(now),
    parameters: PARAMETERS,
    BBOX: `${lonMin},${latMin},${lonMax},${latMax}`,
    dataType: "B",                     // both AQI + concentration (we use AQI)
    format: "application/json",
    verbose: "1",                      // include SiteName + AgencyName
    monitorType: "0",                  // permanent monitors only (skip mobile)
    includerawconcentrations: "0",
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
    recordServiceCall(SERVICE_NAME, 200, `no station within bbox (±${BBOX_HALF_DEG}°, ~80 km)`);
    return null;
  }

  const stations = groupByStation(records);
  const closest = findClosestStation(stations, lat, lon);
  if (!closest) {
    cache.set(key, { payload: null, expiresAt: Date.now() + TTL_MS });
    recordServiceCall(SERVICE_NAME, 200, `${stations.size} stations in bbox but none had a valid AQI`);
    return null;
  }

  const worst = pickWorstRecord(closest.station);
  if (!worst) return null; // defensive — findClosestStation already screened for hasAqi

  const value = Number(worst.AQI);
  const category = categoryForEpaAqi(value);
  if (category == null) return null;

  // `UTC` field is like "2026-05-22T04:00" (no Z); append Z to make
  // it a valid ISO 8601 UTC timestamp for downstream age formatting.
  const observedAt = worst.UTC ? (worst.UTC.endsWith("Z") ? worst.UTC : `${worst.UTC}Z`) : null;

  const stationName = closest.station.siteName || worst.SiteName || "AirNow";
  const stationDistanceKm = Math.round(closest.distanceKm);

  const payload = {
    value,
    category,
    source: "AirNow",
    scale: "epa",
    kind: "nowcast",
    stationName,
    stationDistanceKm,
    pollutant: worst.Parameter || null,
    observedAt,
  };
  cache.set(key, { payload, expiresAt: Date.now() + TTL_MS });
  const ageSuffix = observedAt ? `, ${formatAgeShort(observedAt)} old` : "";
  recordServiceCall(SERVICE_NAME, 200, `${stationName} aqi=${value} (${worst.Parameter}, ${stationDistanceKm} km${ageSuffix})`);
  increment("airnow", "data");
  return payload;
}

module.exports = { tryAqi, SERVICE_NAME };
