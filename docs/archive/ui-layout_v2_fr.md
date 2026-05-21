# Pi Weather Station — Référence de disposition (v2 — archivé)

> **Archivé.** Ce document décrit la **disposition v2** (grille fractionnée, InfoPanel à droite avec ControlButtons au bas du rail), toujours accessible en désactivant le bouton **Aperçu** dans les Paramètres. La disposition v3 Direction C actuellement par défaut est documentée dans [`docs/ui-layout_fr.md`](../ui-layout_fr.md).

Ce document décrit la disposition de l'écran, les noms des panneaux et des sections utilisés dans l'interface v2 de Pi Weather Station. Utilisez-le comme référence pour signaler des problèmes ou demander des modifications relatives à la disposition v2.

---

## Full layout (normal screen, > 520 px height)

```
┌─────────────────────────────────────────┬───────────────────┐
│                                         │   INFOPANEL       │
│                                         │ ┌───────────────┐ │
│                                         │ │ IndoorTemp│CLK│ │
│                                         │ └───────────────┘ │
│                                         │ ╔═══════════════╗ │
│  WEATHERMAP (Leaflet + tuiles radar     │ ║ LocationName  ║ │
│  RainViewer, cercle d'analyse 50 km)    │ ╠═══════════════╣ │
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
│           WEATHERMAP                 │ │ │ IndoorTmp│CLK │ │
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

## Overlay Debug — pleine largeur sur petits écrans

Sur petits écrans, l'overlay **Debug** s'étend sur toute la largeur du viewport au lieu de laisser une gouttière de 320 px à droite pour l'InfoPanel — sans cela, les tableaux de débogage (quotas, services, événements de sécurité) sont trop comprimés pour être utilisables. L'InfoPanel et le bouton **PanelToggle** restent montés en arrière-plan mais sont visuellement recouverts. La fermeture s'effectue via la pastille rouge **Fermer** au coin haut-droit du panneau lui-même, pas via l'icône bug dans ControlButtons (également recouverte).

```
┌──────────────────────────────────────────────────────────[X]┐
│ DEBUG (pleine largeur du viewport)                          │
│  · État des fournisseurs / KPIs / Quotas / Services / Logs  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

L'overlay **Settings** conserve la gouttière de 320 px sur petits écrans — ses lignes tiennent dans la zone réduite, donc l'InfoPanel reste partiellement visible derrière.

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
| Température intérieure      | `IndoorTemperature`      | `components/IndoorTemperature/index.js`     |
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
| Modale de mise à jour       | `UpdateModal`            | `components/UpdateModal/index.js`           |
| Bouton panneau (petit écran)| `PanelToggle`            | dans `App/index.js`                         |

---

## Overlays

**Settings** et **Debug** sont des overlays qui se superposent par-dessus la carte radar. Sur grands écrans ils laissent une gouttière de 320 px à droite pour que l'InfoPanel reste visible ; sur petits écrans (≤ 520 px de hauteur), l'overlay **Debug** s'étend sur toute la largeur du viewport, tandis que **Settings** conserve la gouttière (voir « Overlay Debug — pleine largeur sur petits écrans » plus haut). Les deux panneaux s'excluent mutuellement — ouvrir l'un ferme l'autre automatiquement.

- **Settings** : accessible via le bouton ⚙ dans ControlButtons, toujours visible. Le bouton de fermeture intégré est le **X** au coin haut-droit du panneau. Le bas du panneau expose une section repliable **Paramètres avancés** (groupe Affichage : styles de carte, sliders d'opacité radar, slider de luminosité matérielle ; groupe IA : bascules d'analyse radar, overlay des points d'échantillonnage).
- **Debug** : accessible via le bouton 🐛 dans ControlButtons, visible uniquement depuis le Pi lui-même (`localhost`) quand `DEBUG=true`. La fermeture s'effectue via la pastille ronde rouge **Fermer** au coin haut-droit du panneau — dimensionnée pour le tactile (44×44 px) et bien visible sur le fond sombre. La taille de police du panneau Debug suit le sélecteur global Réglages → Taille police avec une échelle dédiée (P = 1.0×, M = 1.15×, G = 1.30×).
- **UpdateModal** : s'ouvre depuis l'overlay Settings quand `GET /api/update-check` retourne `updateAvailable: true`. Liste les commits `feat:`/`fix:` à venir et affiche les avertissements (`needsManualUpgrade`, `serviceFileChanged`) ainsi que les messages d'erreur d'un `POST /api/update` échoué.

---

## En-tête de l'InfoPanel

La rangée d'en-tête au sommet de l'InfoPanel héberge à la fois **IndoorTemperature** (à gauche) et **Clock** (à droite). Quand `indoorTemperature.enabled` est `false` ou que l'interrogation Homebridge ne retourne rien, IndoorTemperature ne rend rien et Clock se retrouve seul, aligné à droite via `margin-inline-start: auto` sur le dernier enfant.
