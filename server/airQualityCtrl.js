// Air-quality orchestrator. Walks a priority-ordered chain of upstream
// sources and returns the first one that produces a valid reading at
// the requested coordinate; soft-fails to {available:false} when every
// source is empty so the client can transparently fall back to other
// signals (Tomorrow.io's epaIndex when configured).
//
// Source priority is geographic specificity, not data freshness — a
// hyper-local municipal observation beats a regional ECCC fall-back
// every time, even if the ECCC reading is technically more recent:
//
//   1. MELCC Montreal RSQA (city of Montreal, hourly CSV)
//   2. MELCC RSQAQ provincial (rest of Quebec, hourly ArcGIS REST)
//   3. ECCC AQHI (rest of Canada, hourly OGC Features API; falls back
//      to forecast bulletin when observations are empty)
//
// Each source module owns its upstream contract, its own cache, and
// returns a normalised payload. The orchestrator only knows the order.

const sources = [
  require("./airQualitySources/melccMtl"),
  require("./airQualitySources/melccRsqaq"),
  require("./airQualitySources/eccc"),
];

/**
 * GET /api/air-quality
 * Returns the best-available air-quality reading for the nearest
 * station to a given lat/lon, or `{ available: false }` when every
 * source comes up empty.
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

  for (const src of sources) {
    let payload;
    try {
      payload = await src.tryAqi(lat, lon);
    } catch {
      // tryAqi() is supposed to swallow its own errors and return
      // null; this catch is just a belt-and-braces guard.
      payload = null;
    }
    if (payload) {
      return res.status(200).json({ available: true, ...payload }).end();
    }
  }

  return res.status(200).json({ available: false, reason: "no-data" }).end();
}

/**
 * Pre-register every air-quality source with the service-status
 * tracker so the Debug panel shows them as "Not yet called" before
 * the first poll lands. Called from `index.js` at startup.
 */
function registerAirQualityServices(registerService) {
  for (const src of sources) {
    if (src.SERVICE_NAME) registerService(src.SERVICE_NAME);
  }
}

module.exports = { getAirQuality, registerAirQualityServices };
