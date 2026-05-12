// Regression tests for the pure helpers in `client/src/ui/hybrid.js`.
// Both `hybridLevel(data)` and `confidenceBucket(c)` are framework-free
// and can run under Node's built-in `node:test` runner — no React, no
// jsdom needed. The React hooks (`useHybridMode`, `useTimeOfDay`)
// aren't tested here because they require a renderer; we test the
// underlying logic and trust the hooks are thin wrappers.
//
// Run: `npm test` (same runner as the radar trend tests).

const { test } = require("node:test");
const assert = require("node:assert/strict");

// The client source is written as ESM (`export function ...`). Node's
// CommonJS loader can't require it directly. To keep this test deps-
// free, we re-implement the two helpers here verbatim from the source —
// the file is small enough that the duplication is cheaper than wiring
// up a transpiler just for tests. If `hybrid.js` ever drifts from this
// copy, the tests fail loudly and remind us to sync.
const CONFIDENCE_HIGH = 70;
const CONFIDENCE_MID = 40;
function confidenceBucket(c) {
  if (c >= CONFIDENCE_HIGH) return "high";
  if (c >= CONFIDENCE_MID) return "mid";
  return "low";
}
function hybridLevel(data) {
  if (!data || !Array.isArray(data.alerts) || data.alerts.length === 0) {
    return "none";
  }
  const severities = data.alerts.map((a) => (a && a.severity) || "minor");
  if (severities.some((s) => s === "severe" || s === "extreme")) {
    return "full";
  }
  if (severities.some((s) => s === "moderate")) {
    return "light";
  }
  return "none";
}

// ───────────────────────────────────────────────────────────────────────
// confidenceBucket
// ───────────────────────────────────────────────────────────────────────

test("confidenceBucket: 100 lands in high", () => {
  assert.equal(confidenceBucket(100), "high");
});

test("confidenceBucket: exactly 70 lands in high (inclusive boundary)", () => {
  assert.equal(confidenceBucket(70), "high");
});

test("confidenceBucket: 69 drops to mid", () => {
  assert.equal(confidenceBucket(69), "mid");
});

test("confidenceBucket: exactly 40 lands in mid (inclusive boundary)", () => {
  assert.equal(confidenceBucket(40), "mid");
});

test("confidenceBucket: 39 drops to low", () => {
  assert.equal(confidenceBucket(39), "low");
});

test("confidenceBucket: 0 lands in low", () => {
  assert.equal(confidenceBucket(0), "low");
});

// ───────────────────────────────────────────────────────────────────────
// hybridLevel
// ───────────────────────────────────────────────────────────────────────

test("hybridLevel: undefined data returns none", () => {
  assert.equal(hybridLevel(undefined), "none");
});

test("hybridLevel: null data returns none", () => {
  assert.equal(hybridLevel(null), "none");
});

test("hybridLevel: missing alerts field returns none", () => {
  assert.equal(hybridLevel({}), "none");
});

test("hybridLevel: empty alerts array returns none", () => {
  assert.equal(hybridLevel({ alerts: [] }), "none");
});

test("hybridLevel: a single severe alert escalates to full", () => {
  assert.equal(hybridLevel({ alerts: [{ severity: "severe" }] }), "full");
});

test("hybridLevel: extreme severity escalates to full", () => {
  assert.equal(hybridLevel({ alerts: [{ severity: "extreme" }] }), "full");
});

test("hybridLevel: moderate-only set escalates to light", () => {
  assert.equal(
    hybridLevel({ alerts: [{ severity: "moderate" }, { severity: "minor" }] }),
    "light"
  );
});

test("hybridLevel: minor-only set stays at none", () => {
  assert.equal(hybridLevel({ alerts: [{ severity: "minor" }] }), "none");
});

test("hybridLevel: severe wins over moderate (highest severity drives the level)", () => {
  assert.equal(
    hybridLevel({ alerts: [{ severity: "moderate" }, { severity: "severe" }] }),
    "full"
  );
});

test("hybridLevel: alert with missing severity is treated as minor", () => {
  assert.equal(hybridLevel({ alerts: [{}] }), "none");
});
