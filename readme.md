
# Pi Weather Station

This is a weather station designed to be used with a Raspberry Pi on the official 7" 800x480 touchscreen.

![pws-screenshot3](https://user-images.githubusercontent.com/15202038/91359998-4625bb80-e7bb-11ea-937e-c87eede41f35.JPG)

The weather station will require you to have API keys from [Mapbox](https://www.mapbox.com/) and [Tomorrow.io](https://www.tomorrow.io/). Optionally, you can use an API key from [LocationIQ](https://locationiq.com/) to preform reverse geocoding.

Weather maps are provided by the [RainViewer](https://www.rainviewer.com/) API, which generously does not require an [API key](https://www.rainviewer.com/api.html).

Sunrise and Sunset times are provided by [Sunrise-Sunset](https://sunrise-sunset.org/), which generously does not require an [API key](https://sunrise-sunset.org/api).

See it in action [here](https://www.youtube.com/watch?v=dvM6cyqYSw8).

> Be mindful of the plan limits for your API keys and understand the terms of each provider, as scrolling around the map and selecting different locations will incur API calls for every location. Additionally, the weather station will periodically make additional api calls to get weather updates throughout the day.

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

To install, clone the repo and run

    $ npm install

Then build the client

    $ cd client && npm install && npm run prod && cd ..

Start the server with

    $ npm start

Now point your browser to `https://localhost:8443` and put it in full screen mode (`F11` in Chromium).

> **Note:** The server uses a self-signed SSL certificate generated automatically on first launch. Your browser will show a security warning — this is expected. You can safely accept the exception for `localhost`.

## Running on startup

Two methods are available in the `deploy/` folder.

### Option 1 — systemd (recommended)

Starts the server automatically at boot, independent of the graphical session. Restarts automatically on failure.

```bash
cp deploy/pi-weather-server.service ~/.config/systemd/user/
systemctl --user enable pi-weather-server
systemctl --user start pi-weather-server
loginctl enable-linger $USER
```

Then add Chromium to your Wayland compositor's autostart (e.g. `~/.config/labwc/autostart`):

```bash
/usr/bin/chromium --kiosk --noerrdialogs --disable-infobars --no-first-run --ozone-platform=wayland --enable-features=OverlayScrollbar --start-maximized
```

View logs with:

```bash
journalctl --user -u pi-weather-server -f
```

### Option 2 — autostart script

Copy the provided script to your home directory and call it from your compositor's autostart:

```bash
cp deploy/start-weather ~/start-weather
chmod +x ~/start-weather
```

Then in `~/.config/labwc/autostart`:

```bash
sleep 30 && $HOME/start-weather
```

## Access from another machine

By default the server only accepts connections from `localhost` (127.0.0.1). This protects your API keys from being accessed by other devices on your network.

> **Warning:** Opening the app to your network means anyone on it could potentially access your API keys from the settings page. Do this at your own risk.

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

**With the autostart script** — edit `~/start-weather` and uncomment:

```bash
ALLOW_REMOTE=true /usr/bin/npm start &
```

**Manually:**

```bash
ALLOW_REMOTE=true npm start
```

The server will now serve the app across your network on port 8443 (HTTPS).

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
