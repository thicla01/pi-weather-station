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
 * Write the new mode into settings.json via the same atomic-replace
 * machinery the v3 SettingsPanel uses. Uses settingsCtrl directly
 * to avoid bouncing through the HTTP layer.
 *
 * @param {"weather"|"clock"} mode
 */
async function persistMode(mode) {
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
  existing.advanced.sensehat.mode = mode;
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
    await persistMode(mode);
    await applyMode(mode);
    return res.status(200).json({ mode }).end();
  } catch (err) {
    return res.status(500).json({ error: err.message }).end();
  }
}

module.exports = {
  getSenseHatAvailable,
  getSenseHatMode,
  setSenseHatMode,
  applySenseHatModeOnBoot,
  // Exported for regression testing only.
  __test: {
    VALID_MODES,
    DEFAULT_MODE,
  },
};
