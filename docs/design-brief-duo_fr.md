# Brief — Layout iPhone Duo pour pi-weather-station

## Contexte

**pi-weather-station** est une station météo libre qui tourne sur un Raspberry Pi à écran tactile 7″ en mode kiosque, et qui est aussi servie comme page desktop et comme PWA mobile par le même serveur Express. L'app affiche la météo en temps réel, un radar animé (RainViewer), les prévisions, les alertes gouvernementales (ECCC / NWS), la qualité de l'air et un résumé IA généré par Claude.

**Pile actuelle :** React 19 + CSS Modules, Leaflet + tuiles Mapbox, i18next (EN / FR / ES), backend Express, déployé sur 10 Pis en production. La PWA s'utilise dans Safari sur iOS ; pas d'app native, pas de build séparé.

**Trois layouts existants,** choisis par la largeur du viewport (`AmbientLayers`) :

- `LayoutMobile` — `< 800 px` : une colonne défilante (horloge · alerte · hero · air · 2×2 · carte radar · prévisions · IA), dock portrait en bas
- `LayoutPi` — `800–1279 px` : le kiosque 7″. Grille `1fr 300px` (carte · rail) + dock, gouttières encadrées de 10 px, et **trois états du rail** — MIN (le radar prend l'écran), MID (split, défaut), MAX (prévisions en avant, la carte devient une vignette de 190 px)
- `LayoutDesktop` — `≥ 1280 px` : carte pleine page, bandeau héros flottant, rail 320, dock

**iPhone Duo = une nouvelle cible,** pas forcément un layout parti de zéro. La consigne d'Apple est explicite : *un layout compact pour l'écran extérieur, un layout large pour l'écran intérieur, et le layout s'étend d'une pose à l'autre* — pas de layout par pose, pas de réarrangement brutal quand l'appareil se plie.

---

## L'appareil, tel qu'une page web le voit

Apple ne publie pas de résolution logique. Les viewports CSS ci-dessous sont les résolutions physiques ÷ 3 ; les barres de Safari réduisent encore la hauteur utile.

| État | Physique | Viewport CSS estimé | Layout servi aujourd'hui |
|---|---|---|---|
| Écran extérieur, fermé, portrait | 5,4″ · 1398 × 2034 · 460 ppp | **≈ 466 × 678** | LayoutMobile |
| Écran extérieur, paysage | — | ≈ 678 × 466 | LayoutMobile (règles paysage) |
| Écran intérieur, ouvert, paysage | 7,6″ · 1878 × 2670 · 430 ppp | **≈ 890 × 626** | **LayoutPi** (c'est un écran de 7,6″) |
| Écran intérieur, ouvert, portrait | — | ≈ 626 × 890 | LayoutMobile |
| Une moitié en Split View (deux apps, ou deux fenêtres Safari) | — | ≈ 445 × 626 | LayoutMobile |

Les deux écrans ont le même ratio (≈ 1 : 1,45) : ouvert, l'écran intérieur, c'est **deux moitiés de la taille de l'écran extérieur côte à côte, charnière au centre** (les « trois écrans » de la presse). L'écran intérieur est un seul panneau pliable ; un fini nano-texturé minimise la pliure. Chiffres officiels (fiche technique Apple) : fermé 84,1 × 117,8 × 11,3 mm, ouvert 164,6 × 117,8 × 5,2 mm — l'appareil s'ouvre **plus large que haut**, la pose ouverte naturelle est donc le paysage avec charnière verticale ; les deux écrans ont une Dynamic Island ; **l'Apple Pencil (USB-C) est pris en charge**, le pointeur principal reste donc grossier (tactile) alors qu'un pointeur fin peut être présent — toute détection doit lire `pointer`, jamais `any-pointer`.

**Poses** (Apple en recense six) : fermé · tente (debout sur ses bords) · ouvert à plat, paysage · livre (partiellement plié, charnière verticale) · ouvert à plat, portrait · portable (posé, partiellement plié, charnière horizontale — la moitié du haut relevée, celle du bas à plat).

**Ce que Safari n'expose PAS.** Ni CSS Viewport Segments, ni Device Posture API (Chromium seulement en 2026), ni API de régions réservées (natif SwiftUI / UIKit seulement). Une page web obtient : la largeur et la hauteur du viewport et leurs changements à l'ouverture ou à la fermeture, l'orientation, `pointer: coarse` / `hover: none`, `display-mode: standalone` et `env(safe-area-inset-*)` — savoir si la zone caméra latérale est rapportée comme inset de zone sûre en paysage reste **à vérifier sur l'appareil**. La position de la charnière viendra donc soit d'une **heuristique de viewport** (≈ 890 × 626, pointeur grossier → charnière à x ≈ 445), soit d'un **réglage utilisateur** (« écran pliable — charnière au centre »). Dessine comme si la ligne de charnière était connue ; nous choisirons comment l'obtenir.

**Les règles d'Apple qui se transposent directement en layout web** (Human Interface Guidelines, « Designing for iPhone Duo », 2026-09-09) :

1. **Régions réservées** — la caméra frontale extérieure (coin supérieur, s'étend en Dynamic Island), la caméra intérieure (seulement quand elle est active) et la **région de pliage** (seulement partiellement ouvert : elle divise l'écran intérieur en deux régions utilisables et exclut le centre). Garder l'important hors du centre quand c'est plié ; préférer un nombre pair de colonnes dans les grilles (notre 2×2 l'est déjà).
2. **Règle du split** — une paire primaire + secondaire se divise **horizontalement quand la zone est plus large que haute, verticalement quand elle est plus haute que large** ; partiellement plié, chaque vue prend un côté. Pour nous : carte = primaire, rail = secondaire.
3. **Contrôles verticaux** — sur l'écran extérieur (plus large et plus court qu'un iPhone) et sur l'intérieur en paysage, iOS déplace barres d'outils, tab bars, barre d'état et Dynamic Island dans une **bande verticale du côté de la caméra** ; seul l'intérieur en portrait garde des barres horizontales. En Split View chaque app met ses contrôles sur son bord extérieur. Ordre : navigation en haut, actions fréquentes ensuite, débordement de bas en haut. Une interface immersive sans barres peut prendre toute la largeur.
4. **Continuité** — mêmes fonctions et même état d'un écran et d'une pose à l'autre ; un niveau de hiérarchie de plus sur l'écran intérieur (Mail : liste *ou* message fermé, les deux ouvert) ; petits ajustements au pliage, jamais un réarrangement.

---

## Le design system existant à respecter

Tout ce qui suit vit déjà dans le projet Claude Design **« Design System »** (pi-weather-station Ambient Layers). Lis d'abord son `readme.md` — il porte les deux jeux de règles (kiosque et tactile, alertes et statut) et la frontière normatif / illustratif — puis compose à partir de ses jetons et de ses cartes. Ne restyle pas ; prolonge.

- **Quatre palettes** en `data-theme` : `day` (défaut, crème `#f4f0e8`, accent ambre), `dusk` (la palette sombre servie aujourd'hui), `night` (définie, pas encore atteignable), `nightRed` (vision nocturne, tout en rouge — le mot porte le palier, jamais la couleur seule). `data-hybrid="light|full"` escalade chaque slab pendant une alerte gouvernementale (surface .85 → .96, filet plus marqué, liseré ambre ou rouge).
- **Typo** — Geist 400 / 500 / 700 et Geist Mono 500 seulement, chiffres tabulaires pour les valeurs vivantes, sourcils mono en capitales. La densité S / M / L met à l'échelle le rail, jamais la carte.
- **Surfaces** — la recette de slab (`--c-surface`, filet 1 px `--c-border`, rayon 10, liseré hybride), rayons 3 → 14 + pilule, flou verre 8 px sur le dock et le chrome de carte, cibles ≥ 44 px, rétroaction `:active` seulement — **le survol ne peint rien**, pas d'animation infinie, liens externes en code QR seulement.
- **Composants à reprendre tels quels** — `SourceBadge`, `SeverityChip`, `ConfidencePill`, `MoonGlyph`, `MetricCell` ; et les cartes spécimens de l'horloge, du hero, de la NowcastLine, de la carte air, des surfaces d'alerte, du dock, du slab de prévisions. Les anatomies d'écran `pi-7in-mid / min / max`, `desktop-1280` et `mobile-portrait` sont les points de départ — le travail Duo est une variation de `pi-7in-*` (écran intérieur) et de `mobile-portrait` (écran extérieur).
- **Icônes** — SVG inline sur `currentColor` (le code utilise Iconify / IBM Carbon pour les contrôles) ; pas d'emoji.
- **Textes** — trilingues EN / FR (Québec) / ES ; données réelles plausibles (Montréal, Québec, Winslow AZ), états calme **et** alerte, jamais de lorem ipsum. Les unités suivent la préférence de l'utilisateur.

---

## Ce qu'il faut dessiner

Deux layouts et une transition, dans cet ordre.

### 1. Écran intérieur, complètement ouvert — paysage 890 × 626 (le livrable principal)

Pars de `pi-7in-mid`. Place la coupure **sur la charnière** : carte sur une moitié, rail sur l'autre, avec entre les deux une gouttière de charnière assez large pour survivre à la pose livre (partiellement plié) — propose une valeur et nomme-la comme jeton (p. ex. `--hinge-gutter`). Puis réponds aux trois états :

- **MID** — quel côté reçoit la carte ? (Apple : les contrôles du côté de la caméra ; dans les figures des HIG, la caméra est sur le bord extérieur de la moitié droite.) Que contient le rail à ≈ 445 px de large et ≈ 570 px de haut une fois les barres de Safari retirées — la pile MID (alerte · horloge · hero · NowcastLine · air · 2×2 · intérieur) fait ≈ 520 px sur le 7″ ; quelque chose change-t-il ?
- **MIN** — le radar prend l'écran : la carte peut-elle traverser la pliure quand c'est complètement ouvert (nano-texture, panneau unique) — ou doit-elle rester sur une moitié avec la chronologie sur l'autre ? Argumente.
- **MAX** — prévisions en avant sur un écran déjà coupé en deux : prévisions sur une moitié et vignette de carte sur l'autre (la vignette grandit), ou la vignette actuelle de 190 px ?

**Le dock.** Notre `BottomDock` est une barre horizontale. La convention d'Apple sur cet écran, c'est une bande verticale du côté de la caméra. Montre **les deux options** côte à côte — (a) dock en bas, sur les deux moitiés ; (b) dock vertical sur le bord caméra, dans l'ordre Apple (groupe Carte en haut, Système en bas, la puce santé où ?) — et recommande l'une des deux avec les compromis (portée du pouce, évitement de la charnière, cohérence avec le kiosque Pi et avec l'écran extérieur).

### 2. Écran intérieur, plus haut que large — portrait 626 × 890, et la pose portable

La règle du split d'Apple dit vertical : **carte au-dessus, rail en dessous**. En pose portable, la charnière horizontale tombe exactement sur la coupure — la moitié relevée devient le radar, la moitié à plat le rail et les contrôles, un usage façon kiosque qu'on veut encourager. Montre l'écran portrait complètement ouvert et l'écran en pose portable ; ce doit être le même layout avec la gouttière alignée sur la charnière, pas deux designs.

### 3. Écran extérieur, fermé — 466 × 678, et la transition

`mobile-portrait` tient déjà. Montre un écran pour confirmer ce que la proportion plus large et plus courte change (l'horloge de 56 px, la carte radar de 220 px, le dock portrait) et si le dock doit passer vertical du côté caméra ici aussi. Puis montre la **transition ouvert → fermé** : quels éléments gardent leur place, ce qui se replie (Apple : le volet secondaire se replie en un seul volet), ce qui ne doit jamais sauter. Précise l'état qui survit au pliage (onglet de métrique choisi, position temporelle du radar, popover ouvert).

### 4. Moitié en Split View — 445 × 626 (vérification seulement)

Un écran : la PWA partage l'écran intérieur avec une autre app, contrôles sur notre bord extérieur. Confirme que `mobile-portrait` tient à cette largeur et à cette hauteur ; signale ce qui ne tient pas.

---

## Contraintes

- **PWA dans Safari sur iOS 27.1** — pas d'API native ; rien ne peut dépendre de la connaissance de la pose. Chaque décision doit être atteignable par la taille du viewport, l'orientation, `env(safe-area-inset-*)` et un réglage utilisateur.
- **Même layout d'une pose à l'autre** — un pliage déplace la gouttière ; il ne réarrange pas l'interface. Les contrôles gardent leurs positions relatives.
- **Gouttière de charnière** — un jeton nommé ; rien de tappable dans la région de pliage quand c'est partiellement ouvert.
- **Tactile d'abord** — cibles de 44 × 44 px ; pas d'état de survol ; la carte reste à sa résolution native.
- **Palettes** — chaque écran en `day` et `dusk` ; les écrans porteurs d'alerte aussi en `nightRed`.
- **Zones sûres** — le coin caméra extérieure / Dynamic Island, la bande latérale de contrôles, l'indicateur d'accueil ; utilise des insets de la forme `env()` et dis quel bord chacun protège.
- **Performance** — une seule instance Leaflet ; la carte ne doit pas être remontée quand l'appareil se plie (un redimensionnement + `invalidateSize()`, rien de plus).
- **Aucun nouveau réglage, source ou style** que le code n'a pas — le code gagne au moment du port. S'il faut un réglage (position de la charnière), dis-le explicitement comme une demande, avec sa valeur par défaut.

---

## Livrables attendus

1. **Écrans aux tailles CSS exactes** : 890 × 626 (MID · MIN · MAX, options de dock a et b), 626 × 890 + pose portable, 466 × 678, 445 × 626 — en `day` et `dusk`, écrans d'alerte aussi en `nightRed`, scénarios calme et alerte, textes en français.
2. **La transition** ouvert ↔ fermé en paire avant / après, avec la liste de l'état qui survit.
3. **Un README des décisions** : valeur de la gouttière de charnière, recommandation de dock argumentée, correspondance des trois états, recommandation heuristique ou réglage pour la charnière, et chaque endroit où la maquette s'écarte du design system (il ne devrait pas y en avoir) ou du layout Pi 7″ (liste-les).
4. **Les réponses aux questions ouvertes** ci-dessous, chacune avec une ligne de justification.
5. Handoff sous la forme habituelle d'un **bundle HTML** (autonome, s'ouvre dans un navigateur), relié aux jetons du projet « Design System ».

## Questions ouvertes

1. Dock vertical sur le bord caméra, ou dock en bas sur les deux moitiés ?
2. En MIN, le radar traverse-t-il la pliure, ou prend-il une moitié avec la chronologie sur l'autre ?
3. En MAX, vignette comme aujourd'hui (190 px) ou carte sur une demi-largeur ?
4. Position de la charnière : heuristique de viewport (≈ 890 × 626 + pointeur grossier) ou réglage utilisateur explicite — et quelle valeur par défaut ?
5. La pose portable doit-elle recevoir quelque chose que le portrait complètement ouvert n'a pas (p. ex. le dock sur la moitié à plat seulement) ?
6. Quelle est la largeur minimale du rail sous laquelle la pile MID doit retomber sur l'arrangement de l'écran extérieur ?

## Notes complémentaires

- L'appareil sort le 2026-10-23 (précommandes le 2026-10-16) ; nous validerons d'abord dans le Simulateur iOS si Xcode 27 fournit un profil Duo, puis sur l'appareil. D'ici là, les viewports CSS ci-dessus sont des estimations ; garde le layout fluide autour de ces valeurs.
- Le port sera une modification React + CSS Modules dans `AmbientLayers` (une nouvelle gate) et une variante de `LayoutPi` ou un `LayoutDuo`, livrée en PR avec CI. Documentation à mettre à jour de notre côté : `docs/ui-layout_{en,fr}.md` et le kit d'écrans du design system.
- Sources : [Apple — fiche technique iPhone Duo](https://www.apple.com/ca/fr/iphone-duo/specs/) · [Apple newsroom — Apple unveils iPhone Duo](https://www.apple.com/newsroom/2026/09/apple-unveils-iphone-duo/) · [HIG — Designing for iPhone Duo](https://developer.apple.com/design/human-interface-guidelines/designing-for-iphone-duo) · [estimation des viewports à partir des specs officielles (Qiita)](https://qiita.com/keishin_nishiura/items/3e9b91edfbe3390ecff6) · [MDN — Viewport Segments API (absente de Safari)](https://developer.mozilla.org/en-US/docs/Web/API/Viewport_segments_API/Using).
- Dépôt public : <https://github.com/thicla01/pi-weather-station>
