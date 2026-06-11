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
Building on v2, divide each ring into angular sectors (most likely 8 or 16, matching the standard compass rose) and tint each sector with the colour of the worst-case intensity among its radial samples. The current sampling geometry — 16 directions on the inner ring, 32 on the outer when `extendedRadius` is on — gives plenty of resolution for either sector count without further server-side knobs. This adds a *direction-of-risk* dimension that the single-colour ring can't surface in one glance — "the storm is in the SW quadrant" instead of just "there's a storm somewhere on the ring".

- **Implementation**: client-side. Server contract extends from `{ level }` to `{ level, sectors: [{ direction, level }] }` for each ring. Leaflet `Polygon` per sector, low opacity fill (~10-15%) so the radar tiles stay readable underneath.
- **Utility check before shipping**: the radar tile layer already shows precipitation with much higher spatial resolution than 8 sparse sample points. The benefit of the sector overlay is only the *quick directional read* — needs to be validated against real use ("would I have looked at this and known the storm was in the SW faster than just glancing at the radar?") before committing to the visual complexity. Risk: pie-slice tinting on top of radar tiles competes for attention rather than adding signal.
- **Decision gate**: build a static mock first (hand-coloured sectors over a screenshot), test on the 7" kiosk, and only proceed to wiring up live data if the mock genuinely improves at-a-glance reading.

### ✅ ~~Severe weather alerts (NWS + ECCC)~~ — **shipped May 2026**
NWS and ECCC sources are live: `GET /api/weather-alerts` runs both in parallel (skipped per-source by national bbox), normalises CAP severity to the existing yellow/orange/red tier vocabulary, and sorts by severity. The client `<AlertBanner>` now lets an orange/red government alert outrank the radar-derived tier with its localised event title plus a `[NWS]` / `[ECCC]` badge. ECCC's bbox filter on the GeoMet pygeoapi instance is non-functional — strategy is fetch-all-Canadian-alerts (≤50 features) + local point-in-polygon, cached 5 min server-side. MeteoAlarm and the takeover overlay design remain open below.

### ✅ ~~Alert tier maps on CAP `severity` alone — Watches can read as loud as Warnings~~ — **resolved 2026-06-08**
**Fixed** via `capWatchSeverity` in `server/govAlertSources/_shared.js` — a watch's normalised severity is capped at `moderate` (keyed off the event name, "…watch" / ECCC "veille"), so a CAP-`Severe` Flood/Tornado Watch lands on the **orange** tier (and the SeverityChip word becomes "Watch", since it re-derives from severity). Chose the "cap watches one tier down" option from the analysis below over the urgency/certainty approach — simpler, cross-source, and it keeps tier + chip + sort + SenseHat consistent in one place. Verified live (four KY/TN Flood Watches → orange). Regression suite `test/watchTier.test.js`. *Original analysis kept below for context.*

Surfaced 2026-06-05 from a live 3-alert stack over Lavaca County, TX: a **Flood Watch** (`FA.A`) came back tagged CAP `severity: Severe`, which `severityToTier()` mapped straight to **red** — visually identical to the co-active **Flash Flood Warning** (`FF.W`, also `Severe`). But a Watch means "conditions are favourable" (typically `urgency: Future`, `certainty: Possible`) while a Warning means "happening now / imminent" (`urgency: Immediate`, `certainty: Observed/Likely`). Mapping on `severity` alone discards that distinction, so a Watch can shout as loudly as a Warning on the banner **and** the SenseHat pulse.

**Options to weigh (decision before code):**
- **Cap Watches one tier below their severity** — a `Severe` Watch → orange, never red. Simple, predictable, honest about the watch/warning gap. Cheapest path: key off the VTEC significance letter (`.A` = watch) or the event name suffix.
- **Factor in `urgency` / `certainty`** — demote any alert whose `urgency` is `Future` or `certainty` is `Possible`. More principled and covers non-flood events too, at the cost of a bit more logic in `normalize` / `severityToTier` (`server/govAlertSources/_shared.js`).
- **Leave it** — the kiosk's posture is safety-first, and "a serious Watch looks serious" may be the desired behaviour. Counter-argument: red is the colour the user has learned means *act now*; crying red on a Watch erodes that signal over time.

Low complexity (a few lines in `_shared.js` plus the severity→tier regression test in `test/`). The weight is the **product decision**, not the implementation. Whatever is chosen propagates uniformly — the banner, `GovAlertDetail`, the map overlay, and the SenseHat pulse all read the same `tier`.

### ⚠️ MeteoAlarm (Europe) as the third government alerts source
Same source-module shape as NWS / ECCC, but the geographic-filter story is harder than the original roadmap entry implied. Dug into it on 2026-05-04 and surfaced two real obstacles before any code:

- **Modern EDR API** (`api.meteoalarm.org/edr/v1/collections/warnings`) returns GeoJSON with bounding-box geometry, but the FAQ explicitly gates it on "MeteoAlarm Members and Re-distributors" — i.e., a registered commercial relationship. Not viable for a hobby kiosk.
- **Legacy Atom feeds** (`feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-{country}`) are public, no key, CC-BY-4.0, but **alerts are identified by EMMA region code (`AT408` = Grieskirchen) with no polygon embedded** — verified by sampling Austria + the linked CAP XML. To filter for a user at lat/lon we'd need a separate EMMA-code → polygon dataset bundled server-side (closest open mapping is Eurostat NUTS-3, ~2-5 MB GeoJSON, ~38 countries × administrative-tier matching). Substantial integration cost for a feature with no current European users.

**When this becomes worth shipping**: a European user appears, OR we want to invest in the NUTS-3 dataset for a future location-favorites feature that would also benefit. Until then, ECCC + NWS already cover the deployed fleet, and the radar-derived banner is the global fallback for everything else.

**Country-level-only fallback** (a "is *anything* active in Italy?" mode) is technically possible without polygons but produces unacceptable false-positive rates (a thunderstorm warning in Sicily alerting a kiosk in Milan) — explicitly rejected as a path.

### 🗺️ Continental alert polygons overlay (AccuWeather « Avis des autorités publiques »)
**Exploration only — not scheduled.** A toggle that overlays every active ECCC + NWS alert polygon on the map (tier-coloured). Phase 4d already renders the polygon for the user's active alert; this is the much-larger ambition of showing the entire continent at once. Detailed implications, phasing, and open design questions captured in [`docs/alert-polygons-overlay-exploration.md`](docs/alert-polygons-overlay-exploration.md). **Scope refined 2026-05-28 PM toward an optimized-first path** after decomposing the ECCC↔NWS payload disproportion (~50×): NWS `?event=` + `?severity=` + server-side trim + `turf.simplify` knock the payload from 5-20 MB down to 300-800 KB and the polygon count from 1000-2000 down to 100-300, making the MVP viable on Pi 4 without the V2 zone-resolution detour. ~9-10 h MVP→V3 total, but MVP usable at 4-5 h. Mutual-exclusivity with RainViewer (Mode A/B) reopened as a question — at the new polygon count, an outline-only overlay co-existing with radar may be viable.

### 🧭 Nearby alerts — configurable-radius overlay (display-only)
**Design validated and fully specced (2026-06-05/07); ready to build. Background + worked example in [`docs/nearby-alerts-overlay-proposal.md`](docs/nearby-alerts-overlay-proposal.md).** A deliberately de-scoped sibling of the continental overlay above: instead of the whole continent, an on-demand layer paints the active NWS/ECCC alert polygons within a **user-configurable radius** of the user's location, leaving the point-based trigger path (banner, `GovAlertDetail`, SenseHat, eligibility) completely untouched.

**Origin (2026-06-05).** Surfaced from a debugging thread with an AllStarLink / [SkywarnPlus](https://github.com/Mason10198/SkywarnPlus) user (k5map): he heard a Flood Advisory on his ham node but saw nothing on the kiosk. Root cause was **not a bug** — SkywarnPlus queries NWS by **county code** (anything touching the whole county), while we query `?point=lat,lon` (only alerts whose polygon covers the exact point). After reading the proposal he asked for a **user-settable radius** ("keep everything else the same"), rejecting county/state scope as too coarse (NW corner of large Harris County, ~30 mi from its SE corner). That shaped the design below.

**Finalised design (decisions locked):**

*Data / fetch (server)* — New `GET /api/nearby-alerts?lat&lon&radiusKm`. **US: fetch by state** (`?area=XX`), state(s) resolved from the circle's bounding-box corners (1 typical, 2 at a border corner), then filtered locally to the circle. **Canada: reuse the existing all-Canada ECCC feed.** Chose state-fetch over zone-enumeration (no bbox param on the alerts API; zone-enumeration needs the full ~3800-zone geometry set — not worth it). Accepted cost: a US-outbreak state payload (5–20 MB) is parsed before the radius cull → a transient (not retained) heap spike to glance at on first field test. New pure helper `circleIntersectsPolygon()` in `_shared.js` (bbox pre-test + vertex/edge/center math) — **hand-rolled, no turf.js/geolib** (deliberate footprint decision; guard in review), unit-tested via `__test` + `node --test`. Cache keyed on (rounded lat, lon, radiusKm), ~5-min cadence. Zone-only alerts (no polygon, rare — `nws.js` already resolves `affectedZones`) → **omitted from the map** + a "+N not mapped" legend note.

*Activation + radius* — **Layer on/off**: a new BottomDock toggle in the "Map" group (clones the arrows/legend idiom), `localStorage` per device, **OFF by default**, gated behind the existing `radarOverlaysDisabled` check. **Radius**: a `RangeSlider` in Settings → Advanced → new "Nearby alerts" subsection; stops = the existing radar ladder (**km 50/60/70/80/90/100**, **mi 30/36/42/48/54/60**); canonical `alertRadiusKm` stored server-side at `advanced.alerts.radius` via the debounced PATCH + **`buildAdvancedSubtree`**; slider bounds/label derived per render from the mi/km preference. **Default 50 km / 30 mi** (quietest; power users widen).

*Radius = a persistent 3rd ring* — When ON, the chosen radius draws as a **persistent blue/cyan dashed circle** (palette-aware), distinct from the tier-coloured radar risk rings at 50/100 km. The three circles **coexist**; on exact overlap (50/100) the alert ring is **offset ~1 px**. **Live update on desktop** while dragging; on the Pi it redraws on release (the ring is persistent context, so no panel auto-collapse). Legend line "alert radius: 70 km".

*Tap on a polygon* — **1 alert**: lightweight native Leaflet popup — `SourceBadge` + `SeverityChip` (the tier-coloured WORD, also disambiguating the Flood-Watch-is-red trap) + localized title + one "Re-center here" button (→ existing point-based banner + `GovAlertDetail`). **N overlapping**: same popup, body = compact scroll list (AlertMiniCards grammar, severity-desc then expiry, capped ~40 vh), header "N alerts here", one "Re-center here" per row. Uses a NEW `surveySelectedAlertId` — NOT `highlightedAlertId` (which auto-zooms and is cleared against eligibility; reuse would couple the survey to the trigger path).

*Glance* — **Count badge** on the dock toggle: number of alerts in the radius, coloured to the **worst tier present**, no badge at zero, counts **everything** (no tier filter). The count feeds NOTHING (display-only firewall). **Co-display, never exclusive** — radar + rings + arrows + polygons + radius ring all render together (the existing 2px/0.15-fill style was already tuned for radar co-existence; RainViewer's app does the same). Tier key appended to `RadarLegend` when ON.

*Hardware / footprint (verified 2026-06-07)* — **Does not raise the hardware bar** on any model; the binding constraint stays the existing Chromium + radar-Leaflet workload. Pi 4/5 comfortable; Pi 3 not limited by this feature. **< 1 MB RAM** (only when ON; OFF = 0), **~10–25 KB on the SD card, zero `node_modules` growth** (no new dep). In-memory cache → no new SD writes.

**Relationship to the continental overlay (above).** The conservative, shippable MVP of that ambition. The radius cap keeps polygon counts small, so the continental open questions evaporate (no Mode A/B exclusivity — co-display confirmed fine; no ECCC dedup / `turf.simplify` / differential-cache). RainViewer's app ships a global alert layer but does **not** expose it via its public API (radar tiles only), so we build on `api.weather.gov` + ECCC regardless. If this proves useful, the continental view is the natural next step on the same path.

**Open question (confirm with k5map before building).** The whole design is **display-only** (radius = what you *see*). His "keep everything else the same" points that way, but worth one explicit check that he wants radius-to-**see**, not radius-to-**alert** (the latter changes the trigger path — a different, larger feature).

**Effort:** backend ~1 day (endpoint + state resolution + `circleIntersectsPolygon` + test), frontend ~1.5 days (toggle + count badge, GeoJSON layer + radius ring, popup reusing ambient components, the Advanced slider, legend). Docs: `docs/api.md` (new endpoint) + `CHANGELOG.md` + trilingual i18n keys.

### 🚨 Critical-tier severe-alert takeover overlay
The shipped May 2026 banner integration is the light-touch path: a coloured strip with title + source badge, sharing space with the rest of the InfoPanel. For genuinely critical alerts (tornado warning, tsunami warning, evacuation order) the right UX is more than a strip — a full-screen takeover that someone walking by from the next room cannot miss. Hooks into the existing `govAlerts` payload (it already carries `severity: "extreme"` and the full `description_en/fr` body); only the rendering needs design + code.

> **Design-first.** Visual language (colour, typography, iconography, motion, dismissal affordance) is the entire UX — the goal is "you cannot miss this" without crossing into "annoying", and that line is purely a design judgment. Mock in [Claude Design](https://claude.ai/design) before coding. Save to `docs/design-references/severe-alert-overlay.html`.

> **Historical note — Tomorrow.io is not a viable source.** We attempted `/v4/events` first (May 2026); that endpoint expects user-defined insight rule UUIDs from the dashboard, not a global feed of government alerts. Tomorrow.io does not expose a free, plug-and-play "official alerts" feed.

### ✅ ~~OpenAQ as the global air-quality fallback~~ — **shipped May 2026**
Global coverage (~150 countries) of government-monitoring stations live via a free per-install API key. The source converts raw concentrations to EPA-canonical units and applies the official EPA AQI breakpoint formula per supported pollutant (PM2.5, PM10, O3, NO2, SO2, CO) since OpenAQ v3 publishes raw values rather than pre-computed AQI; new `epaAqiFromConcentration` helper in `_shared.js` is reusable for any future source that ships raw pollutants. Slots into the orchestrator's parallel batch — the closest-wins picker handles border zones naturally (a kiosk just inside Mexico picks OpenAQ at 10 km over AirNow at 80 km across the US border).

> **Heads-up on the v2-vs-v3 trap.** Earlier roadmap text claimed OpenAQ was "no-key" — that was the v2 API. v3 (current since 2024) requires `X-API-Key` per request. Keep the per-install-key mental model when discussing AQI sources going forward.

### ✅ ~~Pollen badge for allergy-aware users~~ — **shipped May 2026 (v2.16.x)**
Open-Meteo Air Quality API (free, no key) feeds a 5th cell in MetricsGrid covering the six standard allergens (alder / birch / grass / mugwort / olive / ragweed). Opt-in via `advanced.pollen.enabled` in Settings (default OFF). Server normalises into worst-case + per-allergen array; client renders col-span 2 cell with the click-for-details popover showing the full breakdown colour-coded by tier. Caveat noted in the docs: CAMS coverage is strong for Europe, sparse for North America — the cell hides silently when all allergens are null.

### ✅ ~~Click-for-details overlay on badges and the AlertBanner~~ — **shipped May 2026 (v2.16.x)**
- **AlertBanner / AlertDetailInline** — the slab pinned under the banner exposes the full localised `description_en/fr` + a QR code that opens the upstream alerts page on the user's phone, and grows to natural content height so verbose multi-paragraph ECCC alerts read in one go.
- **`<DetailsPopover>` shared component** — anchored to the parent cell with left/right edge selection so the popover stays inside the rail regardless of which column the cell lives in. Backdrop click + Esc + tap-on-trigger all close cleanly (the `triggerRef` prop prevents the pointerdown-close + click-reopen flash). Discoverable via a small ⓘ hint icon in the top-right of interactive cells.
- **UV cell** — popover shows the WMO category description ("Faible / Modéré / Élevé / Très élevé / Extrême") + per-tier skin-protection guidance.
- **AQ cell** — popover shows value + tier + station name & distance + source label + reading type (observation / forecast / NowCast) + pollutant code.
- **Pollen cell** — popover shows worst-case allergen + per-allergen breakdown colour-coded by tier.

**Future enrichment (separate item)** — the AQ popover currently shows the single dominant pollutant the server returns. AirNow and OpenAQ both track all six pollutants internally; surfacing the full per-pollutant breakdown would require a small server change (extend `/api/air-quality` to return the array). ~30 min of server work + 30 min UI. Not urgent — most users only need the worst-case readout the badge already shows.

### ✅ ~~Acknowledge-and-dismiss on alerts~~ — **shipped May 2026 (v2.16.x)**
New `useDismissedAlerts()` hook persists dismissed alert IDs in localStorage keyed by their `expiresAt`. A ✕ button on the `AlertBanner` triggers the dismissal — both the banner AND the `AlertDetailInline` slab hide. Both design rules from the original scope landed:
- **Severity escalation re-surfaces immediately**: a dismissed moderate-tier alert that climbs to severe / extreme bypasses the dismissal — the safety case that the kiosk must never silence.
- **4 h auto-resurface floor**: the dismissal expires after 4 hours regardless of upstream lifetime, so a "set-and-forget" kiosk can't go dark for the entire duration of a 36 h heat warning. Stale entries also purge every minute as their upstream `expiresAt` passes.

### ✅ ~~Moon phase + upcoming solstice/equinox marker~~ — **shipped May 2026 (v2.16.x)**
A small inline addition to the InfoPanel rather than a dedicated astronomy view: a moon-phase glyph (🌑 → 🌕 → 🌘) shown alongside the existing sunrise/sunset row, plus a transient mini-marker that surfaces the next solstice or equinox **only when within ~14 days of it** (e.g. *"Spring equinox in 8 days"*). Both computed locally — no API, no token cost, no quota. A second iteration added a tap-for-details popover with moonrise / moonset times (from Tomorrow.io's daily payload) and next full / new moon dates (locally computed from the synodic-month model).

- **Moon phase** : Conway's lunar-age approximation (~5 lines of math) → fraction 0-1 → choose one of 8 Unicode glyphs. Accuracy: ±1 day, easily good enough for a casual readout. Refresh once per UTC day (the phase moves slowly — no need for the polling cadence used elsewhere).
- **Solstice/equinox upcoming** : Meeus chapter 27 formulas for the four annual events (March equinox, June solstice, September equinox, December solstice) — accurate to within seconds for any year in the 1000-3000 range. Compute the next one at startup, hide the marker outside the 14-day window, surface it as a small italic line under the existing sunrise/sunset row when inside.

The full "Earth orbiting the Sun, day-length curve, axial-tilt animation" companion view originally scoped here feels too rich for the weather-station InfoPanel — better as a separate companion app rather than a competing view inside the main one. The visual prototype at [`docs/design-references/solstices-equinoxes.html`](design-references/solstices-equinoxes.html) (saved May 2026 via [Claude Design](https://claude.ai/design)) stays in the repo as a reference for that future spinoff.

### 🌆 Solar-driven palette transitions (day → dusk → night)
The v3 "Ambient" tokenset ships with **four** palettes (`day`, `dusk`, `night`, `nightRed`) in [`client/src/ui/tokens.js`](client/src/ui/tokens.js), but `useTimeOfDay()` in [`client/src/ui/hybrid.js`](client/src/ui/hybrid.js) currently only routes between three of them: `day` (when `darkMode` is false), `dusk` (when `darkMode` is true and `nightMode` is false — used as the default placeholder), and `nightRed` (when `nightMode` is true). The `night` palette is defined but never selected — dead code waiting for the wiring that distinguishes "dusk" from "night" based on the actual solar position. To finish the four-palette promise:
- **Compute solar elevation** from `sunriseTime` / `sunsetTime` (already in AppContext): treat `now` as being inside the **dusk window** if it falls within ±45 min of sunrise or sunset, **day** between those two windows around sunrise and sunset, **night** otherwise. The constant is a tunable — 30 min is too short on northern latitudes in summer, 60 min eats into the rest of the day.
- **Route in `useTimeOfDay`**: `if (insideDuskWindow) return "dusk"; if (afterSunset || beforeSunrise) return "night"; return "day"`. NightRed override still wins when `sleepNightMode` is on.
- **Tune the `night` palette** (`tokens.js` lines 69-82): currently `night` is a darker variant of `dusk` (bg `#0e0c0a` vs dusk's `#1c1a17`). With both finally rendered side by side, the day → dusk → night → nightRed gradient may need small adjustments to feel like a smooth temporal progression rather than four arbitrary darkness levels.
- **Re-evaluate `darkMode` semantics**: today `darkMode` is a binary user-controlled toggle that bypasses the solar logic entirely. With solar wiring, `darkMode` becomes a manual override of `auto`, similar to the existing `darkModeAuto` pattern — keep the override on a per-session basis so a user can force day-style for a brightly-lit kiosk regardless of the actual local hour.

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

### 🇺🇸 NOAA MRMS as a high-resolution US radar source
[Multi-Radar/Multi-Sensor System](https://www.nssl.noaa.gov/projects/mrms/) is the NOAA/NSSL operational platform that fuses 150+ radars, surface stations, lightning detection, satellite, and forecast models into 100+ products at **1 km resolution** with a **2-minute update cycle** — substantially higher fidelity than RainViewer's ~5 km / 10-min composite and even tighter than ECCC's 6-min cadence. Free and publicly available. Coverage is **US only** (CONUS, Alaska, Hawaii, Caribbean, Guam — plus a few cross-border feeds with Mexico).

Fits naturally as a 3rd regional radar source alongside the planned ECCC item: `MRMS for US users` + `ECCC for Canadian users` + `RainViewer as global fallback`. Same chain-of-fallbacks logic the air-quality + alerts pipelines already use.

- **Format friction.** MRMS publishes in **GRIB2** (gridded binary, NWP industry standard), not pre-rendered tiles. The Leaflet side would need a GRIB2 → PNG/raster pipeline server-side — fetch the latest product, decode with `wgrib2` CLI or a JS lib like `grib-js`, slice into 256×256 tiles, cache. Significantly more infrastructure than the WMS endpoint ECCC offers.
- **Bandwidth.** Individual MRMS product files are ~10-50 MB. At a 2-min cadence that's ~1 GB/hour to keep one product warm — fine for a Pi with broadband, but a real consideration vs RainViewer's slim CDN tiles.
- **Authority.** MRMS is the reference operational composite for the entire US National Weather Service — same data the official severe-weather alert pipeline runs on. For US users this is the highest-fidelity source available without paying for radar-vendor APIs.
- **Effort estimate: ~10-15h** for an MVP. The bulk is the GRIB2 decoder + tile pipeline, not the client-side integration (a 2nd `radarSource` value gates the URL like the existing `rainviewer` / `eccc` plan already does).

Triggered if any of the following materializes:
1. A US user joins the fleet who values the resolution upgrade.
2. The project pivots toward an aviation / agriculture audience where MRMS's auxiliary products (icing, hail, MESH) are valuable.
3. RainViewer's free tier degrades or imposes new restrictions affecting US coverage specifically.

Until then, RainViewer is "good enough" for US users in the existing fleet, and ECCC is the more impactful next radar source for the Quebec-heavy current install base.

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

### ✅ ~~`eslint-disable-line` comments~~ — **resolved May 2026**
Audited the 9 `react-hooks/exhaustive-deps` suppressions one by one. Every site already carries either the CLAUDE.md-standard `initialization, runs once on mount` form (3 sites — App/index.js:159, WeatherMap/index.js:1474, Debug/index.js:1542) or a detailed inline justification explaining *why* the rule is bypassed (6 sites — AppContext.js:1612, App/index.js:119, ambient/HealthIndicator:98, WeatherMap:811, WeatherInfo:125, WeatherInfo:145). All comply with the CLAUDE.md policy "if a suppression is truly necessary, add an inline comment on the same line explaining why". The original concern — undocumented suppressions hiding dependency assumptions — no longer applies.

### ✅ ~~Version history duplicated between `readme.md` and `CHANGELOG.md`~~ — **resolved May 2026**
`readme.md` no longer carries any per-version section. The "Version history" block now contains a 3-line pointer to `CHANGELOG.md` and the GitHub Releases page, plus a short v1 → v2 ClimaCell note for users who land on the readme with an old API key. The matching policy line in `CLAUDE.md` was updated from "the existing ones will be trimmed over time" (an aspirational instruction nobody acted on) to "no per-version highlight sections in the readme at all" — explicit and enforceable.

### 🧪 Automated tests — server side covered, client side still bare
The May 2026 tech-debt session brought the server-side test suite from 0 to 105 cases via `node --test`:
- `test/conversions.test.js` (31 cases) — every export of `services/conversions.js`, including the -40 °F/°C crossover, the 0-input guard, and the `speedUnit` → `kph` rename
- `test/aiSummary.cache.test.js` (12 cases) — locks `SUMMARY_CACHE_TTL = 15 min` + every documented cache-key invalidation (lang change, every unit toggle, period swap)
- `test/settingsCtrl.test.js` (16 cases) — `sanitizeSettings` whitelist + the `maskForRemote` strip (the CLAUDE.md "indoor credentials never even masked, fully stripped" contract is locked verbatim)
- Plus the pre-existing `alertLogic.test.js` / `radarTrend.test.js` / `uiHybrid.test.js` (46 cases)

A GitHub Actions workflow (`.github/workflows/ci.yml`) runs the suite + the client production build on every push to master and on PRs. A regression in a covered area now turns CI red within ~45 s.

**Still uncovered** — the entire client tree (React components, hooks, AppContext). The integration test path is "boot the app in Chrome, eyeball the layout" — the v2.18.0 / v2.18.1 missing-data regression that the Phase 3 session caught only surfaced because a Pi user reported it from the field. Client unit tests (with React Testing Library + jsdom, or Vitest) are the highest-value follow-up but require a build-tool decision because the client source is ESM and the current `node --test` runner is CommonJS. Estimate: ~half-day to wire up the harness, then incremental coverage per refactor.

### 🪦 `experimentalUiC` migration — v3 now default, v2 removal queued
v2.18 flipped `experimentalUiC` from `false` to `true`. v3 ("Ambient Layers") is now the default interface on every install; the toggle in Settings → Advanced stays as a per-device escape hatch that falls back to the v2 tree when disabled. The full removal of the v2 code path (`components/Settings/`, `components/Debug/`, `components/InfoPanel/`, `components/CurrentWeather/`, `components/AiSummary/`, `components/WeatherInfo/`, `components/Clock/`, `components/SunRiseSet/`, `components/IndoorTemperature/`, `components/AlertBanner/`, `components/GovAlertDetail/`, `components/UvAqiBadges/`, `components/RangeSlider/`, `components/Spinner/`, plus the v2 imports and `experimentalUiC=false` branch in `App/index.js` — the canonical list lives in CLAUDE.md, audited 2026-06. NOT removable: `ControlButtons/` and `weatherCharts/` were relocated under `ambient/` (the v3 dock and chart tabs consume them) and `LocationName/` is shared by v2 AND v3) waits on a few weeks of field testing — once no user reports a v3-only regression, the v2 tree comes out in a single dedicated PR. **Trigger to schedule the removal**: 4 weeks after the v2.18 release with no v3-only issue filed at github.com/thicla01/pi-weather-station/issues, OR the moment we deliberately decide to drop the escape hatch. Removal also takes out `experimentalUiC` itself (no longer needed once v2 is gone) and the `previewGroup` row in AdvancedSettings.

### 🗂️ `AppContext.js` size and responsibility — diminishing returns
`AppContext.js` held all global state in one 1877-line file. Phase 3 of the May 2026 tech-debt remediation extracted **three** coherent clusters into dedicated hooks:
- `~/hooks/useUpdateChecker` — in-app update flow (12 state values + the periodic `/api/update-check` poll + post-update reload polling + the three actions)
- `~/hooks/useScreenSaver` — brightness + sleep-mode state with the debounced slider setter
- `~/hooks/useUiPreferences` — units + clock format + fontSize, including the first-launch browser-locale seeding logic

Plus a `buildAdvancedSubtree()` helper that centralised the `advanced.*` PATCH payload assembly across the five `saveAdvanced*Flag` functions — that one also fixed two latent bugs by construction (`darkModeStyle` and `pollen.enabled` were being wiped on certain toggles because the inline assembly was incomplete in 3 of the 5 functions).

AppContext.js is now ~1670 lines. **Remaining slice candidates** are deferred — past the point of diminishing returns:
- `useLocation` (browserGeo / mapGeo / mapTimezone / customLat / customLon, ~5 state pieces + getBrowserGeo + tz-lookup effect): `mapGeo` is the single most cross-cutting variable in the app — every weather fetch, the radar, the location name, the alerts, the AI summary all key on it. Refactor blast radius is large; estimated gain ~100 lines.
- `useWeatherData` (~30 state pieces — current/hourly/daily payloads + risk/trend/alerts + their err states, plus 3 update fns and 2 polling effects): the beating heart of the app. Cross-cutting deps on `weatherApiKey` × `mapGeo` × poll intervals. Gain ~250 lines, risk **high**, no client unit tests to catch a regression.

The remaining clusters share state via React context anyway, so an extra hook is more of a file move than a true module boundary. Better near-term ROI on (a) deleting the entire v2 tree once the field-test trigger fires, (b) the React 19 migration which forces the `set-state-in-effect` cluster cleanup, or (c) wiring up a client test harness. Not "never" — just not next.

### 🪦 `WeatherMap/index.js` size — mostly resolved (1981 → 967 lines)
The largest single file in the codebase. Phase 3 cut it roughly in half across five extractions, all into sibling files under `client/src/components/WeatherMap/`:
- `RadarTimeline.js` — the bottom-of-map scrubber + playhead + speed cycler (its own state, effect, pointer-event handlers)
- `RadarLegend.js` — the precipitation-tier legend overlay (with its RADAR_LEGEND_ITEMS palette)
- `WeatherLayer.js` — the inert OpenWeatherMap tile overlay (deleted 2026-06 in the v3→v2 boundary cleanup — it was imported by nothing)
- `RiskRing.js` — the dashed-circles wrapper, reading buildRingLayers from geometry.js
- `MapResizer.js` — the hook-only invalidate-size + LayoutMobile-recenter bracket
- `RadarFocusControl.js` — the ⛶ Leaflet control for LayoutDesktop focus mode
- `geometry.js` — pure JS helpers: offsetLatLon, buildArrowPath, buildSamplingPoints, tierForIntensity, panWithRailOffset, hasVal, buildRingLayers, plus all the ring-style + arrow-colour + dot-colour tables and the bearing/distance tables (RADAR_GEOMETRY, BEARING_TO_DIR_*, etc.)

`ArrowToggleControl` was deleted outright — surfaced as dead code during the extraction (was moved to BottomDock pre-v2.14.15 but the inline definition lingered in WeatherMap until grep confirmed no other file imported it).

**Remaining inside index.js** (~967 lines): the main `WeatherMap` component (radar layer + JSX composition + the effects that don't extract cleanly), plus small tightly-coupled sub-components (`MapClickHandler`, `MapZoomTracker`, `ZoomLevelHandler`, `PanHandler`, `RailOffsetTracker`, `InitialOffsetCentering`, the `useRailOffset` hook), plus the Leaflet-dependent `buildLocationMarkerIcon` + the axios-dependent `getMapTimestamps`. Each ~25-60 lines and tightly bound to the parent's render flow — past the diminishing-returns line for further extraction.

### ✅ ~~Two React anti-patterns surfaced by the React Compiler~~ — **resolved in v2.17.0**
Both pre-existing fragility issues fixed in the Phase 1 tech-debt pass: `Math.floor(Date.now() / 1000)` no longer called during render in `WeatherMap/RadarTimeline` (lifted into a `useState` ticked by a 30 s interval), and `WeatherInfo`'s self-recursive `useCallback` replaced with a `useEffect`-bound `setInterval` keyed on `cycleKey`. See the v2.17.0 CHANGELOG entry for the full reasoning.

### 🛠️ React Compiler readiness — `set-state-in-effect` cluster (gated on React 19 migration)
The `eslint-plugin-react-hooks@7.x` test in May 2026 surfaced **13 instances** of the new `set-state-in-effect` rule:

- `WeatherMap/index.js` (8 sites — radar frame index initialisation, scrubber state resets, sample-cache invalidation)
- `App/index.js` (1 site)
- `WeatherInfo/index.js` (1 site — chart auto-cycle)
- `ambient/weatherCharts/HourlyChart/index.js` (1 site — chart data derivation from props)
- `ambient/weatherCharts/DailyChart/index.js` (1 site — same pattern as HourlyChart)

Most are the legitimate "compute derived state from props on change" pattern, which the React docs (and the new rule) recommend replacing with either:
- direct computation during render (when the cost is low), or
- `useMemo` / `useReducer` for expensive derivations, or
- a state-lifting refactor when the dependency truly belongs to the parent.

**Now bundled with the React 19 migration below.** May 2026 finding from the Phase 3 tech-debt session: tackling these 13 sites without `eslint-plugin-react-hooks@7.x` actively enforcing the rule means refactoring blind on every site, with no automated check that the new shape is correct. We can't pin to v7 today because v7 requires React 19. So the cluster waits for the bundled migration: bump react + react-hooks lint together, then walk the 13 sites with the linter as the safety net. Estimate: half-day session once the migration is on deck, with regression risk concentrated on the radar scrubber.

### ⏳ React 18 → 19 + react-leaflet 4 → 5 (must be bundled)
Discovered 2026-05-22 during the Phase 2 tech-debt remediation. The `react-leaflet@5` upgrade looks like an isolated dep bump but has React 19 as a hard peer requirement (`peerDependencies: { react: '^19.0.0' }`); attempting it under React 18 errors out at `npm install` and would risk runtime failures on internal React 19 API usage even with `--legacy-peer-deps`. The other v5 breaking change — removal of `LeafletProvider` — is a non-issue here (we don't import it).

Net: these are **one bundled migration**, not two independent ones. Plan when it becomes worth tackling:
1. Wait for the ecosystem (Mapbox GL React, react-i18next, react-router if ever added) to stabilise on React 19. ~Q3 2026.
2. Verify `eslint-plugin-react-hooks@7.x` is on a React 19-compatible release path (currently v7.1.1 is, but the `set-state-in-effect` cluster above is also gating).
3. Single PR: bump react + react-dom + react-leaflet together. CI catches obvious build / lint regressions; the radar scrubber and the `nowSec` interval fix from v2.17.0 are the highest-risk surfaces and need a manual smoke on a real Pi kiosk before merging.

Until then, react-leaflet stays on 4.2.1 — fully maintained, no security issues, no functional gap for our use case.

### ⏳ ESLint 9 → 10 (one upstream blocker left: `eslint-plugin-react`)
First noted in the v2.16+ "Console hygiene + dependency baseline" line above; investigated 2026-05-28. ESLint 10 was held by **two** upstream peer caps, not one:
- `@babel/eslint-parser` (capped at `eslint ^9`) — **removed 2026-05-28.** Migrated the lint parser to native `espree`: the codebase uses only standard syntax (`@babel/preset-env` + `@babel/preset-react`, JSX), so espree parses everything. Dropped `@babel/eslint-parser` + `@babel/eslint-plugin` (the two `@babel/*` rules `semi` / `no-unused-expressions` are identical to the core rules on our syntax), set `ecmaVersion: "latest"`, deleted the dead legacy `.eslintrc`. `npm run prod` passes with 0 errors and the `dist/` bundle is byte-identical (lint-only change, zero runtime impact). The webpack build still uses `@babel/core` + presets + `babel-loader` — only the ESLint-side Babel packages were removed.
- **`eslint-plugin-react@7.37.5`** (latest) — still caps at `eslint ^9.7`, no published version (nor the stale `next` tag) supports `^10`. This is now the **sole** remaining blocker.

So ESLint 10 still ERESOLVEs, but on one dependency instead of two. Pure upstream wait — replacing `eslint-plugin-react` (many active `react/*` rules) is a chantier not worth it while ESLint 9 is fine (no security issue, no functional gap). **Re-check heuristic:** `npm view eslint-plugin-react peerDependencies` — once `^10.0.0` appears, bump `eslint` + `@eslint/js` to 10 and CI validates it.

### ✅ ~~Service-file customizations should live in a systemd drop-in, not the main unit~~ — **resolved in v2.8.1**
`install.sh` and `toggle-remote.sh` now write `ALLOW_REMOTE=true` into a drop-in (`pi-weather-server.service.d/local.conf`) instead of editing the main service file. The canonical `deploy/pi-weather-server.service` stays a clean upstream mirror, and the in-app updater's `serviceFileChanged` warning only fires on real upstream changes. `toggle-remote.sh` migrates legacy installs by re-commenting the leftover line on the next toggle.

### ✅ ~~Debug panel — graceful fallback for non-Pi platforms~~ — **shipped May 2026**
The Pi-throttle row (under-voltage / freq capped / throttled / temp limit) was already gated by `powerStatus?.available` and hides cleanly on non-Pi; CPU temp already reads from `/sys/class/thermal/thermal_zone0/temp` which works on x86 Linux too; fan-speed row already hides when no hwmon fan sensor is exposed. The remaining gap was the hardware identifier showing literal "Unknown" on x86 Linux deployments (VMware / openSUSE / Ubuntu desktop where `/proc/device-tree/model` doesn't exist and the macOS `sysctl hw.model` branch doesn't apply). Now falls back to `os.cpus()[0].model` (built-in Node, works on every platform), so x86 Linux dev boxes show their CPU brand instead of "Unknown" without changing the macOS or Pi paths.

### 🔒 Committed-`dist` content verification — full reproducibility (deferred from the 2026-06 audit, finding #23)
The 2026-06 security remediation shipped a CI guard that verifies the committed `client/dist` **file set** is reproducible (a fresh build adds/removes no files — catching the orphan-chunk class, the bug the Geist PR hit), plus webpack `output.clean: true` so renamed chunks can't linger as committed orphans. What it deliberately does **not** do is byte-compare the minified JS content, because the committed bundle is built on the maintainer's **macOS** box and webpack/terser minification is **not byte-identical to a Linux CI build** — confirmed during the audit: the first divergence is a terser-mangled identifier in the axios region (~byte 997k), with no absolute path or env value embedded (it's the case-sensitive-FS / module-ordering class of non-determinism; versions are identical via `npm ci`). So a byte-exact check is fundamentally incompatible with the "build `dist` on macOS, commit it" workflow that `CLAUDE.md` documents as intentional. **The remaining gap:** a content tamper of `bundle.min.js` (a malicious edit without a matching `src` change) would pass the structural check. Closing it means making CI the source of truth for `dist` — either build-and-commit-in-CI, or build-in-CI + upload-as-artifact and stop committing `dist` — which drops the commit-dist convention and needs a deliberate workflow decision. **Priority: low** — the threat requires an actor who already has commit access to master modifying the bundle, and PRs are reviewed; the structural check + `output.clean` cover the realistic recurring problem.

### 🔒 Deferred security hardening from the 2026-06 audit (low-value follow-ups)
The 2026-06-09 audit's six mediums and all actionable lows shipped across PRs #204→#211 (resource bounds / denial-of-wallet, `settings.json` 0600, Google-Fonts removal, default-deny mask + HTTP security headers, request-counter debounce, single-owner settings writes, `/api/update` concurrency lock, `/api/brightness` limiter, dist-file-set CI check + pinned Actions, cleartext-fallback loopback bind + gated kiosk debug port). These four were deliberately left as low-value defence-in-depth:
- **CSV formula-injection `'`-prefix in the debug-panel export** — `q()` in `client/src/components/Debug/index.js` doesn't neutralise formula-leading chars. The original headline vector (blocked-request `req.originalUrl`) was refuted (it always starts with `/`), and the one real residual (the remote-clients IP column) had its **source closed by #204** (the column now shows the unspoofable socket peer, which can't start with `=`/`+`/`-`/`@`). Prefixing formula-leading cells with `'` is a one-line client nicety for any *future* field; it forces a `dist` rebuild, which is why it was deferred.
- **Per-IP concurrency cap on `/api/nearby-alerts`** (#26) — the state/area/point caches were bounded in #204, but one request can still fan out up to ~5 outbound NWS `/points` calls; a small per-peer concurrency cap on the nearby path would bound the amplification under `ALLOW_REMOTE`.
- **Per-peer sub-ceiling under the global Claude throttle** — #204 added a per-process 10/min billed-call ceiling (local kiosk exempt). A per-peer sub-ceiling layered under it would stop one remote peer monopolising the global budget; the per-peer 120/min `apiLimiter` already caps each peer's overall request rate, so this is marginal.
- **Install-time hardening** (#15/#16/#17) — `install.sh` pipes the NodeSource setup script to `sudo bash` without an integrity check; passes some secrets via process argv (visible in `ps`); and disables TLS verification when probing Homebridge for the indoor-temperature setup. Each is a local-precondition / install-time-only exposure.

### 🔒 Atomic `settings.json` write (audit finding #3, escalated for power-loss-prone hardware)
`settingsCtrl` writes `settings.json` with a plain `fs.writeFile` (truncate-then-write), not an atomic tmp-write + `rename`. The audit filed this Tier 3 (info), but on a Raspberry Pi — hardware that genuinely loses power (the whole `start-server` cold-boot-recovery design exists for exactly that) — a power cut mid-write truncates **the one file that holds all six API keys + the Homebridge credentials**, leaving the kiosk unconfigured. Low probability (writes are rare, localhost-only settings changes) but high impact (total config loss). Fix: write to `settings.json.tmp`, `fsync`, then `rename` over the target (atomic on the same filesystem). Since #208 routed internal writes through a single `writeSettingsFile` helper in `settingsCtrl`, the fix now has one obvious place to land (the four HTTP write paths could share it too). The same tmp-write + rename pattern applies to `weather-cache.json` and `request-counts.json`, though those are non-critical (regenerated / debug-only).

---

## Perspective

The three items I would prioritize above all others if returning to this project:

1. **Radar animation** — transforms the map from a static snapshot into the most compelling feature of the kiosk; the data is already there, it is purely a UI problem.

2. **Sleep mode** — a device that runs 24 hours a day should protect its screen and go dark when no one is watching; this also makes the device feel intentional rather than like a forgotten browser tab.

3. **Local GPIO sensors** — displaying the real temperature of the room next to the outdoor forecast is something no commercial weather app can do; it gives the project a reason to exist as physical hardware rather than a web app on a tablet.

---

*Last updated: 2026-06-10 (three technical-debt items added from the 2026-06-09 security remediation, after PRs #204→#211 shipped + deployed fleet-wide: (1) committed-`dist` content verification — the CI guard is structural-only because the macOS-built bundle isn't byte-reproducible on Linux CI, full content-tamper detection would need CI to own `dist`; (2) a grouped entry for the four deliberately-deferred low-value hardening follow-ups (CSV `'`-prefix, per-IP nearby-alerts cap, per-peer Claude sub-ceiling, install-time hardening); (3) atomic `settings.json` write — Tier-3 in the audit but escalated here since power-loss truncation of the API-keys file is a real risk on Pi hardware). Prior: 2026-06-07 (« Nearby alerts » upgraded from proposal to a fully-specced, validated design — configurable-radius display-only overlay; k5map confirmed interest and asked for a user-settable radius; design + hardware/footprint resolved via multi-agent design + sizing passes). Prior: 2026-06-05 (added alert-tier item — Watches mapped on CAP `severity` alone can read as loud as Warnings; product decision parked. Earlier same day: « Nearby alert polygons » — area-scoped, display-only sibling of the continental overlay, proposal pending k5map feedback; see `docs/nearby-alerts-overlay-proposal.md`). Prior: 2026-05-28 (ESLint lint parser migrated from `@babel/eslint-parser` to native espree — dropped two `@babel/*` ESLint packages, one of the two ESLint-10 blockers cleared; `eslint-plugin-react` ≤9.7 is now the sole remaining blocker, re-check via `npm view eslint-plugin-react peerDependencies`). Prior: 2026-05-23 Phase 3 tech-debt remediation — AppContext split (three hooks extracted, two deferred past diminishing returns); WeatherMap split (1981 → 967 lines across six new files plus geometry.js); client-side test gap called out; v2 removal on a 4-week field-test timer post-v2.18.1)*


