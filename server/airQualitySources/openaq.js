// OpenAQ source — global air-quality fallback covering ~150
// countries. Slots in last among the parallel sources because:
// (a) the upstream is a single cached fetch like the others; (b)
// the closest-wins picker correctly prefers MELCC / AirNow inside
// their respective countries since OpenAQ stations there typically
// sit further from the marker than the dedicated networks do.
// Outside North America OpenAQ is the only source with anything to
// say, so it lights up the badge for kiosks in Mexico, Europe,
// Asia, Africa, etc.
//
// OpenAQ v3 requires a free per-install API key (sign up at
// `explore.openaq.org/register`). The source silently no-ops to
// null when the key isn't configured — same pattern as AirNow.
//
// OpenAQ doesn't pre-compute AQI; it returns raw pollutant
// concentrations. We compute the EPA AQI sub-index per supported
// pollutant via `epaAqiFromConcentration` and take the worst-case
// across what the station reports, mirroring EPA's own "current
// AQI" methodology. Two HTTP calls per cache miss (locations
// search → location's latest measurements); both responses cached
// together for 30 min so subsequent polls in the same area are
// free.

const axios = require("axios").default;
const { recordServiceCall } = require("../serviceStatus");
const { increment } = require("../requestCounter");
const {
  TIMEOUT_MS,
  haversineKm,
  categoryForEpaAqi,
  epaAqiFromConcentration,
} = require("./_shared");

const SERVICE_NAME = "OpenAQ";
const BASE_URL = "https://api.openaq.org/v3";
const SEARCH_RADIUS_M = 25_000;     // 25 km — comparable to the other sources' caps; OpenAQ accepts up to 25 km in v3
const TTL_MS = 30 * 60 * 1000;       // 30 min — most stations publish hourly; cache aligns with other sources
const cache = new Map();             // cacheKey → { payload, expiresAt }

// EPA-canonical units per pollutant. OpenAQ returns concentrations
// in either canonical units or μg/m³ depending on the station; we
// convert to canonical at standard conditions (25 °C, 1 atm) before
// running the AQI formula. Conversion factors are concentration in
// µg/m³ that equals 1 ppb (or 1 ppm), so canonical = µg/m³ ÷ factor.
const UGM3_TO_CANONICAL = {
  o3:  { unit: "ppm", factor: 1962.5 }, // 1 ppm O3 ≈ 1962.5 µg/m³
  no2: { unit: "ppb", factor: 1.88 },   // 1 ppb NO2 ≈ 1.88 µg/m³
  so2: { unit: "ppb", factor: 2.62 },   // 1 ppb SO2 ≈ 2.62 µg/m³
  co:  { unit: "ppm", factor: 1145 },   // 1 ppm CO ≈ 1145 µg/m³
};

/**
 * Convert an OpenAQ raw measurement to the EPA-canonical unit if
 * needed. Particulates are already canonical (μg/m³) so they pass
 * through unchanged. For gaseous pollutants, prefer the upstream's
 * native unit when it matches EPA's; otherwise convert from μg/m³
 * at standard conditions. Returns null if the unit is one we don't
 * know how to convert.
 *
 * @param {String} parameter OpenAQ parameter name ("pm25", "o3", ...)
 * @param {Number} value
 * @param {String} units Upstream-reported unit ("µg/m³", "ppm", "ppb", ...)
 * @returns {Number|null} value in EPA-canonical unit, or null if unknown
 */
function toCanonical(parameter, value, units) {
  if (parameter === "pm25" || parameter === "pm10") {
    // Particulates are always μg/m³ in EPA's spec. OpenAQ matches.
    if (units === "µg/m³" || units === "ug/m3" || units === "μg/m³") return value;
    return null;
  }
  const conv = UGM3_TO_CANONICAL[parameter];
  if (!conv) return null;
  if (units === conv.unit) return value;
  if (units === "µg/m³" || units === "ug/m3" || units === "μg/m³") return value / conv.factor;
  return null;
}

/**
 * EPA AQI sub-index for one OpenAQ measurement, after unit
 * conversion. Ozone is special: EPA defines separate 8h and 1h
 * bands. We don't know whether the OpenAQ reading is averaged over
 * 8h or 1h (it depends on the station and is rarely surfaced
 * explicitly), so we try the 8h table first and fall back to the
 * 1h table only when the value is in the 1h-only range (≥ 0.125 ppm)
 * — picking the worse of the two when both apply. This is a
 * documented approximation; for stations that publish 1h ozone the
 * AQI may overshoot the strictly-correct 8h value, but never
 * undershoot a real concern.
 *
 * @param {String} parameter OpenAQ parameter
 * @param {Number} canonical Concentration in EPA-canonical unit
 * @returns {Number|null} AQI sub-index (0-500), or null if unmappable
 */
function aqiForParameter(parameter, canonical) {
  if (parameter === "o3") {
    const aqi8h = epaAqiFromConcentration("o3_8h", canonical);
    if (canonical < 0.125) return aqi8h;
    const aqi1h = epaAqiFromConcentration("o3_1h", canonical);
    if (aqi8h == null) return aqi1h;
    if (aqi1h == null) return aqi8h;
    return Math.max(aqi8h, aqi1h);
  }
  return epaAqiFromConcentration(parameter, canonical);
}

/**
 * Round (lat, lon) to a 0.1° grid (~11 km cells) for cache keying.
 *
 * @param {Number} lat
 * @param {Number} lon
 * @returns {String}
 */
function cacheKey(lat, lon) {
  return `${lat.toFixed(1)},${lon.toFixed(1)}`;
}

/**
 * Fetch the nearest location (with sensor list) within
 * SEARCH_RADIUS_M of the given point.
 *
 * @param {Number} lat
 * @param {Number} lon
 * @param {String} apiKey
 * @returns {Promise<Object|null>}
 */
async function findNearestLocation(lat, lon, apiKey) {
  const url = `${BASE_URL}/locations?coordinates=${lat.toFixed(4)},${lon.toFixed(4)}&radius=${SEARCH_RADIUS_M}&limit=1&order_by=distance`;
  const resp = await axios.get(url, {
    timeout: TIMEOUT_MS,
    headers: { "X-API-Key": apiKey },
  });
  const results = resp.data?.results || [];
  return results[0] || null;
}

/**
 * Fetch the latest measurement per sensor at the given location.
 *
 * @param {Number} locationId
 * @param {String} apiKey
 * @returns {Promise<Array<Object>>}
 */
async function getLatestMeasurements(locationId, apiKey) {
  const url = `${BASE_URL}/locations/${locationId}/latest`;
  const resp = await axios.get(url, {
    timeout: TIMEOUT_MS,
    headers: { "X-API-Key": apiKey },
  });
  return resp.data?.results || [];
}

/**
 * Map one OpenAQ sensor (from the location's `sensors` array,
 * which is what attaches the parameter id+name to its sensorId) to
 * its parameter name. The /latest endpoint returns measurements
 * keyed by sensorId, so we need this lookup table to know which
 * pollutant a measurement belongs to.
 *
 * @param {Object} location Location object from /locations
 * @returns {Map<Number, {name: String, units: String}>}
 */
function buildSensorIndex(location) {
  const index = new Map();
  for (const s of location.sensors || []) {
    if (!s.id) continue;
    index.set(s.id, {
      name: s.parameter?.name || null,
      units: s.parameter?.units || null,
    });
  }
  return index;
}

/**
 * Try to resolve an AQI value at (lat, lon) via OpenAQ. Returns the
 * normalised orchestrator-shape payload, or null when no key is
 * configured / no station within SEARCH_RADIUS_M / upstream returned
 * no usable measurement.
 *
 * @param {Number} lat
 * @param {Number} lon
 * @param {Object} [options]
 * @param {String} [options.openAqApiKey] User's OpenAQ API key
 * @returns {Promise<Object|null>}
 */
async function tryAqi(lat, lon, options = {}) {
  const apiKey = options.openAqApiKey;
  if (!apiKey) return null;

  const key = cacheKey(lat, lon);
  const cached = cache.get(key);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.payload;
  }

  let location;
  try {
    location = await findNearestLocation(lat, lon, apiKey);
  } catch (err) {
    recordServiceCall(SERVICE_NAME, err?.response?.status || 500, "locations search failed");
    return null;
  }
  if (!location) {
    cache.set(key, { payload: null, expiresAt: Date.now() + TTL_MS });
    recordServiceCall(SERVICE_NAME, 200, `no station within ${SEARCH_RADIUS_M / 1000} km`);
    return null;
  }

  let measurements;
  try {
    measurements = await getLatestMeasurements(location.id, apiKey);
  } catch (err) {
    recordServiceCall(SERVICE_NAME, err?.response?.status || 500, `latest measurements failed for location ${location.id}`);
    return null;
  }

  const sensorIndex = buildSensorIndex(location);
  let worstAqi = null;
  let worstParameter = null;

  for (const m of measurements) {
    const sensorMeta = sensorIndex.get(m.sensorsId);
    if (!sensorMeta) continue;
    const value = Number(m.value);
    const canonical = toCanonical(sensorMeta.name, value, sensorMeta.units);
    if (canonical == null) continue;
    const aqi = aqiForParameter(sensorMeta.name, canonical);
    if (aqi == null) continue;
    if (worstAqi == null || aqi > worstAqi) {
      worstAqi = aqi;
      worstParameter = sensorMeta.name;
    }
  }

  if (worstAqi == null) {
    cache.set(key, { payload: null, expiresAt: Date.now() + TTL_MS });
    recordServiceCall(SERVICE_NAME, 200, `location ${location.id} had no convertible pollutants`);
    return null;
  }

  const stationLat = location.coordinates?.latitude;
  const stationLon = location.coordinates?.longitude;
  const stationDistanceKm = (typeof stationLat === "number" && typeof stationLon === "number")
    ? Math.round(haversineKm(lat, lon, stationLat, stationLon))
    : null;

  const payload = {
    value: worstAqi,
    category: categoryForEpaAqi(worstAqi),
    source: "OpenAQ",
    scale: "epa",
    kind: "observation",
    stationName: location.name || `OpenAQ #${location.id}`,
    stationDistanceKm,
    pollutant: worstParameter,
  };
  cache.set(key, { payload, expiresAt: Date.now() + TTL_MS });
  recordServiceCall(SERVICE_NAME, 200, `${location.name || location.id} aqi=${worstAqi} (${worstParameter}, ${stationDistanceKm} km)`);
  increment("openaq", "latest");
  return payload;
}

module.exports = { tryAqi, SERVICE_NAME };
