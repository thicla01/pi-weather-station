// Radar tile cooldown — keeps a refused RainViewer tile from being asked
// for again while RainViewer's per-IP rate limit is still saturated.
//
// RainViewer allows 500 tile requests per 60 s per public IP, with bursts
// of 300 (x-ratelimit-* headers), shared by every kiosk behind the same
// router and by their servers' radar analysis. A 429 response is never
// cached, so a tile the limit refused is requested again by every later
// loop pass (each pass re-creates the frame's tiles) and by every retry.
// Measured 2026-10-09 on a 34" layout (32 tiles per frame), cold cache,
// 4× playback: ~2 900 refused requests a minute, the IP's counter at
// ~4 000 against 500, on the old url swap and on the frame slots alike.
// The refusals kept the IP over the limit for as long as the loop played.
//
// So a URL that failed to load is put on hold for RADAR_TILE_COOLDOWN_MS,
// longer than RainViewer's 60 s window: until then no layer requests it
// (WeatherMap/RadarTileLayer.js holds the tile's src back), and the tile
// is retried once the hold ends, at most RADAR_TILE_MAX_RETRIES times.
// The first cold pass can still overrun the burst; the holes it leaves
// fill in a minute later instead of feeding the limit forever. An image
// error carries no status code, so a Wi-Fi blip is held the same way; a
// one-minute hole is the cost of not hammering the shared limit.
//
// MODULE FORMAT: CommonJS on purpose, like ui/radarFrameStack.js, so
// test/radarTileCooldown.test.js runs the real module under `node --test`.

/** Hold time of a failed tile URL: longer than RainViewer's 60 s window. */
const RADAR_TILE_COOLDOWN_MS = 65_000;

/** Retries of one tile after its hold ends, before Leaflet's hole stays. */
const RADAR_TILE_MAX_RETRIES = 2;

/** Bound on tracked URLs (a 34" screen shows 32 tiles × 5 mounted frames). */
const RADAR_TILE_COOLDOWN_MAX_TRACKED = 2000;

/**
 * Creates a registry of failed tile URLs and when each may be requested
 * again. Expired entries are dropped when read; the registry never holds
 * more than `maxTracked` URLs (expired ones go first, then the oldest).
 *
 * @param {object} [options] - Registry options.
 * @param {number} [options.cooldownMs] - Hold time after a failure.
 * @param {number} [options.maxTracked] - Maximum number of URLs tracked.
 * @param {() => number} [options.now] - Clock in ms (injectable for tests).
 * @returns {{ remaining: (url: string) => number, markFailed: (url: string) => void, size: () => number }}
 *   remaining(url) is the ms left on the URL's hold (0 when it may be
 *   requested), markFailed(url) starts or restarts its hold, size() is
 *   the number of URLs tracked.
 */
function createTileCooldown({
  cooldownMs = RADAR_TILE_COOLDOWN_MS,
  maxTracked = RADAR_TILE_COOLDOWN_MAX_TRACKED,
  now = Date.now,
} = {}) {
  const until = new Map();
  return {
    remaining(url) {
      const end = until.get(url);
      if (end === undefined) return 0;
      const left = end - now();
      if (left > 0) return left;
      until.delete(url);
      return 0;
    },
    markFailed(url) {
      // Re-insert so the Map's order stays oldest-first for eviction.
      until.delete(url);
      until.set(url, now() + cooldownMs);
      if (until.size <= maxTracked) return;
      const t = now();
      for (const [u, end] of until) {
        if (end <= t) until.delete(u);
      }
      while (until.size > maxTracked) until.delete(until.keys().next().value);
    },
    size() {
      return until.size;
    },
  };
}

module.exports = {
  RADAR_TILE_COOLDOWN_MS,
  RADAR_TILE_MAX_RETRIES,
  RADAR_TILE_COOLDOWN_MAX_TRACKED,
  createTileCooldown,
};
