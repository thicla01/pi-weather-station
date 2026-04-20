# Pi Weather Station — UI Layout Reference

This document describes the screen layout, panel names, and section names used in the Pi Weather Station interface. Use it as a reference when reporting issues or requesting changes.

---

## Full layout (normal screen, > 520 px height)

```
┌─────────────────────────────────────────┬───────────────────┐
│                                         │   INFOPANEL       │
│                                         │ ┌───────────────┐ │
│                                         │ │     CLOCK     │ │
│                                         │ └───────────────┘ │
│                                         │ ╔═══════════════╗ │
│           WEATHERMAP                    │ ║ LocationName  ║ │
│         (Leaflet radar map)             │ ╠═══════════════╣ │
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
│           WEATHERMAP                 │ │ │     CLOCK     │ │
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
| Location                    | `LocationName`           | `components/LocationName/index.js`          |
| Current weather             | `CurrentWeather`         | `components/CurrentWeather/index.js`        |
| Chart legend                | `ChartLegend`            | inside `WeatherInfo/index.js`               |
| 24-hour chart               | `HourlyChart`            | `components/weatherCharts/HourlyChart/`     |
| 5-day chart                 | `DailyChart`             | `components/weatherCharts/DailyChart/`      |
| Chart tabs                  | `ChartTabs`              | inside `WeatherInfo/index.js` (small screen)|
| AI summary                  | `AiSummary`              | `components/AiSummary/index.js`             |
| Control buttons             | `ControlButtons`         | `components/ControlButtons/index.js`        |
| Settings (overlay)          | `Settings`               | `components/Settings/index.js`              |
| Debug (overlay)             | `Debug`                  | `components/Debug/index.js`                 |
| Panel toggle (small screen) | `PanelToggle`            | inside `App/index.js`                       |

---

## Overlays

**Settings** and **Debug** are overlays that appear on top of the radar map (left side). They never occupy the InfoPanel. The two panels are mutually exclusive — opening one automatically closes the other.

- **Settings**: accessible via the ⚙ button in ControlButtons, always visible
- **Debug**: accessible via the 🐛 button in ControlButtons, only visible from the Pi itself (`localhost`) when `DEBUG=true`
