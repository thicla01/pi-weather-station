"use strict";

/**
 * sensehatModeCtrl.js
 *
 * Two endpoints + a boot hook for the Sense HAT display-mode toggle.
 *
 *   GET  /api/sensehat-available
 *     Probes once whether the host has a Sense HAT — runs
 *     `python3 -c "import sense_hat"` and caches the result. Returns
 *     `{available: boolean}`. Used by the v3 SettingsPanel to hide
 *     the toggle on the 6 Pis in the fleet that don't have the HAT.
 *
 *   GET  /api/sensehat-mode
 *     Returns the current mode `{mode: "weather"|"clock"|"radar"|"auto"}`.
 *     Reads from `advanced.sensehat.mode` in settings.json with the
 *     "weather" default.
 *
 *   POST /api/sensehat-mode  body: {mode: "weather"|"clock"|"radar"|"auto"}
 *     Persists the new mode in settings.json AND switches the systemd
 *     user services: the clock daemon for "clock", the weather daemon
 *     for "weather"/"radar"/"auto" (those three share one service and
 *     only differ in the script's per-poll personality, so switching
 *     among them is a settings write the script picks up within a poll).
 *     Idempotent — flipping to the already-active mode just refreshes
 *     the systemctl state. Locked behind `localhostOnly` because
 *     systemctl --user starts a process on the kiosk; we don't want
 *     a remote client to be able to flip the Sense HAT display.
 *
 *   applySenseHatModeOnBoot()
 *     Called once from server/index.js after settingsCtrl is ready.
 *     Reads the persisted mode and runs systemctl to make systemd
 *     state match. Without this, a Pi reboot would always leave the
 *     weather service active (its [Install] WantedBy=default.target
 *     enables it) regardless of what the user last selected.
 */

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { getSettingsData, patchAdvancedSubKey } = require("./settingsCtrl");

const execFileAsync = promisify(execFile);

// Four display modes. "clock" is the only one backed by its own service
// (pi-sensehat-clock.service / horloge.py); "weather", "radar" and "auto"
// all run pi-sensehat.service / sensehat_weather.py and differ only in the
// personality the script picks each poll from the `mode` field of
// /api/sensehat — so flipping between those three needs no service restart.
//   - weather : weather glyphs only, radar never lit
//   - radar   : radar grid whenever echoes are present, centre dot when clear
//   - auto    : alert > precip-on-me (glyph) > radar "incoming" > sky
const VALID_MODES = ["weather", "clock", "radar", "auto"];
// Modes served by the weather daemon (everything except the clock).
const WEATHER_MODES = ["weather", "radar", "auto"];
const DEFAULT_MODE = "weather";
const WEATHER_SERVICE = "pi-sensehat.service";
const CLOCK_SERVICE = "pi-sensehat-clock.service";
// Default for `advanced.sensehat.clockBrightness` if absent. Mirrors
// the DEFAULT_BRIGHTNESS_PERCENT constant in tools/horloge.py — kept
// in sync manually since the two run in different language runtimes.
const DEFAULT_CLOCK_BRIGHTNESS = 50;
// Default for `advanced.sensehat.radarBrightness` — the brightness
// multiplier (percent) for the radar grid, applied in BOTH day and night
// (like the clock). Mirrors BRIGHTNESS_RADAR_DEFAULT (0.6) in
// tools/sensehat_weather.py. The daemon re-reads this from settings.json
// live (no restart). The client slider is pinned to a 20 % minimum (the
// heavier tiers stay visible there; below ~15 % the matrix goes black on
// both v1 and v2).
const DEFAULT_RADAR_BRIGHTNESS = 60;

// Detection caching — physical attachment of the HAT doesn't change at
// runtime, so the sysfs scan runs once and is cached forever.
let _availableCached = null;
let _availableResolved = false;

/**
 * Detect whether a Sense HAT is *physically present* by scanning sysfs for
 * its LED-matrix framebuffer — a framebuffer whose `name` or backing driver
 * mentions "sense" (e.g. "RPi-Sense FB" / "rpisense-fb").
 *
 * This checks the HARDWARE, not the `sense_hat` Python module. The previous
 * probe ran `python3 -c "import sense_hat"`, which succeeds on any host where
 * the `sense-hat` apt package is installed — including Pis with NO HAT
 * attached (the module imports fine; only `SenseHat()` touches the device,
 * and `deploy/install.sh` apt-installs the package during setup). That made
 * the Settings panel render the Sense HAT block on the HAT-less Pis in the
 * fleet. We mirror the daemon's `_find_sensehat_fb` sysfs check but
 * deliberately DROP its `/dev/fb0` fallback: fb0 is the HDMI/DSI framebuffer
 * present on every Pi, so the fallback would report "present" everywhere.
 *
 * Side-effect-free (no subprocess, no device open → can't contend with the
 * running daemon). On a host with no sysfs (e.g. the macOS dev box) the
 * readdir throws and we return false, which is correct — no HAT there.
 *
 * @param {string} [graphicsDir] sysfs graphics dir (overridable for tests)
 * @returns {boolean}
 */
function detectSenseHatHardware(graphicsDir = "/sys/class/graphics") {
  let entries;
  try {
    entries = fs.readdirSync(graphicsDir);
  } catch {
    return false; // no sysfs (non-Linux dev host) → no HAT
  }
  for (const fb of entries) {
    if (!fb.startsWith("fb")) continue;
    const base = `${graphicsDir}/${fb}`;
    try {
      if (fs.readFileSync(`${base}/name`, "utf8").toLowerCase().includes("sense")) return true;
    } catch { /* fb has no readable name file */ }
    try {
      // Match on the driver's basename only (e.g. "rpisense-fb"), like the
      // daemon's os.path.basename(os.readlink(...)) — NOT the full symlink
      // target path, whose parent dirs could coincidentally contain "sense".
      if (path.basename(fs.readlinkSync(`${base}/device/driver`)).toLowerCase().includes("sense")) return true;
    } catch { /* fb has no driver symlink */ }
  }
  return false;
}

/**
 * Detect the Sense HAT board revision from its ID-EEPROM `product_ver`,
 * exposed by the device-tree at `/proc/device-tree/hat/product_ver`. Confirmed
 * empirically across both fleet boards: v1 reports `0x0001`, v2 `0x0002` (both
 * share `product_id 0x0001`). The official v2's hardware delta is an added
 * colour sensor at I2C 0x39 + this version bump — the LED matrix and IMU are
 * unchanged, so this is purely informational (surfaced in the Debug panel).
 *
 * The device-tree node stores the value as the ASCII string "0x0001"/"0x0002"
 * (NUL-terminated), so we read it as text and parse the hex.
 *
 * @param {string} [productVerPath] path to the product_ver node (overridable for tests)
 * @returns {("v1"|"v2"|string|null)} "v1"/"v2" for known revisions, the raw hex
 *   for an unrecognised one, or null when there's no HAT EEPROM (non-Pi / no HAT)
 */
function detectSenseHatVersion(productVerPath = "/proc/device-tree/hat/product_ver") {
  let raw;
  try {
    raw = fs.readFileSync(productVerPath, "utf8").replace(/\0/g, "").trim();
  } catch {
    return null; // no HAT EEPROM (non-Pi, or no HAT attached)
  }
  const n = parseInt(raw, 16);
  if (n === 1) return "v1";
  if (n === 2) return "v2";
  return raw || null; // unrecognised revision — surface the raw value
}

/**
 * Resolve (and cache) whether the Sense HAT hardware is present.
 *
 * @returns {Promise<boolean>}
 */
async function probeAvailable() {
  if (_availableResolved) return _availableCached;
  _availableResolved = true;
  _availableCached = detectSenseHatHardware();
  return _availableCached;
}

/**
 * Resolve the display mode from an already-loaded settings object, applying
 * the VALID_MODES whitelist and DEFAULT_MODE fallback. Pure — no I/O — so
 * other controllers that already hold `settings` (e.g. sensehatCtrl) can
 * reuse the same validation without a second settings read.
 *
 * @param {object} settings parsed settings.json (or null/partial)
 * @returns {"weather"|"clock"|"radar"|"auto"}
 */
function resolveMode(settings) {
  const m = settings && settings.advanced && settings.advanced.sensehat && settings.advanced.sensehat.mode;
  return VALID_MODES.includes(m) ? m : DEFAULT_MODE;
}

/**
 * Read the persisted mode from settings.json. Falls back to
 * DEFAULT_MODE when the setting is missing OR unparseable.
 *
 * @returns {Promise<"weather"|"clock"|"radar"|"auto">}
 */
async function readPersistedMode() {
  try {
    return resolveMode(await getSettingsData());
  } catch {
    return DEFAULT_MODE;
  }
}

/**
 * Read the persisted clock brightness from settings.json. Falls back
 * to DEFAULT_CLOCK_BRIGHTNESS (50%) on any missing / unparseable
 * value.
 *
 * @returns {Promise<number>} integer 0-100
 */
async function readPersistedBrightness() {
  try {
    const settings = await getSettingsData();
    const v = settings && settings.advanced && settings.advanced.sensehat && settings.advanced.sensehat.clockBrightness;
    if (typeof v === "number" && v >= 0 && v <= 100) return Math.round(v);
  } catch {
    /* fall through */
  }
  return DEFAULT_CLOCK_BRIGHTNESS;
}

/**
 * Resolve the radar brightness percent from an already-loaded settings
 * object (pure, no I/O) so sensehatCtrl can fold it into /api/sensehat without
 * a second read. Falls back to DEFAULT_RADAR_BRIGHTNESS (60%).
 *
 * @param {object} settings parsed settings.json (or null/partial)
 * @returns {number} integer 0-100
 */
function resolveRadarBrightness(settings) {
  const v = settings && settings.advanced && settings.advanced.sensehat && settings.advanced.sensehat.radarBrightness;
  if (typeof v === "number" && v >= 0 && v <= 100) return Math.round(v);
  return DEFAULT_RADAR_BRIGHTNESS;
}

/**
 * Read the persisted radar brightness from settings.json. Falls back to
 * DEFAULT_RADAR_BRIGHTNESS (60%) on any missing / unparseable value.
 *
 * @returns {Promise<number>} integer 0-100
 */
async function readPersistedRadarBrightness() {
  try {
    return resolveRadarBrightness(await getSettingsData());
  } catch {
    return DEFAULT_RADAR_BRIGHTNESS;
  }
}

/**
 * Merge a partial sensehat config into `advanced.sensehat` of settings.json.
 * Only keys present in `patch` get written, so calling with `{mode: "clock"}`
 * doesn't reset the clockBrightness already saved.
 *
 * Routed through settingsCtrl.patchAdvancedSubKey so settings.json has a
 * single owning module: the write respects the key whitelist + the 0600 file
 * mode and is serialised against other internal writes. Previously this wrote
 * the file directly with raw `fs`, a second unsynchronised writer that
 * bypassed all of that.
 *
 * @param {object} patch e.g. {mode: "clock"} or {clockBrightness: 70}
 * @returns {Promise<void>}
 */
async function persistSensehat(patch) {
  await patchAdvancedSubKey("sensehat", patch);
}

/**
 * Apply the mode at the systemd level. Stops the inactive service
 * first (so the LED matrix is released), then starts the active
 * one. The order matters: starting first then stopping would briefly
 * have both daemons writing to the matrix.
 *
 * `systemctl --user` runs as the same user the server runs as (pi),
 * no sudo needed. Errors are non-fatal — log + continue, so a stale
 * unit file doesn't break the API call.
 *
 * @param {"weather"|"clock"|"radar"|"auto"} mode
 */
async function applyMode(mode) {
  // Only "clock" runs the clock daemon; weather/radar/auto all run the
  // weather daemon and differ purely in the script's per-poll personality.
  const wantsClock = mode === "clock";
  const target = wantsClock ? CLOCK_SERVICE : WEATHER_SERVICE;
  const other = wantsClock ? WEATHER_SERVICE : CLOCK_SERVICE;
  try {
    await execFileAsync("systemctl", ["--user", "stop", other], { timeout: 10_000 });
  } catch (err) {
    // "Unit not loaded" is fine — the user may not have installed the
    // counterpart service yet. Other failures get logged but don't
    // block the start of the target service.
    console.log(`[sensehat-mode] stop ${other}: ${err && err.message ? err.message.split("\n")[0] : "ok"}`);
  }
  try {
    await execFileAsync("systemctl", ["--user", "start", target], { timeout: 10_000 });
  } catch (err) {
    throw new Error(`failed to start ${target}: ${err && err.message ? err.message.split("\n")[0] : "unknown"}`);
  }
}

/**
 * Boot hook: re-applies the persisted mode at server start so a
 * reboot doesn't drop the user's selection. Idempotent.
 * Skipped silently when the HAT isn't available.
 */
async function applySenseHatModeOnBoot() {
  if (!(await probeAvailable())) return;
  const mode = await readPersistedMode();
  try {
    await applyMode(mode);
    console.log(`[sensehat-mode] boot: applied mode=${mode}`);
  } catch (err) {
    console.warn(`[sensehat-mode] boot: ${err.message}`);
  }
}

// ─── HTTP handlers ──────────────────────────────────────────────────

/**
 * GET /api/sensehat-available
 */
async function getSenseHatAvailable(req, res) {
  const available = await probeAvailable();
  return res.status(200).json({ available }).end();
}

/**
 * GET /api/sensehat-mode
 */
async function getSenseHatMode(req, res) {
  const mode = await readPersistedMode();
  return res.status(200).json({ mode }).end();
}

/**
 * POST /api/sensehat-mode
 */
async function setSenseHatMode(req, res) {
  const { mode } = req.body || {};
  if (!VALID_MODES.includes(mode)) {
    return res.status(400).json({ error: `mode must be one of: ${VALID_MODES.join(", ")}` }).end();
  }
  if (!(await probeAvailable())) {
    return res.status(503).json({ error: "Sense HAT not detected on this host" }).end();
  }
  try {
    await persistSensehat({ mode });
    await applyMode(mode);
    return res.status(200).json({ mode }).end();
  } catch (err) {
    return res.status(500).json({ error: err.message }).end();
  }
}

/**
 * Check whether pi-sensehat-clock.service is currently active.
 *
 * @returns {Promise<boolean>}
 */
async function isClockServiceActive() {
  try {
    // systemctl --user is-active exits 0 with "active" / non-zero with
    // "inactive" / "failed" / etc. We swallow the non-zero and read
    // the stdout to disambiguate.
    const { stdout } = await execFileAsync("systemctl", ["--user", "is-active", CLOCK_SERVICE], { timeout: 5_000 });
    return stdout.trim() === "active";
  } catch (err) {
    // Non-zero exit lands here too. Check the stdout when present.
    if (err && err.stdout && err.stdout.trim() === "active") return true;
    return false;
  }
}

/**
 * GET /api/sensehat-clock-brightness
 */
async function getClockBrightness(req, res) {
  const brightness = await readPersistedBrightness();
  return res.status(200).json({ brightness }).end();
}

/**
 * POST /api/sensehat-clock-brightness  body: {brightness: 0-100}
 *
 * Persists the new value. Restarts pi-sensehat-clock.service only
 * when it's currently active — the script reads the value at start,
 * so a restart is how the change takes effect immediately. When
 * the clock service isn't running (weather mode), we skip the
 * restart; the new value will be picked up the next time the user
 * flips to clock mode.
 */
async function setClockBrightness(req, res) {
  const { brightness } = req.body || {};
  if (typeof brightness !== "number" || !Number.isFinite(brightness) || brightness < 0 || brightness > 100) {
    return res.status(400).json({ error: "brightness must be a number 0-100" }).end();
  }
  if (!(await probeAvailable())) {
    return res.status(503).json({ error: "Sense HAT not detected on this host" }).end();
  }
  const rounded = Math.round(brightness);
  try {
    await persistSensehat({ clockBrightness: rounded });
    if (await isClockServiceActive()) {
      try {
        await execFileAsync("systemctl", ["--user", "restart", CLOCK_SERVICE], { timeout: 10_000 });
      } catch (err) {
        // Persisted, but couldn't restart — the next start will pick
        // up the value. Surface as a partial success.
        return res.status(200).json({ brightness: rounded, restarted: false, warning: err.message }).end();
      }
      return res.status(200).json({ brightness: rounded, restarted: true }).end();
    }
    return res.status(200).json({ brightness: rounded, restarted: false }).end();
  } catch (err) {
    return res.status(500).json({ error: err.message }).end();
  }
}

/**
 * GET /api/sensehat-radar-brightness
 */
async function getRadarBrightness(req, res) {
  const brightness = await readPersistedRadarBrightness();
  return res.status(200).json({ brightness }).end();
}

/**
 * POST /api/sensehat-radar-brightness  body: {brightness: 0-100}
 *
 * Persists the radar brightness — and does NOT restart the service.
 * Unlike the clock, the weather/radar daemon re-reads radarBrightness from
 * settings.json live on a ~1 s cadence (read_radar_brightness in
 * sensehat_weather.py), so the slider takes effect without a restart. The
 * previous restart-on-change left a stuck black frame when restarts
 * overlapped on fast slider moves (most visible on the v1 HAT).
 */
async function setRadarBrightness(req, res) {
  const { brightness } = req.body || {};
  if (typeof brightness !== "number" || !Number.isFinite(brightness) || brightness < 0 || brightness > 100) {
    return res.status(400).json({ error: "brightness must be a number 0-100" }).end();
  }
  if (!(await probeAvailable())) {
    return res.status(503).json({ error: "Sense HAT not detected on this host" }).end();
  }
  const rounded = Math.round(brightness);
  try {
    await persistSensehat({ radarBrightness: rounded });
    return res.status(200).json({ brightness: rounded }).end();
  } catch (err) {
    return res.status(500).json({ error: err.message }).end();
  }
}

module.exports = {
  getSenseHatAvailable,
  getSenseHatMode,
  setSenseHatMode,
  getClockBrightness,
  setClockBrightness,
  getRadarBrightness,
  setRadarBrightness,
  applySenseHatModeOnBoot,
  resolveMode,
  resolveRadarBrightness,
  detectSenseHatVersion,
  WEATHER_MODES,
  // Exported for regression testing only.
  __test: {
    VALID_MODES,
    DEFAULT_MODE,
    DEFAULT_CLOCK_BRIGHTNESS,
    DEFAULT_RADAR_BRIGHTNESS,
    detectSenseHatHardware,
    detectSenseHatVersion,
  },
};
