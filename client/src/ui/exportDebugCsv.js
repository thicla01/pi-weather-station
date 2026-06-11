/**
 * Human-readable labels for the per-service quota counters, shared by
 * the CSV export below and the v2 Debug page's quota section.
 */
export const SERVICE_LABELS = {
  "tomorrow.io":        "Tomorrow.io",
  "mapbox":             "Mapbox",
  "locationiq":         "LocationIQ",
  "ipapi.co":           "ipapi.co",
  "sunrise-sunset.org": "sunrise-sunset.org",
};

/**
 * Compact "3d 4h 12m 5s" uptime formatter, shared by the CSV export and
 * the v2 Debug page's KPI row.
 *
 * @param {number} seconds uptime in seconds
 * @returns {string} human-compact duration
 */
export function formatUptime(seconds) {
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
 * Build and download the debug-panel CSV export.
 *
 * Shared by BOTH debug surfaces — the legacy v2 `Debug` page and the v3
 * ambient `DebugPanel` — so the CSV format has a single owner. Extracted
 * out of `components/Debug` (2026-06, v3→v2 boundary cleanup) so the v3
 * panel no longer imports from the legacy tree queued for removal.
 *
 * Self-contained: serialises the `/api/debug` payload section by section
 * into `weather-station-debug-<timestamp>.csv` and triggers a browser
 * download. `clientMetrics` and `fps` are v2-only extras — the v3 caller
 * passes null for both and the corresponding rows are simply omitted.
 *
 * @param {object} data the `/api/debug` response payload
 * @param {object|null} clientMetrics optional client-side metrics (v2 Debug page)
 * @param {number|null} fps optional FPS reading (v2 Debug page)
 * @returns {void}
 */
export function exportDebugCsv(data, clientMetrics, fps) {
  // Quote a CSV cell. Two protections:
  //  1. `"` doubled per RFC 4180.
  //  2. Cells starting with a formula trigger get a leading `'` so
  //     spreadsheet apps render them as text instead of evaluating
  //     them (CSV formula injection, OWASP). `=`, `@`, tab and CR
  //     always trigger; `+`/`-` only when the cell is NOT a plain
  //     number, so negative coordinates (`-73.076935`) keep importing
  //     as numbers. Defence in depth: the one attacker-influenced
  //     column (remote-client IP) already shows the non-spoofable
  //     socket peer since #204, but every future field stays covered.
  const q = (val) => {
    let s = String(val ?? "");
    if (/^[=@\t\r]/.test(s)
      || (/^[+-]/.test(s) && !/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s))) {
      s = `'${s}`;
    }
    return `"${s.replace(/"/g, '""')}"`;
  };
  const rows = [];

  const section = (title) => {
    rows.push([]);
    rows.push([q(`=== ${title} ===`)]);
  };

  // Header
  rows.push([q("Generated at"), q(new Date().toLocaleString())]);
  if (data?.appVersion) {
    rows.push([q("App version"), q(`${data.appVersion.name} v${data.appVersion.version} · ${data.appVersion.commit}`)]);
    if (data.appVersion.branch) {
      rows.push([q("Branch"), q(data.appVersion.branch)]);
    }
  }
  if (data?.system) {
    rows.push([q("Hardware"), q(data.system.hardware)]);
    rows.push([q("OS"),       q(data.system.os)]);
  }
  if (data?.network) {
    const urls = data.network.urls?.length > 0
      ? data.network.urls.join(" | ")
      : `${data.network.protocol}://localhost:${data.network.port}`;
    rows.push([q("Server URLs"), q(urls)]);
  }
  if (data?.connectivity) {
    const status = data.connectivity.online
      ? `Online${data.connectivity.latencyMs != null ? ` (${data.connectivity.latencyMs}ms)` : ""}`
      : "Offline";
    rows.push([q("Internet"), q(status)]);
  }

  // Server KPIs
  section("SERVER KPIs");
  rows.push([q("METRIC"), q("VALUE")]);
  if (data?.serverKpis) {
    const kpis = data.serverKpis;
    const { rate } = kpis.cache;
    rows.push([q("Uptime"),             q(formatUptime(kpis.uptimeSec))]);
    rows.push([q("Heap Used (MB)"),     q(kpis.memory.heapUsedMb)]);
    rows.push([q("Heap Total (MB)"),    q(kpis.memory.heapTotalMb)]);
    rows.push([q("RSS (MB)"),           q(kpis.memory.rssMb)]);
    rows.push([q("Cache Hit Rate (%)"), q(rate !== null ? rate : "N/A")]);
    rows.push([q("Cache Hits"),         q(kpis.cache.hits)]);
    rows.push([q("Cache Misses"),       q(kpis.cache.misses)]);
    rows.push([q("CPU Temp (°C)"),      q(kpis.cpuTempC != null ? kpis.cpuTempC : "N/A")]);
    rows.push([q("Fan Speed (RPM)"),    q(kpis.fanRpm != null ? kpis.fanRpm : "N/A")]);
  } else {
    rows.push([q("(no data)")]);
  }

  // Server Response Times
  if (data?.serverKpis?.responseTimes?.length > 0) {
    section("SERVER RESPONSE TIMES");
    rows.push([q("ENDPOINT"), q("COUNT"), q("AVG (ms)"), q("MIN (ms)"), q("MAX (ms)")]);
    data.serverKpis.responseTimes.forEach((r) => {
      rows.push([q(r.endpoint), q(r.count), q(r.avgMs), q(r.minMs), q(r.maxMs)]);
    });
  }

  // Client KPIs
  section("CLIENT KPIs");
  rows.push([q("METRIC"), q("VALUE")]);
  rows.push([q("Page Load (ms)"), q(clientMetrics?.pageLoad ?? "N/A")]);
  rows.push([q("FPS"),            q(fps ?? "N/A")]);
  if (clientMetrics?.heap) {
    rows.push([q("JS Heap Used (MB)"),  q(clientMetrics.heap.used)]);
    rows.push([q("JS Heap Total (MB)"), q(clientMetrics.heap.total)]);
  }

  // Client API Calls
  if (clientMetrics?.apiCalls?.length > 0) {
    section("CLIENT API CALLS (SESSION)");
    rows.push([q("ENDPOINT"), q("COUNT"), q("AVG (ms)"), q("MIN (ms)"), q("MAX (ms)")]);
    clientMetrics.apiCalls.forEach((r) => {
      rows.push([q(r.endpoint), q(r.count), q(r.avgMs), q(r.minMs), q(r.maxMs)]);
    });
  }

  // Provider Status
  if (data?.providerStatus?.providers?.length > 0) {
    section("PROVIDER STATUS");
    rows.push([q("PROVIDER"), q("INDICATOR"), q("DESCRIPTION")]);
    data.providerStatus.providers.forEach(({ name, indicator, description }) => {
      rows.push([q(name), q(indicator.toUpperCase()), q(description)]);
    });
  }

  // Services
  if (data?.services && Object.keys(data.services).length > 0) {
    section("SERVICES");
    rows.push([q("SERVICE"), q("STATUS"), q("LAST CALL"), q("COMMENT")]);
    Object.entries(data.services).forEach(([name, info]) => {
      rows.push([q(name), q(info.status), q(new Date(info.lastCall).toLocaleString()), q(info.comment)]);
    });
  }

  // Quotas
  if (data?.counters && Object.keys(data.counters).length > 0) {
    Object.entries(data.counters).forEach(([service, { quotas, endpoints }]) => {
      section(`QUOTAS — ${(SERVICE_LABELS[service] || service).toUpperCase()}`);
      const showHour  = quotas.hour  != null;
      const showDay   = true; // mirror the UI: always include today in the CSV
      const showMonth = quotas.month != null;
      const headers = [q("ENDPOINT")];
      if (showHour)  headers.push(q("THIS HOUR"));
      if (showDay)   headers.push(q("TODAY"));
      if (showMonth) headers.push(q("THIS MONTH"));
      rows.push(headers);
      Object.entries(endpoints).forEach(([ep, c]) => {
        const row = [q(ep)];
        if (showHour)  row.push(q(c.hour));
        if (showDay)   row.push(q(c.day));
        if (showMonth) row.push(q(c.month));
        rows.push(row);
      });
    });
  }

  // Cache
  if (data?.cache?.length > 0) {
    section("CACHE");
    rows.push([q("TYPE"), q("LAT"), q("LON"), q("TTL (s)")]);
    data.cache.forEach((entry) => {
      const [type, lat, lon] = entry.key.split(":");
      rows.push([q(type), q(lat), q(lon), q(entry.expired ? "EXPIRED" : entry.expiresIn)]);
    });
  }

  // Remote Clients
  if (data?.remoteClients?.length > 0) {
    section("REMOTE CLIENTS");
    rows.push([q("IP ADDRESS"), q("FIRST SEEN"), q("LAST SEEN"), q("REQUESTS")]);
    data.remoteClients.forEach((c) => {
      rows.push([q(c.ip), q(new Date(c.firstSeen).toLocaleString()), q(new Date(c.lastSeen).toLocaleString()), q(c.requestCount)]);
    });
  }

  // Security Events
  if (data?.securityEvents?.length > 0) {
    section("SECURITY EVENTS");
    rows.push([q("METHOD"), q("URL"), q("IP"), q("TIME")]);
    data.securityEvents.forEach((e) => {
      rows.push([q(e.method), q(e.url), q(e.ip), q(e.time)]);
    });
  }

  // Radar Snapshots — flatten radarText/summary onto single lines so each
  // snapshot fits one CSV row. Newlines in the source are joined with " | ".
  if (data?.radarSnapshots?.length > 0) {
    section("RADAR SNAPSHOTS");
    rows.push([q("TIME"), q("LAT"), q("LON"), q("LANG"), q("SOURCE"), q("RADAR INPUT"), q("SUMMARY")]);
    data.radarSnapshots.forEach((s) => {
      const flat = (str) => (str || "").replace(/\r?\n/g, " | ");
      rows.push([
        q(new Date(s.ts).toLocaleString()),
        q(s.lat?.toFixed(4)),
        q(s.lon?.toFixed(4)),
        q(s.lang),
        q(s.source),
        q(flat(s.radarText)),
        q(flat(s.summary)),
      ]);
    });
  }

  // Logs
  if (data?.logs?.length > 0) {
    section("LOGS");
    rows.push([q("LINE")]);
    data.logs.forEach((line) => rows.push([q(line)]));
  }

  // UTF-8 BOM + sep hint for Excel compatibility (auto-detects comma delimiter)
  const csv = "\uFEFF" + "sep=,\r\n" + rows.map((r) => r.join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `weather-station-debug-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
