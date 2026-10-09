# KPI Definitions — Pi Weather Station Debug Panel

This document describes the metrics displayed in the Debug panel and exported via the CSV export feature (About section → **Export CSV**, `client/src/ui/exportDebugCsv.js`). The export carries the server-side sections of `/api/debug` plus the client-side KPIs, measured at the moment of the click (see [Client KPIs](#client-kpis)).

---

## Server KPIs

These metrics are collected server-side by the Node.js / Express process.

| KPI | Unit | Definition |
|---|---|---|
| **Uptime** | d h m s | Time elapsed since the Node.js server process was last started. Resets on every restart of the server process (`systemctl --user restart pi-weather-server` on Linux, the launchd agent on macOS, the in-app updater, or a manual `npm start`) — not when the kiosk browser (`start-server`) is relaunched. |
| **Heap Used** | MB | Amount of memory actively occupied by live JavaScript objects in the Node.js V8 heap. High values indicate a large in-memory working set. |
| **Heap Total** | MB | Total size currently allocated for the V8 heap. Node.js grows this automatically; it is always ≥ Heap Used. |
| **RSS** | MB | Resident Set Size — total physical RAM occupied by the Node.js process, including the heap, native buffers, and shared libraries. Higher than Heap Total by design. |
| **Cache Hit Rate** | % | Percentage of incoming weather API requests served from the in-memory cache, computed as `hits / (hits + misses) × 100`. A high rate (≥ 70 %) means fewer calls to external paid APIs. |
| **Cache Hits** | count | Number of requests answered directly from cache since the server started. |
| **Cache Misses** | count | Number of requests that were not in cache and required a live call to an external API (Tomorrow.io, etc.). |
| **CPU Temp** | °C | CPU package temperature, read from `/sys/class/thermal/thermal_zone0/temp` (Pi: SoC; x86: typically the package sensor). Refreshed every 5 s while the debug panel is open via `GET /api/debug/cpu-temp`. `—` on platforms where the file doesn't exist (macOS). |
| **Fan RPM** | rpm | Fan speed from the first `/sys/class/hwmon/*/fanN_input` found (Pi 5 Active Cooler, PWM fan overlays, Linux x86 fans). Refreshed every 5 s alongside CPU Temp via `GET /api/debug/fan-speed`. `0` is a valid reading (fan stopped); `—` when no fan is exposed. |
| **Power status** | flags | Pi throttle register from `vcgencmd get_throttled`: under-voltage, frequency capped, throttled, soft temperature limit — each reported *now* and *since boot*. Shows `POWER OK` when no flag is currently set, otherwise one chip per active flag (`--c-danger` for under-voltage / throttled, `--c-warn` for the others), plus a "Since reboot" line naming any flag set since boot. Shown only where `vcgencmd` is available (a Pi); not in the CSV export. |
| **Internet (connectivity)** | ms | Connectivity hero at the top of the Server section: raw TCP handshake and full HTTPS `HEAD` latency to `1.1.1.1`, cached 60 s. TCP is tiered ≤ 200 / ≤ 500 / > 500 ms and drives the status LED (HTTPS tier as fallback when the TCP probe fails); HTTPS has its own ≤ 400 / ≤ 800 / > 800 ms scale. The CSV export carries a single `Internet` row with the HTTPS value. |

> `serverKpis.cache.staleServed` (weather responses served from an expired cache entry after an upstream Tomorrow.io failure — see [Cache entry fields](#cache-entry-fields)) is returned by `/api/debug` but is neither displayed nor exported.

### Color thresholds — Cache Hit Rate

No color coding in the v3 panel: the hit rate is shown as plain text. ≥ 70 % remains the informal healthy target (see **Cache Hit Rate** above).

### Color thresholds — CPU Temp

Aligned to the CM5 / Pi 5 Active Cooler fan trip points.

| Color | Meaning |
|---|---|
| Neutral (no color) | < 60 °C — below fan trip point 2, fan quiet |
| Amber (`--c-warn`) | 60–74 °C — fan ramping (trip points 2 → 4), system still healthy |
| Red (`--c-danger`) | ≥ 75 °C — fan at max (trip point 4), SoC heading toward throttling (~80–85 °C on Pi 4); check ventilation / heatsink |

---

## Server Response Times

Measured server-side by the `responseTimerMiddleware`, which is mounted globally after the static-file handler: it records every Express route it reaches — the `/api/` routes plus `/settings`, `/setting` and `/geolocation`. 404 responses are skipped (so scanning unique URLs can't grow the table). Recorded cumulatively since the server started. The panel lists the 10 busiest endpoints (count + avg); the CSV export also includes min and max.

| Column | Unit | Definition |
|---|---|---|
| **Endpoint** | — | The route path (e.g. `/api/weather/current`, `/api/reverse-geocode`, `/settings`). Tile paths are normalized to `/api/tiles/<style>/:z/:x/:y`. |
| **Count** | count | Total number of HTTP requests received on this endpoint. |
| **Avg** | ms | Mean response time across all requests, from the moment the request arrives at the middleware to the moment the response is sent. |
| **Min** | ms | Fastest single response recorded (best-case, usually a cache hit or trivial handler). |
| **Max** | ms | Slowest single response recorded (worst-case, typically a cold cache miss requiring an external API call). |

---

## Client KPIs

These metrics are collected browser-side using standard Web Performance APIs. Page Load and JS Heap reflect the state of the browser tab at the moment the panel's Client section is opened; FPS is live (see [Notes](#notes)).

The CSV export carries them too, measured when **Export CSV** is clicked — whether or not the Client section is pinned: the button samples FPS for 1 s (the download follows that second), then takes a fresh snapshot of Page Load, JS Heap, Screen and the [Client API Calls](#client-api-calls-session) with the same collector the Client section uses (`snapshotClientMetrics`). A reading the browser can't provide exports as `N/A` (Page Load, FPS — e.g. FPS in a hidden tab, which paints no frames) or is left out (the JS Heap rows outside Chromium).

| KPI | Unit | Definition |
|---|---|---|
| **Page Load** | ms | Time from navigation start (`navigationStart`) to the `load` event (`loadEventEnd`), as reported by the Navigation Timing API. Covers HTML parsing, CSS, fonts, and all initial JavaScript execution. |
| **FPS** | frames/s | Frames per second from a `requestAnimationFrame` loop, averaged over a sliding 2 s window and refreshed every second. Reflects rendering smoothness. Values below 30 fps indicate that the UI is struggling (heavy CSS animations, slow device). |
| **JS Heap Used** | MB | JavaScript heap memory currently occupied by live objects in the browser tab, from `performance.memory.usedJSHeapSize`. Only available in Chromium-based browsers (Chromium on Pi, Chrome, Edge). |
| **JS Heap Total** | MB | Total JavaScript heap allocated for the tab, from `performance.memory.totalJSHeapSize`. Always ≥ JS Heap Used. |
| **Screen** | CSS px | `screen.width × screen.height` plus `devicePixelRatio` (1 when unavailable). The panel shows `W×H @DPR×` (the DPR only when ≠ 1); the CSV splits it into `Screen (CSS px)` and `Device Pixel Ratio` rows. |

### Color thresholds — FPS

| Color | Meaning |
|---|---|
| Cool (`--c-cool`, blue-grey; red-family in the night-red palette) | ≥ 50 fps — smooth |
| Amber (`--c-warn`) | 30–49 fps — acceptable but degraded |
| Red (`--c-danger`) | < 30 fps — sluggish, noticeable jank |

---

## Client API Calls (Session)

Collected from the browser's Resource Timing API (`performance.getEntriesByType("resource")`) as a snapshot when the Client section opens; the panel lists the 10 most-called endpoints. The CSV export takes its own snapshot at click time and includes every endpoint (`CLIENT API CALLS (SESSION)` section, omitted when no `/api/` request is in the buffer). Covers the `/api/` requests still held in the browser's resource-timing buffer — a browser-defined default (typically 250 entries) shared with map tiles and every other resource type, which the app never enlarges — so on a long-running kiosk only the earliest part of the session is counted.

| Column | Unit | Definition |
|---|---|---|
| **Endpoint** | — | The API route path. Tile paths are normalized to `/api/tiles/<style>/:z/:x/:y` to group each style's tile requests together. |
| **Count** | count | Number of times this endpoint was called during the current session. |
| **Avg** | ms | Mean round-trip time measured by the browser (from request sent to last byte received), including network latency and server processing time. |
| **Min** | ms | Fastest single call (best-case network + server). |
| **Max** | ms | Slowest single call (worst-case, e.g. a cold cache miss or slow network). |

---

## Provider Status

Real-time operational status fetched from each external service's public status API (RainViewer, which has no scrapable status endpoint, is probed by pinging its API directly). Results are cached for **30 minutes** to avoid hammering status endpoints.

| Provider | Source type | URL |
|---|---|---|
| **Tomorrow.io** | Statuspage (overall) | `https://status.tomorrow.io/api/v2/status.json` |
| **Mapbox** | Statuspage (overall) | `https://status.mapbox.com/api/v2/status.json` |
| **ipapi.co** | HTML scraping | `https://ipapi.co/status/` |
| **LocationIQ** | RSS feed | `https://status.locationiq.com/rss` |
| **Anthropic Claude** | Statuspage (component) | `https://status.claude.com/api/v2/components.json` — component: `"Claude API (api.anthropic.com)"` |
| **RainViewer** | API ping (latency) | `https://api.rainviewer.com/public/weather-maps.json` — `none` when it answers, `minor` if the response takes ≥ 3 s, `major` on timeout / unreachable |
| **GitHub** | Statuspage (component) | `https://www.githubstatus.com/api/v2/components.json` — component: `"Git Operations"` (the in-app updater's `git pull`; also surfaced by the dock health popover) |

### Indicator values

| Indicator | Meaning |
|---|---|
| `none` | Fully operational |
| `minor` | Degraded performance |
| `major` | Partial outage |
| `critical` | Major outage |
| `maintenance` | Scheduled maintenance |
| `unknown` | Status could not be fetched or parsed |
| `—` | Not applicable (e.g. RSS-based providers report last incident date instead) |

> **Anthropic Claude** is matched using `startsWith("Claude API")` to remain resilient to parenthetical label changes (e.g. `"Claude API (api.anthropic.com)"`).

---

## Recent Service Calls

The last recorded outbound call of each server-side upstream service, from the in-memory service-status map (`server/serviceStatus.js`; cleared on server restart). Unlike the lists elsewhere in the panel that stop at 10 rows (response times, client API calls, remote clients, security events), this one is never capped: the server pre-registers its whole inventory at startup (`registerKnownServices` in `server/index.js` — Tomorrow.io ×3, Mapbox, LocationIQ, ipapi.co, sunrise-sunset.org, RainViewer ×2, Claude, Homebridge, the air-quality sources, both alert feeds and Open-Meteo pollen), so a service that has not been called yet — or never will be on this install — still has a row, and a service recorded without being pre-registered is listed too. Failing services are listed first (HTTP 5xx, then 4xx), then every other service in the server's order: startup registration order, with a service first seen later at the end. The list has no internal scroll; the panel's content pane scrolls as a whole. The CSV export's `SERVICES` section carries the same entries in the server's order (no failures-first hoist) plus each entry's last-call time — an empty `LAST CALL` cell (and `Not yet called` in `COMMENT`) for a service not called since the server started, never a 1970 epoch date.

| Column | Definition |
|---|---|
| **Status** | Last HTTP status, as a tag: red for 5xx, amber for 4xx, green for 2xx–3xx; `?` (neutral) when the service has not been called since the server started. |
| **Service** | Service name as recorded by the controller (e.g. `Tomorrow.io (current)`, `NWS (severe weather alerts)`). |
| **Comment** | Free-text detail of the last call — `OK`, a cache note, or the upstream error message; `Not yet called` for a pre-registered service with no call yet. |

---

## API Quota Counters

Tracks outbound calls to paid/rate-limited external services. Counters are persisted to `server/request-counts.json` and survive server restarts. Period keys reset automatically at the start of each hour, day, and month.

| Service | Endpoint | Hour limit | Day limit | Month limit | Notes |
|---|---|---|---|---|---|
| **tomorrow.io** | `current`, `hourly`, `daily` | 25 | 500 | — | Realtime weather, hourly and daily forecasts — the limits apply to the sum of the three endpoints. `current` also counts the AI summary's weather backfill |
| **mapbox** | `tiles` | — | — | 50 000 | Base map tile requests |
| **locationiq** | `geocode` | — | 5 000 | — | Reverse geocoding |
| **ipapi.co** | `geolocation` | — | 1 000 | — | IP-based default location |
| **anthropic** | `summary` | — | — | — | AI weather summary (no published quota) |

> Limits are per service, not per endpoint: the panel's TOTAL row sums every endpoint of a service and is the only row that shows `used / cap`. Every cell, endpoint rows included, is tinted against the full service cap (`--c-warn` at ≥ 80 %, `--c-danger` at ≥ 100 %).

> Counters with `—` for a period mean no limit is tracked for that period; the counter still increments, but the debug panel (and the CSV) always show the day count and show the hour / month columns only when that period has a cap.

> Services without a published quota are counted too and shown with today's count only: `rainviewer` (`analyzer`, `risk` — the 50 km zone analysis), `homebridge` (`accessories`), `airnow` (`data`), `openaq` (`latest`), `eccc` (`aqhi`, `alerts`), `melcc` (`rsqaq`, `rsqa-mtl`) and `nws` (`alerts`). The Sense HAT feed (`GET /api/sensehat`) is an inbound local endpoint and has no counter of its own.

---

## Cache Entries

The server maintains an in-memory cache for weather API responses and AI summaries. The debug panel lists up to 12 cache entries, fresh and expired, with their time-to-live (TTL); the CSV export includes all of them.

| Key pattern | TTL | Source | Description |
|---|---|---|---|
| `current:<fieldsHash>:<lat>:<lon>` | 15 min | Tomorrow.io | Current weather conditions |
| `hourly:<fieldsHash>:<lat>:<lon>` | 30 min | Tomorrow.io | Hourly forecast (next 24 h) |
| `daily:<fieldsHash>:<lat>:<lon>` | 6 h | Tomorrow.io | Daily forecast (next 5 days) |
| `ai-summary:<lat>:<lon>:<lang>:<period>:<tempUnit>:<speedUnit>:<distanceUnit>` | 15 min (5 min for a truncated reply) | Anthropic Claude | AI-generated weather summary |

Weather keys use 4-decimal coordinates and carry `<fieldsHash>`, an 8-hex-character signature of the requested Tomorrow.io field list (since 2.14.6): changing the field list changes the hash, so entries cached under the old field set are simply never matched again. AI summary keys use 2-decimal coordinates.

The panel shows each raw key. The CSV export's `CACHE` section splits it per key shape into `TYPE` (`current` / `hourly` / `daily` / `ai-summary`), `VARIANT` (`fields <fieldsHash>` for a weather key; `<lang>/<period>/<tempUnit>/<speedUnit>/<distanceUnit>` for an AI summary), `LAT`, `LON` and `TTL (s)` (`EXPIRED` once past its TTL). A key of any other shape keeps its first segment in `TYPE` and the rest in `VARIANT`, with `LAT` / `LON` left empty.

### Cache entry fields

| Field | Unit | Definition |
|---|---|---|
| **key** | — | Cache key identifying the entry. AI summary keys include language (`en`/`fr`/`es`), period (`morning`/`evening`/`night`) and the unit set (temperature, speed, distance). |
| **expiresIn** | s | Seconds until the entry expires. 0 means it has already expired and will be refreshed on next request. |
| **expired** | boolean | `true` if the entry is past its TTL. Expired **weather** entries are kept (in memory and on disk) for up to 24 h and are not served normally — the next request refetches; if that fetch fails (any upstream error — 429, 5xx, timeout, network), the stale entry is served as a fallback and counted in `serverKpis.cache.staleServed`. Expired **AI summary** entries are never served and are dropped on the next prune. |

---

## Notes

- **Server vs. Client response times**: Server times measure only the Express handler duration (no network). Client times include the full round-trip (network + server). The difference approximates network latency.
- **Cache interaction**: A client "Min" close to zero on `/api/tiles/...` indicates a browser-level cache hit (HTTP cache — tiles are cacheable); the same goes for `/api/weather-alerts` and `/api/nearby-alerts`, which are sent `Cache-Control: public, max-age=300` (unless the localhost-only test-alert toggle is on). Every other `/api/` response is sent `Cache-Control: no-store`, so its Min reflects a real round-trip (fast when the server-side cache hit).
- **Heap metrics availability**: JS Heap (Used / Total) are Chromium-only. They will not appear in Firefox or Safari.
- **FPS measurement**: FPS is live — averaged over a sliding 2 s window of `requestAnimationFrame` timestamps and refreshed once per second while the Client section is open (shows `…` for roughly the first 1.5 s). The other client KPIs (page load, heap, screen, API-call roll-up) are a snapshot taken when the section opens. The CSV export measures its own: a one-shot 1 s FPS sample at click time, then a fresh snapshot of the rest.
- **Provider status cache**: The 30-minute TTL means status changes may take up to 30 minutes to appear in the debug panel. Force a refresh by restarting the server.
- **AI summary cache key**: The `period` segment (`morning`/`evening`/`night`) is derived from the local hour sent by the client (`localHour` query parameter), ensuring the right forecast window is included in the summary prompt. The trailing `tempUnit` / `speedUnit` / `distanceUnit` segments come from the client's unit preferences, so clients using different units never share a summary.
