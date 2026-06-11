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
//   2. The cache-key format — quantised to 2 decimals of lat/lon (~1.1 km
//      grid, coarse enough that sub-km jitter can't bust the cache on the
//      paid Anthropic path) and embeds every unit pref so a Settings toggle
//      invalidates the cached summary that would otherwise render in the
//      wrong units.
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
const {
  buildSummaryCacheKey,
  SUMMARY_CACHE_TTL,
  SUMMARY_CACHE_MAX,
  normalizeUnitParams,
  setSummaryCache,
  reserveClaudeCall,
  MAX_CLAUDE_CALLS_PER_MIN,
  MAX_CLAUDE_CALLS_PER_MIN_PER_PEER,
} = aiTest;

// === TTL constant ===

test("SUMMARY_CACHE_TTL is exactly 15 minutes in milliseconds", () => {
  assert.equal(SUMMARY_CACHE_TTL, 15 * 60 * 1000);
  assert.equal(SUMMARY_CACHE_TTL, 900000);
});

// === Cache key format ===

test("buildSummaryCacheKey: stable format for a Montréal kiosk in French", () => {
  const key = buildSummaryCacheKey(45.5017, -73.5673, "fr", "current", "c", "kmh", "km");
  assert.equal(key, "45.50:-73.57:fr:current:c:kmh:km");
});

test("buildSummaryCacheKey: sub-km jitter collapses into one bucket (denial-of-wallet defense)", () => {
  // 45.501 and 45.504 are ~330 m apart — both round to 45.50, same bucket,
  // so an attacker can't mint fresh cache keys (and fresh paid Anthropic
  // calls) by walking lat/lon a few hundred metres at a time.
  const a = buildSummaryCacheKey(45.501, -73.5673, "fr", "current", "c", "kmh", "km");
  const b = buildSummaryCacheKey(45.504, -73.5673, "fr", "current", "c", "kmh", "km");
  assert.equal(a, b);
});

test("buildSummaryCacheKey: crossing a 0.01° cell boundary changes the key", () => {
  // 45.501 → 45.50, 45.509 → 45.51 — genuinely different ~1 km cells get
  // their own bucket, so legitimately distant clients aren't merged.
  const a = buildSummaryCacheKey(45.501, 0, "fr", "current", "c", "kmh", "km");
  const b = buildSummaryCacheKey(45.509, 0, "fr", "current", "c", "kmh", "km");
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
  assert.equal(key, "-33.87:151.21:en:current:c:kmh:km");
});

test("buildSummaryCacheKey: lat/lon at 0 keeps the .00 suffix (not dropped)", () => {
  // Avoids subtle bugs where toString() would output "0" but toFixed(2) outputs "0.00"
  const key = buildSummaryCacheKey(0, 0, "fr", "current", "c", "kmh", "km");
  assert.equal(key, "0.00:0.00:fr:current:c:kmh:km");
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

// === Unit / language validation (denial-of-wallet: junk params can't
// expand the cache-key space on the paid Anthropic path) ===

test("normalizeUnitParams: valid values pass through unchanged", () => {
  assert.deepEqual(
    normalizeUnitParams({ lang: "fr", tempUnit: "f", speedUnit: "mph" }),
    { lang: "fr", tempUnit: "f", speedUnit: "mph" },
  );
});

test("normalizeUnitParams: invalid values snap to metric/English defaults", () => {
  assert.deepEqual(
    normalizeUnitParams({ lang: "zz", tempUnit: "rankine", speedUnit: "knots" }),
    { lang: "en", tempUnit: "c", speedUnit: "kmh" },
  );
});

test("normalizeUnitParams: missing values snap to defaults", () => {
  assert.deepEqual(
    normalizeUnitParams({}),
    { lang: "en", tempUnit: "c", speedUnit: "kmh" },
  );
  assert.deepEqual(
    normalizeUnitParams(),
    { lang: "en", tempUnit: "c", speedUnit: "kmh" },
  );
});

test("normalizeUnitParams: a junk lang can't reach the cache key", () => {
  const { lang, tempUnit, speedUnit } = normalizeUnitParams({ lang: "../etc", tempUnit: "c", speedUnit: "kmh" });
  const key = buildSummaryCacheKey(45.5, -73.5, lang, "current", tempUnit, speedUnit, "km");
  assert.ok(key.includes(":en:"));
  assert.ok(!key.includes("../etc"));
});

// === Summary cache hard cap ===

test("setSummaryCache: never exceeds SUMMARY_CACHE_MAX entries", () => {
  // Clear any residue from earlier tests.
  for (const k of Object.keys(summaryCache)) delete summaryCache[k];

  const future = Date.now() + SUMMARY_CACHE_TTL;
  for (let i = 0; i < SUMMARY_CACHE_MAX + 50; i++) {
    setSummaryCache(`cap-test:${i}`, { summary: `s${i}`, expiresAt: future });
  }
  assert.equal(Object.keys(summaryCache).length, SUMMARY_CACHE_MAX);
  // Oldest-inserted keys were evicted FIFO; the most recent survive.
  assert.ok(!(`cap-test:0` in summaryCache));
  assert.ok(`cap-test:${SUMMARY_CACHE_MAX + 49}` in summaryCache);

  for (const k of Object.keys(summaryCache)) delete summaryCache[k];
});

test("setSummaryCache: expired entries are dropped on insert", () => {
  for (const k of Object.keys(summaryCache)) delete summaryCache[k];

  summaryCache["stale-one"] = { summary: "old", expiresAt: Date.now() - 1 };
  setSummaryCache("fresh-one", { summary: "new", expiresAt: Date.now() + SUMMARY_CACHE_TTL });
  assert.ok(!("stale-one" in summaryCache));
  assert.ok("fresh-one" in summaryCache);

  for (const k of Object.keys(summaryCache)) delete summaryCache[k];
});

// === Per-process Anthropic throttle (the hard denial-of-wallet ceiling
// the cache can't provide, since its key is jitterable) ===

// `null` peerKey exercises the global window in isolation (no per-peer cap).

test("reserveClaudeCall: allows up to MAX_CLAUDE_CALLS_PER_MIN then blocks (global)", () => {
  // Use a fixed `now` so the sliding window is deterministic and isolated
  // from any real calls made while the module was loaded.
  const t0 = 1_000_000_000_000;
  let allowed = 0;
  for (let i = 0; i < MAX_CLAUDE_CALLS_PER_MIN + 5; i++) {
    if (reserveClaudeCall(null, t0 + i)) allowed++;
  }
  assert.equal(allowed, MAX_CLAUDE_CALLS_PER_MIN);
});

test("reserveClaudeCall: window slides — calls older than 60 s free up budget", () => {
  const t0 = 2_000_000_000_000;
  // Saturate the window.
  for (let i = 0; i < MAX_CLAUDE_CALLS_PER_MIN; i++) {
    assert.ok(reserveClaudeCall(null, t0 + i));
  }
  // Immediately after, blocked.
  assert.equal(reserveClaudeCall(null, t0 + MAX_CLAUDE_CALLS_PER_MIN), false);
  // 61 s later the earliest timestamps have aged out → allowed again.
  assert.ok(reserveClaudeCall(null, t0 + 61_000));
});

// === Per-peer sub-ceiling layered under the global ceiling ===

test("reserveClaudeCall: a single remote peer is capped at MAX_CLAUDE_CALLS_PER_MIN_PER_PEER while the global still has room", () => {
  const t0 = 3_000_000_000_000;
  let allowed = 0;
  for (let i = 0; i < MAX_CLAUDE_CALLS_PER_MIN_PER_PEER + 3; i++) {
    if (reserveClaudeCall("10.0.0.7", t0 + i)) allowed++;
  }
  // Capped at the per-peer sub-ceiling (4), well below the global 10.
  assert.equal(allowed, MAX_CLAUDE_CALLS_PER_MIN_PER_PEER);
  assert.ok(MAX_CLAUDE_CALLS_PER_MIN_PER_PEER < MAX_CLAUDE_CALLS_PER_MIN);
});

test("reserveClaudeCall: one peer hitting its sub-ceiling doesn't block a different peer", () => {
  const t0 = 4_000_000_000_000;
  for (let i = 0; i < MAX_CLAUDE_CALLS_PER_MIN_PER_PEER; i++) {
    assert.ok(reserveClaudeCall("10.0.0.1", t0 + i));
  }
  assert.equal(reserveClaudeCall("10.0.0.1", t0 + 10), false, "peer A is capped");
  assert.ok(reserveClaudeCall("10.0.0.2", t0 + 11), "peer B is unaffected");
});

test("reserveClaudeCall: the global ceiling still caps combined remote spend across many peers", () => {
  const t0 = 5_000_000_000_000;
  let allowed = 0;
  // 20 distinct peers, each one call (well under its per-peer cap) — the
  // global ceiling still bounds the total billed calls to 10.
  for (let p = 0; p < 20; p++) {
    if (reserveClaudeCall(`192.0.2.${p}`, t0 + p)) allowed++;
  }
  assert.equal(allowed, MAX_CLAUDE_CALLS_PER_MIN);
});
