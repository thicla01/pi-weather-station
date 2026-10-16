// Map motion under the OS reduced-motion preference (client/src/ui/mapMotion.js)
// and the call sites that apply it.
//
// styles/main.css removes every CSS transition under reduced motion and keeps
// Leaflet's zoom transition at 0.01 ms (reducedMotionGuards.test.js pins that
// half). The other half is JavaScript: a recentre at the same zoom takes
// `{ animate: false }` (one step, tiles kept), a zoom change keeps Leaflet's
// animated path (`animate: false` would go through `_resetView`, which can
// empty the tile layers for a frame), and the drag inertia goes off. mapMotion.js is CommonJS, so
// the decisions are tested on the real module; the call sites (ESM) are
// checked as text. Run: `npm test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { recenterAnimates, mapInertia } = require("../client/src/ui/mapMotion");

const SRC_DIR = path.join(__dirname, "..", "client", "src");
const WEATHER_MAP_DIR = path.join(SRC_DIR, "components", "WeatherMap");

/**
 * Read a client source file with its comments blanked out, so prose that
 * names a Leaflet method doesn't count as a call.
 *
 * @param {string} file absolute path
 * @returns {string} the source without its block and line comments
 */
const codeOf = (file) =>
  fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

/**
 * Recursively collect every .js file under a directory.
 *
 * @param {string} dir directory to walk
 * @returns {string[]} absolute paths of the .js files found
 */
const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(p);
    return p.endsWith(".js") ? [p] : [];
  });

/**
 * Path relative to client/src, forward slashes on every OS.
 *
 * @param {string} file absolute path
 * @returns {string} e.g. "components/WeatherMap/geometry.js"
 */
const rel = (file) => path.relative(SRC_DIR, file).split(path.sep).join("/");

test("recenterAnimates: without reduced motion, Leaflet's animated path, as before", () => {
  assert.equal(recenterAnimates({ fromZoom: 8, toZoom: 8 }), true);
  assert.equal(recenterAnimates({ fromZoom: 8, toZoom: 8, reducedMotion: false }), true);
  assert.equal(recenterAnimates({ fromZoom: 8, toZoom: 11, reducedMotion: false }), true);
  assert.equal(recenterAnimates({ animate: true, fromZoom: 8, toZoom: 8, reducedMotion: false }), true);
});

test("recenterAnimates: under reduced motion, a recentre at the same zoom is one step", () => {
  assert.equal(recenterAnimates({ fromZoom: 8, toZoom: 8, reducedMotion: true }), false);
  assert.equal(recenterAnimates({ animate: true, fromZoom: 12, toZoom: 12, reducedMotion: true }), false);
  // Fractional zooms (zoomSnap < 1, pinch) compare as they are.
  assert.equal(recenterAnimates({ fromZoom: 9.5, toZoom: 9.5, reducedMotion: true }), false);
});

test("recenterAnimates: under reduced motion, a zoom change keeps the animated path", () => {
  // animate: false would send setView through _resetView, which can empty the
  // tile layers for a frame; the animated path is a CSS zoom the 0.01 ms
  // exception ends at once.
  assert.equal(recenterAnimates({ fromZoom: 8, toZoom: 11, reducedMotion: true }), true);
  assert.equal(recenterAnimates({ fromZoom: 11, toZoom: 6, reducedMotion: true }), true);
  assert.equal(recenterAnimates({ fromZoom: 9, toZoom: 9.5, reducedMotion: true }), true);
});

test("recenterAnimates: a caller's animate: false always wins", () => {
  for (const reducedMotion of [false, true]) {
    assert.equal(recenterAnimates({ animate: false, fromZoom: 8, toZoom: 8, reducedMotion }), false);
    assert.equal(recenterAnimates({ animate: false, fromZoom: 8, toZoom: 11, reducedMotion }), false);
  }
});

test("mapInertia: off under reduced motion, else the map's own option", () => {
  assert.equal(mapInertia(true, false), true);
  assert.equal(mapInertia(true, true), false);
  assert.equal(mapInertia(false, false), false);
  assert.equal(mapInertia(false, true), false);
  // Leaflet's default is true; an unset option reads as off.
  assert.equal(mapInertia(undefined, false), false);
});

test("no flyTo / flyToBounds anywhere in the client (a JS animation reduced motion can't stop)", () => {
  const hits = walk(SRC_DIR).filter((f) => /\.\s*flyTo(?:Bounds)?\s*\(/.test(codeOf(f))).map(rel);
  assert.deepEqual(hits, [], "Use setView / fitBounds and decide `animate` with recenterAnimates (ui/mapMotion.js).");
});

test("Leaflet recentres live only where the reduced-motion decision is applied", () => {
  // A new caller of panTo / panBy / setView / fitBounds must go through
  // panWithRailOffset or recenterAnimates (or pass animate: false), then be
  // added here.
  const EXPECTED = {
    "components/WeatherMap/geometry.js": ["panTo", "setView"],
    "components/WeatherMap/index.js": ["fitBounds"],
    "components/WeatherMap/MapResizer.js": ["setView"],
  };
  const found = {};
  for (const file of walk(SRC_DIR)) {
    const methods = [...codeOf(file).matchAll(/\.\s*(panTo|panBy|setView|fitBounds)\s*\(/g)].map((m) => m[1]);
    if (methods.length) found[rel(file)] = [...new Set(methods)].sort();
  }
  assert.deepEqual(found, Object.fromEntries(Object.entries(EXPECTED).map(([f, m]) => [f, [...m].sort()])));
});

test("each recentre site applies the reduced-motion decision", () => {
  const geometry = codeOf(path.join(WEATHER_MAP_DIR, "geometry.js"));
  assert.match(geometry, /recenterAnimates\(\{\s*animate,\s*fromZoom: zoom,\s*toZoom: zoom,\s*reducedMotion\s*\}\)/);

  const index = codeOf(path.join(WEATHER_MAP_DIR, "index.js"));
  // Both animated callers of panWithRailOffset pass the live preference.
  const animatedPans = [...index.matchAll(/panWithRailOffset\(([\s\S]*?)\);/g)].map((m) => m[1]);
  assert.equal(animatedPans.length, 3, "PanHandler, RailOffsetTracker, InitialOffsetCentering");
  for (const args of animatedPans) {
    if (/animate:\s*false/.test(args)) continue;
    assert.match(args, /reducedMotion:\s*prefersReducedMotion\(\)/, `panWithRailOffset(${args.trim()})`);
  }
  // The alert framing decides from the landing zoom, under reduced motion
  // only (without it, the call is the one master made).
  assert.match(
    index,
    /if \(prefersReducedMotion\(\)\) \{[\s\S]*?getBoundsZoom\([\s\S]*?recenterAnimates\([\s\S]*?options\.animate = false;[\s\S]*?\}\s*\}\s*map\.fitBounds\(bounds, options\);/,
  );
  // Never `animate: true` towards Leaflet: it forces an animation Leaflet
  // otherwise skips (a far move), which master never asked for.
  assert.doesNotMatch(index, /options\.animate\s*=\s*true/);
  assert.doesNotMatch(geometry, /animate:\s*true/);
  // The inertia follows the preference, inside the map.
  assert.match(index, /<MapInertia \/>/);

  const resizer = codeOf(path.join(WEATHER_MAP_DIR, "MapResizer.js"));
  const setViews = [...resizer.matchAll(/\.setView\(([^)]*\][^)]*)\)/g)].map((m) => m[1]);
  assert.ok(setViews.length > 0);
  for (const args of setViews) assert.match(args, /\{\s*animate:\s*false\s*\}/);
});

test("the inertia follows the OS preference live, through Leaflet's option", () => {
  const src = codeOf(path.join(WEATHER_MAP_DIR, "MapInertia.js"));
  // Subscribed (a flip applies without a reload) and unsubscribed on unmount.
  assert.match(src, /const unsubscribe = subscribeReducedMotion\(apply\);/);
  assert.match(src, /unsubscribe\(\);/);
  // Map.Drag reads map.options.inertia at every release: writing it is enough.
  assert.match(src, /L\.setOptions\(map, \{ inertia: mapInertia\(baseInertia, prefersReducedMotion\(\)\) \}\)/);
  assert.match(src, /L\.setOptions\(map, \{ inertia: baseInertia \}\)/);
});

test("no Leaflet animation option is switched off for reduced motion", () => {
  // Designer decision (2026-10): zoomAnimation / markerZoomAnimation stay on
  // (the CSS exception makes the zoom instant), and fadeAnimation keeps its
  // own value, whatever the preference.
  const index = codeOf(path.join(WEATHER_MAP_DIR, "index.js"));
  assert.doesNotMatch(index, /zoomAnimation=|markerZoomAnimation=/);
  assert.match(index, /fadeAnimation=\{false\}/);
  for (const file of walk(SRC_DIR)) {
    assert.doesNotMatch(codeOf(file), /(?:zoomAnimation|fadeAnimation|markerZoomAnimation)\s*[:=]\s*!?\s*(?:prefersReducedMotion|reducedMotion)/, rel(file));
  }
});
