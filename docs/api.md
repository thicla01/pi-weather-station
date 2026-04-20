# Pi Weather Station — API Reference

All endpoints are served by the Express server on port **8443 (HTTPS)** or **8080 (HTTP)** as a fallback. Endpoints prefixed with `/api/` are subject to rate limiting unless noted otherwise.

**Rate limits (per client IP):**
- Weather, geocoding, summary: **120 req / min**
- Map tiles: **600 req / min**

**Access levels:**
- 🌐 **Public** — accessible from any client (localhost and remote when `ALLOW_REMOTE=true`)
- 🔒 **Localhost only** — always restricted to the Pi itself (`127.0.0.1` / `::1`), regardless of `ALLOW_REMOTE`

---

## Settings

### `GET /settings`
Returns the current settings.

- **Access:** 🌐 Public
- **Response (localhost):** full settings object including API key values
- **Response (remote):** same object with API key fields replaced by booleans (`true` if configured, `false` otherwise)

```json
// localhost
{ "weatherApiKey": "abc123", "mapApiKey": "xyz", ... }

// remote
{ "weatherApiKey": true, "mapApiKey": false, ... }
```

---

### `POST /settings`
Creates or overwrites `settings.json` with the provided body.

- **Access:** 🔒 Localhost only
- **Body:** JSON object with any subset of known keys (unknown keys are stripped)
- **Known keys:** `weatherApiKey`, `mapApiKey`, `reverseGeoApiKey`, `anthropicApiKey`, `startingLat`, `startingLon`

---

### `PUT /settings`
Replaces `settings.json` entirely.

- **Access:** 🔒 Localhost only
- **Body:** full settings JSON object

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
Returns the Pi's approximate location based on its public IP address (via ipapi.co). Used as the default map center when no custom coordinates are configured.

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
| `style` | `dark-v10`, `light-v10`, `light-v11`, `navigation-day-v1` | Mapbox style |
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

Summaries are cached 15 minutes server-side. The second paragraph adapts to the time of day: evening preview (18h–21h) in the morning/afternoon, overnight preview (21h–5h) in the evening, next-day preview at night.

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

- **Response:** `{ "summary": "Two-paragraph weather summary." }`
- **Errors:** HTTP 503 if Anthropic key not configured

---

## Update

### `GET /api/update-check`
Checks GitHub for a newer release (cached 1 hour).

- **Access:** 🌐 Public — rate limited (120 req/min)
- **Response:**

```json
{
  "updateAvailable": true,
  "latestVersion": "2.2.3",
  "currentVersion": "2.2.2",
  "platform": "linux",
  "isSystemd": true
}
```

---

### `POST /api/update`
Triggers a `git pull --ff-only` and restarts the service. The server process exits after responding; systemd restarts it automatically.

- **Access:** 🔒 Localhost only
- **Response:** `{ "ok": true, "isSystemd": true }`
- **Errors:** HTTP 500 with `{ "error": true, "message": "..." }` if `git pull` fails

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
- **Response:** large JSON object containing system info, KPIs, provider status, cache state, quota counters, service call history, security events, and recent log lines
