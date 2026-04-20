# CLAUDE.md — Pi Weather Station

This file provides context for Claude Code on any machine working with this project.

## Project Overview

Pi Weather Station is a full-stack weather display application designed to run on a Raspberry Pi with a touchscreen. It shows real-time weather data, radar maps, hourly/daily forecasts, and an AI-generated weather summary powered by Claude.

- **Frontend**: React (webpack, CSS Modules, i18next for EN/FR/ES)
- **Backend**: Node.js / Express
- **Target hardware**: Raspberry Pi (Bullseye, Bookworm, Trixie) with 7" touchscreen running Chromium in kiosk mode
- **Deployment**: systemd user service (`pi-weather-server.service`)

## Architecture

```
pi-weather-station/
├── server/               # Express server (Node.js)
│   ├── index.js          # Entry point, routes, middleware
│   ├── proxyCtrl.js      # Proxies all external API calls (weather, maps, geocoding)
│   ├── aiSummaryCtrl.js  # Claude AI weather summary endpoint
│   ├── debugCtrl.js      # Debug panel data endpoint
│   ├── clientTracker.js  # Tracks remote client IP addresses
│   ├── geolocationCtrl.js # Default location lookup via ipapi.co
│   ├── responseTimer.js  # Per-endpoint response time tracking middleware
│   ├── settingsCtrl.js   # Reads/writes settings.json
│   ├── serviceStatus.js  # Tracks last status of each external service
│   ├── requestCounter.js # API quota counters (persisted to request-counts.json)
│   └── updateChecker.js  # Checks GitHub for new releases (cached 1 hour)
├── client/               # React frontend
│   ├── src/
│   │   ├── AppContext.js             # Global state (settings, units, dark mode, etc.)
│   │   ├── components/
│   │   │   ├── App/                  # Root layout (CSS grid)
│   │   │   ├── CurrentWeather/       # Temperature, weather icon, wind, humidity
│   │   │   ├── InfoPanel/            # Right panel with all weather info + controls
│   │   │   ├── Settings/             # Settings overlay (API keys, units, language)
│   │   │   ├── Debug/                # Debug panel (localhost only)
│   │   │   ├── AiSummary/            # AI-generated weather summary
│   │   │   ├── Clock/                # Digital clock display
│   │   │   ├── LocationName/         # Current location name display
│   │   │   ├── Spinner/              # Loading spinner
│   │   │   ├── SunRiseSet/           # Sunrise/sunset times display
│   │   │   ├── WeatherInfo/          # Weather information container
│   │   │   ├── WeatherMap/           # Radar map (Leaflet + Mapbox tiles)
│   │   │   ├── weatherCharts/        # Hourly and daily forecast charts
│   │   │   └── ControlButtons/       # Bottom control bar (settings, debug, dark mode)
│   │   ├── hooks/
│   │   │   └── useDragScroll.js      # Drag-to-scroll via pointer events (callback ref pattern)
│   │   ├── i18n/locales/             # EN / FR / ES translations
│   │   └── services/conversions.js   # Unit conversions (temp, speed, length)
│   └── dist/             # Compiled bundle (committed to git)
├── deploy/               # Deployment files (systemd service, install script, logrotate)
├── docs/                 # Documentation (architecture, KPI definitions)
└── tools/                # Utility scripts (CSV to Excel converter)
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
- Logs are written to `server.log` at the project root (excluded from git)

### Settings
- API keys and user preferences are stored in `settings.json` (excluded from git)
- Temperature units: `f` (Fahrenheit), `c` (Celsius), `k` (Kelvin)
- Speed units: `mph`, `ms` (m/s), `kmh` (km/h — displayed as "kph" in charts)
- Length units: `in`, `mm`
- Clock: `12`, `24`
- Font size: `s` (85% zoom), `m` (100%, default), `l` (115% zoom) — persisted in `localStorage`

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

## External Services

| Service | Purpose | Environment |
|---|---|---|
| Tomorrow.io | Weather data (current, hourly, daily) | `weatherApiKey` in settings.json |
| Mapbox | Radar tiles + map | `mapApiKey` in settings.json |
| LocationIQ | Reverse geocoding | `reverseGeoApiKey` in settings.json |
| Anthropic Claude | AI weather summary | `anthropicApiKey` in settings.json |
| ipapi.co | IP-based geolocation | No key required |
| sunrise-sunset.org | Sunrise/sunset times | No key required |

## Security

- Remote access requires `ALLOW_REMOTE=true` in the systemd service
- Settings write endpoints (`POST`, `PUT`, `PATCH`, `DELETE`) are always protected by `localhostOnly` middleware — `REMOTE_SECURITY` has been removed
- `GET /settings` returns masked boolean values for API key fields to remote clients; actual key values are only returned to localhost
- All locality checks use `req.ip` (not `req.socket.remoteAddress`); when `ALLOW_REMOTE=true`, Express trusts one proxy hop so `req.ip` reflects the real client IP even behind a local reverse proxy
- Rate limiting: 120 req/min on weather/geocoding endpoints, 600 req/min on map tiles (per client IP)
- Settings key whitelist enforced server-side — unknown keys are rejected or stripped
- Security events (blocked requests) are logged and visible in the debug panel
- To change settings remotely: use an SSH tunnel (`ssh -L 8443:localhost:8443 pi@<pi-ip>`)
