// Tests for server/geolocationCtrl.js — the GET /geolocation handler.
// The stale-while-revalidate rule (2026-11): an expired cache is served at
// once and refreshed in the background; only a missing cache makes a request
// wait for ipapi.co. Seen on P9 on 2026-11-16: with an expired cache and
// ipapi.co answering 429, every page load waited ~15 s of retries.

const { test, after, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { getCoords, __test } = require("../server/geolocationCtrl");
const { getServiceStatus } = require("../server/serviceStatus");

const HOME = { latitude: 10.5, longitude: 20.25 };
const MOVED = { latitude: 11.75, longitude: 21.5 };
const DAY = 86_400_000;

const tmpDirs = [];
after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

// A refresh left running by one test must not call the next test's doubles.
afterEach(async () => {
  await __test.pendingRefresh();
});

function tmpCacheFile(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-test-"));
  tmpDirs.push(dir);
  const file = path.join(dir, "geolocation-cache.json");
  if (content !== undefined) fs.writeFileSync(file, JSON.stringify(content));
  return file;
}

function fakeRes() {
  const r = { statusCode: null, body: undefined, ended: false };
  r.status = (s) => { r.statusCode = s; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.end = () => { r.ended = true; return r; };
  return r;
}

function httpError(status) {
  return Object.assign(new Error(`Request failed with status code ${status}`), { code: "ERR_BAD_REQUEST", response: { status, data: {} } });
}

// A controllable clock and a fetch double that records its calls.
function setup({ cache, fetchImpl }) {
  delete getServiceStatus()["ipapi.co"]; // module-global: no state carried from another test
  let t = 1_800_000_000_000;
  const calls = [];
  const sleeps = [];
  const cacheFile = tmpCacheFile(cache && { ...cache, fetchedAtMs: t - cache.ageMs });
  __test.configure({
    cacheFile,
    now: () => t,
    sleep: async (ms) => { sleeps.push(ms); },
    fetchOnce: async () => { calls.push(t); return fetchImpl(calls.length); },
  });
  return { calls, sleeps, cacheFile, advance: (ms) => { t += ms; }, now: () => t };
}

test("geolocation: a fresh cache is served without calling ipapi.co", async () => {
  const s = setup({ cache: { ...HOME, ageMs: 2 * DAY }, fetchImpl: () => MOVED });
  const res = fakeRes();
  await getCoords({}, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, HOME);
  assert.equal(s.calls.length, 0);
  assert.equal(__test.pendingRefresh(), null);
});

test("geolocation: an expired cache is served at once, and refreshed in the background", async () => {
  const s = setup({ cache: { ...HOME, ageMs: 31 * DAY }, fetchImpl: () => MOVED });
  const res = fakeRes();
  await getCoords({}, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, HOME, "the request is answered from the expired cache, without waiting");
  const pending = __test.pendingRefresh();
  assert.ok(pending, "a background refresh was started");
  await pending;
  assert.equal(s.calls.length, 1);
  assert.deepEqual({ latitude: __test.cache().latitude, longitude: __test.cache().longitude }, MOVED);
  assert.deepEqual(JSON.parse(fs.readFileSync(s.cacheFile, "utf8")).latitude, MOVED.latitude, "the refreshed cache is written to disk");
  const res2 = fakeRes();
  await getCoords({}, res2);
  assert.deepEqual(res2.body, MOVED, "the next request gets the refreshed coordinates");
  assert.equal(s.calls.length, 1, "and calls nothing: the cache is fresh again");
});

test("geolocation: concurrent requests on an expired cache start ONE refresh", { timeout: 5_000 }, async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const s = setup({ cache: { ...HOME, ageMs: 40 * DAY }, fetchImpl: async () => { await gate; return MOVED; } });
  const results = [];
  for (let i = 0; i < 5; i++) {
    const res = fakeRes();
    await getCoords({}, res);
    results.push(res.body);
  }
  assert.ok(results.every((b) => b.latitude === HOME.latitude), "every request is answered from the expired cache");
  release();
  await __test.pendingRefresh();
  assert.equal(s.calls.length, 1, "one call to ipapi.co for five requests");
});

test("geolocation: a 429 during the refresh is not retried, and the next refresh waits an hour", async () => {
  const s = setup({ cache: { ...HOME, ageMs: 35 * DAY }, fetchImpl: () => { throw httpError(429); } });
  await getCoords({}, fakeRes());
  await __test.pendingRefresh();
  assert.equal(s.calls.length, 1, "a 429 is not retried");
  assert.equal(s.sleeps.length, 0, "and costs no back-off");
  // Within the cooldown: served from the cache, no new call.
  s.advance(__test.RATE_LIMIT_COOLDOWN_MS - 1000);
  const res = fakeRes();
  await getCoords({}, res);
  assert.deepEqual(res.body, HOME);
  assert.equal(__test.pendingRefresh(), null);
  assert.equal(s.calls.length, 1);
  // After it: one more try.
  s.advance(2000);
  await getCoords({}, fakeRes());
  await __test.pendingRefresh();
  assert.equal(s.calls.length, 2);
});

test("geolocation: a network error during the refresh is retried with back-off, then cooled down 15 min", async () => {
  const s = setup({ cache: { ...HOME, ageMs: 33 * DAY }, fetchImpl: () => { throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }); } });
  await getCoords({}, fakeRes());
  await __test.pendingRefresh();
  assert.equal(s.calls.length, 5, "five attempts");
  assert.deepEqual(s.sleeps, [1000, 2000, 4000, 8000]);
  s.advance(__test.REFRESH_COOLDOWN_MS - 1000);
  await getCoords({}, fakeRes());
  assert.equal(__test.pendingRefresh(), null, "no refresh within the cooldown");
  s.advance(2000);
  await getCoords({}, fakeRes());
  assert.ok(__test.pendingRefresh(), "a refresh after it");
  await __test.pendingRefresh();
});

test("geolocation: with no cache, the request waits for ipapi.co, and concurrent requests share one fetch", { timeout: 5_000 }, async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const s = setup({ cache: undefined, fetchImpl: async () => { await gate; return HOME; } });
  const a = fakeRes();
  const b = fakeRes();
  const pa = getCoords({}, a);
  const pb = getCoords({}, b);
  release();
  await Promise.all([pa, pb]);
  assert.deepEqual(a.body, HOME);
  assert.deepEqual(b.body, HOME);
  assert.equal(s.calls.length, 1, "one fetch for both requests");
  assert.ok(fs.existsSync(s.cacheFile), "the cache is written");
});

test("geolocation: with no cache, a 429 IS retried — there is nothing else to serve", async () => {
  // As on P9 on 2026-11-16: two 429s, then a 200 on the 3rd attempt.
  const s = setup({ cache: undefined, fetchImpl: (n) => { if (n <= 2) throw httpError(429); return HOME; } });
  const res = fakeRes();
  await getCoords({}, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, HOME);
  assert.equal(s.calls.length, 3);
  assert.deepEqual(s.sleeps, [1000, 2000]);
});

test("geolocation: with no cache and a lasting 429, the request fails (500) after the five attempts", async () => {
  const s = setup({ cache: undefined, fetchImpl: () => { throw httpError(429); } });
  const res = fakeRes();
  await getCoords({}, res);
  assert.equal(res.statusCode, 500);
  assert.equal(s.calls.length, 5);
  assert.deepEqual(s.sleeps, [1000, 2000, 4000, 8000]);
});

test("geolocation: with no cache, another 4xx fails at once, and the failure does not stick", async () => {
  const s = setup({ cache: undefined, fetchImpl: (n) => { if (n === 1) throw httpError(403); return HOME; } });
  const a = fakeRes();
  await getCoords({}, a);
  assert.equal(a.statusCode, 500);
  assert.equal(s.calls.length, 1, "a 403 is not retried");
  assert.equal(s.sleeps.length, 0);
  const b = fakeRes();
  await getCoords({}, b);
  assert.equal(b.statusCode, 200, "the next request fetches again");
  assert.deepEqual(b.body, HOME);
  assert.equal(s.calls.length, 2);
});

test("geolocation: with no cache, a 5xx then a success gets through on the retry", async () => {
  const s = setup({ cache: undefined, fetchImpl: (n) => { if (n === 1) throw httpError(503); return HOME; } });
  const res = fakeRes();
  await getCoords({}, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, HOME);
  assert.equal(s.calls.length, 2);
  assert.deepEqual(s.sleeps, [1000]);
});

test("geolocation: isRetryable — network errors, timeouts and 5xx yes; a 429 only when asked; other 4xx no", () => {
  assert.equal(__test.isRetryable(Object.assign(new Error("x"), { code: "ECONNRESET" })), true);
  assert.equal(__test.isRetryable(httpError(503)), true);
  assert.equal(__test.isRetryable(httpError(408)), true);
  assert.equal(__test.isRetryable(httpError(429)), false);
  assert.equal(__test.isRetryable(httpError(429), true), true);
  assert.equal(__test.isRetryable(httpError(403)), false);
  assert.equal(__test.isRetryable(httpError(403), true), false);
});

test("geolocation: the cooldowns are 15 min and 1 h", () => {
  assert.equal(__test.REFRESH_COOLDOWN_MS, 15 * 60_000);
  assert.equal(__test.RATE_LIMIT_COOLDOWN_MS, 60 * 60_000);
});

test("geolocation: the background refresh records its outcome for the Debug panel and /api/health", async () => {
  const s = setup({ cache: { ...HOME, ageMs: 31 * DAY }, fetchImpl: (n) => { if (n === 1) return MOVED; throw httpError(429); } });
  await getCoords({}, fakeRes());
  await __test.pendingRefresh();
  assert.equal(getServiceStatus()["ipapi.co"].status, 200);
  assert.equal(getServiceStatus()["ipapi.co"].comment, "OK (refreshed in the background)");
  assert.equal(getServiceStatus()["ipapi.co"].consecutiveFailures, 0);
  s.advance(31 * DAY);
  await getCoords({}, fakeRes());
  await __test.pendingRefresh();
  assert.equal(getServiceStatus()["ipapi.co"].status, 429);
  assert.equal(getServiceStatus()["ipapi.co"].consecutiveFailures, 1);
});

test("geolocation: an odd error body during the refresh is recorded, not thrown (the chain is not awaited)", async () => {
  const odd = Object.assign(new Error("odd"), { code: "E_ODD_BODY", response: { status: 429, data: { reason: { toString: 1 } } } });
  const s = setup({ cache: { ...HOME, ageMs: 40 * DAY }, fetchImpl: () => { throw odd; } });
  const res = fakeRes();
  await getCoords({}, res);
  assert.deepEqual(res.body, HOME);
  await __test.pendingRefresh();
  assert.equal(getServiceStatus()["ipapi.co"].status, 429);
  assert.equal(getServiceStatus()["ipapi.co"].comment, "E_ODD_BODY");
  // The 1 h cooldown was set: no new refresh right away.
  await getCoords({}, fakeRes());
  assert.equal(__test.pendingRefresh(), null);
  assert.equal(s.calls.length, 1);
});

test("geolocation: a clock stepped back after a failed refresh caps the cooldown at 1 h, without dropping it", async () => {
  const s = setup({ cache: { ...HOME, ageMs: 40 * DAY }, fetchImpl: () => { throw httpError(429); } });
  await getCoords({}, fakeRes());
  await __test.pendingRefresh();
  assert.equal(s.calls.length, 1);
  s.advance(-2 * DAY);
  await getCoords({}, fakeRes());
  assert.equal(__test.pendingRefresh(), null, "still cooling down right after the step");
  s.advance(__test.RATE_LIMIT_COOLDOWN_MS + 1000);
  await getCoords({}, fakeRes());
  assert.ok(__test.pendingRefresh(), "a refresh an hour later, not two days later");
  await __test.pendingRefresh();
  assert.equal(s.calls.length, 2);
});

test("geolocation: a small clock step back does not drop the 1 h cooldown after a 429", async () => {
  const s = setup({ cache: { ...HOME, ageMs: 40 * DAY }, fetchImpl: () => { throw httpError(429); } });
  await getCoords({}, fakeRes());
  await __test.pendingRefresh();
  s.advance(500);
  s.advance(-1000);
  await getCoords({}, fakeRes());
  assert.equal(__test.pendingRefresh(), null);
  assert.equal(s.calls.length, 1);
});

test("geolocation: the real fetcher rejects a 200 without coordinates, and sets its timeout", async () => {
  const axios = require("axios").default;
  const realGet = axios.get;
  const seen = [];
  axios.get = async (url, opts) => { seen.push({ url, opts }); return { status: 200, data: { error: true, reason: "RateLimited" } }; };
  try {
    const cacheFile = tmpCacheFile();
    __test.configure({ cacheFile, sleep: async () => {} });
    const res = fakeRes();
    await getCoords({}, res);
    assert.equal(res.statusCode, 500);
    assert.equal(fs.existsSync(cacheFile), false, "nothing is cached");
    assert.equal(seen[0].url, "https://ipapi.co/json/");
    assert.equal(seen[0].opts.timeout, 10_000);
  } finally {
    axios.get = realGet;
    __test.configure({});
  }
});

test("geolocation: a corrupt cache file is ignored", async () => {
  const cacheFile = tmpCacheFile();
  fs.writeFileSync(cacheFile, "{not json");
  const calls = [];
  __test.configure({ cacheFile, now: () => 1, sleep: async () => {}, fetchOnce: async () => { calls.push(1); return HOME; } });
  const res = fakeRes();
  await getCoords({}, res);
  assert.deepEqual(res.body, HOME);
  assert.equal(calls.length, 1);
  __test.configure({});
});

test("geolocation: a cache file without fetchedAtMs is ignored", async () => {
  const cacheFile = tmpCacheFile(HOME);
  const calls = [];
  __test.configure({ cacheFile, now: () => 1, sleep: async () => {}, fetchOnce: async () => { calls.push(1); return MOVED; } });
  const res = fakeRes();
  await getCoords({}, res);
  assert.deepEqual(res.body, MOVED);
  assert.equal(calls.length, 1);
  __test.configure({});
});
