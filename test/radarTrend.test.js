// Regression tests for the radar per-direction trend pipeline. Pure-
// function coverage of the three internal helpers exposed as `__test`
// on radarAnalyzerCtrl. The scenarios below are the live cases that
// shaped the v2.13 trend overhaul — keeping them as tests guards
// against accidental regressions when the thresholds, ETA gate, or
// intensity-weighted summarization get touched again.
//
// Run: `npm test` (uses Node's built-in `node --test` runner, no deps).
//
// Snapshot shape: framesSamples is an array ordered newest → oldest,
// each frame is an array of { direction, distance, intensity } points.
// All three scenarios use a 3-frame window (now / -15 / -45) like
// production. The threshold for the outer ring in km is 8 (5 for inner).

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { __test } = require("../server/radarAnalyzerCtrl");
const { computePerDirectionTrends, summarizeRingTrend, computeTrendConfidence } = __test;

// ───────────────────────────────────────────────────────────────────────
// computePerDirectionTrends — per-direction trend + confidence
// ───────────────────────────────────────────────────────────────────────

test("Sorel scenario: very heavy band closing 85 → 45 km should read as approaching", () => {
  // Pre-v2.13 bug: the 30-min ETA gate left this case as `stable`,
  // letting a weak SW dispersing band flip the ring trend to `leaving`.
  // After the gate was widened to 60 min, this should land squarely
  // in the approaching bucket.
  const dir = "WNW";
  const framesSamples = [
    [{ direction: dir, distance: 45, intensity: 5 }],  // now: very heavy at 45km
    [{ direction: dir, distance: 60, intensity: 5 }],  // -15: very heavy at 60km
    [{ direction: dir, distance: 85, intensity: 5 }],  // -45: very heavy at 85km
  ];
  const map = computePerDirectionTrends(framesSamples, "km", "outer");
  const entry = map.get(dir);
  assert.equal(entry.trend, "approaching", "should be approaching");
  // shift = 85 - 45 = 40 km, speed ≈ 0.89 km/min, ETA = 45 / 0.89 ≈ 51 min
  // (< 60 min gate, so approaching wins over drifting)
  assert.ok(entry.confidence >= 70, `expected high confidence, got ${entry.confidence}`);
});

test("Stratford scenario: inward shift past ETA gate should read as drifting (not stable)", () => {
  // Pre-v2.13: band moving inward but >60 min projected arrival landed
  // as `stable` with 0% confidence (because |shift|/threshold = 1).
  // After introducing `drifting`, this scenario surfaces a real trend
  // with positive confidence.
  const dir = "WNW";
  const framesSamples = [
    [{ direction: dir, distance: 70, intensity: 4 }],  // now: heavy at 70km
    [{ direction: dir, distance: 78, intensity: 4 }],  // -15: heavy at 78km
    [{ direction: dir, distance: 92, intensity: 4 }],  // -45: heavy at 92km
  ];
  // shift = 92 - 70 = 22 km in 45 min → speed 0.49 km/min → ETA = 70/0.49 ≈ 143 min
  // 22 km >= 8 km threshold ✓, ETA fails 60-min gate → drifting
  const map = computePerDirectionTrends(framesSamples, "km", "outer");
  const entry = map.get(dir);
  assert.equal(entry.trend, "drifting", "should be drifting, not stable");
  assert.ok(entry.confidence > 0, `drifting should have non-zero confidence, got ${entry.confidence}`);
});

test("Beauce-Sartigan scenario: band forming in place (peakOld=very-light) should stay stable", () => {
  // Pre-v2.13: the algorithm tracked peak position only, not intensity
  // continuity. A direction where t-45 had a very-light cell at 100 km
  // and t-0 had heavy at 65 km got flagged drifting — but the band
  // hadn't actually moved, it had intensified in place. Fix: require
  // intensity ≥ 2 at BOTH endpoints for any non-stable trend label.
  const dir = "NNE";
  const framesSamples = [
    [{ direction: dir, distance: 65, intensity: 4 }],   // now: heavy at 65km (formed band)
    [{ direction: dir, distance: 70, intensity: 3 }],   // -15: moderate at 70km
    [{ direction: dir, distance: 100, intensity: 1 }],  // -45: very light at 100km (noise)
  ];
  const map = computePerDirectionTrends(framesSamples, "km", "outer");
  const entry = map.get(dir);
  // peakOld.intensity = 1 < 2 → intensity gate forces stable
  assert.equal(entry.trend, "stable", "intensification-in-place should not register as drifting/approaching");
});

test("Genuinely leaving band: peak shifted outward should read as leaving", () => {
  const dir = "SW";
  const framesSamples = [
    [{ direction: dir, distance: 95, intensity: 4 }],  // now: heavy at 95km
    [{ direction: dir, distance: 80, intensity: 4 }],  // -15: heavy at 80km
    [{ direction: dir, distance: 65, intensity: 4 }],  // -45: heavy at 65km
  ];
  // shift = 65 - 95 = -30 km (clearly outward, well past -8 km threshold)
  const map = computePerDirectionTrends(framesSamples, "km", "outer");
  const entry = map.get(dir);
  assert.equal(entry.trend, "leaving");
});

test("Clear direction (no precip in either frame) reads as stable with full confidence", () => {
  const dir = "E";
  const framesSamples = [
    [{ direction: dir, distance: 60, intensity: 0 }],  // intensity 0 → excluded from peaks
    [{ direction: dir, distance: 60, intensity: 0 }],
    [{ direction: dir, distance: 60, intensity: 0 }],
  ];
  const map = computePerDirectionTrends(framesSamples, "km", "outer");
  const entry = map.get(dir);
  assert.equal(entry.trend, "stable");
  assert.equal(entry.confidence, 100, "definitely-stable should hit max confidence");
});

// ───────────────────────────────────────────────────────────────────────
// summarizeRingTrend — intensity-weighted ring rollup
// ───────────────────────────────────────────────────────────────────────

test("Ring summary: dominant approaching beats weak leaving on a different bearing", () => {
  // Pre-v2.13 bug: "any leaving wins over stable" let a weak SW
  // dispersing band override an intense WNW approaching band, even
  // when the latter had higher peak intensity. Intensity-weighted
  // summarization should pick WNW.
  const perDir = new Map([
    ["WNW", { trend: "approaching", peakIntensityNow: 5, confidence: 80 }],
    ["SW",  { trend: "leaving",     peakIntensityNow: 2, confidence: 60 }],
    ["N",   { trend: "stable",      peakIntensityNow: 1, confidence: 90 }],
  ]);
  const out = summarizeRingTrend(perDir);
  assert.equal(out.trend, "approaching");
  assert.equal(out.confidence, 80, "should carry the dominant direction's confidence");
});

test("Ring summary: tie on peak intensity broken by trend priority (approaching > drifting > leaving > stable)", () => {
  const perDir = new Map([
    ["W",  { trend: "drifting",    peakIntensityNow: 4, confidence: 50 }],
    ["E",  { trend: "approaching", peakIntensityNow: 4, confidence: 50 }],
    ["S",  { trend: "leaving",     peakIntensityNow: 4, confidence: 50 }],
  ]);
  assert.equal(summarizeRingTrend(perDir).trend, "approaching");
});

test("Ring summary: empty map returns stable with zero confidence", () => {
  const out = summarizeRingTrend(new Map());
  assert.equal(out.trend, "stable");
  assert.equal(out.confidence, 0);
});

// ───────────────────────────────────────────────────────────────────────
// computeTrendConfidence — score 0-100 with magnitude / monotonicity /
// intensity-persistence components
// ───────────────────────────────────────────────────────────────────────

test("Confidence: full points (max magnitude + monotonic + persistent intensity) hits 100", () => {
  const score = computeTrendConfidence({
    trend: "approaching",
    inwardShift: 30, // 30 km on 8 km threshold = 3.75× threshold → cap 60
    threshold: 8,
    peakNow: { intensity: 4, distance: 50 },
    peakOld: { intensity: 4, distance: 80 },
    peakMid: { intensity: 4, distance: 65 }, // strictly between, monotonic
  });
  assert.equal(score, 100);
});

test("Confidence: stable with shift at threshold reads as 0% (barely stable)", () => {
  // 1 − min(1, |shift|/threshold) = 1 − 1 = 0
  const score = computeTrendConfidence({
    trend: "stable",
    inwardShift: 8,
    threshold: 8,
    peakNow: { intensity: 3, distance: 50 },
    peakOld: { intensity: 3, distance: 58 },
    peakMid: null,
  });
  assert.equal(score, 0);
});

test("Confidence: stable with no shift reads as 100% (definitely stable)", () => {
  const score = computeTrendConfidence({
    trend: "stable",
    inwardShift: 0,
    threshold: 8,
    peakNow: { intensity: 0, distance: null },
    peakOld: { intensity: 0, distance: null },
    peakMid: null,
  });
  assert.equal(score, 100);
});

test("Confidence: drifting uses the same monotonicity check as approaching (inward)", () => {
  // Regression: pre-fix, the monotonicity branch only handled
  // approaching/leaving; drifting fell into the leaving branch and
  // never got the +25 bonus.
  const scoreDrifting = computeTrendConfidence({
    trend: "drifting",
    inwardShift: 16, // 2× threshold → full 60 pts on magnitude
    threshold: 8,
    peakNow: { intensity: 3, distance: 60 },
    peakOld: { intensity: 3, distance: 76 },
    peakMid: { intensity: 3, distance: 68 }, // between 60 and 76, inward
  });
  // 60 (magnitude) + 25 (monotonic) + 15 (intensity persistence) = 100
  assert.equal(scoreDrifting, 100);
});
