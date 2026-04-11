const serviceStatus = {};

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

module.exports = { recordServiceCall, getServiceStatus };
