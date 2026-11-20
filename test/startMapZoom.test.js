// Tests for the starting-map-zoom helpers in
// `client/src/ui/startMapZoom.js` — the range the Settings row saves, the
// storage read/write/clear, and three guards on the code around them:
// AppContext reads the same key, the Settings text quotes the real range,
// and the row never commands the map's zoom. The module is CommonJS so
// these tests exercise the real code. Run: `npm test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  START_ZOOM_STORAGE_KEY,
  DEFAULT_START_ZOOM,
  START_ZOOM_MIN,
  START_ZOOM_MAX,
  clampStartZoom,
  readStoredStartZoom,
  saveStartZoom,
  clearStartZoom,
} = require("../client/src/ui/startMapZoom");
const { RADAR_MAX_ZOOM } = require("../client/src/ui/radarFrameStack");

const SRC = path.join(__dirname, "..", "client", "src");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");

/** In-memory stand-in for `window.localStorage`. */
const fakeStorage = (initial = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
    data,
  };
};

/** Storage whose every access throws, like a blocked localStorage. */
const blockedStorage = () => {
  const boom = () => { throw new Error("SecurityError"); };
  return { getItem: boom, setItem: boom, removeItem: boom };
};

test("range: the v2 slider's 4, up to the radar's drawing limit", () => {
  assert.equal(START_ZOOM_STORAGE_KEY, "defaultMapZoom");
  assert.equal(DEFAULT_START_ZOOM, 7);
  assert.equal(START_ZOOM_MIN, 4);
  assert.equal(START_ZOOM_MAX, RADAR_MAX_ZOOM);
  assert.ok(DEFAULT_START_ZOOM >= START_ZOOM_MIN && DEFAULT_START_ZOOM <= START_ZOOM_MAX);
});

test("clampStartZoom: whole level inside the range", () => {
  assert.equal(clampStartZoom(9), 9);
  assert.equal(clampStartZoom("10"), 10);
  assert.equal(clampStartZoom(8.6), 9);
  assert.equal(clampStartZoom(START_ZOOM_MIN), START_ZOOM_MIN);
  assert.equal(clampStartZoom(START_ZOOM_MAX), START_ZOOM_MAX);
});

test("clampStartZoom: a map zoomed past the range saves the nearest bound", () => {
  // The map itself goes to 18; above START_ZOOM_MAX it would open with no radar.
  assert.equal(clampStartZoom(18), START_ZOOM_MAX);
  assert.equal(clampStartZoom(13), START_ZOOM_MAX);
  assert.equal(clampStartZoom(2), START_ZOOM_MIN);
  // 0 matters: WeatherMap treats a falsy zoom as "no map data".
  assert.equal(clampStartZoom(0), START_ZOOM_MIN);
});

test("clampStartZoom: no level for a value that is not a finite number", () => {
  for (const bad of [null, undefined, "", "abc", NaN, Infinity, -Infinity]) {
    assert.equal(clampStartZoom(bad), null, String(bad));
  }
});

test("readStoredStartZoom: absent, unreadable or blocked storage is null", () => {
  assert.equal(readStoredStartZoom(fakeStorage()), null);
  assert.equal(readStoredStartZoom(fakeStorage({ defaultMapZoom: "abc" })), null);
  assert.equal(readStoredStartZoom(blockedStorage()), null);
});

test("readStoredStartZoom: the level as the boot path parses it, unclamped", () => {
  assert.equal(readStoredStartZoom(fakeStorage({ defaultMapZoom: "9" })), 9);
  // Typed by hand in the console, outside the row's range: the next load
  // uses it as is, so the row must show it as is.
  assert.equal(readStoredStartZoom(fakeStorage({ defaultMapZoom: "14" })), 14);
  assert.equal(readStoredStartZoom(fakeStorage({ defaultMapZoom: "9.7" })), 9);
});

test("no browser storage (node --test has no window): helpers fail soft", () => {
  assert.equal(readStoredStartZoom(), null);
  assert.equal(saveStartZoom(9), null);
  assert.equal(clearStartZoom(), false);
});

test("saveStartZoom: writes the clamped level and returns it", () => {
  const storage = fakeStorage();
  assert.equal(saveStartZoom(10, storage), 10);
  assert.equal(storage.data.get("defaultMapZoom"), "10");
  assert.equal(saveStartZoom(17, storage), START_ZOOM_MAX);
  assert.equal(storage.data.get("defaultMapZoom"), String(START_ZOOM_MAX));
  assert.equal(readStoredStartZoom(storage), START_ZOOM_MAX);
});

test("saveStartZoom: writes nothing for a bad level or blocked storage", () => {
  const storage = fakeStorage({ defaultMapZoom: "9" });
  assert.equal(saveStartZoom("abc", storage), null);
  assert.equal(saveStartZoom(null, storage), null);
  assert.equal(storage.data.get("defaultMapZoom"), "9");
  assert.equal(saveStartZoom(9, blockedStorage()), null);
});

test("clearStartZoom: removes the key; false when storage is blocked", () => {
  const storage = fakeStorage({ defaultMapZoom: "9", other: "kept" });
  assert.equal(clearStartZoom(storage), true);
  assert.equal(storage.data.has("defaultMapZoom"), false);
  assert.equal(storage.data.get("other"), "kept");
  assert.equal(clearStartZoom(storage), true);
  assert.equal(clearStartZoom(blockedStorage()), false);
});

test("AppContext boots from the same key and default as the Settings row", () => {
  const src = read("AppContext.js");
  assert.match(src, /const DEFAULT_MAP_ZOOM_STORAGE_KEY = START_ZOOM_STORAGE_KEY;/);
  assert.match(src, /const DEFAULT_MAP_ZOOM_FALLBACK = DEFAULT_START_ZOOM;/);
  assert.match(src, /window\.localStorage\.getItem\(DEFAULT_MAP_ZOOM_STORAGE_KEY\)/);
});

test("the Settings text quotes the real range, in the three languages", () => {
  const src = read("components/ambient/SettingsPanel/index.js");
  const [lo, hi] = [START_ZOOM_MIN, START_ZOOM_MAX];
  assert.ok(src.includes(`Levels ${lo} to ${hi} (the radar is not drawn above ${hi}).`), "EN");
  assert.ok(src.includes(`Niveaux ${lo} à ${hi} (le radar n'est pas dessiné au-delà de ${hi}).`), "FR");
  assert.ok(src.includes(`Niveles ${lo} a ${hi} (el radar no se dibuja por encima de ${hi}).`), "ES");
});

test("the Settings row saves a level and never commands the map's zoom", () => {
  const src = read("components/ambient/SettingsPanel/index.js");
  const start = src.indexOf("const StartZoomRow = ");
  const end = src.indexOf("\nconst Seg = ", start);
  assert.ok(start > 0 && end > start, "StartZoomRow not found before Seg");
  const row = src.slice(start, end);
  assert.match(row, /saveStartZoom\(target\)/);
  assert.match(row, /clearStartZoom\(\)/);
  // A programmatic zoom drifts the marker under a rail offset, and
  // `defaultMapZoom` feeds MapResizer's setView on LayoutMobile: a saved
  // level applies from the next load only. See ui/startMapZoom.js.
  for (const forbidden of ["saveDefaultMapZoom", "setZoomToLevel", "setDefaultMapZoom", "setZoom(", "setView("]) {
    assert.ok(!row.includes(forbidden), `StartZoomRow must not use ${forbidden}`);
  }
});
