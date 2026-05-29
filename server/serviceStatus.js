const serviceStatus = {};

/**
 * Pre-register a service so it appears in the Debug panel's "Services"
 * section before any real call happens. Useful for inventory ("is service
 * X expected?") and to surface gaps like "Anthropic never called this
 * session" — which would otherwise hide the service entirely. Doesn't
 * overwrite an existing entry: a real call already recorded keeps its
 * status/lastCall/comment intact.
 *
 * @param {String} service Service name (must match recordServiceCall's name)
 */
function registerService(service) {
  if (!serviceStatus[service]) {
    serviceStatus[service] = {
      status: null,
      lastCall: null,
      lastSuccess: null,
      consecutiveFailures: 0,
      comment: "Not yet called",
    };
  }
}

/**
 * Record the result of an external service call
 *
 * @param {String} service  Service name (e.g. "Tomorrow.io (current)")
 * @param {Number} status   HTTP status code
 * @param {String} comment  Additional information (error message, "OK", etc.)
 */
function recordServiceCall(service, status, comment) {
  const now = new Date().toISOString();
  const prev = serviceStatus[service];
  const isSuccess = typeof status === "number" && status >= 200 && status < 400;
  serviceStatus[service] = {
    status,
    lastCall: now,
    // Preserve the timestamp of the most recent successful call so
    // the health classifier can distinguish "service down" from
    // "service flaked once but is working" (e.g. AI-summary path
    // duplicates the Tomorrow.io call and may fail while the main
    // weather fetch from proxyCtrl just succeeded — without this
    // we'd flip to red on every AI summary failure).
    lastSuccess: isSuccess ? now : (prev && prev.lastSuccess) || null,
    // Count of consecutive non-2xx/3xx calls, reset to 0 on any success.
    // The health classifier requires this to reach a threshold before it
    // flags a service, so a single transient upstream blip (Tomorrow.io
    // 5xx that recovers in <21 s, a burst-induced 429) never paints the
    // chip red on its own. See healthCtrl.js `isFailure`.
    consecutiveFailures: isSuccess ? 0 : ((prev && prev.consecutiveFailures) || 0) + 1,
    comment: comment || "",
  };
  console.log(`[service] ${service} → ${status}${comment ? " — " + comment : ""}`);
}

/**
 * Returns the current service status map
 *
 * @returns {Object} serviceStatus
 */
function getServiceStatus() {
  return serviceStatus;
}

module.exports = { registerService, recordServiceCall, getServiceStatus };
