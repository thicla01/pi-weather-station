# Pi Weather Station — API Reference

*Current as of v2.16.5.*

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
- **Whitelisted top-level keys:** `weatherApiKey`, `mapApiKey`, `reverseGeoApiKey`, `anthropicApiKey`, `airNowApiKey`, `openAqApiKey`, `startingLat`, `startingLon`, `indoorTemperature`, `advanced`
- **`advanced` sub-object** — opaque, grouped by feature area:
  - `advanced.ai.radarAnalysisEnabled` (boolean) — controls whether the AI summary's third paragraph (`Radar analysis: …`) is generated and the analysis circles render on the map. Defaults to `true`. When `false`, the analyzer is short-circuited server-side and no circles are drawn client-side.
  - `advanced.ai.extendedRadius` (boolean) — when `true`, the analyzer also samples the outer ring (32 directions × 10 distances every 5 km / 3 mi from 55–100 km or 33–60 mi) on top of the default inner ring (16 directions × 10 distances every 5 km / 3 mi from 5–50 km or 3–30 mi). The map shows a second outer dashed circle. Defaults to `false`. (`doubleOuterPoints` is no longer a setting — outer is always sampled at the dense 32-direction grid when extendedRadius is on.)
  - `advanced.ai.showSamplingPoints` (boolean) — purely client-side rendering flag. When `true`, `WeatherMap` overlays a small dot at every (direction, distance) the analyzer reads. Defaults to `false`.
  - `advanced.ai.calmDayFastPath` (boolean) — when `true` (default), the server short-circuits the Claude call when **all four** of: (1) current weather code is benign (no 4xxx-8000 active precipitation), (2) current precipitation probability < 20 %, (3) period forecast's max precipitation probability < 20 %, (4) the radar snapshot reports no active precipitation in the surveyed annulus (50 km / 100 km). When all four hold, the server returns a three-paragraph localised template (current conditions + period forecast + radar "nothing to report") rendered from the same Tomorrow.io values + radar status that would otherwise have entered the prompt. Saves one full Anthropic call per cache window on calm days; Claude is still invoked the moment any of the gates trip — even if Tomorrow.io says calm but radar shows a band, we defer to Claude so the summary stays honest. Set to `false` to always invoke Claude regardless of conditions.
  - `advanced.display.lightModeStyle` (string) — Mapbox basemap style used when the app is in light mode. One of `light-v10`, `light-v11`, `streets-v12`. Defaults to `streets-v12` (better label and radar contrast than the paler `light-*` styles). The InfoPanel, panel-toggle button and radar legend backgrounds tint to match the chosen style.
  - `advanced.display.darkModeStyle` (string) — Mapbox basemap style used in dark mode. One of `dark-v10` (default — classic Mapbox dark, higher contrast) or `dark-v11` (modern variant with a flatter palette). The dark grey panel background is identical for both options.
  - `advanced.display.radarOpacityLight` (number, 0.05–1.0) — opacity of the RainViewer radar layer over the light-mode basemap. Defaults to `0.7`. Lower values let the basemap show through; higher values make rain bands stand out.
  - `advanced.display.radarOpacityDark` (number, 0.05–1.0) — same control for dark mode. Defaults to `0.3` (lower because the dark basemap makes radar colours pop naturally — too high and they look saturated).
  - `advanced.sleep.enabled` (boolean) — master toggle for the sleep-mode / screensaver feature. Defaults to `false` (existing installs see no change). When `true`, the idle hook attaches input listeners and arms the two-stage timer described below.
  - `advanced.sleep.stage1Delay` (number, minutes) — inactivity threshold before stage 1 (clock screensaver) appears. Defaults to `10`.
  - `advanced.sleep.stage1Brightness` (number, 10–100) — hardware brightness applied during stage 1. Defaults to `30`. Honoured only on devices with an exposed backlight (sysfs `/sys/class/backlight/*`); silently ignored otherwise.
  - `advanced.sleep.stage2Enabled` (boolean) — whether to ever transition into stage 2 (black screen with anti-burn-in dot). Defaults to `true` (so the default sleep flow walks all the way to the black-screen stage).
  - `advanced.sleep.stage2Delay` (number, minutes) — additional delay after stage 1 before stage 2 kicks in. Defaults to `20` (so total time-to-black at defaults is `stage1Delay + stage2Delay = 30` min). Stage 2 hardcodes a brightness write of `{ percent: 0, allowOff: true }` so the backlight goes fully off on panels that honour 0 (and to its hardware floor on panels that don't — no user knob in between, since the floor is hardware-bound regardless of the value written).
  - `advanced.sleep.nightMode` (boolean) — when dark mode is active, switches the screensaver palette from cream-on-anthracite to red-on-near-black. Defaults to `true` (long-wavelength red has minimal impact on melatonin, friendlier for a kiosk visible from a bedroom).

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

- **Response (200):** LocationIQ reverse geocoding JSON
- **Response (204 — No Content):** LocationIQ returned no address for the coord (ocean, undeveloped area). The client's `reverseGeocode` service resolves this to `null` and the caller falls back to displaying lat/lon. Pre-v2.16.5 this was a 500 — switched to 204 so devtools no longer logs it as an error on accidental ocean-clicks.

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
| `date` | string `YYYY-MM-DD` | ⬜ | Optional. Forwarded to the upstream API. The client passes its LOCAL date so the returned sunrise/sunset belong to the user's day. Without it the upstream defaults to "today UTC" — and for users west of UTC during evening hours that's already the next UTC day, which skips over today's local sunset and flips auto dark-mode early. Strict regex match server-side so junk values can't reach the upstream URL. |

- **Response:** sunrise-sunset.org JSON

---

## AI Weather Summary

> See [`docs/ai-summary.md`](ai-summary.md) for the end-to-end feature reference: how the prompt is assembled locally vs what runs at Anthropic, the five-layer cache cascade, the privacy posture, and the model-upgrade procedure. The endpoint surface below is just the HTTP contract.

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
| `inner.trend` | string | `approaching` \| `drifting` \| `leaving` \| `stable` — ring-level trend computed by intensity-weighted summarization of per-direction trends: the direction with the highest peak intensity in the latest frame dictates the ring's trend (the band that defines the tier also defines the trend). Per-direction `approaching` requires a band shifted inward by ≥5 km / ≥3 mi (inner) or ≥8 km / ≥5 mi (outer) over the 45-min window AND projected arrival under 60 min (widened from 30 in May 2026 after the Sorel false-leaving case). `drifting` is the same inward shift without the ETA gate clearing — added in May 2026 after the Stratford case where a moving system around an in-precipitation user collapsed back to "stable" with 0 % confidence (see CHANGELOG). |
| `inner.trendConfidence` | integer | 0–100 score of how strongly the data supports the trend label. For `approaching`/`leaving`: built from inward-shift magnitude (up to 60 pts at 2× threshold), monotonicity across the mid frame (up to 25 pts), and intensity persistence (up to 15 pts when both endpoints are ≥ light precip). For `stable`: inverse of evidence-for-movement (`(1 − min(1, |shift|/threshold)) × 100`), so a direction sitting well below threshold reads as "definitely stable" and a direction blocked only by the ETA gate reads as "barely stable". |
| `inner.samples` | array | Per-point intensities: `[{ direction, distance, intensity }, ...]` — for the inner ring, direction is `C` for the centre + the 16 cardinals (`N`/`NNE`/`NE`/`ENE`/.../`NNW`); for the outer ring (when present), the same 16 cardinal names where bearings match plus 16 in-between bearings labelled by their value (`11.25`, `33.75`, …, `348.75`). Distance is in the user's unit. Always from the latest frame (trend uses older frames internally but doesn't expose them). Used by the WeatherMap to colour individual sampling-point dots when that overlay is on. |
| `inner.directionVectors` | array | Per-direction vectors for the optional arrow overlay: `[{ direction, peakDistance, peakIntensity, magnitude, trend, confidence }, ...]`. Stable directions are filtered out server-side — drawing an arrow on a band that isn't moving would be visual noise. `peakDistance` (user's unit) anchors the arrow on the map; `magnitude` is the absolute inward shift over the trend window; `trend` is `approaching` or `leaving`; `confidence` 0–100 drives arrow opacity. The client computes the lat/lon position via the same `offsetLatLon` helper the dot overlay uses. |
| `outer` | object \| null | Same shape as `inner` (level + maxIntensity + trend + trendConfidence + bumped + samples + directionVectors), or `null` when `extendedRadius` is off |
| `timestamp` | integer | Unix timestamp (seconds) of the latest RainViewer frame the result is computed from |

- **Errors:** HTTP 503 when RainViewer is unreachable or returns no recent frames

---

## Air Quality

### `GET /api/air-quality`
Returns the geographically closest air-quality reading the upstream sources can produce, or `{ available: false }` when every source comes up empty. Free, no per-install API key required for the Canadian sources; AirNow and OpenAQ each need a free per-install key (`airNowApiKey` and `openAqApiKey` in `settings.json`) — without one configured, the corresponding source silently no-ops, so a Canadian-only install pays nothing for either. The client `<UvAqiBadges>` component renders whatever the orchestrator returns and falls back to Tomorrow.io's `epaIndex` (when configured) only when every government source comes up empty.

Sources:

- **MELCC RSQA Montréal** — Ville de Montréal real-time IQA CSV (`donnees.montreal.ca`, hourly ~50 min after the hour). Covers the island of Montreal. Source label `MELCC-Mtl`.
- **MELCC RSQAQ provincial** — Quebec MELCC ArcGIS FeatureServer (`services3.arcgis.com`, hourly real-time, `rsqaq-indice-de-la-qualite-de-l-air` on Données Québec). Covers all of Quebec except the island of Montreal (excluded by intergovernmental agreement; Montreal's network is published by the Mtl source above). Source label `MELCC-RSQAQ`.
- **EPA AirNow** — `airnowapi.org/aq/data/` (raw station endpoint, not the reporting-area endpoint). Covers the United States (continental + AK + HI + PR/VI). Free with a per-install API key, rate-limited at 500 calls/hour. Queried with a ~80 km bbox and a 3-hour lookback window; the response contains one record per station per pollutant per hour. The source groups records by station, keeps the latest reading per pollutant, picks the geographically closest station to the query point, then takes the worst-case AQI across that station's pollutants — EPA's official "current AQI" methodology. The raw-station endpoint is used instead of `/aq/observation/latLong/current/` because the reporting-area endpoint silently excludes plenty of valid stations whose "reporting area" is offline (e.g. Decatur, AL where the EPA reporting area returns empty but the DECATUR station 8 km away publishes hourly readings). Reported `kind` is `nowcast` — AirNow uses the NowCast 12-hour weighted average for PM2.5/PM10 and 1-hour averages for ozone, both of which are EPA's current-observation methodology rather than instantaneous spot values. Source label `AirNow`.
- **OpenAQ** — `api.openaq.org/v3/locations` + `/locations/{id}/latest`. Global coverage (~150 countries) — primarily fills the gap outside the US + Canada footprint. Free with a per-install API key. Aggregates only government monitoring stations (no community sensors), CC-BY-4.0 licence. Returns raw pollutant concentrations (no pre-computed AQI), so the source converts to EPA-canonical units and applies the official EPA AQI breakpoint formula per supported pollutant (PM2.5, PM10, O3, NO2, SO2, CO), then takes the worst-case sub-index across what the station reports. Reported `kind` is `observation`. Source label `OpenAQ`.
- **Environment Canada AQHI** — `api.weather.gc.ca` OGC Features API. Covers all of Canada. Prefers `aqhi-observations-realtime`; when empty (Quebec stations sometimes publish forecasts but no observations), falls back to `aqhi-forecasts-realtime` and picks the forecast row whose `forecast_datetime` is the latest hour ≤ now. The forecast value is official Health Canada AQHI for the hour in question — predicted rather than measured but still authoritative — and the response's `kind` field distinguishes the two. Source label `ECCC`.

Selection rule:

1. MELCC Montréal, MELCC RSQAQ, AirNow, and OpenAQ run in parallel (each is a single cached upstream fetch — OpenAQ is two but they're cached together). The hit with the smallest `stationDistanceKm` wins; ties broken by declaration order (MELCC-Mtl, MELCC-RSQAQ, AirNow, OpenAQ).
2. ECCC is sequenced **after**, only when none of the parallel sources returned a hit. ECCC's per-station walk for defunct stations (up to six) makes it expensive to run speculatively.

This "closest wins" rule replaces the earlier strict priority chain because the chain produced an effect-edge bug: Sainte-Victoire-de-Sorel sat right at the 50 km cap of the Montreal source and got tagged with a station 50 km away while the RSQAQ network had Saint-Joseph-de-Sorel at 8 km. Distance is the real measure of relevance, so the orchestrator now compares it across every cheap source. The same rule handles every border zone naturally — Plattsburgh NY picks AirNow at 5 km over MELCC at 30 km, Lacolle QC picks MELCC over AirNow, a kiosk just inside Mexico picks OpenAQ at 10 km over AirNow at 80 km across the border, and so on — without any explicit country gate.

For each ECCC candidate, defunct stations are skipped automatically: the controller walks the six nearest stations within 300 km and uses the first one that has either a recent observation or a forecast value.

- **Access:** 🌐 Public — rate limited (120 req/min)
- **Caching:** ECCC station list cached 24 h; ECCC per-station observations cached 20 min; MELCC RSQAQ dataset cached 20 min (whole province in one fetch); MELCC Montreal CSV cached 20 min (whole island in one fetch); AirNow per-coordinate response cached 30 min (AirNow updates hourly); OpenAQ per-coordinate location + measurements bundle cached 30 min. Every upstream publishes hourly so 20–30 min smooths repeats without serving stale data.
- **Query params:**

| Parameter | Type | Required | Description |
|---|---|:---:|---|
| `lat` | float | ✅ | Latitude |
| `lon` | float | ✅ | Longitude |

- **Response (when any source returns a reading):**

```json
{
  "available": true,
  "value": 28,
  "category": "moderate",
  "source": "MELCC-Mtl",
  "scale": "iqa",
  "kind": "observation",
  "stationName": "75 Ontario Est",
  "stationDistanceKm": 1,
  "observedAt": "2026-05-21T17:00:00Z"
}
```

| Field | Type | Description |
|---|---|---|
| `value` | number | Raw value in the source's native scale (AQHI 1–10+, IQA 1–100+, EPA AQI 0–500) |
| `category` | string | `low` \| `moderate` \| `high` \| `veryHigh` — pre-normalised by the source so the badge's colour mapping is scale-agnostic |
| `source` | string | `MELCC-Mtl` \| `MELCC-RSQAQ` \| `AirNow` \| `OpenAQ` \| `ECCC` — drives the badge tooltip's source label |
| `scale` | string | `aqhi` (Health Canada AQHI) \| `iqa` (Quebec MELCC IQA) \| `epa` (US EPA AQI, also used by OpenAQ since the source applies the EPA AQI formula to OpenAQ's raw concentrations) — drives badge label ("AQHI/CAS" vs "IQA" vs "AQI") and value formatting (1 decimal for AQHI, integer otherwise) |
| `kind` | string | `observation` (live measurement, used by MELCC + OpenAQ + ECCC observation path) \| `nowcast` (AirNow's 12 h weighted average / 1 h ozone) \| `forecast` (ECCC, used when the observation pipeline is empty) |
| `stationName` | string | Human-readable station name (or municipal address for the Montreal source, the AirNow `SiteName` for AirNow, the OpenAQ-published name for OpenAQ) |
| `stationDistanceKm` | integer | Great-circle distance from the requested point, rounded to the nearest km |
| `pollutant` | string | (AirNow + OpenAQ only) The pollutant that drove the worst-case AQI — `pm25`, `pm10`, `o3`, `no2`, `so2`, or `co`. Surfaced for the Debug panel; not displayed by the badge. |
| `observedAt` | string\|null | (AirNow + OpenAQ) ISO 8601 UTC timestamp of the measurement that won the worst-case AQI. Surfaced in the badge tooltip and the Debug panel as a human-readable "X ago" so the user can tell live readings from stale ones — AirNow's raw-station endpoint surfaces hourly station snapshots that can be 1-2 hours old (vs. the older reporting-area endpoint which silently dropped non-fresh stations), and OpenAQ's `/latest` doesn't enforce a freshness window at all, so a station may return its last reading from hours or days ago. Other sources will populate this field as the data becomes available upstream; clients should `&&`-guard the field rather than assume it's always present. |

Category cut-points per scale:

- AQHI (`scale: "aqhi"`): `low` 1-3, `moderate` 4-6, `high` 7-10, `veryHigh` >10.
- IQA (`scale: "iqa"`): `low` 1-25 (Bon), `moderate` 26-50 (Acceptable), `high` 51-100, `veryHigh` >100. The official MELCC categorisation is three tiers (Bon/Acceptable/Mauvais); the badge splits Mauvais at 100 to keep the four-tier vocabulary it shares with AQHI.
- EPA AQI (`scale: "epa"`): `low` 0-50 (Good), `moderate` 51-100 (Moderate), `high` 101-150 (Unhealthy for Sensitive Groups), `veryHigh` >150. EPA officially defines six tiers (USG / Unhealthy / Very Unhealthy / Hazardous past 150); we collapse the top three into `veryHigh` so the four-tier colour vocabulary stays consistent across sources. The 150 split is the same point at which EPA's own palette transitions from orange to red.

- **Response (no source had a reading):** `{ "available": false, "reason": "no-data" }`. Each source soft-fails internally and returns null; the orchestrator only emits `available: false` when every source has fallen through.

---

## Severe Weather Alerts

### `GET /api/weather-alerts`
Returns the active government severe-weather alerts at the requested point, merged from every regional source whose bounding box covers it. Alerts come straight from authoritative national feeds (NWS for the US, ECCC for Canada) — no curation or rewording on our side. The client `<AlertBanner>` uses these to outrank the radar-derived tier: a tornado warning beats "radar shows red".

Sources:

- **NWS (United States)** — `api.weather.gov/alerts/active?point=lat,lon`. Free, no API key, descriptive User-Agent required by policy. NWS does the spatial matching internally (zone- or polygon-based depending on the alert), so this endpoint just normalises the response. Out-of-bounds coordinates return HTTP 400 from NWS, which is treated as "no coverage" rather than an error.
- **ECCC (Canada)** — `api.weather.gc.ca/collections/weather-alerts/items` (the same pygeoapi instance that serves AQHI). The collection's `bbox` filter is non-functional on this instance (returns 0 features even when alerts intersect the box), so the strategy is to fetch all active Canadian alerts once (≤50 features, ~30-100 KB), cache the list server-side for 5 min, and run point-in-polygon locally per request. Bilingual EN/FR is built into every property (`alert_name_en` / `alert_name_fr`, etc.) and preserved through to the client.

The two sources run in parallel — each is cached, so the cost is negligible even at the US/Canada border where both fire. Failures are isolated: one source erroring out doesn't blank the other. The endpoint always returns 200 with an `alerts` array (possibly empty); the client never has to handle "out of coverage" specially.

- **Access:** 🌐 Public — rate limited (120 req/min)
- **Caching:** Per-source server cache 5 min. Response sets `Cache-Control: public, max-age=300` so a remote client polling at the recommended 10 min cadence sees consistent results.
- **Query params:**

| Parameter | Type | Required | Description |
|---|---|:---:|---|
| `lat` | float | ✅ | Latitude |
| `lon` | float | ✅ | Longitude |

- **Response:**

```json
{
  "alerts": [
    {
      "source": "ECCC",
      "id": "1809563531455007548202605030504_fea1-1052",
      "severity": "moderate",
      "tier": "orange",
      "eventType": "RFW",
      "title_en": "Rainfall warning",
      "title_fr": "Avertissement de pluie",
      "description_en": "What: an additional 5 to 10 millimetres of rain ...",
      "description_fr": "Quoi : pluie supplémentaire de 5 à 10 millimètres ...",
      "expiresAt": "2026-05-05T00:41:04.346Z",
      "areaDesc": "QC"
    }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `source` | string | `NWS` \| `ECCC` — drives the badge label on the banner |
| `id` | string\|null | Upstream alert identifier; useful for de-duplication if more sources are added later |
| `severity` | string | `minor` \| `moderate` \| `severe` \| `extreme` — normalised from the source's CAP severity (or ECCC's `impact_*` field) |
| `tier` | string | `yellow` \| `orange` \| `red` — pre-mapped colour tier matching the radar-derived banner so the client doesn't need to know severity vocabulary |
| `eventType` | string | Raw upstream event code (`RFW`, `Tornado Warning`, etc.) |
| `title_en` | string | Short, banner-sized event title in English (capitalised; `event` for NWS, `alert_name_en` for ECCC) |
| `title_fr` | string | Same for French — for NWS this mirrors `title_en` since NWS is English-only |
| `description_en` | string | Longer body text (NWS `headline` + `description`, ECCC `alert_text_en`). Not shown in the MVP banner; kept in the payload for future expansion-on-tap UI |
| `description_fr` | string | Same for French |
| `expiresAt` | string\|null | ISO 8601 timestamp |
| `areaDesc` | string\|null | Human-readable area name (NWS `areaDesc`, ECCC `feature_name_en` or `province`) |

The `alerts` array is sorted server-side by descending severity, ties broken by descending expiry time so the freshest critical alert lands first. The client banner shows only the first orange/red entry; minor/yellow alerts are present in the payload but not promoted to the banner (small craft advisories, frost watches, etc. fire often enough that surfacing them as a permanent banner would devalue the louder ones).

Coverage gaps:

- **Outside US and Canada** — both sources skip the call (their bbox check fails) and the orchestrator returns `{ "alerts": [] }`. Europe (MeteoAlarm) and other regions are roadmap items, not yet implemented.

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

The feature is opt-in: it is activated only when `settings.json` contains an `indoorTemperature` block with `enabled: true`. Otherwise this endpoint returns `200` with `{ "enabled": false }` and the client component renders nothing. (Pre-v2.16.5 returned `404` for the "not configured" case; switched to `200 + enabled:false` so browser devtools no longer paints it red on every poll for users without Homebridge.)

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
| `enabled` | boolean | `true` when configured + cached data available; `false` when the `indoorTemperature` block is absent or its `enabled` flag is false |
| `value` | float \| null | Temperature in °C; `null` until the first successful poll |
| `humidity` | float \| null | Relative humidity in %, when the sensor exposes it (Dyson does, Hue doesn't) |
| `airQuality` | integer \| null | HomeKit AirQuality 1..5 (1=Excellent..5=Poor); `null` when not exposed |
| `sensorName` | string | Echo of the configured `serviceName` |
| `lastUpdated` | string \| null | ISO 8601 of the last successful poll |
| `isStale` | boolean | `true` when the cached reading is older than 30 min |

- **Response (not configured):** HTTP 200 `{ "enabled": false }`

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
- **Response:** large JSON object containing system info, KPIs, provider status, cache state, quota counters, service call history, security events, recent log lines, and a `radarSnapshots` array with the last 10 AI-summary radar payloads (each entry: `{ ts, lat, lon, lang, source: "fast-path"|"claude", radarText, summary }` — useful for diagnosing cases where the summary's narrative disagrees with the radar map). The `serverKpis.cpuTempC` field holds the CPU temperature in degrees Celsius (read from `/sys/class/thermal/thermal_zone0/temp`); `null` on platforms that don't expose the file. The `serverKpis.fanRpm` field holds the fan speed in raw RPM (read from the first `/sys/class/hwmon/*/fan*_input` found — covers Pi 5 with the official Active Cooler, Pi 4 with PWM-fan overlays, and laptop x86 fans on Linux); `null` on hosts with no fan sensor exposed.

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
Sets the screen brightness in percent (0–100). Floors at `minPercent` (10%) by default to prevent accidental black screens. The sleep-mode stage-2 path bypasses this floor by passing `allowOff: true` — it explicitly turns the backlight off as the cleanest mitigation for LCD backlight bleed.

- **Access:** 🔒 Localhost only — brightness physically affects the device's screen, no value changing it from a remote client
- **Body:** `{ "percent": <number>, "allowOff"?: <boolean> }` — `allowOff: true` lowers the floor from `minPercent` to 0 for this single write. The slider in Settings does not pass it; only the sleep-mode stage-2 transition does.
- **Response on success:** `{ "ok": true, "percent": <clamped>, "raw": <int>, "max": <int> }`
- **Errors:**
  - `400` — `{ error: "Body must be { percent: <number> }" }` or `invalid-percent`
  - `403` — `{ error: "no-write-permission" }` (udev rule missing — install.sh adds it under `/etc/udev/rules.d/52-pi-weather-station-backlight.rules`)
  - `503` — `{ error: "no-device" }` (no `/sys/class/backlight/*` exposed; usually means the kernel `dtoverlay=rpi-backlight` line is missing from `/boot/firmware/config.txt`)
  - `500` — `{ error: "max-unreadable" }` or `write-failed`

---

## Health

### `GET /api/health`
Aggregates the in-memory `serviceStatus` map into a three-tier health verdict for the client-side `HealthIndicator` dot in the BottomDock. Drives the green / yellow / red signal users see at the bottom-right of every layout.

- **Access:** 🌐 Public — rate limited (120 req/min)
- **Query params:** none
- **Response:**

```json
{
  "status": "green" | "yellow" | "red",
  "issues": [
    { "service": "Tomorrow.io (daily)", "status": 429, "comment": "rate limited", "critical": true }
  ],
  "lastChecked": "2026-05-18T12:00:00.000Z"
}
```

Classification logic:
- **green**: every critical service is responding and no non-critical service is in a sustained-failure window.
- **yellow**: at least one non-critical service is failing (Anthropic, RainViewer, Homebridge, ipapi.co, sunrise-sunset.org, AQ sources, gov alert sources).
- **red**: at least one critical service is down (Tomorrow.io current/hourly/daily, Mapbox, LocationIQ).

Two suppression layers prevent false-positive red dots:
1. **`lastSuccess` window (10 min)**: a failure is suppressed if the same service had a successful call within the last 10 minutes. Protects against transient flakes and duplicate call paths (e.g. AI-summary re-fetching Tomorrow.io and failing while the main weather poll just succeeded).
2. **`ALTERNATIVE_GROUPS` cross-suppression**: services orchestrated as alternative chains (NWS+ECCC alerts; MELCC-Mtl / MELCC-RSQAQ / ECCC AQHI / EPA AirNow / OpenAQ for air quality) — a failure on one member is suppressed if any sibling in the group has a recent success. Prevents "wrong region for this user" failures from polluting the dot.

If the client itself cannot reach the server (network failure), the dot paints red with `Server unreachable` synthesized client-side.

---

## Cert

### `GET /api/cert.pem`
Serves the server's self-signed TLS certificate as a downloadable `.pem` file for the Settings panel's "Trust this Pi on this device" affordance. Lets users install + trust the cert in iOS / macOS / Android / Windows for a clean PWA experience without a security warning every visit.

- **Access:** 🌐 Public — rate limit not applied (small static payload, served once per device)
- **Query params:** none
- **Response headers:** `Content-Type: application/x-x509-ca-cert` (triggers the iOS "install profile" flow when opened from Safari)
- **Response body:** the PEM-encoded cert from `server/cert.pem`

See [`docs/pwa-trust-cert_en.md`](pwa-trust-cert_en.md) for the per-platform trust-install walkthrough.

---

## Open-Meteo (Plan B)

### `GET /api/weather/openmeteo`
Proof-of-concept adapter that fetches the [Open-Meteo](https://open-meteo.com/) forecast API and normalises the response into the same envelope shape as the three Tomorrow.io proxy endpoints. Used for side-by-side comparison via `tools/compare-weather.js` — **not** wired into the kiosk UI. See [`docs/open-meteo-plan-b.md`](open-meteo-plan-b.md) for the full Plan B rationale and longitudinal observations.

- **Access:** 🌐 Public — rate limited (120 req/min)
- **Query params:**

| Parameter | Type | Required | Description |
|---|---|:---:|---|
| `lat` | float | ✅ | Latitude |
| `lon` | float | ✅ | Longitude |
| `tz` | string | ⬜ | IANA timezone (e.g. `America/Toronto`). Defaults to `auto`. Strict regex match so junk values can't reach the upstream URL. |

- **Response:** `{ current, hourly, daily, _raw }` — each of `current`/`hourly`/`daily` is a Tomorrow.io-shaped `data.timelines[0].intervals[]` envelope. `_raw` is the unaltered Open-Meteo response for debugging.
