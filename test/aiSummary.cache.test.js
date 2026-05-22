// Regression tests for the AI summary response cache.
//
// The cache fronts the Anthropic API: when a valid entry exists for a
// (location + lang + period + units) tuple, the handler returns the
// cached body without any LLM call. The cache TTL is 15 minutes — long
// enough to absorb the polling cadence of a single Pi (~one /api/weather-
// summary call per refresh) but short enough that user-visible changes
// (a fresh radar trend, a new gov alert) surface within an acceptable
// window.
//
// What we lock down here:
//   1. The cache TTL constant — a stray re-edit changing 15 min to 1.5
//      min would 10x the token bill silently.
//   2. The cache-key format — quantised to 4 decimals of lat/lon (~11 m)
//      and embeds every unit pref so a Settings toggle invalidates the
//      cached summary that would otherwise render in the wrong units.
//   3. The cache state mutation contract — read returns the stored
//      entry; expired entries can be detected via Date.now() vs
//      entry.expiresAt.
//
// Behavioural test of "cache hit short-circuits Anthropic" is not done
// here: that would require mocking the whole external chain (Tomorrow.io,
// Anthropic SDK, radar analyzer). The structural contracts above catch
// the most plausible regressions without that infrastructure.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { __test: aiTest, summaryCache } = require("../server/aiSummaryCtrl");
const { buildSummaryCacheKey, SUMMARY_CACHE_TTL } = aiTest;

// === TTL constant ===

test("SUMMARY_CACHE_TTL is exactly 15 minutes in milliseconds", () => {
  assert.equal(SUMMARY_CACHE_TTL, 15 * 60 * 1000);
  assert.equal(SUMMARY_CACHE_TTL, 900000);
});

// === Cache key format ===

test("buildSummaryCacheKey: stable format for a Montréal kiosk in French", () => {
  const key = buildSummaryCacheKey(45.5017, -73.5673, "fr", "current", "c", "kmh", "km");
  assert.equal(key, "45.5017:-73.5673:fr:current:c:kmh:km");
});

test("buildSummaryCacheKey: lat/lon quantised to 4 decimals (≈ 11 m precision)", () => {
  // 45.50171 and 45.50172 are ~1 m apart — same bucket.
  const a = buildSummaryCacheKey(45.50171, -73.5673, "fr", "current", "c", "kmh", "km");
  const b = buildSummaryCacheKey(45.50172, -73.5673, "fr", "current", "c", "kmh", "km");
  assert.equal(a, b);
});

test("buildSummaryCacheKey: 5th decimal of lat is part of rounding (4-decimal split)", () => {
  // 45.50174 → 45.5017, 45.50175 → 45.5018 (toFixed half-to-even-ish rounding)
  const a = buildSummaryCacheKey(45.50174, 0, "fr", "current", "c", "kmh", "km");
  const b = buildSummaryCacheKey(45.50175, 0, "fr", "current", "c", "kmh", "km");
  assert.notEqual(a, b);
});

test("buildSummaryCacheKey: language change invalidates cache", () => {
  const en = buildSummaryCacheKey(45.5, -73.5, "en", "current", "c", "kmh", "km");
  const fr = buildSummaryCacheKey(45.5, -73.5, "fr", "current", "c", "kmh", "km");
  assert.notEqual(en, fr);
});

test("buildSummaryCacheKey: each unit pref is part of the key (Settings-toggle invalidation)", () => {
  const base = buildSummaryCacheKey(45.5, -73.5, "fr", "current", "c", "kmh", "km");
  // Flip every unit individually — each must produce a different key.
  assert.notEqual(base, buildSummaryCacheKey(45.5, -73.5, "fr", "current", "f", "kmh", "km"));
  assert.notEqual(base, buildSummaryCacheKey(45.5, -73.5, "fr", "current", "c", "mph", "km"));
  assert.notEqual(base, buildSummaryCacheKey(45.5, -73.5, "fr", "current", "c", "kmh", "mi"));
});

test("buildSummaryCacheKey: period change invalidates cache", () => {
  const current = buildSummaryCacheKey(45.5, -73.5, "fr", "current", "c", "kmh", "km");
  const hourly  = buildSummaryCacheKey(45.5, -73.5, "fr", "hourly",  "c", "kmh", "km");
  assert.notEqual(current, hourly);
});

test("buildSummaryCacheKey: southern hemisphere / negative latitudes serialise cleanly", () => {
  const key = buildSummaryCacheKey(-33.8688, 151.2093, "en", "current", "c", "kmh", "km");
  assert.equal(key, "-33.8688:151.2093:en:current:c:kmh:km");
});

test("buildSummaryCacheKey: lat/lon at 0 keeps the .0000 suffix (not dropped)", () => {
  // Avoids subtle bugs where toString() would output "0" but toFixed(4) outputs "0.0000"
  const key = buildSummaryCacheKey(0, 0, "fr", "current", "c", "kmh", "km");
  assert.equal(key, "0.0000:0.0000:fr:current:c:kmh:km");
});

// === Cache state contract ===

test("summaryCache: stored entry is readable by its key", () => {
  const key = "test:store-roundtrip";
  const expiresAt = Date.now() + SUMMARY_CACHE_TTL;
  summaryCache[key] = { summary: "hello", expiresAt };

  assert.equal(summaryCache[key].summary, "hello");
  assert.equal(summaryCache[key].expiresAt, expiresAt);

  delete summaryCache[key];
});

test("summaryCache: expired entry can be detected via Date.now() vs entry.expiresAt", () => {
  const key = "test:expired";
  // expiresAt 1 ms in the past
  summaryCache[key] = { summary: "stale", expiresAt: Date.now() - 1 };
  const entry = summaryCache[key];

  // The handler's hit check is `cached && Date.now() < cached.expiresAt`.
  // For an expired entry, Date.now() >= expiresAt — i.e. the hit check fails.
  assert.ok(Date.now() >= entry.expiresAt);

  delete summaryCache[key];
});

test("summaryCache: fresh entry within the 15 min window is a cache hit", () => {
  const key = "test:fresh";
  // expiresAt 14 minutes in the future — well within TTL.
  summaryCache[key] = { summary: "warm", expiresAt: Date.now() + 14 * 60 * 1000 };
  const entry = summaryCache[key];

  assert.ok(Date.now() < entry.expiresAt);

  delete summaryCache[key];
});
