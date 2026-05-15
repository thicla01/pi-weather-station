# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [2.14.50] - 2026-05-15

### Changed
- **ChartTabs cycle dots — visibility bump** — User report: "we were supposed to put 3 little dots at the bottom — they're not really there". The dots were in fact rendered but the inactive state used a 1-px border at `var(--c-border-hybrid)` which resolves to `rgba(42, 38, 32, 0.18)` in day mode — practically invisible against the cream surface. Reworked the visual:
  - Size 8 → 10 px, gap 8 → 10 px, hit-target ring kept at ~24 px
  - Inactive: outline-only → soft solid fill at `var(--c-text-dim)` with 55 % opacity (reads as a dim dot on every palette)
  - Active: filled `var(--c-accent)` at 100 % opacity, plus a `scale(1.15)` bump to reinforce which view is current
  - Hover lifts inactive opacity to 85 %

---

## [2.14.49] - 2026-05-15

### Added
- **ChartTabs — chart legend restored** — User feedback: the two-line graphs (grey + blue) had no colour key in v3 `ChartTabs`. The Chart.js native legend stays disabled (vertical space is scarce in compact mode, and the canvas title sits where the legend would go), so a small custom legend row now renders above the chart with two dots and labels — grey for « Température » / « Vent », blue for « Précipitations », keyed off the active view. Visible only for the line-chart views (`temp` / `wind`); hidden for the columns view since the icons + temperature labels there are self-descriptive. Mirrors the v2 `WeatherInfo` `ChartLegend` pattern.

---

## [2.14.48] - 2026-05-15

### Fixed
- **HourlyForecastColumns — sparse layout in expanded mode on tall viewports** — On the 24h-tab columns view, with ChartTabs maximized on a desktop monitor (and thus the chart area ~600 px tall), the 3 rows of cells stretched to ~200 px each because of `grid-auto-rows: 1fr` combined with `align-items: stretch`. The cells' content (icon + hour + temperature, ~60 px tall) sat at the top of each row, leaving ~140 px of dead vertical space below. User feedback: "les données ont l'air perdu parce que le tableau est trop grand". Fix: `grid-auto-rows: auto` so rows take their natural height, plus `align-content: center` on `.strip` so the 3-row cluster sits in the middle of the chart area with the leftover space distributed top and bottom as breathing room. Gap bumped from 4 px → 8 px between rows so the strip still reads as a deliberate grid rather than a tight clump.

---

## [2.14.47] - 2026-05-15

### Changed
- **AiSummaryInline maximize — rail widens on both layouts** — Same affordance ChartTabs got in v2.14.46. When the AI summary slab is maximized it now emits `data-ai-maximized="true"` on its root, and both `LayoutPi` and `LayoutDesktop` have their existing `:has` rules extended (comma-separated selector) to match either `data-chart-maximized` or `data-ai-maximized`. Result: opening the AI summary in maximized mode widens the rail to `min(60vw, 600px)` on LayoutPi and `min(60vw, 960px)` on LayoutDesktop, so the user can read the full three paragraphs (current conditions / period forecast / radar analysis) without scrolling on the 7" kiosk.

  Distinct attribute names per slab (`data-chart-maximized` vs `data-ai-maximized`) instead of a shared `data-slab-maximized` because other rules need to target the slabs individually — `HourlyForecastColumns`'s `.expanded` typography only fires on the chart-maximized state, not the AI one.

---

## [2.14.46] - 2026-05-15

### Changed
- **ChartTabs maximize — rail widens on LayoutPi too** — Until this version only `LayoutDesktop` (≥ 1280 px) widened the rail when the chart was maximized; on the 7" Pi the slab grew in height only (covering its rail siblings). Now `LayoutPi` carries its own `:has([data-chart-maximized="true"])` rule that swaps `grid-template-columns` from `1fr 300px` (340 px at ≥ 1280 px) to `1fr min(60vw, 600px)`. On the 800-px-wide 7" kiosk this gives the chart card a 480-px-wide rail (60 %) while keeping ~320 px for the map; on 1024-px screens the rail reaches 600 px. The same 200 ms `grid-template-columns` transition used by the chevron collapse animation drives the open, so the rail slides smoothly into place rather than snapping.
- **HourlyForecastColumns — dense layout now lives on LayoutPi too** — With the wider maximized rail the dense 24-cell × 1-hour grid physically fits at sub-1280 widths. Reverted the v2.14.45 `effectiveExpanded` JS gate so the strip uses the dense layout whenever `expanded` is true, regardless of viewport. The CSS `.expanded` *typography* overrides (icon 38 px, temp 20 px Geist Mono) stay gated behind `@media (min-width: 1280px)` because cells at 7" maximize are ~55 px wide — fine for the compact 26-px icons but too small for the desktop's 38-px ones. Net result: 7" maximize now shows the same 24-hour 1-hour-step grid as desktop maximize, just with the compact-sized text and icons.

---

## [2.14.45] - 2026-05-15

### Fixed
- **HourlyForecastColumns — expanded mode overflowed on the 7" Pi** — Field report: pressing the chart maximize button on the 7" kiosk produced visible column clipping on the right of the rail. Cause: only `LayoutDesktop` (active at viewport widths ≥ 1280 px) widens `--c-rail-width` when the chart slab emits `data-chart-maximized="true"`. `LayoutPi` (< 1280 px, used by the 7" kiosk and any sub-1280 desktop) leaves the rail at its native width. `ChartTabs` was passing `expanded={maximized}` to `HourlyForecastColumns` unconditionally, so the dense 24-cell layout (8 cols × 3 rows × 1-hour step) and the larger expanded typography were applied to a rail that hadn't actually widened — hence the overflow.
- Fix: `HourlyForecastColumns` now derives an `effectiveExpanded` flag = `expanded && isDesktop`, where `isDesktop` tracks `(min-width: 1280px)` via `matchMedia` with a `change` listener. Below 1280 px the chart maximize still works (the slab still covers other rail items, AiSummary-style), but the strip itself stays at the compact 8-cell × 3-hour layout. The CSS `.expanded` rules are additionally wrapped in `@media (min-width: 1280px)` as defence-in-depth against any pre-React-hydration flash. The desktop (≥ 1280 px) maximize behaviour is unchanged.

---

## [2.14.44] - 2026-05-15

### Changed
- **ChartTabs maximize — wider rail + bigger hourly columns** — When the chart card is maximized:
  - **Rail width cap** raised from `min(50vw, 720px)` to `min(60vw, 960px)`. On a 1920×1080 monitor the rail reaches 960 px (50 %), on 1280 px it reaches 768 px (60 %), capped at 960 px on 2560 px ultra-wide. Past ~960 px the chart axes read fine and extra width just stretches the canvas without adding information.
  - **HourlyForecastColumns — expanded typography**: icon 26 → 38 px, hour 11 → 13 px, temperature 14 → 20 px (Geist Mono for clean numeric alignment), precipitation 10 → 12 px, gap 4-6 → 8-10 px. The compact (default rail) sizing is strictly untouched — the new values only apply inside `.strip.expanded` which is gated on the `expanded` prop passed by `ChartTabs` when maximized.
  - Untouched: compact mode at every font-scale (P / M / G) on the 7" kiosk, the line-chart views, and `DailyForecastColumns` (which scales naturally with the wider rail without typography changes).

---

## [2.14.43] - 2026-05-15

### Changed
- **HourlyForecastColumns — multi-row layouts** — Both density modes now stack cells vertically so each cell breathes instead of fighting for horizontal room:
  - **Compact** (~320 px rail): 2 rows × 4 columns at a 3-hour step → 8 cells covering 24 h. Each cell ~75 px wide (vs ~38 px on the previous single-row 8-column layout), so the icon and temperature don't compete for space.
  - **Expanded** (~50 vw rail when ChartTabs is maximized): 3 rows × 8 columns at a **1-hour step** → 24 cells covering 24 h hour-by-hour. Same ~75 px cell width as compact, just three rows of them — the full hourly granularity is now visible at a glance.
  - Both modes share the same per-cell typography (icon 26 px, hour 11 px, temp 14 px) since the cell widths converge on the same ~75 px target — the variable is row count and step, not cell size.

---

## [2.14.42] - 2026-05-15

### Changed
- **HourlyForecastColumns — full 24-hour coverage** — The previous layout showed 6 columns at a 2-hour step, covering only the next 12 hours despite living inside the "24 heures" tab. Reworked to two density modes, both spanning the full 24-hour window:
  - **Compact** (default rail, ~320 px wide): 8 columns at a 3-hour step. Icon scaled down to 24 px, hour/temp/precip slightly tighter so 8 cells fit at ~38 px each.
  - **Expanded** (rail widened by ChartTabs maximize, ~50 vw): 12 columns at a 2-hour step. Icon back to 28 px, type at the previous values — ~55 px per column gives the strip real breathing room.
  - `HourlyForecastColumns` accepts a new `expanded` prop; `ChartTabs` passes `maximized` through so the density mode swaps automatically when the user maximizes the chart card. The strip never silently truncates: the tab label now matches the data span.

---

## [2.14.41] - 2026-05-15

### Fixed
- **HourlyForecastColumns — missing weather icons** — Field-test report: the new 24h "Colonnes horaires" view rendered the hour label and temperature but no weather icon (only the "—" placeholder). Cause: `HOURLY_FIELDS` in `proxyCtrl.js` only requested `temperature`, `precipitationProbability`, `precipitationIntensity`, `windSpeed` — `weatherCode` was never pulled because the v2 `HourlyChart` line chart didn't need it. Added `weatherCode` to `HOURLY_FIELDS`; the cache key versioning introduced in v2.14.6 (commit 300d1f2) bumps the `HOURLY_FIELDS_HASH` automatically, so every Pi will discard its stale hourly cache and refetch on the next request — no manual `rm weather-cache.json` required.
- **HourlyForecastColumns — title overlapping rightmost columns** — The "Prochaines 12 heures" title was absolute-positioned at `top: 4px; right: 6px` and bled over the last column's hour / temperature on both the compact rail (≤ 320 px) and the expanded rail (~ 700 px). The cycle dots already display a "colonnes horaires" label below the chart area, which is enough — removed the in-strip title entirely (and its unused i18n usage / `useTranslation` import).

---

## [2.14.40] - 2026-05-15

### Added
- **ChartTabs — 3-view cycle per tab with dot indicators** — Each tab now cycles through three views:
  - **24h tab**: temperature + precipitation line / wind + precipitation line / **new** `HourlyForecastColumns` (6 columns covering the next 12 hours at 2-hour intervals: hour · weather icon · temperature · precipitation %).
  - **5d tab**: temperature + precipitation line (v2 `DailyChart`, brought back into `ChartTabs`) / wind + precipitation line (v2 `DailyChart` altMode) / existing `DailyForecastColumns`.
  - A row of three dots beneath the chart area shows which view is active and is tappable to jump directly. The legacy tap-on-chart gesture is preserved (advances by one). View indices are persisted to `localStorage` per tab so the user's preference survives reloads.
  - The two line charts (`HourlyChart`, `DailyChart`) gained a controlled-vs-uncontrolled `altMode` + `onAltToggle` prop pair: when `ChartTabs` passes them, the chart respects the parent and forwards taps to the cycle handler; when absent (v2 `InfoPanel`), the charts keep their internal state and previous tap-to-toggle behaviour.
  - New `HourlyForecastColumns` component mirrors `DailyForecastColumns`'s visual language (column with day/hour label, weather icon, temperature, precip %) at hourly granularity. Sized to feel proportional to the daily strip, with a small "Prochaines 12 heures" / "Next 12 hours" / "Próximas 12 horas" title pinned top-right.
  - New i18n keys: `charts.hourlyColumnsTitle`, `charts.cycleView`, `charts.viewTempPrecip`, `charts.viewWindPrecip`, `charts.viewHourlyColumns`, `charts.viewDailyColumns` in EN / FR / ES.

---

## [2.14.39] - 2026-05-15

### Added
- **ChartTabs maximize (24h / 5-day chart card)** — New ↗ button at the right end of the tab row promotes the chart slab to `position: absolute; inset: 12px` over its rail, exactly like AiSummaryInline's maximize button. The maximized slab emits `data-chart-maximized="true"` on its root, and `LayoutDesktop`'s stylesheet uses `:has([data-chart-maximized="true"])` to grow `--c-rail-width` from its default 320 / 360 px to `min(50vw, 720px)`. The HeroBand's `right` offset already references `--c-rail-width` via `calc()` (and was already transitioning over 200 ms), so the band smoothly slides leftward and the rail widens together. Chart.js's `maintainAspectRatio: false` + `responsive: true` already in place means the canvas reflows automatically. On LayoutPi (7" kiosk) the rail is already ~half the screen, so the maximize behaves like AiSummary's: same width, slab covers siblings. ↘ button restores the compact rail width.

This is Approach A from the ROADMAP "Expandable chart card" entry. Approach B (centred modal) and C (compact → tall → wide → modal stepper) remain backlog options if A's 50 vw cap proves too cramped in real use.

---

## [2.14.38] - 2026-05-15

### Fixed
- **AI summary — paragraph 2 (forecast) silently dropped on every Pi** — Field-team report (2026-05-15): the AI weather summary stopped rendering the period-forecast paragraph (« ce soir 18h-21h » / « cette nuit 21h-5h » / « demain ») a few days ago. Cause: commit `300d1f2` (v2.14.6, 2026-05-13) versioned the weather cache key schema in `proxyCtrl.js` from 3 parts (`type:lat:lon`) to 4 parts (`type:fieldsHash:lat:lon`) so future field-list changes auto-invalidate disk-cached entries — but `aiSummaryCtrl.js` was not updated and kept reading with 3-part keys. Both `getHourlyFromSharedCache()` and `getDailyFromSharedCache()` returned `null` for every lookup → `secondSection` stayed empty → the prompt and the calm-day fast path both rendered only paragraphs 1 (current) and 3 (radar). `getWeatherFromSharedCache()` had the same bug but masked it via a fallback fresh API call inside the controller. Fix: `proxyCtrl` now exports `getCacheKey` and `{CURRENT,HOURLY,DAILY}_FIELDS_HASH`; `aiSummaryCtrl` imports and uses them so the two modules cannot drift again. All three lookups now hit the cache correctly; paragraph 2 reappears on first AI summary refresh after upgrade.

---

## [2.14.37] - 2026-05-15

### Changed
- **HeroBand — stacked LocationName + larger date/sun row** — Two-part adjustment to balance the panel against the large temperature numeral:
  - **LocationName `stacked` prop**: New variant renders the city (or first segment before the last comma) on its primary line and the country on a smaller secondary line at 0.65em. Splitting on the LAST comma keeps multi-word regions intact ("Washington, D.C., USA" → "Washington, D.C." + "USA"). The HeroBand passes `stacked` so "Montréal, Canada" reads as a bold "Montréal" with "Canada" underneath rather than getting visually lost on a single small line.
  - **HeroBand `.placeLabel`**: Font bumped 16 px → 28 px (default) / 20 px → 34 px (≥ 1600 px), weight 500 → 600. The stacked country line scales automatically via the relative `0.65em` rule.
  - **HeroBand clock panel**: `.clockDate` 12 px → 14 px (default) / 14 px → 16 px (≥ 1600 px); `.clockSunRow` 12 px → 14 px (default) / 14 px → 16 px (≥ 1600 px); `.clockTime` 52 px → 56 px (≥ 1600 px); `.clockAmPm` 18 px → 20 px (≥ 1600 px); `.clockSunRow` gap 18 px → 20 px (≥ 1600 px). The clock panel now reads as proportional to the new larger location panel.

---

## [2.14.36] - 2026-05-15

### Changed
- **HeroBand — ultra-wide cap + wider font scaling** — At viewport widths beyond 1600 px the three HeroBand panels stretched to 500 px+ each, leaving large expanses of empty space (reported by k5map). Two changes:
  - Added `max-width: 1600px` to `.band` — the band stops growing at 1600 px regardless of how wide the monitor is, keeping the content-rich look of the design reference.
  - Extended the `@media (min-width: 1600px)` block to include the Location panel (`font-size: 16 px → 20 px`, `padding: 24px 32px`) and the Clock panel (`date: 12 px → 14 px`, `clockTime: 44 px → 52 px`, `AM/PM: 16 px → 18 px`, `sun row: 12 px → 14 px`, `gap: 14 px → 18 px`, `margin-top: 8 px → 10 px`, `padding: 24px 32px`). The Temperature panel already scaled at ≥ 1600 px; the other two panels now follow, so all three read as proportional rather than the Location and Clock panels feeling small next to the large temperature digit.

### Docs
- **`docs/ui-layout_en.md`** — Full rewrite for v3 Direction C: LayoutPi ASCII diagram, LayoutDesktop ASCII diagram, HeroBand panels table, BottomDock ControlButtons table, Overlays table, Palette/time-of-day modes table. Replaces the v2 split-grid description.
- **`docs/ui-layout_fr.md`** — Translated to French, aligned with the v3 Direction C rewrite above.

---

## [2.14.35] - 2026-05-14

### Fixed
- **BottomDock — icon size** — Dock icons were rendered at browser default (~16 px). Explicit `width: 24px; height: 24px` on `.dock :global(svg)` fills the 36 px usable area (52 px dock − 8 px padding × 2) comfortably.
- **nightRed palette — text contrast** — Two colour tokens were insufficient for readability of non-bold / secondary text (reported by k5map):
  - `text` bumped `#c04848 → #d05050`: contrast vs. the dark card surface increases from ~4:1 to ~5.1:1, clearing WCAG AA for normal-weight text at normal size.
  - `textDim` bumped `#783030 → #b84848`: the old value had a contrast ratio of only ~2.25:1 — effectively illegible for small text. The new value reaches ~4:1, matching the old `text` token's level and making unit suffixes, sub-labels, and secondary metadata readable in nightRed mode.

---

## [2.14.34] - 2026-05-14

### Fixed
- **v3 BottomDock — button contrast and palette consistency** — Two visual issues with the control-button row at the bottom of the 7" Pi layout:
  - **nightRed mode — icons invisible**: The v2 ControlButtons stylesheet paints button cells with a mid-grey gradient (`#5d5c5c → #4e4e4e`). In nightRed mode the icon colour is `--c-text: #c04848` (warm red). Red on grey has a contrast ratio of only ~1.24:1 — effectively indistinguishable. Root cause: the v2 hard-coded greys are palette-unaware and fight the Direction C tokens.
  - **day mode — colour mismatch**: Switching from dark to light mode turned the button bar from "black" (dark surface + dark grey buttons) to a warm brown-orange. The grey gradient buttons clashed with the day-mode cream dock surface (`rgba(255, 250, 240, 0.85)`).
  - **Fix — CSS custom properties**: Added `--ctrl-btn-bg`, `--ctrl-btn-active`, `--ctrl-btn-down`, `--ctrl-btn-border`, `--ctrl-btn-border-l` custom properties to `ControlButtons/styles.css` with the v2 values as fallbacks. `BottomDock/styles.css` overrides them on `.dock` with Direction C tokens: transparent button backgrounds (dock surface shows through, giving icons ~4:1 contrast in nightRed), `--c-accent-soft` for active/down states, and `--c-border-hybrid` for dividers. v2 layouts that embed ControlButtons outside the dock are unaffected.

---

## [2.14.33] - 2026-05-14

### Fixed
- **v3 SettingsPanel — AI · Analyse Radar section always 2 columns** — The 4 toggles with sub-text in the AI subsection were laid out in a `grid4` (4 columns). Inside the 880 px max-width body each cell was only ~200 px wide — too narrow for labels like "Points d'échantillonnage" + their sub descriptions, which wrapped to 3–4 lines and misaligned rows on the 10" screen (not caught by the `max-height: 520px` kiosk fix from v2.14.32). Added a new `.grid2` CSS class (always 2 columns, `align-items: start`) and applied it to the AI section so each toggle cell gets ~400 px on all viewports.

---

## [2.14.32] - 2026-05-14

### Fixed
- **v3 SettingsPanel — Advanced section layout at 800×480** — Several layout issues in the expanded Advanced (Avancé) section:
  - **grid4 → 2 columns on kiosk**: Added `@media (max-height: 520px)` override that forces `.grid4` to 2 columns. This fixes three subsections at once: (1) AFFICHAGE — "Opacité radar · sombre" no longer overflows to the right (sliders get ~360 px each); (2) ANALYSE RADAR — 4 toggles with sub-text now render in 2 rows of 2 rather than a cramped 4-column layout; (3) VEILLE — each cell has enough width for its content.
  - **fieldLabel nowrap**: Added `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` to `.fieldLabel` (same treatment as `.segLabel` in v2.14.31) so labels like "Opacité radar · sombre" never wrap to a second line at narrow cell widths.
  - **Veille structural fix**: Separated the Sleep section's mixed Toggle/Field `grid4` into distinct rows — Toggles in `toggleRow` (horizontal, flex-wrap) and Fields in their own `grid4` blocks. This removes the visual height mismatch that appeared when a horizontal Toggle (track + label, ~24 px tall) and a vertical Field (label above box, ~30 px tall) shared the same grid row.
- **v3 SettingsPanel — API key fields uniform width** — Each `.apiRow` is an independent CSS grid instance; with `1fr auto` the `auto` description column varied per row (shorter text → wider input). Changed to `2fr 1fr` so both the key input (⅔) and description (⅓) use fixed fractions of the available space, making every key field exactly the same width. Removed the `max-width: 220px` cap from `.apiUnlocks` (now constrained by the `1fr` column) and added explicit `text-align: left`.

---

## [2.14.31] - 2026-05-14

### Fixed
- **v3 SettingsPanel — responsive layout for 7" kiosk (800×480)** — Two issues were visible at the Raspberry Pi 7" touchscreen resolution:
  - **Sticky header opacity**: The header used `background-color: var(--c-surface)` which resolves to `rgba(…, 0.85)` (15% transparent). When the user scrolls, section content bled through the semi-transparent header. Changed to `var(--c-bg)` (always fully opaque) so scrolled content is fully covered.
  - **Compact header padding**: At 800×480 the header's default 14 px vertical padding consumes precious space. Added a `@media (max-height: 520px)` rule that reduces vertical padding to 8 px.
  - **"Carte · sombre" label wrapping**: In the AFFICHAGE `grid4` the "Carte · sombre" seg label wrapped to two lines at 800 px cell widths, and the stretch alignment of the grid caused the segmented control track to sit lower than its neighbours. Fixed with `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` on `.segLabel` and `align-items: start` on `.grid4`.

---

## [2.14.30] - 2026-05-14

### Fixed
- **v3 DebugPanel — responsive layout for 7" kiosk (800×480)** — Several layout issues appeared when viewing the v3 Debug panel at the Raspberry Pi 7" touchscreen resolution:
  - **Zoom cap**: The panel-boost zoom (1.15–1.32×) applied to a `position: fixed; inset: 0` overlay compresses the effective viewport, pushing rail chips out of view. Capped at `zoom: 1` when `max-height ≤ 520 px` (the kiosk detection threshold).
  - **Header — icon-only buttons**: Action buttons ("Refresh", "Export CSV", "Check update") showed icon + text label at 800 px, consuming ~220 px of header width and causing the header row to overflow. At `max-height ≤ 520 px`, the text labels are now hidden (`display: none`) via `.actionLabel`; button padding tightened. The `title` attribute on each button preserves accessibility.
  - **Rail chips — compact size**: The 96 px rail and 10 px chip padding were too large at 800 × 480. Under the compact breakpoint the rail narrows to 76 px, chips use tighter padding (7 px 2 px), and icon/label sizes are reduced (18 px / 8 px) so all 5 tabs fit without vertical overflow.
  - **gridTwo wrapping on VERSION**: `@container (min-width: 800px)` split the KV grid into two columns at the kiosk width, halving each column to ~328 px. Long values like "pi-weather-station v2.14.27 · 7de9b57" then wrapped on every hyphen — five-line VERSION rows. Replaced the container query (and the `container-type: inline-size` it required on `.bucket`) with `@media (min-width: 1080px)` — the kiosk stays single-column, standard desktop displays get the two-column layout.
  - **kvValue hyphen-wrapping**: CSS's default word-break treats hyphens as break opportunities, so "pi-weather-station" was three lines. Added `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` to `.kvValue`.
  - **RÉSEAU URLs wrapping to 3 lines**: `container-type: inline-size` on `.bucket` triggers a Chrome layout bug where block children cannot stretch to the parent's width (their intrinsic inline size resolves to ~0). Both `width: 100%` and `display: flex → block` rewrites on `.netList`/`.netUrl` were ineffective while the containment was in place. Removing `container-type` and switching to viewport media queries fixed the rendering immediately.
  - **gridQuota columns**: Quota grid now uses `@media (min-width: 700px)` for 3-col and `@media (min-width: 1400px)` for 4-col, replacing the `@container` rules that depended on the removed containment.
  - **Pane padding**: Reduced content-pane padding under the compact breakpoint (10 px top, 12 px sides, 16 px bottom) to free more usable area for bucket content.

---

## [2.14.29] - 2026-05-15

### Changed
- **HourlyChart + DailyChart — raw HTTP error no longer shown to user** — "Request failed with status code 429" (and similar axios messages) were displayed verbatim below the translated error label, exposing HTTP internals to kiosk users. The translated label ("Impossible d'obtenir les prévisions sur 24 heures" / daily equivalent) is sufficient for the user; detailed diagnostics remain available in the Debug panel.

---

## [2.14.28] - 2026-05-15

### Fixed
- **v3 ChartTabs — hourly chart Y-axis truncated at fontSize=L** — HourlyChart's wrapper div ships a legacy `width: 255px; height: 115px` from the v2 WeatherInfo panel. In v3's ChartTabs the slab is wider (~276 px usable) and the rail applies `zoom: 1.15` at fontSize=L, so Chart.js's layout math underestimated available space and truncated the right Y-axis labels ("60%" appeared as "6"). A `.chartArea > div` override in ChartTabs/styles.css forces the chart wrapper to `width: 100%; height: 100%` so Chart.js measures the real container and allocates proper axis padding at every font size. v2's WeatherInfo layout is unaffected (the rule is scoped to ChartTabs).

---

## [2.14.27] - 2026-05-15

### Fixed
- **v3 AiSummaryInline maximize broken on LayoutPi (7" Pi)** — `.slabMaximized` does `position: absolute; inset: 12px` to fill the rail when maximized, but LayoutPi's `.rail` was a plain CSS-grid item with no positioning, so the slab pinned to `.layout` (or the viewport) instead. Result on the 7" kiosk: the maximize button didn't visibly do anything — the slab stayed in its flex slot with an inset relative to the wrong ancestor, the background didn't cover the rail's other items, and the body text read through to map labels in light mode. LayoutDesktop already had `position: absolute` on its rail so the bug was specific to LayoutPi. Adding `position: relative` to `.rail` fixes the pinning. Additionally, when entering maximize mode the rail is now scrolled to top — without this, if the user had scrolled down to read the collapsed summary, the maximized slab (correctly positioned at the rail's content origin) sat above the visible viewport and required a manual scroll-up to see.

---

## [2.10.2] - 2026-04-27

### Fixed
- **API key fields visible on remote (read-only) with the same amber notice** — same UX gap as Advanced settings before v2.10.1: API keys, Anthropic key, and custom coordinates were hidden entirely on remote, leaving users wondering where they went. Show them everywhere; on remote, render API keys as a coloured "Configured" / "Not configured" status (the actual key string is never sent to remote clients — server-side masking continues to return booleans), render coordinates as a plain read-only text value, and show an amber notice at the top of the section pointing to the SSH-tunnel workflow. The localhostOnly write boundary on `PATCH /setting`, `PUT /settings`, etc. is preserved unchanged.

---

## [2.10.3] - 2026-04-27

### Fixed
- **Pre-flight check no longer trips on harmless untracked files** — the in-app updater's `local-changes` check used `git status --porcelain` to detect anything that would conflict with `git pull --ff-only`. That command also lists untracked files (with `??` prefix), which `git pull --ff-only` doesn't actually touch — they live outside git's view entirely. Result: harmless backups like `settings.json.bak` blocked the updater with a misleading "uncommitted changes" message. Add `--untracked-files=no` so only real conflicts (modified, staged, deleted, renamed files) trigger the rejection.

---

## [2.14.26] - 2026-05-15

### Changed
- **v3 DebugPanel — "Install update…" button and `needsManualUpgrade` notice translated** — surfaced from the About bucket's Update check section only when an update is available, the install CTA was rendered in English in every locale. Now reads `Installer la mise à jour…` (FR) / `Instalar actualización…` (ES). The fallback "This install is too old for the in-app updater. Run `bash deploy/install.sh` on the device to upgrade." message (shown when `needsManualUpgrade` is set, e.g. pre-v2.4.1 installs) is also fully localised in FR + ES around the unchanged shell-command code block.

---

## [2.14.25] - 2026-05-15

### Changed
- **v3 DebugPanel — more user-facing labels translated in Server bucket** — four remaining English strings localised in FR/ES:
  - `POWER OK` tag in the Power status row → `ALIMENTATION OK` / `ALIMENTACIÓN OK`
  - `avg` suffix in the response-times rows + radar compression stats → `moy` / `prom`
  - `frames` in the radar compression stats → `trames` / `tramas`
  - `Export report` button → `Exporter rapport` / `Exportar informe` (plus the success message `Exported` → `Exporté` / `Exportado`)
- `PowerStatusRow` and `RadarCompressionRow` now receive `lang` as a prop so they can localise their own chrome. `ms` (milliseconds) and `req` (requests) intentionally stay English — universal IT abbreviations.

---

## [2.14.24] - 2026-05-15

### Changed
- **v3 DebugPanel — selective KV-key translation for the user-facing labels** — most KV keys (uptime / rss / heap used / cpu temp / fan rpm / commit / hostname / hardware / os / init / DEBUG / ALLOW_REMOTE / local sha / latest sha / page load / fps / js heap / screen / lat / lon / zoom / aqhi / etc.) stay English on purpose — they're shared technical vocabulary developers use across locales. But a handful of more user-facing labels were translated: `name` (nom / nombre), `version` (versión), `branch` (branche / rama), `license` (licence / licencia), `latest ver` (dernière ver / última ver), `available` (disponible / disponible), `hits` / `misses` / `hit rate` / `entries` in the Cache stats block, and the `Internet: ONLINE / OFFLINE` status (EN LIGNE / EN LÍNEA, HORS LIGNE / DESCONECTADO). The `v3-ambient (preview)` UI flavour string also now reads `aperçu` / `vista previa` in FR / ES.

---

## [2.14.23] - 2026-05-15

### Added
- **v3 SettingsPanel — full Spanish translations** — the panel previously used a two-locale ternary pattern (`lang === "fr" ? "FR" : "EN"`) for ~50 strings, so Spanish users saw English text everywhere except for the few rows that already had explicit ES values (font size segment, tier badges, etc.). Added a shared `lbl(lang, en, fr, es)` helper at the top of the file (same convention DebugPanel uses), then converted every two-locale ternary to three-locale via `lbl(...)`. 49 conversions across Local preferences, API keys, Advanced (Display/AI/Sleep/Diagnostic), Preview, and the RemoteNotice. Spanish translations were drawn from the i18n glossary in `docs/localization-glossary.md` and are pending native-speaker validation (the glossary's `☐` cells will be flipped to `☑` as rows are confirmed).

---

## [2.14.22] - 2026-05-14

### Added
- **v3 SettingsPanel — full Phase 8b port of the Advanced subsections** — closes the "Phase 8b — Full port of the remaining advanced settings" placeholder that lived under the Sleep subsection since 2.14.18. Two new subsections inside the Advanced disclosure, sitting before Sleep:
  - **Affichage / Display** — `lightModeStyle` (Mapbox light style: `light-v10` / `light-v11` / `streets-v12`), `darkModeStyle` (`dark-v10` / `dark-v11`), `radarOpacityLight` slider (0.05–1 in 0.05 steps, % display), `radarOpacityDark` slider (same shape). Wired to the existing `saveAdvancedDisplayFlag` + `setRadarOpacityLightLive` / `setRadarOpacityDarkLive` context helpers.
  - **IA · analyse radar / AI · radar analysis** — four toggles: `radarAnalysisEnabled`, `extendedRadarRadius` (saves under JSON key `extendedRadius`), `showSamplingPoints`, `calmDayFastPath`. Each carries a short FR/EN/ES `sub` explaining the impact. Wired to `saveAdvancedAiFlag`.

### Changed
- **BrightnessSlider generalised into RangeSlider** — same JSX + CSS, now accepts `format` (callback) and arbitrary `min/max/step` so the new radar-opacity sliders can share the implementation. `BrightnessSlider` retained as a thin alias for the existing call site readability.
- **Removed the Phase 8b note** — the placeholder explaining "the rest will land later" is no longer truthful now that Display + AI are in. The advanced section reads cleaner without it.

---

## [2.14.21] - 2026-05-14

### Changed
- **v3 SettingsPanel — API key tier badges localised** — the `REQUIRED` / `OPTIONAL` sub-labels under each provider name now follow the active language: `REQUIS` / `OPTIONNEL` (FR), `REQUERIDO` / `OPCIONAL` (ES). Fall-through preserves the raw tier string for any future custom values.
- **v3 SettingsPanel — "NEW · Direction C" badge removed from the Sleep subsection** — the marker was a Phase-5 dev-time tag pointing reviewers at "this is the newly-ported section". Since the section is now stable + shipped, the marker just added noise next to the section title. Sleep stands on its own.

### Removed
- **v3 SettingsPanel — Copier button removed from the Latitude field** — the button was a port hangover from the Debug panel's Current-Position row (where it makes sense as a one-tap diagnostic copy). In Settings the value is already user-editable, so copying it to clipboard was redundant. Debug keeps its inline copy affordance untouched.
- **v3 SettingsPanel — "lock" glyph next to section numbers 2/3/4 removed** — the panel used `⚿` (U+269F) as a "Local only" cue, but the Geist/Rubik font stack doesn't carry that codepoint so the browser fell back to a tofu rectangle next to the section numbers. The same information is now communicated by the green "MODIFIABLE" pill on section 2 (sections 3/4 are implicitly local-only via the same write-path), so the glyph was pure noise. `lockIcon` prop is dropped from both `SectionHeader` and `DisclosureHeader`.

---

## [2.14.20] - 2026-05-14

### Fixed
- **v3 DebugPanel — service-call pills correctly coloured by HTTP code** — the recent-service-calls table coloured pills by comparing `info?.status === "ok"`, but the server stores the numeric HTTP code (200 / 503 / etc.), not a string. So every successful 200 fell through to the `err` branch and rendered red regardless of outcome. Replaced with a `httpStatusKind(status)` helper: 2xx → ok (green), 4xx → warn (orange), 5xx → err (red), anything else → neutral.
- **v3 DebugPanel — "Statut fournisseurs" (was "Status fournisseurs")** — corrected the FR section title; "status" is an anglicism, "statut" is the standard French noun.

### Changed
- **v3 DebugPanel — more strings localised**:
  - `TRUE` / `FALSE` boolean tags → `VRAI` / `FAUX` (FR), `VERDADERO` / `FALSO` (ES) on the `DEBUG` and `ALLOW_REMOTE` rows
  - Atlassian Statuspage indicators (`NONE` / `MINOR` / `MAJOR` / `CRITICAL` / `MAINTENANCE`) → FR/ES equivalents (`AUCUN` / `MINEUR` / `MAJEUR` / `CRITIQUE` / `MAINTENANCE`, and ES equivalents)
  - `UP-TO-DATE` / `YES` in the update-check row → `À JOUR` / `OUI` and `AL DÍA` / `SÍ`
  - `BLOCKED` security-events tag → `BLOQUÉ` / `BLOQUEADO`
  - `last fetch:` and all "empty state" placeholders (`No remote clients tracked yet.`, `No security events.`, `No provider status available.`, `No service activity yet.`, `No quota data tracked yet.`, `Cache is empty.`, `No radar snapshots yet.`, `No logs to show.`) localised in FR + ES
  - Vulnerability scan notice body text localised in FR + ES

---

## [2.14.19] - 2026-05-14

### Fixed
- **v3 DebugPanel — content no longer overflows the viewport at boosted zoom** — 2.14.18's panel font boost (1.32× at L) made `.kvKey min-width: 110 px` effective ~145 px, padding short labels out and pushing the "About this build" right column off-screen. Reduced `min-width` to 80 px (tight on the longest realistic localised key) and tightened the `gridTwo` column gap from 24 → 12 px. Added a container-query fallback that drops `gridTwo` to single column under 360 px bucket width, so dense buckets stay readable when stacked two-up at narrow desktop widths.
- **v3 SettingsPanel — Save button always fires when clicked** — the button's `disabled` attribute used to gate on `isDirty` (no edits → no save). Users reported "no visual feedback" on click after the panel font boost made the button look the same in both states. Now the button stays enabled whenever a save is possible (local mode + saveSettingsToJson available + not already in-flight). A no-op save still flashes "✓ Saved" so the user knows the click registered; server-side the save is idempotent.
- **v3 DebugPanel — section titles + bucket labels translated** — user reported a French-mode panel mixing FR overlay chrome with EN bucket content. Localised the five bucket labels (`Server` → `Serveur`, `About` → `À propos`, etc.) and the dozen most-visible section titles (`Server config`, `Network`, `Update check`, `Vulnerability scan`, etc.) into FR/ES alongside EN. KV row keys (uptime, rss, heap used, etc.) stay English on purpose — they're shared technical vocabulary and translating them would noise up the dense table without helping readers.

---

## [2.14.18] - 2026-05-14

### Changed
- **v3 SettingsPanel + DebugPanel — baseline font size bumped by ~15 %** — user feedback after 2.14.17: "the current Large should be the new Small". The panels house dense forms with 8–11 px labels which read as too small at kiosk distance even at the L step. Added `PANEL_FONT_ZOOM_BOOST = 1.15` multiplier in `src/ui/fontSize.js` and a new `resolvePanelFontSizeZoom()` resolver; SettingsPanel and DebugPanel now use it. Net effect: panel S(0.85)×1.15 ≈ main M, panel M(1.0)×1.15 = main L, panel L(1.15)×1.15 ≈ 1.32. The main UI (HeroBand, rail, slabs) stays on the original scale via the standard `resolveFontSizeZoom`.
- **v3 SettingsPanel — API key inputs styled like the Lat/Lon fields** — the API key text inputs used `var(--c-bg)` (slab background) which made them visually flat against the slab and easy to miss as editable. Switched to `var(--c-accent-soft)` (same fill as the `.fieldBox` wrapper on Lat/Lon), with a `var(--c-surface)` focus state. Now reads as a clearly interactive row at a glance.

### Added
- **v3 SettingsPanel — Brightness slider** — previously rendered as a read-only Field that just showed the current percentage with no way to change it. Replaced with a `<input type="range">` wired to `setBrightnessLive` (debounced server POST already in AppContext). Min comes from `brightnessMinPercent` (server-reported floor), max is 100, step 1. Thumb + track use the accent token. Slider sits in a `.brightnessRow` styled like the Lat/Lon fieldBox so the visual family stays consistent.

---

## [2.14.17] - 2026-05-14

### Fixed
- **v3 SettingsPanel + DebugPanel now scale with the text-size preference** — the S/M/L choice in Settings drove the rail and HeroBand zoom via `--c-font-scale`, but the SettingsPanel and DebugPanel overlays render as siblings of `<AmbientLayers>` in the React tree, so they're outside `.ambientRoot` and never saw the cascaded CSS variable. Result: changing text size did nothing inside the two overlays where the dense forms benefit most from it. Extracted the `FONT_SIZE_ZOOM` map into a shared `src/ui/fontSize.js`, then applied `zoom: resolveFontSizeZoom(fontSize)` as inline style on both overlays so they scale consistently with the rest of the v3 UI.

### Changed
- **v3 SettingsPanel — text-size labels now follow the active language** — the segmented control showed `S / M / L` regardless of locale. EN keeps `S / M / L` (universal clothing-style sizing), FR and ES switch to `P / M / G` (Petit/Moyen/Grand · Pequeño/Mediano/Grande). Section label also translated: "Taille texte" (FR) / "Tamaño texto" (ES) / "Font size" (EN).

---

## [2.14.16] - 2026-05-14

### Changed
- **Temperature unit "badge" repositioned to the top of the digit (MétéoMédia / TWN style)** — the previous baseline alignment dropped the small `°C` to the bottom-right corner of the big number, where it read as orphaned and easy to miss. Switched to `align-items: flex-start` on `.tempBlock` so the unit's top edge hugs the digit's top edge — same convention MétéoMédia and other weather brands use. Unit font also nudged up from ~33 % of the digit size to ~38 % (24 → 28 px on default breakpoint, 28 → 34 px on the wide-display breakpoint, 22 → 22 px on HeroCompact) so it carries enough presence at kiosk distance. Applied to both `HeroBand` (LayoutDesktop) and `HeroCompact` (LayoutPi) for parity.

---

## [2.14.15] - 2026-05-14

### Changed
- **Map controls reorganisation** — three small layout polishes now that the v3 bottom dock has plenty of room for additional toggles:
  - **Direction-arrows toggle** moved from a Leaflet imperative control at the map's top-left (next to the zoom +/-) into the bottom dock as a regular `ControlButtons` entry. Same `radarAnalysisEnabled` gate. Uses the Iconify `material-symbols/near-me-outline` icon (vs the previous unicode ↗ glyph rendered inline in the Leaflet anchor). State still lives in `showDirectionArrows` on context — same toggle behaviour, different render site.
  - **Radar-legend visibility toggle** added to the bottom dock too, gated on `radarSource === "rainviewer" && mapTimestamps` (same conditions the legend itself checks). Reads/writes `hideRadarLegend` via the existing `saveHideRadarLegend` context helper. Uses Iconify `carbon/legend`.
  - **Radar legend pinned to the left edge with the same edge-gap as the cards** (`left: var(--c-edge-gap, 16px)` instead of the 70 px clearance for Leaflet zoom that 2.14.12 used). The zoom controls move down to the same anchor (next item), so the 70 px clearance is no longer needed — they no longer compete vertically anyway since legend is at bottom and zoom at top.
  - **Leaflet zoom controls aligned with the cards' top edge** — Leaflet's defaults anchor at `top: 10px / left: 10px`; cards sit at `--c-edge-gap` (16 px). Override `.ambientRoot .leaflet-top.leaflet-left` so both stacks land on the same guide line. v2 layouts unaffected because the scope keeps the override out of their tree.

i18n keys added in EN / FR / ES: `controls.showRadarLegend`, `controls.hideRadarLegend`.

---

## [2.14.14] - 2026-05-14

### Changed
- **v3 map centring — now also accounts for the HeroBand height** — 2.14.13 fixed the horizontal off-centring caused by the right rail, but on LayoutDesktop the HeroBand at top-left still covered the upper portion of the outer 100 km radar analysis circle. Extended the `useRailOffset` hook (renamed to return `{x, y}`) to also measure the HeroBand's rendered height via a stable `[data-ambient-hero]` data attribute added to the HeroBand wrapper in LayoutDesktop. `panWithRailOffset` applies the Y offset by subtracting half the HeroBand height from the projected pixel Y, which pushes the marker visually DOWN past the band. LayoutPi stacks the hero info inside the rail (no top-left coverage) and so doesn't need a Y offset — `[data-ambient-hero]` is absent on Pi, the measurement returns 0, and behaviour matches 2.14.13. v2 layouts are still unaffected.

---

## [2.14.13] - 2026-05-14

### Changed
- **v3 map centring — marker now sits at the visual centre of the visible area, not the rail-overlapped one** — Leaflet's stock centring puts the marker at viewport-centre, but in v3 ambient layouts the right rail covers the right 320–360 px of the map. So a geographically-centred marker ended up visually north-east. Added a `panWithRailOffset` helper that projects the marker latLng to pixel coords, shifts the pixel point right by half the rail width, then unprojects — Leaflet centres on the shifted point and the marker lands at the visual middle of the non-rail area. Wired into `PanHandler` (covers map-click navigation + every `setPanToCoords` consumer), plus a new `InitialOffsetCentering` effect that re-centres on initial mount (MapContainer's `center` prop is only honoured once and ignored thereafter), plus `RailOffsetTracker` that re-pans whenever the rail collapses or expands. v2 layouts and v3 layouts in collapsed-rail mode get `railOffsetX = 0` and fall through to the stock Leaflet behaviour, so nothing changes for them. Future full-screen-radar mode (Phase 11) gets the same automatic 0-offset behaviour.

---

## [2.14.12] - 2026-05-14

### Fixed
- **Radar legend moved to bottom-LEFT in ambient mode** — 2.14.11's reset.css rule never matched because `.radar-legend` is CSS-Modules-hashed in the DOM while reset.css uses literal unhashed selectors. The legend stayed pinned bottom-right, behind the AI Summary slab. Moved the rule into `WeatherMap/styles.css` using the `:global(.ambientRoot)` escape hatch so the hashing aligns, and repositioned to `left: 70px; right: auto` — clears the Leaflet zoom buttons' column and stays well left of the rail regardless of font-scale or screen size.

---

## [2.14.11] - 2026-05-14

### Changed
- **Dashed radar circles in nightRed mode now use the dominant red** — 2.14.9 picked `#8c5a5a` (muted brick grey) for calm-tier rings, hoping that staying subdued would keep them out of "alert" territory. User preferred matching the same red family as the rest of the night-red UI, so switched to `#c04848` (the `nightRed.text` token). Risk-tier rings (yellow / orange / red overlays) intentionally stay louder since they're alert signals.
- **UpdateModal — nightRed palette overrides** — the in-app updater modal hardcoded dark-blue / green / amber tones (`#2a2a2a` container, `#1d4ed8` update button, `#3a2a14`/`#f59e0b` service-file warning, `#7dd3a8` command-block text). Felt visually disconnected when the rest of the UI was night-red. Added a `containerNightRed` class applied alongside `containerDark` when `useTimeOfDay() === "nightRed"`. Overrides only the visually-loud elements (container fill, cmd-section terminal, amber notice, update button) — the dark baseline still drives the smaller touches. Colours hardcoded to mirror the `nightRed.*` tokens from `tokens.js` because the modal sits as a sibling of `<AmbientLayers>` in the React tree and so can't pick up the `.ambientRoot` CSS variables.

### Fixed
- **Radar precipitation legend was hidden behind the v3 right rail** — the legend is positioned `bottom-right` of the map, which in v3 layouts is exactly where the right rail sits. Added an `.ambientRoot .radar-legend` rule that shifts the legend left by `rail-width + edge-gap` so it lands just left of the rail's outer border. v2 layouts don't define the CSS variables, so the legend stays at its original `right: 10px` for them.

---

## [2.14.10] - 2026-05-14

### Fixed
- **v3 nightRed mode — Leaflet zoom controls actually tint now** — 2.14.9 added `.ambientRoot .leaflet-bar a` rules but Leaflet's stylesheet (loaded from unpkg.com) ships rules that effectively pin `background-color: #fff` and `color: #000` plus a `text-shadow` that creates a halo around the +/- glyphs. Beat them with matching specificity + `!important` on the colour rules, kill the text-shadow, and cover the `:link / :visited / :hover / :focus / .leaflet-touch` states the Leaflet base styles target. Same treatment for the attribution strip.
- **v3 nightRed mode — Chart.js axes and title** — Chart.js draws on canvas so CSS variables can't reach it; the title (`Temp. 24 heures / Précipitations`) and axis ticks (`10 C / 5 C / 0 C` on the left, `1% / 0% / -1%` on the right, `22 / 01 / 04 …` on the X axis) remained near-white in nightRed mode. Extended the `fontColor()` helper with a `nightRed` flag returning `rgba(192, 72, 72, 0.85)` (matches the `nightRed.text` palette token), and threaded `useTimeOfDay() === "nightRed"` from both `HourlyChart` and `DailyChart` into their respective `buildChartOptions` calls so every text element on the chart picks up the palette.
- **Custom "↗" arrow control — active-state colour palette-aware** — the v3 imperative Leaflet control hardcoded `#2563eb` / `#fff` for its toggled-on state. Replaced with `var(--c-accent, #2563eb)` / `var(--c-bg, #fff)` (inline style CSS-var resolution Chromium does natively); ambientRoot descendants pick up the active palette, v2 layouts fall through to the original blue via the var() default.

---

## [2.14.9] - 2026-05-14

### Changed
- **v3 nightRed mode — dashed radar circles, radar legend, and Leaflet built-in controls now follow the palette** — the calm-tier rings rendered with a desaturated warm grey (`#a8a097`) in dark mode, but nightRed (sleep-stage-1 long-wavelength preference) still got the same grey — visually disconnected from the red-tinted slabs around them. Added a `nightRed` branch in `buildRingLayers` that picks a muted brick (`#8c5a5a`) for calm rings; the bright yellow/orange/red risk overlays intentionally stay loud regardless of palette since they're alert signals. The radar legend's text colour now reads from `var(--c-text)` with a fallback to the original near-white, so it picks up the active palette automatically in ambient layouts (v2 layouts keep the original grey via the fallback). Leaflet's zoom buttons + attribution strip + custom anchor controls were also tinted via global rules scoped to `.ambientRoot`, using `var(--c-surface) / var(--c-text)` so they auto-adapt to whichever palette is active. v2 layouts are untouched because the scope keeps the overrides out of their tree.

---

## [2.14.8] - 2026-05-14

### Fixed
- **v3 AiSummaryInline — maximize mode now fully opaque** — `--c-surfaceHybrid` (96 %) from 2.14.7 wasn't enough: the residual 4 % transparency was still picking up white-sky / yellow-rain / dark-water patches from the map in light mode, making the AI text's contrast inconsistent line by line. Switched to `--c-bg` (the only palette token guaranteed 100 % opaque on every mode). The backdrop blur stays as a safety net.

---

## [2.14.7] - 2026-05-14

### Changed
- **v3 AiSummaryInline — slab opacity bumped to `--c-surfaceHybrid` in maximize mode** — the rest-state fill (`--c-surface`, ~85 % opacity) lets the radar bleed through the slab, which is the right look when the slab floats above the map. In maximize mode the slab covers MetricsGrid + ChartTabs, not the map, so the underlying tiles read as visual noise behind the AI text. Reuse the `--c-surfaceHybrid` token (~96 %, originally introduced for the severe-alert hybrid mode) plus a 6 px backdrop blur — cleans up whatever residual transparency remains so the prose reads on a uniform, calm backdrop.
- **v3 AiSummaryInline — slab grows to fit 3 paragraphs when rail has the space** — the 2.14.2 `max-height: 360 px` cap sat there as a guard against "AI slab dominating the rail on tall displays", but in practice it truncated the 3rd paragraph (the `Analyse radar` block, typically the longest) on common layouts where the rail offered more than 360 px to the slab — 1280×800 Macs being the obvious case. With `flex: 1 1 0` the slab already naturally claims all remaining rail space without being able to overflow, so the cap was pure footgun. Removed. Min-height floor (160 px) preserved as a guard against very crowded rails.

---

## [2.14.6] - 2026-05-14

### Fixed
- **Weather cache no longer serves stale-shape responses across upgrades** — `proxyCtrl.js` persists the in-memory cache to `weather-cache.json` (loaded on startup, saved every 5 min). On the 2.14.4 → 2.14.5 upgrade — which extended the Tomorrow.io daily field list with `temperatureMax` / `temperatureMin` / `weatherCodeMax` / `precipitationProbabilityMax` for the v3 5-day column strip — the disk cache held entries built against the OLD 4-field list and kept serving them after the restart. The v3 React state was populated with the obsolete shape on first fetch and never refreshed (daily polling cadence is 24 h), so the strip rendered with missing icons and identical max/min temperatures. Fix: include an 8-char SHA1 of the requested field list in every cache key (`daily:abc12345:45.5017:-73.5673` instead of `daily:45.5017:-73.5673`). When the field list changes between releases, the new hash mismatches all legacy keys → cache miss → fresh fetch → new shape. `loadCacheFromDisk` also explicitly skips pre-2.14.6 entries (3-part keys) so the on-disk file self-cleans on first startup after upgrade.
- **Browser cache of API JSON cleared at the source** — Chromium can hold onto API responses for hours when the server doesn't send `Cache-Control` (heuristic max-age based on `Last-Modified`). This masked the cache-shape bug above and made debugging painful — `curl` returned fresh fields while the kiosk's `axios` call inside AppContext still got the cached stale shape. Added an Express middleware that emits `Cache-Control: no-store` on every `/api/*` response except `/api/tiles/*` (tiles are content-addressable and benefit from aggressive caching). Future upgrades that change response shape are automatically picked up on the next reload.

---

## [2.14.5] - 2026-05-13

### Fixed
- **v3 DailyForecastColumns — second pass on the missing icons** — 2.14.4's container shape fix (block-level, `font-size`-driven, mirroring HeroCompact) didn't move the needle for the user. Two changes that should: explicit `width={30} height={30}` props on `<InlineIcon>` so the SVG sizes off pixels rather than the 1em-relative font-size cascade, and switched the colour token from `var(--c-accent)` to `var(--c-text)` — the active palette's accent can sit close to the surface fill on some dark-mode combinations, and `--c-text` is the guaranteed-contrast token. The placeholder when the icon is falsy now shows `code N` (the numeric Tomorrow.io code) instead of just `—`, so a future debug round can distinguish "data not arriving" from "data arrived but icon not rendering" at a glance.

---

## [2.14.4] - 2026-05-13

### Fixed
- **v3 DailyForecastColumns — weather icons now render** — the column strip was correctly receiving `weatherCodeMax` from the server (curl-confirmed against `/api/weather/daily`), `parseWeatherCode` returned the expected `{icon, descKey}` object, but the icon never appeared. Root cause: the `.iconRow` CSS shipped in 2.14.2 was a `display: flex; height: 32px` container with `font-size: 28px`, and Iconify's `InlineIcon` was getting starved of vertical room by the parent flex computation. Switched to the same context HeroCompact uses successfully — block-level `font-size: 30px`, `line-height: 1`, no flex on the parent. SVG renders as expected at all five columns.

---

## [2.14.3] - 2026-05-13

### Changed
- **v3 AiSummaryInline — chevron removed, header simplified** — once the dedicated maximize button shipped (2.14.2), the expand/collapse chevron added a second toggle for a behaviour nobody asked for: hiding the AI body inside the slab. The summary body now always renders when the slab is mounted; users hide the slab entirely by collapsing the right rail at the layout level. Header layout cleaned up: title on the left, single action button (maximize / restore) on the right.
- **v3 ChartTabs — segmented control style** — separate bordered pills (2.14.2) read as two independent buttons rather than a "pick one of two views" selector. Switched to the platform-standard segmented-control idiom: a single bordered container wraps both options, the active option is filled with the accent token, the inactive is transparent inside the container with a soft-accent hover state. The unified outer outline makes the relationship between the two halves immediately legible.

### Fixed
- **v3 DailyForecastColumns — tolerant field lookup** — the 2.14.2 component read `temperatureMax` / `temperatureMin` / `weatherCodeMax` / `precipitationProbabilityMax` directly. If the server is still serving a cached pre-2.14.2 daily response (the daily cache TTL is 6 h), those fields are missing and the strip shows "—" everywhere except the day labels. Added fallbacks: temp falls through to `temperatureApparentMax`/`Min` then to plain `temperature` (avg used as both high and low when no spread is available), weather code falls through to `weatherCodeFullDay` / `weatherCodeDay` / plain `weatherCode`, precip probability falls through to plain `precipitationProbability`. The strip now renders something useful regardless of which payload shape the server hands it.

---

## [2.14.2] - 2026-05-13

### Changed
- **v3 ChartTabs — tabs now read as buttons** — the "24 hours" / "5 days" pair previously rendered as 11 px UPPERCASE-letter-spaced labels on a transparent background, distinguishable only by colour shift. Users read them as a section header and missed the interaction entirely. Switched to full pill buttons: bordered, background-filled, equal-width, 12 px non-uppercase text, accent fill on the active tab, hover/focus states with brightness and outline. A separator line below the tab strip gives the chart area a clear visual home.
- **v3 5-day forecast switched from Chart.js line to a column strip** — new `DailyForecastColumns` component replaces the v2 `DailyChart` line graph for the "5 days" tab inside `ChartTabs`. Each column shows the day abbreviation, weather icon (via `parseWeatherCode` + Iconify wi/* set), high temp (bold), low temp (dim), and precipitation % when ≥ 30 %. Matches the Claude Design "Next 5 days" mockup. The hourly tab still uses the Chart.js line — a temperature curve over 24 h is the right shape for that range. Server-side `/api/weather/daily` field list expanded to include `temperatureMax` / `temperatureMin` / `weatherCodeMax` / `precipitationProbabilityMax`; Tomorrow.io returns all of them in the same call, so this is a payload size bump only — no extra API cost. v2 DailyChart stays in the bundle for v2 layouts.

### Added
- **v3 AiSummaryInline — maximize / restore button** — the chevron alone only toggled the body's visibility, with no equivalent of v2's "expand into the panel" behaviour that let the user give long radar paragraphs more room to breathe. Added a dedicated maximize button in the slab header (Iconify `carbon/maximize` / `carbon/minimize`). Tap to promote the slab to `position: absolute` over the rail at z-index 5 — the body claims the entire rail height minus the header. Tap again to restore to flex flow. The button is hidden when the body is collapsed (nothing to maximize) and shows an `aria-pressed` state when active. Header structure refactored: the title row is now a separate `.header` wrapper containing the toggle + a `.headerActions` group with the maximize and chevron buttons side-by-side, each with their own `:focus-visible` outline and hover state.

---

## [2.14.1] - 2026-05-13

### Fixed
- **In-app updater silent about the 2.14.0 release** — `updateChecker.js` only flags an update as available when there's at least one commit matching the conventional-commits filter (`feat:` / `fix:` / `perf:` / `chore(deps):`). The 2.14.0 commit used a `release:` prefix and the subsequent cleanup used plain `chore:`, neither of which the filter recognised — so `commits` came back empty and `updateAvailable` stayed `false`, even though `localSha !== latestSha`. The kiosk reported "up to date" while sitting two commits behind a tagged release. Add `release` to the recognised set and log the precedent inline. Same trap as the `chore(deps):` addition from the May 2026 Dependabot incident. Client-side: new `update.release` i18n key (EN/FR/ES) and a violet `.badgeRelease` style so release commits read distinctly in the UpdateModal.

---

## [2.14.0] - 2026-05-13

### Changed
- **v3 "Ambient" interface promoted from experimental to opt-in preview** — the Direction C / Ambient Layers UI (Phases 0 through 9b) is now reachable by every user without `DEBUG=true` on the service. Removed the debug gate around the toggle in `AdvancedSettings`; relabelled the section from "Experimental" to "Preview" with clearer messaging that v3 is a full rebuild covering the dashboard, settings, and debug panels and that v2 remains the production default. Internal settings key stays `experimentalUiC` so existing `settings.json` files don't need migration. v3 SettingsPanel mirrors the same relabel ("Aperçu" / "Preview" section). i18n keys renamed (`experimentalGroup`/`experimentalUiC`/`experimentalUiCHint` → `previewGroup`/`ambientPreview`/`ambientPreviewHint`) in EN / FR / ES.

### Added
- **Bug-report breadcrumb in Debug → About** — `ui: v3-ambient (preview)` row so reports gathered during the coexistence window unambiguously identify which front-end was active. v2 Debug doesn't have an About card; absence of the row implicitly identifies v2.

### Fixed
- **AI summary slab in v3 — multiple paragraph rendering issues fixed in one pass**: body scroll cap was unreachable (replaced with flex-based sizing — slab claims remaining rail space, body fills inside, scrollbar always inside the visible viewport); paragraph split too strict (Claude occasionally emits single newlines, switched to `split(/\n+/).filter(Boolean)` in v2 + v3); paragraph spacing invisible (bumped to 16 px gap, prefixed `.body .text` to escape the `.ambientRoot p { margin: 0 }` reset in v3); scrollbar widened from 6 → 8 px and recoloured for visibility.
- **Weather data never refreshed in v3 layouts** — polling (10 min current / 60 min hourly / 24 h daily) lived in the v2 `WeatherInfo` component which v3 doesn't mount, so once the initial `setMapPosition` fetch fired the data went stale (~5 h in production). Lifted the polling effect into `AppContext`; every layout v2 / v3 alike gets fresh data without depending on a specific component being rendered.
- **Air-quality (IQA / AQHI / AQI) never refreshed in v3 layouts** — same shape as the weather-refresh bug: the v2 `UvAqiBadges` owned the 30 min `/api/air-quality` fetch. v3 read `aqhiInfo` from context but never had it populated. Lifted to AppContext.
- **MetricsGrid AQI tile lost the scale identifier** — three scales reach the client depending on source (`iqa` Quebec, `aqhi` Canada, `epa` US), and the same number means very different things across them. Surface the scale in the unit slot (`5 IQA` / `Bonne`) mirroring how `kph` anchors the wind value.
- **SettingsPanel API keys read-only on localhost** — Phase 8a regression. Restored editable inputs + Save button flow batching all 6 keys + lat/lon through `saveSettingsToJson()`.

### Added
- **Debug panel — install-update CTA in About** — reads live `updateAvailable` from AppContext so the YES tag flips immediately after `Check update`; `Install update…` button closes Debug and opens the UpdateModal. `needsManualUpgrade` swaps the button for a `bash deploy/install.sh` instruction.
- **Debug panel parity with v2 — full port of remaining sections**: Server bucket gets LAN URLs + Internet badge, init manager, power status, radar compression KPI + Export report, recent logs block. Client bucket gets full client KPIs (page load, FPS, JS heap, screen, API resource-timing). Services bucket gets per-service quota tables (hour / day / month + TOTAL, coloured by tier). Storage bucket gets radar AI snapshots (collapsible details, Copy per entry, Export JSON section-level). About bucket gets Dependabot vulnerability scan link. Header gets Export CSV button (reuses v2's `exportDebugCsv` via named export).
- **Debug panel pinned-bucket state persists across reload** — Set serialised to localStorage on every change, validated against current BUCKETS on init.

---

## [Unreleased]

### Added
- **Direction C UI preview — Phase 0 scaffolding** — first PR of the multi-phase rollout that culminates in v3.0.0 (full UI refresh based on Claude Design's Direction C / Ambient Layers package). Adds an `advanced.experimental.uiC` boolean to `settings.json` (default false), threaded through `AppContext` as `experimentalUiC` with the matching `saveAdvancedExperimentalFlag()` helper. When `true`, `App/index.js` renders the new `<AmbientLayers />` component (currently a placeholder card confirming the wrapper is wired) in place of the legacy WeatherMap + InfoPanel grid. The toggle lives in Advanced settings under a new "Experimental" group, **gated by `DEBUG=true`** so production kiosks and remote viewers never see it during the rollout cycle; the group migrates to a dedicated "Expérimental" section in Settings during Phase 8 and becomes visible to all local users at that point. i18n keys `settings.advanced.experimentalGroup` / `experimentalUiC` / `experimentalUiCHint` added in EN / FR / ES. The placeholder uses the warm-grey palette tokens from the Direction C design as a smoke test that the new visual language is reachable. See `docs/ui-direction-c-implementation-plan.md` for the full 11-phase plan.

### Added
- **Minimal test suite for the radar trend pipeline** — first automated tests on the project. `test/radarTrend.test.js` encodes the three live cases that shaped the v2.13 trend overhaul (Sorel approaching, Stratford drifting, Beauce-Sartigan intensification-in-place) as regression assertions, plus coverage of `summarizeRingTrend` intensity-weighted tie-breaks and `computeTrendConfidence` scoring. 12 assertions, ~140 ms total. Runs via `npm test` using Node's built-in `node --test` runner — no test framework dependency. Internal helpers exposed via a `__test` export on `radarAnalyzerCtrl` so the public surface stays clean. New `### Tests` section added to `CLAUDE.md` documenting the convention.

### Changed
- **README mentions v2.13 alert features in the layout description** — the screenshot caption block now calls out the leading source badge (`RADAR` / `ECCC` / `NWS`), the optional confidence pill (green / amber / red), tap-to-cycle through multiple gov alerts, the collapsible alert-detail section with the kiosk-safe QR code, and the optional direction-arrow overlay on the map. Debug-panel feature list grew an entry for the new "Radar snapshots" section (last 10 AI-summary radar payloads + per-snapshot Copy + section-level Export JSON + inline failure-reason capture).

---

## [2.13.0] - 2026-05-11

### Fixed
- **Upgrade no longer blocked by stale `client/dist/` files** — second case of the same trap that earlier hit npm lockfiles (k5map, May 2026, v2.2.5 → v2.13.x). After the lockfile auto-discard landed in PR #90, the same user hit it again on `client/dist/bundle.min.js` — the compiled React bundle, also committed to git so Pis don't rebuild. Webpack output (the main bundle + chunked siblings + `bundle.min.js.LICENSE.txt`) gets regenerated on every PR upstream, and if a Pi had once run `npm run prod` locally (e.g. an old `--rebuild-client` install.sh invocation), the local copy drifts from upstream and `git pull --ff-only` refuses with "Your local changes to the following files would be overwritten by merge: client/dist/bundle.min.js". Extended the auto-discard list in both upgrade paths (`POST /api/update` in-app updater + `deploy/install.sh`) to also cover `client/dist`. Same rationale as the lockfile case: nobody hand-edits these files, they're 100 % auto-generated, and the next `git pull` writes the upstream copies back. Targeted `client/dist` as a directory pathspec so all current AND future generated files inside (chunked bundles, LICENSE, etc.) are covered automatically without enumerating each one.

### Changed
- **GovAlertDetail: QR points directly to the alerts table (`#alerttable` anchor)** — previous URL (`/canada_X.html`) dropped the user on a national map and required manual drill-down to their region. Switched to ECCC's home page with the `#alerttable` fragment, which scrolls directly to the alerts table on load. ECCC's site uses IP / browser geolocation to detect the visitor's region, so the alerts shown match where the phone is when the QR is scanned (typically right at the kiosk). Coordinates are NOT appended as URL params — ECCC's static HTML shows no evidence of reading lat/lon from the URL, and emitting the user's exact location to an external destination would leak in logs / referrers (violates our privacy posture). Comment in `SOURCE_LINKS` tracks the URL evolution (`/warnings/...` → `/canada_X.html` → `/index_X.html#alerttable`) so the next maintainer hits the precedent.
- **GovAlertDetail: QR-only footer (no text link)** — the text link alongside the QR was a one-way trap on the kiosk (no keyboard, no browser chrome, no way back) and not much better on desktop (user lands on an upstream page they then have to navigate manually). Maintainer call: ship QR-only. Both audiences scan the code — kiosk users with their phone, desktop users by aiming their phone at the screen or right-click → Save Image As. QR bumped from 80×80 to 96×96 now that it's the sole affordance. Footer collapses to QR + caption ("Scannez pour ouvrir sur votre téléphone"). i18n `govAlertDetail.linkLabel` removed. New rule in `CLAUDE.md`: "External links from the kiosk are kiosk-hostile — use QR codes only, never raw `<a>` elements" — applies to any future feature that wants to point at an external URL.

### Fixed
- **GovAlertDetail: footer (QR + link) always reachable, regardless of body length** — previous attempt bumped the scroll cap from 30vh to 65vh, but the section's outer container had no overall cap, so on tall messages the footer was still pushed below the InfoPanel's visible viewport. User report: "on prend toute la place disponible mais on ne peut pas aller vers le bas". Restructured the inner layout: outer `.container` capped at `calc(100vh - 280px)` (viewport height minus clock + banner + controls + padding + buffer), with `display: flex; flex-direction: column; min-height: 0`. The `.body` becomes `flex: 1` and `overflow: hidden`. The `.scrollArea` drops its own max-height and becomes `flex: 1; min-height: 0; overflow-y: auto` — it grows to fill whatever space remains after the footer. The `.footer` stays `flex-shrink: 0` so it keeps its natural height (the QR can't squish below readability). Net effect: short messages display in their natural height with no scroll; long messages show as many paragraphs as fit, with the footer (QR + link) always pinned to the bottom of the section and always visible. `min-height: 0` on the flex chain is the critical bit — without it, the inner `overflow: auto` is silently ignored because flex children default to `min-height: auto = content height`.

### Added
- **GovAlertDetail: QR code in the footer pointing to the official source page** — clicking the text link in a kiosk-mode browser was a one-way trap: no browser chrome, no Back, no way to return to the kiosk app without a keyboard (user had to Ctrl+F4 to escape, landing on an internal error). QR code in the footer (rendered via `qrcode.react`'s `QRCodeSVG` — 80×80 px, amber on white in light mode, amber on transparent in dark mode, no network needed) gives the kiosk user a phone-first path: scan, read on the personal device, kiosk stays put. The text link stays alongside the QR for users hitting the kiosk via SSH tunnel from a desktop browser where clicking works fine. Caption "Scannez pour ouvrir sur votre téléphone" / "Scan to open on your phone" / "Escanee para abrir en su teléfono".
- **GovAlertDetail: description body now takes the panel's available space when expanded** — previous cap (`clamp(120px, 30vh, 320px)`) created strong pressure to collapse the section right after opening it; the maintainer's intent is the opposite: when the user has chosen to read a gov alert, give them the room. Cap raised to `clamp(180px, 65vh, 560px)`. The weather-info area below the alert still scrolls internally; if it ends up too squeezed, the user collapses the alert detail (the chevron toggle stays visible). New rule documented in `CLAUDE.md` ("Gov-alert detail section — reading-first UX") so future maintainers don't shrink it again without context.

### Fixed
- **GovAlertDetail: external link no longer 404s** — the `/warnings/index_X.html` paths I had hard-coded as the link targets returned 404 on ECCC's current site (the user landed on "Nous ne pouvons pas trouver cette page Web" with no easy way back from a kiosk-mode browser). Verified the breakage with a quick `curl` sweep against the candidate URLs: all `/warnings/*` paths are 404, only the root domains and the `/canada_X.html` national-overview pages return 200. Switched the link targets to `meteo.gc.ca/canada_f.html` and `weather.gc.ca/canada_e.html` — stable landing pages with a clickable map and current warnings highlighted by province. Comment in the `SOURCE_LINKS` table notes the breakage history so the next "let me deep-link this" instinct hits the precedent first.
- **GovAlertDetail: long descriptions are scrollable and the source link stays reachable** — observed live on the Saskatchewan rainfall warning test: ECCC's full description (5 paragraphs, ~470 chars in French including the standard closing "Veuillez continuer à surveiller…") expanded the section past the bottom edge of the InfoPanel, hiding the "Voir toutes les alertes ECCC" link entirely. The section sits in `.alertArea` which isn't part of the scrollable `weatherInfoContainer`, so the overflow was simply clipped — user reported "le plus loin que je peux voir c'est la ligne qui se termine par #SKMeteo". Wrapped the description paragraphs in a `.scrollArea` div capped at `clamp(120px, 30vh, 320px)` with internal `overflow-y: auto` (plus `-webkit-overflow-scrolling: touch` for kiosk touchscreen momentum, and a thin amber-tinted custom scrollbar that matches the section's left-border accent). Short descriptions still fit in their natural height without an inner scrollbar; long ones get an inner scroll. The source link is rendered OUTSIDE the scrollArea so it's always pinned at the bottom of the expanded section regardless of body length.

### Added
- **GovAlertDetail: collapsible "alert detail" section under the banner** — banner used to display only the alert title (e.g. "Rainfall warning"), while the actual descriptive text from ECCC / NWS (`alert_text_fr` / `alert_text_en` — typically several sentences about expected accumulations, timing, recommendations) was being received and silently dropped. New collapsible section sits right under the AlertBanner inside the `.alertArea` wrapper. Default state collapsed (just the header "Détails alerte ECCC" / "ECCC alert detail" / etc. with chevrons on both sides for an obvious tap target on the kiosk touchscreen). Expanded state shows the description paragraphs + a discreet underlined link to the source's public warnings page ("Voir toutes les alertes ECCC ›"). Cycle position is shared with the AlertBanner via lifted state in `AppContext` (`govAlertIdx` + `cycleGovAlert`) — tapping the banner to advance to the next alert also swaps the description shown here, so the two stay in lockstep. The SHOW gate matches AlertBanner exactly (≥ 1 orange/red alert at the point) so minor-only situations stay silent. When the currently-displayed alert has no body text (occasional `special weather statement` entries with empty `alert_text` after status flips to `ended`), the section keeps the title and shows a discreet "no additional detail" note instead of disappearing, so cycling feels consistent across alerts. Visual language mirrors the AiSummary section (italic body, same chevron family) but with an amber left border that pairs visually with the warning banners above. External links go to landing pages (`meteo.gc.ca/warnings/index_f.html` / `weather.gov`) rather than deep-linked alert IDs — ECCC's public site doesn't expose stable permalinks matching the API IDs, and a generic landing page avoids ever sending the user's lat/lon as a URL parameter to the destination. i18n keys `govAlertDetail.title` / `linkLabel` / `noDetail` with `{{source}}` interpolation, in EN/FR/ES.
- **AlertBanner: tap to cycle through all active government alerts** — previously the banner showed only the highest-severity gov alert and silently dropped everything else, even when multiple alerts were active at the user's point. Now the banner becomes tappable when more than one gov alert exists: a `+N` pill (matching the source-badge geometry, slightly darker translucent fill) sits between the source badge and the title to indicate how many additional alerts are queued. Each tap advances the cycle A → B → C → A. The cycle includes minor/yellow alerts too — once the banner is showing because at least one orange/red alert exists, the user can browse the full list (frost advisories, special marine, etc.) in the same banner without going to a separate page. The SHOW gate is unchanged (still requires ≥ 1 orange/red active) so minor-only situations stay silent, preserving the original "don't devalue serious alerts with chatter" intent. Banner background colour follows the currently-displayed alert's tier — cycling into a yellow alert visually softens the banner to mustard (`#ca8a04`, white-text-readable), cycling back to a severe one returns it to red. Cycle index resets to 0 when the underlying alert list shrinks (alert expired, new payload). Keyboard accessibility: `Enter` / `Space` advance the cycle when the banner has focus, with a visible focus outline. i18n key `alert.cycleAria` (FR/EN/ES) provides the screen-reader description. The legacy `pickGovBanner` helper is removed since the cycle-aware logic supersedes it.

### Added
- **Radar-snapshot debug entries now record WHY the radar block was missing** — observed live on a Rivière-Nouvelle kiosk: AI summary came back with only 2 paragraphs, debug snapshot read `(no radar block in prompt)` — accurate but uninformative. Cross-checking the Services panel revealed `RainViewer (analyzer)` had returned 502 at exactly the moment the AI summary fired, but that diagnosis was 3 clicks away from the snapshot itself. Threaded a `radarUnavailableReason` variable through `aiSummaryCtrl.js` that captures the actual failure cause in three cases: (a) `analyzeRadar()` catch fires — captures `err.message` and emits a `console.warn` for the journalctl trail; (b) `analyzeRadar()` returns null silently (RainViewer 502 / no frames / etc., recorded internally via `recordServiceCall` before the early return) — reads the most recent `RainViewer (analyzer)` entry from `getServiceStatus()` and surfaces its status code + comment; (c) radar analysis disabled in settings — labels accordingly. The captured reason is woven into the snapshot's `radarText` field as `(radar unavailable: …)` for fast-path summaries and `(no radar block in prompt — …)` for Claude-path summaries. Diagnosis is now self-contained inside the snapshot — no need to cross-reference Service Status or systemd logs to know what went wrong.

### Fixed
- **Per-direction trend now requires real precipitation at both endpoints (no more spurious arrows from intensification-in-place)** — observed live on a Beauce-Sartigan kiosk: several orange "drifting" arrows pointed inward from directions where the radar showed scarcely any precipitation 45 min earlier. Decoding the snapshot: the peak in the NNE direction at t-45 was a `very light` cell at 100 km (effectively noise), and at `now` the peak was `heavy` at 65 km. The algorithm dutifully reported "the peak shifted inward by 35 km" and classified the direction as drifting — but the band hadn't actually moved. It had **formed in place** (intensified from noise to heavy) over the window. Same trap also fires when peak intensity at "now" is `very light` — pure sampling noise drifting a few km between frames triggers a trend label. Fix: in `computePerDirectionTrends`, both endpoints' peak intensity must be ≥ 2 (light tier or stronger) for any non-stable trend classification. If either endpoint sits at intensity < 2, the direction is forced to `stable`. Filters out: bands that intensify in place (peakOld < 2), bands that dissipate (peakNow < 2), and tenuous wisps drifting around at noise level (both < 2). Keeps everything that matters: bands with persistent moderate-or-stronger intensity that actually move. Also fixes a related smaller bug — `computeTrendConfidence`'s monotonicity check treated `drifting` as if it were `leaving` (the trend conditional only branched on `approaching`), so drifting cases never got the +25 monotonicity bonus even when their mid-frame peak position did sit between t-45 and now in the expected inward direction.

### Added
- **AlertBanner: new `drifting` trend label for "motion detected, ETA unclear"** — observed live on a Stratford kiosk: user sat in a heavy precipitation band that was visibly drifting around them, banner read `RADAR · 0% · Heavy precipitation in your area`. The 0 % confidence pill was technically correct (the dominant direction had `inwardShift ≥ threshold` but the projected arrival exceeded the 60-min ETA gate, so the trend was classified `stable` and the confidence-on-stable formula `(1 − |shift|/threshold) × 100` returned 0 %), but read as "the system has no idea what's happening" when the truth was "there's significant motion here that just doesn't qualify as approaching by the strict ETA gate". Introducing a fourth trend value `drifting` between `approaching` and `stable`: per-direction trend now becomes `drifting` whenever `inwardShift ≥ threshold` but the ETA gate fails (band moving inward but too slowly / too far to project a sub-60-min arrival). `summarizeRingTrend`'s tie-break order is now `approaching > drifting > leaving > stable`. Drifting bands are surfaced with their own banner wording (`Heavy/Severe precipitation drifting around you` / `Précipitations fortes/sévères en mouvement autour de vous` / `Precipitación fuerte/severa desplazándose en su zona`) — and crucially, the drifting label is shown regardless of confidence bucket. The whole point was to surface this case explicitly; falling back to position-only on the low-confidence path would defeat that goal. The confidence pill on the badge still carries the nuance. Drifting is also surfaced on the arrow overlay with a third colour (amber #d97706 / #fbbf24) — visually distinct from approaching's red and leaving's blue, reading as "movement detected but not urgent". The bumped-tier logic is unchanged: bumping is still tied to `approaching` only, since drifting by definition lacks the imminent-arrival signal.

### Fixed
- **WeatherMap: arrow head V no longer reversed** — the V-shape arrowhead's wings were computed in the wrong direction, opening forward of the head instead of trailing behind it. Visually this read as a "Y" rather than an arrow, with the apex at the wrong end of the line. User feedback: "j'ai de la difficulté à interpréter les flèches". Fix flips the wing-bearing logic so wings open opposite to the direction of motion (approaching: wings trail outward; leaving: wings trail inward). Arrows now read like normal arrows — apex forward, legs trailing.
- **AlertBanner: confidence pill restyled to match the RADAR source badge** — bright solid-fill variants (green/amber/orange with dark text) clashed with the banner's red/orange tier colour. User feedback: "ça jure un peu". Restyled to mirror `.source-badge` exactly (same font geometry, white text, semi-transparent fill) with only the hue differing per bucket. The bucket-coloured fill at ~55 % alpha lets the underlying banner show through, so the pill reads as an integrated extension of the badge rather than a separate pasted-on element.
- **WeatherMap: arrow toggle visually matches the +/− zoom buttons** — `↗` (U+2197) renders visibly smaller than `+` and `−` at the default 22 px Leaflet font size, even though all three buttons share the same 30×30 cell. Bumped the arrow glyph to 26 px with an explicit 30 px line-height so the trio reads as a single uniform stack.
- **Upgrade no longer blocked by stale npm lockfiles** — observed in production on a v2.2.5 → v2.12.0 upgrade attempt: the in-app updater rejected the upgrade because `package-lock.json` had been silently rewritten by an earlier `npm install` on the device, and `git pull --ff-only` refused with *"Your local changes to the following files would be overwritten by merge: package-lock.json"*. Same trap kept the manual `git pull` flow blocked, leaving the user stuck on a recovery recipe (`git checkout -- package-lock.json` then `bash deploy/install.sh`) that nobody guesses without help. Both upgrade paths now self-heal: (a) the in-app updater (`POST /api/update`) runs `git checkout HEAD -- package-lock.json client/package-lock.json` before its dirty-tree pre-flight check, so a lockfile-only drift no longer trips the local-changes 409 (other tracked-file modifications still block as before — the safety boundary is unchanged); (b) `deploy/install.sh` does the same lockfile reset at startup, then runs `git pull --ff-only` even when already on master (previously only switching from a non-master branch would pull). The lockfile auto-discard is safe because both files are 100 % auto-generated by `npm install`/`npm ci` — nobody hand-edits them — and `npm ci` regenerates them deterministically from the upstream copy after the pull. Errors from the discard step are tolerated (file may not exist on a partial clone, or already be clean — both are fine to ignore).
- **WeatherMap: arrow-toggle button now uses a proper Leaflet control** — initial implementation rendered the toggle as an absolutely-positioned `<button>` at z-index 1000, which looked correct but caught no clicks: every tap on the button propagated through to the map underneath, registering as a "select new location" action instead of toggling the overlay. Replaced with `ArrowToggleControl`, a thin component that uses Leaflet's `L.control` + `L.DomEvent.disableClickPropagation` so the toggle behaves like the built-in zoom +/- buttons (same styling base, same event handling, same topleft stack). The control is created once on mount; subsequent prop changes (active state, tooltip text) are reflected onto the existing DOM element via a separate effect to avoid tearing it down on every toggle.

### Added
- **WeatherMap: optional direction-arrow overlay** — small toggle button below Leaflet's zoom +/- controls (top-left corner of the map) flips an SVG arrow overlay on/off. Each arrow corresponds to a direction the analyzer has classified as `approaching` or `leaving`; stable directions are filtered out server-side because drawing arrows on bands that aren't moving would be pure visual noise. Arrow visuals encode three pieces of information at once:
  - **Position** — anchored at the peak sample's lat/lon (computed client-side via `offsetLatLon` from the peak distance + the bearing for that direction; same math the dot overlay already uses).
  - **Direction** — pointing toward the user when the band is approaching, away from the user when leaving. The head includes a small V-shape (~30° wing angle, 25 % of the arrow length) so the direction reads at a glance even on a busy radar map.
  - **Magnitude** — arrow length scales with the inward shift over the trend window, clamped to 0.4×–1.5× of half the peak distance so a fast-moving band reads visually heavier than a small drift but a single long arrow can't cross the whole ring and obscure others.
  - **Confidence** — opacity = confidence/100 (floored at 0.25 so even low-confidence arrows stay visible). Stroke weight scales gently with `peakIntensity` (cap 4 px). Approaching arrows use a warm hue (red), leaving uses a cool hue (blue) — independent of the dashed-circle tier colour so the arrows don't blend into the ring they sit on.

  Server side: `directionVectorsFromMap` reads the per-direction map produced by `computePerDirectionTrends` and emits `[{ direction, peakDistance, peakIntensity, magnitude, trend, confidence }, ...]` per ring in the `/api/radar-risk` payload. Client side: state lives in `AppContext` (`innerDirectionVectors` / `outerDirectionVectors`); the toggle (`showDirectionArrows`) is persisted in `localStorage` so a power user debugging a kiosk doesn't lose the overlay across reloads. Default OFF — kiosk view stays clean.

  i18n: `radar.showDirectionArrows` / `radar.hideDirectionArrows` for the button title (FR/EN/ES).

### Added
- **AlertBanner: confidence pill + confidence-aware wording** — visible follow-up to the trend-confidence pipeline shipped earlier in this session. The radar-derived banner now renders a second pastille beside the existing `RADAR` badge with the ring-level trend confidence as a percentage (e.g. `RADAR · 85%`). Three colour buckets following the bucket helper in `AlertBanner/index.js`: green (≥ 70 % — high confidence), amber (40–69 % — middling, the data points the right way but doesn't overwhelm the threshold), saturated orange (< 40 % — barely supports the label). Saturation tuned so the orange "low" pill stays readable against the banner's own orange tier — solid background + dark border. Government banners (`ECCC` / `NWS`) keep their single source badge; confidence has no meaning for an authoritative feed and showing 100 % everywhere would be visual noise. Companion change in the wording: when confidence is in the middle bucket, the `Approaching` / `Leaving` keys are swapped for hedged variants (`ApproachingHedged` / `LeavingHedged`, e.g. "Précipitations sévères qui semblent s'approcher" instead of "approchent"); when confidence is below the low cutoff, the trend label is dropped entirely and the wording falls back to the position-only `Near` / `Approaching` (location-based, not trend-based — same key the no-trend path already uses), so the banner doesn't claim a movement direction it isn't sure of. Bumped wording (the analyzer's tier-escalation case) is not hedged: the bump itself already encodes "the analyzer thinks this is real enough to escalate the tier", so confidence-based softening on top would double-count uncertainty. Four new i18n keys per locale: `redApproachingHedged`, `redLeavingHedged`, `orangeApproachingHedged`, `orangeLeavingHedged`. Thresholds named (`CONFIDENCE_HIGH = 70`, `CONFIDENCE_MID = 40`) at the top of `AlertBanner/index.js` so future tuning is a one-line change.

### Fixed
- **Ring-trend summary now intensity-weighted (no more "leaving" overriding an active threat)** — observed live on a Sainte-Victoire-de-Sorel kiosk: the AI summary said "very heavy band approaching from WNW, ETA 30-45 min" while the alert banner read "Précipitations sévères mais s'éloignent". Both signals came from the same RainViewer snapshot pipeline; both should agree. The mismatch came from `summarizeRingTrend`'s old "any approaching wins, then any leaving wins, else stable" rule. Decoded from the radar text export the user shared: WNW had a very heavy peak that moved from 85 km to 45 km over 45 min — clearly approaching at ~50 km/h — but the per-direction logic classified it as `stable` because the projected arrival (57 min) didn't clear the 30-min ETA gate. Meanwhile a weak SW band that had dispersed (heavy at 75 km → very light at 95 km) cleared the `leaving` threshold by inward-shift magnitude, and the ring summary collapsed to "leaving" purely because no other direction had `approaching`. Two coordinated changes:
  - **Intensity-weighted summarization** — `summarizeRingTrend` now picks the direction with the highest peak intensity in the latest frame and returns that direction's trend. Same band that defines the displayed tier (red/orange/yellow) also dictates the trend label. Tie-breaker on equal peak intensity: `approaching > leaving > stable`. Closes the loophole where a weak dispersing band overrides an intense approaching band on a different bearing.
  - **Wider arrival gate** — `arrivalLimitMin` raised from 30 to 60 min. A band 50 km out moving at 50 km/h is genuinely approaching and the user benefits from being warned 50 min ahead, not only when the band is ≤ 30 min away. The bump-to-next-tier still applies, so the banner upgrades to "approaching" wording (not just "near") whenever this fires.
- **Per-direction trend confidence (0–100) exposed end-to-end** — every per-direction trend now carries a confidence score. For `approaching`/`leaving`: built from inward-shift magnitude (up to 60 pts at 2× threshold), monotonicity across the mid frame (up to 25 pts when the t-15 frame's peak distance lies between t-45 and t-0 in the expected direction), and intensity persistence (up to 15 pts when both endpoints are ≥ light precip — guards against single-pixel noise). For `stable`: inverse of evidence-for-movement, so a direction sitting well below threshold reads as "definitely stable" while a direction blocked only by the ETA gate reads as "barely stable". Confidence is surfaced in `getRiskLevels`'s response (`inner.trendConfidence` / `outer.trendConfidence`) and threaded through `AppContext` (`innerTrendConfidence` / `outerTrendConfidence`) so the debug panel, future banner-hedging logic, and AI-summary prompt enrichment can read it. Diagnostic log line now includes `@N%` after each trend label so journalctl forensics can grep on confidence.

### Added
- **AlertBanner: radar-derived banner now carries a `RADAR` source badge** — observed live on a Montreal kiosk where a "Précipitations sévères mais s'éloignent" banner appeared during an approaching front. The user (correctly) wondered whether the banner came from ECCC, since ECCC alerts use the same orange/red visual style and a leading `ECCC` badge that the locally-derived banner lacked. Side-by-side comparison made the gap obvious: the ECCC alert (e.g. "Avis de gel") had its provenance tagged, while the radar-derived banner read as if it were from a third party. Symmetry restored — `AlertBanner/index.js` now renders a `<span className={styles.sourceBadge}>RADAR</span>` for the radar path, mirroring the existing `NWS` / `ECCC` badges from `pickGovBanner`. Same CSS class, same visual proportions; the only thing the user sees differently is the prefix. New rule added to `CLAUDE.md` ("Alert banners — always identify the source") so any future banner-producing source ships with its own short uppercase tag (3-5 chars) from day one. Also documented the three-source taxonomy in `docs/ai-summary.md`'s feature matrix and in the `AlertBanner` JSDoc.
- **Debug panel: per-snapshot Copy button + section-level Export JSON** — follow-up to the radar-snapshots section. The CSV export at the panel level flattens multi-line `radarText` into single rows with ` | ` separators, which is fine for spreadsheet inspection but awkward for diagnostic sharing where the per-direction radar formatting matters. Two new export affordances on the snapshots specifically: (1) a small "Copier" / "Copy" / "Copiar" button that appears at the top of each expanded snapshot, copying a plain-text rendering of that single entry to the clipboard (header line + radar text + summary, with original newlines preserved) — fastest way to paste a problematic case into a chat or issue. Includes a transient "Copied!" feedback that resets after 1.5 s, scoped per index so concurrent clicks don't race. (2) An "Export JSON" / "Exporter JSON" / "Exportar JSON" button on the section header that downloads `radar-snapshots-<timestamp>.json` containing the full array as it came from the server (preserves all metadata: `ts`, `lat`, `lon`, `lang`, `source`, multi-line `radarText`, `summary`). The clipboard API requires a secure context — localhost satisfies it, and the catch handler is silent because the failure modes (insecure context, denied permission) all fall outside what the kiosk encounters in practice. i18n keys for EN / FR / ES.
- **Debug panel: recent radar snapshots section** — when the AI summary's radar paragraph disagrees with what the kiosk's radar map visually shows (observed live on a Montreal kiosk where Claude reported "stationary or slightly receding" while the animation clearly showed a band approaching from the west), the maintainer needs to see exactly what the analyzer fed into Claude to decide whether the bug is in the analyzer's compression, in the prompt, or in Claude's interpretation. New server-side ring buffer (capacity 10, FIFO) in `aiSummaryCtrl.js` records every emitted summary alongside the `radarText` block that produced it, with metadata (`ts`, `lat`, `lon`, `lang`, `source: "fast-path" | "claude"`). The buffer is exposed through `getRecentRadarSnapshots()` and surfaced in the localhost-only `GET /api/debug` payload as `radarSnapshots`. New `RadarSnapshotsSection` in the Debug panel renders each entry as a `<details>` block (timestamp + location + lang + source in the summary line, expanding to the full `radarText` and the resulting summary in monospaced `<pre>` blocks). Snapshots are also flattened into the CSV export ("RADAR INPUT" and "SUMMARY" columns, with internal newlines joined by ` | ` so each snapshot fits one row). i18n keys added in EN / FR / ES. The buffer is in-memory only — it survives the cache window of any individual summary but is wiped on server restart, which is the right tradeoff for a debug aid (no need to grow a database).

### Fixed
- **AI summary's paragraph 2 no longer disappears (two distinct fixes)** — observed in production on two different kiosks: (1) on a Red Bay (Newfoundland) kiosk in calm conditions, the fast-path output rendered only paragraphs 1 and 3, with the period forecast silently missing; (2) on a Quebec City kiosk under active radar (Claude was invoked, fast path correctly bailed), Claude folded the period forecast as a trailing sentence inside paragraph 1 ("...vent à 11 km/h. Aucune précipitation n'est attendue.") instead of producing a standalone paragraph 2. Two distinct root causes, both addressed in this change. **(a) Fast-path gate 3 was permissive when Tomorrow.io was unavailable.** `isCalmStableState` checked `if (typeof periodMaxPrecip === "number" && periodMaxPrecip >= 20) return false;` — a `null` `periodMaxPrecip` (Tomorrow.io hourly/daily cache miss for the relevant interval) silently passed the gate. The fast path then fired with `periodKind` and `periodSummary` also null, so `buildCalmDayTemplate`'s `[p1, p2, p3].filter(Boolean)` dropped paragraph 2 entirely. Tightened to require an actual numeric `periodMaxPrecip`: the gate now refuses `null` and defers to Claude. Slightly more expensive than rendering a 2-paragraph template, but always correct — the fast path is a confidence-based optimisation, and missing forecast data means we don't have confidence. **(b) Claude's prompt didn't enforce paragraph separation strongly enough.** The per-paragraph instructions said "The first paragraph covers current conditions" / "The second paragraph covers tonight's evening" without explicitly forbidding a fold. Claude Haiku 4.5 occasionally optimised for brevity and merged a short period-forecast sentence into the current-conditions paragraph. Three reinforcements: (1) the global instruction now demands `\n\n`-separated paragraphs that "MUST stand on their own — never merge content that belongs to a different paragraph as a trailing sentence"; (2) the current-conditions slot explicitly says "do NOT add a closing sentence about the upcoming forecast"; (3) the period slot explicitly says "STANDALONE paragraph … MUST be separated from the current-conditions paragraph by a blank line and must not be merged into another paragraph as a trailing sentence, even if its content is short." Together these close both rendering modes for the same observable bug.
- **AI summary's radar paragraph stays radar-only (no forecast bleed)** — observed live on a kiosk pointed at Anticosti Island: current conditions calm but tomorrow's precipitation probability at 75 %, fast path correctly bailed and Claude was invoked. Claude's third paragraph started faithfully with `Analyse radar : Aucune précipitation n'est actuellement détectée dans un rayon de 100 km` (radar-correct), then drifted into `mais une dégradation est attendue demain avec l'arrivée des précipitations prévues` — bleed from the period-forecast section into what's labelled as a radar observation. Plausible source given the model's instinct to be contextually helpful, but the bleed is misleading: the user reads "Analyse radar :" as "what the radar shows" and Claude's secondary clause was sourced from Tomorrow.io's daily forecast, not from the radar snapshots. Tightened the per-paragraph instruction in `aiSummaryCtrl.js` to spell it out: *"describe ONLY what the radar shows … Do NOT reference the period forecast (paragraph N already covers that) — the radar paragraph is strictly about radar observations."* Also adds an explicit fallback for the no-precipitation case: *"If the radar shows no precipitation in the surveyed annulus, say so plainly without speculating about future conditions."* The fast path's templated radar paragraph already had this discipline ("rien à signaler dans les {distance}"); this brings the Claude path in line with it so the two rendering modes produce structurally consistent output.
- **Calm-day fast path now renders three paragraphs (was over-aggressive at one)** — the fast-path implementation that shipped earlier this session collapsed every calm-day summary to a single sentence ("Currently 7°C with cloudy and 64% humidity. Wind at 12 km/h. No precipitation expected in the near term."), which felt like a regression compared to the 2-3 paragraph output Claude produces on the same conditions. Original intent was "skip the LLM tokens spent on the third paragraph" but the implementation also dropped paragraph 2 (period forecast) and 3 (radar status) from the rendered output. Three coordinated changes: (1) `analyzeRadar` is now called BEFORE the fast-path gate so the snapshot is available either way — small CPU cost (tile cache hit + ~5-10 ms PNG decode), no Anthropic cost; (2) `isCalmStableState` grew a fourth gate that requires the radar snapshot to be fully clear (no "Active" block in the formatSnapshot output), defending against the case where Tomorrow.io reports calm but RainViewer shows an approaching band — in that case Claude takes over so the summary stays honest; (3) `buildCalmDayTemplate` now renders three paragraphs to mirror Claude's output structure — current conditions (paragraph 1), period forecast for the user's relevant window (paragraph 2, with new per-language `PERIOD_LABEL_BY_LANG` map covering `evening` / `overnight` / `tomorrow`), and radar paragraph 3 with the same `Analyse radar : ` / `Radar analysis: ` / `Análisis radar: ` prefix Claude uses, saying "rien à signaler dans les 50 km / 100 km autour" depending on the user's `distanceUnit` and whether `extendedRadius` is on. The token savings remain (still no Claude call on calm days), but the user-perceived information loss that the maintainer flagged is fixed. Cache key, TTL, and counter-non-incrementing behaviour unchanged.

### Added
- **AI summary "calm-day fast path" — skip Claude when nothing's happening** — cost-management optimisation motivated by reviewing 5 historical kiosk captures: ~40 % of them showed conditions where the AI summary added marginal value over the data already visible in the InfoPanel (no precipitation, low forecast probability, calm radar). New `advanced.ai.calmDayFastPath` setting (default ON) gates a server-side fast path: when the current weather code is benign (no active precipitation in the 4xxx-8000 range) AND current precipitation probability < 20 % AND the period forecast's max precipitation probability < 20 %, `aiSummaryCtrl.js` skips both the Claude call and the radar analyzer call entirely, then returns a templated localised summary built from the same Tomorrow.io values that would have entered the prompt. Per-language templates for EN / FR / ES, with a small `CALM_COND_BY_LANG` table covering the ~10 benign weather codes. Cache writes happen as before (15-min TTL keyed by `lat:lon:lang:period:units`), so the fast-path summary is reused for the cache window. The Anthropic token counter (`requestCounter.anthropic.summary`) does NOT increment on the fast path — the saved calls are clearly visible in the Debug panel's Quotas stripe. New toggle in Settings → Advanced → AI weather summary group; Claude is still invoked the moment any of the three gates trip, so the user never misses an active weather scenario. Expected impact at the typical kiosk cadence (96 calls/day at the 15-min cache TTL): ~40 % saved tokens on calm days. The hint copy explicitly tells the user "no quality loss — Claude is still called whenever something interesting is happening" so the toggle's intent is unambiguous.

### Changed
- **AlertBanner and radar-zone circles no longer require an Anthropic API key** — the rain-alert banner (`Severe precipitation in your area`, `Heavy precipitation intensifying`, etc.) and the dashed analysis-zone circles on the map were previously gated on `aiSummaryAvailable`, which goes false the moment the server returns 503 because no Anthropic key is configured. That coupling was a bug: the underlying `/api/radar-risk` endpoint is purely deterministic (RainViewer tile sampling + tier classification, no LLM call), so its outputs are useful regardless of whether the AI summary's natural-language paragraph is generated. Two fixes: (1) `riskFetchEnabled` in WeatherMap dropped its `aiSummaryAvailable` predicate — the poll now runs whenever a location is known and `radarAnalysisEnabled` is true; (2) the dashed circles are no longer hidden when there's no Anthropic key. To make the absence of AI legible at a glance, the calm-tier circle is rendered with reduced opacity (`0.85` → `0.35`) and a sparser dash pattern (`6 6` → `3 9`) when the AI summary isn't available — the analysis zone is still locatable but visually recedes. Coloured tiers (yellow / orange / red, set when precipitation actually exists in the zone) intentionally ignore this — alerts need to stay loud regardless of AI availability. Side benefit: `advanced.ai.radarAnalysisEnabled = false` is now a clean cost-management knob — disables the AI summary's third paragraph (no Anthropic tokens spent on radar narration) without killing the AlertBanner. Settings hint i18n updated EN/FR/ES to make the new scope explicit. `docs/ai-summary.md` updated to describe the visual distinction.

### Added
- **Sleep-mode stage 2 now drops the backlight to zero (where the panel allows it)** — follow-up to the screensaver feature, motivated by HMIRaspi field observation: the 10" ED-HMI3010 panel has severe LCD backlight bleed in dark rooms, and the previous 10 % brightness floor in stage 2 didn't fully mitigate it. Stage 2 now sends `{ percent: 0, allowOff: true }` to `POST /api/brightness`; the server's `writeBrightness()` helper grew an `opts.allowOff` flag that lowers the floor from MIN_PERCENT (10 %) to 0 specifically for this single write. The slider in the regular Settings UI does NOT pass it, so the 10 % safety floor still protects users who'd otherwise yank brightness to 0 by mistake during normal operation. On panels that honour 0, the backlight goes fully off (cleanest anti-burn-in + maximum bleed mitigation). On panels whose driver clamps internally (some industrial all-in-ones — confirmed on a defective ED-HMI3010 unit), the hardware floor takes over silently. Touch wakes the screen instantly regardless (the touch driver is independent of the backlight), and the wake handler restores the pre-sleep brightness as before. An earlier iteration exposed a `sleepStage2Brightness` slider with range 0-50 %; it was removed after testing showed the knob added UI clutter without buying anything (panels that accept 0 should always go to 0; panels that don't accept 0 won't be helped by writing 5 % instead since the floor is hardware-bound regardless).
- **Sleep mode / screensaver — design A "Loom Sand"** — opt-in two-stage screensaver to protect the kiosk's LCD from burn-in and give the device a polished always-on appearance. After `sleepStage1Delay` minutes of inactivity, fades to a fullscreen minimal clock at a configurable dimmed brightness — italic serif date, ultra-thin sans-serif weight 200 time with tabular numerals, footer with weather glyph + temperature + condition (all three honour the user's existing 12 h/24 h, °F/°C/K and locale settings). After `sleepStage2Delay` minutes more, switches to a black screen with a single 4 px dot that repositions on a 5×5 grid every 5 minutes (anti-burn-in), with hardware brightness floored to its minimum. Three colour variants driven by `darkMode` and a new `sleepNightMode` toggle: **day** (cream `#f3eee7` / anthracite `#1a1816`), **night-cream** (anthracite / cream), **night-red** (near-black `#0a0808` / warm red `#cc4422`). The night-red variant uses long-wavelength red — same principle astronomers and pilots use to preserve night vision — minimal impact on melatonin, friendlier for a kiosk visible from a bedroom or hallway. Three coordinated visual decisions came out of kiosk testing: weather icon bumped from the design's 1.05 em to 2 em with `vertical-align: -0.15em` so it stays glanceable from across the room (the typography hierarchy is already carried by size + weight, so the icon needed to match); a 350 ms transparent-overlay grace period on wake absorbs the synthetic click that would otherwise reach the WeatherMap underneath and reposition the marker (chain: `pointerdown` wakes idle hook → `setStage(0)` → React unmounts before `pointerup`/`click` fire → ghost click hits the map); night-red unified to a single `#cc4422` across date/time/footer/dot rather than the original spec's `#ff6644` time + `#cc4422` date/footer split, because the saturation jump between two reds reads as a hue shift on the actual display rather than as a luminance hierarchy. Idle wake on `pointermove` / `pointerdown` / `touchstart` / `keydown` / `wheel`; the hook is a no-op when sleep is disabled (no listeners attached, no interval) so cost is zero for users who haven't opted in. Brightness orchestration is best-effort: the user's pre-sleep value is captured once on stage-1 entry and restored on wake; failure (no backlight, HDMI monitor, missing udev write permission) silently no-ops without breaking the visual. New "Sleep mode" group inside Advanced settings with six controls (`sleepEnabled` toggle / `sleepStage1Delay` dropdown / `sleepStage1Brightness` slider — hidden when no backlight / `sleepStage2Enabled` toggle / `sleepStage2Delay` dropdown / `sleepNightMode` toggle); sub-controls render conditionally so the section stays compact when sleep is off. All defaults OFF — existing installs see no change. Persisted under `advanced.sleep.*` (mirrors the `advanced.ai.*` and `advanced.display.*` patterns). Visual reference at `docs/design-references/sleep-mode.html` (Claude Design mock); React port at `client/src/components/ScreenSaver/`.

### Documentation
- **`docs/maptiler-cloud-plan-b.md` — empirical findings + ROADMAP follow-up** — followed up the initial doc-only Plan B with a live PoC against the maintainer's free-tier MapTiler key (20-character format, confirmed working). Added a "PoC findings (May 2026)" section documenting what we actually observed: IP geolocation returns Montréal coords with same accuracy as ipapi.co plus the timezone field directly (would let us drop `tz-lookup` if we switched); reverse geocoding's `language=fr,en,es` parameter returns all three languages simultaneously in a single call (real architectural advantage over LocationIQ's one-call-per-language pattern); all four documented map styles return valid PNG 256×256 with sensible file sizes; `streets-v4` is the closest to Mapbox `streets-v12` but with a more pastel palette that would require re-tuning the cream `rgb(238, 236, 232)` panel; `outdoor-v4` is a genuine new capability (lake names, terrain, no Mapbox free-tier equivalent) and worth adding as a 5ᵗʰ style option rather than a Mapbox replacement; `base-v4` too sparse for kiosk use, `hybrid-v4` niche. Doc nit fixed: documented field `languages` in the geolocation response is actually `country_languages` in the live API. The new ROADMAP entry below captures the actionable finding.
- **`ROADMAP.md` — new medium-term entry: `outdoor-v4` as a 5ᵗʰ map style option** — lake names, terrain features, and outdoor POIs surfaced by MapTiler's outdoor style for users in rural / cottage / mountain settings. Incremental addition (not a migration off Mapbox): new optional `mapTilerApiKey`, server-side tile-source selector (`mapbox` default / `maptiler` for this style), 5ᵗʰ value in the existing Advanced settings style picker. Free tier (100k tile requests / month) comfortably covers the 7-Pi fleet's ~30k actual usage. Estimated effort ~2-3 h. The other MapTiler styles tested (`streets-v4`, `base-v4`, `hybrid-v4`) explicitly noted as not worth shipping individually. — reference document for "if any of Mapbox / LocationIQ / ipapi.co becomes problematic, here's the prepared Plan B" rather than an active integration plan. Captures MapTiler Cloud's offerings (raster tiles, vector tiles, forward + reverse geocoding, IP geolocation), the free-tier limits (100k tile requests/month combined with geocoding, 5k map sessions/month — comfortably above current fleet usage), the relevant caveats (no commercial use on free tier, attribution required, no SLA), and per-service integration effort estimates. Also surfaces what we'd lose if we swapped Mapbox today (the cream `rgb(238, 236, 232)` panel tuned to `streets-v12`'s exact palette — a tuning cost separate from the technical swap) and what we'd gain (an `outdoor-v4` topo basemap Mapbox doesn't offer for free, more generous free quota). Maintainer holds a working free-tier key as of May 2026 so ad-hoc testing is unblocked. Verdict: don't switch today, but the path is documented if needed.
- **`docs/ai-summary.md` — explains the AI summary end-to-end** — new reference that walks through the feature from the user's tap to Anthropic and back. Splits the work explicitly into "what runs locally on the Pi" (cache lookup, Tomorrow.io / RainViewer fetches, PNG decoding for the 161-or-481 sample-point radar grid, intensity tier mapping, snapshot compression, unit conversions, prompt assembly) and "what runs at Anthropic" (one stateless `messages.create` call with the assembled prompt). Lists the five caching layers in order with their TTLs (summary 15 min, weather 15-30 min, tile 12 min, analysis 5 min). Documents the model-upgrade procedure: changing `claude-haiku-4-5-20251001` on line 362 of `aiSummaryCtrl.js` is the single mandatory edit; `max_tokens` / `temperature` / per-paragraph wording are tunables that may want re-tuning per release but never block the upgrade. Privacy posture spelled out — no user identifier, no IP, no history goes to Anthropic; the call carries only the assembled prompt. Linked from nowhere yet (will be added to `readme.md` if useful) so it stays a reference the contributor finds via `docs/` when they need it.

### Fixed
- **`install.sh` prompts for the AirNow and OpenAQ API keys** — the air-quality feature shipped with two new optional API keys (`airNowApiKey` for the US AirNow service, `openAqApiKey` for the global OpenAQ fallback) but the install script's interactive setup never offered to write them. New users had to discover the existence of those services post-install, then add the keys via the Settings panel (which triggered a server restart, and only worked from localhost). Two new prompts in Phase 2, marked optional, with the signup URLs documented inline above the read calls; both keys flow through the existing Python heredoc that builds `settings.json`. Either, both, or neither can be left empty — the server-side air-quality controller silently no-ops for the sources that aren't configured, falling back to the remaining ones (MELCC RSQA Montreal, RSQAQ provincial Quebec, ECCC AQHI Canada-wide). Existing installs are unaffected (no migration needed; the prompt only fires on the "configure API keys now" branch).
- **AlertBanner says "intensifying" instead of "approaching" when precipitation is already falling** — observed in a May 9 St. Louis screenshot: inner ring red + bumped, current weather code 4001 ("Rain"), 98 % precipitation probability, marker squarely under heavy radar tiles, yet the banner read "Precipitation approaching". The bumped-tier branch in `getRadarAlertState` was returning the generic `alert.approaching` key regardless of context, which made the banner read as a contradiction whenever the trend bump fired while rain was already falling at the location. Two coordinated changes: (1) the bumped branch now picks `alert.${tier}Approaching` (tier-specific — "Severe" or "Heavy" — instead of generic, matching the wording style of the other branches) when the user is currently dry, AND (2) when `currentWeatherData.weatherCode` reports active precipitation (Tomorrow.io codes 4xxx rain, 5xxx snow, 6xxx freezing rain, 7xxx ice pellets, 8000 thunderstorm), it picks new `alert.${tier}Intensifying` keys instead — semantically accurate (the bump means "a more severe band is moving in") and consistent with what the user is actually experiencing out the window. The orphan `alert.approaching` key was removed from EN/FR/ES locales since no code path emits it any more.
- **In-app updater now surfaces dependency-only batches** — observed live on a fleet of 7 Pis after the 2026-05-07 Dependabot batch (express 4 → 5, body-parser 1 → 2, plus minor groups) was merged: `/api/update-check` returned `updateAvailable: false` on every Pi despite the SHAs differing by 8 commits, and the modal-trigger button never appeared. Root cause was the commit-prefix filter in `updateChecker.js` which only accepted `feat:` / `fix:` / `perf:` — every commit in the batch was `chore(deps):` and got dropped on the floor, leaving `commits=[]` and the gate `updateAvailable = shasDiffer && commits.length > 0` falsy. Filter now also accepts `chore(deps):` and emits a normalised `type: "deps"` (matched against the literal `chore(deps)` capture so plain `chore:` commits still don't qualify), `UpdateModal` recognises the new type with a slate-grey badge to visually distinguish dependency upgrades from feat/fix/perf, and EN/FR/ES have a short `update.deps` label ("Deps"). Kiosks already on a recent commit will pick up the next dependency-only batch via the in-app button as soon as they're updated past this fix.
- **"Now" tick marker actually visible on the kiosk** — follow-up fix to the previous patch: the markers were defined but invisible on HMIRaspi (Bookworm + the Chromium it ships) because the show/hide mechanism leaned on `opacity: calc(var(--show-now-marker, 0) * 0.85)`. PostCSS's `var()` fallback emits a sibling `opacity: calc(0 * 0.85)` declaration first, and on the kiosk the calc-on-opacity-with-var path either short-circuits to the fallback or doesn't override it consistently — net effect: opacity stayed at 0 regardless of the runtime variable value. Replaced the var-based gate with a conditional className: the wrapper gets `radar-timeline-scrubber-wrap-with-now` only when nowcast frames are present, and the pseudo-element selector targets that class — no calc, no opacity dance, just present-or-absent. Bumped tick visual weight at the same time (3 × 8 px with a 1 px white outline + z-index 3) so they stand out against both the gray-past and amber-nowcast portions of the track at a glance.
- **Scrubber hit-zone extended vertically + visible "now" tick marker** — even after the dwell-time pointer-event fix, field testing on the 7" / 10" kiosks reported ~20 % missed grabs that didn't follow the dwell pattern. Root cause: the input element was only 10 px tall (8 px on small), so a finger landing slightly above or below the visible track fell outside the input box entirely (the 32 px-wide thumb above the track was decorative — not interactive — outside the input bounds). Three coordinated tweaks: (1) input height bumped from 10 → 32 px (8 → 24 px on the 7") so the user has a full thumb-diameter vertical hit zone, with the visible track still rendered at its original 10/8 px height via `background-size: 100% var(--track-h) no-repeat center`. (2) `margin-left` on the scrubber wrapper bumped 6 → 12 px so the leftmost-frame thumb has finger-room between it and the step-forward button — previously they visually touched and a missed tap on the thumb caught the button instead. (3) Inter-row gap inside the timeline overlay bumped 4 → 8 px (and the controls row's `margin-top` 2 → 4 px) so a finger drifting upward by a few pixels from the scrubber lands in empty space rather than on the speed or "Now" buttons in the labels row. New "now" tick marker — two short amber hairlines (top + bottom of the input wrapper) at the past→nowcast boundary — stays visible regardless of where the thumb sits, complementing the existing colour gradient (which becomes invisible exactly when the thumb covers the boundary). The marker fades out automatically when there are no nowcast frames available (no point marking "now" if the entire track is past). Implemented with a wrapper `<div>` around the input so we can use `::before`/`::after` pseudo-elements (not supported on `<input>` directly), with `--past-frac` and `--show-now-marker` CSS variables passed through inline style.
- **Scrubber thumb grabs on first tap, no dwell-time required** — after the padding-based hit-area fix, field reports went from ~20 % grab success to ~80 %. The remaining 20 % came with a smoking-gun observation: *"si je laisse mon doigt plus longtemps sur le curseur, le taux de succès augmente"*. That dwell-time dependency is Chromium's heuristic for native `<input type="range">` on touch devices — the browser tries to decide whether a touchstart on the thumb is a drag-start or a tap-on-track, and a quick tap on the kiosk's resistive-ish screen often resolved as a (no-op) tap. Override by attaching pointer-event handlers (`onPointerDown` / `onPointerMove` / `onPointerUp` / `onPointerCancel`) directly on the input: `setPointerCapture` keeps subsequent moves on the input even when the finger drifts off it, `e.preventDefault()` suppresses the native range input's own touch handling so the two don't fight, and `updateFromClientX` reads the input's `getBoundingClientRect()` + computed left/right padding (already configured to match the thumb radius) so the touch x-coord maps to the same trackable range the gradient calc uses. `onChange` stays for keyboard accessibility — Tab focus + arrow-key stepping go through the native handler unchanged. Mouse goes through the same pointer-event path as touch since Chrome unifies them.
- **Radar legend auto-hides while the timeline is open on the 7" Pi kiosk** — observed on the 7" kiosk with the InfoPanel deployed: opening the radar timeline while the legend was visible left the rightmost portion of the scrubber sliding under the legend block. Both elements are pinned to `bottom: 24px` (legend at `right: 10px`, timeline centred), and at small-screen widths the centred timeline reaches into the legend's column. The legend has higher z-index (1000 vs 500) so it visually masks the scrubber's right end — a purely visual issue (legend has `pointer-events: none`, so taps still go through) but ugly enough to make the scrubber feel broken at the rightmost frame. The legend now hides automatically while `radarTimelineVisible && isSmallScreen` (same `(max-height: 520px)` query that drives the other small-screen layout adaptations); on the 10" touchscreen and on desktops there's enough horizontal room that the two never collide, so no behavioural change there. Reappears the moment the timeline is closed. The existing `hideRadarLegend` setting still works as a permanent override.
- **InfoPanel-collapse toggle now also offered on the 10" Pi touchscreen (1280×800)** — the floating tab on the right edge of the radar map that lets the user hide the InfoPanel was gated behind `(max-height: 520px)`, which only matched the 7" Pi kiosk (~480 px tall). On the 10" touchscreen at 800 px height the toggle never appeared, so users had no way to maximise the radar view. Decoupled from the existing 520 px breakpoint (which still drives chart-tabbing and the compact radar-timeline variant — both should stay off at 800 px since the InfoPanel is tall enough to keep both forecast charts stacked) and bumped the collapse breakpoint to `(max-height: 820px)`. Most desktop monitors (1080+ px) stay above this and don't see the toggle. Added a safety net: if the viewport grows past the breakpoint mid-session (e.g. user attaches an external monitor) while the panel is collapsed, the panel auto-restores so it's not stranded with no toggle to bring it back. App's local `isSmallScreen` renamed to `canCollapsePanel` since it now diverges from the same-named flag in WeatherInfo. `touch-action: manipulation` added on the toggle button to match the radar-timeline controls' tap behaviour.
- **Scrubber thumb easier to grab at the rightmost frame** — follow-up to the v2.11 timeline touch-target sizing: at the rightmost frame position, the thumb sat flush against the timeline container's right border, leaving no finger margin to land on it. The leftmost position didn't have this problem — the step-forward button visually buffers the thumb on the left, but the right side ran straight into the container edge. Two coordinated tweaks: thumb 24 → 28 px (default), 20 → 24 px on the 7" kiosk variant — bigger grab target everywhere, not just at the extremes. Scrubber margin asymmetric — 0 → 12 px on the right (default), 0 → 8 px (small) — so the thumb at value=max sits well inside the container with finger room to either side.
- **Scrubber thumb fully grabbable at both extremes (proper fix)** — the previous round of touch-target work helped at the rightmost frame but missed the actual root cause, and reports kept coming in for both extremes ("difficile à attraper complètement à droite OU complètement à gauche"). Native `<input type="range">` renders the thumb's *centre* at the value's position in the trackable range, so at value=min the thumb's centre sits at the input's left content-edge — and the thumb's left half visually extends *outside* the input element. That left half is decorative (Chrome doesn't clip a styled thumb) but **not interactive** — only the half overlapping the input is grabbable. Mirror problem at value=max. The user effectively had half the hit area at the extremes that they had in the middle of the track. Fix: add horizontal padding equal to the thumb radius to the scrubber input, which insets the trackable range so the thumb is fully within the input element at both ends. The visible gradient still spans the input's full width via a `calc()` expression that aligns the past→nowcast colour break with the thumb's actual position — the JSX now passes `--past-frac` as a unitless 0-1 number instead of a percentage string so the calc can do `var(--thumb-w) / 2 + var(--past-frac) * (100% - var(--thumb-w))`. A single `--thumb-w` CSS variable drives both the thumb dimensions and the gradient/padding offsets, so the small-screen variant only needs to override one value (24 px on the 7" kiosk vs 32 px default — also bumping default 28 → 32 for slightly more grab area now that the layout is settled). Asymmetric right-margin from the previous fix retired since the padding handles the edge case symmetrically and properly.

### Added
- **Radar source toggle — Environment Canada as an alternative to RainViewer (Phase A: visual layer only)** — new Settings → Advanced "Radar source" preference (`rainviewer` (default) / `eccc`), persisted to `localStorage`. When `eccc`, the Leaflet radar layer switches from RainViewer's pre-rendered PNG tiles to Environment Canada's WMS GeoMet endpoint (`geo.weather.gc.ca/geomet`, layer `RADAR_1KM_RRAI`) for **6-min update cadence** vs RainViewer's ~10-min and authoritative Canadian radar (32 sites + NA composite, source of truth that RainViewer is downstream of). The radar timeline scrubber, play/pause control, and colour-scale legend are RainViewer-specific (the legend's palette matches RainViewer's intensity encoding, the scrubber drives RainViewer frame URLs) — they're hidden when `eccc` is active. **Server-side analyzer keeps using RainViewer regardless**, so tier/trend/AlertBanner stay on the same data path; this is purely a visible-layer swap. Phase B (port the analyzer to MSC's OGC API Coverages, with auto-source per `req.ip` geolocation, and wire ECCC's WMS time-dimension into the scrubber) is captured in `ROADMAP.md` and deferred behind real-world validation of Phase A on the Canadian fleet. Attribution per ECCC terms ("Radar courtesy Environment Canada"). EN / FR / ES under `settings.radarSource*`.
- **Radar animation timeline overlay (play/pause already existed; now scrub + speed + nowcast)** — the radar tile-cycling toggle in the bottom control bar has worked since v1, but it was a binary play/stop with a fixed 1-second-per-frame cadence and a hard-coded 10-frame past-only window. Three coordinated additions turn it into a proper storm-tracking control: (1) `getMapTimestamps` now fetches both `radar.past` (10 historical frames every 10 min) and `radar.nowcast` (3 short-range forecast frames) from RainViewer's `weather-maps.json` and tags each frame with `kind: "past" | "nowcast"`, so the timeline can surface the next 30 minutes of predicted radar in the same scrub. (2) New `<RadarTimeline>` overlay docked at the bottom-centre of the map shows the current frame's local time (timezone-aware via `mapTimezone`), a relative offset (`−40 min` / `now` / `+10 min`), a scrubber slider with a two-tone track (grey for past, amber for nowcast — split point driven by a CSS variable so the user can see at a glance where "now" sits), and a 1× / 2× / 4× speed-cycler button (`radarSpeed` lives in AppContext, persisted to localStorage). When the playhead lands on a nowcast frame the offset label switches to amber and adds a "forecast" prefix so observed and predicted radar are never confused. (3) The animation effect's per-frame interval is now `MAP_CYCLE_RATE / radarSpeed`, so the speed cycler takes effect immediately without restart, and the resolved current index is centralised through `radarFrameIdx` in AppContext (with a `lastPastIdx` default that anchors the playhead at the most recent past frame on initial mount — so the user sees current radar on first load, not the 90-min-old first past frame). Small-screen variant via `@media (max-height: 520px)` keeps the bar at clamp(220px, 50vw, 360px) and shrinks the speed button so it doesn't compete with the InfoPanel-collapse toggle on the right edge. EN / FR / ES strings under `radar.timeline.*` (`now`, `plusMin`, `minusMin`, `forecast`, `speedAria`, `scrubberAria`).
- **RainViewer in the Debug panel's Provider status section** — the panel's "Provider status" stripe queried five upstream status pages (Tomorrow.io, Mapbox, ipapi.co, LocationIQ, Anthropic Claude) but RainViewer was conspicuously absent despite powering both the radar map and the AI-summary radar paragraph. Adding it the conventional way (scrape `status.rainviewer.com/api/v2/status.json`) didn't work because RainViewer's status page is hosted on Hyperping rather than Statuspage.io and its public surface is a React SPA with no stable JSON endpoint. New `api-ping` provider type instead pings the actual RainViewer API URL the radar code already uses (`api.rainviewer.com/public/weather-maps.json`), with three indicator buckets: `none` when the response comes back under 3 s, `minor` when it's responsive but slow (≥ 3 s), `major` on timeout / unreachable. Slightly different semantics from the other entries — answers "is RainViewer's API currently answering?" rather than "is RainViewer self-reporting issues?" — but functionally what the kiosk owner cares about, and the latency reading surfaces slow-but-up situations that pure status-page scraping wouldn't. Cached 30 min like the other entries.

### Changed
- **Debug panel `npm audit` section retired in favour of a per-fork link to the repo's public dependency-PRs page** — the section read `<repo>/npm-audit.log` from disk and dumped its contents, but the file was a stale snapshot from the last `install.sh` run (since v2.4.x) and went out of date the moment Dependabot patched anything. Pis that ran an older `install.sh` were showing a long list of vulns that had already been resolved upstream, while macOS dev machines that never ran the old `install.sh` showed nothing at all — a confusing "did you run the script?" question that the section was never meant to ask. Renamed to "Vulnerability scan"; server now derives a per-fork URL pointing at `/pulls?q=is%3Apr+label%3Adependencies` from `git remote get-url origin` (same path the in-app updater uses, so a fork at `elewin/pi-weather-station` lands on its own PR list automatically). The PRs view is the public-facing source of truth for what Dependabot has opened and merged; the equivalent `/security/dependabot` alerts page is private to maintainers (404 for non-logged-in users), which would have been a confusing UX from a kiosk Chromium or a shared screen. The client section renders a one-sentence notice with a clickable link instead of dumping log content. EN / FR / ES strings added (`debug.vulnerabilityScan`, `debug.vulnerabilityScanNotice`); `debug.npmAudit` retired. `npm-audit.log` is no longer read by the server — Pis can safely `rm` the file (uninstall.sh's Phase 8 already cleans it up).
- **In-app updater detects divergence on every installed deploy/ artefact, not just the systemd service file** — the existing `serviceFileChanged` warning that v2.4.5 added to the Update modal hashed `deploy/pi-weather-server.service` against its installed copy at `~/.config/systemd/user/pi-weather-server.service`, but didn't extend that check to the other files `install.sh` copies into the user's home tree. Result: a fix to `deploy/start-server` (the kiosk launcher under `~/.local/bin/`) would land in the working copy via `git pull` but the *running* kiosk would keep using the old launcher until someone re-ran `bash deploy/install.sh` manually — the exact failure mode that hid the Chromium-singleton-lock-on-hostname-change fix from a Pi until it was diagnosed live. Generalises the existing single-file check into `checkDeployArtefactsChanged()` walking a per-platform list (Linux: `pi-weather-server.service`, `start-server`; macOS: `com.pi-weather-station.plist`), runs all the hash comparisons in parallel, and surfaces a `changedDeployFiles: string[]` array in the `/api/update-check` response. The Update modal now lists the divergent files inside the existing amber notice and switches the recommended command to `bash deploy/install.sh` (idempotent, only refreshes what changed) for any non-empty divergence — superseding the previous service-file-only `cp` + `daemon-reload` recipe. The one-click button stays disabled while divergence is detected, same as before. The legacy `serviceFileChanged` boolean is retired (the new array shape supersedes it); EN / FR / ES i18n string renamed to `update.deployArtefactsChanged` with copy reflecting the broader scope. Autostart files (labwc / wayfire / lxsession / XDG `.desktop`) aren't covered yet — their installed paths vary by display server and adding them would require detecting the active DE on the server side; a follow-up task in the project backlog.
- **`uninstall.sh` cleans runtime artefacts unconditionally before the project-dir prompt** — the script used to leave a small set of gitignored runtime files behind whenever the user opted to keep the project directory: `npm-audit.log` (legacy artefact from older `install.sh` runs), `server.log` (macOS launchd), `server/weather-cache.json`, `server/geolocation-cache.json`, `server/request-counts.json`, and the `report/` directory generated on demand by the Debug panel. New Phase 8 wipes all of them inconditionally — they're pure derived data with no user content, so a prompt would just be friction. If the user goes on to remove the project directory in Phase 9, this is a no-op; if they keep it, the working copy now lands as clean as a fresh `git clone`.
- **`install.sh` no longer drifts the lockfiles + Dependabot now owns vulnerability patching** — observed live on the Pi we'd run `bash deploy/install.sh` on after a hostname change: three tracked files (`package-lock.json`, `client/package-lock.json`, `client/dist/bundle.min.js`) sat dirty in the working copy, blocking the next in-app updater run with the misleading "Local uncommitted changes would be overwritten" pre-flight error. Root cause was four separate drift vectors in `install.sh`'s Phase 4: `npm install` re-resolves the lockfile, `npm audit fix` mutates lockfile + `package.json`, the same pair runs again in `client/`, and `npm run prod` rebuilds `bundle.min.js` deterministically-but-not-byte-identically. None of these are needed on a Pi: `client/dist/bundle.min.js` is committed to git so the kiosk serves the canonical master build, and the in-app updater already uses `npm ci` for exactly this anti-drift reason. Phase 4 now (1) installs server deps with `npm ci --no-audit --no-fund`, (2) skips the entire client phase by default — no `node_modules` written under `client/`, no rebuild — falling back to a build only if `--rebuild-client` is passed (developer scenario) or `bundle.min.js` is missing (accidental deletion), (3) drops `npm audit fix` entirely, since auditing on the device produced patches that were untested, inconsistent across Pis, and only ran at install time anyway. Vulnerability scanning + automatic security PRs now live on GitHub via `.github/dependabot.yml`: Dependabot opens grouped weekly PRs (dev-deps and prod-deps grouped separately for both root and `client/`, GitHub Actions on a monthly cadence, major bumps stay individual), reviewed and merged in dev where they can be tested, then propagated to every Pi via the in-app updater's `npm ci`. `readme.md` and `docs/logs.md` updated to point at Dependabot for current vuln status and to label the legacy `npm-audit.log` as no-longer-updated. Net diff in `install.sh`: -25 lines, install completes in seconds instead of minutes on the Pi, future installs no longer leave the working copy dirty.
- **Per-direction trend weighting — samples in "leaving" directions count one tier less for the ring's tier decision** — the morning false-positive screenshot was caught by hysteresis (one rogue pixel can't promote a ring on its own anymore), but a related failure mode would still slip through: a real precipitation band passing the user from approach to recession sits at the same raw intensity throughout, so two samples both at intensity 4 in the same outbound direction would still escalate the ring to orange even though the cell is on its way out. Symmetric refinement to the existing approaching-ring tier bump: a sample whose direction has been moving outward by more than the unit-aware shift threshold (5 km / 8 km on the inner / outer ring) over the 45-minute window now contributes its `intensity - 1` to the tier-deciding intensity, while approaching and stable directions keep full weight. Same evidence bar as the existing approaching detection — we only down-weight when the per-direction shift logic has the same confidence it would need to trigger a v2 bump on the other side. `computeRingTrend` was refactored into a `computePerDirectionTrends` primitive (Map<dir, "approaching" | "leaving" | "stable">) and a thin `summarizeRingTrend` collapser that preserves the existing approaching-wins-ties contract for the ring-level label. Diagnostic log gained a `dirs=aA/lL/sS` summary so post-mortem on a "why did the tier drop?" question can confirm the per-direction down-weighting fired.
- **Radar prompt formatter — only non-zero samples listed within the active annulus, fully-clear directions omitted entirely** — the previous "compressed" formatter had a Tier 3 rollup that collapsed an all-clear direction inside the active annulus to a single `DIR : clear` line, but every other direction still listed all 10 of its annulus distances regardless of how many were zero. On mid-cluttered radar geometries (the 0-25 % bucket of the compression-stats report — ~43 % of measured frames), that meant ~12 chars × ~10 distances × ~30 directions even when most of those samples were clear. New behaviour: directions with no precipitation in the annulus are omitted entirely; within an active direction, only the non-zero samples are listed. The aiSummaryCtrl preamble was updated in lockstep to declare the convention to Claude — *"any direction not listed is clear at every sampled distance in the active range, and any distance not listed inside a listed direction is clear at that specific sample point"*. Verified end-to-end: a real Montréal frame went from ~5000 chars compressed to ~2600 (61 % reduction), and Claude's resulting `Analyse radar` paragraph kept the same spatial precision (mentions specific bearings, distance ranges, intensity tiers, and trend) it had before. Compression-stats report taken right after the change shows 100 % of frames now in the 50-75 % bucket.
- **Hysteresis on the radar-ring tier — N-th highest sample (N=2) decides the colour, not the single max** — the morning false-positive screenshot from yesterday had a single sample at intensity 4 sitting right inside the 50 km zone painting the inner ring orange even though the visible cells were 80-100 km out. With 161 inner samples (1 + 16×10) and 320 outer samples (32×10), letting one rogue pixel decide the tier amplifies sampling noise, tile-boundary artefacts, and isolated bright pixels into full alarm-tier escalations. New behaviour: `getRiskLevels` computes the tier from the 2nd-highest sample on each ring instead of the max. A real precipitation cell large enough to matter typically covers several adjacent samples on the dense grid; if only one sample reads heavy and all neighbours read calm, that's much more likely to be sampling noise than a 5 km-wide cell sitting between samples. The `BUMP_MIN_INTENSITY ≥ 2` gate on the v2 trend bump now uses the same hysteretic intensity, so we never bump on a tier we wouldn't have entered without hysteresis. The raw `maxIntensity` is still emitted server-side for the diagnostic log (`[risk] inner=orange↑(max=5,tier=4,…)` makes it obvious when hysteresis is doing work) but is no longer kept on the client — the AlertBanner now reads a new `bumped: boolean` field the server emits directly, since deriving it client-side from `level vs naturalTier(maxIntensity)` broke once the tier and the raw max could legitimately disagree. `naturalTier()` removed from the client.

### Fixed
- **`start-server` clears stale Chromium singleton locks on hostname change** — observed live on a kiosk Pi after a `sudo raspi-config` hostname change: the desktop session came up cleanly but the Chromium kiosk never opened, with no GUI error and no log line obvious enough to find. Root cause turned out to be Chromium's profile lock format: the `~/.config/chromium/SingletonLock` symlink target encodes the holding process's hostname (`HOSTNAME-PID`) as a legacy safeguard for shared-NFS setups, and Chromium refuses to launch when the lock's embedded hostname differs from the current one (« profile in use by another computer »). The kiosk's desktop session has nowhere to surface that error, so the failure is invisible until the user opens a terminal and runs `start-server` by hand. `start-server` now reads the lock symlink target before launching, and clears the lock + companion `SingletonCookie` / `SingletonSocket` files **only when the embedded hostname differs from the current one** — a Chromium genuinely running on the same host keeps its lock untouched. Same defensive cleanup applied for Chrome / Edge / Brave profile dirs (each browser uses its own `~/.config/<vendor>/` subtree). One-line stderr notice when a stale lock is cleared so the next reboot's journal shows what happened.
- **AlertBanner copy softens when the precipitation band is moving away** — yesterday morning's screenshot captured a pure false-positive: orange banner ("Précipitations fortes à proximité"), orange dashed circle, but the actual cells were south-west of Montreal at 80-100 km and visibly drifting outward, the sky was clear at the kiosk, and the AI summary itself said *« elles s'éloignent lentement »*. The original `computeRingTrend` was deliberately silent on departing bands ("departing bands aren't called out separately — they don't change the displayed tier"); the assumption being that a leaving band wouldn't keep the inner ring at orange anyway. That assumption breaks at the boundary — a single sample at intensity 4 sitting right inside the 50 km zone keeps the ring orange even as the cell visibly drifts out. Two coordinated changes: (1) `computeRingTrend` now returns `"leaving"` when no direction qualifies as approaching but at least one shows the symmetric outward shift exceeding the same threshold (approaching still wins ties — an orange ring with two bands, one in and one out, stays a safety concern); (2) `AlertBanner` picks new `alert.orangeLeaving` / `alert.redLeaving` keys when the source ring's trend is `"leaving"` — *« Précipitations fortes mais s'éloignent »* / *« Précipitations sévères mais s'éloignent »* — atones the wording without changing the dashed-circle tier, which still reflects current intensity. EN/FR/ES strings added.
- **Radar prompt formatter falls back to the legacy block when its output would be longer** — the compression metric (added in 1b0d240) had been showing -1.2 % as the worst case across multiple morning reports: in certain mid-cluttered radar geometries (lots of varied non-zero readings, no rollup opportunities), the hierarchical "compressed" formatter's per-direction headers and section overhead outweigh the savings, producing a block 1-2 % longer than the naive baseline. `analyzeRadar` now compares the two outputs and emits whichever is shorter, so the prompt sent to Claude is never larger than naive. Bonus: `compressionStats.record()` already accepts the chosen-vs-legacy ratio, so the metric now floors at 0 % rather than going negative — no clamp needed. Same effective minimum, honest accounting.
- **Radar tiles now rendered at native 512 px (was downscaled to 256)** — same latent bug v2.11.0 caught on the Mapbox basemap, still present on the RainViewer overlay. The radar URL requested 512 px tiles (`/512/{z}/{x}/{y}/...`) but the `<TileLayer>` was missing the matching `tileSize={512}` and `zoomOffset={-1}` props, so Leaflet treated each PNG as a 256 px tile and downscaled it — paying the bandwidth without the resolution. Adds both props on the radar layer and bumps `maxNativeZoom` from 7 to 8 so it stays consistent with the new offset (Leaflet zoom 8 → server zoom 7, RainViewer's documented native ceiling). Visible improvement at kiosk zoom levels (≥ 8) where radar tile pixels were previously aliased. Cherry-picked from [@elewin](https://github.com/elewin)'s upstream [PR #77](https://github.com/elewin/pi-weather-station/pull/77), which applied the same triplet to the radar layer in his fork — his PR description was also where we learned RainViewer has explicitly capped their free-tier API to native zoom 7.

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
