# Brief — Disposition mobile pour pi-weather-station

## Contexte

**pi-weather-station** est une station météo open-source qui tourne sur Raspberry Pi 7" en kiosque. L'app affiche météo temps réel, radar animé (RainViewer), prévisions, alertes gouvernementales (ECCC/NWS) et un résumé IA généré par Claude.

**Stack actuel:**

- React 18 + CSS Modules (kebab-case → camelCase via css-loader)
- Leaflet + Mapbox tiles
- i18next (EN/FR/ES)
- Express backend, déployé sur 7 Pi en production

**Deux layouts existants:**

- `LayoutPi` (800-1279px) — grille à 2 colonnes, dock en bas, optimisé tactile pour kiosque 7"
- `LayoutDesktop` (≥1280px) — carte plein écran, rail flottant à droite, dock superposé

**Mobile = nouveau layout** ciblant `<800px` (en pratique 375-430px portrait sur téléphones).

---

## Système de design existant à respecter

**Palette** — quatre variantes pilotées par l'heure locale via tokens CSS:

- `day` (jour) — fond crème chaud `#fffaf0`, accent brun chaud
- `dusk` (crépuscule) — transition orange
- `night` (nuit) — fond anthracite, accent amber
- `nightRed` (mode vision nocturne) — fond noir, tout en rouge sombre `#c44040` (palette "blood moon")

Tokens clés: `--c-bg`, `--c-surface`, `--c-text`, `--c-text-dim`, `--c-accent`, `--c-accent-soft`, `--c-border`, `--c-border-hybrid`

**Mode hybride** — quand une alerte gouvernementale sévère est active, surfaces deviennent plus opaques + strip latéral coloré (amber pour modéré, rouge pour sévère).

**Typo** — Geist (sans-serif geometric), 13-16px body, 24-72px hero

**Icônes** — IBM Carbon (24×24, stroke 2px) pour les contrôles UI, weather-icons (wi) pour les conditions météo

---

## Deux variantes à mocker en parallèle

### Variante A — Compagnon nomade (lecture rapide)

**Cas d'usage:** l'utilisateur consulte vite la météo depuis son téléphone quand il n'est PAS devant le Pi. Lecture surtout, très peu d'interaction.

**Caractéristiques:**

- Vue unique scrollable (pas de navigation par onglets)
- Stack vertical: alertes → météo actuelle → radar → 24h → 5 jours → résumé IA
- Pas d'accès aux paramètres / debug / clés API (ces fonctions vivent sur le Pi local)
- Interactions minimales: pull-to-refresh, tap pour passer dark/light, tap marqueur sur carte
- Optimisé pour glanceability — toute l'info utile en 2-3 swipes

**Avantages attendus:** simple, rapide à charger, courbe d'apprentissage zéro
**Limites:** pas de configuration possible depuis le mobile

### Variante B — App complète en miniature

**Cas d'usage:** même app que le Pi, juste adaptée portrait. L'utilisateur peut tout faire depuis son téléphone.

**Caractéristiques:**

- Navigation par onglets en bas (tab bar) ou drawer latéral
- Onglets suggérés: **Météo** (hero+alertes+résumé IA) / **Carte** (radar+chronologie) / **Prévisions** (24h+5j) / **Réglages** (params+debug si localhost)
- Tous les contrôles du dock du Pi accessibles (mode auto, palette rouge, marqueur, légende, etc.) — soit dans un dock condensé, soit dans Réglages
- Paramètres complets: clés API, unités, langue, sleep mode, etc.

**Avantages attendus:** parité fonctionnelle avec le Pi
**Limites:** plus complexe, plus de surfaces à designer, plus d'i18n à gérer

---

## Contraintes communes aux deux variantes

- **Touch-first** — cibles 44×44 px minimum, espacements généreux
- **Palette adaptative** — chaque maquette doit montrer au moins `day` et `night` (et idéalement `nightRed` pour la variante A puisque c'est un cas d'usage nocturne fréquent)
- **i18n** — textes EN/FR/ES, prévoir variations de longueur (le français est ~20% plus long)
- **Safe areas** — respecter les notches iOS et la barre de gestes Android
- **PWA-ready** — splash screen + icône d'accueil prévus dans les deux variantes
- **Performance** — la carte Leaflet doit rester fluide; éviter les effets coûteux (backdrop-filter à minimiser)
- **Pas de bottom sheet modal lourd** — l'app est utilisée pour des consultations courtes, pas pour des sessions longues

---

## Livrables attendus

Pour chaque variante:

1. **3-5 écrans clés** en portrait 390×844 (iPhone reference)
2. Le **même écran principal** décliné dans 2 palettes (day + night minimum)
3. Un **état d'alerte** (mode hybride avec strip rouge)

Plus:

- **Tableau comparatif** A vs B sur les axes: complexité, courbe d'apprentissage, valeur ajoutée vs le Pi, effort d'implémentation
- **Recommandation finale** avec justification

---

## Notes additionnelles

- Le projet est mature (v2.14.78), avec ~150 strings i18n existants et un langage visuel établi sur 3 ans. Le mobile doit s'inscrire dans cette continuité, pas réinventer.
- Le maintainer (un humain) déploie via SSH+git pull sur 7 Pi en production. Toute solution nécessitant un build/binaire séparé (app native) est hors scope. Le mobile sera servi par le même Express qui sert déjà LayoutPi/LayoutDesktop.
- Le repo public: <https://github.com/thicla01/pi-weather-station>
