const fs = require("fs");
const path = require("path");

const BACKLIGHT_ROOT = "/sys/class/backlight";
// Floor at 10% of max so the user can never accidentally make the screen
// completely black via the slider — they'd lose the means to recover
// without SSH. 10% is dim but still readable in a normal room.
const MIN_PERCENT = 10;

/**
 * Find the first backlight device exposed by the kernel. Cached for the
 * lifetime of the process — the path doesn't change at runtime once the
 * kernel exposes it.
 *
 * @returns {String|null} Absolute path to the device dir, or null if none
 */
let _cachedDevicePath = null;
let _cachedDevicePathResolved = false;
function getDevicePath() {
  if (_cachedDevicePathResolved) return _cachedDevicePath;
  _cachedDevicePathResolved = true;
  try {
    const entries = fs.readdirSync(BACKLIGHT_ROOT);
    if (entries.length === 0) return (_cachedDevicePath = null);
    // First entry wins. Most systems expose only one backlight; if there
    // are several (rare), the first one is typically the primary panel.
    _cachedDevicePath = path.join(BACKLIGHT_ROOT, entries[0]);
    return _cachedDevicePath;
  } catch {
    // Directory doesn't exist (macOS, x86 without backlight, missing
    // dtoverlay on Pi). Return null and let callers handle it.
    return (_cachedDevicePath = null);
  }
}

/**
 * Read current brightness state.
 *
 * @returns {Object|null} {percent, raw, max, devicePath} or null if no device
 */
function readBrightness() {
  const dev = getDevicePath();
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
  const dev = getDevicePath();
  if (!dev) return { ok: false, error: "no-device" };
  if (typeof percent !== "number" || !Number.isFinite(percent)) {
    return { ok: false, error: "invalid-percent" };
  }
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
                 : 500;
    return res.status(status).json({ error: result.error }).end();
  }
  return res.status(200).json(result).end();
}

module.exports = { getBrightness, setBrightness, readBrightness, writeBrightness, MIN_PERCENT };
