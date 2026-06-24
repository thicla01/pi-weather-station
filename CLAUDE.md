# CLAUDE.md — Pi Weather Station

This file provides context for Claude Code on any machine working with this project.

## Project Overview

Pi Weather Station is a full-stack weather display application designed to run on a Raspberry Pi with a touchscreen. It shows real-time weather data, radar maps, hourly/daily forecasts, and an AI-generated weather summary powered by Claude.

- **Frontend**: React (webpack, CSS Modules, i18next for EN/FR/ES)
- **Backend**: Node.js / Express
- **Target hardware**: Raspberry Pi (Bullseye, Bookworm, Trixie) with 7" touchscreen running a kiosk browser; also runs on Debian/Ubuntu, openSUSE, and macOS
- **Kiosk browser**: Chromium-family (Chromium, Chrome, Brave, Edge) or Firefox; choice prompted by `install.sh` and persisted in `~/.config/pi-weather-station/browser.conf` (`BROWSER_CMD` + `BROWSER_FAMILY`, plus an optional `DISPLAY_SCALE` override). Snap-Firefox is supported via named profile (`-P pi-weather-station`)
- **Kiosk display auto-scale**: `deploy/detect-display-scale.sh` derives a per-panel scale from the screen's **physical** density (`wlr-randr`/`xrandr` → diagonal PPI) so a small high-density panel (e.g. 10.1" 800×1280 ≈ 150 PPI) doesn't render the UI tiny. Target is `TARGET_PPI=130` (the 7" official screen's density); `start-server` applies it at every boot via Chromium `--force-device-scale-factor` or a Firefox `layout.css.devicePixelRatio` profile pref. Emitted only when scaling helps; pin/disable via `DISPLAY_SCALE` (`auto`/number/`off`) in `browser.conf` — settable over SSH or from the **Settings UI** (Advanced → "Display scale"), which writes the same `DISPLAY_SCALE` line via `displayScaleCtrl` (applies on the next kiosk relaunch). This is the escape hatch for a panel whose EDID **lies about its physical size** (e.g. a 13.3" reporting 350×190 mm → 141 PPI → auto-scale wrongly lands on 1.0)
- **Official 7" touchscreen on Trixie**: Mouse Emulation mode must be disabled — set DSI-1 to **Multitouch** via Control Centre → Screens → DSI-1 → Touchscreen. See `docs/troubleshooting-touchscreen.md`.
- **Deployment**: systemd user service (`pi-weather-server.service`) on Linux + XDG autostart entry on GNOME/KDE; launchd agent (`com.pi-weather-station.plist`) on macOS. Optional Sense HAT display daemons: `pi-sensehat.service` (weather/radar on the LED matrix) and `pi-sensehat-clock.service` (clock) — mutually exclusive, switched via `/api/sensehat-mode`.

## Architecture

```
pi-weather-station/
├── server/               # Express server (Node.js)
│   ├── index.js          # Entry point, routes, middleware, /api/update flow
│   ├── proxyCtrl.js      # Proxies all external API calls (weather, maps, geocoding)
│   ├── aiSummaryCtrl.js  # Claude AI weather summary endpoint (current + radar paragraph)
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
│   ├── singleFlight.js   # Single-flight guard middleware — 409s concurrent runs of a non-reentrant op (in-app updater)
│   ├── compressionStats.js # In-memory stats on the radar-prompt compression (legacy vs hierarchical format)
│   ├── settingsCtrl.js   # Reads/writes settings.json (server-side whitelist)
│   ├── serviceStatus.js  # Tracks last status of each external service
│   ├── requestCounter.js # API quota counters (persisted to request-counts.json)
│   └── updateChecker.js  # GitHub release check + needsManualUpgrade detection (cached 1 h)
├── client/               # React frontend
│   ├── src/
│   │   ├── AppContext.js             # Global state (composes useUpdateChecker, useScreenSaver, useUiPreferences hooks; inline state for the rest — weather data, geo, advanced.* save chain, UI state)
│   │   ├── components/
│   │   │   ├── App/                  # Root layout (CSS grid)
│   │   │   ├── ambient/              # v3 "Ambient Layers" tree (default since v2.18) — LayoutDesktop/Mobile/Pi, HeroBand, HeroCompact, MetricsGrid, ChartTabs, BottomDock, alert banner + detail slab, ambient SettingsPanel/DebugPanel, MoonDetailsPopover, etc. (32 components — incl. ControlButtons + weatherCharts, relocated here from the legacy tree in 2026-06 because the v3 dock and ChartTabs consume them)
│   │   │   ├── AmbientLayers/        # Palette dispatcher (day/dusk/night/nightRed), viewport breakpoints, iOS PWA bg paint
│   │   │   ├── WeatherMap/           # Leaflet radar — index.js + RadarTimeline + RadarLegend + RiskRing + MapResizer + RadarFocusControl + geometry.js (pure helpers + style tables)
│   │   │   ├── UpdateModal/          # In-app updater UX (commits, warnings, errors)
│   │   │   ├── ScreenSaver/          # Sleep mode (stage 1 minimal clock, stage 2 anti-burn-in dot)
│   │   │   ├── LocationName/         # Reverse-geocoded place name (shared by v2 + v3)
│   │   │   ├── Settings/, Debug/, InfoPanel/, CurrentWeather/, AiSummary/, Clock/, SunRiseSet/, WeatherInfo/, IndoorTemperature/, AlertBanner/, GovAlertDetail/, UvAqiBadges/, RangeSlider/, Spinner/  # Legacy v2 tree — still mounts when `experimentalUiC=false`, queued for WHOLESALE REMOVAL once the v2.18 field-test trigger fires (no v3-only regression for 4 weeks). This list IS the removal scope (audited 2026-06: the former v3→v2 imports were relocated — ControlButtons + weatherCharts now live under ambient/, exportDebugCsv under ui/ — so deleting these directories breaks nothing v3-side ONCE the v2 branch of `App/index.js` is unwired first: its static imports of InfoPanel/Settings/Debug and the `experimentalUiC=false` JSX branch must go in the same PR, along with the `experimentalUiC` flag itself)
│   │   ├── hooks/
│   │   │   ├── useDragScroll.js      # Drag-to-scroll via pointer events (callback ref pattern)
│   │   │   ├── useUpdateChecker.js   # In-app update flow (state + periodic poll + actions)
│   │   │   ├── useScreenSaver.js     # Brightness + sleep-mode state (debounced slider + initial /api/brightness fetch)
│   │   │   ├── useUiPreferences.js   # Units / clock / fontSize (localStorage + first-launch locale seed)
│   │   │   ├── useIdleDetection.js   # Idle-watcher driving ScreenSaver
│   │   │   └── useDismissedAlerts.js # Per-device dismissal tracking for AlertBanner (4 h auto-resurface floor)
│   │   ├── i18n/locales/             # EN / FR / ES translations
│   │   └── services/conversions.js   # Unit conversions (temp, speed, length, distance)
│   └── dist/             # Compiled bundle (committed to git)
├── deploy/               # Multi-distro install.sh, systemd units, autostart, kiosk launcher,
│                          # detect-display-scale.sh (per-panel kiosk auto-scale from physical PPI),
│                          # relaunch-kiosk.sh (cycles the kiosk browser to apply a display-scale change; spawned by displayScaleCtrl),
│                          # harden-kiosk.sh, logrotate, launchd plist, uninstall.sh
├── docs/                 # api.md, architecture, KPI, security, troubleshooting, ui-layout (en/fr),
│                          # radar-classification (RainViewer pixel → tier → display colour)
└── tools/                # CSV→Excel converter, Sense HAT display daemons (sensehat_weather.py + horloge.py,
                           # both poll GET /api/sensehat over HTTPS and render on the LED matrix)
```

## Key Conventions

### Commits
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`
- Always include a `Co-Authored-By` trailer naming the **actual model** that did the work (currently `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`) — update the model string as the working model changes; do not hardcode a stale version

### CSS
- CSS Modules with kebab-case in `.css` files → camelCase in JSX
- css-loader requires `{ esModule: false }` for `.locals` to work with style-loader

### ESLint rules to watch
- `prefer-destructuring`: use `const { x } = obj` instead of `const x = obj.x`
- `react-hooks/exhaustive-deps`: stable setState functions can be excluded with `// eslint-disable-line`
- `jsdoc/require-param` and `jsdoc/require-returns-description`: all components need JSDoc

### Client build
```bash
cd client && npm run prod
```
The compiled `dist/` files are committed to git so Pis can `git pull` without rebuilding.

### Server
- All outbound `axios.get()` calls must include `{ timeout: 10_000 }`
- Console output is timestamped (local time) via override in `server/index.js`
- Logs: `tail -f ~/.local/state/pi-weather-station/server.log` on Linux (systemd drop-in pins StandardOutput there — XDG state dir, NOT `/tmp`, which is a tmpfs on Trixie; installs older than 2026-06 still write `/tmp/weather-server.log` until `install.sh` is re-run), `tail -f <repo>/server.log` on macOS (launchd plist points there, gitignored). **`journalctl --user -u pi-weather-server` only shows systemd lifecycle events on Linux — not the app's console output.** Full explanation in [`docs/logs.md`](docs/logs.md).

### Settings
- API keys and user preferences are stored in `settings.json` (excluded from git)
- Temperature units: `f` (Fahrenheit), `c` (Celsius), `k` (Kelvin)
- Speed units: `mph`, `ms` (m/s), `kmh` (km/h — displayed as "kph" in charts)
- Length units: `in`, `mm`
- Distance units: `mi`, `km` (persisted in `localStorage` like the other unit prefs) — drives the radar circles, sampling geometry, and AI summary distance unit
- Clock: `12`, `24`
- Font size: `s` (85% zoom), `m` (100%, default), `l` (115% zoom) — persisted in `localStorage`
- `indoorTemperature` block (top-level since v2.6.0): `{ enabled, host, port, username, password, sensorName }` — fully stripped from remote `GET /settings` responses (host/credentials are not even masked)

### Small screen adaptations (≤ 520 px height)
- **Chart tabs** — Hourly and daily charts are shown as tabs ("24 hours" / "5 days") rather than stacked, to save vertical space
- **Collapsible info panel** — A floating toggle button on the right edge of the radar map collapses/expands the info panel; Leaflet calls `map.invalidateSize()` after each toggle via the `MapResizer` component
- Both features activate via `window.matchMedia("(max-height: 520px)")` with a `change` listener for live detection

### Debug panel
- Accessible from localhost only (both server-side middleware and client-side button)
- Enabled via `DEBUG=true` in the systemd service environment
- Exports all sections to CSV (`weather-station-debug-*.csv` → `~/Downloads/`)
- Use SSH tunnel to access from macOS: `ssh -L 8443:localhost:8443 pi@<pi-ip>`

### Deployment on other Pis
```bash
cd ~/pi-weather-station
git pull
systemctl --user restart pi-weather-server
```
No client rebuild needed — dist files are committed.

The in-app updater (`POST /api/update` from the settings modal) does the same thing plus `npm install` and a service restart, gated by pre-flight checks (rejects detached HEAD, non-master branch, or local changes with a structured 409). Installs older than commit `a1b8b78` (pre-v2.4.1) are flagged with `needsManualUpgrade` so the modal directs the user to `bash deploy/install.sh` instead.

## Maintainability Guidelines

These rules apply to every change, regardless of size. They exist to keep the codebase readable, consistent, and safe to modify months after the original work was done.

### Before committing
- Run `cd client && npm run prod` — the build must pass with **zero errors** (warnings on bundle size are acceptable)
- Every new or modified React component must have a complete **JSDoc block** (`@param`, `@returns`) and declared **PropTypes**
- Every new UI string must have a translation key in all three locale files (`en.json`, `fr.json`, `es.json`)
  - **Codified exception (maintainer decision, 2026-06):** the inline-trilingual helper `lbl(lang, en, fr, es)` is permitted **in `SettingsPanel` and `DebugPanel` only** — dense, maintainer-facing configuration surfaces where keeping the three strings next to their usage beats locale-file indirection (~188 call sites). The boundary is strict: `lbl()` must NOT spread to kiosk-visible surfaces (layouts, hero, metrics, charts) and NEVER to alert content (banners, chips, detail sections) — those always go through the locale files. If a fourth language is ever added, this exception is the first thing to revisit (the `lbl()` strings would all need a migration pass).
- New or modified Express endpoints must be reflected in **`docs/api.md`**
- Notable changes must be added to **`CHANGELOG.md`** under the appropriate version

### React components
- **One responsibility per component** — if a component renders more than one distinct concept, split it
- **Local state first** — only promote state to `AppContext` if two or more unrelated components need it; `AppContext.js` is already large and should not grow without deliberate justification
- **No inline styles for static values** — use CSS Modules; inline styles are reserved for values that are computed at runtime (e.g. `zoom`, `gridTemplateColumns`, CSS custom properties)
- **Always clean up side effects** — every `setInterval`, `setTimeout`, or event listener registered in a `useEffect` must have a corresponding cleanup in the return function

### ESLint suppressions
- **Avoid `// eslint-disable-line` and `// eslint-disable-next-line`** — if a suppression is truly necessary, add an inline comment on the same line explaining *why* the rule is being bypassed
- The only accepted standing exception is `react-hooks/exhaustive-deps` on initialization effects that run once on mount — these must carry the comment `// eslint-disable-line react-hooks/exhaustive-deps -- initialization, runs once on mount`

### Constants and magic values
- Named constants for all intervals, thresholds, and repeated literals — define them at the top of the file (e.g. `const REFRESH_INTERVAL = 15 * 60 * 1000`)
- No hardcoded pixel values shared between components — use CSS custom properties (e.g. `--info-col-width`) so a single change propagates everywhere

### Alert banners — always identify the source
- **Every alert banner must carry a leading source badge** so the user can tell at a glance whether the alert is authoritative (government feed) or derived locally. Existing tags:
  - `ECCC` — Environment and Climate Change Canada (official Canadian alerts)
  - `NWS` — US National Weather Service (official US alerts)
  - `RADAR` — derived from RainViewer pixel analysis via `radarAnalyzerCtrl`
  - `AIR` — air-quality health-risk alert (v3.2). Rendered by `ambient/AirAlertCard` (NOT `AlertBanner`), shown on the Pi MID rail when the normalized AQ `category` reaches `high`/`veryHigh` (`getAirAlertState` in `ui/alertLogic.js`). Pairs the `AIR` category tag with the index's source badge (`AQHI`/`IQA`/`AQI`); below the health-risk band the reading stays in the inline `AirCard` only. Tier colour mirrors the radar/gov strip (orange = high, red = veryHigh).
  - `FCST` — Tomorrow.io forecast threshold. Not a banner: it tags the auto-select forecast-tab **reason chip** in `ChartTabs` (the chip reuses the same `SourceBadge` visual), shown when the chart's metric tab was auto-selected from a forecast threshold rather than a gov alert (`NWS`/`ECCC`) or radar (`RADAR`). See `docs/auto-forecast-tab-selection-design.md`.
  - `TEST` — **a qualifier, not a source.** Appended *next to* the source badge (rendered via `SourceBadge variant="test"`) when an NWS alert with CAP status ≠ `Actual` (Test/Exercise/System/Draft) is revealed via the localhost-only "Show test alerts" toggle. Deliberately a **neutral outlined** pill (never coloured — `--c-warn` collapses to red in the nightRed palette, which would re-create the false-emergency look this feature prevents), paired with a "TEST ·" title prefix for zero ambiguity. NWS-only (ECCC carries no CAP status). These alerts are **hidden by default everywhere** (banner, map overlay, Sense HAT) and never served to remote clients — see the Security section.
- When introducing a new banner-producing source, **assign it a short uppercase tag (3-5 chars)** following the same visual convention. Honest about origin (`AQI`, `SENSE`, `CLAUDE`, etc.); avoid vague labels like `LOCAL` or `AUTO`. Document the new tag in this file and in the JSDoc of `AlertBanner/index.js`.
- All banner badges share the `styles.sourceBadge` CSS class — reuse it, don't fork.

### Gov-alert detail section — reading-first UX
- `GovAlertDetail` (collapsible under `AlertBanner`) is **collapsed by default**. Expanded mode is for reading, not glancing.
- When expanded, the description body is capped at ~65 vh — high enough that most ECCC/NWS descriptions display in one read, with internal scroll for the rare verbose case. This is intentional: the maintainer's direction is "lorsqu'il y a une alerte gouvernementale et que l'on veut lire les détails, il me semble normal de prendre toute la place disponible. Pour retourner avec les informations météo, on collapse." Translation: when the user has chosen to read a gov alert, they get the screen real estate. The weather info area below still scrolls internally; if it gets squeezed too small, the user collapses the alert detail.
- **External links from the kiosk are kiosk-hostile — use QR codes only, never raw `<a>` elements.** Chromium in kiosk mode has no browser chrome and no easy way back from an external page; a tap on a text link is a one-way trap even when the URL is valid. The original implementation paired a QR with a text link "for SSH-tunnel desktop users", but the desktop case has the same problem (user lands on an upstream page they then have to manage). Maintainer call: ship QR-only. Users on any platform scan the code with their phone (or for desktop, scan the screen with their phone, or right-click → Save Image As to extract). Use `qrcode.react` (`QRCodeSVG`) — SVG renders crisp at any size and needs no network. **This rule applies to any future feature that wants to point the user at an external URL.**
  - **Codified exception (maintainer decision, 2026-06): the Debug panel.** It is localhost-only (server-enforced) and reached from a desktop browser or SSH tunnel — never from the chrome-less kiosk — so a direct `<a target="_blank">` is permitted there (e.g. the Dependabot CTA in the About bucket). The exception covers the Debug panel only; everything kiosk-visible stays QR-only.
- External link targets must be **stable, vendor-curated landing pages** — not deep links to specific alerts via opaque IDs. ECCC's JSON-API IDs don't map to public URL slugs, and the per-alert URLs would 404 the moment the alert expires upstream. Use root or national-overview pages (`meteo.gc.ca/canada_f.html`, `weather.gc.ca/canada_e.html`, `weather.gov/`). Never include lat/lon as query parameters to external destinations (privacy: see `<user_privacy>` in the system prompt).

### Server
- All outbound HTTP calls must include `{ timeout: 10_000 }` — no exceptions
- New endpoints must be protected by the appropriate middleware (`localhostOnly`, `apiLimiter`, or `tileLimiter`) before being shipped
- Never read `settings.json` directly from a controller — always go through `settingsCtrl.getSettings()`

### Tests
- Live in `test/<area>.test.js` and run via `npm test` (Node's built-in `node --test` runner — no test deps).
- The current suite covers the radar trend pipeline (`test/radarTrend.test.js`) — the live cases that shaped v2.13 (Sorel approaching, Stratford drifting, Beauce-Sartigan intensification-in-place) are encoded as regression tests so the next refactor of `computePerDirectionTrends` / `summarizeRingTrend` / `computeTrendConfidence` doesn't silently break them.
- When tweaking the trend thresholds, ETA gate, or intensity rules, **run `npm test` before pushing** — the existing assertions encode the empirical thresholds that came out of live debugging.
- Internal helpers tested via the `__test` export on the controller (e.g. `radarAnalyzerCtrl.__test`) — keeps the public surface clean while letting tests reach the pure-function helpers.

### Documentation hygiene
- `CHANGELOG.md` is the single source of truth for version history — do not add per-version highlight sections to `readme.md`. The readme points to `CHANGELOG.md` and the GitHub Releases page; that's enough.
- `ROADMAP.md` technical debt section must be updated when a debt item is resolved or a new one is identified
- `docs/ui-layout_fr.md` and `docs/ui-layout_en.md` must be kept in sync when the screen layout changes

### Incident reports for long-to-resolve bugs
- **Write an incident report when a bug debugging session meets at least one of**: ≥ 45 min of back-and-forth, ≥ 3 wrong hypotheses before the fix, a cause that wasn't findable via direct code search (CSS spec war, platform-specific behaviour, layered caching, etc.), or a recurrence risk if someone makes the same class of change again.
- File the report immediately after committing the fix — the chronological detail of "what we tried first and what we thought at each step" decays fast. Past 24 h, the most useful part of the report (the failed-hypotheses timeline) is gone.
- Reports live as Markdown notes in the agent's memory store (`~/.claude/projects/<project>/memory/incident_<topic>.md`) and follow a fixed structure: TL;DR → Timeline table → Exact cause → Fix and rejected alternatives → Lessons learned → "For next time" actionable bullets. See [`incident_status_chip_specificity_war.md`](https://github.com/thicla01/pi-weather-station) and [`incident_moon_glyph_emoji_platform.md`](https://github.com/thicla01/pi-weather-station) for examples of the depth and tone expected.
- The point of the report is *the recurring trap*, not the specific bug. If the lesson reads "we should have read X before writing Y" or "diagnostic Z would have saved an hour," that's the keeper. Skip reports for one-off typos / obvious-once-read bugs / design decisions resolved by a conversation.

## External Services

| Service | Purpose | Environment |
|---|---|---|
| Tomorrow.io | Weather data (current, hourly, daily) | `weatherApiKey` in settings.json |
| Mapbox | Base map tiles | `mapApiKey` in settings.json |
| RainViewer | Radar tiles + 50 km zone analysis | No key required |
| LocationIQ | Reverse geocoding | `reverseGeoApiKey` in settings.json |
| Anthropic Claude | AI weather summary (claude-haiku-4-5) | `anthropicApiKey` in settings.json |
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

## Security

- Remote access requires `ALLOW_REMOTE=true` in the systemd service
- **Remote access is HTTPS-only.** If the TLS cert is unavailable (generation failed, or `SKIP_CERT_AUTOGEN` with no cert on disk), the server falls back to cleartext HTTP on `:8080` but **binds it to `127.0.0.1` only — never `0.0.0.0`, even under `ALLOW_REMOTE`** — so masked settings + traffic are never exposed unencrypted over the LAN. Remote access simply stays down (with a loud startup error) until a cert exists. `harden-kiosk.sh` only opens `:8443` in the firewall to match.
- **The kiosk's Chrome DevTools remote-debugging port (`:9222`) is OFF by default** — gated behind `KIOSK_REMOTE_DEBUG=true` in `deploy/start-server`. While open, any local process can drive the kiosk session and reach the localhost-gated endpoints; enable it (env var or `browser.conf`) only for diagnostics.
- Settings write endpoints (`POST`, `PUT`, `PATCH`, `DELETE`) are always protected by `localhostOnly` middleware — `REMOTE_SECURITY` has been removed
- `GET /settings` returns masked boolean values for API key fields to remote clients; actual key values are only returned to localhost. The mask (`maskForRemote`) is **default-deny**: it projects through the `ALLOWED_KEYS` whitelist *first*, so an unrecognised top-level key (hand-added to `settings.json`, or left over from an older build) can never leak verbatim. (This guards the unknown-key case; a key you deliberately add to `ALLOWED_KEYS` is whitelisted and still passes — if it carries a secret you must also add it to `API_KEY_FIELDS` or `REMOTE_HIDDEN_KEYS`)
- **Every response carries baseline security headers** (`server/securityHeaders.js`, mounted first): `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Content-Security-Policy: frame-ancestors 'none'`; `X-Powered-By` is disabled. Deliberately no HSTS (self-signed cert + `:8080` HTTP fallback) and no script/style CSP (the SPA relies on runtime inline styles + Leaflet — a restrictive policy would break the kiosk). Set by hand, not via `helmet`, to keep the dependency footprint minimal
- **`settings.json` is kept owner-only (`0600`)** — it holds the six API keys plus the `indoorTemperature` Homebridge credentials, so no other local account may read it. Enforced in two places: `install.sh` `chmod 600`s it on creation, and `settingsCtrl.ensureSecurePermissions()` (called at server startup from `index.js`) re-tightens it on every restart, so an existing fleet install created `0644` self-fixes on the next `systemctl --user restart`. Every `settingsCtrl` write also passes `mode: 0o600` so a freshly created file starts locked down. Mirrors the existing `0600` chmod of the TLS key files.
- **Locality / access gates (`localhostOnly`, `debugLocalhostOnly`, the `req.isLocal` masking decision) use the raw TCP socket peer (`req.socket.remoteAddress`), NOT `req.ip`.** `req.ip` honors `trust proxy` (set to 1 when `ALLOW_REMOTE=true`) and therefore the client-supplied `X-Forwarded-For` header — a direct remote/LAN client can spoof `X-Forwarded-For: 127.0.0.1` to impersonate localhost, which bypassed every `localhostOnly` gate and unmasked `GET /settings` (confirmed + fixed 2026-05-29; see `incident_xff_localhost_bypass.md`). The socket peer is the kernel-level connection origin and can't be forged by a header. Both documented remote paths terminate at loopback so they stay "local": SSH tunnel (`ssh -L 8443:localhost:8443`) and RPi Connect (on-device agent → localhost). A direct VPN/LAN client connects from its real IP → correctly treated as remote (read-masked settings, write gates rejected). **Caveat:** if a same-host reverse proxy is ever placed in front, all requests arrive with socket peer `127.0.0.1` and this gate treats everyone as local — at that point the proxy must enforce the restriction itself. **Rate-limit keying and client tracking also key on the socket peer** (`server/rateLimitKey.js` → `socketPeerKeyGenerator`, and `recordClient(req.socket.remoteAddress)`), NOT `req.ip` — a 2026-06-09 audit found the earlier "`req.ip` spoof is low-impact here" assumption wrong: on an `ALLOW_REMOTE` Pi a rotating `X-Forwarded-For` let one client mint unlimited rate-limit buckets (bypassing the limiter, including the only brake on the paid Anthropic endpoint) and unlimited `clientTracker` entries. `req.ip` (XFF-aware) is no longer used for any security- or resource-bearing decision.
- Rate limiting: 120 req/min on weather/geocoding endpoints, 600 req/min on map tiles (per client IP)
- Settings key whitelist enforced server-side — unknown keys are rejected or stripped
- Security events (blocked requests) are logged and visible in the debug panel
- **NWS test/exercise alerts (CAP status ≠ `Actual`) are withheld from remote clients.** They are tagged `isTest` at the source and default-hidden at the orchestrator (`govAlertsCtrl.getActiveAlertsAt` + `getNearbyAlertsAt`), so the gate covers every consumer — banner, the `nearby-alerts` map overlay, and the Sense HAT — not just one endpoint. The `GET /api/weather-alerts` / `GET /api/nearby-alerts` `showTest=1` opt-in is honored **only when `req.isLocal`** (the unspoofable socket peer — never `req.ip`/XFF, per the XFF incident), and the response is then `Cache-Control: private, no-store` so a locality-varying body is never shared by a cache or a future same-host proxy. A remote client can neither see the "Show test alerts" toggle (gated on the client's `isLocal`) nor reveal the data with a forged `?showTest=1`.
- To change settings remotely: use an SSH tunnel (`ssh -L 8443:localhost:8443 pi@<pi-ip>`)
