// Regression tests for the shared air-quality helpers
// (server/airQualitySources/_shared.js). The EPA AQI math is the
// load-bearing part: the 2026-06 quality audit found that
// `epaAqiFromConcentration` skipped EPA's mandatory truncation step,
// so raw/converted float concentrations falling in the gaps between
// breakpoint bands (PM2.5 ]12.0, 12.1[, PM10 ]54, 55[, CO ]4.4, 4.5[,
// ...) returned null and the badge silently showed nothing. These
// tests pin the official EPA reference points, the former-gap values,
// the 1h-SO2 off-scale fallback (EPA-prescribed 200), and the
// category scales shared with AQHI / IQA.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  haversineKm,
  categoryForAqhi,
  categoryForIqa,
  categoryForEpaAqi,
  epaAqiFromConcentration,
  __test: { truncateTo },
} = require("../server/airQualitySources/_shared");

// === epaAqiFromConcentration — official EPA reference points ===

test("PM2.5: official breakpoint values map to their exact AQI", () => {
  assert.equal(epaAqiFromConcentration("pm25", 0.0), 0);
  assert.equal(epaAqiFromConcentration("pm25", 12.0), 50);
  assert.equal(epaAqiFromConcentration("pm25", 12.1), 51);
  assert.equal(epaAqiFromConcentration("pm25", 35.4), 100);
  assert.equal(epaAqiFromConcentration("pm25", 35.5), 101);
  assert.equal(epaAqiFromConcentration("pm25", 55.4), 150);
  assert.equal(epaAqiFromConcentration("pm25", 55.5), 151);
  assert.equal(epaAqiFromConcentration("pm25", 150.4), 200);
  assert.equal(epaAqiFromConcentration("pm25", 250.5), 301);
  assert.equal(epaAqiFromConcentration("pm25", 500.4), 500);
});

test("PM10: official breakpoint values map to their exact AQI", () => {
  assert.equal(epaAqiFromConcentration("pm10", 0), 0);
  assert.equal(epaAqiFromConcentration("pm10", 54), 50);
  assert.equal(epaAqiFromConcentration("pm10", 55), 51);
  assert.equal(epaAqiFromConcentration("pm10", 154), 100);
  assert.equal(epaAqiFromConcentration("pm10", 155), 101);
  assert.equal(epaAqiFromConcentration("pm10", 254), 150);
  assert.equal(epaAqiFromConcentration("pm10", 604), 500);
});

test("O3 8h: official breakpoint values map to their exact AQI", () => {
  assert.equal(epaAqiFromConcentration("o3_8h", 0.054), 50);
  assert.equal(epaAqiFromConcentration("o3_8h", 0.055), 51);
  assert.equal(epaAqiFromConcentration("o3_8h", 0.070), 100);
  assert.equal(epaAqiFromConcentration("o3_8h", 0.071), 101);
  assert.equal(epaAqiFromConcentration("o3_8h", 0.085), 150);
  assert.equal(epaAqiFromConcentration("o3_8h", 0.200), 300);
});

test("O3 1h: defined only from 0.125 ppm; below-range returns null", () => {
  assert.equal(epaAqiFromConcentration("o3_1h", 0.100), null);
  assert.equal(epaAqiFromConcentration("o3_1h", 0.125), 101);
  assert.equal(epaAqiFromConcentration("o3_1h", 0.164), 150);
  assert.equal(epaAqiFromConcentration("o3_1h", 0.165), 151);
  assert.equal(epaAqiFromConcentration("o3_1h", 0.604), 500);
});

test("NO2: official breakpoint values map to their exact AQI", () => {
  assert.equal(epaAqiFromConcentration("no2", 53), 50);
  assert.equal(epaAqiFromConcentration("no2", 54), 51);
  assert.equal(epaAqiFromConcentration("no2", 100), 100);
  assert.equal(epaAqiFromConcentration("no2", 360), 150);
  assert.equal(epaAqiFromConcentration("no2", 2049), 500);
});

test("SO2: official breakpoint values map to their exact AQI", () => {
  assert.equal(epaAqiFromConcentration("so2", 35), 50);
  assert.equal(epaAqiFromConcentration("so2", 36), 51);
  assert.equal(epaAqiFromConcentration("so2", 185), 150);
  assert.equal(epaAqiFromConcentration("so2", 186), 151);
  assert.equal(epaAqiFromConcentration("so2", 304), 200);
});

test("CO: official breakpoint values map to their exact AQI", () => {
  assert.equal(epaAqiFromConcentration("co", 4.4), 50);
  assert.equal(epaAqiFromConcentration("co", 4.5), 51);
  assert.equal(epaAqiFromConcentration("co", 9.4), 100);
  assert.equal(epaAqiFromConcentration("co", 12.4), 150);
  assert.equal(epaAqiFromConcentration("co", 50.4), 500);
});

// === epaAqiFromConcentration — former band-gap values (the audit bug) ===
// Before the truncation fix, every value below fell between two bands
// and returned null (no AQI shown). EPA's TAD prescribes truncating
// the concentration to the table's precision first, which closes the
// gaps by construction.

test("former gap values now resolve via EPA truncation", () => {
  // PM2.5 ]12.0, 12.1[ → truncate to 1 decimal → 12.0 → AQI 50
  assert.equal(epaAqiFromConcentration("pm25", 12.05), 50);
  // PM10 ]54, 55[ → truncate to integer → 54 → AQI 50
  assert.equal(epaAqiFromConcentration("pm10", 54.7), 50);
  // CO ]4.4, 4.5[ → truncate to 1 decimal → 4.4 → AQI 50
  assert.equal(epaAqiFromConcentration("co", 4.45), 50);
  // O3 8h ]0.054, 0.055[ → truncate to 3 decimals → 0.054 → AQI 50
  assert.equal(epaAqiFromConcentration("o3_8h", 0.0545), 50);
  // O3 8h ]0.070, 0.071[ — the moderate/USG gap
  assert.equal(epaAqiFromConcentration("o3_8h", 0.0705), 100);
  // NO2 ]53, 54[ → truncate to integer → 53 → AQI 50
  assert.equal(epaAqiFromConcentration("no2", 53.5), 50);
  // SO2 ]35, 36[ → truncate to integer → 35 → AQI 50
  assert.equal(epaAqiFromConcentration("so2", 35.7), 50);
  // Gap at a higher band edge: PM2.5 ]35.4, 35.5[ → 35.4 → AQI 100
  assert.equal(epaAqiFromConcentration("pm25", 35.43), 100);
});

test("truncation truncates (never rounds up): just-below-breakpoint stays in the lower band", () => {
  // 12.09 is genuinely below 12.1 — must truncate to 12.0, not round to 12.1
  assert.equal(epaAqiFromConcentration("pm25", 12.09), 50);
  assert.equal(epaAqiFromConcentration("pm10", 154.9), 100);
  assert.equal(epaAqiFromConcentration("co", 4.49), 50);
});

// === epaAqiFromConcentration — 1h SO2 off-scale fallback ===

test("SO2 above 304 ppb returns the EPA-prescribed capped AQI of 200", () => {
  // Per EPA, AQI > 200 for SO2 is defined only on the 24h average;
  // with only a 1h reading available, EPA says to report 200.
  assert.equal(epaAqiFromConcentration("so2", 305), 200);
  assert.equal(epaAqiFromConcentration("so2", 304.6), 200); // truncates to 304 → top of band
  assert.equal(epaAqiFromConcentration("so2", 1000), 200);
});

// === epaAqiFromConcentration — invalid / out-of-range inputs ===

test("invalid inputs return null", () => {
  assert.equal(epaAqiFromConcentration("pm25", null), null);
  assert.equal(epaAqiFromConcentration("pm25", undefined), null);
  assert.equal(epaAqiFromConcentration("pm25", NaN), null);
  assert.equal(epaAqiFromConcentration("pm25", -1), null);
  assert.equal(epaAqiFromConcentration("nope", 10), null);
});

test("values above the top band return null (except the SO2 fallback)", () => {
  assert.equal(epaAqiFromConcentration("pm25", 500.5), null);
  assert.equal(epaAqiFromConcentration("pm10", 605), null);
  assert.equal(epaAqiFromConcentration("co", 50.5), null);
  assert.equal(epaAqiFromConcentration("o3_1h", 0.605), null);
});

// === truncateTo — float-noise robustness ===

test("truncateTo: keeps breakpoint values intact despite float representation", () => {
  assert.equal(truncateTo(55.4, 1), 55.4);
  assert.equal(truncateTo(0.070, 3), 0.070);
  assert.equal(truncateTo(12.05, 1), 12.0);
  assert.equal(truncateTo(54.7, 0), 54);
  // A converted value that lands a hair under a breakpoint due to
  // float math must still read as the breakpoint (1108 / 20 = 55.4).
  assert.equal(truncateTo(1108 / 20, 1), 55.4);
});

// === categoryForAqhi (Health Canada 1-10+ scale) ===

test("categoryForAqhi: boundaries per the Health Canada scale", () => {
  assert.equal(categoryForAqhi(1), "low");
  assert.equal(categoryForAqhi(3.9), "low");
  assert.equal(categoryForAqhi(4), "moderate");
  assert.equal(categoryForAqhi(6.9), "moderate");
  assert.equal(categoryForAqhi(7), "high");
  assert.equal(categoryForAqhi(10), "high");
  assert.equal(categoryForAqhi(10.1), "veryHigh");
  assert.equal(categoryForAqhi(null), null);
  assert.equal(categoryForAqhi(NaN), null);
});

// === categoryForIqa (Quebec MELCC scale, "Mauvais" split at 100) ===

test("categoryForIqa: boundaries per the MELCC scale", () => {
  assert.equal(categoryForIqa(1), "low");
  assert.equal(categoryForIqa(25), "low");
  assert.equal(categoryForIqa(26), "moderate");
  assert.equal(categoryForIqa(50), "moderate");
  assert.equal(categoryForIqa(51), "high");
  assert.equal(categoryForIqa(100), "high");
  assert.equal(categoryForIqa(101), "veryHigh");
  assert.equal(categoryForIqa(null), null);
});

// === categoryForEpaAqi (EPA 0-500 scale collapsed to four tiers) ===

test("categoryForEpaAqi: boundaries at 50 / 100 / 150", () => {
  assert.equal(categoryForEpaAqi(0), "low");
  assert.equal(categoryForEpaAqi(50), "low");
  assert.equal(categoryForEpaAqi(51), "moderate");
  assert.equal(categoryForEpaAqi(100), "moderate");
  assert.equal(categoryForEpaAqi(101), "high");
  assert.equal(categoryForEpaAqi(150), "high");
  assert.equal(categoryForEpaAqi(151), "veryHigh");
  assert.equal(categoryForEpaAqi(500), "veryHigh");
  assert.equal(categoryForEpaAqi(null), null);
});

// === haversineKm ===

test("haversineKm: Montréal → Québec City is ~233 km", () => {
  const km = haversineKm(45.5019, -73.5674, 46.8131, -71.2075);
  assert.ok(Math.abs(km - 233) <= 5, `expected ~233 km, got ${km}`);
});

test("haversineKm: zero distance for identical points", () => {
  assert.equal(haversineKm(45.5, -73.6, 45.5, -73.6), 0);
});
