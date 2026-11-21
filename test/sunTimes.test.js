// Tests for the sun-times request logic in `client/src/ui/sunTimes.js`:
// what a failed refresh does to the values on screen (kept when they answer
// the same place and local day, dropped otherwise) and when it is tried
// again (30 s, 2 min, 5 min, then the hourly poller). The fetcher takes its
// HTTP get, state setter, clock and timers as arguments, so every path runs
// here without React or a network. The module is CommonJS so these tests
// exercise the real code. Run: `npm test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  SUN_RETRY_DELAYS_MS,
  NO_SUN_TIMES,
  localDateKey,
  sunRequestKey,
  sunTimesUrl,
  sunRetryDelay,
  createSunTimesFetcher,
} = require("../client/src/ui/sunTimes");

const SRC = path.join(__dirname, "..", "client", "src");
const MONTREAL = { latitude: 45.5088, longitude: -73.5878 };
const QUEBEC = { latitude: 46.8139, longitude: -71.208 };
const NOON = new Date(2026, 10, 19, 12, 0, 0);          // 19 Nov 2026, local
const NEXT_DAY = new Date(2026, 10, 20, 0, 10, 0);
const TODAY = { sunrise: "2026-11-19T11:59:00+00:00", sunset: "2026-11-19T21:20:00+00:00" };
const TOMORROW = { sunrise: "2026-11-20T12:00:00+00:00", sunset: "2026-11-20T21:19:00+00:00" };
const answer = (results = TODAY, tomorrowResults = TOMORROW) => ({ data: { status: "OK", results, tomorrowResults } });

/**
 * A fetcher wired to fakes: `get` returns promises the test settles by hand,
 * timers are captured instead of armed, the clock is a variable, and the
 * state setter behaves like React's (value or updater).
 */
function harness() {
  const h = { sun: NO_SUN_TIMES, gets: [], timers: [], cleared: [], clock: NOON };
  h.fetcher = createSunTimesFetcher({
    get: (url) => new Promise((resolve, reject) => { h.gets.push({ url, resolve, reject }); }),
    setSun: (next) => { h.sun = typeof next === "function" ? next(h.sun) : next; },
    now: () => h.clock,
    setTimer: (fn, ms) => { const id = { fn, ms }; h.timers.push(id); return id; },
    clearTimer: (id) => { if (id) h.cleared.push(id); },
  });
  /** Timers armed and not cancelled. */
  h.pending = () => h.timers.filter((t) => !h.cleared.includes(t));
  /** Fire the one pending retry timer. */
  h.fireRetry = () => {
    const [timer] = h.pending();
    h.cleared.push(timer);
    timer.fn();
  };
  return h;
}

/** Let the promise callbacks chained on a settled `get` run. */
const settle = () => new Promise((resolve) => { setImmediate(resolve); });
const swallow = (promise) => promise.catch(() => undefined);

test("localDateKey: the local calendar day, zero-padded", () => {
  assert.equal(localDateKey(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
  assert.equal(localDateKey(NOON), "2026-11-19");
});

test("sunRequestKey: same place and day → same key; another place or day → another key", () => {
  const key = sunRequestKey(MONTREAL, NOON);
  assert.equal(key, "45.5088,-73.5878@2026-11-19");
  assert.equal(sunRequestKey({ latitude: 45.50881, longitude: -73.58779 }, new Date(2026, 10, 19, 23, 0)), key);
  assert.notEqual(sunRequestKey(QUEBEC, NOON), key);
  assert.notEqual(sunRequestKey(MONTREAL, NEXT_DAY), key);
});

test("sunTimesUrl: the place, the LOCAL day, and tomorrow's times", () => {
  assert.equal(sunTimesUrl(MONTREAL, NOON), "/api/sunrise-sunset?lat=45.5088&lon=-73.5878&date=2026-11-19&tomorrow=1");
});

test("retry delays: 30 s, 2 min, 5 min, then none", () => {
  assert.deepEqual([...SUN_RETRY_DELAYS_MS], [30_000, 120_000, 300_000]);
  assert.deepEqual([0, 1, 2, 3, 4].map(sunRetryDelay), [30_000, 120_000, 300_000, null, null]);
});

test("a successful request stores today and tomorrow, and resolves with today", async () => {
  const h = harness();
  const done = h.fetcher.request(MONTREAL);
  assert.equal(h.gets[0].url, sunTimesUrl(MONTREAL, NOON));
  h.gets[0].resolve(answer());
  assert.equal(await done, TODAY);
  assert.deepEqual(h.sun, { key: sunRequestKey(MONTREAL, NOON), today: TODAY, tomorrow: TOMORROW });
  assert.equal(h.pending().length, 0);
});

test("tomorrow's times missing from the answer is not a failure", async () => {
  const h = harness();
  const done = h.fetcher.request(MONTREAL);
  h.gets[0].resolve({ data: { status: "OK", results: TODAY } });
  await done;
  assert.equal(h.sun.today, TODAY);
  assert.equal(h.sun.tomorrow, null);
  assert.equal(h.pending().length, 0);
});

test("a failed refresh for the same place and day keeps the values on screen", async () => {
  const h = harness();
  const first = h.fetcher.request(MONTREAL);
  h.gets[0].resolve(answer());
  await first;
  const held = h.sun;

  h.clock = new Date(2026, 10, 19, 13, 0, 0); // the hourly tick, same day
  const refresh = h.fetcher.request(MONTREAL);
  h.gets[1].reject(new Error("connect ETIMEDOUT"));
  await assert.rejects(refresh, /ETIMEDOUT/);
  assert.equal(h.sun, held, "the values are still right: they must stay");
  assert.deepEqual(h.pending().map((t) => t.ms), [30_000]);
});

test("a failure with nothing on screen leaves nothing, and is retried after 30 s", async () => {
  const h = harness();
  const boot = h.fetcher.request(MONTREAL);
  h.gets[0].reject(new Error("Request failed with status code 500"));
  await assert.rejects(boot);
  assert.equal(h.sun, NO_SUN_TIMES);
  assert.deepEqual(h.pending().map((t) => t.ms), [30_000]);
});

test("the retry asks again and, when it succeeds, fills the values and stops", async () => {
  const h = harness();
  swallow(h.fetcher.request(MONTREAL));
  h.gets[0].reject(new Error("boom"));
  await settle();

  h.fireRetry();
  assert.equal(h.gets.length, 2);
  assert.equal(h.gets[1].url, sunTimesUrl(MONTREAL, NOON));
  h.gets[1].resolve(answer());
  await settle();
  assert.equal(h.sun.today, TODAY);
  assert.equal(h.pending().length, 0);
});

test("three retries (30 s, 2 min, 5 min), then the series ends", async () => {
  const h = harness();
  swallow(h.fetcher.request(MONTREAL));
  const delays = [];
  for (let i = 0; i < 4; i += 1) {
    h.gets[i].reject(new Error("boom"));
    await settle();
    const pending = h.pending();
    if (pending.length === 0) break;
    delays.push(pending[0].ms);
    h.fireRetry();
  }
  assert.deepEqual(delays, [30_000, 120_000, 300_000]);
  assert.equal(h.gets.length, 4, "the first try and three retries");
  assert.equal(h.pending().length, 0, "after the third retry the hourly poller takes over");
});

test("a new request from the poller cancels the pending retry and starts a new series", async () => {
  const h = harness();
  swallow(h.fetcher.request(MONTREAL));
  h.gets[0].reject(new Error("boom"));
  await settle();
  h.fireRetry();
  h.gets[1].reject(new Error("boom"));
  await settle();
  assert.deepEqual(h.pending().map((t) => t.ms), [120_000]);

  swallow(h.fetcher.request(MONTREAL)); // the hourly tick
  assert.equal(h.pending().length, 0, "the 2 min retry is cancelled");
  h.gets[2].reject(new Error("boom"));
  await settle();
  assert.deepEqual(h.pending().map((t) => t.ms), [30_000], "back to the first delay");
});

test("a failure for ANOTHER place drops the old place's values", async () => {
  const h = harness();
  const first = h.fetcher.request(MONTREAL);
  h.gets[0].resolve(answer());
  await first;

  const moved = h.fetcher.request(QUEBEC);
  h.gets[1].reject(new Error("boom"));
  await assert.rejects(moved);
  assert.equal(h.sun, NO_SUN_TIMES, "Montreal's times would be wrong for Quebec");
  assert.deepEqual(h.pending().map((t) => t.ms), [30_000]);
});

test("a failure on ANOTHER day drops yesterday's values", async () => {
  const h = harness();
  const first = h.fetcher.request(MONTREAL);
  h.gets[0].resolve(answer());
  await first;

  h.clock = NEXT_DAY;
  const refresh = h.fetcher.request(MONTREAL);
  h.gets[1].reject(new Error("boom"));
  await assert.rejects(refresh);
  assert.equal(h.sun, NO_SUN_TIMES, "kept past the next sunrise, yesterday's times would read as night");
});

test("a retry that crosses midnight asks for the new day", async () => {
  const h = harness();
  swallow(h.fetcher.request(MONTREAL));
  h.gets[0].reject(new Error("boom"));
  await settle();
  h.clock = NEXT_DAY;
  h.fireRetry();
  assert.equal(h.gets[1].url, sunTimesUrl(MONTREAL, NEXT_DAY));
});

test("an answer without times is a failure: values kept or dropped by the same rule, retry armed", async () => {
  const h = harness();
  const first = h.fetcher.request(MONTREAL);
  h.gets[0].resolve(answer());
  await first;
  const held = h.sun;

  const refresh = h.fetcher.request(MONTREAL);
  h.gets[1].resolve({ data: { status: "INVALID_REQUEST" } });
  await assert.rejects(refresh, /No sun times/);
  assert.equal(h.sun, held);
  assert.deepEqual(h.pending().map((t) => t.ms), [30_000]);
});

test("a newer request owns the state: an older answer, good or bad, changes nothing", async () => {
  const h = harness();
  const montreal = h.fetcher.request(MONTREAL);
  const quebec = h.fetcher.request(QUEBEC);
  h.gets[1].resolve(answer());
  await quebec;
  const held = h.sun;
  assert.equal(held.key, sunRequestKey(QUEBEC, NOON));

  h.gets[0].resolve(answer({ sunrise: "old", sunset: "old" }));
  assert.equal(await montreal, null, "the superseded request resolves with null");
  assert.equal(h.sun, held);

  const h2 = harness();
  const stale = h2.fetcher.request(MONTREAL);
  const fresh = h2.fetcher.request(QUEBEC);
  h2.gets[1].resolve(answer());
  await fresh;
  h2.gets[0].reject(new Error("late failure"));
  await assert.rejects(stale);
  assert.equal(h2.sun.key, sunRequestKey(QUEBEC, NOON), "a late failure must not erase the newer values");
  assert.equal(h2.pending().length, 0, "nor arm a retry for the old place");
});

test("no coordinates: nothing on screen, no request, a rejection", async () => {
  const h = harness();
  const first = h.fetcher.request(MONTREAL);
  h.gets[0].resolve(answer());
  await first;
  await assert.rejects(h.fetcher.request(null), /No coords/);
  assert.equal(h.sun, NO_SUN_TIMES);
  assert.equal(h.gets.length, 1);
  assert.equal(h.pending().length, 0);
});

test("dispose: the pending retry is cancelled and a late answer changes nothing", async () => {
  const h = harness();
  swallow(h.fetcher.request(MONTREAL));
  h.gets[0].reject(new Error("boom"));
  await settle();
  assert.equal(h.pending().length, 1);
  h.fetcher.dispose();
  assert.equal(h.pending().length, 0);

  const h2 = harness();
  const late = h2.fetcher.request(MONTREAL);
  h2.fetcher.dispose();
  h2.gets[0].resolve(answer());
  assert.equal(await late, null);
  assert.equal(h2.sun, NO_SUN_TIMES);
});

test("the app goes through the fetcher: hook wired, poller's rejection handled, no second copy", () => {
  const hook = fs.readFileSync(path.join(SRC, "hooks", "useSunTimes.js"), "utf8");
  assert.match(hook, /createSunTimesFetcher\(\{ get: \(url\) => axios\.get\(url\), setSun \}\)/);
  assert.match(hook, /fetcher\.dispose\(\)/, "the retry timer must be cancelled on unmount");

  const ctx = fs.readFileSync(path.join(SRC, "AppContext.js"), "utf8");
  assert.match(ctx, /= useSunTimes\(\);/);
  assert.match(ctx, /updateSunriseSunset\(mapGeo\)\.catch\(\(\) => undefined\);/);
  assert.ok(!/\.get\([^)]*sunrise-sunset/.test(ctx), "AppContext must not ask for sun times on its own");
  assert.ok(!/setSunriseTime|setSunsetTime/.test(ctx), "the sun-times state lives in useSunTimes");
});
