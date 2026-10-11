// Regression tests for the radar analyzer's pixel → intensity step, on real
// RainViewer pixels.
//
// RainViewer stopped serving its NEXRAD colour scheme (6) and now paints
// every tile in "Universal Blue" (scheme 2), whatever scheme the URL asks
// for. The analyzer kept matching pixels against the NEXRAD colours, so it
// read about half of the light rain and every extreme core as clear sky
// (2026-10-10). It now decodes each pixel to dBZ with the published Universal
// Blue table (server/rainViewerPalette.js) and maps dBZ to the 6 levels.
//
// Fixtures (test/fixtures/rainviewer/, pixels copied unchanged from zoom-7
// tiles of frame /v2/radar/89624b2a0337, 2026-10-11 03:00 UTC):
//   - storm-crop.png: 64×64 from tile 31/57 (southern Mexico), a storm holding
//     every rain colour from -10 to 60 dBZ;
//   - snow-crop.png: 64×64 from tile 23/42 (Alberta), snow 7-23 dBZ in the
//     snow colours (the URL's `_1` snow option).
// and, from frame /v2/radar/07e17464c89d (2026-10-11 04:10 UTC), tile 20/45
// (Oregon Cascades), the same 64×64 of mixed precipitation twice:
//   - mixed-crop-snow-on.png: with `1_1`, as the map shows it — an unlisted
//     pink ramp;
//   - mixed-crop-snow-off.png: with `1_0`, as the analyzer reads it — the
//     published rain colours.
// The (x, y) → colour pairs below were read from those files; the colour →
// dBZ pairs come from RainViewer's published table, not from our code.
//
// Run: `npm test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PNG } = require("pngjs");

const {
  UNIVERSAL_BLUE_MIN_DBZ,
  UNIVERSAL_BLUE_RAIN,
  UNIVERSAL_BLUE_SNOW,
  buildDbzLookup,
} = require("../server/rainViewerPalette");
const { __test: radar } = require("../server/radarAnalyzerCtrl");

const FIXTURES = path.join(__dirname, "fixtures", "rainviewer");
const readFixture = (name) => fs.readFileSync(path.join(FIXTURES, name));

/**
 * A w×h RGBA tile filled with one colour, as pngjs decodes it.
 *
 * @param {string} hex colour as RRGGBBAA
 * @param {number} [w] width in pixels
 * @param {number} [h] height in pixels
 * @returns {{width: number, height: number, data: Buffer}} decoded-PNG shape
 */
function solidTile(hex, w = 1, h = 1) {
  return { width: w, height: h, data: Buffer.from(hex.repeat(w * h), "hex") };
}

/**
 * Intensity level of one colour, through the analyzer's real classifier.
 *
 * @param {string} hex colour as RRGGBBAA
 * @returns {number} level 0-6
 */
const levelOf = (hex) => radar.classifyTile(solidTile(hex)).levels[0];

// ─── The published table ────────────────────────────────────────────────

test("palette: rain and snow each cover -10 … 95 dBZ, one colour per dBZ", () => {
  assert.equal(UNIVERSAL_BLUE_MIN_DBZ, -10);
  assert.equal(UNIVERSAL_BLUE_RAIN.length, 106);
  assert.equal(UNIVERSAL_BLUE_SNOW.length, 106);
  for (const hex of [...UNIVERSAL_BLUE_RAIN, ...UNIVERSAL_BLUE_SNOW]) {
    assert.match(hex, /^[0-9a-f]{8}$/);
  }
});

test("palette: no colour is both a rain and a snow colour", () => {
  const rain = new Set(UNIVERSAL_BLUE_RAIN);
  assert.deepEqual(UNIVERSAL_BLUE_SNOW.filter((hex) => rain.has(hex)), []);
});

test("palette: the colour jumps the level floors rely on are the published ones", () => {
  // From RainViewer's CSV (Universal Blue column), 2026-10-10.
  const published = [
    ["rain", 10, "cec08796"], ["rain", 15, "88ddeeff"], ["rain", 20, "00a3e0ff"],
    ["rain", 34, "004768ff"], ["rain", 35, "ffee00ff"], ["rain", 40, "ffaa00ff"],
    ["rain", 44, "ff8100ff"], ["rain", 45, "ff4400ff"], ["rain", 54, "5d0000ff"],
    ["rain", 55, "ffaaffff"], ["rain", 65, "ffffffff"], ["rain", 75, "00ff00ff"],
    ["snow", 10, "bfffffff"], ["snow", 20, "7fbfffff"], ["snow", 75, "0000ffff"],
  ];
  for (const [kind, dbz, hex] of published) {
    const table = kind === "rain" ? UNIVERSAL_BLUE_RAIN : UNIVERSAL_BLUE_SNOW;
    assert.equal(table[dbz - UNIVERSAL_BLUE_MIN_DBZ], hex, `${kind} ${dbz} dBZ`);
  }
});

test("palette: a colour repeated over a run maps to the run's lowest dBZ", () => {
  const lookup = buildDbzLookup();
  assert.equal(lookup.get(0xffffffff), 65);
  assert.equal(lookup.get(0x00ff00ff), 75);
  assert.equal(lookup.get(0x0000ffff), 75);
  // Snow -10 dBZ is fully transparent: not a painted colour.
  assert.equal(lookup.has(0xcfffff00), false);
});

// ─── dBZ → level ────────────────────────────────────────────────────────

test("levels: floors at 10 / 20 / 35 / 40 / 45 / 55 dBZ", () => {
  assert.deepEqual(radar.DBZ_LEVEL_FLOORS, [10, 20, 35, 40, 45, 55]);
  const cases = [
    [-10, 0], [9, 0], [10, 1], [19, 1], [20, 2], [34, 2], [35, 3], [39, 3],
    [40, 4], [44, 4], [45, 5], [54, 5], [55, 6], [64, 6], [75, 6], [95, 6],
  ];
  for (const [dbz, level] of cases) assert.equal(radar.dbzToIntensity(dbz), level, `${dbz} dBZ`);
});

test("levels: the colours the NEXRAD matcher read as clear now classify", () => {
  // Real served colours that scheme 6's nearest-colour match dropped to 0.
  assert.equal(levelOf("cec08796"), 1, "10 dBZ beige");
  assert.equal(levelOf("006295ff"), 2, "28 dBZ blue");
  assert.equal(levelOf("004768ff"), 2, "34 dBZ navy");
  assert.equal(levelOf("5d0000ff"), 5, "54 dBZ maroon");
  assert.equal(levelOf("ffaaffff"), 6, "55 dBZ pink");
  assert.equal(levelOf("ffffffff"), 6, "65+ dBZ white");
  assert.equal(levelOf("00ff00ff"), 6, "75+ dBZ green");
});

test("levels: transparent, sub-floor and off-palette pixels read as clear", () => {
  assert.equal(levelOf("00000000"), 0);
  assert.equal(levelOf("c2b4828c"), 0, "9 dBZ beige, under the 10 dBZ floor");
  // The old NEXRAD "light" green: not a Universal Blue colour.
  const tile = radar.classifyTile(solidTile("00c800ff"));
  assert.equal(tile.levels[0], 0);
  assert.equal(tile.offPalette, 1);
});

// ─── Real tiles ─────────────────────────────────────────────────────────

test("storm crop: every painted pixel is a Universal Blue colour, all 7 levels present", () => {
  const tile = radar.decodeTile(readFixture("storm-crop.png"), "storm-crop");
  assert.equal(tile.width, 64);
  assert.equal(tile.height, 64);
  assert.equal(tile.offPalette, 0);
  assert.ok(tile.painted > 2000, `painted ${tile.painted}`);
  const seen = new Set(tile.levels);
  assert.deepEqual([...seen].sort(), [0, 1, 2, 3, 4, 5, 6]);
});

test("storm crop: known pixels classify to their published dBZ's level", () => {
  const tile = radar.decodeTile(readFixture("storm-crop.png"), "storm-crop");
  const png = PNG.sync.read(readFixture("storm-crop.png"));
  const at = (x, y) => tile.levels[y * tile.width + x];
  const hexAt = (x, y) => png.data.subarray((y * 64 + x) * 4, (y * 64 + x) * 4 + 4).toString("hex");
  // [x, y, colour in the file, dBZ by the published table, level]
  const pixels = [
    [19, 0, "63615914", -10, 0],
    [61, 0, "c2b4828c", 9, 0],
    [45, 0, "cec08796", 10, 1],
    [25, 3, "1baee2ff", 19, 1],
    [22, 3, "00a3e0ff", 20, 2],
    [52, 1, "006295ff", 28, 2],
    [26, 9, "004768ff", 34, 2],
    [48, 11, "ffee00ff", 35, 3],
    [29, 13, "ffb700ff", 39, 3],
    [28, 13, "ffaa00ff", 40, 4],
    [24, 10, "ff8100ff", 44, 4],
    [49, 12, "ff4400ff", 45, 5],
    [53, 16, "5d0000ff", 54, 5],
    [37, 15, "ffaaffff", 55, 6],
    [18, 44, "ff77ffff", 60, 6],
  ];
  for (const [x, y, hex, dbz, level] of pixels) {
    assert.equal(hexAt(x, y), hex, `fixture pixel ${x},${y}`);
    assert.equal(at(x, y), level, `${hex} (${dbz} dBZ) at ${x},${y}`);
  }
  // The 3×3 probe keeps the worst level around the point.
  assert.equal(radar.readPixelIntensity(tile, 37, 15), 6);
});

test("snow crop: snow colours decode on the same dBZ scale", () => {
  const tile = radar.decodeTile(readFixture("snow-crop.png"), "snow-crop");
  assert.equal(tile.offPalette, 0);
  const at = (x, y) => tile.levels[y * tile.width + x];
  assert.equal(at(63, 24), 0, "snow 9 dBZ");
  assert.equal(at(30, 0), 1, "snow 10 dBZ");
  assert.equal(at(5, 0), 1, "snow 19 dBZ");
  assert.equal(at(0, 60), 2, "snow 20 dBZ");
  assert.equal(at(34, 62), 2, "snow 23 dBZ");
});

test("mixed precipitation: with snow colours on (`1_1`) it is a pink ramp the guard refuses", (t) => {
  t.mock.method(console, "warn", () => {});
  const png = PNG.sync.read(readFixture("mixed-crop-snow-on.png"));
  const tile = radar.classifyTile(png);
  assert.ok(tile.offPalette >= radar.OFF_PALETTE_REJECT_PIXELS, `offPalette ${tile.offPalette}`);
  assert.equal(png.data.subarray((6 * 64 + 27) * 4, (6 * 64 + 27) * 4 + 4).toString("hex"), "ffa7c1ff");
  assert.throws(() => radar.decodeTile(readFixture("mixed-crop-snow-on.png"), "mixed-on"), /not Universal Blue colours/);
});

test("mixed precipitation: with snow in rain colours (`1_0`, the analyzer's tiles) every pixel decodes", () => {
  const on = PNG.sync.read(readFixture("mixed-crop-snow-on.png"));
  const off = radar.decodeTile(readFixture("mixed-crop-snow-off.png"), "mixed-off");
  assert.equal(off.offPalette, 0);
  // Same echoes, same pixels: what is painted with snow on is painted with
  // snow off (the -10 dBZ fringe aside, transparent in the snow/mix ramps).
  let paintedOn = 0;
  for (let p = 0; p < 64 * 64; p++) if (on.data[p * 4 + 3] > 0) paintedOn++;
  assert.ok(off.painted >= paintedOn, `painted off ${off.painted}, on ${paintedOn}`);
  const at = (x, y) => off.levels[y * off.width + x];
  // [x, y, pink in the snow-on crop, dBZ of its rain colour in the snow-off crop, level]
  for (const [x, y, pink, dbz, level] of [[25, 2, "ffdae57f", 0, 0], [27, 6, "ffa7c1ff", 14, 1], [26, 22, "ff91b2ff", 20, 2]]) {
    const i = (y * 64 + x) * 4;
    assert.equal(on.data.subarray(i, i + 4).toString("hex"), pink, `pink at ${x},${y}`);
    assert.equal(at(x, y), level, `${pink} → rain ${dbz} dBZ at ${x},${y}`);
  }
});

// ─── Palette-drift guard ────────────────────────────────────────────────

/**
 * PNG bytes of a 16×16 tile: `stray` pixels in an off-palette colour (the
 * old NEXRAD green), the rest a real 30 dBZ blue.
 *
 * @param {number} stray number of off-palette pixels
 * @returns {Buffer} encoded RGBA PNG
 */
function tileWithStrays(stray) {
  const png = new PNG({ width: 16, height: 16 });
  for (let p = 0; p < 256; p++) {
    Buffer.from(p < stray ? "00c800ff" : "005588ff", "hex").copy(png.data, p * 4);
  }
  return PNG.sync.write(png);
}

test("drift guard: a tile with OFF_PALETTE_REJECT_PIXELS stray colours is refused", (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const limit = radar.OFF_PALETTE_REJECT_PIXELS;
  const below = radar.decodeTile(tileWithStrays(limit - 1), "below");
  assert.equal(below.offPalette, limit - 1);
  assert.equal(below.levels[0], 0, "a stray pixel reads as clear");
  assert.equal(below.levels[255], 2, "the real blue still reads");
  assert.equal(warn.mock.callCount(), 0);
  assert.throws(() => radar.decodeTile(tileWithStrays(limit), "at-limit"), /not Universal Blue colours/);
  assert.equal(warn.mock.callCount(), 1, "the refusal is logged");
  assert.match(warn.mock.calls[0].arguments[0], /\[radar\] tile at-limit refused/);
  // The log names the stray colours, so a new ramp is identified at once.
  assert.match(warn.mock.calls[0].arguments[0], /most frequent: #00c800ff ×64\)/);
});
