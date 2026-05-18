# Pi Weather Station — Roadmap

This document captures potential directions for the project. It is not a commitment or a release schedule — it is a living reference to guide prioritization and spark ideas.

Items are organized by theme and annotated with an estimated impact (for the primary use case: a kiosk Pi on a kitchen counter) and implementation complexity.

---

## Short term — high impact, low complexity

These items reuse data or infrastructure already in place and can be implemented in a single session.

### ✅ ~~PWA mobile layout + installable kiosk~~ — **shipped May 2026 (v2.15-v2.16)**
New `LayoutMobile` for viewports < 800 px (Variant A "Compagnon nomade" from the Claude Design package — single scrollable column with maximizable radar card and pull-to-refresh). PWA install on iOS/Android via `manifest.json` + opaque `apple-touch-icon.png` 180×180 + standard `mobile-web-app-capable` meta. iOS standalone-mode quirks handled: body bg painted in JS to cover the `100dvh` gap, safe-area-aware headers, Control-Centre swipe-zone clearance on maximized slabs, palette-specific nightRed bg (`#270c0c`). Self-signed cert workflow polished: friendlier CN (`Pi Weather Station - <hostname>`), LAN IP + mDNS hostname in SAN, downloadable `/api/cert.pem` endpoint, per-platform trust guide in `docs/pwa-trust-cert_en.md`.

### ✅ ~~Health-status indicator dot~~ — **shipped May 2026 (v2.16+)**
Small coloured dot in the BottomDock that aggregates `serviceStatus` into a three-tier verdict (green / yellow / red). Tap opens a popover listing services in trouble with their last HTTP status and the server's recorded comment. Backed by a new public `/api/health` endpoint. Two suppression layers prevent false-positive reds: `lastSuccess` window (10 min, protects against transient flakes + duplicate call paths) and `ALTERNATIVE_GROUPS` (cross-suppression for fallback chains — NWS+ECCC for alerts, MELCC/ECCC AQHI/AirNow/OpenAQ for air quality, so "wrong region for this user" failures don't pollute the dot). Client polls every 30 s.

### ✅ ~~PWA refresh affordances~~ — **shipped May 2026 (v2.16+)**
iOS PWA standalone hides Safari's address bar and reload UI. Two mechanisms address it: (1) a 🔄 refresh button in the BottomDock (`carbon:renew`) — universal across all layouts, shows a toast then `window.location.reload()` after 200 ms; (2) pull-to-refresh on LayoutMobile's scroll container — damped 0.5×, 80 px threshold, visual indicator at top, CSS spring-back on release below threshold.

### ✅ ~~Radar focus mode on Desktop~~ — **shipped May 2026 (v2.16+)**
Leaflet topleft control (⛶) on LayoutDesktop ≥ 1280 px. Tap → hides `HeroBand` + rail + chevron via a `.focused` class; the radar fills the entire viewport. Tap again → restore. Mirrors the mobile mapCard maximize pattern but reuses the existing Leaflet control stack so the dock doesn't grow another button. Marker re-pans to the geometric centre via the existing `useRailOffset` hook (gated on `desktopRadarMaximized`).

### ✅ ~~Console hygiene + dependency baseline~~ — **shipped May 2026 (v2.16+)**
Silenced three startup console errors (Leaflet CDN SRI mismatch → CSS now bundled via webpack + `L.Icon.Default` re-pointed to bundled markers; deprecated `apple-mobile-web-app-capable` warning → added the modern `mobile-web-app-capable` alongside; `/api/indoor-temperature` 404 spam → returns `200 + { enabled: false }` when Homebridge not configured). Also dependabot batch: anthropic-sdk 0.96, axios 1.16.1 (prototype pollution + cleartext leak security fixes), i18next minor, style-loader 4, postcss-preset-env 11, webpack-cli 7. (eslint 10 held — `@babel/eslint-parser` upstream peer constraint.)

### ✅ ~~UV index and air quality (AQI)~~ — **shipped May 2026**
Both surfaces ended up far richer than the original "row below the current weather block" idea. UV badge reads from Tomorrow.io's `uvIndex` field. AQI badge chains through five government sources by proximity — MELCC RSQA Montreal first, RSQAQ provincial Quebec next, ECCC AQHI Canada-wide, EPA AirNow for the US, and OpenAQ as the global fallback — each with its own provider's threshold colour scale. The two badges sit in a colour-coded row under the wind/precipitation block in the InfoPanel; either or both hide when the source returns no useful coverage at the user's coordinates. AirNow and OpenAQ keys are optional (`airNowApiKey` / `openAqApiKey` in `settings.json`, prompted by `install.sh`).

### ✅ ~~Automatic dark / light mode at sunrise and sunset~~ — **shipped April 2026**
`darkModeAuto` setting in the Settings panel. When enabled, an interval check flips `darkMode` at sunrise and sunset based on the same sunrise-sunset.org data the rest of the app uses. Manual taps on the dark/light toggle disable auto mode for that session (override pattern — user wins). Persisted in `localStorage`; default OFF so existing installs aren't surprised by sudden theme switches.

### 💡 ~~Screen brightness control~~ ✅ Shipped in v2.11.0
Manual brightness slider in Advanced settings, backed by `/sys/class/backlight/*/brightness`. Hidden when no backlight is exposed (HDMI monitors, x86, missing kernel overlay). `install.sh` provisions the `dtoverlay=rpi-backlight` line and a udev rule so the `pi` user can write to the sysfs node. Automatic dim-at-night is still open — see the dark/light auto-switch item above for the analogous mechanism.

> Future extension to HDMI monitors via DDC/CI is captured as its own item in the medium-term section below.

---

## Medium term — high impact, moderate complexity

These items require new logic or UI work but remain well within the scope of the project.

### ✅ ~~Radar animation (play / pause / speed)~~ — **shipped May 2026**
Full RadarTimeline overlay component embedded in WeatherMap: floating bar at the bottom of the map with date/offset labels, return-to-now button, speed cycler (1× / 2× / 4×), step-back / play-pause / step-forward transport controls, and a touch-friendly scrubber that walks past + nowcast frames from the RainViewer index. Multiple iterations refined the touchscreen UX: thumb hit-area expanded to full thumb-diameter vertical, padding inset of `var(--thumb-w)/2` to keep the thumb fully grabbable at both extremes, dwell-time-free pointer-event handlers (Chromium's heuristic was eating quick taps on the kiosk), legend auto-hide when the timeline collides with it on small screens, ghost-click absorber on close so the WeatherMap doesn't reposition the marker. "Now" tick markers (top + bottom of the input wrapper at the past→nowcast colour boundary) stay visible regardless of where the thumb is parked. Visible directly under the map when the timeline toggle in ControlButtons is active.

### ✅ ~~Sleep mode / screensaver — design A "Loom Sand"~~ — **shipped May 2026**
Two-stage screensaver, opt-in via Settings → Advanced → Sleep mode. After `sleepStage1Delay` minutes of inactivity, the display fades to a fullscreen minimal clock (italic serif date, ultra-thin sans-serif weight 200 time with tabular numerals, footer with weather glyph + temperature + condition) at a configurable dimmed brightness. After a further `sleepStage2Delay` minutes, switches to a black screen with a single 4 px dot that repositions on a 5×5 grid every 5 minutes for LCD anti-burn-in, hardware brightness floored to 0 (with `allowOff: true` bypass on `POST /api/brightness`). Three colour variants: day (cream + anthracite), night-cream (anthracite + cream), night-red (`#0a0808` + `#cc4422`, unified on field-test feedback after the original two-shade `#ff6644` time vs `#cc4422` date read as a hue shift on real panels). Idle wake on `pointermove` / `pointerdown` / `touchstart` / `keydown` / `wheel`. Brightness orchestration silently no-ops on devices without a backlight. 350 ms transparent grace period on wake to absorb the synthetic click that would otherwise reach the WeatherMap. Visual reference at `docs/design-references/sleep-mode.html`; React port at `client/src/components/ScreenSaver/`.

**Design B / C — backlog.** Further visual identities could be added behind a settings selector if user demand emerges:
- **B — "Editorial / Magazine"** : asymmetric layout, time large left, date + weather column right, accent rule.
- **C — "Always-On (watchOS)"** : pure-black centred minimalist, weather chip top-left, indoor chip top-right.

Mock-up workflow if revisited: each new design starts as a standalone HTML file in `docs/design-references/sleep-mode-<variant>.html` (built in [Claude Design](https://claude.ai/design)) before any React work, so the visual is validated before the port.

### ✅ ~~Trend-aware radar-risk colouring~~ — **shipped May 2026**
- **v2 (initial — early May 2026):** `getRiskLevels` fetches the 3-frame sequence (now / -15 min / -45 min) and bumps the ring tier one notch when at least one direction's strongest sample has shifted inward by ≥5 km (≥3 mi) on the inner ring or ≥8 km (≥5 mi) on the outer over the 45-min window AND projected arrival at the centre is < 30 min. Snapshots fetched in parallel; most tile reads hit the shared cache populated by the AI-summary analyzer.
- **v2.5 (May 5 2026 — false-positive remediation pass after observing the morning kiosk screenshot):** four coordinated refinements to stop a single rogue pixel and a band already on its way out from looking like an active threat —
  - **Hysteresis on the tier intensity.** The N-th highest sample (N = 2) decides the ring colour, not the single max. With 161 inner samples (1 + 16×10) and 320 outer (32×10), letting one sample escalate the tier amplified sampling noise into full alarm escalations. The bump gate uses the same hysteretic intensity, so we never bump on a tier we wouldn't have entered without hysteresis.
  - **`leaving` trend label.** `computeRingTrend` (refactored into `computePerDirectionTrends` + `summarizeRingTrend`) now returns `"leaving"` when no direction qualifies as approaching but at least one shows the symmetric outward shift exceeding the same threshold. Approaching wins ties — an orange ring with one inbound and one outbound band stays a safety concern.
  - **AlertBanner copy softens on `leaving`.** New `alert.orangeLeaving` / `alert.redLeaving` keys (EN/FR/ES) — *« Précipitations fortes mais s'éloignent »* / *« Précipitations sévères mais s'éloignent »* — atones the wording without changing the dashed-circle tier, which still reflects current intensity.
  - **Per-direction down-weighting.** A sample whose direction is trending `"leaving"` contributes its `intensity − 1` to the tier-deciding intensity. Symmetric to the existing approaching-ring tier bump — same evidence bar (the unit-aware shift threshold over the 45-min window) on both sides of the inbound/outbound axis. Approaching and stable directions keep full weight.
- **API surface change in v2.5:** the response now exposes a `bumped: boolean` per ring (server already knew when it bumped — no need for the client to reverse-engineer it from `level vs naturalTier(maxIntensity)`, which broke once hysteresis decoupled tier from raw max). `naturalTier()` and `innerMaxIntensity` / `outerMaxIntensity` state were removed from the client.
- **Bonus shipped alongside (not strictly trend-aware):** the radar prompt formatter dropped from ~5000 chars to ~2600 (62 % compression vs ~25 % before) by listing only non-zero samples within the active annulus and omitting fully-clear directions entirely. Claude reads the new convention via an updated preamble in `aiSummaryCtrl`. Compression-stats reports went from ~43 % of frames in the 0-25 % bucket to 100 % in the 50-75 % bucket immediately after the change.
- **What's still tunable:** the inward-shift thresholds (5 km / 8 km) and `TIER_HYSTERESIS_N = 2` are empirical. Tighter and we miss real cells; looser and we trigger on noise. Re-tune if the observed false-positive rate climbs again.

### ✅ ~~Expandable chart card (24h / 5-day) — width beyond the rail~~ — **shipped May 2026**
ChartTabs now ships with a `⛶` maximize button next to the `24 hours` / `5 jours` tabs. When toggled, the slab leaves the rail's flex flow, pins absolutely against the rail bounds, and grows the rail itself via `[data-chart-maximized="true"]` → `--c-rail-width: min(60vw, 960px)` so the chart benefits from the desktop viewport's full horizontal real estate. Mobile LayoutMobile uses the same toggle but inside the scroll column (no horizontal growth — the column is already wide enough). The 5-day expanded view (`DailyForecastColumns expanded` prop) shows day + night icons paired with max/min temps, plus precipitation probability and accumulation rows.

**Future enrichment (separate item)** — with the extra horizontal real estate now available, expose additional series Tomorrow.io already returns:
- Humidity + dew point (24h tab)
- Wind speed + direction (both tabs)
- Pressure trend (24h tab)
- Cloud cover percentage (both tabs)

The chart legend would grow from 2 → 4-6 entries; users could toggle individual series via legend clicks. Effort: ~2-3 h. Worth picking up if a request surfaces — for now the maximized view's larger temp/precip readout is the main value.

**Why not start with a centred modal (Approach B)** : the kiosk's primary content is the radar context. Keeping the chart and radar side-by-side preserves the differentiating glance pattern of the Pi Weather Station. A modal can be added later as a third level (Approach C: compact → tall → wide → modal) if Approach A's ~50% width still feels too cramped after a few weeks of use.

### 🇨🇦 Environment Canada radar source as an alternative to RainViewer
Today's radar layer pulls 256×256 PNG tiles from RainViewer's CDN, which works globally but isn't optimal for the Quebec/Montreal-heavy fleet (7 Pis as of 2026-05-07). RainViewer's North American composite is downstream of the same MSC GeoMet feed that ECCC publishes directly, with extra latency and a ~10-min cadence. Two reasons to consider a Canadian-fleet switch:

- **Authority + freshness:** MSC GeoMet updates every **6 minutes** and is the source of truth (32 Canadian sites + the NA composite). RainViewer's tiles are 1-2 frames behind by the time they hit the kiosk.
- **Snow/rain separation:** MSC offers a dedicated `Radar_1km_SfcPrecipType` layer that distinguishes precipitation type — useful at the freezing line where RainViewer's intensity-only encoding can't tell.

**Trade-offs that make this not an obvious win:**
- **Different protocol.** MSC publishes via WMS (`geo.weather.gc.ca/geomet`) and OGC API (`api.weather.gc.ca`), not pre-rendered tile URLs. The Leaflet side is simple (`L.tileLayer.wms()` instead of `L.tileLayer()`), but it shifts rendering load to a server-side that may have less aggressive caching than RainViewer's CDN.
- **Custom pixel encoding.** [`server/radarAnalyzerCtrl.js`](server/radarAnalyzerCtrl.js) decodes RainViewer's intensity-encoded palette pixel-by-pixel to feed the tier/trend/AlertBanner pipeline. Migrating that to MSC requires either re-decoding their dBZ palette, or (cleaner) switching to MSC's OGC API Coverages for raw precipitation-rate values — a few hours of work, not a find-and-replace.
- **Shorter history window.** MSC keeps ~3 hours of frames; the 45-min trend computation (now / -15 min / -45 min) fits but loses head-room compared to RainViewer's similar span.
- **No documented nowcast.** RainViewer ships 3 short-range forecast frames (`radar.nowcast`) that drive the timeline scrubber's amber "+10 / +20 / +30 min" portion. MSC has extrapolation layers but their frame count and prediction horizon aren't documented the same way; the timeline UX would need a fallback story for ECCC users.
- **No API key needed**, attribution required (*"Canadian radar data was provided courtesy of Environment Canada"*).

**Suggested phased approach:**

- **Phase A — overlay-only opt-in (~30-45 min):** add a `radarSource` preference (`rainviewer` (default) / `eccc`) in Settings → Advanced. When `eccc`, the Leaflet layer uses `L.tileLayer.wms()` against `geo.weather.gc.ca/geomet` with `RADAR_1KM_RRAI` (rain) — winter-time snow swap is a stretch goal. **The server-side analyzer keeps using RainViewer regardless**, so tier/trend/alerts stay on the same data path. Bonus: 6-min visual freshness on the kiosk's view of "what's happening right now". Risk: low — purely visual, easy to revert.

- **Phase B — analyzer port (~3-4 h, deferred):** rework `radarAnalyzerCtrl.js` to consume MSC's OGC API Coverages endpoint for raw precipitation-rate values, with automatic source-selection (ECCC for users in Canada per `req.ip` geolocation, RainViewer everywhere else). Trend window shrinks to fit MSC's 3-hour history; nowcast frames either drop entirely or pull from RainViewer in a hybrid (TBD). **Phase B should only be tackled after Phase A has proven the visual layer works smoothly on the Canadian kiosks for at least a few weeks of varied weather** — the user-visible benefit (snow/rain separation, marginally better trend authority) needs to be evidenced before committing to a refactor of the pipeline that powers every alert decision.

### 🏔️ MapTiler `outdoor-v4` as a 5ᵗʰ map style option
Visual PoC against the maintainer's free-tier MapTiler key (May 2026, see [`maptiler-cloud-plan-b.md`](maptiler-cloud-plan-b.md) for full details) flagged `outdoor-v4` as a genuine new capability rather than a parallel to existing tiles. It surfaces lake names, terrain features, and outdoor POIs that Mapbox doesn't expose on its free tier — useful for users in rural / cottage / mountain settings (e.g. Laurentides, Estrie) where the radar is the secondary concern and the basemap itself is the primary spatial reference.

The integration is incremental, not a migration:
- Add `mapTilerApiKey` to the optional API-key set (alongside Anthropic / AirNow / OpenAQ patterns; prompted by `install.sh`)
- Server `proxyCtrl.js` grows a second tile-source selector (`mapbox` (default) / `maptiler`) with its own `ALLOWED_STYLES` and the matching upstream URL — keys still kept off the client
- Settings → Advanced → Display gets a new `mapStyle` value (5ᵗʰ option after `streets-v12` / `light-v10` / `light-v11` / `dark-v10` / `dark-v11`): `outdoor-v4`. The light/dark toggle becomes irrelevant for this option since `outdoor-v4` doesn't have a dark variant — UI gracefully hides the dark/light split when this style is active.
- Cream `--light-panel-bg-rgb` may need a third value tuned against `outdoor-v4`'s palette (the current cream is calibrated against `streets-v12`'s warm green-beige); empirical pass when the option ships.

Effort estimate ~2-3 h. Free tier covers the fleet comfortably (100k tile requests / month, our usage is ~30k for 7 Pis). Free tier forbids commercial use, which is fine for the project's hobbyist scope; document this in the new option's Settings hint so it's not a surprise.

The other MapTiler styles tested in the PoC (`streets-v4`, `base-v4`, `hybrid-v4`) are not worth shipping individually — they're either redundant with what Mapbox already gives us or too sparse / niche for the kiosk use case.

### ✅ ~~Precipitation motion arrows on the radar~~ — **shipped May 2026**
Implementation chose the ring-sample-point variant rather than a dense field over the whole visible map: the server-side radar analyzer already samples 16 directions × 10 distances on the inner ring (5–50 km) and optionally 32 directions × 10 distances on the outer ring (55–100 km) when `extendedRadius` is on. Each sample point carries a direction-of-motion vector derived from the 13 RainViewer frames the analyzer already pulls. The client renders the vectors as small Leaflet arrows at those sample points, surfaced behind a dock toggle (wind-gusts icon, `showDirectionArrows` state in AppContext). The toggle is greyed out when `radarAnalysisEnabled` is off (no rings = no sample points = nothing to show).

**Why this variant rather than the dense-grid mock**: the dense grid would have competed with the radar tile layer for attention everywhere; pinning the arrows to the ring sample points keeps them clustered around the user's location where the at-a-glance "from which direction" question actually matters. Lower visual cost, comparable signal.

**Future enrichment (separate item)**: surface a *single* aggregate arrow per ring (8-direction wind-rose-style summary of "predominant arrival vector") for users who find the per-sample-point density too busy. Effort: ~1-2 h, all client-side.

### 🥧 Angular-sector risk colouring (v3 — utility to validate before building)
Building on v2, divide each ring into the 8 angular sectors that match the sample directions (N / NE / E / … / NW) and tint each sector with the colour of the worst-case intensity among its radial samples. This adds a *direction-of-risk* dimension that the single-colour ring can't surface in one glance — "the storm is in the SW quadrant" instead of just "there's a storm somewhere on the ring". Optional 16-sector mode reuses `doubleOuterPoints` for the outer ring.

- **Implementation**: client-side. Server contract extends from `{ level }` to `{ level, sectors: [{ direction, level }] }` for each ring. Leaflet `Polygon` per sector, low opacity fill (~10-15%) so the radar tiles stay readable underneath.
- **Utility check before shipping**: the radar tile layer already shows precipitation with much higher spatial resolution than 8 sparse sample points. The benefit of the sector overlay is only the *quick directional read* — needs to be validated against real use ("would I have looked at this and known the storm was in the SW faster than just glancing at the radar?") before committing to the visual complexity. Risk: pie-slice tinting on top of radar tiles competes for attention rather than adding signal.
- **Decision gate**: build a static mock first (hand-coloured sectors over a screenshot), test on the 7" kiosk, and only proceed to wiring up live data if the mock genuinely improves at-a-glance reading.

### ✅ ~~Severe weather alerts (NWS + ECCC)~~ — **shipped May 2026**
NWS and ECCC sources are live: `GET /api/weather-alerts` runs both in parallel (skipped per-source by national bbox), normalises CAP severity to the existing yellow/orange/red tier vocabulary, and sorts by severity. The client `<AlertBanner>` now lets an orange/red government alert outrank the radar-derived tier with its localised event title plus a `[NWS]` / `[ECCC]` badge. ECCC's bbox filter on the GeoMet pygeoapi instance is non-functional — strategy is fetch-all-Canadian-alerts (≤50 features) + local point-in-polygon, cached 5 min server-side. MeteoAlarm and the takeover overlay design remain open below.

### ⚠️ MeteoAlarm (Europe) as the third government alerts source
Same source-module shape as NWS / ECCC, but the geographic-filter story is harder than the original roadmap entry implied. Dug into it on 2026-05-04 and surfaced two real obstacles before any code:

- **Modern EDR API** (`api.meteoalarm.org/edr/v1/collections/warnings`) returns GeoJSON with bounding-box geometry, but the FAQ explicitly gates it on "MeteoAlarm Members and Re-distributors" — i.e., a registered commercial relationship. Not viable for a hobby kiosk.
- **Legacy Atom feeds** (`feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-{country}`) are public, no key, CC-BY-4.0, but **alerts are identified by EMMA region code (`AT408` = Grieskirchen) with no polygon embedded** — verified by sampling Austria + the linked CAP XML. To filter for a user at lat/lon we'd need a separate EMMA-code → polygon dataset bundled server-side (closest open mapping is Eurostat NUTS-3, ~2-5 MB GeoJSON, ~38 countries × administrative-tier matching). Substantial integration cost for a feature with no current European users.

**When this becomes worth shipping**: a European user appears, OR we want to invest in the NUTS-3 dataset for a future location-favorites feature that would also benefit. Until then, ECCC + NWS already cover the deployed fleet, and the radar-derived banner is the global fallback for everything else.

**Country-level-only fallback** (a "is *anything* active in Italy?" mode) is technically possible without polygons but produces unacceptable false-positive rates (a thunderstorm warning in Sicily alerting a kiosk in Milan) — explicitly rejected as a path.

### 🚨 Critical-tier severe-alert takeover overlay
The shipped May 2026 banner integration is the light-touch path: a coloured strip with title + source badge, sharing space with the rest of the InfoPanel. For genuinely critical alerts (tornado warning, tsunami warning, evacuation order) the right UX is more than a strip — a full-screen takeover that someone walking by from the next room cannot miss. Hooks into the existing `govAlerts` payload (it already carries `severity: "extreme"` and the full `description_en/fr` body); only the rendering needs design + code.

> **Design-first.** Visual language (colour, typography, iconography, motion, dismissal affordance) is the entire UX — the goal is "you cannot miss this" without crossing into "annoying", and that line is purely a design judgment. Mock in [Claude Design](https://claude.ai/design) before coding. Save to `docs/design-references/severe-alert-overlay.html`.

> **Historical note — Tomorrow.io is not a viable source.** We attempted `/v4/events` first (May 2026); that endpoint expects user-defined insight rule UUIDs from the dashboard, not a global feed of government alerts. Tomorrow.io does not expose a free, plug-and-play "official alerts" feed.

### ✅ ~~OpenAQ as the global air-quality fallback~~ — **shipped May 2026**
Global coverage (~150 countries) of government-monitoring stations live via a free per-install API key. The source converts raw concentrations to EPA-canonical units and applies the official EPA AQI breakpoint formula per supported pollutant (PM2.5, PM10, O3, NO2, SO2, CO) since OpenAQ v3 publishes raw values rather than pre-computed AQI; new `epaAqiFromConcentration` helper in `_shared.js` is reusable for any future source that ships raw pollutants. Slots into the orchestrator's parallel batch — the closest-wins picker handles border zones naturally (a kiosk just inside Mexico picks OpenAQ at 10 km over AirNow at 80 km across the US border).

> **Heads-up on the v2-vs-v3 trap.** Earlier roadmap text claimed OpenAQ was "no-key" — that was the v2 API. v3 (current since 2024) requires `X-API-Key` per request. Keep the per-install-key mental model when discussing AQI sources going forward.

### 🌼 Pollen badge for allergy-aware users
A fourth badge in the UV / AQI row showing tree / grass / weed / ragweed pollen levels — useful for the chunk of the audience who treat pollen counts the same way others treat AQI. Tomorrow.io exposes `treeIndex` / `grassIndex` / `weedIndex` in its Pollen data layer, but that layer is paid-only (same gate as `epaIndex` was for AQI before AirNow / OpenAQ shipped), and the kiosk owner is on the free tier — so the right path is the same as the AQI chain: free public APIs, per-install opt-in.

- **Source:** [Open-Meteo Air Quality API](https://open-meteo.com/en/docs/air-quality-api) — free, no API key, returns `alder_pollen`, `birch_pollen`, `grass_pollen`, `mugwort_pollen`, `olive_pollen`, `ragweed_pollen` in grains/m³ (CAMS European scale). Coverage is solid for Europe (CAMS native) and acceptable for North America via the global GEOS-CF model — finely-resolved metro areas like Montréal and Paris read well; remote regions read worse but still better than nothing.
- **Implementation:** new `server/pollenSources/openmeteo.js` exposing `tryPollen(lat, lon)` at the same contract shape as the AQI sources (normalised payload with per-allergen index + a worst-case category for the badge colour). New `GET /api/pollen?lat&lon` endpoint, client `<UvAqiBadges>` extends to a third badge "POLLEN" (or 4th, if we keep UV separate) gated by an opt-in toggle in Settings — pollen is seasonal and audience-specific, so default-hidden is the right floor. Reuse the click-for-details pattern from item below to surface the per-allergen breakdown when the user taps the badge.
- **Effort:** ~2-3h once the click-for-details overlay (item below) is in — the source itself is a one-call fetch + category mapping (same shape as MELCC RSQAQ), the UI is the larger piece.
- **Caveat:** the EPA-AQI vocabulary doesn't apply to pollen — the badge would use Open-Meteo's own scale (low / moderate / high / very high) or a translated 4-tier mapping. Worth confirming the colour scale before implementing so it doesn't visually conflict with AQI's worst-case-red coding.

### 🖱️ Click-for-details overlay — partially shipped (badges still open)

**Shipped May 2026** — the AlertBanner → detail expansion is live for both gov sources (NWS + ECCC). The `<AlertDetailInline>` slab pinned under the banner exposes the full localised `description_en/fr` + a QR code that opens the upstream alerts page on the user's phone, and as of v2.16.6 the slab is allowed to grow to its natural content height (rail-scroll picks up the rest) so verbose multi-paragraph ECCC alerts read in one go.

**Still open** — the *badge-side* of this same pattern: a unifying `<DetailsPopover>` for the UV / AQ / future Pollen badges that turns glance-only chips into glance + tap-for-details. Specifically:
- **UV badge** — could expose the WMO category description (e.g. *"6 — Élevé: protect skin"*) plus a 24 h UV curve preview from `hourly.uv_index`.
- **AQ badge** — AirNow and OpenAQ track all six pollutants internally but only expose the worst-case one. Per-pollutant breakdown + station name + measurement age would surface that richer data without changing the badge itself.
- **Pollen badge (when shipped)** — per-allergen breakdown (alder / birch / grass / mugwort / olive / ragweed) from Open-Meteo's allergen-by-allergen payload.

- **Server changes:** `/api/air-quality` extends to optionally include the per-pollutant breakdown when the source has one (AirNow + OpenAQ; MELCC and ECCC stay single-value). `/api/weather-alerts` description fields are already in the payload — no change there.
- **Client:** a shared `<DetailsPopover>` shell with content slots per badge type. Backdrop click + Esc to close. Reuses the popover affordance already proven by the HealthIndicator dot.
- **Effort:** ~3 h. Mostly client-side; the server tweak for the pollutant breakdown is ~30 min.

### 👀 Acknowledge-and-dismiss on alerts
"I've seen this, hide it for now" pattern. Stored as `localStorage`-keyed alert IDs with their `expiresAt`, so dismissed alerts auto-purge when they expire upstream. Two design rules need agreement before coding:

- **Resurface on severity bump?** A dismissed orange-tier alert that escalates to red should re-show — losing visibility on a real escalation is the worst-case UX.
- **Auto-resurface after N hours?** A "set-and-forget" kiosk where someone dismisses a tornado warning and the kiosk goes silent for the rest of the storm is dangerous. Suggested floor: `dismiss = hide for max(4h, until severity rises)`.

The pattern composes cleanly with the click-for-details overlay above (the popover is the natural place to put the "Vu" button).

### 🌙 Moon phase + upcoming solstice/equinox marker
A small inline addition to the InfoPanel rather than a dedicated astronomy view: a moon-phase glyph (🌑 → 🌕 → 🌘) shown alongside the existing sunrise/sunset row, plus a transient mini-marker that surfaces the next solstice or equinox **only when within ~14 days of it** (e.g. *"Spring equinox in 8 days"*). Both computed locally — no API, no token cost, no quota.

- **Moon phase** : Conway's lunar-age approximation (~5 lines of math) → fraction 0-1 → choose one of 8 Unicode glyphs. Accuracy: ±1 day, easily good enough for a casual readout. Refresh once per UTC day (the phase moves slowly — no need for the polling cadence used elsewhere).
- **Solstice/equinox upcoming** : Meeus chapter 27 formulas for the four annual events (March equinox, June solstice, September equinox, December solstice) — accurate to within seconds for any year in the 1000-3000 range. Compute the next one at startup, hide the marker outside the 14-day window, surface it as a small italic line under the existing sunrise/sunset row when inside.

The full "Earth orbiting the Sun, day-length curve, axial-tilt animation" companion view originally scoped here feels too rich for the weather-station InfoPanel — better as a separate companion app rather than a competing view inside the main one. The visual prototype at [`docs/design-references/solstices-equinoxes.html`](design-references/solstices-equinoxes.html) (saved May 2026 via [Claude Design](https://claude.ai/design)) stays in the repo as a reference for that future spinoff.

### 🌡️ Local GPIO sensors (DHT22 / BME280)
This is the item that most clearly differentiates a Pi weather station from any commercial weather app. Connecting a temperature and humidity sensor directly to the Pi's GPIO pins would allow the app to display the **actual conditions in the room** alongside the external forecast. A lightweight server-side poller (every 30 seconds) reading from the sensor via a Node.js GPIO library would feed a new panel section or a prominent badge on the CurrentWeather block. No external API call, no quota, no latency.

### 🔆 Brightness control via DDC/CI for HDMI monitors
The current brightness slider (v2.10.x) only works on devices that expose a backlight via `/sys/class/backlight/*` — i.e. the official 7" DSI screen and the EDATEC ED-HMI3010-101C all-in-one. HDMI monitors on the Pi 5B and CM5 currently hide the slider entirely. Adding a `ddcutil` back-end would extend coverage to any HDMI monitor that supports DDC/CI, including the planned EDATEC ED-MONITOR-101C (10.1" industrial, 500 nits, DDC/CI confirmed in its datasheet).
- **Server**: `getBrightness()` / `setBrightness()` factored into two back-ends (`sysfs`, `ddcutil`) with auto-detection at startup. `ddcutil detect` is slow on first call (~500 ms i2c probe) — cache the result. Writes via `ddcutil setvcp 10 <pct>` (~200-400 ms each); the existing 250 ms client debounce should absorb that, to be confirmed on hardware.
- **Install**: `install.sh` adds `ddcutil` to its package list, ensures the `pi` user is in the `i2c` group, and verifies `dtparam=i2c_arm=on` is active in `/boot/firmware/config.txt` (default on recent RPi OS, but worth checking).
- **Client**: zero changes — the API contract (`GET /api/brightness` returns `{available, percent, ...}`, `POST` accepts `{percent}`) is back-end-agnostic.
- **Validation**: required before merging — some monitors advertise DDC/CI but implement it incorrectly. Test on the actual ED-MONITOR-101C unit before shipping.

### 🖥️🖥️ Dual-monitor kiosk (per-screen target + two-instance display)
A Pi 4B / 5 with two HDMI outputs can drive two screens, but the current `start-server` launcher assumes a single primary display and lets the compositor pick which one. Two related capabilities to bring under the project's autostart machinery:

- **Pick which monitor the kiosk lands on** — useful when one HDMI is the kiosk display and the other is a developer monitor or a second app's screen. Setting shape: a `KIOSK_MONITOR=HDMI-A-2` line in `~/.config/pi-weather-station/browser.conf` next to the existing `BROWSER_CMD` / `BROWSER_FAMILY`. `start-server` resolves the named output via `wlr-randr --json` (Wayland — the default on Pi OS Bookworm/Trixie with labwc) or `xrandr --listmonitors` (X11, older deployments), translates to `--window-position=X,Y --window-size=W,H`, and passes those to Chromium / Firefox.

- **Two kiosk instances, one per screen** — for setups where both screens display the weather kiosk (mirror or different views). Two technical gotchas:
  - **Chromium singleton lock** — by default the second `chromium --kiosk` invocation just signals the first instance and doesn't open a new window. Workaround: distinct `--user-data-dir=$HOME/.config/chromium-screen{1,2}` per process so each gets its own `SingletonLock`. The hostname-aware lock cleanup that v2.10.x added to `start-server` needs to apply per-profile.
  - **Wayland window-positioning is best-effort** — the compositor has the last word. labwc and wayfire honour `--window-position` reliably; some others ignore it and require compositor-level rules (`labwc-window-rules` etc.). On X11 it's deterministic.

**UX setting shape**: `KIOSK_MONITOR_MODE` = `single` (default, today's behaviour) / `mirror` (same URL on both screens) / `dual-view` (two screens, two URLs — e.g. `?view=current` and `?view=radar`). `dual-view` would compose with the existing small-screen layout adaptations: a `?view=radar` query param could hide the InfoPanel and let the radar fill the screen, mirroring what the InfoPanel-collapse toggle already does on small screens.

**Hardware floor**: Pi 4B 4 GB+ minimum for two Chromium instances. Pi 3B+ / Zero are not viable for 24/7 dual-kiosk.

**Effort**: ~3-5 h proper, mostly bash/systemd plumbing in `start-server` + `install.sh` + `browser.conf` schema + a small client query-param handler for `dual-view`. Risk concentrated on the Wayland-positioning compatibility check across the labwc / wayfire / lxsession variants Pi OS ships.

> Origin: 2026-05-07 question from the user about dual-monitor support. No active deployment depends on this today; capture for the moment a 2-screen Pi shows up in the fleet.

---

## Long term — if the project grows

These items have real value but require a more significant investment.

### 🔔 Browser push notifications (severe weather)
If the Pi also serves remote clients on the local network, the Web Push API could deliver severe weather alerts to those devices even when the browser tab is not active. Requires a service worker, VAPID key generation, and a subscription management endpoint.

### 🚪 Guided onboarding for first-run installs
Today, a fresh install dumps the user into the main UI with empty API key fields and no clear next step — they have to discover the Settings panel and figure out which keys go where. A guided onboarding flow (welcome → API key entry, one panel at a time → optional location override → "you're all set") would dramatically reduce the friction for new adopters. Not strictly necessary for the existing fleet, but a major polish item if the project grows.

> **Design-first.** Onboarding flows are 90% UX copy + visual hierarchy + animation timing — exactly what [Claude Design](https://claude.ai/design) is built for. Mock the full flow there before any React work; the implementation is a small state machine wrapping a few existing input components. Save to `docs/design-references/onboarding.html`.

### 📍 Location favorites
A small list of saved locations (home, chalet, work) that the user can switch between with a single tap. The map and all weather data would reload for the selected location. Useful for households that monitor multiple places regularly.

### ✅ Automated tests (Jest + React Testing Library)
There are currently no automated tests. Adding unit tests for the unit conversion functions (`services/conversions.js`) and integration tests for the key server endpoints would provide a safety net against regressions as the project grows. A GitHub Actions workflow running ESLint and the test suite on every push would complete the CI foundation.

### 💸 Anthropic prompt caching for the AI summary
The Claude Console's "Mise en cache" view flags that we're not using prompt caching today — the typical org sees 50–90 % input-cost reduction by adding a `cache_control` block to the request. For the current pi-weather-station profile, the math doesn't work out yet:
- The stable instructions in `aiSummaryCtrl.js` are ~300 tokens; Haiku's minimum cacheable prefix is **1024 tokens**, so we'd need to triple the system prompt before any of it became cacheable.
- The 5-minute default TTL is shorter than our **15-minute server-side response cache** (which already absorbs the bulk of the hits — same exact reply, no LLM call at all).
- A single Pi calls the API ~once / 15 min after the response cache expires, so the prompt cache would be cold every time anyway.

**When this becomes worth shipping**:
- The fleet grows to 10+ kiosks polling in parallel (same prefix shared across them within the 5-min cache window).
- We add a long structured system prompt (e.g. radar-classification reference, multi-shot examples) that crosses the 1024-token threshold and improves the summary quality enough to justify the addition.
- We add an interactive "ask Claude about this radar" feature that fires multiple requests in quick succession with a shared context block — a natural cache fit.

Until one of those triggers, the existing 15-minute response cache + Haiku's already-cheap pricing make this premature optimization. Not zero-value (5–10 % cost shave eventually), just dominated by the response cache today.

### 🔌 Offline mode / graceful degradation
A service worker caching the last known weather data and the compiled bundle would allow the interface to remain functional during brief internet outages — showing stale data with a clear timestamp rather than a blank panel.

---

## Maintenance & Deployment

### ✅ ~~Detect systemd service file changes during update~~ — **shipped April 2026**
`server/updateChecker.js` exposes `checkServiceFileChanged` which SHA-256-compares the installed `~/.config/systemd/user/pi-weather-server.service` against the upstream version on master, and the UpdateModal disables the auto-update button + shows a localised warning when they drift. Linux+systemd-only (returns null on macOS launchd or absent installed file). v2.8.1 also moved customisations like `ALLOW_REMOTE=true` into a drop-in (`pi-weather-server.service.d/local.conf`) so the canonical service file rarely actually drifts in practice.

---

## Technical debt

These are known weaknesses in the current codebase that do not affect functionality today but will slow down development or increase the risk of regressions if left unaddressed as the project grows.

### ✅ ~~JSDoc and PropTypes coverage on React components~~ — **resolved May 2026**
Audited via a regex pass over `client/src/`. All 54 top-level PascalCase symbols (components, exported helpers) carry a JSDoc block. PropTypes is declared on every component that takes props; the three components flagged as "missing PropTypes" by the audit (`HourlyChart`, `DailyChart`, `WeatherInfo`) take no props at all — they read everything from context — so PropTypes would have nothing to validate. ESLint rules `jsdoc/require-param` / `jsdoc/require-returns-description` continue to surface any future regression at build time.

### 📋 JSDoc coverage on server-side helpers (smaller, separate)
~24 % of server-side helpers lack a JSDoc block (~39/165 as of May 2026 — `proxyCtrl`'s cache helpers, `debugCtrl`'s parsers, several `aiSummaryCtrl` cache lookups, validators in `indoorTempCtrl`, etc.). Most are short internal helpers where JSDoc would only state the obvious (`isValidTemperature(c)`, `getCacheKey(lat, lon)`), so this isn't urgent. The bigger ones (`replaceSettings`, `fetchProviderStatus`, `parseStatuspage`, `getNetworkInfo`) would benefit from a JSDoc block describing their failure modes and side effects — incremental fill-in pass when touching those files for other reasons is the pragmatic approach. No need for a dedicated audit session.

### 🔕 `eslint-disable-line` comments
Several `useEffect` hooks carry `// eslint-disable-line react-hooks/exhaustive-deps` comments to silence dependency warnings rather than restructure the logic. Each suppression is a hidden assumption about which dependencies are safe to omit. These should be reviewed one by one: either the dependency array should be corrected, or the suppression should be replaced with a documented `useRef`-based workaround that makes the intent explicit.

### ✅ ~~Version history duplicated between `readme.md` and `CHANGELOG.md`~~ — **resolved May 2026**
`readme.md` no longer carries any per-version section. The "Version history" block now contains a 3-line pointer to `CHANGELOG.md` and the GitHub Releases page, plus a short v1 → v2 ClimaCell note for users who land on the readme with an old API key. The matching policy line in `CLAUDE.md` was updated from "the existing ones will be trimmed over time" (an aspirational instruction nobody acted on) to "no per-version highlight sections in the readme at all" — explicit and enforceable.

### 🧪 No automated tests
There are no unit or integration tests. The highest-value starting points would be:
- Unit tests for `services/conversions.js` (pure functions, easy to cover)
- Integration tests for the Express endpoints most likely to break silently (`/settings`, `/api/weather/*`, `/api/update`)
- A GitHub Actions workflow running ESLint and the test suite on every push

Without tests, every change to shared utilities or server middleware carries an invisible regression risk.

### 🗂️ `AppContext.js` size and responsibility
`AppContext.js` currently holds all global state: settings, units, geolocation, dark mode, font size, panel state, and all update functions. As the project grows, this single file becomes harder to navigate and reason about. Splitting it into focused context providers (e.g. `SettingsContext`, `WeatherContext`, `UIContext`) would improve maintainability without changing any observable behaviour.

### 🪤 Two React anti-patterns surfaced by the React Compiler
Discovered 2026-05-07 when test-running `eslint-plugin-react-hooks@7.x` locally. Both are pre-existing bugs the v5 plugin doesn't catch:

- **`Math.floor(Date.now() / 1000)` called during render** in [`WeatherMap/index.js:408`](client/src/components/WeatherMap/index.js:408). The value feeds the timeline label computation and is consumed by downstream `useMemo` blocks — calling it during render makes those memos effectively non-stable (every render produces a fresh `nowSec`, defeating the memoisation). Fix: store `nowSec` in a `useState` with a `setInterval` ticking once per minute (or once per 10 s to match the radar frame cadence), so the value only changes on a real time tick rather than on every parent re-render.

- **Self-recursive `useCallback` reference before declaration** in [`WeatherInfo/index.js:91-98`](client/src/components/WeatherInfo/index.js:91). `restartCycle` calls itself inside its own `setTimeout` callback, which the compiler flags as a TDZ access. Works at runtime (the closure resolves at timer fire, not at definition), but is fragile and confusing. Fix: replace with a `useRef` that holds the latest scheduling function, or restructure as a `useEffect` that re-arms its own timeout on each tick.

Neither is a production bug today — both have been running on the deployed kiosk for months — but they're real fragility that will bite when we eventually touch those components. Worth fixing in a small dedicated PR rather than under the cover of an unrelated change.

### 🛠️ React Compiler readiness — `set-state-in-effect` cluster
The same `eslint-plugin-react-hooks@7.x` test surfaced **13 instances** of the new `set-state-in-effect` rule across:

- `WeatherMap/index.js` (8 sites — radar frame index initialisation, scrubber state resets, sample-cache invalidation)
- `App/index.js` (1 site)
- `WeatherInfo/index.js` (1 site — chart auto-cycle)
- `weatherCharts/HourlyChart/index.js` (1 site — chart data derivation from props)
- `weatherCharts/DailyChart/index.js` (1 site — same pattern as HourlyChart)

Most are the legitimate "compute derived state from props on change" pattern, which the React docs (and the new rule) recommend replacing with either:
- direct computation during render (when the cost is low), or
- `useMemo` / `useReducer` for expensive derivations, or
- a state-lifting refactor when the dependency truly belongs to the parent.

This is the gating debt for upgrading `eslint-plugin-react-hooks` past v6. The v5 plugin we're pinned to is still maintained, so there's no urgency — but if we ever want the v7+ improvements (skip-non-React-files perf, better Flow typing, ESLint v10 compat), the 13 sites need a coordinated refactor. Estimate: half-day session, with regression risk concentrated on the radar scrubber (which we just stabilised through PRs #33-#49).

### ✅ ~~Service-file customizations should live in a systemd drop-in, not the main unit~~ — **resolved in v2.8.1**
`install.sh` and `toggle-remote.sh` now write `ALLOW_REMOTE=true` into a drop-in (`pi-weather-server.service.d/local.conf`) instead of editing the main service file. The canonical `deploy/pi-weather-server.service` stays a clean upstream mirror, and the in-app updater's `serviceFileChanged` warning only fires on real upstream changes. `toggle-remote.sh` migrates legacy installs by re-commenting the leftover line on the next toggle.

### ✅ ~~Debug panel — graceful fallback for non-Pi platforms~~ — **shipped May 2026**
The Pi-throttle row (under-voltage / freq capped / throttled / temp limit) was already gated by `powerStatus?.available` and hides cleanly on non-Pi; CPU temp already reads from `/sys/class/thermal/thermal_zone0/temp` which works on x86 Linux too; fan-speed row already hides when no hwmon fan sensor is exposed. The remaining gap was the hardware identifier showing literal "Unknown" on x86 Linux deployments (VMware / openSUSE / Ubuntu desktop where `/proc/device-tree/model` doesn't exist and the macOS `sysctl hw.model` branch doesn't apply). Now falls back to `os.cpus()[0].model` (built-in Node, works on every platform), so x86 Linux dev boxes show their CPU brand instead of "Unknown" without changing the macOS or Pi paths.

---

## Perspective

The three items I would prioritize above all others if returning to this project:

1. **Radar animation** — transforms the map from a static snapshot into the most compelling feature of the kiosk; the data is already there, it is purely a UI problem.

2. **Sleep mode** — a device that runs 24 hours a day should protect its screen and go dark when no one is watching; this also makes the device feel intentional rather than like a forgotten browser tab.

3. **Local GPIO sensors** — displaying the real temperature of the room next to the outdoor forecast is something no commercial weather app can do; it gives the project a reason to exist as physical hardware rather than a web app on a tablet.

---

*Last updated: 2026-05-07 (added a medium-term entry for dual-monitor kiosk support — pick which screen the kiosk lands on + optionally drive two screens with one Chromium instance per output; ~3-5 h, gated on a Wayland-positioning sanity check across labwc/wayfire variants)*


