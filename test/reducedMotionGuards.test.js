// Locks in the reduced-motion fix of the dock toast (2026-10). Under the OS
// "reduce motion" preference, the global rule in client/src/styles/main.css
// crushes every CSS animation to ~0.01 ms so its end state applies at once.
// For an animation that fades OUT and holds its last keyframe (`forwards` /
// `both` ending on `opacity: 0` or `visibility: hidden`), that end state is
// "invisible": the element mounts already hidden and is never seen. That is
// how the dock toast (ControlButtons, `toast-pop`) vanished for every
// reduced-motion user, with no build, lint or console signal.
//
// The rule this guard enforces: every such animation has, in the same
// stylesheet and AFTER its base rule (same specificity, so source order
// decides), a `@media (prefers-reduced-motion: reduce)` override of the same
// selector that removes the animation (`animation: none` or
// `animation-name: none`), so the element renders at its resting state.
// The opposite pattern is equally valid and needs no override: an animation
// declared only inside `@media (prefers-reduced-motion: no-preference)`
// never applies under reduced motion, so the guard skips it.
//
// Transitions (2026-10, designer decision): the same global rule removes every
// CSS transition (`transition: none !important`), with one exception, Leaflet's
// zoom transition, kept at 0.01 ms so `transitionend` still ends a zoom at
// once (without it Leaflet waits for its 250 ms fallback timer). The last
// tests below pin both, and that no stylesheet beats the global rule with an
// `!important` transition of its own. The JavaScript half (recentres,
// inertia) is in mapMotion.test.js.
//
// Same spirit as react19Guards.test.js: mechanical, source-level, loud.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC_DIR = path.join(__dirname, "..", "client", "src");
const REDUCED_MOTION_RE = /prefers-reduced-motion\s*:\s*reduce/;
const MOTION_SAFE_RE = /prefers-reduced-motion\s*:\s*no-preference/;
const HOLDING_FILL_MODES = new Set(["forwards", "both"]);
const LAST_FRAME_SELECTORS = new Set(["100%", "to"]);
const HIDDEN_DECL_RE = /(?:^|;)\s*(?:opacity\s*:\s*0(?:\.0+)?%?\s*(?:;|$)|visibility\s*:\s*hidden)/;
const ANIMATION_OFF_RE = /(?:^|;)\s*animation(?:-name)?\s*:\s*none\s*(?:!important\s*)?(?:;|$)/;

/**
 * Recursively collect every .css file under a directory.
 *
 * @param {string} dir directory to walk
 * @returns {string[]} absolute paths of the .css files found
 */
const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(p);
    return p.endsWith(".css") ? [p] : [];
  });

/**
 * Path relative to client/src, forward slashes on every OS.
 *
 * @param {string} file absolute path
 * @returns {string} e.g. "components/ambient/ControlButtons/styles.css"
 */
const rel = (file) => path.relative(SRC_DIR, file).split(path.sep).join("/");

/**
 * Blank out CSS comments, keeping every offset (newlines survive).
 *
 * @param {string} css raw stylesheet
 * @returns {string} the stylesheet with each comment replaced by spaces
 */
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));

/**
 * Index of the `}` closing the block whose `{` sits at `open`.
 *
 * @param {string} css comment-free stylesheet
 * @param {number} open index of the opening brace
 * @returns {number} index of the matching closing brace (css.length if unbalanced)
 */
const matchBrace = (css, open) => {
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return css.length;
};

/**
 * Collapse whitespace so two spellings of one selector compare equal.
 *
 * @param {string} selector raw selector text
 * @returns {string} normalised selector
 */
const normSelector = (selector) => selector.trim().replace(/\s+/g, " ").replace(/\s*([>+~,])\s*/g, "$1");

/**
 * Parse a comment-free stylesheet into its style rules and keyframes.
 * Recurses into `@media` / `@supports` blocks, recording whether a rule
 * sits inside a reduced-motion (`reduce`) or a motion-safe
 * (`no-preference`) media query.
 *
 * @param {string} css comment-free stylesheet
 * @param {number} [start] index to start parsing at
 * @param {number} [end] index to stop parsing at
 * @param {{reducedMotion: boolean, motionSafe: boolean}} [ctx] media context
 *   inherited from the enclosing blocks
 * @param {{rules: object[], keyframes: Map<string, string>}} [out] accumulator
 * @returns {{rules: {selector: string, body: string, offset: number, reducedMotion: boolean, motionSafe: boolean}[], keyframes: Map<string, string>}}
 *   every style rule (normalised selector, declaration body, start offset,
 *   reduced-motion and motion-safe context) and every `@keyframes` body by name
 */
const parseCss = (
  css,
  start = 0,
  end = css.length,
  ctx = { reducedMotion: false, motionSafe: false },
  out = { rules: [], keyframes: new Map() },
) => {
  let i = start;
  while (i < end) {
    const open = css.indexOf("{", i);
    if (open === -1 || open >= end) break;
    // A prelude ends at the last `;` or `}` before the brace (skips @import etc.).
    const preludeStart = Math.max(css.lastIndexOf(";", open), css.lastIndexOf("}", open), i - 1) + 1;
    const prelude = css.slice(preludeStart, open).trim();
    const close = matchBrace(css, open);
    if (/^@keyframes\s/.test(prelude)) {
      out.keyframes.set(prelude.replace(/^@keyframes\s+/, "").trim(), css.slice(open + 1, close));
    } else if (/^@(media|supports)\b/.test(prelude)) {
      const inner = {
        reducedMotion: ctx.reducedMotion || REDUCED_MOTION_RE.test(prelude),
        motionSafe: ctx.motionSafe || MOTION_SAFE_RE.test(prelude),
      };
      parseCss(css, open + 1, close, inner, out);
    } else if (!prelude.startsWith("@")) {
      out.rules.push({
        selector: normSelector(prelude),
        body: css.slice(open + 1, close),
        offset: preludeStart,
        reducedMotion: ctx.reducedMotion,
        motionSafe: ctx.motionSafe,
      });
    }
    i = close + 1;
  }
  return out;
};

/**
 * Whether a keyframes body leaves the element hidden on its last frame.
 *
 * @param {string} body the `@keyframes` block content
 * @returns {boolean} true when a `100%` / `to` frame sets opacity 0 or visibility hidden
 */
const endsHidden = (body) => {
  const frameRe = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = frameRe.exec(body)) !== null) {
    const selectors = m[1].split(",").map((s) => s.trim().toLowerCase());
    if (selectors.some((s) => LAST_FRAME_SELECTORS.has(s)) && HIDDEN_DECL_RE.test(m[2])) return true;
  }
  return false;
};

/**
 * Value of the last declaration of a property in a rule body.
 *
 * @param {string} body declaration block content
 * @param {string} prop property name (e.g. "animation-name")
 * @returns {string|null} the declared value, or null when absent
 */
const declValue = (body, prop) => {
  const re = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "g");
  let value = null;
  let m;
  while ((m = re.exec(body)) !== null) value = m[1].trim();
  return value;
};

/**
 * Every animation of a rule that holds a last keyframe hiding the element.
 *
 * @param {{body: string}} rule a parsed style rule
 * @param {Map<string, string>} keyframes the file's keyframes by name
 * @returns {string[]} names of the hiding, end-holding animations the rule runs
 */
const hidingAnimations = (rule, keyframes) => {
  const found = [];
  const shorthand = declValue(rule.body, "animation");
  if (shorthand) {
    for (const layer of shorthand.split(",")) {
      const tokens = layer.trim().split(/\s+/);
      const name = tokens.find((t) => keyframes.has(t));
      if (name && tokens.some((t) => HOLDING_FILL_MODES.has(t)) && endsHidden(keyframes.get(name))) found.push(name);
    }
  }
  const names = declValue(rule.body, "animation-name");
  const fills = declValue(rule.body, "animation-fill-mode");
  if (names && fills) {
    const fillList = fills.split(",").map((f) => f.trim());
    names.split(",").forEach((raw, idx) => {
      const name = raw.trim();
      const fill = fillList[idx % fillList.length];
      if (keyframes.has(name) && HOLDING_FILL_MODES.has(fill) && endsHidden(keyframes.get(name))) found.push(name);
    });
  }
  return found;
};

/**
 * Scan one stylesheet for fade-out animations and their overrides.
 * Rules inside a reduced-motion query are the overrides themselves, and
 * rules inside a motion-safe query never apply under reduced motion, so
 * neither is scanned as a candidate.
 *
 * @param {string} css raw stylesheet
 * @param {string} file path reported in each hit
 * @returns {{file: string, selector: string, name: string, overridden: boolean}[]}
 *   one entry per hiding, end-holding animation that can run under reduced
 *   motion, with whether a later reduced-motion override removes it
 */
const scanCss = (css, file) => {
  const { rules, keyframes } = parseCss(stripComments(css));
  return rules
    .filter((rule) => !rule.reducedMotion && !rule.motionSafe)
    .flatMap((rule) =>
      hidingAnimations(rule, keyframes).map((name) => ({
        file,
        selector: rule.selector,
        name,
        overridden: rules.some(
          (o) => o.reducedMotion && o.selector === rule.selector && o.offset > rule.offset && ANIMATION_OFF_RE.test(o.body),
        ),
      })),
    );
};

/**
 * Scan every stylesheet under client/src.
 *
 * @returns {{file: string, selector: string, name: string, overridden: boolean}[]}
 *   the hits of scanCss across every file, paths relative to client/src
 */
const scan = () => walk(SRC_DIR).flatMap((file) => scanCss(fs.readFileSync(file, "utf8"), rel(file)));

test("the scan recognises the dock toast's fade-out (guards the parser itself)", () => {
  const toast = scan().find(
    (hit) => hit.file === "components/ambient/ControlButtons/styles.css" && hit.name === "toast-pop",
  );
  assert.ok(toast, "the toast-pop animation of the dock toast is no longer detected: fix the parser or this test");
  assert.equal(toast.selector, ".container>div.toast");
});

test("the scan accepts both reduced-motion patterns and flags a bare fade-out", () => {
  const css = `
    @keyframes fade { from { opacity: 1; } to { opacity: 0; } }
    .bare { animation: fade 1s forwards; }
    .overridden { animation: fade 1s forwards; }
    @media (prefers-reduced-motion: reduce) { .overridden { animation: none; } }
    @media (prefers-reduced-motion: no-preference) { .safe { animation: fade 1s forwards; } }
    @supports (display: grid) {
      @media screen and (prefers-reduced-motion: no-preference) { .nestedSafe { animation: fade 1s both; } }
    }
  `;
  assert.deepEqual(
    scanCss(css, "fixture.css").map(({ selector, overridden }) => ({ selector, overridden })),
    [
      { selector: ".bare", overridden: false },
      { selector: ".overridden", overridden: true },
    ],
  );
});

test("every animation that ends hidden and holds its end state is removed under reduced motion", () => {
  const missing = scan().filter((hit) => !hit.overridden);
  assert.deepEqual(
    missing.map((hit) => `${hit.file}: ${hit.selector} runs "${hit.name}"`),
    [],
    "An animation whose last keyframe hides the element (opacity 0 / visibility hidden) and is held " +
      "(`forwards` / `both`) shows NOTHING under prefers-reduced-motion: the global rule in " +
      "styles/main.css crushes it to its end state. Add, after the base rule in the same file, " +
      "`@media (prefers-reduced-motion: reduce) { <same selector> { animation: none; } }`, " +
      "or declare the animation only inside `@media (prefers-reduced-motion: no-preference)`.",
  );
});

test("the global reduced-motion rule still crushes animations (the premise of this guard)", () => {
  const css = stripComments(fs.readFileSync(path.join(SRC_DIR, "styles", "main.css"), "utf8"));
  const { rules } = parseCss(css);
  const global = rules.find((r) => r.reducedMotion && r.selector.split(",").includes("*"));
  assert.ok(global, "styles/main.css no longer has a reduced-motion rule on `*`: revisit this guard");
  assert.match(global.body, /animation-duration\s*:/);
});

/**
 * The style rules of styles/main.css, parsed without comments.
 *
 * @returns {{selector: string, body: string, offset: number, reducedMotion: boolean, motionSafe: boolean}[]}
 *   every style rule of the global stylesheet
 */
const mainCssRules = () =>
  parseCss(stripComments(fs.readFileSync(path.join(SRC_DIR, "styles", "main.css"), "utf8"))).rules;

const TRANSITION_DECL_RE = /(?:^|;)\s*(?:-webkit-)?transition(?:-[a-z]+)?\s*:/;
const IMPORTANT_TRANSITION_RE = /(?:^|;)\s*(?:-webkit-)?transition(?:-[a-z]+)?\s*:[^;]*!important/;

test("the global reduced-motion rule removes every transition", () => {
  const global = mainCssRules().find((r) => r.reducedMotion && r.selector.split(",").includes("*"));
  assert.ok(global, "styles/main.css no longer has a reduced-motion rule on `*`");
  assert.match(global.body, /(?:^|;)\s*transition\s*:\s*none\s*!important\s*(?:;|$)/);
  // A crushed duration would still run a transition (and fire its events).
  assert.doesNotMatch(global.body, /transition-duration/);
});

test("Leaflet's zoom transition keeps 0.01 ms under reduced motion (transitionend must fire)", () => {
  const leaflet = mainCssRules().filter(
    (r) => r.reducedMotion && r.selector === ".leaflet-zoom-anim .leaflet-zoom-animated",
  );
  assert.equal(leaflet.length, 1, "the Leaflet zoom exception is gone from styles/main.css");
  assert.match(leaflet[0].body, /^\s*transition\s*:\s*transform\s+0\.01ms\s*!important\s*;?\s*$/);
});

test("no other transition is declared under reduced motion, and none is !important elsewhere", () => {
  const reducedMotionTransitions = [];
  const importantTransitions = [];
  for (const file of walk(SRC_DIR)) {
    for (const rule of parseCss(stripComments(fs.readFileSync(file, "utf8"))).rules) {
      if (!TRANSITION_DECL_RE.test(rule.body)) continue;
      if (rule.reducedMotion) reducedMotionTransitions.push(`${rel(file)}: ${rule.selector}`);
      else if (IMPORTANT_TRANSITION_RE.test(rule.body)) importantTransitions.push(`${rel(file)}: ${rule.selector}`);
    }
  }
  assert.deepEqual(reducedMotionTransitions.sort(), [
    "styles/main.css: *,*::before,*::after",
    "styles/main.css: .leaflet-zoom-anim .leaflet-zoom-animated",
  ]);
  assert.deepEqual(
    importantTransitions,
    [],
    "An `!important` transition on a class beats the global `* { transition: none !important }` " +
      "(higher specificity) and runs under reduced motion.",
  );
});
