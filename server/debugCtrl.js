const fs = require("fs");
const path = require("path");
const { weatherCache } = require("./proxyCtrl");

const securityEvents = [];
const MAX_SECURITY_EVENTS = 50;
const LOG_LINES = 100;

/**
 * Log a blocked request event (REMOTE_SECURITY)
 *
 * @param {String} ip
 * @param {String} method
 * @param {String} url
 */
function logSecurityEvent(ip, method, url) {
  const event = { time: new Date().toISOString(), ip, method, url };
  securityEvents.unshift(event);
  if (securityEvents.length > MAX_SECURITY_EVENTS) securityEvents.pop();
  console.log(`[security] BLOCKED ${method} ${url} from ${ip}`);
}

/**
 * GET /api/debug — returns cache state, recent logs, audit summary, security events
 * Always restricted to localhost.
 *
 * @param {Object} req
 * @param {Object} res
 */
function getDebugInfo(req, res) {
  const now = Date.now();

  const cache = Object.entries(weatherCache).map(([key, entry]) => ({
    key,
    expiresIn: Math.max(0, Math.round((entry.expiresAt - now) / 1000)),
    expired: now > entry.expiresAt,
  }));

  let logs = [];
  try {
    const content = fs.readFileSync("/tmp/weather-server.log", "utf8");
    logs = content.trim().split("\n").filter(Boolean).slice(-LOG_LINES);
  } catch {
    logs = ["Log file not available"];
  }

  let audit = "npm-audit.log not found";
  try {
    audit = fs.readFileSync(path.join(__dirname, "../npm-audit.log"), "utf8");
  } catch {
    // file not found — default message applies
  }

  return res.status(200).json({ cache, logs, audit, securityEvents });
}

module.exports = { getDebugInfo, logSecurityEvent };
