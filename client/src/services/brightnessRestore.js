// Wake-from-sleep brightness restore: verification + bounded retry policy,
// plus the guards that keep a page reload during sleep from leaving the
// screen dark (`resolveUserBrightness`, `planBootBrightness` and the
// persisted pre-sleep value, further down).
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
// is the pure decision at the centre of that loop; `restoreBrightnessVerified`
// runs it (POST / settle / GET, HTTP client injected so the tests drive it
// without a network) for both the App's wake restore and the boot restore in
// `hooks/useScreenSaver.js`.
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

// Endpoint the restore loop writes and reads back.
const BRIGHTNESS_ENDPOINT = "/api/brightness";

/**
 * Promise that resolves after `ms` milliseconds — the default settle wait.
 *
 * @param {Number} ms delay in milliseconds
 * @returns {Promise<void>} resolves once the delay has elapsed
 */
function settleDelay(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/**
 * Write `target`, let it settle, read it back, and retry per
 * `nextRestoreAction` until it lands, the read can't verify, or
 * RESTORE_MAX_ATTEMPTS writes have been made. Never rejects: a failed write
 * is caught (the read-back decides), a failed read counts as unverifiable.
 * Never sends `allowOff`, so the server's floor still applies.
 *
 * @param {object} p parameters
 * @param {Number} p.target brightness percent to restore
 * @param {object} p.http an axios-like client exposing `post(url, body)` and
 *   `get(url)` (the client passes `axios`; the tests pass a fake)
 * @param {() => boolean} [p.isCancelled] returns true once the caller no longer
 *   wants the restore (a newer stage transition, the user moved the slider);
 *   checked before every write and before every read
 * @param {(ms: number) => Promise<void>} [p.wait] the settle delay
 * @returns {Promise<object>} `{ outcome, attempts, observed }`: outcome is
 *   `"done"`, `"giveup"` or `"cancelled"`, attempts the writes made, observed
 *   the last value read back (null when none was read or the read failed)
 */
async function restoreBrightnessVerified({
  target,
  http,
  isCancelled = () => false,
  wait = settleDelay,
}) {
  let observed = null;
  for (let attempt = 1; attempt <= RESTORE_MAX_ATTEMPTS; attempt++) {
    if (isCancelled()) return { outcome: "cancelled", attempts: attempt - 1, observed };
    try {
      await http.post(BRIGHTNESS_ENDPOINT, { percent: target });
    } catch {
      // Best-effort write (e.g. a DDC/CI 504): the read-back below decides.
    }
    await wait(RESTORE_SETTLE_MS);
    if (isCancelled()) return { outcome: "cancelled", attempts: attempt, observed };
    try {
      const res = await http.get(BRIGHTNESS_ENDPOINT);
      observed = res?.data?.available ? res.data.percent : null;
    } catch {
      observed = null;
    }
    const action = nextRestoreAction({ target, observed, attemptsMade: attempt });
    if (action !== "retry") return { outcome: action, attempts: attempt, observed };
  }
  // Unreachable: nextRestoreAction gives up at RESTORE_MAX_ATTEMPTS.
  return { outcome: "giveup", attempts: RESTORE_MAX_ATTEMPTS, observed };
}

// ─── A page reload during sleep must not leave the screen dark ─────
//
// Background (incident 2026-10-11, six kiosks): the pre-sleep brightness
// lived only in the App's page memory, and stage 2 leaves the panel at 0.
// A page reloaded during stage 2 (kiosk relaunch, in-app update, refresh
// button) started awake, read `GET /api/brightness` = 0 and adopted it as
// the user's setting: the screen stayed black, the next stage 1 captured
// 0 as the pre-sleep value, and every later wake "restored" 0 — verified,
// so the retry above didn't help. A reload during stage 1 had the same
// shape with the dim level (e.g. 30) in place of 0.
//
// Three guards, in the order a booting page consults them:
// 1. The App also persists its pre-sleep value per device
//    (`brightnessBeforeSleep`): written on stage-1 entry, cleared when the
//    wake restore starts. A page that finds it at boot was reloaded during
//    sleep, and restores that exact level (`planBootBrightness`).
// 2. A reading below the server's floor (`minPercent`, MIN_PERCENT = 10 in
//    `server/brightnessCtrl.js`) is never adopted or captured: only the
//    stage-2 `allowOff` write goes below it, so it means "panel left dark",
//    never a user choice (`resolveUserBrightness`).
// 3. In its place: the last value the user chose with the slider, kept per
//    device (`lastUserBrightness`), else a fixed default.

// Brightness the screen relights to when the panel is found dark and this
// device has no stored slider value — the level the maintainer chose when
// restoring the fleet after the 2026-10-11 incident.
const DEFAULT_RESTORE_BRIGHTNESS_PERCENT = 70;

// Floor used when the server's `minPercent` is missing or malformed.
// Mirrors MIN_PERCENT in `server/brightnessCtrl.js` (pinned by
// test/brightnessRestore.test.js); also the initial `brightnessMinPercent`
// state in `hooks/useScreenSaver.js`.
const DEFAULT_MIN_BRIGHTNESS_PERCENT = 10;

const MAX_BRIGHTNESS_PERCENT = 100;

// localStorage key holding the last brightness the user chose with the
// Settings slider. Written ONLY from the slider: sleep-driven values
// (stage-1 dim, stage-2 off, wake restore, boot restore) never land here.
const LAST_USER_BRIGHTNESS_STORAGE_KEY = "lastUserBrightness";

// localStorage key holding the brightness the App captured on stage-1 entry
// (the value its wake will restore). Present only while this device's page
// is asleep, or after a page died asleep (reload, relaunch, power cut).
const BRIGHTNESS_BEFORE_SLEEP_STORAGE_KEY = "brightnessBeforeSleep";

// Hostnames the kiosk loads the app from (`deploy/start-server` always opens
// `localhost`). `POST /api/brightness` is localhost-only on the server; a
// remote viewer's write would be refused AND logged as a security event.
const LOOPBACK_HOSTNAMES = ["localhost", "127.0.0.1", "[::1]"];

/**
 * The floor to enforce: the server's `minPercent` clamped to [0, 100], or
 * DEFAULT_MIN_BRIGHTNESS_PERCENT when it isn't a finite number.
 *
 * @param {Number|null|undefined} minPercent the server's floor
 * @returns {Number} the floor in percent
 */
function resolveFloor(minPercent) {
  return typeof minPercent === "number" && Number.isFinite(minPercent)
    ? Math.min(MAX_BRIGHTNESS_PERCENT, Math.max(0, minPercent))
    : DEFAULT_MIN_BRIGHTNESS_PERCENT;
}

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
  const floor = resolveFloor(minPercent);
  if (isPercentInRange(percent, floor)) return percent;
  if (isPercentInRange(stored, floor)) return stored;
  const base = typeof fallback === "number" && Number.isFinite(fallback)
    ? fallback
    : DEFAULT_RESTORE_BRIGHTNESS_PERCENT;
  return Math.min(MAX_BRIGHTNESS_PERCENT, Math.max(floor, base));
}

/**
 * What a freshly mounted page does with the brightness it reads at boot.
 * A new page always starts awake, so if the previous page went to sleep and
 * never woke, its wake restore is still owed. Pure so every branch is
 * unit-testable.
 *
 * - A page that can't write (`canWrite` false: a remote viewer, whose POST
 *   the server refuses) shows the raw reading and restores nothing.
 * - Otherwise the target is the persisted pre-sleep value when it is valid
 *   (the previous page was reloaded during stage 1 or 2: restore exactly what
 *   its wake would have); else `resolveUserBrightness` over the reading (a
 *   reading at or above the floor is adopted as before; a sub-floor one is
 *   replaced by the slider value or the default).
 *
 * @param {object} p parameters
 * @param {Number|null|undefined} p.percent the `GET /api/brightness` reading
 * @param {Number|null} [p.minPercent] the server's floor
 * @param {Number|null} [p.beforeSleep] persisted pre-sleep value
 *   (`takeBrightnessBeforeSleep`), or null
 * @param {Number|null} [p.stored] last slider value (`readLastUserBrightness`), or null
 * @param {Boolean} p.canWrite whether this page's brightness writes can land
 *   (`isLoopbackHostname`)
 * @returns {object} `{ percent, relightTo }`: the value to hold as the
 *   user's brightness, and the value to write to the panel (null when the
 *   panel is already there or the page can't write)
 */
function planBootBrightness({ percent, minPercent, beforeSleep, stored, canWrite }) {
  if (!canWrite) return { percent, relightTo: null };
  const target = isPercentInRange(beforeSleep, resolveFloor(minPercent))
    ? beforeSleep
    : resolveUserBrightness({ percent, minPercent, stored });
  return { percent: target, relightTo: target === percent ? null : target };
}

/**
 * The storage to use: `storage` when given, else the browser's
 * localStorage. Reading `window.localStorage` itself can throw (blocked
 * storage), so callers wrap this in their try/catch.
 *
 * @param {object|null|undefined} storage a Storage-like object, or undefined
 * @returns {object|null|undefined} the Storage-like object to use
 */
function storageOrDefault(storage) {
  return storage === undefined ? globalThis.localStorage : storage;
}

/**
 * Read a number stored under `key`. Never throws: localStorage can be
 * missing (node, private mode) or throw (blocked storage, a leveldb store
 * torn by a power cut).
 *
 * @param {String} key localStorage key
 * @param {object} [storage] a Storage-like object; defaults to localStorage
 * @returns {Number|null} the stored number, or null when absent/unreadable
 *   (range validation is the caller's job)
 */
function readStoredPercent(key, storage) {
  try {
    const store = storageOrDefault(storage);
    if (!store) return null;
    const raw = store.getItem(key);
    if (raw === null || raw === undefined || raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * Store a finite number under `key`. Never throws (see `readStoredPercent`).
 *
 * @param {String} key localStorage key
 * @param {Number} percent the value to store
 * @param {object} [storage] a Storage-like object; defaults to localStorage
 * @returns {Boolean} true when the value was written
 */
function writeStoredPercent(key, percent, storage) {
  if (typeof percent !== "number" || !Number.isFinite(percent)) return false;
  try {
    const store = storageOrDefault(storage);
    if (!store) return false;
    store.setItem(key, String(percent));
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove `key`. Never throws (see `readStoredPercent`).
 *
 * @param {String} key localStorage key
 * @param {object} [storage] a Storage-like object; defaults to localStorage
 * @returns {Boolean} true when the removal went through
 */
function removeStored(key, storage) {
  try {
    const store = storageOrDefault(storage);
    if (!store) return false;
    store.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the last brightness the user chose with the slider.
 *
 * @param {object} [storage] a Storage-like object; defaults to localStorage
 * @returns {Number|null} the stored number, or null when absent/unreadable
 */
function readLastUserBrightness(storage) {
  return readStoredPercent(LAST_USER_BRIGHTNESS_STORAGE_KEY, storage);
}

/**
 * Remember the brightness the user just chose with the slider. Call it from
 * the slider path only.
 *
 * @param {Number} percent the chosen brightness percent
 * @param {object} [storage] a Storage-like object; defaults to localStorage
 * @returns {Boolean} true when the value was written
 */
function writeLastUserBrightness(percent, storage) {
  return writeStoredPercent(LAST_USER_BRIGHTNESS_STORAGE_KEY, percent, storage);
}

/**
 * Persist the value the App captured on stage-1 entry, so a page reloaded
 * before the wake can still restore it. Call it from the App's stage-1
 * capture only.
 *
 * @param {Number} percent the pre-sleep brightness percent
 * @param {object} [storage] a Storage-like object; defaults to localStorage
 * @returns {Boolean} true when the value was written
 */
function writeBrightnessBeforeSleep(percent, storage) {
  return writeStoredPercent(BRIGHTNESS_BEFORE_SLEEP_STORAGE_KEY, percent, storage);
}

/**
 * Forget the persisted pre-sleep value — the App calls it as its wake
 * restore starts.
 *
 * @param {object} [storage] a Storage-like object; defaults to localStorage
 * @returns {Boolean} true when the removal went through
 */
function clearBrightnessBeforeSleep(storage) {
  return removeStored(BRIGHTNESS_BEFORE_SLEEP_STORAGE_KEY, storage);
}

/**
 * Read and remove the persisted pre-sleep value: a booting page consumes it
 * once, so a later reload doesn't restore it again.
 *
 * @param {object} [storage] a Storage-like object; defaults to localStorage
 * @returns {Number|null} the stored number, or null when absent/unreadable
 */
function takeBrightnessBeforeSleep(storage) {
  const value = readStoredPercent(BRIGHTNESS_BEFORE_SLEEP_STORAGE_KEY, storage);
  removeStored(BRIGHTNESS_BEFORE_SLEEP_STORAGE_KEY, storage);
  return value;
}

/**
 * True when the page was loaded from a loopback hostname: the kiosk's own
 * browser, or an SSH tunnel (the client can't tell those two apart). A page
 * loaded from the Pi's LAN address is a remote viewer whose
 * `POST /api/brightness` the server's localhost-only gate refuses (it checks
 * the socket peer; this is only a client-side hint to avoid sending a write
 * that can't land).
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
  BRIGHTNESS_BEFORE_SLEEP_STORAGE_KEY,
  nextRestoreAction,
  restoreBrightnessVerified,
  resolveUserBrightness,
  planBootBrightness,
  readLastUserBrightness,
  writeLastUserBrightness,
  writeBrightnessBeforeSleep,
  clearBrightnessBeforeSleep,
  takeBrightnessBeforeSleep,
  isLoopbackHostname,
};
