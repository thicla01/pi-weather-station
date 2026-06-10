const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");
const dns = require("dns").promises;
const axios = require("axios").default;
const { checkForUpdate, getRepo } = require("./updateChecker");
const { weatherCache, getCacheStats } = require("./proxyCtrl");
const { summaryCache, getRecentRadarSnapshots } = require("./aiSummaryCtrl");
const { getServiceStatus } = require("./serviceStatus");
const { getCounters } = require("./requestCounter");
const { getResponseTimeStats } = require("./responseTimer");
const { getRemoteClients } = require("./clientTracker");
const { detectSenseHatVersion } = require("./sensehatModeCtrl");

const PROVIDER_STATUS_TTL = 30 * 60 * 1000;

const PROVIDER_STATUS_APIS = [
  { name: "Tomorrow.io",     type: "statuspage",           url: "https://status.tomorrow.io/api/v2/status.json"      },
  { name: "Mapbox",          type: "statuspage",           url: "https://status.mapbox.com/api/v2/status.json"       },
  { name: "ipapi.co",        type: "html",                 url: "https://ipapi.co/status/"                           },
  { name: "LocationIQ",      type: "rss",                  url: "https://status.locationiq.com/rss"                  },
  { name: "Anthropic Claude", type: "statuspage-component", url: "https://status.claude.com/api/v2/components.json", componentName: "Claude API" },
  // RainViewer hosts its public status page on Hyperping (status.rainviewer.com),
  // which is a React SPA without a stable JSON status endpoint we can scrape
  // the way the Statuspage.io entries above do. Fall back to an "api-ping"
  // probe of the actual API URL the radar code uses for the frame index —
  // semantics are slightly different (it answers "is RainViewer's API
  // currently answering?" rather than "is RainViewer self-reporting issues?")
  // but the result is what the kiosk owner cares about. The latency reading
  // also surfaces slow-but-up situations (>3 s response time → minor).
  { name: "RainViewer",      type: "api-ping",             url: "https://api.rainviewer.com/public/weather-maps.json" },
  // GitHub is not an upstream we call directly from the runtime
  // (no `recordServiceCall` ever fires for it), so the only health
  // signal we have for it is the statuspage. We track "Git
  // Operations" specifically because that's the component that
  // affects the in-app updater (`POST /api/update` runs a real
  // `git pull` to fetch new commits). A degradation here predicts
  // slow or timing-out updates — surfacing it in the dock popover
  // gives the kiosk owner an upstream-side explanation when the
  // updater behaves oddly. Validated live on 2026-05-27 morning
  // when this very component was in degraded state during update
  // attempts (see commit cec11e9 — the 90 s timeout bump that
  // shipped the same morning was motivated by the same incident).
  { name: "GitHub",          type: "statuspage-component", url: "https://www.githubstatus.com/api/v2/components.json", componentName: "Git Operations" },
];

const API_PING_SLOW_MS = 3000; // above this threshold the API is "responsive but slow"

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

// Single shared probe target. Cloudflare 1.1.1.1 is a neutral
// anycast endpoint (not a project upstream, so the indicator
// answers "can the kiosk reach the public internet?" without
// conflating with provider-specific availability — those have
// their own dedicated signals via `providerStatus` and the
// `serviceStatus` map). Exposed in the response payload so the
// Debug panel can surface which host the latency numbers refer
// to, after the May 2026 ambiguity report ("what does 431 ms
// even measure?").
const CONNECTIVITY_HOST = "1.1.1.1";
const CONNECTIVITY_TCP_PORT = 443;

/**
 * Measure raw TCP handshake latency to (host, port). Opens a
 * non-TLS socket, times to the `connect` event, then destroys.
 * No data exchange — just the 3-way SYN/SYN-ACK/ACK round-trip,
 * which is the closest we can get to a "raw ping" without
 * shell-out to `/bin/ping` (which would need `setcap` for raw
 * ICMP on Linux when Node runs as a non-root user).
 *
 * Returns the latency in ms, or `null` if the connection failed
 * (timeout, refused, network error). 3 s timeout matches the
 * fail-fast intent — a TCP handshake that hasn't completed in
 * 3 s on a non-broken link essentially never will.
 *
 * @param {string} host
 * @param {number} port
 * @returns {Promise<number|null>}
 */
function measureTcpLatency(host, port) {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = new net.Socket();
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* already destroyed */ }
      resolve(value);
    };
    socket.setTimeout(3000);
    socket.once("connect", () => finish(Date.now() - start));
    socket.once("timeout", () => finish(null));
    socket.once("error", () => finish(null));
    try {
      socket.connect(port, host);
    } catch {
      finish(null);
    }
  });
}

async function checkConnectivity() {
  const now = Date.now();
  if (_connectivityCache && _connectivityFetchedAt && (now - _connectivityFetchedAt) < CONNECTIVITY_TTL) {
    return _connectivityCache;
  }

  // Two measurements in parallel:
  //
  //  - `latencyMs`    = full HTTPS HEAD round-trip (DNS + TCP +
  //                     TLS handshake + HEAD response). This is
  //                     the historical value the panel always
  //                     reported, kept for back-compat and as a
  //                     user-facing "what does an HTTPS call to a
  //                     neutral host cost from this kiosk?".
  //  - `tcpLatencyMs` = raw TCP handshake only (SYN/SYN-ACK/ACK),
  //                     introduced 2026-05-27. This is what
  //                     classic `ping` represents conceptually
  //                     and is the value the panel's traffic-
  //                     light colour-coding is applied to: ≤200
  //                     green, 200-500 yellow, >500 red. The
  //                     thresholds correspond to a "raw link
  //                     latency" mental model, which is what
  //                     Claude Design's spec intended; applying
  //                     them to the HTTPS HEAD value would yield
  //                     too many yellows because TLS handshake
  //                     alone routinely adds 200-300 ms.
  //
  // HTTPS timeout was 3 s historically — fine on a typical
  // residential line but too tight on marginal links (observed
  // May 5 2026 on a Pi behind an EAP-215 building-to-building
  // wireless bridge). 8 s gives the same fail-fast intent against
  // a real internet outage while tolerating a 5-10× latency
  // spike.
  const httpsStart = Date.now();
  const httpsPromise = axios
    .head(`https://${CONNECTIVITY_HOST}`, { timeout: 8000 })
    .then(() => Date.now() - httpsStart)
    .catch(() => null);
  const tcpPromise = measureTcpLatency(CONNECTIVITY_HOST, CONNECTIVITY_TCP_PORT);
  const [latencyMs, tcpLatencyMs] = await Promise.all([httpsPromise, tcpPromise]);

  // `online` is true if EITHER probe succeeded. Either signal is
  // enough to demonstrate connectivity; a failure on only one
  // typically indicates a transient flake or a middlebox that
  // mangles one protocol but not the other (HTTPS through a
  // captive portal, TCP blocked at the firewall, etc.).
  const online = latencyMs != null || tcpLatencyMs != null;
  _connectivityCache = {
    online,
    host: CONNECTIVITY_HOST,
    latencyMs,
    tcpLatencyMs,
  };
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
      // api-ping is structurally different from the other types: latency is
      // part of the signal and a non-2xx / unreachable result is itself the
      // status answer (not an "unknown — couldn't fetch"). Handle it inline
      // instead of falling through to the generic try/catch.
      if (type === "api-ping") {
        const start = Date.now();
        try {
          await axios.get(url, { timeout: 5000 });
          const latencyMs = Date.now() - start;
          if (latencyMs >= API_PING_SLOW_MS) {
            return { name, indicator: "minor", description: `API responsive but slow (${latencyMs} ms)` };
          }
          return { name, indicator: "none", description: `API responsive (${latencyMs} ms)` };
        } catch (err) {
          const detail = err.code === "ECONNABORTED" ? "API timeout" : "API unreachable";
          return { name, indicator: "major", description: detail };
        }
      }
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

/**
 * Detect the init manager that launched this process.
 * - systemd sets INVOCATION_ID on every unit
 * - launchd is the only service manager on macOS (darwin)
 * - null means the server was started manually (npm start)
 *
 * @returns {"systemd"|"launchd"|null}
 */
function getInitManager() {
  if (process.env.INVOCATION_ID) return "systemd";
  if (process.platform === "darwin") return "launchd";
  return null;
}

function getServerConfig() {
  return {
    allowRemote: process.env.ALLOW_REMOTE === "true",
    debug: process.env.DEBUG === "true",
    initManager: getInitManager(),
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

  // Last-resort hardware fallback for x86 Linux (VMware / Ubuntu desktop /
  // openSUSE etc. where /proc/device-tree/model doesn't exist and the
  // macOS branch above doesn't apply). os.cpus()[0].model is built-in,
  // works on every Node platform, and returns a meaningful identifier
  // ("Intel(R) Core(TM) i7-...") that's actually more useful than the
  // generic "Unknown" the panel used to show.
  if (hardware === "Unknown") {
    try {
      const cpu = os.cpus()?.[0]?.model;
      if (cpu) hardware = cpu;
    } catch { /* highly unusual platform — leave as Unknown */ }
  }

  // Sense HAT board revision (v1 / v2) from the HAT ID-EEPROM, or null when
  // no HAT is attached. Purely informational — handy for fleet inventory.
  const senseHat = detectSenseHatVersion();

  return { hardware, os: osName, hostname: os.hostname(), senseHat };
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

/**
 * Read the CPU temperature in degrees Celsius. Uses /sys/class/thermal,
 * which works on Pi (any model), Linux x86, and most embedded boards;
 * returns null on macOS and any platform that doesn't expose the file.
 * The thermal_zone0 file holds the temperature in millidegrees C — divide
 * by 1000 to get degrees.
 *
 * @returns {Number|null} Temperature in °C (rounded to one decimal), or null
 */
function getCpuTempC() {
  try {
    const raw = fs.readFileSync("/sys/class/thermal/thermal_zone0/temp", "utf8");
    const milliC = parseInt(raw.trim(), 10);
    if (!Number.isFinite(milliC)) return null;
    return Math.round(milliC / 100) / 10; // one decimal place
  } catch {
    return null;
  }
}

// Cached fan-input path. Resolved once on first call by walking
// /sys/class/hwmon/* for any fanN_input file. Pi 5 with the official
// Active Cooler exposes /sys/devices/platform/cooling_fan/hwmon/N/fan1_input,
// which symlinks back into /sys/class/hwmon — so the same scan covers Pi
// 4 with PWM overlays, Pi 5 cooler, and laptop x86 fans on Linux.
//   undefined → not yet resolved
//   null      → resolved, no fan available on this host
//   string    → absolute path to the input file
let fanInputPath;

/**
 * Find the first fan input file exposed under /sys/class/hwmon/. Returns
 * null when no fan sensor is present (macOS, Pis without active coolers,
 * x86 desktops without an exposed fan), or the absolute path otherwise.
 * Result cached at module scope — sysfs paths don't move at runtime.
 *
 * @returns {String|null}
 */
function findFanInputPath() {
  if (fanInputPath !== undefined) return fanInputPath;
  try {
    const hwmonDir = "/sys/class/hwmon";
    const entries = fs.readdirSync(hwmonDir);
    for (const entry of entries) {
      const dir = `${hwmonDir}/${entry}`;
      let files;
      try {
        files = fs.readdirSync(dir);
      } catch {
        continue;
      }
      const fan = files.find((f) => /^fan\d+_input$/.test(f));
      if (fan) {
        fanInputPath = `${dir}/${fan}`;
        return fanInputPath;
      }
    }
  } catch {
    // /sys/class/hwmon doesn't exist (macOS) or is unreadable
  }
  fanInputPath = null;
  return null;
}

/**
 * Read the cached fan-input file. Returns the raw RPM as an integer, or
 * null when no fan sensor is available on this host. 0 RPM is a valid
 * reading (CPU cool, fan stopped) — we only treat path absence as
 * "unavailable".
 *
 * @returns {Number|null}
 */
function getFanRpm() {
  const path = findFanInputPath();
  if (!path) return null;
  try {
    const raw = fs.readFileSync(path, "utf8");
    const rpm = parseInt(raw.trim(), 10);
    return Number.isFinite(rpm) ? rpm : null;
  } catch {
    return null;
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
 * GET /api/debug — returns cache state, recent logs, vulnerability scan URL, security events
 * Always restricted to localhost.
 *
 * @param {Object} req
 * @param {Object} res
 */
async function getDebugInfo(req, res) {
  const now = Date.now();

  const cache = [
    ...Object.entries(weatherCache).map(([key, entry]) => ({
      key,
      expiresIn: Math.max(0, Math.round((entry.expiresAt - now) / 1000)),
      expired: now > entry.expiresAt,
    })),
    ...Object.entries(summaryCache).map(([key, entry]) => ({
      key: `ai-summary:${key}`,
      expiresIn: Math.max(0, Math.round((entry.expiresAt - now) / 1000)),
      expired: now > entry.expiresAt,
    })),
  ];

  let logs = [];
  const LOG_PATHS = [
    // systemd via install.sh override.conf (2026-06+): persistent XDG
    // state dir — /tmp is a tmpfs on Trixie and lost the logs at reboot.
    path.join(os.homedir(), ".local/state/pi-weather-station/server.log"),
    "/tmp/weather-server.log",          // pre-2026-06 installs (until install.sh is re-run)
    path.join(__dirname, "../server.log"), // macOS launchd / manual redirect (npm start > server.log)
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

  // Vulnerability scan URL — points the user at the public list of pull
  // requests labelled "dependencies" on the GitHub repo (open + closed,
  // both security PRs and weekly version-update PRs). Public-facing on
  // purpose: the actual `/security/dependabot` alerts page is private to
  // maintainers, so a non-logged-in user (kiosk Chromium, anyone with a
  // shared screen) would hit a 404 + login prompt. The PRs view is the
  // best public proxy — it shows what Dependabot has actually opened and
  // merged, which is the live indicator of dependency-vuln management
  // since PR #22 retired the on-device `npm audit` snapshot. Built
  // per-fork from the same git remote that drives the in-app updater.
  const vulnerabilityScanUrl = `https://github.com/${getRepo()}/pulls?q=is%3Apr+label%3Adependencies`;

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
    cpuTempC: getCpuTempC(),
    fanRpm: getFanRpm(),
    radarCompression: require("./compressionStats").getStats(),
  };

  // Resolve hostnames for remote clients (cached, best-effort)
  const remoteClients = await Promise.all(
    getRemoteClients().map(async (c) => ({
      ...c,
      hostname: await resolveHostname(c.ip),
    }))
  );

  return res.status(200).json({ cache, logs, vulnerabilityScanUrl, securityEvents, services: getServiceStatus(), counters: getCounters(), system: getSystemInfo(), network: getNetworkInfo(), providerStatus, connectivity, appVersion: getAppVersion(), serverKpis, remoteClients, updateInfo, serverConfig: getServerConfig(), radarSnapshots: getRecentRadarSnapshots() });
}

/**
 * Lightweight CPU-temperature endpoint, polled every few seconds by the
 * client debug panel for live updates. Reads a single sysfs file — no
 * caching needed on the server side.
 *
 * @param {Object} req
 * @param {Object} res
 */
function getCpuTemp(req, res) {
  return res.status(200).json({ cpuTempC: getCpuTempC() });
}

/**
 * Lightweight fan-speed endpoint, polled at the same cadence as cpu-temp.
 * Returns `{ available: false }` when no fan sensor is exposed on the host
 * — the client uses that flag to hide the row entirely (same UX pattern as
 * the brightness slider). When available, `rpm` is the raw integer (0 is a
 * valid reading: CPU cool, fan stopped).
 *
 * @param {Object} req
 * @param {Object} res
 */
function getFanSpeed(req, res) {
  const path = findFanInputPath();
  if (!path) return res.status(200).json({ available: false });
  return res.status(200).json({ available: true, rpm: getFanRpm() });
}

// `fetchProviderStatus` is also imported by `healthCtrl` so the dock
// popover can surface GitHub's `Git Operations` indicator alongside
// the local serviceStatus issues — the only upstream we don't have a
// `recordServiceCall` for (we never hit GitHub from runtime — the
// updater's `git pull` is a one-shot child process).
module.exports = { getDebugInfo, getCpuTemp, getFanSpeed, logSecurityEvent, initServerInfo, fetchProviderStatus };
