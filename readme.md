
# Pi Weather Station

This is a weather station designed to be used with a Raspberry Pi on the official 7" 800x480 touchscreen.

![pws-screenshot3](https://user-images.githubusercontent.com/15202038/91359998-4625bb80-e7bb-11ea-937e-c87eede41f35.JPG)

The weather station will require you to have API keys from [Mapbox](https://www.mapbox.com/) and [Tomorrow.io](https://www.tomorrow.io/). Optionally, you can use an API key from [LocationIQ](https://locationiq.com/) to perform reverse geocoding. All three API keys are kept server-side and never exposed in client-side requests.

Weather maps are provided by the [RainViewer](https://www.rainviewer.com/) API, which generously does not require an [API key](https://www.rainviewer.com/api.html).

Sunrise and Sunset times are provided by [Sunrise-Sunset](https://sunrise-sunset.org/), which generously does not require an [API key](https://sunrise-sunset.org/api).

Default geolocation (used when no custom coordinates are configured) is provided by [ipapi.co](https://ipapi.co/), which does not require an API key for basic usage.

See it in action [here](https://www.youtube.com/watch?v=dvM6cyqYSw8).

> Be mindful of the plan limits for your API keys and understand the terms of each provider, as scrolling around the map and selecting different locations will incur API calls for every location. Additionally, the weather station will periodically make additional API calls to get weather updates throughout the day. All weather (Tomorrow.io), map tile (Mapbox), and reverse geocoding (LocationIQ) calls are proxied through the server — multiple browser clients share the same quota rather than each consuming it independently. Weather responses are cached server-side, further reducing API usage.

# v2.1.3

- **Server-side weather cache** — Tomorrow.io responses are now cached in memory on the server, reducing API quota consumption when multiple clients are connected or when the page is reloaded frequently. Cache TTLs match the natural update cadence of each data type: 15 minutes for current conditions, 30 minutes for hourly forecasts, and 6 hours for daily forecasts. The cache is shared across all clients regardless of `REMOTE_SECURITY` setting and is cleared on server restart.

# v2.1.2

- **Tomorrow.io proxy** — Weather API calls (current, hourly, daily) are now proxied through the Express server, consistent with Mapbox and LocationIQ. The API key is no longer included in client-side request URLs. Multiple browser clients now share the same quota rather than each consuming it independently.

# v2.1.1

Security improvements:

- **API key proxying** — Mapbox (map tiles) and LocationIQ (reverse geocoding) API calls are now proxied through the Express server. Keys are no longer included in client-side request URLs, keeping them out of browser network logs and third-party server logs. Note: keys are still transmitted to the browser via `GET /settings` for display in the settings panel.
- **Settings write protection** — `POST`, `PUT`, `PATCH`, and `DELETE` requests to `/settings` can be restricted to `localhost` by enabling `REMOTE_SECURITY=true`. When active, remote users can view the app but cannot modify API keys or coordinates.
- **Remote access UX** — When `REMOTE_SECURITY=true`, the settings panel hides API key and coordinate fields for remote users. Unit and display preferences (temperature, speed, clock format, mouse) remain accessible as they are stored locally in the browser. Without `REMOTE_SECURITY`, remote users have full access to settings.
- **CORS removed** — The `cors` middleware (which allowed any origin to call the API) has been removed. All legitimate requests are same-origin and do not require it.
- **Shell injection fix** — `deploy/install.sh` now uses `python3 + json.dumps` to write `settings.json`, preventing potential shell injection via API key input.
- **JSON parse hardening** — `settings.json` parsing is now wrapped in a try/catch; a corrupted file returns a clean 500 error instead of crashing the server.
- **Dependency update** — `axios` updated to v1.15.0 to address a SSRF vulnerability (GHSA-3p68-rc4w-qgx5).
- **SSH keys excluded** — `ssh.key` and `ssh.key.pub` added to `.gitignore`.

# v2.1.0

- Upgraded build system from webpack 4 to webpack 5
- Updated all build dependencies (css-loader v7, style-loader v3, postcss v8, html-webpack-plugin v5)
- Fixed CSS modules compatibility with css-loader v7 (`esModule: false`)
- Updated [RainViewer](https://www.rainviewer.com/) API to v2 (`weather-maps.json`)
- Updated geolocation service to [ipapi.co](https://ipapi.co/)
- Updated axios to v1.x and express to v4.22

# v2.0.1

6-12-24: Now uses [Tomorrow.io](https://www.tomorrow.io) APi instead of ClimaCell.

# v2.0.0

1-22-2021: Now uses [ClimaCell](https://www.climacell.co/) API v4. For ClimaCell API v3 keys, use [Pi Weather Station v1](https://github.com/elewin/pi-weather-station/releases/tag/v1.0).

# Setup

> **Node.js requirement:** Node.js 18 or later is required. Bullseye (Debian 11) ships with Node.js 12 by default, but works fine if Node.js 18+ is installed manually (e.g. via [NodeSource](https://github.com/nodesource/distributions)). Bookworm (Debian 12) and Trixie (Debian 13) are recommended as they ship with a more recent Node.js.

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
- Check for Node.js (v18 minimum) and offer to install it if missing or outdated
- Optionally configure your API keys and create `settings.json`
- Optionally enable remote access from other machines on the network (see [Access from another machine](#access-from-another-machine))
- Install all dependencies and build the client
- Run `npm audit` after each install and automatically apply fixes if vulnerabilities are found — results are saved to `npm-audit.log`
- Configure and start the systemd service with log redirection to `/tmp/weather-server.log`
- Install log rotation (`/etc/logrotate.d/weather-server`) — daily rotation, 7 days history, max 10 MB, compressed
- Deploy `~/.local/bin/start-server` and configure your display server's autostart automatically
- Offer to reboot to launch the application automatically

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

Then configure your display server's autostart to launch `start-server`. This script waits for the server to be ready and automatically detects whether it started on port 8443 (HTTPS) or 8080 (HTTP) before launching Chromium.

**labwc** (default on Trixie/Debian 13):

```bash
cp deploy/autostart ~/.config/labwc/autostart
```

**wayfire** (default on Bookworm/Debian 12) — add to `~/.config/wayfire.ini` under the `[autostart]` section:

```ini
[autostart]
start-server = start-server
```

**X11/LXDE** (default on Bullseye/Debian 11) — add to `~/.config/lxsession/LXDE-pi/autostart`:

```bash
@start-server
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

This script starts the Node.js server, waits for it to be ready, and automatically detects whether it started on port 8443 (HTTPS) or 8080 (HTTP) before launching Chromium.

**labwc** (default on Trixie/Debian 13) — add to `~/.config/labwc/autostart`:

```bash
start-weather &
```

**wayfire** (default on Bookworm/Debian 12) — add to `~/.config/wayfire.ini` under the `[autostart]` section:

```ini
[autostart]
weather = start-weather
```

**X11/LXDE** (default on Bullseye/Debian 11) — add to `~/.config/lxsession/LXDE-pi/autostart`:

```bash
@start-weather
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

The script will automatically remove the systemd service, `~/.local/bin/start-server`, `~/.local/bin/start-weather`, and the display server's autostart configuration. It will then ask whether to also remove `settings.json`, SSL certificates, `node_modules`, and the project directory.

## Access from another machine

By default the server only accepts connections from `localhost` (127.0.0.1).

When remote access is enabled (`ALLOW_REMOTE=true`), the following applies:
- All API calls (Tomorrow.io, Mapbox, LocationIQ) are **proxied through the server** — keys are never visible in client-side request URLs or third-party server logs. Keys are still transmitted to the browser via `GET /settings` for display in the settings panel.
- Unit and display preferences (temperature, speed, clock format, etc.) work from any device.
- Optionally, enable **`REMOTE_SECURITY=true`** to restrict remote users: API key and coordinate fields are hidden in the settings panel, and write operations are blocked server-side. Unit and display preferences remain accessible. Without this, remote users have full access to settings.

### Option 1 — Automated (recommended)

If you used `deploy/install.sh`, remote access can be configured automatically during installation. The script will:
- Ask for your Pi's IP address (auto-detected)
- Generate an SSL certificate that includes the Pi's IP as a Subject Alternative Name (SAN) — browsers will show a one-time security warning on first visit, which you can safely accept
- Enable `ALLOW_REMOTE=true` in the systemd service
- Ask whether to restrict remote users to read-only access — if yes, enables `REMOTE_SECURITY=true` in the systemd service

> **Note:** If your Pi's IP address changes, the SSL certificate will no longer be valid for remote connections. Re-run `bash deploy/install.sh` to regenerate it. To avoid this, assign a static IP to your Pi.

### Option 2 — Manual

To allow access from other devices, set the `ALLOW_REMOTE=true` environment variable when starting the server.

**With systemd** — edit `~/.config/systemd/user/pi-weather-server.service` and uncomment the relevant lines:

```ini
Environment=ALLOW_REMOTE=true
# Environment=REMOTE_SECURITY=true  ← also uncomment this to make settings read-only for remote users
```

Then reload and restart:

```bash
systemctl --user daemon-reload
systemctl --user restart pi-weather-server
```

**With the autostart script** — edit `~/.local/bin/start-weather` and uncomment:

```bash
ALLOW_REMOTE=true /usr/bin/npm start &
```

**Manually:**

```bash
ALLOW_REMOTE=true npm start
# or with read-only remote access:
ALLOW_REMOTE=true REMOTE_SECURITY=true npm start
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

# Settings

- Your API keys are saved locally (in plain text) to `settings.json`.
- The server will attempt to get your default location via [ipapi.co](https://ipapi.co/) (requires internet access), but if it cannot or you wish to choose a different default location, enter the latitude and longitude under `Custom Latitude` and `Custom Longitude` in settings, which can be accessed by tapping the gear button in the lower right hand corner.
- To hide the mouse cursor when using a touch screen, set `Hide Mouse` to `On`.

# Contributors

- [@elewin](https://github.com/elewin) — Original author
- [@aevans1987](https://github.com/aevans1987)
- [@dagent23](https://github.com/dagent23)
- [@klamer](https://github.com/klamer)
- [Claude Code](https://claude.ai/code) (Anthropic) — AI pair programmer

# Do you want to Host this Application in Docker?

Pi Weather Station is available as a Docker Image for AMD64 and ARM infrastructures. see the *ReadME* here for more: https://github.com/SeanRiggs/pi-weather-station/blob/master/Docker%20Image/Docker-ReadMe.md

# License

The MIT License (MIT)

Copyright (c) 2020 Eric Lewin

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
