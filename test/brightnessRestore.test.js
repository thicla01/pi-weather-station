// Regression tests for `client/src/services/brightnessRestore.js`.
//
// The module is authored as CommonJS (like `ui/autoTabSelector.js`) so this
// runner exercises the REAL decision helper — no verbatim copy to drift.
// `nextRestoreAction` is the pure core of the wake-restore retry loop: given
// what the hardware reported back, it decides done / retry / giveup. These
// tests lock the two properties that matter: (1) a still-dark screen keeps
// retrying, and (2) the retry is ALWAYS bounded (never an infinite loop),
// which is the explicit requirement behind the feature.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  nextRestoreAction,
  RESTORE_MAX_ATTEMPTS,
  RESTORE_TOLERANCE_PERCENT,
  RESTORE_SETTLE_MS,
} = require("../client/src/services/brightnessRestore");

// ─── Success (the write landed) ────────────────────────────────────

test("exact match → done", () => {
  assert.equal(
    nextRestoreAction({ target: 80, observed: 80, attemptsMade: 1 }),
    "done"
  );
});

test("read-back within tolerance (rounding) → done", () => {
  // sysfs reports round(raw/max*100); a couple of points of drift is the
  // hardware rounding, not a failed write.
  assert.equal(
    nextRestoreAction({ target: 80, observed: 80 - RESTORE_TOLERANCE_PERCENT, attemptsMade: 1 }),
    "done"
  );
});

test("read-back above target → done", () => {
  assert.equal(
    nextRestoreAction({ target: 60, observed: 100, attemptsMade: 1 }),
    "done"
  );
});

// ─── Still dark → retry (with attempts remaining) ──────────────────

test("screen still black (0 %) with attempts left → retry", () => {
  assert.equal(
    nextRestoreAction({ target: 80, observed: 0, attemptsMade: 1 }),
    "retry"
  );
});

test("read-back just beyond tolerance with attempts left → retry", () => {
  assert.equal(
    nextRestoreAction({ target: 80, observed: 80 - RESTORE_TOLERANCE_PERCENT - 1, attemptsMade: 1 }),
    "retry"
  );
});

test("stage-1 wake — restore to 80 but stuck at the dim 30 with attempts left → retry", () => {
  // Waking from stage 1 the screen is visible (30 %) but not yet at the
  // user's pre-sleep 80 %; a failed restore write should still retry.
  assert.equal(
    nextRestoreAction({ target: 80, observed: 30, attemptsMade: 2 }),
    "retry"
  );
});

// ─── Bounded — never an infinite loop ──────────────────────────────

test("still dark at the attempt cap → giveup (bound is respected)", () => {
  assert.equal(
    nextRestoreAction({ target: 80, observed: 0, attemptsMade: RESTORE_MAX_ATTEMPTS }),
    "giveup"
  );
});

test("still dark past the attempt cap → giveup", () => {
  assert.equal(
    nextRestoreAction({ target: 80, observed: 0, attemptsMade: RESTORE_MAX_ATTEMPTS + 5 }),
    "giveup"
  );
});

test("driving the loop to termination — a permanently-dark panel stops in exactly maxAttempts writes", () => {
  // Simulate the App effect's loop against hardware that never lights.
  let writes = 0;
  for (let attempt = 1; attempt <= RESTORE_MAX_ATTEMPTS; attempt++) {
    writes++;
    const action = nextRestoreAction({ target: 80, observed: 0, attemptsMade: attempt });
    if (action !== "retry") break;
  }
  assert.equal(writes, RESTORE_MAX_ATTEMPTS);
});

test("driving the loop — a panel that lights on the 2nd write stops early", () => {
  let writes = 0;
  for (let attempt = 1; attempt <= RESTORE_MAX_ATTEMPTS; attempt++) {
    writes++;
    // Dark on attempt 1, lit on attempt 2.
    const observed = attempt === 1 ? 0 : 80;
    const action = nextRestoreAction({ target: 80, observed, attemptsMade: attempt });
    if (action !== "retry") break;
  }
  assert.equal(writes, 2);
});

// ─── Unverifiable read-back → giveup (best-effort, no loop) ─────────

test("observed null (GET failed / no backlight) → giveup", () => {
  assert.equal(
    nextRestoreAction({ target: 80, observed: null, attemptsMade: 1 }),
    "giveup"
  );
});

test("observed undefined → giveup", () => {
  assert.equal(
    nextRestoreAction({ target: 80, observed: undefined, attemptsMade: 1 }),
    "giveup"
  );
});

test("observed non-numeric (defensive) → giveup", () => {
  assert.equal(
    nextRestoreAction({ target: 80, observed: "80", attemptsMade: 1 }),
    "giveup"
  );
});

// ─── Custom policy params ──────────────────────────────────────────

test("custom maxAttempts is honoured", () => {
  assert.equal(
    nextRestoreAction({ target: 80, observed: 0, attemptsMade: 2, maxAttempts: 2 }),
    "giveup"
  );
  assert.equal(
    nextRestoreAction({ target: 80, observed: 0, attemptsMade: 1, maxAttempts: 2 }),
    "retry"
  );
});

test("custom tolerance is honoured", () => {
  // With a wide tolerance of 20, an observed 65 vs target 80 counts as done.
  assert.equal(
    nextRestoreAction({ target: 80, observed: 65, attemptsMade: 1, tolerance: 20 }),
    "done"
  );
});

// ─── Exported constants are sane ───────────────────────────────────

test("constants are within expected ranges", () => {
  assert.ok(RESTORE_MAX_ATTEMPTS >= 2 && RESTORE_MAX_ATTEMPTS <= 10);
  assert.ok(RESTORE_TOLERANCE_PERCENT >= 0 && RESTORE_TOLERANCE_PERCENT < 10);
  assert.ok(RESTORE_SETTLE_MS >= 0 && RESTORE_SETTLE_MS <= 2000);
});
