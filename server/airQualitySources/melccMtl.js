// City-of-Montreal RSQA real-time IQA source. Backed by the official
// CSV that data.montreal.ca publishes, refreshed hourly (~50 min
// after the hour). Free, CC-BY, no API key. Catalogued on Données
// Québec as `vmtl-rsqa-indice-qualite-air`.
//
// The provincial MELCC dataset (see melccRsqaq.js) explicitly
// excludes the island of Montreal — by intergovernmental agreement,
// the city runs its own station network and publishes the data
// itself. So this source covers Montreal island specifically; the
// orchestrator runs it before RSQAQ so a Montreal marker gets its
// closest local reading instead of a south-shore station like
// Longueuil.
//
// CSV shape: one row per (station, pollutant, hour) — the IQA for a
// station at a given hour is the MAX across pollutants per the
// MELCC methodology ("L'indice horaire rapporté est le plus élevé
// des sous-indices"). We parse the whole CSV once per cache window,
// roll up the latest hour's per-station IQA, and serve the nearest
// station to (lat, lon) from that snapshot.

const axios = require("axios").default;
const { recordServiceCall } = require("../serviceStatus");
const { increment } = require("../requestCounter");
const { TIMEOUT_MS, haversineKm, categoryForIqa } = require("./_shared");

const SERVICE_NAME = "MELCC RSQA (Montreal)";
const CSV_URL = "https://donnees.montreal.ca/dataset/3e9f7b96-3f25-4404-a5ad-22d9a31060e6/resource/6554355e-63d1-4a01-a268-91e0763c3606/download/iqa-by-station.csv";
// data.montreal.ca rejects requests without a browser-style UA
// (returns "RBAC: access denied"); supply one explicitly.
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X) Pi-Weather-Station/2.x";
const STATION_MAX_KM = 50;             // tight on purpose — Montreal island is small,
                                       // anything beyond 50 km should fall through to
                                       // RSQAQ (south shore) or ECCC (further out).
const TTL_MS = 20 * 60 * 1000;         // CSV updates hourly; 20 min smooths repeats

let datasetCache = null;               // { stations: [{stationId, address, lat, lon, iqa, hourLabel}], expiresAt }

/**
 * Tiny CSV parser tailored to this file's format. Handles the one
 * quirk we actually see: optional double-quoted fields. Doesn't try
 * to be a general-purpose CSV reader.
 *
 * @param {String} text
 * @returns {Array<Array<String>>}
 */
function parseCsv(text) {
  const rows = [];
  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    const cells = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < rawLine.length; i++) {
      const c = rawLine[i];
      if (c === '"') { inQ = !inQ; continue; }
      if (c === "," && !inQ) { cells.push(cur); cur = ""; continue; }
      cur += c;
    }
    cells.push(cur);
    rows.push(cells);
  }
  return rows;
}

/**
 * Pull the Montreal CSV, parse it, roll the latest hour up to one
 * IQA per station. Cached `TTL_MS` so the kiosk doesn't refetch on
 * every poll.
 *
 * @returns {Promise<Array<{stationId: String, address: String, lat: Number, lon: Number, iqa: Number, hourLabel: String}>>}
 */
async function getDataset() {
  if (datasetCache && Date.now() < datasetCache.expiresAt) {
    return datasetCache.stations;
  }
  const r = await axios.get(CSV_URL, {
    timeout: TIMEOUT_MS,
    headers: { "User-Agent": UA, Accept: "text/csv,*/*" },
    responseType: "text",
  });
  const rows = parseCsv(r.data || "");
  if (rows.length < 2) {
    datasetCache = { stations: [], expiresAt: Date.now() + TTL_MS };
    return [];
  }
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (name) => header.indexOf(name);
  const iId = idx("stationid");
  const iAddr = idx("address");
  const iLat = idx("latitude");
  const iLon = idx("longitude");
  const iVal = idx("valeur");
  const iDate = idx("date");
  const iHour = idx("heure");
  if ([iId, iLat, iLon, iVal, iDate, iHour].some((i) => i < 0)) {
    recordServiceCall(SERVICE_NAME, 200, "CSV header missing expected columns");
    datasetCache = { stations: [], expiresAt: Date.now() + TTL_MS };
    return [];
  }

  // Bucket every row under (stationId, date, hour) and keep the max
  // sub-index per bucket. Latest (date, hour) overall wins as the
  // current snapshot.
  const perStation = new Map(); // stationId → { address, lat, lon, byHour: Map<dateHourKey, maxIqa> }
  let latestKey = "";
  for (let r2 = 1; r2 < rows.length; r2++) {
    const row = rows[r2];
    const stationId = (row[iId] || "").trim();
    if (!stationId) continue;
    const lat = Number(row[iLat]);
    const lon = Number(row[iLon]);
    const valeur = Number(row[iVal]);
    const date = (row[iDate] || "").trim();
    const heure = (row[iHour] || "").trim();
    if (!isFinite(lat) || !isFinite(lon) || !isFinite(valeur) || !date || heure === "") continue;
    const key = `${date}T${String(heure).padStart(2, "0")}`;
    if (key > latestKey) latestKey = key;
    let entry = perStation.get(stationId);
    if (!entry) {
      entry = { address: (row[iAddr] || "").trim(), lat, lon, byHour: new Map() };
      perStation.set(stationId, entry);
    }
    const prev = entry.byHour.get(key);
    if (prev == null || valeur > prev) entry.byHour.set(key, valeur);
  }

  const stations = [];
  for (const [stationId, entry] of perStation) {
    const iqa = entry.byHour.get(latestKey);
    if (iqa == null) continue;
    stations.push({
      stationId,
      address: entry.address,
      lat: entry.lat,
      lon: entry.lon,
      iqa,
      hourLabel: latestKey,
    });
  }
  datasetCache = { stations, expiresAt: Date.now() + TTL_MS };
  return stations;
}

/**
 * Try to resolve a Montreal IQA value at (lat, lon). Returns null
 * when the marker is outside Montreal-island range or no station
 * has a valid reading for the latest hour.
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
    recordServiceCall(SERVICE_NAME, err?.response?.status || 500, "CSV fetch failed");
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
    recordServiceCall(SERVICE_NAME, 200, `nearest station ${best.stationId} reported invalid IQA`);
    return null;
  }

  const payload = {
    value: best.iqa,
    category,
    source: "MELCC-Mtl",
    scale: "iqa",
    kind: "observation",
    stationName: best.address || `Station ${best.stationId}`,
    stationDistanceKm: Math.round(bestKm),
  };
  recordServiceCall(SERVICE_NAME, 200, `${best.stationId} iqa=${best.iqa} (${Math.round(bestKm)} km, ${best.hourLabel})`);
  increment("melcc", "rsqa-mtl");
  return payload;
}

module.exports = { tryAqi, SERVICE_NAME };
