// Tests for the current-temperature trailing-average smoother added to
// proxyCtrl to damp Tomorrow.io's noisy `timesteps=current` feed (see the
// "Current-temperature smoothing" block in server/proxyCtrl.js). Covers the
// pure mean helper, the stateful windowed + deduplicated accumulator, and the
// in-place payload rewrite — all via the controller's `__test` export.
//
// Run: `npm test` (Node's built-in `node --test` runner, no deps).

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { __test } = require("../server/proxyCtrl");
const {
  roundedMean, pushAndSmoothCurrent, smoothCurrentPayload,
  currentTempHistory, CURRENT_SMOOTH_WINDOW,
} = __test;

test("roundedMean averages finite values to 2 decimals", () => {
  assert.equal(roundedMean([10, 20, 30]), 20);
  assert.equal(roundedMean([1, 2]), 1.5);
  assert.equal(roundedMean([25.34, 27.74, 27.76]), 26.95);
});

test("roundedMean ignores non-finite entries and empty input", () => {
  assert.equal(roundedMean([10, NaN, 20]), 15);
  assert.equal(roundedMean([10, null, 20]), 15);
  assert.equal(roundedMean([]), null);
  assert.equal(roundedMean([NaN, Infinity]), null);
});

test("smoothing window is the configured 3 fetches", () => {
  assert.equal(CURRENT_SMOOTH_WINDOW, 3);
});

test("trailing average slides over the last 3 readings", () => {
  currentTempHistory.clear();
  const k = "test-window";
  assert.equal(pushAndSmoothCurrent(k, "t1", 20, 20).temperature, 20);
  assert.equal(pushAndSmoothCurrent(k, "t2", 30, 30).temperature, 25);
  assert.equal(pushAndSmoothCurrent(k, "t3", 25, 25).temperature, 25);
  // 4th reading drops t1 out of the window: mean(30, 25, 10)
  assert.equal(pushAndSmoothCurrent(k, "t4", 10, 10).temperature, 21.67);
});

test("a re-served identical intervalStart is deduplicated, not stacked", () => {
  currentTempHistory.clear();
  const k = "test-dedup";
  pushAndSmoothCurrent(k, "t1", 20, 20);
  pushAndSmoothCurrent(k, "t2", 30, 30);
  // Re-serving t2 with a corrected value replaces it: mean(20, 40) — not mean(20, 30, 40)
  assert.equal(pushAndSmoothCurrent(k, "t2", 40, 40).temperature, 30);
});

test("apparent temperature is smoothed alongside temperature", () => {
  currentTempHistory.clear();
  const k = "test-apparent";
  pushAndSmoothCurrent(k, "t1", 20, 24);
  const out = pushAndSmoothCurrent(k, "t2", 30, 26);
  assert.equal(out.temperature, 25);
  assert.equal(out.temperatureApparent, 25);
});

test("locations are tracked independently", () => {
  currentTempHistory.clear();
  pushAndSmoothCurrent("loc-A", "t1", 20, 20);
  const b = pushAndSmoothCurrent("loc-B", "t1", 30, 30);
  assert.equal(b.temperature, 30); // B not polluted by A's history
});

function payload(temp, apparent, code, startTime = "2026-07-12T23:37:00Z") {
  return { data: { timelines: [{ intervals: [
    { startTime, values: { temperature: temp, temperatureApparent: apparent, weatherCode: code } },
  ] }] } };
}

test("smoothCurrentPayload rewrites temperature in place, leaves other fields raw", () => {
  currentTempHistory.clear();
  const p1 = payload(20, 20, 1000, "2026-07-12T23:37:00Z");
  smoothCurrentPayload(p1, 45.5, -73.5);
  assert.equal(p1.data.timelines[0].intervals[0].values.temperature, 20); // first reading == raw

  const p2 = payload(30, 30, 1101, "2026-07-12T23:52:00Z");
  smoothCurrentPayload(p2, 45.5, -73.5);
  const v = p2.data.timelines[0].intervals[0].values;
  assert.equal(v.temperature, 25);   // mean(20, 30)
  assert.equal(v.weatherCode, 1101); // untouched — smoothing is temperature-only
});

test("smoothCurrentPayload is a no-op on malformed / temperature-less payloads", () => {
  assert.doesNotThrow(() => smoothCurrentPayload({}, 45, -73));
  assert.doesNotThrow(() => smoothCurrentPayload(null, 45, -73));
  const noTemp = { data: { timelines: [{ intervals: [{ startTime: "x", values: { humidity: 50 } }] }] } };
  smoothCurrentPayload(noTemp, 45, -73);
  assert.equal(noTemp.data.timelines[0].intervals[0].values.humidity, 50);
});
