const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const BACKLIGHT_ROOT = "/sys/class/backlight";
// Floor at 10% of max so the user can never accidentally make the screen
// completely black via the slider — they'd lose the means to recover
// without SSH. 10% is dim but still readable in a normal room.
const MIN_PERCENT = 10;

// Timeout for the ed-ddc-server CLI calls (DDC/CI over i2c can take
// anywhere from 80 ms to ~400 ms on real hardware; 2 s is generous
// enough to cover slow buses without blocking the event loop forever
// if the monitor unplugs mid-write).
const ED_DDC_TIMEOUT_MS = 2_000;
// Detect timeout — a fork/exec of a missing binary fails fast (~10 ms);
// a successful read on a real ED-MONITOR is ~150 ms. 1.5 s covers both
// without blocking the event loop if the i2c bus is stuck.
const ED_DDC_DETECT_TIMEOUT_MS = 1_500;

// ─── sysfs backend ──────────────────────────────────────────────────
// The original /sys/class/backlight implementation. Used by the
// official Pi 7" DSI touchscreen, the EDATEC ED-HMI3010-101C all-in-
// one, and any other panel whose driver exposes a kernel backlight.

let _sysfsCachedDevicePath = null;
let _sysfsCachedDevicePathResolved = false;
function sysfsGetDevicePath() {
  if (_sysfsCachedDevicePathResolved) return _sysfsCachedDevicePath;
  _sysfsCachedDevicePathResolved = true;
  try {
    const entries = fs.readdirSync(BACKLIGHT_ROOT);
    if (entries.length === 0) return (_sysfsCachedDevicePath = null);
    // First entry wins. Most systems expose only one backlight; if there
    // are several (rare), the first one is typically the primary panel.
    _sysfsCachedDevicePath = path.join(BACKLIGHT_ROOT, entries[0]);
    return _sysfsCachedDevicePath;
  } catch {
    // Directory doesn't exist (macOS, x86 without backlight, missing
    // dtoverlay on Pi). Return null and let callers handle it.
    return (_sysfsCachedDevicePath = null);
  }
}

function sysfsDetect() {
  return sysfsGetDevicePath() !== null;
}

function sysfsRead() {
  const dev = sysfsGetDevicePath();
  if (!dev) return null;
  try {
    const max = parseInt(fs.readFileSync(path.join(dev, "max_brightness"), "utf8"), 10);
    const raw = parseInt(fs.readFileSync(path.join(dev, "brightness"), "utf8"), 10);
    if (!Number.isFinite(max) || !Number.isFinite(raw) || max <= 0) return null;
    const percent = Math.round((raw / max) * 100);
    return { percent, raw, max, devicePath: dev };
  } catch {
    return null;
  }
}

function sysfsWrite(percent, opts) {
  const dev = sysfsGetDevicePath();
  if (!dev) return { ok: false, error: "no-device" };
  const floor = opts.allowOff ? 0 : MIN_PERCENT;
  const clamped = Math.max(floor, Math.min(100, percent));
  let max;
  try {
    max = parseInt(fs.readFileSync(path.join(dev, "max_brightness"), "utf8"), 10);
  } catch {
    return { ok: false, error: "max-unreadable" };
  }
  const raw = Math.round((clamped / 100) * max);
  try {
    fs.writeFileSync(path.join(dev, "brightness"), String(raw));
  } catch (err) {
    // Most likely EACCES — udev rule missing or pi user not in video group.
    return { ok: false, error: err.code === "EACCES" ? "no-write-permission" : "write-failed" };
  }
  return { ok: true, percent: clamped, raw, max };
}

// ─── ed-ddc-server backend ──────────────────────────────────────────
// EDATEC's CLI for DDC/CI on the ED-MONITOR-101C and ED-MONITOR-156C
// industrial HDMI displays. The kernel doesn't expose these monitors
// as backlight devices because brightness lives on the panel's DDC
// channel, not in the SoC. EDATEC ships the `ed-ddcci-mib-tool`
// package which provides the `ed-ddc-server` binary; both read and
// write operate as percent 0-100 directly. See
// https://edatec.cn/docs/monitor-156c/um/3-using-the-device/
//
// No `sudo` needed. Field-validated on the SenseHat Pi (May 2026,
// EDATEC `ed-ddcci-mib-tool` 1.x): `ed-ddc-server` works as the
// `pi` user directly. The binary is either setuid-root or the
// /dev/i2c-* device node is group-readable/writable by the `i2c`
// group that the package's postinst adds the `pi` user to.
// (Earlier docs and the first cut of this file used `sudo -n`,
// which is technically still functional via password-cached or
// NOPASSWD-configured sessions but adds an unnecessary failure
// mode — a passwordless-sudo misconfiguration would silently
// disable the backend with no diagnostic. The bare command is
// strictly more robust.)

let _edDdcDetectResult = null;
function edDdcDetect() {
  if (_edDdcDetectResult !== null) return _edDdcDetectResult;
  try {
    // The actual read command — a successful invocation proves the
    // binary is installed, the i2c bus is accessible to the `pi`
    // user, and the attached monitor responds to DDC/CI. Any of
    // these missing makes the call throw and we fall through to
    // the next backend.
    execSync("ed-ddc-server brightness read", {
      timeout: ED_DDC_DETECT_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"],
    });
    _edDdcDetectResult = true;
  } catch {
    _edDdcDetectResult = false;
  }
  return _edDdcDetectResult;
}

/**
 * Parse the output of `ed-ddc-server brightness read`. Format confirmed
 * on the ED-MONITOR-156C (May 2026, EDATEC firmware shipped with the
 * `ed-ddcci-mib-tool` 1.x package):
 *
 *   Backlight: [75]
 *
 * A single line, the value 0-100 inside square brackets. We anchor on
 * the literal `Backlight:` + brackets so incidental digits elsewhere
 * in the output (device paths, i2c bus numbers, hex addresses if the
 * binary ever grows a `-v` verbose mode) can't be picked up as the
 * brightness value.
 *
 * @param {String} stdout raw command output
 * @returns {Number|null} parsed percent, or null if unparseable
 */
function edDdcParsePercent(stdout) {
  if (typeof stdout !== "string") return null;
  const m = stdout.match(/Backlight:\s*\[(\d+)\]/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return n;
}

function edDdcRead() {
  try {
    const out = execSync("ed-ddc-server brightness read", {
      timeout: ED_DDC_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString();
    const percent = edDdcParsePercent(out);
    if (percent === null) return null;
    // DDC/CI works in percent already, so raw === percent and max
    // is 100. Keep the field names consistent with the sysfs back-
    // end so the HTTP response shape doesn't change.
    return { percent, raw: percent, max: 100, devicePath: "ed-ddc-server" };
  } catch {
    return null;
  }
}

function edDdcWrite(percent, opts) {
  const floor = opts.allowOff ? 0 : MIN_PERCENT;
  const clamped = Math.max(floor, Math.min(100, Math.round(percent)));
  try {
    execSync(`ed-ddc-server brightness write -v ${clamped}`, {
      timeout: ED_DDC_TIMEOUT_MS,
      stdio: ["ignore", "ignore", "ignore"],
    });
    return { ok: true, percent: clamped, raw: clamped, max: 100 };
  } catch (err) {
    if (err && err.code === "ETIMEDOUT") return { ok: false, error: "write-timeout" };
    return { ok: false, error: "write-failed" };
  }
}

// ─── Backend selector ───────────────────────────────────────────────
// Auto-detected once at first call; results cached for the lifetime of
// the process.
//
// Order: ed-ddc-server FIRST, sysfs as fallback. The ordering matters
// because Pi OS loads the `rpi_backlight` kernel driver by default
// when the device-tree overlay is on — which is the default on
// Bookworm/Trixie — even when no DSI display is physically attached.
// The kernel happily exposes `/sys/class/backlight/rpi_backlight`
// with a max_brightness of 255, accepts writes, but the writes go
// nowhere observable: the kiosk's actual display (an HDMI panel)
// stays at full brightness while the sysfs `brightness` file dutifully
// reports whatever we wrote.
//
// Reversing the order fixes this: ed-ddc-server requires an explicit
// `apt install ed-ddcci-mib-tool` and only succeeds when a DDC/CI-
// compliant monitor responds on the i2c bus — both are strong signals
// that the user actually wants this backend. If ed-ddc-server isn't
// installed (Pi 7" DSI kiosks, mac dev box, etc.), the detect() call
// fails fast (~10 ms fork/exec of a missing binary) and we fall
// through to sysfs the way we did before.
//
// Caveat: a kiosk that has BOTH a DSI screen (sysfs is real, not
// ghost) AND an ED-MONITOR connected over HDMI would now drive only
// the HDMI panel from the slider, even though sysfs would correctly
// dim the DSI screen too. No such deployment exists in the current
// fleet; the day one shows up, we'll revisit (probably via a
// settings.json preference for the backend selector).

const BACKENDS = [
  { name: "ed-ddc-server", detect: edDdcDetect, read: edDdcRead, write: edDdcWrite },
  { name: "sysfs", detect: sysfsDetect, read: sysfsRead, write: sysfsWrite },
];

let _activeBackend = null;
let _backendResolved = false;
function getActiveBackend() {
  if (_backendResolved) return _activeBackend;
  _backendResolved = true;
  for (const b of BACKENDS) {
    try {
      if (b.detect()) {
        _activeBackend = b;
        console.log(`[brightness] active backend: ${b.name}`);
        return b;
      }
    } catch (err) {
      console.warn(`[brightness] backend ${b.name} detect threw:`, err && err.message);
    }
  }
  console.log("[brightness] no backend available");
  return null;
}

/**
 * Read current brightness state via the active backend.
 *
 * @returns {Object|null} {percent, raw, max, devicePath} or null if no backend
 */
function readBrightness() {
  const b = getActiveBackend();
  return b ? b.read() : null;
}

/**
 * Write a new brightness in percent. Floors at MIN_PERCENT by default to
 * prevent accidental black screens (someone yanking the slider to 0
 * during normal use and thinking the display is broken). The sleep-mode
 * stage-2 path needs to bypass this floor: a fully-off backlight is the
 * cleanest mitigation for LCD backlight bleed and there's no risk of
 * mistaking it for a fault since the user explicitly opted in via the
 * sleep-mode settings.
 *
 * @param {Number} percent 0-100
 * @param {Object} [opts]
 * @param {Boolean} [opts.allowOff] When true, lower bound becomes 0 instead
 *   of MIN_PERCENT. Used by the sleep-mode stage-2 transition.
 * @returns {Object} {ok, percent, raw, max, error?}
 */
function writeBrightness(percent, opts = {}) {
  if (typeof percent !== "number" || !Number.isFinite(percent)) {
    return { ok: false, error: "invalid-percent" };
  }
  const b = getActiveBackend();
  if (!b) return { ok: false, error: "no-device" };
  return b.write(percent, opts);
}

/**
 * GET /api/brightness — returns current state.
 *
 * @param {Object} req
 * @param {Object} res
 */
function getBrightness(req, res) {
  const state = readBrightness();
  if (!state) {
    return res.status(200).json({ available: false }).end();
  }
  return res.status(200).json({ available: true, ...state, minPercent: MIN_PERCENT }).end();
}

/**
 * POST /api/brightness — body { percent: 0-100, allowOff?: boolean }.
 * Floors at MIN_PERCENT by default; pass allowOff: true to allow values
 * below MIN_PERCENT (down to 0). Used by the sleep-mode stage-2 path
 * which intentionally turns the backlight off for LCD-bleed mitigation.
 *
 * @param {Object} req
 * @param {Object} res
 */
function setBrightness(req, res) {
  const { percent, allowOff } = req.body || {};
  if (typeof percent !== "number") {
    return res.status(400).json({ error: "Body must be { percent: <number> }" }).end();
  }
  const result = writeBrightness(percent, { allowOff: allowOff === true });
  if (!result.ok) {
    const status = result.error === "no-device" ? 503
                 : result.error === "no-write-permission" ? 403
                 : result.error === "invalid-percent" ? 400
                 : result.error === "write-timeout" ? 504
                 : 500;
    return res.status(status).json({ error: result.error }).end();
  }
  return res.status(200).json(result).end();
}

module.exports = {
  getBrightness,
  setBrightness,
  readBrightness,
  writeBrightness,
  MIN_PERCENT,
  // Exported for regression testing only — internal helpers, not part
  // of the public surface.
  __test: {
    edDdcParsePercent,
  },
};
