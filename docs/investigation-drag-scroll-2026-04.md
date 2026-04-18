# Investigation — Défilement tactile (avril 2026)

Rapport des problèmes rencontrés lors du remplacement de l'écran tactile par une nouvelle version du même modèle (contrôleur FT5x06). Le nouvel écran produit des événements `pointerType=mouse` au lieu de `pointerType=touch`, ce qui a rendu inopérants les mécanismes basés sur `touch-action` CSS et mis en évidence des bugs latents dans `useDragScroll`.

---

## Problème 1 — Build webpack silencieusement invalide

**Symptôme** : Toutes les modifications CSS et JS semblaient sans effet, même après `npm run prod`. Le bundle produit ne reflétait pas les changements.

**Cause racine** : Webpack 5 en mode production a l'option `emitOnErrors: false` par défaut. React 16.14.0 était installé alors que le code utilisait l'API React 18 (`createRoot` de `react-dom/client`). Webpack compilait mais refusait d'émettre les fichiers de sortie en présence de ces erreurs. Toute modification faite durant la première partie de la session n'a jamais été compilée dans le bundle.

**Correctif** : Mise à niveau React 16.14.0 → 18.3.1.

```bash
npm install react@18 react-dom@18
```

---

## Problème 2 — Corruption de fichier CSS par `sed`

**Symptôme** : `client/src/components/Settings/styles.css` vidé à 0 octet après une commande d'édition en ligne.

**Cause racine** : Une commande `sed -i` mal formée a écrasé le fichier au lieu de l'éditer.

**Correctif** :

```bash
git restore client/src/components/Settings/styles.css
```

---

## Problème 3 — Port de débogage Chrome absent du script installé

**Symptôme** : Impossible d'accéder au Chrome DevTools Protocol (port 9222) pour les investigations via CDP (`DOMDebugger.getEventListeners`, injection JS, etc.).

**Cause racine** : Le script installé sur le Pi (`~/.local/bin/start-server`) était une version antérieure au script source du projet (`deploy/start-server`). L'option `--remote-debugging-port=9222` n'y figurait pas.

**Correctif** : Ajout de l'option dans les deux scripts.

```bash
"$CHROMIUM" --kiosk ... --remote-debugging-port=9222 $FLAGS "$URL"
```

> **Note** : En cas de mise à jour du Pi, vérifier que `~/.local/bin/start-server` est en sync avec `deploy/start-server`.

---

## Problème 4 — `useDragScroll` n'attachait aucun listener sur les panneaux Settings et Debug

**Symptôme** : Le glissé tactile ne fonctionnait pas du tout dans les panneaux Paramètres et Débogage, alors qu'il fonctionnait normalement dans l'InfoPanel. `DOMDebugger.getEventListeners` retournait `[]` sur l'élément scrollable des panneaux ouverts.

**Cause racine** : `useDragScroll` utilisait `useRef` + `useEffect(fn, [])`. L'effet s'exécutait une seule fois au montage du composant *parent* (Settings ou Debug). Or, ces composants encapsulent leur contenu dans `<CSSTransition unmountOnExit>` : l'élément DOM scrollable n'existait pas encore dans le DOM au moment de l'exécution de l'effet. `ref.current` était donc `null`, l'effet se terminait sans attacher aucun listener, et ne se ré-exécutait jamais (tableau de dépendances vide `[]`).

L'InfoPanel fonctionnait parce qu'il est toujours monté — son élément scrollable est présent dès le premier rendu.

**Correctif** : Remplacement du `useRef` + `useEffect` par un **callback ref** (`useCallback`). Un callback ref est invoqué par React exactement au moment où l'élément entre dans le DOM, quelle que soit la temporisation de la transition CSS.

```js
// Avant — useEffect avec ref.current === null au moment de l'exécution
const ref = useRef(null);
useEffect(() => {
  const el = ref.current; // null si CSSTransition n'a pas encore rendu l'enfant
  if (!el) return;
  // listeners jamais attachés, effect jamais ré-exécuté
}, []);

// Après — callback ref, déclenché dès que l'élément entre dans le DOM
const cleanupRef = useRef(null);
const ref = useCallback((el) => {
  if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
  if (!el) return;
  // attacher les listeners ici...
  cleanupRef.current = () => { /* retirer les listeners */ };
}, []);
```

---

## Problème 5 — Saut vers le haut lors du repositionnement du doigt (panneau Débogage)

**Symptôme** : Après un premier geste de défilement réussi, repositionner le doigt pour un second geste faisait remonter le contenu vers le haut brutalement.

**Cause racine** : Des événements `pointermove` parasites se déclenchaient pendant le repositionnement du doigt (entre deux gestes), avec `ptrActive` encore à `true`. Le `pointerup` n'avait pas été capturé ou arrivait en retard — comportement observé avec le contrôleur FT5x06 en mode `pointerType=mouse`. Ces événements parasites appliquaient la **position de départ du geste précédent** (`ptrStartY`) à la position courante du doigt, produisant un delta négatif qui remontait le contenu.

**Correctif** :

1. Dans `onPointerMove` : si `e.buttons === 0` (aucun bouton pressé), réinitialiser `ptrActive = false` et sortir immédiatement.
2. Ajout d'un listener `pointerleave` → `ptrActive = false` pour couvrir le cas où le doigt quitte la zone scrollable sans déclencher `pointerup`.

```js
const onPointerMove = (e) => {
  if (e.buttons === 0) { ptrActive = false; return; }
  if (!ptrActive || touchActive) return;
  // ...
};

const onPointerLeave = () => { ptrActive = false; };
el.addEventListener("pointerleave", onPointerLeave);
```

---

## Commits associés

| Hash | Description |
|------|-------------|
| `b1cc014` | fix: repair drag-scroll in Settings and Debug panels |
