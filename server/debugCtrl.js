const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");
const dns = require("dns").promises;
const axios = require("axios").default;
const { checkForUpdate } = require("./updateChecker");
const { weatherCache, getCacheStats } = require("./proxyCtrl");
const { getServiceStatus } = require("./serviceStatus");
const { getCounters } = require("./requestCounter");
const { getResponseTimeStats } = require("./responseTimer");
const { getRemoteClients } = require("./clientTracker");

const PROVIDER_STATUS_TTL = 30 * 60 * 1000;

const PROVIDER_STATUS_APIS = [
  { name: "Tomorrow.io",     type: "statuspage",           url: "https://status.tomorrow.io/api/v2/status.json"      },
  { name: "Mapbox",          type: "statuspage",           url: "https://status.mapbox.com/api/v2/status.json"       },
  { name: "ipapi.co",        type: "html",                 url: "https://ipapi.co/status/"                           },
  { name: "LocationIQ",      type: "rss",                  url: "https://status.locationiq.com/rss"                  },
  { name: "Anthropic Claude", type: "statuspage-component", url: "https://status.claude.com/api/v2/components.json", componentName: "Claude API" },
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

function parseStatuspageComponent(name, data, componentName) {
  // Use startsWith to be resilient to appended labels like "(formerly ...)"
  const component = data?.components?.find((c) => c.name.startsWith(componentName));
  if (!component) return { name, indicator: "unknown", description: `Component "${componentName}" not found` };
  const statusMap = {
    "operational":           "none",
    "degraded_performance":  "minor",
    "partial_outage":        "major",
    "major_outage":          "critical",
    "under_maintenance":     "maintenance",
  };
  return {
    name,
    indicator:   statusMap[component.status] ?? "unknown",
    description: component.status?.replace(/_/g, " ") ?? "",
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

const CONNECTIVITY_TTL = 60 * 1000;
let _connectivityCache = null;
let _connectivityFetchedAt = null;

async function checkConnectivity() {
  const now = Date.now();
  if (_connectivityCache && _connectivityFetchedAt && (now - _connectivityFetchedAt) < CONNECTIVITY_TTL) {
    return _connectivityCache;
  }

  const start = Date.now();
  try {
    await axios.head("https://1.1.1.1", { timeout: 3000 });
    _connectivityCache = { online: true, latencyMs: Date.now() - start };
  } catch {
    _connectivityCache = { online: false, latencyMs: null };
  }
  _connectivityFetchedAt = Date.now();
  return _connectivityCache;
}

async function fetchProviderStatus() {
  const now = Date.now();
  if (_providerStatusCache && _providerStatusFetchedAt && (now - _providerStatusFetchedAt) < PROVIDER_STATUS_TTL) {
    return _providerStatusCache;
  }

  const results = await Promise.all(
    PROVIDER_STATUS_APIS.map(async ({ name, type, url, componentName }) => {
      try {
        const res = await axios.get(url, { timeout: 5000 });
        if (type === "statuspage")           return parseStatuspage(name, res.data);
        if (type === "statuspage-component") return parseStatuspageComponent(name, res.data, componentName);
        if (type === "html")                 return parseIpapiHtml(name, res.data);
        if (type === "rss")                  return parseLocationIQRss(name, res.data);
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

function getServerConfig() {
  return {
    allowRemote: process.env.ALLOW_REMOTE === "true",
    debug: process.env.DEBUG === "true",
    isSystemd: !!process.env.INVOCATION_ID,
    nodeEnv: process.env.NODE_ENV || "development",
    nodeVersion: process.version,
  };
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

function getAppVersion() {
  const pkg = require("../package.json");
  const version = pkg.version;
  const name = pkg.name;
  let commit = "unknown";
  let branch = null;
  try {
    commit = execSync("git rev-parse --short HEAD", {
      cwd: path.join(__dirname, ".."),
      encoding: "utf8",
      timeout: 3000,
    }).trim();
    const b = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: path.join(__dirname, ".."),
      encoding: "utf8",
      timeout: 3000,
    }).trim();
    if (b && b !== "master") branch = b;
  } catch { /* git not available */ }
  return { name, version, commit, branch };
}

function getSystemInfo() {
  let hardware = "Unknown";
  let osName = "Unknown";

  try {
    hardware = fs.readFileSync("/proc/device-tree/model", "utf8").replace(/\0/g, "").trim();
  } catch { /* not a Pi or file not available */ }

  try {
    const osRelease = fs.readFileSync("/etc/os-release", "utf8");
    const match = osRelease.match(/^PRETTY_NAME="(.+)"$/m);
    if (match) osName = match[1];
  } catch { /* not Linux — try macOS */ }

  if (osName === "Unknown" && process.platform === "darwin") {
    try {
      const productName = execSync("sw_vers -productName", { encoding: "utf8", timeout: 3000 }).trim();
      const productVersion = execSync("sw_vers -productVersion", { encoding: "utf8", timeout: 3000 }).trim();
      osName = `${productName} ${productVersion}`;
    } catch { /* sw_vers not available */ }

    try {
      hardware = execSync("sysctl -n hw.model", { encoding: "utf8", timeout: 3000 }).trim();
    } catch { /* sysctl not available */ }
  }

  return { hardware, os: osName, hostname: os.hostname() };
}

// Hostname reverse-DNS cache (5 min TTL)
const _hostnameCache = new Map();
const HOSTNAME_CACHE_TTL = 5 * 60 * 1000;

/**
 * Resolves the hostname for an IP via reverse DNS. Returns null on failure.
 *
 * @param {string} ip
 * @returns {Promise<string|null>}
 */
async function resolveHostname(ip) {
  const now = Date.now();
  const cached = _hostnameCache.get(ip);
  if (cached && now - cached.fetchedAt < HOSTNAME_CACHE_TTL) return cached.hostname;
  try {
    const hostnames = await dns.reverse(ip);
    const hostname = hostnames[0] || null;
    _hostnameCache.set(ip, { hostname, fetchedAt: now });
    return hostname;
  } catch {
    _hostnameCache.set(ip, { hostname: null, fetchedAt: now });
    return null;
  }
}

/**
 * Reads the Pi throttle register via vcgencmd. Returns null on non-Pi or unavailable.
 *
 * Bit layout:
 *   0x00001 Under-voltage (current)   0x10000 Under-voltage (since boot)
 *   0x00002 Freq. capped (current)    0x20000 Freq. capped (since boot)
 *   0x00004 Throttled (current)       0x40000 Throttled (since boot)
 *   0x00008 Temp. limit (current)     0x80000 Temp. limit (since boot)
 *
 * @returns {{available:boolean, raw:string, current:object, occurred:object}|null}
 */
function getPowerStatus() {
  if (process.platform !== "linux") return null;
  try {
    const output = execSync("vcgencmd get_throttled", {
      encoding: "utf8",
      timeout: 2000,
    }).trim();
    const match = output.match(/throttled=(0x[0-9a-fA-F]+)/);
    if (!match) return { available: false };
    const val = parseInt(match[1], 16);
    return {
      available: true,
      raw: match[1],
      current: {
        underVoltage: !!(val & 0x1),
        freqCapped:   !!(val & 0x2),
        throttled:    !!(val & 0x4),
        tempLimit:    !!(val & 0x8),
      },
      occurred: {
        underVoltage: !!(val & 0x10000),
        freqCapped:   !!(val & 0x20000),
        throttled:    !!(val & 0x40000),
        tempLimit:    !!(val & 0x80000),
      },
    };
  } catch {
    return null; // vcgencmd not available
  }
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
  const LOG_PATHS = [
    "/tmp/weather-server.log",          // systemd via install.sh override.conf
    path.join(__dirname, "../server.log"), // manual redirect (npm start > server.log)
  ];
  let logFound = false;
  for (const logPath of LOG_PATHS) {
    try {
      const content = fs.readFileSync(logPath, "utf8");
      logs = content.trim().split("\n").filter(Boolean).slice(-LOG_LINES);
      logFound = true;
      break;
    } catch {
      // try next path
    }
  }
  if (!logFound) logs = ["Log file not available"];

  let audit = "npm-audit.log not found";
  try {
    audit = fs.readFileSync(path.join(__dirname, "../npm-audit.log"), "utf8");
  } catch {
    // file not found — default message applies
  }

  const [providerStatus, connectivity, updateInfo] = await Promise.all([
    fetchProviderStatus(),
    checkConnectivity(),
    checkForUpdate(),
  ]);

  const mem = process.memoryUsage();
  const serverKpis = {
    uptimeSec: Math.round(process.uptime()),
    memory: {
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
      rssMb: Math.round(mem.rss / 1024 / 1024),
    },
    cache: getCacheStats(),
    responseTimes: getResponseTimeStats(),
    powerStatus: getPowerStatus(),
  };

  // Resolve hostnames for remote clients (cached, best-effort)
  const remoteClients = await Promise.all(
    getRemoteClients().map(async (c) => ({
      ...c,
      hostname: await resolveHostname(c.ip),
    }))
  );

  return res.status(200).json({ cache, logs, audit, securityEvents, services: getServiceStatus(), counters: getCounters(), system: getSystemInfo(), network: getNetworkInfo(), providerStatus, connectivity, appVersion: getAppVersion(), serverKpis, remoteClients, updateInfo, serverConfig: getServerConfig() });
}

module.exports = { getDebugInfo, logSecurityEvent, initServerInfo };
