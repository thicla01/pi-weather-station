// Wake-from-sleep brightness restore: verification + bounded retry policy,
// plus the guard that never adopts a dark panel as the user's brightness
// (`resolveUserBrightness`, further down).
//
// Background: the screensaver dims the backlight on the way into sleep
// (stage 1 → dim, stage 2 → fully off via `allowOff: true`). On wake we
// write the pre-sleep brightness back. That single write is best-effort and
// can silently fail to land on the hardware — most notably on the EDATEC
// ED-MONITOR series, whose brightness rides a DDC/CI i2c channel: a
// transient bus timeout makes `ed-ddc-server brightness write` fail, the
// server returns 504, the client swallows it, and the panel is left at the
// stage-2 value (0 = black). The user then has no on-screen way back — only
// the monitor's physical brightness buttons recover it.
//
// Fix: after writing, read the brightness back and, if the screen is still
// darker than we asked for, write again — up to a hard cap so a panel that
// genuinely can't reach the target never loops forever. `nextRestoreAction`
// is the pure decision at the centre of that loop; the async orchestration
// (POST / settle / GET) lives in the App effect.
//
// Caveat (sysfs backend): a `/sys/class/backlight` read reflects the value
// we WROTE, not whether the panel physically lit — so this catches a failed
// write but not a panel blanked by bl_power / DPMS with a correct value on
// file. That case (if it ever surfaces on the 7" DSI) is a separate fix.
//
// MODULE FORMAT: CommonJS on purpose (like `ui/autoTabSelector.js`) so the
// `node --test` runner can `require()` the REAL module — no verbatim copy to
// drift out of sync. Webpack imports CJS into the ESM client fine, so the
// App effect and `hooks/useScreenSaver.js` can import from
// "~/services/brightnessRestore".

// Hard cap on wake-restore writes before giving up. Guards against an
// infinite loop on a panel that can never reach the target.
const RESTORE_MAX_ATTEMPTS = 4;

// Tolerance (percentage points) between the requested and read-back
// brightness below which the restore is considered landed. Covers backends
// that round: sysfs reports `round(raw / max * 100)`, and a DDC/CI monitor
// may snap to its own step.
const RESTORE_TOLERANCE_PERCENT = 3;

// Settle delay (ms) between writing and reading brightness back. DDC/CI
// writes can take up to ~400 ms on real hardware; sysfs is effectively
// instant, so this only adds latency on the (rare) retry path.
const RESTORE_SETTLE_MS = 400;

/**
 * Decide what to do after a wake-restore write, given the value read back.
 * Pure so the retry policy (success threshold + attempt cap) is unit-
 * testable without touching the network or timers.
 *
 * @param {object} p parameters
 * @param {Number} p.target brightness percent we asked the hardware for
 * @param {Number|null} p.observed brightness percent read back, or null if
 *   the read failed / the device exposes no controllable backlight
 * @param {Number} p.attemptsMade writes performed so far (>= 1)
 * @param {Number} [p.maxAttempts] hard cap on attempts
 * @param {Number} [p.tolerance] success tolerance in percentage points
 * @returns {String} `"done"`, `"retry"`, or `"giveup"`
 */
function nextRestoreAction({
  target,
  observed,
  attemptsMade,
  maxAttempts = RESTORE_MAX_ATTEMPTS,
  tolerance = RESTORE_TOLERANCE_PERCENT,
}) {
  // Can't verify (GET failed, or no backlight on this hardware). Best-
  // effort: stop rather than hammer a device that can't report back.
  if (typeof observed !== "number") return "giveup";
  // Screen is at (or above) the requested level, within rounding — done.
  if (observed >= target - tolerance) return "done";
  // Still too dark, but out of attempts — give up rather than loop.
  if (attemptsMade >= maxAttempts) return "giveup";
  return "retry";
}

// ─── Never adopt darkness as the user's brightness ─────────────────
//
// Background (incident 2026-10-11, six kiosks): the pre-sleep brightness
// lives only in the App's page memory, and stage 2 leaves the panel at 0.
// A page reloaded during stage 2 (kiosk relaunch, in-app update, refresh
// button) started awake, read `GET /api/brightness` = 0 and adopted it as
// the user's setting: the screen stayed black, the next stage 1 captured
// 0 as the pre-sleep value, and every later wake "restored" 0 — verified,
// so the retry above didn't help. The slider never goes below the server's
// floor (`minPercent`, MIN_PERCENT = 10 in `server/brightnessCtrl.js`);
// only the stage-2 `allowOff` write does. A value below the floor is
// therefore "the panel was left dark", never something the user chose.
//
// So the client keeps the last value the user chose with the slider in
// localStorage (per device, like the other display prefs) and falls back
// to it, then to a fixed default, whenever the value it would otherwise
// adopt or restore is below the floor.

// Brightness the screen relights to when the panel is found dark and this
// device has no stored slider value — the level the maintainer chose when
// restoring the fleet after the 2026-10-11 incident.
const DEFAULT_RESTORE_BRIGHTNESS_PERCENT = 70;

// Floor used when the server's `minPercent` is missing or malformed.
// Mirrors MIN_PERCENT in `server/brightnessCtrl.js` and the initial
// `brightnessMinPercent` in `hooks/useScreenSaver.js`.
const DEFAULT_MIN_BRIGHTNESS_PERCENT = 10;

const MAX_BRIGHTNESS_PERCENT = 100;

// localStorage key holding the last brightness the user chose with the
// Settings slider. Written ONLY from the slider: sleep-driven values
// (stage-1 dim, stage-2 off, wake restore, boot relight) never land here.
const LAST_USER_BRIGHTNESS_STORAGE_KEY = "lastUserBrightness";

// Hostnames the kiosk loads the app from (`deploy/start-server` always opens
// `localhost`). `POST /api/brightness` is localhost-only on the server; a
// remote viewer's write would be refused AND logged as a security event.
const LOOPBACK_HOSTNAMES = ["localhost", "127.0.0.1", "[::1]"];

/**
 * True when `v` is a finite number within [floor, 100].
 *
 * @param {Number|null|undefined} v candidate brightness percent (any value is checked)
 * @param {Number} floor lowest accepted percent
 * @returns {Boolean} whether `v` is a usable brightness
 */
function isPercentInRange(v, floor) {
  return typeof v === "number" && Number.isFinite(v)
    && v >= floor && v <= MAX_BRIGHTNESS_PERCENT;
}

/**
 * The brightness to treat as the user's setting, never below the floor.
 * Pure so every branch is unit-testable.
 *
 * Order: the reading (or in-memory value) when it is within
 * [minPercent, 100]; else a valid stored slider value; else `fallback`.
 * The result is always within [minPercent, 100].
 *
 * Known corner: a sysfs backlight with an unusual `max_brightness` (11-14,
 * 22-24, 32-34, …) reads a 10 % setting back as 7-9 %, which this treats as
 * dark. Harmless once the slider has stored the value (it resolves to that
 * same 10); before that, the screen relights to `fallback` once.
 *
 * @param {object} p parameters
 * @param {Number|null|undefined} p.percent current brightness (server reading or React state)
 * @param {Number|null} [p.minPercent] the server's floor; defaults to
 *   DEFAULT_MIN_BRIGHTNESS_PERCENT when not a finite number
 * @param {Number|null} [p.stored] last value the user chose with the slider
 *   (see `readLastUserBrightness`), or null
 * @param {Number} [p.fallback] used when neither of the above is valid
 * @returns {Number} a brightness percent within [minPercent, 100]
 */
function resolveUserBrightness({
  percent,
  minPercent,
  stored,
  fallback = DEFAULT_RESTORE_BRIGHTNESS_PERCENT,
}) {
  const floor = typeof minPercent === "number" && Number.isFinite(minPercent)
    ? Math.min(MAX_BRIGHTNESS_PERCENT, Math.max(0, minPercent))
    : DEFAULT_MIN_BRIGHTNESS_PERCENT;
  if (isPercentInRange(percent, floor)) return percent;
  if (isPercentInRange(stored, floor)) return stored;
  const base = typeof fallback === "number" && Number.isFinite(fallback)
    ? fallback
    : DEFAULT_RESTORE_BRIGHTNESS_PERCENT;
  return Math.min(MAX_BRIGHTNESS_PERCENT, Math.max(floor, base));
}

/**
 * Read the last brightness the user chose with the slider. Never throws:
 * localStorage can be missing (node, private mode) or throw (blocked
 * storage, a leveldb store torn by a power cut).
 *
 * @param {object} [storage] a Storage-like object; defaults to the
 *   browser's localStorage
 * @returns {Number|null} the stored number, or null when absent/unreadable
 *   (range validation is `resolveUserBrightness`'s job)
 */
function readLastUserBrightness(storage) {
  try {
    const store = storage === undefined ? globalThis.localStorage : storage;
    if (!store) return null;
    const raw = store.getItem(LAST_USER_BRIGHTNESS_STORAGE_KEY);
    if (raw === null || raw === undefined || raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * Remember the brightness the user just chose with the slider. Call it from
 * the slider path only. Never throws (see `readLastUserBrightness`).
 *
 * @param {Number} percent the chosen brightness percent
 * @param {object} [storage] a Storage-like object; defaults to the
 *   browser's localStorage
 * @returns {Boolean} true when the value was written
 */
function writeLastUserBrightness(percent, storage) {
  if (typeof percent !== "number" || !Number.isFinite(percent)) return false;
  try {
    const store = storage === undefined ? globalThis.localStorage : storage;
    if (!store) return false;
    store.setItem(LAST_USER_BRIGHTNESS_STORAGE_KEY, String(percent));
    return true;
  } catch {
    return false;
  }
}

/**
 * True when the page was loaded from a loopback hostname — the kiosk's own
 * browser, or an SSH tunnel. A page loaded from the Pi's LAN address is a
 * remote viewer whose `POST /api/brightness` the server's localhost-only
 * gate refuses (it checks the socket peer; this is only a client-side hint
 * to avoid sending a write that can't land).
 *
 * @param {String|null|undefined} hostname `window.location.hostname`
 * @returns {Boolean} whether brightness writes from this page can land
 */
function isLoopbackHostname(hostname) {
  return typeof hostname === "string"
    && LOOPBACK_HOSTNAMES.includes(hostname.toLowerCase());
}

module.exports = {
  RESTORE_MAX_ATTEMPTS,
  RESTORE_TOLERANCE_PERCENT,
  RESTORE_SETTLE_MS,
  DEFAULT_RESTORE_BRIGHTNESS_PERCENT,
  DEFAULT_MIN_BRIGHTNESS_PERCENT,
  LAST_USER_BRIGHTNESS_STORAGE_KEY,
  nextRestoreAction,
  resolveUserBrightness,
  readLastUserBrightness,
  writeLastUserBrightness,
  isLoopbackHostname,
};
