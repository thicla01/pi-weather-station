// End-to-end tests of the radar analyzer's two entry points, analyzeRadar
// (the AI summary's radar block) and getRiskLevels (/api/radar-risk, the
// Sense HAT grid), with RainViewer stubbed: frame index → frame choice →
// tile URLs → decode → classify → samples → text / ring levels.
//
// Why: the other radar tests cover the pure helpers one by one, so a
// refactor that dropped fetchRadarFrames / frameSignature / findFrameNear
// (PR #396, commit b16bbb4) passed all of them while every kiosk's radar
// analysis returned null: the ReferenceError was swallowed by the callers'
// try/catch and reported as "RainViewer 500: fetch frames failed". These
// tests fail on any such break, and pin the tile URL the analyzer really
// sends.
//
// No network and no disk: `axios` and `requestCounter` are replaced through
// require.cache before the analyzer loads (node --test runs each test file
// in its own process, so the stubs stay here). Tiles are built from the real
// fixtures in test/fixtures/rainviewer/. Run: `npm test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PNG } = require("pngjs");

const FIXTURES = path.join(__dirname, "fixtures", "rainviewer");
const TILE_SIZE = 512;

/**
 * A 512×512 RainViewer-like tile: the 64×64 storm crop (every rain colour
 * from -10 to 60 dBZ, real pixels) repeated 8 × 8 times.
 *
 * @returns {Buffer} encoded RGBA PNG
 */
function stormTile() {
  const crop = PNG.sync.read(fs.readFileSync(path.join(FIXTURES, "storm-crop.png")));
  const tile = new PNG({ width: TILE_SIZE, height: TILE_SIZE });
  for (let y = 0; y < TILE_SIZE; y++) {
    const row = (y % crop.height) * crop.width * 4;
    for (let x = 0; x < TILE_SIZE; x += crop.width) {
      crop.data.copy(tile.data, (y * TILE_SIZE + x) * 4, row, row + crop.width * 4);
    }
  }
  return PNG.sync.write(tile);
}

const STORM_TILE = stormTile();
const PLACEHOLDER_TILE = fs.readFileSync(path.join(FIXTURES, "zoom-not-supported.png"));

// What the stubbed RainViewer serves, set per test. `frames` is the past
// frame list of weather-maps.json; `tile` the body of every tile request.
const upstream = { frames: [], tile: STORM_TILE, requests: [] };

const axiosStub = {
  async get(url) {
    upstream.requests.push(url);
    if (url === "https://api.rainviewer.com/public/weather-maps.json") {
      return { status: 200, data: { radar: { past: upstream.frames, nowcast: [] } } };
    }
    if (url.startsWith("https://tilecache.rainviewer.com/")) {
      return { status: 200, data: upstream.tile };
    }
    throw new Error(`unexpected URL in test: ${url}`);
  },
};

/**
 * Put a stub module in require.cache under a real module's resolved path.
 *
 * @param {string} request what the analyzer passes to require()
 * @param {Object} exports the stub's exports
 * @returns {void}
 */
function stubModule(request, exports) {
  const filename = require.resolve(request);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

stubModule("axios", { default: axiosStub });
stubModule("../server/requestCounter", { increment() {}, getCounters: () => ({}), flush() {} });

const { analyzeRadar, getRiskLevels } = require("../server/radarAnalyzerCtrl");
const { getServiceStatus } = require("../server/serviceStatus");

/**
 * Thirteen past frames, 10 min apart, the newest 2 min old — RainViewer's
 * current index shape. The 2-min lag keeps the -15 / -45 min targets off the
 * midpoint between two frames, so the choice doesn't depend on the clock.
 * Paths carry a tag so each test gets its own tile-cache keys.
 *
 * @param {string} tag unique per test
 * @returns {Array<{time: number, path: string}>} past frames, oldest first
 */
function framesNow(tag) {
  const nowSec = Math.floor(Date.now() / 1000);
  return Array.from({ length: 13 }, (_, i) => ({
    time: nowSec - 120 - (12 - i) * 600,
    path: `/v2/radar/${tag}-${i}`,
  }));
}

const tileRequests = () => upstream.requests.filter((u) => u.startsWith("https://tilecache"));

test("getRiskLevels: frame index → z7 `1_0` tiles → ring levels from real pixels", async (t) => {
  t.mock.method(console, "log", () => {});
  upstream.frames = framesNow("risk");
  upstream.tile = STORM_TILE;
  upstream.requests = [];

  const result = await getRiskLevels(45.5, -73.6, { distanceUnit: "km", extendedRadius: false });

  assert.ok(result, "getRiskLevels returned null");
  assert.equal(upstream.requests[0], "https://api.rainviewer.com/public/weather-maps.json");
  const tiles = tileRequests();
  assert.ok(tiles.length > 0, "no tile was requested");
  for (const url of tiles) {
    assert.match(url, /^https:\/\/tilecache\.rainviewer\.com\/v2\/radar\/risk-\d+\/512\/7\/\d+\/\d+\/2\/1_0\.png$/);
  }
  // now / -15 / -45 min → the frames 2, 12 and 42 min old.
  const paths = new Set(tiles.map((u) => u.split("/")[5]));
  assert.deepEqual([...paths].sort(), ["risk-12", "risk-11", "risk-8"].sort());

  assert.equal(result.inner.samples.length, 161, "1 centre + 16 directions × 10 distances");
  const levels = result.inner.samples.map((s) => s.intensity);
  assert.ok(levels.every((l) => Number.isInteger(l) && l >= 0 && l <= 6));
  assert.ok(levels.some((l) => l > 0), "the storm tile reads as clear everywhere");
  assert.ok(["calm", "yellow", "orange", "red"].includes(result.inner.level));
  assert.equal(result.outer, null, "extendedRadius off");
  assert.equal(getServiceStatus()["RainViewer (risk)"].status, 200);
});

test("analyzeRadar: frame index → tiles → the AI prompt's radar block", async (t) => {
  t.mock.method(console, "log", () => {});
  upstream.frames = framesNow("text");
  upstream.tile = STORM_TILE;
  upstream.requests = [];

  const text = await analyzeRadar(46.8, -71.2, { distanceUnit: "km", extendedRadius: true });

  assert.ok(text, "analyzeRadar returned null");
  assert.ok(tileRequests().length > 0, "no tile was requested");
  for (const label of ["now:", "-15 min:", "-45 min:"]) assert.ok(text.includes(label), `missing ${label}`);
  assert.match(text, /Active \d+km-\d+km:/);
  assert.match(text, /(very light|light|moderate|heavy|very heavy|extreme)/);
  assert.equal(getServiceStatus()["RainViewer (analyzer)"].status, 200);
});

test("refused tiles: the frames are fetched, then both entry points report the radar unavailable", async (t) => {
  t.mock.method(console, "log", () => {});
  const warn = t.mock.method(console, "warn", () => {});
  upstream.frames = framesNow("refused");
  upstream.tile = PLACEHOLDER_TILE;
  upstream.requests = [];

  assert.equal(await getRiskLevels(43.7, -79.4, { distanceUnit: "km", extendedRadius: false }), null);
  assert.equal(await analyzeRadar(43.7, -79.4, { distanceUnit: "km", extendedRadius: false }), null);

  // Unavailable because the tiles were refused, not because the frame index
  // couldn't be fetched (what a missing helper looked like).
  assert.ok(tileRequests().length > 0, "no tile was requested");
  assert.match(getServiceStatus()["RainViewer (analyzer)"].comment, /Zoom Level Not Supported/);
  assert.ok(warn.mock.calls.some((c) => /\[radar\] tile .* refused/.test(c.arguments[0])));
});
