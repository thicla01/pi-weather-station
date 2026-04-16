# KPI Definitions — Pi Weather Station Debug Panel

This document describes every metric displayed in the Debug panel and exported via the CSV export feature.

---

## Server KPIs

These metrics are collected server-side by the Node.js / Express process.

| KPI | Unit | Definition |
|---|---|---|
| **Uptime** | d h m s | Time elapsed since the Node.js server process was last started. Resets on every restart of `start-server`. |
| **Heap Used** | MB | Amount of memory actively occupied by live JavaScript objects in the Node.js V8 heap. High values indicate a large in-memory working set. |
| **Heap Total** | MB | Total size currently allocated for the V8 heap. Node.js grows this automatically; it is always ≥ Heap Used. |
| **RSS** | MB | Resident Set Size — total physical RAM occupied by the Node.js process, including the heap, native buffers, and shared libraries. Higher than Heap Total by design. |
| **Cache Hit Rate** | % | Percentage of incoming weather API requests served from the in-memory cache, computed as `hits / (hits + misses) × 100`. A high rate (≥ 70 %) means fewer calls to external paid APIs. |
| **Cache Hits** | count | Number of requests answered directly from cache since the server started. |
| **Cache Misses** | count | Number of requests that were not in cache and required a live call to an external API (Tomorrow.io, etc.). |

### Color thresholds — Cache Hit Rate

| Color | Meaning |
|---|---|
| Green | ≥ 70 % — healthy, most requests cached |
| Orange | 40–69 % — moderate, cache warming up or TTL too short |
| Red | < 40 % — low, most requests bypass cache |

---

## Server Response Times

Measured server-side by the `responseTimerMiddleware` for every Express route that handles an `/api/` request. Recorded cumulatively since the server started.

| Column | Unit | Definition |
|---|---|---|
| **Endpoint** | — | The API route path (e.g. `/api/weather`, `/api/map-key`). Tile endpoints are normalized to `/:z/:x/:y`. |
| **Count** | count | Total number of HTTP requests received on this endpoint. |
| **Avg** | ms | Mean response time across all requests, from the moment the request arrives at the middleware to the moment the response is sent. |
| **Min** | ms | Fastest single response recorded (best-case, usually a cache hit or trivial handler). |
| **Max** | ms | Slowest single response recorded (worst-case, typically a cold cache miss requiring an external API call). |

---

## Client KPIs

These metrics are collected browser-side using standard Web Performance APIs. They reflect the state of the browser tab at the moment the Debug panel is opened.

| KPI | Unit | Definition |
|---|---|---|
| **Page Load** | ms | Time from navigation start (`navigationStart`) to the `load` event (`loadEventEnd`), as reported by the Navigation Timing API. Covers HTML parsing, CSS, fonts, and all initial JavaScript execution. |
| **FPS** | frames/s | Frames per second measured over one second using `requestAnimationFrame`. Reflects rendering smoothness. Values below 30 fps indicate that the UI is struggling (heavy CSS animations, slow device). |
| **JS Heap Used** | MB | JavaScript heap memory currently occupied by live objects in the browser tab, from `performance.memory.usedJSHeapSize`. Only available in Chromium-based browsers (Chromium on Pi, Chrome, Edge). |
| **JS Heap Total** | MB | Total JavaScript heap allocated for the tab, from `performance.memory.totalJSHeapSize`. Always ≥ JS Heap Used. |

### Color thresholds — FPS

| Color | Meaning |
|---|---|
| Green | ≥ 50 fps — smooth |
| Orange | 30–49 fps — acceptable but degraded |
| Red | < 30 fps — sluggish, noticeable jank |

---

## Client API Calls (Session)

Collected from the browser's Resource Timing API (`performance.getEntriesByType("resource")`). Covers every `/api/` HTTP request made by this browser tab since the page was loaded.

| Column | Unit | Definition |
|---|---|---|
| **Endpoint** | — | The API route path. Mapbox tile paths are normalized to `/:z/:x/:y` to group all tile requests together. |
| **Count** | count | Number of times this endpoint was called during the current session. |
| **Avg** | ms | Mean round-trip time measured by the browser (from request sent to last byte received), including network latency and server processing time. |
| **Min** | ms | Fastest single call (best-case network + server). |
| **Max** | ms | Slowest single call (worst-case, e.g. a cold cache miss or slow network). |

---

## Notes

- **Server vs. Client response times**: Server times measure only the Express handler duration (no network). Client times include the full round-trip (network + server). The difference approximates network latency.
- **Cache interaction**: A client "Min" close to zero usually indicates a browser-level cache hit (HTTP cache), not the server-side weather cache.
- **Heap metrics availability**: JS Heap (Used / Total) are Chromium-only. They will not appear in Firefox or Safari.
- **FPS measurement**: FPS is sampled once when the Debug panel opens and is not updated in real time.
