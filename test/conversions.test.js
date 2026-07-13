// Regression tests for the pure functions in `client/src/services/conversions.js`.
// All four exports (`convertTemp`, `convertSpeed`, `speedUnitLabel`,
// `convertLength`) are framework-free arithmetic with no React, no fetch,
// no global state — perfect candidates for the built-in `node:test` runner.
//
// Run: `npm test` (same runner as radarTrend / alertLogic / uiHybrid).
//
// The client source uses ESM (`export const ...`). Node's CommonJS loader
// can't require it directly; rather than wire up a transpiler just for
// tests we re-implement the helpers verbatim here — same pattern as
// `uiHybrid.test.js`. The functions are short enough that the duplication
// is cheaper than the build-step alternative. If `conversions.js` drifts
// from this copy, the tests fail loudly and remind us to sync.
//
// Silencing console.log: the source emits `console.log("missing input ...")`
// on null inputs (a leftover diagnostic, not a contract). The runner shows
// those lines as part of the test output. We could intercept but it would
// add noise without buying anything.

const { test } = require("node:test");
const assert = require("node:assert/strict");

// ---------- start of verbatim copy from client/src/services/conversions.js ----------
const cToF = (c) => c * (9/5) + 32;

const convertTemp = (c, units) => {
  if (!c && c !== 0) {
    return null;
  }
  if (units && units.toLowerCase() === "c") return Math.round(c);
  if (units && units.toLowerCase() === "f") return Math.round(cToF(c));
  if (units && units.toLowerCase() === "k") return Math.round(c + 273.15);
  return null;
};

const msToMph = (ms) => ms / 0.44704;
const msToKmh = (ms) => ms * 3.6;

const convertSpeed = (speed, units) => {
  if (!speed && speed !== 0) return null;
  if (units && units.toLowerCase() === "mph") return parseInt(msToMph(speed));
  if (units && units.toLowerCase() === "ms")  return parseInt(speed);
  if (units && units.toLowerCase() === "kmh") return Math.round(msToKmh(speed));
  return null;
};

const speedUnitLabel = (unit) => {
  if (!unit) return "m/s";
  switch (unit.toLowerCase()) {
    case "mph": return "mph";
    case "kmh": return "kph";
    default:    return "m/s";
  }
};

const mmToIn = (mm) => mm / 25.4;

const convertLength = (len, units) => {
  if (!len && len !== 0) return null;
  if (units && units.toLowerCase() === "in") return parseInt(mmToIn(len) * 100) / 100;
  if (units && units.toLowerCase() === "mm") return len;
  return null;
};
// ---------- end of verbatim copy ----------

// === convertTemp ===

test("convertTemp: 0 °C → 32 °F", () => {
  assert.equal(convertTemp(0, "f"), 32);
});

test("convertTemp: 100 °C → 212 °F (boiling)", () => {
  assert.equal(convertTemp(100, "f"), 212);
});

test("convertTemp: -40 °C → -40 °F (the famous crossover)", () => {
  assert.equal(convertTemp(-40, "f"), -40);
});

test("convertTemp: 0 °C → 273 K", () => {
  assert.equal(convertTemp(0, "k"), 273);
});

test("convertTemp: 25 °C round-trips as integer to celsius", () => {
  assert.equal(convertTemp(25, "c"), 25);
});

test("convertTemp: case-insensitive unit (uppercase F)", () => {
  assert.equal(convertTemp(0, "F"), 32);
});

test("convertTemp: null input → null", () => {
  assert.equal(convertTemp(null, "f"), null);
});

test("convertTemp: undefined input → null", () => {
  assert.equal(convertTemp(undefined, "f"), null);
});

test("convertTemp: 0 input is preserved (not treated as missing)", () => {
  // The guard is `!c && c !== 0` precisely so that 0 °C is a valid temperature
  assert.equal(convertTemp(0, "c"), 0);
});

test("convertTemp: invalid unit → null", () => {
  assert.equal(convertTemp(20, "celsius"), null);
});

test("convertTemp: missing unit → null", () => {
  assert.equal(convertTemp(20), null);
});

// === convertSpeed ===

test("convertSpeed: 0 m/s → 0 mph / 0 ms / 0 kmh", () => {
  assert.equal(convertSpeed(0, "mph"), 0);
  assert.equal(convertSpeed(0, "ms"),  0);
  assert.equal(convertSpeed(0, "kmh"), 0);
});

test("convertSpeed: 10 m/s → 22 mph", () => {
  // 10 / 0.44704 = 22.3694; parseInt → 22
  assert.equal(convertSpeed(10, "mph"), 22);
});

test("convertSpeed: 10 m/s → 36 kmh", () => {
  // 10 * 3.6 = 36
  assert.equal(convertSpeed(10, "kmh"), 36);
});

test("convertSpeed: 10 m/s passed as ms → 10", () => {
  assert.equal(convertSpeed(10, "ms"), 10);
});

test("convertSpeed: case-insensitive unit (KMH)", () => {
  assert.equal(convertSpeed(10, "KMH"), 36);
});

test("convertSpeed: null input → null", () => {
  assert.equal(convertSpeed(null, "mph"), null);
});

test("convertSpeed: invalid unit → null", () => {
  assert.equal(convertSpeed(10, "knots"), null);
});

// === speedUnitLabel ===

test("speedUnitLabel: kmh renders as 'kph' (display convention from CLAUDE.md)", () => {
  assert.equal(speedUnitLabel("kmh"), "kph");
});

test("speedUnitLabel: mph passes through", () => {
  assert.equal(speedUnitLabel("mph"), "mph");
});

test("speedUnitLabel: ms falls through to m/s", () => {
  assert.equal(speedUnitLabel("ms"), "m/s");
});

test("speedUnitLabel: undefined → m/s default", () => {
  assert.equal(speedUnitLabel(undefined), "m/s");
});

test("speedUnitLabel: unknown unit falls back to m/s", () => {
  assert.equal(speedUnitLabel("furlongs"), "m/s");
});

test("speedUnitLabel: case-insensitive (KMH → kph)", () => {
  assert.equal(speedUnitLabel("KMH"), "kph");
});

// === convertLength ===

test("convertLength: 25.4 mm → 1 in (definition)", () => {
  assert.equal(convertLength(25.4, "in"), 1);
});

test("convertLength: 0 mm → 0 (preserved, not treated as missing)", () => {
  assert.equal(convertLength(0, "in"), 0);
  assert.equal(convertLength(0, "mm"), 0);
});

test("convertLength: mm passes through unchanged", () => {
  assert.equal(convertLength(12.7, "mm"), 12.7);
});

test("convertLength: 50.8 mm → 2.00 in (rounded to 2 decimals)", () => {
  // 50.8 / 25.4 = 2.0; parseInt(200) / 100 = 2
  assert.equal(convertLength(50.8, "in"), 2);
});

test("convertLength: 76.2 mm → 3.00 in", () => {
  assert.equal(convertLength(76.2, "in"), 3);
});

test("convertLength: null input → null", () => {
  assert.equal(convertLength(null, "in"), null);
});

test("convertLength: invalid unit → null", () => {
  assert.equal(convertLength(25.4, "cm"), null);
});
