// Tests for client/src/ui/cachedFlags.js: the cached media-query and
// localStorage reads behind priorityViewsEnabled() (which piShellVariant()
// follows) and prefersReducedMotion(). CommonJS module, so these run the
// real code against a stand-in window. Run: `npm test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { createMediaQueryFlag, createStorageFlag } = require("../client/src/ui/cachedFlags");

const SRC_DIR = path.join(__dirname, "..", "client", "src");
const read = (rel) => fs.readFileSync(path.join(SRC_DIR, rel), "utf8");

/**
 * A stand-in window: matchMedia lists that dispatch `change` to their
 * listeners in registration order, a counted localStorage, and window
 * listeners (for `storage`).
 *
 * @param {object} [options]
 * @param {boolean} [options.matches] - The query's result at first.
 * @param {object} [options.storage] - localStorage's content.
 * @returns {object} the stand-in and its counters
 */
const fakeWindow = ({ matches = false, storage = {} } = {}) => {
  const lists = [];
  const winListeners = new Map();
  const counts = { matchMedia: 0, getItem: 0 };
  let current = matches;
  const win = {
    matchMedia(query) {
      counts.matchMedia += 1;
      const listeners = [];
      const list = {
        query,
        get matches() {
          return current;
        },
        addEventListener(type, fn) {
          assert.equal(type, "change");
          listeners.push(fn);
        },
        removeEventListener(type, fn) {
          const i = listeners.indexOf(fn);
          if (i >= 0) listeners.splice(i, 1);
        },
        listeners,
      };
      lists.push(list);
      return list;
    },
    localStorage: {
      getItem(key) {
        counts.getItem += 1;
        return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null;
      },
    },
    addEventListener(type, fn) {
      winListeners.set(type, [...(winListeners.get(type) || []), fn]);
    },
  };
  return {
    win,
    counts,
    lists,
    storage,
    // The viewport / OS preference changes: every list fires `change`.
    flip(next) {
      current = next;
      for (const list of lists) for (const fn of [...list.listeners]) fn({ matches: next });
    },
    storageEvent(key) {
      for (const fn of winListeners.get("storage") || []) fn({ key });
    },
  };
};

test("cachedFlags: a media-query flag makes one list, at creation, and reads a cached value afterwards", () => {
  const f = fakeWindow({ matches: true });
  const flag = createMediaQueryFlag("(max-height: 540px)", f.win);
  assert.equal(f.counts.matchMedia, 1);
  assert.equal(f.lists[0].query, "(max-height: 540px)");
  for (let i = 0; i < 5; i += 1) assert.equal(flag.matches(), true);
  assert.equal(f.counts.matchMedia, 1, "no new MediaQueryList per read");
});

test("cachedFlags: the value follows the query live, and a subscriber reads the new value in its own listener", () => {
  const f = fakeWindow({ matches: false });
  const flag = createMediaQueryFlag("(prefers-reduced-motion: reduce)", f.win);
  const seen = [];
  const unsubscribe = flag.subscribe(() => seen.push(flag.matches()));
  assert.equal(f.lists.length, 1, "subscribers listen on the flag's own list");
  f.flip(true);
  assert.equal(flag.matches(), true);
  assert.deepEqual(seen, [true], "the cache's listener ran first");
  f.flip(false);
  assert.deepEqual(seen, [true, false]);
  unsubscribe();
  f.flip(true);
  assert.deepEqual(seen, [true, false], "unsubscribed");
  assert.equal(flag.matches(), true, "the cache itself keeps following");
});

test("cachedFlags: without matchMedia, or when it throws, the flag reads false and subscribing does nothing; a list without addEventListener is read live", () => {
  for (const win of [null, {}, { matchMedia: () => { throw new Error("blocked"); } }]) {
    const flag = createMediaQueryFlag("(max-height: 540px)", win);
    assert.equal(flag.matches(), false);
    const unsubscribe = flag.subscribe(() => assert.fail("never called"));
    assert.equal(unsubscribe(), undefined);
  }
  let matches = false;
  const legacy = createMediaQueryFlag("(max-height: 540px)", { matchMedia: () => ({ get matches() { return matches; } }) });
  assert.equal(legacy.matches(), false);
  matches = true;
  assert.equal(legacy.matches(), true, "no change event to keep a cache current: read live");
});

test("cachedFlags: a storage flag reads its key once, at its first read, and again only after another document changes it", () => {
  const f = fakeWindow({ storage: { forcePriorityViews: "on" } });
  const flag = createStorageFlag("forcePriorityViews", f.win);
  assert.equal(f.counts.getItem, 0, "nothing read at creation");
  assert.equal(flag.read(), "on");
  assert.equal(flag.read(), "on");
  assert.equal(f.counts.getItem, 1);
  // A write in this document is not seen (reload after changing it).
  f.storage.forcePriorityViews = "off";
  assert.equal(flag.read(), "on");
  // Another document's change to another key: still cached.
  f.storageEvent("fontSize");
  assert.equal(flag.read(), "on");
  assert.equal(f.counts.getItem, 1);
  // To this key, or a clear(): read again.
  f.storageEvent("forcePriorityViews");
  assert.equal(flag.read(), "off");
  delete f.storage.forcePriorityViews;
  f.storageEvent(null);
  assert.equal(flag.read(), null);
  assert.equal(f.counts.getItem, 3);
});

test("cachedFlags: a blocked localStorage, or no window, reads null", () => {
  const blocked = createStorageFlag("forcePriorityViews", { localStorage: { getItem: () => { throw new Error("SecurityError"); } } });
  assert.equal(blocked.read(), null);
  assert.equal(createStorageFlag("forcePriorityViews", null).read(), null);
});

test("cachedFlags: the gates and the reduced-motion reads go through the module-level flags, never a per-call matchMedia or getItem", () => {
  const piLayout = read("ui/piLayout.js");
  assert.match(piLayout, /^const priorityViewport = createMediaQueryFlag\("\(max-height: 540px\)"\);$/m);
  assert.match(piLayout, /if \(priorityViewport\.matches\(\)\) return true;\s*(\/\/[^\n]*\n\s*)*return forcePriorityViews\.read\(\) === "on";/);
  // The shell follows the gate alone: no storage flag of its own.
  assert.match(piLayout, /export function piShellVariant\(\) \{\s*return shellVariantFor\(priorityViewsEnabled\(\)\);\s*\}/);
  const prefs = read("ui/systemPrefs.js");
  assert.match(prefs, /^const reducedMotionFlag = createMediaQueryFlag\(REDUCED_MOTION_QUERY\);$/m);
  assert.match(prefs, /export function prefersReducedMotion\(\) \{\s*return reducedMotionFlag\.matches\(\);\s*\}/);
  assert.match(prefs, /export function subscribeReducedMotion\(onChange\) \{\s*return reducedMotionFlag\.subscribe\(onChange\);\s*\}/);
  // Code, not comments: no direct read left in these modules.
  const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code(piLayout), /piShellFlag|PI_SHELL_STORAGE_KEY|(["'`])piShell\1|\.piShell\b/);
  for (const [rel, src] of [["ui/piLayout.js", piLayout], ["ui/systemPrefs.js", prefs], ["components/ambient/LayoutPi/useShellTiming.js", read("components/ambient/LayoutPi/useShellTiming.js")]]) {
    assert.doesNotMatch(code(src), /\.matchMedia\(|localStorage\.getItem\(/, rel);
  }
});
