// What the Anthropic SDK really sends for the stored key.
//
// SDK 1.x puts the key in `Authorization: Bearer <key>`. A key pasted with a
// space or tab in front used to work (0.x sent it alone in `x-api-key`, and
// the HTTP layer strips whitespace at the ends of a header value), but inside
// `Bearer <key>` that whitespace stays. aiSummaryCtrl trims the key before it
// builds the client, and fails a whitespace-only key locally, as 0.x did
// (anthropicKeyForRequest).
//
// The end-to-end tests call the GET /api/weather-summary handler
// (getWeatherSummary, with a hand-built req / res: not the Express route or
// its rate limiter) with the real SDK, pointed by ANTHROPIC_BASE_URL at a
// local HTTP server that records each request and answers like the
// Messages API. No call leaves the machine:
// axios (Tomorrow.io, RainViewer) is stubbed to fail on any request, the
// request counter is stubbed, radar analysis and the calm-day fast path are
// off, and the current conditions come from a primed shared weather cache.
// The only file written is each run's throwaway settings.json, in the OS
// temp dir (removed afterwards). Run: `npm test` or
// `node --test test/aiSummaryAnthropicKey.test.js`.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

/**
 * Put a stub module in require.cache under a real module's resolved path.
 *
 * @param {string} request what the server code passes to require()
 * @param {Object} exports the stub's exports
 * @returns {void}
 */
function stubModule(request, exports) {
  const filename = require.resolve(request);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

const unexpectedNetwork = async (url) => {
  throw new Error(`unexpected network call in test: ${url}`);
};
stubModule("axios", { default: { get: unexpectedNetwork, post: unexpectedNetwork } });
stubModule("../server/requestCounter", { increment() {}, getCounters: () => ({}), flush() {} });

const { __test: { setSettingsPathForTest } } = require("../server/settingsCtrl");
const {
  getWeatherSummary,
  summaryCache,
  __test: { anthropicKeyForRequest },
} = require("../server/aiSummaryCtrl");
const { weatherCache, getCacheKey, CURRENT_FIELDS_HASH } = require("../server/proxyCtrl");
const { getServiceStatus } = require("../server/serviceStatus");

const LAT = "45.5017";
const LON = "-73.5673";
const REPLY_TEXT = "Cloudy and mild.";

// Every request the fake Messages API received: method, path, headers.
const received = [];
let fakeApi;
let savedBaseUrl;

before(async () => {
  fakeApi = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      received.push({ method: req.method, url: req.url, headers: req.headers, body });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: "claude-haiku-5-5",
        content: [{ type: "text", text: REPLY_TEXT }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 5 },
      }));
    });
  });
  await new Promise((resolve) => fakeApi.listen(0, "127.0.0.1", resolve));
  savedBaseUrl = process.env.ANTHROPIC_BASE_URL;
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${fakeApi.address().port}`;
});

after(async () => {
  if (savedBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL;
  else process.env.ANTHROPIC_BASE_URL = savedBaseUrl;
  // close() waits for a connection still serving a request (one a failed
  // test left mid-flight); closeAllConnections() drops it, so after() can't
  // hang.
  fakeApi.closeAllConnections();
  await new Promise((resolve) => fakeApi.close(resolve));
});

/**
 * Call the GET /api/weather-summary handler once with this stored
 * Anthropic key and return what it sent plus the request the fake API
 * received.
 *
 * @param {*} anthropicApiKey the value stored in settings.json
 * @returns {Promise<{status: number, body: *, request: Object|undefined}>}
 *   the handler's answer and the recorded upstream request
 */
async function runSummaryWithKey(anthropicApiKey) {
  // Cold caches, then one fresh "current conditions" entry, so the request
  // reaches the Claude call with no Tomorrow.io fetch. Restored afterwards.
  const warmWeather = { ...weatherCache };
  for (const key of Object.keys(weatherCache)) delete weatherCache[key];
  for (const key of Object.keys(summaryCache)) delete summaryCache[key];
  weatherCache[getCacheKey("current", CURRENT_FIELDS_HASH, Number(LAT), Number(LON))] = {
    data: {
      data: {
        timelines: [{
          intervals: [{
            startTime: new Date().toISOString(),
            values: {
              temperature: 8, humidity: 70, windSpeed: 4,
              precipitationProbability: 20, weatherCode: 1001, cloudCover: 95,
            },
          }],
        }],
      },
    },
    expiresAt: Date.now() + 60_000,
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-anthropic-key-"));
  const file = path.join(dir, "settings.json");
  fs.writeFileSync(file, JSON.stringify({
    anthropicApiKey,
    advanced: { ai: { radarAnalysisEnabled: false, calmDayFastPath: false } },
  }));
  const previous = setSettingsPathForTest(file);
  const already = received.length;
  try {
    const sent = { status: null, body: undefined };
    const res = new EventEmitter();
    res.status = (s) => { sent.status = s; return res; };
    res.json = (b) => { sent.body = b; return res; };
    res.end = () => res;
    const req = {
      query: { lat: LAT, lon: LON, lang: "en" },
      isLocal: true,
      socket: { remoteAddress: "127.0.0.1" },
    };
    await getWeatherSummary(req, res);
    assert.ok(received.length <= already + 1, "one summary request made more than one upstream call");
    return { ...sent, request: received[already] };
  } finally {
    setSettingsPathForTest(previous);
    fs.rmSync(dir, { recursive: true, force: true });
    for (const key of Object.keys(weatherCache)) delete weatherCache[key];
    Object.assign(weatherCache, warmWeather);
    for (const key of Object.keys(summaryCache)) delete summaryCache[key];
  }
}

// ── The helper ────────────────────────────────────────────────────────────

test("anthropicKeyForRequest trims a string key and leaves a non-string as is", () => {
  assert.equal(anthropicKeyForRequest("sk-ant-api03-abc"), "sk-ant-api03-abc");
  assert.equal(anthropicKeyForRequest(" sk-ant-api03-abc"), "sk-ant-api03-abc");
  assert.equal(anthropicKeyForRequest("\tsk-ant-api03-abc \r\n"), "sk-ant-api03-abc");
  for (const v of [true, 0, null, undefined]) {
    assert.equal(anthropicKeyForRequest(v), v);
  }
});

test("anthropicKeyForRequest throws on a whitespace-only key", () => {
  for (const blank of [" ", "   ", "\t", " \r\n"]) {
    assert.throws(() => anthropicKeyForRequest(blank), /blank/, JSON.stringify(blank));
  }
});

// ── What goes on the wire ─────────────────────────────────────────────────

test("a clean key reaches the API as `Bearer <key>` and the summary is served", async () => {
  const out = await runSummaryWithKey("sk-ant-test-key");
  assert.equal(out.status, 200);
  assert.equal(out.body.summary, REPLY_TEXT);
  assert.ok(out.request, "the fake Messages API received no request");
  assert.equal(out.request.method, "POST");
  assert.equal(out.request.url, "/v1/messages");
  assert.equal(out.request.headers.authorization, "Bearer sk-ant-test-key");
  assert.equal(out.request.headers["x-api-key"], undefined);
});

// Without the trim, the keys with leading whitespace would arrive padded
// (`Bearer  sk-…`, `Bearer \tsk-…`, `Bearer   sk-…`); trailing whitespace
// alone is already stripped by the HTTP layer.
test("a key pasted with surrounding whitespace is sent trimmed", async () => {
  for (const stored of [" sk-ant-test-key", "\tsk-ant-test-key", "  sk-ant-test-key \n", "sk-ant-test-key\r\n"]) {
    const out = await runSummaryWithKey(stored);
    assert.equal(out.status, 200, `stored key ${JSON.stringify(stored)}`);
    assert.equal(
      out.request?.headers.authorization,
      "Bearer sk-ant-test-key",
      `stored key ${JSON.stringify(stored)} was not sent as the bare key`,
    );
  }
});

test("the key is never sent in the request body", async () => {
  const out = await runSummaryWithKey(" sk-ant-test-key ");
  assert.ok(out.request);
  assert.equal(out.request.body.includes("sk-ant-test-key"), false);
});

test("a whitespace-only key fails locally: a 500, no request sent", async () => {
  for (const blank of ["   ", "\t"]) {
    const out = await runSummaryWithKey(blank);
    assert.equal(out.status, 500, `stored key ${JSON.stringify(blank)}`);
    assert.equal(out.request, undefined, `stored key ${JSON.stringify(blank)} reached the API`);
    const status = getServiceStatus()["Claude (AI summary)"];
    assert.equal(status.status, 500);
    assert.match(status.comment, /blank/);
  }
});
