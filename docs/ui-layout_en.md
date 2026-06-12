# Pi Weather Station — UI Layout Reference (v3 / Direction C)

This document describes the screen layout, component names, and section names for the **v3 Direction C** interface. The v3 UI is activated via the **Preview** toggle in Settings (section 4). Use this document when reporting issues or requesting changes.

> **v2 note** — the pre-v3 layout (split grid, InfoPanel on the right with ControlButtons at the bottom of the rail) is still accessible by disabling the Preview toggle. This document covers v3 only; see [`archive/ui-layout_v2_en.md`](archive/ui-layout_v2_en.md) for the v2 reference.

---

## Layout variants

The v3 interface selects a layout automatically based on screen size:

| Condition | Layout |
|-----------|--------|
| `width ≤ 799 px` (portrait phones 375-430 px) | **LayoutMobile** |
| `800 ≤ width ≤ 1279 px` (e.g. official Pi 7" at 800×480) | **LayoutPi** |
| `width ≥ 1280 px` (HD monitor, 10" Pi, desktop) | **LayoutDesktop** |

Transitions are watched live via `matchMedia('change')` — orientation flips and window resizes swap layouts without a reload.

---

## LayoutMobile — portrait phone (< 800 px wide)

Variant A "Compagnon nomade" from the design package. Single scrollable column tuned for 375-430 px portrait (iPhone / Android). The target user is **away from the Pi** and wants a quick read of conditions and alerts.

```
┌──────────────────────────────┐
│ TimeBlock                    │  ◀ clock (date · time)
│ AlertBanner                  │  ◀ government alert (when active)
│ AlertDetailInline            │  ◀ expanded alert (tap to open)
│ HeroCompact                  │  ◀ location · big temp · condition ·
│                              │    feels-like · sun/moon meta-line
│ AirCard                      │  ◀ AQI + pollen rows (pills)
│ MetricsGrid                  │  ◀ wind / humid / UV / pressure tiles
│ IndoorBlock                  │  ◀ Homebridge temps (when configured)
│ Radar mini (~220 px) [⛶]    │  ◀ small inset map; maximize toggle
│ ChartTabs                    │  ◀ 24 h hourly chart
│ AiSummaryInline              │  ◀ Claude-generated summary
│ Footer hint                  │  ◀ "settings live on the Pi"
├──────────────────────────────┤
│ BottomDock                   │  ◀ palette + marker + recenter + refresh
└──────────────────────────────┘
```

### Maximizable radar card

- Maximize button in the top-right corner of the mini card (44×44 px, Apple HIG compliant) — four-corner-bracket SVG pair since Phase 3 (outward = expand, inward = restore, same icons as the desktop/7" focus toggle).
- In mini mode (220 px), the **radar legend strip and timeline are CSS-hidden** — no readable room. The corresponding dock buttons are greyed out and a toast invites the user to maximize the card.
- When maximized, the card goes **full-bleed**: it fills 100 % of the app area above the dock (`inset` to the scroll container's edges, no margins, no rounded corners) — the same "radar owns the screen" treatment as the big-screen layouts. The compact legend strip and the timeline bar reappear.
- The maximized `top:` keeps `env(safe-area-inset-top)` so the in-map controls clear iOS's **Control-Centre swipe zone** (top-right quadrant ~84 px × 30 % viewport width in notched portrait), which was intercepting taps on the minimize button (v2.16.5).
- When a government alert is active while the card is maximized, the **FloatingMiniBanner** chip appears right-aligned under the restore button (the maximized card covers the column's AlertBanner — same "never blind the user to an active warning" property as the Desktop/Pi focus modes). Tapping the chip restores the mini card, revealing the full banner.

### Pull-to-refresh

- Native gesture on the `.scroll` container when `scrollTop === 0`.
- Damping factor 0.5× on raw delta, cap at 120 px.
- Threshold at 80 px: spinner changes colour (armed); release above triggers `window.location.reload()`, release below springs back via a 180 ms CSS transition.
- Visual indicator at the top: spinner + "Refresh app" / "Refreshing…" label.
- Passive listeners (`touchstart` / `touchmove` / `touchend`), scoped to the mobile `.scroll` — does not affect LayoutPi or LayoutDesktop.

### iOS PWA standalone quirks

- **Off-page area** : `100dvh < physical height` in standalone on notched iPhone; `body` and `<html>` are painted with the palette colour via a `useEffect` in `AmbientLayers` so the iOS-reserved zone doesn't show a black bar under the dock.
- **nightRed palette** : uses `#270c0c` (effective composite surface) instead of `palette.bg` (`#100404`) so the off-page area doesn't read as plain black against the brighter red dock.
- **Safe-area top** : SettingsPanel adds `padding-top: max(14px, env(safe-area-inset-top))` on its header so the close button (×, 44×44) isn't under the Dynamic Island. DebugPanel no longer has a header (Phase 7): the rail (left) and the persistent toolbar (right) each absorb their portion of the top safe-area.

---

## LayoutPi — 7" / 10" Pi touchscreen

The map occupies the left column; the rail (info panel) occupies the right column. A collapsible chevron button on the map's right edge hides/shows the rail.

```
┌──────────────────────────┬──────────────────────────┐
│                          │ TimeBlock                 │
│                          │ (date · clock)            │
│                          ├──────────────────────────┤
│   WeatherMap             │ AlertBanner               │
│   (Leaflet + RainViewer  ├──────────────────────────┤
│    radar tiles)          │ AlertDetailInline         │
│                          ├──────────────────────────┤
│         [›]              │ HeroCompact               │
│    (chevron toggle)      │ (location · temp ·        │
│                          │  condition · feels-like · │
│                          │  sun/moon meta-line)      │
│                          ├──────────────────────────┤
│                          │ AirCard (AQI · pollen)    │
│                          ├──────────────────────────┤
│                          │ MetricsGrid               │
│                          │ (wind · humidity · UV ·   │
│                          │  pressure)                │
│                          ├──────────────────────────┤
│                          │ IndoorBlock (Homebridge)  │
│                          ├──────────────────────────┤
│                          │ ChartTabs                 │
│                          │ (24 hours / 5 days tabs)  │
│                          ├──────────────────────────┤
│                          │ AiSummaryInline           │
│                          │ (expandable ↑)            │
└──────────────────────────┴──────────────────────────┤
│ BottomDock (ControlButtons — 7 icon buttons)         │
└──────────────────────────────────────────────────────┘
```

### Always-on adaptations (any height in `LayoutPi`)

- **ChartTabs (v3.1 Phase 5)** — a "Forecast" panel: period pills (`24 h` / `5 days`) next to the title, and four labelled metric tabs (Temp · Wind · Precip · Hours/Days) replacing the old carousel dots (audit F9). Temp = accent line + area fill + key-point labels; Wind = speed + dashed gusts + direction-arrow row; Precip = accumulation bars + dashed probability line; the last tab is the hour/day icon grid. Numeric summary pills under each chart (max/min/peak…, audit F13 fixed the axes: `14°`, unit once on the top tick) plus an optional "Precip" overlay chip on Temp/Wind. The maximize button keeps its 44 px hit area and the bracket-icon pair shared with the radar controls; per-period metric choice persists in localStorage.
- **Panel toggle** — A chevron (`›` / `‹`) is pinned to the map's right edge to collapse/expand the rail. When collapsed the map fills the full width; Leaflet calls `map.invalidateSize()` so the tiles re-fit.
- **FloatingMiniBanner** — When the rail is collapsed and a government severe alert is active, a compact banner overlays the map's top-right so the alert is never silently hidden. Tapping it re-opens the rail.

### Compact-overlay adaptations (`max-height ≤ 520 px` — official 7" display 800×480)

These trigger only on short viewports (the 7" Pi screen and similar). 10"-class 1024×600 displays do NOT hit these — they get the same layout but in standard density.

- **SettingsPanel grid4** — Advanced section grids switch to 2 columns, giving sliders and toggles enough room (fixes overflow on radar-opacity sliders and AI toggle sub-text).
- **DebugPanel compact mode** — Smaller font zoom + tighter row gaps so the 800×480 viewport can show more KPI / service data without scrolling.
- **LayoutMobile landscape mapCard** — Mini radar card height drops 220 → 160 px in landscape so the hero + first metrics row stay above the fold.

### Collapsed rail

```
┌────────────────────────────────────┬──┐
│                                    │  │
│                                    │‹ │
│   WeatherMap (full width)          │  │
│                                    │  │
│  [FloatingMiniBanner if alert]     │  │
│                                    │  │
└────────────────────────────────────┴──┤
│  BottomDock                           │
└───────────────────────────────────────┘
```

---

## LayoutDesktop — HD monitor / desktop (≥ 1280 px wide)

The map fills the entire viewport as a full-bleed background. The HeroBand, right rail, and BottomDock are translucent slabs floating on top of the radar.

```
┌─────────────────────────────────────────────┬───────────┐
│ HeroBand (floating band, max 1600 px wide)  │           │
│ ┌─────────────────────────────┬───────────┐ │           │
│ │ Hero card (P2 pyramid)      │ Clock     │ │  Right    │
│ │  place (micro) · 72px temp  │ card      │ │  Rail     │
│ │  + condition + feels-like   │  date     │ │           │
│ │  sun/moon meta-line         │  time     │ │ - Air     │
│ └─────────────────────────────┴───────────┘ │ - Metrics │
│                                         [›] │ - Alerts  │
│  WeatherMap                                 │ - Charts  │
│  (full-bleed — radar visible through slabs) │ - AI sum. │
│                                             │           │
│                                             │           │
├─────────────────────────────────────────────┴───────────┤
│  BottomDock (ControlButtons)                             │
└──────────────────────────────────────────────────────────┘
```

### HeroBand cards (v3.1 Phase 2)

| Card | Content | Font sizes |
|------|---------|------------|
| **Hero (P2 pyramid)** | Tier 1: place row as a mono micro-label (pin · popover trigger, dotted underline) · Tier 2: large temp numeral (Geist Mono 500 tabular) + unit badge + condition icon/text + always-on **FEELS-LIKE** line with a signed delta chip (±2° gate on the ornament only) · Tier 3: **sun/moon meta-line** (sunrise → sunset with SVG arrow, parametric moon glyph + inline phase name + illumination % — the single home of the sun/moon popovers, B1·a) | Temp 72 px → 88 px at ≥ 1600 px; micro 11 px; meta 12 px |
| **Clock** | Date (all-caps) · HH:MM · AM/PM (12h) — the astro chips migrated into the hero meta-line | Clock 44 px → 56 px at ≥ 1600 px |

The band has a `max-width: 1600 px` cap — at ultra-wide viewports (2560 px+) it stays content-rich rather than sprawling across the full available area.

### Right rail

Width: `320 px` (default) · `360 px` at ≥ 1600 px. Zooms with the user's font-size preference (`--c-font-scale`).

Components (top to bottom):
1. **AlertBanner** — government severe-weather alert pill (hidden when no active alert)
2. **AlertDetailInline** — expanded alert text (hidden when collapsed)
3. **AirCard** — air-quality rows: AQI (value · label · category pill · chevron, tap → detail) + opt-in pollen (worst allergen · pill; hidden when the setting is off or out of coverage). In nightRed the pills collapse to red — the word carries the tier.
4. **MetricsGrid** — strict 2×2 grid: wind speed · humidity · UV index (qualifier, tappable cell + chevron) · surface pressure (hPa / inHg / kPa per the units preference)
5. **IndoorBlock** — Homebridge indoor temperature / humidity / air quality (hidden if not configured)
6. **ChartTabs** — 24-hour and 5-day forecast tabs with Recharts graphs
7. **AiSummaryInline** — Claude AI weather summary; expandable to fill the rail (↑ button)

### Collapsed rail (LayoutDesktop)

The chevron (`›` / `‹`) on the map's right edge collapses the rail. The HeroBand extends to fill the freed width. FloatingMiniBanner appears if an alert is active.

---

## BottomDock

Spans the full viewport width at the bottom of all three layouts (Mobile / Pi / Desktop). Contains the **ControlButtons** row. Height: 52 px. Icons: 24 px.

### ControlButtons (left → right, typical configuration)

| Icon | Action | Visibility condition |
|------|--------|---------------------|
| ↖ Location arrow | Reset map to home position | Always |
| 📍 / 📍off | Toggle location marker | Always |
| 〜 Timeline | Show / hide radar timeline scrubber | RainViewer source only |
| ↗ Direction arrows | Show / hide precipitation direction arrows | Radar analysis enabled |
| ☰ Legend | Show / hide radar colour legend | RainViewer + timestamps loaded |
| ◑ Contrast | Toggle dark / light mode | Always |
| ⏰ Auto | Auto dark/light at sunrise/sunset | Always |
| 🌙 Moon (red) | Toggle the nightRed palette | Always |
| 🔄 Refresh | Reload the app (`window.location.reload()`) | Always — useful in PWA standalone without an address bar |
| ⚙ Settings | Open Settings panel | Always |
| 🐛 Debug | Open Debug panel | Localhost + `DEBUG=true` only |
| ⬆ Update | Open update modal | When a new release is available |

Button appearance adapts to the Direction C palette via CSS custom properties: transparent backgrounds (dock surface shows through), `--c-border-hybrid` dividers, `--c-accent-soft` on press/active.

---

## Radar map controls (v3.1 Phase 3)

All floating controls over the Leaflet map follow the Claude Design Phase 3 v2.1 reference (audit findings F7 · F8 · F20).

- **Zoom +/−** — top-left, 40 × 40 px (36 px on mobile), palette-tinted surface, `:active` accent feedback only (no hover on kiosk surfaces). Localized tooltips.
- **Radar focus (fullscreen)** — standalone 40 × 40 px button below the zoom stack (top 110 px; 100 px on LayoutPi). Four-corner-bracket SVG pair (outward = focus, inward = restore — the same pair as the mobile card's maximize toggle). Hides HeroBand + the rail; each toggle confirms with a short toast. Active state = solid accent.
- **Timeline bar** — full-width bottom bar (rail-aware right inset). Header: play/pause · step ±1 · speed (1×/2×/4×) · timestamp + "now-tag" chip (never a bare relative offset; forecast frames flip to a dashed "Forecast · +N min" chip) · frame-count sub-line · conditional return-to-now pill · source chip ("RainViewer · 10 min", cadence derived from the live frame spacing; warn-tinted when the last frame-list refresh failed). Track: past fill, a labelled "Now" marker at the past→nowcast boundary, a hatched **scrubbable** future zone, and runtime-derived tick labels (−2 h … +30 min). The scrub surface is still the native range input (invisible, full-width) — the field-hardened pointer-capture handling and keyboard accessibility carry over.
- **Legend** — bottom-left card with three sections: *Analysis radii* (unit-aware; outer ring only when extended radius is on), *Precipitation* (the real RainViewer colour-scheme-6 six-segment bar — identical in all four palettes, nightRed included), *Nearby alerts* (tier key + honest in-radius count). On short screens (≤ 520 px height) with the timeline open it collapses to an "(i) Legend" chip; the chip — and the mobile strip's (i) — open the full legend as an overlay (scrim + ✕ + Escape). On the mobile layout the card is replaced by a compact full-width strip above the bottom edge.
- **On-map radius chips** — "50 km" / "100 km" labels at the rings' south-east intersection (unit-aware; hidden on mobile and past zoom 13, same gate as the rings).
- **Attribution** — flush bottom-right, hugging the dock edge in every state (legal requirement — visible everywhere, including the mobile mini-card); slimmed to fit the 16 px corridor under the timeline bar / legend strip.
- New radar-scoped CSS tokens (`--rc-*`, `--map-*`) live in `WeatherMap/styles.css`, switched per palette via `data-palette` (deliberately not added to `ui/tokens.js`). In nightRed the alert-tier tokens collapse to the red family while the precipitation scale keeps the true tile colours.

---

## Overlays

All overlays render as `position: fixed; inset: 0; z-index 5000+` and mirror the active Direction C palette via inline CSS variables (they render outside `AmbientLayers`).

| Overlay | Trigger | Remote access |
|---------|---------|---------------|
| **SettingsPanel** | ⚙ Settings button | Sections 2–4 (server writes) blocked from remote clients; read-only view shown |
| **DebugPanel** | 🐛 Debug button | Localhost + `DEBUG=true` only |
| **UpdateModal** | ⬆ Update button | Localhost only (`/api/update` is `localhostOnly`) |

---

## Palette / time-of-day modes

The Direction C palette adapts automatically based on time of day (`useTimeOfDay()`):

| Mode | Time window | Key colours |
|------|-------------|-------------|
| **day** | After sunrise | Warm cream bg `#f4f0e8`, dark text, amber accent |
| **dusk** | ± 90 min around sunrise/sunset | Deep warm-grey bg `#1c1a17`, amber accent |
| **night** | Between dusk and nightRed window | Near-black bg `#0e0c0a`, copper accent |
| **nightRed** | Late night (night-vision / sleep mode) | Very dark red bg `#100404`, all text and accent in red tones |

`nightRed` uses `text: #d05050` (~5:1 contrast) and `textDim: #b84848` (~4:1 contrast) against the dark card surface — readable for both bold and non-bold text.

---

## PWA install (iOS / Android)

The app can be installed to a phone's home screen via the browser's "Add to Home Screen" function. Once installed it launches in standalone mode (no browser chrome) and inherits the `apple-touch-icon.png` (opaque 180×180 PNG) and `manifest.json` (192 + 512 icons).

### Self-signed TLS certificate

The server generates a self-signed cert on first boot (CN: `Pi Weather Station - <hostname>`, SAN including `localhost`, `127.0.0.1`, the detected LAN IP and the `.local` hostname). For iOS to accept the cert in PWA mode:

1. Download the `.pem` from Settings → "Trust this Pi on this device" (endpoint `/api/cert.pem`, MIME `application/x-x509-ca-cert`).
2. Install the iOS profile (Settings → Downloaded profile).
3. Enable full trust: Settings → General → About → Certificate Trust Settings.

Per-platform walkthrough: [`docs/pwa-trust-cert_en.md`](pwa-trust-cert_en.md).

### Refreshing an installed PWA

In standalone mode the Safari address bar is hidden — no native reload button. Two mechanisms:

- **🔄 Refresh dock button** (universal — all layouts).
- **Pull-to-refresh** on LayoutMobile (touch gesture from the top of the scroll container — see LayoutMobile section).
