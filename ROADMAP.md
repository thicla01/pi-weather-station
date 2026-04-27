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

### 💡 Screen brightness control
The Pi's official display exposes a brightness interface at `/sys/class/backlight/*/brightness`. A simple server endpoint wrapping a `fs.writeFileSync` call would allow the client to dim the screen at night and restore it in the morning — one of the most practical improvements for a device that runs 24/7.

---

## Medium term — high impact, moderate complexity

These items require new logic or UI work but remain well within the scope of the project.

### 📡 Radar animation (play / pause / speed)
RainViewer exposes multiple historical and forecast frames via its API. The WeatherMap component already uses RainViewer tiles. Adding a timeline control bar below the map — with play, pause, and frame scrubbing — would turn the static radar into a proper storm-tracking tool, which is arguably the most useful feature a weather kiosk can offer.

> **UX inspiration** — [Weather Underground's WunderMap](https://www.wunderground.com/wundermap) has particularly polished light/dark base maps and a clean layer-opacity slider. Worth a look when designing the radar timeline + layer controls (their public API is no longer free, so this is purely visual reference, not a data source).

### 😴 Sleep mode / screensaver
After a configurable period of inactivity, the display would transition to a minimal fullscreen clock (large digits, low brightness). Any touch or mouse event would restore the full interface. This protects the LCD panel from burn-in and gives the device a polished, always-on appearance. Implementation requires an inactivity timer in the client and the brightness control endpoint described above.

### ⚠️ Severe weather alerts
Tomorrow.io exposes weather alerts (warnings, watches, advisories) for supported regions. A persistent banner at the top of the InfoPanel — or a badge on the ControlButtons bar — would surface critical alerts without interrupting the normal layout. The server would cache alerts alongside the existing weather data.

### 🌡️ Local GPIO sensors (DHT22 / BME280)
This is the item that most clearly differentiates a Pi weather station from any commercial weather app. Connecting a temperature and humidity sensor directly to the Pi's GPIO pins would allow the app to display the **actual conditions in the room** alongside the external forecast. A lightweight server-side poller (every 30 seconds) reading from the sensor via a Node.js GPIO library would feed a new panel section or a prominent badge on the CurrentWeather block. No external API call, no quota, no latency.

---

## Long term — if the project grows

These items have real value but require a more significant investment.

### 🔔 Browser push notifications (severe weather)
If the Pi also serves remote clients on the local network, the Web Push API could deliver severe weather alerts to those devices even when the browser tab is not active. Requires a service worker, VAPID key generation, and a subscription management endpoint.

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

### ⚙️ Service-file customizations should live in a systemd drop-in, not the main unit
Today `deploy/pi-weather-server.service` is the canonical service file but `install.sh` rewrites it in place to apply user choices like `ALLOW_REMOTE=true`. That makes the installed file diverge from what's checked in, so the in-app updater can't safely overwrite it on releases that change the service definition (v2.4.4 was the first such release — see the `serviceFileChanged` notice added in v2.4.5). The fix: keep the canonical file pristine, write user customizations to `~/.config/systemd/user/pi-weather-server.service.d/override.conf` instead. Once that's done, the in-app updater can `cp` and `daemon-reload` the service file unattended on every update without risking user config loss.

### 🖥️ Debug panel — graceful fallback for non-Pi platforms
Several rows in the debug panel (under-voltage, frequency capped, throttled, temp limit, hardware model) come from `vcgencmd`, a Raspberry-Pi-only binary. On x86 deployments (VMware, openSUSE, Ubuntu desktop), `vcgencmd` doesn't exist so the rows silently render empty. Now that the project is officially multi-distro (since v2.5.0), the debug panel should either hide the Pi-specific section entirely on non-Pi hosts, replace it with x86-compatible equivalents (CPU temp via `/sys/class/hwmon`, throttling via `/sys/devices/system/cpu/cpufreq`), or label the rows "N/A — Raspberry Pi only" so the absence is intentional rather than a bug.

---

## Perspective

The three items I would prioritize above all others if returning to this project:

1. **Radar animation** — transforms the map from a static snapshot into the most compelling feature of the kiosk; the data is already there, it is purely a UI problem.

2. **Sleep mode** — a device that runs 24 hours a day should protect its screen and go dark when no one is watching; this also makes the device feel intentional rather than like a forgotten browser tab.

3. **Local GPIO sensors** — displaying the real temperature of the room next to the outdoor forecast is something no commercial weather app can do; it gives the project a reason to exist as physical hardware rather than a web app on a tablet.

---

*Last updated: 2026-04-26*


