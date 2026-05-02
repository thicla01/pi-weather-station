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
  serviceStatus[service] = {
    status,
    lastCall: new Date().toISOString(),
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
