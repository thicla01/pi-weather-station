// Pins the RainViewer tile requests: zoom, tile size, colour scheme and
// options, on the client's radar layer and in the server's analyzer.
//
// RainViewer serves radar tiles up to z7 in the URL. Past that it answers
// HTTP 200 with a "Zoom Level Not Supported" PNG, a translucent grey box with
// white text (checked 2026-10-10 on z8 and z9, 3,269 bytes), which no error
// handler sees: the browser shows the grey box, the analyzer would decode it
// as radar. The client reaches z7 through Leaflet zoom 8: 512 px tiles with
// `zoomOffset -1`, so the URL zoom is the map zoom minus one, and
// `maxNativeZoom 8` stops it there (map zooms 9-12 stretch the z7 tile; past
// `maxZoom 12` the radar hides). Raising `maxNativeZoom`, dropping
// `zoomOffset` or "fixing" the server's ZOOM to 8 would silently load the
// grey PNG, hence these pins. The colour scheme must be Universal Blue (2) on
// both sides: the analyzer decodes pixels with that table
// (test/radarPalette.test.js). The `{smooth}_{snow}` options differ on
// purpose: the map shows `1_1` (snow and mixed precipitation in their own
// colours), the analyzer reads `1_0` (everything in the published rain
// colours; with `1_1` mixed precipitation is an unlisted pink ramp that the
// palette-change guard would refuse).
//
// Source-level and mechanical, like test/mapAttribution.test.js. Run:
// `npm test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PNG } = require("pngjs");

const { RAINVIEWER_COLOR_SCHEME, RAINVIEWER_ANALYZER_TILE_OPTIONS } = require("../server/rainViewerPalette");
const { __test: radar } = require("../server/radarAnalyzerCtrl");

const MAP_FILE = path.join(__dirname, "..", "client", "src", "components", "WeatherMap", "index.js");
const FIXTURES = path.join(__dirname, "fixtures", "rainviewer");
const PLACEHOLDER = path.join(FIXTURES, "zoom-not-supported.png");
const REAL_TILE = path.join(FIXTURES, "storm-crop.png");
const PALETTE_TILE = path.join(FIXTURES, "storm-crop-palette.png");
const PALETTE_OFF_PALETTE_TILE = path.join(FIXTURES, "mixed-crop-snow-on-palette.png");
const EMPTY_TILE = path.join(FIXTURES, "empty-tile.png");

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

test("server: the analyzer reads z7 tiles, 512 px, Universal Blue, smoothed, snow in rain colours", () => {
  assert.equal(radar.ZOOM, RAINVIEWER_MAX_URL_ZOOM);
  assert.equal(radar.TILE_SIZE, 512);
  assert.equal(RAINVIEWER_COLOR_SCHEME, 2);
  assert.equal(RAINVIEWER_ANALYZER_TILE_OPTIONS, "1_0");
  assert.equal(
    radar.rainViewerTileUrl("/v2/radar/abc123", 37, 46),
    "https://tilecache.rainviewer.com/v2/radar/abc123/512/7/37/46/2/1_0.png",
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

test("client: the radar tile URL has the analyzer's size and scheme, snow in its own colours", () => {
  const m = /const rainViewerTileUrl = \(path\) => `([^`]*)`;/.exec(mapSource());
  assert.ok(m, "rainViewerTileUrl template not found in WeatherMap/index.js");
  assert.equal(
    m[1],
    `https://tilecache.rainviewer.com\${path}/${radar.TILE_SIZE}/{z}/{x}/{y}`
      + `/${RAINVIEWER_COLOR_SCHEME}/1_1.png`,
  );
});

test("server: the grey 'Zoom Level Not Supported' PNG is refused, not read as radar", (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const placeholder = fs.readFileSync(PLACEHOLDER);
  assert.equal(placeholder.length, 3269, "fixture is the real z8 response");
  assert.equal(placeholder[24], 4, "bit depth 4");
  assert.equal(placeholder[25], 3, "colour type 3 (palette)");
  assert.equal(radar.isZoomPlaceholderPng(placeholder), true);
  assert.equal(radar.isZoomPlaceholderPng(fs.readFileSync(REAL_TILE)), false);
  assert.throws(() => radar.decodeTile(placeholder, "z8"), /Zoom Level Not Supported/);
  assert.equal(warn.mock.callCount(), 1);
});

test("server: what refuses the placeholder is its content, none of it Universal Blue", () => {
  // The header only names the refusal; decoded, the placeholder's
  // translucent grey box and white text are no Universal Blue colours.
  const tile = radar.classifyTile(PNG.sync.read(fs.readFileSync(PLACEHOLDER)));
  assert.ok(tile.painted > 0);
  assert.equal(tile.offPalette, tile.painted);
  assert.ok(tile.offPalette >= radar.OFF_PALETTE_REJECT_PIXELS, `offPalette ${tile.offPalette}`);
});

test("server: real radar re-encoded as a palette PNG is not the placeholder and decodes like the original", (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  // storm-crop.png re-encoded losslessly as an 8-bit palette PNG with tRNS
  // (72 colours), as a CDN optimiser could serve it.
  const palette = fs.readFileSync(PALETTE_TILE);
  assert.equal(palette[25], 3, "colour type 3 (palette)");
  assert.equal(palette[24], 8, "bit depth 8");
  assert.equal(radar.isZoomPlaceholderPng(palette), false);
  const fromPalette = radar.decodeTile(palette, "palette");
  const fromRgba = radar.decodeTile(fs.readFileSync(REAL_TILE), "rgba");
  assert.equal(fromPalette.offPalette, 0);
  assert.equal(fromPalette.painted, fromRgba.painted);
  assert.deepEqual(fromPalette.levels, fromRgba.levels);
  assert.equal(warn.mock.callCount(), 0);
});

test("server: a palette PNG of unknown colours is refused under its own name", (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  // mixed-crop-snow-on.png (the unlisted pink ramp) as an 8-bit palette PNG.
  const buffer = fs.readFileSync(PALETTE_OFF_PALETTE_TILE);
  assert.equal(radar.isZoomPlaceholderPng(buffer), false);
  assert.throws(() => radar.decodeTile(buffer, "palette-pink"), (err) => {
    assert.match(err.message, /\(palette-mode PNG\) are not Universal Blue colours/);
    assert.doesNotMatch(err.message, /Zoom Level Not Supported/);
    assert.match(err.message, /most frequent: #ff[0-9a-f]{6} ×\d+/);
    return true;
  });
  assert.equal(warn.mock.callCount(), 1);
});

test("server: an empty RainViewer tile reads as clear, not as unavailable", (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  // A real 512×512 tile with no echo: 1,096 bytes, RGBA, fully transparent.
  const empty = fs.readFileSync(EMPTY_TILE);
  assert.equal(empty.length, 1096);
  assert.equal(radar.isZoomPlaceholderPng(empty), false);
  const tile = radar.decodeTile(empty, "empty");
  assert.equal(tile.width, 512);
  assert.equal(tile.height, 512);
  assert.equal(tile.painted, 0);
  assert.equal(tile.offPalette, 0);
  assert.equal(radar.readPixelIntensity(tile, 256, 256), 0);
  assert.equal(warn.mock.callCount(), 0);
});
