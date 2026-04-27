# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Documentation
- **`docs/security-hardening.md` gains a "Cost-related controls" section** — captures the rationale for keeping `advanced.ai.*` settings behind the `localhostOnly` boundary: beyond the classical security argument, these toggles directly affect Anthropic API billing (prompt size, paragraph count, sample-point density). The section spells out the per-toggle impact, the enforcement points (server route + UI), and recommends per-key quotas + per-device API keys for multi-Pi deployments. The threat model in the same doc gains a corresponding bullet. A code comment on the `PATCH /setting` route in `server/index.js` mirrors the rationale for future maintainers tempted to relax the rule for "harmless preferences".

---

## [2.10.1] - 2026-04-27

### Fixed
- **Advanced settings now visible from remote clients (read-only)** — the section was hidden entirely on remote because the toggles save via `PATCH /setting` (localhostOnly). Hiding it left users wondering "where did my advanced settings go?". Show the section everywhere; on remote, the toggles render with reduced opacity and ignore clicks, and an amber notice at the top of the section points the user toward the SSH-tunnel workflow for actual changes. The localhostOnly write boundary is preserved unchanged — this is purely a UX clarification.

---

## [2.10.0] - 2026-04-27

### Added
- **CPU temperature in the debug panel** — a new live row in the SERVER KPIs section shows the CPU temperature in degrees Celsius, refreshed every 5 s while the panel is open. Read from `/sys/class/thermal/thermal_zone0/temp`, which works on Raspberry Pi (any model), Linux x86, and most embedded boards; falls back to `—` on platforms that don't expose the file (macOS). Color-coded thresholds: green below 60 °C, orange 60–74 °C, red 75 °C and above (close to the Pi 4's ~80–85 °C throttling threshold). The value is also exported to the debug CSV alongside the other KPIs.
- **`GET /api/debug/cpu-temp`** — lightweight endpoint returning `{ cpuTempC: <number | null> }` for cheap polling without re-fetching the full `/api/debug` payload. Localhost-only.

---

## [2.9.1] - 2026-04-27

### Fixed
- **"Check for update" now refreshes an open Update modal** — when a user opened the modal, then clicked the debug panel's "Check for update" button to refresh stale data, the server-side cache was correctly cleared and re-evaluated, but only `updateAvailable`, `latestVersion`, `latestSha`, and `commits` were propagated back into AppContext. `serviceFileChanged` and `needsManualUpgrade` were left at their stale values, so an open modal could keep its amber warning and disabled Update button even after the actual condition had cleared. Centralize the fetch in a shared `refreshUpdateCheck(force)` helper that updates every relevant field, so the periodic 6-hour poll and the on-demand button stay in lockstep.

---

## [2.9.0] - 2026-04-27

### Added
- **`advanced.ai.radarAnalysisEnabled` — toggle the radar analysis on or off** — when this flag is `false`, `analyzeRadar` short-circuits to `null` server-side, the AI summary falls back to its two-paragraph form (no "Radar analysis" paragraph), and `WeatherMap` skips the 45/90 km dashed circles and the sampling-point overlay. Default `true` so existing behaviour is unchanged. The toggle now sits at the top of the AI section in Advanced settings.
- **`advanced.ai.doubleOuterPoints` — uniform point density across rings** — between 45 and 90 km, the area covered grows quadratically while the standard 8-direction sampling stays constant, so points-per-km² drops to ~⅓ of the inner ring's density. When this flag is on (and `extendedRadius` is also on), the outer ring uses 16 directions (every 22.5° — the full 16-point compass: N/NNE/NE/ENE/E/ESE/…/NNW) instead of 8, restoring uniform coverage. Total samples: 32 inner + 48 outer = 80 (vs 56 with extended only, 32 standard). Cache key includes the doubled flag so toggling never returns a stale snapshot.

### Changed
- `radarAnalyzerCtrl` was refactored to split inner and outer rings as separate configurations rather than one combined distance array. `buildSnapshot` now takes a pre-built `points` list of `{direction, distance, bearing}` tuples instead of computing them inline; `formatSnapshot` iterates the 16-point compass so both 8- and 16-direction snapshots come out in a stable N → NNE → NE → … → NNW order.
- The "no precipitation" line in the radar prompt now reports the actual sampled radius (`within 45 km` vs `within 90 km`) instead of the hard-coded 45 km.

---

## [2.8.1] - 2026-04-27

### Fixed
- **`ALLOW_REMOTE` no longer drifts the upstream service file out of sync** — `install.sh` used to enable remote access by `sed`-uncommenting `Environment=ALLOW_REMOTE=true` directly inside `~/.config/systemd/user/pi-weather-server.service`. Once that line was edited, the installed file's hash no longer matched the upstream copy on master, so the in-app updater raised the amber "service file changed" warning on every release — even when the file hadn't actually changed in the new version. Move the env var into a drop-in (`pi-weather-server.service.d/local.conf`) instead, matching what `override.conf` already does for `DEBUG`. The main service file now stays a clean mirror of upstream and the warning only fires when there's a real upstream change.
- **`toggle-remote.sh` migrates legacy installs on the fly** — the script now writes/deletes the drop-in (canonical layout from v2.8.1) and re-comments any leftover `Environment=ALLOW_REMOTE=true` line found in the main service file from a pre-v2.8.1 install. Users on either layout get a consistent toggle UX, and the next toggle normalizes their setup automatically.

---

## [2.8.0] - 2026-04-27

### Added
- **Advanced settings section in the Settings panel** — collapsible "Advanced settings" block at the bottom of the Settings overlay, closed by default, opens on click. Hosts expert toggles without cluttering the main flow. Reads/writes a new top-level `advanced` key in `settings.json`, grouped by feature area. Toggles save instantly via `PATCH /setting` (no separate Save button). Sub-keys are stripped from remote `GET /settings` responses by virtue of the localhost-only write boundary already in place; the read path returns them so the UI can hydrate consistently.
- **`advanced.ai.extendedRadius` — extend the radar analysis from 45 km to 90 km** — when enabled, the server-side radar analyzer samples 7 distance rings instead of 4 (5/15/30/45/60/75/90 km), keeping the same 8 directions and 3 timestamps. Roughly +75 % tile reads to RainViewer (no quota, no key required), parallelized so the latency impact stays within ~0.5-1 s on a cold cache miss. The cache key includes the radius mode so toggling the flag never returns a stale snapshot built with the previous distance set.
- **`advanced.ai.showSamplingPoints` — visualize the analyzer's sample positions on the map** — when enabled, `WeatherMap` draws a small dashed dot at every (direction, distance) point the analyzer reads. The geometry is computed client-side using the same great-circle formula as `radarAnalyzerCtrl`, so the dots always match the server's actual sample positions. Useful for understanding what the AI radar paragraph reasons about, and for visually validating the extended-radius mode.
- **Second 90 km circle on the map** — when `extendedRadius` is on, the existing 45 km dashed circle is joined by an outer 90 km dashed circle in the same style, marking the larger sampling area without hiding the inner zone.

---

## [2.7.0] - 2026-04-27

### Added
- **`deploy/toggle-remote.sh` — focused script for toggling remote access** — flipping `ALLOW_REMOTE` on or off after the initial install used to mean either re-running the full `install.sh` flow (and pressing Enter through every prompt) or hand-editing the systemd unit / launchd plist, regenerating the SSL cert, and restarting the service manager. The new script does only that one job: reads the current state, asks to confirm the inverse action, regenerates `server/cert.pem` with the LAN IP as a Subject Alternative Name (when enabling), edits the env var in the right config file, and reloads + restarts the service. Works on Linux (systemd) and macOS (launchd). Settings writes remain localhost-only either way.

---

## [2.6.3] - 2026-04-27

### Added
- **Update modal warns when the installed version is too old for one-click upgrade** — installations running v2.3.x and earlier have a `/api/update` that doesn't run `npm install` (the fix shipped in v2.4.1). Clicking the one-click button on those installs would `git pull` recent code that requires new dependencies, then restart into a `Cannot find module 'X'` crash loop. The update checker now runs `git merge-base --is-ancestor` against the SHA that introduced the npm-install fix; when local is older, the modal shows an amber notice, expands the displayed command to `git pull && bash deploy/install.sh`, and disables the one-click Update button so the user is forced through the install script (which handles dependencies, service file, and autostart in one go).

---

## [2.6.2] - 2026-04-27

### Fixed
- **One-click update no longer fails silently with a generic "Failed"** — three real failure modes the in-app updater couldn't recover from were surfaced during a v2.3.0 → v2.6.0 rollback test. The `POST /api/update` endpoint now runs three pre-flight checks before touching anything, and returns a structured 409 with a clear, actionable message when one fails:
  - **Detached HEAD** — happens when the working copy was checked out at a specific commit instead of a branch (`git checkout <sha>`). `git pull` had no branch to merge with.
  - **Not on `master`** — happens when the user is testing a feature branch or left a stale branch checked out. Pulling silently followed the wrong remote.
  - **Local uncommitted changes** — happens when an earlier `npm install` (or any local edit) modified `package-lock.json` or another tracked file. `git pull --ff-only` then refused to overwrite the changes.
  - The same path also surfaces `git pull` and `npm install` failures with their actual stderr instead of swallowing them.
- **Update modal now shows the failure message** — when `/api/update` returns an error, the modal renders the server's message (in a red bordered box) above the action buttons instead of just turning the button red. Users see exactly what command to run on the device to recover, without having to SSH in to grep the server log.

---

## [2.6.1] - 2026-04-26

### Fixed
- **Clock AM/PM overflow next to the indoor temperature block** — in 12-hour mode the `3:01 PM` time string was rendered at the same large font as the digits and overflowed into the indoor-temperature block on the left, overlapping the location name and other rows. The `AM`/`PM` suffix is now rendered in a smaller span (digital-clock proportions, ~0.4em of the digit size, baseline-aligned) so the time fits the available width on small panels.
- **Clock drifted to the left after upgrading on Pis without indoor temperature** — the InfoPanel header was switched to a `space-between` flex row to host both the indoor-temperature block (left) and the clock (right). On Pis where `IndoorTemperature` returns `null` (feature not configured), the clock became the only flex child and ended up at flex-start, i.e. the left edge of the panel. Anchor the clock with `margin-inline-start: auto` so it stays on the right whether or not the indoor block is present.

---

## [2.6.0] - 2026-04-26

### Added
- **Indoor temperature display, promoted out of experimental** — a Homebridge-backed indoor reading is now a first-class feature. A small block to the left of the clock shows the temperature, humidity (when the sensor exposes it), and HomeKit air quality (1=Excellent..5=Poor, with a coloured dot). Polls a single configured sensor via `homebridge-config-ui-x`'s REST API every five minutes, with auto-relogin on JWT expiry, range-based defensive filtering, and a stale-after-30-min indicator that dims the readout. The configuration moves from the previous `experimental.indoorTemperature` block in `settings.json` to a top-level `indoorTemperature` block; `install.sh` now offers an interactive prompt for it under "Advanced features" (Homebridge URL, username, password, sensor name). Available on all platforms — works as long as Homebridge is reachable from the device. Documentation: `docs/indoor-temperature.md`.

### Migration note
Users who had the experimental block on `feat/indoor-temperature`: move the contents up one level (drop the `experimental:` wrapper) and restart. `install.sh` re-run is the simplest path — its prompt writes the new top-level block for you. The old `experimental` key is no longer recognised by the server.

---

## [2.5.1] - 2026-04-26

### Fixed
- **`install.sh` no longer silently switches feature/fix branches to master** — the script auto-switched to `master` whenever it detected another branch, which is sensible for normal users but actively breaks testing of work-in-progress branches: bash loads the script into memory before running, so the running install behaved as expected, but the deploy/ files later `cp`-ed into `~/.local/bin` and `~/.config/systemd/user` came from master instead of the branch the maintainer thought they were testing. Now branches matching `feat/*` and `fix/*` are recognised as in-development and skip the auto-switch (with a one-line notice). Any other non-master branch (e.g. a leftover from an old workflow) still triggers the safety switch as before.
- **Server log prefix no longer breaks `printf`-style formatting** — `server/index.js` overrides `console.log`/`console.error` to prepend a timestamp. The previous implementation passed the timestamp as a separate first argument, which made Node treat it as the format string and skip `%s` / `%d` substitutions on the actual log message, leaving placeholders unrendered in the log. The wrapper now inlines the timestamp into the format string when the first argument is a string, so substitutions work as expected (and falls back to the previous behaviour for non-string first arguments like objects).

---

## [2.5.0] - 2026-04-26

### Added
- **Browser choice for kiosk mode** — `install.sh` now detects every supported browser installed on the machine (Chromium, Google Chrome, Microsoft Edge, Brave, Firefox / Firefox ESR), highlights the system default, and prompts the user to pick one for kiosk mode. The choice is persisted in `~/.config/pi-weather-station/browser.conf` and read by `~/.local/bin/start-server` at launch. Two browser families are handled with the right flags: Chromium-based browsers use `--kiosk --noerrdialogs ...`; Firefox uses `--kiosk --no-remote --profile <dedicated-profile>` so the self-signed-cert acceptance persists across launches.
- **GNOME and KDE Plasma autostart support** — `install.sh` now writes a freedesktop.org `~/.config/autostart/pi-weather-station.desktop` entry when it detects GNOME or KDE Plasma as the desktop environment. Existing labwc, wayfire, and X11/LXDE-Pi autostart paths are unchanged. Makes the kiosk usable on standard Ubuntu / Fedora / openSUSE desktops, not just Raspberry Pi OS.
- **Pre-flight checks for required tools** — before doing anything, `install.sh` verifies that `curl` and `git` are installed; if not, it offers to install them via `apt-get` or `zypper` (with the user's permission). Previously, `curl` missing on a minimal Ubuntu/Debian install caused the NodeSource setup to silently fall back to the distribution's old `nodejs` package without `npm`.
- **openSUSE support** — `install.sh` recognises `zypper` as the system package manager and installs Node.js v22 from the openSUSE repos when needed (Leap 16+ ships a recent enough version).

### Changed
- **`install.sh` reorganised into named phases** — the script is now structured around clearly-marked phases (pre-flight, Node.js, base configuration, kiosk + browser, dependencies, services, autostart, advanced features, summary). The flow itself is unchanged; the markers make the script easier to navigate and modify.
- **Sense HAT moved to an explicit "Advanced features" section** — the question is now asked behind an opt-in `Configure now? (y/N)` prompt, so first-time installers aren't asked about hardware they don't have. Re-running `install.sh` is the way to add advanced features later.
- **`start-server` reads the browser config** instead of hard-coding Chromium detection. Backward compatible: when no config file is present, it still auto-detects the first available Chromium-family browser as before.
- **`uninstall.sh` cleans up the new files** — removes `~/.config/pi-weather-station/` (browser config + Firefox profile) and the XDG autostart `.desktop` entry alongside the existing autostart paths.

### Upgrade note
Existing installations don't pick up `start-server` or `install.sh` changes from `git pull` automatically — re-run `bash deploy/install.sh` to refresh both. Existing Chromium kiosk users will get the same experience without any reconfiguration; users who want to switch to Firefox or Chrome can pick a different browser at the kiosk prompt.

---

## [2.4.6] - 2026-04-26

### Fixed
- **Kiosk no longer starts in non-kiosk mode after boot** — `server/index.js` was using the npm `open` package to auto-launch the default browser at server startup, a convenience for `npm start` in dev mode. On the Pi, where the systemd service starts before the user session has loaded its display compositor, the call used to fail silently — leaving `~/.local/bin/start-server` (run from the labwc autostart) free to launch `chromium --kiosk` correctly. As a side effect of v2.4.4's `ExecStartPre` waiting for DNS, the service now starts late enough that the display is already available, so `open()` succeeded and launched a non-kiosk Chromium first; `start-server`'s subsequent `chromium --kiosk` call only opened a tab in the existing instance (Chromium being single-instance, the kiosk flag was ignored). Skip the `open()` call entirely when no TTY is attached, so service environments leave the kiosk launcher to do its job.

---

## [2.4.5] - 2026-04-26

### Added
- **Update modal warns when the systemd service file changed** — the in-app updater (`POST /api/update`) safely handles `git pull`, `npm install`, and `systemctl restart`, but it can't safely overwrite `~/.config/systemd/user/pi-weather-server.service` because the installed copy may have user customizations like `ALLOW_REMOTE=true`. The update checker now hashes the upstream version of `deploy/pi-weather-server.service` and compares it with the installed file. When they differ, the modal shows an amber notice, expands the displayed command to include the manual `cp` + `daemon-reload` steps, and disables the one-click Update button so the user is forced through the manual recipe.

---

## [2.4.4] - 2026-04-26

### Fixed
- **Multiple service errors at cold boot — sunrise-sunset, Mapbox tiles, etc.** — even with the geolocation cache and the IPv4-first DNS fix, on cold boot the systemd user session would launch `pi-weather-server` before the network stack was fully usable. The first wave of outbound HTTP calls (Mapbox tile proxy, `sunrise-sunset.org`, etc.) would fail with `ENOTFOUND` / `EAI_AGAIN` for two to three seconds, and components that don't auto-retry (sunrise/sunset times, reverse geocoded location name) stayed empty in the kiosk until the next page load. Add an `ExecStartPre` step to `deploy/pi-weather-server.service` that blocks until `getent hosts` succeeds for an external domain (up to 60 s, then continues anyway). All outbound calls from Node now happen on a network that's actually ready.

### Upgrade note
Existing installations don't pick up service file changes from `git pull` automatically. After updating, copy the new service file into place and reload systemd:
```bash
cp ~/pi-weather-station/deploy/pi-weather-server.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user restart pi-weather-server
```

---

## [2.4.3] - 2026-04-26

### Fixed
- **Geolocation request failing on cold boot leaves the map empty** — at cold boot, the network stack often isn't fully ready (DNS resolver still bootstrapping, default route not yet installed) when `pi-weather-server` starts. The first call to `ipapi.co` would fail almost immediately, no fallback coordinates were resolved, and the kiosk showed "Cannot retrieve map data" until the user reloaded the page. The geolocation controller now retries with exponential backoff (5 attempts, ~31 s worst case) to absorb the early-boot race, and persists every successful response to a disk cache (`server/geolocation-cache.json`, 30 day TTL). On subsequent boots — even if the network fetch fails again — the cached coordinates are returned immediately, and the kiosk comes up with the right map.

---

## [2.4.2] - 2026-04-26

### Fixed
- **Geolocation fallback failing on networks with broken IPv6** — some home networks advertise AAAA records but can't actually route IPv6. Node.js before v23 doesn't run Happy Eyeballs by default, so axios calls to dual-stacked endpoints like `ipapi.co` (Cloudflare) tried the IPv6 address first and failed with "Network is unreachable" without falling back to IPv4 in time. The result was a `[service] ipapi.co → 500 — Geolocation failed` in the log at boot, no default coordinates resolved, and a "Cannot retrieve map data" message in the kiosk until the user reloaded the page or the browser geolocation eventually succeeded. Force `dns.setDefaultResultOrder("ipv4first")` at server startup so all outbound HTTP from the Node process tries IPv4 before IPv6 — no measurable cost on networks where IPv6 works.

---

## [2.4.1] - 2026-04-26

### Fixed
- **In-app updater now installs new dependencies before restarting** — when an update introduced a new npm package (e.g. `pngjs` for the radar analyzer), `POST /api/update` would `git pull` and restart the server without running `npm install`, leaving the freshly restarted Node process to crash-loop on `Cannot find module '<dep>'`. The endpoint now runs `npm install --omit=dev --no-audit --no-fund` between the pull and the restart, and returns 500 on `npm install` failure (so the running server stays on the previous code rather than restarting into a broken state). When `package.json` hasn't changed, the install is a fast no-op (~2-3 s) — acceptable overhead for the safety guarantee.

---

## [2.4.0] - 2026-04-26

### Added
- **Radar analysis paragraph in the AI weather summary** — the existing summary now ends with a third paragraph starting with `Analyse radar :` (in the user's language) that describes where precipitation is right now relative to the user, whether it is approaching, and an estimated arrival time when a band is moving toward them. Powered by a new server module that samples the RainViewer radar at 32 points around the location (8 directions × 4 distances of 5/15/30/45 km) at 3 timestamps (now, -15 min, -45 min). The compact textual grid is fed to Claude alongside the existing weather data, so the model reasons about movement on its own. Activated automatically when an Anthropic API key is configured; falls back gracefully to the previous two-paragraph format when RainViewer is unreachable.
- **45 km radar-analysis circle on the map** — a thin dashed circle centred on `mapGeo` shows the area covered by the analysis. Real-world radius (Leaflet `Circle`), so it scales correctly with zoom. Visible only when the AI summary feature is configured. Clicking elsewhere on the map relocates both the analysis and the circle in sync.

### Internal
- New dependency: `pngjs` (pure JS PNG decoder) — used server-side to read RainViewer tile pixels for the radar sampling.
- The `aiSummaryAvailable` flag was hoisted from `AiSummary`'s local state to `AppContext`, so other components (notably `WeatherMap`) can react to feature availability.

---

## [2.3.2] - 2026-04-26

### Fixed
- **Sense HAT — midday-sun-at-midnight after a server restart** — when `pi-weather-server` was restarted (manually or as part of an in-app update), systemd cascaded the restart to `pi-sensehat`, which raced against the HTTPS server coming up. The first `/api/sensehat` fetch failed, the Python script fell back to its default state with no `sunriseTs`/`sunsetTs`, and `_compute_sun_pos` returned the noon position (row 1, col 3) — so a midday-sun frame was rendered regardless of the real time of day. The script now retries the initial fetch with exponential backoff (8 attempts, ~120 s worst case) and keeps the display blank until at least one fetch succeeds, instead of rendering a misleading scene.

---

## [2.3.1] - 2026-04-25

### Fixed
- **Empty "update available" modal** — when the only commits between your local copy and the latest GitHub master were of types other than `feat` or `fix` (e.g. `docs:`, `chore:`, `refactor:`), the update checker still flagged an update as available, opening the update modal with an empty "What's new" section. Worse, hitting **Skip this version** in that empty modal silenced the next genuine `feat`/`fix` update too. The checker now requires at least one user-visible commit (`feat` or `fix`) in the diff before flagging the update as available, so the modal no longer appears with empty release notes.

---

## [2.3.0] - 2026-04-23

### Added
- **Animated sun arc** — the 2×2 sun block on the Sense HAT now follows a realistic path throughout the day: rises from the east (bottom-left), climbs to the zenith at solar noon (top-centre), and sets in the west (bottom-right). Vertical position follows a sine arc; horizontal position drifts linearly east→west. East/west direction is configurable via `SUN_EAST_LEFT` in the script.
- **Sun colour shift** — sun pixels interpolate from yellow (255, 200, 0) at noon to orange (~237, 130, 0) at mid-morning/afternoon to red (220, 60, 0) near the horizon, and reverse symmetrically at sunrise.
- **Dynamic horizon glow** — the 4 red sunset pixels appear only when the sun is in the lower third of the display (`sun_row ≥ 4`) and follow the sun's horizontal position; they fade away as the sun climbs higher so the glow is never visible at midday.
- **Direct framebuffer write** — `_render()` now writes raw RGB565 bytes directly to `/dev/fb0` or `/dev/fb1`, bypassing the `sense_hat` library's differential pixel cache which caused colour bleed-through between states. Falls back to `set_pixels()` if the framebuffer cannot be opened.
- **Framebuffer device detection** — `_find_sensehat_fb()` locates the Sense HAT framebuffer via sysfs name/driver before falling back to `/dev/fb1` then `/dev/fb0`.
- **Static state optimisation** — non-animated states (clear, overcast, fog, etc.) are only redrawn when state, day/night flag, or sun position changes, eliminating unnecessary I2C writes and the resulting stroboscopic effect.

### Changed
- Test mode (`--test`) now animates the full east→west sun arc over each 15-second clear/sunset state so the colour shift and movement can be verified without waiting for real conditions.
- Ice pellets visual differentiated from snow: bright cyan (80, 200, 255) 2-pixel-wide drops on a dark background, falling faster (period 8 vs 10), vs snow's single-pixel near-white flakes on a grey background.

---

## [2.2.8] - 2026-04-23

### Added
- **Sense HAT display** (`tools/sensehat_weather.py`) — Python script for Raspberry Pi with Sense HAT 8×8 RGB LED matrix. Displays animated weather states: clear day/night, partly cloudy day/night, overcast, fog, light rain, rain, snow, ice pellets, and thunderstorm. Brightness is automatically reduced at night. Polls `/api/sensehat` every 10 minutes; animates at ~8 fps between polls.
- **`GET /api/sensehat`** — new server endpoint returning a lightweight JSON payload (`weatherCode`, `precipitationType`, `cloudCover`, `temperature`, `isDay`) for the display script. Reads the configured location from `settings.json`, pulls current weather from the shared server-side cache (no extra Tomorrow.io quota), and computes day/night from sunrise-sunset.org (1-hour in-process cache).
- **`deploy/pi-sensehat.service`** — systemd user service file for the Sense HAT display script. Starts after `pi-weather-server.service`; auto-restarts on failure.

---

## [2.2.7] - 2026-04-23

### Changed
- Debug panel "SYSTEMD" row now shows **LAUNCHD** on macOS: the server detects the init manager at runtime (`INVOCATION_ID` → systemd, `darwin` platform → launchd, otherwise null for manual `npm start`) and displays the label and enabled/disabled state accordingly.
- `install.sh` updated with full macOS support: platform detection via `uname`, Node.js via Homebrew, launchd agent configured automatically via Python `plistlib` (sets `WorkingDirectory`, log paths, `NODE_ENV`, `ALLOW_REMOTE`, `DEBUG`), remote IP via `ipconfig getifaddr`, kiosk/logrotate/start-server steps skipped on macOS.

---

## [2.2.6] - 2026-04-23

### Added
- macOS launchd user agent (`deploy/com.pi-weather-station.plist`) — equivalent of the systemd service file for Linux/Pi. Supports `NODE_ENV=production`, `KeepAlive`, `RunAtLoad`, and optional `ALLOW_REMOTE`/`DEBUG` variables. Documents `launchctl bootstrap`/`bootout` (macOS 10.10+) to avoid the deprecated `load`/`unload` commands.

### Changed
- README platform table updated: macOS now listed with launchd auto-start support.
- `CLAUDE.md` updated to reflect multi-platform deployment (systemd on Linux, launchd on macOS).

---

## [2.2.5] - 2026-04-23

### Changed
- AI Summary expansion now fills the entire panel: after the forecast charts collapse, the panel scrolls down so the AI text occupies the full viewport. Closing the summary smooth-scrolls back to the top.

### Fixed
- Partial `CurrentWeather` fragment (condition label + humidity icon) was visible at the top of the panel during AI Summary expansion; `CurrentWeather` is now hidden with `display: none` while the summary is expanded.
- Scroll direction corrected: the panel now scrolls **down** (not up) to bring the AI text to the top of the viewport after charts collapse. The previous approach of resetting `scrollTop` to 0 left `LocationName` and `CurrentWeather` visible above the AI text.

---

## [2.2.4] - 2026-04-22

### Added
- **UpdateModal** — clicking the update badge in the control bar now opens a modal with release notes, commit list, and a skip-version option; replaces the previous tooltip.
- **Force update check** in the debug panel — clears the 1-hour GitHub cache and fetches the latest release immediately; also accessible via `GET /api/update-check/force` from a browser on localhost.
- **Temperature unit labels** (°F / °C / °K) displayed alongside the current temperature in `CurrentWeather`.
- **Hide radar legend** toggle in Settings.

### Fixed
- Debug panel was silently empty: `setUpdateAvailable` and `setLatestVersion` were not exported from `AppContext`, causing the debug data fetch to fail silently on state update.
- Debug panel button row overflowed on the Pi touchscreen; now wraps with `flex-wrap`.
- Settings bottom buttons overflowed on small screens; Save button is now part of the same `flex-wrap` row as the other toggles, preventing it from appearing alone on a third row.
- AI Summary expansion scrolls the info panel so `LocationName` is in view (initial fix, refined in 2.2.5).

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
