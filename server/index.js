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
const { execSync } = require("child_process");
const ver = require("../package.json").version;
const appName = require("../package.json").name;

const settingsCtrl = require("./settingsCtrl");
const geolocationCtrl = require("./geolocationCtrl");
const proxyCtrl = require("./proxyCtrl");
const debugCtrl = require("./debugCtrl");
const aiSummaryCtrl = require("./aiSummaryCtrl");

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

const DIST_DIR = "/../client/dist";
const PORT = 8080;
const HTTPS_PORT = 8443;
const HOST = process.env.ALLOW_REMOTE === "true" ? "0.0.0.0" : "127.0.0.1";
const REMOTE_SECURITY = process.env.REMOTE_SECURITY === "true";
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

const isLocalhostIp = (ip) => ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";

app.use((req, res, next) => {
  const ip = req.socket.remoteAddress;
  if (!isLocalhostIp(ip)) recordClient(ip);
  next();
});

const localhostOnly = (req, res, next) => {
  const ip = req.socket.remoteAddress;
  if (!isLocalhostIp(ip)) {
    logSecurityEvent(ip, req.method, req.originalUrl);
    return res.status(403).json("Settings can only be modified from the Pi itself.").end();
  }
  next();
};

const debugLocalhostOnly = (req, res, next) => {
  const ip = req.socket.remoteAddress;
  if (!isLocalhostIp(ip)) {
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
app.post("/settings", ...(REMOTE_SECURITY ? [localhostOnly] : []), createSettingsFile);
app.put("/settings", ...(REMOTE_SECURITY ? [localhostOnly] : []), replaceSettings);
app.patch("/setting", ...(REMOTE_SECURITY ? [localhostOnly] : []), setSetting);
app.delete("/setting", ...(REMOTE_SECURITY ? [localhostOnly] : []), deleteSetting);

app.get("/geolocation", getCoords);

app.get("/api/is-local", (req, res) => {
  const ip = req.socket.remoteAddress;
  const isLocal = isLocalhostIp(ip);
  return res.status(200).json({ isLocal, securityEnabled: REMOTE_SECURITY, debugEnabled: DEBUG });
});

app.get("/api/reverse-geocode", proxyReverseGeocode);
app.get("/api/tiles/:style/:z/:x/:y", mapTile);

app.get("/api/weather/current", weatherCurrent);
app.get("/api/weather/hourly", weatherHourly);
app.get("/api/weather/daily", weatherDaily);
app.get("/api/sunrise-sunset", sunriseSunset);

app.get("/api/weather-summary", getWeatherSummary);

app.get("/api/debug", debugLocalhostOnly, getDebugInfo);

function shutdown() {
  saveCacheToDisk();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT",  shutdown);
