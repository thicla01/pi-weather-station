// Air Quality Health Index (AQHI) lookup against Environment Canada's
// public OGC Features API at api.weather.gc.ca. Queries the nearest
// AQHI station to a given lat/lon and returns its most recent
// observation. Free, no API key, official Canadian source — fills the
// gap left by Tomorrow.io's epaIndex (paid tier only).
//
// Data flow:
//   1. List of AQHI stations cached in-memory (24 h TTL — stations
//      don't move). Loaded lazily on first request.
//   2. Per-request: find nearest station via Haversine, check it's
//      within STATION_MAX_KM, fetch its latest observation.
//   3. Per-station observation cached 20 min (ECCC publishes hourly,
//      so 20 min smooths repeat polls without serving stale data).

const axios = require("axios").default;
const { recordServiceCall } = require("./serviceStatus");
const { increment } = require("./requestCounter");

const ECCC_BASE = "https://api.weather.gc.ca/collections";
const STATIONS_URL = `${ECCC_BASE}/aqhi-stations/items?f=json&limit=1000`;
const TIMEOUT_MS = 10_000;
const STATION_MAX_KM = 150;          // pretend "no coverage" beyond this
const OBS_TTL_MS = 20 * 60 * 1000;   // 20 min, ECCC publishes hourly
const STATIONS_TTL_MS = 24 * 60 * 60 * 1000; // 24 h

let stationsCache = null;            // { features, expiresAt }
const obsCache = new Map();          // stationId → { payload, expiresAt }

/**
 * Great-circle distance between two points in km.
 *
 * @param {Number} lat1
 * @param {Number} lon1
 * @param {Number} lat2
 * @param {Number} lon2
 * @returns {Number} kilometres
 */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
          + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Pull the AQHI station list (cached 24 h).
 *
 * @returns {Promise<Array>}
 */
async function getStations() {
  if (stationsCache && Date.now() < stationsCache.expiresAt) {
    return stationsCache.features;
  }
  const r = await axios.get(STATIONS_URL, { timeout: TIMEOUT_MS });
  const features = r.data?.features || [];
  stationsCache = { features, expiresAt: Date.now() + STATIONS_TTL_MS };
  return features;
}

/**
 * Sort all stations by distance to (lat, lon) and keep only those
 * within STATION_MAX_KM. Returns an array of `{station, distanceKm}`
 * tuples in ascending distance order — the caller iterates through
 * candidates until one returns a current observation. Some stations
 * in the API's `aqhi-stations` collection are defunct (the Montreal
 * "EHHUN" station, for instance, is the closest to lat=45.5/lon=-73.5
 * but has zero current observations); falling back to the next
 * nearest active station keeps the badge useful.
 *
 * @param {Array} stations Station features from the OGC API
 * @param {Number} lat
 * @param {Number} lon
 * @returns {Array<{station: Object, distanceKm: Number}>}
 */
function rankStationsByDistance(stations, lat, lon) {
  const ranked = [];
  for (const s of stations) {
    const [stLon, stLat] = s.geometry?.coordinates || [];
    if (typeof stLat !== "number" || typeof stLon !== "number") continue;
    const distanceKm = haversineKm(lat, lon, stLat, stLon);
    if (distanceKm <= STATION_MAX_KM) ranked.push({ station: s, distanceKm });
  }
  ranked.sort((a, b) => a.distanceKm - b.distanceKm);
  return ranked;
}

/**
 * Fetch the most recent AQHI observation for a station.
 *
 * @param {String} stationId Station ID (e.g. "ONT_125")
 * @returns {Promise<Object | null>}
 */
async function fetchObservation(stationId) {
  // ECCC tags the most recent observation per station with `latest=true`
  // — single-record filter is more reliable than sorting by datetime
  // across paginated results.
  const url = `${ECCC_BASE}/aqhi-observations-realtime/items?f=json&location_id=${encodeURIComponent(stationId)}&latest=true&limit=1`;
  const r = await axios.get(url, { timeout: TIMEOUT_MS });
  return r.data?.features?.[0] || null;
}

/**
 * Map a numeric AQHI value to one of Health Canada's four risk
 * categories. Used by the client to colour the badge.
 *
 * @param {Number} value AQHI 1-10+
 * @returns {"low" | "moderate" | "high" | "veryHigh" | null}
 */
function categoryFor(value) {
  if (value == null || isNaN(value)) return null;
  if (value > 10) return "veryHigh";
  if (value >= 7) return "high";
  if (value >= 4) return "moderate";
  return "low";
}

/**
 * Pick the station identifier from a station feature, defensively
 * (the OGC spec is followed in practice but field names can drift).
 *
 * @param {Object} station Station feature
 * @returns {String | null}
 */
function stationIdOf(station) {
  const p = station?.properties || {};
  return p.location_id || p.station_id || p.id || null;
}

/**
 * Pick a human-readable name for the station.
 *
 * @param {Object} station Station feature
 * @returns {String | null}
 */
function stationNameOf(station) {
  const p = station?.properties || {};
  return p.location_name_en || p.location_name_fr || p.name || null;
}

/**
 * GET /api/air-quality
 * Returns the AQHI for the nearest ECCC station to a given lat/lon,
 * or `{ available: false }` when out of Canadian coverage / the
 * upstream API is unreachable. Soft-fails on every error path so the
 * client can transparently fall back to other sources.
 *
 * @param {Object} req
 * @param {Object} req.query
 * @param {String} req.query.lat
 * @param {String} req.query.lon
 * @param {Object} res
 */
async function getAirQuality(req, res) {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return res.status(400).json("Invalid coordinates").end();
  }

  let stations;
  try {
    stations = await getStations();
  } catch (err) {
    recordServiceCall("Environment Canada (AQHI)", err?.response?.status || 500, "stations fetch failed");
    return res.status(200).json({ available: false, reason: "stations" }).end();
  }

  const candidates = rankStationsByDistance(stations, lat, lon);
  if (!candidates.length) {
    recordServiceCall("Environment Canada (AQHI)", 200, `no station within ${STATION_MAX_KM} km`);
    return res.status(200).json({ available: false, reason: "out-of-range" }).end();
  }

  // Walk candidates in distance order; the closest may be defunct and
  // return zero observations (Montreal's EHHUN is a good example), so
  // fall through to the next nearest. Cap the walk at MAX_CANDIDATES
  // to avoid spending too long on a single user request when an entire
  // region is offline; in practice the second or third candidate
  // resolves it.
  const MAX_CANDIDATES = 4;
  for (const { station, distanceKm } of candidates.slice(0, MAX_CANDIDATES)) {
    const stationId = stationIdOf(station);
    if (!stationId) continue;

    const cached = obsCache.get(stationId);
    if (cached && Date.now() < cached.expiresAt) {
      return res.status(200).json({ available: true, ...cached.payload }).end();
    }

    let obs;
    try {
      obs = await fetchObservation(stationId);
    } catch {
      // Network blip on one station shouldn't block the rest.
      continue;
    }

    if (!obs) continue;

    const rawValue = obs.properties?.aqhi
                  ?? obs.properties?.value
                  ?? obs.properties?.aqhi_value;
    const value = rawValue != null ? Number(rawValue) : null;
    const category = categoryFor(value);
    if (value == null || category == null) continue;

    const payload = {
      value,
      category,
      source: "ECCC",
      stationName: stationNameOf(station),
      stationDistanceKm: Math.round(distanceKm),
    };
    obsCache.set(stationId, { payload, expiresAt: Date.now() + OBS_TTL_MS });
    recordServiceCall("Environment Canada (AQHI)", 200, `${stationId} aqhi=${value} (${Math.round(distanceKm)} km)`);
    increment("eccc", "aqhi");
    return res.status(200).json({ available: true, ...payload }).end();
  }

  recordServiceCall("Environment Canada (AQHI)", 200, `no active station within ${MAX_CANDIDATES} closest candidates`);
  return res.status(200).json({ available: false, reason: "no-data" }).end();
}

module.exports = { getAirQuality };
