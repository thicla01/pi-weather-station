// Regression tests for the AI summary's calm-day fast path.
//
// The fast path is the gate that SKIPS the billed Anthropic call: when
// current conditions are benign, the forecast window shows no incoming
// precipitation, and the radar snapshot is fully clear, the controller
// renders a localised template instead of paying for an LLM call. A
// regression here is either silent money (gate never fires → every calm
// poll bills a Claude call) or silent dishonesty (gate fires when it
// shouldn't → templated "nothing to report" while radar shows an active
// band).
//
// What we lock down here:
//   1. isCalmStableState boundaries — the 20 % precipitation-probability
//      threshold (current AND period), the disqualifying 4000–8000
//      Tomorrow.io weather-code range, and the "periodMaxPrecip must be a
//      real number" rule (null/unknown forecast → defer to Claude).
//   2. getPeriod boundaries — 5 / 18 / 21 local-hour cutoffs that decide
//      which forecast window paragraph 2 covers.
//   3. getHourlyForecast — [fromTs, toTs) windowing (inclusive lower,
//      exclusive upper) and avg/max/rounding rules.
//   4. isRadarClear — the gate couples to the literal "Active" token that
//      radarAnalyzerCtrl's formatSnapshot emits for the active-annulus
//      header. If that label ever changes, isRadarClear silently becomes
//      always-true (radar gate wide open). The cross-file contract tests
//      below exist to turn that silent failure into a loud one.
//
// Historical caveat, resolved 2026-07: analyzeRadar used to occasionally
// ship a legacy-format block instead (when the hierarchical output was
// longer), and that format never contained "Active" — silently widening
// isRadarClear. The legacy formatter was retired along with the
// compressionStats module (perf lot, 2026-07), so the hierarchical
// format is now the only thing analyzeRadar emits and the token
// contract pinned below is airtight.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { __test: aiTest } = require("../server/aiSummaryCtrl");
const {
  isRadarClear,
  isCalmStableState,
  buildCalmDayTemplate,
  getHourlyForecast,
  getPeriod,
} = aiTest;

const radarCtrl = require("../server/radarAnalyzerCtrl");

// Empirical threshold encoded in isCalmStableState (a literal in the
// controller, named here so the boundary tests read clearly).
const PRECIP_THRESHOLD = 20;

/**
 * Build a calm current-conditions fixture (Tomorrow.io `values` shape),
 * with per-test overrides.
 *
 * @param {Object} [overrides] Fields to override on the calm baseline
 * @returns {Object} Tomorrow.io-shaped current values
 */
function calmValues(overrides = {}) {
  return {
    temperature: 21.4,
    weatherCode: 1000, // Clear
    precipitationProbability: 0,
    humidity: 55,
    windSpeed: 2.5,
    ...overrides,
  };
}

// === isCalmStableState — baseline and precipitation thresholds ===

test("isCalmStableState: calm baseline (clear sky, 0% precip, clear radar) is calm", () => {
  assert.equal(isCalmStableState(calmValues(), 0, null), true);
});

test("isCalmStableState: current precip probability at threshold-1 is calm, at threshold is not", () => {
  const below = calmValues({ precipitationProbability: PRECIP_THRESHOLD - 1 });
  const atThreshold = calmValues({ precipitationProbability: PRECIP_THRESHOLD });
  assert.equal(isCalmStableState(below, 0, null), true);
  assert.equal(isCalmStableState(atThreshold, 0, null), false);
});

test("isCalmStableState: period max precip at threshold-1 is calm, at threshold is not", () => {
  assert.equal(isCalmStableState(calmValues(), PRECIP_THRESHOLD - 1, null), true);
  assert.equal(isCalmStableState(calmValues(), PRECIP_THRESHOLD, null), false);
});

test("isCalmStableState: unknown period precip (null/undefined/non-number) is NOT calm — defer to Claude", () => {
  // When the hourly/daily cache missed, we don't know whether the forecast
  // is calm; the fast path must refuse rather than render a template with
  // a silently-dropped paragraph 2.
  assert.equal(isCalmStableState(calmValues(), null, null), false);
  assert.equal(isCalmStableState(calmValues(), undefined, null), false);
  assert.equal(isCalmStableState(calmValues(), "5", null), false);
});

test("isCalmStableState: missing current conditions are NOT calm", () => {
  assert.equal(isCalmStableState(null, 0, null), false);
  assert.equal(isCalmStableState(undefined, 0, null), false);
  // temperature is the presence sentinel for the whole values object
  assert.equal(isCalmStableState({}, 0, null), false);
});

// === isCalmStableState — weather-code gate ===

test("isCalmStableState: every CALM_COND code (clear/cloudy/fog/wind families) qualifies", () => {
  // The codes the calm-day template can describe — see CALM_COND_BY_LANG
  // in aiSummaryCtrl.js. All are below the 4000 precipitation range.
  const calmCodes = [1000, 1001, 1100, 1101, 1102, 2000, 2100, 3000, 3001, 3002];
  for (const code of calmCodes) {
    assert.equal(
      isCalmStableState(calmValues({ weatherCode: code }), 0, null),
      true,
      `code ${code} should be calm`,
    );
  }
});

test("isCalmStableState: active-precipitation codes 4000–8000 disqualify (range boundaries included)", () => {
  const precipCodes = [
    4000, // Drizzle — lower bound of the range
    4201, // Heavy Rain
    5000, // Snow
    6001, // Freezing Rain
    7000, // Ice Pellets
    8000, // Thunderstorm — upper bound of the range
  ];
  for (const code of precipCodes) {
    assert.equal(
      isCalmStableState(calmValues({ weatherCode: code }), 0, null),
      false,
      `code ${code} should NOT be calm`,
    );
  }
});

test("isCalmStableState: missing weather code passes the code gate (precip + radar gates still apply)", () => {
  // Current behaviour, locked deliberately: a non-numeric code skips the
  // range check rather than failing closed — the probability and radar
  // gates remain the deciders.
  assert.equal(isCalmStableState(calmValues({ weatherCode: undefined }), 0, null), true);
});

// === isCalmStableState — radar gate ===

test("isCalmStableState: radar text with an Active block is NOT calm", () => {
  const active = "now:\n  Clear within 25km.\n  Active 50km-50km:\n    N      : 50km light";
  assert.equal(isCalmStableState(calmValues(), 0, active), false);
});

test("isCalmStableState: fully-clear radar text stays calm", () => {
  const clear = "now: clear (no precipitation within 100km)";
  assert.equal(isCalmStableState(calmValues(), 0, clear), true);
});

// === getPeriod — local-hour boundaries 5 / 18 / 21 ===

test("getPeriod: 5h–17h is morning (boundaries: 4→night, 5→morning, 17→morning)", () => {
  assert.equal(getPeriod(4), "night");
  assert.equal(getPeriod(5), "morning");
  assert.equal(getPeriod(12), "morning");
  assert.equal(getPeriod(17), "morning");
});

test("getPeriod: 18h–20h is evening (boundaries: 17→morning, 18→evening, 20→evening)", () => {
  assert.equal(getPeriod(18), "evening");
  assert.equal(getPeriod(20), "evening");
});

test("getPeriod: 21h+ and 0h–4h are night (boundaries: 20→evening, 21→night)", () => {
  assert.equal(getPeriod(21), "night");
  assert.equal(getPeriod(23), "night");
  assert.equal(getPeriod(0), "night");
});

// === getHourlyForecast — windowing and averaging ===

/**
 * ISO timestamp for a given UTC hour on a fixed test date.
 *
 * @param {Number} h Hour of day (UTC)
 * @returns {String} ISO 8601 timestamp
 */
function hourIso(h) {
  return new Date(Date.UTC(2026, 5, 10, h, 0, 0)).toISOString();
}

/**
 * Build one Tomorrow.io hourly interval.
 *
 * @param {Number} h UTC hour for startTime
 * @param {Object} values { temperature, precipitationProbability, windSpeed }
 * @returns {Object} Interval in Tomorrow.io timeline shape
 */
function interval(h, values) {
  return { startTime: hourIso(h), values };
}

/**
 * Wrap intervals in the Tomorrow.io hourly payload shape the controller
 * reads (`data.timelines[0].intervals`).
 *
 * @param {Array} intervals Interval objects
 * @returns {Object} Hourly payload
 */
function hourlyPayload(intervals) {
  return { data: { timelines: [{ intervals }] } };
}

const T18 = Date.UTC(2026, 5, 10, 18, 0, 0);
const T21 = Date.UTC(2026, 5, 10, 21, 0, 0);

test("getHourlyForecast: window is [fromTs, toTs) — lower bound included, upper bound excluded", () => {
  const payload = hourlyPayload([
    // Outliers placed just outside the window: if either leaks in, the
    // averages and max below are skewed beyond recognition.
    interval(17, { temperature: 100, precipitationProbability: 99, windSpeed: 50 }),
    interval(18, { temperature: 10, precipitationProbability: 0, windSpeed: 1 }),
    interval(19, { temperature: 11, precipitationProbability: 5, windSpeed: 2 }),
    interval(20, { temperature: 11, precipitationProbability: 10, windSpeed: 2 }),
    interval(21, { temperature: -100, precipitationProbability: 88, windSpeed: 50 }),
  ]);
  const forecast = getHourlyForecast(payload, T18, T21);
  assert.deepEqual(forecast, {
    avgTemp: 11, // (10 + 11 + 11) / 3 = 10.67 → 11
    maxPrecip: 10,
    avgWind: 2, // (1 + 2 + 2) / 3 = 1.67 → 2
  });
});

test("getHourlyForecast: maxPrecip treats missing precipitationProbability as 0 and rounds", () => {
  const payload = hourlyPayload([
    interval(18, { temperature: 10, precipitationProbability: 5, windSpeed: 1 }),
    interval(19, { temperature: 10, windSpeed: 1 }), // no precip field → counts as 0
    interval(20, { temperature: 10, precipitationProbability: 12.4, windSpeed: 1 }),
  ]);
  const forecast = getHourlyForecast(payload, T18, T21);
  assert.equal(forecast.maxPrecip, 12);
});

test("getHourlyForecast: returns null when payload, intervals, or window matches are missing", () => {
  assert.equal(getHourlyForecast(null, T18, T21), null);
  assert.equal(getHourlyForecast({}, T18, T21), null);
  assert.equal(getHourlyForecast({ data: { timelines: [] } }, T18, T21), null);
  // Intervals exist but none fall inside the window
  const outside = hourlyPayload([
    interval(10, { temperature: 10, precipitationProbability: 0, windSpeed: 1 }),
  ]);
  assert.equal(getHourlyForecast(outside, T18, T21), null);
});

// === isRadarClear — truth table ===

test("isRadarClear: no radar text (null/undefined/empty) counts as clear", () => {
  // Radar absence is non-fatal by design — the fast path proceeds assuming
  // clear; buildCalmDayTemplate then drops paragraph 3 via radarAvailable.
  assert.equal(isRadarClear(null), true);
  assert.equal(isRadarClear(undefined), true);
  assert.equal(isRadarClear(""), true);
});

test("isRadarClear: fully-clear snapshot text is clear", () => {
  assert.equal(isRadarClear("now: clear (no precipitation within 100km)"), true);
});

test("isRadarClear: any block containing Active is not clear, even alongside clear blocks", () => {
  const multiBlock = [
    "now: clear (no precipitation within 100km)",
    "-15 min:\n  Clear within 25km.\n  Active 50km-50km:\n    N      : 50km light",
  ].join("\n\n");
  assert.equal(isRadarClear(multiBlock), false);
});

// === Cross-file contract with radarAnalyzerCtrl.formatSnapshot ===
//
// isRadarClear's whole gate is `!radarText.includes("Active")` — it works
// only as long as formatSnapshot labels the active annulus with the exact
// "Active <from>-<to>:" header. formatSnapshot is not currently reachable
// through radarAnalyzerCtrl.__test (it exposes only the trend helpers), so
// the fixtures below reproduce its documented output byte-for-byte from
// the source of server/radarAnalyzerCtrl.js (formatSnapshot, tiers 1–4).
// If the __test surface ever grows formatSnapshot, the tests switch to the
// real function automatically.

const realFormatSnapshot =
  radarCtrl.__test && typeof radarCtrl.__test.formatSnapshot === "function"
    ? radarCtrl.__test.formatSnapshot
    : null;

// Samples: clear centre + a single light cell at N/50km inside an otherwise
// clear inner ring → formatSnapshot rolls up to "Clear within 25km." /
// "Clear beyond 75km." and an "Active 50km-50km:" annulus listing N only.
const ACTIVE_SAMPLES = [
  { direction: "C", distance: 0, intensity: 0 },
  { direction: "N", distance: 25, intensity: 0 },
  { direction: "N", distance: 50, intensity: 2 },
  { direction: "N", distance: 75, intensity: 0 },
  { direction: "N", distance: 100, intensity: 0 },
];

// CONTRACT FIXTURE — exact formatSnapshot output for ACTIVE_SAMPLES,
// hand-built from the source because formatSnapshot isn't exported:
//   `${label}:` / `  Clear within ${d}${unit}.` / `  Clear beyond ${d}${unit}.`
//   / `  Active ${from}${unit}-${to}${unit}:` / `    ${dir.padEnd(6)} : ${dist}${unit} ${INTENSITY_LABELS[i]}`
const ACTIVE_FIXTURE = [
  "now:",
  "  Clear within 25km.",
  "  Clear beyond 75km.",
  "  Active 50km-50km:",
  "    N      : 50km light",
].join("\n");

// CONTRACT FIXTURE — tier-1 all-clear short-circuit:
//   `${label}: clear (no precipitation within ${maxDist}${unit})`
const CLEAR_FIXTURE = "now: clear (no precipitation within 100km)";

test("contract: formatSnapshot output with an active zone is NOT radar-clear", () => {
  const text = realFormatSnapshot
    ? realFormatSnapshot(ACTIVE_SAMPLES, "now", "km")
    : ACTIVE_FIXTURE;
  // Sanity-check the fixture/real output anatomy before the assertion that
  // matters, so a drifted fixture fails here instead of passing vacuously.
  assert.ok(text.includes("Active 50km-50km:"), `unexpected snapshot shape:\n${text}`);
  assert.equal(isRadarClear(text), false);
});

test("contract: formatSnapshot all-clear output IS radar-clear", () => {
  const clearSamples = ACTIVE_SAMPLES.map((s) => ({ ...s, intensity: 0 }));
  const text = realFormatSnapshot
    ? realFormatSnapshot(clearSamples, "now", "km")
    : CLEAR_FIXTURE;
  assert.equal(text, CLEAR_FIXTURE);
  assert.equal(isRadarClear(text), true);
});

test("contract: radarAnalyzerCtrl source still emits the literal Active annulus header", () => {
  // Tripwire for the cross-module string coupling: if someone renames the
  // "Active" label in formatSnapshot (e.g. to "Precip"), isRadarClear's
  // includes("Active") check silently becomes always-true and the radar
  // gate stops gating. The regex targets the template literal that builds
  // the annulus header (`Active ${...}`) — doc comments that merely
  // mention "Active X-Y" don't match because they carry no `${`.
  const src = fs.readFileSync(
    path.join(__dirname, "..", "server", "radarAnalyzerCtrl.js"),
    "utf8",
  );
  assert.match(src, /Active \$\{/);
});

// === buildCalmDayTemplate — structure and distance phrasing ===

test("buildCalmDayTemplate: full data renders three paragraphs (current / period / radar)", () => {
  const summary = buildCalmDayTemplate({
    lang: "en",
    values: calmValues(),
    tempUnit: "c",
    speedUnit: "kmh",
    distanceUnit: "km",
    extendedRadius: false,
    periodKind: "evening",
    periodSummary: { avgTemp: 18, maxPrecip: 5, avgWind: 3 },
    radarAvailable: true,
  });
  const paragraphs = summary.split("\n\n");
  assert.equal(paragraphs.length, 3);
  assert.ok(paragraphs[0].includes("21°C"), paragraphs[0]);
  assert.ok(paragraphs[1].includes("this evening (18h–21h)"), paragraphs[1]);
  assert.equal(paragraphs[2], "Radar analysis: nothing to report within 50 km of your location.");
});

test("buildCalmDayTemplate: radar distance phrase follows distanceUnit and extendedRadius", () => {
  const build = (distanceUnit, extendedRadius) => buildCalmDayTemplate({
    lang: "en",
    values: calmValues(),
    tempUnit: "c",
    speedUnit: "kmh",
    distanceUnit,
    extendedRadius,
    periodKind: null,
    periodSummary: null,
    radarAvailable: true,
  });
  assert.ok(build("km", false).includes("within 50 km"));
  assert.ok(build("km", true).includes("within 100 km"));
  assert.ok(build("mi", false).includes("within 30 mi"));
  assert.ok(build("mi", true).includes("within 60 mi"));
});

test("buildCalmDayTemplate: missing period or radar data drops the corresponding paragraph", () => {
  const noPeriod = buildCalmDayTemplate({
    lang: "en",
    values: calmValues(),
    tempUnit: "c",
    speedUnit: "kmh",
    distanceUnit: "km",
    extendedRadius: false,
    periodKind: null,
    periodSummary: null,
    radarAvailable: true,
  });
  assert.equal(noPeriod.split("\n\n").length, 2);

  const noRadar = buildCalmDayTemplate({
    lang: "en",
    values: calmValues(),
    tempUnit: "c",
    speedUnit: "kmh",
    distanceUnit: "km",
    extendedRadius: false,
    periodKind: "tomorrow",
    periodSummary: { avgTemp: 18, maxPrecip: 5, avgWind: 3 },
    radarAvailable: false,
  });
  assert.equal(noRadar.split("\n\n").length, 2);
  assert.ok(!noRadar.includes("Radar analysis"));
});

test("buildCalmDayTemplate: localised radar paragraph keeps the per-language label convention", () => {
  const fr = buildCalmDayTemplate({
    lang: "fr",
    values: calmValues(),
    tempUnit: "c",
    speedUnit: "kmh",
    distanceUnit: "km",
    extendedRadius: false,
    periodKind: null,
    periodSummary: null,
    radarAvailable: true,
  });
  assert.ok(fr.includes("Analyse radar : rien à signaler dans les 50 km"), fr);
});
