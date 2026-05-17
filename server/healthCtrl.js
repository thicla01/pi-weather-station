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
  return code >= 400;
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
function getHealth(req, res) {
  const all = getServiceStatus();
  const issues = [];
  for (const [service, entry] of Object.entries(all)) {
    if (!isFailure(entry)) continue;
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
