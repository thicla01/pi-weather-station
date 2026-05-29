// Tests for the transient-error retry policy that fronts the three
// Tomorrow.io weather endpoints in proxyCtrl. Covers the pure
// classifier (isTransientError) and the single-retry wrapper
// (retryTransient), both exposed via the controller's `__test` export.
//
// Run: `npm test` (Node's built-in `node --test` runner, no deps).
//
// retryTransient takes an optional backoffMs second arg — every test
// passes 0 so the suite doesn't sit through the real ~1.5 s backoff.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { __test } = require("../server/proxyCtrl");
const { isTransientError, retryTransient } = __test;

// Build an axios-shaped error carrying an HTTP status.
function httpError(status) {
  return { response: { status }, message: `HTTP ${status}` };
}

// ───────────────────────────────────────────────────────────────────────
// isTransientError — only 429 and 5xx are retryable
// ───────────────────────────────────────────────────────────────────────

test("isTransientError: 500/502/503 are transient", () => {
  for (const status of [500, 502, 503, 599]) {
    assert.equal(isTransientError(httpError(status)), true, `${status} should be transient`);
  }
});

test("isTransientError: 429 is transient", () => {
  assert.equal(isTransientError(httpError(429)), true);
});

test("isTransientError: 4xx other than 429 is NOT transient", () => {
  for (const status of [400, 401, 403, 404, 422]) {
    assert.equal(isTransientError(httpError(status)), false, `${status} should not be transient`);
  }
});

test("isTransientError: network error / timeout (no response) is NOT transient", () => {
  // A timeout retry would add another full API_TIMEOUT_MS before the
  // stale-on-error fallback kicks in, so these route straight to stale.
  assert.equal(isTransientError({ code: "ECONNABORTED", message: "timeout" }), false);
  assert.equal(isTransientError({ message: "socket hang up" }), false);
  assert.equal(isTransientError(undefined), false);
});

// ───────────────────────────────────────────────────────────────────────
// retryTransient — retries exactly once on a transient error
// ───────────────────────────────────────────────────────────────────────

test("retryTransient: returns the first result when the call succeeds", async () => {
  let calls = 0;
  const result = await retryTransient(async () => {
    calls++;
    return "ok";
  }, 0);
  assert.equal(result, "ok");
  assert.equal(calls, 1, "no retry on success");
});

test("retryTransient: retries once after a transient error, then succeeds", async () => {
  let calls = 0;
  const result = await retryTransient(async () => {
    calls++;
    if (calls === 1) throw httpError(503);
    return "recovered";
  }, 0);
  assert.equal(result, "recovered");
  assert.equal(calls, 2, "should have retried exactly once");
});

test("retryTransient: a 429 is retried", async () => {
  let calls = 0;
  const result = await retryTransient(async () => {
    calls++;
    if (calls === 1) throw httpError(429);
    return "recovered";
  }, 0);
  assert.equal(result, "recovered");
  assert.equal(calls, 2);
});

test("retryTransient: does NOT retry on a non-transient 4xx", async () => {
  let calls = 0;
  await assert.rejects(
    () => retryTransient(async () => {
      calls++;
      throw httpError(401);
    }, 0),
    (err) => err.response.status === 401
  );
  assert.equal(calls, 1, "401 must not be retried");
});

test("retryTransient: gives up after a single retry (two failures propagate)", async () => {
  let calls = 0;
  await assert.rejects(
    () => retryTransient(async () => {
      calls++;
      throw httpError(500);
    }, 0),
    (err) => err.response.status === 500
  );
  assert.equal(calls, 2, "one original attempt + one retry, then give up");
});
