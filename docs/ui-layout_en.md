# Pi Weather Station — UI Layout Reference (v3 / Direction C)

This document describes the screen layout, component names, and section names for the **v3 Direction C** interface. The v3 UI is activated via the **Preview** toggle in Settings (section 4). Use this document when reporting issues or requesting changes.

> **v2 note** — the pre-v3 layout (split grid, InfoPanel on the right with ControlButtons at the bottom of the rail) is still accessible by disabling the Preview toggle. This document covers v3 only.

---

## Layout variants

The v3 interface selects a layout automatically based on screen size:

| Condition | Layout |
|-----------|--------|
| `max-height ≤ 520 px` (e.g. official Pi 7" at 800×480) | **LayoutPi** |
| `width ≥ 1280 px` (HD monitor, 10" Pi, desktop) | **LayoutDesktop** |

---

## LayoutPi — 7" / 10" Pi touchscreen

The map occupies the left column; the rail (info panel) occupies the right column. A collapsible chevron button on the map's right edge hides/shows the rail.

```
┌──────────────────────────┬──────────────────────────┐
│                          │ TimeBlock                 │
│                          │ (date · clock · sun row)  │
│                          ├──────────────────────────┤
│   WeatherMap             │ HeroCompact               │
│   (Leaflet + RainViewer  │ (location · temp · icon · │
│    radar tiles)          │  description)             │
│                          ├──────────────────────────┤
│                          │ AlertBanner               │
│         [›]              ├──────────────────────────┤
│    (chevron toggle)      │ AlertDetailInline         │
│                          ├──────────────────────────┤
│                          │ MetricsGrid               │
│                          │ (wind · humidity · UV ·   │
│                          │  air quality)             │
│                          ├──────────────────────────┤
│                          │ IndoorBlock (Homebridge)  │
│                          ├──────────────────────────┤
│                          │ ChartTabs                 │
│                          │ (24 hours / 5 days tabs   │
│                          │  on ≤ 520 px height)      │
│                          ├──────────────────────────┤
│                          │ AiSummaryInline           │
│                          │ (expandable ↑)            │
└──────────────────────────┴──────────────────────────┤
│ BottomDock (ControlButtons — 7 icon buttons)         │
└──────────────────────────────────────────────────────┘
```

### Small-screen adaptations (≤ 520 px height — official 7" display 800×480)

- **ChartTabs** — HourlyChart and DailyChart are shown as two tabs (`24 hours` / `5 days`) instead of stacked, to save vertical space. Tab state persists across the session.
- **Panel toggle** — A chevron (`›` / `‹`) is pinned to the map's right edge to collapse/expand the rail. When collapsed the map fills the full width; Leaflet calls `map.invalidateSize()` so the tiles re-fit.
- **FloatingMiniBanner** — When the rail is collapsed and a government severe alert is active, a compact banner overlays the map's top-right so the alert is never silently hidden. Tapping it re-opens the rail.
- **SettingsPanel grid4** — Advanced section grids switch to 2 columns on ≤ 520 px height, giving sliders and toggles enough room (fixes overflow on radar-opacity sliders and AI toggle sub-text).

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
│ HeroBand (floating slab, max 1600 px wide)  │           │
│ ┌──────────────┬──────────────┬───────────┐ │           │
│ │ Location     │ Temp + icon  │ Date      │ │  Right    │
│ │ (city name)  │ + description│ Clock     │ │  Rail     │
│ │              │              │ Sun row   │ │           │
│ └──────────────┴──────────────┴───────────┘ │ - Metrics │
│                                         [›] │ - Alerts  │
│  WeatherMap                                 │ - Charts  │
│  (full-bleed — radar visible through slabs) │ - AI sum. │
│                                             │           │
│                                             │           │
├─────────────────────────────────────────────┴───────────┤
│  BottomDock (ControlButtons)                             │
└──────────────────────────────────────────────────────────┘
```

### HeroBand panels

| Panel | Content | Font sizes |
|-------|---------|------------|
| **Left — Location** | City name (LocationName, pin icon) | 16 px → 20 px at ≥ 1600 px |
| **Centre — Temperature** | Large temp numeral · unit badge · weather icon · description | 72 px → 88 px at ≥ 1600 px |
| **Right — Clock** | Date (all-caps) · HH:MM · AM/PM (12h) · sunrise/sunset row | Clock 44 px → 52 px; sun row 12 px → 14 px at ≥ 1600 px |

The band has a `max-width: 1600 px` cap — at ultra-wide viewports (2560 px+) it stays content-rich rather than sprawling across the full available area.

### Right rail

Width: `320 px` (default) · `360 px` at ≥ 1600 px. Zooms with the user's font-size preference (`--c-font-scale`).

Components (top to bottom):
1. **AlertBanner** — government severe-weather alert pill (hidden when no active alert)
2. **AlertDetailInline** — expanded alert text (hidden when collapsed)
3. **MetricsGrid** — wind speed · humidity · UV index · air-quality index
4. **IndoorBlock** — Homebridge indoor temperature / humidity / air quality (hidden if not configured)
5. **ChartTabs** — 24-hour and 5-day forecast tabs with Recharts graphs
6. **AiSummaryInline** — Claude AI weather summary; expandable to fill the rail (↑ button)

### Collapsed rail (LayoutDesktop)

The chevron (`›` / `‹`) on the map's right edge collapses the rail. The HeroBand extends to fill the freed width. FloatingMiniBanner appears if an alert is active.

---

## BottomDock

Spans the full viewport width at the bottom of both layouts. Contains the **ControlButtons** row. Height: 52 px. Icons: 24 px.

### ControlButtons (left → right, typical configuration)

| Icon | Action | Visibility condition |
|------|--------|---------------------|
| ↖ Location arrow | Reset map to home position | Always |
| 📍 / 📍off | Toggle location marker | Always |
| 〜 Timeline | Show / hide radar timeline scrubber | RainViewer source only |
| ↗ Direction arrows | Show / hide precipitation direction arrows | Radar analysis enabled |
| ☰ Legend | Show / hide radar colour legend | RainViewer + timestamps loaded |
| ◑ Contrast | Toggle dark / light mode | Always |
| ⚙ Settings | Open Settings panel | Always |
| 🐛 Debug | Open Debug panel | Localhost + `DEBUG=true` only |
| ⬆ Update | Open update modal | When a new release is available |

Button appearance adapts to the Direction C palette via CSS custom properties: transparent backgrounds (dock surface shows through), `--c-border-hybrid` dividers, `--c-accent-soft` on press/active.

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
