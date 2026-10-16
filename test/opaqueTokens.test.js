// Pins the opaque card edges (client/src/ui/opaqueTokens.js) and the CSS
// contract around them.
//
// Blink paints a rounded box that has a fill and a translucent border
// through an offscreen clip layer (one Skia saveLayer per card); an opaque,
// solid border avoids it. AmbientLayers therefore mirrors, for each palette
// and alert state, the colour a slab's translucent edge shows over the
// opaque `--c-bg` (`--c-opaque-edge*`), and LayoutPi's opaque containers
// map them to the `--c-card-edge*` variables the cards read. Two things
// must hold, and nothing in the build would catch either:
//   - the edge is an opaque `#rrggbb` (alpha 1; a near-opaque form keeps
//     the layer) within one level per channel of the exact translucent
//     chain border → fill → bg;
//   - the opaque edge only reaches cards that really sit on `--c-bg`: a
//     closed list of containers, a `var(--c-border)` fallback on every
//     reader, the Firefox remap.
//
// tokens.js is ESM, so — like opaqueBgToken.test.js — the palettes are read
// as text; the palette list comes from the `export const tokens` line.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  parseColor,
  compositeOver,
  toHex,
  opaqueEdgeTokens,
  opaqueEdgeVars,
} = require("../client/src/ui/opaqueTokens");

const SRC_DIR = path.join(__dirname, "..", "client", "src");
const TOKENS_SRC = fs.readFileSync(path.join(SRC_DIR, "ui", "tokens.js"), "utf8");
const KEYS = ["bg", "surface", "surfaceHybrid", "border", "borderHybrid"];

function palettes() {
  const exported = TOKENS_SRC.match(/^export const tokens = \{([^}]*)\};/m);
  assert.ok(exported, "tokens.js no longer has `export const tokens = { … };`");
  const names = exported[1].split(",").map((s) => s.trim()).filter(Boolean);
  return Object.fromEntries(names.map((name) => {
    const block = TOKENS_SRC.match(new RegExp(`^const ${name} = \\{([\\s\\S]*?)^\\};`, "m"));
    assert.ok(block, `no top-level \`const ${name} = { … };\` in tokens.js`);
    return [name, Object.fromEntries(KEYS.map((key) => {
      const m = block[1].match(new RegExp(`^\\s*${key}:\\s*"([^"]*)",`, "m"));
      assert.ok(m, `palette ${name} has no \`${key}: "…"\` string literal`);
      return [key, m[1]];
    }))];
  }));
}

// Independent exact blend (no rounding), parsed by hand so a bug in the
// module's parser can't hide in the reference too.
function channels(str) {
  if (str.startsWith("#")) {
    return { c: [1, 3, 5].map((i) => parseInt(str.slice(i, i + 2), 16)), a: 1 };
  }
  const n = str.match(/[\d.]+/g).map(Number);
  return { c: n.slice(0, 3), a: n.length > 3 ? n[3] : 1 };
}
const over = (fg, bgChannels) => fg.c.map((v, i) => v * fg.a + bgChannels[i] * (1 - fg.a));
const asColor = (c) => ({ c, a: 1 });

function assertNear(got, exact, what) {
  assert.match(got, /^#[0-9a-f]{6}$/, `${what}: ${got} is not an opaque #rrggbb`);
  const [r, g, b] = channels(got).c;
  [r, g, b].forEach((v, i) => {
    assert.ok(Math.abs(v - exact[i]) <= 1, `${what}: channel ${"rgb"[i]} ${v} vs exact ${exact[i].toFixed(2)}`);
  });
}

// ---- Token values -----------------------------------------------------------

for (const [name, p] of Object.entries(palettes())) {
  test(`${name}: each opaque edge is within one level of the translucent chain`, () => {
    const bg = channels(p.bg).c;
    const surface = over(channels(p.surface), bg);
    const surfaceHybrid = over(channels(p.surfaceHybrid), bg);
    const { edge, edgeHybridFill, edgeHybridState } = opaqueEdgeTokens(p);
    assertNear(edge, over(channels(p.border), surface), "edge (border on surface)");
    assertNear(edgeHybridFill, over(channels(p.border), surfaceHybrid), "edgeHybridFill (border on surfaceHybrid)");
    assertNear(edgeHybridState, over(channels(p.borderHybrid), surfaceHybrid), "edgeHybridState (borderHybrid on surfaceHybrid)");
  });

  for (const hybrid of [false, true]) {
    const state = hybrid ? "hybrid" : "calm";
    test(`${name} ${state}: the root variables follow AmbientLayers' surface/border swap`, () => {
      const bg = channels(p.bg).c;
      const fill = over(channels(hybrid ? p.surfaceHybrid : p.surface), bg);
      const fillHybrid = over(channels(p.surfaceHybrid), bg);
      const border = channels(hybrid ? p.borderHybrid : p.border);
      const { opaqueEdge, opaqueEdgeHybrid } = opaqueEdgeVars(p, hybrid);
      assertNear(opaqueEdge, over(border, fill), "--c-opaque-edge (current border on current surface)");
      assertNear(opaqueEdgeHybrid, over(border, fillHybrid), "--c-opaque-edge-hybrid (current border on surfaceHybrid)");
      // A --c-surface-hybrid box nested in a --c-surface card (HeroCompact's
      // ⤢, ChartTabs' metric tabs, the AlertView and AlertBanner squares)
      // sits on the card, not on bg; at 96 % fill the same edge stays within
      // one level. A --c-surface card nested in a card would not (1 to 3
      // levels), which is why none reads --c-card-edge.
      const nestedFill = over(channels(p.surfaceHybrid), fill);
      assertNear(opaqueEdgeHybrid, over(border, nestedFill), "--c-opaque-edge-hybrid nested in a card");
    });
  }

  test(`${name}: Firefox's calm edge (96 % fill) is the hybrid-fill edge`, () => {
    // styles/main.css forces --c-surface to --c-surface-hybrid on Firefox
    // and remaps --c-opaque-edge to --c-opaque-edge-hybrid to match.
    const bg = channels(p.bg).c;
    const firefoxFill = over(channels(p.surfaceHybrid), bg);
    assertNear(opaqueEdgeVars(p, false).opaqueEdgeHybrid, over(channels(p.border), firefoxFill), "Firefox calm edge");
  });
}

test("the opaque edges match the reviewed table (sRGB, straight alpha)", () => {
  const expected = {
    day: ["#dcd7ce", "#ddd8ce", "#d8d4ca"],
    dusk: ["#36332e", "#37342f", "#494541"],
    night: ["#282521", "#292723", "#363430"],
    nightRed: ["#321010", "#351111", "#451717"],
  };
  const all = palettes();
  assert.deepEqual(Object.keys(all).sort(), Object.keys(expected).sort(), "palette list changed: extend the table");
  for (const [name, [edge, edgeHybridFill, edgeHybridState]] of Object.entries(expected)) {
    assert.deepEqual(opaqueEdgeTokens(all[name]), { edge, edgeHybridFill, edgeHybridState }, name);
  }
});

test("opaqueEdgeVars: calm keeps the two fills apart, hybrid has one edge", () => {
  const { day } = palettes();
  const t = opaqueEdgeTokens(day);
  assert.deepEqual(opaqueEdgeVars(day, false), { opaqueEdge: t.edge, opaqueEdgeHybrid: t.edgeHybridFill });
  assert.deepEqual(opaqueEdgeVars(day, true), { opaqueEdge: t.edgeHybridState, opaqueEdgeHybrid: t.edgeHybridState });
});

// ---- Helpers ----------------------------------------------------------------

test("compositeOver refuses a translucent backdrop", () => {
  assert.throws(() => compositeOver(parseColor("rgba(0, 0, 0, 0.5)"), parseColor("rgba(1, 2, 3, 0.5)")), /opaque/);
  assert.throws(() => compositeOver(parseColor("#000"), parseColor("rgb(1 2 3 / 0.999)")), /opaque/);
});

test("compositeOver stays unrounded so chains don't drift", () => {
  const c = compositeOver(parseColor("rgba(255, 255, 255, 0.5)"), parseColor("#010101"));
  assert.deepEqual(c, { r: 128, g: 128, b: 128, a: 1 });
  const d = compositeOver(parseColor("rgba(0, 0, 0, 0.5)"), parseColor("#030303"));
  assert.equal(d.r, 1.5);
});

test("parseColor reads the token forms and rejects the rest", () => {
  assert.deepEqual(parseColor("#fa0"), { r: 255, g: 170, b: 0, a: 1 });
  assert.deepEqual(parseColor("#F4F0E8"), { r: 244, g: 240, b: 232, a: 1 });
  assert.deepEqual(parseColor("rgba(42, 38, 32, 0.16)"), { r: 42, g: 38, b: 32, a: 0.16 });
  assert.deepEqual(parseColor("rgb(42 38 32 / 16%)"), { r: 42, g: 38, b: 32, a: 0.16 });
  assert.deepEqual(parseColor("rgb(1, 2, 3)"), { r: 1, g: 2, b: 3, a: 1 });
  for (const bad of ["transparent", "#f4f0e8fe", "#ffff", "hsl(0 0% 0%)", "rgba(300, 0, 0, 1)", "rgba(0, 0, 0, 2)", ""]) {
    assert.throws(() => parseColor(bad), /unsupported colour/, bad);
  }
});

test("toHex rounds once and never emits alpha", () => {
  assert.equal(toHex({ r: 219.53, g: 214.82, b: 205.71 }), "#dcd7ce");
  assert.equal(toHex({ r: 0.4, g: 254.6, b: 16.5 }), "#00ff11");
  assert.equal(toHex({ r: 255, g: 255, b: 255, a: 1 }), "#ffffff");
  assert.throws(() => toHex({ r: 255, g: 255, b: 255, a: 0.5 }), /opaque/);
});

// ---- CSS contract -----------------------------------------------------------

function walk(dir, exts, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, exts, out);
    else if (exts.some((ext) => entry.name.endsWith(ext))) out.push(full);
  }
  return out;
}
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "");
const rel = (file) => path.relative(SRC_DIR, file).split(path.sep).join("/");

// Every innermost `selector { declarations }` block of a stylesheet.
function rules(css) {
  const out = [];
  for (const m of stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({ selectors: m[1].split(",").map((s) => s.replace(/\s+/g, " ").trim()), body: m[2] });
  }
  return out;
}

const CSS_FILES = walk(SRC_DIR, [".css"]);
const JS_FILES = walk(SRC_DIR, [".js", ".jsx"]);

// The opaque containers: subtrees whose cards sit directly on the opaque
// --c-bg. Adding one needs a look at what sits under its cards in every
// state (see the inventory comment in LayoutPi/styles.css); never a layout
// whose rail floats over the map (LayoutDesktop, LayoutMobile).
const ALLOWED_CONTAINERS = {
  "components/ambient/LayoutPi/styles.css": [".rail", ".layout > :last-child"],
};

test("every --c-card-edge reader falls back to var(--c-border)", () => {
  let readers = 0;
  for (const file of [...CSS_FILES, ...JS_FILES]) {
    const src = stripComments(fs.readFileSync(file, "utf8"));
    for (const m of src.matchAll(/var\(\s*--c-card-edge[\w-]*[^)]*\)?\)?/g)) {
      readers += 1;
      assert.match(
        m[0],
        /^var\(\s*--c-card-edge(?:-hybrid)?\s*,\s*var\(\s*--c-border\s*\)\s*\)$/,
        `${rel(file)}: "${m[0]}" must read var(--c-card-edge[-hybrid], var(--c-border))`,
      );
    }
  }
  assert.ok(readers >= 10, `expected the card consumers to read --c-card-edge, found ${readers}`);
});

// Each edge is composited over one fill (opaqueTokens.js): --c-card-edge
// over --c-surface, --c-card-edge-hybrid over --c-surface-hybrid. On the
// wrong fill it would stay opaque but be up to 3 levels off (night-red calm:
// #321010 vs #351111), and nothing else would catch it.
const READER_FILL = {
  "--c-card-edge": /background-color\s*:\s*var\(\s*--c-surface\s*\)\s*;/,
  "--c-card-edge-hybrid": /background-color\s*:\s*var\(\s*--c-surface-hybrid\s*[,)]/,
};

test("each --c-card-edge* reader is filled with the surface its edge is composited over", () => {
  let readers = 0;
  for (const file of CSS_FILES) {
    for (const { selectors, body } of rules(fs.readFileSync(file, "utf8"))) {
      for (const [, token] of body.matchAll(/var\(\s*(--c-card-edge[\w-]*)/g)) {
        readers += 1;
        assert.ok(READER_FILL[token], `${rel(file)} ${selectors.join(", ")}: unknown token ${token}`);
        assert.match(
          body,
          READER_FILL[token],
          `${rel(file)} ${selectors.join(", ")} reads ${token}: its own rule must set ${token === "--c-card-edge" ? "background-color: var(--c-surface)" : "background-color: var(--c-surface-hybrid, …)"}`,
        );
      }
    }
  }
  assert.ok(readers >= 10, `expected the card consumers to read --c-card-edge, found ${readers}`);
});

// The overrides that take a reader's translucent edge back, because they put
// it on another fill than the one its edge is composited over (pressed
// accent tint, the extreme alert's red wash). Closed list: in a file that
// reads --c-card-edge*, every `border-color: var(--c-border)` is listed here,
// and each one must win over the reader rule it undoes: later in the same
// file at no lower specificity, or higher specificity from another module
// (the bundle's module order is not something to rely on). Dropping one
// brings back a wrong colour (about 37 levels on a pressed cell, 27 on the
// extreme card) that no other test sees.
const EXCLUSIONS = [
  {
    file: "components/ambient/MetricsGrid/styles.css",
    selector: ".cellInteractive:active",
    base: { file: "components/ambient/MetricsGrid/styles.css", selector: ".cell" },
  },
  {
    file: "components/ambient/AirAlertCard/styles.css",
    selector: ".card:active",
    base: { file: "components/ambient/AirAlertCard/styles.css", selector: ".card" },
  },
  {
    file: "components/ambient/AlertBanner/styles.css",
    selector: ".compactExtreme",
    base: { file: "components/ambient/AlertBanner/styles.css", selector: ".banner" },
  },
  {
    file: "components/ambient/AlertBanner/styles.css",
    selector: ".compactExtreme .compactMax.compactMax",
    base: { file: "components/ambient/RailSquareButton/styles.css", selector: ".square.square" },
  },
];

// [ids, classes + attributes + pseudo-classes, types] of a plain compound /
// descendant selector; functional pseudo-classes are refused rather than
// guessed.
function specificity(selector) {
  assert.doesNotMatch(selector, /\(/, `specificity(): "${selector}" has a functional pseudo-class`);
  const s = selector.replace(/::[\w-]+/g, " ");
  const ids = (s.match(/#[\w-]+/g) || []).length;
  const classes = (s.match(/\.[\w-]+|\[[^\]]*\]|:[\w-]+/g) || []).length;
  const types = (s.replace(/#[\w-]+|\.[\w-]+|\[[^\]]*\]|:[\w-]+/g, " ").match(/[a-z][\w-]*/gi) || []).length;
  return [ids, classes, types];
}
const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

function findRule(file, selector) {
  const all = rules(fs.readFileSync(path.join(SRC_DIR, file), "utf8"));
  const index = all.findIndex((r) => r.selectors.length === 1 && r.selectors[0] === selector);
  assert.ok(index !== -1, `${file}: no rule for ${selector}`);
  return { index, body: all[index].body };
}

test("the translucent-edge overrides are listed and win over the card rule they undo", () => {
  for (const { file, selector, base } of EXCLUSIONS) {
    const rule = findRule(file, selector);
    const card = findRule(base.file, base.selector);
    const what = `${file} ${selector}`;
    assert.match(rule.body, /border-color\s*:\s*var\(\s*--c-border\s*\)\s*;/, `${what} must set border-color: var(--c-border)`);
    assert.match(card.body, /var\(\s*--c-card-edge/, `${base.file} ${base.selector} no longer reads --c-card-edge*`);
    const order = compare(specificity(selector), specificity(base.selector));
    if (file === base.file) {
      assert.ok(rule.index > card.index, `${what} must come after ${base.selector} in the same file`);
      assert.ok(order >= 0, `${what} must not be less specific than ${base.selector}`);
    } else {
      assert.ok(order > 0, `${what} must be more specific than ${base.file} ${base.selector}`);
    }
  }
  const listed = new Set(EXCLUSIONS.map((e) => `${e.file} ${e.selector}`));
  for (const file of CSS_FILES) {
    const all = rules(fs.readFileSync(file, "utf8"));
    if (!all.some((r) => /var\(\s*--c-card-edge/.test(r.body))) continue;
    for (const { selectors, body } of all) {
      if (!/border-color\s*:\s*var\(\s*--c-border\s*\)/.test(body)) continue;
      const key = `${rel(file)} ${selectors.join(", ")}`;
      assert.ok(listed.has(key), `${key} sets border-color: var(--c-border) in a --c-card-edge file: list it in EXCLUSIONS`);
    }
  }
});

test("--c-card-edge is only set by the listed opaque containers", () => {
  const found = {};
  for (const file of CSS_FILES) {
    for (const { selectors, body } of rules(fs.readFileSync(file, "utf8"))) {
      if (/--c-card-edge[\w-]*\s*:/.test(body)) {
        found[rel(file)] = [...(found[rel(file)] || []), ...selectors];
      }
    }
  }
  assert.deepEqual(found, ALLOWED_CONTAINERS);
  for (const file of JS_FILES) {
    const src = stripComments(fs.readFileSync(file, "utf8"));
    assert.doesNotMatch(src, /["']--c-card-edge/, `${rel(file)} sets --c-card-edge from JS`);
  }
});

test("the containers map --c-card-edge* to the root's opaque edges", () => {
  for (const [file, selectors] of Object.entries(ALLOWED_CONTAINERS)) {
    const block = rules(fs.readFileSync(path.join(SRC_DIR, file), "utf8"))
      .find((r) => r.selectors.join(",") === selectors.join(","));
    assert.ok(block, `${file}: no rule for ${selectors.join(", ")}`);
    assert.match(block.body, /--c-card-edge\s*:\s*var\(\s*--c-opaque-edge\s*\)\s*;/);
    assert.match(block.body, /--c-card-edge-hybrid\s*:\s*var\(\s*--c-opaque-edge-hybrid\s*\)\s*;/);
    assert.doesNotMatch(block.body, /--c-(?:surface|border)[\w-]*\s*:/, `${file}: a container must not redefine --c-surface / --c-border`);
  }
});

test("--c-opaque-edge* is read only by the containers and the Firefox rule", () => {
  for (const file of CSS_FILES) {
    for (const { selectors, body } of rules(fs.readFileSync(file, "utf8"))) {
      if (!/var\(\s*--c-opaque-edge/.test(body)) continue;
      const key = selectors.join(",");
      const isContainer = (ALLOWED_CONTAINERS[rel(file)] || []).join(",") === key;
      const isFirefox = rel(file) === "styles/main.css" && key === 'html[data-browser="firefox"] .ambientRoot';
      assert.ok(isContainer || isFirefox, `${rel(file)} ${key} reads --c-opaque-edge directly; read --c-card-edge instead`);
    }
  }
});

test("the Firefox rule remaps the calm edge with the calm fill", () => {
  const block = rules(fs.readFileSync(path.join(SRC_DIR, "styles", "main.css"), "utf8"))
    .find((r) => r.selectors.join(",") === 'html[data-browser="firefox"] .ambientRoot');
  assert.ok(block, 'styles/main.css has no html[data-browser="firefox"] .ambientRoot rule');
  assert.match(block.body, /--c-surface\s*:\s*var\(\s*--c-surface-hybrid\s*\)\s*!important/);
  assert.match(block.body, /--c-opaque-edge\s*:\s*var\(\s*--c-opaque-edge-hybrid\s*\)\s*!important/);
});

test("AmbientLayers swaps the opaque edges with the same hybrid flag as --c-surface/--c-border", () => {
  const src = fs.readFileSync(path.join(SRC_DIR, "components", "AmbientLayers", "index.js"), "utf8");
  assert.match(src, /const surfaceVar = isHybrid \?/);
  assert.match(src, /const borderVar = isHybrid \?/);
  assert.match(src, /opaqueEdgeVars\(palette, isHybrid\)/);
  assert.match(src, /["']--c-opaque-edge["']\s*:\s*opaqueEdge\s*,/);
  assert.match(src, /["']--c-opaque-edge-hybrid["']\s*:\s*opaqueEdgeHybrid\s*,/);
});

test("ChartTabs: the color-mix icon dimming stays before the active icon rule", () => {
  // Same specificity: if the @supports block moved after
  // `.metricTabActive svg`, the active icon would lose its accent colour.
  const css = stripComments(fs.readFileSync(path.join(SRC_DIR, "components", "ambient", "ChartTabs", "styles.css"), "utf8"));
  const supports = css.indexOf("@supports (color: color-mix(");
  const active = css.indexOf(".metricTabs .metricTabActive svg");
  assert.ok(supports !== -1, "the @supports color-mix block for the metric-tab icons is gone");
  assert.ok(active !== -1, ".metricTabs .metricTabActive svg is gone");
  assert.ok(supports < active, "the @supports block must come before .metricTabActive svg");
});

test("opaqueEdgeVars never throws: an unparseable token leaves the edges unset (cards fall back to --c-border)", () => {
  const broken = { bg: "hsl(40 30% 93%)", surface: "rgba(255, 250, 240, 0.85)", surfaceHybrid: "rgba(255, 250, 240, 0.96)", border: "rgba(42, 38, 32, 0.16)", borderHybrid: "rgba(42, 38, 32, 0.18)" };
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual(opaqueEdgeVars(broken, false), { opaqueEdge: undefined, opaqueEdgeHybrid: undefined });
    assert.deepEqual(opaqueEdgeVars(broken, true), { opaqueEdge: undefined, opaqueEdgeHybrid: undefined });
  } finally {
    console.warn = warn;
  }
});
