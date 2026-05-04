// Environment Canada AQHI source — the original air-quality source.
// Queries api.weather.gc.ca's OGC Features API for the nearest active
// AQHI station, prefers a real observation, falls back to the
// forecast bulletin when the observation pipeline is empty (Quebec
// stations currently emit forecasts but no observations). Free, no
// API key, official Canadian source. Runs after the MELCC sources in
// the orchestrator so Quebec markers get observations from the
// provincial / municipal networks before falling back here.

const axios = require("axios").default;
const { recordServiceCall } = require("../serviceStatus");
const { increment } = require("../requestCounter");
const { TIMEOUT_MS, haversineKm, categoryForAqhi } = require("./_shared");

const SERVICE_NAME = "Environment Canada (AQHI)";
const ECCC_BASE = "https://api.weather.gc.ca/collections";
const STATIONS_URL = `${ECCC_BASE}/aqhi-stations/items?f=json&limit=1000`;

const STATION_MAX_KM = 300;          // pretend "no coverage" beyond this — generous because
                                     // entire provinces can be reporting zero stations on the
                                     // upstream API. The badge tooltip surfaces the actual
                                     // station name + distance so the user can judge the
                                     // local relevance.
const MAX_CANDIDATES = 6;            // walk the 6 nearest stations until one returns a
                                     // value — most regional gaps resolve by the second or
                                     // third candidate, but bumped from 4 after observing
                                     // entire-province blackouts.
const OBS_TTL_MS = 20 * 60 * 1000;   // 20 min, ECCC publishes hourly
const STATIONS_TTL_MS = 24 * 60 * 60 * 1000; // 24 h

let stationsCache = null;            // { features, expiresAt }
const obsCache = new Map();          // stationId → { payload, expiresAt }

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
 * Sort ECCC stations by distance to (lat, lon) and keep only those
 * within STATION_MAX_KM. Some stations are defunct (Montreal's EHHUN
 * for example sits in the published list but returns zero current
 * observations); the orchestrator iterates through candidates until
 * one returns a value.
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
 * Fetch the most recent AQHI value for a station, preferring real
 * observations and falling back to the forecast bulletin when none are
 * published.
 *
 * @param {String} stationId Station ID (e.g. "EHTWR")
 * @returns {Promise<{value: Number, kind: "observation" | "forecast"} | null>}
 */
async function fetchAqhi(stationId) {
  const obsUrl = `${ECCC_BASE}/aqhi-observations-realtime/items?f=json&location_id=${encodeURIComponent(stationId)}&latest=true&limit=1`;
  const obsResp = await axios.get(obsUrl, { timeout: TIMEOUT_MS });
  const obs = obsResp.data?.features?.[0];
  if (obs) {
    const v = obs.properties?.aqhi ?? obs.properties?.value ?? obs.properties?.aqhi_value;
    if (v != null && !isNaN(Number(v))) {
      return { value: Number(v), kind: "observation" };
    }
  }

  // Each forecast feature carries a forecast_datetime (the hour it
  // covers); we want the one closest to "now" without being in the
  // future. Sorting by -forecast_datetime returns the most recent
  // hourly entries from the latest bulletin.
  const fcstUrl = `${ECCC_BASE}/aqhi-forecasts-realtime/items?f=json&location_id=${encodeURIComponent(stationId)}&sortby=-forecast_datetime&limit=24`;
  const fcstResp = await axios.get(fcstUrl, { timeout: TIMEOUT_MS });
  const fcsts = fcstResp.data?.features || [];
  if (!fcsts.length) return null;
  const nowMs = Date.now();
  let bestPast = null, bestPastTs = -Infinity;
  let bestFuture = null, bestFutureTs = Infinity;
  for (const f of fcsts) {
    const dt = f.properties?.forecast_datetime;
    const v = f.properties?.aqhi ?? f.properties?.value;
    if (!dt || v == null || isNaN(Number(v))) continue;
    const ts = Date.parse(dt);
    if (ts <= nowMs && ts > bestPastTs) { bestPastTs = ts; bestPast = f; }
    if (ts > nowMs && ts < bestFutureTs) { bestFutureTs = ts; bestFuture = f; }
  }
  const chosen = bestPast || bestFuture;
  if (!chosen) return null;
  const v = chosen.properties?.aqhi ?? chosen.properties?.value;
  return { value: Number(v), kind: "forecast" };
}

function stationIdOf(s) {
  const p = s?.properties || {};
  return p.location_id || p.station_id || p.id || null;
}
function stationNameOf(s) {
  const p = s?.properties || {};
  return p.location_name_en || p.location_name_fr || p.name || null;
}

/**
 * Try to resolve an AQHI value at (lat, lon). Returns a normalised
 * payload or null when out of coverage / upstream is empty.
 *
 * @param {Number} lat
 * @param {Number} lon
 * @returns {Promise<Object|null>}
 */
async function tryAqi(lat, lon) {
  let stations;
  try {
    stations = await getStations();
  } catch (err) {
    recordServiceCall(SERVICE_NAME, err?.response?.status || 500, "stations fetch failed");
    return null;
  }

  const candidates = rankStationsByDistance(stations, lat, lon);
  if (!candidates.length) {
    recordServiceCall(SERVICE_NAME, 200, `no station within ${STATION_MAX_KM} km`);
    return null;
  }

  for (const { station, distanceKm } of candidates.slice(0, MAX_CANDIDATES)) {
    const stationId = stationIdOf(station);
    if (!stationId) continue;

    const cached = obsCache.get(stationId);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.payload;
    }

    let result;
    try {
      result = await fetchAqhi(stationId);
    } catch {
      continue;
    }
    if (!result) continue;

    const { value, kind } = result;
    const category = categoryForAqhi(value);
    if (value == null || category == null) continue;

    const payload = {
      value,
      category,
      source: "ECCC",
      scale: "aqhi",
      kind,
      stationName: stationNameOf(station),
      stationDistanceKm: Math.round(distanceKm),
    };
    obsCache.set(stationId, { payload, expiresAt: Date.now() + OBS_TTL_MS });
    recordServiceCall(SERVICE_NAME, 200, `${stationId} aqhi=${value} (${kind}, ${Math.round(distanceKm)} km)`);
    increment("eccc", "aqhi");
    return payload;
  }

  recordServiceCall(SERVICE_NAME, 200, `no active station within ${MAX_CANDIDATES} closest candidates`);
  return null;
}

module.exports = { tryAqi, SERVICE_NAME };
