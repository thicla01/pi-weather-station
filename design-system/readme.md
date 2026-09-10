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
- **`ui_kits/screens/`** — 5 anatomies at real pixel size, tagged `@dsCard group="Screens"`: Pi 7″ 800×480 in **MID** (split, calm), **MIN** (radar owns the screen + FloatingMiniBanner) and **MAX** (forecast-forward, 190 px map thumbnail); desktop 1280×800 (hero band + rail 320 + dock, watch active); mobile portrait 390×844. Shared recipes in `screens.css`, glyphs in `sprite.svg`, notes in the kit's `README.md`. The rails overflow on purpose — they scroll on the real screens.

---

## PALETTES — four, chosen at runtime

| Palette | When | Character |
|---|---|---|
| **day** (`:root`) | dark mode off | warm cream `#f4f0e8`, dark ink, amber accent `#b85a18` |
| **dusk** | dark mode on | deep warm grey `#1c1a17`, amber accent `#e8a050` — the palette every dark screen shows today |
| **night** | *defined, unreachable* | near-black `#0e0c0a`, copper accent — waits for solar wiring (Phase 5) to split dusk from night |
| **nightRed** | dark mode + sleep night mode | very dark red `#100404`, **everything red** — night-vision preservation |

Dispatcher: `useTimeOfDay()` in `client/src/ui/hybrid.js`. The iOS PWA paints `<html>/<body>` with `--c-bg`, except nightRed which uses the composite `#270c0c`. `color-scheme` follows (light for day, dark otherwise) so native form controls match.

**Roles (28, identical across palettes).** `bg` · `text` · `textDim` · `accent` · `accentSoft` (tints, outlines, badge fill, the dock's only ON signal) · `surface` (translucent slab fill, .85 — the radar shows through) · `surfaceHybrid` (.96) · `border` (hairline) · `borderHybrid` · `warn` (moderate, amber) · `danger` (severe, red) · `advisory` (minor-tier strip — the map's alert gold `#f0c000`, **not** `sevLowInk`) · `cool` (informational blue-grey) · `sev{Low,Med,High}{Bg,Border,Ink}` (severity chips) · `moonLit` / `moonDark` · `cat{Good,Mod,Bad,Vhigh}` (air-quality / pollen / UV qualifiers). **There is no `success` token by design** — the warm-grey palette stays calm when things are fine.

**nightRed rules.** Every severity and category tier collapses to the red family, `advisory` too. The *word* (chip label, qualifier, badge) carries the tier; colour only says "alert". Text `#d05050` ≈ 5.1:1 and dim `#b84848` ≈ 4:1 on the card surface (WCAG AA). A component is finished only when it reads in all four palettes.

**Hybrid levels** (`themes/hybrid.css`). The worst active government-alert severity sets `data-hybrid`: moderate → `light`, severe / extreme → `full`. Three knobs move at once: surface .85 → .96, hairline → `borderHybrid`, and a left strip `box-shadow: inset 3px 0 0 var(--c-strip-color)` (amber for light, red for full; 4 px on the clock and hero slabs). No per-component logic.

---

## TYPE — Geist, four faces, no exceptions

- **Faces:** Geist **400** (body) · **500** (labels, captions, most values — the workhorse) · **700** (desktop hero temperature, popover values, emphasis) · Geist Mono **500** (every numeral, badge, section title). Self-hosted woff2, `font-display: swap`. **No 600, no italics, no synthesized weights** — `test/fontWeightGuards.test.js` fails the build on any other weight (43 rules had drifted by 2026-09; fixed in PR 353).
- **Stacks:** `"Geist", system-ui, -apple-system, sans-serif` and `"Geist Mono", ui-monospace, "SF Mono", Menlo, monospace`.
- **Ladder (observed, px before density):** 9 · 10 · 11 · 12 · 13 · 14 · 16 · 18 · 22 · 30 · 39 · 40 · 44 · 56 · 72 · 88. Named uses: desktop hero temperature 72 (88 ≥ 1600), desktop clock 44 (56 ≥ 1600), Pi hero temperature 39, Pi clock 30, mobile hero 56, metric tile value 22, NowcastLine 14, body 12–13, badges 11, mono eyebrows 10 (tracked .8 px, uppercase), SeverityChip 9.5 (tracked .12 em).
- **Hierarchy** comes from size, weight, tracking and uppercase mono eyebrows — never from a fifth weight. Large numerals track tight (−1 px at 40, −1.5 px at 56/72). **Tabular numerals** wherever a value updates live.
- **Text density S / M / L** = 0.85 / 1 / 1.15 (`--c-font-scale`), applied as `zoom` on the scrollable subtrees (rail, hero slot, dock) — **never on the map**; map-overlay text uses `calc(base * var(--c-font-scale))`. Settings and Debug overlays run one notch larger (× 1.15).

---

## SURFACES & SHAPE

- **The slab recipe** (hero, clock, forecast, AI summary, metric cells, air card, alert head): `background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 10px; padding: 12px 14px; box-shadow: inset 4px 0 0 var(--c-strip-color, transparent)`. Cells use radius 8 and a 3 px strip; the dock and the framed Pi map use 14.
- **Radii:** 3 (source badge) · 4 · 6 (NowcastLine, popover rows) · 8 (cells, mini cards) · 10 (slabs, radar legend, Leaflet bar) · 14 (dock, map frame) · pill (chips, period pills).
- **Elevation:** floating cards `0 1px 2px rgba(0,0,0,.08), 0 6px 16px rgba(0,0,0,.12)`; overlays `0 4px 16px rgba(0,0,0,.35)`. **Glass:** `backdrop-filter: blur(8px)` on the dock and map chrome, `blur(6px)` on the AI slab, the maximized chart slab and the control buttons — always with the `-webkit-` twin.
- **Interaction feedback:** `:active { background: var(--c-accent-soft); transform: scale(.985) }` and `:focus-visible { outline: 2px dashed var(--c-text); outline-offset: -2px }`. **Hover paints nothing** (see rules). Buttons are reset to `font: inherit; background: transparent; border: 0; -webkit-tap-highlight-color: transparent` inside the root.
- **Dock contract:** the dock re-skins the shared control buttons through `--ctrl-btn-*`; press flash removed, `--ctrl-btn-down: var(--c-accent-soft)` is the only accent signal (= toggle is ON). Icons 24 px in a 52 px bar. Leaflet zoom / focus buttons are 40 × 40 (36 on mobile), radius 10, palette-tinted, no hover.

---

## LAYOUTS — three viewports, one grammar

| Viewport | Layout | Anatomy |
|---|---|---|
| **< 800 px** | `LayoutMobile` | one scroll column, pull-to-refresh, radar as a maximizable card, hero 56 px |
| **800–1279 px** (the 7″ kiosk is 800×480) | `LayoutPi` | grid `1fr 300px` (340 ≥ 1280) + dock 52; framed 10 px gutters; rail states **MIN** (radar full-bleed, floating mini-banner) · **MID** (split: hero, nowcast line, alert card, metrics 2×2, forecast) · **MAX** (forecast-forward, map thumbnail) |
| **≥ 1280 px** | `LayoutDesktop` | full-bleed map, floating hero band (hero card + clock card sharing a hairline), right rail 320 (360 ≥ 1600; `min(60vw, 960px)` while a slab is maximized), dock 52, edge gap 16 |

Height gates: **≤ 520 px** compact Settings / Debug and radar-legend auto-hide; **≤ 540 px** the Pi three-state rail (a separate threshold on purpose); **≤ 600 px + portrait** hides secondary dock buttons. Priority views (alert / conditions / AI as full-rail surfaces) are the v3.3 opt-in on short screens.

---

## RULES — Kiosk & touch (the floor that wins)

1. **No hover-painted state, ever.** The kiosk is a touchscreen: a `:hover` that paints a background sticks after a tap even behind a media-query gate ("drop, don't gate"). Hover may only drop opacity. `-webkit-tap-highlight-color: transparent` on every tappable surface.
2. **No `animation: … infinite` on any kiosk-visible surface.** A composited loop keeps the Pi GPU awake every vsync (+12 °C measured). Transitions are one-shot, ≤ 300 ms, on user action only. `prefers-reduced-motion` crushes every duration to 0.01 ms.
3. **Hit targets ≥ 44 px** even when the visual is 28 px (pad the hit box, not the glyph).
4. **External links = QR code only.** The kiosk browser has no chrome and no way back; a text link is a one-way trap. Point to stable vendor landing pages, never deep links with IDs or coordinates. (Exception: the localhost-only Debug panel.)
5. **The map is never zoomed** by the text-density preference; Leaflet stays at native resolution.
6. **Everything renders in four palettes**; nightRed never relies on colour alone.
7. **Reading first.** A government-alert detail is collapsed by default; expanded, it may take ~65 vh — the user chose to read.

## RULES — Alerts & status (honest about origin)

- **Every alert banner carries a leading source badge**: `ECCC` · `NWS` (official feeds), `RADAR` (local pixel analysis), `AIR` (air-quality health band, paired with the index's own badge AQHI / IQA / AQI). `FCST` tags the forecast-tab reason chip. **`TEST` is a qualifier, never a source** — a neutral *outlined* pill next to the source badge plus a "TEST ·" title prefix; never amber (amber turns red in nightRed and would fake an emergency).
- **Tier colour = CAP severity, not the alert type**: minor → yellow / `sev-low`, moderate → `warn` / `sev-med`, severe & extreme → `danger` / `sev-high`. The chip word is the parsed product type (Watch, Warning, Veille, Avert.). One alert, four colours — one per palette.
- A new banner-producing source gets a short uppercase tag (3–5 chars) that says where the data comes from — never `LOCAL` or `AUTO`. All badges share one visual (`SourceBadge`); reuse it, don't fork it.
- Radar: the RainViewer precipitation scale is the tiles' own colour scheme and is identical in all four palettes; alert polygons use `--rc-alert-*` (red-family steps in nightRed); the 50 km analysis ring is `--map-circle`. NWS alert bodies stay in English on purpose.

## ICONOGRAPHY

- **No emoji.** Platform emoji differ across macOS, Pi Chromium and Firefox and ignore the palette. Glyphs are inline SVG on `currentColor`; the moon is a parametric SVG — dark disc + bright lit side in every palette (the emoji convention; the light-disc silhouette field-tested as confusing).
- Severity chip = triangle SVG (outlined for low / med, filled for high) + uppercase mono word. Category pills = dot + word. Status markers are shapes, never font glyphs.
- Weather condition icons are Iconify SVGs sized by `font-size` (24 px hero, 18 px on the Pi hero, 16 px in metric tiles), coloured `--c-accent`.

## COPY & I18N

- Trilingual **EN / FR / ES**; every kiosk-visible string exists in all three. French is Québec French (« Prévisions », « Ressenti », « Avert. »). Sentence case everywhere; UPPERCASE only for mono eyebrows, source badges and the day-of-week eyebrow above the desktop clock.
- Mockups use plausible real scenarios (Montréal, Québec, Winslow AZ Red Flag Warning), show the calm **and** the alert states, and never lorem ipsum. Units follow the user's preference (°C/°F, km/h, mm, km) — never hard-code one.

---

## What is normative vs illustrative in a handoff

- **Normative:** the palette tokens, `--sev-*`, `--mx-cat-*`, `--rc-*` / `--map-*`, the tier colours, the source badges, the four faces and weights, the radii, the three-viewport grammar, the kiosk rules above.
- **Illustrative:** micro-type sizes drawn for a 720 px mock device (the codebase re-bases on `--c-font-scale` and sits ~1–1.5 px above), exact paddings, safe-area values (`top: max(90px, calc(env(safe-area-inset-top) + 44px))` in code), the pin colour (the code uses the target icon, not a blue pin), any option the code does not expose.
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
