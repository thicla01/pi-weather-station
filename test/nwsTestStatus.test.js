// Regression tests for NWS test/exercise-alert handling (the "Show test
// alerts" feature + the bug fix it carries: a live NWS National Tsunami
// Warning Center *Test* message rendering as a real red Extreme alert).
//
// Covers three pure pieces:
//   - _shared.isTestStatus     — CAP <status> classification
//   - nws.__test.normalize      — tags `isTest` WITHOUT touching tier/severity
//   - nws.__test.mapInBatches   — bounded-concurrency zone-fetch pool
//
// The actual security boundary (a remote client can't reveal test alerts) is
// the endpoint's `req.isLocal && showTest` and is NOT unit-testable — see the
// curl note in test/alertTestStrip.test.js.
//
// Run: `npm test` (Node's built-in `node --test` runner, no deps).

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { isTestStatus } = require("../server/govAlertSources/_shared");
const { __test: nwsTest } = require("../server/govAlertSources/nws");

const { normalize, mapInBatches } = nwsTest;

test("isTestStatus: non-Actual CAP statuses are test", () => {
  for (const s of ["Test", "Exercise", "System", "Draft"]) {
    assert.equal(isTestStatus(s), true, `${s} should classify as test`);
  }
});

test("isTestStatus: Actual / missing / empty are NOT test", () => {
  assert.equal(isTestStatus("Actual"), false);
  assert.equal(isTestStatus(undefined), false);
  assert.equal(isTestStatus(null), false);
  assert.equal(isTestStatus(""), false);
});

const feature = (props) => ({
  id: "urn:oid:test",
  geometry: null,
  properties: { event: "Tsunami Warning", severity: "Extreme", ...props },
});

test("normalize tags isTest for a Test alert, leaving tier/severity intact", () => {
  const n = normalize(feature({ status: "Test" }));
  assert.equal(n.isTest, true);
  // The flag is ORTHOGONAL to severity: a Test Tsunami still normalizes to a
  // real Extreme/red alert. It's the orchestrator gate that hides it, not a
  // tier downgrade — so when revealed the maintainer sees the authentic render.
  assert.equal(n.severity, "extreme");
  assert.equal(n.tier, "red");
});

test("normalize: Actual and status-less alerts are not test", () => {
  assert.equal(normalize(feature({ status: "Actual" })).isTest, false);
  assert.equal(normalize(feature({})).isTest, false); // ECCC-style: no status field
});

test("mapInBatches preserves input order and bounds concurrency to the limit", async () => {
  const items = Array.from({ length: 25 }, (_, i) => i);
  let active = 0;
  let maxActive = 0;
  const out = await mapInBatches(items, 10, async (n) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await Promise.resolve();
    active -= 1;
    return n * 2;
  });
  assert.deepEqual(out, items.map((n) => n * 2), "results returned in input order");
  assert.ok(maxActive <= 10, `at most 10 concurrent (observed ${maxActive})`);
  assert.ok(maxActive > 1, "batches actually run concurrently within the limit");
});

test("mapInBatches handles an empty list and a list shorter than the limit", async () => {
  assert.deepEqual(await mapInBatches([], 10, async (n) => n), []);
  assert.deepEqual(await mapInBatches([1, 2, 3], 10, async (n) => n + 1), [2, 3, 4]);
});
