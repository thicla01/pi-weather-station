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

- **MID** (défaut) — le split ci-dessous (sur le 7", la carte remplit l'écran et le rail flotte au-dessus : voir *Le 7" : la coque superposée*) : carte radar à gauche, rail *compagnon du radar* allégé à droite (alertes · horloge slim · hero ancré sur le ressenti · NowcastLine · qualité de l'air · un 2×2 Vent / Rafales / UV / Humidité · intérieur). Le graphique de prévisions et le résumé IA ne sont pas dans ce coup d'œil — les deux s'atteignent depuis le groupe **Vues** du dock : le bouton prévisions ouvre MAX, et le bouton IA (étincelle) ouvre la vue IA plein rail, quittée par son bouton retour. L'ouverture de la vue IA fonctionne sur tous les écrans Pi, y compris les 10,1" plus hauts (CSS 1024×640, hors du gate des vues prioritaires v3.3) ; jusqu'en 2026-10 elle n'existait que dans le modèle prioritaire v3.3, ce qui privait ces écrans de tout accès au résumé IA.
- **MIN** — radar plein écran (l'ancien mode focus) : le rail se replie et le dock se masque pour que le radar remplisse vraiment l'écran. Sur le 7", ils glissent hors de l'écran par-dessus la carte (voir *Le 7" : la coque superposée*). Rien d'autre ne recouvre la carte — la seule superposition est la **FloatingMiniBanner**, épinglée en haut à droite quand une alerte gouvernementale admissible est active, pour que le mode focus ne masque jamais une alerte sévère. *(Le `HeroOverlayMin` compact lieu / température que la v3.2 épinglait d'abord sur le radar a été retiré et le composant supprimé ; le coup d'œil lieu / température est à un tap dans le rail.)*
- **MAX** — prévisions prioritaires : sur le rail empilé, la carte se réduit en vignette gelée ~190 px et le graphique de prévisions prend tout le rail ; sur le 7", le graphique s'ouvre dans la feuille de vue de la coque superposée, à côté d'une bande de carte de 210 px ; le dock se masque dans les deux cas (comme en MIN). Atteint par le **bouton prévisions** du dock (groupe Vues) ; quitté par le bouton restaurer du graphique. *(Refonte des affordances du rail 2026-06-24 : la NowcastLine ne maximise plus — c'est une ligne d'état radar seulement ; les prévisions sont passées au dock pour que l'état radar « maintenant » et les prévisions « futur » soient des affordances distinctes.)*

**Deux rails MID.** MIN, MAX et la vue IA sont communs, mais LayoutPi a deux rails MID, choisis selon la hauteur du viewport CSS : au-dessus de 540 px, le rail empilé v3.2 détaillé ci-dessous ; à 540 px ou moins — le 7" officiel 800×480 — le coup d'œil des vues prioritaires v3.3, dont les points d'entrée ouvrent deux vues plein rail de plus, Alerte et Conditions (voir *Vues prioritaires (v3.3)* plus bas). Les deux diffèrent aussi par la coque : le rail empilé garde la grille (une colonne de carte qui se redimensionne et une colonne de rail) ; le coup d'œil prioritaire tourne dans la coque superposée, où la carte remplit l'écran et où le rail, le dock et les vues flottent au-dessus.

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

Sur un viewport limité en hauteur, le rail empilé ci-dessus ne tient pas — sur le 7" en taille de texte G, il repoussait le 2×2 des métriques hors de la zone visible — alors LayoutPi passe au **modèle des vues prioritaires v3.3** : MID devient un *coup d'œil* compact dont chaque point d'entrée ouvre une **vue plein rail**, le mécanisme de MAX généralisé (sur le 7", la feuille de vue de la coque superposée : voir plus bas). Livré dans la PR 257 (squash `622965a`, 2026-06-20) derrière un indicateur opt-in et activé automatiquement sur l'écran court par la PR 258 (`aeda96e`) ; la PR 285 (`fbf11b8`) a basé la condition d'activation sur la hauteur du viewport CSS.

#### Activation

`priorityViewsEnabled()` dans `client/src/ui/piLayout.js` choisit le rail MID qu'affiche LayoutPi (LayoutPi lui-même reste choisi selon la largeur, 800–1279 px) :

- **Automatique** — `matchMedia("(max-height: 540px)")`, la hauteur du *viewport* CSS (pas `window.screen.height`). Actif sur le 7" officiel 800×480 et sur tout écran que l'échelle d'affichage du kiosque ramène à la même hauteur (p. ex. un écran 7" 1024×600 mis automatiquement à l'échelle 1,25 → 819×480 px CSS). Les viewports LayoutPi plus spacieux — p. ex. les écrans 10,1" à 1024×640 px CSS — gardent le rail empilé v3.2.
- **Stable d'une taille de texte à l'autre** — la préférence P / M / G est un `zoom` limité au défileur du rail (`.rail`, ou `.railScroll` dans le `.railFrame` non zoomé sur le 7", où la `.sheetInner` de la feuille de vue le prend aussi) et ne change jamais le viewport ; le modèle ne peut donc pas basculer d'une taille de texte à l'autre sur un même écran.
- **Forçage manuel** — `localStorage.forcePriorityViews = "on"` force le modèle sur un viewport plus haut (développement / test en fenêtre). L'une ou l'autre condition suffit à l'activer. La clé est lue une fois par chargement de la page, et de nouveau quand un autre onglet la change : dans le même onglet, recharger après l'avoir posée.
- Contrairement au choix de disposition, la condition ne provoque aucun rendu quand elle change. Elle est lue depuis une `MediaQueryList` en cache dont l'écouteur `change` tient la valeur à jour (`ui/cachedFlags.js`), mais dans le bundle compilé LayoutPi la lit une fois par montage (le React Compiler mémoïse l'appel sans argument `priorityViewsEnabled()`), la carte d'alerte aussi une fois par montage de LayoutPi, tandis que le dock et la carte radar la relisent à chaque changement de `piLayoutState`. Un viewport qui franchit 540 px ne prend donc pleinement effet qu'au prochain montage de LayoutPi (changement de disposition ou rechargement) ; d'ici là, la carte radar, la garde des boutons de vues et le bouton de chronologie du dock suivent la nouvelle valeur dès le prochain changement de `piLayoutState`. Un viewport de kiosque est fixe de toute façon (un changement d'échelle d'affichage relance le kiosque).
- **Même seuil, même coque** — le seuil choisit aussi la coque superposée (*Le 7" : la coque superposée* plus bas), qui n'a pas de clé localStorage à elle. Elle couvre donc tout viewport LayoutPi de 540 px de haut ou moins, y compris un téléphone distant tenu à l'horizontale dont le viewport CSS atteint 800 px de large (non testé). Avec `forcePriorityViews` sur une fenêtre LayoutPi plus haute (800 à 1279 px de large), la coque prend la même géométrie ancrée aux bords du viewport, dessinée pour 800 × 480 et non testée plus haut. Un franchissement de 540 px sous une LayoutPi montée peut laisser le décalage de la carte, la garde des boutons de vues et le bouton de chronologie du dock, et la coque en désaccord jusqu'à ce prochain montage (ROADMAP.md, Technical debt).

#### Le coup d'œil (MID)

Le coup d'œil du 7" est dessiné sous *Le 7" : la coque superposée* plus bas.

- **Carte d'alerte** — la carte gouvernementale compacte est un seul bouton sur deux lignes : chip de sévérité · badge de source · un ⤢ décoratif, puis le titre sur sa propre ligne à côté d'un indicateur `1 / N` passif. Un appui n'importe où sur la carte ouvre **AlertView** sur l'alerte affichée (une autre se choisit dans la rangée *Aussi actives* de la vue) ; l'expansion en ligne `AlertDetailInline` disparaît. Son nom accessible donne le niveau, la source, le titre et « 1 sur N » (omis avec une seule alerte). Le bouton de retour d'AlertView tombe sous le doigt : l'appui arme donc la garde contre le double appui. Pendant 300 ms après son clic, un second appui dans une boîte de 60 × 58 px centrée sur lui est ignoré, de même qu'un second geste qui tombe sur le bouton de retour, où qu'ait été le premier appui (`ui/tapGuard.js` ; voir *Le 7" : la coque superposée* plus bas). En français, le titre commence par le phénomène : le préfixe de type des noms d'ECCC, que le chip affiche déjà, est retiré (« Pluie verglaçante » à côté de « AVERT. », et non « Avertissement de pluie verglaçante »). En anglais et en espagnol, qui affichent tous deux le titre anglais, c'est le mot de type final qui est retiré (« Heavy Freezing Spray » à côté de « WARNING » ou « ADVERT. », et non « Heavy Freezing Spray Warning »), pour les avertissements, les veilles et les avis ; un bulletin garde son mot (« Special Weather Statement »), de même que les quelques dangers trop génériques pour tenir seuls (« Weather warning », « Special Marine Warning », « Hydrologic Advisory »). L'en-tête d'AlertView, la carte d'alerte du rail empilé et de LayoutDesktop / LayoutMobile, les mini-cartes, la fenêtre d'un polygone sur la carte et la FloatingMiniBanner sur le radar plein écran font de même à côté de leur chip.
- **HeroCompact** — lieu · température · condition. La ligne du ressenti passe dans ConditionsView (la ligne soleil/lune est déjà masquée sur le rail Pi) ; le ⤢ en coin ouvre **ConditionsView** sans ajouter de hauteur à la carte.
- **MetricsGrid et IndoorBlock** quittent le coup d'œil — tous deux passent dans ConditionsView.
- **Inchangés par rapport au rail empilé** — la pastille « restaurer » (AlertMiniCards), la AirAlertCard, le TimeBlock slim, la NowcastLine (ligne d'état seulement) et l'AirCard (sa rangée IQA cède toujours la place à la AirAlertCard). Comme sur le rail empilé, le graphique de prévisions et le résumé IA ne sont pas dans le coup d'œil : les deux s'ouvrent en vues plein rail depuis le dock.

#### Vues plein rail

La v3.3 a étendu l'enum `piLayoutState` avec `'alert'`, `'conditions'` et `'ai'` ; avec `'max'`, ils forment `MAX_VIEWS` dans `client/src/ui/piLayout.js` (vérifié par `isPiMaxView()`). Seul le modèle prioritaire produit `'alert'` et `'conditions'` ; `'ai'` et `'max'` s'ouvrent depuis le dock sur toute LayoutPi, rail empilé compris. Sur le rail empilé, toutes les vues plein rail partagent le cadre de MAX : la carte se réduit en vignette gelée ~190 px (zoom, carré focus et légende masqués, animation radar en pause), le coup d'œil et le dock se masquent, et la vue prend tout le rail. Le carré de réduction de chaque vue (équerres vers l'intérieur, en haut à droite) ramène à `'mid'` — le dock étant masqué, c'est le chemin du retour. Sur le 7", les vues s'ouvrent plutôt dans la feuille de la coque superposée (voir plus bas).

| État | Vue | Ouverte depuis | Rail |
|------|-----|----------------|------|
| `'alert'` | **AlertView** | la carte d'alerte (un seul bouton) | prioritaire seulement |
| `'conditions'` | **ConditionsView** | le ⤢ du HeroCompact | prioritaire seulement |
| `'ai'` | **AiView** | le bouton IA (étincelle) du dock — groupe Vues | les deux |
| `'max'` | **ChartTabs**, agrandi (prévisions) | le bouton prévisions du dock — groupe Vues | les deux |

- **AlertView** — un en-tête fixe porte le traitement de sévérité (une alerte `extreme` reçoit une bande rouge pleine, texte en blanc ; toute autre sévérité, le chip de sévérité teinté), le badge de source, le titre et le carré de réduction, plus une ligne de validité (p. ex. « Jusqu'à 19 h 30 · NWS Mobile AL ») quand l'alerte a une expiration. En dessous, un sélecteur **Aussi actives** liste les autres alertes admissibles en chips à pastille de sévérité — toucher un chip en fait l'alerte affichée (la rangée défile horizontalement). Seul le corps structuré défile : les sections extraites (*Zones affectées* · *Ce qui se passe* · *Ce qui a été observé* · *Source des données* · *Impacts possibles*…), avec le même rendu de sections que `AlertDetailInline` ; *Mesures à prendre* n'apparaît que si le bulletin de l'autorité contient un bloc d'actions — le kiosque ne rédige jamais ses propres consignes de sécurité. Le corps se termine par le code QR vers le bulletin source (règle kiosque : QR seulement) et **Masquer** (cache l'alerte 4 h ; elle réapparaît si elle s'aggrave), qui ramène au coup d'œil. Si l'alerte expire ou quitte l'ensemble admissible pendant la lecture, la vue revient d'elle-même au coup d'œil.
- **ConditionsView** — de haut en bas : la ligne du ressenti ; le **MetricsGrid** étendu à six tuiles sur trois colonnes, soit deux rangées thématiques — Vent · Rafales · UV, puis Humidité · Pression · Visibilité (pression selon la préférence d'unités, visibilité selon l'unité de distance ; la tuile UV garde son popover détail) ; l'**IndoorBlock** (si configuré) ; et un almanach **Soleil / Lune** — lever · coucher · durée du jour, phase de lune + illumination · lever · coucher de la lune — dont les en-têtes soulignés en pointillé ouvrent les mêmes popovers soleil/lune que le héros grand écran (LayoutPi masque la ligne astro du héros ; sur le 7", c'est donc le seul accès à ces popovers).
- **AiView** — le résumé de Claude en au plus trois sections titrées par leur vraie période : *Maintenant*, puis *Ce soir* / *Cette nuit* / *Demain* (sinon *Prochaine période*), puis *Analyse radar*, avec les états « Génération du résumé… » et « Résumé IA indisponible. ». Elle ne demande le résumé que lorsqu'elle est ouverte — sur le rail empilé, elle est montée à la demande, seulement dans l'état `'ai'` ; sur le 7", elle reste montée dans la feuille, inactive tant qu'elle est fermée, et affiche le message de chargement à chaque ouverture — pour que l'appel Anthropic payant parte à l'ouverture de la vue, jamais en arrière-plan. Le bouton étincelle l'ouvre depuis le dock de toute LayoutPi, rail empilé compris (voir MID plus haut) ; il s'affiche seulement si une clé Anthropic est configurée, et n'est pas réservé au mode debug. Le client le sait dès sa lecture `GET /settings` au démarrage : un `anthropicApiKey` absent, vide ou laissé à la valeur d'exemple `"key"` masque le bouton d'emblée — aussi sur un client distant, dont les paramètres masqués signalent la valeur d'exemple comme non configurée. Le 503 « pas de clé » de `/api/weather-summary` sert de repli (p. ex. un `settings.json` modifié après le démarrage) ; tout autre échec, le 502 « pas de données météo » compris, garde le bouton et la vue réessaie au prochain rafraîchissement.
- **Prévisions (`'max'`)** — ChartTabs agrandi : sur le rail empilé, le MAX v3.2 décrit plus haut ; sur le 7", dans la feuille de vue. Son bouton restaurer ramène à `'mid'`. Comme AiView, elle existe aussi sur le rail empilé.

Sur le rail empilé, l'hôte prévisions reste monté pendant qu'il est masqué (`display: none`), ce qui préserve son état lors d'un aller-retour (p. ex. ses onglets de période et de métrique) ; l'hôte IA n'est monté que lorsque la vue est ouverte, et il n'y a ni hôte conditions ni hôte alerte. Sur le 7", les quatre hôtes, celui de l'IA compris, restent montés dans la feuille (voir plus bas).

#### Curseur radar → MIN

Dans le modèle prioritaire, la chronologie radar ne s'affiche jamais sur la carte du coup d'œil — le curseur est un outil du radar plein écran :

- Le bouton chronologie du dock (groupe Carte) active l'indicateur éphémère `piScrubberOpen` (AppContext, en mémoire seulement) et passe en MIN ; son toast « Chronologie radar affichée » part avec le dock quand la disposition quitte MID : il ne s'affiche pas. Il ne touche jamais la préférence persistée `radarTimelineVisible` qu'utilisent le rail empilé, LayoutDesktop et LayoutMobile.
- Le curseur n'est actif que si l'état est MIN **et** que l'indicateur est actif (sur le 7", il reste monté, caché et inerte sinon, tant que la source RainViewer a des images).
- LayoutPi efface l'indicateur dès que l'état quitte MIN, par n'importe quel chemin (carré focus, FloatingMiniBanner) : la prochaine entrée en MIN par le carré focus donne un radar épuré, et le curseur ne revient que par le bouton du dock. Le dock étant masqué en MIN, fermer le curseur revient à quitter MIN.
- Sur le 7" (la coque superposée, à toute hauteur), la légende radar ignore elle aussi la préférence : chip « (i) Légende » dans le coup d'œil et au-dessus du curseur ouvert, carte complète seulement sur un radar MIN sans curseur (voir *Légende* sous *Contrôles de la carte radar*).

#### Le 7" : la coque superposée (PR 455)

Sous les vues prioritaires, LayoutPi ne partage plus l'écran entre une colonne de carte et une colonne de rail. La carte remplit le viewport (800 × 480 sur le 7" officiel) dans tous les états et n'est jamais redimensionnée. Le rail, le dock et les vues flottent au-dessus et ne bougent que par `transform` et `opacity`. La géométrie et les règles de temps sont dans `client/src/ui/piShellGeometry.js` (épinglé par `test/piShellGeometry.test.js`), et le minutage des bascules dans `LayoutPi/useShellTiming.js`. Le rail s'ancre au bord droit du viewport et la feuille de vue va de x 210 à ce bord : les chiffres ci-dessous de la position du rail, de la zone libre et de la translation des volets pendant une vue valent pour 800 × 480 et changent sur un viewport plus large (p. ex. un 819 × 480 mis à l'échelle) ; le bord gauche de la feuille et la bande de 210 px, non. Le rail empilé (viewports plus hauts) garde la grille décrite plus haut.

```
┌──────────────────────────────────────────┬───────────────────────┐
│ [+][−] zoom                              │ cadre du rail, 300 px,│
│ [carré focus] -> MIN                     │ à 10 px des bords     │
│                                          │ haut et droit         │
│ WeatherMap — remplit le viewport dans    │ carte d'alerte (un    │
│ tous les états, jamais redimensionnée ;  │ bouton) -> alerte     │
│ le rail et le dock flottent dessus.      │ AlertMiniCards        │
│ Marqueur à (245, 211) en 800 × 480 :     │ AirAlertCard          │
│ centre des 490 × 422 laissés libres.     │ TimeBlock compact     │
│                                          │ HeroCompact [⤢]       │
│                                          │ -> conditions         │
│                                          │ NowcastLine           │
│ (i) puce légende                         │ AirCard               │
│                             attribution  └───────────────────────┤
├──────────────────────────────────────────────────────────────────┤
│ BottomDock — bande opaque de 58 px, boutons de 44 px ;           │
│ Vues : IA, prévisions ; Carte : chronologie -> MIN +             │
│ curseur ; menu « ··· »                                           │
└──────────────────────────────────────────────────────────────────┘
```

- **MID (le coup d'œil)** — Le rail est un cadre de 300 px à 10 px des bords haut et droit (en 800 × 480 : x 490–790, y 10 à 412 au plus). Ses cartes sont mises à l'échelle de la taille de texte à l'intérieur, espacées de 10 px, sur la surface translucide des cartes, sans flou (85 % ; 96 % en nuit-rouge, sous Firefox et en mode hybride d'alerte). Le dock est une bande opaque de 58 px, en bas, sur toute la largeur. La zone de carte qu'ils laissent libre mesure 490 × 422, et le marqueur de position est à son centre, (245, 211). Le rail porte le coup d'œil décrit plus haut. L'icône de condition du HeroCompact passe sur la ligne de son libellé, et son ⤢ garde une cible de 44 px à toutes les tailles de texte. Le cadre du rail et le dock vivant portent une région `touch-action: manipulation` : un toucher sur eux n'attend pas derrière les écouteurs de la carte.
- **MIN** — Le rail glisse vers la droite (310 px) et le dock vers le bas (58 px), en s'estompant, en 250 ms ; la carte ramène le marqueur au centre de l'écran, et l'attribution suit. La puce de légende s'efface au départ de la glissade. La carte de légende, ou le curseur avec la puce relevée, et la FloatingMiniBanner apparaissent de 150 à 300 ms. Le rail reste mis en page, caché et inerte. Le dock quitte le rendu une fois sa glissade finie, derrière une garde `@supports (transition-behavior: allow-discrete)` ; là où ce test échoue, il reste mis en page, caché et inerte comme le rail. Le retour en MID est le miroir : rail et dock partent de l'image même de l'appui.
- **Vues** (alerte, conditions, IA, prévisions) — Une feuille opaque, de x 210 au bord droit, glisse depuis la droite à partir de l'image du clic. Le rail reste peint dessous, inerte, et le dock descend comme en MIN, mais reste mis en page, caché et inerte. Zoom, carré focus, légende et chronologie restent montés, cachés et inertes. La carte ne bouge pas pendant la glissade. Une fois la feuille posée, en une image, les volets de la carte sont translatés de (−140, 0) pour placer le marqueur au centre de la bande de 210 px laissée à gauche, (105, 211) ; l'animation radar s'arrête et l'attribution passe sur deux lignes. Cette bande ne prend aucun geste. La fermeture tient en une image : la feuille disparaît, les volets reviennent, le radar repart et les commandes de la carte reviennent ; le dock remonte en 250 ms. Les quatre hôtes de vue restent montés dans la feuille, celui de l'IA compris : la vue ne demande le résumé que lorsqu'elle est ouverte, dès l'appui, affiche le message de chargement à chaque ouverture et n'affiche sa réponse qu'une fois la feuille posée. Les hôtes des autres états sont sautés par `content-visibility: hidden`. Au repos, une fois la page et ses polices chargées, chaque hôte caché qui a un contenu est mis en page et peint une fois, hors de vue, dans une image libre, pour que la première ouverture d'une vue ne le paie pas. Pendant qu'une alerte gouvernementale est affichée, le style de la bascule de la vue d'alerte est en plus calculé une fois d'avance, en une tâche au repos en MID : une fois par chargement de la page avec une alerte affichée, puis de nouveau quand une alerte paraît après aucune ; jamais par temps calme.
- **Boucliers** — Pendant une vue, un bouclier transparent sous la feuille prend tout appui sur la carte et le rail, jusqu'au retour du dock après la fermeture. Pendant une bascule MIN ↔ MID, un bouclier sur la bande du dock prend les appuis que le dock en mouvement ne prend pas, sauf sur un curseur qui arrive, qui prend les siens. À l'endroit où le clic de la bascule est tombé sur le dock, une garde de la hauteur de la bande reste le temps de la glissade. Tous deux annulent les touchers qu'ils prennent : aucun clic ne passe quand ils se lèvent.
- **Garde contre le double appui** — Six commandes de cette disposition arment `ui/tapGuard.js` : la carte d'alerte, le ⤢ du HeroCompact, les boutons IA, prévisions et chronologie du dock, et la FloatingMiniBanner (rien ne l'arme dans les autres dispositions, sauf les boutons de vues du dock sur le rail empilé après un franchissement de 540 px sous une LayoutPi montée : voir *Activation* ci-dessus). Pendant 300 ms après le clic du premier appui, un second appui dans une boîte de 60 × 58 px centrée sur lui est avalé en entier. Un second geste commencé dans cette fenêtre et dont le clic tombe sur le bouton de retour d'une vue est avalé, où qu'ait été le premier appui. Les écouteurs de la garde se retirent au premier toucher daté après la fenêtre, ou 3 s après l'armement si aucun ne vient ; d'ici là, tout toucher part bloquant. La feuille porte `touch-action: manipulation` : une fois ces écouteurs partis, un toucher sur son bouton de retour ou son corps n'est plus bloquant. Ses limites sont dans ROADMAP.md (Technical debt).
- **Teinte d'appui** — Les déclencheurs de vue du rail, les boutons de vue du dock et les boutons de retour des vues prennent une teinte de fond pendant l'appui (aucun repeint `:active`, aucune mise à l'échelle).
- **Dock** — Les boutons font 44 px (40 dans les autres dispositions). Quatre boutons quittent la rangée pour un menu « ··· » après le groupe Système : marqueur, légende (source RainViewer seulement), et la paire localhost + `DEBUG`, anneaux radar et panneau de débogage. Les lignes du menu font les mêmes actions. Il s'ouvre au-dessus du dock (opaque, lignes de 44 px) et se ferme sur un appui ailleurs, qui n'atteint rien d'autre, sur un choix, sur Échap ou à tout changement de disposition. Les toasts du dock sont centrés sur la zone de carte libre, 8 px au-dessus de la puce de légende, et abandonnés quand la disposition quitte MID. Le bouton chronologie n'affiche donc aucun toast, et « Emplacement par défaut mis à jour » de Lieux ne s'affiche pas si sa réponse arrive après la sortie du dock.
- **Mouvement réduit** — Aucune transition : toute bascule, MIN ↔ MID comme les vues, tient en une image, et les boucliers restent levés 300 ms après une bascule.
- **Ce qui change par rapport à la grille** — La carte n'est plus redimensionnée : il n'y a plus de morphose de grille, `MapResizer` ne voit aucun changement, et `RailOffsetTracker` recentre selon un décalage par état. La carte n'est plus une carte encadrée. Les vues ne la réduisent plus en vignette gelée de ~190 px. Le dock est une bande pleine largeur de cibles de 44 px avec le menu « ··· ». La carte d'alerte est un seul bouton, et son « 1 / N » n'est plus qu'un indicateur.

#### Références de design

- [`docs/v3.3-priority-views-design.md`](v3.3-priority-views-design.md) — le design figé ; ses notes **As built** consignent les écarts du code (pas de renommage `'forecast'`, la vue IA ajoutée — sur tous les écrans Pi depuis 2026-10 — et l'entrée des prévisions déplacée au dock).
- [`docs/rail-affordance-redesign-design.md`](rail-affordance-redesign-design.md) — le vocabulaire de tap que suit le coup d'œil : le ⤢ approfondit le même sujet, un bouton du dock change de sujet, un soulignement pointillé ouvre un popover ; pourquoi la NowcastLine a perdu son ⤢.

### Adaptations toujours actives (toute hauteur en `LayoutPi`)

- **ChartTabs (v3.1 Phase 5)** — un panneau « Prévisions » : pills de période (`24 h` / `5 jours`) à côté du titre, et quatre onglets de métrique étiquetés (Temp · Vent · Précip · Heures/Jours) remplaçant les anciens points de carrousel (constat F9). Temp = courbe accent + remplissage + étiquettes des points clés ; Vent = vitesse + rafales en pointillé + rangée de flèches de direction ; Précip = barres d'accumulation + ligne de probabilité pointillée ; le dernier onglet est la grille d'icônes heure/jour. Pills de résumé chiffré sous chaque graphique (max/min/pic…, le constat F13 corrige les axes : « 14° », unité une seule fois sur le tick max) plus un chip « Précip » optionnel de superposition sur Temp/Vent. Le bouton agrandir garde sa zone de 44 px et la paire d'équerres partagée avec les contrôles radar ; le choix de métrique par période persiste en localStorage.
- **Bascule focus radar (MIN)** — le carré `RadarFocusControl` sous la pile de zoom Leaflet (haut-gauche de la carte, 40 × 40 px, paire d'équerres partagée avec le bouton agrandir de la carte mobile) replie le rail et masque le dock pour que le radar remplisse l'écran, puis rétablit le split au tap suivant ; sur le rail empilé, `MapResizer` relit la taille de la carte à chaque redimensionnement du conteneur (un `ResizeObserver`), afin que les tuiles et le bouton de recentrage suivent la bascule ; sur le 7", la carte n'est jamais redimensionnée : le rail et le dock glissent hors de l'écran par-dessus elle, et la carte ramène le marqueur au centre de l'écran. Il a remplacé le chevron v2 du bord droit (`›` / `‹`) en v3.1.
- **FloatingMiniBanner** — Lorsque le rail est replié et qu'une alerte météo gouvernementale sévère est active, une bannière compacte se superpose en haut à droite de la carte pour que l'alerte ne soit jamais silencieusement masquée : badge de source · le chip de sévérité abrégé de la carte d'alerte du Pi (« AVERT. », « VEILLE », « AVIS ») · titre · compteur `1 / N` quand plusieurs alertes sont actives · chevron. Le chip affiche le type de produit, donc un titre français d'ECCC commence par le phénomène (« Pluie verglaçante ») et un titre anglais perd son mot de type final (« Heavy Freezing Spray »), comme sur la carte d'alerte. Un titre trop long pour une ligne passe sur une deuxième, et la bannière s'agrandit, au lieu d'être coupé. Une alerte d'essai NWS (affichée seulement par l'interrupteur « Afficher les alertes de test », réservé à localhost) ajoute le badge neutre à contour `TEST` après le badge de source et le préfixe « TEST · » devant le titre, comme sur toutes les surfaces d'alerte gouvernementale : la carte d'alerte, l'en-tête d'AlertView, les mini-cartes et les puces « Aussi actives » (préfixe seul — elles n'ont pas de badge de source) et la fenêtre d'un polygone sur la carte. Appuyer dessus rouvre le rail. Sur le 7", elle reste montée et apparaît de 150 à 300 ms après le départ de la glissade vers MIN ; son appui, qui ramène le rail sous le doigt, y arme la garde contre le double appui (pas dans les autres dispositions).

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

La carte occupe le viewport au-dessus du BottomDock en arrière-plan pleine saignée (`.mapArea` est inséré `0 0 var(--c-dock-height) 0`). Le HeroBand et le rail droit sont des dalles translucides (`--c-surface`, 85 %, sans flou d'arrière-plan) flottant au-dessus du radar ; le BottomDock se trouve sous la carte, jamais par-dessus, et n'a pas de flou non plus.

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
4. **AirCard** — rangées qualité de l'air : IQA (valeur + étiquette formant un seul terme **souligné en pointillé**, tap sur la rangée → popover détail) + pollen opt-in (pire allergène + étiquette, même soulignement pointillé ; masquée si réglage off ou hors couverture), chacune avec sa pastille de catégorie. Le soulignement pointillé a remplacé l'ancien chevron (refonte des affordances du rail 2026-06-24) — c'est le signal popover de la maison, comme les soulignements nom-de-ville / lune ; toute la rangée reste la surface de tap. En nightRed, les pastilles s'effondrent au rouge — le mot porte le palier. L'étiquette de la rangée qualité de l'air est l'indice de la source (CAS — AQHI en anglais —, IQA ou AQI) ; avant la première lecture, ou là où aucune source ne couvre l'endroit, la rangée affiche « — Qualité de l'air », un libellé neutre de même hauteur, pour ne jamais nommer un indice que la source n'emploie peut-être pas.
5. **MetricsGrid** — grille 2×2 stricte : vitesse du vent · rafales · indice UV (qualificatif, cellule tappable + chevron) · humidité — le même 2×2 dans toutes les dispositions depuis la v3.2. La pression de surface (retirée du 2×2 en v3.2) et la visibilité n'apparaissent que dans la grille étendue à six tuiles de ConditionsView (voir *Vues prioritaires (v3.3)* plus haut).
6. **IndoorBlock** — température / humidité / qualité de l'air intérieurs Homebridge (masqué si non configuré)
7. **ChartTabs** — le panneau « Prévisions » (pills de période 24 h / 5 jours ; onglets Temp · Vent · Précip · Heures/Jours), graphiques tracés avec Chart.js via react-chartjs-2 — voir *Adaptations toujours actives* sous LayoutPi
8. **AiSummaryInline** — résumé météo IA Claude ; expansible pour remplir le rail (bouton ↑)

### Focus radar (LayoutDesktop)

Le carré de focus radar sous la pile de zoom (haut-gauche) entre en mode focus : le HeroBand et le rail sont masqués pour que le radar occupe toute la largeur, la barre de chronologie s'étend jusqu'au bord droit et le dock reste. La FloatingMiniBanner apparaît en haut à droite si une alerte rouge/orange est active ; appuyer dessus quitte le mode focus. Il a remplacé le chevron v2 du bord droit (`›` / `‹`) en v3.1.

---

## BottomDock

Se place en bas des trois dispositions : sur toute la largeur du viewport en Mobile et Desktop ; sur le rail empilé de LayoutPi, en retrait dans la gouttière de la grille ; sur le 7", une bande opaque pleine largeur de boutons de 44 px sur le bas de la carte (voir *Le 7" : la coque superposée*) ; sur LayoutPi, masqué en MIN et dans toutes les vues plein rail. Contient les groupes **ControlButtons** et, au bord droit, la puce d'état des services **HealthIndicator** (« Services · OK / Dégradé / Critique / Hors ligne » — le libellé ne s'affiche qu'à ≥ 1280 px, sous ce seuil la pastille colorée reste seule ; un tap ouvre le popover « État des services » qui liste les services en difficulté). Hauteur : 52 px (58 px sur le 7"). Icônes : 24 px.

### ControlButtons (de gauche à droite, configuration typique)

Les boutons se répartissent en quatre groupes étiquetés, séparés par des filets : **Carte** (flèche localisation → anneaux radar), **Vues** (IA, prévisions — le groupe n'apparaît que s'il contient un bouton, c.-à-d. sur LayoutPi ou avec le bouton IA de debug), **Affichage** (contraste, auto, lune) et **Système** (refresh → mise à jour). Sur le 7", Marqueur, Légende, Anneaux radar et Débogage quittent la rangée pour un menu « ··· » après le groupe Système ; ses lignes font les mêmes actions.

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
| ✦ IA (étincelle) | LayoutPi : ouvrir la vue IA plein rail (AiView) · Mobile / Desktop : afficher/masquer le résumé IA en ligne | LayoutPi : si une clé Anthropic est configurée (information tirée de la lecture `GET /settings` au démarrage ; repli : le HTTP 503 « pas de clé » de `/api/weather-summary`) · Mobile / Desktop : idem, plus Localhost + `DEBUG=true` |
| 📊 Prévisions | Ouvrir les prévisions agrandies (MAX) | LayoutPi uniquement |
| ◑ Contraste | Basculer mode sombre / clair | Toujours |
| ⏰ Auto | Mode auto sombre/clair selon lever/coucher | Toujours |
| 🌙 Lune (rouge) | Activer/désactiver la palette nightRed | Toujours |
| 🔄 Refresh | Recharger l'application (`window.location.reload()`) | Toujours — utile en PWA standalone sans barre d'adresse |
| ⚙ Paramètres | Ouvrir le panneau Paramètres | Toujours |
| 🐛 Debug | Ouvrir le panneau Debug | Localhost + `DEBUG=true` uniquement |
| ⬆ Mise à jour | Ouvrir la fenêtre de mise à jour | Quand une nouvelle version est disponible — en localhost, ouvre la fenêtre ; un client distant obtient un bouton désactivé dont le tap affiche un toast d'avis |
| ··· Plus de commandes | Ouvrir un menu avec Marqueur, Légende, Anneaux radar et Débogage (mêmes actions, mêmes conditions) | LayoutPi (vues prioritaires) seulement ; ces quatre boutons quittent alors la rangée |

En portrait à ≤ 600 px de large (téléphones), le dock masque les boutons marqués secondaires — chronologie, flèches direction, légende, alertes à proximité, auto et lune — pour que l'essentiel reste tappable ; la chronologie et la légende reviennent quand la carte radar mobile est maximisée. Tant que cette carte est en mode mini, la chronologie, la légende et les alertes à proximité sont grisées et un tap affiche plutôt un toast d'indication.

L'apparence des boutons s'adapte à la palette Direction C via des propriétés CSS personnalisées : arrière-plans transparents (la surface du dock transparaît), séparateurs `--c-border-hybrid`, aucun flash à l'appui (`--ctrl-btn-active: transparent`) ; `--c-accent-soft` ne marque qu'une bascule active (`.buttonDown`). Sur le 7", les boutons de vue du dock (IA, prévisions) prennent une teinte de fond pendant l'appui (aucun repeint `:active`).

---

## Contrôles de la carte radar (v3.1 Phase 3)

Tous les contrôles flottants sur la carte Leaflet suivent la référence Claude Design Phase 3 v2.1 (constats d'audit F7 · F8 · F20).

- **Zoom +/−** — haut-gauche, 40 × 40 px (36 px sur mobile), surface teintée par la palette, retour `:active` accent uniquement (aucun survol sur les surfaces kiosque). Infobulles localisées.
- **Focus radar (plein écran)** — bouton autonome 40 × 40 px sous la pile de zoom (top 110 px ; 100 px sur LayoutPi). Paire SVG à quatre équerres (vers l'extérieur = focus, vers l'intérieur = restaurer — la même paire que le toggle de maximisation de la carte mobile). Masque le HeroBand + le rail ; chaque bascule est confirmée par un bref toast. État actif = accent plein.
- **Barre de timeline** — barre pleine largeur en bas (inset droit conscient du rail). En-tête : lecture/pause · pas ±1 · vitesse (1×/2×/4×) · horodatage + chip « now-tag » (jamais un décalage relatif nu ; les trames de prévision basculent vers un chip pointillé « Prévision · +N min ») · sous-ligne des comptes de trames · pilule retour-au-présent conditionnelle · chip source (« RainViewer · 10 min », cadence dérivée de l'espacement réel des trames ; teinte d'avertissement si le dernier rafraîchissement de la liste a échoué). Piste : remplissage passé, marqueur « Maintenant » étiqueté à la frontière passé→prévision, zone future hachurée **scrubbable**, et étiquettes de graduation dérivées au runtime (−2 h … +30 min). La zone future demande des trames de prévision (nowcast), et RainViewer n'en envoie plus depuis au moins le 2026-10-10 : la piste s'arrête alors à la trame la plus récente, dont la graduation de fin affiche « Maintenant » (sans marqueur séparé). La surface de scrub reste l'input range natif (invisible, pleine largeur) — la gestion pointer-capture éprouvée sur le terrain et l'accessibilité clavier sont conservées.
- **Légende** — carte bas-gauche à trois sections au plus : *Rayons d'analyse* (seulement si l'analyse radar est active ; sensible à l'unité ; cercle extérieur seulement si le rayon étendu est actif), *Précipitations* (toujours ; une barre à six segments de vraies couleurs de tuiles, tirées de la palette Universal Blue de RainViewer, une par niveau d'intensité de l'analyseur — identique dans les quatre palettes, nuit-rouge incluse), *Alertes à proximité* (seulement si la couche des alertes à proximité est active ; clé des tiers + compte honnête dans le rayon). La clé des tiers nomme chaque couleur par sa gravité — Sévère / Modérée / Mineure — parce que la couleur est la gravité CAP de l'alerte, pas son type (le tier orange contient des avis et des avertissements autant que des veilles). Sur écrans courts (≤ 520 px de haut), elle se replie en chip « (i) Légende » tant que la barre de timeline est affichée. Sous la coque superposée du 7", à toute hauteur, elle est le chip du coup d'œil MID (où la carte de légende — ~190 px de haut avec la section alertes, ~215 px en taille de police L — couvrirait la moitié de la hauteur de la zone de carte que le rail et le dock laissent libre, et une partie des anneaux d'analyse) et le chip relevé au-dessus du curseur ouvert. Le radar plein écran MIN sans curseur garde la carte de légende. Le chip suit la timeline réellement affichée, jamais la préférence persistée `radarTimelineVisible`, qui ne pilote pas le curseur MIN de la v3.3. Le chip — et le (i) de la bande mobile — ouvrent la légende complète en surimpression (scrim + ✕ + Échap). Sur la disposition mobile, la carte est remplacée par une bande compacte pleine largeur près du bord inférieur.
- **Chips de rayon sur la carte** — étiquettes « 50 km » / « 100 km » à l'intersection sud-est des cercles (sensibles à l'unité ; masquées sur mobile et au-delà du zoom 13, même porte que les cercles).
- **Attribution** — au ras du bas-droite, collée au bord du dock dans tous les états (obligation légale — visible partout, y compris la mini-carte mobile) ; amincie pour tenir dans le couloir de 16 px sous la barre de timeline / la bande de légende. Sur le 7", elle se place en bas à droite de la zone de carte libre en MID, dans le coin de l'écran en MIN, et sur deux lignes à côté de la feuille de vue.
- Les nouveaux tokens CSS du radar (`--rc-*`, `--map-*`) vivent dans `WeatherMap/styles.css`, commutés par palette via `data-palette` (délibérément pas ajoutés à `ui/tokens.js`). En nuit-rouge, les tokens des tiers d'alertes s'effondrent vers la famille rouge tandis que l'échelle de précipitations garde les vraies couleurs des tuiles.
- **Fond de carte** — là où aucune tuile de fond de carte n'est dessinée (tuiles en chargement ou en échec, bord découvert par un déplacement ou un zoom arrière), la carte montre le fond de page de la palette, `--c-bg`, et non le gris `#ddd` de Leaflet, dans toutes les dispositions (`ui/reset.css`).

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

Procédure détaillée par plateforme : [`docs/pwa-trust-cert_fr.md`](pwa-trust-cert_fr.md). Le même bloc des Paramètres l'offre à tous sous forme de code QR (« Scannez pour consulter le guide », dans la langue d'interface de l'utilisateur : FR / ES, sinon EN). Les clients distants reçoivent aussi un lien « Lire le guide ↗ » vers la même page, à côté de « Télécharger le cert », parce qu'un téléphone ne peut pas scanner son propre écran et qu'un navigateur distant a son propre bouton Retour. Le kiosque n'a jamais ce lien, pas plus que tout autre client local (tunnel SSH compris), selon la règle kiosque « QR seulement » pour les URL externes.

### Rafraîchir une PWA installée

En mode standalone, la barre d'adresse Safari est masquée — pas de bouton recharger natif. Deux mécanismes :

- **Bouton 🔄 Refresh du dock** (universel — toutes dispositions).
- **Pull-to-refresh** sur LayoutMobile (geste tactile depuis le haut du conteneur défilant — voir section LayoutMobile).
