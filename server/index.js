// Prefix all console output with an ISO timestamp for log readability
const _origLog = console.log.bind(console);
const _origErr = console.error.bind(console);
const _ts = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
};
console.log   = (...args) => _origLog(`[${_ts()}]`, ...args);
console.error = (...args) => _origErr(`[${_ts()}]`, ...args);

const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const https = require("https");
const fs = require("fs");
const { execSync, exec } = require("child_process");
const ver = require("../package.json").version;
const appName = require("../package.json").name;

const settingsCtrl = require("./settingsCtrl");
const geolocationCtrl = require("./geolocationCtrl");
const proxyCtrl = require("./proxyCtrl");
const debugCtrl = require("./debugCtrl");
const aiSummaryCtrl = require("./aiSummaryCtrl");
const { getSenseHatData } = require("./sensehatCtrl");

const {
  getSettings,
  setSetting,
  deleteSetting,
  createSettingsFile,
  replaceSettings,
} = settingsCtrl;
const { getCoords } = geolocationCtrl;
const { reverseGeocode: proxyReverseGeocode, mapTile, weatherCurrent, weatherHourly, weatherDaily, sunriseSunset, saveCacheToDisk } = proxyCtrl;
const { responseTimerMiddleware } = require("./responseTimer");
const { recordClient } = require("./clientTracker");
const { getDebugInfo, logSecurityEvent, initServerInfo } = debugCtrl;
const { getWeatherSummary } = aiSummaryCtrl;
const { checkForUpdate, clearCache: clearUpdateCache } = require("./updateChecker");
const rateLimit = require("express-rate-limit");

const DIST_DIR = "/../client/dist";
const PORT = 8080;
const HTTPS_PORT = 8443;
const ALLOW_REMOTE = process.env.ALLOW_REMOTE === "true";
const HOST = ALLOW_REMOTE ? "0.0.0.0" : "127.0.0.1";
const DEBUG = process.env.DEBUG === "true";
const app = express();

const sslOptions = (() => {
  const keyPath = path.join(__dirname, "key.pem");
  const certPath = path.join(__dirname, "cert.pem");

  const certExpiresSoon = () => {
    try {
      const output = execSync(`openssl x509 -enddate -noout -in "${certPath}"`, { stdio: "pipe" }).toString();
      const match = output.match(/notAfter=(.*)/);
      if (!match) return true;
      const expiry = new Date(match[1]);
      const daysLeft = (expiry - Date.now()) / (1000 * 60 * 60 * 24);
      return daysLeft < 30;
    } catch {
      return true;
    }
  };

  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath) || certExpiresSoon()) {
    console.log("SSL certificates not found, generating self-signed certificates...");
    try {
      execSync(
        `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 825 -nodes` +
        ` -subj "/CN=localhost"` +
        ` -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"`,
        { stdio: "pipe" }
      );
      fs.chmodSync(keyPath, 0o600);
      console.log("SSL certificates generated successfully.");
    } catch (err) {
      console.error("Failed to generate SSL certificates:", err.message);
      return null;
    }
  }

  try {
    return {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
    };
  } catch {
    return null;
  }
})();

// ***** dev only:
// const livereload = require("livereload");
// const connectLivereload = require("connect-livereload");
// const liveReloadServer = livereload.createServer();
// liveReloadServer.watch(path.join(`${__dirname}/${DIST_DIR}`));
// liveReloadServer.server.once("connection", () => {
//   setTimeout(() => {
//     liveReloadServer.refresh("/");
//   }, 100);
// });
// app.use(connectLivereload());
// *****

app.use(bodyParser.json());
app.use(express.static(path.join(`${__dirname}/${DIST_DIR}`)));
app.use(responseTimerMiddleware);

// When remote access is enabled, trust the first proxy hop so req.ip
// reflects the real client IP from X-Forwarded-For rather than the
// proxy's socket address. Disabled for local-only mode to prevent
// header spoofing on direct connections.
if (ALLOW_REMOTE) app.set("trust proxy", 1);

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many requests",
});

const tileLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many requests",
});

const isLocalhostIp = (ip) => ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";

// req.ip respects trust proxy: when ALLOW_REMOTE is true it reads
// X-Forwarded-For (set by the proxy), otherwise it falls back to socket IP.
app.use((req, res, next) => {
  req.isLocal = isLocalhostIp(req.ip);
  if (!req.isLocal) recordClient(req.ip);
  next();
});

const localhostOnly = (req, res, next) => {
  if (!isLocalhostIp(req.ip)) {
    logSecurityEvent(req.ip, req.method, req.originalUrl);
    return res.status(403).json("Settings can only be modified from the Pi itself.").end();
  }
  next();
};

const debugLocalhostOnly = (req, res, next) => {
  if (!isLocalhostIp(req.ip)) {
    return res.status(403).json("Debug endpoint is only accessible from the Pi itself.").end();
  }
  next();
};

if (sslOptions) {
  https.createServer(sslOptions, app).listen(HTTPS_PORT, HOST, async () => {
    initServerInfo(HTTPS_PORT, "https");
    const { default: open } = await import("open");
    await open(`https://localhost:${HTTPS_PORT}`);
    console.log(`${appName} v${ver} has started on port ${HTTPS_PORT} (HTTPS, bound to ${HOST})`);
  });
} else {
  app.listen(PORT, HOST, async () => {
    initServerInfo(PORT, "http");
    const { default: open } = await import("open");
    await open(`http://localhost:${PORT}`);
    console.log(`${appName} v${ver} has started on port ${PORT} (HTTP, bound to ${HOST})`);
  });
}

app.get("/settings", getSettings);
app.post("/settings", localhostOnly, createSettingsFile);
app.put("/settings", localhostOnly, replaceSettings);
app.patch("/setting", localhostOnly, setSetting);
app.delete("/setting", localhostOnly, deleteSetting);

app.get("/geolocation", getCoords);

app.get("/api/is-local", (req, res) => {
  const { isLocal } = req;
  const response = { isLocal, securityEnabled: true };
  if (isLocal) response.debugEnabled = DEBUG;
  return res.status(200).json(response);
});

app.get("/api/reverse-geocode", apiLimiter, proxyReverseGeocode);
app.get("/api/tiles/:style/:z/:x/:y", tileLimiter, mapTile);

app.get("/api/weather/current", apiLimiter, weatherCurrent);
app.get("/api/weather/hourly", apiLimiter, weatherHourly);
app.get("/api/weather/daily", apiLimiter, weatherDaily);
app.get("/api/sunrise-sunset", apiLimiter, sunriseSunset);

app.get("/api/weather-summary", apiLimiter, getWeatherSummary);
app.get("/api/sensehat",        apiLimiter, getSenseHatData);

app.get("/api/update-check", apiLimiter, async (req, res) => {
  try {
    const result = await checkForUpdate();
    res.json({
      ...result,
      platform: process.platform,
      isSystemd: !!process.env.INVOCATION_ID,
    });
  } catch {
    res.status(500).json({ error: true });
  }
});

app.all("/api/update-check/force", localhostOnly, async (req, res) => {
  clearUpdateCache();
  try {
    const result = await checkForUpdate();
    res.json({
      ...result,
      platform: process.platform,
      isSystemd: !!process.env.INVOCATION_ID,
    });
  } catch {
    res.status(500).json({ error: true });
  }
});

app.post("/api/update", localhostOnly, (req, res) => {
  const projectRoot = path.join(__dirname, "..");
  console.log("[update] Starting git pull…");

  exec("git pull --ff-only", { cwd: projectRoot, timeout: 30_000 }, (pullErr, pullStdout, pullStderr) => {
    if (pullErr) {
      console.error("[update] git pull failed:", pullStderr);
      return res.status(500).json({ error: true, message: pullStderr });
    }
    console.log("[update] git pull succeeded:", pullStdout.trim());

    // Always run `npm install` after the pull. It's idempotent (a few
    // seconds when nothing changed), and it prevents the
    // "Cannot find module 'X'" trap when an update introduces a new
    // dependency — without this step, the post-restart server would
    // crash-loop on the missing module.
    console.log("[update] Running npm install (--omit=dev)…");
    exec(
      "npm install --omit=dev --no-audit --no-fund",
      { cwd: projectRoot, timeout: 180_000 },
      (npmErr, npmStdout, npmStderr) => {
        if (npmErr) {
          console.error("[update] npm install failed:", npmStderr);
          return res.status(500).json({
            error: true,
            message: `npm install failed: ${npmStderr || npmErr.message}`,
          });
        }
        console.log("[update] npm install succeeded.");
        res.json({ ok: true, isSystemd: !!process.env.INVOCATION_ID });

        setTimeout(() => {
          if (process.env.INVOCATION_ID) {
            exec("systemctl --user restart pi-weather-server", (restartErr) => {
              if (restartErr) {
                console.error("[update] systemctl restart failed, falling back to process.exit:", restartErr.message);
                process.exit(0);
              }
            });
          } else {
            // No systemd (dev / macOS) — exit and let the developer restart manually.
            process.exit(0);
          }
        }, 500);
      }
    );
  });
});

app.get("/api/debug", debugLocalhostOnly, getDebugInfo);

function shutdown() {
  saveCacheToDisk();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT",  shutdown);
