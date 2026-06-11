# Pi Weather Station — UI Layout Reference (v2 — archived)

> **Archived.** This document describes the **v2 layout** (split grid, InfoPanel on the right with ControlButtons at the bottom of the rail), which remains accessible by disabling the **Preview** toggle in Settings. The current default v3 Direction C layout is documented in [`docs/ui-layout_en.md`](../ui-layout_en.md).

This document describes the screen layout, panel names, and section names used in the Pi Weather Station v2 interface. Use it as a reference when reporting issues or requesting changes against the v2 layout.

---

## Full layout (normal screen, > 520 px height)

```
┌─────────────────────────────────────────┬───────────────────┐
│                                         │   INFOPANEL       │
│                                         │ ┌───────────────┐ │
│                                         │ │ IndoorTemp│CLK│ │
│                                         │ └───────────────┘ │
│                                         │ ╔═══════════════╗ │
│  WEATHERMAP (Leaflet + RainViewer       │ ║ LocationName  ║ │
│  radar tiles, 50 km analysis circle)    │ ╠═══════════════╣ │
│                                         │ ║CurrentWeather ║ │
│                                         │ ║  temp, icon   ║ │
│                                         │ ║  wind, humidity║ │
│                                         │ ╠═══════════════╣ │
│                                         │ ║  ChartLegend  ║ │
│                                         │ ╠═══════════════╣ │
│  ┌──────────────────────────────────┐   │ ║  HourlyChart  ║ │
│  │   SETTINGS  (overlay)            │   │ ╠═══════════════╣ │
│  │   DEBUG     (overlay)            │   │ ║  DailyChart   ║ │
│  └──────────────────────────────────┘   │ ╠═══════════════╣ │
│                                         │ ║   AiSummary   ║ │
│                                         │ ║[AI SUMMARY ↑] ║ │
│                                         │ ╚═══════════════╝ │
│                                         │ ┌───────────────┐ │
│                                         │ │ ControlButtons│ │
│                                         │ └───────────────┘ │
└─────────────────────────────────────────┴───────────────────┘
```

---

## Small screen (≤ 520 px height — official 7" display 800×480)

On small screens, two adaptations activate automatically:

- **ChartTabs** — HourlyChart and DailyChart are replaced by two tabs (`24 hours` / `5 days`) to save vertical space.
- **PanelToggle** — A floating button appears on the right edge of the map to hide/show the InfoPanel.

```
┌──────────────────────────────────────┬─┬───────────────────┐
│                                      │ │   INFOPANEL       │
│                                      │›│ ┌───────────────┐ │
│           WEATHERMAP                 │ │ │ IndoorTmp│CLK │ │
│         (Leaflet radar map)          │P│ └───────────────┘ │
│                                      │a│ ╔═══════════════╗ │
│                                      │n│ ║ LocationName  ║ │
│                                      │e│ ╠═══════════════╣ │
│                                      │l│ ║CurrentWeather ║ │
│                                      │T│ ╠═══════════════╣ │
│                                      │o│ ║  ChartLegend  ║ │
│                                      │g│ ╠═══════════════╣ │
│                                      │g│ ║   ChartTabs   ║ │
│                                      │l│ ║  24h │  5d    ║ │
│                                      │e│ ╠═══════════════╣ │
│                                      │ │ ║ HourlyChart   ║ │
│                                      │ │ ║     or        ║ │
│                                      │ │ ║ DailyChart    ║ │
│                                      │ │ ╠═══════════════╣ │
│                                      │ │ ║   AiSummary   ║ │
│                                      │ │ ║[AI SUMMARY ↑] ║ │
│                                      │ │ ╚═══════════════╝ │
│                                      │ │ ┌───────────────┐ │
│                                      │ │ │ ControlButtons│ │
│                                      │ │ └───────────────┘ │
└──────────────────────────────────────┴─┴───────────────────┘
```

---

## Collapsed InfoPanel (small screen only)

When the **PanelToggle** button is pressed (`‹`), the InfoPanel is hidden and the map occupies the full width:

```
┌────────────────────────────────────────────────────────────┬┐
│                                                            │›││
│                   WEATHERMAP (full width)                  │ ││
│                                                            │ ││
└────────────────────────────────────────────────────────────┴┘
```

---

## Debug overlay — full-width on small screens

On small screens the **Debug** overlay extends across the entire viewport instead of leaving a 320 px gutter for the InfoPanel — there isn't enough horizontal room to show the debug tables (quotas, services, security events) usefully otherwise. The InfoPanel and the **PanelToggle** button are still rendered behind the overlay but are visually covered. Closing is done via the red **Close** pill at the top-right corner of the panel itself, not via the bug-icon in ControlButtons (which is also covered).

```
┌──────────────────────────────────────────────────────────[X]┐
│ DEBUG (full viewport width)                                 │
│  · Provider status / KPIs / Quotas / Services / Logs ...    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

The **Settings** overlay keeps the 320 px gutter on small screens — its rows fit fine in the narrower area, so the InfoPanel stays partially visible behind it.

---

## AiSummary — expanded mode

When the **AI SUMMARY ↑** button is pressed, the charts (ChartLegend, ChartTabs/Charts) are hidden and the summary slides up automatically:

```
╔═══════════════╗
║ LocationName  ║
╠═══════════════╣
║CurrentWeather ║
╠═══════════════╣   ← ChartLegend + Charts hidden (350 ms transition)
║   AiSummary   ║
║[AI SUMMARY ↓] ║   ← chevron ↓ to restore charts
╚═══════════════╝
```

Pressing **AI SUMMARY ↓** restores the charts and automatically scrolls the view back to the top of the InfoPanel (LocationName visible).

---

## Component nomenclature

| Display / common name       | React component          | Source file                                 |
|-----------------------------|--------------------------|---------------------------------------------|
| Radar map                   | `WeatherMap`             | `components/WeatherMap/index.js`            |
| Right side panel            | `InfoPanel`              | `components/InfoPanel/index.js`             |
| Clock                       | `Clock`                  | `components/Clock/index.js`                 |
| Indoor temperature          | `IndoorTemperature`      | `components/IndoorTemperature/index.js`     |
| Location                    | `LocationName`           | `components/LocationName/index.js`          |
| Current weather             | `CurrentWeather`         | `components/CurrentWeather/index.js`        |
| Chart legend                | `ChartLegend`            | inside `WeatherInfo/index.js`               |
| 24-hour chart               | `HourlyChart`            | `components/ambient/weatherCharts/HourlyChart/`     |
| 5-day chart                 | `DailyChart`             | `components/ambient/weatherCharts/DailyChart/`      |
| Chart tabs                  | `ChartTabs`              | inside `WeatherInfo/index.js` (small screen)|
| AI summary                  | `AiSummary`              | `components/AiSummary/index.js`             |
| Control buttons             | `ControlButtons`         | `components/ambient/ControlButtons/index.js`        |
| Settings (overlay)          | `Settings`               | `components/Settings/index.js`              |
| Debug (overlay)             | `Debug`                  | `components/Debug/index.js`                 |
| Update modal (overlay)      | `UpdateModal`            | `components/UpdateModal/index.js`           |
| Panel toggle (small screen) | `PanelToggle`            | inside `App/index.js`                       |

---

## Overlays

**Settings** and **Debug** are overlays that appear on top of the radar map. On wide screens they leave a 320 px gutter on the right so the InfoPanel stays visible; on small screens (≤ 520 px height) the **Debug** overlay extends across the full viewport, while **Settings** keeps the gutter (see "Debug overlay — full-width on small screens" above). The two panels are mutually exclusive — opening one automatically closes the other.

- **Settings**: accessible via the ⚙ button in ControlButtons, always visible. Its built-in close button is the **X** at the top-right of the panel. The bottom of the panel exposes an **Advanced settings** collapsible section (Display group: map styles, radar opacity sliders, hardware brightness slider; AI group: radar-analysis toggles, sampling-point overlay).
- **Debug**: accessible via the 🐛 button in ControlButtons, only visible from the Pi itself (`localhost`) when `DEBUG=true`. The close action is the red circular **Close** pill at the top-right of the panel — sized for touch (44×44 px) and clearly visible against the dark background. The font size for the Debug panel follows the global Settings → Font Size selector with a dedicated scale (S = 1.0×, M = 1.15×, L = 1.30×).
- **UpdateModal**: opens from inside the Settings overlay when `GET /api/update-check` reports `updateAvailable: true`. Lists incoming `feat:`/`fix:` commits and surfaces warnings (`needsManualUpgrade`, `serviceFileChanged`) plus error messages from a failed `POST /api/update`.

---

## InfoPanel header

The header row at the top of the InfoPanel hosts both **IndoorTemperature** (left) and **Clock** (right). When `indoorTemperature.enabled` is `false` or the Homebridge poll returns no data, IndoorTemperature renders nothing and Clock alone is right-aligned via `margin-inline-start: auto` on the last child.
