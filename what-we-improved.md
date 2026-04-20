# Pi Weather Station — What We Improved

Pi Weather Station is a self-hosted weather display app running on a Raspberry Pi with a 7" touchscreen. Over the past few weeks, we made a series of improvements across four main areas:

---

**1. Security hardening**

The original app already anticipated network use — the option to allow remote access was documented from the start. We built on that vision by adding the security layer it needed: API key proxying, access controls, and an opt-in read-only mode for remote visitors. As the threat landscape continues to evolve, we audited the codebase and applied several hardening measures: CORS was locked down, and all third-party API calls (Mapbox, LocationIQ, Tomorrow.io, and sunrise-sunset.org) are now proxied through the Express server, so API keys never appear in the browser's network requests — this applies unconditionally, regardless of how the server is started. Note that API keys remain readable in the Settings panel — on localhost at all times, and on remote clients when REMOTE_SECURITY is not enabled.

On the transport side, the server runs over HTTPS using a self-signed certificate generated automatically on first launch. All communication between the browser and the Pi is encrypted, and mixed-content issues — where a browser blocks unencrypted requests from a secure page — are avoided by routing all external API calls through the server.

As part of the same effort, outdated dependencies were audited and updated. Key packages — including webpack (v4 → v5), axios, and express — were brought up to date, significantly reducing the number of known vulnerabilities reported by `npm audit`. Notably, the axios update addressed a known SSRF vulnerability. The installation script now runs `npm audit` automatically and applies fixes when possible, so the dependency baseline stays healthy over time.

---

**2. API key protection and quota management**

Weather data from Tomorrow.io was previously fetched directly by the browser, exposing the API key and consuming one quota slot per connected client per refresh. Calls are now proxied server-side with a shared cache (15 min / 30 min / 6 h depending on the endpoint), so the upstream API is hit only once regardless of how many clients are connected or how often the page reloads — a significant saving given Tomorrow.io's strict quota limits. The same proxy architecture applies to all other external services, where the primary benefit is consistent API key protection rather than quota management.

---

**3. Automated installation and clean uninstall**

The project had grown more complex to install over time — not by design, but because external dependencies evolved: API changes, new Raspberry Pi OS versions, the transition from X11 to Wayland, and variations in the Chromium binary name across releases. We replaced the scattered manual steps with a guided `install.sh` script that handles Node.js version checks, dependency installation, API key configuration, SSL certificate generation, and startup configuration automatically. Beyond convenience, automation reduces the risk of human error that manual multi-step installations inevitably carry. A matching `uninstall.sh` cleanly reverses every change. Both scripts prompt with clear yes/no defaults so nothing happens by surprise.

Node.js 22 is now installed on all supported platforms: via nvm on Bullseye 32-bit (`armv7l`), where NodeSource has no packages for that architecture, and via NodeSource everywhere else (Bullseye 64-bit, Bookworm, Trixie). The installer detects the OS and architecture automatically and picks the right method without user intervention beyond confirming the install. nvm installs to the user account and the systemd service is automatically configured to source it at startup via a drop-in override, working around the fact that systemd does not load the interactive shell profile. The uninstall script handles both cases, including cleaning up stale nvm references in shell profile files even when the nvm directory has already been manually removed.

A separate bug was also fixed: on Bullseye with X11/LXDE, the installer was creating the autostart file with only `@start-server`, discarding the system default entries for `lxpanel`, `pcmanfm`, and `xscreensaver`. Exiting kiosk mode left a black screen with no taskbar or desktop. The installer now copies the system default first before appending `@start-server`.

---

**4. Flexible kiosk autostart and debug panel**

The kiosk startup logic (launching Chromium in fullscreen once the server is ready) is now unified in a single `start-server` script installed to `~/.local/bin`. It auto-detects the display server (labwc, wayfire, or X11) and the correct Chromium binary name, so the same script works across Raspberry Pi OS versions without modification. Kiosk mode is optional — users who have enabled remote access (`ALLOW_REMOTE=true`) and prefer to access the app from another device on the network can skip it during installation. The server still starts automatically via systemd either way, and `start-server` remains available for manual use.

A debug panel (enabled via `DEBUG=true`) provides live visibility into provider operational status (Tomorrow.io, Mapbox, ipapi.co, LocationIQ), internet connectivity with latency, network access URLs, cache state, API quota counters, service call history, security events, and server logs.

---

**5. Internationalization and UI refinements**

The interface is now fully localized in English, French, and Spanish using i18next. A language selector is available in the Settings panel, and the browser's language is detected automatically on first load. All UI strings are covered — weather labels, error messages, settings fields, and the entire debug panel.

As part of the same phase, the debug panel header was reorganized into a two-column layout to reduce its vertical footprint: system information (hardware model, OS, version) on the left, network information (URLs, internet connectivity) on the right. The header now also displays the application name, version number, current Git commit hash, and active branch name when not on `master` — making it easy to confirm which build and branch is running directly from the Pi's screen.

---

**6. AI weather summary**

An optional AI-generated weather summary was added to the main screen, powered by the Anthropic Claude Haiku model. When an Anthropic API key is configured in the settings, a short natural-language paragraph appears below the forecast charts describing current conditions. A second paragraph adapts to the time of day: during the morning or afternoon it previews the evening (18h–21h), during the evening it previews the overnight period (21h–5h), and at night it previews the next day's forecast. Summaries are generated in the interface language (English, French, or Spanish), cached 15 minutes server-side, and silently hidden when no API key is configured — the feature is entirely optional and the app functions fully without it.

Weather data used to build the prompt is reused from the shared server-side cache, so enabling AI summaries does not trigger additional Tomorrow.io API calls beyond what the app already makes. The summary section is visually distinguished with a blue left border, a centered "AI SUMMARY / RÉSUMÉ IA / RESUMEN IA" header, and italic text styled differently in dark and light modes.

A shared chart legend was also added above the forecast charts to label the temperature/wind and precipitation curves — replacing the per-chart legends that had been disabled because they compressed the chart area.

---

**7. Observability KPIs, license cleanup, and UX polish**

The debug panel gained two new sections giving real-time visibility into both the server and the browser:

- **Server KPIs** track Node.js process uptime, heap memory (used and total) and RSS, the weather cache hit rate with raw hit/miss counts, and a per-endpoint response time table (count, average, min, max) collected by a new Express middleware added to every route.
- **Client KPIs** are collected live in the browser each time the panel opens: page load time from the Navigation Timing API, a live FPS reading measured over one second via `requestAnimationFrame`, JS heap size (available on Chromium-based browsers), and a grouped summary of every `/api/*` call recorded by the browser's Resource Timing API since the page was loaded.

On the license front, a dependency audit revealed two GPL-licensed icon packages (`@iconify/icons-gridicons` and `@iconify/icons-dashicons`) had been included since the project's early versions. Both were replaced with visually equivalent icons from MIT-licensed sets already present in the project (`ion/location-sharp` and `carbon/undo`). The packages were removed from `package.json`. All dependencies are now MIT, ISC, BSD, Apache-2.0, or Creative Commons — no copyleft obligations.

Finally, a small UX fix ensures that opening the Settings panel automatically closes the Debug panel, and vice versa, so both panels can never be visible simultaneously.

---

**8. Small screen UX and display polish**

The 7" official Raspberry Pi touchscreen (800×480) leaves limited vertical room once the info panel, current weather, and two stacked forecast charts are all visible. Three complementary improvements address this:

First, on screens ≤ 520 px tall, the hourly and daily charts are now shown as tabs ("24 hours" / "5 days") rather than stacked. Only one chart is visible at a time, and switching is instant — each tab keeps its own chart instance without re-fetching data.

Second, a floating toggle button appears on the right edge of the radar map (small screens only) and collapses the info panel entirely, expanding the map to full width. This is particularly useful when monitoring approaching rain. Because Leaflet does not automatically adapt to container size changes, a `MapResizer` component calls `map.invalidateSize()` after a short delay whenever the panel is toggled — without this, the right portion of the map stays white until the user pans or zooms.

Third, a Font Size setting (S / M / L — 85%, 100%, 115% zoom) lets users adapt the info panel to their preference and viewing distance. Applying `zoom` to a container also scales its visual height, which would otherwise push controls off screen or leave a blank area. This is corrected by setting `height: calc(100dvh / zoom)` — restoring the logical height without affecting other layout elements. The forecast charts use a counter-zoom (`zoom: 1 / parentZoom`) so that chart.js measures the container in its natural coordinate space and draws at the right size regardless of the selected font size.

On the visual side, the radar legend overlay was restyled to match the app's panel palette: a frosted-glass background (backdrop blur + semi-transparent fill) with a subtle border that switches between dark and light variants, consistent with every other overlay in the UI. The color swatches were also slightly enlarged for better readability at arm's length. The km/h speed unit label was shortened to "kph" to fit more cleanly in the narrow chart axis area.
