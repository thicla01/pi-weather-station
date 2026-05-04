# Pi Weather Station — API Reference

*Current as of v2.6.3.*

All endpoints are served by the Express server on port **8443 (HTTPS)** or **8080 (HTTP)** as a fallback. Endpoints prefixed with `/api/` are subject to rate limiting unless noted otherwise.

**Rate limits (per client IP):**
- Weather, geocoding, summary, indoor-temperature, sensehat, update-check: **120 req / min**
- Map tiles: **600 req / min**

**Access levels:**
- 🌐 **Public** — accessible from any client (localhost and remote when `ALLOW_REMOTE=true`)
- 🔒 **Localhost only** — always restricted to the Pi itself (`127.0.0.1` / `::1`), regardless of `ALLOW_REMOTE`

---

## Settings

### `GET /settings`
Returns the current settings.

- **Access:** 🌐 Public
- **Response (localhost):** full settings object including API key values and the entire `indoorTemperature` block
- **Response (remote):** API key fields replaced by booleans (`true` if configured, `false` otherwise); `indoorTemperature` block stripped entirely (it contains a Homebridge password)

```json
// localhost
{
  "weatherApiKey": "abc123",
  "mapApiKey": "xyz",
  "indoorTemperature": {
    "enabled": true,
    "homebridgeUrl": "http://192.168.x.y:8581",
    "username": "admin",
    "password": "...",
    "sensorName": "Purificateur bureau"
  },
  ...
}

// remote
{ "weatherApiKey": true, "mapApiKey": false, ... }
// (no indoorTemperature key)
```

---

### `POST /settings`
Creates or overwrites `settings.json` with the provided body.

- **Access:** 🔒 Localhost only
- **Body:** JSON object with any subset of known keys (unknown keys are stripped)
- **Whitelisted top-level keys:** `weatherApiKey`, `mapApiKey`, `reverseGeoApiKey`, `anthropicApiKey`, `startingLat`, `startingLon`, `indoorTemperature`, `advanced`
- **`advanced` sub-object** — opaque, grouped by feature area:
  - `advanced.ai.radarAnalysisEnabled` (boolean) — controls whether the AI summary's third paragraph (`Radar analysis: …`) is generated and the analysis circles render on the map. Defaults to `true`. When `false`, the analyzer is short-circuited server-side and no circles are drawn client-side.
  - `advanced.ai.extendedRadius` (boolean) — when `true`, the analyzer also samples the outer ring (32 directions × 10 distances every 5 km / 3 mi from 55–100 km or 33–60 mi) on top of the default inner ring (16 directions × 10 distances every 5 km / 3 mi from 5–50 km or 3–30 mi). The map shows a second outer dashed circle. Defaults to `false`. (`doubleOuterPoints` is no longer a setting — outer is always sampled at the dense 32-direction grid when extendedRadius is on.)
  - `advanced.ai.showSamplingPoints` (boolean) — purely client-side rendering flag. When `true`, `WeatherMap` overlays a small dot at every (direction, distance) the analyzer reads. Defaults to `false`.
  - `advanced.display.lightModeStyle` (string) — Mapbox basemap style used when the app is in light mode. One of `light-v10`, `light-v11`, `streets-v12`. Defaults to `streets-v12` (better label and radar contrast than the paler `light-*` styles). The InfoPanel, panel-toggle button and radar legend backgrounds tint to match the chosen style.
  - `advanced.display.darkModeStyle` (string) — Mapbox basemap style used in dark mode. One of `dark-v10` (default — classic Mapbox dark, higher contrast) or `dark-v11` (modern variant with a flatter palette). The dark grey panel background is identical for both options.
  - `advanced.display.radarOpacityLight` (number, 0.05–1.0) — opacity of the RainViewer radar layer over the light-mode basemap. Defaults to `0.7`. Lower values let the basemap show through; higher values make rain bands stand out.
  - `advanced.display.radarOpacityDark` (number, 0.05–1.0) — same control for dark mode. Defaults to `0.3` (lower because the dark basemap makes radar colours pop naturally — too high and they look saturated).

---

### `PUT /settings`
Replaces `settings.json` entirely.

- **Access:** 🔒 Localhost only
- **Body:** full settings JSON object — same whitelist as `POST /settings`

---

### `PATCH /setting`
Updates a single key in `settings.json`.

- **Access:** 🔒 Localhost only
- **Body:** `{ "key": "<name>", "value": "<value>" }`
- **Errors:** HTTP 400 if the key is not in the whitelist

---

### `DELETE /setting`
Removes a single key from `settings.json`.

- **Access:** 🔒 Localhost only
- **Body:** `{ "key": "<name>" }`

---

## Geolocation

### `GET /geolocation`
Returns the device's approximate location based on its public IP address (via ipapi.co). Used as the default map center when no custom coordinates are configured.

The result is cached on disk (`server/geolocation-cache.json`, 30-day TTL). At cold boot, fresh fetches use retry-with-backoff (5 attempts, ~31 s worst case). If all retries fail but a stale cache exists, the cached value is returned rather than 500.

- **Access:** 🌐 Public
- **Response:** `{ "latitude": 45.5, "longitude": -73.6 }`

---

## Weather

All weather endpoints proxy Tomorrow.io and share a server-side cache.

| Endpoint | Cache TTL |
|---|---|
| `/api/weather/current` | 15 minutes |
| `/api/weather/hourly` | 30 minutes |
| `/api/weather/daily` | 6 hours |

### `GET /api/weather/current`
### `GET /api/weather/hourly`
### `GET /api/weather/daily`

- **Access:** 🌐 Public — rate limited (120 req/min)
- **Query params:**

| Parameter | Type | Required | Description |
|---|---|:---:|---|
| `lat` | float | ✅ | Latitude (-90 to 90) |
| `lon` | float | ✅ | Longitude (-180 to 180) |

- **Response:** Tomorrow.io timeline JSON, cached and forwarded as-is

---

## Map tiles

### `GET /api/tiles/:style/:z/:x/:y`
Proxies Mapbox raster tiles.

- **Access:** 🌐 Public — rate limited (600 req/min)
- **Path params:**

| Parameter | Values | Description |
|---|---|---|
| `style` | `dark-v10`, `dark-v11`, `light-v10`, `light-v11`, `streets-v12`, `navigation-day-v1`, or any defined custom style | Mapbox style |
| `z` | integer | Zoom level |
| `x` | integer | Tile X coordinate |
| `y` | integer | Tile Y coordinate |

- **Errors:** HTTP 400 if `style` is not in the allowed list

---

## Geocoding

### `GET /api/reverse-geocode`
Returns a human-readable location name for the given coordinates (via LocationIQ).

- **Access:** 🌐 Public — rate limited (120 req/min)
- **Query params:**

| Parameter | Type | Required | Description |
|---|---|:---:|---|
| `lat` | float | ✅ | Latitude |
| `lon` | float | ✅ | Longitude |

- **Response:** LocationIQ reverse geocoding JSON

---

## Sunrise / Sunset

### `GET /api/sunrise-sunset`
Returns sunrise and sunset times for the given coordinates (via sunrise-sunset.org).

- **Access:** 🌐 Public — rate limited (120 req/min)
- **Query params:**

| Parameter | Type | Required | Description |
|---|---|:---:|---|
| `lat` | float | ✅ | Latitude |
| `lon` | float | ✅ | Longitude |

- **Response:** sunrise-sunset.org JSON

---

## AI Weather Summary

### `GET /api/weather-summary`
Returns an AI-generated weather summary powered by Claude Haiku (Anthropic). Returns HTTP 503 if no Anthropic API key is configured — the client silently hides the feature in that case.

The response can be 1, 2, or 3 paragraphs depending on what data is available:

1. **Current conditions** (always)
2. **Period preview** when timestamp params are present and the matching cache (hourly/daily) is hot — evening preview (18h–21h) in the morning/afternoon, overnight preview (21h–5h) in the evening, next-day preview at night
3. **Radar analysis** (since v2.4.0) when the radar analyzer can sample tiles successfully — starts with the localised label `Analyse radar : ...` and describes where precipitation is, whether it is approaching, and an estimated arrival time. Sampling geometry depends on `distanceUnit` and `advanced.ai.extendedRadius`:
   - **Default (inner ring only):** 161 points = 1 centre point on the user's exact location (labelled `C` in the prompt grid) + 16 directions (every 22.5°: N, NNE, NE, ENE, …, NNW) × 10 distances. Distances are `5/10/15/.../50 km` when `distanceUnit=km` (inner circle 50 km) and `3/6/9/.../30 mi` when `distanceUnit=mi` (inner circle 30 mi). The centre sample catches small cells sitting right on the marker — too narrow to extend out to the closest 5 km / 3 mi probes.
   - **`extendedRadius: true`:** adds an outer ring of 32 directions (every 11.25°) × 10 distances every 5 km / 3 mi from 55–100 km / 33–60 mi → 481 points total. The map shows a second dashed circle (100 km or 60 mi) in addition to the inner one. Where outer bearings match the 16 inner cardinals, both ring's samples merge into one direction block in the prompt — denser radial profile per direction makes movement easier for Claude to reason about. The 16 in-between outer bearings are labelled by their value (e.g. `11.25`, `33.75`).
   Each point is read at 3 timestamps (now, -15 min, -45 min) on RainViewer raster tiles, decoded server-side via `pngjs` (3×3 max-pooled per probe to absorb anti-aliasing edges), and fed to Claude as a compact textual grid. Set `advanced.ai.radarAnalysisEnabled: false` to skip this paragraph entirely (and the matching circles on the map).

Summaries are cached 15 minutes server-side, keyed by `lat:lon:lang:period:tempUnit:speedUnit:distanceUnit` so toggling user-facing units never returns a stale snapshot in the wrong unit system.

- **Access:** 🌐 Public — rate limited (120 req/min)
- **Query params:**

| Parameter | Type | Required | Description |
|---|---|:---:|---|
| `lat` | float | ✅ | Latitude |
| `lon` | float | ✅ | Longitude |
| `lang` | string | | Language: `en` (default), `fr`, `es` |
| `localHour` | integer | | Client's current hour (0–23), used to select forecast window |
| `ts18` | integer | | Unix timestamp (ms) for 18:00 local time today |
| `ts21` | integer | | Unix timestamp (ms) for 21:00 local time today |
| `ts05tomorrow` | integer | | Unix timestamp (ms) for 05:00 local time tomorrow |
| `tempUnit` | string | | `c` (default), `f`, or `k`. The summary's temperatures and the matching unit symbol follow this preference — passing `f` produces "53°F" instead of the default "12°C". |
| `speedUnit` | string | | `kmh` (default), `ms`, or `mph`. Drives wind-speed unit. |
| `distanceUnit` | string | | `km` (default) or `mi`. Drives the radar-analysis distance unit, the sampled distances, and the dashed circle radii on the map. Older clients that omit this param fall back to inferring from `speedUnit` (`mph` → mi, otherwise km). |

- **Response:** `{ "summary": "..." }` — paragraphs separated by blank lines
- **Errors:** HTTP 503 if Anthropic key not configured

### `GET /api/radar-risk`
Returns the current "right now" radar-risk level for the inner and (optionally) outer dashed circles around the user. Drives the colour of those circles in the WeatherMap component, on top of the underlying RainViewer tile layer. Worst-case approach: each ring's level reflects the highest precipitation intensity sampled on that ring, mapped via the table below.

| RainViewer intensity | Level | Hex |
|---:|---|---|
| 0 (no echoes)            | `calm`   | (theme-default neutral) |
| 1–3 (very light → moderate) | `yellow` | `#f0e600` |
| 4 (heavy)                | `orange` | `#f08200` |
| 5–6 (very heavy / extreme)| `red`    | `#e60000` |

The outer ring is sampled only when `advanced.ai.extendedRadius` is `true` (server-side gate, matches the AI summary). Result is cached server-side for 5 minutes per location, so polling at the 5-minute interval the client uses costs at most one full sample per location per cycle. The underlying tile cache (12 minutes per RainViewer tile PNG) is shared with the AI summary's analyzer, so most polls only hit cache.

- **Access:** 🌐 Public — rate limited (120 req/min)
- **Query params:**

| Parameter | Type | Required | Description |
|---|---|:---:|---|
| `lat` | float | ✅ | Latitude |
| `lon` | float | ✅ | Longitude |
| `distanceUnit` | string | | `km` (default) or `mi` — selects which sampling geometry to use, so the rings the client draws and the points the server samples stay aligned. |

- **Response:**

```json
{
  "inner": { "level": "yellow", "maxIntensity": 2 },
  "outer": { "level": "red",    "maxIntensity": 5 },
  "timestamp": 1777110561
}
```

| Field | Type | Description |
|---|---|---|
| `inner.level` | string | `calm` \| `yellow` \| `orange` \| `red` — already includes the trend bump (one notch up from `maxIntensity` when `trend === "approaching"`) |
| `inner.maxIntensity` | integer | Worst-case RainViewer intensity (0–6) sampled on the inner ring |
| `inner.trend` | string | `approaching` \| `stable` — `approaching` means a band on at least one direction has shifted inward by ≥5 km / ≥3 mi over the last 45 min AND its projected arrival at the centre is under 30 min. Computed from the same 3-frame sequence the AI summary uses. |
| `inner.samples` | array | Per-point intensities: `[{ direction, distance, intensity }, ...]` — for the inner ring, direction is `C` for the centre + the 16 cardinals (`N`/`NNE`/`NE`/`ENE`/.../`NNW`); for the outer ring (when present), the same 16 cardinal names where bearings match plus 16 in-between bearings labelled by their value (`11.25`, `33.75`, …, `348.75`). Distance is in the user's unit. Always from the latest frame (trend uses older frames internally but doesn't expose them). Used by the WeatherMap to colour individual sampling-point dots when that overlay is on. |
| `outer` | object \| null | Same shape as `inner` (level + maxIntensity + trend + samples), or `null` when `extendedRadius` is off |
| `timestamp` | integer | Unix timestamp (seconds) of the latest RainViewer frame the result is computed from |

- **Errors:** HTTP 503 when RainViewer is unreachable or returns no recent frames

---

## Air Quality

### `GET /api/air-quality`
Returns the AQHI (Air Quality Health Index / Cote air santé) for the nearest active Environment Canada station to a given lat/lon. Free, no API key, official Canadian source — fills the gap left by Tomorrow.io's `epaIndex`, which requires the paid Air Quality data layer. The client `<UvAqiBadges>` component prefers this source when available and falls back to Tomorrow.io's `epaIndex` (when configured) outside Canadian coverage.

Defunct stations (the closest by lat/lon may be inactive — Montreal's "EHHUN" station, for example, is in the published list but returns zero current observations) are skipped automatically: the controller walks the six nearest stations within 300 km and uses the first one that has either a recent observation or a forecast value. For each candidate, the controller queries `aqhi-observations-realtime` first; if that returns nothing (Quebec province's stations currently publish forecasts but no observations), it falls back to `aqhi-forecasts-realtime` and picks the forecast row whose `forecast_datetime` is the latest hour ≤ now. Forecast values are official Health Canada AQHI for the hour in question — predicted rather than measured, but still authoritative — and the response carries a `kind` field so callers can distinguish.

- **Access:** 🌐 Public — rate limited (120 req/min)
- **Caching:** station list cached 24 h; per-station observations cached 20 min (ECCC publishes hourly so anything finer just adds load with no fresher data).
- **Query params:**

| Parameter | Type | Required | Description |
|---|---|:---:|---|
| `lat` | float | ✅ | Latitude |
| `lon` | float | ✅ | Longitude |

- **Response (when an active station is within 300 km):**

```json
{
  "available": true,
  "value": 2,
  "category": "low",
  "source": "ECCC",
  "kind": "forecast",
  "stationName": "Quebec",
  "stationDistanceKm": 1
}
```

| Field | Type | Description |
|---|---|---|
| `value` | number | AQHI value, 1–10+ (Health Canada scale) |
| `category` | string | `low` (1-3) \| `moderate` (4-6) \| `high` (7-10) \| `veryHigh` (>10) |
| `source` | string | Always `"ECCC"` for now — the field is there so the client can render a different label/tooltip if more sources are added later (NWS AirNow, MeteoAlarm, etc.) |
| `kind` | string | `"observation"` (live measurement from `aqhi-observations-realtime`) \| `"forecast"` (Health Canada forecast bulletin from `aqhi-forecasts-realtime`, used as fallback when the station has no current observation) |
| `stationName` | string | English name of the station the AQHI was read from |
| `stationDistanceKm` | integer | Great-circle distance from the requested point, rounded to the nearest km |

- **Response (out of coverage / no active station):** `{ "available": false, "reason": "..." }` where `reason` is one of `stations` (couldn't reach the upstream stations endpoint), `out-of-range` (no station within 300 km), `no-data` (6 nearest candidates all returned empty for both observations and forecasts — most of them are likely defunct).

---

## Sense HAT Display

### `GET /api/sensehat`
Lightweight aggregated weather state intended for the Sense HAT 8×8 LED matrix display script (`tools/sensehat_weather.py`). Pulls current weather from the shared server-side cache (no extra Tomorrow.io quota) and computes day/night and sun position from sunrise/sunset.org (1-hour in-process cache).

When no location is configured in `settings.json` (`startingLat` / `startingLon`), falls back to `ipapi.co` for IP-based geolocation (cached 1 hour).

- **Access:** 🌐 Public — rate limited (120 req/min)
- **Query params:** none (location read from `settings.json` or ipapi fallback)
- **Response:**

```json
{
  "weatherCode":       1101,
  "precipitationType": 0,
  "cloudCover":        45,
  "temperature":       14.2,
  "isDay":             true,
  "sunriseTs":         1777110561000,
  "sunsetTs":          1777161287000
}
```

| Field | Type | Description |
|---|---|---|
| `weatherCode` | integer \| null | Tomorrow.io weather code (1000 = clear, 4001 = rain, 5000 = snow, 8000 = storm, …) |
| `precipitationType` | integer | 0 = none, 1 = rain, 2 = snow, 3 = freezing rain, 4 = ice pellets |
| `cloudCover` | integer | 0–100 % |
| `temperature` | float \| null | °C |
| `isDay` | boolean | `true` between sunrise and sunset (hour-based fallback if sunrise-sunset.org unavailable) |
| `sunriseTs` | integer \| null | Unix timestamp (ms) for today's sunrise — used by the Python script to position the sun on its arc |
| `sunsetTs` | integer \| null | Unix timestamp (ms) for today's sunset |

---

## Indoor Temperature

### `GET /api/indoor-temperature`
Returns the latest indoor temperature reading (and optionally humidity and HomeKit air-quality) for the configured Homebridge sensor. Polled server-side every 5 minutes; this endpoint just returns the cached result.

The feature is opt-in: it is activated only when `settings.json` contains an `indoorTemperature` block with `enabled: true`. Otherwise this endpoint returns 404 with `{ "enabled": false }` and the client component renders nothing.

See `docs/indoor-temperature.md` for setup details.

- **Access:** 🌐 Public — rate limited (120 req/min)
- **Query params:** none
- **Response (configured & data available):**

```json
{
  "enabled":     true,
  "value":       21.4,
  "humidity":    35,
  "airQuality":  1,
  "sensorName":  "Purificateur bureau",
  "lastUpdated": "2026-04-26T18:32:11.000Z",
  "isStale":     false
}
```

| Field | Type | Description |
|---|---|---|
| `enabled` | boolean | Always `true` here (this endpoint returns 404 when not configured) |
| `value` | float \| null | Temperature in °C; `null` until the first successful poll |
| `humidity` | float \| null | Relative humidity in %, when the sensor exposes it (Dyson does, Hue doesn't) |
| `airQuality` | integer \| null | HomeKit AirQuality 1..5 (1=Excellent..5=Poor); `null` when not exposed |
| `sensorName` | string | Echo of the configured `serviceName` |
| `lastUpdated` | string \| null | ISO 8601 of the last successful poll |
| `isStale` | boolean | `true` when the cached reading is older than 30 min |

- **Response (not configured):** HTTP 404 `{ "enabled": false }`

---

## Update

### `GET /api/update-check`
Checks GitHub for a newer release. Cached 1 hour to stay within GitHub's unauthenticated rate limit (60 req/h).

- **Access:** 🌐 Public — rate limited (120 req/min)
- **Response:**

```json
{
  "updateAvailable":     true,
  "latestVersion":       "2.6.3",
  "latestSha":           "34fc363",
  "localSha":            "94b35e4",
  "checkedAt":           "2026-04-27T10:15:00.000Z",
  "commits": [
    { "type": "feat", "message": "promote indoor temperature out of experimental" },
    { "type": "fix",  "message": "render AM/PM suffix at digital-clock proportions" }
  ],
  "serviceFileChanged":  false,
  "needsManualUpgrade":  false,
  "platform":            "linux",
  "isSystemd":           true
}
```

| Field | Type | Description |
|---|---|---|
| `updateAvailable` | boolean | True only when remote head differs from local AND at least one feat/fix commit is in the diff (silent for docs-only releases) |
| `latestVersion` | string \| null | Semver from `package.json` on master |
| `latestSha` / `localSha` | string \| null | Short SHAs |
| `commits` | array | feat/fix commits in the diff, most recent first |
| `serviceFileChanged` | boolean \| null | True when `deploy/pi-weather-server.service` differs from the installed copy — the modal disables one-click and shows a `cp + daemon-reload` recipe. Null on non-systemd platforms or when the comparison can't be made |
| `needsManualUpgrade` | boolean \| null | True when the local SHA is older than the v2.4.1 commit that added `npm install` to `/api/update` — the modal disables one-click and points the user at `bash deploy/install.sh` |
| `platform` | string | `process.platform` |
| `isSystemd` | boolean | `true` when the server is running under systemd (presence of `INVOCATION_ID`) |

---

### `GET /api/update-check/force`
### `POST /api/update-check/force`
Same response shape as `GET /api/update-check`, but clears the 1-hour cache first so the next answer comes from a fresh GitHub round-trip. Available on any HTTP method (`app.all`).

- **Access:** 🔒 Localhost only

---

### `POST /api/update`
Pulls the latest code, installs new dependencies, and restarts the service.

- **Access:** 🔒 Localhost only
- **Pre-flight checks** — return HTTP 409 with `{ error, reason, message, ...details }` when any precondition fails. The modal renders `message` directly to the user:

| `reason` | When |
|---|---|
| `detached-head` | `git symbolic-ref --short HEAD` failed (working copy at a specific SHA, not on a branch) |
| `wrong-branch` | Current branch isn't `master` (`currentBranch` field returned for context) |
| `local-changes` | `git status --porcelain` reported uncommitted changes (`dirtyFiles` field returned for context) |
| `git-status-failed` | git itself errored unexpectedly |

- **Successful flow** — when pre-flight passes, runs `git pull --ff-only`, then `npm install --omit=dev --no-audit --no-fund`, then schedules a service restart. Errors during the pull or install return HTTP 500 with `{ error, reason: "pull-failed" | "npm-install-failed", message: "..." }`.

- **Success response:** `{ "ok": true, "isSystemd": true }`

---

## Diagnostics

### `GET /api/is-local`
Indicates whether the request originates from localhost. Used by the client to decide which UI features to show (settings writes, debug button).

- **Access:** 🌐 Public
- **Response (remote):** `{ "isLocal": false, "securityEnabled": true }`
- **Response (localhost):** `{ "isLocal": true, "securityEnabled": true, "debugEnabled": false }`

---

### `GET /api/debug`
Returns full server diagnostics for the debug panel.

- **Access:** 🔒 Localhost only — also requires `DEBUG=true` server-side for the button to appear in the UI (the endpoint itself is always restricted regardless)
- **Response:** large JSON object containing system info, KPIs, provider status, cache state, quota counters, service call history, security events, and recent log lines. The `serverKpis.cpuTempC` field holds the CPU temperature in degrees Celsius (read from `/sys/class/thermal/thermal_zone0/temp`); `null` on platforms that don't expose the file. The `serverKpis.fanRpm` field holds the fan speed in raw RPM (read from the first `/sys/class/hwmon/*/fan*_input` found — covers Pi 5 with the official Active Cooler, Pi 4 with PWM-fan overlays, and laptop x86 fans on Linux); `null` on hosts with no fan sensor exposed.

---

### `GET /api/debug/cpu-temp`
Lightweight endpoint polled by the debug panel every 5 s while open, for live CPU-temperature updates without re-fetching the full debug payload.

- **Access:** 🔒 Localhost only
- **Response:** `{ "cpuTempC": <number | null> }`

---

### `GET /api/debug/fan-speed`
Lightweight endpoint polled by the debug panel every 5 s while open, alongside `cpu-temp`. Auto-detects the first `/sys/class/hwmon/*/fan*_input` exposed on the host (path cached after first scan — sysfs paths don't move at runtime). The client uses `available` to decide whether to render the FAN SPEED row at all (hidden on macOS, x86 without an exposed fan, and Pis without an Active Cooler).

- **Access:** 🔒 Localhost only
- **Response:** `{ "available": false }` when no fan sensor is exposed, otherwise `{ "available": true, "rpm": <number | null> }` (a value of `0` is valid — CPU cool, fan stopped — and is distinct from `null`, which means the file existed at detection time but became unreadable since).

---

### `GET /api/brightness`
Reports the current screen-brightness state. The client uses this on mount to decide whether to render the brightness slider in Advanced settings (hidden when `available: false`) and to initialize the slider value.

- **Access:** Open (read is harmless and the client needs it before rendering even on remote, where the slider stays hidden anyway)
- **Response when supported:** `{ "available": true, "percent": <0-100>, "raw": <int>, "max": <int>, "devicePath": "/sys/class/backlight/...", "minPercent": 10 }`
- **Response when not supported** (no kernel backlight, e.g. HDMI monitor, missing dtoverlay, macOS): `{ "available": false }`

---

### `POST /api/brightness`
Sets the screen brightness in percent (0–100). Floors at `minPercent` (10%) to prevent accidental black screens.

- **Access:** 🔒 Localhost only — brightness physically affects the device's screen, no value changing it from a remote client
- **Body:** `{ "percent": <number> }`
- **Response on success:** `{ "ok": true, "percent": <clamped>, "raw": <int>, "max": <int> }`
- **Errors:**
  - `400` — `{ error: "Body must be { percent: <number> }" }` or `invalid-percent`
  - `403` — `{ error: "no-write-permission" }` (udev rule missing — install.sh adds it under `/etc/udev/rules.d/52-pi-weather-station-backlight.rules`)
  - `503` — `{ error: "no-device" }` (no `/sys/class/backlight/*` exposed; usually means the kernel `dtoverlay=rpi-backlight` line is missing from `/boot/firmware/config.txt`)
  - `500` — `{ error: "max-unreadable" }` or `write-failed`
