// Debug-panel CSV export — the single owner of the CSV format, plus the
// client-side metrics its CLIENT sections carry (so the panel's Client
// bucket and the export read the browser through the same collector).
// Extracted out of the since-deleted `components/Debug` in 2026-06.
//
// MODULE FORMAT: CommonJS on purpose (like `ui/autoTabSelector.js` and
// `services/brightnessRestore.js`) so the `node --test` runner can
// `require()` the REAL module — test/exportDebugCsv.test.js and
// test/exportCsvQuote.test.js exercise the shipped code, no verbatim copy
// to drift. Webpack imports CJS into the ESM client fine, so DebugPanel can
// `import { exportDebugCsv } from "~/ui/exportDebugCsv"`. Keep the file free
// of `import` / `export` syntax so webpack keeps treating it as CommonJS.
// Browser globals (`document`, `performance`, `requestAnimationFrame`, …)
// are only touched inside functions, never at load time.

/**
 * Human-readable labels for the per-service quota counters, used by
 * the CSV export below.
 */
const SERVICE_LABELS = {
  "tomorrow.io":        "Tomorrow.io",
  "mapbox":             "Mapbox",
  "locationiq":         "LocationIQ",
  "ipapi.co":           "ipapi.co",
  "sunrise-sunset.org": "sunrise-sunset.org",
};

// Placeholder written for a KPI the export has no reading for.
const NOT_AVAILABLE = "N/A";

// Download name: `weather-station-debug-<YYYY-MM-DDTHH-MM-SS>.csv`.
const CSV_FILENAME_PREFIX = "weather-station-debug-";

// Cache-key shapes served by `/api/debug` (server/debugCtrl.js), split on `:`:
//   weather    `type:fieldsHash:lat:lon` (proxyCtrl.getCacheKey, since 2.14.6)
//   AI summary `ai-summary:lat:lon:lang:period:tempUnit:speedUnit:distanceUnit`
//              (aiSummaryCtrl's buildSummaryCacheKey, prefixed by debugCtrl)
//   legacy     `type:lat:lon` (pre-2.14.6 weather — dropped at load, kept
//              here only so an old snapshot still parses)
const AI_SUMMARY_KEY_TYPE = "ai-summary";
const AI_SUMMARY_KEY_PARTS = 8;
const WEATHER_KEY_PARTS = 4;
const LEGACY_WEATHER_KEY_PARTS = 3;

// Map-tile request paths end in `/z/x/y`; collapsing them keeps the
// client API-call roll-up to one row per tile style.
const TILE_PATH_RE = /\/[0-9]+\/[0-9]+\/[0-9]+$/;
const TILE_PATH_PLACEHOLDER = "/:z/:x/:y";

const BYTES_PER_MB = 1024 * 1024;
const MS_PER_SECOND = 1000;

/**
 * Quote one CSV cell. Two protections:
 *  1. `"` doubled per RFC 4180.
 *  2. Cells starting with a formula trigger get a leading `'` so
 *     spreadsheet apps render them as text instead of evaluating
 *     them (CSV formula injection, OWASP). `=`, `@`, tab and CR
 *     always trigger; `+`/`-` only when the cell is NOT a plain
 *     number, so negative coordinates (`-73.076935`) keep importing
 *     as numbers. Defence in depth: the one attacker-influenced
 *     column (remote-client IP) already shows the non-spoofable
 *     socket peer since #204, but every future field stays covered.
 *
 * @param {string|number|boolean|null|undefined} val cell value; `null` /
 *   `undefined` become an empty cell
 * @returns {string} the cell wrapped in double quotes, ready to join
 */
const q = (val) => {
  let s = String(val ?? "");
  if (/^[=@\t\r]/.test(s)
    || (/^[+-]/.test(s) && !/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s))) {
    s = `'${s}`;
  }
  return `"${s.replace(/"/g, '""')}"`;
};

/**
 * Compact "3d 4h 12m 5s" uptime formatter, used by the CSV export.
 *
 * @param {number} seconds uptime in seconds
 * @returns {string} human-compact duration
 */
function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0 || d > 0) parts.push(`${h}h`);
  parts.push(`${m}m ${s}s`);
  return parts.join(" ");
}

/**
 * Locale date-time cell for a timestamp the server may leave unset.
 * `new Date(null)` is the Unix epoch, so an unguarded `toLocaleString()`
 * turns "never" into 1970-01-01 (1969-12-31 west of UTC) — which is what
 * every pre-registered, not-yet-called service used to export.
 *
 * @param {string|number|null|undefined} value ISO-8601 string or epoch
 *   milliseconds
 * @returns {string} `new Date(value).toLocaleString()`, or `""` when the
 *   value is `null`, `undefined`, `""` or not a parsable date
 */
function formatTimestamp(value) {
  if (value == null || value === "") return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

/**
 * Split a `/api/debug` cache key into the CSV's CACHE columns, per key
 * shape (see the constants above). Lat/lon are NOT at a fixed position:
 * weather keys end with them, AI-summary keys carry them right after the
 * type — so the shape is recognised first.
 *
 * @param {string} key cache key as served by `/api/debug`
 * @returns {{type: string, variant: string, lat: string, lon: string}}
 *   `type` is the first segment (`current` / `hourly` / `daily` /
 *   `ai-summary`). `variant` names what else keys the entry: `fields
 *   <hash>` for a weather key (the word keeps an all-digit or `1e…` hash
 *   from importing as a number), `<lang>/<period>/<tempUnit>/<speedUnit>/
 *   <distanceUnit>` for an AI summary, `""` for a legacy key. `lat` /
 *   `lon` are the key's own strings (4 decimals for weather, 2 for an AI
 *   summary). An unrecognised shape keeps everything after the first
 *   segment in `variant` with empty `lat` / `lon` — nothing is dropped.
 */
function parseCacheKey(key) {
  const parts = String(key ?? "").split(":");
  const [type] = parts;
  if (type === AI_SUMMARY_KEY_TYPE && parts.length === AI_SUMMARY_KEY_PARTS) {
    const [, lat, lon, ...rest] = parts;
    return { type, variant: rest.join("/"), lat, lon };
  }
  if (parts.length === WEATHER_KEY_PARTS) {
    const [, fieldsHash, lat, lon] = parts;
    return { type, variant: `fields ${fieldsHash}`, lat, lon };
  }
  if (parts.length === LEGACY_WEATHER_KEY_PARTS) {
    const [, lat, lon] = parts;
    return { type, variant: "", lat, lon };
  }
  return { type, variant: parts.slice(1).join(":"), lat: "", lon: "" };
}

/**
 * Roll the browser's resource-timing entries up into one row per `/api/`
 * endpoint — the Client bucket's "API calls (session)" list and the CSV's
 * CLIENT API CALLS section.
 *
 * @param {Array<{name: string, duration: number}>} entries
 *   `performance.getEntriesByType("resource")`; `name` is the absolute URL
 * @returns {Array<{endpoint: string, count: number, avgMs: number,
 *   minMs: number, maxMs: number}>} one entry per `/api/…` path — tile
 *   requests collapsed to `/:z/:x/:y`, query strings stripped — with all
 *   durations rounded to whole milliseconds, sorted by descending call
 *   count; `[]` when no `/api/` request is in the buffer
 */
function summarizeApiCalls(entries) {
  const grouped = {};
  (Array.isArray(entries) ? entries : [])
    .filter((r) => typeof r?.name === "string" && r.name.includes("/api/"))
    .forEach((r) => {
      const { pathname } = new URL(r.name);
      const [key] = pathname.replace(TILE_PATH_RE, TILE_PATH_PLACEHOLDER).split("?");
      const ms = Math.round(r.duration);
      if (!grouped[key]) grouped[key] = { count: 0, totalMs: 0, minMs: Infinity, maxMs: 0 };
      grouped[key].count++;
      grouped[key].totalMs += ms;
      if (ms < grouped[key].minMs) grouped[key].minMs = ms;
      if (ms > grouped[key].maxMs) grouped[key].maxMs = ms;
    });
  return Object.entries(grouped)
    .map(([endpoint, s]) => ({
      endpoint,
      count: s.count,
      avgMs: Math.round(s.totalMs / s.count),
      minMs: s.minMs === Infinity ? 0 : s.minMs,
      maxMs: s.maxMs,
    }))
    .sort((a, b) => b.count - a.count);
}

/**
 * One snapshot of the client KPIs read from the Performance API — page
 * load, JS heap, the `/api/` call roll-up and the screen. Shared by the
 * Client bucket (`useClientMetrics`, taken when the bucket mounts) and the
 * CSV export (taken at click time, whether or not the Client bucket is
 * pinned), so the two can never disagree on what a KPI means. FPS is not
 * part of the snapshot — it needs frames over time (`sampleFps`).
 *
 * @param {Performance} [perf] the Performance API (defaults to the
 *   browser's `performance`; tests pass a stub)
 * @param {Window} [win] the window (defaults to the browser's `window`)
 * @returns {{pageLoad: number|null, heap: {used: number, total: number}|null,
 *   apiCalls: Array<{endpoint: string, count: number, avgMs: number, minMs: number, maxMs: number}>,
 *   screen: {width: number, height: number, dpr: number}}}
 *   `pageLoad` is `loadEventEnd` in milliseconds since navigation start,
 *   null when the browser exposes no navigation entry. `heap` is the
 *   used/total JS heap in **megabytes** (not bytes), null everywhere
 *   `performance.memory` is missing, i.e. outside Chromium. `apiCalls` is
 *   `summarizeApiCalls` over the resource-timing buffer. `screen` is the
 *   physical screen size in CSS pixels plus `devicePixelRatio` (1 when
 *   unavailable).
 */
function snapshotClientMetrics(perf = performance, win = window) {
  const [navEntry] = perf.getEntriesByType("navigation");
  const pageLoad = navEntry ? Math.round(navEntry.loadEventEnd) : null;
  const heap = perf.memory
    ? {
      used: Math.round(perf.memory.usedJSHeapSize / BYTES_PER_MB),
      total: Math.round(perf.memory.totalJSHeapSize / BYTES_PER_MB),
    }
    : null;
  const apiCalls = summarizeApiCalls(perf.getEntriesByType("resource"));
  const screen = {
    width: win.screen.width,
    height: win.screen.height,
    dpr: win.devicePixelRatio || 1,
  };
  return { pageLoad, heap, apiCalls, screen };
}

/**
 * Frames per second from a run of `requestAnimationFrame` timestamps.
 *
 * @param {number[]} timestamps rAF timestamps in milliseconds, oldest first
 * @returns {number|null} frames per second rounded to an integer, or null
 *   with fewer than two timestamps or no elapsed time (nothing to measure)
 */
function fpsFromTimestamps(timestamps) {
  if (!Array.isArray(timestamps) || timestamps.length < 2) return null;
  const elapsed = timestamps[timestamps.length - 1] - timestamps[0];
  return elapsed > 0
    ? Math.round(((timestamps.length - 1) * MS_PER_SECOND) / elapsed)
    : null;
}

/**
 * Measure the frame rate once, over `durationMs`, with a self-terminating
 * `requestAnimationFrame` loop — what the CSV export uses, so it carries a
 * real FPS reading even when the Client bucket (whose live meter runs only
 * while it is mounted) is not pinned. Settles on a timer rather than on a
 * frame count, so a hidden tab (no frames) still resolves.
 *
 * @param {number} durationMs sampling window in milliseconds
 * @param {object} [timers] scheduling primitives (tests inject fakes)
 * @param {(cb: (ts: number) => void) => number} [timers.raf]
 *   `requestAnimationFrame`
 * @param {(id: number) => void} [timers.caf] `cancelAnimationFrame`
 * @param {(cb: () => void, ms: number) => void} [timers.setTimer] `setTimeout`
 * @returns {Promise<number|null>} the FPS over the window
 *   (`fpsFromTimestamps`), null when fewer than two frames were painted
 */
function sampleFps(durationMs, timers = {}) {
  const {
    raf = (cb) => requestAnimationFrame(cb),
    caf = (id) => cancelAnimationFrame(id),
    setTimer = (cb, ms) => setTimeout(cb, ms),
  } = timers;
  return new Promise((resolve) => {
    const timestamps = [];
    let frameId = null;
    let done = false;
    const tick = (ts) => {
      if (done) return;
      timestamps.push(ts);
      frameId = raf(tick);
    };
    frameId = raf(tick);
    setTimer(() => {
      done = true;
      if (frameId != null) caf(frameId);
      resolve(fpsFromTimestamps(timestamps));
    }, durationMs);
  });
}

/**
 * Build the debug CSV as rows of raw (unquoted) cell values, section by
 * section — `toCsvText` applies `q()` to every cell exactly once.
 *
 * @param {object} data the `/api/debug` response payload
 * @param {object|null} clientMetrics `snapshotClientMetrics()` output
 *   (`{ pageLoad, heap, apiCalls, screen }`), or null — then Page Load
 *   reads "N/A" and the heap / screen rows and the CLIENT API CALLS
 *   section are left out
 * @param {number|null} fps a frame-rate reading (`sampleFps`), or null
 *   for "N/A"
 * @returns {Array<Array<string|number|null|undefined>>} the rows; `[]`
 *   is a blank separator row
 */
function buildDebugCsvRows(data, clientMetrics, fps) {
  const rows = [];

  const section = (title) => {
    rows.push([]);
    rows.push([`=== ${title} ===`]);
  };

  // Header
  rows.push(["Generated at", new Date().toLocaleString()]);
  if (data?.appVersion) {
    rows.push(["App version", `${data.appVersion.name} v${data.appVersion.version} · ${data.appVersion.commit}`]);
    if (data.appVersion.branch) {
      rows.push(["Branch", data.appVersion.branch]);
    }
  }
  if (data?.system) {
    rows.push(["Hardware", data.system.hardware]);
    rows.push(["OS",       data.system.os]);
  }
  if (data?.network) {
    const urls = data.network.urls?.length > 0
      ? data.network.urls.join(" | ")
      : `${data.network.protocol}://localhost:${data.network.port}`;
    rows.push(["Server URLs", urls]);
  }
  if (data?.connectivity) {
    const status = data.connectivity.online
      ? `Online${data.connectivity.latencyMs != null ? ` (${data.connectivity.latencyMs}ms)` : ""}`
      : "Offline";
    rows.push(["Internet", status]);
  }

  // Server KPIs
  section("SERVER KPIs");
  rows.push(["METRIC", "VALUE"]);
  if (data?.serverKpis) {
    const kpis = data.serverKpis;
    const { rate } = kpis.cache;
    rows.push(["Uptime",             formatUptime(kpis.uptimeSec)]);
    rows.push(["Heap Used (MB)",     kpis.memory.heapUsedMb]);
    rows.push(["Heap Total (MB)",    kpis.memory.heapTotalMb]);
    rows.push(["RSS (MB)",           kpis.memory.rssMb]);
    rows.push(["Cache Hit Rate (%)", rate !== null ? rate : NOT_AVAILABLE]);
    rows.push(["Cache Hits",         kpis.cache.hits]);
    rows.push(["Cache Misses",       kpis.cache.misses]);
    rows.push(["CPU Temp (°C)",      kpis.cpuTempC != null ? kpis.cpuTempC : NOT_AVAILABLE]);
    rows.push(["Fan Speed (RPM)",    kpis.fanRpm != null ? kpis.fanRpm : NOT_AVAILABLE]);
  } else {
    rows.push(["(no data)"]);
  }

  // Server Response Times
  if (data?.serverKpis?.responseTimes?.length > 0) {
    section("SERVER RESPONSE TIMES");
    rows.push(["ENDPOINT", "COUNT", "AVG (ms)", "MIN (ms)", "MAX (ms)"]);
    data.serverKpis.responseTimes.forEach((r) => {
      rows.push([r.endpoint, r.count, r.avgMs, r.minMs, r.maxMs]);
    });
  }

  // Client KPIs
  section("CLIENT KPIs");
  rows.push(["METRIC", "VALUE"]);
  rows.push(["Page Load (ms)", clientMetrics?.pageLoad ?? NOT_AVAILABLE]);
  rows.push(["FPS",            fps ?? NOT_AVAILABLE]);
  if (clientMetrics?.heap) {
    rows.push(["JS Heap Used (MB)",  clientMetrics.heap.used]);
    rows.push(["JS Heap Total (MB)", clientMetrics.heap.total]);
  }
  if (clientMetrics?.screen) {
    rows.push(["Screen (CSS px)",    `${clientMetrics.screen.width}×${clientMetrics.screen.height}`]);
    rows.push(["Device Pixel Ratio", clientMetrics.screen.dpr]);
  }

  // Client API Calls
  if (clientMetrics?.apiCalls?.length > 0) {
    section("CLIENT API CALLS (SESSION)");
    rows.push(["ENDPOINT", "COUNT", "AVG (ms)", "MIN (ms)", "MAX (ms)"]);
    clientMetrics.apiCalls.forEach((r) => {
      rows.push([r.endpoint, r.count, r.avgMs, r.minMs, r.maxMs]);
    });
  }

  // Provider Status
  if (data?.providerStatus?.providers?.length > 0) {
    section("PROVIDER STATUS");
    rows.push(["PROVIDER", "INDICATOR", "DESCRIPTION"]);
    data.providerStatus.providers.forEach(({ name, indicator, description }) => {
      rows.push([name, String(indicator ?? "").toUpperCase(), description]);
    });
  }

  // Services — LAST CALL is empty for a pre-registered service that has
  // not been called yet (its COMMENT reads "Not yet called").
  if (data?.services && Object.keys(data.services).length > 0) {
    section("SERVICES");
    rows.push(["SERVICE", "STATUS", "LAST CALL", "COMMENT"]);
    Object.entries(data.services).forEach(([name, info]) => {
      rows.push([name, info?.status, formatTimestamp(info?.lastCall), info?.comment]);
    });
  }

  // Quotas
  if (data?.counters && Object.keys(data.counters).length > 0) {
    Object.entries(data.counters).forEach(([service, info]) => {
      const quotas = info?.quotas || {};
      const endpoints = info?.endpoints || {};
      section(`QUOTAS — ${(SERVICE_LABELS[service] || service).toUpperCase()}`);
      const showHour  = quotas.hour  != null;
      const showDay   = true; // mirror the UI: always include today in the CSV
      const showMonth = quotas.month != null;
      const headers = ["ENDPOINT"];
      if (showHour)  headers.push("THIS HOUR");
      if (showDay)   headers.push("TODAY");
      if (showMonth) headers.push("THIS MONTH");
      rows.push(headers);
      Object.entries(endpoints).forEach(([ep, c]) => {
        const row = [ep];
        if (showHour)  row.push(c.hour);
        if (showDay)   row.push(c.day);
        if (showMonth) row.push(c.month);
        rows.push(row);
      });
    });
  }

  // Cache — one column per key segment, parsed per key shape.
  if (data?.cache?.length > 0) {
    section("CACHE");
    rows.push(["TYPE", "VARIANT", "LAT", "LON", "TTL (s)"]);
    data.cache.forEach((entry) => {
      const { type, variant, lat, lon } = parseCacheKey(entry.key);
      rows.push([type, variant, lat, lon, entry.expired ? "EXPIRED" : entry.expiresIn]);
    });
  }

  // Remote Clients
  if (data?.remoteClients?.length > 0) {
    section("REMOTE CLIENTS");
    rows.push(["IP ADDRESS", "FIRST SEEN", "LAST SEEN", "REQUESTS"]);
    data.remoteClients.forEach((c) => {
      rows.push([c.ip, formatTimestamp(c.firstSeen), formatTimestamp(c.lastSeen), c.requestCount]);
    });
  }

  // Security Events — `time` is exported as the server's raw ISO string.
  if (data?.securityEvents?.length > 0) {
    section("SECURITY EVENTS");
    rows.push(["METHOD", "URL", "IP", "TIME"]);
    data.securityEvents.forEach((e) => {
      rows.push([e.method, e.url, e.ip, e.time]);
    });
  }

  // Radar Snapshots — flatten radarText/summary onto single lines so each
  // snapshot fits one CSV row. Newlines in the source are joined with " | ".
  if (data?.radarSnapshots?.length > 0) {
    section("RADAR SNAPSHOTS");
    rows.push(["TIME", "LAT", "LON", "LANG", "SOURCE", "RADAR INPUT", "SUMMARY"]);
    data.radarSnapshots.forEach((s) => {
      const flat = (str) => (str || "").replace(/\r?\n/g, " | ");
      rows.push([
        formatTimestamp(s.ts),
        s.lat?.toFixed(4),
        s.lon?.toFixed(4),
        s.lang,
        s.source,
        flat(s.radarText),
        flat(s.summary),
      ]);
    });
  }

  // Logs
  if (data?.logs?.length > 0) {
    section("LOGS");
    rows.push(["LINE"]);
    data.logs.forEach((line) => rows.push([line]));
  }

  return rows;
}

/**
 * Serialise raw rows to the exported CSV text: every cell through `q()`,
 * CRLF line ends, behind a UTF-8 BOM and a `sep=,` hint so Excel
 * auto-detects both the encoding and the comma delimiter.
 *
 * @param {Array<Array<string|number|null|undefined>>} rows raw cell
 *   values (`buildDebugCsvRows`)
 * @returns {string} the CSV file contents
 */
function toCsvText(rows) {
  return "\uFEFF" + "sep=,\r\n" + rows.map((r) => r.map(q).join(",")).join("\r\n");
}

/**
 * Build the debug CSV text (`buildDebugCsvRows` + `toCsvText`) without
 * downloading it.
 *
 * @param {object} data the `/api/debug` response payload
 * @param {object|null} clientMetrics `snapshotClientMetrics()` output, or null
 * @param {number|null} fps a frame-rate reading (`sampleFps`), or null
 * @returns {string} the CSV file contents
 */
function buildDebugCsv(data, clientMetrics, fps) {
  return toCsvText(buildDebugCsvRows(data, clientMetrics, fps));
}

/**
 * Build and download the debug-panel CSV export.
 *
 * Serialises the `/api/debug` payload section by section, plus the
 * client-side KPIs, into `weather-station-debug-<timestamp>.csv` and
 * triggers a browser download. The DebugPanel About bucket passes
 * `snapshotClientMetrics()` taken at click time and a `sampleFps()`
 * reading; either may be null, in which case the corresponding client
 * rows read "N/A" or are omitted (see `buildDebugCsvRows`).
 *
 * @param {object} data the `/api/debug` response payload
 * @param {object|null} clientMetrics `snapshotClientMetrics()` output
 *   (`{ pageLoad, heap, apiCalls, screen }`), or null
 * @param {number|null} fps a frame-rate reading, or null
 * @returns {void}
 */
function exportDebugCsv(data, clientMetrics, fps) {
  const csv = buildDebugCsv(data, clientMetrics, fps);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${CSV_FILENAME_PREFIX}${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

module.exports = {
  exportDebugCsv,
  buildDebugCsv,
  buildDebugCsvRows,
  toCsvText,
  snapshotClientMetrics,
  sampleFps,
  // pure helpers (exported for the panel hook + tests)
  q,
  formatUptime,
  formatTimestamp,
  parseCacheKey,
  summarizeApiCalls,
  fpsFromTimestamps,
};
