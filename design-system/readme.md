# Pi Weather Station — Ambient Layers design system

The design language of the **v3 "Ambient Layers" UI** of [Pi Weather Station](https://github.com/thicla01/pi-weather-station): a React weather kiosk for a Raspberry Pi with a 7″ touchscreen (800×480), also served as a desktop page (≥ 1280 px) and a mobile PWA. Radar map, hourly/daily forecasts, government alerts, air quality, an AI summary — read at arm's length, at night, by touch.

This bundle is **extracted from the running codebase**, not from mockups. Palettes are transposed from `client/src/ui/tokens.js`; every other value comes from the component stylesheets under `client/src/components/ambient/`. **Where a mockup and this file disagree, the codebase wins**, and the port step drops anything the code does not have.

> **Two attributes drive everything.** The runtime root carries `data-palette="day|dusk|night|nightRed"` and `data-hybrid="none|light|full"`. This bundle exposes the same switches as `data-theme` (so the Design System pane detects the themes) and `data-hybrid`. Set them on any wrapper; every token below follows.

---

## Index / manifest

- **`styles.css`** (root) — the only file consumers link. `@import`s the tokens, the four themes, the hybrid swap and the radar tokens.
- **`overview.html`** (root) — at-a-glance gallery of the foundation cards.
- **`tokens/`** — `typography.css` (Geist faces + weight contract + size ladder + text density), `spacing.css` (radii, edges, padding, elevation, glass, touch), `layout.css` (rail / dock / gutters, viewport grammar, dock re-skin contract), `radar.css` (`--rc-*` / `--map-*` per palette).
- **`themes/`** — `day.css` (`:root`, default), `dusk.css`, `night.css`, `night-red.css` (scoped `[data-theme="…"]`), `hybrid.css` (`[data-hybrid]`, imported last).
- **`assets/fonts/`** — Geist Regular / Medium / Bold + Geist Mono Medium, woff2 (SIL OFL), the exact four faces the client ships.
- **`guidelines/`** — 9 foundation cards: palettes, severity tiers, category qualifiers & moon, hybrid levels, type scale & weights, shape & spacing, radar & map chrome, viewports, kiosk rules.
- **`SKILL.md`** — Agent-Skills-compatible entry point.
- **`components/ambient/`** — 7 specimen cards built from the production CSS (badges & chips, rail slabs, alert surfaces, hero, dock & squares, popovers & QR, forecast slab) + 5 React ports of the true primitives, each `.jsx` + `.d.ts` + `.prompt.md`: `SourceBadge`, `SeverityChip`, `ConfidencePill`, `MoonGlyph` (with `moonLitPath`), `MetricCell`. The ports use inline styles on the role tokens so they render standalone; the codebase keeps CSS Modules.
- **`ui_kits/screens/`** — 6 anatomies at real pixel size, tagged `@dsCard group="Screens"`: Pi 7″ 800×480 in **MID as the 7″ really shows it** (`pi-7in-glance` — the v3.3 priority glance: compact clock · hero with ⤢ · RADAR nowcast · air, legend chip, no timeline), **MID as the v3.2 stacked rail** (`pi-7in-mid` — what `LayoutPi` serves above the 540 px CSS-height gate, e.g. the 10.1″ at CSS 1024×640, drawn at 800×480 for scale), **MIN** (radar owns the screen + FloatingMiniBanner) and **MAX** (forecast-forward, 190 px map thumbnail); desktop 1280×800 (hero band + rail 320 + dock, watch active); mobile portrait 390×844. Shared recipes in `screens.css` (border-box, like production), glyphs in `sprite.svg`, notes in the kit's `README.md`. The stacked rails overflow on purpose — they scroll on the real screens.

---

## PALETTES — four, chosen at runtime

| Palette | When | Character |
|---|---|---|
| **day** (`:root`) | dark mode off | warm cream `#f4f0e8`, dark ink, amber accent `#b85a18` |
| **dusk** | dark mode on | deep warm grey `#1c1a17`, amber accent `#e8a050` — the palette every dark screen shows today |
| **night** | *defined, unreachable* | near-black `#0e0c0a`, copper accent — waits for solar wiring (Phase 5) to split dusk from night |
| **nightRed** | dark mode + sleep night mode | very dark red `#100404`, **everything red** — night-vision preservation |

Dispatcher: `useTimeOfDay()` in `client/src/ui/hybrid.js`. The iOS PWA paints `<html>/<body>` with `--c-bg`, except nightRed which uses the composite `#270c0c`. `color-scheme` follows (light for day, dark otherwise) so native form controls match.

**Roles (28, identical across palettes).** `bg` · `text` · `textDim` · `accent` · `accentSoft` (tints, outlines, badge fill, the dock's only ON signal) · `surface` (translucent slab fill, .85 — the radar shows through only where a surface floats over the map; see *Translucency by layout*) · `surfaceHybrid` (.96) · `border` (hairline) · `borderHybrid` · `warn` (moderate, amber) · `danger` (severe, red) · `advisory` (minor-tier strip — the map's alert gold `#f0c000`, **not** `sevLowInk`) · `cool` (informational blue-grey) · `sev{Low,Med,High}{Bg,Border,Ink}` (severity chips) · `moonLit` / `moonDark` · `cat{Good,Mod,Bad,Vhigh}` (air-quality / pollen / UV qualifiers). **There is no `success` token by design** — the warm-grey palette stays calm when things are fine.

**nightRed rules.** Every severity and category tier collapses to the red family, `advisory` too. The *word* (chip label, qualifier, badge) carries the tier; colour only says "alert". Text `#d05050` ≈ 5.1:1 and dim `#b84848` ≈ 4:1 on the card surface (WCAG AA). A component is finished only when it reads in all four palettes.

**Hybrid levels** (`themes/hybrid.css`). The worst active government-alert severity sets `data-hybrid`: moderate → `light`, severe / extreme → `full`. Three knobs move at once: surface .85 → .96, hairline → `borderHybrid`, and a left strip `box-shadow: inset 3px 0 0 var(--c-strip-color)` (amber for light, red for full; 4 px on the clock and hero slabs). No per-component logic — a slab only opts into the strip in CSS (see the slab recipe).

---

## TYPE — Geist, four faces, no exceptions

- **Faces:** Geist **400** (body) · **500** (labels, captions, most values — the workhorse) · **700** (popover titles and values, the hourly and daily-high forecast-cell temperatures, the active metric tab, emphasis) · Geist Mono **500** (every numeral, badge, section title). Hero temperatures (desktop 72 px / 88 ≥ 1600, mobile 56 px, Pi 39 px) and the clocks are Geist Mono 500, never 700. Self-hosted woff2, `font-display: swap`. **No 600, no italics, no synthesized weights** — `test/fontWeightGuards.test.js` fails the build on any other weight (43 rules had drifted by 2026-09; fixed in PR 353).
- **Stacks:** `"Geist", system-ui, -apple-system, sans-serif` and `"Geist Mono", ui-monospace, "SF Mono", Menlo, monospace`.
- **Ladder (observed, px before density):** 9 · 10 · 11 · 12 · 13 · 14 · 16 · 18 · 22 · 30 · 39 · 40 · 44 · 56 · 72 · 88. Named uses: desktop hero temperature 72 (88 ≥ 1600), desktop clock 44 (56 ≥ 1600), Pi hero temperature 39, Pi clock 30, mobile hero 56, metric tile value 22, NowcastLine 14, body 12–13, badges 11, mono eyebrows 10 (tracked .8 px, uppercase), SeverityChip 9.5 (tracked .12 em).
- **Hierarchy** comes from size, weight, tracking and uppercase mono eyebrows — never from a fifth weight. Large numerals track tight (−1 px at 39 / 40 / 44 and on the 56 px desktop clock ≥ 1600, −1.5 px at 56 on mobile, −2 px at 72 / 88). **Tabular numerals** wherever a value updates live.
- **Text density S / M / L** = 0.85 / 1 / 1.15 (`--c-font-scale`), applied as `zoom` on the rail subtree only (LayoutPi and LayoutDesktop `.rail`) — **never on the map**; the desktop hero slot, the dock and the mobile scroll column are not zoomed. HeroBand's micro text and the map-overlay text follow the preference through `calc(base * var(--c-font-scale))` instead. Settings and Debug overlays run one notch larger (× 1.15).

---

## SURFACES & SHAPE

- **The slab recipe** (the clock and the Pi / mobile hero): `background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 10px; padding: 12px 14px; box-shadow: inset 4px 0 0 var(--c-strip-color, transparent)`. Variants: the desktop hero and clock cards use radius 12 and add `0 8px 24px rgba(0,0,0,.25)`; metric cells, the air card and the indoor block use radius 8 and a 3 px strip; the forecast (ChartTabs) and AI-summary slabs are radius 10 with no hybrid strip; the alert head is radius 8 with its own tier-coloured `::before` strip. The dock and the framed Pi map use 14.
- **Radii:** 3 (source badge) · 4 · 6 (NowcastLine, popover rows) · 8 (cells, mini cards, alert head) · 10 (rail slabs, radar legend, Leaflet bar) · 12 (desktop hero / clock cards, AlertView, radar timeline) · 14 (dock, map frame) · pill (chips, period pills).
- **Elevation:** floating cards `0 1px 2px rgba(0,0,0,.08), 0 6px 16px rgba(0,0,0,.12)`; overlays `0 4px 16px rgba(0,0,0,.35)`.
- **Glass = map chrome only.** `backdrop-filter: blur(8px)` sits only on what floats over the radar: the legend card, its "(i)" chip, the mobile legend strip, the legend detail overlay (popover on the 7″/desktop, bottom sheet on mobile), the radar timeline bar (`WeatherMap/styles.css`); plus `blur(6px)` on the dock toast (`ControlButtons/styles.css`) — always with the `-webkit-` twin. **The dock has no blur, in every layout** (since 2026-10): it never sits over the map, apart from LayoutMobile's pull-to-refresh gesture (LayoutPi gives it its own grid row, LayoutDesktop insets the map above it, LayoutMobile stacks it under the scroll column), so a blur only frosted the flat `--c-bg` behind it — and made the dock the containing block of its `position: fixed` toast. Never over an opaque fill either: the maximized AI-summary and chart slabs sit on `--c-bg` and carry no blur (it would be invisible, yet recomputed on every frame the map moves under them).
- **Firefox drops the glass.** `client/src/index.js` stamps `<html data-browser="firefox">` at boot for any Firefox user agent, kiosk or remote viewer; `client/src/styles/main.css` then sets `backdrop-filter: none !important` on every element and raises `--c-surface` to `--c-surface-hybrid` (96 %) in every palette (the hybrid border and strip still mark an alert). So a frosted surface **must stay legible unblurred** over a busy radar, and **no layout may depend on the containing block or stacking context a blur creates** — a `position: fixed` descendant would resolve against a different box on Firefox than on Chromium.
- **Translucency by layout** — one `--c-surface` (.85), three compositions:
  - **Desktop** (`LayoutDesktop`): the hero band and the rail slabs float over the full-bleed map at `--c-surface`, **without** blur, so the radar shows through unfrosted. The maximized AI-summary / forecast slabs switch to opaque `--c-bg`, no blur (pinned by `test/opaqueBgToken.test.js`). The map stops at the dock (`.mapArea { inset: 0 0 var(--c-dock-height) 0 }`).
  - **Pi** (`LayoutPi`): the rail cards use the same `--c-surface`, but the rail is its own grid column (map | 300 px rail) over the layout's opaque `--c-bg`, so they read opaque. **On the Pi the difference is composition, not alpha**: only the map chrome sits over the radar (plus the FloatingMiniBanner in MIN, at 96 %).
  - **Mobile** (`LayoutMobile`): one scroll column over `--c-bg`; the radar is a clipped card (maximizable to the whole app area above the dock), so only its own chrome overlays it.
  - **Hybrid mode** lifts every surface to `--c-surface-hybrid` (96 %) — also Firefox's fill in every state.
- **Interaction feedback:** `:active { background: var(--c-accent-soft); transform: scale(.985) }` and `:focus-visible { outline: 2px dashed var(--c-text); outline-offset: -2px }`. **Hover paints nothing** (see rules). Buttons are reset to `font: inherit; background: transparent; border: 0; -webkit-tap-highlight-color: transparent` inside the root.
- **Dock contract:** the dock re-skins the shared control buttons through `--ctrl-btn-*`; press flash removed, `--ctrl-btn-down: var(--c-accent-soft)` is the only accent signal (= toggle is ON). Icons 24 px in 40 px buttons; dock min-height 52 (58 px rendered on LayoutPi; LayoutDesktop pins the cell to 52). Leaflet zoom / focus buttons are 40 × 40 (36 on mobile), radius 10, palette-tinted, no hover.

---

## LAYOUTS — three viewports, one grammar

| Viewport | Layout | Anatomy |
|---|---|---|
| **< 800 px** | `LayoutMobile` | one scroll column, pull-to-refresh, radar as a maximizable card, hero 56 px |
| **800–1279 px** (the 7″ kiosk is 800×480) | `LayoutPi` | grid `1fr 300px` + dock row `auto` (58 px rendered); framed 10 px gutters; rail states **MIN** (radar full-bleed, floating mini-banner) · **MID** (split: alert stack, compact clock, hero, nowcast line, air card; metrics 2×2 + indoor on the stacked rail only — in the Conditions view on the ≤ 540 px priority glance) · **MAX** (forecast-forward: map thumbnail, ChartTabs fills the rail) |
| **≥ 1280 px** | `LayoutDesktop` | full-bleed map, floating hero band (hero card + clock card sharing a hairline), right rail 320 (360 ≥ 1600; `min(60vw, 960px)` while a slab is maximized), dock 52, edge gap 16 |

Height gates: **≤ 520 px** compact Settings / Debug, compact timeline copy, and the radar legend collapsed to its "(i)" chip (when the timeline is on screen, or in LayoutPi's MID); **≤ 540 px** (CSS viewport height) switches LayoutPi's MID rail to the v3.3 priority-views glance automatically, whose alert / conditions entry points open full-rail views (a separate threshold on purpose; `localStorage.forcePriorityViews = "on"` forces it on taller viewports). The MIN / MID / MAX states exist on every Pi viewport, and the AI view opens from the dock on every Pi panel. Width gate: **≤ 600 px + portrait** hides secondary dock buttons.

---

## RULES — Kiosk & touch (the floor that wins)

1. **No hover-painted state, ever.** The kiosk is a touchscreen: a `:hover` that paints a background sticks after a tap even behind a media-query gate ("drop, don't gate"). Hover may only drop opacity. `-webkit-tap-highlight-color: transparent` on every tappable surface.
2. **No `animation: … infinite` on any kiosk-visible surface.** A composited loop keeps the Pi GPU awake every vsync (+12 °C measured). Transitions are one-shot, ≤ 300 ms, on user action only. `prefers-reduced-motion` crushes every duration to 0.01 ms.
3. **Hit targets ≥ 44 px** even when the visual is 28 px (pad the hit box, not the glyph).
4. **External links = QR code only.** The kiosk browser has no chrome and no way back; a text link is a one-way trap. Point to stable vendor landing pages, never deep links with IDs or coordinates. (Exception: the localhost-only Debug panel.)
5. **The map is never zoomed** by the text-density preference; Leaflet stays at native resolution.
6. **Everything renders in four palettes**; nightRed never relies on colour alone.
7. **Reading first.** A government-alert detail is collapsed by default; expanded, it lays out at full natural height (no cap) and the rail (or the mobile column) scrolls — the user chose to read. On the ≤ 540 px priority glance the alert card opens the full-rail AlertView instead.

## RULES — Alerts & status (honest about origin)

- **Every alert banner carries a leading source badge**: `ECCC` · `NWS` (official feeds), `RADAR` (local pixel analysis), `AIR` (air-quality health band: a tier-tinted category pill styled like the SeverityChip, followed by the index's own source badge AQHI / IQA / AQI — AQHI reads `CAS` in French, ECCC's own name, from the `metrics.aqScale.*` locale keys via `ui/airQualityDisplay.js`: the only source badge whose text follows the UI language). `FCST` tags the forecast-tab reason chip. **`TEST` is a qualifier, never a source** — a neutral *outlined* pill next to the source badge plus a "TEST ·" title prefix; never amber (amber turns red in nightRed and would fake an emergency).
- **Tier colour = CAP severity, not the alert type**: minor → yellow / `sev-low`, moderate → `warn` / `sev-med`, severe & extreme → `danger` / `sev-high`. The chip word is the parsed product type (Watch, Warning, Veille, Avert.). One alert, four colours — one per palette.
- A new banner-producing source gets a short uppercase tag (3–5 chars) that says where the data comes from — never `LOCAL` or `AUTO`. Source badges (ECCC, NWS, RADAR, FCST, AQHI (FR `CAS`) / IQA / AQI) share one visual (`SourceBadge`); reuse it, don't fork it.
- Radar: the RainViewer precipitation scale is the tiles' own colour scheme and is identical in all four palettes; alert polygons use `--rc-alert-*` (red-family steps in nightRed); the 50 km analysis ring is `--map-circle`. NWS alert bodies stay in English on purpose.

## ICONOGRAPHY

- **No emoji.** Platform emoji differ across macOS, Pi Chromium and Firefox and ignore the palette. Glyphs are inline SVG on `currentColor`; the moon is a parametric SVG — dark disc + bright lit side in every palette (the emoji convention; the light-disc silhouette field-tested as confusing).
- Severity chip = outlined triangle SVG (same shape for every tier; colour comes from the `--sev-*` tier) + uppercase mono word. Category pills = dot + word. Status markers are shapes, never font glyphs.
- Weather condition icons are Iconify SVGs sized by `font-size` (30 px desktop hero / 38 ≥ 1600, 24 px mobile hero, 18 px Pi hero, 16 px metric tiles), coloured `--c-accent`.

## COPY & I18N

- Trilingual **EN / FR / ES**; every kiosk-visible string exists in all three. French is Québec French (« Prévisions », « Ressenti », « Avert. »). Sentence case everywhere; UPPERCASE only for mono eyebrows, micro labels (metric-tile and popover labels and their qualifiers), source badges, severity / AIR chips and the day-of-week eyebrow above the desktop clock.
- Mockups use plausible real scenarios (Montréal, Québec, Winslow AZ Red Flag Warning), show the calm **and** the alert states, and never lorem ipsum. Units follow the user's preference (°C/°F, km/h, mm, km) — never hard-code one.

---

## What is normative vs illustrative in a handoff

- **Normative:** the palette tokens, `--sev-*`, `--mx-cat-*`, `--rc-*` / `--map-*`, the tier colours, the source badges, the four faces and weights, the radii, the three-viewport grammar, the kiosk rules above.
- **Illustrative:** micro-type sizes drawn for a 720 px mock device (the codebase re-bases on `--c-font-scale` and sits ~1–1.5 px above), exact paddings, safe-area values (the code pads with `max(12px, env(safe-area-inset-top))`-style expressions), the pin (the code keeps Leaflet's default blue pin at 0.65 opacity in day / dusk / night and swaps to the palette-aware target icon only in nightRed), any option the code does not expose.
- **Codebase wins.** When a mock invents a setting, a source, a style or a fifth weight, it is dropped at port time — cross every enumerated list with the real `SettingsPanel` and the server whitelist.

---

## How to use

**Mockups / prototypes:** link `styles.css`, set `data-theme="dusk"` (or `night`, `nightRed`; omit for day) and optionally `data-hybrid="light|full"` on a wrapper, compose from the role tokens, use the fonts in `assets/fonts/`. Show every screen in at least day and dusk, and every alert-bearing surface in nightRed.

```html
<link rel="stylesheet" href="styles.css">
<div data-theme="dusk" data-hybrid="full">…</div>
```

**Production port:** React + CSS Modules, one directory per component with `index.js` (JSDoc + PropTypes) and `styles.css` reading `var(--c-*)`; strings through `client/src/i18n/locales/{en,fr,es}.json`; no inline styles for static values; every timer and listener cleaned up. See `CLAUDE.md` in the repository for the full contract.

## Provenance

- `client/src/ui/tokens.js` (palettes) · `client/src/ui/fonts.css` (faces) · `client/src/ui/fontSize.js` (density) · `client/src/ui/reset.css` (scoped reset) · `client/src/components/AmbientLayers/index.js` (token mirroring, breakpoints) · `client/src/components/WeatherMap/styles.css` (radar tokens).
- `docs/ui-layout_en.md` / `docs/ui-layout_fr.md` (screen-by-screen reference), `docs/radar-classification.md`, `docs/design-references/README.md` (how prior Claude Design handoffs are kept), `CHANGELOG.md`.
