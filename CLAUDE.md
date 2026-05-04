# CLAUDE.md — Pi Weather Station

This file provides context for Claude Code on any machine working with this project.

## Project Overview

Pi Weather Station is a full-stack weather display application designed to run on a Raspberry Pi with a touchscreen. It shows real-time weather data, radar maps, hourly/daily forecasts, and an AI-generated weather summary powered by Claude.

- **Frontend**: React (webpack, CSS Modules, i18next for EN/FR/ES)
- **Backend**: Node.js / Express
- **Target hardware**: Raspberry Pi (Bullseye, Bookworm, Trixie) with 7" touchscreen running a kiosk browser; also runs on Debian/Ubuntu, openSUSE, and macOS
- **Kiosk browser**: Chromium-family (Chromium, Chrome, Brave, Edge) or Firefox; choice prompted by `install.sh` and persisted in `~/.config/pi-weather-station/browser.conf` (`BROWSER_CMD` + `BROWSER_FAMILY`). Snap-Firefox is supported via named profile (`-P pi-weather-station`)
- **Official 7" touchscreen on Trixie**: Mouse Emulation mode must be disabled — set DSI-1 to **Multitouch** via Control Centre → Screens → DSI-1 → Touchscreen. See `docs/troubleshooting-touchscreen.md`.
- **Deployment**: systemd user service (`pi-weather-server.service`) on Linux + XDG autostart entry on GNOME/KDE; launchd agent (`com.pi-weather-station.plist`) on macOS. Optional `pi-sensehat.service` for Sense HAT readings.

## Architecture

```
pi-weather-station/
├── server/               # Express server (Node.js)
│   ├── index.js          # Entry point, routes, middleware, /api/update flow
│   ├── proxyCtrl.js      # Proxies all external API calls (weather, maps, geocoding)
│   ├── aiSummaryCtrl.js  # Claude AI weather summary endpoint (current + radar paragraph)
│   ├── radarAnalyzerCtrl.js # Parses RainViewer tile pixels for the 45 km zone
│   ├── indoorTempCtrl.js # Polls Homebridge for indoor temperature/humidity/air quality
│   ├── sensehatCtrl.js   # Reads Sense HAT JSON dropped by tools/sensehat_weather.py
│   ├── debugCtrl.js      # Debug panel data endpoint (localhost-only)
│   ├── clientTracker.js  # Tracks remote client IP addresses
│   ├── geolocationCtrl.js # Default location lookup via ipapi.co (retry + 30-day disk cache)
│   ├── responseTimer.js  # Per-endpoint response time tracking middleware
│   ├── settingsCtrl.js   # Reads/writes settings.json (server-side whitelist)
│   ├── serviceStatus.js  # Tracks last status of each external service
│   ├── requestCounter.js # API quota counters (persisted to request-counts.json)
│   └── updateChecker.js  # GitHub release check + needsManualUpgrade detection (cached 1 h)
├── client/               # React frontend
│   ├── src/
│   │   ├── AppContext.js             # Global state (settings, units, dark mode, etc.)
│   │   ├── components/
│   │   │   ├── App/                  # Root layout (CSS grid)
│   │   │   ├── CurrentWeather/       # Temperature, weather icon, wind, humidity
│   │   │   ├── IndoorTemperature/    # Indoor temp/humidity/air-quality block (Homebridge)
│   │   │   ├── InfoPanel/            # Right panel with all weather info + controls
│   │   │   ├── Settings/             # Settings overlay (API keys, units, language, indoor)
│   │   │   ├── Debug/                # Debug panel (localhost only)
│   │   │   ├── AiSummary/            # AI-generated weather summary
│   │   │   ├── Clock/                # Digital clock display (12/24 h, scaled AM/PM)
│   │   │   ├── LocationName/         # Current location name display
│   │   │   ├── Spinner/              # Loading spinner
│   │   │   ├── SunRiseSet/           # Sunrise/sunset times display
│   │   │   ├── UpdateModal/          # In-app updater UX (commits, warnings, errors)
│   │   │   ├── WeatherInfo/          # Weather information container
│   │   │   ├── WeatherMap/           # Radar map (Leaflet + RainViewer tiles + 45 km circle)
│   │   │   ├── weatherCharts/        # Hourly and daily forecast charts
│   │   │   └── ControlButtons/       # Bottom control bar (settings, debug, dark mode)
│   │   ├── hooks/
│   │   │   └── useDragScroll.js      # Drag-to-scroll via pointer events (callback ref pattern)
│   │   ├── i18n/locales/             # EN / FR / ES translations
│   │   └── services/conversions.js   # Unit conversions (temp, speed, length)
│   └── dist/             # Compiled bundle (committed to git)
├── deploy/               # Multi-distro install.sh, systemd units, autostart, kiosk launcher,
│                          # harden-kiosk.sh, logrotate, launchd plist, uninstall.sh
├── docs/                 # api.md, architecture, KPI, security, troubleshooting, ui-layout (en/fr),
│                          # radar-classification (RainViewer pixel → tier → display colour)
└── tools/                # CSV→Excel converter, Sense HAT collector script
```

## Key Conventions

### Commits
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`
- Always include `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`

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
- Logs: `tail -f /tmp/weather-server.log` on Linux (systemd drop-in pins StandardOutput there), `tail -f <repo>/server.log` on macOS (launchd plist points there). Both are gitignored. **`journalctl --user -u pi-weather-server` only shows systemd lifecycle events on Linux — not the app's console output.** Full explanation in [`docs/logs.md`](docs/logs.md).

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

### Server
- All outbound HTTP calls must include `{ timeout: 10_000 }` — no exceptions
- New endpoints must be protected by the appropriate middleware (`localhostOnly`, `apiLimiter`, or `tileLimiter`) before being shipped
- Never read `settings.json` directly from a controller — always go through `settingsCtrl.getSettings()`

### Documentation hygiene
- `CHANGELOG.md` is the single source of truth for version history — do not add per-version highlight sections to `readme.md`. The readme points to `CHANGELOG.md` and the GitHub Releases page; that's enough.
- `ROADMAP.md` technical debt section must be updated when a debt item is resolved or a new one is identified
- `docs/ui-layout_fr.md` and `docs/ui-layout_en.md` must be kept in sync when the screen layout changes

## External Services

| Service | Purpose | Environment |
|---|---|---|
| Tomorrow.io | Weather data (current, hourly, daily) | `weatherApiKey` in settings.json |
| Mapbox | Base map tiles | `mapApiKey` in settings.json |
| RainViewer | Radar tiles + 45 km zone analysis | No key required |
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
| NWS | US severe weather alerts | No key required (User-Agent only) |
| Environment Canada (alerts) | Canadian severe weather alerts | No key required |

## Security

- Remote access requires `ALLOW_REMOTE=true` in the systemd service
- Settings write endpoints (`POST`, `PUT`, `PATCH`, `DELETE`) are always protected by `localhostOnly` middleware — `REMOTE_SECURITY` has been removed
- `GET /settings` returns masked boolean values for API key fields to remote clients; actual key values are only returned to localhost
- All locality checks use `req.ip` (not `req.socket.remoteAddress`); when `ALLOW_REMOTE=true`, Express trusts one proxy hop so `req.ip` reflects the real client IP even behind a local reverse proxy
- Rate limiting: 120 req/min on weather/geocoding endpoints, 600 req/min on map tiles (per client IP)
- Settings key whitelist enforced server-side — unknown keys are rejected or stripped
- Security events (blocked requests) are logged and visible in the debug panel
- To change settings remotely: use an SSH tunnel (`ssh -L 8443:localhost:8443 pi@<pi-ip>`)
