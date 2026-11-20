// Starting map zoom — the per-device preference behind Settings → Local
// preferences → "Starting map zoom".
//
// The map opens at the level stored under `defaultMapZoom` in
// localStorage: AppContext's `loadStoredData` reads the key once at boot
// and Leaflet's MapContainer takes its zoom only at mount. This module
// holds the key, the default, the range and the storage helpers of the
// Settings row that writes it.
//
// The row saves the zoom the map ALREADY shows; it never moves the map,
// so a saved level applies from the next page load. That is deliberate:
// a programmatic `map.setZoom` keeps the map's true centre, which on the
// layouts where the rail covers the map is not the marker's visual centre
// (see `handleSelect` in ambient/PlacesPopover), so the marker drifts.
// The +/- buttons and the pinch are anchored correctly; the user zooms
// with those, then saves.
//
// MODULE FORMAT: CommonJS on purpose, like ui/radarFrameStack.js, so
// test/startMapZoom.test.js runs the real code. Webpack imports it into
// the ESM client.

const { RADAR_MAX_ZOOM } = require("./radarFrameStack");

/** localStorage key read at boot by AppContext's `loadStoredData`. */
const START_ZOOM_STORAGE_KEY = "defaultMapZoom";

/** Level the map opens at when nothing is stored. */
const DEFAULT_START_ZOOM = 7;

/** Lowest level the Settings row saves (the v2 slider's lower bound). */
const START_ZOOM_MIN = 4;

/**
 * Highest level the Settings row saves: above it the RainViewer layers
 * are not drawn, so the map would open without radar.
 */
const START_ZOOM_MAX = RADAR_MAX_ZOOM;

/**
 * The storage to use: the one passed in (tests), else the browser's.
 * Call it inside a `try`: reading `window.localStorage` throws when
 * storage is blocked, and `window` does not exist under `node --test`.
 *
 * @param {Storage} [storage] - Injected storage.
 * @returns {Storage} The storage to read or write.
 */
function resolveStorage(storage) {
  return storage || window.localStorage;
}

/**
 * The level the Settings row would save for a given map zoom: rounded to
 * a whole level, then held inside START_ZOOM_MIN..START_ZOOM_MAX.
 *
 * @param {unknown} level - A map zoom, usually AppContext's `currentMapZoom`.
 * @returns {?number} The level to save, or null when `level` is not a
 *   finite number.
 */
function clampStartZoom(level) {
  if (level === null || level === undefined || level === "") return null;
  const n = Number(level);
  if (!Number.isFinite(n)) return null;
  return Math.min(START_ZOOM_MAX, Math.max(START_ZOOM_MIN, Math.round(n)));
}

/**
 * The stored starting zoom, parsed the way `loadStoredData` parses it
 * (`parseInt`, any finite value accepted), so the Settings row shows the
 * level the next load will really use — including one typed by hand in
 * the console outside the row's range.
 *
 * @param {Storage} [storage] - Injected storage; the browser's by default.
 * @returns {?number} The stored level, or null when the key is absent,
 *   not a number, or storage is unavailable.
 */
function readStoredStartZoom(storage) {
  try {
    const n = parseInt(resolveStorage(storage).getItem(START_ZOOM_STORAGE_KEY), 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * Store a starting zoom, clamped by `clampStartZoom`.
 *
 * @param {unknown} level - The map zoom to save.
 * @param {Storage} [storage] - Injected storage; the browser's by default.
 * @returns {?number} The level written, or null when nothing was written
 *   (`level` not a finite number, or storage unavailable).
 */
function saveStartZoom(level, storage) {
  const n = clampStartZoom(level);
  if (n === null) return null;
  try {
    resolveStorage(storage).setItem(START_ZOOM_STORAGE_KEY, String(n));
    return n;
  } catch {
    return null;
  }
}

/**
 * Forget the stored starting zoom: the next load opens at
 * DEFAULT_START_ZOOM.
 *
 * @param {Storage} [storage] - Injected storage; the browser's by default.
 * @returns {boolean} False when storage is unavailable.
 */
function clearStartZoom(storage) {
  try {
    resolveStorage(storage).removeItem(START_ZOOM_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  START_ZOOM_STORAGE_KEY,
  DEFAULT_START_ZOOM,
  START_ZOOM_MIN,
  START_ZOOM_MAX,
  clampStartZoom,
  readStoredStartZoom,
  saveStartZoom,
  clearStartZoom,
};
