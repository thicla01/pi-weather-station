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
