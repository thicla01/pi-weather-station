# Pi Weather Station — Software Architecture

*Last updated: 2026-04-21*

---

## 1. Context and objectives

Pi Weather Station is a self-hosted weather kiosk running on a Raspberry Pi with a 7" 800×480 touchscreen. It displays real-time weather data, a radar map, hourly and daily forecasts, and an optional AI-generated summary powered by Claude.

### Target use case
A always-on display mounted in a home, operated exclusively by touch with no keyboard. Chromium runs in kiosk mode, the server starts automatically via systemd at boot, and the device requires no manual intervention after setup.

### Quality attributes

| Attribute | Target | How it is addressed |
|---|---|---|
| **Availability** | 24/7 unattended | systemd `Restart=on-failure`, cache survives restarts |
| **API quota efficiency** | Minimize external calls | Server-side shared cache; all clients share one set of responses |
| **Security** | Keys never leave the Pi | All external calls proxied server-side; remote clients receive masked booleans |
| **UI responsiveness** | < 500 ms for interactions | React local state; weather data pre-cached; no blocking calls on render |
| **Maintainability** | Deployable with `git pull` | `dist/` committed to git; no rebuild needed on target hardware |
| **Touchscreen usability** | No keyboard, fat-finger friendly | Drag-to-scroll, large tap targets, adaptive layout for 480px height |

---

## 2. System view

```
                        ┌─────────────────┐                   ┌─────────────┐
                        │    Browser      │                   │   Browser   │
                        │   PC / Mac      │                   │   Tablet    │
                        └────────┬────────┘                   └──────┬──────┘
                                 │              Local network        │
                 ─ ─ ─ ─ ─ ─ ─ ─┼─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┼─ ─ ─ ─ ─
                                 └──────────────┬────────────────────┘
                                         HTTPS :8443
┌─────────────────┐                             │
│    Chromium     │    loopback          ┌──────▼──────────────────────────────┐
│  (localhost)    ├─────────────────────►│              Raspberry Pi           │
└─────────────────┘    127.0.0.1         │                                     │
                                         │          Express Server             │
                                         │          HTTPS :8443                │
                                         │                                     │
                                         │  /api/weather/*      → shared cache │
                                         │  /api/tiles/*        → shared cache │
                                         │  /api/reverse-geocode               │
                                         │  /api/sunrise-sunset                │
                                         │  /api/weather-summary → AI cache    │
                                         │  /api/debug          (localhost only)│
                                         │  /settings  write    (localhost only)│
                                         └──────────────────────┬───────────────┘
                                                                │
                                                           Internet
                        ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┼─ ─ ─ ─ ─ ─ ─ ─
                                                                │
       ┌──────────────┬──────────────┬───────────────┬──────────┴────────┬──────────────────────┐
       │              │              │               │                   │                      │
┌──────┴──────┐  ┌────┴──────┐  ┌───┴─────────┐  ┌─┴─────────┐  ┌──────┴─────────┐  ┌─────────┴──────────┐
│ Tomorrow.io │  │  Mapbox   │  │  LocationIQ │  │ ipapi.co  │  │ sunrise-sunset │  │ Anthropic (Claude) │
│  (weather)  │  │  (tiles)  │  │  (geocoding)│  │  (IP geo) │  │     .org       │  │   (AI summary)     │
└─────────────┘  └───────────┘  └─────────────┘  └───────────┘  └────────────────┘  └────────────────────┘
```

**North** — remote browsers connect over HTTPS when `ALLOW_REMOTE=true`  
**West** — Chromium on the Pi communicates via loopback, granting exclusive access to `/api/debug`, unmasked settings, and write endpoints  
**Center** — the Pi is the single gateway; no client ever reaches an external API directly  
**South** — external APIs are only reachable by the Pi; Anthropic is optional (requires a configured key)

---

## 3. Server architecture

The Express server (`server/`) is organized as independent controller modules, each with a single responsibility. `index.js` wires them together.

```
server/index.js  ─── entry point, routes, middleware, HTTPS server
    │
    ├── settingsCtrl.js      Read / write settings.json. Enforces a key
    │                        whitelist. Returns masked booleans for API key
    │                        fields to remote clients.
    │
    ├── proxyCtrl.js         Proxies all outbound API calls (Tomorrow.io,
    │                        Mapbox, LocationIQ, sunrise-sunset.org).
    │                        Owns the shared in-memory weather cache
    │                        (persisted to weather-cache.json on shutdown).
    │                        Cache TTLs: 15 min current / 30 min hourly / 6 h daily.
    │
    ├── aiSummaryCtrl.js     Builds a prompt from cached weather data and
    │                        calls Claude Haiku (Anthropic SDK). Owns its
    │                        own in-memory summary cache (15 min TTL, keyed
    │                        by lat/lon/lang/period). Returns 503 if no key.
    │
    ├── geolocationCtrl.js   Resolves the Pi's approximate location via
    │                        ipapi.co. Used as default map center when no
    │                        custom coordinates are configured.
    │
    ├── debugCtrl.js         Aggregates all diagnostic data for the debug
    │                        panel: system info, KPIs, provider status,
    │                        weather + AI cache state, quota counters,
    │                        service call history, security events, logs.
    │                        Always restricted to localhost.
    │
    ├── serviceStatus.js     In-memory journal of the last HTTP status and
    │                        timestamp for every external API call.
    │
    ├── requestCounter.js    Per-service/endpoint counters (hourly, daily,
    │                        monthly) persisted to request-counts.json.
    │                        Compared against quota limits in the debug panel.
    │
    ├── responseTimer.js     Express middleware. Records response time for
    │                        every route; exposes count/avg/min/max per endpoint.
    │
    ├── clientTracker.js     Records the IP and first-seen timestamp of each
    │                        remote client that connects to the server.
    │
    └── updateChecker.js     Polls the GitHub releases API once per hour to
                             detect newer versions. Result cached in memory.
```

### Middleware stack (applied in order)

```
bodyParser.json()
express.static()          ← serves client/dist/
responseTimerMiddleware   ← records latency for every route
req.isLocal assignment    ← true if req.ip is 127.0.0.1 / ::1
  └── recordClient()      ← logs remote IPs
```

Then per-route middleware: `localhostOnly`, `debugLocalhostOnly`, `apiLimiter` (120/min), `tileLimiter` (600/min).

---

## 4. Client architecture

The React frontend (`client/src/`) uses a single global context for shared state and CSS Modules for style isolation.

### Component tree

```
App                          Root layout — CSS grid (map | info panel)
│                            Manages: font size zoom, small-screen detection,
│                            panel collapse, dark/light mode class
│
├── WeatherMap               Leaflet map with RainViewer radar tiles and
│   └── MapResizer           Mapbox base tiles. MapResizer calls
│                            map.invalidateSize() when the panel toggles.
│
└── InfoPanel                Right column (300 px, full height)
    ├── Clock                Digital clock, updates every second
    │
    ├── WeatherInfo          Scrollable area — owns weather update intervals
    │   │                    and the aiExpanded toggle state
    │   ├── LocationName     Reverse-geocoded place name (LocationIQ)
    │   ├── CurrentWeather   Temperature, weather icon, wind, humidity
    │   ├── [ChartLegend]    Shared legend (hidden when AI expanded)
    │   ├── [HourlyChart]    Chart.js — 24-hour forecast
    │   ├── [DailyChart]     Chart.js — 5-day forecast
    │   │   └── [ChartTabs]  Replaces stacked charts on screens ≤ 520 px
    │   └── AiSummary        AI summary with expand/collapse toggle
    │
    └── ControlButtons       Bottom bar: settings, dark mode, location,
        ├── Settings         radar play/stop, debug, update badge
        └── Debug
```

### State management

All shared state lives in `AppContext.js` (React Context + `useState`). Components read from context and call setter functions exposed by the context value.

```
AppContext
  ├── Settings (from server)   weatherApiKey, mapApiKey, reverseGeoApiKey,
  │                            anthropicApiKey, customLat, customLon
  ├── Weather data             currentWeatherData, hourlyWeatherData,
  │                            dailyWeatherData, sunriseSunset, mapGeo
  ├── UI preferences           darkMode, mouseHide, tempUnit, speedUnit,
  │   (localStorage)           lengthUnit, clockTime, fontSize
  └── UI state                 settingsMenuOpen, debugMenuOpen,
                               infoPanelCollapsed, isLocal, isRemote...
```

> ⚠️ `AppContext.js` is already large and is a known technical debt item. See `ROADMAP.md`.

### Responsive adaptations (≤ 520 px height)

Detected via `window.matchMedia("(max-height: 520px)")` with a `change` listener for live updates.

| Feature | Normal screen | Small screen (7" Pi display) |
|---|---|---|
| Forecast charts | HourlyChart + DailyChart stacked | Single chart with 24h / 5d tabs |
| Info panel | Always visible | Collapsible via floating PanelToggle button |
| Font size zoom | Applied to InfoPanel | Same — counter-zoom on chart wrappers prevents overflow |

### Font size zoom model

`zoom: fontSizeZoom` is applied to the InfoPanel container (S=0.85, M=1.0, L=1.15). Two compensations are required:

- **Height**: `height: calc(100dvh / fontSizeZoom)` restores the logical height so controls stay in view
- **Charts**: `zoom: 1 / fontSizeZoom` on each chart wrapper cancels the parent zoom, letting Chart.js measure the container in its natural coordinate space

---

## 5. Key data flows

### Startup sequence

```
systemd starts npm start
  → Express server binds HTTPS :8443
  → start-server script detects port open
  → Chromium launches in kiosk mode → https://localhost:8443
  → React app loads from dist/
  → AppContext: loadStoredData() ← localStorage (units, dark mode, font size)
  → AppContext: getCustomLatLon() ← settings.json via GET /settings
  → AppContext: getBrowserGeo() ← navigator.geolocation (or IP fallback)
  → AppContext: checkIsLocal() ← GET /api/is-local
  → WeatherInfo mounts → GET /api/weather/current, /hourly, /daily
  → AiSummary mounts → GET /api/weather-summary (if key configured)
```

### Location change (map click)

```
User clicks map
  → Leaflet fires click event → mapGeo updated in AppContext
  → WeatherInfo useEffect fires (mapGeo dependency)
  → createWeatherUpdateInterval() clears old intervals, starts new ones
  → GET /api/weather/current?lat=…&lon=… (server checks cache → miss → Tomorrow.io)
  → GET /api/weather/hourly, /daily (same)
  → AiSummary useEffect fires (mapGeo dependency) → GET /api/weather-summary
  → LocationName fires → GET /api/reverse-geocode?lat=…&lon=…
```

### AI summary request

```
Client: GET /api/weather-summary?lat=…&lon=…&lang=fr&localHour=14&…
  → aiSummaryCtrl checks summaryCache → miss
  → reads anthropicApiKey from settings.json → 503 if absent
  → reads current/hourly/daily from shared weatherCache (no new API call)
  → builds prompt (current conditions + period-appropriate forecast window)
  → Anthropic SDK: claude-haiku-4-5 → max_tokens: 150, temperature: 0
  → stores in summaryCache (TTL 15 min)
  → recordServiceCall("Claude (AI summary)", 200, "OK")
  → increment("anthropic", "summary")
  → returns { summary: "…" }
```

### One-click update

```
User taps Update button (localhost only)
  → POST /api/update
  → server: git pull --ff-only (cwd: project root, timeout: 30s)
  → on success: res.json({ ok: true })
  → setTimeout 500ms → systemctl --user restart pi-weather-server
  → client polls https://localhost:8443 until server responds
  → page reloads automatically
```

---

## 6. Deployment architecture

```
~/.config/systemd/user/
  └── pi-weather-server.service          Main unit
  └── pi-weather-server.service.d/
        ├── override.conf                Log redirect, ALLOW_REMOTE, DEBUG
        └── nvm.conf                     Bullseye 32-bit only — sources nvm

~/.local/bin/
  └── start-server                       Waits for server, launches Chromium
                                         in kiosk mode. Auto-detects display
                                         server (labwc / wayfire / X11) and
                                         Chromium binary name.

Display server autostart (one of):
  ~/.config/labwc/autostart              Trixie / Debian 13
  ~/.config/wayfire.ini [autostart]      Bookworm / Debian 12
  ~/.config/lxsession/LXDE-pi/autostart Bullseye / Debian 11
```

### Update flow on target Pi

```bash
git pull                           # pulls new dist/ — no rebuild needed
systemctl --user restart pi-weather-server
```

`dist/` is committed to git so the compiled React bundle is always available without Node.js toolchain on the Pi.

---

## 7. Architecture decision records (ADR)

### ADR-01 — All external API calls proxied server-side

**Decision:** Every call to Tomorrow.io, Mapbox, LocationIQ, sunrise-sunset.org, ipapi.co, and Anthropic is made by the Express server, never by the browser.

**Rationale:** API keys would be visible in browser network logs if called client-side. Server-side proxying also enables a shared cache: all connected browsers benefit from the same cached response, reducing quota consumption.

**Consequences:** Adds a server hop for every data fetch. Acceptable given the LAN context and 15–360 min cache TTLs.

---

### ADR-02 — `dist/` committed to git

**Decision:** The compiled webpack bundle (`client/dist/`) is committed alongside source code.

**Rationale:** Raspberry Pis update with `git pull` + service restart. Requiring a webpack build on the Pi would add Node.js build toolchain as a dependency on every device, and would make updates slower and riskier on low-RAM Pi models.

**Consequences:** The dist/ files must be rebuilt and committed on the development machine before every push that touches client source. `npm run prod` must be run and the result staged explicitly.

---

### ADR-03 — Single AppContext for all shared state

**Decision:** All global state (settings, weather data, UI preferences, panel state) lives in one React Context (`AppContext.js`).

**Rationale:** Appropriate for the project's size at the time. A single context is simple to reason about and avoids prop drilling across the component tree.

**Consequences:** `AppContext.js` has grown large and is now a known technical debt item. As the project grows, splitting into focused contexts (`SettingsContext`, `WeatherContext`, `UIContext`) should be considered. See `ROADMAP.md`.

---

### ADR-04 — CSS `zoom` for font size scaling

**Decision:** Font size scaling (S/M/L) is implemented via the CSS `zoom` property on the InfoPanel container, not via `font-size` or CSS custom properties on individual elements.

**Rationale:** `zoom` scales the entire subtree uniformly — all text, spacing, icons, and chart containers — without requiring changes to individual components. A `font-size` approach would require explicit `em`-based sizing throughout every component.

**Consequences:** Two compensations are required: `height: calc(100dvh / zoom)` to prevent grey areas or hidden controls, and a counter-zoom (`zoom: 1/parentZoom`) on chart wrappers so Chart.js measures the container in its natural coordinate space.

---

### ADR-05 — Weather cache persisted to disk

**Decision:** The server-side weather cache is saved to `server/weather-cache.json` on shutdown (SIGTERM/SIGINT) and every 5 minutes.

**Rationale:** Without persistence, every server restart (deployment, crash, reboot) triggers a full set of Tomorrow.io API calls. The Pi reboots on power loss; cache persistence avoids exhausting the daily quota on restart days.

**Consequences:** `weather-cache.json` must be excluded from git (it is). On first start there is no cache and API calls fire normally.

---

### ADR-06 — HTTPS with auto-generated self-signed certificate

**Decision:** The server runs exclusively over HTTPS using a self-signed certificate generated at first launch.

**Rationale:** Avoids mixed-content browser errors when the page (served over HTTPS) makes fetch calls to the same server. Also ensures traffic between the Pi and remote browsers on the LAN is encrypted.

**Consequences:** Browsers show a security warning on first visit. Users must accept the exception once. For remote access with a valid certificate, the Pi's IP must be included as a SAN — `install.sh` handles this automatically.

---

## 8. Known limitations

| Limitation | Impact | Tracked in |
|---|---|---|
| No automated tests | Regressions not caught automatically | ROADMAP.md |
| `AppContext.js` too large | Growing harder to navigate | ROADMAP.md |
| No offline mode | Blank panel on internet outage | ROADMAP.md |
| Self-signed certificate | Browser warning on first visit | — (by design) |
| `eslint-disable-line` suppressions | Hidden assumptions in hooks | ROADMAP.md |
| Version history in both readme.md and CHANGELOG.md | Manual sync required | ROADMAP.md |
