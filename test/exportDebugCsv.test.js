// Regression tests for the Debug-panel CSV export
// (`client/src/ui/exportDebugCsv.js`, called from the About bucket of
// `client/src/components/ambient/DebugPanel/index.js`).
//
// Three bugs are locked down:
//   1. SERVICES → LAST CALL exported `new Date(null).toLocaleString()`
//      — the Unix epoch (1970-01-01, or 1969-12-31 west of UTC) — for
//      every pre-registered service not called yet. Same null trap
//      checked on every other date column the exporter formats.
//   2. CACHE split every key as `[type, lat, lon]`, but weather keys
//      have been `type:fieldsHash:lat:lon` since 2.14.6, so LAT got the
//      hash and LON the latitude. The parser is now shape-aware, and is
//      fed keys built by the REAL server key builders so a future key
//      change breaks here, not silently in a spreadsheet.
//   3. CLIENT KPIs always read "N/A" because the panel called
//      `exportDebugCsv(data, null, null)`. The client metrics collector
//      and the FPS sampler the panel now feeds the exporter are tested
//      here, plus a source guard on the panel's call.
//
// The module is CommonJS on purpose so this runner exercises the REAL
// code — no verbatim copy. Run: `npm test` or
// `node --test test/exportDebugCsv.test.js`.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildDebugCsv,
  buildDebugCsvRows,
  formatTimestamp,
  parseCacheKey,
  summarizeApiCalls,
  snapshotClientMetrics,
  fpsFromTimestamps,
  sampleFps,
} = require("../client/src/ui/exportDebugCsv");
const {
  getCacheKey,
  CURRENT_FIELDS_HASH,
  HOURLY_FIELDS_HASH,
  DAILY_FIELDS_HASH,
} = require("../server/proxyCtrl");
const { __test: { buildSummaryCacheKey } } = require("../server/aiSummaryCtrl");

const REPO_ROOT = path.join(__dirname, "..");
const DEBUG_PANEL_SRC = fs.readFileSync(
  path.join(REPO_ROOT, "client", "src", "components", "ambient", "DebugPanel", "index.js"),
  "utf8",
);

// Epoch rendered the way the old code did — the value a null timestamp
// must never produce.
const EPOCH_LOCALE = new Date(null).toLocaleString();

/**
 * Rows of one `=== TITLE ===` section (header row included), up to the
 * next blank separator row.
 *
 * @param {Array<Array<*>>} rows output of `buildDebugCsvRows`
 * @param {string} title section title without the `===` delimiters
 * @returns {Array<Array<*>>} the section's rows after its marker
 */
function sectionRows(rows, title) {
  const start = rows.findIndex((r) => r.length === 1 && r[0] === `=== ${title} ===`);
  assert.notEqual(start, -1, `section "${title}" not found`);
  const out = [];
  for (let i = start + 1; i < rows.length && rows[i].length > 0; i += 1) out.push(rows[i]);
  return out;
}

// ─── 1. Null timestamps never become the epoch ─────────────────────

test("formatTimestamp: unset or unparsable → empty cell, never the epoch", () => {
  for (const value of [null, undefined, "", "not a date"]) {
    assert.equal(formatTimestamp(value), "", `value ${JSON.stringify(value)}`);
  }
});

test("formatTimestamp: ISO strings and epoch ms → locale date-time", () => {
  const iso = "2026-10-09T14:30:00.000Z";
  assert.equal(formatTimestamp(iso), new Date(iso).toLocaleString());
  const ms = Date.parse(iso);
  assert.equal(formatTimestamp(ms), new Date(ms).toLocaleString());
});

test("SERVICES: a pre-registered, not-yet-called service exports an empty LAST CALL", () => {
  const iso = "2026-10-09T14:30:00.000Z";
  const rows = buildDebugCsvRows({
    services: {
      // Exactly what server/serviceStatus.js registerService() stores.
      "Homebridge": { status: null, lastCall: null, lastSuccess: null, consecutiveFailures: 0, comment: "Not yet called" },
      "Mapbox": { status: 200, lastCall: iso, lastSuccess: iso, consecutiveFailures: 0, comment: "OK" },
    },
  }, null, null);
  const section = sectionRows(rows, "SERVICES");
  assert.deepEqual(section[0], ["SERVICE", "STATUS", "LAST CALL", "COMMENT"]);
  const homebridge = section.find((r) => r[0] === "Homebridge");
  assert.equal(homebridge[2], "");
  assert.notEqual(homebridge[2], EPOCH_LOCALE);
  assert.equal(homebridge[3], "Not yet called");
  const mapbox = section.find((r) => r[0] === "Mapbox");
  assert.equal(mapbox[2], new Date(iso).toLocaleString());
});

test("other date columns: missing remote-client / radar-snapshot times export empty", () => {
  const rows = buildDebugCsvRows({
    remoteClients: [{ ip: "192.168.1.20", firstSeen: null, lastSeen: undefined, requestCount: 3 }],
    radarSnapshots: [{ ts: null, lat: 45.5, lon: -73.56, lang: "fr", source: "claude", radarText: "a\nb", summary: "s" }],
  }, null, null);
  const [, client] = sectionRows(rows, "REMOTE CLIENTS");
  assert.deepEqual(client, ["192.168.1.20", "", "", 3]);
  const [, snapshot] = sectionRows(rows, "RADAR SNAPSHOTS");
  assert.equal(snapshot[0], "");
  assert.equal(snapshot[1], "45.5000");
  assert.equal(snapshot[2], "-73.5600");
  assert.equal(snapshot[5], "a | b");
});

// ─── 2. Cache keys parsed per shape ────────────────────────────────

test("parseCacheKey: weather keys from the real proxyCtrl.getCacheKey", () => {
  for (const [type, hash] of [
    ["current", CURRENT_FIELDS_HASH],
    ["hourly", HOURLY_FIELDS_HASH],
    ["daily", DAILY_FIELDS_HASH],
  ]) {
    const key = getCacheKey(type, hash, 45.50169, -73.567253);
    assert.deepEqual(parseCacheKey(key), {
      type,
      variant: `fields ${hash}`,
      lat: "45.5017",
      lon: "-73.5673",
    }, key);
  }
});

test("parseCacheKey: AI-summary keys (debugCtrl's ai-summary: prefix + the real builder)", () => {
  // server/debugCtrl.js getDebugInfo serves summary keys as `ai-summary:${key}`.
  const key = `ai-summary:${buildSummaryCacheKey(45.50169, -73.567253, "fr", "morning", "c", "kmh", "km")}`;
  assert.deepEqual(parseCacheKey(key), {
    type: "ai-summary",
    variant: "fr/morning/c/kmh/km",
    lat: "45.50",
    lon: "-73.57",
  });
});

test("parseCacheKey: legacy 3-part and unknown shapes keep every segment", () => {
  assert.deepEqual(parseCacheKey("hourly:45.5017:-73.5673"),
    { type: "hourly", variant: "", lat: "45.5017", lon: "-73.5673" });
  assert.deepEqual(parseCacheKey("mystery"),
    { type: "mystery", variant: "", lat: "", lon: "" });
  assert.deepEqual(parseCacheKey("a:b:c:d:e"),
    { type: "a", variant: "b:c:d:e", lat: "", lon: "" });
  assert.deepEqual(parseCacheKey(undefined),
    { type: "", variant: "", lat: "", lon: "" });
});

test("CACHE section: LAT/LON hold the coordinates, the hash gets its own column", () => {
  const weatherKey = getCacheKey("current", CURRENT_FIELDS_HASH, 46.0458, -73.1168);
  const aiKey = `ai-summary:${buildSummaryCacheKey(46.0458, -73.1168, "en", "night", "f", "mph", "mi")}`;
  const rows = buildDebugCsvRows({
    cache: [
      { key: weatherKey, expiresIn: 812, expired: false },
      { key: aiKey, expiresIn: 0, expired: true },
    ],
  }, null, null);
  assert.deepEqual(sectionRows(rows, "CACHE"), [
    ["TYPE", "VARIANT", "LAT", "LON", "TTL (s)"],
    ["current", `fields ${CURRENT_FIELDS_HASH}`, "46.0458", "-73.1168", 812],
    ["ai-summary", "en/night/f/mph/mi", "46.05", "-73.12", "EXPIRED"],
  ]);
});

// ─── 3. Client KPIs ────────────────────────────────────────────────

test("CLIENT KPIs: real metrics and FPS are exported", () => {
  const clientMetrics = {
    pageLoad: 1834,
    heap: { used: 42, total: 64 },
    apiCalls: [{ endpoint: "/api/weather/current", count: 4, avgMs: 120, minMs: 80, maxMs: 200 }],
    screen: { width: 800, height: 480, dpr: 1 },
  };
  const rows = buildDebugCsvRows({}, clientMetrics, 58);
  assert.deepEqual(sectionRows(rows, "CLIENT KPIs"), [
    ["METRIC", "VALUE"],
    ["Page Load (ms)", 1834],
    ["FPS", 58],
    ["JS Heap Used (MB)", 42],
    ["JS Heap Total (MB)", 64],
    ["Screen (CSS px)", "800×480"],
    ["Device Pixel Ratio", 1],
  ]);
  assert.deepEqual(sectionRows(rows, "CLIENT API CALLS (SESSION)"), [
    ["ENDPOINT", "COUNT", "AVG (ms)", "MIN (ms)", "MAX (ms)"],
    ["/api/weather/current", 4, 120, 80, 200],
  ]);
});

test("CLIENT KPIs: null metrics still export (documented N/A fallback)", () => {
  const rows = buildDebugCsvRows({}, null, null);
  assert.deepEqual(sectionRows(rows, "CLIENT KPIs"), [
    ["METRIC", "VALUE"],
    ["Page Load (ms)", "N/A"],
    ["FPS", "N/A"],
  ]);
  assert.equal(rows.some((r) => r[0] === "=== CLIENT API CALLS (SESSION) ==="), false);
});

test("summarizeApiCalls: groups /api/ paths, collapses tiles, sorts by count", () => {
  const entries = [
    { name: "https://localhost:8443/api/weather/current?lat=1&lon=2", duration: 100.4 },
    { name: "https://localhost:8443/api/weather/current?lat=3&lon=4", duration: 300.6 },
    { name: "https://localhost:8443/api/tiles/dark-v11/7/37/45", duration: 10 },
    { name: "https://localhost:8443/api/tiles/dark-v11/7/38/45", duration: 20 },
    { name: "https://localhost:8443/api/tiles/dark-v11/8/75/91", duration: 30 },
    { name: "https://localhost:8443/main.js", duration: 999 },
    { name: "https://localhost:8443/settings", duration: 5 },
  ];
  assert.deepEqual(summarizeApiCalls(entries), [
    { endpoint: "/api/tiles/dark-v11/:z/:x/:y", count: 3, avgMs: 20, minMs: 10, maxMs: 30 },
    { endpoint: "/api/weather/current", count: 2, avgMs: 201, minMs: 100, maxMs: 301 },
  ]);
  assert.deepEqual(summarizeApiCalls([]), []);
  assert.deepEqual(summarizeApiCalls(undefined), []);
});

test("snapshotClientMetrics: reads page load, heap (MB), API calls and screen", () => {
  const MB = 1024 * 1024;
  const perf = {
    getEntriesByType: (type) => (type === "navigation"
      ? [{ loadEventEnd: 1834.6 }]
      : [{ name: "https://localhost:8443/api/geolocation", duration: 42 }]),
    memory: { usedJSHeapSize: 41.6 * MB, totalJSHeapSize: 64 * MB },
  };
  const win = { screen: { width: 1280, height: 800 }, devicePixelRatio: 2 };
  assert.deepEqual(snapshotClientMetrics(perf, win), {
    pageLoad: 1835,
    heap: { used: 42, total: 64 },
    apiCalls: [{ endpoint: "/api/geolocation", count: 1, avgMs: 42, minMs: 42, maxMs: 42 }],
    screen: { width: 1280, height: 800, dpr: 2 },
  });
});

test("snapshotClientMetrics: no navigation entry / no heap API / no DPR → null, null, 1", () => {
  const perf = { getEntriesByType: () => [] };
  const win = { screen: { width: 800, height: 480 } };
  assert.deepEqual(snapshotClientMetrics(perf, win), {
    pageLoad: null,
    heap: null,
    apiCalls: [],
    screen: { width: 800, height: 480, dpr: 1 },
  });
});

test("fpsFromTimestamps: frames over elapsed time; null when unmeasurable", () => {
  const sixtyFps = Array.from({ length: 61 }, (_, i) => i * (1000 / 60));
  assert.equal(fpsFromTimestamps(sixtyFps), 60);
  assert.equal(fpsFromTimestamps([0, 50, 100]), 20);
  assert.equal(fpsFromTimestamps([]), null);
  assert.equal(fpsFromTimestamps([16]), null);
  assert.equal(fpsFromTimestamps([16, 16]), null);
  assert.equal(fpsFromTimestamps(null), null);
});

/**
 * Fake rAF / timer rig: frames are fired by hand, the settle timer is
 * captured so the test decides when the window closes.
 *
 * @returns {object} `{ timers, fireFrame, closeWindow, cancelled, scheduledMs }`
 */
function fakeTimers() {
  let pending = null;
  let nextId = 1;
  let settle = null;
  const rig = {
    cancelled: [],
    scheduledMs: null,
    timers: {
      raf: (cb) => { pending = { id: nextId, cb }; nextId += 1; return pending.id; },
      caf: (id) => { rig.cancelled.push(id); pending = null; },
      setTimer: (cb, ms) => { settle = cb; rig.scheduledMs = ms; },
    },
    fireFrame: (ts) => { const p = pending; pending = null; if (p) p.cb(ts); },
    closeWindow: () => settle(),
  };
  return rig;
}

test("sampleFps: measures over the window, then cancels the rAF loop", async () => {
  const rig = fakeTimers();
  const result = sampleFps(1000, rig.timers);
  assert.equal(rig.scheduledMs, 1000);
  for (let i = 0; i <= 30; i += 1) rig.fireFrame(i * (1000 / 30));
  rig.closeWindow();
  assert.equal(await result, 30);
  assert.equal(rig.cancelled.length, 1, "the pending frame is cancelled");
  rig.fireFrame(5000); // nothing left to run — a late frame is ignored
});

test("sampleFps: no frames painted (hidden tab) → resolves null on the timer", async () => {
  const rig = fakeTimers();
  const result = sampleFps(1000, rig.timers);
  rig.closeWindow();
  assert.equal(await result, null);
});

test("DebugPanel feeds the exporter real client metrics (no more null, null)", () => {
  assert.doesNotMatch(DEBUG_PANEL_SRC, /exportDebugCsv\(\s*data\s*,\s*null/,
    "the About bucket must not pass null client metrics to the exporter");
  assert.match(DEBUG_PANEL_SRC, /exportDebugCsv\(\s*data\s*,\s*snapshotClientMetrics\(\)\s*,\s*fps\s*\)/,
    "the export must carry a click-time snapshotClientMetrics() and the sampled fps");
  // The Client bucket reads the same collector, so the CSV and the panel agree.
  assert.match(DEBUG_PANEL_SRC, /useState\(snapshotClientMetrics\)/);
});

// ─── Serialisation ─────────────────────────────────────────────────

test("buildDebugCsv: BOM + sep hint, every cell quoted, formula guard applied", () => {
  const csv = buildDebugCsv({ logs: ["=HYPERLINK(\"http://evil\")", "plain"] }, null, null);
  assert.ok(csv.startsWith("\uFEFFsep=,\r\n"));
  const lines = csv.slice("\uFEFFsep=,\r\n".length).split("\r\n");
  assert.ok(lines.includes("\"'=== LOGS ===\""), "section marker quoted (and '-guarded)");
  assert.ok(lines.includes("\"'=HYPERLINK(\"\"http://evil\"\")\""));
  assert.ok(lines.includes("\"plain\""));
  assert.ok(lines.includes(""), "blank separator rows survive");
});
