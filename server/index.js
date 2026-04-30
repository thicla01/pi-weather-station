// Force IPv4-first DNS resolution for all outbound HTTP from this process.
// Some networks advertise AAAA records but cannot actually route IPv6
// (common with consumer routers); Node before v23 doesn't run Happy Eyeballs
// by default, so axios calls to dual-stacked services like ipapi.co
// (Cloudflare) try the IPv6 address first and fail with "Network is
// unreachable" before falling back to IPv4. Forcing IPv4-first sidesteps
// the issue entirely with no measurable cost on networks where IPv6 works.
require("dns").setDefaultResultOrder("ipv4first");

// Prefix all console output with an ISO timestamp for log readability.
//
// When the first argument is a string we PREPEND the timestamp into it
// rather than passing the timestamp as a separate argument. Otherwise
// Node's console.log treats the timestamp as the format string,
// `%s/%d/%j` placeholders in subsequent arguments are never substituted,
// and the printf-style format strings printed unsubstituted in the log.
const _origLog = console.log.bind(console);
const _origErr = console.error.bind(console);
const _ts = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
};
const _withTimestamp = (orig) => (first, ...rest) => {
  if (typeof first === "string") {
    orig(`[${_ts()}] ${first}`, ...rest);
  } else {
    orig(`[${_ts()}]`, ...(first === undefined ? [] : [first]), ...rest);
  }
};
console.log   = _withTimestamp(_origLog);
console.error = _withTimestamp(_origErr);

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
const { getBrightness, setBrightness } = require("./brightnessCtrl");
const aiSummaryCtrl = require("./aiSummaryCtrl");
const { getSenseHatData } = require("./sensehatCtrl");
const { initIndoorTemperature, getIndoorTemperature } = require("./indoorTempCtrl");

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
const { getDebugInfo, getCpuTemp, logSecurityEvent, initServerInfo } = debugCtrl;
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

// Open the URL in the default browser only in interactive dev mode (npm
// start in a terminal). In a kiosk service environment, this would launch
// a non-kiosk Chromium that wins the race against start-server's
// `chromium --kiosk ...` invocation (Chromium is single-instance and the
// second call's flags are ignored). TTY presence is the cleanest signal:
// dev shells have one, systemd/launchd services don't.
const openInBrowserIfDev = async (url) => {
  if (!process.stdout.isTTY) return;
  try {
    const { default: open } = await import("open");
    await open(url);
  } catch (err) {
    console.error("Failed to open browser:", err.message);
  }
};

if (sslOptions) {
  https.createServer(sslOptions, app).listen(HTTPS_PORT, HOST, async () => {
    initServerInfo(HTTPS_PORT, "https");
    initIndoorTemperature();
    await openInBrowserIfDev(`https://localhost:${HTTPS_PORT}`);
    console.log(`${appName} v${ver} has started on port ${HTTPS_PORT} (HTTPS, bound to ${HOST})`);
  });
} else {
  app.listen(PORT, HOST, async () => {
    initServerInfo(PORT, "http");
    initIndoorTemperature();
    await openInBrowserIfDev(`http://localhost:${PORT}`);
    console.log(`${appName} v${ver} has started on port ${PORT} (HTTP, bound to ${HOST})`);
  });
}

app.get("/settings", getSettings);
// All settings writes are localhostOnly — including for advanced.ai.* keys
// which look benign (booleans, no secrets). Two reasons, both worth keeping:
//   1. Security boundary: a single, clear rule ("no writes from remote ever")
//      is easier to reason about and audit than per-key exceptions.
//   2. Cost control: advanced.ai.* gates a paid feature (Anthropic API tokens
//      consumed by the AI summary). Even small toggles change prompt size or
//      enable analyses that bill against the Pi owner's API key. Only the
//      device owner — physically at the Pi or via SSH tunnel — should be
//      able to dial those up.
// If you're tempted to relax this for "harmless preferences", remember the
// AdvancedSettings UI already shows the section read-only on remote with a
// notice pointing the user to the SSH-tunnel workflow.
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
app.get("/api/sensehat",            apiLimiter, getSenseHatData);
app.get("/api/indoor-temperature",  apiLimiter, getIndoorTemperature);

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

  // ── Pre-flight checks ──
  // git pull --ff-only fails with cryptic messages when:
  //   1. The working copy is in detached HEAD (no branch to pull)
  //   2. The working copy is on a non-master branch (testing leftovers)
  //   3. There are uncommitted local changes that would be overwritten
  // Each of these silently surfaces as a generic "Failed" in the modal.
  // Detect them up front and return a structured 409 with a clear, actionable
  // message instead.
  const failPrecondition = (reason, message, extra = {}) =>
    res.status(409).json({ error: true, reason, message, ...extra });

  exec("git symbolic-ref --short HEAD", { cwd: projectRoot, timeout: 5_000 }, (symbolicErr, symbolicStdout) => {
    if (symbolicErr) {
      // symbolic-ref fails on detached HEAD with exit code 1
      console.error("[update] precheck: detached HEAD");
      return failPrecondition(
        "detached-head",
        "Repository is in detached HEAD state. Run `git checkout master` on the device, then retry."
      );
    }
    const currentBranch = symbolicStdout.trim();
    if (currentBranch !== "master") {
      console.error("[update] precheck: not on master, on '%s'", currentBranch);
      return failPrecondition(
        "wrong-branch",
        `On branch '${currentBranch}' instead of 'master'. Run \`git checkout master\` on the device, then retry.`,
        { currentBranch }
      );
    }

    // --untracked-files=no skips files with `??` prefix (not in git's index).
    // Untracked files cannot conflict with `git pull --ff-only` — they live
    // outside git's view entirely. Without this flag, harmless backups like
    // settings.json.bak would block the in-app updater.
    exec("git status --porcelain --untracked-files=no", { cwd: projectRoot, timeout: 5_000 }, (statusErr, statusStdout) => {
      if (statusErr) {
        console.error("[update] precheck: git status failed:", statusErr.message);
        return failPrecondition(
          "git-status-failed",
          `git status failed: ${statusErr.message}`
        );
      }
      if (statusStdout.trim()) {
        const dirtyFiles = statusStdout.trim().split("\n").map((l) => l.trim()).slice(0, 5);
        console.error("[update] precheck: local changes detected:", dirtyFiles);
        return failPrecondition(
          "local-changes",
          `Local uncommitted changes would be overwritten by the update. Run \`git stash\` on the device, then retry.`,
          { dirtyFiles }
        );
      }

      // ── All pre-flight checks passed — proceed with the actual update ──
      console.log("[update] Starting git pull…");
      exec("git pull --ff-only", { cwd: projectRoot, timeout: 30_000 }, (pullErr, pullStdout, pullStderr) => {
        if (pullErr) {
          console.error("[update] git pull failed:", pullStderr);
          return res.status(500).json({
            error: true,
            reason: "pull-failed",
            message: `git pull failed: ${pullStderr || pullErr.message}`,
          });
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
                reason: "npm-install-failed",
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
  });
});

app.get("/api/debug", debugLocalhostOnly, getDebugInfo);
app.get("/api/debug/cpu-temp", debugLocalhostOnly, getCpuTemp);

// Display brightness — read open to anyone (for the client to know whether
// to render the slider), write localhost-only (the brightness physically
// affects the device's screen, makes no sense for a remote client to dim
// what they aren't looking at).
app.get("/api/brightness", getBrightness);
app.post("/api/brightness", localhostOnly, setBrightness);

function shutdown() {
  saveCacheToDisk();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT",  shutdown);
