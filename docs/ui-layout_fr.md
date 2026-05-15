# Pi Weather Station — Référence de disposition de l'interface (v3 / Direction C)

Ce document décrit la disposition de l'écran, les noms des composants et les noms des sections de l'interface **v3 Direction C**. L'interface v3 est activée via le bouton **Aperçu** dans les Paramètres (section 4). Utilisez ce document pour signaler des problèmes ou demander des modifications.

> **Note v2** — la disposition d'avant la v3 (grille fractionnée, InfoPanel à droite avec ControlButtons en bas du rail) est toujours accessible en désactivant le bouton Aperçu. Ce document couvre uniquement la v3.

---

## Variantes de disposition

L'interface v3 sélectionne automatiquement une disposition selon la taille de l'écran :

| Condition | Disposition |
|-----------|-------------|
| `max-height ≤ 520 px` (p. ex. Pi 7" officiel à 800×480) | **LayoutPi** |
| `width ≥ 1280 px` (moniteur HD, Pi 10", bureau) | **LayoutDesktop** |

---

## LayoutPi — écran tactile Pi 7" / 10"

La carte occupe la colonne de gauche ; le rail (panneau d'information) occupe la colonne de droite. Un bouton chevron repliable sur le bord droit de la carte masque/affiche le rail.

```
┌──────────────────────────┬──────────────────────────┐
│                          │ TimeBlock                 │
│                          │ (date · horloge · soleil) │
│                          ├──────────────────────────┤
│   WeatherMap             │ HeroCompact               │
│   (Leaflet + tuiles radar│ (lieu · temp · icône ·   │
│    RainViewer)           │  description)             │
│                          ├──────────────────────────┤
│                          │ AlertBanner               │
│         [›]              ├──────────────────────────┤
│    (chevron repliable)   │ AlertDetailInline         │
│                          ├──────────────────────────┤
│                          │ MetricsGrid               │
│                          │ (vent · humidité · UV ·   │
│                          │  qualité de l'air)        │
│                          ├──────────────────────────┤
│                          │ IndoorBlock (Homebridge)  │
│                          ├──────────────────────────┤
│                          │ ChartTabs                 │
│                          │ (onglets 24 h / 5 jours   │
│                          │  sur ≤ 520 px hauteur)    │
│                          ├──────────────────────────┤
│                          │ AiSummaryInline           │
│                          │ (expansible ↑)            │
└──────────────────────────┴──────────────────────────┤
│ BottomDock (ControlButtons — 7 boutons icônes)       │
└──────────────────────────────────────────────────────┘
```

### Adaptations petit écran (≤ 520 px hauteur — affichage 7" officiel 800×480)

- **ChartTabs** — HourlyChart et DailyChart sont affichés sous forme de deux onglets (`24 heures` / `5 jours`) au lieu d'être empilés, pour économiser l'espace vertical. L'état de l'onglet persiste pendant la session.
- **Basculement du panneau** — Un chevron (`›` / `‹`) est épinglé au bord droit de la carte pour replier/déplier le rail. Lorsque replié, la carte occupe toute la largeur ; Leaflet appelle `map.invalidateSize()` afin que les tuiles se réajustent.
- **FloatingMiniBanner** — Lorsque le rail est replié et qu'une alerte météo gouvernementale sévère est active, une bannière compacte se superpose en haut à droite de la carte pour que l'alerte ne soit jamais silencieusement masquée. Appuyer dessus rouvre le rail.
- **Grille SettingsPanel grid4** — Les grilles de la section Avancé basculent à 2 colonnes sur ≤ 520 px de hauteur, ce qui donne suffisamment d'espace aux curseurs et aux interrupteurs (corrige le débordement sur les curseurs d'opacité radar et le sous-texte du bouton IA).

### Rail replié

```
┌────────────────────────────────────┬──┐
│                                    │  │
│                                    │‹ │
│   WeatherMap (pleine largeur)      │  │
│                                    │  │
│  [FloatingMiniBanner si alerte]    │  │
│                                    │  │
└────────────────────────────────────┴──┤
│  BottomDock                           │
└───────────────────────────────────────┘
```

---

## LayoutDesktop — moniteur HD / bureau (≥ 1280 px de large)

La carte occupe tout le viewport en arrière-plan pleine saignée. Le HeroBand, le rail droit et le BottomDock sont des dalles translucides flottant au-dessus du radar.

```
┌─────────────────────────────────────────────┬───────────┐
│ HeroBand (dalle flottante, max 1600 px)     │           │
│ ┌──────────────┬──────────────┬───────────┐ │           │
│ │ Localisation │ Temp + icône │ Date      │ │  Rail     │
│ │ (nom ville)  │ + description│ Horloge   │ │  droit    │
│ │              │              │ Soleil    │ │           │
│ └──────────────┴──────────────┴───────────┘ │ - Métriq. │
│                                         [›] │ - Alertes │
│  WeatherMap                                 │ - Graphes │
│  (pleine saignée — radar visible à travers) │ - Résumé  │
│                                             │   IA      │
│                                             │           │
├─────────────────────────────────────────────┴───────────┤
│  BottomDock (ControlButtons)                             │
└──────────────────────────────────────────────────────────┘
```

### Panneaux du HeroBand

| Panneau | Contenu | Tailles de police |
|---------|---------|-------------------|
| **Gauche — Localisation** | Nom de la ville (LocationName, icône épingle) | 16 px → 20 px à ≥ 1600 px |
| **Centre — Température** | Grand chiffre de temp. · badge unité · icône météo · description | 72 px → 88 px à ≥ 1600 px |
| **Droite — Horloge** | Date (majuscules) · HH:MM · AM/PM (12h) · rangée lever/coucher | Horloge 44 px → 52 px ; rangée soleil 12 px → 14 px à ≥ 1600 px |

Le band a une limite de `max-width: 1600 px` — aux viewports ultra-larges (2560 px+), il reste riche en contenu plutôt que de s'étendre sur toute la largeur disponible.

### Rail droit

Largeur : `320 px` (défaut) · `360 px` à ≥ 1600 px. Suit la préférence de taille de police de l'utilisateur (`--c-font-scale`).

Composants (de haut en bas) :
1. **AlertBanner** — pastille d'alerte météo sévère gouvernementale (masquée en l'absence d'alerte active)
2. **AlertDetailInline** — texte de l'alerte développée (masqué lorsque réduit)
3. **MetricsGrid** — vitesse du vent · humidité · indice UV · indice de qualité de l'air
4. **IndoorBlock** — température / humidité / qualité de l'air intérieurs Homebridge (masqué si non configuré)
5. **ChartTabs** — onglets de prévisions sur 24 heures et 5 jours avec graphiques Recharts
6. **AiSummaryInline** — résumé météo IA Claude ; expansible pour remplir le rail (bouton ↑)

### Rail replié (LayoutDesktop)

Le chevron (`›` / `‹`) sur le bord droit de la carte replie le rail. Le HeroBand s'étend pour occuper la largeur libérée. FloatingMiniBanner apparaît si une alerte est active.

---

## BottomDock

S'étend sur toute la largeur du viewport en bas des deux dispositions. Contient la rangée **ControlButtons**. Hauteur : 52 px. Icônes : 24 px.

### ControlButtons (de gauche à droite, configuration typique)

| Icône | Action | Condition d'affichage |
|-------|--------|-----------------------|
| ↖ Flèche localisation | Recentrer la carte sur la position d'accueil | Toujours |
| 📍 / 📍off | Afficher/masquer le marqueur de position | Toujours |
| 〜 Chronologie | Afficher/masquer le curseur de chronologie radar | Source RainViewer uniquement |
| ↗ Flèches direction | Afficher/masquer les flèches de direction des précipitations | Analyse radar activée |
| ☰ Légende | Afficher/masquer la légende des couleurs radar | RainViewer + horodatages chargés |
| ◑ Contraste | Basculer mode sombre / clair | Toujours |
| ⚙ Paramètres | Ouvrir le panneau Paramètres | Toujours |
| 🐛 Debug | Ouvrir le panneau Debug | Localhost + `DEBUG=true` uniquement |
| ⬆ Mise à jour | Ouvrir la fenêtre de mise à jour | Quand une nouvelle version est disponible |

L'apparence des boutons s'adapte à la palette Direction C via des propriétés CSS personnalisées : arrière-plans transparents (la surface du dock transparaît), séparateurs `--c-border-hybrid`, `--c-accent-soft` lors de l'appui/actif.

---

## Superpositions

Toutes les superpositions s'affichent en `position: fixed; inset: 0; z-index 5000+` et reprennent la palette Direction C active via des variables CSS en ligne (elles sont rendues en dehors de `AmbientLayers`).

| Superposition | Déclencheur | Accès distant |
|---------------|-------------|---------------|
| **SettingsPanel** | Bouton ⚙ Paramètres | Sections 2–4 (écritures serveur) bloquées depuis les clients distants ; vue en lecture seule affichée |
| **DebugPanel** | Bouton 🐛 Debug | Localhost + `DEBUG=true` uniquement |
| **UpdateModal** | Bouton ⬆ Mise à jour | Localhost uniquement (`/api/update` est `localhostOnly`) |

---

## Palette / modes heure du jour

La palette Direction C s'adapte automatiquement en fonction de l'heure du jour (`useTimeOfDay()`) :

| Mode | Plage horaire | Couleurs clés |
|------|---------------|---------------|
| **day** | Après le lever du soleil | Fond crème chaud `#f4f0e8`, texte sombre, accent ambré |
| **dusk** | ± 90 min autour du lever/coucher | Fond gris chaud profond `#1c1a17`, accent ambré |
| **night** | Entre dusk et la fenêtre nightRed | Fond presque noir `#0e0c0a`, accent cuivré |
| **nightRed** | Fin de nuit (vision nocturne / mode sommeil) | Fond rouge très sombre `#100404`, texte et accent en tons rouges |

`nightRed` utilise `text: #d05050` (contraste ~5:1) et `textDim: #b84848` (contraste ~4:1) sur la surface de carte sombre — lisible aussi bien pour le texte gras que non gras.
