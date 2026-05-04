# Pi Weather Station — Roadmap

This document captures potential directions for the project. It is not a commitment or a release schedule — it is a living reference to guide prioritization and spark ideas.

Items are organized by theme and annotated with an estimated impact (for the primary use case: a kiosk Pi on a kitchen counter) and implementation complexity.

---

## Short term — high impact, low complexity

These items reuse data or infrastructure already in place and can be implemented in a single session.

### 🌡️ UV index and air quality (AQI)
Both fields (`uvIndex`, `epaIndex`) are already present in the Tomorrow.io hourly payload — no new API key or endpoint required. A small row below the current weather block would surface this information without cluttering the layout.

### 🌓 Automatic dark / light mode at sunrise and sunset
The app already fetches precise sunrise and sunset times. Switching the color theme automatically at those moments is a natural extension — a `setInterval` check every minute against the stored times would be sufficient.

### 💡 ~~Screen brightness control~~ ✅ Shipped in v2.11.0
Manual brightness slider in Advanced settings, backed by `/sys/class/backlight/*/brightness`. Hidden when no backlight is exposed (HDMI monitors, x86, missing kernel overlay). `install.sh` provisions the `dtoverlay=rpi-backlight` line and a udev rule so the `pi` user can write to the sysfs node. Automatic dim-at-night is still open — see the dark/light auto-switch item above for the analogous mechanism.

> Future extension to HDMI monitors via DDC/CI is captured as its own item in the medium-term section below.

---

## Medium term — high impact, moderate complexity

These items require new logic or UI work but remain well within the scope of the project.

### 📡 Radar animation (play / pause / speed)
RainViewer exposes multiple historical and forecast frames via its API. The WeatherMap component already uses RainViewer tiles. Adding a timeline control bar below the map — with play, pause, and frame scrubbing — would turn the static radar into a proper storm-tracking tool, which is arguably the most useful feature a weather kiosk can offer.

> **UX inspiration** — [Weather Underground's WunderMap](https://www.wunderground.com/wundermap) has particularly polished light/dark base maps and a clean layer-opacity slider. Worth a look when designing the radar timeline + layer controls (their public API is no longer free, so this is purely visual reference, not a data source).

### 😴 Sleep mode / screensaver
After a configurable period of inactivity, the display would transition to a minimal fullscreen clock (large digits, low brightness). Any touch or mouse event would restore the full interface. This protects the LCD panel from burn-in and gives the device a polished, always-on appearance. Implementation requires an inactivity timer in the client and the brightness control endpoint described above.

> **Design-first candidate.** The whole feature is a visual identity exercise — large clock, optional weather highlights, optional ambient animation (subtle starfield, simplified radar bands, breathing glow). [Claude Design](https://claude.ai/design) is the right tool to mock this up before any React work. Save the standalone HTML to `docs/design-references/sleep-mode.html` for the eventual port.

### ✅ ~~Trend-aware radar-risk colouring (v2)~~ — **shipped May 2026**
`getRiskLevels` now fetches the 3-frame sequence (now / -15 min / -45 min) and bumps the ring tier one notch when a band on at least one direction has shifted inward by ≥5 km (≥3 mi) over 45 min AND projected arrival is < 30 min. Snapshots fetched in parallel; most tile reads hit the shared cache populated by the AI-summary analyzer. Response gains a `trend` field per ring (`approaching` \| `stable`) for diagnostics — no client change required, the bumped `level` flows through the existing rendering. Threshold values are empirical: tighter and we miss real cells, looser and we trigger on noise. Re-tune if the observed false-positive rate is high.

### ➡️ Precipitation motion arrows on the radar (utility to validate before building)
Overlay arrows on the radar tile layer showing the general direction precipitation is moving in each part of the visible area — the same kind of vector field that MétéoMédia / The Weather Network displays on their app. The 13 RainViewer frames the analyzer already pulls (10 historical at 10-min intervals + 3 nowcast) carry implicit motion: a band that sat 50 km west three frames ago and now sits at the marker has a known velocity. Surfacing that as arrows turns "is this storm going to hit me?" from a multi-second mental computation into a glance.

Two viable approaches; choice deferred to the design-validation step.

- **Block-matching on a coarse grid** (~150 lines, robust). Divide the visible map into a regular grid (e.g. 16×16). For each cell that contains precipitation, compare 2-3 recent frames and find the displacement that best matches the cell's content from frame to frame. Render one arrow per non-empty cell, magnitude scaled by velocity. Robust to cell merging / splitting (no object-tracking needed). Probably what produces the visual style in the reference screenshot.
- **Cell tracking via connected-components + centroid matching** (more code, more cases). Identify discrete precipitation cells per frame (intensity-thresholded connected components), match cells across frames by proximity + size similarity, compute a velocity vector per cell. More precise (one arrow per real cell) but lots of edge cases (cells that merge, split, dissipate, form mid-sequence).

- **Implementation, common to both**: server-side analysis to produce a `{ arrows: [{ lat, lon, headingDeg, speedKmh }] }` payload at low frequency (every 5 min, shared cache with the AI summary's frame fetches — adds ~zero RainViewer load); client-side rendering as Leaflet markers with a rotated arrow icon, opacity scaled by speed so stationary cells don't visually compete with moving ones.
- **Utility check before shipping**: the existing `<AlertBanner>` already says "précipitations approchent" when the trend detector fires. The arrow overlay's added value is purely the *direction-of-arrival glance* ("from the SW") — needs to be validated against real use ("would I have looked at this and known faster than reading the banner + comparing to the radar?") before committing to the visual complexity. Risk: arrow clutter on top of an already-busy radar layer competes for attention rather than adding signal.
- **Decision gate**: build a static mock first (hand-drawn arrows over a screenshot, both density variants — coarse grid vs per-cell — to compare side-by-side). Test on the 7" kiosk. Pick the approach (or none) based on which actually improves at-a-glance reading. Then implement.

> **Design-first.** Same pattern as the severe-alert overlay below: the value is entirely visual (arrow density, magnitude scaling, icon shape, opacity rules), so mock in [Claude Design](https://claude.ai/design) before any code. Save the mock variants to `docs/design-references/precip-motion-arrows.html`.

### 🥧 Angular-sector risk colouring (v3 — utility to validate before building)
Building on v2, divide each ring into the 8 angular sectors that match the sample directions (N / NE / E / … / NW) and tint each sector with the colour of the worst-case intensity among its radial samples. This adds a *direction-of-risk* dimension that the single-colour ring can't surface in one glance — "the storm is in the SW quadrant" instead of just "there's a storm somewhere on the ring". Optional 16-sector mode reuses `doubleOuterPoints` for the outer ring.

- **Implementation**: client-side. Server contract extends from `{ level }` to `{ level, sectors: [{ direction, level }] }` for each ring. Leaflet `Polygon` per sector, low opacity fill (~10-15%) so the radar tiles stay readable underneath.
- **Utility check before shipping**: the radar tile layer already shows precipitation with much higher spatial resolution than 8 sparse sample points. The benefit of the sector overlay is only the *quick directional read* — needs to be validated against real use ("would I have looked at this and known the storm was in the SW faster than just glancing at the radar?") before committing to the visual complexity. Risk: pie-slice tinting on top of radar tiles competes for attention rather than adding signal.
- **Decision gate**: build a static mock first (hand-coloured sectors over a screenshot), test on the 7" kiosk, and only proceed to wiring up live data if the mock genuinely improves at-a-glance reading.

### ✅ ~~Severe weather alerts (NWS + ECCC)~~ — **shipped May 2026**
NWS and ECCC sources are live: `GET /api/weather-alerts` runs both in parallel (skipped per-source by national bbox), normalises CAP severity to the existing yellow/orange/red tier vocabulary, and sorts by severity. The client `<AlertBanner>` now lets an orange/red government alert outrank the radar-derived tier with its localised event title plus a `[NWS]` / `[ECCC]` badge. ECCC's bbox filter on the GeoMet pygeoapi instance is non-functional — strategy is fetch-all-Canadian-alerts (≤50 features) + local point-in-polygon, cached 5 min server-side. MeteoAlarm and the takeover overlay design remain open below.

### ⚠️ MeteoAlarm (Europe) as the third government alerts source
Same shape as NWS / ECCC — a `server/govAlertSources/meteoalarm.js` exporting `tryAlerts(lat, lon)` and slotting into the existing orchestrator with no controller change. MeteoAlarm aggregates from national met services and exposes a JSON feed by country/region. Kept out of the May 2026 ship because the kiosk fleet is currently US/CA-only; revisit when a European user materialises.

### 🚨 Critical-tier severe-alert takeover overlay
The shipped May 2026 banner integration is the light-touch path: a coloured strip with title + source badge, sharing space with the rest of the InfoPanel. For genuinely critical alerts (tornado warning, tsunami warning, evacuation order) the right UX is more than a strip — a full-screen takeover that someone walking by from the next room cannot miss. Hooks into the existing `govAlerts` payload (it already carries `severity: "extreme"` and the full `description_en/fr` body); only the rendering needs design + code.

> **Design-first.** Visual language (colour, typography, iconography, motion, dismissal affordance) is the entire UX — the goal is "you cannot miss this" without crossing into "annoying", and that line is purely a design judgment. Mock in [Claude Design](https://claude.ai/design) before coding. Save to `docs/design-references/severe-alert-overlay.html`.

> **Historical note — Tomorrow.io is not a viable source.** We attempted `/v4/events` first (May 2026); that endpoint expects user-defined insight rule UUIDs from the dashboard, not a global feed of government alerts. Tomorrow.io does not expose a free, plug-and-play "official alerts" feed.

### 🌍 OpenAQ as the global air-quality fallback (after AirNow)
Today's air-quality chain (MELCC Mtl → MELCC RSQAQ → ECCC AQHI → AirNow once shipped) covers Canada and the US with authoritative government data. Outside that footprint the badge falls back to Tomorrow.io's `epaIndex`, which requires the paid Air Quality data layer the kiosk owner doesn't have — so for Latin America, Europe, Asia, Africa the badge is currently dark. [OpenAQ](https://openaq.org) closes that gap with a single source: free no-key API (`https://api.openaq.org/v3/locations` + `/measurements`), CC-BY-4.0 licence so redistribution is explicitly fine, aggregates only government monitoring stations (no community sensors — important for an authoritative-tone badge), global coverage of ~150 countries.

- **Why not IQAir** — evaluated 2026-05-04 and rejected: free tier requires per-install API key, ToU restrict redistribution and require "Powered by IQAir" attribution (awkward for an open-source project shipping to multiple kiosks), mixes government with consumer-grade AirVisual sensors. OpenAQ has the same global reach without those frictions.
- **Implementation**: new `server/airQualitySources/openaq.js` exposing the same `tryAqi(lat, lon)` shape as the existing sources. Slots into the orchestrator's parallel-batch as a fourth source, downstream of the closer ones thanks to the closest-wins picker. Handles both "AQI" responses and individual pollutant readings (PM2.5, ozone, etc.) — when only raw pollutants are returned, compute the worst-case sub-index per the EPA AQI formula and use that.
- **Effort**: ~1-2h once AirNow is in (same source-module pattern as MELCC RSQAQ — single ArcGIS-style fetch + nearest-station Haversine + category mapping).

### 🌌 Astronomy companion view
A second optional "page" in the kiosk that complements the weather/radar primary view: Earth orbiting the Sun with continuous axial-tilt animation, day-length variation over the year, sunrise/sunset arcs, and a "Today" mode showing real-time orbital angle, current axial tilt, and a countdown to the next solstice/equinox. Branched on the user's actual latitude/longitude (not the generic 48°N / 35°S the prototype hard-codes), so the day-length curve is *their* curve, not a demo.

Accessed via a new ControlButtons icon that toggles between the radar view and the astronomy view; the InfoPanel and clock area stay shared. Almost zero new server work — the data is purely astronomical (date + lat/lon → math), and the existing `sunriseTime` / `sunsetTime` from sunrise-sunset.org are already there to cross-check.

> **Design-first.** A working visual prototype already exists at [`docs/design-references/solstices-equinoxes.html`](design-references/solstices-equinoxes.html) (saved May 2026, produced via [Claude Design](https://claude.ai/design)). Open it directly in a browser — that file is the source of truth for the visual identity. The integration work is to port the React-in-HTML to a proper component (CSS Modules, JSDoc + PropTypes, full i18n EN/FR/ES — the prototype is French-only), plus wire it to the user's real location, plus add the toggle button. Probably one full session.

### 🌡️ Local GPIO sensors (DHT22 / BME280)
This is the item that most clearly differentiates a Pi weather station from any commercial weather app. Connecting a temperature and humidity sensor directly to the Pi's GPIO pins would allow the app to display the **actual conditions in the room** alongside the external forecast. A lightweight server-side poller (every 30 seconds) reading from the sensor via a Node.js GPIO library would feed a new panel section or a prominent badge on the CurrentWeather block. No external API call, no quota, no latency.

### 🔆 Brightness control via DDC/CI for HDMI monitors
The current brightness slider (v2.10.x) only works on devices that expose a backlight via `/sys/class/backlight/*` — i.e. the official 7" DSI screen and the EDATEC ED-HMI3010-101C all-in-one. HDMI monitors on the Pi 5B and CM5 currently hide the slider entirely. Adding a `ddcutil` back-end would extend coverage to any HDMI monitor that supports DDC/CI, including the planned EDATEC ED-MONITOR-101C (10.1" industrial, 500 nits, DDC/CI confirmed in its datasheet).
- **Server**: `getBrightness()` / `setBrightness()` factored into two back-ends (`sysfs`, `ddcutil`) with auto-detection at startup. `ddcutil detect` is slow on first call (~500 ms i2c probe) — cache the result. Writes via `ddcutil setvcp 10 <pct>` (~200-400 ms each); the existing 250 ms client debounce should absorb that, to be confirmed on hardware.
- **Install**: `install.sh` adds `ddcutil` to its package list, ensures the `pi` user is in the `i2c` group, and verifies `dtparam=i2c_arm=on` is active in `/boot/firmware/config.txt` (default on recent RPi OS, but worth checking).
- **Client**: zero changes — the API contract (`GET /api/brightness` returns `{available, percent, ...}`, `POST` accepts `{percent}`) is back-end-agnostic.
- **Validation**: required before merging — some monitors advertise DDC/CI but implement it incorrectly. Test on the actual ED-MONITOR-101C unit before shipping.

---

## Long term — if the project grows

These items have real value but require a more significant investment.

### 🔔 Browser push notifications (severe weather)
If the Pi also serves remote clients on the local network, the Web Push API could deliver severe weather alerts to those devices even when the browser tab is not active. Requires a service worker, VAPID key generation, and a subscription management endpoint.

### 🚪 Guided onboarding for first-run installs
Today, a fresh install dumps the user into the main UI with empty API key fields and no clear next step — they have to discover the Settings panel and figure out which keys go where. A guided onboarding flow (welcome → API key entry, one panel at a time → optional location override → "you're all set") would dramatically reduce the friction for new adopters. Not strictly necessary for the existing fleet, but a major polish item if the project grows.

> **Design-first.** Onboarding flows are 90% UX copy + visual hierarchy + animation timing — exactly what [Claude Design](https://claude.ai/design) is built for. Mock the full flow there before any React work; the implementation is a small state machine wrapping a few existing input components. Save to `docs/design-references/onboarding.html`.

### 📍 Location favorites
A small list of saved locations (home, chalet, work) that the user can switch between with a single tap. The map and all weather data would reload for the selected location. Useful for households that monitor multiple places regularly.

### ✅ Automated tests (Jest + React Testing Library)
There are currently no automated tests. Adding unit tests for the unit conversion functions (`services/conversions.js`) and integration tests for the key server endpoints would provide a safety net against regressions as the project grows. A GitHub Actions workflow running ESLint and the test suite on every push would complete the CI foundation.

### 🔌 Offline mode / graceful degradation
A service worker caching the last known weather data and the compiled bundle would allow the interface to remain functional during brief internet outages — showing stale data with a clear timestamp rather than a blank panel.

---

## Maintenance & Deployment

### 🔧 Detect systemd service file changes during update
When `deploy/pi-weather-server.service` is modified between releases, the one-click update (`git pull` + service restart) is not sufficient — the user must also copy the new file to `~/.config/systemd/user/` and run `systemctl --user daemon-reload`. The UpdateModal has no way to signal this today.

A practical improvement would be to compare the SHA of `deploy/pi-weather-server.service` at the local commit vs the latest release commit, and display a warning in the UpdateModal when they differ:

> ⚠️ The systemd service file has changed. After updating, run:
> ```
> cp deploy/pi-weather-server.service ~/.config/systemd/user/
> systemctl --user daemon-reload
> ```

**Impact:** low (edge case, rare releases touch the service file) — **Complexity:** low (git diff on a single file via the GitHub API)

---

## Technical debt

These are known weaknesses in the current codebase that do not affect functionality today but will slow down development or increase the risk of regressions if left unaddressed as the project grows.

### 📋 JSDoc and PropTypes coverage
Most React components have a JSDoc block, but parameter descriptions and `PropTypes` declarations are incomplete on several components. ESLint rules `jsdoc/require-param` and `jsdoc/require-returns-description` surface the gaps at build time. A full audit and fill-in pass would make the codebase self-documenting and catch prop misuse earlier.

### 🔕 `eslint-disable-line` comments
Several `useEffect` hooks carry `// eslint-disable-line react-hooks/exhaustive-deps` comments to silence dependency warnings rather than restructure the logic. Each suppression is a hidden assumption about which dependencies are safe to omit. These should be reviewed one by one: either the dependency array should be corrected, or the suppression should be replaced with a documented `useRef`-based workaround that makes the intent explicit.

### 📄 Version history duplicated between `readme.md` and `CHANGELOG.md`
The full version history exists in both files. `readme.md` should keep only the last two or three releases for quick reference, with a link to `CHANGELOG.md` for the full history. Keeping both in sync manually is error-prone.

### 🧪 No automated tests
There are no unit or integration tests. The highest-value starting points would be:
- Unit tests for `services/conversions.js` (pure functions, easy to cover)
- Integration tests for the Express endpoints most likely to break silently (`/settings`, `/api/weather/*`, `/api/update`)
- A GitHub Actions workflow running ESLint and the test suite on every push

Without tests, every change to shared utilities or server middleware carries an invisible regression risk.

### 🗂️ `AppContext.js` size and responsibility
`AppContext.js` currently holds all global state: settings, units, geolocation, dark mode, font size, panel state, and all update functions. As the project grows, this single file becomes harder to navigate and reason about. Splitting it into focused context providers (e.g. `SettingsContext`, `WeatherContext`, `UIContext`) would improve maintainability without changing any observable behaviour.

### ✅ ~~Service-file customizations should live in a systemd drop-in, not the main unit~~ — **resolved in v2.8.1**
`install.sh` and `toggle-remote.sh` now write `ALLOW_REMOTE=true` into a drop-in (`pi-weather-server.service.d/local.conf`) instead of editing the main service file. The canonical `deploy/pi-weather-server.service` stays a clean upstream mirror, and the in-app updater's `serviceFileChanged` warning only fires on real upstream changes. `toggle-remote.sh` migrates legacy installs by re-commenting the leftover line on the next toggle.

### 🖥️ Debug panel — graceful fallback for non-Pi platforms
Several rows in the debug panel (under-voltage, frequency capped, throttled, temp limit, hardware model) come from `vcgencmd`, a Raspberry-Pi-only binary. On x86 deployments (VMware, openSUSE, Ubuntu desktop), `vcgencmd` doesn't exist so the rows silently render empty. Now that the project is officially multi-distro (since v2.5.0), the debug panel should either hide the Pi-specific section entirely on non-Pi hosts, replace it with x86-compatible equivalents (CPU temp via `/sys/class/hwmon`, throttling via `/sys/devices/system/cpu/cpufreq`), or label the rows "N/A — Raspberry Pi only" so the absence is intentional rather than a bug.

---

## Perspective

The three items I would prioritize above all others if returning to this project:

1. **Radar animation** — transforms the map from a static snapshot into the most compelling feature of the kiosk; the data is already there, it is purely a UI problem.

2. **Sleep mode** — a device that runs 24 hours a day should protect its screen and go dark when no one is watching; this also makes the device feel intentional rather than like a forgotten browser tab.

3. **Local GPIO sensors** — displaying the real temperature of the room next to the outdoor forecast is something no commercial weather app can do; it gives the project a reason to exist as physical hardware rather than a web app on a tablet.

---

*Last updated: 2026-05-02 (added Claude Design references for astronomy view, sleep mode, severe-alert overlay, onboarding)*


