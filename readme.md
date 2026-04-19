
# Pi Weather Station

This is a weather station designed to be used with a Raspberry Pi on the official 7" 800x480 touchscreen.

![pws-screenshot3](https://user-images.githubusercontent.com/15202038/91359998-4625bb80-e7bb-11ea-937e-c87eede41f35.JPG)

The weather station will require you to have API keys from [Mapbox](https://www.mapbox.com/) and [Tomorrow.io](https://www.tomorrow.io/). Optionally, you can use an API key from [LocationIQ](https://locationiq.com/) to perform reverse geocoding, and an [Anthropic](https://console.anthropic.com/) API key for AI-generated weather summaries powered by Claude. All API keys are kept server-side: they never appear in client-side request URLs, and remote clients only receive a masked response (boolean) from `GET /settings` — the actual key values are only accessible from the Pi itself.

Weather maps are provided by the [RainViewer](https://www.rainviewer.com/) API, which generously does not require an [API key](https://www.rainviewer.com/api.html).

Sunrise and Sunset times are provided by [Sunrise-Sunset](https://sunrise-sunset.org/), which generously does not require an [API key](https://sunrise-sunset.org/api).

Default geolocation (used when no custom coordinates are configured) is provided by [ipapi.co](https://ipapi.co/), which does not require an API key for basic usage.

See it in action [here](https://www.youtube.com/watch?v=dvM6cyqYSw8).

> Be mindful of the plan limits for your API keys and understand the terms of each provider, as scrolling around the map and selecting different locations will incur API calls for every location. Additionally, the weather station will periodically make additional API calls to get weather updates throughout the day. All weather (Tomorrow.io), map tile (Mapbox), and reverse geocoding (LocationIQ) calls are proxied through the server — multiple browser clients share the same quota rather than each consuming it independently. Weather responses are cached server-side, further reducing API usage.

# v2.2.2 — 2026-04-19

UX: one-click update from the UI, platform-aware update commands, and FPS measurement improvements.

- **One-click update (kiosk-friendly)** — The update tooltip now includes a **Update** button that triggers `git pull --ff-only` and restarts the service directly from the browser — no terminal needed. Ideal for kiosk mode where opening a terminal is impractical. The page reloads automatically once the server is back up. Only available from the Pi itself (localhost).
- **Platform-aware update commands** — The update tooltip detects whether the server is running under systemd and adapts the displayed commands accordingly. On non-systemd hosts (e.g. macOS), the `systemctl` line is replaced by a `npm start` restart note.
- **Copy to clipboard** — A **Copy** button copies the full update command to the clipboard for easy pasting into a terminal.
- **Update indicator synced on debug refresh** — Clicking Refresh in the debug panel now immediately updates the badge in the control bar — no need to wait for the 6-hour client-side check cycle.
- **FPS measurement** — The debug panel now uses a sliding window of 60 frames for a more stable FPS reading, instead of a single-frame delta which produced noisy values.

# v2.2.1 — 2026-04-18

Bug fixes: drag-scroll compatibility and update indicator refresh.

- **iPad / mobile browser scroll** — The drag-scroll hook previously registered a non-passive `touchmove` listener that called `preventDefault()`, which blocked iOS Safari's native scroll even when `touch-action: pan-y` was set. Touch event handlers have been removed from `useDragScroll`; iOS now uses native scroll unobstructed. The Pi's Chromium touchscreen is unaffected — it continues to use pointer events.
- **Controls hidden on mobile browsers** — The app container used `height: 100vh`, which on iOS Safari includes the area behind the address bar and toolbar. The bottom control bar was hidden behind the browser UI. Fixed by adding `height: 100dvh` (dynamic viewport height, iOS 15.4+ / Chrome 108+) alongside the existing `100vh` fallback.
- **Update indicator after `git pull`** — The update badge remained visible after a `git pull` and service restart until the next 6-hour client-side check. The Debug panel refresh now reads `updateInfo` from the `/api/debug` response (already fetched server-side) and updates the indicator immediately — no extra API call needed.

# v2.2.0 — 2026-04-16

Security hardening: API key masking, rate limiting, proxy-aware IP detection, and settings key whitelist.

- **API key masking** — `GET /settings` now returns boolean values (`true`/`false`) for API key fields when called by remote clients. Key values are only returned when the request originates from the Pi itself (localhost). This prevents key exposure even when `ALLOW_REMOTE=true`.
- **`REMOTE_SECURITY` removed** — Settings write endpoints (`POST`, `PUT`, `PATCH`, `DELETE`) are now always restricted to localhost. The `REMOTE_SECURITY` environment variable has been removed. Use an SSH tunnel to change settings remotely.
- **Rate limiting** — All `/api/*` endpoints are now rate-limited per client IP. Weather and geocoding endpoints: 120 req/min. Map tile endpoints: 600 req/min (tile bursts require a higher limit). Protects external API quotas from exhaustion.
- **Proxy-aware IP detection** — All locality checks (`localhostOnly`, `req.isLocal`) now use `req.ip` instead of `req.socket.remoteAddress`. When `ALLOW_REMOTE=true`, Express trusts the first `X-Forwarded-For` hop so that a local reverse proxy does not mask real client IPs. This ensures `localhostOnly` correctly blocks remote clients even when the proxy runs on the Pi itself.
- **Settings key whitelist** — `POST`, `PUT`, and `PATCH` to `/settings` now accept only known keys (`weatherApiKey`, `mapApiKey`, `reverseGeoApiKey`, `anthropicApiKey`, `startingLat`, `startingLon`). Unknown keys are stripped silently (PUT/POST) or rejected with 400 (PATCH).
- **`/api/is-local` scoped response** — `debugEnabled` is now only included in the response when the request comes from localhost. `securityEnabled` remains visible to all clients (needed by the UI).

# v2.1.11 — 2026-04-14

Observability: server and client KPIs in debug panel, license cleanup.

- **Debug panel — Server KPIs** — A new SERVER KPIs section shows Node.js process uptime, heap memory usage (used/total), RSS, and weather cache hit rate (with raw hit/miss counts). A response time table tracks count, average, min, and max latency per server endpoint, measured by a new `responseTimerMiddleware`.
- **Debug panel — Client KPIs** — A new CLIENT KPIs section collects browser-side metrics live when the panel opens: page load time (Navigation Timing API), live FPS measured via `requestAnimationFrame`, JS heap size (Chromium only), and a per-endpoint summary of all `/api/*` calls made since page load (Resource Timing API).
- **Debug panel — mutual exclusion** — Opening the Settings panel now closes the Debug panel, and vice versa. Both panels can no longer be visible at the same time.
- **License cleanup** — Replaced two GPL-licensed icon packages (`@iconify/icons-gridicons`, `@iconify/icons-dashicons`) with MIT-licensed equivalents already present in the project (`ion/location-sharp`, `carbon/undo`). All dependencies are now MIT, ISC, BSD, Apache-2.0, or CC — no copyleft obligations.

# v2.1.10 — 2026-04-13

Bug fix: LXDE autostart no longer discards system default entries on Bullseye.

- **LXDE autostart fix** — On Bullseye with X11/LXDE, `install.sh` previously created `~/.config/lxsession/LXDE-pi/autostart` with only `@start-server`, discarding the system default entries (`lxpanel`, `pcmanfm`, `xscreensaver`). Exiting kiosk mode would leave a black screen with no taskbar or desktop. The script now copies the system default first before appending `@start-server`.

# v2.1.9 — 2026-04-13

Compatibility: Node.js 22 via nvm on Bullseye 32-bit, plus debug and install improvements.

- **Bullseye — Node.js 22 via nvm (32-bit only)** — On Raspberry Pi OS Bullseye **32-bit** (`armv7l`), `install.sh` now installs Node.js 22 via [nvm](https://github.com/nvm-sh/nvm) instead of NodeSource, which does not provide Node.js 22 packages for `armv7l`. nvm is installed to the user account and Node.js 22 is set as the default version. The systemd service is automatically configured to source nvm at startup via a drop-in override (`nvm.conf`). Bullseye **64-bit** (`aarch64`), Bookworm, and Trixie continue to use NodeSource.
- **Debug panel — git branch** — The debug panel header now shows the active git branch when it differs from `master` (e.g. `pi-weather-station v2.1.9 · abc1234 [feature/my-branch]`). Useful when testing feature branches directly on the Pi.
- **install.sh — API key prompt default** — When no `settings.json` exists, the API key configuration prompt now defaults to yes (`Y/n`) since configuring keys is required for the app to function.
- **uninstall.sh — improved nvm cleanup** — The nvm removal section now detects stale `NVM_DIR` references in shell profile files even when `~/.nvm` (or `~/.config/nvm`) has already been manually removed, and cleans them up to prevent conflicts on reinstall.

# v2.1.8 — 2026-04-13

Internationalization: full EN/FR/ES localization and debug panel improvements.

- **Internationalization (i18n)** — The interface is now fully localized in English, French, and Spanish. A language selector is available in the Settings panel. The browser's language is detected automatically on first load, falling back to English if the detected language is not supported. All UI labels, error messages, and debug panel strings are covered.
- **Debug panel — two-column header** — The debug panel header is now split into two columns (system info on the left, network info on the right) to reduce vertical height and improve readability.
- **Debug panel — version display** — The debug panel header now shows the application name, version, and current Git commit hash (e.g. `pi-weather-station v2.1.8 · 9aa3702`).

# v2.1.7 — 2026-04-12

UX: kiosk mode is now optional during installation.

- **Kiosk mode is now optional** — `deploy/install.sh` now asks whether to launch Chromium automatically in fullscreen on startup. When declined, the server still starts via systemd but no autostart is configured — the app can be accessed manually at `https://localhost:8443` or from another machine on the network.

# v2.1.6 — 2026-04-12

Observability: external provider status and internet connectivity in debug panel.

- **Debug panel — provider status** — A new PROVIDER STATUS section shows the live operational status of external providers (Tomorrow.io, Mapbox via Atlassian Statuspage JSON API; ipapi.co via HTML scraping; LocationIQ via RSS feed). Results are cached 30 minutes server-side.
- **Debug panel — internet connectivity** — The debug panel header now shows whether the Pi has internet access (`ONLINE` / `OFFLINE`) and the measured latency to `1.1.1.1`. Cached 60 seconds, fetched in parallel with provider status.

# v2.1.5 — 2026-04-12

Observability: network info in debug panel and sunrise-sunset.org proxied server-side.

- **Debug panel — network info** — The debug panel header now shows the Pi's IP address(es), server port, protocol, and the full URL(s) to access the app from the network (e.g. `https://192.168.1.42:8443`).
- **sunrise-sunset.org proxy** — Sunrise/sunset API calls are now proxied through the Express server, consistent with all other external services. This enables service status tracking in the debug panel and avoids mixed-content issues when the server runs over HTTPS.

# v2.1.4 — 2026-04-11

Reliability: weather cache persistence across restarts, debug panel improvements.

- **Weather cache persistence** — The server-side weather cache is now saved to `server/weather-cache.json` on shutdown and every 5 minutes. On restart, non-expired entries are reloaded automatically, avoiding unnecessary API calls to Tomorrow.io when the server is restarted during development or after a crash.
- **Debug panel — system info** — The debug panel header now shows the detected hardware model (e.g. `Raspberry Pi 4 Model B`) and OS version (e.g. `Debian GNU/Linux 12 (bookworm)`).
- **Debug panel — install option** — `deploy/install.sh` now offers to enable the debug panel during installation.
- **Startup script fix** — Replaced `nc` (netcat) with bash's built-in `/dev/tcp` for server readiness detection in `start-server` and `start-weather`. No external dependency required.

# v2.1.3 — 2026-04-11

Performance: server-side weather cache and new debug panel.

- **Server-side weather cache** — Tomorrow.io responses are now cached in memory on the server, reducing API quota consumption when multiple clients are connected or when the page is reloaded frequently. Cache TTLs match the natural update cadence of each data type: 15 minutes for current conditions, 30 minutes for hourly forecasts, and 6 hours for daily forecasts. The cache is shared across all clients and is cleared on server restart.
- **Debug panel** — A debug panel is available when `DEBUG=true` is set server-side. The panel is accessible only from the Pi itself (localhost) and shows API service status, quota counters, cache state, server logs, security events, and npm audit results. See [Debug panel](#debug-panel) for details.

# v2.1.2 — 2026-04-11

API key security: Tomorrow.io weather calls are now proxied server-side.

- **Tomorrow.io proxy** — Weather API calls (current, hourly, daily) are now proxied through the Express server, consistent with Mapbox and LocationIQ. The API key is no longer included in client-side request URLs. Multiple browser clients now share the same quota rather than each consuming it independently.

# v2.1.1 — 2026-04-09

Security improvements:

- **API key proxying** — Mapbox (map tiles) and LocationIQ (reverse geocoding) API calls are now proxied through the Express server. Keys are no longer included in client-side request URLs, keeping them out of browser network logs and third-party server logs.
- **Settings write protection** — `POST`, `PUT`, `PATCH`, and `DELETE` requests to `/settings` are always restricted to `localhost` (see v2.2.0).
- **Remote access UX** — The settings panel always hides API key and coordinate fields for remote users. Unit and display preferences (temperature, speed, clock format, mouse) remain accessible as they are stored locally in the browser.
- **CORS removed** — The `cors` middleware (which allowed any origin to call the API) has been removed. All legitimate requests are same-origin and do not require it.
- **Shell injection fix** — `deploy/install.sh` now uses `python3 + json.dumps` to write `settings.json`, preventing potential shell injection via API key input.
- **JSON parse hardening** — `settings.json` parsing is now wrapped in a try/catch; a corrupted file returns a clean 500 error instead of crashing the server.
- **Dependency update** — `axios` updated to v1.15.0 to address a SSRF vulnerability (GHSA-3p68-rc4w-qgx5).
- **SSH keys excluded** — `ssh.key` and `ssh.key.pub` added to `.gitignore`.

# v2.1.0 — 2026-04-03

Build system modernization: webpack 5, updated dependencies, and RainViewer API v2.

- Upgraded build system from webpack 4 to webpack 5
- Updated all build dependencies (css-loader v7, style-loader v3, postcss v8, html-webpack-plugin v5)
- Fixed CSS modules compatibility with css-loader v7 (`esModule: false`)
- Updated [RainViewer](https://www.rainviewer.com/) API to v2 (`weather-maps.json`)
- Updated geolocation service to [ipapi.co](https://ipapi.co/)
- Updated axios to v1.x and express to v4.22

# v2.0.1 — 2024-06-12

Now uses [Tomorrow.io](https://www.tomorrow.io) APi instead of ClimaCell.

# v2.0.0 — 2021-01-22

Now uses [ClimaCell](https://www.climacell.co/) API v4. For ClimaCell API v3 keys, use [Pi Weather Station v1](https://github.com/elewin/pi-weather-station/releases/tag/v1.0).

# Setup

> **Node.js requirement:** Node.js 18 or later is required. `install.sh` installs Node.js 22 on all supported platforms — via [nvm](https://github.com/nvm-sh/nvm) on Bullseye 32-bit (`armv7l`, where NodeSource has no packages), and via NodeSource on Bullseye 64-bit (`aarch64`), Bookworm (Debian 12), and Trixie (Debian 13).

> **API keys:** If you use the automated install (Option 1), the script will offer to configure your API keys automatically. For a manual setup, copy the example settings file and edit it:

    $ cp settings.example.json settings.json

To test the installation manually:

    $ npm install
    $ cd client && npm install && npm run prod && cd ..
    $ npm start

Now point your browser to `https://localhost:8443` and put it in full screen mode (`F11` in Chromium).

> **Note:** The server uses a self-signed SSL certificate generated automatically on first launch. Your browser will show a security warning — this is expected. You can safely accept the exception for `localhost`.

## Running on startup

Three options are available in the `deploy/` folder. **Option 1 is recommended** for most users.

> **Which display server am I using?** Run the following command to find out:
> ```bash
> ps aux | grep -E 'labwc|wayfire|Xorg' | grep -v grep
> ```
> - `labwc` → Wayland with labwc (default on Trixie/Debian 13)
> - `wayfire` → Wayland with wayfire (default on Bookworm/Debian 12)
> - `Xorg` → X11 (default on Bullseye/Debian 11)

### Option 1 — Automated installation (recommended)

The `deploy/install.sh` script handles the full installation automatically:

```bash
git clone https://github.com/thicla01/pi-weather-station.git
cd pi-weather-station
bash deploy/install.sh
```

It will:
- Check for Node.js (v18 minimum) and offer to install Node.js 22 if missing or outdated — via nvm on Bullseye 32-bit, via NodeSource on all other platforms
- Optionally configure your API keys and create `settings.json`
- Optionally enable remote access from other machines on the network (see [Access from another machine](#access-from-another-machine))
- Optionally enable the debug panel (see [Debug panel](#debug-panel))
- Install all dependencies and build the client
- Run `npm audit` after each install and automatically apply fixes if vulnerabilities are found — results are saved to `npm-audit.log`
- Configure and start the systemd service with log redirection to `/tmp/weather-server.log`
- Install log rotation (`/etc/logrotate.d/weather-server`) — daily rotation, 7 days history, max 10 MB, compressed
- Optionally enable kiosk mode — deploy `~/.local/bin/start-server` and configure your display server's autostart to launch Chromium in fullscreen automatically (default: yes). When declined, the server still starts via systemd but no autostart is configured
- Offer to reboot to launch the application automatically (default: yes)

Each prompt shows the default choice in uppercase — pressing Enter accepts the default.

### Option 2 — systemd (manual)

Starts the server automatically at boot, independent of the graphical session. Restarts automatically on failure.

```bash
git clone https://github.com/thicla01/pi-weather-station.git
cd pi-weather-station
cp deploy/pi-weather-server.service ~/.config/systemd/user/
npm install
cd client && npm install && npm run prod && cd ..
mkdir -p ~/.config/systemd/user/pi-weather-server.service.d
cat > ~/.config/systemd/user/pi-weather-server.service.d/override.conf << 'EOF'
[Service]
StandardOutput=append:/tmp/weather-server.log
StandardError=append:/tmp/weather-server.log
EOF
sudo cp deploy/logrotate-weather-server /etc/logrotate.d/weather-server
systemctl --user daemon-reload
systemctl --user enable pi-weather-server
systemctl --user start pi-weather-server
loginctl enable-linger $USER
mkdir -p ~/.local/bin
cp deploy/start-server ~/.local/bin/start-server
chmod +x ~/.local/bin/start-server
```

> **Bullseye 32-bit with nvm:** If you installed Node.js via nvm (see Node.js requirement above), systemd does not load the shell profile where nvm is initialized. Create an additional drop-in to source nvm explicitly — replace `~/.config/nvm` with `~/.nvm` if that is where nvm was installed:
> ```bash
> cat > ~/.config/systemd/user/pi-weather-server.service.d/nvm.conf << 'EOF'
> [Service]
> ExecStart=
> ExecStart=/bin/bash -c '. $HOME/.config/nvm/nvm.sh && exec npm start'
> EOF
> systemctl --user daemon-reload
> ```

Then configure your display server's autostart to launch `start-server`. This script waits for the server to be ready, automatically detects whether it started on port 8443 (HTTPS) or 8080 (HTTP), and automatically detects the Chromium binary (`chromium` on Bookworm/Trixie, `chromium-browser` on Bullseye).

**labwc** (default on Trixie/Debian 13):

```bash
cp deploy/autostart ~/.config/labwc/autostart
```

**wayfire** (default on Bookworm/Debian 12) — add to `~/.config/wayfire.ini` under the `[autostart]` section:

```ini
[autostart]
start-server = start-server
```

**X11/LXDE** (default on Bullseye/Debian 11) — if `~/.config/lxsession/LXDE-pi/autostart` does not exist yet, copy the system default first to preserve the desktop entries, then append `start-server`:

```bash
[ ! -f ~/.config/lxsession/LXDE-pi/autostart ] && \
  cp /etc/xdg/lxsession/LXDE-pi/autostart ~/.config/lxsession/LXDE-pi/autostart
echo "@start-server" >> ~/.config/lxsession/LXDE-pi/autostart
```

View logs with:

```bash
tail -f /tmp/weather-server.log
```

Then reboot to launch the application automatically:

```bash
sudo reboot
```

### Option 3 — autostart script (without systemd)

Copy the provided script to `~/.local/bin/` and call it from your compositor's autostart:

```bash
mkdir -p ~/.local/bin
cp deploy/start-weather ~/.local/bin/start-weather
chmod +x ~/.local/bin/start-weather
sudo cp deploy/logrotate-weather-server /etc/logrotate.d/weather-server
```

This script starts the Node.js server, waits for it to be ready, automatically detects whether it started on port 8443 (HTTPS) or 8080 (HTTP), and automatically detects the Chromium binary (`chromium` on Bookworm/Trixie, `chromium-browser` on Bullseye).

**labwc** (default on Trixie/Debian 13) — add to `~/.config/labwc/autostart`:

```bash
start-weather &
```

**wayfire** (default on Bookworm/Debian 12) — add to `~/.config/wayfire.ini` under the `[autostart]` section:

```ini
[autostart]
weather = start-weather
```

**X11/LXDE** (default on Bullseye/Debian 11) — if `~/.config/lxsession/LXDE-pi/autostart` does not exist yet, copy the system default first to preserve the desktop entries, then append `start-weather`:

```bash
[ ! -f ~/.config/lxsession/LXDE-pi/autostart ] && \
  cp /etc/xdg/lxsession/LXDE-pi/autostart ~/.config/lxsession/LXDE-pi/autostart
echo "@start-weather" >> ~/.config/lxsession/LXDE-pi/autostart
```

View logs with:

```bash
tail -f /tmp/weather-server.log
```

Then reboot to launch the application automatically:

```bash
sudo reboot
```

## Uninstall

To remove the Pi Weather Station service, scripts, and configurations:

```bash
bash deploy/uninstall.sh
```

The script will automatically remove the systemd service, `~/.local/bin/start-server`, `~/.local/bin/start-weather`, and the display server's autostart configuration. It will then ask whether to also remove:

- `settings.json` (contains your API keys) — kept by default
- SSL certificates (`server/cert.pem`, `server/key.pem`) — kept by default
- `node_modules` directories — removed by default
- The entire project directory — kept by default (requires explicit confirmation)

## Access from another machine

By default the server only accepts connections from `localhost` (127.0.0.1).

When remote access is enabled (`ALLOW_REMOTE=true`), the following applies:
- All API calls (Tomorrow.io, Mapbox, LocationIQ, sunrise-sunset.org) are **proxied through the server** — keys are never visible in client-side request URLs or third-party server logs. Remote clients receive only a boolean (configured/not configured) from `GET /settings` — actual key values are never sent over the network.
- Unit and display preferences (temperature, speed, clock format, etc.) work from any device.
- Settings writes (API keys, coordinates) are **always restricted to the Pi itself**. To change settings remotely, use an SSH tunnel instead (see below).

> **Changing settings remotely:** open an SSH tunnel and access the app as if you were local:
> ```bash
> ssh -L 8443:localhost:8443 pi@<pi-ip>
> # then open https://localhost:8443 in your browser
> ```

### Option 1 — Automated (recommended)

If you used `deploy/install.sh`, remote access can be configured automatically during installation. The script will:
- Ask for your Pi's IP address (auto-detected)
- Generate an SSL certificate that includes the Pi's IP as a Subject Alternative Name (SAN) — browsers will show a one-time security warning on first visit, which you can safely accept
- Enable `ALLOW_REMOTE=true` in the systemd service
- Remote users are always restricted to read-only access (settings writes are always localhost-only)

> **Note:** If your Pi's IP address changes, the SSL certificate will no longer be valid for remote connections. Re-run `bash deploy/install.sh` to regenerate it. To avoid this, assign a static IP to your Pi.

### Option 2 — Manual

To allow access from other devices, set the `ALLOW_REMOTE=true` environment variable when starting the server.

**With systemd** — edit `~/.config/systemd/user/pi-weather-server.service` and uncomment:

```ini
Environment=ALLOW_REMOTE=true
```

Then reload and restart:

```bash
systemctl --user daemon-reload
systemctl --user restart pi-weather-server
```

> Settings writes are always restricted to the Pi itself. To change settings remotely, use an SSH tunnel.

**With the autostart script** — edit `~/.local/bin/start-weather` and uncomment:

```bash
ALLOW_REMOTE=true /usr/bin/npm start &
```

**Manually:**

```bash
ALLOW_REMOTE=true npm start
```

The server will now serve the app across your network on port 8443 (HTTPS).

> **SSL certificate:** The auto-generated certificate only covers `localhost` and `127.0.0.1`. When accessing from another machine, your browser will show a certificate warning. To avoid this, regenerate the certificate with your Pi's IP as a SAN:
> ```bash
> openssl req -x509 -newkey rsa:2048 \
>     -keyout server/key.pem -out server/cert.pem \
>     -days 825 -nodes -subj "/CN=localhost" \
>     -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:<your-pi-ip>"
> chmod 600 server/key.pem
> ```
> Then restart the server.

## Debug panel

A debug panel is available on the Pi when `DEBUG=true` is set server-side. It shows:

- **Header** — application name, version, Git commit hash, and active branch (if not `master`); hardware model, OS version, network URL(s), and internet connectivity status (`ONLINE` / `OFFLINE` + latency)
- **Server KPIs** — process uptime, heap memory (used/total) and RSS, weather cache hit rate, and a per-endpoint response time table (count, avg, min, max)
- **Client KPIs** — page load time, live FPS, JS heap size (Chromium only), and a per-endpoint summary of all `/api/*` calls recorded by the browser since page load
- **Provider status** — live operational status fetched from each provider's status page (Tomorrow.io, Mapbox, ipapi.co, LocationIQ), cached 30 minutes
- **Services** — last HTTP status and timestamp for each external API call (Tomorrow.io, Mapbox, LocationIQ, ipapi.co, sunrise-sunset.org, Claude)
- **Quotas** — hourly, daily, and monthly request counters per service and endpoint, with colour-coded thresholds
- **Cache** — current in-memory weather cache entries with remaining TTL
- **Logs** — last 100 lines of the server log
- **Security events** — blocked requests (write attempts from remote clients)
- **npm audit** — output of the last `npm audit` run

The debug button (bug icon) appears in the control bar only when `DEBUG=true` and only when the app is accessed from the Pi itself.

**With systemd (Option 1 or 2)** — edit the override file and uncomment the `DEBUG=true` line:

```bash
nano ~/.config/systemd/user/pi-weather-server.service.d/override.conf
```

Remove the `#` in front of `# Environment=DEBUG=true`, then reload and restart:

```bash
systemctl --user daemon-reload
systemctl --user restart pi-weather-server
```

**With the autostart script (Option 3)** — edit `~/.local/bin/start-weather`:

```bash
nano ~/.local/bin/start-weather
```

Comment out the default `npm start` line and uncomment the `DEBUG=true` line:

```bash
# npm start >> /tmp/weather-server.log 2>&1 &
DEBUG=true npm start >> /tmp/weather-server.log 2>&1 &
```

**Manually:**

```bash
DEBUG=true npm start
```

> `DEBUG=true` is disabled by default. The `/api/debug` endpoint is always restricted to `localhost` regardless of this setting — it cannot be accessed from remote machines even when `ALLOW_REMOTE=true`.

# Settings

- Your API keys are saved locally (in plain text) to `settings.json`.
- The server will attempt to get your default location via [ipapi.co](https://ipapi.co/) (requires internet access), but if it cannot or you wish to choose a different default location, enter the latitude and longitude under `Custom Latitude` and `Custom Longitude` in settings, which can be accessed by tapping the gear button in the lower right hand corner.
- To hide the mouse cursor when using a touch screen, set `Hide Mouse` to `On`.
- To enable AI weather summaries, enter your [Anthropic API key](https://console.anthropic.com/) in the `Anthropic API Key` field. This feature is optional — the app works fully without it. Summaries are generated by Claude Haiku, cached 15 minutes server-side, and adapt to the time of day (morning, evening, or night forecast in the second paragraph). Supported languages: English, French, Spanish.

# Contributors

- [@elewin](https://github.com/elewin) — Original author
- [@aevans1987](https://github.com/aevans1987)
- [@dagent23](https://github.com/dagent23)
- [@klamer](https://github.com/klamer)
- [Claude Code](https://claude.ai/code) (Anthropic) — AI pair programmer

# License

The MIT License (MIT)

Copyright (c) 2020 Eric Lewin

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
