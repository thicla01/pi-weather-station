const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync, spawn } = require("child_process");

// The kiosk launcher config that `start-server` sources. The DISPLAY_SCALE
// line we manage here is exported by start-server and honoured by
// detect-display-scale.sh (auto / off / number > 1). No secrets live in
// this file, so we preserve its existing permissions on write (unlike
// settings.json, which we force to 0600).
const BROWSER_CONF = path.join(os.homedir(), ".config", "pi-weather-station", "browser.conf");

// detect-display-scale.sh lookup: installed location first (prod kiosk),
// the repo copy as a dev-checkout fallback. Mirrors start-server's own
// candidate order.
const DETECT_SCRIPT_CANDIDATES = [
  path.join(os.homedir(), ".local", "bin", "detect-display-scale.sh"),
  path.join(__dirname, "..", "deploy", "detect-display-scale.sh"),
];

// relaunch-kiosk.sh lookup: repo copy first (it's git-tracked, so a plain
// `git pull` ships it — no install step), installed location as a fallback.
const RELAUNCH_SCRIPT_CANDIDATES = [
  path.join(__dirname, "..", "deploy", "relaunch-kiosk.sh"),
  path.join(os.homedir(), ".local", "bin", "relaunch-kiosk.sh"),
];

// wlr-randr is ~50 ms; 3 s is generous enough to cover a slow xrandr
// fallback without blocking the event loop if the call ever hangs.
const DETECT_TIMEOUT_MS = 3_000;

// `ps -eo args` is a /proc walk (tens of ms on a Pi). It runs synchronously,
// so this caps how long a wedged call can stall the event loop.
const PS_TIMEOUT_MS = 2_000;

// The flag start-server passes to EVERY kiosk browser (Chromium family and
// Firefox alike) — the same token relaunch-kiosk.sh pkills by. Matched as a
// whole argv token, never as a substring of another argument.
const KIOSK_FLAG = "--kiosk";

// argv[0] basenames of a Chromium-family kiosk's MAIN (browser) process, for
// every browser start-server can launch (install.sh KNOWN_BROWSERS /
// classify_browser_family). Two spellings can reach `ps`:
//  - the real binary the vendor wrapper execs — what Chromium normally shows,
//    since it re-titles itself from /proc/self/exe:
//    /usr/lib/chromium/chromium (Debian, Raspberry Pi OS, openSUSE),
//    /usr/lib/chromium-browser/chromium-browser[-v7] (Pi OS Bullseye),
//    /opt/google/chrome/chrome and Ubuntu's chromium snap .../chrome,
//    /opt/microsoft/msedge/msedge, /opt/brave.com/brave/brave;
//  - the launcher name itself (a bare BROWSER_CMD, or the `exec -a "$0"` the
//    Chrome / Edge / Brave wrappers do): chromium, chromium-browser,
//    google-chrome[-stable], microsoft-edge[-stable], brave-browser[-stable].
// Anchored on purpose so the helper binaries sharing those install dirs —
// chrome_crashpad_handler, msedge_crashpad_handler, chrome-sandbox,
// chromedriver — never match.
const CHROMIUM_KIOSK_EXE = new RegExp(
  "^(?:chromium(?:-browser)?(?:-v\\d+)?|chrome"
  + "|google-chrome(?:-stable|-beta|-unstable)?"
  + "|msedge|microsoft-edge(?:-stable|-beta|-dev)?"
  + "|brave|brave-browser(?:-stable|-beta|-nightly)?)$",
);

// argv[0] basenames of a Firefox kiosk's main process: the firefox /
// firefox-esr launcher names, the deb + snap binaries of the same names, and
// the Mozilla tarball's firefox-bin.
const FIREFOX_KIOSK_EXE = /^firefox(?:-esr|-bin)?$/;

// Child processes run the browser's own binary but are not the kiosk:
// Chromium zygote / renderer / GPU / utility helpers carry `--type=…`,
// Firefox content processes `-contentproc`. The launch flags we read live on
// the main process only.
const CHILD_PROCESS_ARG = /^(?:--type=|-contentproc$)/;

// Chromium's scale switch. A repeated switch is legal and the LAST one wins
// (base::CommandLine overwrites), so every occurrence is scanned.
const SCALE_SWITCH_PREFIX = "--force-device-scale-factor=";

// What Chromium accepts as a factor; anything else it logs and ignores,
// falling back to no forced scale.
const SCALE_VALUE = /^\d+(?:\.\d+)?$/;

const SNAP_STEP = 0.25;
// UI ceiling (maintainer decision 2026-06-24): the fleet's densest real
// panel needs 1.25, so 2.0 is a wide margin. detect-display-scale.sh's own
// MAX_SCALE is 3.0; we cap the override picker lower on purpose.
const MAX_SCALE = 2.0;

// The values offered in the UI, in browser.conf terms. "auto" = remove the
// line (fall back to auto-detect); "off" = force no scaling (1.0); the
// numbers are the snap quarters detect-display-scale.sh would emit.
const SCALE_CHOICES = ["auto", "off", "1.25", "1.5", "1.75", "2"];

/**
 * Parse a DISPLAY_SCALE assignment out of browser.conf contents. Tolerates
 * surrounding quotes, an inline trailing comment, and multiple assignments
 * (the last wins, matching shell `source` semantics). Returns "auto" when
 * no assignment is present — the absence of a line IS auto-detect.
 *
 * @param {String} contents raw browser.conf text
 * @returns {String} the override value: "auto" | "off" | a number string
 */
function parseOverrideLine(contents) {
  if (typeof contents !== "string") return "auto";
  let value = "auto";
  for (const line of contents.split("\n")) {
    const m = line.match(/^\s*DISPLAY_SCALE\s*=\s*(.+?)\s*$/);
    if (!m) continue;
    let raw = m[1].replace(/\s+#.*$/, "");                 // strip inline comment
    raw = raw.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1").trim(); // unquote
    if (raw) value = raw;
  }
  return value || "auto";
}

/**
 * Parse the PPI / raw diagnostic that detect-display-scale.sh prints to
 * stderr, e.g. "detect-display-scale: PPI=141 raw=1.081 -> 1.0 ...".
 *
 * @param {String} stderr captured stderr
 * @returns {{ppi:Number, raw:Number}|null} parsed diagnostic, or null
 */
function parseDetectDiag(stderr) {
  if (typeof stderr !== "string") return null;
  const m = stderr.match(/PPI=(\d+(?:\.\d+)?)\s+raw=(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const ppi = parseFloat(m[1]);
  const raw = parseFloat(m[2]);
  if (!Number.isFinite(ppi) || !Number.isFinite(raw)) return null;
  return { ppi, raw };
}

/**
 * Validate a requested scale against the allowed values: "auto", "off", or
 * a clean quarter in (1.0, MAX_SCALE]. Returns the normalized string to
 * persist ("2.0" -> "2", "1.50" -> "1.5") or null if invalid.
 *
 * @param {String|Number} scale requested value
 * @returns {String|null} normalized value, or null when out of range / not a quarter
 */
function validateScale(scale) {
  if (scale === "auto" || scale === "off") return scale;
  const n = typeof scale === "number" ? scale : parseFloat(scale);
  if (!Number.isFinite(n) || n <= 1.0 || n > MAX_SCALE) return null;
  const snapped = Math.round(n / SNAP_STEP) * SNAP_STEP;
  if (Math.abs(snapped - n) > 1e-9) return null;        // must land on a quarter
  return snapped.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * Rewrite browser.conf contents with a managed DISPLAY_SCALE line. Drops
 * every existing DISPLAY_SCALE assignment, then appends the new one unless
 * the value is "auto" (absence of a line IS auto-detect). All other lines
 * are preserved verbatim. Mirrors start-server's apply_firefox_scale()
 * managed-line pattern (grep -v + append).
 *
 * @param {String} contents existing browser.conf text ("" if new)
 * @param {String} value normalized scale ("auto" | "off" | number string)
 * @returns {String} the new file contents (trailing newline)
 */
function rewriteBrowserConf(contents, value) {
  const lines = (typeof contents === "string" ? contents : "")
    .split("\n")
    .filter((l) => !/^\s*DISPLAY_SCALE\s*=/.test(l));
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  if (value !== "auto") {
    lines.push(`DISPLAY_SCALE="${value}"   # set via Settings UI`);
  }
  return `${lines.join("\n")}\n`;
}

function readBrowserConf() {
  try {
    return fs.readFileSync(BROWSER_CONF, "utf8");
  } catch {
    return null;
  }
}

function findDetectScript() {
  for (const candidate of DETECT_SCRIPT_CANDIDATES) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // ignore and try the next candidate
    }
  }
  return null;
}

/**
 * Run detect-display-scale.sh in auto mode to learn what the auto-detector
 * resolves to right now, independent of any override. The script
 * self-discovers WAYLAND_DISPLAY / XDG_RUNTIME_DIR, so it works even from
 * the systemd-user service env. Never throws.
 *
 * @returns {{value:String|null, ppi:Number|null, raw:Number|null}} the
 *   snapped value ("1.25", or null when the detector emits nothing ⇒ 1.0)
 *   plus the PPI/raw diagnostic for the UI hint
 */
function detectAuto() {
  const script = findDetectScript();
  if (!script) return { value: null, ppi: null, raw: null };
  try {
    const r = spawnSync(script, [], {
      env: { ...process.env, DISPLAY_SCALE: "auto" },
      timeout: DETECT_TIMEOUT_MS,
      encoding: "utf8",
    });
    if (r.error) return { value: null, ppi: null, raw: null };
    const value = (r.stdout || "").trim() || null;
    const diag = parseDetectDiag(r.stderr || "");
    return { value, ppi: diag ? diag.ppi : null, raw: diag ? diag.raw : null };
  } catch {
    return { value: null, ppi: null, raw: null };
  }
}

/**
 * Find the kiosk browser's MAIN process(es) in a `ps -eo args` listing. A
 * line qualifies only when its argv[0] basename is a supported kiosk browser
 * (see CHROMIUM_KIOSK_EXE / FIREFOX_KIOSK_EXE), it carries `--kiosk` as a
 * whole token, and it is not a child process (`--type=…` / `-contentproc`).
 * That rules out crashpad handlers, renderer/zygote/GPU helpers, a desktop
 * browser window without `--kiosk`, and any shell or grep/pgrep/pkill
 * command line that merely mentions the words.
 *
 * Tokens are split on whitespace (ps joins argv with spaces), which is exact
 * for the paths and flags start-server produces.
 *
 * @param {String} psStdout output of `ps -eo args`
 * @returns {Array<{family:String, args:String[]}>} one entry per kiosk main
 *   process, in listing order; `family` is "chromium" or "firefox"
 */
function findKioskProcesses(psStdout) {
  if (typeof psStdout !== "string") return [];
  const kiosks = [];
  for (const line of psStdout.split("\n")) {
    const args = line.trim().split(/\s+/);
    if (!args.includes(KIOSK_FLAG)) continue;
    if (args.some((a) => CHILD_PROCESS_ARG.test(a))) continue;
    const exe = path.posix.basename(args[0]);
    if (CHROMIUM_KIOSK_EXE.test(exe)) kiosks.push({ family: "chromium", args });
    else if (FIREFOX_KIOSK_EXE.test(exe)) kiosks.push({ family: "firefox", args });
  }
  return kiosks;
}

/**
 * The device-scale-factor a Chromium-family browser runs with, from its
 * argv: the LAST `--force-device-scale-factor=X` (Chromium's own rule for a
 * repeated switch). No flag — or a value Chromium can't parse, which it
 * ignores — ⇒ "1": no forced factor, the browser follows the compositor.
 *
 * @param {String[]} args the main process's argv tokens
 * @returns {String} the applied factor ("1.25") or "1"
 */
function chromiumScaleFromArgs(args) {
  let raw = null;
  for (const a of args) {
    if (a.startsWith(SCALE_SWITCH_PREFIX)) raw = a.slice(SCALE_SWITCH_PREFIX.length);
  }
  return raw !== null && SCALE_VALUE.test(raw) ? raw : "1";
}

/**
 * Pull the device-scale-factor actually applied to the RUNNING kiosk from a
 * `ps` listing — the ground truth of what the user currently sees, vs the
 * `override` in browser.conf (which only takes effect on the next relaunch).
 *
 * What `applied` means per family:
 *  - **Chromium family** (Chromium, Chrome, Brave, Edge): the
 *    `--force-device-scale-factor=X` on the kiosk's main process, or "1"
 *    when start-server launched it without the flag (no forced factor).
 *  - **Firefox**: always null. Firefox has no scale flag — start-server
 *    writes the factor into the kiosk profile's user.js
 *    (`layout.css.devicePixelRatio`) before launch, which argv can't show,
 *    so the running value is genuinely unknown here. Reporting "1" for a
 *    flagless Firefox would claim "no scaling" on a possibly-scaled screen.
 *  - **No kiosk found** (headless, mid-relaunch), or several kiosk main
 *    processes that disagree (old and new browser overlapping during a
 *    relaunch): null.
 *
 * The client reads null as "unknown ⇒ keep the Relaunch button available".
 *
 * @param {String} psStdout output of `ps -eo args`
 * @returns {String|null} applied factor ("1.25"), "1" (no flag), or null
 */
function parseAppliedFromPs(psStdout) {
  const kiosks = findKioskProcesses(psStdout);
  if (kiosks.length === 0) return null;
  const values = new Set(kiosks.map((k) => (k.family === "chromium" ? chromiumScaleFromArgs(k.args) : null)));
  return values.size === 1 ? [...values][0] : null;
}

/**
 * Read the scale currently applied to the running kiosk. Never throws.
 *
 * @returns {String|null} applied factor, "1", or null if undeterminable
 *   (Firefox kiosk, no kiosk running, or `ps` unavailable)
 */
function detectApplied() {
  try {
    const r = spawnSync("ps", ["-eo", "args"], { encoding: "utf8", timeout: PS_TIMEOUT_MS });
    if (r.error) return null;
    return parseAppliedFromPs(r.stdout || "");
  } catch {
    return null;
  }
}

/**
 * GET /api/display-scale — current override + what Auto resolves to.
 * `available:false` on non-kiosk installs (no browser.conf — macOS launchd
 * dev box, headless) so the Settings control hides, mirroring brightness.
 *
 * @param {Object} req Express request
 * @param {Object} res Express response
 */
function getDisplayScale(req, res) {
  if (!fs.existsSync(BROWSER_CONF)) {
    return res.status(200).json({ available: false }).end();
  }
  const override = parseOverrideLine(readBrowserConf() || "");
  const auto = detectAuto();
  return res.status(200).json({
    available: true,
    override,
    autoDetected: auto.value,   // null ⇒ effective 1.0
    applied: detectApplied(),   // running kiosk: "1.25"/"1"; null = unknown (Firefox, none)
    ppi: auto.ppi,
    raw: auto.raw,
    choices: SCALE_CHOICES,
    appliesOnRestart: true,
  }).end();
}

/**
 * POST /api/display-scale — body { scale }. Writes the managed DISPLAY_SCALE
 * line into browser.conf. `localhostOnly` at the route: this tunes the Pi's
 * physical kiosk (like brightness), so a remote client can't change it.
 * Takes effect on the next kiosk relaunch (it's a browser launch flag).
 *
 * @param {Object} req Express request
 * @param {Object} res Express response
 */
function setDisplayScale(req, res) {
  if (!fs.existsSync(BROWSER_CONF)) {
    return res.status(503).json({ error: "no-browser-conf" }).end();
  }
  const { scale } = req.body || {};
  const normalized = validateScale(scale);
  if (normalized === null) {
    return res.status(400).json({ error: "invalid-scale", choices: SCALE_CHOICES }).end();
  }
  const current = readBrowserConf();
  if (current === null) {
    return res.status(500).json({ error: "read-failed" }).end();
  }
  const next = rewriteBrowserConf(current, normalized);
  try {
    let mode = 0o644;
    try {
      mode = fs.statSync(BROWSER_CONF).mode & 0o777;      // preserve existing perms
    } catch {
      // fall back to 0644 if stat fails
    }
    const tmp = `${BROWSER_CONF}.pwx.${process.pid}`;
    fs.writeFileSync(tmp, next);
    fs.chmodSync(tmp, mode);
    fs.renameSync(tmp, BROWSER_CONF);                     // atomic replace
  } catch {
    return res.status(500).json({ error: "write-failed" }).end();
  }
  return res.status(200).json({
    available: true,
    override: normalized,
    appliesOnRestart: true,
  }).end();
}

function findRelaunchScript() {
  for (const candidate of RELAUNCH_SCRIPT_CANDIDATES) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // ignore and try the next candidate
    }
  }
  return null;
}

/**
 * POST /api/relaunch-kiosk — relaunch the kiosk browser so a changed
 * DISPLAY_SCALE takes effect (a launch flag can't change on a live page).
 * `localhostOnly` at the route. NOT a server restart: the kiosk browser is
 * a separate process from pi-weather-server. Spawns relaunch-kiosk.sh fully
 * detached (it kills the very browser this request came from, so it must
 * outlive it) and returns 200 immediately.
 *
 * @param {Object} req Express request
 * @param {Object} res Express response
 */
function relaunchKiosk(req, res) {
  if (!fs.existsSync(BROWSER_CONF)) {
    return res.status(503).json({ error: "no-browser-conf" }).end();
  }
  const script = findRelaunchScript();
  if (!script) {
    return res.status(503).json({ error: "no-relaunch-script" }).end();
  }
  try {
    // bash <script> so the executable bit isn't required; detached + unref so
    // it survives the server killing the kiosk and this handler returning.
    const child = spawn("bash", [script], { detached: true, stdio: "ignore" });
    child.unref();
  } catch {
    return res.status(500).json({ error: "spawn-failed" }).end();
  }
  return res.status(200).json({ ok: true }).end();
}

module.exports = {
  getDisplayScale,
  setDisplayScale,
  relaunchKiosk,
  readOverride: () => parseOverrideLine(readBrowserConf() || ""),
  detectAuto,
  detectApplied,
  SCALE_CHOICES,
  // Exported for regression testing only — internal helpers, not part of
  // the public surface.
  __test: {
    parseOverrideLine,
    parseDetectDiag,
    validateScale,
    rewriteBrowserConf,
    parseAppliedFromPs,
    findKioskProcesses,
    chromiumScaleFromArgs,
  },
};
