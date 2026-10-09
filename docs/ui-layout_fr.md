# Pi Weather Station — Référence de disposition de l'interface (v3 / Direction C)

Ce document décrit la disposition de l'écran, les noms des composants et les noms des sections de l'interface **v3 Direction C** — la seule interface depuis juillet 2026. Utilisez ce document pour signaler des problèmes ou demander des modifications.

> **Note v2** — la disposition d'avant la v3 (grille fractionnée, InfoPanel à droite avec ControlButtons en bas du rail) a été retirée du code en juillet 2026 et ne peut plus être sélectionnée. Sa référence est conservée dans [`archive/ui-layout_v2_fr.md`](archive/ui-layout_v2_fr.md) afin que les anciennes captures d'écran et les anciens rapports de problème restent lisibles.

---

## Variantes de disposition

L'interface v3 sélectionne automatiquement une disposition selon la taille de l'écran :

| Condition | Disposition |
|-----------|-------------|
| `width ≤ 799 px` (téléphone portrait 375-430 px) | **LayoutMobile** |
| `800 ≤ width ≤ 1279 px` (p. ex. Pi 7" officiel à 800×480, Pi 10,1" mis à l'échelle automatiquement → 1024×640 px CSS) | **LayoutPi** |
| `width ≥ 1280 px` (moniteur HD, bureau, Pi 10,1" 1280×800 sans mise à l'échelle d'affichage) | **LayoutDesktop** |

Les transitions sont surveillées en direct via `matchMedia('change')` — les rotations d'orientation et les redimensionnements de fenêtre permutent les dispositions sans rechargement.

---

## LayoutMobile — téléphone portrait (< 800 px de large)

Variante A « Compagnon nomade » du dossier de design. Colonne unique défilante optimisée pour 375-430 px portrait (iPhone / Android). L'utilisateur cible est **loin du Pi** et veut une lecture rapide des conditions et des alertes.

```
┌──────────────────────────────┐
│ TimeBlock                    │  ◀ horloge (date · heure)
│ AlertBanner                  │  ◀ alerte gouv., sinon alerte RADAR (si active)
│ AlertDetailInline            │  ◀ alerte développée (tap pour ouvrir)
│ AlertMiniCards               │  ◀ autres alertes + pastille « restaurer » (si présentes)
│ HeroCompact                  │  ◀ lieu · grosse temp · condition ·
│                              │    ressenti · méta-ligne soleil/lune
│ AirCard                      │  ◀ rangées IQA + pollen (pastilles)
│ MetricsGrid                  │  ◀ tuiles vent / rafales / UV / humidité
│ IndoorBlock                  │  ◀ températures Homebridge (si configuré)
│ Carte radar mini (~220 px) [⛶] │ ◀ carte inset; bouton maximiser
│ ChartTabs                    │  ◀ prévisions (24 h / 5 jours)
│ AiSummaryInline              │  ◀ résumé Claude
│ Footer hint                  │  ◀ « réglages sur le Pi »
├──────────────────────────────┤
│ BottomDock                   │  ◀ recentrer · lieux · marqueur · contraste ·
│                              │    refresh · paramètres · pastille d'état (portrait)
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
- **Safe-area en haut** : ni le SettingsPanel (Phase 6) ni le DebugPanel (Phase 7) n'ont plus de header ; dans les deux, le rail (gauche) absorbe les insets haut + gauche, et le côté contenu (droite — le volet de contenu du SettingsPanel, la toolbar persistante du DebugPanel) les insets haut + droit. La sortie du SettingsPanel est l'action « Fermer » au bout du rail (plus de bouton × flottant). Sur téléphone (≤ 600 px de large), ce rail devient une barre d'onglets en haut qui absorbe à elle seule les insets haut, gauche et droit.

---

## LayoutPi — écran tactile Pi 7" / 10"

**v3.2 — trois états de mise en page.** Un seul enum `piLayoutState` (`"min" | "mid" | "max"`) pilote l'écran via `data-pi-state` sur la racine :

- **MID** (défaut) — le split ci-dessous : carte radar à gauche, rail *compagnon du radar* allégé à droite (alertes · horloge slim · hero ancré sur le ressenti · NowcastLine · qualité de l'air · un 2×2 Vent / Rafales / UV / Humidité · intérieur). Le graphique de prévisions et le résumé IA ne sont pas dans ce coup d'œil — les deux s'atteignent depuis le groupe **Vues** du dock : le bouton prévisions ouvre MAX, et le bouton IA (étincelle) ouvre la vue IA plein rail, quittée par son bouton retour. L'ouverture de la vue IA fonctionne sur tous les écrans Pi, y compris les 10,1" plus hauts (CSS 1024×640, hors du gate des vues prioritaires v3.3) ; jusqu'en 2026-10 elle n'existait que dans le modèle prioritaire v3.3, ce qui privait ces écrans de tout accès au résumé IA.
- **MIN** — radar plein écran (l'ancien mode focus) : le rail se replie et le dock se masque pour que le radar remplisse vraiment l'écran. Rien d'autre ne recouvre la carte — la seule superposition est la **FloatingMiniBanner**, épinglée en haut à droite quand une alerte gouvernementale admissible est active, pour que le mode focus ne masque jamais une alerte sévère. *(Le `HeroOverlayMin` compact lieu / température que la v3.2 épinglait d'abord sur le radar a été retiré et le composant supprimé ; le coup d'œil lieu / température est à un tap dans le rail.)*
- **MAX** — prévisions prioritaires : la carte se réduit en vignette gelée ~190 px, le graphique de prévisions prend tout le rail et le dock se masque (comme en MIN). Atteint par le **bouton prévisions** du dock (groupe Vues) ; quitté par le bouton restaurer du graphique. *(Refonte des affordances du rail 2026-06-24 : la NowcastLine ne maximise plus — c'est une ligne d'état radar seulement ; les prévisions sont passées au dock pour que l'état radar « maintenant » et les prévisions « futur » soient des affordances distinctes.)*

**Deux rails MID.** MIN, MAX et la vue IA sont communs, mais LayoutPi a deux rails MID, choisis selon la hauteur du viewport CSS : au-dessus de 540 px, le rail empilé v3.2 détaillé ci-dessous ; à 540 px ou moins — le 7" officiel 800×480 — le coup d'œil des vues prioritaires v3.3, dont les points d'entrée ouvrent deux vues plein rail de plus, Alerte et Conditions (voir *Vues prioritaires (v3.3)* plus bas).

Le diagramme ci-dessous détaille le rail **MID** empilé (ordre v3.2, de haut en bas — le graphique de prévisions et le résumé IA ne sont pas dans ce coup d'œil).

```
┌──────────────────────────┬──────────────────────────┐
│ [+][−] zoom              │ AlertBanner (alerte gouv,│
│ [carré focus] -> MIN     │  rangée compacte : chip ·│
│ (sous la pile de zoom)   │  source · titre · 1/N)   │
│                          ├──────────────────────────┤
│                          │ AlertDetailInline (tap   │
│                          │  la bannière → détail)   │
│                          ├──────────────────────────┤
│                          │ AlertMiniCards (pastille │
│                          │  « restaurer » seulement)│
│                          ├──────────────────────────┤
│                          │ AirAlertCard (AIR, si    │
│                          │  QA ≥ élevé seulement)   │
│                          ├──────────────────────────┤
│   WeatherMap             │ TimeBlock compact (heure │
│   (carte encadrée 14 px, │  · date · prochain lever │
│    Leaflet + tuiles radar│  ou coucher du soleil)   │
│    RainViewer)           ├──────────────────────────┤
│                          │ HeroCompact (lieu · temp │
│                          │  · condition · ressenti ;│
│                          │  pas d'astro sur le Pi)  │
│                          ├──────────────────────────┤
│                          │ NowcastLine (RADAR ·     │
│                          │  verdict · confiance)    │
│                          ├──────────────────────────┤
│                          │ AirCard (IQA · pollen ;  │
│                          │  rangée IQA masquée si   │
│                          │  AirAlertCard affichée)  │
│                          ├──────────────────────────┤
│                          │ MetricsGrid 2×2 (vent ·  │
│                          │  rafales · UV · humidité)│
│ carte légende            ├──────────────────────────┤
│ [barre de chronologie]   │ IndoorBlock (Homebridge, │
│             attribution  │  si configuré)           │
└──────────────────────────┴──────────────────────────┤
│ BottomDock (ControlButtons — groupes Carte · Vues · │
│  Affichage · Système ; Vues = prévisions (MAX) + IA)│
└─────────────────────────────────────────────────────┘
```

*Les rangées de la pile d'alertes, la AirAlertCard et l'IndoorBlock ne s'affichent que lorsqu'elles ont quelque chose à montrer ; le rail défile quand la pile dépasse la hauteur du viewport (ce rail tourne sur les écrans plus hauts, p. ex. le 10,1" à 1024×640 px CSS ; le 7" utilise plutôt le coup d'œil prioritaire ci-dessous).*

### Vues prioritaires (v3.3 — viewport court)

Sur un viewport limité en hauteur, le rail empilé ci-dessus ne tient pas — sur le 7" en taille de texte G, il repoussait le 2×2 des métriques hors de la zone visible — alors LayoutPi passe au **modèle des vues prioritaires v3.3** : MID devient un *coup d'œil* compact dont chaque point d'entrée ouvre une **vue plein rail**, le mécanisme de MAX généralisé. Livré dans la PR 257 (squash `622965a`, 2026-06-20) derrière un indicateur opt-in et activé automatiquement sur l'écran court par la PR 258 (`aeda96e`) ; la PR 285 (`fbf11b8`) a basé la condition d'activation sur la hauteur du viewport CSS.

#### Activation

`priorityViewsEnabled()` dans `client/src/ui/piLayout.js` choisit le rail MID qu'affiche LayoutPi (LayoutPi lui-même reste choisi selon la largeur, 800–1279 px) :

- **Automatique** — `matchMedia("(max-height: 540px)")`, la hauteur du *viewport* CSS (pas `window.screen.height`). Actif sur le 7" officiel 800×480 et sur tout écran que l'échelle d'affichage du kiosque ramène à la même hauteur (p. ex. un écran 7" 1024×600 mis automatiquement à l'échelle 1,25 → 819×480 px CSS). Les viewports LayoutPi plus spacieux — p. ex. les écrans 10,1" à 1024×640 px CSS — gardent le rail empilé v3.2.
- **Stable d'une taille de texte à l'autre** — la préférence P / M / G est un `zoom` limité au sous-arbre `.rail` et ne change jamais le viewport ; le modèle ne peut donc pas basculer d'une taille de texte à l'autre sur un même écran.
- **Forçage manuel** — `localStorage.forcePriorityViews = "on"` force le modèle sur un viewport plus haut (développement / test en fenêtre). L'une ou l'autre condition suffit à l'activer.
- Contrairement au choix de disposition, la condition n'a pas d'écouteur `change` — elle est lue au rendu (un viewport de kiosque est fixe ; un changement d'échelle d'affichage relance le kiosque).

#### Le coup d'œil (MID)

```
┌──────────────────────────┬──────────────────────────┐
│ [+][−] zoom              │ AlertBanner — carte gouv │
│ [carré focus] -> MIN     │  2 lignes : chip · source│
│ (sous la pile de zoom)   │  · [⤢] -> AlertView ;    │
│                          │  titre · compteur 1/N    │
│                          ├──────────────────────────┤
│                          │ AlertMiniCards (pastille │
│                          │  « restaurer » seulement)│
│                          ├──────────────────────────┤
│                          │ AirAlertCard (AIR, si    │
│   WeatherMap             │  QA ≥ élevé seulement)   │
│   (carte encadrée 14 px, ├──────────────────────────┤
│    Leaflet + tuiles radar│ TimeBlock compact (heure │
│    RainViewer)           │  · date · prochain lever │
│                          │  ou coucher du soleil)   │
│                          ├──────────────────────────┤
│ pas de chronologie dans  │ HeroCompact (lieu · temp │
│ le coup d'œil : le bouton│  · condition ; sans      │
│ chronologie du dock      │  ressenti) [⤢] ->        │
│ l'ouvre en MIN           │  ConditionsView          │
│                          ├──────────────────────────┤
│                          │ NowcastLine (RADAR ·     │
│                          │  verdict · confiance —   │
│                          │  état seulement, sans ⤢) │
│                          ├──────────────────────────┤
│                          │ AirCard (IQA · pollen ;  │
│ (i) chip légende         │  rangée IQA masquée si   │
│             attribution  │  AirAlertCard affichée)  │
└──────────────────────────┴──────────────────────────┤
│ BottomDock — groupe Vues : IA -> AiView ·           │
│  prévisions -> MAX ; groupe Carte : chronologie ->  │
│  MIN + curseur (dock masqué en MIN et dans les vues)│
└─────────────────────────────────────────────────────┘
```

- **Carte d'alerte** — la carte gouvernementale compacte passe sur deux lignes : chip de sévérité · badge de source · ⤢, puis le titre sur sa propre ligne à côté du compteur `1 / N` qui fait défiler les alertes. Le ⤢ et le compteur sont ses deux zones de tap ; le ⤢ ouvre **AlertView**, et l'expansion en ligne `AlertDetailInline` disparaît.
- **HeroCompact** — lieu · température · condition. La ligne du ressenti passe dans ConditionsView (la ligne soleil/lune est déjà masquée sur le rail Pi) ; le ⤢ en coin ouvre **ConditionsView** sans ajouter de hauteur à la carte.
- **MetricsGrid et IndoorBlock** quittent le coup d'œil — tous deux passent dans ConditionsView.
- **Inchangés par rapport au rail empilé** — la pastille « restaurer » (AlertMiniCards), la AirAlertCard, le TimeBlock slim, la NowcastLine (ligne d'état seulement) et l'AirCard (sa rangée IQA cède toujours la place à la AirAlertCard). Comme sur le rail empilé, le graphique de prévisions et le résumé IA ne sont pas dans le coup d'œil : les deux s'ouvrent en vues plein rail depuis le dock.

#### Vues plein rail

La v3.3 a étendu l'enum `piLayoutState` avec `'alert'`, `'conditions'` et `'ai'` ; avec `'max'`, ils forment `MAX_VIEWS` dans `client/src/ui/piLayout.js` (vérifié par `isPiMaxView()`). Seul le modèle prioritaire produit `'alert'` et `'conditions'` ; `'ai'` et `'max'` s'ouvrent depuis le dock sur toute LayoutPi, rail empilé compris. Toutes les vues plein rail partagent le cadre de MAX : la carte se réduit en vignette gelée ~190 px (zoom, carré focus et légende masqués, animation radar en pause), le coup d'œil et le dock se masquent, et la vue prend tout le rail. Le carré de réduction de chaque vue (équerres vers l'intérieur, en haut à droite) ramène à `'mid'` — le dock étant masqué, c'est le chemin du retour.

| État | Vue | Ouverte depuis | Rail |
|------|-----|----------------|------|
| `'alert'` | **AlertView** | le ⤢ de la carte d'alerte | prioritaire seulement |
| `'conditions'` | **ConditionsView** | le ⤢ du HeroCompact | prioritaire seulement |
| `'ai'` | **AiView** | le bouton IA (étincelle) du dock — groupe Vues | les deux |
| `'max'` | **ChartTabs**, agrandi (prévisions) | le bouton prévisions du dock — groupe Vues | les deux |

- **AlertView** — un en-tête fixe porte le traitement de sévérité (une alerte `extreme` reçoit une bande rouge pleine, texte en blanc ; toute autre sévérité, le chip de sévérité teinté), le badge de source, le titre et le carré de réduction, plus une ligne de validité (p. ex. « Jusqu'à 19 h 30 · NWS Mobile AL ») quand l'alerte a une expiration. En dessous, un sélecteur **Aussi actives** liste les autres alertes admissibles en chips à pastille de sévérité — toucher un chip en fait l'alerte affichée (la rangée défile horizontalement). Seul le corps structuré défile : les sections extraites (*Zones affectées* · *Ce qui se passe* · *Ce qui a été observé* · *Source des données* · *Impacts possibles*…), avec le même rendu de sections que `AlertDetailInline` ; *Mesures à prendre* n'apparaît que si le bulletin de l'autorité contient un bloc d'actions — le kiosque ne rédige jamais ses propres consignes de sécurité. Le corps se termine par le code QR vers le bulletin source (règle kiosque : QR seulement) et **Masquer** (cache l'alerte 4 h ; elle réapparaît si elle s'aggrave), qui ramène au coup d'œil. Si l'alerte expire ou quitte l'ensemble admissible pendant la lecture, la vue revient d'elle-même au coup d'œil.
- **ConditionsView** — de haut en bas : la ligne du ressenti ; le **MetricsGrid** étendu à six tuiles sur trois colonnes, soit deux rangées thématiques — Vent · Rafales · UV, puis Humidité · Pression · Visibilité (pression selon la préférence d'unités, visibilité selon l'unité de distance ; la tuile UV garde son popover détail) ; l'**IndoorBlock** (si configuré) ; et un almanach **Soleil / Lune** — lever · coucher · durée du jour, phase de lune + illumination · lever · coucher de la lune — dont les en-têtes soulignés en pointillé ouvrent les mêmes popovers soleil/lune que le héros grand écran (LayoutPi masque la ligne astro du héros ; sur le 7", c'est donc le seul accès à ces popovers).
- **AiView** — le résumé de Claude en au plus trois sections titrées par leur vraie période : *Maintenant*, puis *Ce soir* / *Cette nuit* / *Demain* (sinon *Prochaine période*), puis *Analyse radar*, avec les états « Génération du résumé… » et « Résumé IA indisponible. ». Montée à la demande — seulement dans l'état `'ai'` — pour que l'appel Anthropic payant parte à l'ouverture de la vue, jamais en arrière-plan. Le bouton étincelle l'ouvre depuis le dock de toute LayoutPi, rail empilé compris (voir MID plus haut) ; il s'affiche sauf si le serveur a répondu qu'aucune clé Anthropic n'est configurée (HTTP 503), et n'est pas réservé au mode debug.
- **Prévisions (`'max'`)** — le MAX v3.2 décrit plus haut, inchangé : ChartTabs agrandi ; son bouton restaurer ramène à `'mid'`. Comme AiView, elle existe aussi sur le rail empilé.

Les hôtes prévisions, conditions et alerte restent montés pendant qu'ils sont masqués (`display: none`), ce qui préserve leur état lors d'un aller-retour (p. ex. les onglets de période et de métrique des prévisions) ; l'hôte IA n'est monté que lorsque la vue est ouverte.

#### Curseur radar → MIN

Dans le modèle prioritaire, la chronologie radar ne s'affiche jamais sur la demi-carte du coup d'œil — le curseur est un outil du radar plein écran :

- Le bouton chronologie du dock (groupe Carte) active l'indicateur éphémère `piScrubberOpen` (AppContext, en mémoire seulement) et passe en MIN, avec le toast « Chronologie radar affichée ». Il ne touche jamais la préférence persistée `radarTimelineVisible` qu'utilisent le rail empilé, LayoutDesktop et LayoutMobile.
- Le curseur ne s'affiche que si l'état est MIN **et** que l'indicateur est actif.
- LayoutPi efface l'indicateur dès que l'état quitte MIN, par n'importe quel chemin (carré focus, FloatingMiniBanner) : la prochaine entrée en MIN par le carré focus donne un radar épuré, et le curseur ne revient que par le bouton du dock. Le dock étant masqué en MIN, fermer le curseur revient à quitter MIN.
- Sur le 7" (≤ 520 px de haut), la légende radar ignore elle aussi la préférence : chip « (i) Légende » dans le coup d'œil et au-dessus du curseur ouvert, carte complète seulement sur un radar MIN sans curseur (voir *Légende* sous *Contrôles de la carte radar*).

#### Références de design

- [`docs/v3.3-priority-views-design.md`](v3.3-priority-views-design.md) — le design figé ; ses notes **As built** consignent les écarts du code (pas de renommage `'forecast'`, la vue IA ajoutée — sur tous les écrans Pi depuis 2026-10 — et l'entrée des prévisions déplacée au dock).
- [`docs/rail-affordance-redesign-design.md`](rail-affordance-redesign-design.md) — le vocabulaire de tap que suit le coup d'œil : le ⤢ approfondit le même sujet, un bouton du dock change de sujet, un soulignement pointillé ouvre un popover ; pourquoi la NowcastLine a perdu son ⤢.

### Adaptations toujours actives (toute hauteur en `LayoutPi`)

- **ChartTabs (v3.1 Phase 5)** — un panneau « Prévisions » : pills de période (`24 h` / `5 jours`) à côté du titre, et quatre onglets de métrique étiquetés (Temp · Vent · Précip · Heures/Jours) remplaçant les anciens points de carrousel (constat F9). Temp = courbe accent + remplissage + étiquettes des points clés ; Vent = vitesse + rafales en pointillé + rangée de flèches de direction ; Précip = barres d'accumulation + ligne de probabilité pointillée ; le dernier onglet est la grille d'icônes heure/jour. Pills de résumé chiffré sous chaque graphique (max/min/pic…, le constat F13 corrige les axes : « 14° », unité une seule fois sur le tick max) plus un chip « Précip » optionnel de superposition sur Temp/Vent. Le bouton agrandir garde sa zone de 44 px et la paire d'équerres partagée avec les contrôles radar ; le choix de métrique par période persiste en localStorage.
- **Bascule focus radar (MIN)** — le carré `RadarFocusControl` sous la pile de zoom Leaflet (haut-gauche de la carte, 40 × 40 px, paire d'équerres partagée avec le bouton agrandir de la carte mobile) replie le rail et masque le dock pour que le radar remplisse l'écran, puis rétablit le split au tap suivant ; `MapResizer` appelle `map.invalidateSize()` après chaque bascule afin que les tuiles se réajustent. Il a remplacé le chevron v2 du bord droit (`›` / `‹`) en v3.1.
- **FloatingMiniBanner** — Lorsque le rail est replié et qu'une alerte météo gouvernementale sévère est active, une bannière compacte se superpose en haut à droite de la carte pour que l'alerte ne soit jamais silencieusement masquée. Appuyer dessus rouvre le rail.

### Adaptations compactes pour superpositions (`max-height ≤ 520 px` — affichage 7" officiel 800×480)

Ces ajustements ne se déclenchent que sur les viewports courts (l'écran Pi 7" et similaires). Les écrans 10" 1024×600 à l'échelle d'affichage 1 (celle que l'échelle automatique leur attribue) ne touchent PAS ces seuils — ils obtiennent la même mise en page à densité standard. Le seuil porte sur le viewport CSS : un écran 1024×600 que l'échelle d'affichage du kiosque ramène à ≤ 520 px CSS de haut les atteint (p. ex. un écran 7" mis automatiquement à l'échelle 1,25 → 819×480, voir *Activation* plus haut).

- **Grille SettingsPanel grid4** — Les grilles de la section Avancé basculent à 2 colonnes, ce qui donne suffisamment d'espace aux curseurs et aux interrupteurs (corrige le débordement sur les curseurs d'opacité radar et le sous-texte du bouton IA).
- **Mode compact DebugPanel** — Zoom de police réduit + interlignes resserrés pour que le viewport 800×480 montre plus de KPI / données services sans défilement.
- **LayoutMobile mapCard landscape** — La carte radar mini passe de 220 → 160 px en paysage pour que le hero + la première rangée de métriques restent visibles sans scroll.

### Focus radar (MIN)

```
┌───────────────────────────────────────┐
│ [restaurer]      [FloatingMiniBanner  │
│ (haut-gauche,     si alerte active —  │
│  sous le zoom)    haut-droite]        │
│                                       │
│   WeatherMap (plein écran, sans cadre)│
│                                       │
│   rail + dock masqués                 │
└───────────────────────────────────────┘
```

---

## LayoutDesktop — moniteur HD / bureau (≥ 1280 px de large)

La carte occupe tout le viewport en arrière-plan pleine saignée. Le HeroBand, le rail droit et le BottomDock sont des dalles translucides flottant au-dessus du radar.

```
┌─────────────────────────────────────────────┬───────────┐
│ HeroBand (bande flottante, max 1600 px)     │           │
│ ┌─────────────────────────────┬───────────┐ │           │
│ │ Carte héros (pyramide P2)   │ Carte     │ │  Rail     │
│ │  lieu (micro) · temp 72 px  │ horloge   │ │  droit    │
│ │  + condition + ressenti     │  date     │ │           │
│ │  méta-ligne soleil/lune     │  heure    │ │ - Alertes │
│ └─────────────────────────────┴───────────┘ │ - Air     │
│ [+][-] [focus]  (sous la pile de zoom)      │ - Métriq. │
│  WeatherMap                                 │ - Intér.  │
│  (pleine saignée — radar visible à travers) │ - Graphes │
│                                             │ - Résumé  │
│                                             │   IA      │
├─────────────────────────────────────────────┴───────────┤
│  BottomDock (ControlButtons)                             │
└──────────────────────────────────────────────────────────┘
```

### Cartes du HeroBand (v3.1 Phase 2)

| Carte | Contenu | Tailles de police |
|-------|---------|-------------------|
| **Héros (pyramide P2)** | Palier 1 : rangée lieu en micro-étiquette mono (épingle · trigger popover, souligné pointillé) · Palier 2 : grand chiffre de temp. (Geist Mono 500 tabulaire) + badge unité + icône/description + ligne **RESSENTI** toujours affichée, avec chip d'écart signée (seuil de ±2° sur la chip seulement) · Palier 3 : **méta-ligne soleil/lune** (lever → coucher en SVG, glyphe de lune paramétrique + nom de phase + % — l'unique foyer des popovers soleil/lune, B1·a) | Temp 72 px → 88 px à ≥ 1600 px ; micro 11 px ; méta 12 px |
| **Horloge (grammaire C1, grand écran)** | Reflète les 3 paliers du héros pour aligner palier 1 + hairline à travers le bandeau — Palier 1 : **sourcil jour-semaine** (« JEUDI », micro mono majuscules) · Palier 2 : heure focale HH:MM · AM/PM (12h) · Palier 3 : **hairline + date** (« 11 juin », méta mono). Les chips astro ont migré dans la méta-ligne du héros (B1). Pendant la fenêtre de 14 j avant un solstice/équinoxe, le **compte à rebours C2** rejoint la date derrière la hairline (« 11 juin · Solstice dans 9 j », encre dim, sans accent). **Taper la date** (toute l'année, souligné pointillé) ouvre le popover **« Saisons »** : les 4 prochains solstices/équinoxes (nom, date, jours). | Horloge 44 px → 56 px à ≥ 1600 px ; sourcil 11 px ; date-méta 12 px |

Le band a une limite de `max-width: 1600 px` — aux viewports ultra-larges (2560 px+), il reste riche en contenu plutôt que de s'étendre sur toute la largeur disponible.

### Rail droit

Largeur : `320 px` (défaut) · `360 px` à ≥ 1600 px. Suit la préférence de taille de police de l'utilisateur (`--c-font-scale`).

Composants (de haut en bas) :
1. **AlertBanner** — l'alerte météo sévère gouvernementale (badge NWS / ECCC) ou, en l'absence d'alerte gouvernementale active, l'alerte dérivée du radar (badge RADAR) ; masquée quand ni l'une ni l'autre ne s'applique
2. **AlertDetailInline** — texte de l'alerte développée (masqué lorsque réduit)
3. **AlertMiniCards** — les autres alertes gouvernementales actives en mini-cartes triées par sévérité (tap = la rendre principale) + pastille « Restaurer N alertes masquées » (masqué quand il n'y a rien à montrer)
4. **AirCard** — rangées qualité de l'air : IQA (valeur + étiquette formant un seul terme **souligné en pointillé**, tap sur la rangée → popover détail) + pollen opt-in (pire allergène + étiquette, même soulignement pointillé ; masquée si réglage off ou hors couverture), chacune avec sa pastille de catégorie. Le soulignement pointillé a remplacé l'ancien chevron (refonte des affordances du rail 2026-06-24) — c'est le signal popover de la maison, comme les soulignements nom-de-ville / lune ; toute la rangée reste la surface de tap. En nightRed, les pastilles s'effondrent au rouge — le mot porte le palier.
5. **MetricsGrid** — grille 2×2 stricte : vitesse du vent · rafales · indice UV (qualificatif, cellule tappable + chevron) · humidité — le même 2×2 dans toutes les dispositions depuis la v3.2. La pression de surface (retirée du 2×2 en v3.2) et la visibilité n'apparaissent que dans la grille étendue à six tuiles de ConditionsView (voir *Vues prioritaires (v3.3)* plus haut).
6. **IndoorBlock** — température / humidité / qualité de l'air intérieurs Homebridge (masqué si non configuré)
7. **ChartTabs** — le panneau « Prévisions » (pills de période 24 h / 5 jours ; onglets Temp · Vent · Précip · Heures/Jours), graphiques tracés avec Chart.js via react-chartjs-2 — voir *Adaptations toujours actives* sous LayoutPi
8. **AiSummaryInline** — résumé météo IA Claude ; expansible pour remplir le rail (bouton ↑)

### Focus radar (LayoutDesktop)

Le carré de focus radar sous la pile de zoom (haut-gauche) entre en mode focus : le HeroBand et le rail sont masqués pour que le radar occupe toute la largeur, la barre de chronologie s'étend jusqu'au bord droit et le dock reste. La FloatingMiniBanner apparaît en haut à droite si une alerte rouge/orange est active ; appuyer dessus quitte le mode focus. Il a remplacé le chevron v2 du bord droit (`›` / `‹`) en v3.1.

---

## BottomDock

Se place en bas des trois dispositions : sur toute la largeur du viewport en Mobile et Desktop ; sur LayoutPi, en retrait dans la gouttière de la grille, et masqué en MIN et dans toutes les vues plein rail. Contient les groupes **ControlButtons** et, au bord droit, la puce d'état des services **HealthIndicator** (« Services · OK / Dégradé / Critique / Hors ligne » — le libellé ne s'affiche qu'à ≥ 1280 px, sous ce seuil la pastille colorée reste seule ; un tap ouvre le popover « État des services » qui liste les services en difficulté). Hauteur : 52 px. Icônes : 24 px.

### ControlButtons (de gauche à droite, configuration typique)

Les boutons se répartissent en quatre groupes étiquetés, séparés par des filets : **Carte** (flèche localisation → anneaux radar), **Vues** (IA, prévisions — le groupe n'apparaît que s'il contient un bouton, c.-à-d. sur LayoutPi ou avec le bouton IA de debug), **Affichage** (contraste, auto, lune) et **Système** (refresh → mise à jour).

| Icône | Action | Condition d'affichage |
|-------|--------|-----------------------|
| ↖ Flèche localisation | Recentrer la carte sur la position de départ (`browserGeo`) — l'infobulle disait « position actuelle » jusqu'en 2026-08, ce qui est précisément ce qu'elle ne fait pas | Toujours |
| 🔖 Signet | Ouvrir « Lieux » — ligne d'accueil `⌂` (la position de départ, non stockée et hors du plafond ; masquée si un favori occupe déjà ces coordonnées) puis la liste des villes favorites (max. 6, ou 7 si l'un d'eux est la position par défaut — le budget est de 7 rangées et un accueil épinglé occupe la place de la pseudo-rangée ; l'accueil toujours en tête) : appuyer sur une entrée y déplace la carte sans toucher au zoom ; le mode Modifier permet de définir le lieu par défaut (⌂), de renommer (champ texte affichant son contrat Entrée/Échap sous l'input, où Échap annule le renommage sans fermer le panneau — offert sur tout client local, le navigateur ne pouvant savoir si un clavier est branché ; sans clavier le champ reste simplement vide et le quitter n'écrit rien), de retirer (double appui) et, sur la ligne d'accueil, d'épingler (★) la position de départ pour en faire un favori stocké — donc renommable — ou de revenir (↺) à la géolocalisation par IP en abandonnant l'override manuel (affiché seulement quand un override est enregistré ; si l'accueil est un favori stocké, le ↺ figure sur cette ligne badgée ⌂ à la place de son action ⌂, qui n'y ferait rien) | Toujours |
| 📍 / 📍off | Afficher/masquer le marqueur de position | Toujours |
| 〜 Chronologie | Afficher/masquer le curseur de chronologie radar | Source RainViewer uniquement |
| ↗ Flèches direction | Afficher/masquer les flèches de direction des précipitations | Toujours (grisé, avec un toast d'indication, tant que l'analyse radar est désactivée) |
| ☰ Légende | Afficher/masquer la légende des couleurs radar | Source RainViewer uniquement |
| ⚠ Alertes à proximité | Afficher/masquer les polygones des alertes gouvernementales à proximité sur la carte ; une fois actif, et s'il y a des alertes dans le rayon, une pastille de compte à la couleur du pire tier | Toujours |
| ◌ Anneaux radar | Activer/désactiver les anneaux d'analyse radar (`radarAnalysisEnabled`) | Localhost + `DEBUG=true` uniquement |
| ✦ IA (étincelle) | LayoutPi : ouvrir la vue IA plein rail (AiView) · Mobile / Desktop : afficher/masquer le résumé IA en ligne | LayoutPi : sauf si le serveur a répondu qu'aucune clé Anthropic n'est configurée (HTTP 503) · Mobile / Desktop : idem, plus Localhost + `DEBUG=true` |
| 📊 Prévisions | Ouvrir les prévisions agrandies (MAX) | LayoutPi uniquement |
| ◑ Contraste | Basculer mode sombre / clair | Toujours |
| ⏰ Auto | Mode auto sombre/clair selon lever/coucher | Toujours |
| 🌙 Lune (rouge) | Activer/désactiver la palette nightRed | Toujours |
| 🔄 Refresh | Recharger l'application (`window.location.reload()`) | Toujours — utile en PWA standalone sans barre d'adresse |
| ⚙ Paramètres | Ouvrir le panneau Paramètres | Toujours |
| 🐛 Debug | Ouvrir le panneau Debug | Localhost + `DEBUG=true` uniquement |
| ⬆ Mise à jour | Ouvrir la fenêtre de mise à jour | Quand une nouvelle version est disponible — en localhost, ouvre la fenêtre ; un client distant obtient un bouton désactivé dont le tap affiche un toast d'avis |

En portrait à ≤ 600 px de large (téléphones), le dock masque les boutons marqués secondaires — chronologie, flèches direction, légende, alertes à proximité, auto et lune — pour que l'essentiel reste tappable ; la chronologie et la légende reviennent quand la carte radar mobile est maximisée. Tant que cette carte est en mode mini, la chronologie, la légende et les alertes à proximité sont grisées et un tap affiche plutôt un toast d'indication.

L'apparence des boutons s'adapte à la palette Direction C via des propriétés CSS personnalisées : arrière-plans transparents (la surface du dock transparaît), séparateurs `--c-border-hybrid`, aucun flash à l'appui (`--ctrl-btn-active: transparent`) ; `--c-accent-soft` ne marque qu'une bascule active (`.buttonDown`).

---

## Contrôles de la carte radar (v3.1 Phase 3)

Tous les contrôles flottants sur la carte Leaflet suivent la référence Claude Design Phase 3 v2.1 (constats d'audit F7 · F8 · F20).

- **Zoom +/−** — haut-gauche, 40 × 40 px (36 px sur mobile), surface teintée par la palette, retour `:active` accent uniquement (aucun survol sur les surfaces kiosque). Infobulles localisées.
- **Focus radar (plein écran)** — bouton autonome 40 × 40 px sous la pile de zoom (top 110 px ; 100 px sur LayoutPi). Paire SVG à quatre équerres (vers l'extérieur = focus, vers l'intérieur = restaurer — la même paire que le toggle de maximisation de la carte mobile). Masque le HeroBand + le rail ; chaque bascule est confirmée par un bref toast. État actif = accent plein.
- **Barre de timeline** — barre pleine largeur en bas (inset droit conscient du rail). En-tête : lecture/pause · pas ±1 · vitesse (1×/2×/4×) · horodatage + chip « now-tag » (jamais un décalage relatif nu ; les trames de prévision basculent vers un chip pointillé « Prévision · +N min ») · sous-ligne des comptes de trames · pilule retour-au-présent conditionnelle · chip source (« RainViewer · 10 min », cadence dérivée de l'espacement réel des trames ; teinte d'avertissement si le dernier rafraîchissement de la liste a échoué). Piste : remplissage passé, marqueur « Maintenant » étiqueté à la frontière passé→prévision, zone future hachurée **scrubbable**, et étiquettes de graduation dérivées au runtime (−2 h … +30 min). La surface de scrub reste l'input range natif (invisible, pleine largeur) — la gestion pointer-capture éprouvée sur le terrain et l'accessibilité clavier sont conservées.
- **Légende** — carte bas-gauche à trois sections au plus : *Rayons d'analyse* (seulement si l'analyse radar est active ; sensible à l'unité ; cercle extérieur seulement si le rayon étendu est actif), *Précipitations* (toujours ; la vraie barre à six segments du scheme 6 RainViewer — identique dans les quatre palettes, nuit-rouge incluse), *Alertes à proximité* (seulement si la couche des alertes à proximité est active ; clé des tiers + compte honnête dans le rayon). Sur écrans courts (≤ 520 px de haut), elle se replie en chip « (i) Légende » partout où la carte radar manque de place : barre de timeline affichée, et demi-carte MID de LayoutPi (le coup d'œil du 7", où la carte de légende — ~190 px de haut avec la section alertes, ~215 px en taille de police L — couvrirait la moitié de la hauteur de la carte radar et une partie des anneaux d'analyse). Le radar plein écran MIN sans curseur garde la carte de légende. Le chip suit la timeline réellement affichée, jamais la préférence persistée `radarTimelineVisible`, qui ne pilote pas le curseur MIN de la v3.3. Le chip — et le (i) de la bande mobile — ouvrent la légende complète en surimpression (scrim + ✕ + Échap). Sur la disposition mobile, la carte est remplacée par une bande compacte pleine largeur près du bord inférieur.
- **Chips de rayon sur la carte** — étiquettes « 50 km » / « 100 km » à l'intersection sud-est des cercles (sensibles à l'unité ; masquées sur mobile et au-delà du zoom 13, même porte que les cercles).
- **Attribution** — au ras du bas-droite, collée au bord du dock dans tous les états (obligation légale — visible partout, y compris la mini-carte mobile) ; amincie pour tenir dans le couloir de 16 px sous la barre de timeline / la bande de légende.
- Les nouveaux tokens CSS du radar (`--rc-*`, `--map-*`) vivent dans `WeatherMap/styles.css`, commutés par palette via `data-palette` (délibérément pas ajoutés à `ui/tokens.js`). En nuit-rouge, les tokens des tiers d'alertes s'effondrent vers la famille rouge tandis que l'échelle de précipitations garde les vraies couleurs des tuiles.

---

## Superpositions

SettingsPanel et DebugPanel s'affichent en `position: fixed; inset: 0; z-index 5000` et reprennent la palette Direction C active via des variables CSS en ligne (ils sont rendus en dehors de `AmbientLayers`). UpdateModal est un panneau de 300 px qui glisse depuis le bas à droite (z-index 4999), avec ses propres classes de thème sombre / clair / nightRed.

| Superposition | Déclencheur | Accès distant |
|---------------|-------------|---------------|
| **SettingsPanel** | Bouton ⚙ Paramètres | Sections 2–3 — API et Avancé, c.-à-d. les écritures serveur — bloquées depuis les clients distants ; vue en lecture seule affichée. La section 1 (Préférences locales, `localStorage`) reste modifiable à distance. |
| **DebugPanel** | Bouton 🐛 Debug | Localhost + `DEBUG=true` uniquement |
| **UpdateModal** | Bouton ⬆ Mise à jour | Localhost uniquement (`/api/update` est `localhostOnly`) |

---

## Modes de palette

La palette Direction C est choisie par `useTimeOfDay()` à partir de deux bascules, pas de l'heure : `day` quand le mode sombre est désactivé, `dusk` quand il est activé, et `nightRed` quand le mode sombre et la préférence nuit-rouge (bouton 🌙 du dock / `advanced.sleep.nightMode`) sont tous deux actifs. La palette `night` est définie dans `ui/tokens.js`, mais rien ne la sélectionne encore — les transitions jour → crépuscule → nuit selon la position du soleil sont prévues dans [`ROADMAP.md`](../ROADMAP.md) (*Solar-driven palette transitions*). La seule bascule liée à l'heure est aujourd'hui le bouton ⏰ Auto, qui inverse le mode sombre au lever / coucher du soleil (day ↔ dusk).

| Mode | Sélectionné quand | Couleurs clés |
|------|-------------------|---------------|
| **day** | Mode sombre désactivé | Fond crème chaud `#f4f0e8`, texte sombre, accent ambré |
| **dusk** | Mode sombre activé (manuellement, ou par ⏰ Auto entre le coucher et le lever du soleil) | Fond gris chaud profond `#1c1a17`, accent ambré |
| **night** | Définie, mais sélectionnée par aucun chemin du code pour l'instant | Fond presque noir `#0e0c0a`, accent cuivré |
| **nightRed** | Mode sombre + bascule nuit-rouge actifs (vision nocturne / mode sommeil) | Fond rouge très sombre `#100404`, texte et accent en tons rouges |

`nightRed` utilise `text: #d05050` (contraste ~5:1) et `textDim: #b84848` (contraste ~4:1) sur la surface de carte sombre — lisible aussi bien pour le texte gras que non gras.

---

## Installation PWA (iOS / Android)

L'application peut être installée sur l'écran d'accueil d'un téléphone via la fonction « Ajouter à l'écran d'accueil » du navigateur. Une fois installée, elle se lance en mode standalone (sans la chrome du navigateur) et hérite de l'icône `apple-touch-icon.png` (PNG opaque 180×180) et du `manifest.json` (icônes 192 + 512).

### Certificat TLS (autorité racine locale)

Au premier démarrage, le serveur crée sa propre autorité racine (`ca-cert.pem`, CN : `Pi Weather Station CA - <hostname>`) et un certificat serveur signé par elle (`cert.pem`, CN : `Pi Weather Station - <hostname>`, SAN incluant `localhost`, `127.0.0.1`, chaque IPv4 LAN, le hostname et sa variante `.local`) ; le certificat serveur est régénéré automatiquement à l'approche de son expiration ou quand il ne couvre plus le hostname / les IP actuels. Pour qu'iOS l'accepte en mode PWA, installer l'autorité racine :

1. Télécharger le `.pem` depuis Paramètres → « Faire confiance à ce Pi sur cet appareil » (endpoint `/api/cert.pem`, qui sert l'autorité racine `ca-cert.pem` en `application/x-x509-ca-cert`).
2. Installer le profil iOS (Réglages → Profil téléchargé).
3. Activer la confiance complète : Réglages → Général → Information → Réglages de confiance des certificats.

Procédure détaillée par plateforme : [`docs/pwa-trust-cert_fr.md`](pwa-trust-cert_fr.md).

### Rafraîchir une PWA installée

En mode standalone, la barre d'adresse Safari est masquée — pas de bouton recharger natif. Deux mécanismes :

- **Bouton 🔄 Refresh du dock** (universel — toutes dispositions).
- **Pull-to-refresh** sur LayoutMobile (geste tactile depuis le haut du conteneur défilant — voir section LayoutMobile).
