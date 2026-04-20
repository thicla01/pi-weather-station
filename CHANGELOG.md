# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [2.2.3] - 2026-04-20

### Added
- Font size setting (S / M / L — 85% / 100% / 115% zoom) for the info panel, persisted in `localStorage`
- Chart tabs on small screens (≤ 520 px height): HourlyChart and DailyChart shown as "24 hours" / "5 days" tabs instead of stacked
- Collapsible info panel on small screens: floating toggle button on the right edge of the radar map; Leaflet resizes automatically via `MapResizer` component
- AI Summary toggle button: tapping "AI SUMMARY / RÉSUMÉ IA" collapses the forecast charts and scrolls the summary into view; tapping again restores the charts and scrolls back to top

### Changed
- Radar legend overlay restyled to match the app palette: frosted-glass background, panel-tinted border, dark/light mode variants, slightly larger color swatches
- Speed unit km/h now labelled "kph" in forecast chart axes

---

## [2.2.2] - 2026-04-19

### Added
- One-click update button in the debug panel tooltip (localhost only) — triggers `git pull --ff-only` and restarts the service without opening a terminal
- Copy-to-clipboard button for the update command in the debug tooltip
- Platform-aware update instructions: `systemctl` command shown on systemd hosts, `npm start` note on non-systemd hosts (e.g. macOS)

### Changed
- FPS measurement in the debug panel uses a 60-frame sliding window for a more stable reading

### Fixed
- Update indicator in the control bar now refreshes immediately when the debug panel is manually refreshed, without waiting for the 6-hour client-side check cycle

---

## [2.2.1] - 2026-04-18

### Fixed
- iPad / mobile browser scroll: removed non-passive `touchmove` listener from `useDragScroll` that blocked iOS Safari's native scroll; Pi touchscreen unaffected (uses pointer events)
- Controls hidden on mobile browsers: app container now uses `height: 100dvh` (dynamic viewport height) alongside the `100vh` fallback to avoid the iOS Safari toolbar overlap
- Update badge remained visible after `git pull` + restart until the next 6-hour cycle; debug panel refresh now reads `updateInfo` from `/api/debug` and updates the indicator immediately

---

## [2.2.0] - 2026-04-16

### Added
- Rate limiting: 120 req/min on weather/geocoding endpoints, 600 req/min on map tile endpoints (per client IP)
- Settings key whitelist: unknown keys stripped silently (PUT/POST) or rejected with HTTP 400 (PATCH)
- Proxy-aware IP detection: `req.ip` used for all locality checks; Express trusts one proxy hop when `ALLOW_REMOTE=true`

### Changed
- `GET /settings` now returns boolean values for API key fields to remote clients; actual values only returned to localhost
- Settings write endpoints (`POST`, `PUT`, `PATCH`, `DELETE`) are now always restricted to localhost — `REMOTE_SECURITY` environment variable removed
- `/api/is-local` response only includes `debugEnabled` when the request comes from localhost

---

## [2.1.11] - 2026-04-14

### Added
- Debug panel — Server KPIs: process uptime, heap memory (used/total), RSS, weather cache hit rate, per-endpoint response time table (count, avg, min, max) via new `responseTimerMiddleware`
- Debug panel — Client KPIs: page load time, live FPS via `requestAnimationFrame`, JS heap size (Chromium), per-endpoint `/api/*` call summary via Resource Timing API

### Changed
- Opening Settings now closes Debug, and vice versa — both panels can no longer be visible simultaneously

### Fixed
- Replaced two GPL-licensed icon packages (`@iconify/icons-gridicons`, `@iconify/icons-dashicons`) with MIT-licensed equivalents; all dependencies are now MIT/ISC/BSD/Apache-2.0/CC

---

## [2.1.10] - 2026-04-13

### Fixed
- LXDE autostart: `install.sh` now copies the system default autostart file before appending `@start-server`, preserving `lxpanel`, `pcmanfm`, and `xscreensaver` entries on Bullseye/X11

---

## [2.1.9] - 2026-04-13

### Added
- Node.js 22 via nvm on Bullseye 32-bit (`armv7l`) where NodeSource has no packages; systemd drop-in (`nvm.conf`) sources nvm at startup automatically
- Debug panel header shows active git branch when it differs from `master`

### Changed
- `install.sh` API key prompt now defaults to yes (`Y/n`)

### Fixed
- `uninstall.sh` detects stale `NVM_DIR` references in shell profiles even when `~/.nvm` has already been manually removed

---

## [2.1.8] - 2026-04-13

### Added
- Full EN / FR / ES localization via i18next; language auto-detected from browser, selectable in Settings
- Debug panel header: two-column layout (system info left, network info right), version and Git commit hash display

---

## [2.1.7] - 2026-04-12

### Changed
- Kiosk mode is now optional during `install.sh` — server still starts via systemd when declined

---

## [2.1.6] - 2026-04-12

### Added
- Debug panel — Provider status: live operational status for Tomorrow.io, Mapbox, ipapi.co, LocationIQ (cached 30 min)
- Debug panel — Internet connectivity: `ONLINE` / `OFFLINE` status and latency to `1.1.1.1` (cached 60 s)

---

## [2.1.5] - 2026-04-12

### Added
- Debug panel — network info: Pi IP address(es), server port, protocol, full access URL(s)
- sunrise-sunset.org calls proxied through Express server

---

## [2.1.4] - 2026-04-11

### Added
- Weather cache persistence: saved to `server/weather-cache.json` on shutdown and every 5 minutes; non-expired entries reloaded on restart
- Debug panel — system info: hardware model, OS version
- Debug panel install option added to `deploy/install.sh`

### Fixed
- Startup script: replaced `nc` (netcat) with bash's built-in `/dev/tcp` for server readiness detection

---

## [2.1.3] - 2026-04-11

### Added
- Server-side weather cache with TTLs: 15 min (current), 30 min (hourly), 6 h (daily); shared across all clients
- Debug panel (`DEBUG=true`): API service status, quota counters, cache state, server logs, security events, npm audit results

---

## [2.1.2] - 2026-04-11

### Changed
- Tomorrow.io weather calls (current, hourly, daily) proxied through Express server; API key no longer in client-side request URLs

---

## [2.1.1] - 2026-04-09

### Added
- Mapbox and LocationIQ API calls proxied through Express server
- Settings write protection: POST/PUT/PATCH/DELETE always restricted to localhost
- CORS middleware removed

### Fixed
- Shell injection risk in `install.sh`: uses `python3 + json.dumps` to write `settings.json`
- `settings.json` parse errors return HTTP 500 instead of crashing the server
- `axios` updated to v1.15.0 (SSRF vulnerability GHSA-3p68-rc4w-qgx5)

---

## [2.1.0] - 2026-04-03

### Changed
- Build system upgraded from webpack 4 to webpack 5
- Updated css-loader v7, style-loader v3, postcss v8, html-webpack-plugin v5
- RainViewer API updated to v2 (`weather-maps.json`)
- Geolocation service updated to ipapi.co
- axios updated to v1.x, express updated to v4.22

---

## [2.0.1] - 2024-06-12

### Changed
- Weather provider switched from ClimaCell to Tomorrow.io API

---

## [2.0.0] - 2021-01-22

### Changed
- Weather provider switched from ClimaCell API v3 to v4

---

## [1.0.0]

Initial release.
