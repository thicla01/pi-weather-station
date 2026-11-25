// Pins the narrower context subscriptions that
// keep a LayoutPi view switch from re-rendering components that don't use
// what changed. Mechanical, text-level guards in the spirit of
// react19Guards.test.js: a regression here has no build, lint or console
// signal, the UI renders the same, it is just slower on the kiosk.
//
//  1. LocationName reads the Location slice, never the legacy
//     AppContext union (re-minted by every slice change), and renders its
//     pin from one module-scope element.
//  2. The LayoutPi shell's state (piLayoutState, piRadarMaximized,
//     piScrubberOpen) lives in PiLayoutContext, owned by PiLayoutProvider
//     above the seven slices' provider: never in the System slice, never in
//     the union (spreading it back "for compatibility" would re-render every
//     union consumer at each switch again), its setters still in the Actions
//     slice. Its readers are a pinned list, and the components that only ask
//     "is LayoutPi mounted?" read the boolean PiLayoutMountedContext instead.
//  3. The dock's pieces a switch no longer renders: the dock's two
//     view-button glyphs are module-scope elements (their buttons' down
//     state follows the layout state), and the AI view's back button is
//     one memoized element while its handler and label hold. The map
//     chrome's side (the shell registry) is pinned by
//     test/shellElements.test.js and test/piShellGeometry.test.js.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC_DIR = path.join(__dirname, "..", "client", "src");
const read = (rel) => fs.readFileSync(path.join(SRC_DIR, rel), "utf8");

const LOCATION_NAME_JS = read("components/LocationName/index.js");

/**
 * The source of a module-level arrow-function component, from its
 * `const <name> = (` line to the first line that closes it (`};` at
 * column 0).
 *
 * @param {string} src module source
 * @param {string} name component name
 * @returns {string} the component's source
 */
const componentBody = (src, name) => {
  const start = src.indexOf(`\nconst ${name} = (`);
  assert.ok(start >= 0, `${name} not found`);
  const end = src.indexOf("\n};\n", start);
  assert.ok(end > start, `${name}: no closing "};" at column 0`);
  return src.slice(start, end);
};

test("LocationName subscribes to LocationContext, not the AppContext union", () => {
  assert.match(LOCATION_NAME_JS, /import \{ LocationContext \} from "~\/AppContext";/);
  assert.match(LOCATION_NAME_JS, /const \{ mapGeo, reverseGeoResult \} = useContext\(LocationContext\);/);
  assert.doesNotMatch(LOCATION_NAME_JS, /useContext\(AppContext\)/);
  assert.doesNotMatch(LOCATION_NAME_JS, /import \{[^}]*\bAppContext\b[^}]*\} from/);
});

test("LocationName renders its pin from one module-scope element", () => {
  assert.match(LOCATION_NAME_JS, /^const LOCATION_ICON = <InlineIcon icon=\{locationIcon\} \/>;$/m);
  const body = componentBody(LOCATION_NAME_JS, "LocationName");
  assert.doesNotMatch(body, /<InlineIcon\b/, "no InlineIcon element created inside the render");
  // Both branches (stacked and single-line) keep the icon, a space, then the text.
  assert.equal((body.match(/\{LOCATION_ICON\} \{(primary|name)\}/g) || []).length, 2);
});

// ------------------------------------------------------------- Pi-layout context

const APP_CONTEXT_JS = read("AppContext.js");
const PI_FIELDS = ["piLayoutState", "piRadarMaximized", "piScrubberOpen"];
const PI_SETTERS = ["setPiLayoutState", "setPiRadarMaximized", "setPiScrubberOpen"];

/**
 * A memoized slice of AppStateProvider, `const <name> = useMemo(() => ({`
 * to its deps list's `]);`, split into the object's keys and the deps.
 *
 * @param {string} name the slice variable (systemSlice, actionsSlice, …)
 * @returns {{keys: string[], deps: string[]}} the keys and the deps, in order
 */
const sliceOf = (name) => {
  const m = new RegExp(`const ${name} = useMemo\\(\\(\\) => \\(\\{([\\s\\S]*?)\\}\\), \\[([\\s\\S]*?)\\]\\);`).exec(APP_CONTEXT_JS);
  assert.ok(m, `${name} not found`);
  const names = (txt) => txt.split("\n")
    .map((l) => l.replace(/\/\/.*$/, "").trim())
    .filter(Boolean)
    .map((l) => l.replace(/[:,].*$/, "").replace(/^\.\.\./, "").trim());
  return { keys: names(m[1]), deps: names(m[2]) };
};

/**
 * Every client/src .js file, relative to client/src.
 *
 * @param {string} dir directory to walk (absolute)
 * @returns {string[]} the files, relative to SRC_DIR
 */
const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(p);
    return p.endsWith(".js") ? [path.relative(SRC_DIR, p)] : [];
  });
const SOURCES = walk(SRC_DIR).map((rel) => ({ rel, src: read(rel) }));

/**
 * The source of a module-level function declaration, from its
 * `function <name>(` line to the first `}` at column 0.
 *
 * @param {string} src module source
 * @param {string} name function name
 * @returns {string} the function's source
 */
const functionBody = (src, name) => {
  const start = src.search(new RegExp(`\\n(export )?function ${name}\\(`));
  assert.ok(start >= 0, `${name} not found`);
  const end = src.indexOf("\n}\n", start);
  assert.ok(end > start, `${name}: no closing "}" at column 0`);
  return src.slice(start, end);
};

test("Pi-layout context: the Pi-layout fields are in neither the System slice nor the union", () => {
  const system = sliceOf("systemSlice");
  for (const f of PI_FIELDS) {
    assert.ok(!system.keys.includes(f), `${f} in systemSlice`);
    assert.ok(!system.deps.includes(f), `${f} in systemSlice's deps`);
  }
  // The union spreads the seven slices and nothing else.
  const union = sliceOf("defaultContext");
  assert.deepEqual(union.keys, ["actionsSlice", "systemSlice", "locationSlice", "uiPrefsSlice", "weatherDataSlice", "alertsSlice", "radarStateSlice"]);
  assert.deepEqual(union.deps, union.keys);
  // No other slice picked them up either.
  for (const name of ["actionsSlice", "locationSlice", "uiPrefsSlice", "weatherDataSlice", "alertsSlice", "radarStateSlice"]) {
    for (const f of PI_FIELDS) assert.ok(!sliceOf(name).keys.includes(f), `${f} in ${name}`);
  }
});

test("Pi-layout context: the setters stay in the Actions slice, handed down from PiLayoutProvider", () => {
  const actions = sliceOf("actionsSlice");
  for (const f of PI_SETTERS) {
    assert.ok(actions.keys.includes(f), `${f} missing from actionsSlice`);
    assert.ok(actions.deps.includes(f), `${f} missing from actionsSlice's deps`);
  }
  assert.match(APP_CONTEXT_JS, /const \{ setPiLayoutState, setPiRadarMaximized, setPiScrubberOpen \} = useContext\(PiLayoutActionsContext\);/);
  // The actions context is internal, and its value is built once.
  assert.match(APP_CONTEXT_JS, /^const PiLayoutActionsContext = createContext\(null\);$/m);
  assert.match(APP_CONTEXT_JS, /const piLayoutActions = useMemo\(\(\) => \(\{\s*setPiLayoutState,\s*setPiRadarMaximized,\s*setPiScrubberOpen,\s*\}\), \[setPiRadarMaximized\]\);/);
});

test("Pi-layout context: PiLayoutProvider owns the state, above AppStateProvider, under a stateless root", () => {
  const pi = functionBody(APP_CONTEXT_JS, "PiLayoutProvider");
  assert.match(pi, /const \[piLayoutState, setPiLayoutState\] = useState\(null\);/);
  assert.match(pi, /const \[piScrubberOpen, setPiScrubberOpen\] = useState\(false\);/);
  assert.match(pi, /const piRadarMaximized = piLayoutState == null \? null : piLayoutState === "min";/);
  assert.match(pi, /const piLayoutSlice = useMemo\(\(\) => \(\{\s*piLayoutState,\s*piRadarMaximized,\s*piScrubberOpen,\s*\}\), \[piLayoutState, piRadarMaximized, piScrubberOpen\]\);/);
  assert.match(pi, /const piLayoutMounted = piLayoutState != null;/);
  assert.match(pi, /<PiLayoutMountedContext\.Provider value=\{piLayoutMounted\}>/);
  assert.match(pi, /<PiLayoutContext\.Provider value=\{piLayoutSlice\}>/);
  // The root holds no state: it only nests the two providers.
  const root = functionBody(APP_CONTEXT_JS, "AppContextProvider");
  assert.doesNotMatch(root, /use[A-Z]\w*\(/, "no hook in AppContextProvider");
  assert.match(root, /<PiLayoutProvider>\s*<AppStateProvider>\{children\}<\/AppStateProvider>\s*<\/PiLayoutProvider>/);
  // The state tree never declares the Pi-layout state again.
  const tree = functionBody(APP_CONTEXT_JS, "AppStateProvider");
  assert.ok(tree.length > 50000, "AppStateProvider's body found whole");
  assert.doesNotMatch(tree, /\[piLayoutState,|\[piScrubberOpen,|const piRadarMaximized =/);
});

test("Pi-layout context: nobody reads the Pi-layout fields from SystemContext or the union", () => {
  const destructures = /const \{([^}]*)\} = useContext\((SystemContext|AppContext)\);/g;
  for (const { rel, src } of SOURCES) {
    for (const m of src.matchAll(destructures)) {
      for (const f of PI_FIELDS) assert.ok(!new RegExp(`\\b${f}\\b`).test(m[1]), `${rel}: ${f} read from ${m[2]}`);
    }
    // The `const x = useContext(SystemContext)` form: no x.piLayoutState & co.
    for (const m of src.matchAll(/const (\w+) = useContext\((SystemContext|AppContext)\);/g)) {
      for (const f of PI_FIELDS) assert.ok(!src.includes(`${m[1]}.${f}`), `${rel}: ${m[1]}.${f}`);
    }
  }
});

test("Pi-layout context: the readers of the Pi-layout contexts are a pinned list", () => {
  const readers = (ctx) => SOURCES.filter(({ src }) => new RegExp(`useContext\\(${ctx}\\)`).test(src)).map(({ rel }) => rel).sort();
  // Exact state: the shell, the map, the forecast slab's MAX toggle, the
  // alert view's anti-stranding effect, the dock's button states.
  assert.deepEqual(readers("PiLayoutContext"), [
    "components/WeatherMap/index.js",
    "components/ambient/AlertView/index.js",
    "components/ambient/ChartTabs/index.js",
    "components/ambient/ControlButtons/index.js",
    "components/ambient/LayoutPi/index.js",
  ]);
  // "Am I on the Pi rail?" alone.
  assert.deepEqual(readers("PiLayoutMountedContext"), [
    "components/ambient/AlertBanner/index.js",
    "components/ambient/AlertDetailInline/index.js",
    "components/ambient/AlertMiniCards/index.js",
  ]);
  for (const rel of readers("PiLayoutMountedContext")) {
    assert.match(read(rel), /const isPi = useContext\(PiLayoutMountedContext\);/, rel);
  }
});

// ------------------------------------------------------------- the AI view

test("AI view: AiView is memoized and LayoutPi hands it two booleans only, so a view switch that leaves them unchanged doesn't render it", () => {
  const aiView = read("components/ambient/AiView/index.js");
  assert.match(aiView, /^export default React\.memo\(AiView\);$/m);
  assert.doesNotMatch(aiView, /^export default AiView;$/m);
  // Still the same component, its props typed on it.
  assert.match(aiView, /^const AiView = \(\{ active = true, replyReady = true \}\) => \{$/m);
  assert.match(aiView, /^AiView\.propTypes = \{$/m);
  // The element LayoutPi renders: two primitives, no inline object or
  // function a shallow compare would see as new at every render.
  const layout = read("components/ambient/LayoutPi/index.js");
  const element = layout.slice(layout.indexOf("<AiView"), layout.indexOf("/>", layout.indexOf("<AiView")) + 2);
  assert.match(element, /^<AiView\s+active=\{piLayoutState === "ai"\}\s+replyReady=\{!shellVariant \|\| \(shell\.mapState === "ai" && shell\.settled\)\}\s+\/>$/);
  // Still mounted under the overlay shell in every state (the paint
  // prewarm and the opening in the tap's commit rely on it).
  assert.match(layout, /\{\(shellVariant !== null \|\| piLayoutState === "ai"\) && \(\s*<div ref=\{aiHostRef\} className=\{styles\.aiHost\}>/);
});

// ------------------------------------------------------------- the dock

test("dock: BottomDock is memoized, so a layout's render never renders the dock, compiled layout or not", () => {
  // Without the memo the dock skipped a view switch's render only through
  // LayoutPi's compiled element cache. Its props are constants or a stable
  // ref everywhere.
  const dock = read("components/ambient/BottomDock/index.js");
  assert.match(dock, /^export default React\.memo\(BottomDock\);$/m);
  assert.doesNotMatch(dock, /^export default BottomDock;$/m);
  for (const rel of ["components/ambient/LayoutDesktop/index.js", "components/ambient/LayoutMobile/index.js"]) {
    assert.match(read(rel), /<BottomDock \/>/, rel);
  }
  assert.match(read("components/ambient/LayoutPi/index.js"), /<BottomDock piDockCell cellRef=\{shellVariant \? dockCellRef : undefined\} \/>/);
});

test("dock: the dock's view-button glyphs are module-scope elements, rendered in both of the AI button's branches and the forecast button", () => {
  const dock = read("components/ambient/ControlButtons/index.js");
  assert.match(dock, /^const AI_VIEW_ICON = <InlineIcon icon=\{sparkleIcon\} \/>;$/m);
  assert.match(dock, /^const FORECAST_VIEW_ICON = <InlineIcon icon=\{chartColumnIcon\} \/>;$/m);
  assert.equal((dock.match(/\{AI_VIEW_ICON\}/g) || []).length, 2);
  assert.equal((dock.match(/\{FORECAST_VIEW_ICON\}/g) || []).length, 1);
  assert.doesNotMatch(dock, /<InlineIcon icon=\{(sparkleIcon|chartColumnIcon)\} \/>(?!;)/, "no glyph element made in the render");
  // The dock's toast is dropped on leaving MID only while one is up, with no
  // state tracking the last layout seen (a second pass at every switch).
  assert.doesNotMatch(dock, /prevToastShellState|closeKey/);
});

test("AI view: its back button is one memoized element — a stable handler and its label as the only inputs", () => {
  const aiView = read("components/ambient/AiView/index.js");
  assert.match(aiView, /const back = useCallback\(\(\) => setPiLayoutState\("mid"\), \[setPiLayoutState\]\);/);
  assert.match(aiView, /const backButton = useMemo\(\(\) => \(\s*<RailSquareButton\s+icon=\{RestoreIcon\}\s+back\s+onClick=\{back\}\s+ariaLabel=\{backLabel\}\s+className=\{styles\.minimize\}\s*\/>\s*\), \[back, backLabel\]\);/);
  assert.match(aiView, /\{backButton\}/);
  assert.doesNotMatch(aiView, /onClick=\{\(\) => setPiLayoutState/);
});
