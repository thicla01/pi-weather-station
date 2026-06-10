// Shared bounded-cache primitives.
//
// Several controllers keep in-memory caches keyed on client-supplied
// coordinates (or, before the socket-peer fix, on a spoofable client IP).
// None of them had an upper bound: a remote client that keeps presenting
// fresh keys — by walking lat/lon a few metres at a time, or rotating a
// header — could grow these maps without limit and drive the process
// toward OOM. The brakes here are deliberately simple and allocation-free
// on the hot path:
//
//   • BoundedMap        — a Map with a hard entry cap; inserting past the
//                         cap evicts the oldest entry (FIFO / insertion
//                         order), and re-inserting an existing key moves
//                         it to the most-recent slot (so a steadily-hit
//                         key is protected from eviction → effectively LRU
//                         for the access pattern these caches use, which
//                         only re-set a key when its entry is refreshed).
//   • sweepExpired      — drop every entry already past its `expiresAt`;
//                         called on a periodic interval so expired-but-
//                         under-cap entries don't sit pinned in memory.
//   • pruneObjectCache  — the same two guarantees for the plain-object
//                         caches that can't cheaply become Maps without
//                         churning their consumers (weatherCache,
//                         summaryCache).
//
// Entries are expected to carry a numeric `expiresAt` (epoch ms). Entries
// without one are never expired by the sweepers (they only ever fall out
// via the size cap), which is the correct behaviour for the few non-TTL
// values these helpers also guard.

/**
 * A Map with a hard maximum entry count. Inserting beyond the cap evicts
 * the oldest entries in insertion order; re-inserting an existing key
 * refreshes its position so frequently-touched keys survive.
 */
class BoundedMap extends Map {
  /**
   * @param {Number} maxEntries Positive integer cap on stored entries.
   */
  constructor(maxEntries) {
    super();
    if (!Number.isInteger(maxEntries) || maxEntries <= 0) {
      throw new Error("BoundedMap requires a positive integer maxEntries");
    }
    this._maxEntries = maxEntries;
  }

  /**
   * Insert or update an entry, enforcing the cap.
   *
   * @param {*} key
   * @param {*} value
   * @returns {BoundedMap} this
   */
  set(key, value) {
    // Delete-then-set so an updated key moves to the end of the insertion
    // order (most-recent). Without this, re-setting an existing key keeps
    // its original position and a hot key could be evicted while cold ones
    // that were inserted later survive.
    if (super.has(key)) super.delete(key);
    super.set(key, value);
    while (this.size > this._maxEntries) {
      // Map iteration order is insertion order; the first key is the oldest.
      const oldest = super.keys().next().value;
      super.delete(oldest);
    }
    return this;
  }
}

/**
 * Delete every entry whose numeric `expiresAt` is at or before `now`.
 * Entries whose value lacks a numeric `expiresAt` are left untouched.
 * Deleting the current key during Map iteration is well-defined in JS.
 *
 * @param {Map} map
 * @param {Number} [now] Epoch ms to compare against (default Date.now()).
 * @returns {Number} count of entries removed
 */
function sweepExpired(map, now = Date.now()) {
  let removed = 0;
  for (const [key, entry] of map) {
    if (entry && typeof entry.expiresAt === "number" && entry.expiresAt <= now) {
      map.delete(key);
      removed++;
    }
  }
  return removed;
}

/**
 * Bound a plain-object cache: drop entries past their expiry (plus an
 * optional grace window so a stale-fallback cache can keep serving), then
 * evict oldest-inserted entries until at most `maxEntries` remain. Object
 * key order is insertion order for string keys, so the front of
 * `Object.keys` is the oldest.
 *
 * @param {Object} obj The cache object (mutated in place).
 * @param {Object} opts
 * @param {Number} opts.maxEntries Positive integer cap on stored entries.
 * @param {Number} [opts.graceMs] Keep entries until this long past expiry
 *   (default 0 — drop as soon as expired). Used by weatherCache to mirror
 *   its on-disk stale-fallback window.
 * @param {Number} [opts.now] Epoch ms (default Date.now()).
 * @returns {Number} count of entries removed
 */
function pruneObjectCache(obj, { maxEntries, graceMs = 0, now = Date.now() } = {}) {
  if (!Number.isInteger(maxEntries) || maxEntries <= 0) {
    throw new Error("pruneObjectCache requires a positive integer maxEntries");
  }
  let removed = 0;
  const cutoff = now - graceMs;
  for (const key of Object.keys(obj)) {
    const entry = obj[key];
    if (entry && typeof entry.expiresAt === "number" && entry.expiresAt <= cutoff) {
      delete obj[key];
      removed++;
    }
  }
  let keys = Object.keys(obj);
  let i = 0;
  while (keys.length - i > maxEntries) {
    delete obj[keys[i]];
    removed++;
    i++;
  }
  return removed;
}

module.exports = { BoundedMap, sweepExpired, pruneObjectCache };
