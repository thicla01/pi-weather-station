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
const os = require("os");
const { execSync, exec } = require("child_process");
const ver = require("../package.json").version;
const appName = require("../package.json").name;

const settingsCtrl = require("./settingsCtrl");
const { flush: flushRequestCounts } = require("./requestCounter");
const geolocationCtrl = require("./geolocationCtrl");
const proxyCtrl = require("./proxyCtrl");
const debugCtrl = require("./debugCtrl");
const { getBrightness, setBrightness } = require("./brightnessCtrl");
const aiSummaryCtrl = require("./aiSummaryCtrl");
const { getSenseHatData } = require("./sensehatCtrl");
const { postKioskLocation } = require("./kioskLocationCtrl");
const {
  getSenseHatAvailable,
  getSenseHatMode,
  setSenseHatMode,
  getClockBrightness,
  setClockBrightness,
  getRadarBrightness,
  setRadarBrightness,
  applySenseHatModeOnBoot,
} = require("./sensehatModeCtrl");
const { initIndoorTemperature, getIndoorTemperature } = require("./indoorTempCtrl");
const { registerService } = require("./serviceStatus");

/**
 * Pre-register every external service we expect to call so they all show
 * up in the Debug panel's "Services" inventory from the first paint, even
 * before the user has triggered an action that hits them. Without this,
 * an absent row in the panel was ambiguous: "is the service broken or
 * just unused?". Now an unused service appears with status null + comment
 * "Not yet called", and a real call overwrites it with the live result.
 *
 * Names must match exactly the strings passed to recordServiceCall().
 */
function registerKnownServices() {
  [
    "Tomorrow.io (current)",
    "Tomorrow.io (hourly)",
    "Tomorrow.io (daily)",
    "Mapbox",
    "LocationIQ",
    "ipapi.co",
    "sunrise-sunset.org",
    "RainViewer (analyzer)",
    "RainViewer (risk)",
    "Claude (AI summary)",
    "Homebridge",
    "Environment Canada (AQHI)",
    "MELCC RSQAQ (Quebec)",
    "MELCC RSQA (Montreal)",
    "EPA AirNow",
    "OpenAQ",
    "NWS (severe weather alerts)",
    "Environment Canada (severe weather alerts)",
    "Open-Meteo (pollen)",
  ].forEach(registerService);
}

const {
  getSettings,
  setSetting,
  deleteSetting,
  createSettingsFile,
  replaceSettings,
  ensureSecurePermissions,
} = settingsCtrl;

// Tighten settings.json to 0600 at startup — the file holds the API keys +
// Homebridge credentials and must not be world-readable. Runs once on every
// service start, so an existing fleet install created 0644 (before this
// guard) self-tightens on the next restart. No-op if the file doesn't exist
// yet (createSettingsFile writes it 0600). Mirrors the TLS-key chmod below.
ensureSecurePermissions();
const { getCoords } = geolocationCtrl;
const { reverseGeocode: proxyReverseGeocode, mapTile, weatherCurrent, weatherHourly, weatherDaily, sunriseSunset, saveCacheToDisk } = proxyCtrl;
const { responseTimerMiddleware } = require("./responseTimer");
const { recordClient } = require("./clientTracker");
const { getDebugInfo, getCpuTemp, getFanSpeed, logSecurityEvent, initServerInfo } = debugCtrl;
const { getWeatherSummary } = aiSummaryCtrl;
const { checkForUpdate, clearCache: clearUpdateCache } = require("./updateChecker");
const rateLimit = require("express-rate-limit");
const { socketPeerKeyGenerator } = require("./rateLimitKey");
const { securityHeaders } = require("./securityHeaders");

const DIST_DIR = "/../client/dist";
const PORT = 8080;
const HTTPS_PORT = 8443;
const ALLOW_REMOTE = process.env.ALLOW_REMOTE === "true";
const HOST = ALLOW_REMOTE ? "0.0.0.0" : "127.0.0.1";
const DEBUG = process.env.DEBUG === "true";
// When true, the server uses cert.pem / key.pem / ca-cert.pem as-is and
// never auto-generates anything — for users who supply their own cert
// (Let's Encrypt, internal CA, mkcert). If cert.pem or key.pem is
// missing, boot fails loudly rather than silently falling back to a
// self-signed chain. See docs/ssl-custom-cert_{en,fr}.md.
const SKIP_CERT_AUTOGEN = process.env.SKIP_CERT_AUTOGEN === "true";
const app = express();

// Don't advertise the framework (X-Powered-By: Express), and stamp the
// baseline security headers on every response. Mounted first so they cover
// static files, the API, and error responses alike.
app.disable("x-powered-by");
app.use(securityHeaders);

const sslOptions = (() => {
  const keyPath = path.join(__dirname, "key.pem");
  const certPath = path.join(__dirname, "cert.pem");
  const caKeyPath = path.join(__dirname, "ca-key.pem");
  const caCertPath = path.join(__dirname, "ca-cert.pem");

  // Sanitised hostname — used in both the SAN and the Subject CN.
  // Restricted to a hostname-safe whitelist (letters, digits, hyphen,
  // dot) so a hostname with shell metacharacters can't break the
  // openssl invocation, and so it renders cleanly in the iOS profile-
  // install dialog without escape sequences.
  const safeHostname = (() => {
    try {
      const h = os.hostname() || "";
      const clean = h.replace(/[^a-zA-Z0-9.\-]/g, "");
      return clean === "localhost" ? "" : clean;
    } catch { return ""; }
  })();

  // Cert Subject Common Name shown by iOS / macOS / Android when the
  // user inspects the profile before trusting it. v2.16.1: switched
  // from the bare `localhost` default (which read as confusing on a
  // user's iPhone — "trust localhost?") to "Pi Weather Station -
  // <hostname>" so each Pi in a multi-Pi household shows up
  // distinguishably. Falls back to the static label if hostname
  // collection fails.
  const targetCN = safeHostname
    ? `Pi Weather Station - ${safeHostname}`
    : "Pi Weather Station";
  const caTargetCN = safeHostname
    ? `Pi Weather Station CA - ${safeHostname}`
    : "Pi Weather Station CA";

  // Collect all non-loopback, non-internal IPv4 LAN addresses + the
  // device hostname so the cert's SubjectAltName covers every way
  // the user might reach this Pi. Without this, accessing the Pi by
  // its LAN IP (e.g. https://192.168.6.25:8443) flagged a hostname
  // mismatch even when the cert was trusted at the OS level — which
  // made the iOS PWA add-to-home-screen flow fail to fetch the
  // apple-touch-icon in the background (user-reported v2.15.21).
  const collectSanEntries = () => {
    const entries = ["DNS:localhost", "IP:127.0.0.1"];
    try {
      const ifaces = os.networkInterfaces();
      for (const name of Object.keys(ifaces)) {
        for (const addr of ifaces[name] || []) {
          if (addr.family === "IPv4" && !addr.internal) {
            entries.push(`IP:${addr.address}`);
          }
        }
      }
    } catch { /* fall back to loopback-only */ }
    if (safeHostname) {
      // Add the hostname as reported by `os.hostname()` and the
      // opposite-of-`.local` variant, so users can reach the Pi by
      // either `<name>` or `<name>.local` (avahi / Bonjour mDNS)
      // without hitting a hostname-mismatch warning.
      entries.push(`DNS:${safeHostname}`);
      if (safeHostname.endsWith(".local")) {
        const bare = safeHostname.slice(0, -".local".length);
        if (bare) entries.push(`DNS:${bare}`);
      } else {
        entries.push(`DNS:${safeHostname}.local`);
      }
    }
    // Deduplicate (interfaces with multiple IPv4s, e.g. eth0 + wlan0,
    // can produce duplicate addresses in some configs).
    return [...new Set(entries)];
  };

  // Does the existing cert's Subject CN match what we'd generate now?
  // If not, regenerate so the iOS profile dialog shows the friendly
  // "Pi Weather Station - <hostname>" name. openssl prints the
  // subject as either `subject= /CN=value` (LibreSSL) or
  // `subject=CN = value` (OpenSSL 3+) — match both.
  const certHasTargetCN = () => {
    try {
      const output = execSync(
        `openssl x509 -in "${certPath}" -noout -subject 2>/dev/null`,
        { stdio: ["pipe", "pipe", "pipe"] }
      ).toString();
      return output.includes(`CN=${targetCN}`) || output.includes(`CN = ${targetCN}`);
    } catch {
      return false;
    }
  };

  // Read the SAN from an existing cert so we can decide whether it
  // needs regeneration when the network configuration has changed
  // since the cert was issued (e.g. the Pi got a new DHCP lease or
  // a second interface came online).
  const certCoversCurrentHosts = () => {
    try {
      const output = execSync(
        `openssl x509 -in "${certPath}" -noout -ext subjectAltName 2>/dev/null`,
        { stdio: ["pipe", "pipe", "pipe"] }
      ).toString();
      const wanted = collectSanEntries();
      // The openssl output for the SAN extension uses spaces and the
      // word "IP Address" rather than "IP:" — normalise both sides
      // so we can do a substring check.
      const normalised = output.replace(/IP Address/g, "IP").replace(/\s+/g, "");
      return wanted.every((entry) => normalised.includes(entry.replace(/\s+/g, "")));
    } catch {
      return false;
    }
  };

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

  // Same checks for the CA. Re-issued only when hostname changes
  // (CN mismatch) or it's missing — its long 10-year validity makes
  // expiry-driven regen practically a non-issue. Cert SAN coverage
  // doesn't apply to the CA (no SAN on a CA root).
  const caHasTargetCN = () => {
    try {
      const output = execSync(
        `openssl x509 -in "${caCertPath}" -noout -subject 2>/dev/null`,
        { stdio: ["pipe", "pipe", "pipe"] }
      ).toString();
      return output.includes(`CN=${caTargetCN}`) || output.includes(`CN = ${caTargetCN}`);
    } catch {
      return false;
    }
  };

  // Detect old-format certs (single self-signed file with CA:TRUE,
  // pre-CA-chain refactor). When present, force regen so we move
  // to the proper two-cert chain.
  const certIsOldSelfSignedRoot = () => {
    try {
      // Old format: leaf and CA were the same file. Detect via
      // basicConstraints=CA:TRUE on the file at certPath.
      const output = execSync(
        `openssl x509 -in "${certPath}" -noout -ext basicConstraints 2>/dev/null`,
        { stdio: ["pipe", "pipe", "pipe"] }
      ).toString();
      // Detect when the LEAF still claims CA:TRUE — that's the old
      // self-signed-root-as-server pattern Firefox 150 rejects with
      // MOZILLA_PKIX_ERROR_CA_CERT_USED_AS_END_ENTITY.
      return /CA:\s*TRUE/i.test(output);
    } catch {
      return false;
    }
  };

  // Bring-your-own-cert short-circuit: skip every auto-regen check
  // (and every openssl invocation that backs them) and use the files
  // on disk as-is. Missing cert/key here is a hard failure — the user
  // has explicitly opted out of the fallback by setting the env var.
  if (SKIP_CERT_AUTOGEN) {
    console.log("SKIP_CERT_AUTOGEN=true — using existing certificate files as-is, no auto-regeneration");
    if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
      const missing = !fs.existsSync(certPath) ? "cert.pem" : "key.pem";
      console.error(`SKIP_CERT_AUTOGEN=true but server/${missing} is missing — refusing to fall back to auto-generation. Provide your own certificate or unset SKIP_CERT_AUTOGEN.`);
      return null;
    }
    try {
      // ca-cert.pem is optional in BYO-cert mode: many users already
      // have the chain concatenated in cert.pem (e.g. Let's Encrypt's
      // fullchain.pem). Concatenate the CA only if a separate file is
      // present.
      const certBuf = fs.readFileSync(certPath);
      const chain = fs.existsSync(caCertPath)
        ? Buffer.concat([certBuf, Buffer.from("\n"), fs.readFileSync(caCertPath)])
        : certBuf;
      return { key: fs.readFileSync(keyPath), cert: chain };
    } catch (err) {
      console.error("SKIP_CERT_AUTOGEN=true but failed to read certificate files:", err.message);
      return null;
    }
  }

  const caNeedsRegen =
    !fs.existsSync(caKeyPath) ||
    !fs.existsSync(caCertPath) ||
    !caHasTargetCN();

  const leafNeedsRegen =
    !fs.existsSync(keyPath) ||
    !fs.existsSync(certPath) ||
    certExpiresSoon() ||
    !certCoversCurrentHosts() ||
    !certHasTargetCN() ||
    certIsOldSelfSignedRoot() ||
    caNeedsRegen; // re-sign the leaf if we just regenerated the CA

  if (caNeedsRegen) {
    console.log("Generating self-signed root CA...");
    try {
      execSync(
        // Root CA — 10-year validity so the user trusts it once
        // and re-trust is rare. `keyCertSign + cRLSign` are the
        // standard CA usages; no `digitalSignature` here because
        // the CA never serves traffic itself.
        `openssl req -x509 -newkey rsa:2048 -keyout "${caKeyPath}" -out "${caCertPath}" -days 3650 -nodes` +
        ` -subj "/CN=${caTargetCN}"` +
        ` -addext "basicConstraints=critical,CA:TRUE"` +
        ` -addext "keyUsage=critical,keyCertSign,cRLSign"`,
        { stdio: "pipe" }
      );
      fs.chmodSync(caKeyPath, 0o600);
      console.log(`Root CA generated: CN="${caTargetCN}"`);
    } catch (err) {
      console.error("Failed to generate root CA:", err.message);
      return null;
    }
  }

  if (leafNeedsRegen) {
    console.log("Generating leaf server certificate signed by the CA...");
    try {
      const san = collectSanEntries().join(",");
      const csrPath = path.join(__dirname, "leaf.csr");
      const extPath = path.join(__dirname, "leaf-ext.conf");
      const srlPath = path.join(__dirname, "ca-cert.srl");
      // Write the leaf-specific extensions to a temp file. openssl
      // `x509 -req -CA ...` doesn't pick up addext from the CSR, so
      // we pass extensions via -extfile. `serverAuth` in the EKU is
      // what tells Firefox 150 + Chrome that the leaf is a server
      // cert (and only a server cert — explicitly NOT a CA).
      fs.writeFileSync(extPath,
        `subjectAltName=${san}\n`
        + "basicConstraints=critical,CA:FALSE\n"
        + "keyUsage=critical,digitalSignature,keyEncipherment\n"
        + "extendedKeyUsage=serverAuth\n");
      // 1) Generate leaf key + CSR (Subject CN only; SAN comes via extfile).
      execSync(
        `openssl req -new -newkey rsa:2048 -keyout "${keyPath}" -out "${csrPath}" -nodes` +
        ` -subj "/CN=${targetCN}"`,
        { stdio: "pipe" }
      );
      // 2) Sign the CSR with the root CA.
      execSync(
        `openssl x509 -req -in "${csrPath}" -CA "${caCertPath}" -CAkey "${caKeyPath}" -CAcreateserial` +
        ` -out "${certPath}" -days 825 -sha256` +
        ` -extfile "${extPath}"`,
        { stdio: "pipe" }
      );
      fs.chmodSync(keyPath, 0o600);
      // Clean up scratch files (CSR + ext config). The .srl serial
      // file is kept — openssl needs a stable counter to issue
      // future leaf certs without colliding serials.
      try { fs.unlinkSync(csrPath); } catch { /* ignore */ }
      try { fs.unlinkSync(extPath); } catch { /* ignore */ }
      // Reassure that the serial file landed where expected — not
      // strictly required for the boot path but useful for debugging.
      if (!fs.existsSync(srlPath)) {
        console.warn(`Expected CA serial file at ${srlPath} after signing`);
      }
      console.log(`Leaf cert signed by CA: CN="${targetCN}", SAN=${san}`);
    } catch (err) {
      console.error("Failed to generate leaf certificate:", err.message);
      return null;
    }
  }

  try {
    return {
      key: fs.readFileSync(keyPath),
      // Present leaf + CA as a chain. This isn't strictly required
      // for clients that already trust the CA, but it helps any
      // client doing eager chain validation (e.g. curl --cacert
      // pointed at the CA, or a Node.js client without --insecure).
      cert: Buffer.concat([
        fs.readFileSync(certPath),
        Buffer.from("\n"),
        fs.readFileSync(caCertPath),
      ]),
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
// Tiered Cache-Control on the static client bundle.
//
// Problem this solves: webpack outputs `bundle.min.js` (and the
// split chunks `1.bundle.min.js`, `810.bundle.min.js`) with FIXED
// filenames across builds. Without an explicit Cache-Control,
// `express.static` sends only `Last-Modified`, and Chromium then
// computes a heuristic max-age (~10 % of the file's age — for a
// bundle that's been on disk a few hours, that's tens of minutes
// of cache the browser will serve WITHOUT revalidating). So a
// kiosk that completes an in-app update and reloads the page can
// keep running the pre-update JS for a while — observed live on
// 2026-05-27 on the SenseHat Pi, where `git pull` confirmed the
// branch was already on the latest commit but the UI didn't show
// the changes until a manual hard refresh.
//
//  Tiers:
//   1. Filename-hashed assets (`[contenthash][ext]` — webpack's
//      asset/resource output for woff2 / json / etc., names like
//      `438417506dfef4949800.woff2`): the name itself changes
//      when the content changes, so the cached copy can be
//      treated as `immutable` and held for a year.
//   2. Bundle / chunks / HTML / license txt (fixed names, content
//      changes per build): `no-cache` forces the browser to send
//      an `If-Modified-Since` on every request; the server replies
//      with 304 Not Modified when the file is unchanged (cheap —
//      ~150 bytes per response). Guarantees a post-update reload
//      always picks up the fresh bundle.
//   3. PWA icons / favicon (fixed names, content changes maybe
//      once a quarter): 24 h cache keeps them out of the reload
//      path without locking them in forever.
app.use(express.static(path.join(`${__dirname}/${DIST_DIR}`), {
  setHeaders: (res, filepath) => {
    const name = path.basename(filepath);
    if (/^[a-f0-9]{16,}\./.test(name)) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      return;
    }
    if (/\.(html|js|css|txt)$/.test(name)) {
      res.setHeader("Cache-Control", "no-cache");
      return;
    }
    res.setHeader("Cache-Control", "public, max-age=86400");
  },
}));
app.use(responseTimerMiddleware);

// Disable browser caching of every /api/* response. The kiosk
// Chromium would otherwise hold onto JSON payloads across reloads
// (max-age heuristic when no Cache-Control is sent), which masked
// a real server-side cache change during the 2.14.4 → 2.14.5 rollout
// — the proxy started returning new fields but Chromium kept serving
// the cached pre-upgrade response and the UI rendered the old shape.
// Combined with proxyCtrl's field-hash in the cache key (2.14.6),
// this guarantees every upgrade gets fresh payloads on first reload.
// Tile responses (/api/tiles/...) deliberately bypass this — tiles
// are content-addressable and benefit from aggressive browser cache.
app.use("/api", (req, res, next) => {
  if (!req.path.startsWith("/tiles")) {
    res.setHeader("Cache-Control", "no-store");
  }
  next();
});

// When remote access is enabled, trust the first proxy hop so req.ip
// reflects the real client IP from X-Forwarded-For rather than the
// proxy's socket address. Disabled for local-only mode to prevent
// header spoofing on direct connections.
if (ALLOW_REMOTE) app.set("trust proxy", 1);

// Both limiters key on the socket peer (see rateLimitKey.js), NOT req.ip —
// under `trust proxy` req.ip is X-Forwarded-For-spoofable, which would let a
// single remote client rotate the header to bypass the limit entirely.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: socketPeerKeyGenerator,
  message: "Too many requests",
});

const tileLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: socketPeerKeyGenerator,
  message: "Too many requests",
});

const isLocalhostIp = (ip) => ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";

// SECURITY GATE — derive "is this request local?" from the raw TCP
// socket peer, NEVER from req.ip.
//
// req.ip honors `trust proxy` (set to 1 when ALLOW_REMOTE, line ~493)
// and therefore the client-supplied `X-Forwarded-For` header. A direct
// remote/LAN client can send `X-Forwarded-For: 127.0.0.1` and Express
// resolves req.ip to 127.0.0.1 — impersonating localhost and bypassing
// every localhostOnly gate (and unmasking GET /settings). Confirmed
// with a faithful repro 2026-05-29: socket peer 192.168.x.x + that
// header → req.ip 127.0.0.1 → full API keys + Homebridge creds returned.
//
// `req.socket.remoteAddress` is the kernel-level connection origin and
// cannot be forged by an HTTP header. Both documented remote-access
// paths terminate at loopback, so they stay "local" and keep working:
//   - SSH tunnel (`ssh -L 8443:localhost:8443`) connects from 127.0.0.1
//   - RPi Connect screen-share drives the on-device kiosk → localhost
// A direct VPN/LAN client connects from its real IP and is correctly
// treated as remote: read-masked /settings, write gates rejected —
// matching the "use an SSH tunnel for remote settings" docs.
//
// CAVEAT — if a same-host reverse proxy (nginx/caddy) is ever placed in
// front of this server, every request arrives with socket peer
// 127.0.0.1 and this check treats ALL clients as local. No such
// deployment exists in the fleet today; if one is added, the proxy
// itself must enforce the localhost restriction (never forward the
// write endpoints) and this gate must be revisited.
const socketIsLocal = (req) => isLocalhostIp(req.socket?.remoteAddress);

// Client tracking + rate-limit keying both derive from the socket peer
// (req.socket.remoteAddress), NOT req.ip. req.ip honours trust proxy /
// X-Forwarded-For and is therefore spoofable: a remote client rotating
// the header could bypass the rate limiter and mint unlimited
// clientTracker entries. The socket peer is the kernel-level connection
// origin and can't be forged by a header. (Behind a legitimate same-host
// reverse proxy every peer would read 127.0.0.1 — see the socketIsLocal
// caveat above; no such deployment exists in the fleet today.) Neither of
// these gates access — that's socketIsLocal's job.
app.use((req, res, next) => {
  req.isLocal = socketIsLocal(req);
  if (!req.isLocal) recordClient(req.socket?.remoteAddress);
  next();
});

const localhostOnly = (req, res, next) => {
  if (!socketIsLocal(req)) {
    logSecurityEvent(req.socket?.remoteAddress || req.ip, req.method, req.originalUrl);
    return res.status(403).json("Settings can only be modified from the Pi itself.").end();
  }
  next();
};

const debugLocalhostOnly = (req, res, next) => {
  if (!socketIsLocal(req)) {
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
    registerKnownServices();
    // Re-apply the persisted Sense HAT display mode (weather/clock).
    // No-op on hosts without a Sense HAT. Fire-and-forget; the call
    // does its own logging.
    applySenseHatModeOnBoot().catch(() => undefined);
    await openInBrowserIfDev(`https://localhost:${HTTPS_PORT}`);
    console.log(`${appName} v${ver} has started on port ${HTTPS_PORT} (HTTPS, bound to ${HOST})`);
  });
} else {
  app.listen(PORT, HOST, async () => {
    initServerInfo(PORT, "http");
    initIndoorTemperature();
    registerKnownServices();
    applySenseHatModeOnBoot().catch(() => undefined);
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

// Serve the self-signed CA cert as a downloadable file. Browsers /
// iOS recognise the `application/x-x509-ca-cert` MIME and offer to
// install it as a trusted profile. Once trusted at the OS level,
// the iOS add-to-home-screen flow can fetch the apple-touch-icon
// over the secure connection without falling back to the letter
// glyph (user-reported v2.15.21). Content-Disposition forces the
// "download" behaviour rather than displaying the PEM inline.
//
// Not gated by `localhostOnly` because remote users are exactly
// who need this — the cert is a public artefact (the public key
// is in every TLS handshake anyway), only the private key in
// `key.pem` is sensitive and never served.
app.get("/api/cert.pem", (req, res) => {
  // Serve the ROOT CA cert (ca-cert.pem) — that's the artefact
  // users install in their device's trust store. The server's
  // leaf cert (cert.pem) is presented in the TLS handshake and
  // validated against the trusted root client-side. Pre-CA-chain
  // refactor this endpoint served cert.pem directly because the
  // leaf WAS the root; after the refactor we point at ca-cert.pem.
  // Falls back to cert.pem if ca-cert.pem is missing (defensive —
  // legacy installs that haven't regenerated yet).
  const caCertPath = path.join(__dirname, "ca-cert.pem");
  const legacyCertPath = path.join(__dirname, "cert.pem");
  const sourcePath = fs.existsSync(caCertPath) ? caCertPath : legacyCertPath;
  fs.readFile(sourcePath, (err, data) => {
    if (err) return res.status(404).send("cert.pem not found");
    res.setHeader("Content-Type", "application/x-x509-ca-cert");
    res.setHeader("Content-Disposition", "attachment; filename=\"pi-weather-cert.pem\"");
    return res.status(200).send(data);
  });
});

app.get("/api/reverse-geocode", apiLimiter, proxyReverseGeocode);
app.get("/api/tiles/:style/:z/:x/:y", tileLimiter, mapTile);

app.get("/api/weather/current", apiLimiter, weatherCurrent);
app.get("/api/weather/hourly", apiLimiter, weatherHourly);
app.get("/api/weather/daily", apiLimiter, weatherDaily);
app.get("/api/sunrise-sunset", apiLimiter, sunriseSunset);

app.get("/api/weather-summary", apiLimiter, getWeatherSummary);
app.get("/api/sensehat",            apiLimiter, getSenseHatData);
app.get("/api/sensehat-available",  apiLimiter, getSenseHatAvailable);
app.get("/api/sensehat-mode",       apiLimiter, getSenseHatMode);
app.post("/api/sensehat-mode",      localhostOnly, setSenseHatMode);
app.get("/api/sensehat-clock-brightness",  apiLimiter, getClockBrightness);
app.post("/api/sensehat-clock-brightness", localhostOnly, setClockBrightness);
app.get("/api/sensehat-radar-brightness",  apiLimiter, getRadarBrightness);
app.post("/api/sensehat-radar-brightness", localhostOnly, setRadarBrightness);
app.post("/api/kiosk-location",            localhostOnly, postKioskLocation);
app.get("/api/indoor-temperature",  apiLimiter, getIndoorTemperature);

const { getAirQuality } = require("./airQualityCtrl");
app.get("/api/air-quality",         apiLimiter, getAirQuality);

const { getHealth } = require("./healthCtrl");
app.get("/api/health",              apiLimiter, getHealth);

const { getOpenMeteoWeather } = require("./openMeteoCtrl");
app.get("/api/weather/openmeteo",   apiLimiter, getOpenMeteoWeather);

const { getPollen } = require("./pollenCtrl");
app.get("/api/pollen",              apiLimiter, getPollen);

const { getWeatherAlerts, getNearbyAlerts } = require("./govAlertsCtrl");
app.get("/api/weather-alerts",      apiLimiter, getWeatherAlerts);
app.get("/api/nearby-alerts",       apiLimiter, getNearbyAlerts);

// Radar risk-level overlay for the dashed circles in WeatherMap. Reads the
// "right now" intensity sampled on each ring and maps to a colour tier
// (calm / yellow / orange / red) aligned with WMO / Météo-France / NWS
// conventions. The outer ring is only evaluated when the user has opted
// into extendedRadius — same gate as the AI summary's outer-ring sampling.
const { getRiskLevels } = require("./radarAnalyzerCtrl");
app.get("/api/radar-risk", apiLimiter, async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return res.status(400).json("Invalid coordinates").end();
  }
  const distanceUnit = req.query.distanceUnit === "mi" ? "mi" : "km";
  let extendedRadius = false;
  try {
    const settings = await settingsCtrl.getSettingsData();
    extendedRadius = Boolean(settings?.advanced?.ai?.extendedRadius);
  } catch {
    // Settings unreadable — proceed with inner ring only (safe default).
  }
  try {
    const result = await getRiskLevels(lat, lon, { extendedRadius, distanceUnit });
    if (!result) return res.status(503).json("Radar risk unavailable").end();
    return res.status(200).json(result).end();
  } catch {
    return res.status(500).json("Radar risk failed").end();
  }
});

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

    // Auto-discard local edits to ALL auto-generated tracked artifacts
    // before the dirty-tree check. Two recurring sources of drift, both
    // observed live with k5map upgrades:
    //   1. Lockfiles — `npm install` rewrites package-lock.json and
    //      client/package-lock.json on the device (May 2026 v2.2.5 →
    //      v2.12.0 case).
    //   2. Client dist — a `--rebuild-client` install.sh run, or any
    //      `npm run prod` invoked on the device, rewrites
    //      client/dist/bundle.min.js (and chunked siblings like
    //      1.bundle.min.js, plus the LICENSE.txt). Observed live on the
    //      v2.2.5 → v2.13.x retry, same upgrade flow as before.
    // All of these are 100 % auto-generated (lockfiles by npm/npm ci,
    // dist files by webpack); nobody hand-edits them. Silent revert is
    // safe. Errors tolerated (file may be clean / absent). After the
    // pull, `npm ci` regenerates the lockfiles from the upstream copy.
    exec("git checkout HEAD -- package-lock.json client/package-lock.json client/dist", { cwd: projectRoot, timeout: 5_000 }, () => {

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
      // Timeout bumped from 30s to 90s after a 2026-05-27 incident on a Pi
      // reached via VPN + RPi Connect: github.com over the VPN tunnel
      // routinely takes 40-60 s to complete handshake + fetch, so 30 s
      // killed the pull mid-flight. The on-disk pull usually completed in
      // the background (next `git status` showed the branch clean and
      // ahead of where it was), but the API call returned a cryptic
      // "Command failed: git pull --ff-only" because Node's exec
      // propagates only the killed-process error, not git's own output
      // (which never had time to write). 90 s covers comfortable margin
      // for VPN'd / mobile / congested-Wi-Fi pulls without making a
      // genuinely-stuck pull hang the modal too long. Local pulls stay
      // sub-second so the bump is invisible there.
      console.log("[update] Starting git pull…");
      exec("git pull --ff-only", { cwd: projectRoot, timeout: 90_000 }, (pullErr, pullStdout, pullStderr) => {
        if (pullErr) {
          console.error("[update] git pull failed:", pullStderr || pullErr.message);
          // Timeout detection — `exec` kills the child with SIGTERM once
          // the timeout elapses. Both `pullErr.killed` and `pullErr.signal`
          // are set in that case; `pullStderr` is typically empty because
          // git was interrupted before writing any output. Distinguish
          // this from a real git failure so the user gets actionable
          // feedback ("the link is slow, the pull may have completed in
          // the background") instead of the bare "Command failed" string.
          if (pullErr.killed || pullErr.signal === "SIGTERM") {
            return res.status(504).json({
              error: true,
              reason: "pull-timeout",
              message:
                "git pull took longer than 90 seconds and was aborted. " +
                "This usually means the device's connection to GitHub is " +
                "slow (VPN tunnel, mobile network, congested Wi-Fi). The " +
                "pull may have completed in the background — wait a moment, " +
                "then retry the update.",
            });
          }
          // File-ownership problem: some tracked files are owned by root
          // (caused by a previous `sudo git pull` or `sudo bash deploy/install.sh`).
          // git can't overwrite root-owned files when running as the normal user.
          if (/Permission denied/i.test(pullStderr)) {
            return res.status(409).json({
              error: true,
              reason: "permission-denied",
              message:
                "Some repository files are owned by root and cannot be updated. " +
                "Fix with this command on your device, then retry:\n\n" +
                "sudo chown -R $(whoami):$(whoami) ~/pi-weather-station",
            });
          }
          return res.status(500).json({
            error: true,
            reason: "pull-failed",
            message: `git pull failed: ${pullStderr || pullErr.message}`,
          });
        }
        console.log("[update] git pull succeeded:", pullStdout.trim());

        // Always run `npm ci` after the pull. Like `npm install` it's
        // idempotent and prevents the "Cannot find module 'X'" trap on
        // freshly-introduced dependencies, but unlike `npm install` it
        // never rewrites package-lock.json. Lockfile drift caused by
        // `npm install` resolving transitive deps slightly differently
        // on different node versions has been the recurring cause of
        // pre-flight "uncommitted local changes" failures on the next
        // update — the kiosk owner sees an opaque rejection message
        // referring to a file they never touched. `npm ci` is the
        // canonical fix: install strictly from the lockfile or fail
        // loudly if the lockfile and package.json don't agree (which
        // would be a real problem worth surfacing anyway).
        console.log("[update] Running npm ci (--omit=dev)…");
        exec(
          "npm ci --omit=dev --no-audit --no-fund",
          { cwd: projectRoot, timeout: 180_000 },
          (npmErr, npmStdout, npmStderr) => {
            if (npmErr) {
              console.error("[update] npm ci failed:", npmStderr);
              return res.status(500).json({
                error: true,
                reason: "npm-install-failed",
                message: `npm ci failed: ${npmStderr || npmErr.message}`,
              });
            }
            console.log("[update] npm ci succeeded.");
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
    });  // close lockfile-discard callback
  });
});

app.get("/api/debug", debugLocalhostOnly, getDebugInfo);
app.get("/api/debug/cpu-temp", debugLocalhostOnly, getCpuTemp);
app.get("/api/debug/fan-speed", debugLocalhostOnly, getFanSpeed);

// Radar prompt-compression report. Generates a Markdown breakdown of
// the in-memory stats accumulated by compressionStats and writes it
// to `report/radar-compression-{ISO}.md`. Localhost-only (the report
// is for the kiosk owner; remote clients shouldn't be able to fill
// the report/ directory). Returns the relative path of the file
// written so the client can show it in a confirmation toast.
app.post("/api/debug/radar-compression-report", debugLocalhostOnly, (req, res) => {
  const compressionStats = require("./compressionStats");
  const reportDir = path.join(__dirname, "..", "report");
  try {
    if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
    const isoTs = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `radar-compression-${isoTs}.md`;
    const filepath = path.join(reportDir, filename);
    fs.writeFileSync(filepath, compressionStats.generateReport());
    return res.status(200).json({ ok: true, path: `report/${filename}` });
  } catch (err) {
    console.error("[radar-compression-report] write failed:", err.message);
    return res.status(500).json({ error: true, message: err.message });
  }
});

// Display brightness — read open to anyone (for the client to know whether
// to render the slider), write localhost-only (the brightness physically
// affects the device's screen, makes no sense for a remote client to dim
// what they aren't looking at).
app.get("/api/brightness", getBrightness);
app.post("/api/brightness", localhostOnly, setBrightness);

function shutdown() {
  saveCacheToDisk();
  flushRequestCounts();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT",  shutdown);
