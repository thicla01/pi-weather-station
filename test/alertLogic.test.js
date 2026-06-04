// Regression tests for `client/src/ui/alertLogic.js`. The state
// machine here used to live inside AlertBanner; pulling it out into a
// pure module means we can now lock its transitions down with tests
// that survive React refactors.
//
// Run: `npm test`

const { test } = require("node:test");
const assert = require("node:assert/strict");

// Same duplication pattern as `uiHybrid.test.js` — re-implementing the
// helpers here keeps the test runner deps-free. If `alertLogic.js`
// drifts from this copy, the tests fail loudly.
const CONFIDENCE_HIGH = 70;
const CONFIDENCE_MID = 40;
function confidenceBucket(c) {
  if (c >= CONFIDENCE_HIGH) return "high";
  if (c >= CONFIDENCE_MID) return "mid";
  return "low";
}
function severity(level) {
  if (level === "red") return 3;
  if (level === "orange") return 2;
  if (level === "yellow") return 1;
  return 0;
}
function isCurrentlyPrecipitating(weatherCode) {
  if (typeof weatherCode !== "number") return false;
  if (weatherCode >= 4000 && weatherCode <= 4201) return true;
  if (weatherCode >= 5000 && weatherCode <= 5101) return true;
  if (weatherCode >= 6000 && weatherCode <= 6201) return true;
  if (weatherCode >= 7000 && weatherCode <= 7102) return true;
  if (weatherCode === 8000) return true;
  return false;
}
function getRadarAlertState(innerRisk, outerRisk, innerTrend, outerTrend, innerBumped, outerBumped, innerC, outerC, currentlyPrecipitating) {
  const innerSev = severity(innerRisk);
  const outerSev = severity(outerRisk);
  const maxSev = Math.max(innerSev, outerSev);
  if (maxSev < 2) return null;
  const tier = maxSev === 3 ? "red" : "orange";
  const innerIsSource = innerSev === maxSev;
  const sourceTrend = innerIsSource ? innerTrend : outerTrend;
  const sourceBumped = innerIsSource ? innerBumped : outerBumped;
  const confidence = Math.max(0, Math.min(100, Math.round(innerIsSource ? innerC : outerC)));
  const bucket = confidenceBucket(confidence);
  if (sourceBumped) {
    const variant = currentlyPrecipitating ? "Intensifying" : "Approaching";
    return { tier, i18nKey: `alert.${tier}${variant}`, confidence, confidenceBucket: bucket };
  }
  if (sourceTrend === "drifting") {
    return { tier, i18nKey: `alert.${tier}Drifting`, confidence, confidenceBucket: bucket };
  }
  if (bucket === "low") {
    return { tier, i18nKey: `alert.${tier}${innerIsSource ? "Near" : "Approaching"}`, confidence, confidenceBucket: bucket };
  }
  if (sourceTrend === "leaving") {
    const suffix = bucket === "mid" ? "LeavingHedged" : "Leaving";
    return { tier, i18nKey: `alert.${tier}${suffix}`, confidence, confidenceBucket: bucket };
  }
  if (sourceTrend === "approaching") {
    const suffix = bucket === "mid" ? "ApproachingHedged" : "Approaching";
    return { tier, i18nKey: `alert.${tier}${suffix}`, confidence, confidenceBucket: bucket };
  }
  return { tier, i18nKey: `alert.${tier}${innerIsSource ? "Near" : "Approaching"}`, confidence, confidenceBucket: bucket };
}

// ───────────────────────────────────────────────────────────────────────
// severity
// ───────────────────────────────────────────────────────────────────────

test("severity: red is 3, orange 2, yellow 1, calm/null 0", () => {
  assert.equal(severity("red"), 3);
  assert.equal(severity("orange"), 2);
  assert.equal(severity("yellow"), 1);
  assert.equal(severity("calm"), 0);
  assert.equal(severity(null), 0);
});

// ───────────────────────────────────────────────────────────────────────
// isCurrentlyPrecipitating
// ───────────────────────────────────────────────────────────────────────

test("isCurrentlyPrecipitating: undefined input is false", () => {
  assert.equal(isCurrentlyPrecipitating(undefined), false);
});

test("isCurrentlyPrecipitating: rain (4000-4201) is true", () => {
  assert.equal(isCurrentlyPrecipitating(4000), true);
  assert.equal(isCurrentlyPrecipitating(4201), true);
});

test("isCurrentlyPrecipitating: snow (5000-5101) is true", () => {
  assert.equal(isCurrentlyPrecipitating(5000), true);
});

test("isCurrentlyPrecipitating: thunderstorm (8000) is true", () => {
  assert.equal(isCurrentlyPrecipitating(8000), true);
});

test("isCurrentlyPrecipitating: clear (1000) is false", () => {
  assert.equal(isCurrentlyPrecipitating(1000), false);
});

// ───────────────────────────────────────────────────────────────────────
// getRadarAlertState — SHOW gate
// ───────────────────────────────────────────────────────────────────────

test("getRadarAlertState: calm/yellow only returns null (SHOW gate)", () => {
  assert.equal(getRadarAlertState("yellow", "calm", "stable", "stable", false, false, 80, 80, false), null);
  assert.equal(getRadarAlertState("calm", "calm", "stable", "stable", false, false, 0, 0, false), null);
});

test("getRadarAlertState: orange clears the SHOW gate", () => {
  const result = getRadarAlertState("orange", "calm", "stable", "stable", false, false, 80, 0, false);
  assert.equal(result.tier, "orange");
});

test("getRadarAlertState: red wins tier when present", () => {
  const result = getRadarAlertState("orange", "red", "stable", "stable", false, false, 80, 80, false);
  assert.equal(result.tier, "red");
});

// ───────────────────────────────────────────────────────────────────────
// getRadarAlertState — bumped wording
// ───────────────────────────────────────────────────────────────────────

test("getRadarAlertState: bumped + dry → Approaching wording", () => {
  const r = getRadarAlertState("red", "calm", "stable", "stable", true, false, 80, 0, false);
  assert.equal(r.i18nKey, "alert.redApproaching");
});

test("getRadarAlertState: bumped + currently raining → Intensifying wording", () => {
  const r = getRadarAlertState("red", "calm", "stable", "stable", true, false, 80, 0, true);
  assert.equal(r.i18nKey, "alert.redIntensifying");
});

// ───────────────────────────────────────────────────────────────────────
// getRadarAlertState — trend wording + confidence softening
// ───────────────────────────────────────────────────────────────────────

test("getRadarAlertState: high-confidence approaching → unhedged Approaching", () => {
  const r = getRadarAlertState("red", "calm", "approaching", "stable", false, false, 85, 0, false);
  assert.equal(r.i18nKey, "alert.redApproaching");
  assert.equal(r.confidenceBucket, "high");
});

test("getRadarAlertState: mid-confidence approaching → ApproachingHedged", () => {
  const r = getRadarAlertState("red", "calm", "approaching", "stable", false, false, 55, 0, false);
  assert.equal(r.i18nKey, "alert.redApproachingHedged");
  assert.equal(r.confidenceBucket, "mid");
});

test("getRadarAlertState: low-confidence approaching falls back to position-only", () => {
  const r = getRadarAlertState("red", "calm", "approaching", "stable", false, false, 25, 0, false);
  assert.equal(r.i18nKey, "alert.redNear");
  assert.equal(r.confidenceBucket, "low");
});

test("getRadarAlertState: drifting always wins over bucket softening", () => {
  const r = getRadarAlertState("red", "calm", "drifting", "stable", false, false, 25, 0, false);
  assert.equal(r.i18nKey, "alert.redDrifting");
});

test("getRadarAlertState: leaving + mid confidence → LeavingHedged", () => {
  const r = getRadarAlertState("red", "calm", "leaving", "stable", false, false, 55, 0, false);
  assert.equal(r.i18nKey, "alert.redLeavingHedged");
});

test("getRadarAlertState: outer-source approaching reads as Approaching not Near", () => {
  const r = getRadarAlertState("calm", "red", "stable", "approaching", false, false, 0, 85, false);
  assert.equal(r.i18nKey, "alert.redApproaching");
});

test("getRadarAlertState: confidence is clamped 0-100", () => {
  const r1 = getRadarAlertState("red", "calm", "stable", "stable", false, false, 150, 0, false);
  assert.equal(r1.confidence, 100);
  const r2 = getRadarAlertState("red", "calm", "stable", "stable", false, false, -20, 0, false);
  assert.equal(r2.confidence, 0);
});

// ───────────────────────────────────────────────────────────────────────
// selectEligibleGovAlerts — the displayable-tier filter shared by the
// AlertBanner counter, primary index, AlertDetailInline,
// FloatingMiniBanner and AlertMiniCards (via useEligibleGovAlerts).
// Re-implemented here deps-free, same pattern as the helpers above.
// ───────────────────────────────────────────────────────────────────────

const ELIGIBLE_GOV_TIERS = ["red", "orange"];
const ELIGIBLE_GOV_TIERS_WITH_ADVISORY = ["red", "orange", "yellow"];
function selectEligibleGovAlerts(alerts, showAdvisory = false) {
  if (!Array.isArray(alerts)) return [];
  const tiers = showAdvisory ? ELIGIBLE_GOV_TIERS_WITH_ADVISORY : ELIGIBLE_GOV_TIERS;
  return alerts.filter((a) => tiers.includes(a?.tier));
}

test("selectEligibleGovAlerts: keeps red and orange, drops yellow", () => {
  const out = selectEligibleGovAlerts([
    { id: "a", tier: "red" },
    { id: "b", tier: "orange" },
    { id: "c", tier: "yellow" },
  ]);
  assert.deepEqual(out.map((a) => a.id), ["a", "b"]);
});

test("selectEligibleGovAlerts: Nicolet regression — a yellow alert must not inflate the count", () => {
  // The Nicolet report (2026-05-29): one red/orange ECCC alert plus one
  // yellow-tier alert showed "1 / 2" in the banner but only one card.
  // The eligible set the counter/cards run off must be length 1, so the
  // counter reads "1 / 1" and there is no orphan second card.
  const visible = [
    { id: "orage", tier: "red" },
    { id: "veille-jaune", tier: "yellow" },
  ];
  const eligible = selectEligibleGovAlerts(visible);
  assert.equal(eligible.length, 1);
  assert.equal(eligible[0].id, "orage");
});

test("selectEligibleGovAlerts: non-array / empty inputs return []", () => {
  assert.deepEqual(selectEligibleGovAlerts(null), []);
  assert.deepEqual(selectEligibleGovAlerts(undefined), []);
  assert.deepEqual(selectEligibleGovAlerts([]), []);
});

test("selectEligibleGovAlerts: alerts with no tier are dropped", () => {
  const out = selectEligibleGovAlerts([{ id: "a" }, { id: "b", tier: "red" }]);
  assert.deepEqual(out.map((a) => a.id), ["b"]);
});

test("selectEligibleGovAlerts: showAdvisory=true also keeps the yellow tier", () => {
  // The k5map opt-in (flood-prone TX): with advisories enabled the
  // yellow tier (Flood Advisory etc.) joins red/orange.
  const out = selectEligibleGovAlerts([
    { id: "a", tier: "red" },
    { id: "b", tier: "orange" },
    { id: "c", tier: "yellow" },
  ], true);
  assert.deepEqual(out.map((a) => a.id), ["a", "b", "c"]);
});

test("selectEligibleGovAlerts: defaults off — yellow dropped without the opt-in", () => {
  // Default arg must preserve the historical red/orange-only behaviour
  // so every existing caller is unchanged until it passes the flag.
  assert.deepEqual(selectEligibleGovAlerts([{ id: "adv", tier: "yellow" }]), []);
  assert.deepEqual(selectEligibleGovAlerts([{ id: "adv", tier: "yellow" }], false), []);
});
