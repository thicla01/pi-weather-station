const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const open = require("open");
const https = require("https");
const fs = require("fs");
const { execSync } = require("child_process");
const ver = require("../package.json").version;
const appName = require("../package.json").name;

const settingsCtrl = require("./settingsCtrl");
const geolocationCtrl = require("./geolocationCtrl");
const proxyCtrl = require("./proxyCtrl");

const {
  getSettings,
  setSetting,
  deleteSetting,
  createSettingsFile,
  replaceSettings,
} = settingsCtrl;
const { getCoords } = geolocationCtrl;
const { reverseGeocode: proxyReverseGeocode, mapTile } = proxyCtrl;

const DIST_DIR = "/../client/dist";
const PORT = 8080;
const HTTPS_PORT = 8443;
const HOST = process.env.ALLOW_REMOTE === "true" ? "0.0.0.0" : "127.0.0.1";
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

const localhostOnly = (req, res, next) => {
  const ip = req.socket.remoteAddress;
  const isLocalhost = ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
  if (!isLocalhost) {
    return res.status(403).json("Settings can only be modified from the Pi itself.").end();
  }
  next();
};

if (sslOptions) {
  https.createServer(sslOptions, app).listen(HTTPS_PORT, HOST, async () => {
    await open(`https://localhost:${HTTPS_PORT}`);
    console.log(`${appName} v${ver} has started on port ${HTTPS_PORT} (HTTPS, bound to ${HOST})`);
  });
} else {
  app.listen(PORT, HOST, async () => {
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
  const ip = req.socket.remoteAddress;
  const isLocal = ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
  return res.status(200).json({ isLocal });
});

app.get("/api/reverse-geocode", proxyReverseGeocode);
app.get("/api/tiles/:style/:z/:x/:y", mapTile);
