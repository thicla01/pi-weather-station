# Pi Weather Station — Software Architecture

*Last updated: 2026-04-27 — current as of v2.6.3*

---

## 1. Context and objectives

Pi Weather Station is a self-hosted weather kiosk originally designed for a Raspberry Pi with the official 7" touchscreen, and now confirmed to run on any modern Linux desktop (Debian, Ubuntu, openSUSE) and macOS. It displays real-time weather data, an animated radar map, hourly and daily forecasts, an optional AI-generated summary powered by Claude (with a radar-trajectory paragraph), and an optional indoor temperature reading sourced from a Homebridge instance.

### Target use case

An always-on display mounted in a home, operated exclusively by touch with no keyboard. The configured browser (Chromium-family or Firefox) runs in kiosk mode, the server starts automatically via systemd (Linux) or launchd (macOS) at boot, and the device requires no manual intervention after setup.

### Quality attributes

| Attribute | Target | How it is addressed |
|---|---|---|
| **Availability** | 24/7 unattended | systemd `Restart=on-failure`; weather, geolocation, and request-counter caches survive restarts; ExecStartPre waits for DNS before launching Node |
| **API quota efficiency** | Minimize external calls | Server-side shared cache; all clients share one set of responses |
| **Security** | Keys never leave the Pi | All external calls proxied server-side; remote clients receive masked booleans; passwords (Homebridge) entirely stripped from remote `/settings` responses |
| **UI responsiveness** | < 500 ms for interactions | React local state; weather data pre-cached; no blocking calls on render |
| **Maintainability** | Deployable with `git pull` | `dist/` committed to git; in-app updater runs `npm install` between pull and restart; pre-flight checks catch the common failure modes |
| **Touchscreen usability** | No keyboard, fat-finger friendly | Drag-to-scroll, large tap targets, adaptive layout for 480px height |
| **Cross-distro portability** | Pi OS, Debian/Ubuntu, openSUSE, macOS | `install.sh` detects apt vs zypper, browser family, and desktop environment (labwc / wayfire / LXDE-Pi / GNOME / KDE Plasma) |

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
│    Browser      │    loopback          ┌──────▼──────────────────────────────────┐
│  (kiosk on Pi)  ├─────────────────────►│              Raspberry Pi               │
└─────────────────┘    127.0.0.1         │                                         │
                                         │           Express Server                │
                                         │           HTTPS :8443                   │
                                         │                                         │
                                         │  /api/weather/*       → shared cache    │
                                         │  /api/tiles/*         → shared cache    │
                                         │  /api/reverse-geocode                   │
                                         │  /api/sunrise-sunset                    │
                                         │  /api/weather-summary  → AI cache       │
                                         │  /api/sensehat        → cache + ipapi   │
                                         │  /api/indoor-temperature → 5-min cache  │
                                         │  /api/update-check    → 1-hour cache    │
                                         │  /api/update          (localhost only)  │
                                         │  /api/debug           (localhost only)  │
                                         │  /settings  write     (localhost only)  │
                                         └────┬────────────────────┬───────────────┘
                                              │                    │
                                         Internet              LAN (IoT VLAN)
                  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┼─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┼─ ─ ─ ─ ─ ─ ─ ─
                                              │                    │
       ┌────────────┬────────────┬────────────┼────────────┬───────┴────────┬─────────────┐
┌──────┴─────┐ ┌────┴───┐ ┌──────┴────┐ ┌─────┴─────┐ ┌────┴──────┐ ┌──────┴───────┐ ┌────┴──────┐
│Tomorrow.io │ │ Mapbox │ │LocationIQ │ │ ipapi.co  │ │ sunrise-  │ │  Anthropic   │ │ Homebridge│
│  (weather) │ │ (tiles)│ │(geocoding)│ │ (IP geo)  │ │ sunset.org│ │   (Claude)   │ │  (sensor) │
└────────────┘ └────────┘ └───────────┘ └───────────┘ └───────────┘ └──────────────┘ └───────────┘
                                  ▲                                          ▲              ▲
                                  │                                          │              │
                                  └─ RainViewer (radar tiles direct from client; no API key)
                                                                   AI summary       Indoor temp
                                                                   (optional)       (optional)
```

**North** — remote browsers connect over HTTPS when `ALLOW_REMOTE=true`; remote clients have read-only access (settings writes always restricted to localhost)
**West** — the kiosk browser on the Pi communicates via loopback, granting exclusive access to `/api/debug`, unmasked settings, and `/api/update`
**Center** — the Pi is the gateway for all keyed APIs; no client ever reaches Tomorrow.io / Mapbox / LocationIQ / Anthropic / Homebridge directly. RainViewer radar tiles are an exception — they're fetched by the client directly because they require no key.
**South-internet** — keyed external APIs reachable only from the Pi
**South-LAN** — Homebridge sits on the same network (often a separate IoT VLAN); used by the optional indoor-temperature feature

---

## 3. Server architecture

The Express server (`server/`) is organized as independent controller modules, each with a single responsibility. `index.js` wires them together.

```
server/index.js  ─── entry point, routes, middleware, HTTPS server
    │             ─── DNS IPv4-first preference (avoids broken IPv6 routing)
    │             ─── timestamp wrapper around console.log/error
    │
    ├── settingsCtrl.js      Read / write settings.json. Enforces a key
    │                        whitelist. Returns masked booleans for API key
    │                        fields to remote clients; entirely strips the
    │                        indoorTemperature block (contains a password).
    │
    ├── proxyCtrl.js         Proxies all outbound API calls (Tomorrow.io,
    │                        Mapbox, LocationIQ, sunrise-sunset.org).
    │                        Owns the shared in-memory weather cache
    │                        (persisted to weather-cache.json on shutdown).
    │                        Cache TTLs: 15 min current / 30 min hourly / 6 h daily.
    │
    ├── aiSummaryCtrl.js     Builds a prompt from cached weather data plus
    │                        the radar analyzer's textual snapshots, then
    │                        calls Claude Haiku (Anthropic SDK). Owns its
    │                        own in-memory summary cache (15 min TTL, keyed
    │                        by lat/lon/lang/period). Returns 503 if no key.
    │
    ├── radarAnalyzerCtrl.js Samples the RainViewer radar at 32 (or 56 in
    │                        extended-radius mode) points around the user
    │                        (8 directions × 4 or 7 distances of 5/15/30/45,
    │                        +60/75/90 km) at 3 timestamps (now, -15, -45 min).
    │                        Reads tile pixels via pngjs, classifies against
    │                        the 6-level NEXRAD palette, returns a compact
    │                        textual grid for inclusion in the AI prompt.
    │                        Tile cache: 12 min. Analysis cache: 5 min.
    │
    ├── geolocationCtrl.js   Resolves the Pi's approximate location via
    │                        ipapi.co with retry-with-backoff (5 attempts)
    │                        and a 30-day disk cache (geolocation-cache.json)
    │                        so cold boots survive transient network gaps
    │                        and ipapi outages.
    │
    ├── sensehatCtrl.js      Lightweight JSON endpoint for the Sense HAT
    │                        Python display script (weatherCode, isDay,
    │                        sunriseTs, sunsetTs, etc.). Reads location
    │                        from settings.json, falls back to ipapi.co
    │                        when no custom coordinates are configured.
    │
    ├── indoorTempCtrl.js    Polls Homebridge (homebridge-config-ui-x REST
    │                        API) every 5 minutes for the configured
    │                        sensor. Auto-relogin on JWT expiry. Range-
    │                        based defensive filtering (5..40 °C, 0..100 %,
    │                        AirQuality 1..5). Activated only when
    │                        settings.indoorTemperature.enabled is true.
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
    └── updateChecker.js     Polls the GitHub commits API once per hour to
                             detect newer versions on master. Returns the
                             version string, the SHA, the list of feat/fix
                             commits in the diff, plus two booleans:
                             - serviceFileChanged: would the upgrade modify
                               the systemd service file?
                             - needsManualUpgrade: is the local SHA older
                               than the npm-install-in-update fix (v2.4.1)?
                             Both feed warnings in the UI to gate the
                             one-click button when it would do the wrong
                             thing.
```

### Process-wide bootstrapping (top of `index.js`)

```
require("dns").setDefaultResultOrder("ipv4first")    ← absorb broken-IPv6 LANs
console.log/error wrapped to prepend ISO timestamp   ← printf-style preserved
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

The dev-only `open(URL)` (auto-launch the default browser at startup) is gated on `process.stdout.isTTY` so it only runs when Node was started from an interactive terminal — never in service mode (where it would fight with `start-server`'s kiosk launch).

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
│   ├── MapResizer           Mapbox base tiles (proxied through /api/tiles).
│   ├── PanHandler           Renders the 45 km dashed circle showing the
│   ├── MapClickHandler      area covered by the radar AI analysis when
│   ├── RadarLegend          aiSummaryAvailable is true. When the
│   └── (Leaflet Circle      advanced.ai.extendedRadius flag is on, a
│       + CircleMarker)      second 90 km circle is added; when
│                            advanced.ai.showSamplingPoints is on, small
│                            dots mark each (direction, distance) sample.
│
├── UpdateModal              Slide-up modal triggered by the update badge;
│                            shows changelog, manual command, and three
│                            kinds of advisory notice (service file change,
│                            needs-manual-upgrade, server failure message).
│                            Auto-update button is disabled when the modal
│                            knows one-click would fail or be unsafe.
│
└── InfoPanel                Right column (300 px, full height)
    │
    ├── (clock-container)    Flex row with IndoorTemperature on the left,
    │   ├── IndoorTemperature  Clock on the right. IndoorTemperature renders
    │   │                      null when the feature is not configured;
    │   └── Clock             margin-inline-start: auto on the last child
    │                         keeps the clock right-aligned in either case.
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
  │
  ├── Weather data             currentWeatherData, hourlyWeatherData,
  │                            dailyWeatherData, sunriseSunset, mapGeo
  │
  ├── Feature availability     aiSummaryAvailable    (gates radar circle)
  │                            isLocal, debugEnabled, isSystemd
  │
  ├── UI preferences           darkMode, mouseHide, tempUnit, speedUnit,
  │   (localStorage)           lengthUnit, clockTime, fontSize
  │
  ├── UI state                 settingsMenuOpen, debugMenuOpen,
  │                            infoPanelCollapsed, ...
  │
  └── Update flow              updateAvailable, latestVersion, latestSha,
                               updateCommits, serviceFileChanged,
                               needsManualUpgrade, skippedSha,
                               updateModalOpen, updateState,
                               updateErrorMessage
```

> ⚠️ `AppContext.js` is large and is a known technical debt item. See `ROADMAP.md`.

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

### Cold-boot startup sequence

```
boot
  → systemd starts pi-weather-server.service
  → ExecStartPre loops `getent hosts ipapi.co` until DNS resolves (max 60 s)
  → npm start → node ./server/index.js
  → DNS preference set to ipv4first
  → SSL cert loaded (or auto-generated on first run)
  → HTTPS :8443 listens
  → initIndoorTemperature() schedules the 5-min Homebridge poll
  → start-server (from autostart) detects port open
  → reads ~/.config/pi-weather-station/browser.conf for browser choice
  → launches Chromium / Firefox in kiosk mode → https://localhost:8443
  → React app loads from dist/
  → AppContext: loadStoredData() ← localStorage (units, dark mode, font size)
  → AppContext: getCustomLatLon() ← settings.json via GET /settings
  → AppContext: getBrowserGeo() ← navigator.geolocation (or IP fallback via /geolocation)
  → AppContext: checkIsLocal() ← GET /api/is-local
  → WeatherInfo mounts → GET /api/weather/current, /hourly, /daily
  → AiSummary mounts → GET /api/weather-summary (if Anthropic key present)
  → IndoorTemperature mounts → GET /api/indoor-temperature
  → UpdateModal opens automatically when GET /api/update-check returns updateAvailable=true
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
  → WeatherMap re-renders the 45 km circle around the new mapGeo
```

### AI summary request (with radar paragraph)

```
Client: GET /api/weather-summary?lat=…&lon=…&lang=fr&localHour=14&…
  → aiSummaryCtrl checks summaryCache → miss
  → reads anthropicApiKey from settings.json → 503 if absent
  → reads current/hourly/daily from shared weatherCache (no new API call)
  → calls radarAnalyzerCtrl.analyzeRadar(lat, lon)
      → fetches RainViewer past frames (cached 12 min)
      → for now, -15 min, -45 min: fetches matching tiles, reads pixels at
        the 32 sample points, classifies intensity, formats as text
      → returns a compact "now: clear / -15 min: light NE / -45 min: ..." block
  → builds 1/2/3-paragraph prompt depending on which data is available
  → Anthropic SDK: claude-haiku-4-5 → max_tokens 280 with radar, 150 without
  → stores in summaryCache (TTL 15 min)
  → recordServiceCall("Claude (AI summary)", 200, "OK")
  → returns { summary: "…three paragraphs…" }
```

### Indoor temperature poll loop

```
At server startup (initIndoorTemperature):
  → reads settings.indoorTemperature → if not enabled, returns
  → schedules pollOnce() every 5 min and runs it once immediately

pollOnce():
  → fetchAccessoriesWithRetry(homebridgeUrl, username, password)
      → if no token or token expired, login (POST /api/auth/login)
      → GET /api/accessories with Bearer token
      → on 401, force re-login + retry once
  → filter accessories matching the configured serviceName
  → pick valid temperature, humidity, AirQuality (range-checked)
  → update in-memory cache { value, humidity, airQuality, lastUpdatedMs }
  → recordServiceCall("Homebridge", 200, "OK")

Client: GET /api/indoor-temperature
  → returns the cache (fresh or stale-marked) or 404 when feature is off
```

### One-click update (modern flow, v2.6.2+)

```
User taps Update button (localhost only)
  → POST /api/update
  → server pre-flight checks:
      - git symbolic-ref --short HEAD       (detects detached HEAD)
      - assert current branch == "master"   (detects wrong-branch)
      - git status --porcelain              (detects local changes)
      - any failure → 409 with { reason, message } → modal renders the
        message in a red bordered box and stays on the failed state
  → git pull --ff-only (timeout 30 s)
  → npm install --omit=dev --no-audit --no-fund (timeout 180 s)
  → res.json({ ok: true })
  → setTimeout 500 ms → systemctl --user restart pi-weather-server
                       (or process.exit on macOS / dev mode)
  → client polls GET /api/is-local until the server responds
  → page reloads automatically
```

When the local install is older than v2.4.1, /api/update-check returns
`needsManualUpgrade: true`; the modal disables the button entirely and
displays `cd ~/pi-weather-station && git pull && bash deploy/install.sh`
as the only viable recipe.

---

## 6. Deployment architecture

### Linux (Raspberry Pi OS, Debian / Ubuntu, openSUSE)

```
~/.config/systemd/user/
  └── pi-weather-server.service          Main unit (with ExecStartPre)
  └── pi-weather-server.service.d/
        ├── override.conf                Log redirect, ALLOW_REMOTE, DEBUG
        └── nvm.conf                     Bullseye 32-bit only — sources nvm
  └── pi-sensehat.service                Optional — Sense HAT LED display

~/.local/bin/
  └── start-server                       Waits for server, launches the
                                         configured browser in kiosk mode
                                         (reads browser.conf for the choice).

~/.config/pi-weather-station/
  └── browser.conf                       BROWSER_CMD, BROWSER_FAMILY
                                         (chromium-family or firefox)

Display server / desktop autostart (one of):
  ~/.config/labwc/autostart              Trixie / Debian 13
  ~/.config/wayfire.ini [autostart]      Bookworm / Debian 12
  ~/.config/lxsession/LXDE-pi/autostart  Bullseye / Debian 11
  ~/.config/autostart/*.desktop          GNOME, KDE Plasma, MATE, Cinnamon,
                                         XFCE — anything honouring the
                                         freedesktop.org XDG autostart spec
```

### macOS

```
~/Library/LaunchAgents/
  └── com.pi-weather-station.plist       launchd user agent (kept in sync
                                         by install.sh; opens the URL in
                                         the default browser via launchd
                                         when the user logs in)
```

### Update flows on the target

```bash
# In-app: from the kiosk's update modal — handled by /api/update
# (git pull + npm install + restart) when local is v2.4.1+.

# Manual (recommended for v2.3.x → v2.6.x or any release that changes
# the systemd service file):
cd ~/pi-weather-station && git pull && bash deploy/install.sh
```

`dist/` is committed to git so the compiled React bundle is always available without a Node.js toolchain rebuild on the Pi.

---

## 7. Architecture decision records (ADR)

### ADR-01 — All keyed external API calls proxied server-side

**Decision:** Every call to Tomorrow.io, Mapbox, LocationIQ, sunrise-sunset.org, ipapi.co, Anthropic, and Homebridge is made by the Express server, never by the browser. The single exception is RainViewer radar tiles, which require no key.

**Rationale:** API keys would be visible in browser network logs if called client-side. Server-side proxying also enables a shared cache: all connected browsers benefit from the same cached response, reducing quota consumption.

**Consequences:** Adds a server hop for every data fetch. Acceptable given the LAN context and 15–360 min cache TTLs.

---

### ADR-02 — `dist/` committed to git

**Decision:** The compiled webpack bundle (`client/dist/`) is committed alongside source code.

**Rationale:** Raspberry Pis update with `git pull` + service restart. Requiring a webpack build on the Pi would add a Node.js build toolchain dependency on every device, and would make updates slower and riskier on low-RAM Pi models.

**Consequences:** The dist/ files must be rebuilt and committed on the development machine before every push that touches client source. `npm run prod` must be run and the result staged explicitly.

---

### ADR-03 — Single AppContext for all shared state

**Decision:** All global state (settings, weather data, UI preferences, panel state, update flow) lives in one React Context (`AppContext.js`).

**Rationale:** Appropriate for the project's size at the time. A single context is simple to reason about and avoids prop drilling across the component tree.

**Consequences:** `AppContext.js` has grown large and is now a known technical debt item. As the project grows, splitting into focused contexts (`SettingsContext`, `WeatherContext`, `UIContext`, `UpdateContext`) should be considered. See `ROADMAP.md`.

---

### ADR-04 — CSS `zoom` for font size scaling

**Decision:** Font size scaling (S/M/L) is implemented via the CSS `zoom` property on the InfoPanel container, not via `font-size` or CSS custom properties on individual elements.

**Rationale:** `zoom` scales the entire subtree uniformly — all text, spacing, icons, and chart containers — without requiring changes to individual components. A `font-size` approach would require explicit `em`-based sizing throughout every component.

**Consequences:** Two compensations are required: `height: calc(100dvh / zoom)` to prevent grey areas or hidden controls, and a counter-zoom (`zoom: 1/parentZoom`) on chart wrappers so Chart.js measures the container in its natural coordinate space.

---

### ADR-05 — Caches persisted to disk

**Decision:** Both the server-side weather cache and the geolocation result are saved to disk (`server/weather-cache.json`, `server/geolocation-cache.json`) and reloaded at startup.

**Rationale:** Without persistence, every server restart (deployment, crash, reboot) would trigger a fresh set of Tomorrow.io API calls and an ipapi.co lookup. The Pi reboots on power loss; cache persistence avoids exhausting the daily quota on restart days, and avoids a "cold boot blank screen" when ipapi briefly fails.

**Consequences:** Cache files must be excluded from git (they are). On first start there is no cache and API calls fire normally.

---

### ADR-06 — HTTPS with auto-generated self-signed certificate

**Decision:** The server runs exclusively over HTTPS using a self-signed certificate generated at first launch.

**Rationale:** Avoids mixed-content browser errors when the page (served over HTTPS) makes fetch calls to the same server. Also ensures traffic between the Pi and remote browsers on the LAN is encrypted.

**Consequences:** Browsers show a security warning on first visit. Users must accept the exception once. For remote access with a valid certificate, the Pi's IP must be included as a SAN — `install.sh` handles this automatically. Firefox kiosks use a dedicated named profile (managed by Firefox itself, snap-friendly) so the acceptance persists across launches.

---

### ADR-07 — `ExecStartPre` waits for DNS before launching Node

**Decision:** The systemd service has an `ExecStartPre` that blocks until `getent hosts <external-host>` succeeds (or 60 s elapses).

**Rationale:** On cold boot, the user session can come up before the network stack is fully usable. The first wave of outbound HTTP from Node would otherwise fail with `ENOTFOUND`/`EAI_AGAIN`, leaving non-retrying components (sunrise/sunset, reverse geocoding) blank in the kiosk until the next page load.

**Consequences:** Adds a few seconds to startup time. Worth it for a clean cold-boot experience. Combined with `dns.setDefaultResultOrder("ipv4first")` to absorb networks that advertise broken IPv6 routes.

---

### ADR-08 — In-app updater runs `npm install` and pre-flight checks

**Decision:** `POST /api/update` runs three pre-flight checks (detached HEAD, branch, local changes) before pulling, then runs `npm install --omit=dev` between `git pull` and the service restart. Each known failure mode returns a structured 409 with a human-readable hint.

**Rationale:** Originally the endpoint was just `git pull && restart`. A v2.3.0 → v2.6.0 rollback test surfaced four failure modes: detached HEAD (cryptic git error), wrong branch (wrong-remote pull), local changes (silent overwrite refusal), and missing dependencies after pulling new code. Each one gave a generic "Failed" with no actionable signal.

**Consequences:** The endpoint is now more conservative — it refuses to do destructive work on a misconfigured repo, and surfaces what the user needs to fix. Adds ~3 s for the npm install step on idempotent runs. The modal disables the auto button entirely when the local install is too old to be safely upgraded that way (`needsManualUpgrade`).

---

### ADR-09 — Browser choice persisted in `~/.config/pi-weather-station/browser.conf`

**Decision:** `install.sh` detects all installed browsers (Chromium-family and Firefox), prompts the user to pick one, and persists the choice. `start-server` reads this file at launch and uses family-specific kiosk flags.

**Rationale:** Different distributions ship different browsers as the default. Hard-coding Chromium in `start-server` works for Pi OS but breaks on Ubuntu (Firefox-only) and openSUSE (Firefox-default). Two browser families need different kiosk flags: Chromium-based use `--kiosk --noerrdialogs ...`; Firefox uses `-P <named-profile>` so the self-signed-cert acceptance persists, and to stay compatible with the snap-confined Firefox on Ubuntu where arbitrary `--profile <path>` doesn't work.

**Consequences:** The browser choice survives upgrades. Users can switch by re-running `install.sh` or editing the conf file directly. `start-server` falls back to auto-detecting Chromium when the conf file is absent (backward compatible with installs that pre-date this feature).

---

## 8. Known limitations

| Limitation | Impact | Tracked in |
|---|---|---|
| No automated tests | Regressions not caught automatically | ROADMAP.md |
| `AppContext.js` too large | Growing harder to navigate | ROADMAP.md |
| Service file customizations live in the main unit, not a drop-in | The in-app updater can't safely overwrite the service file when it changes upstream | ROADMAP.md |
| Debug panel rows for `vcgencmd` show empty on x86 | Pi-specific monitoring fields are blank on Ubuntu/openSUSE deployments | ROADMAP.md |
| No offline mode | Blank panel on internet outage (geolocation cache helps, but live weather doesn't) | ROADMAP.md |
| Self-signed certificate | Browser warning on first visit | — (by design) |
| `eslint-disable-line` suppressions | Hidden assumptions in hooks | ROADMAP.md |
| Version history in both readme.md and CHANGELOG.md | Manual sync required | ROADMAP.md |
