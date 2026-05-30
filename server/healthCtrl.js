const { getServiceStatus } = require("./serviceStatus");
const { fetchProviderStatus } = require("./debugCtrl");

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

// A failure is suppressed (treated as "not live") if there has been a
// successful call within this window. This protects against transient
// flakes and duplicate call paths (e.g. the AI-summary path re-fetching
// Tomorrow.io and failing while the main weather poll just succeeded), and
// against alternative-chain siblings: an EPA AirNow 401 for a Canadian
// kiosk shouldn't surface every cycle while the regional source (MELCC
// RSQA / ECCC AQHI) is working fine, so the window must be wider than the
// slowest *fast* poller's cadence.
//
// 35 min comfortably covers the AQ refresh (30 min, see AppContext.js
// `AQI_REFRESH_MS`), the current-weather poll (10 min), alerts (10 min),
// and geocode (on location change). It does NOT cover the hourly weather
// poll (60 min) or daily (24 h) — and that's fine, because the window is
// no longer the only line of defence (see MIN_CONSECUTIVE_FAILURES below).
const RECENT_SUCCESS_WINDOW_MS = 35 * 60 * 1000;

// How many consecutive failed calls a service must accumulate before the
// classifier flags it. This is the fix for the hourly/daily blip problem:
// those endpoints poll at 60 min / 24 h, so their last success is ALWAYS
// older than RECENT_SUCCESS_WINDOW_MS — meaning a single transient
// Tomorrow.io 5xx/429 used to paint the chip red and keep it red until the
// next successful poll (up to 24 h away for daily). Requiring two
// consecutive failures means one blip bumps the counter to 1 and stays
// invisible; only a sustained failure across consecutive polls reaches the
// threshold and surfaces. The `consecutiveFailures` counter is maintained
// in serviceStatus.recordServiceCall and reset to 0 on any success.
//
// Combined with the server-side single-retry in proxyCtrl (which already
// absorbs most transient blips before they're ever recorded as a failure),
// this makes a red chip mean "Tomorrow.io is actually down", not "it
// hiccuped once".
//
// Trade-off: a service that genuinely starts failing now needs two failed
// polls to surface — at worst ~48 h for the daily endpoint. Acceptable:
// the 10-min current poll still surfaces a real Tomorrow.io outage within
// ~20 min, and the daily forecast going stale for a day is not a
// "degraded display" the user needs a red dot to learn about.
const MIN_CONSECUTIVE_FAILURES = 2;

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
 * health reporting. HTTP 2xx and 3xx are fine; 4xx/5xx + non-numeric
 * status (server-side exceptions) are failure *candidates*. `null`
 * status (never called) is treated as "fine" — see comment above.
 *
 * A failure candidate is only reported if BOTH:
 *   1. there has been no successful call within RECENT_SUCCESS_WINDOW_MS
 *      (suppresses transient flakes / duplicate call paths), and
 *   2. it has failed at least MIN_CONSECUTIVE_FAILURES times in a row
 *      (suppresses a single blip on a slow poller — hourly/daily —
 *      whose last success always predates the window).
 *
 * @param {{status: ?number, lastSuccess: ?string, consecutiveFailures: ?number}} entry
 * @returns {boolean}
 */
function isFailure(entry) {
  if (!entry || entry.status == null) return false;
  const code = Number(entry.status);
  const isErrorCode = !Number.isFinite(code) || code >= 400;
  if (!isErrorCode) return false;
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
  // Require a sustained failure (not a one-off blip) before reporting.
  // See MIN_CONSECUTIVE_FAILURES above.
  if ((entry.consecutiveFailures || 0) < MIN_CONSECUTIVE_FAILURES) {
    return false;
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

// Patterns that can carry an internal network address inside a service
// comment: bare IPv4 (with optional :port), and host:port pairs (e.g. a
// reverse-DNS name or "homebridge.local:8581"). Service comments are
// surfaced verbatim by GET /api/health, which is NOT localhost-gated, so a
// comment sourced from a raw network-error message could disclose an
// internal host to a remote client — the exact thing GET /settings strips
// for the indoorTemperature block. Sources are also hardened at the point
// of recording (see indoorTempCtrl), but this is defense in depth for any
// current or future comment source that forgets.
const IPV4_WITH_PORT = /\b\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?\b/g;
const HOST_WITH_PORT = /\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+:\d{1,5}\b/gi;

/**
 * Redacts internal network addresses (IPv4 / host:port) from a service
 * comment so it is safe to return to a remote (non-localhost) client.
 *
 * @param {string} comment - Raw service comment, possibly containing a host.
 * @returns {string} The comment with any address replaced by "[redacted]".
 */
function redactHostInfo(comment) {
  if (!comment) return "";
  return comment
    .replace(IPV4_WITH_PORT, "[redacted]")
    .replace(HOST_WITH_PORT, "[redacted]");
}

async function getHealth(req, res) {
  const all = getServiceStatus();
  const issues = [];
  for (const [service, entry] of Object.entries(all)) {
    if (!isFailure(entry)) continue;
    if (isUnconfiguredAlternative(service, entry)) continue;
    if (suppressedByGroupSibling(service, all)) continue;
    const rawComment = entry.comment || "";
    issues.push({
      service,
      status: entry.status,
      // Local callers (the kiosk itself, SSH tunnel, RPi Connect — all
      // terminate at loopback) get the full comment for diagnostics;
      // remote callers get an address-redacted version.
      comment: req.isLocal ? rawComment : redactHostInfo(rawComment),
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

  // Surface upstream provider statuspages alongside the local
  // serviceStatus issues — added 2026-05-27 after the morning's
  // GitHub Git-Operations degradation made in-app updates slow /
  // time out with no upstream-side hint visible to the kiosk
  // owner. Currently scoped to GitHub: it's the only provider we
  // don't already track via `recordServiceCall` (the in-app
  // updater spawns `git pull` as a one-shot child process, so no
  // call wrapper ever fires for it), so the statuspage is our
  // only signal for it. Other providers (Tomorrow.io, Mapbox,
  // etc.) keep their statuspages in the Debug panel only — their
  // real-time health is already represented by `serviceStatus`
  // entries from our actual call paths, and duplicating that into
  // the dock popover would surface upstream-reported degradations
  // that our specific calls aren't experiencing.
  //
  // IMPORTANT: `providerStatus` does NOT influence the chip's
  // color classification above. It's purely informational —
  // rendered as a section in the popover when the user taps the
  // chip. The chip stays green if no local services are failing,
  // even if GitHub is reporting a major outage. Rationale: the
  // user's kiosk is fully functional without GitHub (only the
  // update flow is affected), so painting the chip yellow / red
  // for a GitHub-only issue would mis-represent the system state.
  //
  // fetchProviderStatus has its own 30-min cache, so the cost
  // here is essentially free after the first call. The try/catch
  // defends against a statuspage-API outage breaking /api/health
  // entirely — a partial response with providerStatus=null is
  // more useful than a 500.
  let providerStatus = null;
  try {
    // `fetchProviderStatus` returns an envelope `{ fetchedAt,
    // providers: [...] }` (the shape the debug panel renders); the
    // actual list of `{ name, indicator, description }` entries is
    // under `.providers`.
    const all = await fetchProviderStatus();
    const list = Array.isArray(all?.providers) ? all.providers : [];
    const github = list.find((p) => p.name === "GitHub");
    if (github) providerStatus = { github };
  } catch (err) {
    console.warn("[health] fetchProviderStatus failed:", err.message);
  }

  res.json({
    status,
    issues,
    providerStatus,
    lastChecked: new Date().toISOString(),
  });
}

module.exports = {
  getHealth,
  // Pure classifier helpers exposed for unit tests (see
  // test/healthClassifier.test.js) — keeps the public surface minimal.
  __test: {
    isFailure,
    suppressedByGroupSibling,
    isUnconfiguredAlternative,
    redactHostInfo,
    MIN_CONSECUTIVE_FAILURES,
    RECENT_SUCCESS_WINDOW_MS,
  },
};
