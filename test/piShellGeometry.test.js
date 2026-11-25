// Pins the numbers of LayoutPi's overlay shell in
// `client/src/ui/piShellGeometry.js` (CommonJS, so these tests run the real
// module) and their copy in `components/ambient/LayoutPi/styles.css`:
//   - the shell's variant values, the one the priority-views gate alone
//     selects (no localStorage key of its own), and the root attributes
//     LayoutPi derives from them (none at all for the grid shell);
//   - the geometry on the 800 × 480 panel: rail x 490–790 and y 10 to at
//     most 412, a 490 × 422 cleared map zone, a 58 px dock band, a 210 px
//     view strip;
//   - the map offsets WeatherMap's centring consumes, and where they put
//     the marker: (245, 211) in MID, the centre in MIN, (105, 211) in views;
//   - the map-chrome insets (attribution beside the rail, never under it)
//     and the survey popup's auto-pan padding (never under rail or dock);
//   - the CSS: custom properties equal to the module, every rule naming a
//     box of the shell's own gated on the root attribute, transitions on
//     transform / opacity only with `visibility` as a 0s step (boxes stay
//     laid out, hidden once their slide or fade ends; in MIN the dock cell
//     then leaves the render by a discrete `display` step, behind
//     `@supports`), nothing infinite, no will-change but the view sheet's
//     and the views' shield's, and no `visibility: visible` anywhere in
//     client/src;
//   - the map chrome in WeatherMap/styles.css: the per-state insets the
//     shell's root declares equal chromeFor, every rule reading them is
//     gated, the attribution moves by transform in step with the shell, and
//     each map overlay keeps one place in every state;
//   - the shell's dock: 44 px targets set only there (40 px everywhere
//     else), a main row that fits the band once marker / legend / rings /
//     debug move to the "···" menu, that menu gated on the shell in
//     ControlButtons, kept out of ControlButtons' `div` wildcard rules,
//     touch-safe (no hover, no blur, no motion) and labelled in EN/FR/ES;
//   - the rail cards: NowcastLine's opaque alarm tiers and calm line on
//     --c-surface, nightRed's 96 % surface on the shell's root (not in
//     ui/tokens.js), 10 px on-screen card gaps, and HeroCompact's inline
//     condition icon, a prop only LayoutPi passes, under the shell only,
//     that keeps the hero at 82 internal px — all inert without the shell;
//   - the views: a padding-free sheet that is the view's surface (the
//     forecast and alert cards flattened, the conditions and AI hosts
//     inset), and a gesture shield over the whole map and rail from the
//     first frame of the slide; on MIN ↔ MID, a shield over the dock's
//     band (mounted once, `[data-pi-dock-shield]` / `data-active`) until
//     the dock has finished moving, or 300 ms after a one-frame switch;
//   - the "···" menu opening clear of the attribution strip, and handing
//     focus back to its trigger when closed from the keyboard;
//   - the shell's easing as an approximation of Leaflet's pan curve (within
//     3 % of the travel), and RailOffsetTracker's default-free parameter
//     pattern;
//   - the timing: one React update per switch, every slide and fade in CSS
//     from that commit (the rail, dock and sheet `visibility: hidden` and
//     inert once out, and laid out bar the dock cell in MIN once its slide
//     is over, behind `@supports`); which frame the chrome and
//     the map each change on (a view's map recentre once the SHEET's own
//     transform transition has ended; one-frame closes; reduced motion's
//     one frame, MIN ↔ MID and the views alike; form 2's one frame); the
//     end signal (the transitions' own Animation.finished, read two frames
//     after the commit so it forces no style recalc, and a guarded fallback
//     armed once they have started), `data-pi-moving`, the views' shield
//     held until the close has settled, and the CSS / JSX wiring;
//   - the dock toast centred over the cleared zone 8 px above the legend
//     chip (x 245, bottom 116, ≤ 458 px wide), 44 px touch areas around
//     the dock chip and the two ⤢ squares, the hero's ⤢ 4 px higher,
//     nightRed without hard-coded white (dock counter,
//     health chip, play button, Leaflet flag; never the strip), the
//     attribution's MID ↔ MIN travel of (310, 58) to MIN's right 6 /
//     bottom 2, and the map overlays' MIN ↔ MID fades (all pre-mounted,
//     one live per state; out in 100 ms as the slide starts, in over
//     150 ms after a 150 ms delay: every transition of the shell on
//     transform / opacity, ≤ 250 ms each, done by 300 ms, and every
//     duration and delay 0 in form 2 and under reduced motion);
//   - the ⤢ touch areas 44 px ON SCREEN at every text size (44 px /
//     --c-font-scale, centred), the dock band shield's cut-out over an
//     arriving scrubber (a visible control never loses a tap) with its
//     double-tap guard over the dock click that started the switch (a
//     double tap's second tap never reaches the scrubber; kept beside the
//     event guard the timeline button arms, test/tapGuard.test.js), the
//     scrubber's first input engaging its work at once (one synchronous
//     commit, then the input acts, rather than queuing the input until the
//     work is ready), and the AI view's reply held outside React state
//     until the opening has settled, then one more frame (the request
//     itself starts at the tap);
//   - the view hosts stacked in the sheet's one cell and always laid out
//     (the AI view's too, `active` in its own state only and cleared on
//     close), the other states' skipped by `content-visibility: hidden`
//     and tap-proof (hidden instead without content-visibility); the
//     forecast slab maximized in every state and its chart sized from its
//     box; the per-state chrome insets set on their readers, never
//     redefined on the root, and every rule keyed on a switch's state
//     ending on a class or an attribute (the dock cell is
//     `[data-pi-dock-cell]`); the sheet's one-frame pre-roll (0 in form 2
//     and under reduced motion);
//   - the switch's transitions read two frames after its commit, never in
//     it (no forced style recalc in the tap); the hidden conditions and
//     alert hosts laid out once ahead of their first opening (one idle
//     frame each, sheet closed); the hidden chart sized again on a tab
//     change, from a box that ignores the canvas;
//   - reduced motion: no transition at all in the shell's moving set (the
//     rail frame, dock, sheet and overlays with everything inside them,
//     and the attribution corner), a guard behind styles/main.css, which
//     removes every transition under reduced motion since PR 411.
// Form 2 ("d1-form2") and "d1-still" are the shell's fallback forms, kept
// but unreachable (ui/piShellGeometry.js); their tests stay until the forms
// are removed.
// Run: `npm test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  PI_SHELL_VARIANTS,
  SHIPPED_SHELL_VARIANT,
  VIEW_STATES,
  SHELL_GEOMETRY,
  SHELL_MOTION,
  SHELL_SLIDE_END_FALLBACK_MS,
  SHELL_END_RECHECK_MS,
  SHELL_ONE_FRAME_SHIELD_MS,
  SHELL_MODES,
  isViewState,
  shellMode,
  shellSwitchPlan,
  initialShellSwitch,
  nextShellSwitch,
  recentresInstantly,
  motionEnd,
  dockShieldMode,
  viewShieldHeld,
  settleHoldMs,
  scrubberFlagClears,
  overlayPlacement,
  overlayPresentation,
  toastPlacement,
  ATTRIBUTION_EDGE_GAP,
  ATTRIBUTION_VIEW_MAX_WIDTH,
  ATTRIBUTION_BOTTOM_GAP,
  POPUP_EDGE_PADDING,
  parsePiShellVariant,
  piShellForm,
  piShellRootAttributes,
  shellVariantFor,
  railLeft,
  railMaxHeight,
  clearedZone,
  railOffsetFor,
  viewPaneShift,
  markerPoint,
  chromeFor,
  popupAutoPanPadding,
} = require("../client/src/ui/piShellGeometry");

const SRC_DIR = path.join(__dirname, "..", "client", "src");
const LAYOUT_PI_CSS = fs.readFileSync(path.join(SRC_DIR, "components", "ambient", "LayoutPi", "styles.css"), "utf8");
const WEATHER_MAP_CSS = fs.readFileSync(path.join(SRC_DIR, "components", "WeatherMap", "styles.css"), "utf8");
const PI_LAYOUT_JS = fs.readFileSync(path.join(SRC_DIR, "ui", "piLayout.js"), "utf8");
const AMBIENT_DIR = path.join(SRC_DIR, "components", "ambient");
const BOTTOM_DOCK_CSS = fs.readFileSync(path.join(AMBIENT_DIR, "BottomDock", "styles.css"), "utf8");
const CONTROL_BUTTONS_CSS = fs.readFileSync(path.join(AMBIENT_DIR, "ControlButtons", "styles.css"), "utf8");
const CONTROL_BUTTONS_JS = fs.readFileSync(path.join(AMBIENT_DIR, "ControlButtons", "index.js"), "utf8");
const OVERFLOW_MENU_CSS = fs.readFileSync(path.join(AMBIENT_DIR, "DockOverflowMenu", "styles.css"), "utf8");
const OVERFLOW_MENU_JS = fs.readFileSync(path.join(AMBIENT_DIR, "DockOverflowMenu", "index.js"), "utf8");
const HEALTH_CSS = fs.readFileSync(path.join(AMBIENT_DIR, "HealthIndicator", "styles.css"), "utf8");
const CHART_TABS_CSS = fs.readFileSync(path.join(AMBIENT_DIR, "ChartTabs", "styles.css"), "utf8");
const ALERT_VIEW_CSS = fs.readFileSync(path.join(AMBIENT_DIR, "AlertView", "styles.css"), "utf8");
const LOCALES_DIR = path.join(SRC_DIR, "i18n", "locales");
const NOWCAST_CSS = fs.readFileSync(path.join(AMBIENT_DIR, "NowcastLine", "styles.css"), "utf8");
const HERO_CSS = fs.readFileSync(path.join(AMBIENT_DIR, "HeroCompact", "styles.css"), "utf8");
const HERO_JS = fs.readFileSync(path.join(AMBIENT_DIR, "HeroCompact", "index.js"), "utf8");
const LAYOUT_PI_JS = fs.readFileSync(path.join(AMBIENT_DIR, "LayoutPi", "index.js"), "utf8");
const SHELL_TIMING_JS = fs.readFileSync(path.join(AMBIENT_DIR, "LayoutPi", "useShellTiming.js"), "utf8");
const BOTTOM_DOCK_JS = fs.readFileSync(path.join(AMBIENT_DIR, "BottomDock", "index.js"), "utf8");
const WEATHER_MAP_JS = fs.readFileSync(path.join(SRC_DIR, "components", "WeatherMap", "index.js"), "utf8");
const LAYOUT_MOBILE_JS = fs.readFileSync(path.join(AMBIENT_DIR, "LayoutMobile", "index.js"), "utf8");
const LAYOUT_DESKTOP_JS = fs.readFileSync(path.join(AMBIENT_DIR, "LayoutDesktop", "index.js"), "utf8");
const TOKENS_JS = fs.readFileSync(path.join(SRC_DIR, "ui", "tokens.js"), "utf8");
const FONT_SIZE_JS = fs.readFileSync(path.join(SRC_DIR, "ui", "fontSize.js"), "utf8");
const FMB_CSS = fs.readFileSync(path.join(AMBIENT_DIR, "FloatingMiniBanner", "styles.css"), "utf8");
const ALERT_BANNER_CSS = fs.readFileSync(path.join(AMBIENT_DIR, "AlertBanner", "styles.css"), "utf8");
const RAIL_SQUARE_CSS = fs.readFileSync(path.join(AMBIENT_DIR, "RailSquareButton", "styles.css"), "utf8");
const RESET_CSS = fs.readFileSync(path.join(SRC_DIR, "ui", "reset.css"), "utf8");
const FMB_JS = fs.readFileSync(path.join(AMBIENT_DIR, "FloatingMiniBanner", "index.js"), "utf8");
const RADAR_LEGEND_JS = fs.readFileSync(path.join(SRC_DIR, "components", "WeatherMap", "RadarLegend.js"), "utf8");
const RADAR_TIMELINE_JS = fs.readFileSync(path.join(SRC_DIR, "components", "WeatherMap", "RadarTimeline.js"), "utf8");
const AI_VIEW_JS = fs.readFileSync(path.join(AMBIENT_DIR, "AiView", "index.js"), "utf8");
const CHART_TABS_JS = fs.readFileSync(path.join(AMBIENT_DIR, "ChartTabs", "index.js"), "utf8");
const METRIC_CHART_JS = fs.readFileSync(path.join(AMBIENT_DIR, "weatherCharts", "MetricChart", "index.js"), "utf8");
const USE_AI_SUMMARY_JS = fs.readFileSync(path.join(SRC_DIR, "components", "hooks", "useAiSummary.js"), "utf8");
// Leaflet's own source, to pin the pan defaults the shell's slides copy. Only
// present where the client's dependencies are installed (not in CI's
// server job), so that test skips without it.
const LEAFLET_SRC = path.join(__dirname, "..", "client", "node_modules", "leaflet", "dist", "leaflet-src.js");

const W = 800;
const H = 480;

/**
 * Blank out CSS comments so selectors and declarations can be scanned.
 *
 * @param {string} css stylesheet source
 * @returns {string} the source without comments
 */
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * Innermost CSS rules (selector + declaration block), at-rule wrappers
 * skipped, so a rule nested in `@media` is returned with its own selector.
 *
 * @param {string} css stylesheet source
 * @returns {Array<{selector: string, body: string}>} rules in source order
 */
// The view sheet's warm pose: one idle frame per view host at rest, the warm-up test.
const WARM_POSE = '.layout[data-pi-shell][data-pi-state="mid"][data-pi-warm] .sheet, .layout[data-pi-shell][data-pi-state="min"][data-pi-warm] .sheet';

const rulesOf = (css) =>
  [...stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1].trim().replace(/\s+/g, " "),
    body: m[2],
  }));

/**
 * Split a declaration value on its top-level commas (not inside parentheses).
 *
 * @param {string} value declaration value
 * @returns {string[]} trimmed items
 */
const splitTopLevel = (value) => {
  const items = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === "(") depth += 1;
    else if (value[i] === ")") depth -= 1;
    else if (value[i] === "," && depth === 0) {
      items.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  items.push(value.slice(start).trim());
  return items;
};

/**
 * Custom-property declarations of a declaration block.
 *
 * @param {string} body declaration block
 * @returns {Map<string, string>} property name → trimmed value
 */
const customProps = (body) =>
  new Map([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

/**
 * Recursively collect every stylesheet under a directory.
 *
 * @param {string} dir directory to walk
 * @returns {string[]} absolute paths of the `.css` files
 */
const cssFiles = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return cssFiles(full);
    return e.name.endsWith(".css") ? [full] : [];
  });

// The map-chrome custom properties for WeatherMap, in two groups: those
// following the chrome's state (`data-pi-state`: the map hidden at the
// right, and the legend's detail sheet above the dock — nothing that moves
// on a switch reads them) and the attribution's, following the map's
// (`data-pi-map`). MID's values are declared on the shell's root; the other
// states' on their readers in WeatherMap/styles.css (the legend's detail
// sheet, the attribution corner), keyed on the root's attributes, never
// redefined on the root (an inherited property changed there restyles its
// whole subtree on every switch). `--c-rail-visible-width` has MID's value
// only: nothing reads it under the overlay shell.
const CHROME_STATE_PROPS = ["--c-rail-visible-width", "--c-map-bottom-inset"];
const MAP_STATE_PROPS = ["--c-attr-right", "--c-attr-bottom", "--c-attr-max-width"];
const CHROME_PROPS = [...CHROME_STATE_PROPS, ...MAP_STATE_PROPS];
// Of those, the ones that exist only under the overlay shell (LayoutDesktop also sets
// --c-rail-visible-width, its own long-standing contract).
const SHELL_ONLY_PROPS = ["--c-map-bottom-inset", "--c-attr-right", "--c-attr-bottom", "--c-attr-max-width"];

/**
 * Evaluate a chrome inset of the shell as the CSS would on a given viewport width:
 * `<n>px`, `calc(100vw - <n>px)` or `none` (→ null). Anything else throws,
 * so a new form in the stylesheet has to be taught here.
 *
 * @param {string} value declared custom-property value
 * @param {number} viewportWidth CSS px standing for 100vw
 * @returns {?number} CSS px, or null for `none`
 */
const evalInset = (value, viewportWidth) => {
  if (value === "none") return null;
  let m = value.match(/^(-?\d+(?:\.\d+)?)px$/);
  if (m) return Number(m[1]);
  m = value.match(/^calc\(100vw - (\d+(?:\.\d+)?)px\)$/);
  if (m) return viewportWidth - Number(m[1]);
  throw new Error(`unexpected inset value: ${value}`);
};

// The readers of the per-state insets in WeatherMap/styles.css, after the
// root's `:global([data-pi-shell][…])` key.
const LEGEND_SHEET = ".legend-overlay-sheet";
const ATTRIBUTION_CORNER = ".map-wrapper :global(.leaflet-bottom.leaflet-right)";

/**
 * The shell's chrome insets their readers see in a settled LayoutPi state
 * (chrome and map agree): the base `.layout[data-pi-shell]` block (MID),
 * inherited, overridden on the legend's detail sheet by its
 * `data-pi-state` rule and on the attribution corner by its `data-pi-map`
 * rule, as the cascade does (the two groups are disjoint, so one map
 * holds both readers' values).
 *
 * @param {string} state `data-pi-state` / `data-pi-map` value
 * @returns {Map<string, string>} custom property → declared value
 */
const chromePropsFor = (state) => {
  const props = new Map();
  const root = rulesOf(LAYOUT_PI_CSS).find((r) => r.selector === ".layout[data-pi-shell]");
  for (const [k, v] of customProps(root.body)) if (CHROME_PROPS.includes(k)) props.set(k, v);
  for (const { selector, body } of rulesOf(WEATHER_MAP_CSS)) {
    const parts = selector.split(",").map((p) => p.trim());
    const applies = parts.some(
      (p) => p === `:global([data-pi-shell][data-pi-state="${state}"]) ${LEGEND_SHEET}`
        || p === `:global([data-pi-shell][data-pi-map="${state}"]) ${ATTRIBUTION_CORNER}`,
    );
    if (!applies) continue;
    for (const [k, v] of customProps(body)) if (CHROME_PROPS.includes(k)) props.set(k, v);
  }
  return props;
};

test("variants: only the shell's three form values parse; anything else is null (the grid shell); no key of its own selects them", () => {
  assert.deepEqual([...PI_SHELL_VARIANTS], ["d1", "d1-form2", "d1-still"]);
  for (const v of PI_SHELL_VARIANTS) assert.equal(parsePiShellVariant(v), v);
  // Nothing else parses; no case or whitespace folding.
  for (const v of [null, undefined, "", "on", "D1", " d1", "d1 ", "d1-other", "true"]) {
    assert.equal(parsePiShellVariant(v), null, `${JSON.stringify(v)} must not select the overlay shell`);
  }
});

test("variants: form and root attributes per variant; none at all for the grid shell", () => {
  assert.equal(piShellForm(null), null);
  assert.equal(piShellForm("d1"), 1);
  assert.equal(piShellForm("d1-still"), 1);
  assert.equal(piShellForm("d1-form2"), 2);

  const none = piShellRootAttributes(null);
  assert.deepEqual(Object.keys(none), [], "the grid shell must get no extra root attribute");
  assert.ok(Object.isFrozen(none));
  assert.deepEqual(piShellRootAttributes("bogus"), {});

  assert.deepEqual(piShellRootAttributes("d1"), { "data-pi-shell": "d1", "data-pi-form": "1" });
  assert.deepEqual(piShellRootAttributes("d1-form2"), { "data-pi-shell": "d1", "data-pi-form": "2" });
  assert.deepEqual(piShellRootAttributes("d1-still"), {
    "data-pi-shell": "d1",
    "data-pi-form": "1",
    "data-pi-variant": "still",
  });
});

// JS source without its comments (block and whole-line).
const jsCode = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("activation: the overlay shell's form 1 under the priority views, the grid shell elsewhere; no key of its own", () => {
  assert.equal(SHIPPED_SHELL_VARIANT, "d1");
  assert.ok(PI_SHELL_VARIANTS.includes(SHIPPED_SHELL_VARIANT));
  assert.equal(shellVariantFor(true), "d1");
  assert.equal(shellVariantFor(false), null);
  // At 800 × 480: the overlay shell's form 1 root, with no variant attribute.
  assert.deepEqual(piShellRootAttributes(shellVariantFor(true)), { "data-pi-shell": "d1", "data-pi-form": "1" });
  assert.deepEqual(piShellRootAttributes(shellVariantFor(false)), {});
  assert.equal(piShellForm(shellVariantFor(true)), 1);
  assert.deepEqual(railOffsetFor("min", shellVariantFor(true)), { x: 0, y: 0 }, "MIN recentres (not d1-still's MID anchor)");
  assert.equal(railOffsetFor("mid", shellVariantFor(false)), null, "the grid shell keeps its own offset logic");
  assert.match(PI_LAYOUT_JS, /export function piShellVariant\(\) \{\s*return shellVariantFor\(priorityViewsEnabled\(\)\);\s*\}/);
});

test("activation: no client code reads or writes a piShell localStorage key", () => {
  const jsFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return jsFiles(full);
    return e.name.endsWith(".js") ? [full] : [];
  });
  const files = jsFiles(SRC_DIR);
  assert.ok(files.length > 100, `walked ${files.length} files`);
  for (const file of files) {
    assert.doesNotMatch(jsCode(fs.readFileSync(file, "utf8")), /(["'`])piShell\1|\.piShell\b/, path.relative(SRC_DIR, file));
  }
});

test("activation: LayoutDesktop and LayoutMobile never take the overlay shell", () => {
  for (const [name, src] of [["LayoutDesktop", LAYOUT_DESKTOP_JS], ["LayoutMobile", LAYOUT_MOBILE_JS]]) {
    assert.doesNotMatch(jsCode(src), /piShellVariant|piShellRootAttributes|data-pi-shell|setPiLayoutState/, name);
    assert.match(src, /<WeatherMap zoom=\{defaultMapZoom\} dark=\{darkMode\} \/>/, name);
  }
  // Outside LayoutPi, the readers also require a mounted LayoutPi.
  assert.match(CONTROL_BUTTONS_JS, /const dockOverflow = inPiDock && piShellVariant\(\) !== null;/);
  assert.match(WEATHER_MAP_JS, /const shellOffset = railOffsetFor\(shellState, piShellVariant\(\)\);/);
});

test("view states mirror MAX_VIEWS in ui/piLayout.js", () => {
  const m = PI_LAYOUT_JS.match(/const MAX_VIEWS = \[([^\]]*)\];/);
  assert.ok(m, "ui/piLayout.js no longer declares `const MAX_VIEWS = [ … ];`");
  const maxViews = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  assert.deepEqual([...VIEW_STATES].sort(), maxViews.sort());
});

test("geometry on 800 × 480: rail x 490–790, y 10–412 at most; 490 × 422 clear; 58 px dock", () => {
  assert.equal(railLeft(W), 490);
  assert.equal(railLeft(W) + SHELL_GEOMETRY.railWidth, W - SHELL_GEOMETRY.railRight);
  assert.equal(SHELL_GEOMETRY.railTop, 10);
  assert.equal(railMaxHeight(H), 402);
  assert.equal(SHELL_GEOMETRY.railTop + railMaxHeight(H) + SHELL_GEOMETRY.railDockGap, H - SHELL_GEOMETRY.dockHeight);
  assert.deepEqual(clearedZone(W, H), { width: 490, height: 422 });
  // Dock band: 1 px hairline + 6 px padding + 44 px button + 6 px = 57, so
  // the band needs its explicit 58.
  assert.equal(SHELL_GEOMETRY.dockHeight, 58);
  assert.ok(1 + 6 + 44 + 6 <= SHELL_GEOMETRY.dockHeight);
  assert.equal(SHELL_GEOMETRY.sheetLeft, 210);
  // Internal rail budget at density L (zoom 1.15): 349.6.
  assert.equal(Math.round((railMaxHeight(H) / 1.15) * 10) / 10, 349.6);
});

test("offsets: MID {310, −58}, MIN zero, views MID's (Leaflet at its MID pose); null without the overlay shell", () => {
  assert.deepEqual(railOffsetFor("mid", "d1", W), { x: 310, y: -58 });
  assert.deepEqual(railOffsetFor("min", "d1", W), { x: 0, y: 0 });
  for (const view of VIEW_STATES) {
    assert.equal(railOffsetFor(view, "d1", W), railOffsetFor("mid", "d1", W), view);
  }
  // Form 2 uses form 1's offsets.
  assert.deepEqual(railOffsetFor("mid", "d1-form2", W), { x: 310, y: -58 });
  assert.deepEqual(railOffsetFor("min", "d1-form2", W), { x: 0, y: 0 });
  // d1-still: MIN keeps the MID offset, so MIN ↔ MID never pans.
  assert.deepEqual(railOffsetFor("min", "d1-still", W), railOffsetFor("mid", "d1-still", W));
  assert.deepEqual(railOffsetFor("max", "d1-still", W), { x: 310, y: -58 });

  assert.equal(railOffsetFor("mid", null, W), null, "the grid shell keeps its own offset logic");
  assert.equal(railOffsetFor(null, "d1", W), null, "no LayoutPi mounted");
  assert.equal(railOffsetFor("bogus", "d1", W), null);
});

test("offsets are frozen and identity-stable (safe in React dependency arrays)", () => {
  assert.ok(Object.isFrozen(railOffsetFor("mid", "d1", W)));
  assert.ok(Object.isFrozen(railOffsetFor("min", "d1", W)));
  assert.equal(railOffsetFor("mid", "d1", W), railOffsetFor("mid", "d1-form2", W));
  const shift = viewPaneShift(W);
  assert.ok(Object.isFrozen(shift));
  assert.equal(viewPaneShift(W), shift, "same width → same object");
  assert.notEqual(viewPaneShift(819), shift, "new width → new object");
});

test("marker: (245, 211) in MID, centre in MIN, (105, 211) in views by the panes' (−140, 0) translate", () => {
  // Views: Leaflet's MID pose plus the map pane's CSS translate.
  const at = (state, variant = "d1", w = W, h = H) => {
    const p = markerPoint(railOffsetFor(state, variant, w), w, h);
    if (!VIEW_STATES.includes(state)) return p;
    const s = viewPaneShift(w);
    return { x: p.x + s.x, y: p.y + s.y };
  };
  assert.deepEqual(at("mid"), { x: 245, y: 211 });
  const zone = clearedZone(W, H);
  assert.deepEqual(at("mid"), { x: zone.width / 2, y: zone.height / 2 });
  assert.deepEqual(at("min"), { x: 400, y: 240 });
  assert.deepEqual(viewPaneShift(W), { x: -140, y: 0 }, "(−140, 0) on 800 px");
  for (const view of VIEW_STATES) {
    assert.deepEqual(at(view), { x: SHELL_GEOMETRY.sheetLeft / 2, y: 211 }, view);
  }
  assert.deepEqual(at("max"), { x: 105, y: 211 });
  // d1-still: 155 px left of and 29 px above the centre in MIN.
  assert.deepEqual(at("min", "d1-still"), { x: 400 - 155, y: 240 - 29 });
  // Pan vectors (view centre moves by these, Leaflet panBy sign).
  const mid = at("mid");
  const min = at("min");
  assert.deepEqual({ x: min.x - mid.x, y: min.y - mid.y }, { x: 155, y: 29 });
  // A display-scaled panel squeezed to 480 CSS px (1024 × 600 at 1.25 →
  // 819 px wide): the rail anchors right, the marker stays centred in the
  // cleared zone.
  const wide = clearedZone(819, H);
  assert.deepEqual(at("mid", "d1", 819), { x: wide.width / 2, y: wide.height / 2 });
  assert.deepEqual(at("ai", "d1", 819), { x: 105, y: 211 });
});

test("chrome: attribution 6 px beside the rail / sheet / edge and 2 px above the dock / edge, never under them", () => {
  const mid = chromeFor("mid", W);
  assert.deepEqual(mid, { railVisibleWidth: 316, mapBottomInset: 58, attrRight: 316, attrBottom: 60, attrMaxWidth: null });
  assert.equal(mid.railVisibleWidth, W - railLeft(W) + ATTRIBUTION_EDGE_GAP);
  assert.ok(mid.attrBottom > SHELL_GEOMETRY.dockHeight);

  for (const view of VIEW_STATES) {
    assert.deepEqual(chromeFor(view, W), { railVisibleWidth: 596, mapBottomInset: 0, attrRight: 596, attrBottom: 2, attrMaxWidth: 192 }, view);
  }
  // Settled, the attribution keeps 6 px from whatever hides the map at
  // the right (the rail, the sheet, nothing in MIN) and 2 px from the band
  // below (the dock, nothing elsewhere) — the offset's own spans.
  // (Views: what hides the map is the sheet, W − 210 wide, not Leaflet's offset, which stays MID's.)
  for (const state of ["mid", "min", ...VIEW_STATES]) {
    const offset = VIEW_STATES.includes(state) ? { x: W - SHELL_GEOMETRY.sheetLeft, y: 0 } : railOffsetFor(state, "d1", W);
    const c = chromeFor(state, W);
    assert.equal(c.attrRight, offset.x + ATTRIBUTION_EDGE_GAP, state);
    assert.equal(c.attrBottom, Math.max(0, -offset.y) + ATTRIBUTION_BOTTOM_GAP, state);
  }
  // Right edge at 800 − 596 = 204, 6 px short of the sheet; the 192 px
  // two-line block then fits the 210 px strip.
  assert.equal(W - chromeFor("max", W).railVisibleWidth, SHELL_GEOMETRY.sheetLeft - ATTRIBUTION_EDGE_GAP);
  assert.ok(ATTRIBUTION_VIEW_MAX_WIDTH <= W - chromeFor("max", W).railVisibleWidth);

  // MIN: the design's right 6, bottom 2; the legend / timeline insets back
  // to the corners.
  assert.deepEqual(chromeFor("min", W), { railVisibleWidth: 0, mapBottomInset: 0, attrRight: 6, attrBottom: 2, attrMaxWidth: null });
  assert.equal(chromeFor(null, W), null);
});

test("chrome: MID ↔ MIN moves the attribution by translate(310px, 58px) — the rail's and the dock's own travel", () => {
  const mid = chromeFor("mid", W);
  const min = chromeFor("min", W);
  const travel = { x: mid.attrRight - min.attrRight, y: mid.attrBottom - min.attrBottom };
  assert.deepEqual(travel, { x: 310, y: 58 });
  // The rail slides its width plus its right gap, the dock its height:
  // same distance, same 250 ms curve, so the 6 / 2 px gaps hold on every
  // frame, and the end of the move is MIN's place (nothing set after).
  assert.equal(travel.x, SHELL_GEOMETRY.railWidth + SHELL_GEOMETRY.railRight);
  assert.equal(travel.y, SHELL_GEOMETRY.dockHeight);
  // CSS: the rail's MIN pose is its own width plus the right gap, the
  // dock's its own height (the 58 px band), as the attribution's.
  assert.match(
    ruleBody(LAYOUT_PI_CSS, '.layout[data-pi-shell][data-pi-state="min"] .railFrame'),
    /transform:\s*translateX\(calc\(100% \+ var\(--pi-rail-right\)\)\);/,
  );
  assert.match(sharedRulePart(LAYOUT_PI_CSS, DOCK_MIN), /transform:\s*translateY\(100%\);/);
  const minMap = customProps(ruleBody(WEATHER_MAP_CSS, `:global([data-pi-shell][data-pi-map="min"]) ${ATTRIBUTION_CORNER}`));
  assert.equal(minMap.get("--c-attr-right"), `${min.attrRight}px`);
  assert.equal(minMap.get("--c-attr-bottom"), `${min.attrBottom}px`);
});

test("CSS: the shell's root declares the module's geometry and motion", () => {
  const roots = rulesOf(LAYOUT_PI_CSS).filter((r) => r.selector === ".layout[data-pi-shell]");
  // The base block plus its reduced-motion override.
  assert.ok(roots.length >= 1, "no `.layout[data-pi-shell] { … }` block in LayoutPi/styles.css");
  const props = customProps(roots[0].body);
  const px = (n) => `${n}px`;
  assert.equal(props.get("--pi-rail-right"), px(SHELL_GEOMETRY.railRight));
  assert.equal(props.get("--pi-rail-top"), px(SHELL_GEOMETRY.railTop));
  assert.equal(props.get("--pi-rail-width"), px(SHELL_GEOMETRY.railWidth));
  assert.equal(props.get("--pi-rail-dock-gap"), px(SHELL_GEOMETRY.railDockGap));
  assert.equal(props.get("--pi-sheet-left"), px(SHELL_GEOMETRY.sheetLeft));
  assert.equal(props.get("--c-dock-height"), px(SHELL_GEOMETRY.dockHeight));
  assert.equal(props.get("--pi-shell-duration"), `${SHELL_MOTION.durationMs}ms`);
  assert.equal(props.get("--pi-shell-easing"), SHELL_MOTION.easing);
  // The shell's easing, an approximation of Leaflet's pan curve (see the
  // motion test below).
  assert.equal(SHELL_MOTION.easing, "cubic-bezier(0, 0, 0.5, 1)");
  assert.equal(SHELL_MOTION.durationMs, 250);

  // Form 2 and reduced motion switch in one frame.
  const form2 = rulesOf(LAYOUT_PI_CSS).find((r) => r.selector === '.layout[data-pi-form="2"]');
  assert.ok(form2, 'no `.layout[data-pi-form="2"] { … }` block');
  assert.equal(customProps(form2.body).get("--pi-shell-duration"), "0ms");
  assert.match(
    stripComments(LAYOUT_PI_CSS),
    /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.layout\[data-pi-shell\]\s*\{\s*--pi-shell-duration:\s*0ms;/,
  );
});

test("CSS: every rule naming a box of the shell's own is gated on the root attribute", () => {
  const SHELL_ONLY = /\.(railFrame|railScroll|sheet|sheetInner|shield|dockShield|dockGuard|mapClip)\b/;
  const gated = /\[data-pi-shell\]|\[data-pi-form="[12]"\]/;
  const d1Rules = rulesOf(LAYOUT_PI_CSS).filter((r) => SHELL_ONLY.test(r.selector));
  assert.ok(d1Rules.length > 0, "no rule of the shell found — did the class names change?");
  for (const { selector } of d1Rules) {
    for (const part of selector.split(",")) {
      assert.match(part, gated, `ungated selector of the shell: ${part.trim()}`);
    }
  }
  // And the custom properties the shell's rules read are only declared there.
  for (const { selector, body } of rulesOf(LAYOUT_PI_CSS)) {
    if (/--pi-(rail|sheet|shell|attr|dock)-/.test([...customProps(body).keys()].join(" "))) {
      assert.match(selector, gated, `--pi-* declared outside the shell's gate: ${selector}`);
    }
  }
});

test("CSS: the overlay shell moves by transform / opacity only — `visibility` as a discrete step, no layout transition, nothing infinite, will-change on the sheet and the views' shield alone", () => {
  const css = stripComments(LAYOUT_PI_CSS);
  assert.doesNotMatch(css, /\binfinite\b/);
  // `will-change: transform` on the view sheet and on the views' shield, the two exceptions (the next tests pin the
  // shield's). The sheet's warm pose adds `opacity` to the sheet's own, for one idle frame per view host (the warm-up
  // test).
  const willChange = rulesOf(LAYOUT_PI_CSS).filter((r) => /will-change/.test(r.body));
  assert.deepEqual(willChange.map((r) => r.selector), [".layout[data-pi-shell] .sheet", WARM_POSE, ".layout[data-pi-shell] .shield"]);
  for (const r of willChange) assert.match(r.body, r.selector === WARM_POSE ? /(?:^|;)\s*will-change:\s*transform, opacity;/ : /(?:^|;)\s*will-change:\s*transform;/, r.selector);
  // The sheet's will-change is permanent, its layer is not: closed (MID, MIN) the sheet is
  // `visibility: hidden`, paints nothing, and Chromium keeps no layer for it; the layer is made at each opening
  // (and for a view host's warm frame, the one closed pose that isn't hidden: the warm-up test).
  assert.match(rulePart(LAYOUT_PI_CSS, '.layout[data-pi-shell][data-pi-state="mid"]:not([data-pi-warm]) .sheet'), /(?:^|;)\s*visibility:\s*hidden;/);
  assert.match(rulePart(LAYOUT_PI_CSS, '.layout[data-pi-shell][data-pi-state="min"]:not([data-pi-warm]) .sheet'), /(?:^|;)\s*visibility:\s*hidden;/);
  // The sheet is then the containing block of any `position: fixed` descendant: none may exist. The stylesheets that
  // use it are all outside the views (overlays, panels, the dock and its menu, LayoutPi's own shields beside the sheet);
  // DetailsPopover goes fixed only in portal mode, into <body>.
  const COMPONENTS = path.join(SRC_DIR, "components");
  const walkCss = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walkCss(path.join(dir, e.name)) : e.name.endsWith(".css") ? [path.join(dir, e.name)] : []));
  const fixed = walkCss(COMPONENTS).filter((f) => /position:\s*fixed/.test(stripComments(fs.readFileSync(f, "utf8")))).map((f) => path.relative(COMPONENTS, f)).sort();
  assert.deepEqual(fixed, [
    "UpdateModal/styles.css", "ambient/ControlButtons/styles.css", "ambient/DebugPanel/styles.css",
    "ambient/DockOverflowMenu/styles.css", "ambient/SettingsPanel/styles.css", "ScreenSaver/styles.css",
  ].sort(), "a new position: fixed stylesheet: check it is never inside the shell's sheet (will-change makes the sheet its containing block)");
  // DetailsPopover sets `position: fixed` inline, in portal mode only, rendered into <body>.
  const popoverJs = fs.readFileSync(path.join(COMPONENTS, "ambient", "DetailsPopover", "index.js"), "utf8");
  assert.match(popoverJs, /createPortal\(/);
  for (const { selector, body } of rulesOf(LAYOUT_PI_CSS)) {
    if (!/\[data-pi-shell\]|\[data-pi-form=/.test(selector)) continue;
    for (const { prop, duration, item } of transitionItems(body)) {
      // `clip-path`: only the dock band shield's cut-out, a hit area that
      // never paints (below).
      // The dock cell's MIN-only rule adds DOCK_MIN_STEP, a discrete step
      // at the slide's end (the "dock cell in MIN" test below).
      const allowed = ["transform", "opacity", "visibility", "none", ...(/\.dockShield\b/.test(selector) ? ["clip-path"] : []), ...(selector === DOCK_MIN ? [DOCK_MIN_STEP] : [])];
      assert.ok(allowed.includes(prop), `${selector}: transition on "${prop}"`);
      // `visibility` never fades: a 0s step, held by a delay at most (the
      // box stays visible until its slide or fade ends); the shield's
      // cut-out likewise, and the dock cell's MIN step, discrete.
      if (prop === "visibility" || prop === "clip-path" || prop === DOCK_MIN_STEP) assert.equal(duration, "0s", `${selector}: ${item}`);
      if (prop === DOCK_MIN_STEP) assert.match(item, /\sallow-discrete$/, `${selector}: ${item}`);
    }
  }
});

test("popup padding: a survey popup never auto-pans under the rail or the dock", () => {
  const mid = popupAutoPanPadding(railOffsetFor("mid", "d1", W));
  assert.deepEqual(mid, { autoPanPaddingTopLeft: [5, 5], autoPanPaddingBottomRight: [315, 63] });
  // The popup's right edge stops POPUP_EDGE_PADDING short of the rail
  // frame, its bottom the same short of the dock band.
  assert.equal(W - mid.autoPanPaddingBottomRight[0], railLeft(W) - POPUP_EDGE_PADDING);
  assert.equal(H - mid.autoPanPaddingBottomRight[1], H - SHELL_GEOMETRY.dockHeight - POPUP_EDGE_PADDING);
  // MIN: nothing overlays the map, Leaflet's own [5, 5] default.
  assert.deepEqual(popupAutoPanPadding(railOffsetFor("min", "d1", W)), {
    autoPanPaddingTopLeft: [5, 5],
    autoPanPaddingBottomRight: [5, 5],
  });
  assert.equal(POPUP_EDGE_PADDING, 5);
  // Views: MID's (Leaflet stays at its MID pose; a popup opened in MID moves with the panes' translate, and none
  // can open during a view, the gesture shield covering the map strip).
  assert.deepEqual(popupAutoPanPadding(railOffsetFor("alert", "d1", W)), mid);
  // A positive y (a band at the TOP, LayoutDesktop's HeroBand) pads the top.
  assert.deepEqual(popupAutoPanPadding({ x: 320, y: 120 }), {
    autoPanPaddingTopLeft: [5, 125],
    autoPanPaddingBottomRight: [325, 5],
  });
  assert.deepEqual(popupAutoPanPadding(null), popupAutoPanPadding({ x: 0, y: 0 }));
});

test("CSS: the map-chrome insets equal chromeFor in every state — MID's on the shell's root, the others' on their readers, never redefined on the root", () => {
  const states = ["mid", "min", ...VIEW_STATES];
  for (const width of [W, 819]) {
    for (const state of states) {
      const props = chromePropsFor(state);
      for (const name of CHROME_PROPS) assert.ok(props.has(name), `${state}: ${name} not declared`);
      const expected = chromeFor(state, width);
      const got = {
        mapBottomInset: evalInset(props.get("--c-map-bottom-inset"), width),
        attrRight: evalInset(props.get("--c-attr-right"), width),
        attrBottom: evalInset(props.get("--c-attr-bottom"), width),
        attrMaxWidth: evalInset(props.get("--c-attr-max-width"), width),
      };
      const { railVisibleWidth, ...rest } = expected;
      assert.deepEqual(got, rest, `${state} at ${width} px`);
      // The rail's visible width: MID's on the root, read by nothing
      // under the overlay shell (below), so no other state declares it.
      if (state === "mid") assert.equal(evalInset(props.get("--c-rail-visible-width"), width), railVisibleWidth);
    }
  }
  // MID attribution: 2 px above the 58 px dock band.
  assert.equal(chromeFor("mid", W).attrBottom, SHELL_GEOMETRY.dockHeight + ATTRIBUTION_BOTTOM_GAP);

  // Never on the root: none of LayoutPi's rules but the shell root's base
  // block declares a chrome inset or the attribution's duration, and no
  // rule whose subject is the root and whose key is a switch's state
  // (`data-pi-state`, `-map`, `-switch`, `-moving`) declares any custom
  // property — an inherited property changed there restyles the whole
  // subtree, map and rail included, on every switch (seen in a desktop
  // Chromium trace). The static form-2 and reduced-motion blocks may.
  for (const { selector, body } of rulesOf(LAYOUT_PI_CSS)) {
    const declared = [...customProps(body).keys()];
    if (selector !== ".layout[data-pi-shell]") {
      for (const k of declared) assert.ok(!CHROME_PROPS.includes(k) && k !== "--pi-attr-duration", `${selector}: ${k} declared off the shell root's base block`);
    }
    for (const part of selector.split(",").map((p) => p.trim())) {
      if (/^\.layout(\[[^\]]+\])+$/.test(part) && /\[data-pi-(state|map|switch|moving)\b/.test(part)) {
        assert.deepEqual(declared, [], `${part}: custom properties redefined on the root per state`);
      }
    }
  }

  // On their readers (WeatherMap/styles.css), the two groups apart: keyed
  // on the chrome's state, the legend's detail sheet and its bottom inset
  // only; on the map's, the attribution corner and its three only (so a
  // view's attribution waits for the map); on the view switch, the
  // corner's one-frame move. Nothing else there declares one.
  const readerRules = rulesOf(WEATHER_MAP_CSS).filter((r) => [...customProps(r.body).keys()].some((k) => CHROME_PROPS.includes(k) || k === "--pi-attr-duration"));
  assert.ok(readerRules.length >= 4, "no per-state reader rules in WeatherMap/styles.css");
  for (const { selector, body } of readerRules) {
    const declared = [...customProps(body).keys()];
    for (const part of selector.split(",").map((p) => p.trim())) {
      if (part.endsWith(LEGEND_SHEET)) {
        assert.match(part, /^:global\(\[data-pi-shell\]\[data-pi-state="(min|max|conditions|alert|ai)"\]\) /, part);
        assert.deepEqual(declared, ["--c-map-bottom-inset"], part);
      } else if (part.endsWith(ATTRIBUTION_CORNER) && /\[data-pi-map=/.test(part)) {
        assert.match(part, /^:global\(\[data-pi-shell\]\[data-pi-map="(min|max|conditions|alert|ai)"\]\) /, part);
        for (const k of declared) assert.ok(MAP_STATE_PROPS.includes(k), `${part}: ${k} keyed on the map's state`);
      } else if (part.endsWith(ATTRIBUTION_CORNER) && /\[data-pi-switch=/.test(part)) {
        assert.equal(part, `:global([data-pi-shell][data-pi-switch="view"]) ${ATTRIBUTION_CORNER}`);
        assert.deepEqual(Object.fromEntries(customProps(body)), { "--pi-attr-duration": "0ms" });
      } else {
        assert.fail(`${part}: chrome insets declared outside the per-state reader rules`);
      }
    }
  }
  // `--c-rail-visible-width`: read under the overlay shell by nothing — its
  // two base readers, the attribution corner's and the scrubber's right
  // inset, are overridden by their rules under the shell, and no rule of
  // the shell reads it.
  for (const { rel, selector, body } of d1RulesEverywhere()) {
    assert.doesNotMatch(body, /var\(--c-rail-visible-width/, `${rel}: ${selector} reads the rail's width under the overlay shell`);
  }
  const readers = rulesOf(WEATHER_MAP_CSS).filter((r) => /var\(--c-rail-visible-width/.test(r.body)).map((r) => r.selector);
  assert.deepEqual(readers, [".map-wrapper :global(.leaflet-bottom.leaflet-right)", ".radar-timeline"]);
  assert.match(ruleBody(WEATHER_MAP_CSS, `:global([data-pi-shell]) ${ATTRIBUTION_CORNER}`), /\bright:\s*0;/);
  assert.match(bodiesOf(WEATHER_MAP_CSS, ":global([data-pi-shell]) .radar-timeline"), /\bright:\s*var\(--pi-scrubber-inset\);/);
  assert.doesNotMatch(stripComments(LAYOUT_PI_CSS), /data-pi-overlay(?![-\w])/);
});

test("CSS: no rule keyed on a switch's state ends on a bare structural pseudo-class or universal selector — a switch restyles what it changes, not the root's subtree", () => {
  // Blink can narrow a state change's restyle to the elements a rule's
  // last compound names (a class or an attribute); a last compound with
  // neither (`> :last-child`, `*`) restyles the root's whole subtree on
  // every switch. The dock cell is `[data-pi-dock-cell]` in every such
  // rule (in a desktop Chromium trace, MID → MIN restyled the whole
  // subtree, about a quarter of it once re-keyed).
  const KEYED = /\[data-pi-(state|map|switch|moving)\b/;
  for (const [css, name] of [[LAYOUT_PI_CSS, "LayoutPi"], [WEATHER_MAP_CSS, "WeatherMap"]]) {
    for (const { selector } of rulesOf(css)) {
      for (const part of selector.split(",").map((p) => p.trim())) {
        if (!KEYED.test(part)) continue;
        const last = part.replace(/:global\(([^()]*)\)/g, "$1").split(/\s*[ >+~]\s*/).filter(Boolean).pop();
        assert.match(last, /[.[]/, `${name}: ${part} ends on "${last}"`);
      }
    }
  }
  // And no structural pseudo-class followed by a descendant anywhere in
  // LayoutPi's stylesheet: `> :last-child *` makes whatever stops being its
  // parent's last child (#root, when a popover or the screensaver is
  // appended to <body>) restyle its whole subtree. The grid shell's base
  // `.layout > :last-child` (the dock cell's grid placement, both shells)
  // is the one structural selector left, twice since PR 408: its opaque-edge container rule (custom properties on the
  // dock cell itself, no descendant) and its grid placement.
  const structural = rulesOf(LAYOUT_PI_CSS).flatMap((r) => r.selector.split(",").map((p) => p.trim())).filter((p) => /:(last|first|nth|only)-/.test(p));
  assert.deepEqual(structural, [".layout > :last-child", ".layout > :last-child"]);
  // The attribute is BottomDock's, rendered only when LayoutPi asks.
  assert.match(BOTTOM_DOCK_JS, /data-pi-dock-cell=\{piDockCell \? "" : undefined\}/);
  assert.match(LAYOUT_PI_JS, /<BottomDock piDockCell cellRef=\{shellVariant \? dockCellRef : undefined\} \/>/);
  // The timing hook reads the dock cell through BottomDock's `cellRef`
  // (no DOM query in a switch's click or commit).
  assert.match(BOTTOM_DOCK_JS, /<div ref=\{cellRef\} className=\{styles\.dock\}/);
  assert.match(SHELL_TIMING_JS, /const dock = dockCellRef\.current;/);
  assert.doesNotMatch(SHELL_TIMING_JS, /lastElementChild|DOCK_CELL_SELECTOR|querySelector/);
  for (const file of [LAYOUT_DESKTOP_JS, LAYOUT_MOBILE_JS]) assert.doesNotMatch(file, /piDockCell/);
});

test("CSS: the shell's own chrome variables are declared on its root or on their readers under its gate, and read only by gated rules", () => {
  const gated = /\[data-pi-shell\]/;
  const homes = [path.join("components", "ambient", "LayoutPi", "styles.css"), path.join("components", "WeatherMap", "styles.css")];
  for (const file of cssFiles(SRC_DIR)) {
    const rel = path.relative(SRC_DIR, file);
    for (const { selector, body } of rulesOf(fs.readFileSync(file, "utf8"))) {
      const declared = [...customProps(body).keys()].filter((k) => SHELL_ONLY_PROPS.includes(k));
      if (declared.length) {
        assert.ok(homes.includes(rel), `${declared} declared in ${rel}`);
        for (const part of selector.split(",")) assert.match(part, gated, `${rel}: ${declared} declared outside the shell's gate (${part.trim()})`);
      }
      if (/var\(--c-(map-bottom-inset|attr-bottom|attr-max-width)\b/.test(body)) {
        for (const part of selector.split(",")) assert.match(part, gated, `${rel}: shell inset read by an ungated rule (${part.trim()})`);
      }
    }
  }
});

test("CSS: under the overlay shell the attribution moves by transform with the shell's timing, and each map overlay keeps one place, clear of the dock", () => {
  const d1Rules = rulesOf(WEATHER_MAP_CSS).filter((r) => /\[data-pi-shell\]/.test(r.selector));
  assert.ok(d1Rules.length > 0, "no block of the shell in WeatherMap/styles.css");
  const corner = d1Rules.find((r) => r.selector.includes(".leaflet-bottom.leaflet-right"));
  assert.ok(corner, "no rule of the shell for the attribution corner");
  assert.match(corner.body, /transform:\s*translate\(calc\(-1 \* var\(--c-attr-right, 0px\)\), calc\(-1 \* var\(--c-attr-bottom, 0px\)\)\);/);
  assert.match(corner.body, /transition:\s*transform var\(--pi-attr-duration, 0ms\) var\(--pi-shell-easing, [^)]+\);/);
  // Its duration: the shell's on MIN ↔ MID, none on a view switch (it
  // jumps with the map's instant recentre), none in form 2 / reduced
  // motion (it resolves through --pi-shell-duration).
  const root = customProps(rulesOf(LAYOUT_PI_CSS).find((r) => r.selector === ".layout[data-pi-shell]").body);
  assert.equal(root.get("--pi-attr-duration"), "var(--pi-shell-duration)");
  assert.equal(customProps(ruleBody(WEATHER_MAP_CSS, `:global([data-pi-shell][data-pi-switch="view"]) ${ATTRIBUTION_CORNER}`)).get("--pi-attr-duration"), "0ms");
  assert.match(corner.body, /\bright:\s*0;/);
  assert.match(corner.body, /\bbottom:\s*0;/);
  const attr = d1Rules.find((r) => r.selector.includes(".leaflet-control-attribution"));
  assert.ok(attr, "no rule of the shell for the attribution width");
  assert.match(attr.body, /max-width:\s*var\(--c-attr-max-width, none\);/);
  // The shell's chrome only ever transitions transform and opacity (no layout
  // transition), `visibility` as a 0s step; the attribution, which may
  // never fade or hide, transform alone.
  for (const { selector, body } of d1Rules) {
    const attribution = /leaflet-(bottom|control-attribution)/.test(selector);
    for (const { prop, duration, item } of transitionItems(body)) {
      // `transition: none` (the overlays on a view switch) runs nothing.
      if (item === "none") continue;
      assert.ok(attribution ? prop === "transform" : ["transform", "opacity", "visibility"].includes(prop), `${selector}: transition on "${item}"`);
      if (prop === "visibility") assert.equal(duration, "0s", `${selector}: ${item}`);
    }
  }
  // Places (piShellGeometry.overlayPlacement): one per overlay, the same in
  // every state, never read from a per-state inset — so an overlay fading
  // out where it is never jumps when the state flips under it, and one
  // fading in is already in place.
  const place = overlayPlacement();
  assert.deepEqual(place, { chip: 74, chipRaised: 122, card: 16, scrubber: 16 });
  assert.equal(place.chip, SHELL_GEOMETRY.dockHeight + SHELL_GEOMETRY.mapChromeGap);
  assert.match(bodiesOf(WEATHER_MAP_CSS, ":global([data-pi-shell]) .legend-chip.legend-chip"), /bottom:\s*calc\(var\(--c-dock-height, 0px\) \+ 16px\);/);
  assert.equal(customProps(rulesOf(LAYOUT_PI_CSS).find((r) => r.selector === ".layout[data-pi-shell]").body).get("--c-dock-height"), `${SHELL_GEOMETRY.dockHeight}px`);
  assert.match(ruleBody(WEATHER_MAP_CSS, ':global([data-pi-shell]) .legend-chip.legend-chip[data-pi-overlay-el="chip-raised"]'), new RegExp(`bottom:\\s*${place.chipRaised}px;`));
  assert.match(bodiesOf(WEATHER_MAP_CSS, ":global([data-pi-shell]) .radar-legend"), new RegExp(`bottom:\\s*${place.card}px;`));
  // The scrubber reads its place from the shell's root (`--pi-scrubber-inset`,
  // shared with the dock band shield's cut-out; the dock shield's cut-out
  // test pins the value to place.scrubber).
  const scrubber = bodiesOf(WEATHER_MAP_CSS, ":global([data-pi-shell]) .radar-timeline");
  assert.match(scrubber, /\bbottom:\s*var\(--pi-scrubber-inset\);/);
  assert.equal(customProps(rulesOf(LAYOUT_PI_CSS).find((r) => r.selector === ".layout[data-pi-shell]").body).get("--pi-scrubber-inset"), `${place.scrubber}px`);
  // Full width at rest in MID too: the base rule's right inset follows the
  // rail's visible width, which would resize it as it fades out of MIN.
  assert.match(scrubber, /\bright:\s*var\(--pi-scrubber-inset\);/);
  // The raised chip sits where the grid shell's `.with-timeline` puts it;
  // WeatherMap never sets that class under the overlay shell.
  assert.match(ruleBody(WEATHER_MAP_CSS, ".with-timeline .radar-legend, .with-timeline .legend-chip"), new RegExp(`bottom:\\s*${place.chipRaised}px;`));
  assert.match(WEATHER_MAP_JS, /\$\{timelineShown && !shellActive \? styles\.withTimeline : ""\}/);
  // No rule of the shell places an overlay by a per-state inset; only the legend's
  // detail sheet (opened at rest) follows the chrome's.
  for (const { selector, body } of d1Rules) {
    if (/var\(--c-(map-bottom-inset|rail-visible-width)/.test(body)) assert.equal(selector, ":global([data-pi-shell]) .legend-overlay-sheet", selector);
  }
  assert.match(ruleBody(WEATHER_MAP_CSS, ":global([data-pi-shell]) .legend-overlay-sheet"), /bottom:\s*calc\(var\(--c-map-bottom-inset, 0px\) \+ 16px\);/);
  // The chip in MID: 58 + 16 = 74 from the bottom (the design: top 372 + 34).
  assert.equal(chromeFor("mid", W).mapBottomInset + 16, 74);
});

/**
 * A CSS `cubic-bezier(x1, y1, x2, y2)` timing function, as the browser
 * evaluates it: progress → eased progress (x solved by bisection).
 *
 * @param {number[]} controls the four control-point coordinates
 * @returns {function(number): number} the timing function
 */
const cubicBezier = ([x1, y1, x2, y2]) => {
  const at = (t, a, b) => 3 * a * t * (1 - t) ** 2 + 3 * b * t ** 2 * (1 - t) + t ** 3;
  return (x) => {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 60; i += 1) {
      const mid = (lo + hi) / 2;
      if (at(mid, x1, x2) < x) lo = mid;
      else hi = mid;
    }
    return at((lo + hi) / 2, y1, y2);
  };
};

/**
 * Largest gap, over the whole slide, between two progress curves.
 *
 * @param {function(number): number} f a timing function
 * @param {function(number): number} g another timing function
 * @returns {number} max |f(t) − g(t)| for t in [0, 1], as a fraction of the travel
 */
const maxGap = (f, g) => {
  let gap = 0;
  for (let i = 0; i <= 1000; i += 1) gap = Math.max(gap, Math.abs(f(i / 1000) - g(i / 1000)));
  return gap;
};

test("motion: the shell's 250 ms on cubic-bezier(0, 0, .5, 1) approximates Leaflet's default pan", () => {
  // PosAnimation's curve with the default easeLinearity of 0.5 (below).
  const leaflet = (t) => 1 - (1 - t) ** 2;
  const controls = SHELL_MOTION.easing.match(/^cubic-bezier\(([^)]+)\)$/)[1].split(",").map(Number);
  // An approximation, not an identity: the chrome trails the map by at
  // most 2.9 % of the travel (~9 px of the rail's 310 px slide).
  const gap = maxGap(cubicBezier(controls), leaflet);
  assert.ok(gap > 0.02 && gap < 0.03, `max gap ${gap}`);
  // The exact cubic form of 1 − (1 − t)², should it be wanted.
  assert.ok(maxGap(cubicBezier([1 / 3, 2 / 3, 2 / 3, 1]), leaflet) < 1e-6);
});

test("motion: Leaflet's default pan is 250 ms on 1 − (1 − t)²", { skip: !fs.existsSync(LEAFLET_SRC) && "client dependencies not installed" }, () => {
  const src = fs.readFileSync(LEAFLET_SRC, "utf8");
  // panBy: `options.duration || 0.25` seconds.
  assert.match(src, /this\._panAnim\.run\(this\._mapPane, newPos, options\.duration \|\| 0\.25, options\.easeLinearity\);/);
  assert.equal(SHELL_MOTION.durationMs, 0.25 * 1000);
  // PosAnimation: ease-out power 1 / easeLinearity, 0.5 by default, so
  // 1 − (1 − t)² (approximated by SHELL_MOTION.easing, see above).
  assert.match(src, /this\._easeOutPower = 1 \/ Math\.max\(easeLinearity \|\| 0\.5, 0\.2\);/);
});

test("dock: 44 px targets on the shell's dock only, 40 px everywhere else", () => {
  assert.equal(SHELL_GEOMETRY.dockButtonSize, 44);
  // Declared only by rules gated on the shell's root, at the module's size.
  const declarations = [];
  for (const file of cssFiles(SRC_DIR)) {
    const rel = path.relative(SRC_DIR, file);
    for (const { selector, body } of rulesOf(fs.readFileSync(file, "utf8"))) {
      const value = customProps(body).get("--ctrl-btn-size");
      if (value === undefined) continue;
      declarations.push({ rel, selector, value });
      for (const part of selector.split(",")) {
        assert.match(part, /\[data-pi-shell\]/, `${rel}: --ctrl-btn-size declared outside the shell's gate (${part.trim()})`);
      }
    }
  }
  assert.deepEqual(declarations, [{
    rel: path.join("components", "ambient", "BottomDock", "styles.css"),
    selector: ":global([data-pi-shell]) > .dock",
    value: `${SHELL_GEOMETRY.dockButtonSize}px`,
  }]);
  // Read with the usual 40 px as the fallback: the dock cells and the trigger.
  const cell = rulesOf(CONTROL_BUTTONS_CSS).find((r) => r.selector === ".container.grouped .group > div");
  assert.ok(cell, "ControlButtons' grouped cell rule moved");
  assert.match(cell.body, /\bwidth:\s*var\(--ctrl-btn-size, 40px\);/);
  assert.match(cell.body, /\bheight:\s*var\(--ctrl-btn-size, 40px\);/);
  const trigger = rulesOf(OVERFLOW_MENU_CSS).find((r) => r.selector === ".trigger.trigger");
  assert.ok(trigger, "DockOverflowMenu's trigger rule moved");
  assert.match(trigger.body, /\bwidth:\s*var\(--ctrl-btn-size, 40px\);/);
  assert.match(trigger.body, /\bheight:\s*var\(--ctrl-btn-size, 40px\);/);
  // And BottomDock's other rules stay the ungated, unchanged dock.
  assert.ok(rulesOf(BOTTOM_DOCK_CSS).some((r) => r.selector === ".dock"));
});

test("dock: a 44 px button fits the 58 px band, and the shell's row fits its width", () => {
  const band = rulesOf(LAYOUT_PI_CSS).find((r) => r.selector === ".layout[data-pi-shell] > [data-pi-dock-cell]");
  assert.ok(band, "no dock band rule of the shell in LayoutPi/styles.css");
  const pad = band.body.match(/\bpadding:\s*(\d+)px (\d+)px;/);
  assert.ok(pad, "the shell's dock band padding is no longer `<y>px <x>px`");
  const [padY, padX] = [Number(pad[1]), Number(pad[2])];
  assert.deepEqual([padY, padX], [6, 10], "the design's 6 px / 10 px");
  assert.match(band.body, /\bheight:\s*var\(--c-dock-height\);/);
  assert.match(band.body, /\bborder-width:\s*1px 0 0;/);
  assert.ok(1 + padY + SHELL_GEOMETRY.dockButtonSize + padY <= SHELL_GEOMETRY.dockHeight);

  // Row width at 800 px, every input read from the source: the spacing
  // from ControlButtons/styles.css (no gap between groups; 2 px between a
  // group's buttons; its ≤ 980 px block hides the group labels and pads
  // each group 0 4px), the health chip from HealthIndicator/styles.css (its
  // ≤ 1279 px block: 4 px padding around the 18 px disc, 1 px border), and
  // the buttons per group from ControlButtons' JSX.
  const media = (css, query) => {
    const m = stripComments(css).match(new RegExp(`@media ${query.replace(/[()]/g, "\\$&")} \\{([\\s\\S]*?)\\n\\}`));
    assert.ok(m, `no @media ${query} block`);
    return m[1];
  };
  const pxOf = (body, prop) => {
    const m = body.match(new RegExp(`(?:^|;|\\s)${prop}:\\s*(\\d+)px;`));
    assert.ok(m, `no ${prop} in px`);
    return Number(m[1]);
  };
  const firstRule = (css, selector) => {
    const r = rulesOf(css).find((x) => x.selector === selector);
    assert.ok(r, `no ${selector} rule`);
    return r.body;
  };
  assert.match(firstRule(CONTROL_BUTTONS_CSS, ".container.grouped"), /\bgap:\s*0;/);
  const GAP = pxOf(firstRule(CONTROL_BUTTONS_CSS, ".container.grouped .group"), "gap");
  const narrow = media(CONTROL_BUTTONS_CSS, "(max-width: 980px)");
  assert.match(firstRule(narrow, ".container.grouped .groupLabel"), /display:\s*none;/);
  const groupPad = firstRule(narrow, ".container.grouped .group").match(/\bpadding:\s*0 (\d+)px;/);
  assert.ok(groupPad, "the ≤ 980 px group padding is no longer `0 <x>px`");
  const GROUP_PAD = Number(groupPad[1]);
  const chipPad = firstRule(media(HEALTH_CSS, "(max-width: 1279px)"), ".chipButton.chipButton").match(/\bpadding:\s*(\d+)px;/);
  assert.ok(chipPad, "the ≤ 1279 px chip padding is no longer one length");
  const chipBorder = firstRule(HEALTH_CSS, ".chipButton.chipButton").match(/\bborder:\s*(\d+)px solid/);
  assert.ok(chipBorder, "the chip border is no longer `<n>px solid`");
  const CHIP = pxOf(firstRule(HEALTH_CSS, ".chipIcon"), "width") + 2 * Number(chipPad[1]) + 2 * Number(chipBorder[1]);
  assert.deepEqual([GAP, GROUP_PAD, CHIP], [2, 4, 28]);

  // Buttons per group, from the return JSX. A `{btnX}` slot is always in
  // the row; `{dockOverflow ? null : btnX}` leaves it under the overlay shell; the "···"
  // group holds the DockOverflowMenu. The two update buttons are mutually
  // exclusive (local vs remote), so they share one slot.
  assert.match(CONTROL_BUTTONS_JS, /const btnUpdateLocal = updateAvailable && isLocal \?/);
  assert.match(CONTROL_BUTTONS_JS, /const btnUpdateRemote = updateAvailable && !isLocal \?/);
  const jsx = CONTROL_BUTTONS_JS.slice(CONTROL_BUTTONS_JS.lastIndexOf("return ("));
  const groups = [...jsx.matchAll(/<div className=\{styles\.group\}>([\s\S]*?)<\/div>/g)].map((m) => {
    const body = m[1].replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    const kept = [...body.matchAll(/\{(btn\w+)\}/g)].map((x) => x[1]);
    const moved = [...body.matchAll(/\{dockOverflow \? null : (btn\w+)\}/g)].map((x) => x[1]);
    const slots = (names) => new Set(names.map((n) => (/^btnUpdate/.test(n) ? "btnUpdate" : n))).size;
    return { kept: slots(kept), moved: moved.length, overflow: /<DockOverflowMenu\b/.test(body) ? 1 : 0 };
  });
  // Map, Views, Display, System, "···".
  assert.equal(groups.length, 5, "ControlButtons' groups changed — recheck the shell's row");
  const withoutMenu = groups.filter((g) => !g.overflow).map((g) => g.kept + g.moved);
  const withMenu = groups.map((g) => g.kept + g.overflow);
  assert.deepEqual(withoutMenu, [8, 2, 3, 4]);
  assert.deepEqual(withMenu, [5, 2, 3, 3, 1]);

  const rowWidth = (counts) => counts.reduce(
    (sum, n) => sum + n * SHELL_GEOMETRY.dockButtonSize + (n - 1) * GAP + 2 * GROUP_PAD,
    CHIP,
  );
  const inner = W - 2 * padX;
  // Without the overflow, a DEBUG kiosk with an update pending would
  // overflow the band at 44 px.
  assert.ok(rowWidth(withoutMenu) > inner, `the row without the menu at 44 px: ${rowWidth(withoutMenu)} px`);
  // With it (marker, legend, rings, debug in "···"; update kept in the
  // row): the design's 656 px set without the update button, and the
  // worst case with it still fits.
  assert.equal(rowWidth(withMenu.map((n, k) => (k === 3 ? n - 1 : n))), 656);
  assert.ok(rowWidth(withMenu) <= inner, `the row with the menu: ${rowWidth(withMenu)} px`);
});

test("dock: the overflow menu exists only under the overlay shell, and the row is unchanged otherwise", () => {
  // Same gate as LayoutPi's `data-pi-shell`: the priority-views gate AND a
  // mounted LayoutPi (non-null piLayoutState).
  assert.match(CONTROL_BUTTONS_JS, /const dockOverflow = inPiDock && piShellVariant\(\) !== null;/);
  assert.match(CONTROL_BUTTONS_JS, /const overflowItems = dockOverflow \? \[/);
  assert.match(CONTROL_BUTTONS_JS, /\{dockOverflow \? \(\s*<div className=\{styles\.group\}>\s*<DockOverflowMenu\b/);
  // The four buttons leave the row only under the overlay shell.
  for (const btn of ["btnMarker", "btnLegend", "btnRings", "btnDebug"]) {
    assert.match(CONTROL_BUTTONS_JS, new RegExp(`\\{dockOverflow \\? null : ${btn}\\}`), btn);
    assert.equal(
      (CONTROL_BUTTONS_JS.match(new RegExp(`\\{${btn}\\}`, "g")) || []).length,
      0,
      `${btn} rendered outside the dockOverflow switch`,
    );
  }
  // The update buttons stay in the row.
  assert.match(CONTROL_BUTTONS_JS, /\{btnUpdateLocal\}\s*\{btnUpdateRemote\}/);
  // Closed by any layout change, in the switch's own render — never by a
  // `key` remount, which remounted its Iconify glyph (setState on mount:
  // two extra React commits after every switch's tap) — and through no
  // prop that changes at a switch (a `closeKey` prop
  // rendered the menu twice at every switch): the menu reads LayoutPi's
  // state itself (React 19 `use`, the one context read allowed in a
  // condition), only while it is open, and a state other than the one it
  // opened in closes it during that render.
  assert.match(CONTROL_BUTTONS_JS, /<DockOverflowMenu\s+label=\{t\("controls\.moreControls"\)\}\s+items=\{overflowItems\}\s*\/>/);
  assert.doesNotMatch(CONTROL_BUTTONS_JS, /<DockOverflowMenu\s+key=|closeKey/);
  const overflowCode = OVERFLOW_MENU_JS.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(overflowCode, /closeKey/);
  assert.match(overflowCode, /const layoutState = openIn === CLOSED \? null : use\(PiLayoutContext\)\?\.piLayoutState \|\| "mid";\s*if \(openIn === OPENING\) \{\s*setOpenIn\(layoutState\);\s*\} else if \(openIn !== CLOSED && openIn !== layoutState\) \{\s*setOpenIn\(CLOSED\);\s*\}/);
  assert.equal((overflowCode.match(/\buse\(/g) || []).length, 1, "one context read, skipped while the menu is closed");
  assert.match(overflowCode, /onClick=\{\(\) => setOpenIn\(\(prev\) => \(prev === CLOSED \? OPENING : CLOSED\)\)\}/);
});

test("dock: the overflow menu stays out of ControlButtons' div rules and is touch-safe", () => {
  // `.container > div` and `.container.grouped .group > div` restyle every
  // div child as a dock button; the menu renders no div at all (comments,
  // which explain exactly that, aside).
  const code = OVERFLOW_MENU_JS.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /<div\b/);
  assert.match(OVERFLOW_MENU_JS, /aria-haspopup="menu"/);
  assert.match(OVERFLOW_MENU_JS, /aria-expanded=\{open\}/);
  assert.match(OVERFLOW_MENU_JS, /role="menu"/);
  assert.match(OVERFLOW_MENU_JS, /role="menuitem"/);
  // The chosen row hands the trigger to its action (an element a caller may
  // anchor a toast on; ControlButtons anchors none on this dock).
  assert.match(OVERFLOW_MENU_JS, /item\.onSelect\(triggerRef\.current\)/);

  const css = stripComments(OVERFLOW_MENU_CSS);
  for (const banned of [/:hover\b/, /backdrop-filter/, /\btransition\b/, /\banimation\b/, /will-change/, /\binfinite\b/]) {
    assert.doesNotMatch(css, banned);
  }
  const rule = (sel) => {
    const r = rulesOf(OVERFLOW_MENU_CSS).find((x) => x.selector === sel);
    assert.ok(r, `no ${sel} rule in DockOverflowMenu/styles.css`);
    return r.body;
  };
  assert.match(rule(".menu"), /background-color:\s*var\(--c-bg\);/);
  // The edge over its own --c-bg fill, the translucent edge as fallback
  // (test/opaqueTokens.test.js, own-fill readers).
  assert.match(rule(".menu"), /border:\s*1px solid var\(--c-edge-on-bg, var\(--c-border\)\);/);
  assert.match(rule(".item.item"), /min-height:\s*44px;/);
  assert.match(rule(".backdrop"), /position:\s*fixed;/);
  assert.match(rule(".backdrop"), /inset:\s*0;/);
});

test("dock: the overflow trigger's label exists in EN, FR and ES", () => {
  const expected = { en: "More controls", fr: "Plus de commandes", es: "Más controles" };
  for (const [lang, text] of Object.entries(expected)) {
    const json = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, `${lang}.json`), "utf8"));
    assert.equal(json.controls.moreControls, text, lang);
  }
  assert.match(CONTROL_BUTTONS_JS, /label=\{t\("controls\.moreControls"\)\}/);
});

/**
 * The one rule of a stylesheet whose selector is exactly `selector`.
 *
 * @param {string} css stylesheet source
 * @param {string} selector normalised selector text
 * @returns {string} that rule's declaration block
 */
const ruleBody = (css, selector) => {
  const matches = rulesOf(css).filter((r) => r.selector === selector);
  assert.equal(matches.length, 1, `expected exactly one \`${selector}\` rule, found ${matches.length}`);
  return matches[0].body;
};

/**
 * Every declaration block of the rules with exactly this selector, joined
 * (a selector may carry its place and its transitions in separate rules).
 *
 * @param {string} css stylesheet source
 * @param {string} selector whitespace-normalised selector
 * @returns {string} the bodies, newline-joined
 */
const bodiesOf = (css, selector) => {
  const matches = rulesOf(css).filter((r) => r.selector === selector);
  assert.ok(matches.length > 0, `no \`${selector}\` rule`);
  return matches.map((r) => r.body).join("\n");
};

/**
 * Declaration block of the one rule whose selector LIST contains `part`
 * (a rule shared by several selectors, e.g. the five states that hide the
 * dock).
 *
 * @param {string} css stylesheet source
 * @param {string} part one selector of the list, whitespace-normalised
 * @returns {string} the rule's declaration block
 */
const rulePart = (css, part) => {
  const matches = rulesOf(css).filter((r) => r.selector.split(",").map((p) => p.trim()).includes(part));
  assert.equal(matches.length, 1, `expected exactly one rule listing \`${part}\`, found ${matches.length}`);
  return matches[0].body;
};

// The dock cell in MIN has a rule of its own besides the shared out-pose
// of MIN and the views: out of the render once its slide is over, by a
// discrete `display` step (the "dock cell in MIN" test below).
const DOCK_MIN = '.layout[data-pi-shell][data-pi-state="min"] > [data-pi-dock-cell]';
const DOCK_MIN_STEP = "display";

/**
 * Declaration block of the one SHARED rule whose selector list contains
 * `part` among other selectors — when `part` also has a rule of its own
 * (the dock cell's MIN-only rule).
 *
 * @param {string} css stylesheet source
 * @param {string} part one selector of the list, whitespace-normalised
 * @returns {string} the shared rule's declaration block
 */
const sharedRulePart = (css, part) => {
  const matches = rulesOf(css).filter((r) => {
    const parts = r.selector.split(",").map((p) => p.trim());
    return parts.length > 1 && parts.includes(part);
  });
  assert.equal(matches.length, 1, `expected exactly one shared rule listing \`${part}\`, found ${matches.length}`);
  return matches[0].body;
};

/**
 * Split a value on its top-level whitespace (not inside parentheses), so a
 * `calc(…)` or `var(…, …)` stays one token.
 *
 * @param {string} value declaration value or transition item
 * @returns {string[]} the tokens
 */
const splitTopLevelSpaces = (value) => {
  const tokens = [];
  let depth = 0;
  let current = "";
  for (const ch of value.trim()) {
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    if (/\s/.test(ch) && depth === 0) {
      if (current) tokens.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
};

/**
 * The items of every `transition` declaration of a declaration block, each
 * parsed as `property duration [easing] [delay]`.
 *
 * @param {string} body declaration block
 * @returns {Array<{item: string, prop: string, duration: string, easing: ?string, delay: ?string}>} one per item; `none` has prop "none"
 */
const transitionItems = (body) => {
  const out = [];
  for (const m of body.matchAll(/(?:^|;)\s*transition\s*:\s*([^;]+);/g)) {
    for (const item of splitTopLevel(m[1])) {
      if (item === "none") {
        out.push({ item, prop: "none", duration: "0ms", easing: null, delay: null });
        continue;
      }
      const parts = splitTopLevelSpaces(item);
      out.push({ item, prop: parts[0], duration: parts[1], easing: parts[2] || null, delay: parts[3] || null });
    }
  }
  return out;
};

test("rail cards: NowcastLine's alarm tiers are opaque and its calm line sits on --c-surface, under the overlay shell only", () => {
  const wash = (token) => new RegExp(`background-color:\\s*color-mix\\(in srgb, var\\(${token}\\) 16%, var\\(--c-surface-hybrid\\)\\);`);
  // .compactExtreme's recipe: a 16 % warn / danger wash over the 96 % fill.
  assert.match(ruleBody(NOWCAST_CSS, ":global([data-pi-shell]) .tier-orange.tier-orange"), wash("--c-warn"));
  assert.match(ruleBody(NOWCAST_CSS, ":global([data-pi-shell]) .tier-red.tier-red"), wash("--c-danger"));
  assert.match(ruleBody(NOWCAST_CSS, ":global([data-pi-shell]) .tier-calm.tier-calm"), /background-color:\s*var\(--c-surface\);/);
  // Without the overlay shell the line is unchanged: translucent
  // accent-soft base for the alarm tiers, the 96 % hybrid fill for calm.
  assert.match(ruleBody(NOWCAST_CSS, ".line.line"), /background-color:\s*var\(--c-accent-soft\);/);
  assert.match(ruleBody(NOWCAST_CSS, ".tier-calm.tier-calm"), /background-color:\s*var\(--c-surface-hybrid\);/);
  for (const tier of [".tier-orange.tier-orange", ".tier-red.tier-red"]) {
    assert.doesNotMatch(ruleBody(NOWCAST_CSS, tier), /background/, `${tier} gained an ungated fill`);
  }
  // Every rule that changes a fill on top of the base one sits behind the gate.
  for (const { selector, body } of rulesOf(NOWCAST_CSS)) {
    if (/color-mix|var\(--c-surface\)/.test(body)) assert.match(selector, /^:global\(\[data-pi-shell\]\) /, selector);
  }
});

test("rail cards: nightRed at 96 % and 10 px on-screen gaps, on the shell's root only", () => {
  // nightRed: the shell's root takes the hybrid fill as its surface; the
  // palette itself (ui/tokens.js, which can't be scoped to the shell) is
  // untouched.
  const nightRed = ':global(.ambientRoot[data-palette="nightRed"]) .layout[data-pi-shell]';
  assert.match(ruleBody(LAYOUT_PI_CSS, nightRed), /--c-surface:\s*var\(--c-surface-hybrid\);/);
  assert.match(TOKENS_JS, /surface: "rgba\(40, 12, 12, 0\.85\)",\s*surfaceHybrid: "rgba\(40, 12, 12, 0\.96\)",/);
  for (const { selector, body } of rulesOf(LAYOUT_PI_CSS)) {
    if (customProps(body).has("--c-surface")) {
      for (const part of selector.split(",")) assert.match(part, /\[data-pi-shell\]/, `--c-surface redefined outside the shell's gate (${part.trim()})`);
    }
  }

  // Gaps: divided by the rail's zoom, so 10 px on screen at S, M and L.
  assert.match(ruleBody(LAYOUT_PI_CSS, ".layout[data-pi-shell] .railScroll > .midPanel"), /\bgap:\s*calc\(10px \/ var\(--c-font-scale, 1\)\);/);
  assert.match(ruleBody(LAYOUT_PI_CSS, ".midPanel"), /\bgap:\s*10px;/, "the grid shell's rail keeps its 10 internal px");
  const zoom = FONT_SIZE_JS.match(/FONT_SIZE_ZOOM = \{ s: ([\d.]+), m: ([\d.]+), l: ([\d.]+) \}/);
  assert.ok(zoom, "ui/fontSize.js FONT_SIZE_ZOOM moved");
  const l = Number(zoom[3]);
  // DOCUMENTATION, not a guard: the card heights below are design
  // measurements, which no static check can take from the source. Only
  // the zoom (ui/fontSize.js), the gap formula above and the rail's
  // height (railMaxHeight) are read from code. The worst case
  // at L (FR, 12 h, °F, two ECCC alerts, two-line calm verdict): alert
  // card 70 + clock 54 + hero 82 + NowcastLine 51 + air 46 + four gaps of
  // 10 / 1.15 fits the 402 / 1.15 internal budget. Re-measure on a Pi.
  const worstCase = 70 + 54 + 82 + 51 + 46 + 4 * (10 / l);
  assert.equal(Math.round(worstCase * 10) / 10, 337.8);
  assert.ok(worstCase <= railMaxHeight(H) / l);
});

test("rail cards: HeroCompact's inline condition icon — LayoutPi passes it under the overlay shell only, the unchanged markup otherwise", () => {
  // The prop, documented, typed and defaulting to the existing layout.
  assert.match(HERO_JS, /inlineConditionIcon = false,/);
  assert.match(HERO_JS, /@param \{boolean\} \[props\.inlineConditionIcon\]/);
  assert.match(HERO_JS, /inlineConditionIcon: PropTypes\.bool,/);
  // HeroCompact never reads the shell variant (LayoutMobile mounts it too): only
  // LayoutPi passes the prop, from the same variant that stamps the root.
  const heroCode = HERO_JS.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(heroCode, /piShell|localStorage|piLayout/);
  assert.match(LAYOUT_PI_JS, /inlineConditionIcon=\{shellVariant !== null\}/);
  assert.doesNotMatch(LAYOUT_MOBILE_JS, /inlineConditionIcon/);
  // Off: the slab class string is unchanged (the modifier is appended only
  // when set), and the existing column renders as before.
  assert.match(HERO_JS, /const inlineClass = inlineConditionIcon \? ` \$\{styles\.inlineCond\}` : "";/);
  assert.match(HERO_JS, /<div className=\{styles\.condCol\}>\s*\{condIcon\}\s*\{parsed\?\.descKey \? \(\s*<div className=\{styles\.condText\}>\{t\(parsed\.descKey\)\}<\/div>/);

  // The design's recipe: label bottom-aligned 2 px above
  // the numeral's foot, 1.2 line height, the 18 px icon inline at -4 px
  // with 5 px before the text; the slab floor at 82 px.
  const col = ruleBody(HERO_CSS, ".condCol.condInline");
  assert.match(col, /display:\s*block;/);
  assert.match(col, /align-self:\s*flex-end;/);
  assert.match(col, /margin-bottom:\s*2px;/);
  assert.match(ruleBody(HERO_CSS, ".condInline .condText"), /line-height:\s*1\.2;/);
  const icon = ruleBody(HERO_CSS, ".condInline .condIcon");
  for (const decl of [/display:\s*inline-block;/, /width:\s*18px;/, /height:\s*18px;/, /margin-right:\s*5px;/, /vertical-align:\s*-4px;/]) {
    assert.match(icon, decl);
  }
  assert.match(ruleBody(HERO_CSS, ".condInline .condIcon > svg"), /display:\s*block;/);
  assert.match(ruleBody(HERO_CSS, ".slab.inlineCond"), /min-height:\s*82px;/);

  // Height: two label lines stay within the 39 px numeral, so the focal
  // row (and the hero) doesn't grow. Geist's ascent / descent are 1.005 /
  // 0.295 em, so at a 1.2 line height a text line is 15.6 px and its
  // baseline sits 12.4 px under the top; the -4 px icon (14 px above the
  // baseline, 4 below) makes the first line 18 px.
  const media = HERO_CSS.match(/@media \(min-width: 800px\) and \(max-width: 1279px\) \{([\s\S]*?)\n\}/);
  assert.ok(media, "HeroCompact's 800–1279 px block moved");
  const px = (sel, prop) => {
    const r = rulesOf(media[1]).find((x) => x.selector === sel);
    assert.ok(r, `no ${sel} in the 800–1279 px block`);
    const v = r.body.match(new RegExp(`${prop}:\\s*(\\d+)px;`));
    assert.ok(v, `${sel} ${prop}`);
    return Number(v[1]);
  };
  const numeral = px(".tempValue", "font-size");
  const label = px(".condText", "font-size");
  assert.deepEqual([numeral, label], [39, 13]);
  const lineHeight = 1.2 * label;
  const firstLine = Math.max(14, 0.955 * label) + Math.max(4, 0.245 * label);
  assert.equal(firstLine, 18);
  assert.ok(firstLine + lineHeight + 2 <= numeral, "a two-line label would outgrow the numeral");
});

test("views: the sheet is the view's surface — no padding; the forecast and alert cards drop their chrome, the conditions and AI hosts inset", () => {
  const sheet = ruleBody(LAYOUT_PI_CSS, ".layout[data-pi-shell] .sheet");
  assert.doesNotMatch(sheet, /\bpadding\b/, "the sheet pads its content again");
  const hairline = sheet.match(/border-left:\s*(\d+)px solid var\(--c-border\);/);
  assert.ok(hairline, "the sheet's left hairline moved");
  // Content width at L: the design's 512.17 internal px, against the grid
  // shell's 580 / 1.15 ≈ 504.3.
  const zoom = FONT_SIZE_JS.match(/FONT_SIZE_ZOOM = \{ s: ([\d.]+), m: ([\d.]+), l: ([\d.]+) \}/);
  assert.ok(zoom, "ui/fontSize.js FONT_SIZE_ZOOM moved");
  const width = (W - SHELL_GEOMETRY.sheetLeft - Number(hairline[1])) / Number(zoom[3]);
  assert.equal(Math.round(width * 100) / 100, 512.17);
  assert.ok(width > 580 / Number(zoom[3]));

  // Forecast: the design's maximized slab in the sheet — no fill, border or
  // radius, a 12 px / 14 px inset. The grid shell's maximized slab keeps
  // its card.
  const fc = ruleBody(CHART_TABS_CSS, ":global([data-pi-shell]) .slab.slabPiMax");
  for (const decl of [/background-color:\s*transparent;/, /border:\s*0;/, /border-radius:\s*0;/, /padding:\s*12px 14px;/]) {
    assert.match(fc, decl);
  }
  assert.doesNotMatch(ruleBody(CHART_TABS_CSS, ".slab.slabPiMax"), /background|border|padding/);
  // Alert: same flattening; its header, selector and body pad themselves.
  const alert = ruleBody(ALERT_VIEW_CSS, ":global([data-pi-shell]) .view");
  for (const decl of [/background-color:\s*transparent;/, /border:\s*0;/, /border-radius:\s*0;/]) assert.match(alert, decl);
  assert.match(ruleBody(ALERT_VIEW_CSS, ".view"), /background-color:\s*var\(--c-surface\);/, "the grid shell's alert view lost its card");
  // Conditions and AI: no card of their own, so their hosts inset them
  // (8 + the header's 4 = 12 on top, 12 + its 2 = 14 at the sides).
  assert.match(
    ruleBody(LAYOUT_PI_CSS, ".layout[data-pi-shell] .conditionsHost, .layout[data-pi-shell] .aiHost"),
    /padding:\s*8px 12px 12px;/,
  );
  // Every rule added for the sheet's content is gated on the root.
  for (const [css, name] of [[CHART_TABS_CSS, "ChartTabs"], [ALERT_VIEW_CSS, "AlertView"]]) {
    for (const { selector } of rulesOf(css)) {
      if (/data-pi-shell/.test(selector)) assert.match(selector, /^:global\(\[data-pi-shell\]\) /, `${name}: ${selector}`);
    }
  }
});

test("views: the gesture shield covers the map and the rail from the first frame of the slide, under the sheet", () => {
  const zOf = (selector) => {
    const m = ruleBody(LAYOUT_PI_CSS, selector).match(/z-index:\s*(\d+);/);
    assert.ok(m, `no z-index on ${selector}`);
    return Number(m[1]);
  };
  const shield = ruleBody(LAYOUT_PI_CSS, ".layout[data-pi-shell] .shield");
  assert.match(shield, /\binset:\s*0;/, "the shield no longer spans the whole root");
  assert.doesNotMatch(shield, /\bwidth\b/);
  assert.match(shield, /touch-action:\s*none;/);
  const z = {
    rail: zOf(".layout[data-pi-shell] .railFrame"),
    shield: zOf(".layout[data-pi-shell] .shield"),
    sheet: zOf(".layout[data-pi-shell] .sheet"),
  };
  assert.ok(z.rail < z.shield && z.shield < z.sheet, JSON.stringify(z));
  // The rail is inert from the switch's own commit and stays painted under the sheet (no fade, no
  // `visibility: hidden` in a view).
  assert.match(LAYOUT_PI_JS, /<aside ref=\{railRef\} className=\{styles\.railFrame\} inert=\{!atMid\}>/);
  // Mounted while useShellTiming holds it (the views, then until the
  // close has settled), before the sheet; below the dock.
  assert.match(LAYOUT_PI_JS, /\{shell\.shield && <div ref=\{shieldRef\} className=\{styles\.shield\} aria-hidden="true" \/>\}/);
  assert.ok(LAYOUT_PI_JS.indexOf("styles.shield") < LAYOUT_PI_JS.indexOf("className={styles.sheet}"));
  assert.ok(z.shield < 1100, "the shield must stay under the dock band");
});

test("touch regions: the live rail and the live dock carry a touch-action: manipulation region, so the map's blocking region beneath does not decide their touches; gated on the shell, permanent on the rail, the live dock only", () => {
  // The compositor decides a touch by the frontmost layer with a touch region at its point;
  // the map (Leaflet: non-passive touchstart listeners, touch-action: none) lies under the rail and the dock. A
  // manipulation region does not block, and only drops double-tap zoom: a pinch and a rail scroll stay allowed.
  // The rail frame, in its own rule (no state rule, so a switch restyles nothing).
  assert.match(ruleBody(LAYOUT_PI_CSS, ".layout[data-pi-shell] .railFrame"), /(?:^|;)\s*touch-action:\s*manipulation;/);
  // The dock cell while it is not inert (the inert dock sliding out must not pass in front of the raised band
  // shield, which takes a touch aimed at it).
  assert.match(ruleBody(LAYOUT_PI_CSS, ".layout[data-pi-shell] > [data-pi-dock-cell]:not([inert])"), /^\s*touch-action:\s*manipulation;\s*$/);
  // Every touch-action of the stylesheet, by selector: the views' shield and the raised band shield / guard block
  // (none), the live rail and the live dock don't (manipulation); all under the shell's gate, so the grid shell is
  // unchanged.
  const declared = rulesOf(LAYOUT_PI_CSS)
    .filter((r) => /touch-action/.test(r.body))
    .map((r) => [r.selector, r.body.match(/touch-action:\s*([^;]+);/)[1].trim()]);
  assert.deepEqual(declared, [
    [".layout[data-pi-shell] .railFrame", "manipulation"],
    [".layout[data-pi-shell] > [data-pi-dock-cell]:not([inert])", "manipulation"],
    [".layout[data-pi-shell] .shield", "none"],
    ['.layout[data-pi-shell] .dockShield[data-active="true"]', "none"],
    ['.layout[data-pi-shell] .dockGuard[data-active="true"]', "none"],
  ]);
  for (const [selector] of declared) assert.match(selector, /^\.layout\[data-pi-shell\]/, selector);
  // The rail and the dock are under the views' shield and the band shield where those must win: the rail (20) under
  // the views' shield (25); the dock cell (1100) over the band shield (25) — hence the dock cell
  // rule's `:not([inert])`.
  const zOf = (selector) => Number(ruleBody(LAYOUT_PI_CSS, selector).match(/z-index:\s*(\d+);/)[1]);
  assert.ok(zOf(".layout[data-pi-shell] .railFrame") < zOf(".layout[data-pi-shell] .shield"));
  assert.ok(zOf(".layout[data-pi-shell] > [data-pi-dock-cell]") > zOf(".layout[data-pi-shell] .dockShield"));
  // The dock cell's inert is set by hand by useShellTiming outside MID (the attribute that rule's
  // `:not([inert])` keys on).
  assert.match(SHELL_TIMING_JS, /if \(dock\) dock\.toggleAttribute\("inert", chromeState !== "mid"\);/);
});

test("views' shield: it has its own layer (will-change: transform) only while it is mounted — the view state until the close has settled, never MID or MIN at rest; the dock band's shield and guard have none", () => {
  // In LayoutPi's stylesheet, only the sheet and the views' shield carry a will-change (both `transform`; the sheet's
  // warm pose `transform, opacity`, the warm-up test).
  const holders = rulesOf(LAYOUT_PI_CSS).filter((r) => /(?:^|;)\s*will-change\s*:/.test(r.body));
  assert.deepEqual(holders.map((r) => r.selector), [".layout[data-pi-shell] .sheet", WARM_POSE, ".layout[data-pi-shell] .shield"]);
  assert.match(ruleBody(LAYOUT_PI_CSS, ".layout[data-pi-shell] .shield"), /(?:^|;)\s*will-change:\s*transform;/);
  // Not the dock band's shield or its double-tap guard: no rule naming them (active or not, reduced motion
  // included) sets one, and none names the views' shield with them.
  for (const { selector, body } of rulesOf(LAYOUT_PI_CSS)) {
    if (/\.dockShield\b|\.dockGuard\b/.test(selector)) assert.doesNotMatch(body, /will-change/, selector);
    if (/(?:^|[\s,])\.layout\[data-pi-shell\] \.shield\b/.test(selector)) assert.equal(selector, ".layout[data-pi-shell] .shield", `the views' shield's will-change shared: ${selector}`);
  }
  // The selector can only match the views' shield: the class is used once in the JSX, on an element rendered
  // only while useShellTiming's `shield` holds, childless (no `position: fixed` descendant can take it as its
  // containing block); the dock band's two are other classes, always mounted. The one other use is the style
  // warm-up's stand-in (ui/styleWarmup.js): a childless div with that class, inserted and removed inside one
  // synchronous task, before any frame — no frame paints it, so no layer is ever made for it.
  assert.equal((LAYOUT_PI_JS.match(/styles\.shield\b/g) || []).length, 2);
  assert.match(LAYOUT_PI_JS, /shieldClassName: styles\.shield,/);
  assert.match(LAYOUT_PI_JS, /\{shell\.shield && <div ref=\{shieldRef\} className=\{styles\.shield\} aria-hidden="true" \/>\}/);
  assert.match(LAYOUT_PI_JS, /className=\{styles\.dockShield\}/);
  assert.match(LAYOUT_PI_JS, /className=\{styles\.dockGuard\}/);
  // `shield` = viewShieldHeld(chromeState, kind, settled): up in every view state, and after a view's close
  // until that switch has settled; down in MID and MIN at rest, and on every MIN <-> MID slide.
  assert.match(SHELL_TIMING_JS, /const shield = active && viewShieldHeld\(chromeState, plan\.kind, settled\);/);
  for (const view of ["max", "conditions", "alert", "ai"]) assert.equal(viewShieldHeld(view, "view", true), true, view);
  assert.equal(viewShieldHeld("mid", "view", false), true, "a view's close, before it has settled");
  for (const state of ["mid", "min"]) {
    assert.equal(viewShieldHeld(state, "view", true), false, `${state} at rest after a view`);
    for (const settled of [false, true]) assert.equal(viewShieldHeld(state, "slide", settled), false, `${state}, slide, ${settled}`);
  }
});

test("views: the four hosts are stacked in the sheet's one cell and always laid out; the other states' are skipped (content-visibility: hidden) and take no tap; without content-visibility they are hidden instead", () => {
  // One grid cell of definite size: an opening only switches which host
  // shows (nothing mounts, nothing goes from display: none to its first
  // layout, the chart keeps its size).
  const inner = ruleBody(LAYOUT_PI_CSS, ".layout[data-pi-shell] .sheetInner");
  for (const decl of [/display:\s*grid;/, /grid-template-columns:\s*minmax\(0, 1fr\);/, /grid-template-rows:\s*minmax\(0, 1fr\);/, /\bmin-height:\s*0;/, /zoom:\s*var\(--c-font-scale, 1\);/]) assert.match(inner, decl);
  const HOSTS = { max: "forecastHost", conditions: "conditionsHost", alert: "alertHost", ai: "aiHost" };
  const hosts = ruleBody(LAYOUT_PI_CSS, Object.values(HOSTS).map((h) => `.layout[data-pi-shell] .${h}`).join(", "));
  for (const decl of [/grid-area:\s*1 \/ 1;/, /display:\s*flex;/, /flex-direction:\s*column;/, /min-width:\s*0;/, /min-height:\s*0;/]) assert.match(hosts, decl);
  // Skipped outside their own state, written for the hidden hosts only
  // (`:not()`): the shown one keeps the initial values, and nothing writes
  // a `content-visibility: visible` (the visibility guard's regex) or
  // hands a host its taps back.
  // Each host is also left out while the root's `data-pi-warm` names its
  // state (useHostWarmup, its warm frame: next test).
  const hiddenSelector = Object.entries(HOSTS).map(([state, host]) => `.layout[data-pi-shell]:not([data-pi-state="${state}"]):not([data-pi-warm="${state}"]) .${host}`).join(", ");
  const hidden = rulesOf(LAYOUT_PI_CSS).filter((r) => r.selector === hiddenSelector);
  assert.equal(hidden.length, 2, "the content-visibility rule and its fallback");
  const [skipped, fallback] = hidden;
  assert.match(skipped.body, /content-visibility:\s*hidden;/);
  // The host's own box still hit-tests: stacked over the shown one, it
  // would take the view's taps.
  assert.match(skipped.body, /pointer-events:\s*none;/);
  // The sheet's box on 800 × 480: 590 px less its 1 px hairline.
  const hairline = Number(ruleBody(LAYOUT_PI_CSS, ".layout[data-pi-shell] .sheet").match(/border-left:\s*(\d+)px/)[1]);
  assert.match(skipped.body, new RegExp(`contain-intrinsic-size:\\s*${W - SHELL_GEOMETRY.sheetLeft - hairline}px ${H}px;`));
  // Without content-visibility (the `@supports not` fallback), the four
  // would paint on top of each other; `visibility: hidden` instead (no
  // tap, focus or accessibility either).
  assert.match(fallback.body, /^\s*visibility:\s*hidden;\s*$/);
  assert.match(stripComments(LAYOUT_PI_CSS), /@supports not \(content-visibility: hidden\)\s*\{\s*\.layout\[data-pi-shell\]:not\(\[data-pi-state="max"\]\):not\(\[data-pi-warm="max"\]\) \.forecastHost,/);
  for (const { selector, body } of rulesOf(LAYOUT_PI_CSS)) {
    if (/Host\b/.test(selector)) assert.doesNotMatch(body, /content-visibility:\s*(?:visible|auto)|pointer-events:\s*auto/, selector);
  }
  // JSX: every host mounted under the overlay shell — the AI view's too, gated on
  // `active` (pre-mount test) — and ChartTabs in its maximized layout in
  // every state (its host shows only in MAX), sizing its chart from its
  // box: Chart.js sizes a new chart in on-screen px (the sheet's zoom at
  // text size S or L) and its ResizeObserver reports nothing in a skipped
  // host, so the first opening drew the chart at the wrong size for two
  // frames, and after a text-size
  // change made while the host was hidden.
  assert.match(LAYOUT_PI_JS, /<ChartTabs piSheet=\{shellVariant !== null\} \/>/);
  assert.match(CHART_TABS_JS, /const ChartTabs = \(\{ piSheet = false \}\) => \{/);
  assert.match(CHART_TABS_JS, /const maximized = piSheet \|\| \(onPi \? piLayoutState === "max" : localMaximized\);/);
  assert.match(CHART_TABS_JS, /sizeFromBox=\{piSheet\}/);
  assert.match(CHART_TABS_JS, /piSheet: PropTypes\.bool,/);
  assert.match(METRIC_CHART_JS, /const MetricChart = \(\{ cadence, metric, precipOverlay, onCycle, sizeFromBox = false \}\) => \{/);
  assert.match(METRIC_CHART_JS, /if \(!sizeFromBox \|\| !chart \|\| !box\) return;\s*const cs = window\.getComputedStyle\(box\);\s*const w = parseFloat\(cs\.width\);\s*const h = parseFloat\(cs\.height\);\s*if \(w > 0 && h > 0\) chart\.resize\(w, h\);\s*\}, \[sizeFromBox, hasChart, fontSize, hasDirRow, metric, cadence\]\);/);
  // …and again when the text size changes (the box resizes under the
  // sheet's zoom while the hidden host reports nothing)…
  assert.match(METRIC_CHART_JS, /speedUnit,\s*fontSize,\s*\} = useContext\(UiPrefsContext\);/);
  // …or when the tab changes while the host is hidden, which resizes the
  // box the same way: the wind-direction row under it comes or goes (its
  // only sibling in MetricChart), and the summary row under the chart
  // area differs per metric. The auto-select feature switching to wind on
  // a gust forecast drew a 484×260.8 chart in a 484×246 box at L for the
  // opening's first two frames; daily
  // wind → precip left 260.8 in 263.3 (found applying it).
  assert.match(METRIC_CHART_JS, /\}, \[metric, series\]\);\s*const hasDirRow = Boolean\(dirArrows\);/);
  assert.match(METRIC_CHART_JS, /\{dirArrows \? \(\s*<div className=\{styles\.windDirRow\}/);
  // One measure is exact only if the box's height doesn't follow the
  // canvas inside it: under the overlay shell the chart area takes the height the other
  // rows leave (flex-basis 0, not the content's, so the summary row never
  // shares a shrink: 245.8 measured for 244.8 at rest, at L). Charts only:
  // the grid tab keeps its natural-height rule; inert without the shell.
  const chartAreaShell = ruleBody(CHART_TABS_CSS, ":global([data-pi-shell]) .slabPiMax .chartArea:not(.chartAreaGrid)");
  assert.match(chartAreaShell, /^\s*flex-basis:\s*0;\s*$/);
  assert.match(ruleBody(CHART_TABS_CSS, ".slabPiMax .chartArea"), /flex:\s*1 1 auto;[\s\S]*min-height:\s*0;/);
  assert.match(METRIC_CHART_JS, /<div className=\{styles\.canvasBox\} ref=\{boxRef\}>\s*\{chart\}\s*<\/div>/);
  // One plugins array and one Chart element per data /
  // options pair, so a render of the chart's parent hands react-chartjs-2
  // nothing new.
  assert.match(METRIC_CHART_JS, /^const CHART_PLUGINS = Object\.freeze\(\[ChartDataLabels\]\);$/m);
  assert.match(METRIC_CHART_JS, /const chart = useMemo\(\(\) => \(chartData \? \(\s*<Chart\s*ref=\{chartRef\}\s*type="bar"\s*data=\{chartData\}\s*options=\{chartOptions\}\s*plugins=\{CHART_PLUGINS\}\s*\/>\s*\) : null\), \[chartData, chartOptions\]\);/);
  assert.doesNotMatch(METRIC_CHART_JS, /plugins=\{\[/);
  assert.match(METRIC_CHART_JS, /sizeFromBox: PropTypes\.bool,/);
});
test("views: every hidden view host is laid out AND painted once before its first opening — one idle frame each at rest with the sheet closed, the sheet then in place at opacity 0.001 with its own layer, dropped on the next frame; again when an alert mounts", () => {
  // A host skipped by content-visibility keeps its layout for the next reveal only once it has been revealed; the
  // first conditions / alert opening after boot paid the host's whole style and layout in its first frame. The
  // first opening since load also paid the first rasterization of the views' content (a frame skipped at the
  // slide's start in 8 first openings out of 8), so each host is painted too. The scheduling:
  // test/sheetWarmup.test.js.
  const WARMUP_JS = fs.readFileSync(path.join(AMBIENT_DIR, "LayoutPi", "useHostWarmup.js"), "utf8");
  // The hook drives ui/sheetWarmup.js's scheduler: inputs heard on the window, idle callbacks, the warm pose
  // taken off at the start of the next frame (afterNextFrame), style flushed on the sheet when an input takes
  // it off; told `atRest` in a layout effect (a switch's own commit takes the pose off before it paints), loaded
  // once the page and its fonts are; content mounted at a host's top (its own children, not its subtree)
  // warms it again; everything disposed on cleanup.
  assert.match(WARMUP_JS, /import \{ afterNextFrame \} from "\.\/useShellTiming";/);
  assert.match(SHELL_TIMING_JS, /export function afterNextFrame\(step\) \{/);
  assert.match(WARMUP_JS, /import \{ createSheetWarmup, whenIdle \} from "~\/ui\/sheetWarmup";/);
  assert.match(WARMUP_JS, /inputTarget: window,/);
  assert.match(WARMUP_JS, /hosts: hosts\.map\(\(\{ state, ref \}\) => \(\{ state, element: \(\) => ref\.current \}\)\),/);
  assert.match(WARMUP_JS, /whenIdle: \(step\) => whenIdle\(step, window\),\s*afterFrames: afterNextFrame,/);
  assert.match(WARMUP_JS, /const sheet = sheetRef\.current;\s*if \(sheet\) window\.getComputedStyle\(sheet\)\.getPropertyValue\("transform"\);/);
  assert.match(WARMUP_JS, /useLayoutEffect\(\(\) => \{\s*atRestRef\.current = atRest;\s*if \(warmupRef\.current\) warmupRef\.current\.setAtRest\(atRest\);\s*\}, \[atRest\]\);/);
  assert.match(WARMUP_JS, /warmup\.setAtRest\(atRestRef\.current\);/);
  assert.match(WARMUP_JS, /if \(document\.readyState === "complete"\) onLoad\(\);\s*else window\.addEventListener\("load", onLoad\);/);
  assert.match(WARMUP_JS, /const fontsReady = document\.fonts \? document\.fonts\.ready : Promise\.resolve\(\);\s*fontsReady\.then\(\(\) => \{\s*if \(!cancelled\) warmup\.setLoaded\(true\);/);
  assert.match(WARMUP_JS, /if \(host && record\.addedNodes\.length > 0\) warmup\.contentChanged\(host\.state\);/);
  assert.match(WARMUP_JS, /observer\.observe\(host\.ref\.current, \{ childList: true \}\)/);
  assert.match(WARMUP_JS, /return \(\) => \{\s*cancelled = true;\s*window\.removeEventListener\("load", onLoad\);\s*if \(observer\) observer\.disconnect\(\);\s*warmup\.dispose\(\);\s*warmupRef\.current = null;\s*\};/);
  assert.doesNotMatch(WARMUP_JS, /setAttribute|removeAttribute/, "the attributes are the scheduler's alone");
  // LayoutPi: the four hosts, conditions and alert first (the overlay shell, under the priority views only), at rest
  // with the sheet closed (MID or MIN, settled) and the data in; nothing under the grid shell.
  assert.match(LAYOUT_PI_JS, /\(shellVariant !== null && priority\s*\? \[\s*\{ state: "conditions", ref: conditionsHostRef \},\s*\{ state: "alert", ref: alertHostRef \},\s*\{ state: "ai", ref: aiHostRef \},\s*\{ state: "max", ref: forecastHostRef \},\s*\]\s*: NO_WARM_HOSTS\),\s*\[shellVariant, priority\],/);
  assert.match(LAYOUT_PI_JS, /useHostWarmup\(warmHosts, shellVariant !== null && \(atMid \|\| focused\) && shell\.settled && currentWeatherData != null, rootRef, sheetRef, styleWarm\);/);
  // The style warm-up (ui/styleWarmup.js, test/styleWarmup.test.js): with the priority views under the overlay shell,
  // the same scheduler runs the style warm-up of the alert's switch once the alert host is warm — its elements LayoutPi's
  // own refs, the views' shield class and the shell registry (its view chrome), in a stable object; none under the grid
  // shell.
  assert.match(LAYOUT_PI_JS, /const styleWarm = useMemo\(\s*\(\) => \(shellVariant !== null && priority\s*\? \{ railRef, dockCellRef, dockShieldRef, dockGuardRef, alertHostRef, shieldClassName: styles\.shield, shellElements \}\s*: null\),\s*\[shellVariant, priority, shellElements\],\s*\);/);
  assert.match(WARMUP_JS, /import \{ createStyleWarmup \} from "~\/ui\/styleWarmup";/);
  assert.match(WARMUP_JS, /export default function useHostWarmup\(hosts, atRest, rootRef, sheetRef, styleWarm = null\) \{/);
  assert.match(WARMUP_JS, /const styleWarmup = styleWarm\s*\? createStyleWarmup\(\{/);
  assert.match(WARMUP_JS, /viewChrome: styleWarm\.shellElements\.viewChrome\(\),\s*zoomBar: findZoomBar\(\),/);
  assert.match(WARMUP_JS, /elements: \(\) => \(\{\s*root,\s*rail: styleWarm\.railRef\.current,\s*sheet: sheetRef\.current,\s*dockCell: styleWarm\.dockCellRef\.current,\s*dockShield: styleWarm\.dockShieldRef\.current,\s*dockGuard: styleWarm\.dockGuardRef\.current,\s*alertHost: styleWarm\.alertHostRef\.current,\s*viewChrome: styleWarm\.shellElements\.viewChrome\(\),\s*zoomBar: findZoomBar\(\),\s*shieldClassName: styleWarm\.shieldClassName,\s*\}\),/);
  assert.match(WARMUP_JS, /if \(!zoomBar \|\| !zoomBar\.isConnected\) zoomBar = root\.querySelector\("\.leaflet-control-zoom"\);/);
  assert.match(WARMUP_JS, /styleWarmup,\s*\}\);/);
  assert.match(WARMUP_JS, /\}, \[hosts, rootRef, sheetRef, styleWarm\]\);/);
  // The views' shield the style warm-up stands in for is the one LayoutPi renders: that class, aria-hidden, before the
  // dock band's shield.
  assert.match(LAYOUT_PI_JS, /\{shell\.shield && <div ref=\{shieldRef\} className=\{styles\.shield\} aria-hidden="true" \/>\}\s*(\{\/\*[\s\S]*?\*\/\}\s*)?<div\s*ref=\{dockShieldRef\}/);
  assert.match(LAYOUT_PI_JS, /<div ref=\{conditionsHostRef\} className=\{styles\.conditionsHost\}>/);
  assert.match(LAYOUT_PI_JS, /<div ref=\{alertHostRef\} className=\{styles\.alertHost\}>/);
  assert.match(LAYOUT_PI_JS, /<div ref=\{aiHostRef\} className=\{styles\.aiHost\}>/);
  assert.match(LAYOUT_PI_JS, /<div ref=\{forecastHostRef\} className=\{styles\.forecastHost\}>/);
  assert.match(LAYOUT_PI_JS, /<div ref=\{sheetRef\} className=\{styles\.sheet\} inert=\{!inView\}>/);
  // CSS. The attribute keys three rules: the hosts' skip and its fallback, where it names each host's own state
  // inside `:not()` (previous test), and the closed sheet's two poses. Closed and not warming: off screen,
  // hidden, no transition. In a warm frame (MID and MIN only, never a view's state): the base rule's open
  // position (no transform of its own), not hidden, at opacity 0.001 (test/sheetWarmup.test.js pins the
  // value), `will-change: transform, opacity` (the compositor applies the opacity, the tiles are rasterized at
  // full alpha), no pointer, no transition. Nothing writes `visibility: visible` (the guard below).
  const keyed = rulesOf(LAYOUT_PI_CSS).filter((r) => /data-pi-warm/.test(r.selector));
  assert.equal(keyed.length, 4, "the hosts' skip and its fallback, the closed sheet, the warm pose");
  const closedSheet = ruleBody(LAYOUT_PI_CSS, '.layout[data-pi-shell][data-pi-state="mid"]:not([data-pi-warm]) .sheet, .layout[data-pi-shell][data-pi-state="min"]:not([data-pi-warm]) .sheet');
  assert.match(closedSheet, /visibility:\s*hidden;/);
  assert.match(closedSheet, /transform:\s*translateX\(100%\);/);
  assert.match(closedSheet, /transition:\s*none;/);
  const warm = ruleBody(LAYOUT_PI_CSS, WARM_POSE);
  assert.match(warm, /(?:^|;)\s*opacity:\s*0\.001;/);
  assert.match(warm, /(?:^|;)\s*will-change:\s*transform, opacity;/);
  assert.match(warm, /(?:^|;)\s*pointer-events:\s*none;/);
  assert.match(warm, /(?:^|;)\s*transition:\s*none;/);
  assert.doesNotMatch(warm, /(?:^|;)\s*(?:transform|visibility)\s*:/, "in place by the base rule, shown by not being hidden");
  for (const { selector } of keyed) {
    for (const part of selector.split(",").map((p) => p.trim())) {
      if (/\.sheet$/.test(part)) assert.match(part, /^\.layout\[data-pi-shell\]\[data-pi-state="(?:mid|min)"\](?::not\(\[data-pi-warm\]\)|\[data-pi-warm\]) \.sheet$/, part);
      else assert.match(part, /:not\(\[data-pi-warm="(\w+)"\]\) \.\w+Host$/, part);
    }
  }
});

test("sheet pre-roll: a view's slide starts one frame into its curve and still lands at 250 ms, its first frame already on screen; none in form 2 and under reduced motion", () => {
  const { durationMs, sheetPrerollMs, easing } = SHELL_MOTION;
  assert.equal(sheetPrerollMs, 17);
  assert.equal(Math.round(1000 / 60), sheetPrerollMs, "one 60 Hz frame");
  // The root's property, zeroed with every other delay in form 2 and under
  // reduced motion.
  const root = customProps(rulesOf(LAYOUT_PI_CSS).find((r) => r.selector === ".layout[data-pi-shell]").body);
  assert.equal(root.get("--pi-sheet-preroll"), `${sheetPrerollMs}ms`);
  const form2 = customProps(ruleBody(LAYOUT_PI_CSS, '.layout[data-pi-form="2"]'));
  const reducedBlock = stripComments(LAYOUT_PI_CSS).match(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.layout\[data-pi-shell\]\s*\{([^}]*)\}/);
  assert.ok(reducedBlock, "no reduced-motion block for the shell's root");
  const reduced = customProps(reducedBlock[1]);
  assert.equal(form2.get("--pi-sheet-preroll"), "0ms");
  assert.equal(reduced.get("--pi-sheet-preroll"), "0ms");
  // The opening slide only (the close is `transition: none`, poses test):
  // the shell's duration plus the pre-roll, started that far in.
  const slide = transitionItems(ruleBody(LAYOUT_PI_CSS, ".layout[data-pi-shell] .sheet")).find((t) => t.prop === "transform");
  assert.equal(slide.duration, "calc(var(--pi-shell-duration) + var(--pi-sheet-preroll))");
  assert.equal(slide.easing, "var(--pi-shell-easing)");
  assert.equal(slide.delay, "calc(-1 * var(--pi-sheet-preroll))");
  /**
   * The slide's duration and delay with the given properties in effect.
   *
   * @param {Map<string, string>} props custom properties (ms values)
   * @returns {{duration: number, delay: number}} ms
   */
  const timing = (props) => {
    const ms = (name) => Number(props.get(name).replace(/ms$/, ""));
    return { duration: ms("--pi-shell-duration") + ms("--pi-sheet-preroll"), delay: -ms("--pi-sheet-preroll") };
  };
  const animated = timing(root);
  assert.deepEqual(animated, { duration: durationMs + sheetPrerollMs, delay: -sheetPrerollMs });
  assert.equal(animated.duration + animated.delay, durationMs, "it lands with the shell, at 250 ms");
  // Form 2 and reduced motion: 0 and 0 — a combined duration of 0 starts
  // no transition at all (and reduced motion's `transition: none` covers
  // the sheet anyway).
  for (const props of [new Map([...root, ...form2]), new Map([...root, ...reduced])]) {
    assert.deepEqual(timing(props), { duration: 0, delay: -0 });
  }
  // The first composited frame of the slide: the curve at 17 / 267 of its
  // time, about 12 % of the sheet's 590 px travel — some 69 px of sheet on
  // screen, where progress 0 (`translateX(100%)`) would show none.
  const controls = easing.match(/^cubic-bezier\(([^)]+)\)$/)[1].split(",").map(Number);
  const shown = cubicBezier(controls)(sheetPrerollMs / animated.duration) * (W - SHELL_GEOMETRY.sheetLeft);
  assert.ok(shown > 60 && shown < 80, `first frame shows ${shown} px`);
  assert.equal(Math.round(shown), 69);
});

test("sheet: it starts its slide in the tap's frame only — no sheet-start switch, no pre-roll pose held by hand", () => {
  // One rule gives the open sheet its transition: the base `.sheet` rule
  // (the pre-roll test above), started by the switch's own commit; the
  // closed poses' `transition: none` is the instant exit.
  const sheetTransitions = rulesOf(LAYOUT_PI_CSS)
    .filter((r) => /\.sheet\b/.test(r.selector) && transitionItems(r.body).some((t) => t.prop === "transform"));
  assert.deepEqual(sheetTransitions.map((r) => r.selector), [".layout[data-pi-shell] .sheet"]);
  // No sheet-start switch, no sheet attribute on the root and no pre-roll
  // pose held by hand, in the layout, its stylesheet or the hook:
  for (const [name, src] of [["LayoutPi/index.js", LAYOUT_PI_JS], ["LayoutPi/styles.css", LAYOUT_PI_CSS], ["useShellTiming.js", SHELL_TIMING_JS]]) {
    assert.doesNotMatch(stripComments(src), /data-pi-sheet-start|data-pi-sheet\b|--pi-sheet-preroll-px|piShellSheetStart|SHEET_PREROLL|SHEET_START/, name);
  }
  const piLayout = fs.readFileSync(path.join(SRC_DIR, "ui", "piLayout.js"), "utf8");
  assert.doesNotMatch(piLayout, /piShellSheetStart|"presented"/);
  // The hook only waits for the sheet's slide; nothing sets an attribute on
  // the root for the opening besides `data-pi-moving`.
  const effect = SHELL_TIMING_JS.slice(SHELL_TIMING_JS.indexOf("root.setAttribute(MOVING_ATTRIBUTE"), SHELL_TIMING_JS.indexOf("// Reduced motion and form 2"));
  assert.deepEqual(effect.match(/root\.setAttribute\(\w+/g), ["root.setAttribute(MOVING_ATTRIBUTE"]);
  assert.match(effect, /if \(plan\.mapWait === "sheet"\) \{\s*const sheet = sheetRef\.current;\s*cancels\.push\(whenStartedTransitionsEnd\(\(\) => shellTransitions\(\[sheet\], "transform"\), \(\) => setSheetLandedId\(id\)\)\);/);
});

test("dock: the open \"···\" menu clears the map's attribution strip in MID", () => {
  // The strip's height, from WeatherMap/styles.css: 10 px font, 1.3 line,
  // 1 px padding above and below — 15 px on one line (MID).
  const attr = ruleBody(WEATHER_MAP_CSS, ".map-wrapper :global(.leaflet-control-attribution)");
  const font = Number(attr.match(/font-size:\s*(\d+)px;/)[1]);
  const line = Number(attr.match(/line-height:\s*([\d.]+);/)[1]);
  const padY = Number(attr.match(/padding:\s*(\d+)px \d+px;/)[1]);
  const stripHeight = font * line + 2 * padY;
  assert.equal(stripHeight, 15);

  // The base block (the other `.layout[data-pi-shell]` is the
  // reduced-motion override).
  const root = customProps(rulesOf(LAYOUT_PI_CSS).find((r) => r.selector === ".layout[data-pi-shell]").body);
  assert.equal(root.get("--pi-attr-height"), `${stripHeight}px`);
  assert.equal(
    root.get("--pi-dock-menu-lift"),
    "max(0px, calc(var(--c-attr-bottom) - var(--c-dock-height) + var(--pi-attr-height)))",
  );
  assert.match(
    ruleBody(OVERFLOW_MENU_CSS, ".menu"),
    /bottom:\s*calc\(100% \+ 12px \+ var\(--pi-dock-menu-lift, 0px\)\);/,
  );

  // MID on 800 × 480: the trigger is centred in the band's content box
  // (1 px hairline, 6 px padding), the menu's bottom 12 px + the lift above
  // its top; the strip sits 2 px above the band.
  const { dockHeight, dockButtonSize } = SHELL_GEOMETRY;
  const { attrBottom } = chromeFor("mid", W);
  const lift = Math.max(0, attrBottom - dockHeight + stripHeight);
  assert.equal(lift, 17);
  const bandTop = H - dockHeight;
  const triggerTop = bandTop + 1 + 6 + (dockHeight - 1 - 2 * 6 - dockButtonSize) / 2;
  const menuBottom = triggerTop - 12 - lift;
  const stripTop = H - attrBottom - stripHeight;
  assert.deepEqual([triggerTop, menuBottom, stripTop], [429.5, 400.5, 405]);
  assert.ok(menuBottom < stripTop, "the open menu covers the attribution");
});

test("dock: closing the \"···\" menu from the keyboard hands focus back to the trigger, a tap doesn't", () => {
  assert.match(OVERFLOW_MENU_JS, /if \(e\.key !== "Escape"\) return;\s*setOpenIn\(CLOSED\);\s*triggerRef\.current\?\.focus\(\);/);
  assert.match(OVERFLOW_MENU_JS, /if \(event\.detail === 0\) triggerRef\.current\?\.focus\(\);\s*item\.onSelect\(triggerRef\.current\);/);
  assert.match(OVERFLOW_MENU_JS, /onClick=\{\(e\) => choose\(item, e\)\}/);
});

test("RailOffsetTracker keeps its default-free parameter pattern: an absent `instant` reads as false", () => {
  // No destructuring default (`instant = false`): `if (!instant)` treats
  // undefined as false (its JSDoc says so).
  const weatherMap = fs.readFileSync(path.join(SRC_DIR, "components", "WeatherMap", "index.js"), "utf8");
  assert.match(weatherMap, /const RailOffsetTracker = \(\{ railOffset, markerPosition, instant \}\) => \{/);
});

// ---------------------------------------------------------------------
// Timing: which frame each part of the shell changes on, and what waits
// for the motion's own end.

test("timing: the mode is form 1 animated, form 1 reduced, or one frame (form 2 / the grid shell)", () => {
  assert.equal(shellMode("d1", false), SHELL_MODES.animated);
  assert.equal(shellMode("d1-still", false), SHELL_MODES.animated);
  assert.equal(shellMode("d1", true), SHELL_MODES.reduced);
  assert.equal(shellMode("d1-still", true), SHELL_MODES.reduced);
  assert.equal(shellMode("d1-form2", false), SHELL_MODES.instant);
  assert.equal(shellMode("d1-form2", true), SHELL_MODES.instant);
  assert.equal(shellMode(null, false), SHELL_MODES.instant, "the grid shell: nothing ever waits");
  assert.ok(VIEW_STATES.every(isViewState));
  assert.ok(!isViewState("mid") && !isViewState("min") && !isViewState(null));
});

test("timing: opening a view (form 1) holds the map until the sheet has slid in, then recentres it without animation", () => {
  for (const view of VIEW_STATES) {
    assert.deepEqual(shellSwitchPlan("mid", view, SHELL_MODES.animated), { kind: "view", chromeWait: null, mapWait: "sheet" }, view);
  }
  // The chrome (sheet, rail fade, dock, shield) starts at once; the map's
  // recentre, the radar stop and the attribution's two lines wait for the
  // sheet — and then happen without animation.
  assert.equal(recentresInstantly(SHELL_MODES.animated, "view"), true);
});

test("timing: closing a view is one frame — sheet hidden, map recentred without animation, attribution back", () => {
  for (const view of VIEW_STATES) {
    assert.deepEqual(shellSwitchPlan(view, "mid", SHELL_MODES.animated), { kind: "view", chromeWait: null, mapWait: null }, view);
  }
  // A view replacing another: the sheet is already in, nothing waits.
  assert.deepEqual(shellSwitchPlan("conditions", "alert", SHELL_MODES.animated), { kind: "view", chromeWait: null, mapWait: null });
});

test("timing: MIN ↔ MID (form 1) slides the chrome and pans the map together, animated", () => {
  assert.deepEqual(shellSwitchPlan("mid", "min", SHELL_MODES.animated), { kind: "slide", chromeWait: null, mapWait: null });
  assert.deepEqual(shellSwitchPlan("min", "mid", SHELL_MODES.animated), { kind: "slide", chromeWait: null, mapWait: null });
  assert.equal(recentresInstantly(SHELL_MODES.animated, "slide"), false);
});

test("timing: reduced motion switches everything in one frame, MIN ↔ MID and the views alike", () => {
  // The chrome and the map change in the switch's own frame, no two-frame split.
  assert.deepEqual(shellSwitchPlan("mid", "min", SHELL_MODES.reduced), { kind: "slide", chromeWait: null, mapWait: null });
  assert.deepEqual(shellSwitchPlan("min", "mid", SHELL_MODES.reduced), { kind: "slide", chromeWait: null, mapWait: null });
  for (const view of VIEW_STATES) {
    assert.deepEqual(shellSwitchPlan("mid", view, SHELL_MODES.reduced), { kind: "view", chromeWait: null, mapWait: null }, view);
    assert.deepEqual(shellSwitchPlan(view, "mid", SHELL_MODES.reduced), { kind: "view", chromeWait: null, mapWait: null }, view);
  }
  assert.equal(recentresInstantly(SHELL_MODES.reduced, "slide"), true);
  assert.equal(recentresInstantly(SHELL_MODES.reduced, "view"), true);
});

test("timing: form 2 switches everything in one frame", () => {
  for (const [from, to] of [["mid", "min"], ["min", "mid"], ["mid", "max"], ["ai", "mid"]]) {
    const plan = shellSwitchPlan(from, to, SHELL_MODES.instant);
    assert.equal(plan.chromeWait, null, `${from} → ${to}`);
    assert.equal(plan.mapWait, null, `${from} → ${to}`);
  }
  assert.equal(recentresInstantly(SHELL_MODES.instant, "slide"), true);
  // No switch, no wait.
  assert.deepEqual(shellSwitchPlan("mid", "mid", SHELL_MODES.animated), { kind: "slide", chromeWait: null, mapWait: null });
});

test("timing: the switch record — numbered from the last committed one, from its target, in the mode of the render that records it, and kept as is while the state holds", () => {
  const { animated, reduced } = SHELL_MODES;
  const mount = initialShellSwitch("mid", animated);
  assert.deepEqual({ ...mount }, { id: 0, from: "mid", to: "mid", mode: animated, plan: shellSwitchPlan("mid", "mid", animated) });
  assert.ok(Object.isFrozen(mount));
  // Same state: the committed record itself (same object, so the hook's
  // effects keyed on it never re-run), whatever the mode is now.
  assert.equal(nextShellSwitch(mount, "mid", reduced), mount);
  // A new state: the next number, from the committed target, planned in
  // the mode current at this render.
  const open = nextShellSwitch(mount, "conditions", animated);
  assert.deepEqual({ ...open }, { id: 1, from: "mid", to: "conditions", mode: animated, plan: shellSwitchPlan("mid", "conditions", animated) });
  assert.equal(open.plan.mapWait, "sheet");
  assert.ok(Object.isFrozen(open));
  // Pure: a render run again before its commit derives the same record.
  assert.deepEqual(nextShellSwitch(mount, "conditions", animated), open);
  // A reduced-motion change mid-switch: the committed record keeps its
  // mode and plan, the next switch takes the new one.
  assert.equal(nextShellSwitch(open, "conditions", reduced), open);
  const close = nextShellSwitch(open, "mid", reduced);
  assert.deepEqual({ ...close }, { id: 2, from: "conditions", to: "mid", mode: reduced, plan: shellSwitchPlan("conditions", "mid", reduced) });
  // Derived from what was COMMITTED: a state that never committed (a
  // render discarded before its commit) is no switch's `from`.
  assert.deepEqual({ ...nextShellSwitch(mount, "max", animated) }, { id: 1, from: "mid", to: "max", mode: animated, plan: shellSwitchPlan("mid", "max", animated) });
});

test("motion end: form 1 with motion waits for its own transitions; reduced motion and form 2 end a frame after the switch", () => {
  assert.equal(motionEnd(SHELL_MODES.animated), "transitions");
  assert.equal(motionEnd(SHELL_MODES.reduced), "frame");
  assert.equal(motionEnd(SHELL_MODES.instant), "frame");
  // Once out, the rail, the dock and the sheet stay laid out (no
  // `display: none` on any of them, in any state), so an entry starts from
  // the tap's own frame, with no frame of layout first — except the dock
  // cell in MIN once its slide is over (the "dock cell in MIN" test: its
  // entry starts from the tap's frame too, from a starting style).
  for (const { selector, body } of rulesOf(LAYOUT_PI_CSS)) {
    if (!/\[data-pi-shell\]|\[data-pi-form=/.test(selector) || !/display:\s*none/.test(body)) continue;
    if (selector === DOCK_MIN) continue;
    assert.doesNotMatch(selector, /\.railFrame|\.sheet\b|> \[data-pi-dock-cell\]|\.dockShield/, `${selector}: out of the render`);
  }
  assert.doesNotMatch(SHELL_TIMING_JS, /flushSync\(\(\) => setPhase|presence|staged/i, "useShellTiming stages the rail, the dock or the sheet in or out of the render");
});

test("shield: a view's gesture lock holds through the view, then until the close has settled — the dock back and 300 ms gone", () => {
  // Up for as long as the chrome shows a view, settled or not.
  for (const view of VIEW_STATES) {
    for (const settled of [false, true]) assert.equal(viewShieldHeld(view, "view", settled), true, `${view} / ${settled}`);
  }
  // A view has closed: up until the close has settled. useShellTiming
  // settles a switch one frame after its last transition (the dock's
  // return under form 1 with motion; at once under reduced motion and
  // form 2) and, for a close, no sooner than settleHoldMs after its
  // commit: the one-frame close keeps the shield 300 ms (maintainer
  // decision), so the second tap of a double tap on "Restore" reaches
  // neither the map nor the MID rail under it.
  assert.equal(viewShieldHeld("mid", "view", false), true);
  assert.equal(viewShieldHeld("mid", "view", true), false);
  assert.equal(SHELL_ONE_FRAME_SHIELD_MS, 300);
  for (const view of VIEW_STATES) {
    assert.equal(settleHoldMs(view, "mid"), SHELL_ONE_FRAME_SHIELD_MS, `${view} → mid`);
    // Opening one, or MIN ↔ MID: no hold (MIN ↔ MID has the dock band's
    // own shield, dockShieldMode).
    assert.equal(settleHoldMs("mid", view), 0, `mid → ${view}`);
    assert.equal(settleHoldMs("conditions", view), 0, `conditions → ${view}`);
  }
  assert.equal(settleHoldMs("mid", "min"), 0);
  assert.equal(settleHoldMs("min", "mid"), 0);
  // MIN ↔ MID never raises the views' full-screen shield, settled or not.
  for (const settled of [false, true]) {
    assert.equal(viewShieldHeld("mid", "slide", settled), false);
    assert.equal(viewShieldHeld("min", "slide", settled), false);
  }
  // The hook: the hold is measured from the switch's commit and only delays
  // the settled render, never `data-pi-moving`.
  assert.match(SHELL_TIMING_JS, /const holdUntil = performance\.now\(\) \+ settleHoldMs\(from, to\);/);
  assert.match(SHELL_TIMING_JS, /root\.removeAttribute\(MOVING_ATTRIBUTE\);\s*const wait = holdUntil - performance\.now\(\);/);
  assert.match(SHELL_TIMING_JS, /const shield = active && viewShieldHeld\(chromeState, plan\.kind, settled\);/);
});

test("dock shield: a MIN ↔ MID switch covers the dock's band until the dock has finished moving, or 300 ms after a one-frame one; never on a view switch", () => {
  // Form 1 with motion: until the dock's own transform transition ends.
  assert.equal(dockShieldMode("mid", "min", SHELL_MODES.animated), "dockEnd");
  assert.equal(dockShieldMode("min", "mid", SHELL_MODES.animated), "dockEnd");
  // One-frame switches (reduced motion, form 2): the
  // dock is gone or back at once, and the shield holds 300 ms (maintainer
  // decision: a double tap after a one-frame switch must not land on what
  // it uncovered).
  for (const mode of [SHELL_MODES.reduced, SHELL_MODES.instant]) {
    assert.equal(dockShieldMode("mid", "min", mode), "hold", mode);
    assert.equal(dockShieldMode("min", "mid", mode), "hold", mode);
  }
  // No switch, or a view switch (the views' full-screen shield covers the
  // band there, and holds until the close has settled): never.
  for (const mode of Object.values(SHELL_MODES)) {
    assert.equal(dockShieldMode("mid", "mid", mode), "none", mode);
    for (const view of VIEW_STATES) {
      assert.equal(dockShieldMode("mid", view, mode), "none", `${mode}: mid → ${view}`);
      assert.equal(dockShieldMode(view, "mid", mode), "none", `${mode}: ${view} → mid`);
    }
  }
  // The hook: raised in the switch's commit (layout effect, before the
  // frame that paints it), lowered by the DOCK's transform transition only
  // (that element, that property), or by the 300 ms timer; every switch
  // sets it anew, so a
  // view opened mid-slide drops it.
  assert.match(SHELL_TIMING_JS, /const shieldMode = dockShieldMode\(from, to, mode\);\s*setDockShield\(shieldEl, shieldMode !== "none"\);/);
  assert.match(SHELL_TIMING_JS, /const lowerDockShield = \(\) => \{\s*setDockShield\(shieldEl, false\);\s*setDockGuard\(guardEl, null\);\s*\};/);
  assert.match(SHELL_TIMING_JS, /setTimeout\(lowerDockShield, SHELL_ONE_FRAME_SHIELD_MS\)/);
  assert.match(SHELL_TIMING_JS, /const dock = dockCellRef\.current;\s*cancels\.push\(whenStartedTransitionsEnd\(\(\) => shellTransitions\(\[dock\], "transform"\), lowerDockShield\)\);/);
  assert.equal((SHELL_TIMING_JS.match(/setDockShield\(shieldEl, false\)/g) || []).length, 1, "the shield is lowered only with its guard");
  assert.match(SHELL_TIMING_JS, /shield\.setAttribute\("data-active", up \? "true" : "false"\);/);
});

test("dock shield: CSS and wiring — mounted once, the dock's band only, over the map and under the dock, blocking only while data-active", () => {
  const body = ruleBody(LAYOUT_PI_CSS, ".layout[data-pi-shell] .dockShield");
  // Exactly the dock's band: full width, at the bottom, the dock's height.
  for (const decl of [/position:\s*absolute;/, /\bleft:\s*0;/, /\bright:\s*0;/, /\bbottom:\s*0;/, /\bheight:\s*var\(--c-dock-height\);/]) {
    assert.match(body, decl);
  }
  assert.doesNotMatch(body, /\binset\b|\btop\s*:/, "the dock shield must not cover the map above the band");
  // Inert unless raised: pointer-events is the switch, no mount / unmount.
  assert.match(body, /pointer-events:\s*none;/);
  assert.match(ruleBody(LAYOUT_PI_CSS, '.layout[data-pi-shell] .dockShield[data-active="true"]'), /pointer-events:\s*auto;/);
  // `touch-action: none` only while raised — at rest
  // it would keep a blocking touch region over the dock's band (pointer-events: none notwithstanding).
  assert.doesNotMatch(body, /touch-action/, "no touch region at rest");
  assert.match(ruleBody(LAYOUT_PI_CSS, '.layout[data-pi-shell] .dockShield[data-active="true"]'), /touch-action:\s*none;/);
  // The rail never reaches the band (railMaxHeight + its gap = the band's top).
  assert.equal(railMaxHeight(480) + SHELL_GEOMETRY.railTop + SHELL_GEOMETRY.railDockGap, 480 - SHELL_GEOMETRY.dockHeight);
  const zOf = (selector) => Number(ruleBody(LAYOUT_PI_CSS, selector).match(/z-index:\s*(\d+);/)[1]);
  const z = zOf(".layout[data-pi-shell] .dockShield");
  assert.ok(z > zOf(".layout[data-pi-shell] .railFrame"), "over the rail");
  assert.ok(z < zOf(".layout[data-pi-shell] > [data-pi-dock-cell]"), "under the dock, which takes its taps as soon as it is back in");
  // JSX: always mounted under the overlay shell as [data-pi-dock-shield]
  // (measurement tooling reads it too), React rendering data-active="false" once and
  // useShellTiming flipping it by hand; before the dock (which must stay
  // the root's last child).
  assert.match(LAYOUT_PI_JS, /<div\s+ref=\{dockShieldRef\}\s+className=\{styles\.dockShield\}\s+data-pi-dock-shield=""\s+data-active="false"\s+aria-hidden="true"\s+\/>/);
  assert.doesNotMatch(LAYOUT_PI_JS, /shell\.dockShield &&/);
  assert.ok(LAYOUT_PI_JS.indexOf("styles.dockShield") < LAYOUT_PI_JS.indexOf("<BottomDock"));
});

test("dock shield: a cut-out over an arriving scrubber, opened in the frame the scrubber shows and closed at once — a visible control never loses a tap to the shield", () => {
  // The entry fades start at 150 ms, inside the dock's 250 ms slide, and
  // the shield (over the map's overlays) holds until the dock's end: the
  // scrubber's bottom 42 px lie in the band. The cut-out uncovers them on
  // the arriving overlays' own delay, so the bar takes its taps the
  // moment it is visible and the map is never bared before that.
  const pts = (body) => {
    const m = body.match(/clip-path:\s*polygon\(evenodd,\s*([^;]+)\);/);
    assert.ok(m, "no evenodd polygon");
    return splitTopLevel(m[1]);
  };
  const closed = pts(ruleBody(LAYOUT_PI_CSS, ".layout[data-pi-shell] .dockShield"));
  const open = pts(ruleBody(LAYOUT_PI_CSS, ".layout[data-pi-shell] .dockShield[data-scrubber]"));
  const OUTER = ["0 0", "100% 0", "100% 100%", "0 100%", "0 0"];
  // Same vertex count (so the change is an interpolable transition, which
  // a delay can hold), same outer ring (the whole band).
  assert.equal(closed.length, open.length);
  assert.deepEqual(closed.slice(0, 5), OUTER);
  assert.deepEqual(open.slice(0, 5), OUTER);
  // Closed: a zero-area hole (every vertex at one point).
  assert.ok(closed.slice(5).every((p) => p === "0 0"), "the closed cut-out has an area");
  // Open: the scrubber's box in the band's coordinates (100% = the band's
  // 58 px), less a corner square where its rounding leaves map bare. The
  // box and the radius are ONE pair of root properties, read by the
  // scrubber's own rule under the shell and by the cut-out alike (no px value shared
  // between the two stylesheets).
  const root = customProps(rulesOf(LAYOUT_PI_CSS).find((r) => r.selector === ".layout[data-pi-shell]").body);
  const bottom = overlayPlacement().scrubber;
  assert.equal(root.get("--pi-scrubber-inset"), `${bottom}px`);
  assert.equal(root.get("--pi-scrubber-radius"), `${SHELL_GEOMETRY.scrubberRadius}px`);
  assert.deepEqual([bottom, SHELL_GEOMETRY.scrubberRadius], [16, 12]);
  assert.ok(bottom < SHELL_GEOMETRY.dockHeight, "the scrubber reaches into the band");
  const scrubberShell = bodiesOf(WEATHER_MAP_CSS, ":global([data-pi-shell]) .radar-timeline");
  for (const decl of [/\bleft:\s*var\(--pi-scrubber-inset\);/, /\bright:\s*var\(--pi-scrubber-inset\);/, /\bbottom:\s*var\(--pi-scrubber-inset\);/, /border-radius:\s*var\(--pi-scrubber-radius\);/]) {
    assert.match(scrubberShell, decl);
  }
  // The grid shell's scrubber keeps the same look: its own radius is the same 12 px,
  // its sides the same 16 px fallback.
  const tl = rulesOf(WEATHER_MAP_CSS).find((r) => r.selector === ".radar-timeline").body;
  assert.match(tl, new RegExp(`border-radius:\\s*${SHELL_GEOMETRY.scrubberRadius}px;`));
  assert.match(tl, new RegExp(`\\bleft:\\s*var\\(--c-edge-gap, ${bottom}px\\);`));
  assert.doesNotMatch(LAYOUT_PI_CSS, /--c-edge-gap\s*:/, "the shell's root must not move the grid shell's scrubber sides");
  const cut = customProps(ruleBody(LAYOUT_PI_CSS, ".layout[data-pi-shell] .dockShield[data-scrubber]"));
  assert.equal(cut.get("--pi-cut-edge"), "var(--pi-scrubber-inset)");
  assert.equal(cut.get("--pi-cut-corner"), "calc(var(--pi-scrubber-inset) + var(--pi-scrubber-radius))");
  const e = "var(--pi-cut-edge)";
  const er = "var(--pi-cut-corner)";
  const yb = "calc(100% - var(--pi-cut-edge))";
  const yr = "calc(100% - var(--pi-cut-corner))";
  assert.deepEqual(open.slice(5), [
    `${e} 0`, `calc(100% - ${e}) 0`, `calc(100% - ${e}) ${yr}`, `calc(100% - ${er}) ${yr}`, `calc(100% - ${er}) ${yb}`,
    `${er} ${yb}`, `${er} ${yr}`, `${e} ${yr}`, `${e} 0`,
  ]);
  // Opened on the arriving overlays' delay as a 0s step (the scrubber's
  // own `visibility` step, same delay, same commit, same clock); closed
  // at once (the base rule has no clip-path transition).
  assert.match(ruleBody(LAYOUT_PI_CSS, ".layout[data-pi-shell] .dockShield[data-scrubber]"), /transition:\s*clip-path 0s linear var\(--pi-overlay-in-delay\);/);
  assert.match(bodiesOf(WEATHER_MAP_CSS, ":global([data-pi-shell]) .radar-timeline"), /visibility 0s linear var\(--pi-overlay-in-delay, 0ms\)/);
  assert.doesNotMatch(ruleBody(LAYOUT_PI_CSS, ".layout[data-pi-shell] .dockShield"), /transition/);
  // Set by hand by the hook, from the DOM, in every commit that changes
  // the chrome: only a mounted, live scrubber opens it (none on ECCC radar
  // or before the frame list); React never renders it. Before the switch's
  // effect, which raises the shield (and reads the transitions two frames
  // later, not in the commit).
  // From the shell registry (ui/shellElements.js
  // `liveScrubber`: a registered overlay named "scrubber" and not inert;
  // test/shellElements.test.js).
  assert.match(SHELL_TIMING_JS, /if \(shield\) shield\.toggleAttribute\("data-scrubber", open\);/);
  assert.match(SHELL_TIMING_JS, /setScrubberCutout\(dockShieldRef\.current, shellElements\.liveScrubber\(\)\);\s*\}, \[active, id, chromeState, scrubberOpen, rootRef, dockShieldRef, shellElements\]\);/);
  assert.ok(SHELL_TIMING_JS.indexOf("setScrubberCutout(dockShieldRef.current") < SHELL_TIMING_JS.indexOf("root.setAttribute(MOVING_ATTRIBUTE"), "the cut-out's effect runs first");
  assert.doesNotMatch(LAYOUT_PI_JS, /data-scrubber=/);
});

test("dock shield: a double-tap guard over the dock click that started the switch — the cut-out never hands a double tap's second tap to the scrubber", () => {
  // The cut-out bares the scrubber's track right over the dock buttons'
  // row (the bar's bottom 42 px lie in the band), so the second tap of a
  // double tap on the dock's timeline button would land on it once the
  // bar shows (from 150 ms; from the first frame under reduced motion)
  // and seek the radar back in time, inside the slide — the tap the
  // shield exists to swallow (the shield is kept 300 ms, reduced motion
  // included). The guard covers that click's spot while the shield is up.
  const body = ruleBody(LAYOUT_PI_CSS, ".layout[data-pi-shell] .dockGuard");
  for (const decl of [
    /position:\s*absolute;/,
    /\bbottom:\s*0;/,
    /\bheight:\s*var\(--c-dock-height\);/,
    /\bwidth:\s*var\(--pi-dock-guard-width\);/,
    /\bleft:\s*calc\(var\(--pi-dock-guard-x, 0px\) - var\(--pi-dock-guard-width\) \/ 2\);/,
    /pointer-events:\s*none;/,
  ]) {
    assert.match(body, decl);
  }
  assert.doesNotMatch(body, /\binset\b|\btop\s*:|\bright\s*:|transition/, "the band only, centred on the click, never animated");
  assert.match(ruleBody(LAYOUT_PI_CSS, '.layout[data-pi-shell] .dockGuard[data-active="true"]'), /pointer-events:\s*auto;/);
  // Like the shield: `touch-action: none` only while raised.
  assert.doesNotMatch(body, /touch-action/, "no touch region at rest");
  assert.match(ruleBody(LAYOUT_PI_CSS, '.layout[data-pi-shell] .dockGuard[data-active="true"]'), /touch-action:\s*none;/);
  // Same z as the shield (over the map's overlays, the scrubber included,
  // under the dock, which takes its taps from its first frame back).
  const zOf = (selector) => Number(ruleBody(LAYOUT_PI_CSS, selector).match(/z-index:\s*(\d+);/)[1]);
  assert.equal(zOf(".layout[data-pi-shell] .dockGuard"), zOf(".layout[data-pi-shell] .dockShield"));
  assert.ok(zOf(".layout[data-pi-shell] .dockGuard") < zOf(".layout[data-pi-shell] > [data-pi-dock-cell]"));
  // A dock button plus 8 px a side.
  const root = customProps(rulesOf(LAYOUT_PI_CSS).find((r) => r.selector === ".layout[data-pi-shell]").body);
  assert.equal(root.get("--pi-dock-guard-width"), `${SHELL_GEOMETRY.dockGuardWidth}px`);
  assert.equal(SHELL_GEOMETRY.dockGuardWidth, SHELL_GEOMETRY.dockButtonSize + 2 * 8);
  // JSX: mounted once under the overlay shell, React rendering data-active="false" only;
  // after the shield (same z, so painted over it), before the sheet and
  // the dock (which must stay the root's last child).
  assert.match(LAYOUT_PI_JS, /<div\s+ref=\{dockGuardRef\}\s+className=\{styles\.dockGuard\}\s+data-pi-dock-guard=""\s+data-active="false"\s+aria-hidden="true"\s+\/>/);
  const at = (needle) => LAYOUT_PI_JS.indexOf(needle);
  assert.ok(at("className={styles.dockShield}") < at("className={styles.dockGuard}"));
  assert.ok(at("className={styles.dockGuard}") < at("className={styles.sheet}"));
  assert.ok(at("className={styles.dockGuard}") < at("<BottomDock"));
  // The hook records the click in the capture phase on the root (before
  // React's onClick, which commits the switch), only a pointer click
  // (`detail` > 0) on the dock, and forgets it after that event's task.
  assert.match(SHELL_TIMING_JS, /root\.addEventListener\("click", onClick, true\);/);
  assert.match(SHELL_TIMING_JS, /root\.removeEventListener\("click", onClick, true\);\s*clearTimeout\(clear\);/);
  assert.match(SHELL_TIMING_JS, /const dock = dockCellRef\.current;\s*dockPressRef\.current = event\.detail > 0 && dock && dock\.contains\(event\.target\) \? \{ x: event\.clientX \} : null;/);
  assert.match(SHELL_TIMING_JS, /clear = setTimeout\(\(\) => \{\s*dockPressRef\.current = null;\s*\}, 0\);/);
  assert.match(SHELL_TIMING_JS, /if \(!active \|\| !root\) return undefined;\s*let clear = 0;/, "the grid shell listens to nothing");
  // The switch's effect consumes it and raises the guard with the shield,
  // never without; it comes down with the shield on both paths (the
  // dock's own transform end, or the 300 ms hold) and on cleanup.
  assert.match(SHELL_TIMING_JS, /const press = dockPressRef\.current;\s*dockPressRef\.current = null;\s*setDockGuard\(guardEl, shieldMode !== "none" && press \? press\.x : null\);/);
  assert.match(SHELL_TIMING_JS, /cancels\.push\(\(\) => setDockGuard\(guardEl, null\)\);/);
  assert.match(SHELL_TIMING_JS, /const DOCK_GUARD_X_PROPERTY = "--pi-dock-guard-x";/);
  assert.match(SHELL_TIMING_JS, /if \(x !== null\) guard\.style\.setProperty\(DOCK_GUARD_X_PROPERTY, `\$\{x\}px`\);\s*guard\.setAttribute\("data-active", x === null \? "false" : "true"\);/);
  assert.match(SHELL_TIMING_JS, /\}, \[active, id, from, to, mode, plan, rootRef, railRef, sheetRef, dockShieldRef, dockGuardRef, dockCellRef, shellElements\]\);/);
});

test("motion: no rail fade beside a view; the end-signal fallback is armed at the transitions' real start, outlasts a Pi 3B's slide, and never ends a running one", () => {
  assert.equal("railFadeMs" in SHELL_MOTION, false);
  // The end signal is the transitions' own Animation.finished; the fallback
  // only covers one that never reports. Sized for a Pi 3B: the 250 ms slide
  // + a long commit frame (≤ 266 ms measured) + event dispatch, so
  // it can't beat the sheet's own end, and still well under a second.
  assert.ok(SHELL_SLIDE_END_FALLBACK_MS >= 650, "the fallback would race the sheet's end on a Pi 3B");
  assert.ok(SHELL_SLIDE_END_FALLBACK_MS < 1000);
  assert.ok(SHELL_END_RECHECK_MS > 0 && SHELL_END_RECHECK_MS <= SHELL_MOTION.durationMs);
  // Armed at the motion's real start:
  // once every tracked transition's `ready` has settled — its start time
  // resolved after the frame that presents the commit, the long one on a
  // Pi 3B — or, without the Web Animations API, one animation frame after
  // the hook's whenTransitionsEnd is called (two frames after the commit,
  // whenStartedTransitionsEnd). Guarded: while a tracked transition still
  // runs it looks again instead of ending the wait.
  assert.match(SHELL_TIMING_JS, /const armFallback = \(\) => \{\s*if \(!done\) timer = setTimeout\(check, SHELL_SLIDE_END_FALLBACK_MS\);\s*\};/);
  assert.match(SHELL_TIMING_JS, /if \(animations === null\) \{\s*frame = requestAnimationFrame\(armFallback\);\s*\} else \{/);
  assert.match(SHELL_TIMING_JS, /Promise\.allSettled\(animations\.map\(\(a\) => a\.ready\)\)\.then\(armFallback\);/);
  assert.match(SHELL_TIMING_JS, /if \(animations !== null && animations\.some\(\(a\) => a\.playState === "running"\)\) \{\s*timer = setTimeout\(check, SHELL_END_RECHECK_MS\);/);
  // The primary signal: every tracked transition's `finished`, settled
  // (a cancelled one rejects, and still counts as over).
  assert.match(SHELL_TIMING_JS, /Promise\.allSettled\(animations\.map\(\(a\) => a\.finished\)\)\.then\(finish\);/);
  // No rail fade beside a view: no rail-fade duration in the stylesheet.
  assert.doesNotMatch(stripComments(LAYOUT_PI_CSS), /--pi-rail-fade-duration/);
});

test("CSS: the rail, dock and sheet poses — laid out in every state, bar the dock cell in MIN once its slide is over, behind @supports (its own test); out is visibility: hidden once their slide or fade has ended, in returns at once", () => {
  const SD = "var(--pi-shell-duration)";
  /**
   * The `visibility` item of a rule's transition: its delay ("0s" when none).
   *
   * @param {string} body declaration block
   * @returns {string} the delay of the visibility step
   */
  const visibilityDelay = (body) => {
    const item = transitionItems(body).find((t) => t.prop === "visibility");
    assert.ok(item, "no visibility step in the transition");
    assert.equal(item.duration, "0s");
    return item.delay || "0s";
  };
  // Rail. Arriving (MID, the base rule): slides and fades in, visible at once.
  const rail = ruleBody(LAYOUT_PI_CSS, ".layout[data-pi-shell] .railFrame");
  assert.doesNotMatch(rail, /(?:^|;)\s*(?:transform|opacity|visibility)\s*:/, "the rail rests in MID with no pose of its own");
  assert.equal(visibilityDelay(rail), "0s");
  // A view switch never moves the rail: no transition at all.
  const railBack = ruleBody(LAYOUT_PI_CSS, '.layout[data-pi-shell][data-pi-switch="view"] .railFrame');
  assert.match(railBack, /^\s*transition:\s*none;\s*$/);
  // MIN: slid off by its width plus the right gap, faded, hidden once the
  // slide is over.
  const railMin = ruleBody(LAYOUT_PI_CSS, '.layout[data-pi-shell][data-pi-state="min"] .railFrame');
  for (const decl of [/transform:\s*translateX\(calc\(100% \+ var\(--pi-rail-right\)\)\);/, /opacity:\s*0;/, /visibility:\s*hidden;/]) assert.match(railMin, decl);
  assert.equal(visibilityDelay(railMin), SD);
  // Views: the rail keeps its MID pose, painted under the sheet at opacity 1 — no state rule of its own.
  for (const view of VIEW_STATES) {
    assert.equal(rulesOf(LAYOUT_PI_CSS).some((r) => r.selector.split(",").some((p) => p.trim() === `.layout[data-pi-shell][data-pi-state="${view}"] .railFrame`)), false, view);
  }
  // Dock. At rest (MID): no transform / filter / will-change / contain —
  // the ControlButtons toast and the "···" backdrop are position: fixed in
  // viewport coordinates; arriving, visible at once.
  const dockIn = ruleBody(LAYOUT_PI_CSS, ".layout[data-pi-shell] > [data-pi-dock-cell]");
  assert.doesNotMatch(dockIn, /(?:^|;)\s*(?:transform|filter|backdrop-filter|will-change|contain|perspective|visibility)\s*:/);
  assert.equal(visibilityDelay(dockIn), "0s");
  // Out (MIN and the views): slid down by its height, faded, inert,
  // hidden once the slide is over.
  for (const state of ["min", ...VIEW_STATES]) {
    const body = sharedRulePart(LAYOUT_PI_CSS, `.layout[data-pi-shell][data-pi-state="${state}"] > [data-pi-dock-cell]`);
    for (const decl of [/transform:\s*translateY\(100%\);/, /opacity:\s*0;/, /visibility:\s*hidden;/, /pointer-events:\s*none;/]) assert.match(body, decl, state);
    assert.equal(visibilityDelay(body), SD, state);
  }
  // Sheet: in the views (the base rule) it slides in, pre-rolled one frame
  // (the next test), visible at once; outside them, off the right edge and
  // hidden, with no transition (the close is one frame).
  const sheet = ruleBody(LAYOUT_PI_CSS, ".layout[data-pi-shell] .sheet");
  assert.doesNotMatch(sheet, /(?:^|;)\s*(?:transform|visibility)\s*:/, "the sheet rests in a view with no pose of its own");
  assert.deepEqual(transitionItems(sheet).map((t) => t.item), [
    "transform calc(var(--pi-shell-duration) + var(--pi-sheet-preroll)) var(--pi-shell-easing) calc(-1 * var(--pi-sheet-preroll))",
    "visibility 0s linear 0s",
  ]);
  for (const state of ["mid", "min"]) {
    const body = rulePart(LAYOUT_PI_CSS, `.layout[data-pi-shell][data-pi-state="${state}"]:not([data-pi-warm]) .sheet`);
    for (const decl of [/transform:\s*translateX\(100%\);/, /visibility:\s*hidden;/, /transition:\s*none;/]) assert.match(body, decl, state);
  }
  // Inert from the switch's own commit, cleared on arrival (LayoutPi).
  assert.match(LAYOUT_PI_JS, /<aside ref=\{railRef\} className=\{styles\.railFrame\} inert=\{!atMid\}>/);
  assert.match(LAYOUT_PI_JS, /<div ref=\{sheetRef\} className=\{styles\.sheet\} inert=\{!inView\}>/);
  assert.match(LAYOUT_PI_JS, /<BottomDock piDockCell cellRef=\{shellVariant \? dockCellRef : undefined\} \/>/);
  // Nothing here ever takes the map (and its attribution) out of the render.
  for (const { selector, body } of rulesOf(LAYOUT_PI_CSS)) {
    if (/display:\s*none|visibility:\s*hidden/.test(body)) assert.doesNotMatch(selector, /mapArea|mapClip/, selector);
  }
});

test("dock cell in MIN: it leaves the render once its slide is over — display: none by a discrete step at the slide's end, back in MID from a starting style keyed on data-pi-moving (none at load), behind @supports; the shared out-pose and the views unchanged", () => {
  const css = stripComments(LAYOUT_PI_CSS);
  // The MIN-only rule and the entry's starting style, alone in their
  // feature query: without discrete transitions the cell keeps the shared rule.
  const block = css.match(/@supports \(transition-behavior: allow-discrete\)\s*\{\s*([^{}]+)\{([^{}]*)\}\s*@starting-style\s*\{\s*([^{}]+)\{([^{}]*)\}\s*\}\s*\}/);
  assert.ok(block, "no @supports block for the dock cell in MIN and its starting style");
  assert.equal(block[1].trim().replace(/\s+/g, " "), DOCK_MIN);
  const body = block[2];
  assert.match(body, /(?:^|;)\s*display:\s*none;/);
  assert.doesNotMatch(body, /(?:^|;)\s*(?:content-visibility|visibility|transform|opacity|pointer-events|contain|will-change)\s*:/, "the MIN-only rule changes nothing but the render");
  // Its transitions: the shared rule's three items as written, then the
  // discrete display step at the slide's end (when `visibility` turns
  // hidden): the slide out is unchanged.
  const shared = transitionItems(sharedRulePart(LAYOUT_PI_CSS, DOCK_MIN)).map((t) => t.item);
  assert.deepEqual(shared, [
    "transform var(--pi-shell-duration) var(--pi-shell-easing)",
    "opacity var(--pi-shell-duration) var(--pi-shell-easing)",
    "visibility 0s linear var(--pi-shell-duration)",
  ]);
  assert.deepEqual(transitionItems(body).map((t) => t.item), [...shared, "display 0s linear var(--pi-shell-duration) allow-discrete"]);
  // The entry: MIN's pose as the starting style of the MID cell, only while
  // a switch moves (data-pi-moving, set in the switch's commit by
  // useShellTiming): the cell's first style at load slides nothing in.
  assert.equal(block[3].trim().replace(/\s+/g, " "), '.layout[data-pi-shell][data-pi-moving][data-pi-state="mid"] > [data-pi-dock-cell]');
  assert.match(block[4], /(?:^|;)\s*transform:\s*translateY\(100%\);/);
  assert.match(block[4], /(?:^|;)\s*opacity:\s*0;/);
  assert.doesNotMatch(block[4], /(?:^|;)\s*(?:display|visibility|transition)\s*:/);
  assert.match(SHELL_TIMING_JS, /root\.setAttribute\(MOVING_ATTRIBUTE, "true"\);/);
  assert.match(SHELL_TIMING_JS, /const MOVING_ATTRIBUTE = "data-pi-moving";/);
  // The one rule that takes the dock cell out of the render, MIN's
  // selector only; the shared out-pose keeps all five states.
  const noneRules = rulesOf(LAYOUT_PI_CSS).filter((r) => /\[data-pi-dock-cell\]/.test(r.selector) && /display:\s*none/.test(r.body));
  assert.deepEqual(noneRules.map((r) => r.selector), [DOCK_MIN]);
  for (const state of ["min", ...VIEW_STATES]) assert.match(sharedRulePart(LAYOUT_PI_CSS, `.layout[data-pi-shell][data-pi-state="${state}"] > [data-pi-dock-cell]`), /visibility:\s*hidden;/, state);
});

test("JSX: LayoutPi runs the timing hook on its own refs; the hook sets the dock cell's `inert`", () => {
  assert.match(LAYOUT_PI_JS, /const shell = useShellTiming\(shellVariant, piLayoutState \|\| "mid", piScrubberOpen, rootRef, railRef, sheetRef, dockShieldRef, dockGuardRef, dockCellRef, shellElements\);/);
  for (const ref of ["rootRef", "railRef", "sheetRef", "dockShieldRef", "dockGuardRef", "dockCellRef"]) assert.match(LAYOUT_PI_JS, new RegExp(`const ${ref} = useRef\\(null\\);`), ref);
  // The shell registry: one per LayoutPi, its ref callbacks handed down
  // under the overlay shell only.
  assert.match(LAYOUT_PI_JS, /const \[shellElements\] = useState\(createShellElements\);/);
  assert.match(LAYOUT_PI_JS, /shellElements=\{shellVariant \? shellElements : undefined\}/);
  assert.match(LAYOUT_PI_JS, /const shownState = shellVariant \? shell\.chromeState : piLayoutState \|\| "mid";/);
  assert.match(LAYOUT_PI_JS, /ref=\{rootRef\}\s*className=\{styles\.layout\}\s*data-pi-state=\{shownState\}\s*\{\.\.\.piShellRootAttributes\(shellVariant\)\}\s*\{\.\.\.shell\.attributes\}/);
  // No transitionend handler anywhere in the shell: the end signal is the
  // transitions' own Animation.finished (useShellTiming).
  assert.doesNotMatch(LAYOUT_PI_JS, /onTransitionEnd/);
  assert.doesNotMatch(BOTTOM_DOCK_JS, /onTransitionEnd/);
  // WeatherMap gets the shell's states only under the overlay shell.
  for (const [prop, field] of [["shellChromeState", "chromeState"], ["shellMapState", "mapState"], ["shellInstantRecentre", "instantRecentre"], ["shellTimelineEngaged", "timelineEngaged"]]) {
    assert.match(LAYOUT_PI_JS, new RegExp(`${prop}=\\{shellVariant \\? shell\\.${field} : undefined\\}`), prop);
  }
  assert.doesNotMatch(LAYOUT_PI_JS, /shellOverlayState/);
  // BottomDock: the dock cell's attribute only when LayoutPi asks
  // (`piDockCell`, both shells), and `cellRef` (overlay shell only): a ref
  // to its wrapper, the dock cell, for the timing hook, which also sets
  // that wrapper's `inert` outside MID, by hand, in the commit of each
  // chrome change (an `inert` prop would render the dock, its buttons and
  // its health chip at every view switch).
  assert.match(BOTTOM_DOCK_JS, /const BottomDock = \(\{ piDockCell = false, cellRef \}\) => \(\s*<div ref=\{cellRef\} className=\{styles\.dock\} data-pi-dock-cell=\{piDockCell \? "" : undefined\}>/);
  assert.match(BOTTOM_DOCK_JS, /BottomDock\.propTypes = \{\s*piDockCell: PropTypes\.bool,\s*cellRef: PropTypes\.shape\(\{ current: PropTypes\.object \}\),\s*\};/);
  const dockCode = BOTTOM_DOCK_JS.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(dockCode, /\binert\b/);
  assert.doesNotMatch(LAYOUT_PI_JS, /<BottomDock[^>]*\binert=/);
  assert.match(SHELL_TIMING_JS, /useLayoutEffect\(\(\) => \{\s*if \(!active\) return;\s*const dock = dockCellRef\.current;\s*inertDockRef\.current = dock;\s*if \(dock\) dock\.toggleAttribute\("inert", chromeState !== "mid"\);\s*shellElements\.present\(chromeState, scrubberOpen\);\s*\}, \[active, chromeState, scrubberOpen, dockCellRef, shellElements\]\);/);
  // The shell turning off under a mounted LayoutPi (defensive: the compiled
  // LayoutPi reads the shell variant once per mount): the dock cell
  // BottomDock keeps rendering goes back without that
  // `inert`, from the element the last present kept (React has detached
  // the cell's ref by then), in a cleanup keyed on the shell alone — no
  // work at a switch.
  assert.match(SHELL_TIMING_JS, /const inertDockRef = useRef\(null\);/);
  assert.match(SHELL_TIMING_JS, /useLayoutEffect\(\(\) => \{\s*if \(!active\) return undefined;\s*return \(\) => \{\s*const dock = inertDockRef\.current;\s*inertDockRef\.current = null;\s*if \(dock\) dock\.removeAttribute\("inert"\);\s*\};\s*\}, \[active\]\);/);
  assert.equal((SHELL_TIMING_JS.match(/removeAttribute\("inert"\)/g) || []).length, 1);
  // …the first of the chrome's layout effects (before the scrubber
  // cut-out's and the switch's own).
  assert.ok(SHELL_TIMING_JS.indexOf("shellElements.present(") < SHELL_TIMING_JS.indexOf("setScrubberCutout(dockShieldRef.current"));
  assert.ok(SHELL_TIMING_JS.indexOf("shellElements.present(") < SHELL_TIMING_JS.indexOf("root.setAttribute(MOVING_ATTRIBUTE"));
});

test("hook: one update per switch — the hook waits on the transitions' own end, never measures, and renders only once the motion is over", () => {
  // The switch is recorded in the render that first sees the new state,
  // in the commit of that state, derived from the last COMMITTED record:
  // no state update during render, so React calls LayoutPi once per
  // switch, not twice; no other state update runs at the tap. The record
  // is read through useSyncExternalStore and written back in a passive
  // effect declared after the reads (ui/committedValue.js,
  // test/committedValue.test.js).
  assert.match(SHELL_TIMING_JS, /const \[committedSwitch, switchStore\] = useCommittedValue\(\(\) => initialShellSwitch\(state, liveMode\)\);\s*const current = active \? nextShellSwitch\(committedSwitch, state, liveMode\) : committedSwitch;/);
  assert.match(SHELL_TIMING_JS, /function useCommittedValue\(init\) \{\s*const \[store\] = useState\(\(\) => createCommittedValue\(init\(\)\)\);\s*return \[useSyncExternalStore\(store\.subscribe, store\.read\), store\];\s*\}/);
  assert.match(SHELL_TIMING_JS, /useEffect\(\(\) => \{\s*switchStore\.write\(current\);\s*engagedStore\.write\(timelineEngaged\);\s*\}, \[switchStore, engagedStore, current, timelineEngaged\]\);/);
  const writeAt = SHELL_TIMING_JS.indexOf("switchStore.write(current)");
  for (const read of ["useCommittedValue(() => initialShellSwitch(", "useCommittedValue(() => wantEngaged)"]) {
    assert.ok(SHELL_TIMING_JS.indexOf(read) >= 0 && SHELL_TIMING_JS.indexOf(read) < writeAt, `the write comes after ${read}`);
  }
  assert.equal((SHELL_TIMING_JS.match(/\.write\(/g) || []).length, 2, "written only by that passive effect");
  assert.doesNotMatch(SHELL_TIMING_JS, /setLastSwitch|setEngaged|lastSwitch\b/);
  // Each switch runs in the mode it was committed in: the
  // record carries it, and every wait, shield and recentre reads it from
  // there, never the per-render preference, so a reduced-motion change
  // can neither re-run the last switch nor split CSS and JS mid-switch
  // (the record's rules: the nextShellSwitch test below).
  assert.match(SHELL_TIMING_JS, /const \{ id, from, to, mode, plan \} = current;/);
  assert.equal((SHELL_TIMING_JS.match(/\bliveMode\b/g) || []).length, 3, "liveMode is read only to plan a new switch");
  // The preference is followed live (a `change` listener, removed on
  // cleanup), like the CSS it pairs with; the grid shell subscribes to nothing.
  // Store and snapshot are ui/systemPrefs.js's: one
  // cached MediaQueryList whose own listener runs first
  // (test/cachedFlags.test.js), so the snapshot read in every render is a
  // variable, and the hook makes no list of its own.
  assert.match(SHELL_TIMING_JS, /const reducedMotion = useSyncExternalStore\(\s*active \? subscribeReducedMotion : subscribeNothing,\s*active \? prefersReducedMotion : readNoReducedMotion,\s*\);/);
  assert.match(SHELL_TIMING_JS, /^import \{ prefersReducedMotion, subscribeReducedMotion \} from "~\/ui\/systemPrefs";$/m);
  assert.doesNotMatch(SHELL_TIMING_JS, /matchMedia|REDUCED_MOTION_QUERY/);
  // The end signal: each moving box's CSS transitions, read from the
  // switch's commit (getAnimations brings style up to date first).
  assert.match(SHELL_TIMING_JS, /for \(const animation of el\.getAnimations\(\)\) \{/);
  assert.match(SHELL_TIMING_JS, /animation instanceof CSSTransition/);
  // Read two frames after the commit (whenStartedTransitionsEnd, through
  // afterNextFrame), never in it: getAnimations() brings style up to date
  // first, and inside the tap's task that would be a forced style recalc
  // the frame would then partly redo (11-23 ms per MIN ↔ MID at 6× CPU
  // throttling in desktop Chromium). The commit's DOM writes stay in it.
  assert.match(SHELL_TIMING_JS, /function whenStartedTransitionsEnd\(read, onEnd\) \{\s*let cancelWait = null;\s*const cancelFrames = afterNextFrame\(\(\) => \{\s*cancelWait = whenTransitionsEnd\(read\(\), onEnd\);\s*\}\);\s*return \(\) => \{\s*cancelFrames\(\);\s*if \(cancelWait\) cancelWait\(\);\s*\};/);
  assert.match(SHELL_TIMING_JS, /cancels\.push\(whenStartedTransitionsEnd\(\(\) => shellTransitions\(moving\), \(\) => \{\s*motion\.ended = true;\s*motion\.finish\(\);\s*\}\)\);/);
  const transitionReads = [...SHELL_TIMING_JS.matchAll(/(\S+ )?shellTransitions\(/g)].filter((m) => m[1] !== "function ");
  assert.equal(transitionReads.length, 3, "the dock's, the moving set's and the sheet's");
  for (const m of transitionReads) assert.equal(m[1], "=> ", "shellTransitions is only called inside a deferred read");
  assert.equal((SHELL_TIMING_JS.match(/\bwhenTransitionsEnd\(/g) || []).length, 2, "defined once, called only by whenStartedTransitionsEnd");
  // The moving set from refs and the shell registry, not
  // from DOM queries in the commit.
  assert.match(SHELL_TIMING_JS, /const moving = \[\s*railRef\.current,\s*dockCellRef\.current,\s*sheetRef\.current,\s*shellElements\.attribution\(\),\s*\.\.\.shellElements\.overlays\(\),\s*\];/);
  // Opening a view, the map waits for the SHEET's own transform
  // transition (that element, that property), not for a timer started at
  // the tap; its fallback is the guarded one armed a frame after the
  // commit (previous test).
  assert.match(SHELL_TIMING_JS, /if \(plan\.mapWait === "sheet"\) \{\s*const sheet = sheetRef\.current;\s*cancels\.push\(whenStartedTransitionsEnd\(\(\) => shellTransitions\(\[sheet\], "transform"\), \(\) => setSheetLandedId\(id\)\)\);/);
  assert.match(SHELL_TIMING_JS, /if \(active && plan\.mapWait === "sheet" && sheetLandedId !== id\) mapState = from;/);
  // The motion's end, one frame later (and after the view's recentre):
  // `data-pi-moving` drops, then the one "settled" render.
  assert.match(SHELL_TIMING_JS, /const MOVING_ATTRIBUTE = "data-pi-moving";/);
  assert.match(SHELL_TIMING_JS, /root\.setAttribute\(MOVING_ATTRIBUTE, "true"\);/);
  assert.match(SHELL_TIMING_JS, /if \(!motion\.ended \|\| !motion\.recentred \|\| motion\.finishing\) return;/);
  assert.match(SHELL_TIMING_JS, /const motion = \{ id, ended: false, recentred: plan\.mapWait !== "sheet",/);
  assert.match(SHELL_TIMING_JS, /if \(!motion \|\| motion\.id !== id \|\| sheetLandedId !== id \|\| motion\.recentred\) return;\s*motion\.recentred = true;\s*motion\.finish\(\);/);
  // Reduced motion and form 2: over one frame after the switch's commit.
  assert.match(SHELL_TIMING_JS, /if \(!active \|\| frameWaiting \|\| motionEnd\(mode\) !== "frame" \|\| !motion \|\| motion\.id !== id\) return;/);
  // The generic one-frame wait, which no plan uses: its second step is
  // committed inside the next frame's requestAnimationFrame.
  assert.match(SHELL_TIMING_JS, /return afterNextFrame\(\(\) => flushSync\(\(\) => setFrameReachedId\(id\)\)\);/);
  assert.match(SHELL_TIMING_JS, /const first = requestAnimationFrame\(\(\) => \{\s*second = requestAnimationFrame\(step\);\s*\}\);/);
  // Every React state update outside the tap's own render is post-motion:
  // the sheet's end, the settled render, the one-frame wait's step — and
  // the scrubber's early engagement, which only the user's own input on
  // the scrubber triggers (engageTimeline, one synchronous commit inside
  // that input's event: engaging at once, rather than queuing the input
  // until ready, keeps a visible control from ever ignoring it). The
  // shields and the guard are DOM writes, not renders.
  const setters = [...SHELL_TIMING_JS.matchAll(/\b(set[A-Z]\w*)\(/g)].map((m) => m[1]).filter((n) => n !== "setTimeout" && n !== "setAttribute" && n !== "setProperty");
  assert.deepEqual([...new Set(setters)].sort(), ["setDockGuard", "setDockShield", "setEarlyEngagedId", "setFrameReachedId", "setScrubberCutout", "setSettledId", "setSheetLandedId"].sort());
  // One function for the hook's lifetime (a new one per switch would
  // re-render RadarTimeline at every switch); the switch it
  // engages is the last committed one, from a ref each commit writes.
  assert.match(SHELL_TIMING_JS, /const engageIdRef = useRef\(id\);\s*useLayoutEffect\(\(\) => \{\s*engageIdRef\.current = id;\s*\}, \[id\]\);\s*const engageTimeline = useCallback\(\(\) => \{\s*flushSync\(\(\) => setEarlyEngagedId\(engageIdRef\.current\)\);\s*\}, \[\]\);/);
  assert.equal((SHELL_TIMING_JS.match(/setEarlyEngagedId\(/g) || []).length, 1, "engaged early only through engageTimeline");
  assert.doesNotMatch(SHELL_TIMING_JS, /setTimeout\(\(\) => set(?!SettledId|DockShield)/, "a timer that renders mid-motion");
  // Reads no layout.
  assert.doesNotMatch(SHELL_TIMING_JS, /getBoundingClientRect|offset(Width|Height|Top|Left)|getComputedStyle|client(Width|Height)/);
  // Cleanups for every frame, timer and wait.
  assert.match(SHELL_TIMING_JS, /cancelAnimationFrame\(first\);\s*cancelAnimationFrame\(second\);/);
  assert.match(SHELL_TIMING_JS, /return \(\) => \{\s*for \(const cancel of cancels\) cancel\(\);\s*\};/);
  assert.match(SHELL_TIMING_JS, /return \(\) => \{\s*done = true;\s*clearTimeout\(timer\);\s*cancelAnimationFrame\(frame\);\s*\};/);
});

test("WeatherMap: under the overlay shell the map follows the shell's map state, its chrome and overlays the chrome state, and the scrubber's work the settled state", () => {
  assert.match(WEATHER_MAP_JS, /const chromeLayoutState = shellChromeState \?\? piLayoutState;/);
  assert.match(WEATHER_MAP_JS, /const mapLayoutState = shellMapState \?\? piLayoutState;/);
  assert.match(WEATHER_MAP_JS, /const railOffset = useRailOffset\(shellMapState\);/);
  assert.match(WEATHER_MAP_JS, /const instantRecentre = shellActive && Boolean\(shellInstantRecentre\);/);
  // The radar loop stops with the map (a view: once its sheet has landed).
  assert.match(WEATHER_MAP_JS, /if \(mapTimestamps && animateWeatherMap && !isPiMaxView\(mapLayoutState\)\) \{/);
  // Zoom, focus button and legend follow the chrome.
  // Under the overlay shell the chrome stays mounted in the views (hidden and inert); the grid shell unmounts it
  // there.
  assert.match(WEATHER_MAP_JS, /const chromeMounted = shellActive \|\| !isPiMaxView\(chromeLayoutState\);/);
  assert.match(WEATHER_MAP_JS, /\{chromeMounted && \(\s*<ZoomControl/);
  // The zoom bar, the focus button and the legend take the shell registry,
  // which sets their `inert` from the chrome's state in the switch's commit
  // (no prop of theirs changes at a switch).
  assert.match(WEATHER_MAP_JS, /\{shellElements && <ShellZoomInert shell=\{shellElements\} lang=\{i18n\.language\} \/>\}/);
  assert.match(WEATHER_MAP_JS, /\{chromeMounted\s*&& \(\(desktopRadarMaximized/);
  assert.match(WEATHER_MAP_JS, /<RadarFocusControl[\s\S]*?shell=\{shellElements\}\s*\/>/);
  assert.doesNotMatch(WEATHER_MAP_JS, /shellViewHidden|shellHidden=/);
  // Which overlay is live: the chrome's state, in the switch's commit.
  assert.match(WEATHER_MAP_JS, /const shellOverlays = shellActive \? overlayPresentation\(chromeLayoutState, piScrubberOpen\) : null;/);
  // The legend's and the scrubber's props are values of their own, never
  // expressions in the JSX: the React Compiler memoizes an
  // element on what its JSX reads, so an inline expression of the chrome's
  // state (or of the presentation object) would give both a new element,
  // with equal props, at every view switch.
  assert.match(WEATHER_MAP_JS, /const legendChipMode = !shellActive && isSmallScreen && \(timelineShown \|\| chromeLayoutState === "mid"\);\s*const scrubberLive = shellOverlays \? shellOverlays\.scrubber : undefined;\s*const scrubberEngaged = shellOverlays \? timelineEngaged : undefined;\s*const scrubberEngage = shellOverlays \? shellEngageTimeline : undefined;\s*const scrubberOverlayRef = shellOverlays && shellElements \? shellElements\.overlayRef : undefined;/);
  assert.match(WEATHER_MAP_JS, /<RadarLegend\s+dark=\{dark\}\s+chipMode=\{legendChipMode\}\s+shell=\{shellElements\}\s*\/>/);
  assert.match(WEATHER_MAP_JS, /shellLive=\{scrubberLive\}\s*shellEngaged=\{scrubberEngaged\}\s*onShellEngage=\{scrubberEngage\}\s*overlayRef=\{scrubberOverlayRef\}/);
  // The scrubber stays mounted under the overlay shell wherever the legend is; its work
  // (playhead snap, the ±2 RainViewer frame window) follows the shell's
  // latched engagement, never the tap's state.
  assert.match(WEATHER_MAP_JS, /const piScrubberEngaged = shellActive \? Boolean\(shellTimelineEngaged\) : \(piLayoutState === "min" && piScrubberOpen\);/);
  assert.match(WEATHER_MAP_JS, /const scrubberMounted = shellActive \? timelineAvailable : timelineShown;/);
  assert.match(WEATHER_MAP_JS, /\{scrubberMounted && \(\s*<RadarTimeline/);
  assert.match(WEATHER_MAP_JS, /const radarWindowActive = timelineShown\s*&& \(animateWeatherMap \|\| currentMapTimestampIdx !== lastPastIdx\);/);
  // The grid shell's chip / card choice, unchanged without the overlay
  // shell (under it RadarLegend ignores it: false there, so a switch
  // changes none of its props).
  assert.match(WEATHER_MAP_JS, /const legendChipMode = !shellActive && isSmallScreen && \(timelineShown \|\| chromeLayoutState === "mid"\);/);
  assert.match(WEATHER_MAP_JS, /shellTimelineEngaged: PropTypes\.bool,/);
  assert.doesNotMatch(WEATHER_MAP_JS, /overlayLayoutState|shellOverlayState/);
  // No other read of the raw state for the map's chrome or loop.
  assert.doesNotMatch(WEATHER_MAP_JS, /isPiMaxView\(piLayoutState\)/);
});

// ---------------------------------------------------------------------
// The dock toast, 44 px touch areas, the hero's raised ⤢, nightRed without
// hard-coded white, and the map overlays' MIN ↔ MID fades.

/**
 * Every rule of every stylesheet under client/src gated on the shell's root
 * (`[data-pi-shell]` or `[data-pi-form=…]` in its selector).
 *
 * @returns {Array<{rel: string, selector: string, body: string}>} the shell's rules, with their file
 */
const d1RulesEverywhere = () =>
  cssFiles(SRC_DIR).flatMap((file) =>
    rulesOf(fs.readFileSync(file, "utf8"))
      .filter((r) => /\[data-pi-shell\]|\[data-pi-form=/.test(r.selector))
      .map((r) => ({ rel: path.relative(SRC_DIR, file), ...r })));

test("toast: under the overlay shell every dock toast is centred over the cleared zone, 8 px above the legend chip, at most 458 px wide", () => {
  const place = toastPlacement(W);
  assert.deepEqual(place, { centreX: 245, bottom: 116, maxWidth: 458 });
  // Centred on the cleared zone, the marker's own x in MID.
  assert.equal(place.centreX, clearedZone(W, H).width / 2);
  assert.equal(place.centreX, markerPoint(railOffsetFor("mid", "d1", W), W, H).x);
  // 116 = dock 58 + the chip's 16 px gap + its 34 px height + 8, the chip
  // read from WeatherMap/styles.css: its top at 372 (the design), the
  // toast's bottom edge 8 px above it.
  const { dockHeight, mapChromeGap, legendChipHeight, toastChipGap, toastSideGap } = SHELL_GEOMETRY;
  assert.deepEqual([mapChromeGap, legendChipHeight, toastChipGap, toastSideGap], [16, 34, 8, 16]);
  assert.match(ruleBody(WEATHER_MAP_CSS, ".legend-chip.legend-chip"), new RegExp(`\\bheight:\\s*${legendChipHeight}px;`));
  const chipBottom = chromeFor("mid", W).mapBottomInset + mapChromeGap;
  assert.equal(H - chipBottom - legendChipHeight, 372);
  assert.equal(place.bottom, chipBottom + legendChipHeight + toastChipGap);
  assert.equal(place.bottom, dockHeight + 16 + 34 + 8);

  // CSS: the root's numbers, and the shell's rule that reads them.
  const root = customProps(rulesOf(LAYOUT_PI_CSS).find((r) => r.selector === ".layout[data-pi-shell]").body);
  assert.equal(root.get("--pi-rail-span"), "calc(var(--pi-rail-width) + var(--pi-rail-right))");
  assert.equal(root.get("--pi-toast-bottom"), `${place.bottom}px`);
  assert.equal(root.get("--pi-toast-side-gap"), `${toastSideGap}px`);
  const toast = ruleBody(CONTROL_BUTTONS_CSS, ":global([data-pi-shell]) .container > div.toast");
  assert.match(toast, /\bleft:\s*calc\(\(100vw - var\(--pi-rail-span\)\) \/ 2\);/);
  assert.match(toast, /\bbottom:\s*var\(--pi-toast-bottom\);/);
  assert.match(toast, /\bmax-width:\s*calc\(100vw - var\(--pi-rail-span\) - 2 \* var\(--pi-toast-side-gap\)\);/);
  // …measured on the visible box (the toast pads 12 px a side).
  assert.match(toast, /\bbox-sizing:\s*border-box;/);
  const span = SHELL_GEOMETRY.railWidth + SHELL_GEOMETRY.railRight;
  assert.equal((W - span) / 2, place.centreX);
  assert.equal(W - span - 2 * toastSideGap, place.maxWidth);
  // Still centred by the shared translateX(-50%) (keyframes included).
  // The base rule (the reduced-motion `animation: none` override of
  // PR 403 shares the selector inside its @media).
  const baseRules = rulesOf(CONTROL_BUTTONS_CSS).filter((r) => r.selector === ".container > div.toast" && /--toast-tx/.test(r.body));
  assert.equal(baseRules.length, 1, "expected exactly one base `.container > div.toast` rule");
  const base = baseRules[0].body;
  assert.match(base, /--toast-tx:\s*-50%;/);
  // Without the overlay shell the toast is unchanged: anchored on its
  // button (inline left / bottom), with its usual fallback and width cap.
  assert.match(base, /\bleft:\s*50%;/);
  assert.match(base, /\bbottom:\s*60px;/);
  assert.match(base, /max-width:\s*min\(360px, calc\(100vw - 24px\)\);/);
  // JS: no anchoring on the shell's dock, so the shell's rule places every toast.
  assert.match(CONTROL_BUTTONS_JS, /if \(e && e\.currentTarget && !dockOverflow\) \{/);
});

test("toast: on the shell's dock a pending toast is dropped once the layout leaves MID, so it can't reappear mid-animation when the dock comes back", () => {
  // Out of MID the shell's dock stays mounted and hidden: laid out in the
  // views, where its toast's `toast-pop` keeps running unseen, and in MIN,
  // behind an `@supports (transition-behavior: allow-discrete)` gate, out
  // of the render once its slide is over. Either way, left alone, the
  // toast would only unmount on its TOAST_TIMEOUT.
  assert.match(sharedRulePart(LAYOUT_PI_CSS, DOCK_MIN), /visibility:\s*hidden;/);
  // Tracked only on the shell's dock (null elsewhere: nothing runs without
  // the shell), cleared during render on any state but MID — only while a
  // toast is up (a toast is raised in MID only, so the state alone
  // tells the departure; the last state seen, kept in a state of its own,
  // would give every switch a second pass of this render).
  assert.match(CONTROL_BUTTONS_JS, /const toastShellState = dockOverflow \? piLayoutState : null;\s*if \(toast\.message && toastShellState !== null && toastShellState !== "mid"\) \{\s*setToast\(\(prev\) => \(\{ \.\.\.prev, message: "" \}\)\);\s*\}/);
  assert.doesNotMatch(CONTROL_BUTTONS_JS, /prevToastShellState/);
  // Clearing the message unmounts the toast (rendered only while set).
  assert.match(CONTROL_BUTTONS_JS, /const toastNode = toast\.message \? \(/);
});

test("touch: 44 px areas around the dock chip and the hero ⤢, 44 px on screen at every text size, under the overlay shell only; the compact alert card is one button; the 28 px squares are unchanged", () => {
  // Every zone is centred on its square and sized on its own (never from
  // the host's box: `inset: -8px`, resolved against the chip's PADDING
  // box, would give 42 px). The dock chip is outside the rail's font-scale
  // zoom: a plain 44px. The two ⤢ are inside it (the rail and its cards
  // are zoomed by --c-font-scale), so 44px divided by the scale is 44 px
  // on screen at S, M and L alike (`inset: -8px` would give 37.4, 44
  // and 50.6 px).
  const cases = [
    { name: "HealthIndicator", css: HEALTH_CSS, host: ":global([data-pi-shell]) .chipButton.chipButton", size: "44px" },
    { name: "HeroCompact", css: HERO_CSS, host: ":global([data-pi-shell]) .maximize.maximize", size: "calc(44px / var(--c-font-scale, 1))" },
  ];
  const AREA = 8;
  const ZONE = 44;
  const esc = (v) => v.replace(/[()/*.]/g, "\\$&");
  const ZONE_DECL = /\b(?:width|height):\s*(?:44px|calc\(44px \/ var\(--c-font-scale, 1\)\));/;
  for (const { name, css, host, size } of cases) {
    const after = ruleBody(css, `${host}::after`);
    assert.match(after, /content:\s*"";/, name);
    assert.match(after, /position:\s*absolute;/, name);
    assert.doesNotMatch(after, /\binset\b/, `${name}: the zone must not derive from the host's box`);
    for (const decl of [/\bleft:\s*50%;/, /\btop:\s*50%;/, new RegExp(`\\bwidth:\\s*${esc(size)};`), new RegExp(`\\bheight:\\s*${esc(size)};`), /\btransform:\s*translate\(-50%, -50%\);/]) {
      assert.match(after, decl, name);
    }
    if (size === "44px") {
      assert.doesNotMatch(after, /font-scale|zoom/, `${name}: the dock is not zoomed, the zone must not scale`);
      // Nothing else transforms the chip (its zone would follow a scale).
      for (const { selector, body } of rulesOf(css)) {
        if (/\.chipButton/.test(selector) && !/::after/.test(selector)) assert.doesNotMatch(body, /(?:^|;)\s*transform\s*:/, selector);
      }
    }
    // The pseudo-element's box is its host's: a positioned host.
    const hostBodies = rulesOf(css).filter((r) => r.selector === host || r.selector === host.replace(/^:global\(\[data-pi-shell\]\) /, "")).map((r) => r.body).join("\n");
    assert.match(hostBodies, /position:\s*(relative|absolute);/, `${name}: the ::after needs a positioned host`);
    // Every such hit area in the file is gated on the shell's root.
    for (const { selector, body } of rulesOf(css)) {
      if (/::after/.test(selector) && (/\binset:\s*-\d+px;/.test(body) || ZONE_DECL.test(body))) {
        for (const part of selector.split(",")) assert.match(part, /^\s*:global\(\[data-pi-shell\]\) /, `${name}: ungated hit area (${part.trim()})`);
      }
    }
  }
  // On screen: the rail's internal px times the scale (ui/fontSize.js's
  // S / M / L: 0.85, 1, 1.15) — 44 px at each.
  const SCALES = { s: 0.85, m: 1, l: 1.15 };
  assert.match(FONT_SIZE_JS, /export const FONT_SIZE_ZOOM = \{ s: 0\.85, m: 1\.0, l: 1\.15 \};/);
  for (const scale of Object.values(SCALES)) assert.ok(Math.abs((ZONE / scale) * scale - ZONE) < 1e-9);
  // The squares stay 28 px: the hero's own, the RailSquareButton the
  // compact card uses, and the chip (18 px disc + 2 × 4 px + 2 × 1 px,
  // checked in the dock row test above) — 28 + 2 × 8 = 44 at M.
  const square = (css, selector) => {
    const body = ruleBody(css, selector);
    return [Number(body.match(/\bwidth:\s*(\d+)px;/)[1]), Number(body.match(/\bheight:\s*(\d+)px;/)[1])];
  };
  assert.deepEqual(square(HERO_CSS, ".maximize.maximize"), [28, 28]);
  assert.deepEqual(square(RAIL_SQUARE_CSS, ".square.square"), [28, 28]);
  assert.equal(28 + 2 * AREA, 44);
  // The compact alert card: the whole card is the target, so its ⤢ has no area of its own
  // and the "1 / N" is a passive indicator.
  assert.equal(rulesOf(ALERT_BANNER_CSS).some((r) => /\.compactMax/.test(r.selector) && /::after/.test(r.selector)), false);
  assert.equal(rulesOf(ALERT_BANNER_CSS).some((r) => /\.compactBottom \.cycleCounter/.test(r.selector)), false);
  assert.doesNotMatch(ruleBody(ALERT_BANNER_CSS, ".cycleIndicator"), /cursor|background/);
  // None of the shell's rules above repaints the squares.
  for (const { css, host } of cases) {
    for (const { selector, body } of rulesOf(css)) {
      if (selector === host) assert.doesNotMatch(body, /\b(width|height|background|border|padding)\b/, selector);
    }
  }
});

test("hero: the ⤢ sits 4 px higher under the overlay shell (top 6 instead of 10)", () => {
  const gridTop = Number(ruleBody(HERO_CSS, ".maximize.maximize").match(/\btop:\s*(\d+)px;/)[1]);
  const shellTop = Number(ruleBody(HERO_CSS, ":global([data-pi-shell]) .maximize.maximize").match(/\btop:\s*(\d+)px;/)[1]);
  assert.deepEqual([gridTop, shellTop], [10, 6]);
  assert.equal(gridTop - shellTop, 4);
});

test("nightRed under the overlay shell: no hard-coded white — the dock counter in --c-bg, the health chip a --c-text ring, the play button --c-bg, the Leaflet flag hidden (never the strip)", () => {
  const NR = ':global(.ambientRoot[data-palette="nightRed"]) :global([data-pi-shell])';
  // Dock counter: its ink is inline (#fff on the red, orange and grey
  // tiers), so only !important gets past it.
  assert.match(CONTROL_BUTTONS_JS, /style=\{\{ backgroundColor: nearbyWorst\.bg, color: nearbyWorst\.fg \}\}/);
  assert.match(ruleBody(CONTROL_BUTTONS_CSS, `${NR} .alert-count-badge`), /color:\s*var\(--c-bg\) !important;/);
  // Health chip: a 1.5 px --c-text ring around a --c-text glyph, no fill.
  const icon = ruleBody(HEALTH_CSS, `${NR} .chipIcon`);
  assert.match(icon, /background-color:\s*transparent !important;/);
  assert.match(icon, /\bcolor:\s*var\(--c-text\);/);
  assert.match(icon, /box-shadow:\s*0 0 0 1\.5px var\(--c-text\);/);
  assert.match(ruleBody(HEALTH_CSS, `${NR} .chipIcon svg path, ${NR} .chipIcon svg line`), /stroke:\s*var\(--c-text\);/);
  assert.match(ruleBody(HEALTH_CSS, `${NR} .chipIcon svg circle`), /fill:\s*var\(--c-text\);/);
  // The usual nightRed chip (a --c-text disc, dark glyph) stays without the shell.
  assert.match(ruleBody(HEALTH_CSS, '[data-palette="nightRed"] .chipIcon'), /background-color:\s*var\(--c-text\) !important;/);
  // The timeline's play button already inks in --c-bg in nightRed.
  assert.match(
    ruleBody(WEATHER_MAP_CSS, ':global(.ambientRoot[data-palette="nightRed"]) .rt-play, :global(.ambientRoot[data-palette="nightRed"]) .rt-play:active'),
    /color:\s*var\(--c-bg, #100404\);/,
  );
  // The Leaflet flag (the attribution's yellow stripe) is hidden in
  // nightRed — the flag only: the strip itself stays (test/mapAttribution).
  const flag = rulesOf(RESET_CSS).find((r) => /\.leaflet-attribution-flag/.test(r.selector));
  assert.ok(flag, "no nightRed rule for the Leaflet flag in ui/reset.css");
  assert.equal(flag.selector, '.ambientRoot[data-palette="nightRed"] .leaflet-attribution-flag');
  assert.match(flag.body, /display:\s*none !important;/);
  // And no rule of the shell anywhere paints a literal white.
  for (const { rel, selector, body } of d1RulesEverywhere()) {
    // (`white` the colour, never `white-space`.)
    assert.doesNotMatch(body, /#fff\b|#ffffff\b|\bwhite\b(?!-)|255,\s*255,\s*255/i, `${rel}: ${selector}`);
  }
});

test("overlays: one live per state — the chip in MID, the card (or the raised chip and the scrubber) and the banner in MIN, none in the views", () => {
  assert.deepEqual(overlayPresentation("mid", false), { legend: "chip", scrubber: false, banner: false });
  // The scrubber flag never shows anything in MID (it clears once the
  // switch out of MIN has settled; meanwhile the chrome says MID).
  assert.deepEqual(overlayPresentation("mid", true), { legend: "chip", scrubber: false, banner: false });
  assert.deepEqual(overlayPresentation("min", false), { legend: "card", scrubber: false, banner: true });
  assert.deepEqual(overlayPresentation("min", true), { legend: "chipRaised", scrubber: true, banner: true });
  for (const view of VIEW_STATES) {
    for (const open of [false, true]) assert.deepEqual(overlayPresentation(view, open), { legend: "none", scrubber: false, banner: false }, view);
  }
  // Frozen and identity-stable (React props).
  assert.ok(Object.isFrozen(overlayPresentation("mid", false)));
  assert.equal(overlayPresentation("min", true), overlayPresentation("min", true));
  // Exactly one legend presentation and at most one scrubber per state.
  for (const state of ["mid", "min"]) {
    for (const open of [false, true]) {
      const p = overlayPresentation(state, open);
      assert.ok(["chip", "chipRaised", "card"].includes(p.legend), `${state}/${open}`);
      assert.equal(p.scrubber, p.legend === "chipRaised", `${state}/${open}: the raised chip goes with the scrubber`);
    }
  }
});

test("motion: overlays leave in 100 ms and arrive at 150–300 ms — every transition of the shell done by 300 ms, every delay 0 in form 2 and under reduced motion", () => {
  const { durationMs, overlayOutMs, overlayInDelayMs, overlayInMs, overlayShiftPx } = SHELL_MOTION;
  assert.deepEqual([overlayOutMs, overlayInDelayMs, overlayInMs, overlayShiftPx], [100, 150, 150, 8]);
  // Those leaving are gone before the slide ends; those arriving start
  // once they are gone (never two overlays fading at once) and are done
  // by 300 ms (150–300 ms): the whole choreography in
  // 300 ms.
  assert.ok(overlayOutMs < durationMs);
  assert.ok(overlayInDelayMs >= overlayOutMs, "an arriving overlay overlaps one still leaving");
  assert.ok(overlayInDelayMs < durationMs, "the entry fades start inside the slide");
  assert.equal(overlayInDelayMs + overlayInMs, 300);
  const root = customProps(rulesOf(LAYOUT_PI_CSS).find((r) => r.selector === ".layout[data-pi-shell]").body);
  assert.equal(root.get("--pi-overlay-out-duration"), `${overlayOutMs}ms`);
  assert.equal(root.get("--pi-overlay-in-delay"), `${overlayInDelayMs}ms`);
  assert.equal(root.get("--pi-overlay-in-duration"), `${overlayInMs}ms`);
  assert.equal(root.get("--pi-overlay-shift"), `${overlayShiftPx}px`);
  // Form 2 and reduced motion: every duration AND every delay 0.
  const ZEROED = ["--pi-shell-duration", "--pi-overlay-out-duration", "--pi-overlay-in-delay", "--pi-overlay-in-duration", "--pi-sheet-preroll"];
  const form2 = customProps(ruleBody(LAYOUT_PI_CSS, '.layout[data-pi-form="2"]'));
  const reducedBlock = stripComments(LAYOUT_PI_CSS).match(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.layout\[data-pi-shell\]\s*\{([^}]*)\}/);
  assert.ok(reducedBlock, "no reduced-motion block for the shell's root");
  const reduced = customProps(reducedBlock[1]);
  for (const name of ZEROED) {
    assert.equal(form2.get(name), "0ms", `form 2: ${name}`);
    assert.equal(reduced.get(name), "0ms", `reduced motion: ${name}`);
  }
  // Since PR 411 styles/main.css removes every transition under reduced motion (`transition: none`, delays
  // included); the zeroed delays above stay as the shell's guard behind it.
  assert.match(stripComments(fs.readFileSync(path.join(SRC_DIR, "styles", "main.css"), "utf8")), /\*, \*::before, \*::after \{[^}]*transition:\s*none !important;/);
  assert.doesNotMatch(stripComments(fs.readFileSync(path.join(SRC_DIR, "styles", "main.css"), "utf8")), /transition-delay/, "main.css declares a transition-delay: revisit the shell's variables");

  // Every transition in a rule of the shell, in any stylesheet: transform
  // or opacity, `visibility` as a 0s step; durations and delays resolved
  // against the shell's root (and again against the form-2 and
  // reduced-motion overrides). Each item, delay + duration, ends by
  // 300 ms; every delay is a custom property of the shell, so it drops to
  // 0 with them; nothing else animates
  // (the dock band shield's cut-out is a 0s `clip-path` step on the
  // arriving overlays' delay: a hit area, it never paints). The one
  // negative delay is the view sheet's pre-roll (its own test below): its
  // slide starts that far into its curve, so what plays on screen is the
  // duration less it.
  const PREROLL_DELAY = "calc(-1 * var(--pi-sheet-preroll))";
  /**
   * Resolve a time token against a set of custom properties.
   *
   * @param {string} token e.g. "250ms", "0s", "var(--pi-shell-duration)", "var(--x, 0ms)", "calc(var(--a) + var(--b))", "calc(-1 * var(--a))"
   * @param {Map<string, string>} props the custom properties in effect
   * @returns {number} ms
   */
  const resolve = (token, props) => {
    let m = token.match(/^(\d+(?:\.\d+)?)(ms|s)$/);
    if (m) return Number(m[1]) * (m[2] === "s" ? 1000 : 1);
    m = token.match(/^calc\((var\([^()]*\)) \+ (var\([^()]*\))\)$/);
    if (m) return resolve(m[1], props) + resolve(m[2], props);
    m = token.match(/^calc\(-1 \* (var\([^()]*\))\)$/);
    if (m) return -resolve(m[1], props);
    m = token.match(/^var\((--[\w-]+)(?:,\s*(.+))?\)$/);
    assert.ok(m, `unexpected time ${token}`);
    return resolve(props.has(m[1]) ? props.get(m[1]) : m[2], props);
  };
  const variants = { animated: root, form2: new Map([...root, ...form2]), reduced: new Map([...root, ...reduced]) };
  const durations = new Set();
  for (const { rel, selector, body } of d1RulesEverywhere()) {
    assert.doesNotMatch(body, /\banimation\b|\binfinite\b/, `${rel}: ${selector}`);
    // will-change: the sheet's (its warm pose's too) and the views' shield's alone (the test above pins them).
    if (![".layout[data-pi-shell] .sheet", WARM_POSE, ".layout[data-pi-shell] .shield"].includes(selector)) assert.doesNotMatch(body, /will-change/, `${rel}: ${selector}`);
    for (const { item, prop, duration, delay } of transitionItems(body)) {
      if (prop === "none") continue;
      // The dock cell's MIN-only discrete step (DOCK_MIN_STEP).
      const steps = /\.dockShield\b/.test(selector) ? ["visibility", "clip-path"] : selector === DOCK_MIN ? ["visibility", DOCK_MIN_STEP] : ["visibility"];
      assert.ok(["transform", "opacity", ...steps].includes(prop), `${rel}: ${selector}: transition on "${prop}"`);
      if (steps.includes(prop)) assert.equal(duration, "0s", `${rel}: ${selector}: ${item}`);
      if (delay === PREROLL_DELAY) assert.equal(selector, ".layout[data-pi-shell] .sheet", `${rel}: a pre-roll outside the view sheet (${item})`);
      else if (delay && delay !== "0s") assert.match(delay, /^var\(--pi-[\w-]+(?:, 0ms)?\)$/, `${rel}: ${selector}: a hard-coded delay (${item})`);
      for (const [name, props] of Object.entries(variants)) {
        const ms = resolve(duration, props) + (delay ? resolve(delay, props) : 0);
        // On screen: a negative delay's part has already played at start.
        const played = resolve(duration, props) + Math.min(0, delay ? resolve(delay, props) : 0);
        if (name === "animated") {
          assert.ok(played <= durationMs, `${rel}: ${selector}: ${item}`);
          assert.ok(ms <= overlayInDelayMs + overlayInMs, `${rel}: ${selector}: ends at ${ms} ms (${item})`);
          if (!steps.includes(prop)) durations.add(played);
        } else {
          assert.equal(ms, 0, `${name}: ${rel}: ${selector}: ${item} still takes ${ms} ms`);
        }
      }
    }
  }
  assert.deepEqual([...durations].sort((a, b) => a - b), [overlayOutMs, overlayInMs, durationMs].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b));
});

test("CSS: the overlays fade by opacity, hidden (never opacity alone) and inert out of their state — the scrubber rises 8 px, the banner drops 8 px; the attribution never fades", () => {
  const easing = "var\\(--pi-shell-easing, ease-out\\)";
  const tin = (prop) => `${prop} var\\(--pi-overlay-in-duration, 0ms\\) ${easing} var\\(--pi-overlay-in-delay, 0ms\\)`;
  const tout = (prop) => `${prop} var\\(--pi-overlay-out-duration, 0ms\\) ${easing}`;
  const vin = "visibility 0s linear var\\(--pi-overlay-in-delay, 0ms\\)";
  const vout = "visibility 0s linear var\\(--pi-overlay-out-duration, 0ms\\)";
  // Live (arriving): wait out the slide, then fade in; visible as the fade starts.
  assert.match(
    ruleBody(WEATHER_MAP_CSS, ":global([data-pi-shell]) .radar-legend, :global([data-pi-shell]) .legend-chip.legend-chip"),
    new RegExp(`transition:\\s*${tin("opacity")},\\s*${vin};`),
  );
  assert.match(
    bodiesOf(WEATHER_MAP_CSS, ":global([data-pi-shell]) .radar-timeline"),
    new RegExp(`transition:\\s*${tin("opacity")},\\s*${tin("transform")},\\s*${vin};`),
  );
  assert.match(
    ruleBody(FMB_CSS, ":global([data-pi-shell]) .banner.banner"),
    new RegExp(`transition:\\s*${tin("opacity")},\\s*${tin("transform")},\\s*${vin};`),
  );
  // Inert (another state's): fade out in 100 ms where they are, then
  // hidden. Opacity alone would keep a backdrop blur rendering over the
  // moving map (the chip, the card and the scrubber carry one).
  const legendOut = ruleBody(WEATHER_MAP_CSS, ":global([data-pi-shell]) .radar-legend[inert], :global([data-pi-shell]) .legend-chip.legend-chip[inert]");
  for (const decl of [/opacity:\s*0;/, /visibility:\s*hidden;/]) assert.match(legendOut, decl);
  assert.doesNotMatch(legendOut, /transform/, "the chip's :active scale stays instant");
  assert.match(legendOut, new RegExp(`transition:\\s*${tout("opacity")},\\s*${vout};`));
  const scrubOut = ruleBody(WEATHER_MAP_CSS, ":global([data-pi-shell]) .radar-timeline[inert]");
  for (const decl of [/opacity:\s*0;/, /visibility:\s*hidden;/, /transform:\s*translateY\(var\(--pi-overlay-shift, 0px\)\);/]) assert.match(scrubOut, decl);
  assert.match(scrubOut, new RegExp(`transition:\\s*${tout("opacity")},\\s*${tout("transform")},\\s*${vout};`));
  const fmbOut = ruleBody(FMB_CSS, ":global([data-pi-shell]) .banner.banner[inert]");
  for (const decl of [/opacity:\s*0;/, /visibility:\s*hidden;/, /transform:\s*translateY\(calc\(-1 \* var\(--pi-overlay-shift, 0px\)\)\);/]) assert.match(fmbOut, decl);
  assert.match(fmbOut, new RegExp(`transition:\\s*${tout("opacity")},\\s*${tout("transform")},\\s*${vout};`));
  for (const [name, css] of [["legend / chip / scrubber", WEATHER_MAP_CSS], ["banner", FMB_CSS]]) {
    for (const { selector, body } of rulesOf(css)) {
      if (/data-pi-shell/.test(selector) && /opacity:\s*0;/.test(body)) {
        assert.match(body, /visibility:\s*hidden;/, `${name}: ${selector} hides by opacity alone`);
        assert.match(selector, /\[inert\]/, `${name}: ${selector}: the out pose is keyed on inert, never on a state`);
        assert.doesNotMatch(selector, /data-pi-(state|map|overlay)/, selector);
      }
    }
  }
  // …and the scrub surface, belt and braces: its range input sets its own
  // `pointer-events: auto` (`.rt-scrubber`). Aimed at that input, never `*`.
  assert.match(ruleBody(WEATHER_MAP_CSS, ".rt-scrubber"), /pointer-events:\s*auto;/);
  assert.match(ruleBody(WEATHER_MAP_CSS, ":global([data-pi-shell]) .radar-timeline[inert] .rt-scrubber"), /pointer-events:\s*none;/);
  assert.equal(rulesOf(WEATHER_MAP_CSS).some((r) => r.selector.includes(".radar-timeline[inert] *")), false);
  // The legend card has nothing interactive to override its none.
  assert.match(ruleBody(WEATHER_MAP_CSS, ".radar-legend"), /pointer-events:\s*none;/);
  for (const { selector, body } of rulesOf(WEATHER_MAP_CSS)) {
    if (/pointer-events:\s*auto/.test(body)) assert.match(selector, /^\.(radar-timeline|rt-scrubber)$/, selector);
  }
  // Without the overlay shell the banner is unchanged: no transition, no pose.
  assert.doesNotMatch(ruleBody(FMB_CSS, ".banner.banner"), /transition|transform|opacity|visibility/);
  // Every FloatingMiniBanner rule naming the shell is gated on it.
  for (const { selector } of rulesOf(FMB_CSS)) {
    if (/data-pi-/.test(selector)) assert.match(selector, /^:global\(\[data-pi-shell\]/, selector);
  }
  // The attribution never takes an overlay's pose or a fade: no rule of the shell on
  // it reads the overlay variables or hides it (test/mapAttribution
  // forbids the latter everywhere).
  for (const { rel, selector, body } of d1RulesEverywhere()) {
    if (!/leaflet-(bottom|control-attribution)/.test(selector)) continue;
    assert.doesNotMatch(selector, /inert|data-pi-overlay/, `${rel}: ${selector}`);
    assert.doesNotMatch(body, /--pi-overlay|\bopacity\b|visibility|display:\s*none/, `${rel}: ${selector}`);
  }
});

test("pre-mount: the legend's chip, raised chip and card, the scrubber and the FloatingMiniBanner are all mounted under the overlay shell, inert outside their state, with nothing running while hidden", () => {
  // RadarLegend: under the overlay shell all three presentations, `inert`
  // unless live, tagged for the CSS, the shell's motion tracking and
  // measurement tooling. Which one is live is the shell registry's
  // presentation, which sets their `inert` by hand at each chrome change.
  assert.match(RADAR_LEGEND_JS, /if \(shell\) \{\s*presentations = \[\s*renderChip\("chip", shellLive === "chip"\),\s*renderChip\("chip-raised", shellLive === "chipRaised"\),\s*renderCard\("card", shellLive === "card"\),\s*\];/);
  assert.match(RADAR_LEGEND_JS, /presentations = chipMode \? renderChip\(undefined, true\) : renderCard\(undefined, true\);/);
  assert.match(RADAR_LEGEND_JS, /data-pi-overlay-el=\{overlayEl\}\s*inert=\{!live\}/);
  assert.match(RADAR_LEGEND_JS, /shell: PropTypes\.shape\(\{\s*overlayRef: PropTypes\.func\.isRequired,\s*presentation: PropTypes\.func\.isRequired,\s*subscribe: PropTypes\.func\.isRequired,\s*\}\),/);
  // The legend has no effect unless its detail sheet is open.
  assert.match(RADAR_LEGEND_JS, /if \(!overlayOpen\) return undefined;/);
  // RadarTimeline: inert and its clock stopped while hidden; the render that
  // makes it live reads the clock afresh (an external store), so no render
  // of its own and never a stale offset.
  assert.match(RADAR_TIMELINE_JS, /const nowSec = useSyncExternalStore\(shellLive === false \? subscribeNowDormant : subscribeNowTick, readNowSec\);/);
  assert.match(RADAR_TIMELINE_JS, /const subscribeNowDormant = \(\) => NO_UNSUBSCRIBE;/);
  assert.match(RADAR_TIMELINE_JS, /data-pi-overlay-el=\{shellLive === undefined \? undefined : "scrubber"\}\s*inert=\{shellLive === false\}/);
  assert.doesNotMatch(RADAR_TIMELINE_JS, /Date\.now\(\)\s*\/\s*1000\)\s*\);\s*useEffect/, "the old always-on tick");
  assert.doesNotMatch(RADAR_TIMELINE_JS, /\buseEffect\b|\bsetInterval\(\(\) => set/);
  assert.match(RADAR_TIMELINE_JS, /shellLive: PropTypes\.bool,/);
  // FloatingMiniBanner: always mounted under the overlay shell, live in MIN only.
  assert.match(LAYOUT_PI_JS, /\{shellVariant\s*\? <FloatingMiniBanner guardTaps=\{priority\} onExpand=\{\(\) => setPiLayoutState\("mid"\)\} shellLive=\{focused\} overlayRef=\{shellElements\.overlayRef\} \/>\s*: focused && <FloatingMiniBanner guardTaps=\{priority\} onExpand=\{\(\) => setPiLayoutState\("mid"\)\} \/>\}/);
  assert.match(FMB_JS, /data-pi-overlay-el=\{shellLive === undefined \? undefined : "banner"\}\s*inert=\{shellLive === false\}/);
  assert.match(FMB_JS, /shellLive: PropTypes\.bool,/);
  assert.doesNotMatch(FMB_JS, /\buseEffect\b/);
  // The scrubber's work never lands in a motion: the shell latches its
  // engagement and only moves it once the switch has settled.
  assert.match(SHELL_TIMING_JS, /const wantEngaged = active && overlayPresentation\(chromeState, scrubberOpen\)\.scrubber;/);
  // It turns on once settled, but off with the chrome, in the switch's
  // own commit (a playing loop does not step through the
  // motion out of MIN), written at once so a reversal before the settle
  // can't re-engage it mid-motion.
  // The latch is the last committed render's value (read
  // like the switch record, written back by the same passive effect).
  assert.match(SHELL_TIMING_JS, /const \[engaged, engagedStore\] = useCommittedValue\(\(\) => wantEngaged\);\s*const \[earlyEngagedId, setEarlyEngagedId\] = useState\(0\);\s*const timelineEngaged = wantEngaged && \(engaged \|\| \(active && \(settled \|\| earlyEngagedId === id\)\)\);/);
  assert.doesNotMatch(SHELL_TIMING_JS, /active && settled \? wantEngaged : engaged/);
  // …or at the scrubber's first input, whichever comes first (a visible
  // control never ignores an input: engaging at once, rather than queuing
  // the press until ready, never makes it wait). The bar's capture phase
  // engages it in one synchronous commit (the playhead snaps to "now" in
  // that render), then the same press acts normally on the engaged bar.
  assert.match(SHELL_TIMING_JS, /const timelineEngaged = wantEngaged && \(engaged \|\| \(active && \(settled \|\| earlyEngagedId === id\)\)\);/);
  assert.match(LAYOUT_PI_JS, /shellEngageTimeline=\{shellVariant \? shell\.engageTimeline : undefined\}/);
  assert.match(WEATHER_MAP_JS, /const scrubberEngaged = shellOverlays \? timelineEngaged : undefined;\s*const scrubberEngage = shellOverlays \? shellEngageTimeline : undefined;/);
  assert.match(WEATHER_MAP_JS, /shellEngaged=\{scrubberEngaged\}\s*onShellEngage=\{scrubberEngage\}/);
  assert.match(WEATHER_MAP_JS, /shellEngageTimeline: PropTypes\.func,/);
  assert.match(RADAR_TIMELINE_JS, /const engageFirst = shellEngaged === false && onShellEngage \? \(\) => onShellEngage\(\) : undefined;/);
  assert.match(RADAR_TIMELINE_JS, /onPointerDownCapture=\{engageFirst\}\s*onKeyDownCapture=\{engageFirst\}/);
  assert.match(RADAR_TIMELINE_JS, /data-pi-engaged=\{shellEngaged === undefined \? undefined : String\(shellEngaged\)\}/);
  assert.match(RADAR_TIMELINE_JS, /shellEngaged: PropTypes\.bool,/);
  assert.match(RADAR_TIMELINE_JS, /onShellEngage: PropTypes\.func,/);
  // The snap is an adjust-on-change during render (so inside that one
  // synchronous commit, before the press reaches its control), never an
  // effect that would land after it and undo a scrub.
  assert.match(WEATHER_MAP_JS, /if \(timelineEngaged !== prevTimelineEngaged\) \{\s*setPrevTimelineEngaged\(timelineEngaged\);\s*if \(mapTimestamps\) \{\s*setRadarFrameIdx\(lastPastIdx\);/);
  // No tap blocking: the bar keeps its own
  // pointer-events, and only an inert (hidden) scrubber refuses taps.
  for (const { selector } of rulesOf(WEATHER_MAP_CSS)) assert.doesNotMatch(selector, /data-pi-engaged/, selector);
  assert.match(rulesOf(WEATHER_MAP_CSS).find((r) => r.selector === ".radar-timeline").body, /pointer-events:\s*auto;/);
  // The clock's snapshot is floored to its 30 s tick and its change signal
  // re-armed to the next boundary: a per-second snapshot
  // changed between render and React's post-commit check, forcing an
  // extra synchronous render in the tap's task.
  assert.match(RADAR_TIMELINE_JS, /const readNowSec = \(\) => Math\.floor\(Date\.now\(\) \/ NOW_TICK_INTERVAL_MS\) \* NOW_TICK_SEC;/);
  assert.match(RADAR_TIMELINE_JS, /\}, NOW_TICK_INTERVAL_MS - \(Date\.now\(\) % NOW_TICK_INTERVAL_MS\)\);/);
  assert.doesNotMatch(RADAR_TIMELINE_JS, /Date\.now\(\) \/ 1000\)/);
  // The AI view: its request starts at the tap, as in the grid shell; only the reply's
  // render waits — held outside React state until the opening has settled
  // (the sheet landed, the map recentred, the motion over), then committed
  // on the next animation frame, so even an instant reply renders nothing
  // in the slide, nor in the frame interval where `data-pi-moving` drops
  // (still counted as motion). Its host is mounted at all times under the
  // overlay shell, like the other
  // hosts (the tap's commit mounts nothing), and the view is `active` in
  // the "ai" state only: the request starts in that commit, nothing is
  // requested or polled while it is closed, and closing it clears the
  // summary, so an opening shows the loading caption while the sheet
  // slides, as a fresh mount did, never the previous summary. The grid
  // shell still mounts it lazily (active from mount).
  assert.match(LAYOUT_PI_JS, /\{\(shellVariant !== null \|\| piLayoutState === "ai"\) && \(\s*<div ref=\{aiHostRef\} className=\{styles\.aiHost\}>\s*<AiView\s*active=\{piLayoutState === "ai"\}\s*replyReady=\{!shellVariant \|\| \(shell\.mapState === "ai" && shell\.settled\)\}\s*\/>/);
  assert.match(AI_VIEW_JS, /const AiView = \(\{ active = true, replyReady = true \}\) => \{/);
  assert.match(AI_VIEW_JS, /useAiSummary\(replyReady, active\)/);
  assert.match(AI_VIEW_JS, /active: PropTypes\.bool,\s*replyReady: PropTypes\.bool,/);
  assert.doesNotMatch(AI_VIEW_JS, /fetchReady/);
  assert.match(USE_AI_SUMMARY_JS, /export default function useAiSummary\(ready = true, active = true\) \{/);
  // The request is gated on `active`, not on `ready`, and `ready` doesn't
  // restart it.
  assert.match(USE_AI_SUMMARY_JS, /if \(!active \|\| !mapGeo \|\| !available \|\| sleepStage > 0\) return undefined;/);
  assert.match(USE_AI_SUMMARY_JS, /\}, \[active, mapGeo, lang, available, setAvailable, tempUnit, speedUnit, distanceUnit, sleepStage\]\);/);
  // Deactivation clears what is shown during render (adjust-on-change), in
  // the closing commit itself: no render of its own, and the next opening
  // finds the loading state.
  assert.match(USE_AI_SUMMARY_JS, /const \[wasActive, setWasActive\] = useState\(active\);\s*if \(active !== wasActive\) \{\s*setWasActive\(active\);\s*if \(!active\) \{\s*setSummary\(null\);\s*setPeriod\(null\);\s*setErrored\(false\);\s*\}\s*\}/);
  assert.doesNotMatch(USE_AI_SUMMARY_JS, /useEffect\(\(\) => \{\s*if \(!active\)/, "a clearing effect would render on its own after the close");
  // Every reply (success, error, no-key) goes through `deliver`: its
  // state writes run now if ready, else wait in a ref (the last one wins)
  // and run on the frame after `ready` turns true; a held reply dies with
  // its run.
  assert.match(USE_AI_SUMMARY_JS, /const deliver = \(commit\) => \{\s*if \(cancelled\) return;\s*if \(readyRef\.current\) commit\(\);\s*else heldReplyRef\.current = commit;\s*\};/);
  assert.match(USE_AI_SUMMARY_JS, /const text = res\.data\.summary;\s*const periodKind = res\.data\.period \?\? null;\s*deliver\(\(\) => \{\s*setSummary\(text\);\s*setPeriod\(periodKind\);\s*setErrored\(false\);\s*\}\);/);
  assert.match(USE_AI_SUMMARY_JS, /deliver\(\(\) => \{\s*if \(isAiSummaryKeyMissing\(err\)\) setAvailable\(false\);\s*else setErrored\(true\);\s*\}\);/);
  // `readyRef` turns true only inside that frame (a reply landing before it
  // is held too), never before; already ready (the grid shell) defers nothing;
  // the frame is cancelled with the effect.
  assert.match(USE_AI_SUMMARY_JS, /if \(!ready\) \{\s*readyRef\.current = false;\s*return undefined;\s*\}\s*if \(readyRef\.current\) return undefined;\s*const frame = requestAnimationFrame\(\(\) => \{\s*readyRef\.current = true;\s*const commitHeld = heldReplyRef\.current;\s*heldReplyRef\.current = null;\s*if \(commitHeld\) commitHeld\(\);\s*\}\);\s*return \(\) => cancelAnimationFrame\(frame\);\s*\}, \[ready\]\);/);
  assert.equal((USE_AI_SUMMARY_JS.match(/readyRef\.current = true/g) || []).length, 1, "ready only on the frame after `ready`");
  assert.match(USE_AI_SUMMARY_JS, /const readyRef = useRef\(ready\);/);
  assert.match(USE_AI_SUMMARY_JS, /cancelled = true;[\s\S]{0,160}?heldReplyRef\.current = null;/);
  // No state write outside `deliver` in the fetch path.
  const fetchPath = USE_AI_SUMMARY_JS.slice(USE_AI_SUMMARY_JS.indexOf(".get(`/api/weather-summary"), USE_AI_SUMMARY_JS.indexOf("fetchSummary();"));
  assert.ok(fetchPath.length > 0);
  assert.equal((fetchPath.match(/\bset[A-Z]\w*\(/g) || []).length, 5, "setSummary, setPeriod, setErrored(false) | setAvailable, setErrored(true) — all inside deliver");
});

test("scrubber: the flag survives the dock's timeline button (MIN and the flag in one commit) and clears only once the switch out of MIN has settled", () => {
  // Entering or in MIN: never cleared.
  assert.equal(scrubberFlagClears("min", false), false);
  assert.equal(scrubberFlagClears("min", true), false);
  // Leaving MIN under the overlay shell: kept while the motion runs (the scrubber is
  // already hidden and inert from the switch's commit), cleared once it
  // has settled — a render after the motion, never inside it.
  assert.equal(scrubberFlagClears("mid", false), false);
  assert.equal(scrubberFlagClears("mid", true), true);
  for (const view of VIEW_STATES) {
    assert.equal(scrubberFlagClears(view, false), false, view);
    assert.equal(scrubberFlagClears(view, true), true, view);
  }
  // The grid shell (no settled state): piLayoutState alone, as before.
  assert.equal(scrubberFlagClears("min", undefined), false);
  assert.equal(scrubberFlagClears("mid", undefined), true);
  assert.equal(scrubberFlagClears("max", undefined), true);
  // Outside LayoutPi (piLayoutState null) nothing is cleared.
  assert.equal(scrubberFlagClears(null, undefined), false);
  // LayoutPi wiring.
  assert.match(LAYOUT_PI_JS, /const scrubberGone = scrubberFlagClears\(piLayoutState, shellVariant \? shell\.settled : undefined\);/);
  assert.match(LAYOUT_PI_JS, /if \(priority && scrubberGone && piScrubberOpen\) \{\s*setPiScrubberOpen\(false\);/);
  // The dock button still sets both in one handler.
  assert.match(CONTROL_BUTTONS_JS, /setPiScrubberOpen\(true\);\s*setPiLayoutState\("min"\);/);
});

test("guard: no `visibility: visible` anywhere in client/src — a descendant would show through its hidden rail, dock, sheet or overlay", () => {
  // Under the overlay shell the rail, the dock, the sheet and the inactive map overlays
  // are `visibility: hidden` when out; `visibility` inherits, so a
  // descendant setting `visible` would paint (and take taps) through its
  // hidden box. The shell's rules write the hidden poses only and let the
  // visible one inherit; nothing else in client/src sets it either.
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return /\.(css|js|jsx)$/.test(e.name) ? [full] : [];
  });
  for (const file of walk(SRC_DIR)) {
    const src = fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const rel = path.relative(SRC_DIR, file);
    assert.doesNotMatch(src, /visibility\s*:\s*["']?(?:visible|initial)\b/, `${rel} sets visibility: visible (or initial, which computes to it)`);
    assert.doesNotMatch(src, /\.visibility\s*=\s*["'](?:visible|initial)["']/, `${rel} sets visibility = "visible"`);
    assert.doesNotMatch(src, /\ball\s*:\s*initial\b/, `${rel} sets all: initial (visibility back to visible)`);
    assert.doesNotMatch(src, /setProperty\(\s*["']visibility["']\s*,\s*["'](?:visible|initial)/, `${rel} sets visibility through setProperty`);
  }
});

test("reduced motion: nothing in the shell's moving set transitions — the rail frame, the dock, the sheet, the map overlays, everything inside them, and the attribution corner", () => {
  // Since PR 411 styles/main.css removes every transition under reduced
  // motion (`transition: none`, delays included); the shell's
  // reduced-motion block turns them off in its moving set too, as the
  // shell's guard behind it.
  const css = stripComments(LAYOUT_PI_CSS);
  const at = css.indexOf("@media (prefers-reduced-motion: reduce)");
  assert.ok(at >= 0, "no reduced-motion block in LayoutPi/styles.css");
  const open = css.indexOf("{", at);
  let depth = 0;
  let close = open;
  for (; close < css.length; close += 1) {
    if (css[close] === "{") depth += 1;
    else if (css[close] === "}" && --depth === 0) break;
  }
  const block = css.slice(open + 1, close);
  const off = rulesOf(block).filter((r) => /(?:^|;)\s*transition:\s*none !important;/.test(r.body));
  assert.equal(off.length, 2, "the boxes' rule, and the attribution corner's with the dock band shield's and its guard's");
  for (const r of off) assert.match(r.body, /^\s*transition:\s*none !important;\s*$/, "they do nothing else");
  const selectors = off.flatMap((r) => r.selector.split(",").map((s) => s.trim()));
  for (const box of [".railFrame", "> [data-pi-dock-cell]", ".sheet", "[data-pi-overlay-el]"]) {
    for (const part of ["", " *", "::before", "::after", " *::before", " *::after"]) {
      assert.ok(selectors.includes(`.layout[data-pi-shell] ${box}${part}`), `missing: ${box}${part}`);
    }
  }
  assert.ok(selectors.includes(".layout[data-pi-shell] :global(.leaflet-bottom.leaflet-right)"), "missing: the attribution corner");
  // The dock band shield's scrubber cut-out: opened in the frame the
  // scrubber shows, not one later.
  assert.ok(selectors.includes(".layout[data-pi-shell] .dockShield"), "missing: the dock band shield");
  // The double-tap guard's move to the switch's click (its `left`): at
  // once, not a frame later.
  assert.ok(selectors.includes(".layout[data-pi-shell] .dockGuard"), "missing: the dock band shield's double-tap guard");
  assert.equal(selectors.length, 27);
  // The same set useShellTiming waits on under motion (rail, dock, sheet,
  // attribution, overlays): the attribution corner WeatherMap registers
  // is the one these rules move.
  const weatherMapJs = fs.readFileSync(path.join(SRC_DIR, "components", "WeatherMap", "index.js"), "utf8");
  assert.match(weatherMapJs, /useLayoutEffect\(\(\) => register\(map\.getContainer\(\)\.querySelector\("\.leaflet-bottom\.leaflet-right"\)\), \[map, register\]\);/);
  assert.match(SHELL_TIMING_JS, /shellElements\.attribution\(\),\s*\.\.\.shellElements\.overlays\(\),/);
  // Reduced motion only: no other rule of the shell turns transitions off with
  // !important, so form 1 with motion keeps every slide and fade.
  for (const { rel, selector, body } of d1RulesEverywhere()) {
    if (/transition:\s*none !important/.test(body)) assert.ok(selectors.includes(selector.split(",")[0].trim()), `${rel}: ${selector}`);
  }
  // PR 411's global rule does the same for every element (`transition: none !important`); this block stays as the
  // shell's guard behind it.
  assert.match(stripComments(fs.readFileSync(path.join(SRC_DIR, "styles", "main.css"), "utf8")), /\*, \*::before, \*::after \{[^}]*transition:\s*none !important;/);
  // Why `none` is safe: nothing in client/src listens for transition
  // events (useShellTiming reads `Animation.finished`, and under reduced
  // motion waits for nothing but frames).
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return /\.(js|jsx)$/.test(e.name) ? [full] : [];
  });
  for (const file of walk(SRC_DIR)) {
    // Code only: ui/mapMotion.js (PR 411) explains Leaflet's own `transitionend` in its comments.
    const code = fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    assert.doesNotMatch(code, /\btransition(?:run|start|end|cancel)\b|\bonTransition(?:Run|Start|End|Cancel)\b/i, path.relative(SRC_DIR, file));
  }
  assert.equal(motionEnd(SHELL_MODES.reduced), "frame");
});

test("map chrome: under the overlay shell it stays mounted in the views, hidden and inert, and a view switch fades none of it", () => {
  // Timeline, legend (chip, raised chip, card), zoom bar and focus button kept mounted while a
  // view is open, hidden by `visibility` + `inert` (never opacity alone), back at once when it closes.
  const css = rulesOf(WEATHER_MAP_CSS);
  const viewRule = css.find((r) => r.selector.includes(':global([data-pi-shell][data-pi-switch="view"]) .radar-legend[inert]'));
  assert.ok(viewRule, "no view-switch rule for the overlays");
  assert.match(viewRule.body, /^\s*transition:\s*none;\s*$/);
  const parts = viewRule.selector.split(",").map((p) => p.trim());
  for (const el of [".radar-legend", ".legend-chip.legend-chip", ".radar-timeline"]) {
    for (const suffix of ["", "[inert]"]) assert.ok(parts.includes(`:global([data-pi-shell][data-pi-switch="view"]) ${el}${suffix}`), `${el}${suffix}`);
  }
  const hidden = css.find((r) => r.selector.includes(":global(.leaflet-control-zoom[inert])"));
  assert.ok(hidden, "no hidden rule for the inert zoom bar");
  assert.ok(hidden.selector.includes(".radar-focus-btn.radar-focus-btn[inert]"), "the inert focus button is not hidden");
  assert.match(hidden.body, /^\s*visibility:\s*hidden;\s*$/);
  // The attribute is set by hand at each chrome change: on Leaflet's bar by ShellZoomInert's
  // subscription to the shell registry, on the button by the registry itself (its `viewChromeRef`); the button's own
  // render reads the registry, so it renders the same value.
  assert.match(WEATHER_MAP_JS, /bar\.toggleAttribute\("inert", shell\.viewHidden\(\)\)/);
  const focus = fs.readFileSync(path.join(SRC_DIR, "components", "WeatherMap", "RadarFocusControl.js"), "utf8");
  assert.match(focus, /ref=\{shell \? shell\.viewChromeRef : undefined\}/);
  assert.match(focus, /inert=\{shellHidden \|\| undefined\}/);
  // The legend and the scrubber take NO_OVERLAYS in a view: none live.
  for (const view of VIEW_STATES) assert.deepEqual(overlayPresentation(view, true), { legend: "none", scrubber: false, banner: false }, view);
});

test("map chrome: the chrome kept mounted in a view drops its transient surfaces in the view switch's own commit — the legend's detail sheet and the focus button's toast", () => {
  // The grid shell unmounts them with the chrome. Under the overlay shell
  // they stay mounted, and a view switch renders neither: each reads the
  // shell registry's presentation in every render, subscribed only while
  // its surface is open. With the sheet or the toast up, the registry's
  // change, told in the switch's commit, renders it once more before the
  // frame that paints the switch, and an adjustment during that render
  // resets its state: no effect, no render of its own inside the slide.
  // The legend: the sheet closes when the legend goes "none" (a view
  // only: MIN and MID never give "none", so MIN ↔ MID keeps it open).
  assert.match(RADAR_LEGEND_JS, /const shellLive = useSyncExternalStore\(\s*shell && overlayOpen \? shell\.subscribe : subscribeNothing,\s*shell \? shell\.presentation : readNoShell,\s*\)\.legend;\s*if \(shellLive === "none" && overlayOpen\) setOverlayOpen\(false\);/);
  for (const state of ["mid", "min"]) {
    for (const scrubber of [false, true]) assert.notEqual(overlayPresentation(state, scrubber).legend, "none", `${state} ${scrubber}`);
  }
  // WeatherMap hands it the registry, whose presentation is "none" in every
  // view (test/shellElements.test.js runs it).
  assert.match(WEATHER_MAP_JS, /chipMode=\{legendChipMode\}\s*shell=\{shellElements\}/);
  // The focus button: a pending toast is dropped when the button goes
  // hidden (a view), and its timer goes with it (the effect's cleanup).
  const focus = fs.readFileSync(path.join(SRC_DIR, "components", "WeatherMap", "RadarFocusControl.js"), "utf8");
  assert.match(focus, /const shellHidden = useSyncExternalStore\(\s*shell && toast != null \? shell\.subscribe : subscribeNothing,\s*shell \? shell\.viewHidden : readNotHidden,\s*\);\s*if \(shellHidden && toast != null\) setToast\(null\);/);
  assert.match(focus, /if \(toast == null\) return undefined;\s*toastTimerRef\.current = setTimeout\(\(\) => setToast\(null\), TOAST_TIMEOUT_MS\);\s*return \(\) => clearTimeout\(toastTimerRef\.current\);/);
  assert.match(WEATHER_MAP_JS, /<RadarFocusControl[\s\S]*?shell=\{shellElements\}\s*\/>/);
  // Neither reset runs without the overlay shell (nothing subscribed, nothing
  // hidden) or from an effect.
  for (const [name, src, prop] of [["RadarLegend", RADAR_LEGEND_JS, "shellLive"], ["RadarFocusControl", focus, "shellHidden"]]) {
    const effects = src.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[[^\]]*\]\);/g) || [];
    for (const e of effects) assert.doesNotMatch(e, new RegExp(`\\b${prop}\\b`), `${name}: no effect reads ${prop}`);
  }
});

test("views: a view moves Leaflet's map pane by the CSS translate property, (−140, 0) on 800 px, keyed on the map state — never transform, never a pan", () => {
  const rule = rulesOf(WEATHER_MAP_CSS).find((r) => r.selector.includes(":global(.leaflet-map-pane)"));
  assert.ok(rule, "no rule of the shell moves the map pane");
  const parts = rule.selector.split(",").map((p) => p.trim()).sort();
  assert.deepEqual(parts, VIEW_STATES.map((v) => `:global([data-pi-shell][data-pi-map="${v}"]) :global(.leaflet-map-pane)`).sort());
  assert.match(rule.body, /^\s*translate:\s*calc\(\(var\(--pi-sheet-left\) \+ var\(--pi-rail-span\) - 100vw\) \/ 2\) 0;\s*$/);
  // The root's values give viewPaneShift's (−140, 0) on 800 px.
  const root = customProps(rulesOf(LAYOUT_PI_CSS).find((r) => r.selector === ".layout[data-pi-shell]").body);
  const px = (v) => Number(/^(-?\d+(?:\.\d+)?)px$/.exec(v)[1]);
  assert.equal(px(root.get("--pi-sheet-left")), SHELL_GEOMETRY.sheetLeft);
  assert.equal(root.get("--pi-rail-span"), "calc(var(--pi-rail-width) + var(--pi-rail-right))");
  const railSpan = px(root.get("--pi-rail-width")) + px(root.get("--pi-rail-right"));
  assert.equal((px(root.get("--pi-sheet-left")) + railSpan - W) / 2, viewPaneShift(W).x);
  assert.equal(viewPaneShift(W).x, -140);
  // Leaflet owns the pane's transform: no stylesheet sets one on it.
  for (const css of [WEATHER_MAP_CSS, LAYOUT_PI_CSS]) {
    for (const r of rulesOf(css)) if (r.selector.includes("leaflet-map-pane")) assert.doesNotMatch(r.body, /(?:^|;)\s*transform\s*:/, r.selector);
  }
});

test("alert card: the compact alert card is ONE button whose name says the level, the source, the title and 1 of N (left out with a single alert), in EN, FR and ES; the ⤢ is decorative, with no `:active` feedback", () => {
  const banner = fs.readFileSync(path.join(AMBIENT_DIR, "AlertBanner", "index.js"), "utf8");
  const card = banner.slice(banner.indexOf("className={styles.compactCard}"), banner.indexOf("</button>", banner.indexOf("className={styles.compactCard}")));
  assert.ok(card.length > 0);
  // No interactive element inside the card button (no nested button, no role="button").
  assert.doesNotMatch(card, /<button|role="button"|onClick=\{(?!openAlertView)/);
  // The name goes through ui/alertCardName.js (test/alertCardName.test.js runs it): "1 of N" from two alerts,
  // `alert.compactCardAriaSingle` (no count) for one.
  assert.match(banner, /const cardName = compactAlertCardName\(t, \{\s*level: t\(`alert\.severity\$\{productWord\.charAt\(0\)\.toUpperCase\(\)\}\$\{productWord\.slice\(1\)\}`\),\s*source: currentAlert\.source,\s*title,\s*current: safeIdx \+ 1,\s*count: eligibleGovAlerts\.length,\s*\}\);/);
  for (const [lang, word] of [["en", "of"], ["fr", "sur"], ["es", "de"]]) {
    const loc = JSON.parse(fs.readFileSync(path.join(SRC_DIR, "i18n", "locales", `${lang}.json`), "utf8"));
    const s = loc.alert.compactCardAria;
    for (const v of ["level", "source", "title", "current", "count"]) assert.ok(s.includes(`{{${v}}}`), `${lang}: ${v}`);
    assert.match(s, new RegExp(`\\{\\{current\\}\\} ${word} \\{\\{count\\}\\}`), lang);
    const single = loc.alert.compactCardAriaSingle;
    for (const v of ["level", "source", "title"]) assert.ok(single.includes(`{{${v}}}`), `${lang}: single ${v}`);
    assert.doesNotMatch(single, /\{\{(?:current|count)\}\}/, `${lang}: single`);
  }
  // The ⤢: a decorative span, hidden from assistive tech, with no `:active` feedback of its own.
  const square = fs.readFileSync(path.join(AMBIENT_DIR, "RailSquareButton", "index.js"), "utf8");
  assert.match(square, /<span className=\{`\$\{styles\.square\} \$\{styles\.decorative\} \$\{className \|\| ""\}`\} aria-hidden="true">/);
  const squareCss = fs.readFileSync(path.join(AMBIENT_DIR, "RailSquareButton", "styles.css"), "utf8");
  assert.match(ruleBody(squareCss, ".decorative.decorative:active"), /transform:\s*none;/);
  // No :active rule on the card itself.
  assert.equal(rulesOf(ALERT_BANNER_CSS).some((r) => /\.compactCard[^,]*:active/.test(r.selector)), false);
});

test("hero: the place row stops 2 px short of the ⤢'s 44 px area at S, M and L, and a long name ellipsizes on one line", () => {
  const px = (body, prop) => Number(new RegExp(`(?:^|;)\\s*${prop}:\\s*(-?\\d+(?:\\.\\d+)?)px;`).exec(body)[1]);
  const square = ruleBody(HERO_CSS, ".maximize.maximize");
  const [right, width] = [px(square, "right"), px(square, "width")];
  assert.deepEqual([right, width], [12, 28]);
  assert.match(ruleBody(HERO_CSS, ":global([data-pi-shell]) .maximize.maximize::after"), /width:\s*calc\(44px \/ var\(--c-font-scale, 1\)\);/);
  // Both `.slab` rules (base and the 800–1279 px block) pad the right by 16.
  const slabRules = rulesOf(HERO_CSS).filter((r) => r.selector === ".slab");
  assert.ok(slabRules.length >= 1);
  const pads = slabRules.map((r) => Number(/padding:\s*\d+px (\d+)px/.exec(r.body)[1]));
  assert.ok(pads.every((v) => v === 16), pads.join());
  const slabPadRight = pads[0];
  assert.match(ruleBody(HERO_CSS, ":global([data-pi-shell]) .withMax .location"), /^\s*padding-right:\s*calc\(16px \+ 22px \/ var\(--c-font-scale, 1\)\);\s*$/);
  const beforeReach = -px(ruleBody(HERO_CSS, ".locationButton::before"), "right");
  assert.equal(beforeReach, 4);
  for (const scale of [0.85, 1, 1.15]) {
    const areaLeft = right + width / 2 + 22 / scale; // from the slab's padding-box right edge, internal px
    const placeReach = slabPadRight + (16 + 22 / scale) - beforeReach;
    assert.ok(Math.abs(placeReach - areaLeft - 2) < 1e-9, `scale ${scale}: ${placeReach} vs ${areaLeft}`);
  }
  const ell = rulesOf(HERO_CSS).find((r) => r.selector.includes(":global([data-pi-shell]) .withMax .location > button > div > div"));
  assert.ok(ell);
  for (const d of [/display:\s*block;/, /overflow:\s*hidden;/, /text-overflow:\s*ellipsis;/, /white-space:\s*nowrap;/]) assert.match(ell.body, d);
});

test("press tint: the shell's press tint (always on under the overlay shell, no switch) marks view triggers at touch-down and clears them out of sight; no :active repaint or scale() on them under the shell; the dock buttons have no transition", () => {
  assert.match(LAYOUT_PI_JS, /usePressTint\(shellVariant !== null, rootRef, shell\.settled\);/);
  // The listeners live in ui/pressTint.js (CommonJS; their behaviour, the
  // touch order included: test/pressTint.test.js); the hook attaches them.
  const tint = fs.readFileSync(path.join(SRC_DIR, "ui", "pressTint.js"), "utf8");
  assert.match(tint, /const PRESS_SELECTOR = "\[data-pi-press\]";/);
  assert.match(tint, /root\.addEventListener\("pointerdown", onDown, true\);/);
  assert.match(tint, /root\.addEventListener\("click", onClick, true\);/);
  assert.match(tint, /if \(!root\.hasAttribute\(MOVING_ATTRIBUTE\)\) clearPressed\(\);/);
  const tintHook = fs.readFileSync(path.join(AMBIENT_DIR, "LayoutPi", "usePressTint.js"), "utf8");
  assert.match(tintHook, /const tint = createPressTint\(root\);/);
  // Only the marks present at the settle (a press made after it keeps its mark).
  assert.match(tintHook, /const marked = tint\.marked\(\);/);
  assert.match(tintHook, /requestIdleCallback\(clearSettled, \{ timeout: IDLE_TIMEOUT_MS \}\)/);
  assert.match(ruleBody(LAYOUT_PI_CSS, ".layout[data-pi-shell] [data-pi-press][data-pi-pressed][data-pi-pressed][data-pi-pressed]"), /^\s*background-color:\s*var\(--c-accent-soft\);\s*$/);
  // The marked triggers.
  for (const [file, re] of [
    [path.join(AMBIENT_DIR, "HeroCompact", "index.js"), /className=\{styles\.maximize\}[\s\S]{0,120}data-pi-press=""/],
    [path.join(AMBIENT_DIR, "AlertBanner", "index.js"), /aria-label=\{cardName\}\s+data-pi-press=""/],
    [path.join(AMBIENT_DIR, "RailSquareButton", "index.js"), /data-pi-press=\{back \? "" : undefined\}/],
    [path.join(AMBIENT_DIR, "ChartTabs", "index.js"), /data-pi-press=\{maximized \? "" : undefined\}/],
  ]) assert.match(fs.readFileSync(file, "utf8"), re, file);
  const dock = fs.readFileSync(path.join(AMBIENT_DIR, "ControlButtons", "index.js"), "utf8");
  assert.equal((dock.match(/data-pi-press=""/g) || []).length, 2, "the AI and forecast buttons");
  // No `:active` repaint or scale() on them under the overlay shell.
  assert.match(ruleBody(HERO_CSS, ":global([data-pi-shell]) .maximize.maximize:active"), /^\s*transform:\s*none;\s*$/);
  assert.match(ruleBody(RAIL_SQUARE_CSS, ":global([data-pi-shell]) .square.square:active"), /^\s*transform:\s*none;\s*$/);
  assert.match(ruleBody(CHART_TABS_CSS, ":global([data-pi-shell]) .headerRow .actionButton:active"), /transform:\s*none;/);
  const controlCss = fs.readFileSync(path.join(AMBIENT_DIR, "ControlButtons", "styles.css"), "utf8");
  assert.match(ruleBody(controlCss, ":global([data-pi-shell]) .container.grouped .group > div"), /^\s*transition:\s*none;\s*$/);
});

test("press tint: under the overlay shell ChartTabs' restore button (always pressed) looks the same held as at rest, and its press tint shows on its box", () => {
  // Under the overlay shell the forecast slab is maximized in every state, so its button
  // is always aria-pressed="true".
  assert.match(LAYOUT_PI_JS, /<ChartTabs piSheet=\{shellVariant !== null\} \/>/);
  assert.match(CHART_TABS_JS, /const maximized = piSheet \|\| /);
  assert.match(CHART_TABS_JS, /aria-pressed=\{maximized\}/);
  const decl = (body, prop) => {
    const m = new RegExp(`(?:^|;)\\s*${prop}:\\s*([^;]+);`).exec(body);
    return m ? m[1].trim() : null;
  };
  // [classes + attributes + pseudo-classes, types] once `:global()` is unwrapped.
  const specificity = (selector) => {
    const s = selector.replace(/:global\(([^)]*)\)/g, "$1").replace(/::[\w-]+/g, " ");
    return [(s.match(/\.[\w-]+|\[[^\]]*\]|:[\w-]+/g) || []).length, (selector.match(/::[\w-]+/g) || []).length];
  };
  const outranks = (a, b) => {
    const [x, y] = [specificity(a), specificity(b)];
    return x[0] > y[0] || (x[0] === y[0] && x[1] > y[1]);
  };
  const base = ".headerRow .actionButton";
  const d1 = `:global([data-pi-shell]) ${base}`;
  const pressed = '[aria-pressed="true"]';
  const css = (selector) => ruleBody(CHART_TABS_CSS, selector);
  // Unpressed (a dead path under piSheet, kept right): held = resting.
  assert.equal(decl(css(`${d1}:active`), "color"), decl(css(base), "color"));
  assert.equal(decl(css(`${d1}:active::before`), "background-color"), decl(css(`${base}::before`), "background-color"));
  // Pressed (the overlay shell's case): held = the aria-pressed resting look, from rules
  // that outrank both that look and the unpressed `:active` pair.
  assert.equal(decl(css(`${d1}${pressed}:active`), "color"), decl(css(`${base}${pressed}`), "color"));
  assert.equal(decl(css(`${d1}${pressed}:active::before`), "background-color"), decl(css(`${base}${pressed}::before`), "background-color"));
  assert.ok(outranks(`${d1}${pressed}:active`, `${d1}:active`));
  assert.ok(outranks(`${d1}${pressed}:active`, `${base}${pressed}`));
  assert.ok(outranks(`${d1}${pressed}:active::before`, `${d1}:active::before`));
  assert.ok(outranks(`${d1}${pressed}:active::before`, `${base}${pressed}::before`));
  // The base `:active` scale is cancelled; nothing in the shell's `:active` rules
  // moves the box or its border.
  assert.match(css(`${d1}:active`), /transform:\s*none;/);
  for (const sel of [`${d1}:active`, `${d1}:active::before`, `${d1}${pressed}:active`, `${d1}${pressed}:active::before`]) {
    assert.doesNotMatch(css(sel), /scale|border|inset|width|height/, sel);
  }
  // The tint: on the 28 px box, not the 44 px button, and visible against
  // the pressed box's resting fill (the generic tint IS that fill).
  const tintBox = ":global([data-pi-shell]) .headerRow .actionButton[data-pi-pressed][data-pi-pressed][data-pi-pressed]::before";
  const tint = css(tintBox);
  assert.match(tint, /^\s*background-color:\s*color-mix\(in srgb, var\(--c-accent\) 36%, transparent\);\s*$/);
  assert.notEqual(decl(tint, "background-color"), decl(css(`${base}${pressed}::before`), "background-color"));
  assert.match(ruleBody(LAYOUT_PI_CSS, ".layout[data-pi-shell] [data-pi-press][data-pi-pressed][data-pi-pressed][data-pi-pressed]"), /background-color:\s*var\(--c-accent-soft\);/);
  assert.equal(decl(css(`${base}${pressed}::before`), "background-color"), "var(--c-accent-soft)");
  assert.ok(outranks(tintBox, `${d1}${pressed}:active::before`), "the tint shows while the press is held");
  // Behind @supports (no color-mix() in Chrome 109), like the tab icons.
  const src = stripComments(CHART_TABS_CSS);
  const at = src.indexOf(tintBox.replace(/\s+/g, " "));
  assert.ok(at > 0);
  assert.match(src.slice(src.lastIndexOf("@supports", at), at), /^@supports \(color: color-mix\(in srgb, red 50%, transparent\)\) \{\s*$/);
  // The button's own 44 px fill stays transparent under the generic tint.
  assert.match(css(":global([data-pi-shell]) .headerRow .actionButton[data-pi-pressed][data-pi-pressed][data-pi-pressed][data-pi-pressed]"), /^\s*background-color:\s*transparent;\s*$/);
});

test("shell: no development switch in it — the press tint always on, no close marks, no sheet-start switch", () => {
  // The press tint has no root attribute: the generic rule and ChartTabs'
  // two reach their (0,6,0) / (0,7,0) / (0,6,1) specificity by a repeated
  // `data-pi-pressed`.
  const COMPONENTS = path.join(SRC_DIR, "components");
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(?:js|css)$/.test(e.name) ? [path.join(dir, e.name)] : []));
  const sources = [...walk(COMPONENTS), ...walk(path.join(SRC_DIR, "ui"))];
  for (const file of sources) {
    const src = fs.readFileSync(file, "utf8");
    const rel = path.relative(SRC_DIR, file);
    assert.doesNotMatch(src, /data-pi-tint|piShellTapTint|piShellCloseMarks|piShellSheetStart|useCloseMarks/, rel);
    // No User Timing in the shell's code, but the style warm-up's two
    // marks around its task (for measurement tooling, which waits for them, leaves the task out of its measures and
    // times it).
    if (rel === path.join("ui", "styleWarmup.js")) {
      assert.deepEqual([...stripComments(src).matchAll(/performance\.(mark|measure|clearMarks|clearMeasures)\(([^)]*)\)/g)].map((m) => `${m[1]}(${m[2]})`), ["mark(name)"], rel);
      assert.match(src, /const STYLE_WARM_START_MARK = "pi-k6-start";\s*const STYLE_WARM_END_MARK = "pi-k6-end";/);
    } else if (rel.startsWith(path.join("components", "ambient", "LayoutPi")) || rel.startsWith("ui")) {
      assert.doesNotMatch(src, /performance\.(?:mark|measure|clearMarks|clearMeasures)\(/, rel);
    }
  }
  assert.equal(fs.existsSync(path.join(AMBIENT_DIR, "LayoutPi", "useCloseMarks.js")), false);
  // ui/piLayout.js exports the gate, the views' list and the shell variant
  // only; the only localStorage key it reads is forcePriorityViews.
  const piLayout = fs.readFileSync(path.join(SRC_DIR, "ui", "piLayout.js"), "utf8");
  assert.deepEqual([...piLayout.matchAll(/export function (\w+)/g)].map((m) => m[1]), ["isPiMaxView", "priorityViewsEnabled", "piShellVariant"]);
  // Read once, through ui/cachedFlags.js.
  assert.deepEqual([...piLayout.matchAll(/createStorageFlag\(([^)]+)\)/g)].map((m) => m[1]), ['"forcePriorityViews"']);
  assert.doesNotMatch(stripComments(piLayout), /localStorage\.getItem|matchMedia\(/);
  const specificity = (selector) => {
    const s2 = selector.replace(/:global\(([^)]*)\)/g, "$1").replace(/::[\w-]+/g, " ");
    return [(s2.match(/\.[\w-]+|\[[^\]]*\]|:[\w-]+/g) || []).length, (selector.match(/::[\w-]+/g) || []).length];
  };
  assert.deepEqual(specificity(".layout[data-pi-shell] [data-pi-press][data-pi-pressed][data-pi-pressed][data-pi-pressed]"), [6, 0]);
  assert.deepEqual(specificity(":global([data-pi-shell]) .headerRow .actionButton[data-pi-pressed][data-pi-pressed][data-pi-pressed][data-pi-pressed]"), [7, 0]);
  assert.deepEqual(specificity(":global([data-pi-shell]) .headerRow .actionButton[data-pi-pressed][data-pi-pressed][data-pi-pressed]::before"), [6, 1]);
});
