// Regression tests for `client/src/services/brightnessRestore.js`.
//
// Second half: `resolveUserBrightness` and its localStorage helpers, the
// guard behind the 2026-10-11 incident (a page reloaded during sleep stage 2
// adopted the dark panel's 0 % as the user's brightness and restored it on
// every later wake). The property locked here: whatever goes in, the result
// is never below the floor.
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
  DEFAULT_RESTORE_BRIGHTNESS_PERCENT,
  DEFAULT_MIN_BRIGHTNESS_PERCENT,
  LAST_USER_BRIGHTNESS_STORAGE_KEY,
  resolveUserBrightness,
  readLastUserBrightness,
  writeLastUserBrightness,
  isLoopbackHostname,
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

// ═══ resolveUserBrightness — never adopt a dark panel ══════════════

const MIN = 10;

// ─── The reading wins when it is a real setting ────────────────────

test("reading within [minPercent, 100] is adopted as is", () => {
  assert.equal(resolveUserBrightness({ percent: 80, minPercent: MIN, stored: 40 }), 80);
});

test("reading exactly at the floor is adopted (the slider's minimum is a real choice)", () => {
  assert.equal(resolveUserBrightness({ percent: MIN, minPercent: MIN, stored: 40 }), MIN);
});

test("reading at 100 is adopted", () => {
  assert.equal(resolveUserBrightness({ percent: 100, minPercent: MIN, stored: 40 }), 100);
});

test("stage-1 dim reading (30) is >= floor → adopted, the stored value does not override it", () => {
  // A reload during stage 1 reads the dim level; at boot it can't be told
  // apart from a user setting, so it's adopted (documented decision).
  assert.equal(resolveUserBrightness({ percent: 30, minPercent: MIN, stored: 80 }), 30);
});

// ─── Below the floor → stored slider value ─────────────────────────

test("the incident: reading 0 (stage 2 across a reload) with a stored value → stored", () => {
  assert.equal(resolveUserBrightness({ percent: 0, minPercent: MIN, stored: 80 }), 80);
});

test("reading one point under the floor → stored", () => {
  assert.equal(resolveUserBrightness({ percent: MIN - 1, minPercent: MIN, stored: 55 }), 55);
});

test("stored value exactly at the floor is accepted", () => {
  assert.equal(resolveUserBrightness({ percent: 0, minPercent: MIN, stored: MIN }), MIN);
});

test("stored value at 100 is accepted", () => {
  assert.equal(resolveUserBrightness({ percent: 0, minPercent: MIN, stored: 100 }), 100);
});

// ─── Below the floor, no valid stored value → fallback ─────────────

test("reading 0 and nothing stored (null) → the 70 % default", () => {
  assert.equal(resolveUserBrightness({ percent: 0, minPercent: MIN, stored: null }), 70);
  assert.equal(DEFAULT_RESTORE_BRIGHTNESS_PERCENT, 70);
});

test("stored omitted (undefined) → default", () => {
  assert.equal(resolveUserBrightness({ percent: 0, minPercent: MIN }), DEFAULT_RESTORE_BRIGHTNESS_PERCENT);
});

test("stored below the floor (0, a sleep value) → default, never darkness", () => {
  assert.equal(resolveUserBrightness({ percent: 0, minPercent: MIN, stored: 0 }), DEFAULT_RESTORE_BRIGHTNESS_PERCENT);
  assert.equal(resolveUserBrightness({ percent: 0, minPercent: MIN, stored: MIN - 1 }), DEFAULT_RESTORE_BRIGHTNESS_PERCENT);
});

test("stored above 100 → default", () => {
  assert.equal(resolveUserBrightness({ percent: 0, minPercent: MIN, stored: 101 }), DEFAULT_RESTORE_BRIGHTNESS_PERCENT);
});

test("stored negative → default", () => {
  assert.equal(resolveUserBrightness({ percent: 0, minPercent: MIN, stored: -5 }), DEFAULT_RESTORE_BRIGHTNESS_PERCENT);
});

test("stored NaN / Infinity → default", () => {
  assert.equal(resolveUserBrightness({ percent: 0, minPercent: MIN, stored: NaN }), DEFAULT_RESTORE_BRIGHTNESS_PERCENT);
  assert.equal(resolveUserBrightness({ percent: 0, minPercent: MIN, stored: Infinity }), DEFAULT_RESTORE_BRIGHTNESS_PERCENT);
});

test("stored as a string (raw localStorage text) → default (callers parse it first)", () => {
  assert.equal(resolveUserBrightness({ percent: 0, minPercent: MIN, stored: "80" }), DEFAULT_RESTORE_BRIGHTNESS_PERCENT);
});

test("custom fallback is honoured", () => {
  assert.equal(resolveUserBrightness({ percent: 0, minPercent: MIN, stored: null, fallback: 45 }), 45);
});

test("fallback below the floor is raised to the floor", () => {
  assert.equal(resolveUserBrightness({ percent: 0, minPercent: MIN, stored: null, fallback: 0 }), MIN);
});

test("fallback above 100 is capped at 100", () => {
  assert.equal(resolveUserBrightness({ percent: 0, minPercent: MIN, stored: null, fallback: 150 }), 100);
});

test("non-numeric fallback (null, NaN, string) → the 70 % default", () => {
  for (const fallback of [null, NaN, "50"]) {
    assert.equal(resolveUserBrightness({ percent: 0, minPercent: MIN, stored: null, fallback }), DEFAULT_RESTORE_BRIGHTNESS_PERCENT);
  }
});

// ─── Malformed readings fall through ───────────────────────────────

test("reading null / undefined (state not loaded) → stored", () => {
  assert.equal(resolveUserBrightness({ percent: null, minPercent: MIN, stored: 60 }), 60);
  assert.equal(resolveUserBrightness({ percent: undefined, minPercent: MIN, stored: 60 }), 60);
});

test("reading NaN / Infinity → stored", () => {
  assert.equal(resolveUserBrightness({ percent: NaN, minPercent: MIN, stored: 60 }), 60);
  assert.equal(resolveUserBrightness({ percent: Infinity, minPercent: MIN, stored: 60 }), 60);
});

test("reading as a numeric string → not trusted, stored", () => {
  assert.equal(resolveUserBrightness({ percent: "80", minPercent: MIN, stored: 60 }), 60);
});

test("reading above 100 (impossible, defensive) → stored", () => {
  assert.equal(resolveUserBrightness({ percent: 120, minPercent: MIN, stored: 60 }), 60);
});

test("reading negative → stored", () => {
  assert.equal(resolveUserBrightness({ percent: -1, minPercent: MIN, stored: 60 }), 60);
});

// ─── minPercent edge values ────────────────────────────────────────

test("minPercent missing → the 10 % default floor applies", () => {
  assert.equal(DEFAULT_MIN_BRIGHTNESS_PERCENT, 10);
  assert.equal(resolveUserBrightness({ percent: 5, stored: 60 }), 60);
  assert.equal(resolveUserBrightness({ percent: 10, stored: 60 }), 10);
});

test("minPercent malformed (null, NaN, string) → the 10 % default floor applies", () => {
  for (const minPercent of [null, NaN, "10", Infinity]) {
    assert.equal(resolveUserBrightness({ percent: 5, minPercent, stored: null }), DEFAULT_RESTORE_BRIGHTNESS_PERCENT);
    assert.equal(resolveUserBrightness({ percent: 10, minPercent, stored: null }), 10);
  }
});

test("a higher server floor (20) rejects readings and stored values under it", () => {
  assert.equal(resolveUserBrightness({ percent: 15, minPercent: 20, stored: 15 }), DEFAULT_RESTORE_BRIGHTNESS_PERCENT);
  assert.equal(resolveUserBrightness({ percent: 15, minPercent: 20, stored: 20 }), 20);
});

test("minPercent 0 → 0 is a valid reading (no floor to violate)", () => {
  assert.equal(resolveUserBrightness({ percent: 0, minPercent: 0, stored: 60 }), 0);
});

test("minPercent negative is clamped to 0", () => {
  assert.equal(resolveUserBrightness({ percent: 0, minPercent: -10, stored: 60 }), 0);
  assert.equal(resolveUserBrightness({ percent: -5, minPercent: -10, stored: 60 }), 60);
});

test("minPercent 100 → only 100 is valid; the fallback is raised to 100", () => {
  assert.equal(resolveUserBrightness({ percent: 100, minPercent: 100, stored: 60 }), 100);
  assert.equal(resolveUserBrightness({ percent: 90, minPercent: 100, stored: 60 }), 100);
});

test("minPercent above 100 is clamped to 100", () => {
  assert.equal(resolveUserBrightness({ percent: 100, minPercent: 150, stored: null }), 100);
  assert.equal(resolveUserBrightness({ percent: 50, minPercent: 150, stored: null }), 100);
});

test("the result is never below the floor, whatever the inputs", () => {
  const values = [undefined, null, NaN, -Infinity, -1, 0, 5, 9, 10, 11, 30, 70, 100, 101, Infinity, "0", "80"];
  for (const minPercent of [undefined, 0, 1, 10, 20, 50, 100]) {
    const floor = minPercent === undefined ? DEFAULT_MIN_BRIGHTNESS_PERCENT : minPercent;
    for (const percent of values) {
      for (const stored of values) {
        const r = resolveUserBrightness({ percent, minPercent, stored });
        assert.ok(Number.isFinite(r) && r >= floor && r <= 100,
          `percent=${String(percent)} stored=${String(stored)} min=${String(minPercent)} → ${r}`);
      }
    }
  }
});

// ─── localStorage helpers ──────────────────────────────────────────

/**
 * Minimal in-memory Storage stand-in.
 *
 * @param {object} [initial] key → string value
 * @returns {object} a Storage-like object exposing getItem / setItem / data
 */
function makeStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
  };
}

const throwingStorage = {
  getItem: () => { throw new Error("SecurityError: storage blocked"); },
  setItem: () => { throw new Error("QuotaExceededError"); },
};

test("storage key is the documented lastUserBrightness", () => {
  assert.equal(LAST_USER_BRIGHTNESS_STORAGE_KEY, "lastUserBrightness");
});

test("write then read round-trips the slider value", () => {
  const s = makeStorage();
  assert.equal(writeLastUserBrightness(65, s), true);
  assert.equal(s.data.lastUserBrightness, "65");
  assert.equal(readLastUserBrightness(s), 65);
});

test("read: absent key → null", () => {
  assert.equal(readLastUserBrightness(makeStorage()), null);
});

test("read: empty string → null (not 0)", () => {
  assert.equal(readLastUserBrightness(makeStorage({ lastUserBrightness: "" })), null);
});

test("read: garbage text → null", () => {
  assert.equal(readLastUserBrightness(makeStorage({ lastUserBrightness: "bright" })), null);
});

test("read: out-of-range number is returned as is (range check is resolveUserBrightness's job)", () => {
  const raw = readLastUserBrightness(makeStorage({ lastUserBrightness: "0" }));
  assert.equal(raw, 0);
  assert.equal(resolveUserBrightness({ percent: 0, minPercent: MIN, stored: raw }), DEFAULT_RESTORE_BRIGHTNESS_PERCENT);
});

test("read: storage that throws (blocked, torn leveldb) → null, never throws", () => {
  assert.equal(readLastUserBrightness(throwingStorage), null);
});

test("read: no storage at all (null) → null", () => {
  assert.equal(readLastUserBrightness(null), null);
});

test("read/write with the default storage outside a browser → null / false, never throws", () => {
  // node has no localStorage global; the helpers must degrade, not crash.
  if (globalThis.localStorage === undefined) {
    assert.equal(readLastUserBrightness(), null);
    assert.equal(writeLastUserBrightness(50), false);
  }
});

test("write: storage that throws → false, never throws", () => {
  assert.equal(writeLastUserBrightness(50, throwingStorage), false);
});

test("write: non-numeric or non-finite values are refused", () => {
  const s = makeStorage();
  for (const v of [null, undefined, NaN, Infinity, "50"]) {
    assert.equal(writeLastUserBrightness(v, s), false);
  }
  assert.deepEqual(s.data, {});
});

// ─── isLoopbackHostname ────────────────────────────────────────────

test("loopback hostnames (the kiosk's localhost, IPv4, IPv6) → true", () => {
  for (const h of ["localhost", "LOCALHOST", "127.0.0.1", "[::1]"]) {
    assert.equal(isLoopbackHostname(h), true, h);
  }
});

test("LAN / remote hostnames and junk → false", () => {
  for (const h of ["192.168.1.20", "raspberrypi.local", "localhost.example.com", "", null, undefined, 127]) {
    assert.equal(isLoopbackHostname(h), false, String(h));
  }
});
