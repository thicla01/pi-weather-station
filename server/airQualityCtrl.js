// Air-quality orchestrator. Collects candidate readings from the
// cheap government sources in parallel (the two MELCC networks for
// Quebec, EPA AirNow for the US), picks the geographically closest
// one, and falls back to ECCC when none of them returned anything.
// Soft-fails to {available:false} when every source is empty so the
// client can transparently fall back to other signals (Tomorrow.io's
// epaIndex when configured).
//
// Why "closest wins" instead of strict source priority: the previous
// "first non-null wins" rule produced an effect-edge bug —
// Sainte-Victoire-de-Sorel sat right at the 50 km cap of the
// Montreal source and got tagged with a station 50 km away while
// the RSQAQ network had Saint-Joseph-de-Sorel at 8 km. Distance is
// the real measure of relevance, so the orchestrator now compares
// stationDistanceKm across whatever the cheap sources return. The
// US/Canada border is handled naturally by the same rule: a kiosk
// in Plattsburgh NY picks AirNow at 5 km over MELCC at 30 km
// across the border, and a kiosk in Lacolle QC picks MELCC at 5 km
// over AirNow at 30 km — without any explicit country gate.
//
// ECCC is sequenced after — not parallel with — the cheap sources
// because ECCC may make multiple per-station HTTP calls when the
// nearest station is defunct (the existing 6-candidate walk). The
// MELCC sources and AirNow are each one cached fetch, so running
// them in parallel is essentially free; firing ECCC for every
// marker would not be. AirNow also requires a per-install API key
// and silently no-ops when one isn't configured.

const settingsCtrl = require("./settingsCtrl");

const sources = {
  melccMtl:   require("./airQualitySources/melccMtl"),
  melccRsqaq: require("./airQualitySources/melccRsqaq"),
  airnow:     require("./airQualitySources/airnow"),
  eccc:       require("./airQualitySources/eccc"),
};

/**
 * Pick the candidate with the smallest stationDistanceKm. Null
 * entries are ignored. Returns null if every entry is null. A
 * candidate without a stationDistanceKm (shouldn't happen with the
 * current sources, but defensive) is treated as Infinity so it only
 * wins when nothing else is available.
 *
 * @param {Array<Object|null>} candidates
 * @returns {Object|null}
 */
function pickClosest(candidates) {
  let best = null;
  for (const c of candidates) {
    if (!c) continue;
    const dist = c.stationDistanceKm == null ? Infinity : c.stationDistanceKm;
    const bestDist = best && best.stationDistanceKm != null ? best.stationDistanceKm : Infinity;
    if (!best || dist < bestDist) best = c;
  }
  return best;
}

/**
 * Read the orchestrator-level options every source might need.
 * Currently just the AirNow API key — other sources ignore it.
 * Centralised here so each source stays dependency-free and the
 * settings read happens at most once per request.
 *
 * @returns {Promise<Object>}
 */
async function loadSourceOptions() {
  try {
    const settings = await settingsCtrl.getSettingsData();
    return { airNowApiKey: settings?.airNowApiKey || null };
  } catch {
    return {};
  }
}

/**
 * GET /api/air-quality
 * Returns the geographically closest air-quality reading the
 * upstream sources can produce, or `{ available: false }` when all
 * of them come up empty.
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

  const opts = await loadSourceOptions();

  // Cheap, parallel pass — each cheap source is a single cached
  // upstream fetch. The closest valid hit wins; ties broken by
  // declaration order. AirNow no-ops to null when no API key is
  // configured, so a Canadian-only install pays nothing for it.
  const [melccMtl, melccRsqaq, airnow] = await Promise.all([
    sources.melccMtl.tryAqi(lat, lon, opts).catch(() => null),
    sources.melccRsqaq.tryAqi(lat, lon, opts).catch(() => null),
    sources.airnow.tryAqi(lat, lon, opts).catch(() => null),
  ]);
  let best = pickClosest([melccMtl, melccRsqaq, airnow]);

  // Sequential ECCC fallback only when no cheap source had coverage.
  // ECCC's per-station walks for defunct stations make it expensive
  // to run speculatively.
  if (!best) {
    best = await sources.eccc.tryAqi(lat, lon, opts).catch(() => null);
  }

  if (best) {
    return res.status(200).json({ available: true, ...best }).end();
  }
  return res.status(200).json({ available: false, reason: "no-data" }).end();
}

/**
 * Pre-register every air-quality source with the service-status
 * tracker so the Debug panel shows them as "Not yet called" before
 * the first poll lands. Called from `index.js` at startup.
 *
 * @param {Function} registerService Callback from serviceStatus
 */
function registerAirQualityServices(registerService) {
  for (const src of Object.values(sources)) {
    if (src.SERVICE_NAME) registerService(src.SERVICE_NAME);
  }
}

module.exports = { getAirQuality, registerAirQualityServices };
