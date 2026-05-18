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
// this window. The main weather + geocode pollers run on intervals
// well below this, so a single flaky response surrounded by
// successes won't trip the health dot. Tuned at 10 min so a real
// outage still surfaces within a couple of poll cycles.
const RECENT_SUCCESS_WINDOW_MS = 10 * 60 * 1000;

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

function getHealth(req, res) {
  const all = getServiceStatus();
  const issues = [];
  for (const [service, entry] of Object.entries(all)) {
    if (!isFailure(entry)) continue;
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
