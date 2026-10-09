// Tests for the radar tile cooldown in `client/src/ui/radarTileCooldown.js`:
// a refused RainViewer tile URL is not requested again until its hold
// ends (longer than RainViewer's 60 s rate-limit window). CommonJS module,
// so these tests run the real code. Run: `npm test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  RADAR_TILE_COOLDOWN_MS,
  RADAR_TILE_MAX_RETRIES,
  RADAR_TILE_COOLDOWN_MAX_TRACKED,
  createTileCooldown,
} = require("../client/src/ui/radarTileCooldown");

const clock = (start = 1_000_000) => {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
};
const URL_A = "https://tilecache.rainviewer.com/v2/radar/a/512/6/18/22/6/1_1.png";
const URL_B = "https://tilecache.rainviewer.com/v2/radar/b/512/6/18/22/6/1_1.png";

test("the hold outlasts RainViewer's 60 s window; retries are bounded", () => {
  assert.ok(RADAR_TILE_COOLDOWN_MS > 60_000);
  assert.ok(RADAR_TILE_MAX_RETRIES >= 1 && RADAR_TILE_MAX_RETRIES <= 3);
  assert.ok(RADAR_TILE_COOLDOWN_MAX_TRACKED >= 32 * 5, "covers a 34\" screen × 5 mounted frames");
});

test("an unknown URL may be requested right away", () => {
  const c = createTileCooldown({ now: clock().now });
  assert.equal(c.remaining(URL_A), 0);
  assert.equal(c.size(), 0);
});

test("a failed URL is held for the cooldown, then released and forgotten", () => {
  const k = clock();
  const c = createTileCooldown({ now: k.now, cooldownMs: 65_000 });
  c.markFailed(URL_A);
  assert.equal(c.remaining(URL_A), 65_000);
  assert.equal(c.remaining(URL_B), 0, "other URLs are not affected");
  k.advance(60_000);
  assert.equal(c.remaining(URL_A), 5_000);
  k.advance(5_000);
  assert.equal(c.remaining(URL_A), 0);
  assert.equal(c.size(), 0, "an expired entry is dropped when read");
});

test("failing again restarts the hold", () => {
  const k = clock();
  const c = createTileCooldown({ now: k.now, cooldownMs: 65_000 });
  c.markFailed(URL_A);
  k.advance(65_000);
  c.markFailed(URL_A);
  assert.equal(c.remaining(URL_A), 65_000);
  assert.equal(c.size(), 1);
});

test("the registry stays bounded: expired entries go first, then the oldest", () => {
  const k = clock();
  const c = createTileCooldown({ now: k.now, cooldownMs: 1_000, maxTracked: 3 });
  c.markFailed("u1");
  c.markFailed("u2");
  k.advance(2_000); // u1, u2 expired
  c.markFailed("u3");
  c.markFailed("u4");
  assert.equal(c.size(), 2, "u3 + u4 remain: expired u1/u2 were swept when the 4th mark crossed the cap of 3");
  c.markFailed("u5");
  c.markFailed("u6");
  assert.equal(c.size(), 3);
  assert.equal(c.remaining("u3"), 0, "the oldest live entry was evicted");
  assert.ok(c.remaining("u6") > 0);
});

test("re-marking a URL moves it to the young end of the eviction order", () => {
  const k = clock();
  const c = createTileCooldown({ now: k.now, cooldownMs: 10_000, maxTracked: 2 });
  c.markFailed("old");
  c.markFailed("other");
  c.markFailed("old"); // refreshed: now younger than "other"
  c.markFailed("new"); // over the cap: "other" goes
  assert.ok(c.remaining("old") > 0);
  assert.equal(c.remaining("other"), 0);
  assert.ok(c.remaining("new") > 0);
});
