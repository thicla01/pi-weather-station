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

const { circleIntersectsPolygon } = require("./govAlertSources/_shared");

const SEVERITY_RANK = { extreme: 4, severe: 3, moderate: 2, minor: 1 };

// Nearby-alerts radius bounds — the slider's 50–100 km range, with a
// defensive 10 km floor in case a client passes something smaller.
const NEARBY_MIN_RADIUS_KM = 10;
const NEARBY_MAX_RADIUS_KM = 100;
const NEARBY_DEFAULT_RADIUS_KM = 50;

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
 * Default-hide test/exercise alerts (CAP status !== "Actual", tagged `isTest`
 * by the source). This is the single gate every consumer shares — it lives at
 * the orchestrator, NOT at an HTTP endpoint, because `getActiveAlertsAt` also
 * feeds the Sense HAT (no `req`) and `getNearbyAlertsAt` feeds the map-overlay
 * endpoint. Gating only `GET /api/weather-alerts` would still surface a test
 * alert on the LED matrix and as a coast-wide map polygon. `showTest` is the
 * maintainer's localhost-only opt-in (see the endpoint handlers).
 *
 * @param {Array<Object>} alerts
 * @param {Boolean} showTest when true, test alerts pass through
 * @returns {Array<Object>}
 */
function filterTestAlerts(alerts, showTest) {
  return showTest ? alerts : alerts.filter((a) => !a?.isTest);
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
 * @param {Object} [opts]
 * @param {Boolean} [opts.showTest] include test/exercise alerts (default false
 *   → hidden). Only the localhost-gated endpoint ever passes true; the Sense
 *   HAT caller omits it, so test alerts never reach the LED matrix.
 * @returns {Promise<Array<Object>>} Sorted alerts, possibly empty.
 */
async function getActiveAlertsAt(lat, lon, { showTest = false } = {}) {
  const results = await Promise.all(
    Object.values(sources).map((src) => src.tryAlerts(lat, lon, { showTest }).catch(() => null))
  );
  const merged = results.filter(Array.isArray).flat();
  return filterTestAlerts(sortBySeverity(merged), showTest);
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

  // Two-factor opt-in for test/exercise alerts: locality (the unspoofable
  // socket-peer `req.isLocal`, set in index.js — NOT req.ip) closes remote
  // clients out by construction; the explicit `showTest=1` keeps the kiosk
  // (itself localhost) clean until the maintainer flips its per-device toggle.
  // A forged `?showTest=1` from a remote client is inert (isLocal false).
  const showTest = req.isLocal && req.query.showTest === "1";
  const sorted = await getActiveAlertsAt(lat, lon, { showTest });

  // Default: 5 min HTTP cache aligned with the per-source server cache so a
  // remote client polling at the recommended 10 min cadence sees consistent
  // results without hammering the upstream feeds. When test alerts are revealed
  // the body varies on locality, so it must NOT be shared by a cache (or a
  // future same-host proxy — see CLAUDE.md's reverse-proxy caveat).
  res.set("Cache-Control", showTest ? "private, max-age=0, no-store" : "public, max-age=300");
  return res.status(200).json({ alerts: sorted }).end();
}

/**
 * Collect active government alerts whose polygon comes within `radiusKm`
 * of (lat, lon), for the "nearby alerts" display-only overlay. Unlike
 * getActiveAlertsAt (point-in-polygon at the exact spot), this fetches
 * broadly — NWS by the state(s) the circle spans, ECCC's whole national
 * feed — then culls to the circle with circleIntersectsPolygon.
 *
 * Alerts with no polygon (a handful of zone-only NWS alerts whose zone
 * geometry couldn't be resolved) can't be circle-tested or drawn, so they
 * are omitted from `alerts` and only reported in `residualCount` (the
 * client's "+N not mapped" note). Nothing here feeds the banner / SenseHat
 * / eligibility — this whole path is display-only.
 *
 * @param {Number} lat
 * @param {Number} lon
 * @param {Number} radiusKm
 * @param {Object} [opts]
 * @param {Boolean} [opts.showTest] include test/exercise alerts (default false).
 *   This path draws the map-overlay polygons — without this gate a test alert's
 *   coast-wide geometry would paint even for remote viewers.
 * @returns {Promise<{alerts: Array<Object>, residualCount: Number}>}
 */
async function getNearbyAlertsAt(lat, lon, radiusKm, { showTest = false } = {}) {
  const collected = [];

  // US — fetch by the state(s) the circle's bbox corners land in.
  let states = [];
  try {
    states = await sources.nws.resolveStatesForCircle(lat, lon, radiusKm);
  } catch {
    states = [];
  }
  if (states.length) {
    const perState = await Promise.all(
      states.map((s) => sources.nws.fetchAlertsForArea(s, { showTest }).catch(() => [])),
    );
    for (const arr of perState) if (Array.isArray(arr)) collected.push(...arr);
  }

  // Canada — the (cached) feed for the circle's grid cell, whose bbox
  // covers the maximum nearby radius; the circle filter below culls
  // anything actually too far, so this naturally covers a US point
  // near the border without any extra coverage logic.
  try {
    const ca = await sources.eccc.fetchAllNormalized(lat, lon);
    if (Array.isArray(ca)) collected.push(...ca);
  } catch {
    /* best-effort — one source failing must not blank the other */
  }

  // De-dupe: a state-line alert can surface once per queried state.
  const byId = new Map();
  for (const a of collected) {
    const k = a.id || `${a.source}|${a.eventType}|${a.areaDesc}|${a.expiresAt}`;
    if (!byId.has(k)) byId.set(k, a);
  }
  const unique = filterTestAlerts([...byId.values()], showTest);

  const mappable = unique.filter((a) => a.geometry);
  const residualCount = unique.length - mappable.length;
  const inRadius = mappable.filter((a) => circleIntersectsPolygon(lat, lon, radiusKm, a.geometry));

  return { alerts: sortBySeverity(inRadius), residualCount };
}

/**
 * GET /api/nearby-alerts?lat&lon&radiusKm
 * Display-only radius survey of active government alerts around a point.
 * Always 200; an empty list is valid. `radiusKm` is clamped to the
 * supported 10–100 km range and echoed back so the client can confirm
 * what was applied.
 *
 * @param {Object} req
 * @param {Object} req.query
 * @param {String} req.query.lat
 * @param {String} req.query.lon
 * @param {String} req.query.radiusKm
 * @param {Object} res
 */
async function getNearbyAlerts(req, res) {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  let radiusKm = parseFloat(req.query.radiusKm);
  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return res.status(400).json("Invalid coordinates").end();
  }
  if (isNaN(radiusKm)) radiusKm = NEARBY_DEFAULT_RADIUS_KM;
  radiusKm = Math.max(NEARBY_MIN_RADIUS_KM, Math.min(NEARBY_MAX_RADIUS_KM, radiusKm));

  // Same localhost-only opt-in as getWeatherAlerts (see that handler).
  const showTest = req.isLocal && req.query.showTest === "1";
  const result = await getNearbyAlertsAt(lat, lon, radiusKm, { showTest });

  res.set("Cache-Control", showTest ? "private, max-age=0, no-store" : "public, max-age=300");
  return res.status(200).json({ ...result, radiusKm }).end();
}

module.exports = {
  getWeatherAlerts, getActiveAlertsAt, getNearbyAlerts, getNearbyAlertsAt,
  // Internal helpers exposed for unit tests (see test/alertTestStrip.test.js).
  __test: { filterTestAlerts, sortBySeverity },
};
