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
 *     Returns the current mode `{mode: "weather" | "clock"}`. Reads
 *     from `advanced.sensehat.mode` in settings.json with the
 *     "weather" default.
 *
 *   POST /api/sensehat-mode  body: {mode: "weather" | "clock"}
 *     Persists the new mode in settings.json AND switches the
 *     systemd user services: starts the new one, stops the other.
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

const { execFile } = require("child_process");
const { promisify } = require("util");
const { getSettingsData } = require("./settingsCtrl");

const execFileAsync = promisify(execFile);

const VALID_MODES = ["weather", "clock"];
const DEFAULT_MODE = "weather";
const WEATHER_SERVICE = "pi-sensehat.service";
const CLOCK_SERVICE = "pi-sensehat-clock.service";
// Default for `advanced.sensehat.clockBrightness` if absent. Mirrors
// the DEFAULT_BRIGHTNESS_PERCENT constant in tools/horloge.py — kept
// in sync manually since the two run in different language runtimes.
const DEFAULT_CLOCK_BRIGHTNESS = 50;

// Detection caching — `import sense_hat` is a non-trivial probe
// (~150 ms on a Pi 4, longer on first import after boot due to
// kernel module load). Cache forever; physical attachment of the
// HAT doesn't change at runtime.
let _availableCached = null;
let _availableResolved = false;

/**
 * Probe the Sense HAT availability by attempting to import its
 * Python module. Caches the result.
 *
 * @returns {Promise<boolean>}
 */
async function probeAvailable() {
  if (_availableResolved) return _availableCached;
  _availableResolved = true;
  try {
    await execFileAsync("python3", ["-c", "import sense_hat"], { timeout: 5_000 });
    _availableCached = true;
  } catch {
    _availableCached = false;
  }
  return _availableCached;
}

/**
 * Read the persisted mode from settings.json. Falls back to
 * DEFAULT_MODE when the setting is missing OR unparseable.
 *
 * @returns {Promise<"weather"|"clock">}
 */
async function readPersistedMode() {
  try {
    const settings = await getSettingsData();
    const m = settings && settings.advanced && settings.advanced.sensehat && settings.advanced.sensehat.mode;
    return VALID_MODES.includes(m) ? m : DEFAULT_MODE;
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
 * Merge a partial sensehat config into settings.json. The body is
 * spread into `advanced.sensehat` — only keys present in `patch` get
 * written, so calling with `{mode: "clock"}` doesn't reset the
 * clockBrightness already saved.
 *
 * Bypasses the HTTP /api/settings round-trip to keep the toggle's
 * latency low (one file write instead of three HTTP calls).
 *
 * @param {object} patch e.g. {mode: "clock"} or {clockBrightness: 70}
 */
async function persistSensehat(patch) {
  const fs = require("fs");
  const path = require("path");
  const FILE = path.join(__dirname, "..", "settings.json");
  let existing = {};
  try {
    existing = JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    /* fresh install / unreadable — start from {} */
  }
  if (!existing.advanced || typeof existing.advanced !== "object") existing.advanced = {};
  if (!existing.advanced.sensehat || typeof existing.advanced.sensehat !== "object") {
    existing.advanced.sensehat = {};
  }
  Object.assign(existing.advanced.sensehat, patch);
  fs.writeFileSync(FILE, JSON.stringify(existing), "utf8");
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
 * @param {"weather"|"clock"} mode
 */
async function applyMode(mode) {
  const target = mode === "weather" ? WEATHER_SERVICE : CLOCK_SERVICE;
  const other = mode === "weather" ? CLOCK_SERVICE : WEATHER_SERVICE;
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

module.exports = {
  getSenseHatAvailable,
  getSenseHatMode,
  setSenseHatMode,
  getClockBrightness,
  setClockBrightness,
  applySenseHatModeOnBoot,
  // Exported for regression testing only.
  __test: {
    VALID_MODES,
    DEFAULT_MODE,
    DEFAULT_CLOCK_BRIGHTNESS,
  },
};
