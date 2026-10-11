// Regression tests for `client/src/services/brightnessRestore.js`.
//
// Second half: the guards behind the 2026-10-11 incident (a page reloaded
// during sleep stage 2 adopted the dark panel's 0 % as the user's brightness
// and restored it on every later wake) — `resolveUserBrightness`,
// `planBootBrightness`, the localStorage helpers, the shared verified-restore
// loop, and source guards pinning where the client wires them. The
// properties locked here: whatever goes in, the result is never below the
// floor; a page reloaded during sleep restores the pre-sleep level; only the
// slider records the user's choice.
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
const fs = require("node:fs");
const path = require("node:path");

const {
  nextRestoreAction,
  RESTORE_MAX_ATTEMPTS,
  RESTORE_TOLERANCE_PERCENT,
  RESTORE_SETTLE_MS,
  DEFAULT_RESTORE_BRIGHTNESS_PERCENT,
  DEFAULT_MIN_BRIGHTNESS_PERCENT,
  LAST_USER_BRIGHTNESS_STORAGE_KEY,
  BRIGHTNESS_BEFORE_SLEEP_STORAGE_KEY,
  restoreBrightnessVerified,
  resolveUserBrightness,
  planBootBrightness,
  readLastUserBrightness,
  writeLastUserBrightness,
  writeBrightnessBeforeSleep,
  clearBrightnessBeforeSleep,
  takeBrightnessBeforeSleep,
  isLoopbackHostname,
} = require("../client/src/services/brightnessRestore");
const { MIN_PERCENT } = require("../server/brightnessCtrl");

const CLIENT_SRC = path.join(__dirname, "..", "client", "src");
const APP_FILE = path.join(CLIENT_SRC, "components", "App", "index.js");
const HOOK_FILE = path.join(CLIENT_SRC, "hooks", "useScreenSaver.js");
const SERVICE_FILE = path.join(CLIENT_SRC, "services", "brightnessRestore.js");

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

// The server's floor, not a restated literal: raising MIN_PERCENT in
// server/brightnessCtrl.js re-runs every case below against the new floor.
const MIN = MIN_PERCENT;

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

test("the client's default floor mirrors the server's MIN_PERCENT", () => {
  assert.equal(DEFAULT_MIN_BRIGHTNESS_PERCENT, MIN_PERCENT);
});

test("minPercent missing → the default floor applies", () => {
  const floor = DEFAULT_MIN_BRIGHTNESS_PERCENT;
  assert.equal(resolveUserBrightness({ percent: floor - 1, stored: 60 }), 60);
  assert.equal(resolveUserBrightness({ percent: floor, stored: 60 }), floor);
});

test("minPercent malformed (null, NaN, string, Infinity) → the default floor applies", () => {
  // "50" differs from the default floor on purpose: a helper that coerced
  // the string (floor 50) would reject the reading at the default floor.
  const floor = DEFAULT_MIN_BRIGHTNESS_PERCENT;
  for (const minPercent of [null, NaN, "50", Infinity]) {
    assert.equal(resolveUserBrightness({ percent: floor - 1, minPercent, stored: null }), DEFAULT_RESTORE_BRIGHTNESS_PERCENT);
    assert.equal(resolveUserBrightness({ percent: floor, minPercent, stored: null }), floor, String(minPercent));
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
    removeItem: (k) => { delete data[k]; },
  };
}

const throwingStorage = {
  getItem: () => { throw new Error("SecurityError: storage blocked"); },
  setItem: () => { throw new Error("QuotaExceededError"); },
  removeItem: () => { throw new Error("SecurityError: storage blocked"); },
};

/**
 * Run `fn` with `globalThis.localStorage` replaced by `value` (undefined
 * removes it), then restore whatever was there — so the default-storage
 * path is exercised the same way on every Node version, whether or not it
 * ships a localStorage global.
 *
 * @param {*} value the stand-in, or undefined for "no localStorage"
 * @param {Function} fn the assertions to run
 */
function withGlobalLocalStorage(value, fn) {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  try {
    if (value === undefined) delete globalThis.localStorage;
    else Object.defineProperty(globalThis, "localStorage", { value, configurable: true, writable: true });
    fn();
  } finally {
    if (saved) Object.defineProperty(globalThis, "localStorage", saved);
    else delete globalThis.localStorage;
  }
}

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

test("default storage is the localStorage global", () => {
  const s = makeStorage();
  withGlobalLocalStorage(s, () => {
    assert.equal(writeLastUserBrightness(55), true);
    assert.equal(s.data.lastUserBrightness, "55");
    assert.equal(readLastUserBrightness(), 55);
    assert.equal(writeBrightnessBeforeSleep(65), true);
    assert.equal(takeBrightnessBeforeSleep(), 65);
    assert.equal(BRIGHTNESS_BEFORE_SLEEP_STORAGE_KEY in s.data, false);
  });
});

test("default storage absent (plain node, no window) → null / false, never throws", () => {
  withGlobalLocalStorage(undefined, () => {
    assert.equal(readLastUserBrightness(), null);
    assert.equal(writeLastUserBrightness(50), false);
    assert.equal(writeBrightnessBeforeSleep(50), false);
    assert.equal(takeBrightnessBeforeSleep(), null);
    assert.equal(clearBrightnessBeforeSleep(), false);
  });
});

test("default storage that throws (blocked, torn leveldb) → null / false, never throws", () => {
  withGlobalLocalStorage(throwingStorage, () => {
    assert.equal(readLastUserBrightness(), null);
    assert.equal(writeLastUserBrightness(50), false);
    assert.equal(takeBrightnessBeforeSleep(), null);
    assert.equal(clearBrightnessBeforeSleep(), false);
  });
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

// ─── Persisted pre-sleep value (brightnessBeforeSleep) ─────────────

test("before-sleep storage key is the documented brightnessBeforeSleep", () => {
  assert.equal(BRIGHTNESS_BEFORE_SLEEP_STORAGE_KEY, "brightnessBeforeSleep");
});

test("before-sleep: write then take round-trips once, and take removes the key", () => {
  const s = makeStorage();
  assert.equal(writeBrightnessBeforeSleep(60, s), true);
  assert.equal(s.data.brightnessBeforeSleep, "60");
  assert.equal(takeBrightnessBeforeSleep(s), 60);
  assert.equal(BRIGHTNESS_BEFORE_SLEEP_STORAGE_KEY in s.data, false);
  assert.equal(takeBrightnessBeforeSleep(s), null, "a second boot must not restore it again");
});

test("before-sleep: take on an absent key → null; garbage → null and still removed", () => {
  assert.equal(takeBrightnessBeforeSleep(makeStorage()), null);
  const s = makeStorage({ brightnessBeforeSleep: "dim" });
  assert.equal(takeBrightnessBeforeSleep(s), null);
  assert.deepEqual(s.data, {});
});

test("before-sleep: clear removes the key and leaves the slider value alone", () => {
  const s = makeStorage({ brightnessBeforeSleep: "60", lastUserBrightness: "45" });
  assert.equal(clearBrightnessBeforeSleep(s), true);
  assert.deepEqual(s.data, { lastUserBrightness: "45" });
});

test("before-sleep: the two keys are independent", () => {
  const s = makeStorage();
  writeLastUserBrightness(45, s);
  writeBrightnessBeforeSleep(60, s);
  assert.equal(readLastUserBrightness(s), 45);
  assert.equal(takeBrightnessBeforeSleep(s), 60);
  assert.equal(readLastUserBrightness(s), 45);
});

test("before-sleep: storage that throws → write false, take null, clear false, never throws", () => {
  assert.equal(writeBrightnessBeforeSleep(60, throwingStorage), false);
  assert.equal(takeBrightnessBeforeSleep(throwingStorage), null);
  assert.equal(clearBrightnessBeforeSleep(throwingStorage), false);
});

test("before-sleep: null storage → write false, take null, clear false", () => {
  assert.equal(writeBrightnessBeforeSleep(60, null), false);
  assert.equal(takeBrightnessBeforeSleep(null), null);
  assert.equal(clearBrightnessBeforeSleep(null), false);
});

test("before-sleep: non-numeric or non-finite values are refused", () => {
  const s = makeStorage();
  for (const v of [null, undefined, NaN, Infinity, "60"]) {
    assert.equal(writeBrightnessBeforeSleep(v, s), false);
  }
  assert.deepEqual(s.data, {});
});

// ═══ planBootBrightness — what a freshly mounted page does ═════════

const plan = (p) => planBootBrightness({ minPercent: MIN, beforeSleep: null, stored: null, canWrite: true, ...p });

test("boot, awake panel, no persisted value → adopt the reading, no write (unchanged behaviour)", () => {
  assert.deepEqual(plan({ percent: 60 }), { percent: 60, relightTo: null });
  assert.deepEqual(plan({ percent: 60, stored: 80 }), { percent: 60, relightTo: null });
});

test("boot after a reload during stage 1: dim reading + persisted value → restore the persisted value", () => {
  // The finding behind the second pass: the dim level (30) used to be
  // adopted for good, and the next stage 1 captured it again.
  assert.deepEqual(plan({ percent: 30, beforeSleep: 60 }), { percent: 60, relightTo: 60 });
  assert.deepEqual(plan({ percent: MIN, beforeSleep: 60, stored: 45 }), { percent: 60, relightTo: 60 });
});

test("boot after a reload during stage 2: dark reading + persisted value → the exact pre-sleep level, not the slider value", () => {
  assert.deepEqual(plan({ percent: 0, beforeSleep: 80, stored: 50 }), { percent: 80, relightTo: 80 });
});

test("the incident: dark reading, nothing persisted, a slider value → restore the slider value", () => {
  assert.deepEqual(plan({ percent: 0, stored: 55 }), { percent: 55, relightTo: 55 });
});

test("dark reading, nothing persisted, no slider value → the 70 % default", () => {
  assert.deepEqual(plan({ percent: 0 }), { percent: DEFAULT_RESTORE_BRIGHTNESS_PERCENT, relightTo: DEFAULT_RESTORE_BRIGHTNESS_PERCENT });
});

test("persisted value equal to the reading → adopt it, no write", () => {
  assert.deepEqual(plan({ percent: 60, beforeSleep: 60 }), { percent: 60, relightTo: null });
});

test("persisted value outside [floor, 100] is ignored → the reading path decides", () => {
  for (const beforeSleep of [0, MIN - 1, 101, -5, NaN, Infinity, "60", undefined]) {
    assert.deepEqual(plan({ percent: 40, beforeSleep }), { percent: 40, relightTo: null }, String(beforeSleep));
    assert.deepEqual(plan({ percent: 0, beforeSleep, stored: 55 }), { percent: 55, relightTo: 55 }, String(beforeSleep));
  }
});

test("persisted value at the floor and at 100 is honoured", () => {
  assert.deepEqual(plan({ percent: 0, beforeSleep: MIN }), { percent: MIN, relightTo: MIN });
  assert.deepEqual(plan({ percent: 0, beforeSleep: 100 }), { percent: 100, relightTo: 100 });
});

test("a higher server floor (20) also rejects a persisted value under it", () => {
  assert.deepEqual(plan({ percent: 0, minPercent: 20, beforeSleep: 15, stored: 25 }), { percent: 25, relightTo: 25 });
});

test("a remote viewer (can't write) shows the raw reading and never writes", () => {
  // Its POST would be refused; a made-up 70 % on its disabled slider would
  // misreport a panel that is really at 0.
  for (const p of [{ percent: 0 }, { percent: 0, beforeSleep: 80, stored: 55 }, { percent: 30, beforeSleep: 60 }, { percent: 60 }]) {
    assert.deepEqual(plan({ ...p, canWrite: false }), { percent: p.percent, relightTo: null }, JSON.stringify(p));
  }
});

test("a page that can write never holds or writes a value below the floor", () => {
  const values = [undefined, null, NaN, -1, 0, 5, MIN - 1, MIN, 30, 70, 100, 101, "80"];
  for (const percent of values) {
    for (const beforeSleep of values) {
      for (const stored of values) {
        const r = plan({ percent, beforeSleep, stored });
        assert.ok(Number.isFinite(r.percent) && r.percent >= MIN && r.percent <= 100,
          `percent=${String(percent)} beforeSleep=${String(beforeSleep)} stored=${String(stored)} → ${r.percent}`);
        assert.ok(r.relightTo === null || r.relightTo === r.percent);
      }
    }
  }
});

// ═══ restoreBrightnessVerified — the shared wake / boot restore loop ═

/**
 * Fake axios-like client: `post` records each body; `get` answers from the
 * `reads` script (a number → that reading; null → available: false; an
 * Error → rejects). `postFails` lists the attempt numbers whose POST rejects.
 *
 * @param {object} p parameters
 * @param {Array} p.reads one entry per GET, in order
 * @param {Array<number>} [p.postFails] 1-based attempts whose POST rejects
 * @returns {object} the fake client, with `posts` / `gets` counters
 */
function fakeHttp({ reads, postFails = [] }) {
  const http = {
    posts: [],
    gets: 0,
    post: async (url, body) => {
      assert.equal(url, "/api/brightness");
      http.posts.push(body);
      if (postFails.includes(http.posts.length)) throw new Error("504 write-timeout");
      return { data: { ok: true } };
    },
    get: async (url) => {
      assert.equal(url, "/api/brightness");
      const r = reads[http.gets++];
      if (r instanceof Error) throw r;
      return { data: r === null ? { available: false } : { available: true, percent: r, minPercent: MIN } };
    },
  };
  return http;
}

const noWait = async () => undefined;

test("restore lands on the first write → done after 1 attempt, body is { percent } only (no allowOff)", async () => {
  const http = fakeHttp({ reads: [60] });
  const r = await restoreBrightnessVerified({ target: 60, http, wait: noWait });
  assert.deepEqual(r, { outcome: "done", attempts: 1, observed: 60 });
  assert.deepEqual(http.posts, [{ percent: 60 }]);
});

test("restore: a swallowed write failure (DDC 504) is retried until it lands", async () => {
  const http = fakeHttp({ reads: [0, 70], postFails: [1] });
  const r = await restoreBrightnessVerified({ target: 70, http, wait: noWait });
  assert.deepEqual(r, { outcome: "done", attempts: 2, observed: 70 });
  assert.equal(http.posts.length, 2);
});

test("restore never lands → gives up after RESTORE_MAX_ATTEMPTS writes, reports the last reading", async () => {
  const http = fakeHttp({ reads: Array(RESTORE_MAX_ATTEMPTS + 2).fill(0) });
  const r = await restoreBrightnessVerified({ target: 70, http, wait: noWait });
  assert.deepEqual(r, { outcome: "giveup", attempts: RESTORE_MAX_ATTEMPTS, observed: 0 });
  assert.equal(http.posts.length, RESTORE_MAX_ATTEMPTS);
});

test("restore: a failed read-back or available:false can't verify → gives up after 1 write", async () => {
  for (const read of [new Error("Network Error"), null]) {
    const http = fakeHttp({ reads: [read] });
    const r = await restoreBrightnessVerified({ target: 70, http, wait: noWait });
    assert.deepEqual(r, { outcome: "giveup", attempts: 1, observed: null });
    assert.equal(http.posts.length, 1);
  }
});

test("restore waits RESTORE_SETTLE_MS between each write and its read-back", async () => {
  const http = fakeHttp({ reads: [0, 70] });
  const waits = [];
  await restoreBrightnessVerified({ target: 70, http, wait: async (ms) => { waits.push([ms, http.posts.length, http.gets]); } });
  assert.deepEqual(waits, [[RESTORE_SETTLE_MS, 1, 0], [RESTORE_SETTLE_MS, 2, 1]]);
});

test("restore cancelled before it starts → no write at all", async () => {
  const http = fakeHttp({ reads: [70] });
  const r = await restoreBrightnessVerified({ target: 70, http, wait: noWait, isCancelled: () => true });
  assert.deepEqual(r, { outcome: "cancelled", attempts: 0, observed: null });
  assert.equal(http.posts.length, 0);
});

test("restore cancelled during the settle (newer stage, slider moved) → no read, no further write", async () => {
  const http = fakeHttp({ reads: [0, 70] });
  let cancelled = false;
  const r = await restoreBrightnessVerified({
    target: 70, http, isCancelled: () => cancelled, wait: async () => { cancelled = true; },
  });
  assert.deepEqual(r, { outcome: "cancelled", attempts: 1, observed: null });
  assert.equal(http.posts.length, 1);
  assert.equal(http.gets, 0);
});

test("restore cancelled between retries → stops before the next write", async () => {
  const http = fakeHttp({ reads: [0, 0, 0] });
  let n = 0;
  const r = await restoreBrightnessVerified({
    target: 70, http, wait: noWait, isCancelled: () => (n++ >= 2), // passes attempt 1's two checks
  });
  assert.equal(r.outcome, "cancelled");
  assert.equal(http.posts.length, 1);
});

// ═══ Wiring — where the client applies the guards ══════════════════
//
// The helpers alone fix nothing: pin the call sites so a refactor of the
// App sleep effect or the hook's mount fetch can't silently bring back
// "page awake on a black screen, every wake restores 0".

/**
 * Source with block and line comments removed, so prose that names a
 * helper doesn't count as a call.
 *
 * @param {string} src JavaScript source
 * @returns {string} the source without comments
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/**
 * Every .js file under `dir`, recursively.
 *
 * @param {string} dir directory to walk
 * @returns {Array<string>} absolute file paths
 */
function jsFilesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return jsFilesUnder(p);
    return e.name.endsWith(".js") ? [p] : [];
  });
}

/**
 * Files under client/src (the service module itself excluded) whose code
 * calls `fn(`, with the call count per file.
 *
 * @param {string} fn function name
 * @returns {object} relative path → number of calls
 */
function callSites(fn) {
  const re = new RegExp(`\\b${fn}\\(`, "g");
  const out = {};
  for (const file of jsFilesUnder(CLIENT_SRC)) {
    if (file === SERVICE_FILE) continue;
    const n = (stripComments(fs.readFileSync(file, "utf8")).match(re) || []).length;
    if (n) out[path.relative(CLIENT_SRC, file)] = n;
  }
  return out;
}

test("App: the stage-1 capture goes through resolveUserBrightness and is persisted", () => {
  const src = stripComments(fs.readFileSync(APP_FILE, "utf8"));
  assert.match(
    src,
    /if \(brightnessBeforeSleepRef\.current === null\) \{\s*brightnessBeforeSleepRef\.current = resolveUserBrightness\(\{\s*percent: brightnessPercent,\s*minPercent: brightnessMinPercent,\s*stored: readLastUserBrightness\(\),\s*\}\);\s*writeBrightnessBeforeSleep\(brightnessBeforeSleepRef\.current\);\s*\}/,
    "stage 1 must capture resolveUserBrightness(...) (never a raw sub-floor value) and persist it",
  );
  const assigns = src.match(/brightnessBeforeSleepRef\.current = [^;(]+[;(]/g) || [];
  assert.deepEqual(assigns, ["brightnessBeforeSleepRef.current = resolveUserBrightness(", "brightnessBeforeSleepRef.current = null;"],
    "the pre-sleep ref is only ever set to the resolved value, or cleared");
});

test("App: the wake clears the persisted value and restores through the verified loop", () => {
  const src = stripComments(fs.readFileSync(APP_FILE, "utf8"));
  assert.match(
    src,
    /const restoreTo = brightnessBeforeSleepRef\.current;\s*brightnessBeforeSleepRef\.current = null;\s*clearBrightnessBeforeSleep\(\);/,
    "the wake must forget the persisted value as it takes over the restore",
  );
  assert.match(src, /restoreBrightnessVerified\(\{\s*target: restoreTo,\s*http: axios,\s*isCancelled: \(\) => cancelled,/);
  // The stage-2 write is the only allowOff write in the client.
  assert.deepEqual(src.match(/allowOff[^,}]*/g), ["allowOff: true "]);
});

test("useScreenSaver: the mount fetch adopts only planBootBrightness's value and restores through the verified loop", () => {
  const src = stripComments(fs.readFileSync(HOOK_FILE, "utf8"));
  assert.match(
    src,
    /const plan = planBootBrightness\(\{\s*percent,\s*minPercent,\s*beforeSleep: takeBrightnessBeforeSleep\(\),\s*stored: readLastUserBrightness\(\),\s*canWrite: isLoopbackHostname\(window\.location\.hostname\),\s*\}\);\s*setBrightnessPercent\(plan\.percent\);/,
    "the boot reading must go through planBootBrightness before it becomes the user's brightness",
  );
  const sets = src.match(/setBrightnessPercent\([^)]*\)/g) || [];
  assert.deepEqual(sets, ["setBrightnessPercent(plan.percent)", "setBrightnessPercent(v)"],
    "only the boot plan and the slider may set the brightness state (never res.data.percent or a raw reading)");
  assert.match(src, /restoreBrightnessVerified\(\{\s*target: plan\.relightTo,\s*http: axios,\s*isCancelled: \(\) => cancelled \|\| userSetBrightnessRef\.current,/);
  assert.doesNotMatch(src, /allowOff/, "the hook never writes below the floor");
  assert.match(src, /useState\(DEFAULT_MIN_BRIGHTNESS_PERCENT\)/, "the initial floor is the shared constant");
});

test("only the slider records the user's choice: writeLastUserBrightness has one call, inside setBrightnessLive's debounced write", () => {
  assert.deepEqual(callSites("writeLastUserBrightness"), { [path.join("hooks", "useScreenSaver.js")]: 1 });
  const src = stripComments(fs.readFileSync(HOOK_FILE, "utf8"));
  const m = src.match(/const setBrightnessLive = useCallback\(\(v\) => \{[\s\S]*?setTimeout\(\(\) => \{([\s\S]*?)\}, BRIGHTNESS_SAVE_DEBOUNCE_MS\);/);
  assert.ok(m, "setBrightnessLive's debounced write not found");
  assert.match(m[1], /writeLastUserBrightness\(v\);/);
});

test("only the App's stage-1 capture persists the pre-sleep value; only the boot consumes it", () => {
  assert.deepEqual(callSites("writeBrightnessBeforeSleep"), { [path.join("components", "App", "index.js")]: 1 });
  assert.deepEqual(callSites("clearBrightnessBeforeSleep"), { [path.join("components", "App", "index.js")]: 1 });
  assert.deepEqual(callSites("takeBrightnessBeforeSleep"), { [path.join("hooks", "useScreenSaver.js")]: 1 });
});
