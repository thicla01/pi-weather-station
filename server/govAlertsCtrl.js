// Government severe-weather alerts orchestrator. Calls every regional
// source in parallel and merges their normalised payloads into a
// single list. Each source already filters by geography (NWS by
// point query, ECCC by point-in-polygon over the cached feed), so a
// kiosk in Mexico gets `{ alerts: [] }` from both, and a kiosk near
// the Niagara border legitimately gets alerts from both. Failures
// are isolated: one source erroring out doesn't blank the other.
//
// The endpoint always returns 200 with an `alerts` array (possibly
// empty). The client never has to handle the "out of coverage" case
// — empty list IS the out-of-coverage response. The radar-derived
// banner keeps working independently when there's no government
// signal to surface.

const sources = {
  nws: require("./govAlertSources/nws"),
  eccc: require("./govAlertSources/eccc"),
};

const SEVERITY_RANK = { extreme: 4, severe: 3, moderate: 2, minor: 1 };

/**
 * Sort merged alerts by descending severity, ties broken by
 * descending expiry time so the freshest critical alert lands
 * first. The client only displays the first one in the banner;
 * the others are still in the payload for future "show all
 * active alerts" UI without changing the contract.
 *
 * @param {Array<Object>} alerts
 * @returns {Array<Object>}
 */
function sortBySeverity(alerts) {
  return alerts.slice().sort((a, b) => {
    const sa = SEVERITY_RANK[a.severity] || 0;
    const sb = SEVERITY_RANK[b.severity] || 0;
    if (sb !== sa) return sb - sa;
    return String(b.expiresAt || "").localeCompare(String(a.expiresAt || ""));
  });
}

/**
 * Merge every regional source's normalised alerts at the given
 * point and return them sorted by severity. Exposed as a reusable
 * helper so other controllers (notably `sensehatCtrl` for the LED
 * matrix alert override) can resolve "is there an active gov alert
 * here?" without duplicating the source-fan-out + sort logic. Each
 * source's `tryAlerts` is wrapped in `.catch(() => null)` so one
 * upstream failure doesn't blank the others.
 *
 * @param {Number} lat
 * @param {Number} lon
 * @returns {Promise<Array<Object>>} Sorted alerts, possibly empty.
 */
async function getActiveAlertsAt(lat, lon) {
  const results = await Promise.all(
    Object.values(sources).map((src) => src.tryAlerts(lat, lon).catch(() => null))
  );
  const merged = results.filter(Array.isArray).flat();
  return sortBySeverity(merged);
}

/**
 * GET /api/weather-alerts?lat&lon
 * Merge every regional source's normalised alerts at the given
 * point and return them sorted by severity. Always 200; an empty
 * list is a valid response.
 *
 * @param {Object} req
 * @param {Object} req.query
 * @param {String} req.query.lat
 * @param {String} req.query.lon
 * @param {Object} res
 */
async function getWeatherAlerts(req, res) {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return res.status(400).json("Invalid coordinates").end();
  }

  const sorted = await getActiveAlertsAt(lat, lon);

  // 5 min HTTP cache aligns with the per-source server cache so a
  // remote client polling at the recommended 10 min cadence sees
  // consistent results without hammering the upstream feeds.
  res.set("Cache-Control", "public, max-age=300");
  return res.status(200).json({ alerts: sorted }).end();
}

module.exports = { getWeatherAlerts, getActiveAlertsAt };
