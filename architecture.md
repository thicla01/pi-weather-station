# Pi Weather Station — Software Architecture

*Last updated: 2026-10-08 — current as of v3.3.0*

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
| **Security** | Keys never leave the Pi | All keyed external calls proxied server-side; remote clients receive masked booleans; passwords (Homebridge) entirely stripped from remote `/settings` responses |
| **UI responsiveness** | < 500 ms for interactions | React local state; weather data pre-cached; no blocking calls on render |
| **Maintainability** | Deployable with `git pull` | `dist/` committed to git; in-app updater runs `npm ci --omit=dev` between pull and restart; pre-flight checks catch the common failure modes |
| **Touchscreen usability** | No keyboard, fat-finger friendly | Native touch scrolling, large tap targets, layouts tuned for 800×480 (priority-view Pi rail at `max-height: 540px`) |
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
                                         │  /api/weather/openmeteo  (PoC adapter)  │
                                         │  /api/tiles/*         → pass-through    │
                                         │  /api/reverse-geocode                   │
                                         │  /api/sunrise-sunset  (date param)      │
                                         │  /api/weather-summary  → AI cache       │
                                         │  /api/air-quality     → orchestrator    │
                                         │  /api/weather-alerts  → gov alerts      │
                                         │  /api/nearby-alerts   → map overlay     │
                                         │  /api/radar-risk      → ring tiers      │
                                         │  /api/pollen          → Open-Meteo      │
                                         │  /api/sensehat        → cache + ipapi   │
                                         │  /api/indoor-temperature → 5-min cache  │
                                         │  /api/health          → service status  │
                                         │  /api/cert.pem        → PWA cert        │
                                         │  /api/update-check    → 1-hour cache    │
                                         │  /api/update          (localhost only)  │
                                         │  device-control POSTs (localhost only)  │
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
**Center** — the Pi is the gateway for all keyed APIs; no client ever reaches Tomorrow.io / Mapbox / LocationIQ / EPA AirNow / OpenAQ / Anthropic / Homebridge directly. RainViewer radar tiles and frame index (and ECCC GeoMet WMS radar when the ECCC radar source is selected) are the exception — the client fetches them directly because they require no key.
**South-internet** — keyed external APIs reachable only from the Pi
**South-LAN** — Homebridge sits on the same network (often a separate IoT VLAN); used by the optional indoor-temperature feature

*Abridged:* the box lists the main routes; the full list — including `/api/is-local`, `/geolocation`, `/api/update-check/force` and the localhost-only device-control writes (`/api/brightness`, `/api/display-scale`, `/api/relaunch-kiosk`, the `/api/sensehat-*` setters, `/api/kiosk-location`) — is in [`docs/api.md`](docs/api.md). `/api/tiles/*` keeps no server-side cache: tiles pass straight through from Mapbox and are cached by the browser only (the `/api` `no-store` middleware exempts them). The south row shows the core services only; the server also calls NWS, ECCC (alerts + AQHI), MELCC, EPA AirNow, OpenAQ, Open-Meteo (pollen + PoC weather) and GitHub (update check), and samples RainViewer itself in `radarAnalyzerCtrl` (AI summary, `/api/radar-risk`, Sense HAT grid) — full table under *External Services* in `CLAUDE.md`.

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
    │                        (saved to weather-cache.json every 5 min and
    │                        on SIGTERM/SIGINT; expired entries kept 24 h
    │                        for stale-on-error fallback; pruned to ≤ 512
    │                        entries on the same 5-min pass).
    │                        Cache TTLs: 15 min current / 30 min hourly / 6 h daily.
    │
    ├── aiSummaryCtrl.js     Builds a prompt from cached weather data plus
    │                        the radar analyzer's textual snapshots, then
    │                        calls Claude Haiku (Anthropic SDK). Owns its
    │                        own in-memory summary cache (15 min TTL, keyed
    │                        by lat/lon/lang/period + temp/speed/distance
    │                        units). Returns 503 if no key.
    │
    ├── radarAnalyzerCtrl.js Samples the RainViewer radar around the user at
    │                        3 timestamps (now, -15, -45 min). Geometry is
    │                        configurable: inner ring is always 16 directions
    │                        × 10 distances (5 km steps from 5 to 50 km);
    │                        outer ring (32 directions × 10 distances, 5 km
    │                        steps from 55 to 100 km) is opt-in via
    │                        advanced.ai.extendedRadius.
    │                        advanced.ai.radarAnalysisEnabled = false skips
    │                        it for the AI summary and stops the kiosk's
    │                        /api/radar-risk poll (the Sense HAT radar/auto
    │                        modes still sample).
    │                        Reads tile pixels via pngjs, classifies against
    │                        the 6-level NEXRAD palette. Exports analyzeRadar
    │                        (compact textual grid for the AI prompt),
    │                        getRiskLevels (/api/radar-risk ring tiers +
    │                        trends) and buildRadarGrid (Sense HAT 8×8 grid).
    │                        Tile cache: 60 min. Analysis cache: 5 min.
    │
    ├── airQualityCtrl.js    Air-quality orchestrator over airQualitySources/
    │                        (MELCC Montréal, MELCC RSQAQ, EPA AirNow,
    │                        OpenAQ queried in parallel — closest station
    │                        wins; ECCC AQHI as the fallback).
    │
    ├── govAlertsCtrl.js     Gov severe-weather alerts orchestrator over
    │                        govAlertSources/ (NWS point query, ECCC
    │                        point-in-polygon; nwsZones.js resolves zone-only
    │                        NWS alerts to polygons, 24 h cache). Sources run
    │                        in parallel; one failing never blanks the other.
    │
    ├── pollenCtrl.js        Pollen badge — Open-Meteo Air Quality API,
    │                        worst case of 6 allergens.
    │
    ├── openMeteoCtrl.js     PoC Open-Meteo weather adapter returning the
    │                        Tomorrow.io envelope shape (source comparison).
    │
    ├── geolocationCtrl.js   Resolves the Pi's approximate location via
    │                        ipapi.co with retry-with-backoff (5 attempts)
    │                        and a 30-day disk cache (geolocation-cache.json)
    │                        so cold boots survive transient network gaps
    │                        and ipapi outages.
    │
    ├── sensehatCtrl.js      Lightweight JSON endpoint for the Sense HAT
    │                        display daemons (sensehat_weather.py,
    │                        horloge.py): weatherCode, isDay, sunriseTs,
    │                        sunsetTs, mode, radarBrightness, etc., plus an
    │                        optional radar 8×8 grid (radar/auto modes) and
    │                        red/orange gov alert. Location: kiosk-location
    │                        cache → settings.json startingLat/Lon →
    │                        ipapi.co (1 h cache).
    │
    ├── sensehatModeCtrl.js  Sense HAT mode / availability / LED-brightness
    │                        endpoints; switches the pi-sensehat ↔
    │                        pi-sensehat-clock systemd units.
    │
    ├── kioskLocationCtrl.js In-memory cache of the kiosk's currently-viewed
    │                        map coordinates (POST /api/kiosk-location,
    │                        localhost only); consumed by /api/sensehat.
    │
    ├── indoorTempCtrl.js    Polls Homebridge (homebridge-config-ui-x REST
    │                        API) every 5 minutes for the configured
    │                        sensor. Auto-relogin on JWT expiry. Range-
    │                        based defensive filtering (5..40 °C, 0..100 %,
    │                        AirQuality 1..5). The loop always runs; each
    │                        tick re-reads settings.indoorTemperature and
    │                        no-ops while it is disabled, so enabling it
    │                        needs no server restart.
    │
    ├── brightnessCtrl.js    GET/POST /api/brightness — screen brightness via
    │                        sysfs backlight (Pi) or DDC/CI (monitors).
    │
    ├── displayScaleCtrl.js  GET/POST /api/display-scale + POST
    │                        /api/relaunch-kiosk — manages the DISPLAY_SCALE
    │                        line in browser.conf (kiosk device-scale
    │                        override); relaunch spawns
    │                        deploy/relaunch-kiosk.sh detached.
    │
    ├── debugCtrl.js         Aggregates all diagnostic data for the debug
    │                        panel: system info, KPIs, provider status,
    │                        weather + AI cache state, quota counters,
    │                        service call history, security events, logs.
    │                        Always restricted to localhost.
    │
    ├── healthCtrl.js        GET /api/health — red/yellow/green roll-up of
    │                        external-service statuses (serviceStatus).
    │
    ├── serviceStatus.js     In-memory journal of the last HTTP status and
    │                        timestamp for every external API call.
    │
    ├── requestCounter.js    Per-service/endpoint counters (hourly, daily,
    │                        monthly) persisted to request-counts.json.
    │                        Compared against quota limits in the debug panel.
    │
    ├── responseTimer.js     Express middleware. Records response time for
    │                        every non-static route (404s skipped); exposes
    │                        count/avg/min/max per endpoint.
    │
    ├── clientTracker.js     Records first-seen / last-seen / request count
    │                        per remote client, keyed on the socket peer
    │                        (never req.ip); capped at 1000 entries.
    │
    ├── securityHeaders.js   Baseline security-header middleware, mounted
    │                        first (nosniff, X-Frame-Options DENY,
    │                        no-referrer, CSP frame-ancestors 'none').
    │
    ├── rateLimitKey.js      Rate-limit bucket key derived from the TCP
    │                        socket peer — never req.ip / X-Forwarded-For.
    │
    ├── boundedCache.js      BoundedMap + expiry-sweep primitives that cap
    │                        the in-memory caches (OOM guard).
    │
    ├── singleFlight.js      Concurrency guards: single-flight (409) for
    │                        POST /api/update, per-peer in-flight cap (429)
    │                        for /api/nearby-alerts.
    │
    └── updateChecker.js     Queries the GitHub commits API on demand (result
                             cached 1 h; the client polls every 6 h) to
                             detect newer versions on master. Returns the
                             version string, the SHA, the list of
                             user-facing commits (feat / fix / perf / style /
                             polish / ux / release / chore(deps)) in the
                             diff, plus two fields:
                             - changedDeployFiles: installed deploy
                               artefacts (pi-weather-server.service +
                               start-server on Linux, the launchd plist on
                               macOS) whose SHA-256 differs from the
                               upstream master copy (null when nothing
                               could be compared)
                             - needsManualUpgrade: is the local SHA older
                               than the npm-install-in-update fix (v2.4.1)?
                             Both feed warnings in the UI to gate the
                             one-click button when it would do the wrong
                             thing.
```

### Process-wide bootstrapping (top of `index.js`)

```
require("dns").setDefaultResultOrder("ipv4first")    ← absorb broken-IPv6 LANs
console.log/error wrapped to prepend local timestamp ← [YYYY-MM-DD HH:MM:SS], printf-style preserved
```

### Middleware stack (applied in order)

```
app.disable("x-powered-by")
securityHeaders           ← mounted first: nosniff, X-Frame-Options DENY,
                            no-referrer, CSP frame-ancestors 'none'
bodyParser.json()
express.static()          ← serves client/dist/ (tiered Cache-Control)
responseTimerMiddleware   ← records latency for every non-static route (404s skipped)
/api Cache-Control        ← no-store on every /api/* response except /api/tiles
trust proxy = 1           ← only when ALLOW_REMOTE (affects req.ip, which no gate reads)
req.isLocal assignment    ← true if the SOCKET PEER (req.socket.remoteAddress) is
                            127.0.0.1 / ::1 / ::ffff:127.0.0.1 — never req.ip, which
                            honours X-Forwarded-For under trust proxy
  └── recordClient(socket peer) ← logs remote peers (non-local only)
```

Then per-route middleware: `localhostOnly`, `debugLocalhostOnly`, `apiLimiter` (120/min) and `tileLimiter` (600/min) — both limiters keyed on the socket peer via `rateLimitKey.socketPeerKeyGenerator` — plus `updateGuard` (single-flight, 409 `update-in-progress` on `POST /api/update`) and `nearbyAlertsConcurrencyGuard` (max 3 in flight per remote peer, 429, local kiosk exempt, on `GET /api/nearby-alerts`).

The dev-only `open(URL)` (auto-launch the default browser at startup) is gated on `process.stdout.isTTY` so it only runs when Node was started from an interactive terminal — never in service mode (where it would fight with `start-server`'s kiosk launch).

---

## 4. Client architecture

The React frontend (`client/src/`) uses a single global context for shared state and CSS Modules for style isolation.

### Layout variants (v3 / Direction C)

Since v2.15 (Direction C introduced in v2.14 with `LayoutPi` + `LayoutDesktop`; `LayoutMobile` added in v2.15) the kiosk renders one of three responsive layouts under a shared `AmbientLayers` root. The dispatcher reads `window.matchMedia` and reflows live on viewport changes (no reload):

| Width | Layout | Audience |
|---|---|---|
| ≤ 799 px | **LayoutMobile** | Phone portrait (375-430 px iPhone / Android) — single scrollable column, mini radar with maximize button, pull-to-refresh |
| 800-1279 px | **LayoutPi** | 7" / 10" Pi kiosk + small windows — map + rail split driven by `piLayoutState`: MIN (radar only) / MID (default split) / MAX (map thumbnail, forecast fills the rail) + the full-rail `ai` view; a ≤ 540 px-high viewport (e.g. the 7" 800×480) swaps the rail for the v3.3 priority-views glance (+ `conditions` / `alert` views) — state diagram in the `LayoutPi` JSDoc |
| ≥ 1280 px | **LayoutDesktop** | HD monitor + desktop — full-bleed map background, floating HeroBand + rail, the `RadarFocusControl` overlay button hides them for full radar view |

Full layout reference (with safe-area / PWA notes) in [`docs/ui-layout_fr.md`](docs/ui-layout_fr.md) and [`_en.md`](docs/ui-layout_en.md).

### Component tree (v3)

```
App                               Root — mounts the overlays and AmbientLayers as
│                                 siblings. SettingsPanel + DebugPanel compute
│                                 their own palette tokens: CSS custom properties
│                                 don't propagate to siblings (see App/index.js)
│
├── SettingsPanel                 Overlay — API keys, units, language, advanced,
│                                 PWA cert download
├── DebugPanel                    Overlay — services / quotas / system info
│                                 (localhost only)
├── UpdateModal                   In-app updater
│
├── AmbientLayers                 CSS-variable root — sets palette tokens (day/dusk/
│   │                             night/nightRed) per useTimeOfDay(), tracks viewport
│   │                             breakpoints, paints body bg in JS for iOS PWA gap
│   │                             coverage, applies --c-font-scale to scrollable subtrees
│   │
│   └── LayoutMobile / LayoutPi / LayoutDesktop   (one renders at a time)
│       │   [Pi] = LayoutPi only · [D/M] = LayoutDesktop + LayoutMobile only.
│       │   Per-state Pi rail: LayoutPi JSDoc + docs/ui-layout_{en,fr}.md
│       │
│       ├── WeatherMap                Leaflet map with RainViewer (or ECCC WMS) radar
│       │   │                         + Mapbox tiles
│       │   ├── MapResizer            invalidateSize on rail/maximize/focus toggles
│       │   ├── PanHandler            Programmatic re-centering with rail-offset math
│       │   ├── RailOffsetTracker     Pans marker when rail width changes
│       │   ├── MapClickHandler       Click-to-recenter with 200 ms debounce
│       │   ├── RadarFocusControl     Overlay button under the zoom stack — hides
│       │   │                          hero+rail on LayoutPi and LayoutDesktop
│       │   │                          (standalone button since v3.1 Phase 3, was a
│       │   │                           Leaflet bar control before)
│       │   ├── RiskRing              Dashed analysis rings (one or two stacked circles
│       │   │                          based on risk tier + theme; see geometry.js)
│       │   ├── RingLabels            On-map radius chips (50 km / 30 mi; extended
│       │   │                          ring 100 km / 60 mi)
│       │   ├── AlertGeometryOverlay  Gov-alert polygons
│       │   ├── NearbyAlertsOverlay   Nearby-alerts overlay (+ survey tap popup)
│       │   ├── RadarTimeline         Bottom-of-map scrubber + playhead + speed cycler
│       │   ├── RadarLegend           Precipitation-tier legend overlay
│       │   └── (Leaflet Marker)      Marker uses bundled L.Icon.Default + npm Leaflet
│       │
│       │   Pure helpers in `WeatherMap/geometry.js`:
│       │   - offsetLatLon, buildArrowPath, buildSamplingPoints, panWithRailOffset
│       │   - tierForIntensity, buildRingLayers, hasVal
│       │   - tierColour, buildAlertPolygonLayers, buildRadiusRingOptions,
│       │     pointInGeometry (alert-polygon + radius-ring helpers)
│       │   - RING_RISK_STYLE / DOT_COLOR_BY_TIER / ARROW_COLOR / RADAR_GEOMETRY
│       │     / KM_PER_UNIT / METERS_PER_UNIT / BEARING_TO_DIR_* + reverse maps
│       │
│       ├── FloatingMiniBanner        Gov-alert chip over the map while the radar is
│       │                             focused (Pi MIN / Desktop) or maximized (Mobile)
│       ├── HeroBand / HeroCompact / TimeBlock    Layout-specific hero surfaces
│       ├── AlertBanner               Alert head — gov (NWS/ECCC) and radar-derived
│       │                             (RADAR) alerts; on the Pi rail the radar branch
│       │                             is suppressed (NowcastLine carries it)
│       ├── AlertDetailInline         Expandable detail w/ QR (grows natural height)
│       │                             (Pi: not in the priority-views glance)
│       ├── AlertMiniCards            Other active alerts + "restore hidden alerts"
│       │                             pill (Pi: the pill only)
│       ├── AirAlertCard        [Pi]  AIR health-risk card (AQ category high /
│       │                             veryHigh) — AIR alerts never use AlertBanner
│       ├── NowcastLine         [Pi]  Status-only RADAR line, always present
│       ├── AirCard                   AQ (+ optional pollen) rows above the grid
│       ├── MetricsGrid               2×2 cells — wind / gust / UV / humidity
│       │                             (extended: + pressure / visibility in the Pi
│       │                              Conditions view); qualifiers coloured via
│       │                              the `--mx-cat-*` palette tokens
│       ├── IndoorBlock               Homebridge indoor temp (renders null when off)
│       │                             (Pi priority-views glance: MetricsGrid +
│       │                              IndoorBlock move into ConditionsView)
│       ├── ChartTabs                 24 h / 5 days tabbed forecast (Chart.js)
│       │   │                         (Pi: shown in the MAX state only)
│       │   ├── HourlyForecastColumns
│       │   └── DailyForecastColumns  (minmax(0,1fr) grid + sub-799px tightening)
│       ├── AiSummaryInline    [D/M]  Claude summary w/ maximize button
│       ├── AiView              [Pi]  Full-rail "ai" state, every Pi panel (fetches
│       │                             via components/hooks/useAiSummary)
│       ├── ConditionsView / AlertView   [Pi]  v3.3 priority views (≤ 540 px
│       │                                      height only)
│       └── BottomDock
│           ├── ControlButtons        Map: recenter, places, marker, timeline†,
│           │   │                     arrows, legend†, nearby alerts (+ radar rings
│           │   │                     when local + DEBUG); Views: AI view + forecast
│           │   │                     (Pi dock only; elsewhere a local-debug
│           │   │                     AI-summary hide toggle); Display: contrast,
│           │   │                     auto, nightRed; System: refresh, settings
│           │   │                     (+ debug when local + DEBUG, update when
│           │   │                     available). † RainViewer source only.
│           │   │                     Secondary buttons hidden ≤600px portrait
│           │   │                     via data-dock-priority="secondary"
│           │   └── PlacesPopover     Favorite locations (mounted while open)
│           └── HealthIndicator       Coloured dot + popover — polls /api/health,
│                                     green/yellow/red, listing failing services
│
└── ScreenSaver                   Sleep-mode stage 1 (clock) + stage 2 (anti-burn-in dot)
```

The legacy v2 component tree (`InfoPanel` / `CurrentWeather` / `Clock` / `WeatherInfo` / `UvAqiBadges` / `Settings` / `Debug` / …) was **deleted in 2026-07**, together with the `experimentalUiC` flag that used to select it. The tree above is therefore the whole client at the surface level (leaf primitives such as `SourceBadge` or `DetailsPopover` are omitted) — there is no second UI path. Six directories sit under `client/src/components/` outside `ambient/`, and v3 consumes all of them:

| Directory | Role in v3 |
|---|---|
| `App/` | Root — mounts `AmbientLayers` plus the sibling overlays `SettingsPanel`, `DebugPanel`, `UpdateModal`, `ScreenSaver` |
| `AmbientLayers/` | Palette / breakpoint dispatcher, picks the layout variant |
| `WeatherMap/` | Leaflet radar map + its overlays and `geometry.js` helpers |
| `LocationName/` | Reverse-geocoded place name, imported by `HeroBand` / `HeroCompact` |
| `UpdateModal/` | In-app updater UX |
| `ScreenSaver/` | Sleep-mode stages 1 and 2 |

Plus two hook directories: `components/hooks/` (`useAiSummary`) and `~/hooks/` (`useUpdateChecker`, `useScreenSaver`, `useUiPreferences`, `useIdleDetection`, `useDismissedAlerts`, `useAutoTabSelector`, `useDisplayScale`, `useEligibleGovAlerts`, `useSenseHatMode`, `useFavoriteLocations`).

> ⚠️ Naming trap for anyone reading pre-July commits: `ambient/AlertBanner` is a **different, live** component from the deleted `components/AlertBanner`. Same for `ambient/AiSummaryInline`, `ambient/IndoorBlock`, `ambient/SettingsPanel` and `ambient/DebugPanel` — those are the v3 surfaces and were never removed.

### State management

All shared state lives in `AppContext.js` (React Context + `useState`). Components read from context and call setter functions exposed by the context value. As of v2.18, three coherent clusters have been extracted into dedicated hooks under `~/hooks/` — AppContext composes them via `useUpdateChecker()` / `useScreenSaver()` / `useUiPreferences()` and re-exports their returns through the context, so consumers don't see any difference at the call site. Since then `useDisplayScale`, `useSenseHatMode`, `useIdleDetection` and `useFavoriteLocations` have joined the same way, so AppContext now composes seven hooks. The value is additionally published through seven sliced contexts — `AppActionsContext`, `SystemContext`, `LocationContext`, `UiPrefsContext`, `WeatherDataContext`, `AlertsContext`, `RadarStateContext` — so a component subscribes only to the slice it reads (most of the v3 `ambient/` tree uses these; the original catch-all `AppContext` export remains and is still what about a dozen components import when they need several slices at once).

```
AppContext
  ├── Settings (from server)        weatherApiKey, mapApiKey, reverseGeoApiKey,
  │                                 anthropicApiKey, customLat, customLon
  │
  ├── Weather data                  currentWeatherData, hourlyWeatherData,
  │                                 dailyWeatherData, sunriseSunsetToday /
  │                                 sunriseSunsetTomorrow, mapGeo
  │
  ├── Feature availability          aiSummaryAvailable (dims the neutral radar
  │                                 ring via `aiOff`; the rings themselves are
  │                                 gated on `radarAnalysisEnabled`),
  │                                 isLocal, debugEnabled, isSystemd
  │
  ├── useUiPreferences hook         tempUnit, speedUnit, lengthUnit,
  │   (localStorage-backed,         distanceUnit, pressureUnit, clockTime,
  │    first-launch locale seed)    fontSize + save* helpers
  │
  ├── useScreenSaver hook           brightnessPercent + setBrightnessLive
  │   (brightness + sleep mode)     sleepEnabled, sleepStage1Delay,
  │                                 sleepStage1Brightness, sleepStage2*,
  │                                 sleepNightMode + their setters
  │
  ├── useUpdateChecker hook         updateAvailable, latestVersion, latestSha,
  │   (in-app update flow)          updateCommits, changedDeployFiles,
  │                                 needsManualUpgrade, skippedSha,
  │                                 updateModalOpen, updateState,
  │                                 updateErrorMessage, serverPlatform,
  │                                 isSystemd, refreshUpdateCheck,
  │                                 triggerUpdate, saveSkippedSha
  │
  ├── useDisplayScale hook          displayScaleAvailable, displayScaleOverride,
  │   (kiosk device-scale           displayScaleAuto, displayScaleApplied,
  │    override)                    displayScalePpi, displayScaleChoices,
  │                                 saveDisplayScale, relaunchKiosk
  │
  ├── useSenseHatMode hook          senseHatAvailable, senseHatMode,
  │   (Sense HAT display mode)      senseHatClockBrightness,
  │                                 senseHatRadarBrightness + their setters
  │
  ├── useIdleDetection hook         sleepStage (0 / 1 / 2), fed by the
  │   (idle watcher)                useScreenSaver sleep settings
  │
  ├── useFavoriteLocations hook     favorites, pin / remove / rename /
  │   (Places, settings.json)       hydrate, canPin*, maxFavorites
  │
  ├── UI preferences (inline)       darkMode, mouseHide,
  │                                 hideRadarLegend, radarSource
  │
  ├── UI state (inline)             settingsMenuOpen, debugMenuOpen,
  │                                 panToCoords, mobileRadarMaximized,
  │                                 piRadarMaximized,
  │                                 desktopRadarMaximized, ...
  │
  ├── Weather poll effect           gated on `weatherApiKey && mapGeo`,
  │                                 fires current/hourly/daily updates +
  │                                 the periodic 10 min / 1 h / 24 h
  │                                 intervals
  │
  └── advanced.* PATCH chain        buildAdvancedSubtree(overrides) + the five
                                    save helpers that call it — ai / pollen /
                                    display / sleep / alerts.radius
                                    (centralised in v2.18.1)
```

> ⚠️ `AppContext.js` is ~2900 lines — further hook extractions (useLocation, useWeatherData) are tracked in `ROADMAP.md` as past the diminishing-returns line. The current arrangement is a workable middle ground: seven clusters (update checker, screen saver, UI prefs, display scale, Sense HAT mode, idle detection, favorites) live in their own hooks, the rest stays inline. (The v2-tree deletion in 2026-07 removed the `experimental` branch of the PATCH chain along with `saveAdvancedExperimentalFlag()`; it did not shrink the file materially, because the state the v3 tree needs was never the v2 tree's.)

### Responsive adaptations

Detected two ways, both live (no reload): `window.matchMedia` listeners where JS has to branch (the layout dispatch in `AmbientLayers`, the WeatherMap legend / timeline gates), and plain CSS `@media` queries for styling-only changes (the panels' compact grids, the `LayoutMobile` landscape mapCard, the dock's portrait row). The 540 px row below is the exception — read per render, not watched.

| Trigger | Effect |
|---|---|
| `width ≤ 799 px` | Switch to `LayoutMobile` (single column, mini radar with maximize button, pull-to-refresh) |
| `width 800-1279 px` | `LayoutPi` (map + rail split; `piLayoutState` MIN / MID / MAX + the `ai` view) |
| `width ≥ 1280 px` | `LayoutDesktop` (full-bleed map + floating panels + `RadarFocusControl` overlay button) |
| `max-height ≤ 520 px` | SettingsPanel + DebugPanel switch to compact 2-column layouts; WeatherMap collapses the radar legend to its (i) chip where the map can't spare the room (timeline open, or the Pi MID pane) and uses the compact timeline; on `LayoutMobile` in landscape the mini mapCard shrinks to 160 px. ChartTabs has no height gate. |
| `max-height ≤ 540 px` (read per render by `priorityViewsEnabled()` in `ui/piLayout.js`, not a live listener; also forceable via the `forcePriorityViews` localStorage key) | `LayoutPi` switches to the v3.3 priority-views glance rail (+ `conditions` / `alert` full-rail views). Deliberately a **separate threshold** from 520 — don't unify the two queries |
| `(max-width: 600px) and (orientation: portrait)` (was 479 px) | Dock hides `data-dock-priority="secondary"` buttons (timeline / arrows / legend / nearby alerts / auto / nightRed; timeline + legend stay while the mobile radar is maximized) — essentials only. Group spacing tightens further at ≤ 479 px |

### Font size zoom model

Within the layouts, `zoom: var(--c-font-scale)` (S=0.85, M=1.0, L=1.15) is applied to the scrollable rail only — `.rail` in `LayoutPi` and `LayoutDesktop`. Two boundaries were established by trial:

- **Not the `AmbientLayers` root.** It broke positioning of `position: absolute` children, because `100dvh` references inside the layout no longer matched the zoomed root.
- **Not `LayoutDesktop`'s `heroSlot`.** Phase 7 polish briefly zoomed it too, but `zoom` expands a box visually without updating the layout engine's geometry: at scale 1.15 the slot painted ~968 px wide while its declared width stayed 842, the (also zoomed) rail marched left, and the clock got clipped by a ~150 px overlap. The hero is large enough at native size, so it stays unzoomed; `heroSlot`'s `right` offset instead multiplies `--c-rail-width` by `--c-font-scale` so the gap to the rail holds at every preference.

Scoping to the rail keeps the map at native resolution while the user's text-density preference still has visible effect.

**Two strategies, one variable.** `--c-font-scale` is consumed two different ways, and mixing them is the recurring trap:

| Where | How | Rule for new code |
|---|---|---|
| Inside the rail (`.rail` subtree) | The rail's `zoom` scales the whole subtree | Size in plain `px`. An extra `calc(… * var(--c-font-scale))` here **double-scales** (1.32× at L). |
| Outside the rail — `HeroBand`, `FeelsLikeLine`, `AstroMetaLine`, `FloatingMiniBanner`, the on-map labels in `WeatherMap` | `font-size: calc(<base>px * var(--c-font-scale, 1))` per element | Opt in explicitly, per property. Nothing scales for free out here. |

`LayoutDesktop`'s `heroSlot` sits in the second group and additionally multiplies `--c-rail-width` by `--c-font-scale` in its `right` offset, so it always ends before the (zoomed) rail's visual left edge.

The `SettingsPanel` and `DebugPanel` overlays sit outside both groups: they render outside `.ambientRoot`, so they never see `--c-font-scale`, and each sets its own `zoom: resolvePanelFontSizeZoom(fontSize)` on its root — one notch (×1.15) above the main UI scale; `DebugPanel` drops it to 1 at ≤ 520 px height.

---

## 5. Key data flows

### Cold-boot startup sequence

```
boot
  → systemd starts pi-weather-server.service
  → ExecStartPre loops `getent hosts ipapi.co` until DNS resolves (max 60 s)
  → npm start → node ./server/index.js
  → DNS preference set to ipv4first
  → TLS cert checked at every start (unless SKIP_CERT_AUTOGEN=true): root CA
      generated if missing / hostname changed; leaf re-signed if missing,
      expiring, or its CN / SAN no longer match (no cert → HTTP :8080 on
      127.0.0.1 only)
  → HTTPS :8443 listens
  → initIndoorTemperature() schedules the 5-min Homebridge poll
  → start-server (from autostart) detects port open
  → reads ~/.config/pi-weather-station/browser.conf for browser choice
  → launches Chromium / Firefox in kiosk mode → https://localhost:8443
  → React app loads from dist/
  → AppContext first render: useUiPreferences hydrates (lazy useState initializer)
      ← localStorage (units, clock, font size; first-launch locale seed)
  → App mount effect calls the AppContext actions, in order:
      → getCustomLatLon() ← settings.json via GET /settings
      → getBrowserGeo() ← startingLat/startingLon from GET /settings, else
          GET /geolocation (server-side ipapi.co lookup, 30-day disk cache) —
          navigator.geolocation is not used
      → loadStoredData() ← localStorage (dark mode / auto, map zoom, marker,
          radar source, alert toggles, …)
      → checkIsLocal() ← GET /api/is-local
  → AppContext mount effect: getWeatherApiKey() + getReverseGeoApiKey() ← GET /settings
      (context-level on purpose — see the note below)
  → AppContext weather-poll effect (gated on `weatherApiKey && mapGeo`)
      → GET /api/weather/current, /hourly, /daily + sunrise/sunset
      → arms the staggered 10 min / 1 h / 24 h pollers
  → AppContext reverse-geo effect (gated on `mapGeo && reverseGeoApiKey`)
      → GET /api/reverse-geocode → `reverseGeoResult` (rendered by LocationName)
  → ambient/AiSummaryInline mounts (LayoutMobile / LayoutDesktop)
      → GET /api/weather-summary (if Anthropic key present)
      On LayoutPi the summary is not inline: ambient/AiView mounts on demand
      when the user opens the IA view, and fetches via components/hooks/useAiSummary
  → ambient/IndoorBlock mounts → GET /api/indoor-temperature
  → useUpdateChecker polls GET /api/update-check (on mount + every 6 h); when
      updateAvailable (and not the skipped SHA) the dock shows an update
      button — tapping it (localhost only) opens UpdateModal
```

> The API-key fetch and the weather poll both live in `AppContext`, not in a
> component. They used to be component-triggered, which broke when v3 became the
> default: no v3 layout mounted the v2 component that owned them, so the keys
> stayed `null` and weather data went stale after the first fetch. Owning them at
> context level means every layout gets the same data regardless of which
> surfaces are rendered.

### Location change (map click)

```
User clicks map
  → WeatherMap's MapClickHandler (200 ms debounce) → AppContext.setMapPosition()
  → setMapPosition fires the one-shot fetches immediately and updates mapGeo:
      GET /api/weather/current?lat=…&lon=… (server checks cache → miss → Tomorrow.io)
      GET /api/weather/hourly, /daily (same)
  → AppContext weather-poll effect re-runs (mapGeo dependency):
      clears the old timers, re-arms the staggered 10 min / 1 h / 24 h pollers
      for the new coordinates
  → AppContext reverse-geo effect re-runs (mapGeo dependency)
      → GET /api/reverse-geocode?lat=…&lon=… → LocationName re-renders
  → ambient/AiSummaryInline (or useAiSummary in AiView) re-fetches on the
      mapGeo dependency → GET /api/weather-summary
  → WeatherMap re-renders the 50 km circle around the new mapGeo
```

### AI summary request (with radar paragraph)

```
Client: GET /api/weather-summary?lat=…&lon=…&lang=fr&localHour=14&…
  → aiSummaryCtrl reads anthropicApiKey via settingsCtrl.getSettingsData()
      → 503 if absent
  → checks summaryCache (key: lat/lon/lang/localHour period + unit prefs) → miss
  → in-flight coalescing (inflightSummaries): a concurrent miss on the same key
      awaits the build already running and mirrors its status/body — one radar
      pipeline + one Claude call for the lot (exception: a local kiosk that
      would inherit a remote owner's 429 runs its own build instead)
  → reads current/hourly/daily from shared weatherCache (a current-conditions
      miss triggers one non-fatal Tomorrow.io backfill)
  → calls radarAnalyzerCtrl.analyzeRadar(lat, lon)
      → fetches the RainViewer past-frames index (analysis cached 5 min,
        decoded tiles 60 min)
      → for now, -15 min, -45 min: fetches matching tiles, reads pixels at
        161 sample points (centre + 16 directions × 10 distances; 481 with
        advanced.ai.extendedRadius), classifies intensity, formats as text
      → returns a compact "now: clear / -15 min: light NE / -45 min: ..." block
  → calm-day fast path (advanced.ai.calmDayFastPath, default on): benign weather
      code, precip probability < 20 % now and for the coming period, and no
      radar return → templated summary, NO Claude call; cached 15 min,
      recordServiceCall(…, 200, "calm-day fast path (no LLM call)") → returns
  → no current, period or radar data at all → 503 "No weather data available"
  → builds 1/2/3-paragraph prompt depending on which data is available
  → billed-call ceiling (reserveClaudeCall), remote peers only — the local kiosk
      is exempt: past 10 billed calls/min process-wide or 4/min per socket peer
      → 429 "AI summary temporarily rate-limited", nothing spent
  → Anthropic SDK (buildClaudeRequest): claude-haiku-5-5, adaptive thinking,
      effort "low", no sampling params → max_tokens 3072 with radar, 1024 without
  → classifyClaudeReply: summary = the reply's type === "text" blocks only
      (a Haiku 5.5 reply can open with thinking blocks)
      → ok              → stores in summaryCache (TTL 15 min)
      → truncated       → served, cached TRUNCATED_SUMMARY_TTL (5 min) only
      → refusal / empty → 502 "AI summary failed", never cached; service
          status 422 (refusal) / 502 (no text)
  → recordServiceCall("Claude (AI summary)", 200, "OK (in=… out=… think=…)")
      (ok / truncated only; a truncated reply logs "OK, truncated (…)")
  → returns { summary: "…three paragraphs…", period: "evening" }
      (period = forecast slot covered: evening / overnight / tomorrow, or null)
```

### Indoor temperature poll loop

```
At server startup (initIndoorTemperature):
  → runs pollOnce() once and schedules it every 5 min, unconditionally; each
      tick re-reads settings.indoorTemperature and no-ops (clearing the cache)
      while disabled — enabling it needs no restart

pollOnce():
  → fetchAccessoriesWithRetry(homebridgeUrl, username, password)
      → if no token or token expired, login (POST /api/auth/login)
      → GET /api/accessories with Bearer token
      → on 401, force re-login + retry once
  → keep accessories whose serviceName equals the configured
      indoorTemperature.sensorName
  → pick valid temperature, humidity, AirQuality (range-checked)
  → update in-memory cache { value, humidity, airQuality, lastUpdatedMs }
  → recordServiceCall("Homebridge", 200, "OK")

Client: GET /api/indoor-temperature
  → returns 200 with the cache (isStale after 30 min; value: null before the
      first reading), or 200 { enabled: false } when the feature is off
```

### One-click update (modern flow, v2.6.2+)

```
User taps Update button (localhost only)
  → POST /api/update   (single-flight guard: concurrent run → 409 "update-in-progress")
  → server pre-flight checks:
      - git symbolic-ref --short HEAD       (detects detached HEAD)
      - assert current branch == "master"   (detects wrong-branch)
      - (preparation, not a check) silently reverts package-lock.json,
        client/package-lock.json and client/dist — auto-generated artefacts
      - git status --porcelain --untracked-files=no   (detects local changes)
      - any failure → 409 with { reason, message } → modal renders the
        message in a red bordered box and stays on the failed state
  → git pull --ff-only (timeout 90 s; timeout → 504 "pull-timeout",
      root-owned files → 409 "permission-denied", other → 500 "pull-failed")
  → npm ci --omit=dev --no-audit --no-fund (timeout 180 s; failure → 500
      "npm-install-failed")
  → res.json({ ok: true, isSystemd })
  → after 500 ms: under systemd (INVOCATION_ID set) → systemctl --user restart
      pi-weather-server (restart failure → shutdown()); otherwise → shutdown()
      (cache saved, counters flushed, process exits — the updater issues no
      restart; on a macOS launchd install, KeepAlive relaunches the server)
  → client (isSystemd from /api/update-check): under systemd, polls
      GET /api/is-local until the server responds, then reloads the page;
      otherwise the modal shows the "stopped" state (no polling)
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
        ├── override.conf                Log redirect + DEBUG
        ├── local.conf                   ALLOW_REMOTE=true (install.sh /
        │                                toggle-remote.sh; absent when
        │                                remote access is off)
        └── nvm.conf                     Only when node comes from nvm (e.g.
                                         32-bit Bullseye) — sources nvm.sh
                                         before npm start
  └── pi-sensehat.service                Optional — Sense HAT LED display
  └── pi-sensehat-clock.service          Optional — Sense HAT clock (parked;
                                         switched with pi-sensehat via
                                         /api/sensehat-mode)

~/.local/bin/
  └── start-server                       Waits for server, launches the
                                         configured browser in kiosk mode
                                         (reads browser.conf for the choice).
  └── detect-display-scale.sh            Per-panel auto-scale (physical PPI),
                                         called by start-server

~/.config/pi-weather-station/
  └── browser.conf                       BROWSER_CMD, BROWSER_FAMILY
                                         (chromium or firefox); optional
                                         DISPLAY_SCALE (auto | <number> |
                                         off — also written from Settings →
                                         Advanced) and KIOSK_REMOTE_DEBUG
                                         (off by default; diagnostics only)

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
  └── com.pi-weather-station.plist       launchd user agent (written by
                                         install.sh from the deploy/
                                         template): starts the server
                                         (npm start) at login and keeps it
                                         alive; logs to <repo>/server.log.
                                         No browser is launched — open
                                         https://localhost:8443 manually.
```

### Update flows on the target

```bash
# In-app: from the kiosk's update modal — handled by /api/update
# (git pull + npm ci --omit=dev + restart) when local is v2.4.1+.

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

**Amended 2026-10-08:** the browser-direct exception is wider than RainViewer tiles — it covers the keyless radar sources: RainViewer tiles plus its frame index (`weather-maps.json`), and the ECCC GeoMet WMS radar layer (`geo.weather.gc.ca`) when the ECCC radar source is selected. Every *keyed* call is still proxied, so the decision stands.

---

### ADR-02 — `dist/` committed to git

**Decision:** The compiled webpack bundle (`client/dist/`) is committed alongside source code.

**Rationale:** Raspberry Pis update with `git pull` + service restart. Requiring a webpack build on the Pi would add a Node.js build toolchain dependency on every device, and would make updates slower and riskier on low-RAM Pi models.

**Consequences:** The dist/ files must be rebuilt and committed on the development machine before every push that touches client source. `npm run prod` must be run and the result staged explicitly.

---

### ADR-03 — Single AppContext for all shared state

**Decision:** All global state (settings, weather data, UI preferences, panel state, update flow) lives in one React Context (`AppContext.js`).

**Rationale:** Appropriate for the project's size at the time. A single context is simple to reason about and avoids prop drilling across the component tree.

**Consequences:** `AppContext.js` grew large and became a known technical debt item. **Superseded in part:** the provider was since split into focused contexts so consumers subscribe to one slice instead of the whole value — `AppContext.js` now exports `AppActionsContext`, `SystemContext`, `LocationContext`, `UiPrefsContext`, `WeatherDataContext`, `AlertsContext` and `RadarStateContext` alongside the original catch-all `AppContext`. The *file* is still one module (~2900 lines) — what was split is the context surface, not the source file. Remaining extraction ideas (`useLocation`, `useWeatherData`) are tracked in `ROADMAP.md` as past the diminishing-returns line.

---

### ADR-04 — CSS `zoom` for font size scaling

**Decision:** Font size scaling (S/M/L) is implemented via the CSS `zoom` property on a scrollable container subtree, not via `font-size` or CSS custom properties on individual elements.

**Rationale:** `zoom` scales the entire subtree uniformly — all text, spacing, icons, and chart containers — without requiring changes to individual components. A `font-size` approach would require explicit `em`-based sizing throughout every component.

**Consequences (as originally shipped on the v2 `InfoPanel`):** two compensations were required — `height: calc(100dvh / zoom)` to prevent grey areas or hidden controls, and a counter-zoom (`zoom: 1/parentZoom`) on chart wrappers so Chart.js measured the container in its natural coordinate space. *Both are gone as of 2026-07:* they were properties of the v2 panel, which was a full-height flex column with `zoom` on its outermost box. The v3 rail is absolutely positioned with explicit `top`/`bottom`, so its height is constrained independently of `zoom` and neither compensation is needed — `grep`ping for `100dvh / zoom` or a counter-zoom in `client/src/` now returns nothing.

**Container, then and now:** the original context was the v2 `InfoPanel` container *(historical — that component was deleted in 2026-07)*. Since v3 the decision is unchanged but the container moved: within the layouts, `zoom` is applied to the scrollable rail only — `.rail` in `LayoutPi` / `LayoutDesktop` (the `SettingsPanel` / `DebugPanel` overlays, rendered outside `.ambientRoot`, apply their own boosted `zoom` via `resolvePanelFontSizeZoom`). Applying it to the `AmbientLayers` root broke `position: absolute` children (`100dvh` references no longer matched the zoomed root), and applying it to `LayoutDesktop`'s `heroSlot` clipped the clock (zoom grows the painted box without updating layout geometry). See "Font size zoom model" in section 4 for both rejected placements.

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

**Superseded in part (v2.17.0, 2026-05-22):** the single self-signed certificate became a two-cert chain — a locally generated root CA (10-year validity, served by `/api/cert.pem` so users trust it once per device, see [`docs/pwa-trust-cert_en.md`](docs/pwa-trust-cert_en.md)) signing an 825-day leaf. `install.sh` no longer generates a certificate; the server checks both at every start (unless `SKIP_CERT_AUTOGEN=true`) and re-signs the leaf when its CN, expiry or SAN no longer match — the SAN covers every LAN IPv4 address plus the hostname and `<hostname>.local`. An IP change re-signs only the leaf, so existing trust holds; a hostname change also regenerates the CA (its CN carries the hostname), so clients must trust it again. If no certificate can be produced, the server falls back to cleartext HTTP on :8080 bound to 127.0.0.1 only — never the LAN.

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

**Superseded in part:** the install step became `npm ci --omit=dev --no-audit --no-fund` in v2.13.0 (2026-05-11, commit `c05b774`), so dependencies install strictly from the lockfile, which is never rewritten — `npm ci` rebuilds `node_modules` from scratch, so the "~3 s" above no longer describes it. Since the same release, the lockfiles and `client/dist` are also silently discarded before the local-changes check; the `git pull` timeout went from 30 s to 90 s (504 `pull-timeout` on expiry) in v2.19.0 (2026-06-02, commit `cec11e9`). Current flow: "One-click update" in section 5.

---

### ADR-09 — Browser choice persisted in `~/.config/pi-weather-station/browser.conf`

**Decision:** `install.sh` detects the supported browsers installed — the Chromium family (Chromium, Google Chrome, Brave, Microsoft Edge) and Firefox / Firefox ESR — marks the system default (`xdg-settings`), prompts the user to pick one, and persists the choice (`BROWSER_CMD` + `BROWSER_FAMILY`). `start-server` reads this file at launch and uses family-specific kiosk flags.

**Rationale:** Different distributions ship different browsers as the default. Hard-coding Chromium in `start-server` works for Pi OS but breaks on Ubuntu (Firefox-only) and openSUSE (Firefox-default). Two browser families need different kiosk flags: Chromium-based use `--kiosk --noerrdialogs ...`; Firefox uses `-P <named-profile>` so the self-signed-cert acceptance persists, and to stay compatible with the snap-confined Firefox on Ubuntu where arbitrary `--profile <path>` doesn't work.

**Consequences:** The browser choice survives upgrades. Users can switch by re-running `install.sh` or editing the conf file directly. When the conf file is absent, `start-server` falls back to the first of `chromium`, `chromium-browser`, `google-chrome` or `firefox` it finds (backward compatible with installs that pre-date this feature). The supported executable names live in three lists that must move in lockstep — `KNOWN_BROWSERS` (what the installer offers) and `classify_browser_family` in `install.sh`, and `start-server`'s family case — and drift between them fails silently: Brave was classified in both scripts from the start but missing from `KNOWN_BROWSERS`, so the installer never offered it until 2026-10. `test/kioskBrowserLists.test.js` now parses the three lists (plus `start-server`'s per-browser profile-lock cleanup) and fails when an offered name is unclassified, is classified differently by the two scripts, or (Chromium family) has no lock cleanup; it also pins Brave in the offered list.

---

## 8. Known limitations

| Limitation | Impact | Tracked in |
|---|---|---|
| No React render tests (server + pure client logic are covered by `npm test` in CI) | UI regressions are caught only by manual or browser checks | ROADMAP.md |
| `AppContext.js` too large | Growing harder to navigate | ROADMAP.md |
| No offline mode | No client-side offline cache (service worker): during an internet outage the panel depends on the server's stale-on-error weather cache (up to 24 h past expiry, persisted in `weather-cache.json`); with no cached entry for the location the panel is blank | ROADMAP.md |
| Self-signed local root CA | Browser warning until the CA is trusted once per device | — (by design) |
