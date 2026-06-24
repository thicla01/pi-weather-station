// Regression tests for the orchestrator-level test-alert gate
// (govAlertsCtrl.filterTestAlerts). This is the SINGLE place that hides
// test/exercise alerts from every consumer — the banner endpoint, the
// nearby-alerts map overlay, AND the Sense HAT (which calls getActiveAlertsAt
// directly with no `req`). Placing the gate here rather than at one HTTP
// endpoint is what makes "hidden by default everywhere" true.
//
// Run: `npm test` (Node's built-in `node --test` runner, no deps).

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { __test } = require("../server/govAlertsCtrl");

const { filterTestAlerts } = __test;

const A = { id: "a", isTest: false, tier: "red" }; // real NWS alert
const T = { id: "t", isTest: true, tier: "red" };  // NWS test/exercise alert
const U = { id: "u", tier: "orange" };             // ECCC-style: no isTest field

test("default (showTest=false) drops only isTest alerts", () => {
  const out = filterTestAlerts([A, T, U], false);
  assert.deepEqual(out.map((x) => x.id), ["a", "u"]);
});

test("showTest=true keeps everything, including test alerts", () => {
  const out = filterTestAlerts([A, T, U], true);
  assert.deepEqual(out.map((x) => x.id), ["a", "t", "u"]);
});

test("a real (Actual / status-less) alert is NEVER dropped — regression vs over-filtering", () => {
  assert.deepEqual(filterTestAlerts([A], false).map((x) => x.id), ["a"]);
  assert.deepEqual(filterTestAlerts([A], true).map((x) => x.id), ["a"]);
  // An alert with no isTest field (e.g. every ECCC alert) survives default-hide.
  assert.deepEqual(filterTestAlerts([U], false).map((x) => x.id), ["u"]);
});

// MANUAL VERIFICATION (not unit-testable): the security boundary that a REMOTE
// client cannot reveal test alerts lives in the endpoint handlers as
//   const showTest = req.isLocal && req.query.showTest === "1";
// Confirm with curl against a running server:
//   localhost + "?showTest=1" → the test alert IS present
//   a LAN/VPN client + "?showTest=1" → the test alert is ABSENT (req.isLocal false)
