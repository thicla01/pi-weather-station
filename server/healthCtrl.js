const { getServiceStatus } = require("./serviceStatus");

/**
 * Service-name lists that drive the health classification.
 *
 * "Critical" services back the core display (Tomorrow.io weather,
 * Mapbox tiles, LocationIQ reverse geocoding). Any one of them
 * returning an error tier means the user is looking at a degraded
 * UI and we surface "red".
 *
 * Everything else is "non-critical": Anthropic AI summary, radar
 * overlays, indoor sensors, air-quality sources, government
 * alerts, sunrise/sunset, IP geolocation. A failure in any of
 * them degrades but doesn't break the app — surface "yellow".
 *
 * Services that haven't been called yet (`status: null`) are
 * IGNORED — counting them as failures would paint a freshly-booted
 * Pi as red until the first poll completes.
 */
const CRITICAL_SERVICES = new Set([
  "Tomorrow.io (current)",
  "Tomorrow.io (hourly)",
  "Tomorrow.io (daily)",
  "Mapbox",
  "LocationIQ",
]);

// A failure is only "live" if there has been no successful call in
// this window. The window must be wider than the slowest poller's
// cadence — otherwise a sibling that succeeded once falls out of
// the window before the next poll cycle, and an alternative-chain
// failure (e.g. EPA AirNow 401 for a Canadian kiosk) re-surfaces
// every cycle even though the regional source (MELCC RSQA / ECCC
// AQHI) is working fine.
//
// Slowest poller is the AQ refresh at 30 min (see AppContext.js
// `AQI_REFRESH_MS`). 35 min gives a 5 min buffer for the next poll
// to land while the previous success is still counted. Faster
// pollers (weather 1-5 min, alerts 5 min, geocode 30 min on
// location change) all sit comfortably below this window.
//
// Trade-off: a service that genuinely starts failing takes up to
// ~35 min to surface on the chip. Acceptable because we can't
// detect a regression faster than the poll itself — bumping the
// window narrower than the poll cadence just creates false
// positives without speeding up real-failure detection.
const RECENT_SUCCESS_WINDOW_MS = 35 * 60 * 1000;

// Services orchestrated as alternative chains — the first one that
// returns usable data wins, and the others are expected to fail or
// return "no data" depending on the user's region. Surfacing those
// expected failures as health issues paints the dot as degraded
// when the feature is actually working perfectly.
//
//   - Alerts: NWS covers US territory, ECCC covers Canada. For a
//     Montreal user NWS will 5xx or 400; for a Texan user ECCC
//     returns nothing.
//   - Air quality: MELCC (Montreal first, then rest of Quebec),
//     ECCC AQHI Canada-wide, EPA AirNow for the US, OpenAQ as
//     global fallback. Only the source matching the user's region
//     returns data — others 404 or 503.
//
// A failure on a member of one of these groups is suppressed as
// long as ANY sibling has a recent success.
const ALTERNATIVE_GROUPS = [
  [
    "NWS (severe weather alerts)",
    "Environment Canada (severe weather alerts)",
  ],
  [
    "MELCC RSQA (Montreal)",
    "MELCC RSQAQ (Quebec)",
    "Environment Canada (AQHI)",
    "EPA AirNow",
    "OpenAQ",
  ],
];

/**
 * Decide whether a serviceStatus entry counts as a failure for
 * health reporting. HTTP 2xx and 3xx are fine; 4xx/5xx + null
 * server-side exceptions are failures. `null` status (never called)
 * is treated as "fine" — see comment above.
 *
 * @param {{status: ?number}} entry
 * @returns {boolean}
 */
function isFailure(entry) {
  if (!entry || entry.status == null) return false;
  const code = Number(entry.status);
  if (!Number.isFinite(code)) return true;
  if (code < 400) return false;
  // Suppress the failure if there's been a successful call recently
  // — protects against transient flakes and duplicate call paths
  // (e.g. AI summary re-fetching Tomorrow.io and failing while the
  // main weather poll just succeeded).
  if (entry.lastSuccess) {
    const successAge = Date.now() - new Date(entry.lastSuccess).getTime();
    if (Number.isFinite(successAge) && successAge < RECENT_SUCCESS_WINDOW_MS) {
      return false;
    }
  }
  return true;
}

/**
 * GET /api/health
 *
 * Aggregates the in-memory `serviceStatus` map into one of three
 * states for the client-side HealthIndicator dot.
 *
 * Response shape:
 *   {
 *     status: "green" | "yellow" | "red",
 *     issues: [ { service, status, comment, critical } ],
 *     lastChecked: <ISO timestamp>
 *   }
 *
 * Public endpoint, rate-limited by the caller. Returns 200 in all
 * cases — even "red" — so the client can render the diagnostic.
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
/**
 * True if `service` belongs to an alternative-chain group AND at
 * least one sibling in that group has a recent successful call —
 * meaning the feature backed by the group is working and this
 * particular source's failure is just "wrong region for this user".
 *
 * @param {string} service
 * @param {Object} all serviceStatus map
 * @returns {boolean}
 */
function suppressedByGroupSibling(service, all) {
  for (const group of ALTERNATIVE_GROUPS) {
    if (!group.includes(service)) continue;
    for (const sibling of group) {
      if (sibling === service) continue;
      const e = all[sibling];
      if (!e || !e.lastSuccess) continue;
      const age = Date.now() - new Date(e.lastSuccess).getTime();
      if (Number.isFinite(age) && age < RECENT_SUCCESS_WINDOW_MS) return true;
    }
  }
  return false;
}

/**
 * True if `service` belongs to an alternative-chain group AND has
 * never recorded a successful call (`lastSuccess` is null). This
 * indicates a service that's either (a) never properly configured
 * by the user (e.g. EPA AirNow without a valid API key), or
 * (b) not relevant to the user's region (e.g. AirNow called for a
 * Canadian kiosk because the US bounding box is intentionally
 * permissive to cover Alaska / Hawaii / Puerto Rico, which makes it
 * also catch Eastern Canada). Reporting such a service as
 * "degraded" is misleading — it hasn't regressed, it's never been
 * up. Once the user fixes the configuration and the service
 * succeeds once, `lastSuccess` is populated and any subsequent
 * failure will be reported normally.
 *
 * Critical services (Tomorrow.io, Mapbox, etc.) are not in any
 * alternative group, so this suppression doesn't apply to them —
 * a critical service that's never succeeded is a real config
 * problem that the user needs to see.
 *
 * @param {string} service
 * @param {{lastSuccess: ?string}} entry
 * @returns {boolean}
 */
function isUnconfiguredAlternative(service, entry) {
  if (entry.lastSuccess) return false;
  for (const group of ALTERNATIVE_GROUPS) {
    if (group.includes(service)) return true;
  }
  return false;
}

function getHealth(req, res) {
  const all = getServiceStatus();
  const issues = [];
  for (const [service, entry] of Object.entries(all)) {
    if (!isFailure(entry)) continue;
    if (isUnconfiguredAlternative(service, entry)) continue;
    if (suppressedByGroupSibling(service, all)) continue;
    issues.push({
      service,
      status: entry.status,
      comment: entry.comment || "",
      critical: CRITICAL_SERVICES.has(service),
    });
  }

  const hasCriticalIssue = issues.some((i) => i.critical);
  // eslint-disable-next-line no-nested-ternary -- 3-tier classifier reads more cleanly inline
  const status = hasCriticalIssue
    ? "red"
    : issues.length > 0
      ? "yellow"
      : "green";

  res.json({
    status,
    issues,
    lastChecked: new Date().toISOString(),
  });
}

module.exports = { getHealth };
