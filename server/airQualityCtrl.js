// Air-quality orchestrator. Collects candidate readings from the
// MELCC sources in parallel, picks the geographically closest one,
// and falls back to ECCC when neither returned anything.
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
// stationDistanceKm across whatever the cheap sources return.
//
// ECCC is sequenced after — not parallel with — the MELCC sources
// because ECCC may make multiple per-station HTTP calls when the
// nearest station is defunct (the existing 6-candidate walk). The
// MELCC sources are each one cached fetch, so running both in
// parallel is essentially free; firing ECCC for every Quebec
// marker would not be.

const sources = {
  melccMtl:   require("./airQualitySources/melccMtl"),
  melccRsqaq: require("./airQualitySources/melccRsqaq"),
  eccc:       require("./airQualitySources/eccc"),
};

/**
 * Pick the candidate with the smallest stationDistanceKm. Null
 * entries are ignored. Returns null if every entry is null.
 *
 * @param {Array<Object|null>} candidates
 * @returns {Object|null}
 */
function pickClosest(candidates) {
  let best = null;
  for (const c of candidates) {
    if (!c) continue;
    if (!best || c.stationDistanceKm < best.stationDistanceKm) best = c;
  }
  return best;
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

  // Cheap, parallel pass — both MELCC sources are a single cached
  // upstream fetch each. The closest valid hit wins; ties broken by
  // declaration order (Mtl before RSQAQ).
  const [melccMtl, melccRsqaq] = await Promise.all([
    sources.melccMtl.tryAqi(lat, lon).catch(() => null),
    sources.melccRsqaq.tryAqi(lat, lon).catch(() => null),
  ]);
  let best = pickClosest([melccMtl, melccRsqaq]);

  // Sequential ECCC fallback only when no MELCC coverage — ECCC's
  // per-station walks for defunct stations make it expensive to
  // run speculatively.
  if (!best) {
    best = await sources.eccc.tryAqi(lat, lon).catch(() => null);
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
