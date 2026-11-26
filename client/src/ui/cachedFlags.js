// Cached reads of the media-query and localStorage flags that renders ask
// for on the kiosk's click path (the semantics are the same on every
// layout, so every layout gets them).
//
// `window.matchMedia(query).matches` builds a new MediaQueryList and
// evaluates it on every call. Here each query gets ONE list, made when the
// module that asks for it loads, whose `matches` is cached and kept current
// by a `change` listener registered on that list before any other:
//   - live: a change of the viewport or of the OS preference updates the
//     value, as a per-call read would have seen it;
//   - in step with its subscribers: `subscribe()` adds listeners to the
//     same list, after the cache's own, so a subscriber reading the value
//     in its listener (useSyncExternalStore, MapInertia) reads the new
//     one; and a list made at module load is older than any component's,
//     and a browser fires the lists' `change` events in the order the lists
//     were made, so a component that re-renders from its own list's event
//     (AmbientLayers' breakpoints) already reads the new value.
// A localStorage flag is read once, at its first read, and again only when
// another document changes it (`storage` event); a write in the same
// document (a DevTools console) needs a reload.
//
// Without `matchMedia` (Node, old WebViews), or when it throws, a flag
// reads false and subscribing does nothing, as the per-call reads did; a
// list without `addEventListener` (Safari < 14) is read live, uncached.
//
// MODULE FORMAT: CommonJS on purpose (like ui/pressTint.js), so
// test/cachedFlags.test.js runs the real code against a stand-in window.

const NO_UNSUBSCRIBE = () => undefined;

/**
 * The browser window, or null outside one (Node, tests).
 *
 * @returns {?object} `window`, or null.
 */
function currentWindow() {
  return typeof window === "undefined" ? null : window;
}

/**
 * One media query, read from a cached value that its own `change`
 * listener keeps current (see the header). The list is made now.
 *
 * @param {string} query - A media query, e.g. "(max-height: 540px)".
 * @param {?object} [win] - The window (injected by the tests); default `window`.
 * @returns {{matches: function(): boolean, subscribe: function(function(object): void): function(): void}}
 *   matches() the query's current result; subscribe(onChange) calls
 *   onChange on every change, after the cached value is updated, and
 *   returns the unsubscribe.
 */
function createMediaQueryFlag(query, win = currentWindow()) {
  let list = null;
  try {
    list = win && typeof win.matchMedia === "function" ? win.matchMedia(query) : null;
  } catch {
    list = null;
  }
  if (!list) {
    return { matches: () => false, subscribe: () => NO_UNSUBSCRIBE };
  }
  if (typeof list.addEventListener !== "function") {
    return { matches: () => Boolean(list.matches), subscribe: () => NO_UNSUBSCRIBE };
  }
  let cached = Boolean(list.matches);
  list.addEventListener("change", (event) => {
    cached = Boolean(event && typeof event.matches === "boolean" ? event.matches : list.matches);
  });
  return {
    matches: () => cached,
    subscribe: (onChange) => {
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
  };
}

/**
 * One localStorage key, read once at its first read and again after
 * another document changes it (see the header).
 *
 * @param {string} key - The localStorage key.
 * @param {?object} [win] - The window (injected by the tests); default `window`.
 * @returns {{read: function(): ?string}} read() the key's value, or null when absent or storage is blocked.
 */
function createStorageFlag(key, win = currentWindow()) {
  let loaded = false;
  let value = null;
  if (win && typeof win.addEventListener === "function") {
    win.addEventListener("storage", (event) => {
      // `key` null: the other document cleared the whole storage.
      if (!event || event.key === key || event.key === null) loaded = false;
    });
  }
  return {
    read: () => {
      if (!loaded) {
        loaded = true;
        try {
          value = win ? win.localStorage.getItem(key) : null;
        } catch {
          value = null;
        }
      }
      return value;
    },
  };
}

module.exports = { createMediaQueryFlag, createStorageFlag };
