# Pi Weather Station — Référence de disposition de l'interface (v3 / Direction C)

Ce document décrit la disposition de l'écran, les noms des composants et les noms des sections de l'interface **v3 Direction C**. L'interface v3 est activée via le bouton **Aperçu** dans les Paramètres (section 4). Utilisez ce document pour signaler des problèmes ou demander des modifications.

> **Note v2** — la disposition d'avant la v3 (grille fractionnée, InfoPanel à droite avec ControlButtons en bas du rail) est toujours accessible en désactivant le bouton Aperçu. Ce document couvre uniquement la v3 ; voir [`archive/ui-layout_v2_fr.md`](archive/ui-layout_v2_fr.md) pour la référence v2.

---

## Variantes de disposition

L'interface v3 sélectionne automatiquement une disposition selon la taille de l'écran :

| Condition | Disposition |
|-----------|-------------|
| `width ≤ 799 px` (téléphone portrait 375-430 px) | **LayoutMobile** |
| `800 ≤ width ≤ 1279 px` (p. ex. Pi 7" officiel à 800×480) | **LayoutPi** |
| `width ≥ 1280 px` (moniteur HD, Pi 10", bureau) | **LayoutDesktop** |

Les transitions sont surveillées en direct via `matchMedia('change')` — les rotations d'orientation et les redimensionnements de fenêtre permutent les dispositions sans rechargement.

---

## LayoutMobile — téléphone portrait (< 800 px de large)

Variante A « Compagnon nomade » du dossier de design. Colonne unique défilante optimisée pour 375-430 px portrait (iPhone / Android). L'utilisateur cible est **loin du Pi** et veut une lecture rapide des conditions et des alertes.

```
┌──────────────────────────────┐
│ TimeBlock                    │  ◀ horloge + lever/coucher
│ AlertBanner                  │  ◀ alerte gouvernementale (si active)
│ AlertDetailInline            │  ◀ alerte développée (tap pour ouvrir)
│ HeroCompact                  │  ◀ lieu, grosse temp, condition
│ MetricsGrid                  │  ◀ tuiles vent / humidité / UV / AQ
│ IndoorBlock                  │  ◀ températures Homebridge (si configuré)
│ Carte radar mini (~220 px) [⛶] │ ◀ carte inset; bouton maximiser
│ ChartTabs                    │  ◀ graphique horaire 24 h
│ AiSummaryInline              │  ◀ résumé Claude
│ Footer hint                  │  ◀ « réglages sur le Pi »
├──────────────────────────────┤
│ BottomDock                   │  ◀ palette + marqueur + recentrer + refresh
└──────────────────────────────┘
```

### Carte radar maximisable

- Bouton maximiser dans le coin supérieur droit de la carte mini (44×44 px, conforme Apple HIG) — paire SVG à quatre équerres depuis la Phase 3 (vers l'extérieur = agrandir, vers l'intérieur = restaurer, mêmes icônes que le toggle focus desktop/7").
- En mode mini (220 px), la **bande de légende radar et la timeline sont cachées en CSS** — pas de place lisible. Les boutons correspondants du dock sont grisés et un toast invite à maximiser la carte.
- En mode maximisé, la carte passe en **pleine surface** : elle remplit 100 % de l'espace applicatif au-dessus du dock (`inset` aux bords du conteneur défilant, sans marges ni coins arrondis) — le même traitement « le radar possède l'écran » que les grandes dispositions. La bande de légende compacte et la barre de timeline réapparaissent.
- Le `top:` maximisé conserve `env(safe-area-inset-top)` pour que les contrôles sur la carte évitent la **zone Control-Centre d'iOS** (coin supérieur droit ~84 px × 30 % de la largeur en portrait notché) qui interceptait les taps sur le bouton de minimiser (v2.16.5).
- Quand une alerte gouvernementale est active pendant que la carte est maximisée, la puce **FloatingMiniBanner** apparaît alignée à droite sous le bouton restaurer (la carte maximisée recouvre l'AlertBanner de la colonne — même propriété « ne jamais cacher une alerte active à l'utilisateur » que les modes focus Desktop/Pi). Un tap sur la puce restaure la carte mini, ce qui révèle la bannière complète.

### Pull-to-refresh

- Geste natif sur le conteneur `.scroll` quand `scrollTop === 0`.
- Damping 0.5× sur le delta brut, cap à 120 px.
- Seuil à 80 px : le spinner change de couleur (armé) ; relâcher au-dessus déclenche `window.location.reload()`, relâcher en-dessous ressort via transition CSS 180 ms.
- Indicateur visuel en haut : spinner + label « Rafraîchir l'application » / « Rafraîchissement… ».
- Listeners passifs (`touchstart` / `touchmove` / `touchend`), scopés au `.scroll` mobile — n'affecte ni LayoutPi ni LayoutDesktop.

### Quirks PWA standalone iOS

- **Fond hors-zone** : `100dvh < hauteur physique` en standalone sur iPhone notché ; le `body` et `<html>` sont peints à la couleur du palette via un `useEffect` dans `AmbientLayers` pour combler la zone réservée par iOS (sinon : barre noire visible sous le dock).
- **Palette nightRed** : utilise `#270c0c` (surface effective composite) plutôt que `palette.bg` (`#100404`) pour éviter que la zone hors-page apparaisse noire face au dock rouge plus clair.
- **Safe-area en haut** : le SettingsPanel ajoute `padding-top: max(14px, env(safe-area-inset-top))` sur son header pour que le bouton de fermeture (×, 44×44) ne soit pas sous la Dynamic Island. Le DebugPanel n'a plus de header (Phase 7) : le rail (gauche) et la toolbar persistante (droite) absorbent chacun leur portion du safe-area haut.

---

## LayoutPi — écran tactile Pi 7" / 10"

La carte occupe la colonne de gauche ; le rail (panneau d'information) occupe la colonne de droite. Un bouton chevron repliable sur le bord droit de la carte masque/affiche le rail.

```
┌──────────────────────────┬──────────────────────────┐
│                          │ TimeBlock                 │
│                          │ (date · horloge · soleil) │
│                          ├──────────────────────────┤
│   WeatherMap             │ AlertBanner               │
│   (Leaflet + tuiles radar├──────────────────────────┤
│    RainViewer)           │ AlertDetailInline         │
│                          ├──────────────────────────┤
│         [›]              │ HeroCompact               │
│    (chevron repliable)   │ (lieu · temp · icône ·   │
│                          │  description)             │
│                          ├──────────────────────────┤
│                          │ MetricsGrid               │
│                          │ (vent · humidité · UV ·   │
│                          │  qualité de l'air)        │
│                          ├──────────────────────────┤
│                          │ IndoorBlock (Homebridge)  │
│                          ├──────────────────────────┤
│                          │ ChartTabs                 │
│                          │ (onglets 24 h / 5 jours)  │
│                          ├──────────────────────────┤
│                          │ AiSummaryInline           │
│                          │ (expansible ↑)            │
└──────────────────────────┴──────────────────────────┤
│ BottomDock (ControlButtons — 7 boutons icônes)       │
└──────────────────────────────────────────────────────┘
```

### Adaptations toujours actives (toute hauteur en `LayoutPi`)

- **ChartTabs (v3.1 Phase 5)** — un panneau « Prévisions » : pills de période (`24 h` / `5 jours`) à côté du titre, et quatre onglets de métrique étiquetés (Temp · Vent · Précip · Heures/Jours) remplaçant les anciens points de carrousel (constat F9). Temp = courbe accent + remplissage + étiquettes des points clés ; Vent = vitesse + rafales en pointillé + rangée de flèches de direction ; Précip = barres d'accumulation + ligne de probabilité pointillée ; le dernier onglet est la grille d'icônes heure/jour. Pills de résumé chiffré sous chaque graphique (max/min/pic…, le constat F13 corrige les axes : « 14° », unité une seule fois sur le tick max) plus un chip « Précip » optionnel de superposition sur Temp/Vent. Le bouton agrandir garde sa zone de 44 px et la paire d'équerres partagée avec les contrôles radar ; le choix de métrique par période persiste en localStorage.
- **Basculement du panneau** — Un chevron (`›` / `‹`) est épinglé au bord droit de la carte pour replier/déplier le rail. Lorsque replié, la carte occupe toute la largeur ; Leaflet appelle `map.invalidateSize()` afin que les tuiles se réajustent.
- **FloatingMiniBanner** — Lorsque le rail est replié et qu'une alerte météo gouvernementale sévère est active, une bannière compacte se superpose en haut à droite de la carte pour que l'alerte ne soit jamais silencieusement masquée. Appuyer dessus rouvre le rail.

### Adaptations compactes pour superpositions (`max-height ≤ 520 px` — affichage 7" officiel 800×480)

Ces ajustements ne se déclenchent que sur les viewports courts (l'écran Pi 7" et similaires). Les écrans 10" 1024×600 ne touchent PAS ces seuils — ils obtiennent la même mise en page à densité standard.

- **Grille SettingsPanel grid4** — Les grilles de la section Avancé basculent à 2 colonnes, ce qui donne suffisamment d'espace aux curseurs et aux interrupteurs (corrige le débordement sur les curseurs d'opacité radar et le sous-texte du bouton IA).
- **Mode compact DebugPanel** — Zoom de police réduit + interlignes resserrés pour que le viewport 800×480 montre plus de KPI / données services sans défilement.
- **LayoutMobile mapCard landscape** — La carte radar mini passe de 220 → 160 px en paysage pour que le hero + la première rangée de métriques restent visibles sans scroll.

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

S'étend sur toute la largeur du viewport en bas des trois dispositions (Mobile / Pi / Desktop). Contient la rangée **ControlButtons**. Hauteur : 52 px. Icônes : 24 px.

### ControlButtons (de gauche à droite, configuration typique)

| Icône | Action | Condition d'affichage |
|-------|--------|-----------------------|
| ↖ Flèche localisation | Recentrer la carte sur la position d'accueil | Toujours |
| 📍 / 📍off | Afficher/masquer le marqueur de position | Toujours |
| 〜 Chronologie | Afficher/masquer le curseur de chronologie radar | Source RainViewer uniquement |
| ↗ Flèches direction | Afficher/masquer les flèches de direction des précipitations | Analyse radar activée |
| ☰ Légende | Afficher/masquer la légende des couleurs radar | RainViewer + horodatages chargés |
| ◑ Contraste | Basculer mode sombre / clair | Toujours |
| ⏰ Auto | Mode auto sombre/clair selon lever/coucher | Toujours |
| 🌙 Lune (rouge) | Activer/désactiver la palette nightRed | Toujours |
| 🔄 Refresh | Recharger l'application (`window.location.reload()`) | Toujours — utile en PWA standalone sans barre d'adresse |
| ⚙ Paramètres | Ouvrir le panneau Paramètres | Toujours |
| 🐛 Debug | Ouvrir le panneau Debug | Localhost + `DEBUG=true` uniquement |
| ⬆ Mise à jour | Ouvrir la fenêtre de mise à jour | Quand une nouvelle version est disponible |

L'apparence des boutons s'adapte à la palette Direction C via des propriétés CSS personnalisées : arrière-plans transparents (la surface du dock transparaît), séparateurs `--c-border-hybrid`, `--c-accent-soft` lors de l'appui/actif.

---

## Contrôles de la carte radar (v3.1 Phase 3)

Tous les contrôles flottants sur la carte Leaflet suivent la référence Claude Design Phase 3 v2.1 (constats d'audit F7 · F8 · F20).

- **Zoom +/−** — haut-gauche, 40 × 40 px (36 px sur mobile), surface teintée par la palette, retour `:active` accent uniquement (aucun survol sur les surfaces kiosque). Infobulles localisées.
- **Focus radar (plein écran)** — bouton autonome 40 × 40 px sous la pile de zoom (top 110 px ; 100 px sur LayoutPi). Paire SVG à quatre équerres (vers l'extérieur = focus, vers l'intérieur = restaurer — la même paire que le toggle de maximisation de la carte mobile). Masque le HeroBand + le rail ; chaque bascule est confirmée par un bref toast. État actif = accent plein.
- **Barre de timeline** — barre pleine largeur en bas (inset droit conscient du rail). En-tête : lecture/pause · pas ±1 · vitesse (1×/2×/4×) · horodatage + chip « now-tag » (jamais un décalage relatif nu ; les trames de prévision basculent vers un chip pointillé « Prévision · +N min ») · sous-ligne des comptes de trames · pilule retour-au-présent conditionnelle · chip source (« RainViewer · 10 min », cadence dérivée de l'espacement réel des trames ; teinte d'avertissement si le dernier rafraîchissement de la liste a échoué). Piste : remplissage passé, marqueur « Maintenant » étiqueté à la frontière passé→prévision, zone future hachurée **scrubbable**, et étiquettes de graduation dérivées au runtime (−2 h … +30 min). La surface de scrub reste l'input range natif (invisible, pleine largeur) — la gestion pointer-capture éprouvée sur le terrain et l'accessibilité clavier sont conservées.
- **Légende** — carte bas-gauche à trois sections : *Rayons d'analyse* (sensible à l'unité ; cercle extérieur seulement si le rayon étendu est actif), *Précipitations* (la vraie barre à six segments du scheme 6 RainViewer — identique dans les quatre palettes, nuit-rouge incluse), *Alertes à proximité* (clé des tiers + compte honnête dans le rayon). Sur écrans courts (≤ 520 px de haut) avec la timeline ouverte, elle se replie en chip « (i) Légende » ; le chip — et le (i) de la bande mobile — ouvrent la légende complète en surimpression (scrim + ✕ + Échap). Sur la disposition mobile, la carte est remplacée par une bande compacte pleine largeur près du bord inférieur.
- **Chips de rayon sur la carte** — étiquettes « 50 km » / « 100 km » à l'intersection sud-est des cercles (sensibles à l'unité ; masquées sur mobile et au-delà du zoom 13, même porte que les cercles).
- **Attribution** — au ras du bas-droite, collée au bord du dock dans tous les états (obligation légale — visible partout, y compris la mini-carte mobile) ; amincie pour tenir dans le couloir de 16 px sous la barre de timeline / la bande de légende.
- Les nouveaux tokens CSS du radar (`--rc-*`, `--map-*`) vivent dans `WeatherMap/styles.css`, commutés par palette via `data-palette` (délibérément pas ajoutés à `ui/tokens.js`). En nuit-rouge, les tokens des tiers d'alertes s'effondrent vers la famille rouge tandis que l'échelle de précipitations garde les vraies couleurs des tuiles.

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

---

## Installation PWA (iOS / Android)

L'application peut être installée sur l'écran d'accueil d'un téléphone via la fonction « Ajouter à l'écran d'accueil » du navigateur. Une fois installée, elle se lance en mode standalone (sans la chrome du navigateur) et hérite de l'icône `apple-touch-icon.png` (PNG opaque 180×180) et du `manifest.json` (icônes 192 + 512).

### Certificat TLS auto-signé

Le serveur génère un certificat auto-signé au premier démarrage (CN : `Pi Weather Station - <hostname>`, SAN incluant `localhost`, `127.0.0.1`, l'IP LAN détectée et le hostname `.local`). Pour qu'iOS accepte le certificat en mode PWA :

1. Télécharger le `.pem` depuis Paramètres → « Faire confiance à ce Pi sur cet appareil » (endpoint `/api/cert.pem`, MIME `application/x-x509-ca-cert`).
2. Installer le profil iOS (Réglages → Profil téléchargé).
3. Activer la confiance complète : Réglages → Général → Information → Réglages de confiance des certificats.

Procédure détaillée par plateforme : [`docs/pwa-trust-cert_fr.md`](pwa-trust-cert_fr.md).

### Rafraîchir une PWA installée

En mode standalone, la barre d'adresse Safari est masquée — pas de bouton recharger natif. Deux mécanismes :

- **Bouton 🔄 Refresh du dock** (universel — toutes dispositions).
- **Pull-to-refresh** sur LayoutMobile (geste tactile depuis le haut du conteneur défilant — voir section LayoutMobile).
