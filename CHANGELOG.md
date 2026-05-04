# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [2.10.2] - 2026-04-27

### Fixed
- **API key fields visible on remote (read-only) with the same amber notice** — same UX gap as Advanced settings before v2.10.1: API keys, Anthropic key, and custom coordinates were hidden entirely on remote, leaving users wondering where they went. Show them everywhere; on remote, render API keys as a coloured "Configured" / "Not configured" status (the actual key string is never sent to remote clients — server-side masking continues to return booleans), render coordinates as a plain read-only text value, and show an amber notice at the top of the section pointing to the SSH-tunnel workflow. The localhostOnly write boundary on `PATCH /setting`, `PUT /settings`, etc. is preserved unchanged.

---

## [2.10.3] - 2026-04-27

### Fixed
- **Pre-flight check no longer trips on harmless untracked files** — the in-app updater's `local-changes` check used `git status --porcelain` to detect anything that would conflict with `git pull --ff-only`. That command also lists untracked files (with `??` prefix), which `git pull --ff-only` doesn't actually touch — they live outside git's view entirely. Result: harmless backups like `settings.json.bak` blocked the updater with a misleading "uncommitted changes" message. Add `--untracked-files=no` so only real conflicts (modified, staged, deleted, renamed files) trigger the rejection.

---

## [Unreleased]

---

## [2.12.0] - 2026-05-04

### Fixed
- **InfoPanel width now scales with the `fontSize` zoom** — the panel column was a fixed 300 screen px while its contents were CSS-zoomed by `fontSize` (`{s: 0.85, m: 1.0, l: 1.15}`). At size L the contents zoomed up 15 % but the column didn't, so the right column of stats (precip / cloud / wind / humidity) overflowed and the panel's right edge clipped the trailing `%` on every value. Symmetric fix: width now scales with the same factor (255 / 300 / 345 px for S / M / L), so the contents always see ~300 CSS px of internal layout space regardless of size. Height was already adjusted via `calc(100dvh / fontSizeZoom)`; width was the asymmetric half that caused the clipping.
- **AQI source selection now picks the geographically closest hit, not just the first one in priority order** — yesterday's strict priority chain (Mtl → RSQAQ → ECCC, first non-null wins) produced an effect-edge bug at Sainte-Victoire-de-Sorel (45.978, -73.082): the closest Montreal station ("1050-A St-Jean-Baptiste") sat right at the 50 km cap and won the chain, even though the RSQAQ network had Saint-Joseph-de-Sorel at 8 km. The orchestrator now runs the two MELCC sources in parallel (each is a single cached upstream fetch, so this is essentially free) and picks the candidate with the smallest `stationDistanceKm`. ECCC stays sequenced after — its per-station walk for defunct stations (up to six HTTP calls) makes it expensive to run speculatively, and its 300 km cap is wide enough that geographic comparison doesn't add value when MELCC has any coverage. Bonus side-effects worth noting: Longueuil now correctly resolves the provincial "Longueuil" station (3 km) instead of crossing the river to a Montreal-island station (4 km), and Laval lands on "Laval - Chomedey" (0 km) instead of any Mtl station ~10 km away. Quebec city, Sherbrooke, and Sorel itself all unchanged because their nearest source had always been clearly closest. Toronto / Vancouver / Newfoundland still ECCC. The 50 km Mtl cap stays as-is — the cap is no longer the load-bearing safety net, just a cheap pre-filter to avoid scoring stations that obviously can't win.

### Documentation
- **`settings.example.json`, `CLAUDE.md`, `SECURITY.md`, `docs/api.md` — list `airNowApiKey` and `openAqApiKey` everywhere** — four spots referenced the old set of API key fields and would have sent fresh installers down the wrong path: the bootstrap template, CLAUDE.md's External Services table, SECURITY.md's settings whitelist section, and docs/api.md's whitelisted-top-level-keys line. Adds the two new keys plus inline rows for AirNow and OpenAQ in the External Services table (and the recently-shipped MELCC sources / gov-alerts services that were also missing from that table).
- **`docs/logs.md` — single source of truth for log locations** — three different sources said three slightly different things about where the server log lived (CLAUDE.md said `<repo>/server.log` flat, the systemd unit's header pointed at `journalctl`, and the readme had `tail -f /tmp/weather-server.log` snippets scattered through install sections), which made for at least one debugging session this morning where journalctl was checked for output that was never going to be there. Captures the full picture in one file: `/tmp/weather-server.log` on Linux (because `install.sh` always writes a drop-in pinning `StandardOutput`/`StandardError` to that path so the file is easy to `tail`/`grep`/`logrotate`), `<repo>/server.log` on macOS (launchd plist points there), what `journalctl` actually contains on Linux (systemd lifecycle events only — start/stop/exit/ExecStartPre — never the application's `console.log`), and the related artefacts that share the directory but aren't logs (`npm-audit.log`, `request-counts.json`). Cross-linked from CLAUDE.md, `deploy/pi-weather-server.service`'s header comment, and the readme's Debug-panel section so anyone following the obvious trail lands on the right answer.

### Added
- **OpenAQ as the global air-quality fallback** — closes the geographic gap left by MELCC (Quebec) + AirNow (US) + ECCC (Canada): for kiosks anywhere outside North America the badge has been falling back to Tomorrow.io's `epaIndex` (paid Air Quality data layer) and silently going dark. OpenAQ aggregates ~150 countries of government-monitoring data via a free per-install API key (sign up at `explore.openaq.org/register`); the source skips silently when the key isn't configured, so a North-America-only install pays nothing for it. New `server/airQualitySources/openaq.js` queries `api.openaq.org/v3/locations` for the nearest station within 25 km, then `/locations/{id}/latest` for the latest reading per sensor — both cached together for 30 min. OpenAQ doesn't pre-compute AQI, so the source converts raw concentrations to EPA-canonical units (µg/m³ for particulates, ppm for O3/CO, ppb for NO2/SO2 — converting from µg/m³ at 25 °C / 1 atm where needed) and applies the official EPA breakpoint formula per supported pollutant (PM2.5, PM10, O3, NO2, SO2, CO), then takes the worst-case sub-index across what the station reports — same methodology EPA itself uses for "current AQI". The new `epaAqiFromConcentration` helper in `_shared.js` is reused by any future source that ships raw pollutants. Slots into the orchestrator's parallel batch as a fourth source; the closest-wins picker handles every border zone naturally without an explicit country gate (a kiosk just inside Mexico picks OpenAQ at 10 km over AirNow at 80 km across the US border, without any code change). Reports `source: "OpenAQ"`, `scale: "epa"`, `kind: "observation"`. New `openAqApiKey` field in Settings (matches the AirNow / Anthropic pattern: per-install secret, masked to a boolean for remote clients via `API_KEY_FIELDS`). Adds `OpenAQ` to the Debug panel's Services section.
- **EPA AirNow as the US air-quality source** — the AQI badge has been dark for any US location since v2.6 because Tomorrow.io's `epaIndex` requires a paid Air Quality data layer the kiosk owner doesn't have. EPA AirNow closes the gap with a free per-install API key (sign up at `docs.airnowapi.org`, rate-limited 500 calls/h, generous for our 30-min poll). New `server/airQualitySources/airnow.js` exports the same `tryAqi(lat, lon, opts)` shape as the existing sources and slots into the orchestrator's parallel batch alongside the two MELCC networks; the closest-wins picker handles US/Canada border zones naturally without an explicit country gate (Plattsburgh NY → AirNow at 5 km wins over MELCC at 30 km across the border; Lacolle QC → MELCC at 5 km wins over AirNow at 30 km). The source returns `{ scale: "epa", kind: "nowcast", source: "AirNow", pollutant: "PM2.5"|"O3"|"PM10", ... }` — the badge already understood the four-tier vocabulary thanks to AQHI/IQA work; new `categoryForEpaAqi` in `_shared.js` maps the 0–500 EPA scale to `low`/`moderate`/`high`/`veryHigh` at the EPA palette's own orange→red split (150). `kind: "nowcast"` is the most accurate label — AirNow reports the NowCast 12-h weighted average for PM2.5/PM10 and 1-h averages for O3, both of which are EPA's official current-observation methodology rather than instantaneous spot values; the badge tooltip surfaces "NowCast" so the user knows the number is real-time-ish but not raw-instantaneous. New `airNowApiKey` field in Settings (matches the `anthropicApiKey` pattern: per-install secret, masked to a boolean for remote clients via the existing `API_KEY_FIELDS` whitelist). Without a key the source no-ops to null and a Canadian-only install pays nothing for it. Adds `EPA AirNow` to the Debug panel's Services section. Verified end-to-end against the live endpoint with `airNowApiKey` configured.
- **Government severe-weather alerts in the AlertBanner (NWS for the US, ECCC for Canada)** — the banner used to derive its tier purely from the radar (orange/red dashed-circle colours surfacing as a localised "Précipitations fortes/sévères" string), which is great for storms that radar can see but silent for warnings that aren't really about precipitation: tornado watches, wind advisories, freezing-rain warnings, heat warnings, etc. Now `<AlertBanner>` first checks for active government alerts at `mapGeo` and lets a NWS or ECCC alert outrank the radar tier — when one is active at orange/red severity, its localised event title (NWS `event` like "Wind Advisory", ECCC `alert_name_en/fr` like "Rainfall warning" / "Avertissement de pluie") plus a `[NWS]` or `[ECCC]` source badge replaces the radar wording. Yellow/minor advisories stay out of the banner on purpose (small craft advisories, frost watches fire often enough that promoting them to a permanent banner would devalue the louder ones); they're still in the API payload for future expansion-on-tap UI. New `GET /api/weather-alerts?lat&lon` endpoint runs the two regional sources in parallel — NWS via the native `?point=lat,lon` query (free, no API key, descriptive User-Agent required) and ECCC via the same `api.weather.gc.ca/collections/weather-alerts` pygeoapi collection that already serves AQHI. The collection's `bbox` filter is non-functional on this instance, so the strategy is to fetch all active Canadian alerts once (≤50 features, ~30-100 KB), cache the list server-side for 5 min, and run point-in-polygon locally per request — bilingual EN/FR is built into every property and preserved through to the client. Each source filters by a rough national bounding box before calling so a Quebec kiosk doesn't generate a guaranteed-400 NWS request every poll, and a Texas kiosk doesn't run a wasted PIP scan over Canadian polygons. Failures isolated: one source erroring out doesn't blank the other. Adds `NWS (severe weather alerts)` and `Environment Canada (severe weather alerts)` to the Debug panel's Services section. Outside US/CA, both sources skip the call and the endpoint returns `{ alerts: [] }` — Europe (MeteoAlarm) and other regions are a roadmap follow-up.
- **Quebec air-quality observations from MELCC (provincial RSQAQ + Ville de Montréal RSQA)** — every Quebec marker was previously falling back to ECCC's twice-daily forecast bulletin (Quebec stations don't currently publish to `aqhi-observations-realtime`); for Montreal the badge value matched the EHHUN forecast 10 km from downtown, and for Sorel / Quebec city / Sherbrooke the badge had to walk to whatever distant station ECCC could resolve. Two real-observation sources now sit in front of ECCC in the priority chain — both free, both CC-BY, both indexed on Données Québec, no API key:
  - **MELCC RSQA Montréal** (`donnees.montreal.ca` CSV, `vmtl-rsqa-indice-qualite-air`) — covers the island of Montréal, hourly real-time (~50 min after the hour). The CSV is one row per (station, pollutant, hour); the source rolls the latest hour up to one IQA per station via max-of-pollutants per the official methodology, then serves the nearest station within 50 km.
  - **MELCC RSQAQ provincial** (ArcGIS FeatureServer behind `iqa.environnement.gouv.qc.ca`, `rsqaq-indice-de-la-qualite-de-l-air` on Données Québec) — covers all of Quebec except Montreal island (excluded by intergovernmental agreement; the city runs its own network published by the Montreal source above). Hourly real-time, returns the nearest valid station within 200 km.
  Verified end-to-end against the live endpoints on 2026-05-03: Montréal centre-ville now resolves "75 Ontario Est" (IQA=28, observation, 1 km) instead of EHHUN's forecast 10 km away; Sorel resolves "Saint-Joseph-de-Sorel — École Martel" (2 km) instead of Cornwall (169 km via the older ECCC fallback); Québec city resolves "Québec — Vieux-Limoilou" (1 km, observation) instead of EHTWR's forecast. Toronto / Vancouver / Newfoundland remain on ECCC AQHI as before. The badge label switches to "IQA" for the Quebec sources and stays "AQHI/CAS" for ECCC; the badge tooltip shows the source-specific label and the Debug panel "AQI SOURCE" row surfaces the chosen station + scale + kind for any backend.
  Refactor: `airQualityCtrl.js` is now a thin orchestrator that walks `[melccMtl, melccRsqaq, eccc]` in order; each source lives in `server/airQualitySources/` and exposes a normalised `tryAqi(lat, lon)` that returns `{value, category, source, scale, kind, stationName, stationDistanceKm}` or null. Adding tomorrow's NWS-alerts and EPA AirNow source slots into the same shape with no orchestrator changes.
- **Debug panel — AQHI SOURCE row** — when the badge resolves an Environment Canada AQHI value, the Debug panel's Client KPIs grid now shows a dedicated row with the chosen station's name, distance, observation/forecast `kind`, and the raw value (e.g. `Cornwall — 109 km — observed — AQHI 2.8`). Without this row the only place to see *why* the badge picked a 109-km-away station for Montreal was the Services table comment, which uses the cryptic station ID and is easy to miss; the dedicated row makes the data quality of the badge legible at a glance. Sourced from `aqhiInfo` lifted into AppContext (the badge component now publishes its existing 30-min poll there instead of keeping local state) so the row updates in lockstep with the badge with zero extra requests.
- **AQHI falls back from observation to forecast when the station's hourly observation is missing** — Quebec province's AQHI stations (EHTWR Quebec, EHHUN Montreal, etc.) currently publish twice-daily forecast bulletins (06:00 / 17:00 local) but their observation pipeline at `aqhi-observations-realtime` returns zero features. The widened-radius fix from earlier today worked around it by walking out to Edmundston / Cornwall (~230 km), but a "Quebec — 230 km" tooltip is misleading when there's a perfectly authoritative AQHI value for Quebec itself, just predicted rather than measured. Now `fetchAqhi(stationId)` tries `aqhi-observations-realtime` first and, when empty, queries `aqhi-forecasts-realtime` for the forecast row whose `forecast_datetime` is the latest hour ≤ now (falls back to the earliest future hour if every row is in the future). The endpoint surfaces `kind: "observation" | "forecast"` so the badge tooltip can honestly say "observed" vs "forecast" — the value is still official Health Canada AQHI either way. Verified: Quebec city now resolves EHTWR's forecast (AQHI=2 at 1 km) instead of Edmundston's observation 230 km away; Toronto continues to prefer FCWYG's live observation. Adds `badges.aqiKindObservation` / `badges.aqiKindForecast` keys in EN/FR/ES.
- **AQHI station-search radius widened to 300 km, walk to 6 candidates** — initial 150 km / 4 candidates was too tight: on May 3 2026 the entire province of Quebec had no active station reporting (EHTWR Quebec, EHHUN Montreal both defunct), so kiosks at Sorel and Quebec city showed an empty AQI badge despite Cornwall and Edmundston (NB) being within reach. Bumping the cutoff and walk depth lets Sorel pick up Cornwall (169 km) and Quebec city pick up Edmundston (230 km) — regional rather than local readings, but the tooltip surfaces station name + distance so the user can judge relevance themselves.
- **AQI badge backed by Environment Canada's free AQHI feed** — the AQI badge added a few days ago has never displayed for the kiosk's actual user because Tomorrow.io's `epaIndex` requires the paid Air Quality data layer. Now `<UvAqiBadges>` prefers Environment Canada's free [AQHI](https://api.weather.gc.ca/) (Cote air santé) when the marker is in Canada, and only falls back to Tomorrow.io's `epaIndex` outside coverage. New `GET /api/air-quality?lat&lon` endpoint walks the published `aqhi-stations` list to find the nearest active station within 150 km — defunct stations (Montreal's "EHHUN" is the obvious example: in the published list but returns zero current observations) are skipped by trying the next four nearest until one has a recent observation. Per-station observations cached 20 min server-side; the station list itself cached 24 h. Adds "Environment Canada (AQHI)" to the Debug panel's Services section. Badge tooltip shows the source (Health Canada AQHI vs Tomorrow.io EPA) plus the station name and distance when ECCC is the source. AQI badge tier vocabulary unified to four categories (low / moderate / high / veryHigh) since the underlying scales (AQHI 1-10+ and EPA 1-6) both map cleanly onto Health Canada's four-tier risk model.

### Changed
- **Radar trend tuning: gate bumps on intensity ≥ 2, ring-aware inward-shift threshold** — analysis of a full storm cycle on May 3 2026 (~10h30, 125 polls, 32 v2 bumps) showed two refinements worth shipping:
  - **Bump suppression at intensity 1** — ~25 % of bumps were `max=1 + approaching` events that surfaced an orange banner for what was essentially drizzle. The AI summary already mentions light precipitation in its narrative when relevant; the radar tier doesn't need to escalate for it. New gate: bump only applies when `maxIntensity ≥ 2` on the ring (light + above). All meaningful bumps from the analysed cycle (orange↑ from max=3, red↑ from max=4 sustained 50 min during peak intensity) are preserved.
  - **Ring-aware inward-shift threshold** — inner ring keeps the 5 km / 3 mi threshold; outer ring now uses 8 km / 5 mi. The same physical shift is a smaller fraction of the outer-ring radius (5 km / 50 km = 10 %, vs 5 km / 100 km = 5 %), and the analysed cycle showed only 1 outer bump in 10 h with the inner threshold — too tight to catch genuine outer-ring approaches. The proportional 8 km threshold should produce a more sensible outer-bump rate without flooding it with noise.
- **Radar sampling geometry densified ~10× (57 → 481 points), trend threshold relaxed, server-side trend logging added** — overnight observation showed the previous geometry (8 inner + 16 outer directions, 4 + 3 distances per ring = 57 points) was too sparse to reliably catch real approaching cells: a moderate band that visibly crossed both rings drifted between sample positions, leaving `trend: stable` throughout. Three coordinated fixes:
  - **Geometry**: inner ring is now 16 directions (every 22.5°) × 10 distances (every 5 km / 3 mi from 5–50 km / 3–30 mi); outer ring is 32 directions (every 11.25°) × 10 distances (every 5 km / 3 mi from 55–100 km / 33–60 mi). 481 points total when extendedRadius is on. Where outer bearings match the 16 inner cardinals, samples merge into one direction block in the AI prompt for a denser radial profile per direction.
  - **Trend threshold**: lowered from intensity ≥2 to ≥1 in `computeRingTrend` so light-precip approaches (intensity 1, the most common case in stratiform systems) actually contribute to the inward-shift detection. The denser direction grid absorbs the extra noise from light samples.
  - **Diagnostic logging**: `getRiskLevels` now emits one `[risk]` line per call to `console.log` (visible in `journalctl --user -u pi-weather-server`) with the cache key, both rings' base intensity, trend, and final tier (with `↑` marker if v2 bumped). Lets a "why did the banner fire then?" question be answered from logs instead of guesswork.
- **`advanced.ai.doubleOuterPoints` setting removed** — the new dense geometry always uses 32 outer directions when `extendedRadius` is on, so the toggle no longer has any effect. The setting is dropped from the UI and AppContext; existing `settings.json` entries are silently ignored. Frees up one row in the Advanced settings panel.

### Added
- **Trend-aware radar-risk colouring (v2)** — the dashed-circle tier was previously a "right now" intensity score. Now `getRiskLevels` fetches the same 3-frame sequence (now / -15 min / -45 min) the AI summary already uses, computes a per-direction inward gradient on each ring, and bumps the displayed tier one notch (calm → yellow → orange → red) when at least one direction shows a precipitation peak that has shifted inward by ≥5 km (≥3 mi) over the 45-min window AND its projected arrival at the centre is under 30 min. Operational meteorology treats imminence as part of the warning, not just raw intensity — an "orange that's heading inward" is now displayed as red before the cell actually crosses the intensity-5 threshold. Snapshots are fetched in parallel and most tile reads hit the shared cache populated by the AI-summary analyzer, so the latency stays close to a single-frame fetch. The response now also carries a `trend` field per ring (`approaching` \| `stable`) for diagnostics and future UI use (no client change required for v2).
- **Bright radar-tier ring colours restored in light mode via dark-outline trick** — the previous fix for "yellow rings drown on cream basemap" muted the light-mode yellow tier to a goldenrod amber, which solved visibility but lost the visual link with the radar tile palette and brought the yellow visually too close to the orange tier. New `buildRingLayers` helper renders coloured rings in light mode as a solid dark outline beneath a brighter dashed coloured stroke — the outline does the heavy lifting on contrast, so the bright `#f0e600` / `#f08200` / `#e60000` work cleanly against the cream basemap. Dark mode keeps a single-stroke ring (no outline needed; the dark basemap supplies the contrast). Same solid-outline trick also applied to the per-point dot overlay.
- **Sampling-point dots are now colour-coded by their own intensity** — when the "Show sampling points" overlay is on, each dot used to be a uniform neutral colour regardless of what the radar showed underneath it; you had to mentally cross-reference the radar tile to see which probe was sitting in a heavy band. Now each dot picks its colour from its individual intensity using the same calm / yellow / orange / red mapping the dashed circles use, so a single glance shows exactly which directions and distances are contributing to the inner / outer ring's risk score. `GET /api/radar-risk` now returns `inner.samples` and `outer.samples` alongside the existing aggregate fields; the client builds an O(1) lookup keyed by `${direction}:${distance}` and matches it to the points it draws. Calm samples (intensity 0) keep the original neutral dot — the colour change is a positive signal, not a redundant one.
- **Persistent text alert banner in the InfoPanel for orange / red radar tiers** — the dashed-circle colour already conveys risk visually, but at-a-glance users sometimes miss the chromatic shift, especially on busy radar tiles. A new `<AlertBanner>` lives between the clock area and the scrollable weather section, surfaces a localised one-line message when the radar-risk analyser reports orange or red on either ring, and stays out of the way (renders nothing) for calm and yellow. Wording differentiates "in your area" from "approaching" based on whether the inner or outer ring is the source of the worst tier — so a storm 80 km out reads differently from one already on the marker. Background colour matches the ring tier (orange `#f08200`, red `#e60000`) so the banner and the dashed circles share a single visual language. Yellow stays ring-only on purpose to avoid alert fatigue. Risk state lifted from WeatherMap to AppContext so the banner and the circles consume the same source.
- **Centre sample point at the user's exact location for radar analysis** — the inner ring's nearest probes were at 5 km / 3 mi in 8 directions, leaving a hole on the marker itself: a small precipitation cell sitting right on the user (too narrow to extend out to 5 km in any direction) would slip through the geometry and the AI summary would honestly report "clear" while the radar tile clearly showed rain on top of the user. Both `analyzeRadar` (AI summary text) and `getRiskLevels` (dashed-circle colour) now sample at `(lat, lon)` itself, labelled `C` in the prompt's per-direction grid (`C : 0km moderate`) and rendered as the first sampling-point dot under the marker. Risk score still uses worst-case across the whole inner ring including the centre — no separate tier for "on top of the user", because the existing tier mapping already handles it correctly (a single intensity-5 reading on the centre sample is enough to flip the inner ring red).

### Documentation
- **`docs/radar-classification.md`** — captures the full RainViewer pixel → intensity → tier → display-colour pipeline in one place: the projection step, the 3×3 neighbourhood max sampling, the alpha and palette-distance thresholds, the NEXRAD level-III palette table, the server-side `RISK_LEVELS` mapping, and the client-side `RING_RISK_STYLE` / `DOT_COLOR_BY_TIER` palettes. Also lists the known limitations (single colour scheme, no precipitation type, no movement awareness, worst-case can over-report) and concrete future improvements (larger kernel, median instead of max, multi-frame confidence) — written to make the next "is this still the right tuning?" review fast.

### Changed
- **Radar analyzer samples a 3×3 pixel neighbourhood per probe instead of a single pixel** — single-pixel sampling on RainViewer tiles was noisy: a probe sitting between two bands, on an anti-aliased edge (alpha < threshold), or in a tiny gap inside a band would honestly report "clear" while the surrounding ~100 m on the radar tile clearly showed rain. Now `readPixelIntensity` reads the 3×3 window around each probe and returns the worst-case intensity. Cost is negligible (9 byte reads per probe instead of 1, no extra tile fetches), and the spatial dilution is ±1 pixel = ±100 m at zoom 7, well below the geometry's resolution. Both the AI-summary text and the dashed-circle/dot risk colouring benefit. Visible improvement: sampling-point dots that previously appeared neutral inside a precipitation zone (because the exact pixel landed in an anti-aliasing gap) now correctly pick up the surrounding intensity.
- **AI summary degrades gracefully when Tomorrow.io throttles** — pre-refactor, a single `/api/weather/current` failure (typically a 429 quota-exceeded) made `/api/weather-summary` return 500 and the entire "Résumé IA" section to disappear from the panel — even though the radar analysis and the cached forecast were both still available. Now Tomorrow.io failures are non-fatal: the controller logs the failure to the service status, drops the "Current conditions" paragraph from the prompt, tells Claude not to invent values for it, and renumbers the remaining paragraphs so what *is* available still gets summarised. Only when *all three* sections (current, period preview, radar) are empty does the endpoint return 503 and the client hide the section entirely. The radar analysis path is independent of Tomorrow.io, so most of the time the summary stays useful even during a Tomorrow.io outage.
- **Debug panel pre-registers all known external services** — the "Services" table only listed providers that had been called *at least once* during the current process lifetime. An absent row was ambiguous: "is Anthropic broken or just unused?". Now `serviceStatus` exposes a new `registerService(name)` helper, called at server startup for the eleven known providers (Tomorrow.io × 3, Mapbox, LocationIQ, ipapi.co, sunrise-sunset.org, RainViewer × 2, Claude, Homebridge). Pre-registered services appear with a neutral `—` status and "Not yet called" comment until the first real call overwrites them. The renderer treats null status / null lastCall as the "never-called" state instead of falling through to the error-red badge for `NaN`.
- **Debug panel hides CPU TEMP entirely on hosts without `/sys/class/thermal/thermal_zone0/temp`** — same UX as the new fan-speed row and the brightness slider: when a sensor isn't exposed by the platform (macOS dev machines, x86 without thermal zone 0), the row disappears instead of showing a perpetual "—". `null` from the server is now treated as "not available" rather than "no value yet". On Pis and Linux x86 with thermal zones, behaviour is unchanged.

### Added
- **Debug panel — fan speed (RPM) alongside CPU temp** — new row in the Server KPIs grid, populated from `GET /api/debug/fan-speed` (polled every 5 s while the panel is open, same cadence as cpu-temp). Server-side detection walks `/sys/class/hwmon/*/fan*_input` on first call and caches the resolved path; covers Pi 5 with the official Active Cooler (`/sys/devices/platform/cooling_fan/...` symlinked into hwmon), Pi 4 with PWM-fan overlays, and laptop x86 fans on Linux. The endpoint reports `available: false` on macOS / x86 without an exposed fan / Pis without a cooler — and the row hides entirely in those cases (same UX pattern as the brightness slider). Raw RPM rather than a normalised percentage so the value matches what `cat /sys/.../fan1_input` would print, and a 0-RPM stopped fan stays distinguishable from "no sensor" (null vs hidden row).
- **Radar-risk colouring on the dashed circles (v1)** — the inner and outer dashed circles around the user used to be a constant neutral colour, leaving readers to interpret the underlying radar bands themselves. Now each ring is tinted by the worst-case precipitation intensity sampled on it (calm / 🟡 yellow / 🟠 orange / 🔴 red), aligned with WMO / Météo-France / NWS conventions where intensity drives the colour and worst-case dominates the score. Inner and outer are evaluated independently — inner red = imminent, outer red while inner stays calm = approaching threat. Powered by a new `GET /api/radar-risk` endpoint that reuses the existing radar analyzer pipeline (5-minute cache, shared tile cache with the AI summary so polling adds no RainViewer requests on the common path). Client polls every 5 minutes; gated by the same `aiSummaryAvailable && radarAnalysisEnabled` flags as the circles themselves. Trend-aware bumping ("an orange that's heading inward becomes red before it crosses the threshold") is captured as v2 in `ROADMAP.md`.
- **Default map zoom is now user-selectable, current zoom shown in Debug** — the initial map zoom was hard-coded at `7` in `App/index.js` (was `9` in earlier versions). Adds a slider in Settings → "Default map zoom" with range 4–12, persisted in `localStorage` under `defaultMapZoom`. Sliding the control gives an instant live preview via a new `ZoomLevelHandler` (otherwise the change would only take effect on next load — confusing UX). Independently, a new `MapZoomTracker` listens to Leaflet's `zoomend` event and pushes the current zoom up to AppContext, so the Debug panel can show "MAP ZOOM" alongside the existing "SCREEN" / "JS HEAP" rows. Useful when tweaking the default to find the right starting view, and for diagnostics when users report "the radar looks weird at this zoom."
- **Distance unit setting (mi / km) drives the radar circles, sampling geometry, and AI summary** — previously the AI summary inferred imperial vs. metric distance from `speedUnit` (mph → miles, otherwise km), and the radar circles were hard-coded at 45 km / 90 km regardless of preference. Mph users got their distances in miles in the prompt but still saw `45 km` / `90 km` rings on the map, and there was no way to opt for km in the AI summary while keeping mph for wind. The new toggle in Settings → Units adds an explicit `mi` / `km` choice (default `mi`, matching the existing `mph` default). The Leaflet circles, the sampling-point overlay, and the prompt sent to Claude all switch in lockstep — and the inner/outer circles now round to clean values per unit instead of carrying the same kilometric numbers across both modes:
  - **`distanceUnit=mi`:** inner ring 30 mi, outer 60 mi; sample distances `3/10/20/30 mi` (inner) and `40/50/60 mi` (outer).
  - **`distanceUnit=km`:** inner ring 50 km, outer 100 km; sample distances `5/15/30/50 km` (inner) and `65/80/100 km` (outer).
  Stored client-side in `localStorage` (no server whitelist change). The summary cache key now includes `distanceUnit` so toggling never returns a stale snapshot. Older clients that omit the new query param fall back to inferring from `speedUnit`, so the upgrade is backwards-compatible.
- **`deploy/toggle-debug.sh` — companion to `toggle-remote.sh` for the DEBUG flag** — flipping the bug-icon panel on or off used to mean either editing `~/.config/systemd/user/pi-weather-server.service.d/override.conf` by hand (uncommenting `# Environment=DEBUG=true`, then `daemon-reload` + `restart`) or re-running the full `install.sh` flow. The new script reads the current state from `override.conf` (Linux) or the launchd plist (macOS), asks to confirm the inverse action, edits the env var, and reloads + restarts the service. It preserves the other directives in `override.conf` (StandardOutput, StandardError) untouched and re-comments the line on disable rather than deleting it, so the template stays consistent with what `install.sh` writes. Mirrors `toggle-remote.sh` in shape and naming for muscle memory.

### Documentation
- **`docs/ssl-custom-cert.md` is now bilingual** — the original was in French only, which was inconsistent with the rest of the docs (api.md, security-hardening.md, indoor-temperature.md, etc.) being in English with a `_fr` companion only where one was specifically authored. Renamed the existing file to `docs/ssl-custom-cert_fr.md` and added an English equivalent at `docs/ssl-custom-cert_en.md`. Both `readme.md` and `docs/security-hardening.md` now point to the EN version with a parenthetical link to the FR version.

### Changed
- **`install.sh` indoor-temperature prompt now lists Homebridge sensors and lets you pick by number** — previously the script asked for the exact `serviceName` string up front, leaving the user to track it down via the curl + jq recipe in `docs/indoor-temperature.md` before re-running install. Now the script queries `/api/auth/login` and `/api/accessories` itself (Python's `urllib`, no extra dependencies), filters services exposing `CurrentTemperature` / `CurrentRelativeHumidity` / `AirQuality`, groups them by `serviceName` so a single Dyson appears as one entry, and presents a numbered list with capability tags (`temp`, `humidity`, `air-quality`). The user picks by number; pressing `m` falls back to manual entry. Falls back automatically to manual entry on auth failure, network error, or empty list — install never wedges on a Homebridge hiccup.

---

## [2.11.0] - 2026-04-30

### Added
- **Display brightness slider** — a third entry in the Advanced settings → Display group lets the user dim the kiosk's screen via a slider (10%-100%, step 5%, default = current hardware value at first load). Implemented as `GET /api/brightness` (returns `{available, percent, max, ...}` or `{available: false}` for HDMI monitors / x86 / missing kernel overlay) and `POST /api/brightness` (localhostOnly — brightness physically affects the device's screen, no value in changing it remotely). The slider is hidden entirely when the server reports the backlight is not exposed, so the same UI works across the whole fleet (Pi 4B with 7" DSI, Pi 5 ED-HMI3010, CM5 with HDMI, Pi 5B with HDMI, macOS dev). 10% floor prevents accidental black screens. Live preview updates the screen as the user drags; the actual sysfs write is debounced 250 ms after release.
- **`install.sh` configures brightness control end-to-end** — new prompt under Phase 7 (Advanced features). When opted into: appends `dtoverlay=rpi-backlight` to `/boot/firmware/config.txt` (or `/boot/config.txt` on older layouts) with a `.bak` backup, creates `/etc/udev/rules.d/52-pi-weather-station-backlight.rules` to grant write access on `/sys/class/backlight/*/brightness` to the `video` group, ensures the user is in `video`, and reloads udev so the change takes effect immediately when a backlight is already exposed. The summary block warns about the reboot requirement when the overlay was just added. `uninstall.sh` removes the udev rule (the dtoverlay line stays — harmless and removing it would require another reboot).
- **Live radar opacity sliders for light and dark modes** — two sliders in the new Display group of Advanced settings, ranging from 5% to 100%. The map updates instantly while the slider is dragged (no save round-trip per tick). Persistence happens via a 500 ms debounce after the user stops moving the slider, so the user gets immediate visual feedback without spamming `PATCH /setting`. Defaults match the historical hard-coded values (70% light, 30% dark) — these were deliberately tuned so the radar reads well against each basemap, and the slider lets users pick a different point on the spectrum (e.g. lower opacity if the radar is overwhelming the map, higher if rain bands are too faint to see). Floor at 5% prevents the radar from disappearing entirely. Persisted under `advanced.display.radarOpacityLight` and `advanced.display.radarOpacityDark`.
- **New `<RangeSlider>` component** — reusable native-range-input wrapper with project styling (gold-accented track and thumb, scaling on hover/focus). Used by the radar opacity sliders and ready to be reused for the upcoming brightness slider. Custom `formatValue` prop lets callers control how the readout displays (e.g. `0.7` → `70%`).
- **Debug panel goes full-width on small screens** — on devices where the chart-tabs and InfoPanel-collapse features already activate (`max-height: 520px`), the debug overlay now extends across the full viewport width instead of leaving the historical 320 px gutter for the InfoPanel. On a 7" / 10" touchscreen kiosk, that's the difference between cramped two-column tables and tables that actually breathe. The built-in close button (X, top-right corner of the panel) is unchanged — it lives inside the panel itself, not on the InfoPanel, so closing the overlay still works even though the InfoPanel and its bug-icon toggle are visually covered. Same `matchMedia` breakpoint and live-detection pattern as the existing small-screen features.
- **Font-size setting now also drives the debug panel** — the existing Settings → Font Size control (S/M/L) previously only zoomed the InfoPanel. The debug overlay used a fixed `clamp()`-based scale that was readable on a dev monitor but cramped on the 7" touchscreen. Now the same setting also zooms the debug panel, with its own scale so the historical compact appearance stays available: S = 1.0× (current size, default-equivalent for users who like it dense), M = 1.15×, L = 1.30×. The mapping intentionally differs from the InfoPanel scale (0.85/1.0/1.15) because the debug panel's clamp() font sizes are already tuned tight — shrinking further would cross legibility floors. No new UI control: the Settings selector pilots both panels.
- **Dark-mode map style is now user-selectable** — companion picker to the light-mode selector, with two options: `dark-v10` (the historical default — classic Mapbox dark style) and `dark-v11` (modern variant with a slightly different palette and label rendering). No equivalent of `streets-v12` exists for dark mode in Mapbox's built-in catalogue. The dark grey InfoPanel background is unchanged across both options — only the basemap tiles differ — so no CSS custom-property plumbing was needed. Persisted under `advanced.display.darkModeStyle`. Server-side `ALLOWED_STYLES` whitelist updated to accept `dark-v11`.
- **Light-mode map style is now user-selectable** — new "Display" group at the top of Advanced settings with a 3-button picker for `light-v10` / `light-v11` / `streets-v12`. The InfoPanel, panel-toggle and radar legend backgrounds tint to match: cream (`rgb(238, 236, 232)`) for `streets-v12`'s warmer green/beige basemap, near-white (`rgb(247, 247, 247)`) for the paler `light-v10` and `light-v11`. Implemented via a single CSS custom property `--light-panel-bg-rgb` set on `:root` from a `useEffect` in `AppContext`, so all three surfaces stay synchronized with one source of truth. Persisted under `advanced.display.lightModeStyle`. Dark mode is unaffected.
- **`InlineToggle` accepts an `options` array for N-button selectors** — the previous boolean shape (`onLabel` / `offLabel`) still works for the existing AI toggles. The new shape (`options=[{label, val}, ...]`) supports 3+ choices and is what the new map-style picker uses.

### Changed
- **Light-mode basemap switched from `light-v10` to `streets-v12`** — the previous `light-v10` Mapbox style (`light-v10`) was so pale that city names and the radar's lighter precipitation cells faded into the background. `streets-v12` provides much higher contrast for labels and roads, and the saturated yellow/orange of the radar reads sharply against the green/beige basemap. Dark mode is unchanged (`dark-v10`) — the asymmetry is intentional, since each mode solves a different legibility problem and the dark map already worked well. The `streets-v12` style is added to the proxy's `ALLOWED_STYLES` whitelist in `server/proxyCtrl.js`.
- **InfoPanel light-mode background warmed from `#f7f7f7` to `#eeece8`** — the previous near-white panel looked clinical next to `streets-v12`'s warmer beige/green palette. The new neutral cream tone harmonizes with the basemap without becoming a thematic colour. The same value is applied to the small-screen panel-toggle button on the right edge of the map and to the radar legend overlay, so all three light-mode surfaces match.
- **Map `maxZoom` raised from Leaflet's default 18 to 20** — at the previous limit, even with the 512 px tile fix, neighbourhood-level features stayed cramped on the 7" touchscreen. `streets-v12` supports zoom levels up to 22 natively, so going to 20 stays well within the no-degradation zone and gives roughly 4× more zoom-in headroom without any visual loss. Applied to both `<MapContainer>` and the Mapbox `<TileLayer>` so Leaflet keeps fetching native tiles up to that level.

### Fixed
- **Advanced settings row is now an obvious tappable pill that auto-scrolls into view** — kiosk feedback: on the 7" touchscreen, the "Advanced settings" toggle row at the bottom of the Settings panel was hard to tap (small padding, no visual affordance signalling it was interactive — just a chevron next to plain text), and once expanded the user still had to scroll the panel manually to see what they had revealed. Two changes: (1) the row now has visible background and border styling with `padding: 0.7em 0.8em` for a comfortable touch target, plus hover/active states; (2) on expand, the section scrolls itself to the top of the surrounding Settings scroll container via `scrollIntoView({ behavior: "smooth", block: "start" })`, so the body is immediately visible without manual scrolling. Wrapped in `requestAnimationFrame` so the scroll happens after React has painted the expanded body.
- **Debug-panel close button is now a visible red pill instead of a corner X** — feedback from kiosk testing: the icon-only X (top-right, `right: 10px`) was hard to spot on the 7" touchscreen and even harder to tap accurately — users reported it felt like the icon was about to slip off the edge. Replaced with a 44×44 red circular button (Apple HIG / Material Design minimum touch-target size), bumped to `right: 16px` / `top: 16px` so it's safely inside the visible area regardless of how `zoom` skews coordinates, and z-indexed so nothing behind it can intercept the tap. Hover and active states for desktop testing.
- **AI weather summary now respects user unit preferences** — the prompt sent to Claude hardcoded `°C` and `km/h` regardless of what the user had selected in Settings, so a Fahrenheit user would see the right panel show "53°F" while the AI summary said "12°C" right next to it. Same problem with wind speeds (always km/h) and radar-analysis distances (always km). The client now passes `tempUnit` and `speedUnit` to `/api/weather-summary`; the server converts source values from Tomorrow.io's metric defaults using the same formulas as the existing `convertTemp`/`convertSpeed` helpers, formats them with the matching unit symbols, and adds an explicit instruction to Claude to keep the same units throughout its response. The radar analyzer's distance formatting follows the speed unit (mph → miles, kmh/ms → km). Both caches (AI summary + radar analyzer) include the unit preferences in their keys so toggling Settings never returns a stale snapshot in the wrong units.
- **Mapbox tiles now render at native 512 px resolution instead of being downscaled to 256 px** — `WeatherMap`'s `<TileLayer>` was using Leaflet's default `tileSize` of 256 px, but Mapbox's Static Tiles API serves 512×512 PNGs by default for built-in styles. The mismatch meant Leaflet displayed each 512 px image into a 256 px slot, scaling everything down by 2× — labels, roads, and icons all appeared at half their intended size, blurry on the 7" touchscreen. Add `tileSize={512}` and `zoomOffset={-1}` (the canonical pair for Mapbox 512 px tiles in Leaflet) so tiles render at native resolution with the correct geographic alignment. Effect: city names and road labels are now legible at the kiosk's typical zoom levels without any other change.
- **Radar-analysis dashed circles (45 km / 90 km) now visible on the streets-v12 basemap** — the circles used `weight: 1` and `opacity: 0.45`, which read fine on the very pale `light-v10` basemap but disappeared into the green/beige variation of `streets-v12`. Bumped to `weight: 2` and `opacity: 0.85` so the dashed outline reads clearly across forest, water, urban, and farmland tiles. Sampling-point dots are unchanged — they were already rendered at higher opacity and remained visible. Dark mode is unaffected (the same higher values still look correct on the dark basemap).

### Documentation
- **New `docs/ssl-custom-cert.md`** — full reference for replacing the auto-generated self-signed certificate with one from a real CA (Let's Encrypt, corporate CA, mkcert). Covers the file replacement procedure, three typical scenarios, the auto-regeneration caveat (`server/index.js` regenerates a self-signed cert if `cert.pem` is missing or expired — so a custom cert can be silently overwritten on restart if it's let to expire), format conversion from PKCS#12 / DER / encrypted keys, and verification commands. Linked from the readme's first-launch note and from `docs/security-hardening.md`.
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
