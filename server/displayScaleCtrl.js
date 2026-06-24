const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

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

// wlr-randr is ~50 ms; 3 s is generous enough to cover a slow xrandr
// fallback without blocking the event loop if the call ever hangs.
const DETECT_TIMEOUT_MS = 3_000;

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
    applied: false,
    appliesOnRestart: true,
  }).end();
}

module.exports = {
  getDisplayScale,
  setDisplayScale,
  readOverride: () => parseOverrideLine(readBrowserConf() || ""),
  detectAuto,
  SCALE_CHOICES,
  // Exported for regression testing only — internal helpers, not part of
  // the public surface.
  __test: {
    parseOverrideLine,
    parseDetectDiag,
    validateScale,
    rewriteBrowserConf,
  },
};
