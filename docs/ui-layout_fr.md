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
│        (carte radar Leaflet)            │ ╠═══════════════╣ │
│                                         │ ║CurrentWeather ║ │
│                                         │ ║  temp, icône  ║ │
│                                         │ ║  vent, humidité║ │
│                                         │ ╠═══════════════╣ │
│                                         │ ║  ChartLegend  ║ │
│                                         │ ╠═══════════════╣ │
│  ┌──────────────────────────────────┐   │ ║  HourlyChart  ║ │
│  │   SETTINGS  (overlay)            │   │ ╠═══════════════╣ │
│  │   DEBUG     (overlay)            │   │ ║  DailyChart   ║ │
│  └──────────────────────────────────┘   │ ╠═══════════════╣ │
│                                         │ ║   AiSummary   ║ │
│                                         │ ║  [RÉSUMÉ IA ↑]║ │
│                                         │ ╚═══════════════╝ │
│                                         │ ┌───────────────┐ │
│                                         │ │ ControlButtons│ │
│                                         │ └───────────────┘ │
└─────────────────────────────────────────┴───────────────────┘
```

---

## Petit écran (≤ 520 px de hauteur — écran officiel 7" 800×480)

Sur les petits écrans, deux adaptations s'activent automatiquement :

- **ChartTabs** — HourlyChart et DailyChart sont remplacés par deux onglets (`24 heures` / `5 jours`) pour économiser l'espace vertical.
- **PanelToggle** — Un bouton flottant apparaît sur le bord droit de la carte pour masquer/afficher l'InfoPanel.

```
┌──────────────────────────────────────┬─┬───────────────────┐
│                                      │ │   INFOPANEL       │
│                                      │›│ ┌───────────────┐ │
│           WEATHERMAP                 │ │ │     CLOCK     │ │
│        (carte radar Leaflet)         │P│ └───────────────┘ │
│                                      │a│ ╔═══════════════╗ │
│                                      │n│ ║ LocationName  ║ │
│                                      │e│ ╠═══════════════╣ │
│                                      │l│ ║CurrentWeather ║ │
│                                      │T│ ╠═══════════════╣ │
│                                      │o│ ║  ChartLegend  ║ │
│                                      │g│ ╠═══════════════╣ │
│                                      │g│ ║   ChartTabs   ║ │
│                                      │l│ ║  24h │  5j    ║ │
│                                      │e│ ╠═══════════════╣ │
│                                      │ │ ║ HourlyChart   ║ │
│                                      │ │ ║   ou          ║ │
│                                      │ │ ║ DailyChart    ║ │
│                                      │ │ ╠═══════════════╣ │
│                                      │ │ ║   AiSummary   ║ │
│                                      │ │ ║  [RÉSUMÉ IA ↑]║ │
│                                      │ │ ╚═══════════════╝ │
│                                      │ │ ┌───────────────┐ │
│                                      │ │ │ ControlButtons│ │
│                                      │ │ └───────────────┘ │
└──────────────────────────────────────┴─┴───────────────────┘
```

---

## Panneau InfoPanel replié (petit écran uniquement)

Quand le **PanelToggle** est activé (chevron `‹`), l'InfoPanel est masqué et la carte occupe toute la largeur :

```
┌────────────────────────────────────────────────────────────┬┐
│                                                            │›││
│                   WEATHERMAP (pleine largeur)              │ ││
│                                                            │ ││
└────────────────────────────────────────────────────────────┴┘
```

---

## AiSummary — mode étendu

Quand on appuie sur le bouton **RÉSUMÉ IA ↑**, les graphiques (ChartLegend, ChartTabs/Charts) se masquent et le résumé remonte automatiquement :

```
╔═══════════════╗
║ LocationName  ║
╠═══════════════╣
║CurrentWeather ║
╠═══════════════╣   ← ChartLegend + Charts masqués (transition 350 ms)
║   AiSummary   ║
║  [RÉSUMÉ IA ↓]║   ← chevron ↓ pour rétablir les graphiques
╚═══════════════╝
```

Appuyer sur **RÉSUMÉ IA ↓** rétablit les graphiques et remonte automatiquement la vue au sommet de l'InfoPanel (LocationName visible).

---

## Nomenclature des composants

| Nom affiché / courant       | Composant React          | Fichier source                              |
|-----------------------------|--------------------------|---------------------------------------------|
| Carte radar                 | `WeatherMap`             | `components/WeatherMap/index.js`            |
| Panneau latéral droit       | `InfoPanel`              | `components/InfoPanel/index.js`             |
| Horloge                     | `Clock`                  | `components/Clock/index.js`                 |
| Localisation                | `LocationName`           | `components/LocationName/index.js`          |
| Météo actuelle              | `CurrentWeather`         | `components/CurrentWeather/index.js`        |
| Légende des graphiques      | `ChartLegend`            | dans `WeatherInfo/index.js`                 |
| Graphique 24 heures         | `HourlyChart`            | `components/weatherCharts/HourlyChart/`     |
| Graphique 5 jours           | `DailyChart`             | `components/weatherCharts/DailyChart/`      |
| Onglets graphiques          | `ChartTabs`              | dans `WeatherInfo/index.js` (petit écran)   |
| Résumé IA                   | `AiSummary`              | `components/AiSummary/index.js`             |
| Boutons de contrôle         | `ControlButtons`         | `components/ControlButtons/index.js`        |
| Paramètres (overlay)        | `Settings`               | `components/Settings/index.js`              |
| Débogage (overlay)          | `Debug`                  | `components/Debug/index.js`                 |
| Bouton panneau (petit écran)| `PanelToggle`            | dans `App/index.js`                         |

---

## Overlays

**Settings** et **Debug** sont des overlays qui se superposent par-dessus la carte radar (côté gauche). Ils n'occupent jamais l'InfoPanel. Les deux panneaux s'excluent mutuellement — ouvrir l'un ferme l'autre automatiquement.

- **Settings** : accessible via le bouton ⚙ dans ControlButtons, toujours visible
- **Debug** : accessible via le bouton 🐛 dans ControlButtons, visible uniquement depuis le Pi lui-même (`localhost`) quand `DEBUG=true`
