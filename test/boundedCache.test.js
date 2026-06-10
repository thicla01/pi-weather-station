// Regression tests for the shared bounded-cache primitives (server/
// boundedCache.js). These back the resource-ceiling fix for the
// coordinate-keyed caches that were previously unbounded: BoundedMap caps
// the Map-based caches, sweepExpired reclaims their expired entries, and
// pruneObjectCache does both for the plain-object caches (weatherCache,
// summaryCache). The contracts locked down here are exactly what the
// security fix relies on — a regression would silently re-open the OOM
// lever.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { BoundedMap, sweepExpired, pruneObjectCache } = require("../server/boundedCache");

// === BoundedMap ===

test("BoundedMap: constructor rejects a non-positive / non-integer cap", () => {
  assert.throws(() => new BoundedMap(0));
  assert.throws(() => new BoundedMap(-1));
  assert.throws(() => new BoundedMap(2.5));
  assert.throws(() => new BoundedMap("10"));
});

test("BoundedMap: never exceeds the cap, evicting oldest-inserted first (FIFO)", () => {
  const m = new BoundedMap(3);
  m.set("a", 1);
  m.set("b", 2);
  m.set("c", 3);
  m.set("d", 4); // evicts "a"
  assert.equal(m.size, 3);
  assert.ok(!m.has("a"));
  assert.deepEqual([...m.keys()], ["b", "c", "d"]);
});

test("BoundedMap: re-setting an existing key refreshes its recency (LRU-on-write)", () => {
  const m = new BoundedMap(3);
  m.set("a", 1);
  m.set("b", 2);
  m.set("c", 3);
  m.set("a", 10); // "a" moves to the most-recent slot
  m.set("d", 4);  // now "b" is oldest and gets evicted, not "a"
  assert.ok(m.has("a"));
  assert.equal(m.get("a"), 10);
  assert.ok(!m.has("b"));
  assert.deepEqual([...m.keys()], ["c", "a", "d"]);
});

test("BoundedMap: updating an existing key in place doesn't grow size", () => {
  const m = new BoundedMap(2);
  m.set("a", 1);
  m.set("a", 2);
  m.set("a", 3);
  assert.equal(m.size, 1);
  assert.equal(m.get("a"), 3);
});

// === sweepExpired ===

test("sweepExpired: deletes only entries at or past expiresAt", () => {
  const now = 1_000_000;
  const m = new Map([
    ["fresh", { expiresAt: now + 1000 }],
    ["exact", { expiresAt: now }],     // <= now → expired
    ["stale", { expiresAt: now - 1 }],
  ]);
  const removed = sweepExpired(m, now);
  assert.equal(removed, 2);
  assert.deepEqual([...m.keys()], ["fresh"]);
});

test("sweepExpired: leaves entries without a numeric expiresAt untouched", () => {
  const m = new Map([
    ["no-ttl", { value: 1 }],
    ["null-ttl", { expiresAt: null }],
    ["stale", { expiresAt: 5 }],
  ]);
  const removed = sweepExpired(m, 1_000);
  assert.equal(removed, 1);
  assert.ok(m.has("no-ttl"));
  assert.ok(m.has("null-ttl"));
  assert.ok(!m.has("stale"));
});

// === pruneObjectCache ===

test("pruneObjectCache: rejects a non-positive / non-integer cap", () => {
  assert.throws(() => pruneObjectCache({}, { maxEntries: 0 }));
  assert.throws(() => pruneObjectCache({}, { maxEntries: 1.5 }));
});

test("pruneObjectCache: drops expired entries then caps to maxEntries (oldest-first)", () => {
  const now = 1_000_000;
  const obj = {};
  // 3 expired + 5 fresh, inserted in order.
  obj.e1 = { expiresAt: now - 10 };
  obj.e2 = { expiresAt: now - 10 };
  obj.e3 = { expiresAt: now - 10 };
  for (let i = 0; i < 5; i++) obj[`f${i}`] = { expiresAt: now + 1000 };

  const removed = pruneObjectCache(obj, { maxEntries: 3, now });
  // 3 expired removed + 2 oldest-fresh evicted to reach cap 3.
  assert.equal(removed, 5);
  assert.deepEqual(Object.keys(obj), ["f2", "f3", "f4"]);
});

test("pruneObjectCache: graceMs keeps entries within the stale-fallback window", () => {
  const now = 1_000_000;
  const grace = 24 * 60 * 60 * 1000;
  const obj = {
    recentlyExpired: { expiresAt: now - 1000 },          // expired but within grace → kept
    ancient: { expiresAt: now - grace - 1 },             // past grace → dropped
    fresh: { expiresAt: now + 1000 },
  };
  const removed = pruneObjectCache(obj, { maxEntries: 100, graceMs: grace, now });
  assert.equal(removed, 1);
  assert.ok("recentlyExpired" in obj);
  assert.ok("fresh" in obj);
  assert.ok(!("ancient" in obj));
});

test("pruneObjectCache: a cache already within bounds is left unchanged", () => {
  const now = 1_000_000;
  const obj = { a: { expiresAt: now + 1 }, b: { expiresAt: now + 1 } };
  const removed = pruneObjectCache(obj, { maxEntries: 10, now });
  assert.equal(removed, 0);
  assert.deepEqual(Object.keys(obj), ["a", "b"]);
});
