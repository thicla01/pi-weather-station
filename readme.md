
# Pi Weather Station

A full-stack weather display application originally designed for the Raspberry Pi 7" touchscreen, and confirmed to run on any modern Linux system (Debian, Ubuntu) or macOS.

| Platform | Auto-start | Kiosk mode |
|---|---|---|
| Raspberry Pi OS (Bullseye / Bookworm / Trixie) | systemd + labwc / wayfire / LXDE autostart | Chromium-family or Firefox |
| Debian / Ubuntu (incl. 26.04 GNOME, snap-Firefox) | systemd + XDG `~/.config/autostart` | Chromium-family or Firefox |
| openSUSE Leap 16+ (KDE Plasma) | systemd + XDG `~/.config/autostart` | Chromium-family or Firefox |
| macOS | launchd | — (window mode) |

The kiosk browser is chosen interactively by `install.sh` (Chromium, Chrome, Brave, Edge, or Firefox) and persisted in `~/.config/pi-weather-station/browser.conf`. Snap-confined Firefox is supported via a named profile (`-P pi-weather-station`).

![pws-screenshot3](https://user-images.githubusercontent.com/15202038/91359998-4625bb80-e7bb-11ea-937e-c87eede41f35.JPG)

The weather station will require you to have API keys from [Mapbox](https://www.mapbox.com/) and [Tomorrow.io](https://www.tomorrow.io/). Optionally, you can use an API key from [LocationIQ](https://locationiq.com/) to perform reverse geocoding, and an [Anthropic](https://console.anthropic.com/) API key for AI-generated weather summaries powered by Claude. All API keys are kept server-side: they never appear in client-side request URLs, and remote clients only receive a masked response (boolean) from `GET /settings` — the actual key values are only accessible from the host itself.

Weather maps are provided by the [RainViewer](https://www.rainviewer.com/) API, which generously does not require an [API key](https://www.rainviewer.com/api.html).

Sunrise and Sunset times are provided by [Sunrise-Sunset](https://sunrise-sunset.org/), which generously does not require an [API key](https://sunrise-sunset.org/api).

Default geolocation (used when no custom coordinates are configured) is provided by [ipapi.co](https://ipapi.co/), which does not require an API key for basic usage.

See it in action [here](https://www.youtube.com/watch?v=dvM6cyqYSw8).

> Be mindful of the plan limits for your API keys and understand the terms of each provider, as scrolling around the map and selecting different locations will incur API calls for every location. Additionally, the weather station will periodically make additional API calls to get weather updates throughout the day. All weather (Tomorrow.io), map tile (Mapbox), and reverse geocoding (LocationIQ) calls are proxied through the server — multiple browser clients share the same quota rather than each consuming it independently. Weather responses are cached server-side, further reducing API usage.

## Updating

For day-to-day updates, the in-app **Update** button (debug panel → notification badge) handles `git pull`, `npm install`, and the service restart automatically.

> ⚠️ **Upgrading from v2.3.x or older?** The in-app updater in those releases doesn't run `npm install`, so a one-click upgrade would land new dependencies as `Cannot find module` crashes. Run the install script once instead, and you're safe to use one-click updates from then on:
>
> ```bash
> cd ~/pi-weather-station && git pull && bash deploy/install.sh
> ```
>
> The script picks up your existing `settings.json`, refreshes service files, and reinstalls dependencies cleanly. Starting from v2.6.3 the modal also detects this case and shows the same recipe.

# Version history

Each release is fully documented in [CHANGELOG.md](./CHANGELOG.md). The sections below summarize the highlights of each minor version and link to the per-release notes.

## v2.6 — Indoor temperature, radar analysis paragraph, and updater UX (Apr 2026)

Indoor temperature/humidity/air-quality block (Homebridge-backed) promoted from experimental to a top-level setting in the InfoPanel header, with `install.sh` interactive prompt and stripped credentials in remote settings responses. The in-app updater gained pre-flight checks (rejects detached HEAD, non-`master`, or local changes with structured 409s) and surfaces the actual failure message in the modal; installs older than v2.4.1 are now flagged with `needsManualUpgrade` so the user is steered to `bash deploy/install.sh` instead of crashing on missing dependencies. Plus small layout polish (clock right-aligned without indoor block, AM/PM scaled).

Releases: [2.6.3](./CHANGELOG.md#263---2026-04-27) · [2.6.2](./CHANGELOG.md#262---2026-04-27) · [2.6.1](./CHANGELOG.md#261---2026-04-26) · [2.6.0](./CHANGELOG.md#260---2026-04-26)

## v2.5 — Multi-browser kiosk, GNOME/KDE autostart, openSUSE (Apr 2026)

Browser choice (Chromium-family or Firefox) prompted at install and persisted in `~/.config/pi-weather-station/browser.conf`, with family-aware kiosk flags. XDG `~/.config/autostart/pi-weather-station.desktop` for GNOME and KDE Plasma alongside the existing labwc / wayfire / LXDE paths. `install.sh` reorganised into named phases, gained pre-flight checks for `curl`/`git`, and recognises `zypper` for openSUSE Leap 16+. Plus `install.sh` no longer hijacks `feat/*` and `fix/*` branches off `master` during testing.

Releases: [2.5.1](./CHANGELOG.md#251---2026-04-26) · [2.5.0](./CHANGELOG.md#250---2026-04-26)

## v2.4 — Cold-boot robustness, AI radar analysis (Apr 2026)

A 45 km radar-analysis circle on the map and a third "Analyse radar" paragraph in the AI summary, fed by a server-side RainViewer tile sampler (8 directions × 4 distances × 3 timestamps, decoded via `pngjs`). Cold-boot reliability was hardened on multiple fronts: `dns.setDefaultResultOrder("ipv4first")` to avoid IPv6 stalls, geolocation retry-with-backoff + 30-day disk cache, `ExecStartPre` waiting on DNS in the systemd unit, and `npm install` added to the in-app updater so dependency-introducing pulls don't crash-loop on `Cannot find module`.

Releases: [2.4.6](./CHANGELOG.md#246---2026-04-26) · [2.4.5](./CHANGELOG.md#245---2026-04-26) · [2.4.4](./CHANGELOG.md#244---2026-04-26) · [2.4.3](./CHANGELOG.md#243---2026-04-26) · [2.4.2](./CHANGELOG.md#242---2026-04-26) · [2.4.1](./CHANGELOG.md#241---2026-04-26) · [2.4.0](./CHANGELOG.md#240---2026-04-26)

## v2.3 — Sense HAT animated sun arc and Trixie touchscreen fix (Apr 2026)

The Sense HAT 8×8 LED display gained a realistic animated sun arc (rising east → zenith → setting west) with colour shift (yellow → orange → red), a dynamic horizon glow, and a direct framebuffer write that bypasses the `sense_hat` differential cache. `GET /api/sensehat` falls back to ipapi.co when no custom coordinates are configured. Documented the official Raspberry Pi 7" touchscreen fix on Trixie (DSI-1 → Multitouch in Control Centre) for imprecise tapping, scrolling, and pinch-to-zoom.

Releases: [2.3.2](./CHANGELOG.md#232---2026-04-26) · [2.3.1](./CHANGELOG.md#231---2026-04-25) · [2.3.0](./CHANGELOG.md#230---2026-04-23)

## v2.2 — Security hardening, AI summary, Sense HAT, macOS, small-screen UX (Apr 2026)

Security: `GET /settings` masks API keys to remote clients, `REMOTE_SECURITY` removed (writes are now unconditionally `localhostOnly`), per-client rate limiting (120 req/min on weather/geocoding, 600 req/min on tiles), proxy-aware IP detection, and a server-side settings key whitelist. AI weather summary powered by Claude Haiku with localized output. Sense HAT 8×8 LED display + companion `pi-sensehat.service`. macOS deployment via launchd. Small-screen UX: chart tabs, collapsible info panel, font-size setting, frosted-glass radar legend. Plus the in-app `UpdateModal` with one-click update, force-check button, and `Update` button for kiosk users.

Releases: [2.2.8](./CHANGELOG.md#228---2026-04-23) · [2.2.7](./CHANGELOG.md#227---2026-04-23) · [2.2.6](./CHANGELOG.md#226---2026-04-23) · [2.2.5](./CHANGELOG.md#225---2026-04-23) · [2.2.4](./CHANGELOG.md#224---2026-04-22) · [2.2.3](./CHANGELOG.md#223---2026-04-20) · [2.2.2](./CHANGELOG.md#222---2026-04-19) · [2.2.1](./CHANGELOG.md#221---2026-04-18) · [2.2.0](./CHANGELOG.md#220---2026-04-16)

## v2.1 — Webpack 5, server-side cache, debug panel, i18n, kiosk options (Apr 2026)

Build system modernized to webpack 5, all build dependencies refreshed, RainViewer API v2, axios v1.x and express v4.22. Server-side weather cache reduces Tomorrow.io API spend; new debug panel (localhost-only, `DEBUG=true`) exposes provider status, network info, server/client KPIs, response times, quota counters, cache state, security events, and logs. Internationalization (EN/FR/ES) via i18next with browser-language detection. Kiosk mode made optional during install. LXDE autostart no longer discards system defaults on Bullseye. Bullseye 32-bit Node.js 22 via nvm; NodeSource everywhere else. License cleanup (no more GPL icon packs).

Releases: [2.1.11](./CHANGELOG.md#2111---2026-04-14) · [2.1.10](./CHANGELOG.md#2110---2026-04-13) · [2.1.9](./CHANGELOG.md#219---2026-04-13) · [2.1.8](./CHANGELOG.md#218---2026-04-13) · [2.1.7](./CHANGELOG.md#217---2026-04-12) · [2.1.6](./CHANGELOG.md#216---2026-04-12) · [2.1.5](./CHANGELOG.md#215---2026-04-12) · [2.1.4](./CHANGELOG.md#214---2026-04-11) · [2.1.3](./CHANGELOG.md#213---2026-04-11) · [2.1.2](./CHANGELOG.md#212---2026-04-11) · [2.1.1](./CHANGELOG.md#211---2026-04-09) · [2.1.0](./CHANGELOG.md#210---2026-04-03)

## v2.0 — Tomorrow.io and ClimaCell APIs (2021–2024)

Switched from ClimaCell API v4 to Tomorrow.io. For ClimaCell API v3 keys, use [Pi Weather Station v1](https://github.com/elewin/pi-weather-station/releases/tag/v1.0).

Releases: [2.0.1](./CHANGELOG.md#201---2024-06-12) · [2.0.0](./CHANGELOG.md#200---2021-01-22)

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

## Sense HAT LED display (optional)

If your Raspberry Pi has a [Sense HAT](https://www.raspberrypi.com/products/sense-hat/) attached, the included display script shows animated weather states on the 8×8 RGB LED matrix.

**Features:**
- 12 weather states: clear day/night, partly cloudy day/night, overcast, fog, light rain, rain, snow, ice pellets, thunderstorm
- Sun travels an east-to-west arc throughout the day, shifting from yellow at noon to red near the horizon
- Sunset glow (4 red pixels) appears on the horizon as the sun sets
- Brightness automatically reduced at night

**Installation:**

The `deploy/install.sh` script asks whether a Sense HAT is present and handles the setup automatically. For a manual install:

```bash
sudo apt-get install sense-hat
cp deploy/pi-sensehat.service ~/.config/systemd/user/
systemctl --user enable --now pi-sensehat
```

**Test mode** — cycles through all 12 states for 15 seconds each:

```bash
python3 ~/pi-weather-station/tools/sensehat_weather.py --test
```

**View logs:**

```bash
journalctl --user -u pi-sensehat -n 50
```

> **Important:** the script takes exclusive control of the Sense HAT LED matrix. Disable any other program writing to the HAT (clock display, demos, etc.) before enabling the service.

> **Orientation:** edit the `ROTATION` constant in `tools/sensehat_weather.py` if the display appears rotated. On a Pi 4B with USB-C/HDMI pointing up, use `ROTATION = 180`.

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

# Environment variables

These variables are set in the systemd service drop-in (`~/.config/systemd/user/pi-weather-server.service.d/override.conf`) or exported before `npm start`.

| Variable | Values | Default | Description |
|---|---|:---:|---|
| `ALLOW_REMOTE` | `true` / `false` | `false` | Allow connections from other devices on the network. When `false`, the server only accepts connections from `localhost`. |
| `DEBUG` | `true` / `false` | `false` | Enable the debug panel and the `/api/debug` endpoint. Both remain restricted to localhost regardless of this flag. |

No other environment variables are used by the server. API keys and user preferences are stored in `settings.json`, not in the environment.

# Settings

- Your API keys are saved locally (in plain text) to `settings.json`.
- The server will attempt to get your default location via [ipapi.co](https://ipapi.co/) (requires internet access), but if it cannot or you wish to choose a different default location, enter the latitude and longitude under `Custom Latitude` and `Custom Longitude` in settings, which can be accessed by tapping the gear button in the lower right hand corner.
- To hide the mouse cursor when using a touch screen, set `Hide Mouse` to `On`.
- To adjust text size in the info panel, use the **Font Size** toggle (S / M / L). The setting is saved in `localStorage` and takes effect immediately.
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
