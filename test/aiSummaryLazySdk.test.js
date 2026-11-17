// The Anthropic SDK is loaded by the first Claude call, not at server start.
//
// Required at start-up, SDK 1.6.0 made the server listen ~160 ms later with
// ~17 MB more RSS (Mac, Node 22), and a kiosk laid out by LayoutPi asks for
// a summary only when its AI view opens, so aiSummaryCtrl requires the SDK
// inside the billed path (loadAnthropicSdk). These tests pin that: requiring
// the controller, a request stopped by the no-key gate, a calm-day summary
// and a summary-cache hit all leave the SDK unloaded; a billed call loads
// it; and no server file requires it anywhere else.
//
// node --test runs each test file in its own process, so require.cache here
// starts without the SDK. The billed call goes to a local HTTP server that
// answers like the Messages API (ANTHROPIC_BASE_URL); axios and the request
// counter are stubbed, so nothing leaves the machine. The only file written
// is each run's throwaway settings.json, in the OS temp dir (removed
// afterwards). The tests run in order, the billed call after the ones that
// must not load the SDK. Run: `npm test` or
// `node --test test/aiSummaryLazySdk.test.js`.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const SERVER_DIR = path.join(__dirname, "..", "server");
const SDK_ENTRY = require.resolve("@anthropic-ai/sdk");
const SDK_DIR = path.dirname(require.resolve("@anthropic-ai/sdk"));

/**
 * Whether any file of the Anthropic SDK package is in require.cache.
 *
 * @returns {boolean} true once the SDK has been required
 */
const sdkLoaded = () => Object.keys(require.cache).some((file) => file.startsWith(SDK_DIR + path.sep));

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

assert.equal(sdkLoaded(), false, "the SDK was already loaded before the controller");
const { __test: { setSettingsPathForTest } } = require("../server/settingsCtrl");
const {
  getWeatherSummary,
  summaryCache,
  __test: { loadAnthropicSdk },
} = require("../server/aiSummaryCtrl");
const { weatherCache, getCacheKey, CURRENT_FIELDS_HASH, DAILY_FIELDS_HASH } = require("../server/proxyCtrl");
const loadedByRequire = sdkLoaded();

const LAT = "45.5017";
const LON = "-73.5673";

let fakeApi;
let fakeApiRequests = 0;
let savedBaseUrl;

before(async () => {
  fakeApi = http.createServer((req, res) => {
    fakeApiRequests += 1;
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: "claude-haiku-5-5",
        content: [{ type: "text", text: "Cloudy and mild." }],
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

// Cloudy, 20 % chance of rain: not calm, so a keyed request goes to Claude.
const UNSETTLED_NOW = {
  temperature: 8, humidity: 70, windSpeed: 4,
  precipitationProbability: 20, weatherCode: 1001, cloudCover: 95,
};
// Clear, dry now and tomorrow: with the fast path on, answered by template.
const CALM_NOW = {
  temperature: 12, humidity: 50, windSpeed: 2,
  precipitationProbability: 0, weatherCode: 1000, cloudCover: 5,
};
const CALM_TOMORROW = { temperature: 14, windSpeed: 3, precipitationProbability: 0 };

/**
 * Tomorrow.io-shaped timeline holding these interval values.
 *
 * @param {Object[]} intervals one `values` object per interval
 * @returns {Object} the payload the shared weather cache stores
 */
const timeline = (intervals) => ({
  data: {
    timelines: [{
      intervals: intervals.map((values) => ({ startTime: new Date().toISOString(), values })),
    }],
  },
});

/**
 * Call the GET /api/weather-summary handler (getWeatherSummary, not the
 * Express route) once against a temp settings.json, with
 * fresh "current conditions" (and, for a calm day, tomorrow's daily
 * forecast) in the shared weather cache, so no request needs Tomorrow.io.
 * Radar analysis is off; the calm-day fast path is off unless the settings
 * turn it on. No `localHour` is sent, so the period is the night and the
 * forecast paragraph reads tomorrow from the daily cache. The weather cache
 * is restored afterwards; the summary cache is emptied before and after,
 * unless `keepSummaryCache` is set.
 *
 * @param {Object} settings settings.json content (merged over those defaults)
 * @param {Object} [opts]
 * @param {boolean} [opts.calm] prime a calm day instead of an unsettled one
 * @param {boolean} [opts.keepSummaryCache] keep the summary cache as it is
 * @returns {Promise<{status: number, body: *}>} what the handler sent
 */
async function runSummary(settings, { calm = false, keepSummaryCache = false } = {}) {
  const warmWeather = { ...weatherCache };
  for (const key of Object.keys(weatherCache)) delete weatherCache[key];
  if (!keepSummaryCache) for (const key of Object.keys(summaryCache)) delete summaryCache[key];
  const expiresAt = Date.now() + 60_000;
  weatherCache[getCacheKey("current", CURRENT_FIELDS_HASH, Number(LAT), Number(LON))] = {
    data: timeline([calm ? CALM_NOW : UNSETTLED_NOW]),
    expiresAt,
  };
  if (calm) {
    weatherCache[getCacheKey("daily", DAILY_FIELDS_HASH, Number(LAT), Number(LON))] = {
      data: timeline([CALM_TOMORROW, CALM_TOMORROW]),
      expiresAt,
    };
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-lazy-sdk-"));
  const file = path.join(dir, "settings.json");
  fs.writeFileSync(file, JSON.stringify({
    ...settings,
    advanced: { ai: { radarAnalysisEnabled: false, calmDayFastPath: false, ...settings.advanced?.ai } },
  }));
  const previous = setSettingsPathForTest(file);
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
    return sent;
  } finally {
    setSettingsPathForTest(previous);
    fs.rmSync(dir, { recursive: true, force: true });
    for (const key of Object.keys(weatherCache)) delete weatherCache[key];
    Object.assign(weatherCache, warmWeather);
    if (!keepSummaryCache) for (const key of Object.keys(summaryCache)) delete summaryCache[key];
  }
}

test("requiring the controller does not load the SDK", () => {
  assert.equal(loadedByRequire, false);
});

test("a request stopped by the no-key gate does not load the SDK", async () => {
  for (const anthropicApiKey of [undefined, "", "key"]) {
    const sent = await runSummary(anthropicApiKey === undefined ? {} : { anthropicApiKey });
    assert.equal(sent.status, 503, `anthropicApiKey=${JSON.stringify(anthropicApiKey)}`);
  }
  assert.equal(sdkLoaded(), false);
  assert.equal(fakeApiRequests, 0);
});

test("a calm-day summary (fast path) and a summary-cache hit do not load the SDK", async () => {
  const keyed = { anthropicApiKey: "sk-ant-test-key" };
  const calm = await runSummary({ ...keyed, advanced: { ai: { calmDayFastPath: true } } }, { calm: true, keepSummaryCache: true });
  assert.equal(calm.status, 200);
  assert.equal(typeof calm.body.summary, "string");
  assert.ok(Object.keys(summaryCache).length > 0, "the calm-day summary was not cached");
  // Same request with the fast path off: only the summary cache answers.
  const hit = await runSummary(keyed, { keepSummaryCache: true });
  assert.equal(hit.status, 200);
  assert.equal(hit.body.summary, calm.body.summary);
  for (const key of Object.keys(summaryCache)) delete summaryCache[key];
  assert.equal(fakeApiRequests, 0);
  assert.equal(sdkLoaded(), false);
});

test("the first billed call loads the SDK and is served", async () => {
  const sent = await runSummary({ anthropicApiKey: "sk-ant-test-key" });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.summary, "Cloudy and mild.");
  assert.equal(fakeApiRequests, 1);
  assert.equal(sdkLoaded(), true);
});

test("loadAnthropicSdk returns the SDK module itself, the same object every time", () => {
  const sdk = loadAnthropicSdk();
  assert.equal(sdk, require(SDK_ENTRY));
  assert.equal(loadAnthropicSdk(), sdk);
  assert.equal(typeof sdk, "function", "the module export is the client constructor");
});

test("no server file requires the SDK outside loadAnthropicSdk", () => {
  const sites = [];
  /**
   * Collect every require of the SDK under a directory, recursively.
   *
   * @param {string} dir directory to scan
   * @returns {void}
   */
  const scan = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) scan(file);
      else if (entry.name.endsWith(".js")) {
        const src = fs.readFileSync(file, "utf8");
        for (const m of src.matchAll(/require\(\s*["']@anthropic-ai\/sdk[^"']*["']\s*\)/g)) {
          sites.push({ file: path.relative(SERVER_DIR, file), index: m.index, src });
        }
      }
    }
  };
  scan(SERVER_DIR);
  assert.equal(sites.length, 1, `expected one require of the SDK, found: ${sites.map((s) => s.file).join(", ")}`);
  const [site] = sites;
  assert.equal(site.file, "aiSummaryCtrl.js");
  const fnStart = site.src.indexOf("function loadAnthropicSdk() {");
  assert.ok(fnStart >= 0, "loadAnthropicSdk not found in aiSummaryCtrl.js");
  const fnEnd = site.src.indexOf("\n}", fnStart);
  assert.ok(site.index > fnStart && site.index < fnEnd, "the SDK require is not inside loadAnthropicSdk");
});
