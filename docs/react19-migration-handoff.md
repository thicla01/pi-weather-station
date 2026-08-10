# Handoff — React 18 → 19 + react-leaflet 4 → 5

**Written 2026-08-10. Revised the same day after an empirical verification pass** that actually performed the migration in throwaway git worktrees. The first draft was written from code reading alone and got several load-bearing things wrong; those are corrected below and called out in "Corrections to the first draft" so nobody re-derives them.

Self-contained briefing for a fresh session. Claims marked *verified* were established by running something on 2026-08-10.

---

## TL;DR — read this part twice

**The migration installs and builds clean today.** Verified empirically: set `react` + `react-dom` to `^19` and `react-leaflet` to `^5.0.0`, run `npm install`, run `npm run prod` → **704 packages, 0 vulnerabilities, 0 build errors, exactly 151 lint warnings**, which is the unchanged master baseline. Server suite still 565/565.

**That is the problem, not the good news.** There is no build-time signal at all. Both real work items are runtime-silent:

1. `defaultProps` on function components is ignored under the automatic JSX runtime → props arrive `undefined`, **with no warning whatsoever** (React 18 at least warned; React 19 says nothing).
2. `CSSTransition` without `nodeRef` hits `ReactDOM.findDOMNode`, removed in React 19 → **TypeError that unmounts the entire React root**, because there is no error boundary above `App`. Blank kiosk until reload.

An engineer can apply the version bump, skip both fixes, pass every local gate, commit a rebuilt bundle, and ship a broken kiosk to 10 Pis. **Plan the session around that fact.**

react-leaflet is the *gate*, not the *work*: its peer range is what forbids React 19, but v5 is a clean bump for this codebase (verified — see item B).

---

## Verified state (2026-08-10)

Resolved after the bump, in a real install:

```
react@19.2.8  react-dom@19.2.8  react-leaflet@5.0.0
@react-leaflet/core@3.0.0  leaflet@1.9.4 (unchanged)  react-transition-group@4.4.5 (unchanged)
```

`npm ls` shows a fully deduped tree — every React consumer resolves to the single `react@19.2.8`. `npm ci` from the generated lockfile re-installs clean.

| Package | Installed now | React 19 | Note |
|---|---|---|---|
| `react` / `react-dom` | ^18.3.1 | → `^19.x` | |
| `react-leaflet` | ^4.2.1 | ❌ peers `react ^18.0.0` | **the gate** → v5.0.0 (only 5.x published) |
| `@react-leaflet/core` | 2.1.0 | → 3.0.0 | transitive; both `type: "module"`, identical `exports` map — no ESM/CJS shift for webpack |
| `leaflet` | 1.9.4 | ✅ | v5 peers `^1.9.0` — **no Leaflet bump** |
| `react-transition-group` | 4.4.5 | ⚠️ peer allows, code path breaks | 4.4.5 *is* latest — the fix is ours (item C) |
| `react-chartjs-2` | ^5.3.1 | ✅ peer includes `^19.0.0` | |
| `qrcode.react` | ^4.2.0 | ✅ peer includes `^19.0.0` | |
| `@iconify/react` | ^6.0.2 | ✅ peer `>=16` | permissive ≠ tested |
| `react-i18next` | ^17.0.11 | ✅ peer `>=16.8.0` | permissive ≠ tested |
| `prop-types` | ^15.7.2 → 15.8.1 | ✅ no react peer | direct dep, `client/package.json:33` — subject of item D |

Already modern, nothing to do: `client/src/index.js` uses `createRoot`; no `ReactDOM.render`, no `findDOMNode` in `src`, no JSX string refs.

**StrictMode is NOT enabled.** `client/src/index.js:8-13` renders `createRoot(...).render(<AppContextProvider><App /></AppContextProvider>)` with no wrapper; the only `StrictMode` matches in `src` are two prose comments. React 19 will not double-invoke anything here. *(The first draft treated double-invoke as a headline Pi-field-test risk. It is phantom — do not spend hardware time on it.)*

---

## Why a single-package bump still cannot be merged

Dependabot proposes `react-dom` alone. Real npm 10.9.7 output, verbatim:

```
npm error code ERESOLVE
npm error ERESOLVE unable to resolve dependency tree
npm error While resolving: pi-weather-station-client@2.2.0
npm error Found: react@18.3.1
npm error Could not resolve dependency:
npm error peer react@"^19.2.8" from react-dom@19.2.8
```

npm stops at the first conflict, so `react-leaflet`'s `^18` peer is not shown — it blocks identically on the next attempt. All three move in one commit.

⚠️ **Do not confuse this with a benign warning.** A *successful* install during the lockfile transition prints `npm warn ERESOLVE overriding peer dependency / Found: react@18.3.1 / Conflicting peer...` and then succeeds. Same shape, `warn` not `error`. Check the prefix before backing out.

**What a half-bump does NOT do:** it does not break fleet deploys. See "Deployment" below — the first draft was wrong about this.

---

## Work items

### A. `defaultProps` → destructuring defaults — highest volume, silent failure

**Mechanism (corrected).** React 19 did *not* universally remove `defaultProps`. `React.createElement` still resolves them (`react/cjs/react.development.js:1037`). The **automatic JSX runtime does not** — `react-jsx-runtime` contains zero occurrences of `defaultProps`. This codebase compiles every JSX element through `jsx()` because `client/.babelrc` sets `["@babel/preset-react", { "runtime": "automatic" }]`, and there is no `React.createElement` anywhere in `client/src`. So the defaults are genuinely dead **here** — but anyone spot-checking in a REPL with `createElement` will see them still working and wrongly conclude there is no problem. Class components also keep `defaultProps`; the only class in `src` is `BucketErrorBoundary` (`DebugPanel/index.js:646`) and it has none.

**No diagnostic is emitted.** Probed with `react-dom/server`, capturing both `console.error` and `console.warn`: zero messages.

**Surface: 16 sites / 12 files — but 3 are already dead code**, so the real conversion is **13**. Deleting these three is a provable no-op (their signatures already carry identical destructuring defaults, or the value is neutralised downstream):

```
components/ambient/MetricsGrid/index.js:271      ← already shadowed by :55, delete
components/ambient/AirCard/index.js:305          ← already shadowed by :61, delete
components/ambient/RailSquareButton/index.js:48  ← neutralised by `${className || ""}` at :31, delete
```

The 13 that need real conversion:

```
components/ambient/MoonDetailsPopover/index.js:131
components/ambient/MetricsGrid/index.js:251        (Cell)
components/ambient/AirCard/index.js:291            (Row)
components/ambient/AstroMetaLine/index.js:140
components/ambient/QrCode/index.js:63
components/ambient/DetailsPopover/index.js:263
components/ambient/TimeBlock/index.js:186
components/ambient/LocationDetailsPopover/index.js:147
components/ambient/HeroCompact/index.js:180
components/ambient/SunDetailsPopover/index.js:147
components/WeatherMap/index.js:528                 (AlertGeometryOverlay)
components/WeatherMap/index.js:584                 (NearbyAlertsOverlay)
components/WeatherMap/index.js:632                 (SurveyAlertContent)
```

Re-grep before starting — `grep -rn "\.defaultProps" client/src/`.

**The real conversion hazard is referential identity, not falsiness.** *(The first draft warned about "falsy-vs-undefined distinctions, check anything defaulting to `0`/`""`/`false`". That warning is empty — both `defaultProps` and `= default` fire only on `undefined`, byte-identical trigger conditions.)*

The actual trap: `defaultProps` evaluated its object/array literal **once at module scope**, so an omitted prop kept the same reference on every render. A naive `= []` in the signature allocates a **fresh array per render**. Three sites are affected, all in `WeatherMap/index.js`: `AlertGeometryOverlay` `govAlerts: []`, `NearbyAlertsOverlay` `alerts: []`, `SurveyAlertContent` `alerts: []`.

**This collides directly with item B.1.** `AlertGeometryOverlay` has `useMemo(..., [govAlerts, highlightedAlertId])` that a fresh `[]` busts on every render — exactly the 1-4 Hz churn the memos exist to prevent. Items A and B.1 are the same problem, not two.

Severity is **latent, not active**: `govAlerts`/`nearbyAlerts` are `useState([])` (`AppContext.js:543`, `:564`) and always passed explicitly at the call sites (`WeatherMap` 1494/1504/1514), so the default never fires today. Preserve identity anyway — hoist a frozen module-scope constant rather than relying on that.

**Optional mechanical gate.** `react/require-default-props` with `{ functions: "defaultArguments" }` flags the whole class. Measured cost over full `src`: 151 → 200 warnings (+49, the extra being its companion "no corresponding default argument value"). A real tradeoff, but it converts "read each site carefully" into a checkable rule.

One concrete already-identified breakage: `QrCode/index.js:63` defaults `size: 96` and the signature at `:30` has no destructuring default; `size` is forwarded unguarded to `<QRCodeSVG>`, whose own `DEFAULT_SIZE` is **128**. Every QR code silently renders one third larger. Kiosk-visible, no error.

### B. react-leaflet 4.2.1 → 5.0.0 — **verified clean**

All 13 imported symbols still export from v5. Verified three ways: reading `node_modules/react-leaflet/lib/index.js`, checking `index.d.ts`, and a deliberate bad-import probe that made webpack enumerate its "possible exports" list.

```
MapContainer TileLayer WMSTileLayer AttributionControl ZoomControl Marker
Circle CircleMarker Polyline GeoJSON Popup useMap useMapEvents
```

⚠️ **A green build does not prove exports resolve.** Proven: importing a nonexistent symbol from `react-leaflet` produces only `export 'X' was not found` as a **warning**; webpack still exits 0. If you change the import block, grep the warnings or read `lib/index.js` — do not trust green.

*(The first draft justified this with "the only documented v5 removal is `LeafletProvider`, which we don't use." That reasoning is defective: `LeafletProvider` was never exported by react-leaflet's public barrel — it is `@react-leaflet/core`-internal, so no consumer was ever exposed to it. The conclusion is right; it rests on the export-surface check above, not on that.)*

**B.1 — the referential-stability memos: RESOLVED, no action.** The first draft left this open. `@react-leaflet/core@3.0.0` still diffs by reference — `circle.js` does `if (props.center !== prevProps.center)` and `props.radius !== prevProps.radius`; `path.js` `usePathOptions` does `if (props.pathOptions !== optionsRef.current)`. Unchanged from v4. The memos at `WeatherMap/index.js:~1118` remain necessary exactly as written. Just don't let item A reintroduce fresh references (above).

Still worth exercising by hand, unchanged from the first draft:

- **`index.js:~652`** — ZoomControl remount keyed on `i18n` (react-leaflet only forwards `position` to an existing control, so +/- titles would freeze in the mount-time language). Switch EN → FR → ES live with the map mounted.
- **`MapResizer.js`** — imperative `map.invalidateSize()` after each radar-focus toggle. Exercise `RadarFocusControl` on `LayoutPi` **and** `LayoutDesktop`.
- **`index.js:402-440` — `ZoomAnchorOffset` monkey-patches the live Leaflet instance** (`map.zoomIn` / `map.zoomOut` are replaced and restored in an effect cleanup, and it reads `map.options.zoomDelta` and calls `map.setZoomAround(map.containerPointToLatLng(anchor), ...)`). This is a *fourth* and more invasive coupling than the three the first draft listed — it depends on `useMap()` returning a stable instance and on Leaflet internals, not on react-leaflet's public API. Test zoom via the on-screen +/- buttons **and** pinch, and confirm the anchor offset still holds with the rail visible.

### C. `CSSTransition` `nodeRef` — the one hard breaker, and worse than it looks

Confirmed mechanically: `react-dom@19.2.8` exports no `findDOMNode` (`typeof === "undefined"`). `react-transition-group@4.4.5` calls `ReactDOM.findDOMNode(this)` at `cjs/Transition.js` lines 252, 276, 314, 378 — on exactly the `props.nodeRef ? … : findDOMNode(this)` branch. Exactly one `CSSTransition` in the tree, `UpdateModal/index.js:104`, and zero `nodeRef` anywhere in `client/src`. 4.4.5 is latest, so the fix is ours: add a `useRef`, pass `nodeRef`, attach the same ref to the transitioning child.

**Blast radius (the first draft understated this badly).** There is **no error boundary above `App`** — the only one is `BucketErrorBoundary` inside `DebugPanel`, which cannot catch a sibling. `client/src/index.js` renders with no boundary and no error options. An uncaught commit-phase throw therefore **unmounts the whole React root: blank kiosk until the browser reloads.**

**And it destroys the fleet's own recovery path.** `UpdateModal` is the only caller of `triggerUpdate()`. Ship the bump without this fix and the in-app updater becomes unusable — recovering 10 Pis then means SSH, by hand. See "Deployment" for the ordering constraint this imposes.

Mitigating: it is user-triggered (dock button / debug panel), never auto-opened by the update poller.

*(The first draft cited the April 2026 drag-scroll incident as "this file has history". **That is wrong — `UpdateModal` did not exist yet** at that commit; the incident was `useDragScroll` in the since-deleted v2 Settings/Debug panels. The report is still worth reading, but as a **transferable pattern**: under `CSSTransition unmountOnExit` the child DOM node does not exist when a mount-time `useEffect` runs, so a ref read there is `null`.)*

### D. `propTypes` — a decision, but option (b) is NOT available

React 19 ignores `propTypes` on function components — verified by probe: a string passed to a `number.isRequired` prop renders silently, no warning. 37 files declare them, and `CLAUDE.md` mandates them.

**Correction to the first draft:** it offered "(b) strip them" as a policy option. **That is a hard build break, not a choice.** `client/eslint.config.js:10` loads `react.configs.flat.recommended`, in which `react/prop-types` is severity **2 (error)**, and `client/webpack.config.js:4,:128` wires `ESLintPlugin` into the build with `failOnError` defaulting true. Removing PropTypes fails `npm run prod`.

So the live options are: **(a)** keep them as documentation and note in `CLAUDE.md` that React no longer enforces them, or **(c)** move to a checker that still runs at build time. Either way this is the maintainer's call — raise it, do not settle it inside a dependency migration. Note option (b), if ever chosen, also means dropping the direct `prop-types` dependency and relaxing the lint rule first.

### E. Ecosystem render check (not a StrictMode check)

`@iconify/react` and `react-i18next` have permissive peer ranges — "allowed", not "tested". Render-check each screen once. **Drop the double-invoke framing**: StrictMode is not enabled (see above).

---

## Verification strategy — and why the local gates are not enough

```bash
cd client && npm run prod
```

```bash
npm test
```

Both pass **before and after** the bump, and pass **with or without** fixes A and C. Measured: the sorted lint-warning sets pre- and post-fix are *identical*, 151 both times.

> ⚠️ **The first draft told you to "watch the lint count — a jump means something regressed." That is false comfort.** The local gates are provably blind to items A and C. Green means nothing here.

**Correction on the test suite:** the first draft said it "covers the server radar-trend pipeline only; it will not catch a single React regression." Wrong twice — there are **38 test files**, and 11 touch client code, including direct requires (`test/autoTabSelector.test.js` → `client/src/ui/autoTabSelector`, `test/brightnessRestore.test.js` → `client/src/services/brightnessRestore`) and drift guards in `test/verbatimSync.test.js` pinned to `client/src/ui/alertLogic.js` and `client/src/ui/hybrid.js`. Still React-blind for rendering, but touching those files can break tests — do not assume the suite is irrelevant.

**Add a dev-mode browser run.** `npm run prod` strips React's warnings entirely, so any React 19 migration warning that *does* exist can only ever appear in a development build. A production-only check can never surface them.

**The Pi is the real gate.** Minimum on-hardware checklist:

- **Open the update modal** (dock button) on every palette — this is item C's failure, and it blanks the whole screen
- Radar animation at 1-4 Hz — compare CPU/GPU against current behaviour (item A/B.1 churn)
- Zoom via on-screen +/- **and** pinch, rail visible (the `ZoomAnchorOffset` monkey-patch)
- Language switch EN → FR → ES with map mounted (ZoomControl titles)
- `RadarFocusControl` toggle on `LayoutPi` **and** `LayoutDesktop` (`invalidateSize`)
- **QR codes** — confirm size after the `size: 96` conversion
- Alert polygons + `RiskRing`; all palettes day/dusk/night/nightRed

Good targets: **RPi5-PWS5** (`192.168.6.55`, display-scale reference) and **StationMeteoP9** (`192.168.6.4`, 7" DSI, historically the most fragile renderer). Full host list is in the maintainer's fleet inventory — **not in this repo**, it is confidential.

---

## Deployment — the first draft's rationale was wrong

**The in-app updater never installs client dependencies.** `server/index.js:967-969` runs `npm ci --omit=dev --no-audit --no-fund` with `cwd: projectRoot` — the **repo root**, not `client/`. Root `package.json` has no `workspaces` key and its dependencies are server-only; `grep -c "react" package-lock.json` returns **0**.

Consequences, both corrections to the first draft:

- A merged half-bump breaks **dev and CI builds, not fleet deploys**. The "would break every deploy on the 10-Pi fleet" framing was unearned.
- This is **not** a server-dependency-class change. From the Pi's perspective it is a **dist-only change**: the committed `client/dist/bundle.min.js` is the entire delivery vehicle. Rebuilding and committing the bundle is the part that actually matters.
- One real exception: `deploy/install.sh:660-663` does run `npm ci` inside `client/`, but only under `--rebuild-client` or when `bundle.min.js` is missing. That is the sole path where client peer resolution reaches a Pi.

⚠️ **CI will not catch a stale bundle.** `.github/workflows/ci.yml:54-62` deliberately ignores the ` M` modified status and only fails on structural `dist` changes — the comment says so explicitly. Forgetting `npm run prod` produces a green CI and an inert deploy.

**Ordering constraint — this one matters.** The first draft suggested "bump first, code fallout in separate commits." That is **actively dangerous**: anyone deploying at the intermediate commit ships a fleet whose in-app updater throws and blanks the screen, recoverable only over SSH on 10 hosts. Either commit the bump **and** fix C together, or do not deploy any intermediate commit. Fix A can follow separately; fix C cannot.

Unchanged, still true:

- Two tracked lockfiles; **only `client/package-lock.json` changes here**. CI runs `server` and `client` as separate jobs with separate `npm ci`.
- Deployment and verification are two separate loops. `POST /api/update` is asynchronous — `{"ok":true}` means *accepted*. Verify by reading versions actually installed, never the lockfile or the curl response.
- Relaunch kiosks after deploy (`POST /api/relaunch-kiosk`); the new bundle does not appear until the browser reloads.
- The updater pre-flight 409s on a dirty tree, non-`master` branch, or detached HEAD. Run a read-only pre-flight first.
- Use a curated commit type (`chore(deps):` / `feat:`) — the fleet genuinely needs this deploy.

---

## Corrections to the first draft — do not re-derive these

| First draft said | Reality |
|---|---|
| Half-bump "would break every deploy on the 10-Pi fleet" | False. Updater's `npm ci` runs at repo root; zero react in root lockfile. Breaks CI/dev only. |
| "Server-dependency-class change, npm ci must re-resolve the whole tree" | False. Dist-only change from the Pi's perspective. |
| StrictMode double-invoke is a headline Pi risk | Phantom. StrictMode is not enabled anywhere. |
| "React 19 removed defaultProps for function components" | Imprecise. `createElement` still applies them; the *automatic JSX runtime* does not. Holds here only because `.babelrc` sets `runtime: "automatic"`. |
| Watch for "falsy-vs-undefined" when converting defaults | Empty concern — identical `undefined`-only semantics. The real hazard is **referential identity** of array/object defaults. |
| Items A and B.1 are unrelated | Same problem. Fresh `[]` defaults bust the very memos B.1 protects. |
| "Watch the lint count — a jump means regression" | False comfort. Build is byte-identically green with and without both fixes. |
| Test suite is server-only, React-blind | 38 files, 11 touch client code, with drift guards on `client/src/ui/*`. |
| propTypes option (b) "strip them" | Not available — `react/prop-types` is a lint **error** and ESLint runs in the build. |
| "Only documented v5 removal is LeafletProvider, which we don't use" | Non-evidence — it was never in react-leaflet's public barrel. Conclusion right, reasoning wrong. |
| UpdateModal "has history" from the April 2026 incident | Wrong file. `UpdateModal` did not exist then. Keep the report as a transferable pattern. |
| Item C is "one file" / "a runtime throw" | Unmounts the entire root (no error boundary) → blank kiosk, and disables the fleet's own update path. |
| ERESOLVE block | Was paraphrased. Verbatim output is above. |
| B.1 memos "unverified — may be redundant" | Verified: core v3 still diffs by reference. Memos stay. No action. |

---

## Still genuinely unverified

Everything above was established by running something. These were not:

- ❌ Runtime behaviour of `@iconify/react` and `react-i18next` under React 19 — peer ranges allow it, nobody rendered it
- ❌ Whether the `ZoomAnchorOffset` monkey-patch survives — it depends on Leaflet internals and `useMap()` instance stability, and was never exercised under v5
- ❌ Any Pi-hardware behaviour whatsoever — no on-device run was performed. Every performance and rendering claim about the kiosk remains theoretical.
- ❌ Whether a dev-mode build surfaces React 19 warnings that the production build strips
