# CLAUDE.md — Pi Weather Station

This file provides context for Claude Code on any machine working with this project.

## Project Overview

Pi Weather Station is a full-stack weather display application designed to run on a Raspberry Pi with a touchscreen. It shows real-time weather data, radar maps, hourly/daily forecasts, and an AI-generated weather summary powered by Claude.

- **Frontend**: React (webpack, CSS Modules, i18next for EN/FR/ES)
- **Backend**: Node.js / Express
- **Target hardware**: Raspberry Pi (Bullseye, Bookworm, Trixie) with 7" touchscreen running a kiosk browser; also runs on Debian/Ubuntu, openSUSE, and macOS
- **Kiosk browser**: Chromium-family (Chromium, Chrome, Brave, Edge) or Firefox; choice prompted by `install.sh` and persisted in `~/.config/pi-weather-station/browser.conf` (`BROWSER_CMD` + `BROWSER_FAMILY`, plus an optional `DISPLAY_SCALE` override). Snap-Firefox is supported via named profile (`-P pi-weather-station`). Snap-packaged Brave (command `brave`) is deliberately NOT offered: start-server's hostname-change lock cleanup only knows the APT profile `~/.config/BraveSoftware/Brave-Browser` (the snap's lives under `~/snap/brave/`), and start-server is updater-hashed; `install.sh` prints a note and the readme explains. `test/kioskBrowserLists.test.js` keeps the kiosk browser-name lists in `install.sh` and `start-server` in lockstep, and `relaunch-kiosk.sh`'s per-browser profile map (`kiosk_profile_dir`) identical to start-server's lock-cleanup arms
- **Kiosk display auto-scale**: `deploy/detect-display-scale.sh` derives a per-panel scale from the screen's **physical** density (`wlr-randr`/`xrandr` → diagonal PPI) so a small high-density panel (e.g. 10.1" 800×1280 ≈ 150 PPI) doesn't render the UI tiny. Target is `TARGET_PPI=130` (the 7" official screen's density); `start-server` applies it at every boot via Chromium `--force-device-scale-factor` or a Firefox `layout.css.devicePixelRatio` profile pref. Emitted only when scaling helps; pin/disable via `DISPLAY_SCALE` (`auto`/number/`off`) in `browser.conf` — settable over SSH or from the **Settings UI** (API → "Configuration & API keys" → "Location & hardware" → "Display scale"), which writes the same `DISPLAY_SCALE` line via `displayScaleCtrl` (applies on the next kiosk relaunch). This is the escape hatch for a panel whose EDID **lies about its physical size** (e.g. a 13.3" reporting 350×190 mm → 141 PPI → auto-scale wrongly lands on 1.0)
- **Official 7" touchscreen on Trixie**: Mouse Emulation mode must be disabled — set DSI-1 to **Multitouch** via Control Centre → Screens → DSI-1 → Touchscreen. See `docs/troubleshooting-touchscreen.md`.
- **Deployment**: systemd user service (`pi-weather-server.service`) on Linux + XDG autostart entry on GNOME/KDE; launchd agent (`com.pi-weather-station.plist`) on macOS. Optional Sense HAT display daemons: `pi-sensehat.service` (weather/radar on the LED matrix) and `pi-sensehat-clock.service` (clock) — mutually exclusive, switched via `/api/sensehat-mode`.

## Architecture

```
pi-weather-station/
├── server/               # Express server (Node.js)
│   ├── index.js          # Entry point, routes, middleware, /api/update flow
│   ├── proxyCtrl.js      # Proxies Tomorrow.io weather (current/hourly/daily, shared cache), Mapbox tiles, LocationIQ reverse geocoding, sunrise-sunset.org — other upstreams are called from their own controllers; radar tiles (RainViewer, ECCC GeoMet) load straight from the browser
│   ├── aiSummaryCtrl.js  # Claude AI weather summary endpoint (current + period-forecast + radar paragraphs, each only when its data is available)
│   ├── radarAnalyzerCtrl.js # Parses RainViewer tile pixels for the 50 km zone
│   ├── airQualityCtrl.js # Air-quality orchestrator — closest station wins across sources, ECCC AQHI fallback
│   ├── airQualitySources/ # One module per AQ source (MELCC Mtl, MELCC RSQAQ, AirNow, OpenAQ, ECCC) + _shared.js helpers
│   ├── govAlertsCtrl.js  # Gov severe-weather alerts orchestrator — merges sources in parallel, isolates failures
│   ├── govAlertSources/  # One module per alert source (NWS point query, ECCC point-in-polygon) + nwsZones.js (resolves NWS zone-only alerts to polygons via affectedZones, 24 h cache) + _shared.js helpers
│   ├── pollenCtrl.js     # Pollen badge — Open-Meteo Air Quality API, worst case of 6 allergens
│   ├── openMeteoCtrl.js  # PoC Open-Meteo weather adapter in the Tomorrow.io envelope shape (source comparison)
│   ├── indoorTempCtrl.js # Polls Homebridge for indoor temperature/humidity/air quality
│   ├── sensehatCtrl.js   # GET /api/sensehat — serves aggregated weather/alert/radar-grid data to the Sense HAT display daemons
│   ├── sensehatModeCtrl.js # Sense HAT mode/availability/LED-brightness endpoints — switches pi-sensehat ↔ pi-sensehat-clock units
│   ├── kioskLocationCtrl.js # In-memory cache of the kiosk's currently-viewed map coords (consumed by /api/sensehat)
│   ├── brightnessCtrl.js # GET/POST /api/brightness — screen brightness via sysfs backlight (Pi) or DDC/CI (monitors)
│   ├── displayScaleCtrl.js # GET/POST /api/display-scale + POST /api/relaunch-kiosk — kiosk device-scale override (manages the DISPLAY_SCALE line in browser.conf; corrects a lying-EDID panel's auto-scale; GET reports the scale APPLIED to the running kiosk so the UI offers a relaunch only when useful; relaunch spawns deploy/relaunch-kiosk.sh detached)
│   ├── healthCtrl.js     # GET /api/health — red/yellow/green roll-up of external-service statuses
│   ├── debugCtrl.js      # Debug panel data endpoint (localhost-only)
│   ├── clientTracker.js  # Tracks remote client IP addresses
│   ├── geolocationCtrl.js # Default location lookup via ipapi.co (retry + 30-day disk cache)
│   ├── responseTimer.js  # Per-endpoint response time tracking middleware
│   ├── securityHeaders.js # Baseline security-header middleware (nosniff, frame DENY, no-referrer, CSP frame-ancestors)
│   ├── rateLimitKey.js   # Rate-limit bucket key derived from the TCP socket peer — never req.ip/XFF
│   ├── boundedCache.js   # BoundedMap + expiry-sweep primitives capping the in-memory caches (OOM guard)
│   ├── singleFlight.js   # Concurrency-guard middlewares — single-flight 409 for a non-reentrant op (in-app updater) + per-peer in-flight cap (/api/nearby-alerts; local kiosk exempt)
│   ├── settingsCtrl.js   # Reads/writes settings.json (server-side whitelist)
│   ├── serviceStatus.js  # Tracks last status of each external service
│   ├── requestCounter.js # API quota counters (persisted to request-counts.json)
│   └── updateChecker.js  # GitHub master-commit check (local HEAD vs master, user-facing commit types only) + changed deploy/ artefacts + needsManualUpgrade detection (cached 1 h)
├── client/               # React frontend
│   ├── src/
│   │   ├── AppContext.js             # Global state (composes useUpdateChecker, useScreenSaver, useUiPreferences, useDisplayScale, useSenseHatMode, useIdleDetection, useFavoriteLocations hooks; inline state for the rest — weather data, geo, advanced.* save chain, UI state)
│   │   ├── components/
│   │   │   ├── App/                  # Root shell — mounts AmbientLayers, the Settings/Debug overlays, UpdateModal, ScreenSaver; boot actions + sleep-stage hardware-brightness orchestration (layout itself lives in ambient/Layout*)
│   │   │   ├── ambient/              # v3 "Ambient Layers" tree — default since v2.18, and the ONLY UI since the v2 tree was deleted (2026-07). LayoutDesktop/Mobile/Pi, HeroBand, HeroCompact, MetricsGrid, ChartTabs, BottomDock, alert banner + detail slab, SettingsPanel/DebugPanel, MoonDetailsPopover, etc. (incl. ControlButtons + weatherCharts, moved here in 2026-06 from what was then the v2 tree because the dock and ChartTabs consume them)
│   │   │   ├── AmbientLayers/        # Palette dispatcher (day/dusk/night/nightRed), viewport breakpoints, iOS PWA bg paint
│   │   │   ├── WeatherMap/           # Leaflet radar — index.js + RadarTimeline + RadarLegend + RiskRing + RingLabels (radius chips) + MapResizer + RadarFocusControl + icons.js (inline SVG control glyphs) + geometry.js (pure helpers + style tables)
│   │   │   ├── UpdateModal/          # In-app updater UX (commits, warnings, errors)
│   │   │   ├── ScreenSaver/          # Sleep mode (stage 1 minimal clock, stage 2 anti-burn-in dot)
│   │   │   ├── LocationName/         # Reverse-geocoded place name (imported by ambient/HeroBand + ambient/HeroCompact)
│   │   │   ├── hooks/useAiSummary.js # Claude summary fetch/refresh (15 min; only while mounted + available + awake) — used by ambient/AiView; ambient/AiSummaryInline still carries its own copy of the fetch
│   │   │   (The legacy v2 tree — Settings/, Debug/, InfoPanel/, CurrentWeather/, AiSummary/, Clock/, SunRiseSet/, WeatherInfo/, IndoorTemperature/, AlertBanner/, GovAlertDetail/, UvAqiBadges/, RangeSlider/, Spinner/ — was DELETED 2026-07 together with the `experimentalUiC` flag; v3 is the only UI. Those names still appear throughout CHANGELOG history and in docs/archive/ui-layout_v2_*.md — nothing on disk. NOTE: `ambient/AlertBanner` is a DIFFERENT, live component from the removed `components/AlertBanner`; same for `ambient/AiSummaryInline`, `ambient/IndoorBlock`, `ambient/SettingsPanel`, `ambient/DebugPanel`.)
│   │   ├── hooks/
│   │   │   ├── useUpdateChecker.js   # In-app update flow (state + periodic poll + actions)
│   │   │   ├── useScreenSaver.js     # Brightness + sleep-mode state (debounced slider + initial /api/brightness fetch)
│   │   │   ├── useUiPreferences.js   # Units / clock / fontSize (localStorage + first-launch locale seed)
│   │   │   ├── useDisplayScale.js    # Kiosk display-scale override (GET/POST /api/display-scale + POST /api/relaunch-kiosk; a new scale applies on the next kiosk relaunch)
│   │   │   ├── useSenseHatMode.js    # Sense HAT display mode + LED brightness (availability probe, /api/sensehat-* reads/writes)
│   │   │   ├── useFavoriteLocations.js # Favorite locations (Places) — `favorites` in settings.json via localhost-only PATCH /setting; optimistic + rollback; row-budget cap
│   │   │   ├── useIdleDetection.js   # Idle-watcher driving ScreenSaver
│   │   │   ├── useAutoTabSelector.js # Auto-select forecast tab driver for ChartTabs (signals → pure ui/autoTabSelector.js reducer; debounce + manual hold)
│   │   │   ├── useEligibleGovAlerts.js # Single source of truth for the displayed gov-alert set + current alert (dismissals + tier gate: red/orange by default, + yellow when the per-device showAdvisoryAlerts opt-in is on), shared by every gov-alert surface
│   │   │   └── useDismissedAlerts.js # Per-device dismissal tracking for AlertBanner (4 h auto-resurface floor)
│   │   ├── i18n/locales/             # EN / FR / ES translations
│   │   ├── ui/                       # Pure logic + design tokens — tokens.js (day/dusk/night/nightRed palettes), hybrid.js (useTimeOfDay palette key + hybrid-mode escalation), alertLogic.js, autoTabSelector.js (reducer), piLayout.js, severity.js, weatherCodes.js, … + fonts.css / reset.css
│   │   └── services/                 # conversions.js (unit conversions + labels: temp, speed, pressure, length — no km↔mi helper; that's KM_PER_UNIT in WeatherMap/geometry.js), formatting.js, brightnessRestore.js, geolocation.js, reverseGeocode.js
│   └── dist/             # Compiled bundle (committed to git)
├── deploy/               # Multi-distro install.sh, systemd units, autostart, kiosk launcher,
│                          # detect-display-scale.sh (per-panel kiosk auto-scale from physical PPI),
│                          # relaunch-kiosk.sh (cycles the kiosk browser to apply a display-scale change; spawned by displayScaleCtrl),
│                          # harden-kiosk.sh, logrotate, launchd plist, uninstall.sh,
│                          # toggle-remote.sh / toggle-debug.sh (flip ALLOW_REMOTE / DEBUG on a running install),
│                          # start-weather (launcher for running without systemd)
├── docs/                 # api.md, KPI, security, logs, troubleshooting, ui-layout (en/fr),
│                          # radar-classification (RainViewer pixel → tier → display colour),
│                          # user guides (places, pwa-trust-cert, ssl-custom-cert), design docs —
│                          # architecture.md, ROADMAP.md and CHANGELOG.md live at the repo root
├── design-system/        # Ambient Layers design-system bundle for Claude Design — tokens, 4 themes (+ data-hybrid),
│                          # guideline + specimen cards, React ports of the primitives, screen anatomies. Source of the
│                          # DesignSync pushes to the "Design System" project (maintainer tooling; nothing runs on a Pi)
├── .github/workflows/    # ci.yml (npm test + client lint/webpack build), dependabot-auto-merge.yml (security patch/minor bumps)
├── test/                 # node --test suite (test/<area>.test.js), run via `npm test` — see Tests below
└── tools/                # CSV→Excel converter, Sense HAT display daemons (sensehat_weather.py + horloge.py,
                           # both poll GET /api/sensehat over HTTPS and render on the LED matrix),
                           # gen-localization-glossary.js (generates docs/localization-glossary.md; npm test fails when stale),
                           # maintainer-only: capture-screenshots.js (docs/screenshots), compare-weather.js
                           # (Tomorrow.io vs Open-Meteo diff), radar_grid_preview.js (Sense HAT grid), track-traffic.sh
```

## Key Conventions

### Commits
- Conventional commits — **the type decides whether the fleet sees an update.** The in-app update check only counts `feat:`, `fix:`, `perf:`, `style:`, `polish:`, `ux:`, `release:` and `chore(deps):` (`USER_FACING_COMMIT_RE` in `server/updateChecker.js`; `updateAvailable` needs at least one), so a real Pi change pushed under any other type is silently swallowed. Conversely, a change that doesn't run on a Pi (`docs/`, `test/`, CI, `design-system/`, `tools/` other than the deployed `sensehat_weather.py` / `horloge.py`) takes an out-of-vocabulary type (`chore:`, `chore(ci):`, `docs:`, `test:`) even when it is a fix — otherwise every kiosk shows a false update badge. Adding a type means changing the regex, `test/updateChecker.test.js`, the `update.<type>` locale keys and the `UpdateModal` badge together
- Always include a `Co-Authored-By` trailer naming the **actual model** that did the work (currently `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`) — update the model string as the working model changes; do not hardcode a stale version

### CSS
- CSS Modules with kebab-case in `.css` files → camelCase in JSX
- css-loader requires `{ esModule: false }` for `.locals` to work with style-loader

### ESLint rules to watch
- `prefer-destructuring`: use `const { x } = obj` instead of `const x = obj.x`
- `react-hooks/exhaustive-deps`: list every dependency — local `useState` setters are recognised as stable and need no entry; setters received through context or props (e.g. `setPiLayoutState`) are not, so list them (they are stable, so it costs nothing). Don't suppress the rule just to drop a setter; see ESLint suppressions below
- `jsdoc/require-param` and `jsdoc/require-returns-description`: all components need JSDoc

### Client build
```bash
cd client && npm run prod
```
The compiled `dist/` files are committed to git so Pis can `git pull` without rebuilding.

### Server
- All outbound axios calls must carry an explicit timeout — `10_000` by default (the `API_TIMEOUT_MS` / `TIMEOUT_MS` constants); a deliberately shorter fail-fast budget is fine (e.g. RainViewer radar fetches 8 s, NWS zone geometry 5 s, the debug probes); a missing timeout never is
- Console output is timestamped (local time) via override in `server/index.js`
- Logs: `tail -f ~/.local/state/pi-weather-station/server.log` on Linux (systemd drop-in pins StandardOutput there — XDG state dir, NOT `/tmp`, which is a tmpfs on Trixie; installs older than 2026-06 still write `/tmp/weather-server.log` until `install.sh` is re-run), `tail -f <repo>/server.log` on macOS (launchd plist points there, gitignored). **`journalctl --user -u pi-weather-server` only shows systemd lifecycle events on Linux — not the app's console output.** Full explanation in [`docs/logs.md`](docs/logs.md).

### Settings
- API keys, the starting coordinates (`startingLat`/`startingLon`), the `indoorTemperature` block, the server-side `advanced.*` preferences and `favorites` are stored in `settings.json` (excluded from git; whitelisted by `ALLOWED_KEYS` in `settingsCtrl.js`). The unit / clock / font-size display preferences below are per-device `localStorage` keys (`hooks/useUiPreferences.js`)
- Temperature units: `f` (Fahrenheit), `c` (Celsius), `k` (Kelvin)
- Speed units: `mph`, `ms` (m/s), `kmh` (km/h — displayed as "kph" in charts)
- Length units: `in`, `mm`
- Distance units: `mi`, `km` (persisted in `localStorage` like the other unit prefs) — drives the radar circles, sampling geometry, and AI summary distance unit
- Pressure units: `hpa`, `inhg`, `kpa` (localStorage `pressureUnit`) — fresh installs seed from the locale (`inhg` for US, `hpa` otherwise); installs that predate the key derive `inhg` once from a stored length unit `in`, else `hpa`; `kpa` is selectable but never seeded
- Clock: `12`, `24`
- Font size: `s` (85% zoom), `m` (100%, default), `l` (115% zoom) — persisted in `localStorage`
- `indoorTemperature` block (top-level since v2.6.0): `{ enabled, homebridgeUrl, username, password, sensorName }` — fully stripped from remote `GET /settings` responses (URL/credentials are not even masked)

### Small screen adaptations (≤ 520 px height)
- **Chart tabs** — the v3 `ChartTabs` component always presents the hourly and daily forecasts as tabs ("24 hours" / "5 days"); there is no stacked variant to fall back to
- **Radar focus** — the `RadarFocusControl` overlay button (top-left, under the zoom stack; rendered outside the Leaflet `MapContainer`, and not shown in the Pi full-rail views) hides the hero + rail so the radar fills the column, on both `LayoutPi` and `LayoutDesktop`; `MapResizer` calls `map.invalidateSize()` after each toggle. It replaced the v2 right-edge chevron in release 2.19.0 (a v3.1 design-programme consolidation; one mental model instead of two intersecting toggles)
- The `(max-height: 520px)` query still drives, in `WeatherMap/index.js` (`window.matchMedia`), the radar legend's collapse to its "(i)" chip (when the timeline is on screen or on the Pi MID glance) and the compact `RadarTimeline`, plus the compact modes of the ambient `SettingsPanel` (CSS `@media`) and `DebugPanel` (CSS `@media` + a `matchMedia` that skips the panel zoom boost). **Separate threshold, on purpose:** `ui/piLayout.js` (`priorityViewsEnabled()`) gates the v3.3 priority-views model (compact glance rail + alert / conditions / ai full-rail views) on `(max-height: 540px)`, or on `localStorage.forcePriorityViews = "on"`; the v3.2 MIN/MID/MAX radar states run on every `LayoutPi` regardless of height — don't unify the two queries casually

### Debug panel
- Accessible from localhost only (both server-side middleware and client-side button)
- Enabled via `DEBUG=true` in the systemd drop-in (`pi-weather-server.service.d/override.conf`) or the launchd plist on macOS; flip it with `bash deploy/toggle-debug.sh`. The flag only reveals the client-side button — the `/api/debug*` endpoints are localhost-gated regardless
- Exports every section to CSV (`weather-station-debug-*.csv` → the browser's download folder), client KPIs included. The About bucket's Export CSV measures FPS for 1 s (`sampleFps`), then passes a `snapshotClientMetrics()` taken at click time (the same collector the Client bucket's `useClientMetrics` reads) to `exportDebugCsv(data, clientMetrics, fps)`, so the export does not depend on the Client bucket being pinned. `client/src/ui/exportDebugCsv.js` is CommonJS (like `ui/autoTabSelector.js`) so `test/exportDebugCsv.test.js` runs the real exporter
- Use SSH tunnel to access from macOS: `ssh -L 8443:localhost:8443 pi@<pi-ip>`

### Deployment on other Pis
```bash
cd ~/pi-weather-station
git pull
systemctl --user restart pi-weather-server
```
No client rebuild needed — dist files are committed. This manual recipe is the fallback for the in-app updater below and skips two steps: if the pull changed `package-lock.json`, run `npm ci --omit=dev` before the restart (the updater always does); if it changed `deploy/pi-weather-server.service`, `deploy/start-server` or `deploy/com.pi-weather-station.plist`, run `bash deploy/install.sh` instead — `git pull` doesn't refresh the installed copies under `$HOME` (the updater detects this case and points to the same recipe).

The in-app updater (`POST /api/update`, fired from `UpdateModal`, which opens from the dock's update button — localhost only — or from Debug panel → About → "Install update…") does the same thing plus `npm ci --omit=dev` (server dependencies, exactly as locked) and a service restart, gated by pre-flight checks (rejects detached HEAD, non-master branch, or local changes with a structured 409). The update check also hashes those installed deploy artefacts against upstream (`changedDeployFiles`); when any diverge, or the install is older than commit `a1b8b78` (pre-v2.4.1, flagged `needsManualUpgrade`), the modal disables one-click and directs the user to `git pull && bash deploy/install.sh` instead.

## Maintainability Guidelines

These rules apply to every change, regardless of size. They exist to keep the codebase readable, consistent, and safe to modify months after the original work was done.

### Before committing
- Run `cd client && npm run prod` — the build must pass with **zero errors** (warnings on bundle size are acceptable)
- Run `npm test` from the repo root — CI runs it on every push and PR to `master`, and its guards over `client/src` and the locale files mean a client-only or locale-only change can fail it too (see Tests below)
- Every new or modified React component must have a complete **JSDoc block** (`@param`, `@returns`) and declared **PropTypes**
  - **PropTypes are documentation + a lint-enforced contract, not runtime validation** (React 19, decision 2026-08): React no longer runs `propTypes` checks on function components, so no console warning will ever fire. They stay mandatory because `react/prop-types` is a build **error** and the declarations document each component's API.
  - The file-private helper components of `ambient/SettingsPanel` and `ambient/DebugPanel` are exempt — see ESLint suppressions below.
- Every new UI string must have a translation key in all three locale files (`en.json`, `fr.json`, `es.json`)
  - **Codified exception (maintainer decision, 2026-06):** the inline-trilingual helper `lbl(lang, en, fr, es)` is permitted **in `SettingsPanel` and `DebugPanel` only** — dense, maintainer-facing configuration surfaces where keeping the three strings next to their usage beats locale-file indirection (~188 call sites). The boundary is strict: `lbl()` must NOT spread to kiosk-visible surfaces (layouts, hero, metrics, charts) and NEVER to alert content (banners, chips, detail sections) — those always go through the locale files. If a fourth language is ever added, this exception is the first thing to revisit (the `lbl()` strings would all need a migration pass).
- New or modified Express endpoints must be reflected in **`docs/api.md`**
- Notable changes must be added to **`CHANGELOG.md`** under the appropriate version

### React components
- **One responsibility per component** — if a component renders more than one distinct concept, split it
- **Local state first** — only promote state to `AppContext` if two or more unrelated components need it; `AppContext.js` is already large and should not grow without deliberate justification
- **No inline styles for static values** — use CSS Modules; inline styles are reserved for values that are computed at runtime (e.g. `zoom`, `gridTemplateColumns`, CSS custom properties)
- **Always clean up side effects** — every `setInterval`, `setTimeout`, or event listener registered in a `useEffect` must have a corresponding cleanup in the return function
- **Never `X.defaultProps = {…}`** — React 19's automatic JSX runtime ignores it silently (the prop arrives `undefined`, zero warning in any build). Use destructuring defaults in the signature; for array/object defaults hoist a frozen module-scope constant so the reference stays stable across renders (see `NO_ALERTS` in `WeatherMap/index.js` — a bare `= []` allocates per render and busts memo chains). `test/react19Guards.test.js` fails the suite on any reappearance.

### ESLint suppressions
- **Avoid `// eslint-disable-line` and `// eslint-disable-next-line`** — if a suppression is truly necessary, add an inline comment on the same line explaining *why* the rule is being bypassed
- The first accepted standing exception is `react-hooks/exhaustive-deps` on initialization effects that run once on mount — these must carry the comment `// eslint-disable-line react-hooks/exhaustive-deps -- initialization, runs once on mount`
- Second standing exception (in place since 2026-05): the file-level `/* eslint-disable react/prop-types -- … */` at the top of `ambient/SettingsPanel` and `ambient/DebugPanel`. It covers only their file-private helper components (`Pill`, `Toggle`, `Field`, `Seg`, …); the exported panels take no props. Same two surfaces as the `lbl()` exception

### Constants and magic values
- Named constants for all intervals, thresholds, and repeated literals — define them at the top of the file (e.g. `const REFRESH_INTERVAL = 15 * 60 * 1000`)
- No hardcoded pixel values shared between components — use CSS custom properties (e.g. `--c-font-scale`, set once on the `AmbientLayers` root and read by ~9 stylesheets: map, hero, layouts, meta lines, rail buttons, mini-banner; or `--ctrl-btn-bg`, which `BottomDock` overrides to re-skin the shared `ControlButtons`) so a single change propagates everywhere

### Alert banners — always identify the source
- **Every alert banner must carry a leading source badge** so the user can tell at a glance whether the alert is authoritative (government feed) or derived locally. Existing tags:
  - `ECCC` — Environment and Climate Change Canada (official Canadian alerts)
  - `NWS` — US National Weather Service (official US alerts)
  - `RADAR` — derived from RainViewer pixel analysis via `radarAnalyzerCtrl`
  - `AIR` — air-quality health-risk alert (v3.2). Rendered by `ambient/AirAlertCard` (NOT `AlertBanner`), shown on the Pi MID rail when the normalized AQ `category` reaches `high`/`veryHigh` (`getAirAlertState` in `ui/alertLogic.js`). Pairs the `AIR` category tag with the index's source badge (`AQHI`/`IQA`/`AQI`); below the health-risk band the reading stays in the inline `AirCard` only. Tier colour mirrors the radar/gov strip (orange = high, red = veryHigh).
  - `FCST` — Tomorrow.io forecast threshold. Not a banner: it tags the auto-select forecast-tab **reason chip** in `ChartTabs` (the chip reuses the same `SourceBadge` visual), shown when the chart's metric tab was auto-selected from a forecast threshold rather than a gov alert (`NWS`/`ECCC`) or radar (`RADAR`). See `docs/auto-forecast-tab-selection-design.md`.
  - `TEST` — **a qualifier, not a source.** Appended *next to* the source badge (rendered via `SourceBadge variant="test"`) when an NWS alert with CAP status ≠ `Actual` (Test/Exercise/System/Draft) is revealed via the localhost-only "Show test alerts" toggle. Deliberately a **neutral outlined** pill (never coloured — `--c-warn` collapses to red in the nightRed palette, which would re-create the false-emergency look this feature prevents), paired with a "TEST ·" title prefix for zero ambiguity. NWS-only (ECCC carries no CAP status). These alerts are **hidden by default everywhere** (banner, map overlay, Sense HAT) and never served to remote clients — see the Security section.
- When introducing a new banner-producing source, **assign it a short uppercase tag (3-5 chars)** following the same visual convention. Honest about origin (`AQI`, `SENSE`, `CLAUDE`, etc.); avoid vague labels like `LOCAL` or `AUTO`. Document the new tag in this file and in the JSDoc of `ambient/AlertBanner/index.js`.
- All banner badges render through the shared `ambient/SourceBadge` component (`variant="test"` for the TEST qualifier) — reuse it, don't fork a per-banner badge style. Known deviation, not yet reconciled: on the extreme-severity red band, `ambient/AlertView` renders the source as its own white-outlined pill (`.srcWhite`) instead of `SourceBadge`; don't copy it to new surfaces. (`AirAlertCard`'s tinted `AIR` pill is the category tag described above, paired with a real `SourceBadge` for the index.)

### Gov-alert detail section — reading-first UX
- `ambient/AlertDetailInline` (formerly v2 `GovAlertDetail`; the detail slab under `AlertBanner`, toggled by tapping the banner head row through `govAlertExpanded`) is **collapsed by default**. Expanded mode is for reading, not glancing. On the Pi rail under the v3.3 priority model (`priorityViewsEnabled()`), the slab isn't mounted: the compact alert card opens the full-rail `ambient/AlertView` instead, which scrolls its own body.
- When expanded, the description body lays out at natural height, with no cap. This is intentional: the maintainer's direction is "lorsqu'il y a une alerte gouvernementale et que l'on veut lire les détails, il me semble normal de prendre toute la place disponible. Pour retourner avec les informations météo, on collapse." Translation: when the user has chosen to read a gov alert, they get the screen real estate. A long alert pushes the sibling cards (MetricsGrid, ChartTabs, AiSummaryInline) down and the user scrolls the rail; collapsing (banner head row or the slab's collapse button) hides the slab. *Amended 2026-10-08:* the v2 slab was capped (~65 vh, then `calc(100vh - 280px)`) with internal scroll; the cap was removed in May 2026 (`322e4fc`, see the header of `ambient/AlertDetailInline/styles.css`).
- **External links from the kiosk are kiosk-hostile — use QR codes only, never raw `<a>` elements.** Chromium in kiosk mode has no browser chrome and no easy way back from an external page; a tap on a text link is a one-way trap even when the URL is valid. The original implementation paired a QR with a text link "for SSH-tunnel desktop users", but the desktop case has the same problem (user lands on an upstream page they then have to manage). Maintainer call: ship QR-only. Users on any platform scan the code with their phone (or for desktop, scan the screen with their phone, or right-click → Save Image As to extract). Use the shared `ambient/QrCode` wrapper (around `qrcode.react`'s `QRCodeSVG`; kiosk default size + error-correction level, palette-aware colours) — SVG renders crisp at any size and needs no network. **This rule applies to any future feature that wants to point the user at an external URL.** Enforced by `test/kioskExternalLinks.test.js`, which fails on any `target="_blank"`, `window.open(`, script navigation (`location.href = …`) or `<a>` whose `href` is absolute or computed anywhere in `client/src` outside the Debug panel (the three pre-existing Leaflet attribution links in `WeatherMap` are pinned there as shrink-only debt), and recognises the remote-only exception below only when the link's JSX is the direct operand of an `isLocal === false &&` guard, in a file that also renders a `QrCode` and is listed with its exact link count in the test's `REMOTE_ONLY_LINKS`; it also checks that every `QrCode` passes a `title` (the SVG's accessible name).
  - **Codified exception (maintainer decision, 2026-06): the Debug panel.** It is localhost-only (server-enforced) and reached from a desktop browser or SSH tunnel — never from the chrome-less kiosk — so a direct `<a target="_blank">` is permitted there (e.g. the Dependabot CTA in the About bucket). The exception covers the Debug panel only; everything kiosk-visible stays QR-only.
  - **Codified exception (maintainer decision, 2026-10-08): remote-only companion links.** A raw external `<a target="_blank" rel="noopener noreferrer">` may accompany a QR when it is rendered only for remote clients — gated on the client's `isLocal` being `false` (AppContext initialises it to `true` and only sets it from `GET /api/is-local`, which derives locality from the unspoofable socket peer; the kiosk launcher always loads `localhost`, so the kiosk never shows the link, even if that call fails). A phone viewing the page can't scan its own screen, and a remote browser has normal navigation chrome (Back, tabs), so the kiosk trap doesn't apply. The QR stays for everyone; SSH-tunnel viewers count as local and get the QR only. First use: Settings → "Trust this Pi on this device" (the `pwa-trust-cert` guide).
- External link targets must be **stable, vendor-curated landing pages** — not deep links to specific alerts via opaque IDs. ECCC's JSON-API IDs don't map to public URL slugs, and the per-alert URLs would 404 the moment the alert expires upstream. Use root or overview pages — the ones in `SOURCE_LINKS` (`ambient/AlertDetailInline`, reused by `ambient/AlertView`): `meteo.gc.ca/index_f.html#alerttable`, `weather.gc.ca/index_e.html#alerttable`, `www.weather.gov/`. Never include lat/lon as query parameters to external destinations (privacy: see `<user_privacy>` in the system prompt).

### Server
- All outbound HTTP calls must include a timeout, `{ timeout: 10_000 }` by default — deliberate exceptions: the shorter fail-fast budgets noted under Key Conventions → Server, and the Anthropic SDK client in `aiSummaryCtrl`, which uses `CLAUDE_TIMEOUT_MS` (30 s) since a generated reply plus adaptive thinking outlasts a data fetch
- New endpoints must be protected by the appropriate middleware (`localhostOnly`, `apiLimiter`, or `tileLimiter`) before being shipped
- Never read `settings.json` directly from a controller — always go through `settingsCtrl.getSettingsData()` (`getSettings` is the `GET /settings` HTTP handler, not an internal reader)

### Tests
- Live in `test/<area>.test.js` and run via `npm test` (Node's built-in `node --test` runner — no test deps).
- The suite spans server controllers, client pure helpers and codebase guards (e.g. `test/react19Guards.test.js`, `test/localizationGlossary.test.js`). It includes the radar trend pipeline (`test/radarTrend.test.js`) — the live cases that shaped v2.13 (Sorel approaching, Stratford drifting, Beauce-Sartigan intensification-in-place) are encoded as regression tests so the next refactor of `computePerDirectionTrends` / `summarizeRingTrend` / `computeTrendConfidence` doesn't silently break them.
- When tweaking the trend thresholds, ETA gate, or intensity rules, **run `npm test` before pushing** — the existing assertions encode the empirical thresholds that came out of live debugging.
- Internal helpers tested via the `__test` export on the controller (e.g. `radarAnalyzerCtrl.__test`) — keeps the public surface clean while letting tests reach the pure-function helpers.

### Documentation hygiene
- `CHANGELOG.md` is the single source of truth for version history. **`readme.md` Highlights block (maintainer decision, 2026-10-09):** while a new release is being introduced, the readme may carry, near the top, one short `## 📣 Highlights — <month year>` block for that release only (a few bullets, pointing to `CHANGELOG.md` and the GitHub Releases page). Once the introduction is over — the maintainer's call, at the latest when the next release ships — remove the block and leave readers to `CHANGELOG.md`, the Releases page and the relevant guides. Never keep a block for a superseded release, and never stack blocks into a per-version history.
- `ROADMAP.md` technical debt section must be updated when a debt item is resolved or a new one is identified
- `docs/ui-layout_fr.md` and `docs/ui-layout_en.md` must be kept in sync when the screen layout changes
- **User-facing guides are a separate obligation from the dev docs, and the one most likely to drift silently** — nothing in the build checks them, so a behaviour change that makes a guide wrong produces no error anywhere; the cost lands later, as a support round-trip with a user. When a change alters something a guide describes gesture-by-gesture, re-read the guide and carry the correction into **all three languages in the same commit** (a manual right in one language and wrong in two is worse than one uniformly stale — the disagreement stays invisible until someone reports it). Current guides: `docs/places-guide_{en,fr,es}.md` (Places / favorite locations — triggered by any change to the pin, the home row, the cap, rename, or the reset to automatic), `docs/pwa-trust-cert_{en,fr,es}.md` (the Settings panel's "Trust this Pi" block offers it as a QR code in the viewer's UI language, plus a link for remote clients only). **Exception (decided 2026-10-08): `docs/ssl-custom-cert_{en,fr}.md` has no ES version, on purpose** — it is an admin-level technical reference (shell, `openssl`, systemd/launchd environment overrides) reached only from the English `readme.md` and `docs/security-hardening.md`, never from the app, and the FR copy exists because the guide was first written in French. Keep that pair in sync in the same commit; add an ES version only if the app ever links to the guide
- **`docs/localization-glossary.md` is GENERATED — never hand-edit it.** Run `node tools/gen-localization-glossary.js` after touching a locale file or an inline `lbl()` string; `--check` exits 1 when it's stale, and so does `npm test` (a drift test in `test/localizationGlossary.test.js` makes the same comparison, so CI catches it too). Both ignore the inline tables' `:<line>` refs: a panel edit that only moves code doesn't need a regeneration, and the refs catch up at the next one. It derives every row from `client/src/i18n/locales/*.json` plus the `lbl()` calls in `ambient/SettingsPanel` + `ambient/DebugPanel`, and reports EN↔FR↔ES coverage gaps. The one thing it can't reconstruct is the `Validé` column (native-speaker review state), so it parses the existing file and carries each `☑` forward while its row's EN, FR and ES are all unchanged — rewording any of them drops the row back to `☐`, a renamed key keeps its mark (full rule in the generator's header, pinned by `test/localizationGlossary.test.js`) — which is what makes re-running it safe. It was hand-maintained until 2026-07 and went stale twice; that's why the generator exists. It then sat stale for seven weeks because nothing ran `--check`; that's why `npm test` now does

### Incident reports for long-to-resolve bugs
- **Write an incident report when a bug debugging session meets at least one of**: ≥ 45 min of back-and-forth, ≥ 3 wrong hypotheses before the fix, a cause that wasn't findable via direct code search (CSS spec war, platform-specific behaviour, layered caching, etc.), or a recurrence risk if someone makes the same class of change again.
- File the report immediately after committing the fix — the chronological detail of "what we tried first and what we thought at each step" decays fast. Past 24 h, the most useful part of the report (the failed-hypotheses timeline) is gone.
- Reports live as Markdown notes in the agent's memory store (`~/.claude/projects/<project>/memory/incident_<topic>.md`) and follow a fixed structure: TL;DR → Timeline table → Exact cause → Fix and rejected alternatives → Lessons learned → "For next time" actionable bullets. See `incident_status_chip_specificity_war.md` and `incident_moon_glyph_emoji_platform.md` in that memory store (not in the repo) for examples of the depth and tone expected.
- The point of the report is *the recurring trap*, not the specific bug. If the lesson reads "we should have read X before writing Y" or "diagnostic Z would have saved an hour," that's the keeper. Skip reports for one-off typos / obvious-once-read bugs / design decisions resolved by a conversation.

## External Services

| Service | Purpose | Environment |
|---|---|---|
| Tomorrow.io | Weather data (current, hourly, daily) | `weatherApiKey` in settings.json |
| Mapbox | Base map tiles | `mapApiKey` in settings.json |
| RainViewer | Radar tiles + 50 km zone analysis | No key required |
| LocationIQ | Reverse geocoding | `reverseGeoApiKey` in settings.json |
| Anthropic Claude | AI weather summary (claude-haiku-5-5) | `anthropicApiKey` in settings.json |
| Homebridge (`homebridge-config-ui-x`) | Indoor temperature/humidity/air quality | `indoorTemperature.*` in settings.json |
| ipapi.co | IP-based geolocation (default location) | No key required |
| sunrise-sunset.org | Sunrise/sunset times | No key required |
| MELCC RSQA Montréal | Air quality (Montreal IQA) | No key required |
| MELCC RSQAQ provincial | Air quality (Quebec IQA outside Montreal) | No key required |
| Environment Canada AQHI | Air quality (Canada-wide AQHI fallback) | No key required |
| EPA AirNow | Air quality (US AQI) | `airNowApiKey` in settings.json |
| OpenAQ | Air quality (global fallback, ~150 countries) | `openAqApiKey` in settings.json |
| Open-Meteo | Pollen (`pollenCtrl`, Air Quality API) + PoC weather adapter (`openMeteoCtrl`) | No key required |
| NWS | US severe weather alerts | No key required (User-Agent only) |
| Environment Canada (alerts) | Canadian severe weather alerts | No key required |
| Environment Canada GeoMet (radar) | Alternative radar layer (WMS `RADAR_1KM_RRAI`, current frame only), per-device choice in Settings → Radar source; fetched by the browser, not proxied — the server-side radar analysis always uses RainViewer. See `docs/eccc-radar.md` | No key required |
| GitHub (the repo's `origin`) | In-app update check (`updateChecker`: `api.github.com` commits/compare + `raw.githubusercontent.com` package.json and deploy artefacts, 1 h cache) + `git pull` for `POST /api/update` | No key required (unauthenticated, 60 req/h — hence the 1 h cache) |
| Provider status pages | Debug panel provider-status section (list in `debugCtrl.PROVIDER_STATUS_APIS`; RainViewer via an API ping), 30 min cache; `GET /api/health` surfaces only GitHub "Git Operations", informational | No key required |

## Security

- Remote access requires `ALLOW_REMOTE=true` in the systemd service
- **Remote access is HTTPS-only.** If the TLS cert is unavailable (generation failed, or `SKIP_CERT_AUTOGEN` with no cert on disk), the server falls back to cleartext HTTP on `:8080` but **binds it to `127.0.0.1` only — never `0.0.0.0`, even under `ALLOW_REMOTE`** — so masked settings + traffic are never exposed unencrypted over the LAN. Remote access simply stays down (with a loud startup error) until a cert exists. `harden-kiosk.sh` only opens `:8443` in the firewall to match.
- **The kiosk's Chrome DevTools remote-debugging port (`:9222`) is OFF by default** — gated behind `KIOSK_REMOTE_DEBUG=true` in `deploy/start-server`. While open, any local process can drive the kiosk session and reach the localhost-gated endpoints; enable it (env var or `browser.conf`) only for diagnostics.
- Settings write endpoints (`POST`, `PUT`, `PATCH`, `DELETE`) are always protected by `localhostOnly` middleware — `REMOTE_SECURITY` has been removed
- `GET /settings` returns masked boolean values for API key fields to remote clients; actual key values are only returned to localhost. The mask (`maskForRemote`) is **default-deny**: it projects through the `ALLOWED_KEYS` whitelist *first*, so an unrecognised top-level key (hand-added to `settings.json`, or left over from an older build) can never leak verbatim. (This guards the unknown-key case; a key you deliberately add to `ALLOWED_KEYS` is whitelisted and still passes — if it carries a secret you must also add it to `API_KEY_FIELDS` or `REMOTE_HIDDEN_KEYS`). The boolean is `settingsCtrl.isApiKeyConfigured` ("the server would use this key"), the same predicate as aiSummaryCtrl's no-key 503 (`reason: "no-key"`). So an `anthropicApiKey` left at the `"key"` placeholder masks to `false`, and a remote client hides the AI summary from boot. The other key fields are sent upstream as stored, placeholder included, and stay `Boolean(value)`. Add a field to `PLACEHOLDER_MEANS_UNSET_FIELDS` only together with the controller change that makes it treat the placeholder as unset.
- **Every response carries baseline security headers** (`server/securityHeaders.js`, mounted first): `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Content-Security-Policy: frame-ancestors 'none'`; `X-Powered-By` is disabled. Deliberately no HSTS (self-signed cert + `:8080` HTTP fallback) and no script/style CSP (the SPA relies on runtime inline styles + Leaflet — a restrictive policy would break the kiosk). Set by hand, not via `helmet`, to keep the dependency footprint minimal
- **`settings.json` is kept owner-only (`0600`)** — it holds the six API keys plus the `indoorTemperature` Homebridge credentials, so no other local account may read it. Enforced in two places: `install.sh` `chmod 600`s it on creation, and `settingsCtrl.ensureSecurePermissions()` (called at server startup from `index.js`) re-tightens it on every restart, so an existing fleet install created `0644` self-fixes on the next `systemctl --user restart`. Every `settingsCtrl` write also passes `mode: 0o600` so a freshly created file starts locked down. Mirrors the existing `0600` chmod of the TLS key files.
- **Locality / access gates (`localhostOnly`, `debugLocalhostOnly`, the `req.isLocal` masking decision) use the raw TCP socket peer (`req.socket.remoteAddress`), NOT `req.ip`.** `req.ip` honors `trust proxy` (set to 1 when `ALLOW_REMOTE=true`) and therefore the client-supplied `X-Forwarded-For` header — a direct remote/LAN client can spoof `X-Forwarded-For: 127.0.0.1` to impersonate localhost, which bypassed every `localhostOnly` gate and unmasked `GET /settings` (confirmed + fixed 2026-05-28, commit `e4a9e72`; see `incident_xff_localhost_bypass.md`). The socket peer is the kernel-level connection origin and can't be forged by a header. Both documented remote paths terminate at loopback so they stay "local": SSH tunnel (`ssh -L 8443:localhost:8443`) and RPi Connect (on-device agent → localhost). A direct VPN/LAN client connects from its real IP → correctly treated as remote (read-masked settings, write gates rejected). **Caveat:** if a same-host reverse proxy is ever placed in front, all requests arrive with socket peer `127.0.0.1` and this gate treats everyone as local — at that point the proxy must enforce the restriction itself. **Rate-limit keying and client tracking also key on the socket peer** (`server/rateLimitKey.js` → `socketPeerKeyGenerator`, and `recordClient(req.socket.remoteAddress)`), NOT `req.ip` — a 2026-06-09 audit found the earlier "`req.ip` spoof is low-impact here" assumption wrong: on an `ALLOW_REMOTE` Pi a rotating `X-Forwarded-For` let one client mint unlimited rate-limit buckets (bypassing the limiter, including the only brake on the paid Anthropic endpoint) and unlimited `clientTracker` entries. `req.ip` (XFF-aware) is no longer used for any security- or resource-bearing decision.
- Rate limiting, keyed per socket peer (see above): 120 req/min (`apiLimiter`) on the read `/api/*` endpoints (weather, geocoding, AI summary, alerts, air quality, Sense HAT, …), 600 req/min (`tileLimiter`) on map tiles; `GET /settings`, `/geolocation`, `/api/is-local`, `/api/cert.pem` and the localhost-only routes are not rate-limited. Per-endpoint detail in `docs/api.md`
- Settings key whitelist enforced server-side — unknown keys are rejected or stripped
- Security events (blocked requests) are logged and visible in the debug panel
- **NWS test/exercise alerts (CAP status ≠ `Actual`) are withheld from remote clients.** They are tagged `isTest` at the source and default-hidden at the orchestrator (`govAlertsCtrl.getActiveAlertsAt` + `getNearbyAlertsAt`), so the gate covers every consumer — banner, the `nearby-alerts` map overlay, and the Sense HAT — not just one endpoint. The `GET /api/weather-alerts` / `GET /api/nearby-alerts` `showTest=1` opt-in is honored **only when `req.isLocal`** (the unspoofable socket peer — never `req.ip`/XFF, per the XFF incident), and the response is then `Cache-Control: private, no-store` so a locality-varying body is never shared by a cache or a future same-host proxy. A remote client can neither see the "Show test alerts" toggle (gated on the client's `isLocal`) nor reveal the data with a forged `?showTest=1`.
- To change settings remotely: use an SSH tunnel (`ssh -L 8443:localhost:8443 pi@<pi-ip>`)
