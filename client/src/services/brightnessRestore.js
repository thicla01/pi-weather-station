// Wake-from-sleep brightness restore: verification + bounded retry policy.
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
// App effect can `import { nextRestoreAction } from "~/services/brightnessRestore"`.

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

module.exports = {
  RESTORE_MAX_ATTEMPTS,
  RESTORE_TOLERANCE_PERCENT,
  RESTORE_SETTLE_MS,
  nextRestoreAction,
};
