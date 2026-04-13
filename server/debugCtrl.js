const fs = require("fs");
const os = require("os");
const path = require("path");
const axios = require("axios").default;
const { weatherCache } = require("./proxyCtrl");
const { getServiceStatus } = require("./serviceStatus");
const { getCounters } = require("./requestCounter");

const PROVIDER_STATUS_TTL = 30 * 60 * 1000;

const PROVIDER_STATUS_APIS = [
  { name: "Tomorrow.io", type: "statuspage", url: "https://status.tomorrow.io/api/v2/status.json" },
  { name: "Mapbox",      type: "statuspage", url: "https://status.mapbox.com/api/v2/status.json"  },
  { name: "ipapi.co",    type: "html",       url: "https://ipapi.co/status/"                      },
  { name: "LocationIQ",  type: "rss",        url: "https://status.locationiq.com/rss"             },
];

function parseStatuspage(name, data) {
  const { indicator, description } = data?.status ?? {};
  return { name, indicator: indicator ?? "unknown", description: description ?? "" };
}

function parseIpapiHtml(name, html) {
  const m = html.match(/<div class="incident-entry">\s*<span class="light light-(\d)"><\/span>\s*<span>([^<]+)<\/span>[^<]*<span>([^<]+)<\/span>/);
  if (!m) return { name, indicator: "unknown", description: "Could not parse status" };
  const lightMap = { "0": "none", "1": "minor", "2": "major" };
  return {
    name,
    indicator:   lightMap[m[1]] ?? "unknown",
    description: `${m[2].trim()} · ${m[3].trim()}`,
  };
}

function parseLocationIQRss(name, xml) {
  const m = xml.match(/<item>[\s\S]*?<title><!\[CDATA\[([^\]]+)\]\]><\/title>[\s\S]*?<pubDate>([^<]+)<\/pubDate>/);
  if (!m) return { name, indicator: "—", description: "Could not parse feed" };
  const title = m[1].trim();
  const dateMatch = m[2].match(/(\d{2} \w{3} \d{4})/);
  const date = dateMatch ? dateMatch[1] : m[2].trim();
  return { name, indicator: "—", description: `Last incident: ${date} · ${title}` };
}

let _providerStatusCache = null;
let _providerStatusFetchedAt = null;

async function fetchProviderStatus() {
  const now = Date.now();
  if (_providerStatusCache && _providerStatusFetchedAt && (now - _providerStatusFetchedAt) < PROVIDER_STATUS_TTL) {
    return _providerStatusCache;
  }

  const results = await Promise.all(
    PROVIDER_STATUS_APIS.map(async ({ name, type, url }) => {
      try {
        const res = await axios.get(url, { timeout: 5000 });
        if (type === "statuspage") return parseStatuspage(name, res.data);
        if (type === "html")       return parseIpapiHtml(name, res.data);
        if (type === "rss")        return parseLocationIQRss(name, res.data);
        return { name, indicator: "unknown", description: "Unknown provider type" };
      } catch {
        return { name, indicator: "unknown", description: "Could not fetch status" };
      }
    })
  );

  _providerStatusCache = { fetchedAt: new Date().toISOString(), providers: results };
  _providerStatusFetchedAt = now;
  return _providerStatusCache;
}

let _serverPort = null;
let _serverProtocol = null;

/**
 * Called from index.js once the server is listening.
 *
 * @param {number} port
 * @param {string} protocol  "http" or "https"
 */
function initServerInfo(port, protocol) {
  _serverPort = port;
  _serverProtocol = protocol;
}

function getNetworkInfo() {
  const ifaces = os.networkInterfaces();
  const ips = [];
  for (const iface of Object.values(ifaces)) {
    for (const addr of iface) {
      if (addr.family === "IPv4" && !addr.internal) {
        ips.push(addr.address);
      }
    }
  }
  return {
    ips,
    port: _serverPort,
    protocol: _serverProtocol,
    urls: ips.map((ip) => `${_serverProtocol}://${ip}:${_serverPort}`),
  };
}

function getSystemInfo() {
  let hardware = "Unknown";
  let os = "Unknown";

  try {
    hardware = fs.readFileSync("/proc/device-tree/model", "utf8").replace(/\0/g, "").trim();
  } catch { /* not a Pi or file not available */ }

  try {
    const osRelease = fs.readFileSync("/etc/os-release", "utf8");
    const match = osRelease.match(/^PRETTY_NAME="(.+)"$/m);
    if (match) os = match[1];
  } catch { /* file not available */ }

  return { hardware, os };
}

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
async function getDebugInfo(req, res) {
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

  const providerStatus = await fetchProviderStatus();

  return res.status(200).json({ cache, logs, audit, securityEvents, services: getServiceStatus(), counters: getCounters(), system: getSystemInfo(), network: getNetworkInfo(), providerStatus });
}

module.exports = { getDebugInfo, logSecurityEvent, initServerInfo };
