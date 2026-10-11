// Pins the RainViewer tile requests: zoom, tile size, colour scheme and
// options, on the client's radar layer and in the server's analyzer.
//
// RainViewer serves radar tiles up to z7 in the URL. Past that it answers
// HTTP 200 with a "Zoom Level Not Supported" PNG, a translucent grey box with
// white text (checked 2026-10-10 on z8 and z9, 3,269 bytes), which no error
// handler sees: the browser shows the grey box, the analyzer would decode it
// as radar. The client reaches z7
// through Leaflet zoom 8: 512 px tiles with `zoomOffset -1`, so the URL zoom
// is the map zoom minus one, and `maxNativeZoom 8` stops it there (map zooms
// 9-12 stretch the z7 tile; past `maxZoom 12` the radar hides). Raising
// `maxNativeZoom`, dropping `zoomOffset` or "fixing" the server's ZOOM to 8
// would silently load the grey PNG, hence these pins. The colour scheme must
// be Universal Blue (2) on both sides: the analyzer decodes pixels with that
// table (test/radarPalette.test.js).
//
// Source-level and mechanical, like test/mapAttribution.test.js. Run:
// `npm test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { RAINVIEWER_COLOR_SCHEME, RAINVIEWER_TILE_OPTIONS } = require("../server/rainViewerPalette");
const { __test: radar } = require("../server/radarAnalyzerCtrl");

const MAP_FILE = path.join(__dirname, "..", "client", "src", "components", "WeatherMap", "index.js");
const PLACEHOLDER = path.join(__dirname, "fixtures", "rainviewer", "zoom-not-supported.png");
const REAL_TILE = path.join(__dirname, "fixtures", "rainviewer", "storm-crop.png");

// RainViewer's maximum zoom in the tile URL (weather-maps-api docs, and the
// grey placeholder above it).
const RAINVIEWER_MAX_URL_ZOOM = 7;

/**
 * The map component's source with comment lines blanked (same masking as
 * test/mapAttribution.test.js), so prose never passes for a prop.
 *
 * @returns {string} comment-masked source of WeatherMap/index.js
 */
function mapSource() {
  return fs.readFileSync(MAP_FILE, "utf8")
    .replace(/^[ \t]*(?:\/\/|\/\*|\*|\{\/\*).*$/gm, (line) => " ".repeat(line.length));
}

/**
 * Numeric value of a `prop={n}` in a JSX element's text.
 *
 * @param {string} tag element source
 * @param {string} prop prop name
 * @returns {number|null} the number, or null when absent
 */
function numericProp(tag, prop) {
  const m = new RegExp(`\\b${prop}=\\{\\s*(-?\\d+)\\s*\\}`).exec(tag);
  return m ? Number(m[1]) : null;
}

test("server: the analyzer reads z7 tiles, 512 px, Universal Blue, smoothed with snow", () => {
  assert.equal(radar.ZOOM, RAINVIEWER_MAX_URL_ZOOM);
  assert.equal(radar.TILE_SIZE, 512);
  assert.equal(RAINVIEWER_COLOR_SCHEME, 2);
  assert.equal(RAINVIEWER_TILE_OPTIONS, "1_1");
  assert.equal(
    radar.rainViewerTileUrl("/v2/radar/abc123", 37, 46),
    "https://tilecache.rainviewer.com/v2/radar/abc123/512/7/37/46/2/1_1.png",
  );
});

test("client: the radar layer can't request a zoom RainViewer doesn't serve", () => {
  const code = mapSource();
  const start = code.indexOf("<RadarTileLayer");
  assert.ok(start !== -1, "<RadarTileLayer> not found in WeatherMap/index.js");
  const tag = code.slice(start, code.indexOf("/>", start) + 2);
  const tileSize = numericProp(tag, "tileSize");
  const zoomOffset = numericProp(tag, "zoomOffset");
  const maxNativeZoom = numericProp(tag, "maxNativeZoom");
  const maxZoom = numericProp(tag, "maxZoom");
  assert.equal(tileSize, 512);
  assert.equal(zoomOffset, -1);
  assert.equal(maxNativeZoom, 8);
  assert.equal(maxZoom, 12);
  // The highest zoom the layer puts in a URL.
  assert.equal(maxNativeZoom + zoomOffset, RAINVIEWER_MAX_URL_ZOOM);
});

test("client: the radar tile URL matches the analyzer's size, scheme and options", () => {
  const m = /const rainViewerTileUrl = \(path\) => `([^`]*)`;/.exec(mapSource());
  assert.ok(m, "rainViewerTileUrl template not found in WeatherMap/index.js");
  assert.equal(
    m[1],
    `https://tilecache.rainviewer.com\${path}/${radar.TILE_SIZE}/{z}/{x}/{y}`
      + `/${RAINVIEWER_COLOR_SCHEME}/${RAINVIEWER_TILE_OPTIONS}.png`,
  );
});

test("server: the grey 'Zoom Level Not Supported' PNG is refused, not read as radar", (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const placeholder = fs.readFileSync(PLACEHOLDER);
  assert.equal(placeholder.length, 3269, "fixture is the real z8 response");
  assert.equal(radar.isZoomPlaceholderPng(placeholder), true);
  assert.equal(radar.isZoomPlaceholderPng(fs.readFileSync(REAL_TILE)), false);
  assert.throws(() => radar.decodeTile(placeholder, "z8"), /Zoom Level Not Supported/);
  assert.equal(warn.mock.callCount(), 1);
});

test("server: the palette-drift guard would refuse the placeholder too", () => {
  // Second line of defence if the header check ever misses: decoded, the
  // placeholder's translucent grey box and white text are no Universal Blue
  // colours.
  const { PNG } = require("pngjs");
  const tile = radar.classifyTile(PNG.sync.read(fs.readFileSync(PLACEHOLDER)));
  assert.ok(tile.painted > 0);
  assert.equal(tile.offPalette, tile.painted);
  assert.ok(tile.offPalette >= radar.OFF_PALETTE_REJECT_PIXELS, `offPalette ${tile.offPalette}`);
});
