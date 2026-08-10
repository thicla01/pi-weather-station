# Handoff — React 18 → 19 + react-leaflet 4 → 5

**Written 2026-08-10.** Self-contained briefing for a fresh Claude Code session. Everything marked *verified* was checked against the live tree or the registry on that date; everything marked *unverified* is explicitly flagged so you re-check rather than inherit an assumption.

---

## TL;DR

The client is pinned to React 18. Dependabot will keep proposing React 19 and those PRs will keep failing. PR #312 was closed for this reason (see `ROADMAP.md` → Technical debt → "React 18 → 19 migration").

The headline is misleading. **react-leaflet is the *gate*, not the *work*.** Its v5 peer range is what forbids React 19, but our usage of its API looks unaffected by the v5 changes. The actual work is on the React 19 side, and it is concentrated in two mechanical-but-wide changes that have nothing to do with maps:

1. `defaultProps` on function components — **removed** in React 19. 16 call sites, 12 files.
2. `CSSTransition` without `nodeRef` in `UpdateModal` — relies on `ReactDOM.findDOMNode`, **removed** in React 19.

Budget the session around those two, not around the map.

---

## Why a single-package bump can never work

Dependabot proposes `react-dom` alone. That combination cannot install:

```
npm error ERESOLVE could not resolve
npm error While resolving: react-dom@19.2.8
npm error Found: react@18.3.1
npm error Conflicting peer dependency: react@19.2.8
```

This is worse than a red CI. The in-app updater (`POST /api/update`) runs the same `npm ci`, so a merged half-bump would **break every deploy on the 10-Pi fleet**, not just the build. Any React move must be `react` + `react-dom` + `react-leaflet` in one commit.

---

## Verified state (2026-08-10)

| Package | Installed | React 19 ready? | Note |
|---|---|---|---|
| `react` | ^18.3.1 | — | target `^19.x` |
| `react-dom` | ^18.3.1 | — | target `^19.x` |
| `react-leaflet` | ^4.2.1 | ❌ peers `react ^18.0.0` | **the gate** — needs v5.0.0 |
| `leaflet` | 1.9.4 | ✅ | v5 peers `leaflet ^1.9.0` — **no Leaflet bump needed** |
| `react-transition-group` | 4.4.5 | ⚠️ peer allows, code path breaks | 4.4.5 *is* latest; see work item C |
| `react-chartjs-2` | ^5.3.1 | ✅ peer includes `^19.0.0` | |
| `qrcode.react` | ^4.2.0 | ✅ peer includes `^19.0.0` | |
| `@iconify/react` | ^6.0.2 | ✅ peer `>=16` | permissive — still render-check it |
| `react-i18next` | ^17.0.11 | ✅ peer `react >=16.8.0` | permissive — still render-check it |

`react-leaflet@5.0.0` declares: deps `@react-leaflet/core ^3.0.0`; peers `leaflet ^1.9.0`, `react ^19.0.0`, `react-dom ^19.0.0`.

**The entry point is already modern:** `client/src/index.js` uses `createRoot` from `react-dom/client`. The React 19 removal of legacy `ReactDOM.render` does not apply. No string refs in JSX either.

---

## Work items, ranked by real risk

### A. `defaultProps` on function components — **highest volume, highest silent-failure risk**

React 19 removed `defaultProps` for function components. It does not throw: the assignment is simply **ignored**, so every defaulted prop arrives as `undefined`. Failures surface as blank values, `NaN`, or a crash deep in a child — far from the cause. This is the item most likely to produce a subtly wrong kiosk rather than a red build.

16 call sites across 12 files (verified by grep):

```
components/ambient/MoonDetailsPopover/index.js:131
components/ambient/MetricsGrid/index.js:251   (Cell)
components/ambient/MetricsGrid/index.js:271   (MetricsGrid)
components/ambient/AirCard/index.js:291       (Row)
components/ambient/AirCard/index.js:305       (AirCard)
components/ambient/AstroMetaLine/index.js:140
components/ambient/QrCode/index.js:63
components/ambient/DetailsPopover/index.js:263
components/ambient/TimeBlock/index.js:186
components/ambient/LocationDetailsPopover/index.js:147
components/ambient/HeroCompact/index.js:180
components/ambient/RailSquareButton/index.js:48
components/ambient/SunDetailsPopover/index.js:147
components/WeatherMap/index.js:528            (AlertGeometryOverlay)
components/WeatherMap/index.js:584            (NearbyAlertsOverlay)
components/WeatherMap/index.js:632            (SurveyAlertContent)
```

Convert each to destructuring defaults in the signature. **Do not batch this blind** — read each default and confirm the semantics survive, because `= default` in destructuring only fires on `undefined`, whereas `defaultProps` also fired on `undefined` but people sometimes rely on falsy-vs-undefined distinctions. Check especially anything defaulting to `0`, `""`, or `false`.

Re-run the grep before you start; the list will have drifted if anyone touched these files:

```bash
grep -rn "\.defaultProps" client/src/
```

### B. react-leaflet 4.2.1 → 5.0.0 — **the gate, probably small**

Symbols we import (`components/WeatherMap/index.js`):

```
MapContainer, TileLayer, WMSTileLayer, AttributionControl, ZoomControl,
Marker, Circle, CircleMarker, Polyline, GeoJSON, Popup, useMap, useMapEvents
```

Plus `Marker` in `RingLabels.js`, `useMap` in `MapResizer.js`, `Circle` in `RiskRing.js`. `geometry.js` is deliberately pure — no react-leaflet, no hooks — so it needs no attention.

The only documented v5 removal is the **`LeafletProvider` component**, which **we do not use**. On that basis the API surface we depend on appears unchanged and this should reduce to a version bump. *Unverified:* the upstream release notes are thin, so confirm at install time that all 13 symbols still export, and skim `@react-leaflet/core` v2 → v3 for prop-update behaviour changes.

Three spots in `WeatherMap/` deserve a deliberate look because they encode assumptions about react-leaflet **v4** behaviour:

1. **`index.js:~1118` — referential-stability memos.** The comment states plainly: *"react-leaflet v4 compares props by reference: a fresh array/object every render triggers setLatLng/setStyle on the underlying Leaflet layers even when the values are identical — at 1-4 Hz during radar animation that's constant no-op SVG work on Pi hardware."* If v5 changed prop diffing, these memos are either still necessary, newly redundant, or newly insufficient. **This is a Pi-performance concern, not a correctness one** — it will not show up on a dev Mac. Verify on hardware during radar animation.
2. **`index.js:~652` — the ZoomControl remount key.** Keyed on `i18n` because *"react-leaflet only forwards `position` updates to an existing control, so the +/- titles would otherwise stay frozen in the mount-time language."* Re-test by switching language live (EN/FR/ES) and confirming the zoom button tooltips follow.
3. **`MapResizer.js` — imperative `map.invalidateSize()`.** Called after each radar-focus toggle. Exercise `RadarFocusControl` on both `LayoutPi` and `LayoutDesktop`.

### C. `CSSTransition` without `nodeRef` — **hard runtime breaker, one file**

`components/UpdateModal/index.js:104` renders `<CSSTransition>` with **no `nodeRef` prop** (verified: zero `nodeRef` occurrences anywhere in `client/src/`). Without it, react-transition-group falls back to `ReactDOM.findDOMNode`, which React 19 **removed**. Expect a runtime throw when the update modal animates.

`react-transition-group@4.4.5` is the current latest — there is no newer release to upgrade into, so the fix is ours: add a `useRef` and pass `nodeRef`, attaching the same ref to the transitioning child element.

⚠️ **This file has history.** See the April 2026 drag-scroll incident: `useRef`/`useEffect` returning `null` inside `CSSTransition` was the cause of a long debugging session. Read that incident note before editing, and verify with the browser devtools rather than by reasoning — the failure mode there was invisible in the source.

### D. `propTypes` — a policy decision, not a code change

React 19 **ignores** `propTypes` on function components. They stop validating; they do not break. 37 files declare them, and `CLAUDE.md` currently mandates *"Every new or modified React component must have a complete JSDoc block and declared PropTypes."*

After React 19 that rule enforces a no-op. **This needs a maintainer decision, not a unilateral one** — options are (a) keep them as documentation and note in `CLAUDE.md` that they are inert, (b) strip them, (c) move to a checker that still runs. Do not silently delete 37 files' worth of PropTypes as part of a dependency migration. Raise it and let the maintainer choose.

### E. StrictMode / ecosystem render check

`@iconify/react` and `react-i18next` have permissive peer ranges, which means "not blocked", not "verified". Render-check every screen once under React 19, watching for double-invoke effects and any `useEffect` that is not idempotent. The map's imperative Leaflet calls are the likeliest place for a double-invoke to bite.

---

## Verification strategy

Local gates, all of which must pass before the Pi stage:

```bash
cd client && npm run prod
```
Must finish with **0 errors**. Bundle-size warnings are expected and acceptable. Watch the lint count: it has held at **151 warnings / 0 errors** across the whole August dependency batch — a jump means something regressed.

```bash
npm test
```
565/565 at time of writing. Note this suite covers the **server** radar-trend pipeline only; it will not catch a single React regression. Passing tests are necessary, not sufficient.

**The real gate is the Pi field test**, because three of the risks above (referential-stability churn, StrictMode double-invoke on imperative Leaflet calls, kiosk-only layouts) simply do not manifest on a dev Mac. Minimum on-hardware checklist:

- Radar animation running at 1-4 Hz — watch for CPU/GPU churn, compare against current behaviour
- Language switch EN → FR → ES with the map mounted (ZoomControl titles)
- `RadarFocusControl` toggle on `LayoutPi` **and** `LayoutDesktop` (`invalidateSize`)
- Alert polygons + `RiskRing` rendering
- The update modal animating (work item C)
- All three palettes, day/dusk/night/nightRed

Good target Pis: **RPi5-PWS5** (`192.168.6.55`) is the display-scale reference machine; **StationMeteoP9** (`192.168.6.4`) is the 7" DSI kiosk and the historically most fragile renderer. See the fleet inventory (**not in this repo** — it lives on the maintainer's Desktop and is confidential) for the full host list.

---

## Deployment notes — do not skip

- **This lands as a server-dependency-class change**, because `npm ci` must re-resolve the whole tree. Deploy via the updater path (`POST /api/update`), **never a bare `git pull`**.
- **`client/dist/` is committed** and is what the Pis actually serve. A React migration without a rebuilt bundle is inert. Run `cd client && npm run prod` and commit the bundle.
- **Relaunch the kiosks afterwards** — `POST /api/relaunch-kiosk` per host. The new bundle does not appear until the browser reloads. Prefer this endpoint over `pkill`, which has a documented respawn trap.
- **Deployment and verification are two separate loops.** A combined heredoc returns misleading exit codes. `POST /api/update` is asynchronous: `{"ok":true}` means *accepted*, not *finished* — verify by reading versions actually installed in `node_modules`, never the lockfile or the curl response.
- The updater pre-flight rejects a dirty tree, a non-`master` branch, or detached HEAD with a structured 409. Run a read-only pre-flight before the batch.

---

## Suggested commit shape

One commit for the lockstep bump (`react` + `react-dom` + `react-leaflet` + lockfile), then separate commits for the code fallout (`defaultProps`, `nodeRef`), then the `dist` rebuild. That keeps a bisectable history if the kiosk misbehaves in the field.

Use `chore(deps):` or `feat:` — both are curated types the in-app updater surfaces, which is correct here: the fleet genuinely needs this deploy. (Contrast with lint-only dependency fixes, which are deliberately typed plain `chore:` so they do not light the update badge on ten Pis for nothing.)

---

## What I did *not* verify

Be skeptical of anything not in this list — I checked these directly on 2026-08-10:

- ✅ Installed versions and peer ranges of every package in the table (registry + local `node_modules`)
- ✅ The exact `defaultProps` call sites (grep over `client/src/`)
- ✅ Absence of `nodeRef` anywhere in `client/src/`
- ✅ `createRoot` in use; no string refs in JSX
- ✅ The 13 react-leaflet symbols we import, and which files import them
- ✅ `react-leaflet@5.0.0` dependency/peer metadata
- ✅ Leaflet 1.9.4 already satisfies v5's `^1.9.0`

Not verified — **do these yourself**:

- ❌ The complete react-leaflet v4 → v5 API delta. Upstream release notes are sparse; only the `LeafletProvider` removal is clearly documented. **Do not assume a clean bump** until you have installed v5 and the build is green.
- ❌ `@react-leaflet/core` v2 → v3 changes, specifically anything touching prop diffing (bears directly on the memoization in work item B.1)
- ❌ Whether React 19's StrictMode changes actually bite any of our effects — this needs a run, not a read
- ❌ Any behavioural change in the other React ecosystem packages; their peer ranges say "allowed", which is not the same as "tested"
