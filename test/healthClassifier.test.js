// Tests for the health-chip failure classifier in healthCtrl. The focus
// is the two-layered suppression that stops a single transient Tomorrow.io
// blip from painting the chip red:
//
//   1. RECENT_SUCCESS_WINDOW_MS — a recent success suppresses a failure
//      (covers fast pollers: current weather, AQ, alerts).
//   2. MIN_CONSECUTIVE_FAILURES — a failure candidate must recur before it
//      surfaces (covers slow pollers: hourly/daily, whose last success is
//      always older than the window).
//
// Run: `npm test` (Node's built-in `node --test` runner, no deps).

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { __test } = require("../server/healthCtrl");
const { isFailure, MIN_CONSECUTIVE_FAILURES, RECENT_SUCCESS_WINDOW_MS } = __test;

const minutesAgo = (m) => new Date(Date.now() - m * 60 * 1000).toISOString();

// ───────────────────────────────────────────────────────────────────────
// Trivial non-failures
// ───────────────────────────────────────────────────────────────────────

test("null entry / never-called status is not a failure", () => {
  assert.equal(isFailure(null), false);
  assert.equal(isFailure({ status: null }), false);
  assert.equal(isFailure({}), false);
});

test("2xx / 3xx are not failures", () => {
  assert.equal(isFailure({ status: 200, consecutiveFailures: 0 }), false);
  assert.equal(isFailure({ status: 304, consecutiveFailures: 0 }), false);
});

// ───────────────────────────────────────────────────────────────────────
// Layer 1: recent-success window
// ───────────────────────────────────────────────────────────────────────

test("an error with a recent success is suppressed regardless of count", () => {
  // The AI-summary duplicate-path case: main current poll succeeded 2 min
  // ago, AI path then 500s. Even with the consecutive count high, the
  // recent success keeps the chip green.
  const entry = {
    status: 500,
    lastSuccess: minutesAgo(2),
    consecutiveFailures: 5,
  };
  assert.equal(isFailure(entry), false);
});

test("a stale success (older than the window) no longer suppresses", () => {
  const entry = {
    status: 500,
    lastSuccess: minutesAgo(RECENT_SUCCESS_WINDOW_MS / 60000 + 5),
    consecutiveFailures: MIN_CONSECUTIVE_FAILURES,
  };
  assert.equal(isFailure(entry), true);
});

// ───────────────────────────────────────────────────────────────────────
// Layer 2: consecutive-failure threshold (the hourly/daily blip fix)
// ───────────────────────────────────────────────────────────────────────

test("single blip on a slow poller (no recent success, 1 failure) is NOT a failure", () => {
  // The exact regression: hourly polls every 60 min, so lastSuccess is
  // always older than the 35 min window. One transient 500 used to paint
  // red. With the consecutive gate it stays green.
  const entry = {
    status: 500,
    lastSuccess: minutesAgo(60),
    consecutiveFailures: 1,
  };
  assert.equal(isFailure(entry), false);
});

test("two consecutive failures on a slow poller DO surface", () => {
  const entry = {
    status: 500,
    lastSuccess: minutesAgo(120),
    consecutiveFailures: 2,
  };
  assert.equal(isFailure(entry), true);
});

test("a blip with no prior success at all (count 1) is still suppressed", () => {
  const entry = {
    status: 503,
    lastSuccess: null,
    consecutiveFailures: 1,
  };
  assert.equal(isFailure(entry), false);
});

test("a sustained outage with no prior success surfaces once the count is met", () => {
  const entry = {
    status: 503,
    lastSuccess: null,
    consecutiveFailures: MIN_CONSECUTIVE_FAILURES,
  };
  assert.equal(isFailure(entry), true);
});

test("non-numeric status (server-side exception) follows the same consecutive gate", () => {
  assert.equal(isFailure({ status: "ERR", lastSuccess: null, consecutiveFailures: 1 }), false);
  assert.equal(isFailure({ status: "ERR", lastSuccess: null, consecutiveFailures: 2 }), true);
});

test("a missing consecutiveFailures field is treated as 0 (suppressed)", () => {
  // Defensive: an entry recorded before this field existed shouldn't crash
  // or spuriously surface.
  assert.equal(isFailure({ status: 500, lastSuccess: null }), false);
});
