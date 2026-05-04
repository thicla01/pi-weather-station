// Quebec MELCC — RSQAQ (Réseau de surveillance de la qualité de l'air
// du Québec) real-time IQA source. Backed by the ministry's published
// ArcGIS FeatureServer; same dataset that powers the official
// iqa.environnement.gouv.qc.ca interactive map. Hourly observations
// (the "last available hour"), free, no API key, CC-BY licence,
// catalogued as `rsqaq-indice-de-la-qualite-de-l-air` on Données
// Québec.
//
// Coverage: every Quebec station EXCEPT those on the island of
// Montreal — those live in a separate municipal feed (see
// `melccMtl.js`). For Quebec city, Sorel, Saguenay, Sherbrooke etc.
// this source returns real observations rather than ECCC's
// twice-daily forecasts (which is what the previous fallback chain
// was forced to settle for).
//
// We pull the full feature set on each cache miss (~50 stations,
// ~30 KB JSON) and run the nearest-station search in-process. The
// ArcGIS server does support `geometry=&distance=` filters but
// ranking happens here anyway (we want the nearest valid reading,
// some stations report `-99` for missing pollutants and even for
// IQA), so fetching the whole set is simpler and the upstream load
// is identical (one request per 20 min regardless).

const axios = require("axios").default;
const { recordServiceCall } = require("../serviceStatus");
const { increment } = require("../requestCounter");
const { TIMEOUT_MS, haversineKm, categoryForIqa } = require("./_shared");

const SERVICE_NAME = "MELCC RSQAQ (Quebec)";
const FEATURESERVER_URL = "https://services3.arcgis.com/0lL78GhXbg1Po7WO/arcgis/rest/services/IQA_resultat_REST/FeatureServer/0/query"
  + "?where=1%3D1"
  + "&outFields=NO_STATION,NOM_STATION,LATITUDE,LONGITUDE,DATE_HEURE,IQA"
  + "&returnGeometry=false"
  + "&resultRecordCount=2000"
  + "&f=json";
const STATION_MAX_KM = 200; // Quebec is large; this still leaves the whole inhabited
                            // arc covered without spilling into bordering provinces
                            // (where ECCC is the natural fallback anyway).
const TTL_MS = 20 * 60 * 1000; // dataset publishes hourly, 20 min smooths repeat polls

let datasetCache = null; // { stations: [{noStation, nomStation, lat, lon, iqa, dateHeureMs}], expiresAt }

/**
 * Pull and parse the latest snapshot of every Quebec station.
 * Cached `TTL_MS` so the kiosk doesn't hammer ArcGIS on every poll.
 *
 * @returns {Promise<Array<{noStation: String, nomStation: String, lat: Number, lon: Number, iqa: Number, dateHeureMs: Number}>>}
 */
async function getDataset() {
  if (datasetCache && Date.now() < datasetCache.expiresAt) {
    return datasetCache.stations;
  }
  const r = await axios.get(FEATURESERVER_URL, { timeout: TIMEOUT_MS });
  const features = r.data?.features || [];
  const stations = [];
  for (const f of features) {
    const a = f.attributes || {};
    const lat = Number(a.LATITUDE);
    const lon = Number(a.LONGITUDE);
    const iqa = Number(a.IQA);
    if (!isFinite(lat) || !isFinite(lon)) continue;
    if (!isFinite(iqa) || iqa < 0) continue; // -99 sentinel = no valid reading
    stations.push({
      noStation: String(a.NO_STATION || ""),
      nomStation: String(a.NOM_STATION || ""),
      lat,
      lon,
      iqa,
      dateHeureMs: Number(a.DATE_HEURE) || null, // ArcGIS epoch ms
    });
  }
  datasetCache = { stations, expiresAt: Date.now() + TTL_MS };
  return stations;
}

/**
 * Try to resolve an IQA value at (lat, lon). Returns a normalised
 * payload or null when no valid Quebec station is within range.
 *
 * @param {Number} lat
 * @param {Number} lon
 * @returns {Promise<Object|null>}
 */
async function tryAqi(lat, lon) {
  let stations;
  try {
    stations = await getDataset();
  } catch (err) {
    recordServiceCall(SERVICE_NAME, err?.response?.status || 500, "dataset fetch failed");
    return null;
  }

  if (!stations.length) {
    recordServiceCall(SERVICE_NAME, 200, "empty dataset");
    return null;
  }

  let best = null;
  let bestKm = Infinity;
  for (const s of stations) {
    const km = haversineKm(lat, lon, s.lat, s.lon);
    if (km < bestKm) { bestKm = km; best = s; }
  }
  if (!best || bestKm > STATION_MAX_KM) {
    recordServiceCall(SERVICE_NAME, 200, `no station within ${STATION_MAX_KM} km`);
    return null;
  }

  const category = categoryForIqa(best.iqa);
  if (category == null) {
    recordServiceCall(SERVICE_NAME, 200, `nearest station ${best.noStation} reported invalid IQA`);
    return null;
  }

  const payload = {
    value: best.iqa,
    category,
    source: "MELCC-RSQAQ",
    scale: "iqa",
    kind: "observation",
    stationName: best.nomStation,
    stationDistanceKm: Math.round(bestKm),
  };
  recordServiceCall(SERVICE_NAME, 200, `${best.noStation} iqa=${best.iqa} (${Math.round(bestKm)} km)`);
  increment("melcc", "rsqaq");
  return payload;
}

module.exports = { tryAqi, SERVICE_NAME };
