// Pins the opaque edges (client/src/ui/opaqueTokens.js) and the CSS
// contract around them: the card edges, then (second half of the file) the
// own-fill edges.
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
// The own-fill edges (map frame, popovers, health chip) are composited over
// the box's OWN opaque fill instead, and read directly by the box: their
// values, the chip's mix ratios mirrored from CSS, and the closed list of
// readers are pinned in the second half, with the rules that swap a
// reader's fill (card edges included).
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
  HEALTH_CHIP_ACCENT_MIX,
  mixOklab,
  opaqueEdgeOver,
  ownFillEdgeTokens,
  ownFillEdgeVars,
} = require("../client/src/ui/opaqueTokens");

const SRC_DIR = path.join(__dirname, "..", "client", "src");
const TOKENS_SRC = fs.readFileSync(path.join(SRC_DIR, "ui", "tokens.js"), "utf8");
const KEYS = ["bg", "surface", "surfaceHybrid", "border", "borderHybrid"];

function palettes(keys = KEYS) {
  const exported = TOKENS_SRC.match(/^export const tokens = \{([^}]*)\};/m);
  assert.ok(exported, "tokens.js no longer has `export const tokens = { … };`");
  const names = exported[1].split(",").map((s) => s.trim()).filter(Boolean);
  return Object.fromEntries(names.map((name) => {
    const block = TOKENS_SRC.match(new RegExp(`^const ${name} = \\{([\\s\\S]*?)^\\};`, "m"));
    assert.ok(block, `no top-level \`const ${name} = { … };\` in tokens.js`);
    return [name, Object.fromEntries(keys.map((key) => {
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
  // The forms the module header says it refuses: percentage channels (only
  // the alpha may be a percentage), other colour functions, named colours,
  // 4- and 8-digit hex, out-of-range values.
  const refused = [
    "transparent", "white", "#f4f0e8fe", "#ffff", "hsl(0 0% 0%)",
    "rgb(50% 40% 30%)", "rgba(50%, 40%, 30%, 0.16)", "rgb(42 38 30% / 16%)",
    "color-mix(in srgb, #2a2620 16%, transparent)", "var(--c-border)",
    "rgba(300, 0, 0, 1)", "rgba(0, 0, 0, 2)", "",
  ];
  for (const bad of refused) {
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
// whose rail floats over the map (LayoutDesktop). DetailsPopover's
// `.popover` is filled with the opaque --c-bg in every layout, in place or
// portaled (the portal copies --c-opaque-edge with the other tokens); it
// maps --c-card-edge only (CALM_ONLY_CONTAINERS).
const ALLOWED_CONTAINERS = {
  "components/ambient/DetailsPopover/styles.css": [".popover"],
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

// Containers that map --c-card-edge only. DetailsPopover's portal copies
// --c-surface but not --c-surface-hybrid, so a `--c-card-edge-hybrid`
// reader's `var(--c-surface-hybrid, var(--c-surface))` fill falls back to
// the calm surface there, under an edge composited over the 0.96 one (up
// to 3 levels off in night red): left unmapped, it keeps its translucent
// edge.
const CALM_ONLY_CONTAINERS = ["components/ambient/DetailsPopover/styles.css"];

test("the containers map --c-card-edge* to the root's opaque edges", () => {
  for (const [file, selectors] of Object.entries(ALLOWED_CONTAINERS)) {
    const block = rules(fs.readFileSync(path.join(SRC_DIR, file), "utf8"))
      .find((r) => r.selectors.join(",") === selectors.join(","));
    assert.ok(block, `${file}: no rule for ${selectors.join(", ")}`);
    assert.match(block.body, /--c-card-edge\s*:\s*var\(\s*--c-opaque-edge\s*\)\s*;/);
    if (CALM_ONLY_CONTAINERS.includes(file)) {
      assert.doesNotMatch(block.body, /--c-card-edge-hybrid\s*:/, `${file}: must not map --c-card-edge-hybrid (CALM_ONLY_CONTAINERS)`);
    } else {
      assert.match(block.body, /--c-card-edge-hybrid\s*:\s*var\(\s*--c-opaque-edge-hybrid\s*\)\s*;/);
    }
    assert.doesNotMatch(block.body, /--c-(?:surface|border)[\w-]*\s*:/, `${file}: a container must not redefine --c-surface / --c-border`);
  }
  for (const file of CALM_ONLY_CONTAINERS) assert.ok(file in ALLOWED_CONTAINERS, `${file} is not a container`);
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
  // Memoised on the same two inputs: the React Compiler does not cache this
  // call on its own (see the comment above it in AmbientLayers).
  assert.match(
    src,
    /useMemo\(\s*\(\)\s*=>\s*opaqueEdgeVars\(palette, isHybrid\),\s*\[palette, isHybrid\],?\s*\)/,
    "AmbientLayers must memoise opaqueEdgeVars(palette, isHybrid) on [palette, isHybrid]",
  );
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

test("a percentage channel in any edge token falls back the same way: no edges, a warning, no throw", () => {
  // parseColor reads number channels only (module header). Rewrite each of
  // the five tokens of every palette, one at a time, with the same colour in
  // percentage channels: whichever token it is, the edges must come back
  // unset (AmbientLayers then leaves --c-opaque-edge* unset and the cards
  // keep their translucent var(--c-border) fallback, pinned above).
  const asPercent = (str) => {
    const { r, g, b, a } = parseColor(str);
    const pct = (v) => `${+(v / 2.55).toFixed(2)}%`;
    return `rgb(${pct(r)} ${pct(g)} ${pct(b)} / ${a})`;
  };
  const warn = console.warn;
  const warnings = [];
  console.warn = (msg) => warnings.push(String(msg));
  try {
    for (const [name, p] of Object.entries(palettes())) {
      for (const key of KEYS) {
        const percent = asPercent(p[key]);
        assert.match(percent, /^rgb\([\d.]+% [\d.]+% [\d.]+% \/ [\d.]+\)$/, `${name}.${key}`);
        const broken = { ...p, [key]: percent };
        assert.throws(() => opaqueEdgeTokens(broken), /unsupported colour/, `${name}.${key}`);
        for (const hybrid of [false, true]) {
          warnings.length = 0;
          assert.deepEqual(
            opaqueEdgeVars(broken, hybrid),
            { opaqueEdge: undefined, opaqueEdgeHybrid: undefined },
            `${name}.${key} = ${percent}, hybrid ${hybrid}`,
          );
          assert.equal(warnings.length, 1, `${name}.${key}: one warning per call`);
          assert.match(warnings[0], /unsupported colour/, `${name}.${key}`);
          assert.ok(warnings[0].includes(percent), `${name}.${key}: the warning quotes the offending value (${warnings[0]})`);
        }
      }
    }
  } finally {
    console.warn = warn;
  }
});

test("only the five edge tokens are parsed: another token in a refused form changes nothing and warns nothing", () => {
  // The module header limits the fallback to the five tokens
  // opaqueEdgeTokens reads (KEYS). Any other palette token (an accent in
  // hsl(), a named text colour, a color-mix() soft accent) must never reach
  // parseColor: same edges, no warning.
  const others = {
    accent: "hsl(28 77% 41%)",
    accentSoft: "color-mix(in srgb, #b85a18 16%, transparent)",
    text: "black",
    textDim: "rgb(43% 40% 35%)",
    danger: "var(--c-danger)",
  };
  const warn = console.warn;
  const warnings = [];
  console.warn = (msg) => warnings.push(String(msg));
  try {
    for (const [name, p] of Object.entries(palettes())) {
      const withOthers = { ...p, ...others };
      assert.deepEqual(opaqueEdgeTokens(withOthers), opaqueEdgeTokens(p), name);
      for (const hybrid of [false, true]) {
        const vars = opaqueEdgeVars(withOthers, hybrid);
        assert.deepEqual(vars, opaqueEdgeVars(p, hybrid), `${name}, hybrid ${hybrid}`);
        assert.match(vars.opaqueEdge, /^#[0-9a-f]{6}$/, `${name}, hybrid ${hybrid}`);
      }
    }
    assert.deepEqual(warnings, [], "no warning for a token outside the five");
  } finally {
    console.warn = warn;
  }
});

// ============================================================================
// Own-fill edges
// ============================================================================
//
// A box that paints its OWN opaque fill under a translucent border shows one
// fixed edge colour, whatever lies beneath it: the border composited over
// that fill. AmbientLayers mirrors two such colours onto the root
// (`--c-edge-on-bg`, `--c-edge-on-health-chip`) and a closed list of boxes
// reads them directly, each over the fill its token is composited over,
// with its old translucent edge as fallback.

const OWN_KEYS = ["bg", "border", "borderHybrid", "accent"];

const readSrc = (file) => fs.readFileSync(path.join(SRC_DIR, file), "utf8");
const norm = (s) => s.replace(/\s+/g, " ").trim();

// Every innermost `selector { declarations }` block, in source order, with
// the preludes of the at-rules around it (`@supports (…)`, `@media (…)`),
// outermost first.
function blocks(css) {
  const src = stripComments(css);
  const out = [];
  const stack = [];
  let start = 0;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") {
      if (stack.length) stack[stack.length - 1].hasChild = true;
      stack.push({ prelude: norm(src.slice(start, i)), bodyStart: i + 1, hasChild: false });
      start = i + 1;
    } else if (ch === "}") {
      const block = stack.pop();
      if (block && !block.hasChild) {
        out.push({
          selectors: block.prelude.split(",").map(norm),
          body: src.slice(block.bodyStart, i),
          context: stack.map((b) => b.prelude),
        });
      }
      start = i + 1;
    } else if (ch === ";") {
      start = i + 1;
    }
  }
  return out;
}

// The full `var(…)` expression that starts at `index` (nested parentheses
// balanced).
function varAt(body, index) {
  let depth = 0;
  for (let i = index; i < body.length; i += 1) {
    if (body[i] === "(") depth += 1;
    else if (body[i] === ")") {
      depth -= 1;
      if (depth === 0) return norm(body.slice(index, i + 1));
    }
  }
  throw new Error(`unbalanced var() at ${index}`);
}

// Chrome 155's display-list colours of the health chip's fill (headless,
// 2026-10-17). The `night` palette is not reachable today (useTimeOfDay
// returns day, dusk or nightRed); the reviewed table below covers it.
const CHROME_CHIP_FILL = { day: "#f0e4d8", dusk: "#3c2f22", nightRed: "#2b0c0c" };

test("HEALTH_CHIP_ACCENT_MIX mirrors the chip's color-mix() rules, one ratio per palette", () => {
  const MIX_RE = /color-mix\(\s*in oklab\s*,\s*var\(\s*--c-bg\s*\)\s*([\d.]+)%\s*,\s*var\(\s*--c-accent\s*\)\s*([\d.]+)%\s*\)/;
  let base;
  const perPalette = {};
  for (const { selectors, body, context } of blocks(readSrc("components/ambient/HealthIndicator/styles.css"))) {
    if (!selectors.some((sel) => sel.endsWith(".chipButton.chipButton"))) continue;
    const m = body.match(MIX_RE);
    if (!m) {
      assert.doesNotMatch(body, /color-mix/, `${selectors.join(", ")}: a chip color-mix() this test can't read`);
      continue;
    }
    assert.deepEqual(context, [], `${selectors.join(", ")}: the chip's mix must not sit inside an at-rule`);
    assert.equal(Number(m[1]) + Number(m[2]), 100, `${selectors.join(", ")}: the two shares must add up to 100 %`);
    const t = Number(m[2]) / 100;
    for (const sel of selectors) {
      if (sel === ".chipButton.chipButton") {
        assert.equal(base, undefined, "two base chip mixes");
        base = t;
      } else {
        const palette = (sel.match(/^\[data-palette="(\w+)"\] \.chipButton\.chipButton$/) || [])[1];
        assert.ok(palette, `unexpected chip mix selector: ${sel}`);
        perPalette[palette] = t;
      }
    }
  }
  assert.ok(base !== undefined, "the base .chipButton.chipButton rule has no color-mix() fill");
  const effective = Object.fromEntries(Object.keys(palettes()).map((name) => [name, name in perPalette ? perPalette[name] : base]));
  assert.deepEqual(effective, { ...HEALTH_CHIP_ACCENT_MIX });
});

test("mixOklab reproduces Chrome's color-mix(in oklab) for the health chip's fills", () => {
  const all = palettes(OWN_KEYS);
  for (const [name, fill] of Object.entries(CHROME_CHIP_FILL)) {
    const p = all[name];
    const mix = mixOklab(parseColor(p.bg), parseColor(p.accent), HEALTH_CHIP_ACCENT_MIX[name]);
    assert.equal(toHex(mix), fill, `${name}: mixOklab vs Chrome's display list`);
  }
  // Endpoints, and the OKLab mid-grey (oklab(0.5 0 0) is rgb(99 99 99)).
  assert.equal(toHex(mixOklab(parseColor("#123456"), parseColor("#abcdef"), 0)), "#123456");
  assert.equal(toHex(mixOklab(parseColor("#123456"), parseColor("#abcdef"), 1)), "#abcdef");
  assert.equal(toHex(mixOklab(parseColor("#000"), parseColor("#fff"), 0.5)), "#636363");
  assert.throws(() => mixOklab(parseColor("rgba(0, 0, 0, 0.5)"), parseColor("#fff"), 0.5), /opaque/);
  assert.throws(() => mixOklab(parseColor("#fff"), parseColor("rgb(0 0 0 / 0.999)"), 0.5), /opaque/);
});

test("opaqueEdgeOver composites one border over an opaque fill, rounded once", () => {
  const fill = parseColor("#1c1a17");
  assert.equal(opaqueEdgeOver("rgba(216, 212, 204, 0.10)", fill), toHex(compositeOver(parseColor("rgba(216, 212, 204, 0.10)"), fill)));
  assert.throws(() => opaqueEdgeOver("rgba(0, 0, 0, 0.5)", parseColor("rgba(1, 2, 3, 0.5)")), /opaque/);
  assert.throws(() => opaqueEdgeOver("hsl(0 0% 0%)", fill), /unsupported colour/);
});

for (const [name, p] of Object.entries(palettes(OWN_KEYS))) {
  for (const hybrid of [false, true]) {
    const state = hybrid ? "hybrid" : "calm";
    test(`${name} ${state}: each own-fill edge is within one level of its border over its own fill`, () => {
      const border = channels(hybrid ? p.borderHybrid : p.border);
      const vars = ownFillEdgeVars(p, name, hybrid);
      assertNear(vars.edgeOnBg, over(border, channels(p.bg).c), "--c-edge-on-bg (current border on bg)");
      // The chip reads --c-border-hybrid in every state: same edge calm and
      // hybrid, checked against the fill Chrome actually paints.
      if (CHROME_CHIP_FILL[name]) {
        assertNear(vars.edgeOnHealthChip, over(channels(p.borderHybrid), channels(CHROME_CHIP_FILL[name]).c), "--c-edge-on-health-chip (borderHybrid on the chip's fill)");
      }
    });
  }
}

test("the own-fill edges match the reviewed table (sRGB, straight alpha; chip fill mixed in OKLab)", () => {
  // [onBg, onBgHybrid, onHealthChip]
  const expected = {
    day: ["#d4d0c8", "#d0ccc4", "#cdc2b7"],
    dusk: ["#2f2d29", "#423f3b", "#5b5044"],
    night: ["#1d1a18", "#2b2926", "#42362d"],
    nightRed: ["#200a0a", "#331111", "#481818"],
  };
  const all = palettes(OWN_KEYS);
  assert.deepEqual(Object.keys(all).sort(), Object.keys(expected).sort(), "palette list changed: extend the table");
  for (const [name, [onBg, onBgHybrid, onHealthChip]] of Object.entries(expected)) {
    assert.deepEqual(ownFillEdgeTokens(all[name], name), { onBg, onBgHybrid, onHealthChip }, name);
  }
});

test("ownFillEdgeVars: the hybrid flag switches the --c-border edge, not the chip's", () => {
  for (const [name, p] of Object.entries(palettes(OWN_KEYS))) {
    const t = ownFillEdgeTokens(p, name);
    assert.deepEqual(ownFillEdgeVars(p, name, false), { edgeOnBg: t.onBg, edgeOnHealthChip: t.onHealthChip }, name);
    assert.deepEqual(ownFillEdgeVars(p, name, true), { edgeOnBg: t.onBgHybrid, edgeOnHealthChip: t.onHealthChip }, name);
  }
});

// Runs `fn` with console.warn captured; returns its warnings.
function captureWarnings(fn) {
  const warn = console.warn;
  const warnings = [];
  console.warn = (msg) => warnings.push(String(msg));
  try {
    fn();
  } finally {
    console.warn = warn;
  }
  return warnings;
}

test("ownFillEdgeVars never throws: an unknown palette name drops the chip's edge only", () => {
  const { day } = palettes(OWN_KEYS);
  let vars;
  const warnings = captureWarnings(() => {
    vars = ownFillEdgeVars(day, "dawn", false);
  });
  assert.deepEqual(vars, { edgeOnBg: ownFillEdgeTokens(day, "day").onBg, edgeOnHealthChip: undefined });
  assert.equal(warnings.length, 1, "one warning per dropped token");
  assert.match(warnings[0], /mirror for palette "dawn"/);
  assert.throws(() => ownFillEdgeTokens(day, "dawn"), /mirror for palette "dawn"/);
  let empty;
  const emptyWarnings = captureWarnings(() => {
    empty = ownFillEdgeVars({}, "day", true);
  });
  assert.deepEqual(empty, { edgeOnBg: undefined, edgeOnHealthChip: undefined });
  assert.equal(emptyWarnings.length, 2);
});

test("ownFillEdgeVars: an accent in hsl() drops the chip's edge alone, with one warning quoting it", () => {
  for (const [name, p] of Object.entries(palettes(OWN_KEYS))) {
    for (const hybrid of [false, true]) {
      const accent = "hsl(28 77% 41%)";
      let vars;
      const warnings = captureWarnings(() => {
        vars = ownFillEdgeVars({ ...p, accent }, name, hybrid);
      });
      assert.deepEqual(vars, { ...ownFillEdgeVars(p, name, hybrid), edgeOnHealthChip: undefined }, `${name}, hybrid ${hybrid}`);
      assert.equal(warnings.length, 1, `${name}, hybrid ${hybrid}: one warning`);
      assert.ok(warnings[0].includes(accent), `${name}: the warning quotes the value (${warnings[0]})`);
    }
  }
});

test("ownFillEdgeVars: a percentage channel drops exactly the edges that read that token", () => {
  // Which tokens each own-fill edge reads, for the current hybrid flag.
  const NEEDS = {
    edgeOnBg: (hybrid) => ["bg", hybrid ? "borderHybrid" : "border"],
    edgeOnHealthChip: () => ["bg", "accent", "borderHybrid"],
  };
  const asPercent = (str) => {
    const { r, g, b, a } = parseColor(str);
    const pct = (v) => `${+(v / 2.55).toFixed(2)}%`;
    return `rgb(${pct(r)} ${pct(g)} ${pct(b)} / ${a})`;
  };
  for (const [name, p] of Object.entries(palettes(OWN_KEYS))) {
    for (const key of OWN_KEYS) {
      const percent = asPercent(p[key]);
      for (const hybrid of [false, true]) {
        const clean = ownFillEdgeVars(p, name, hybrid);
        let vars;
        const warnings = captureWarnings(() => {
          vars = ownFillEdgeVars({ ...p, [key]: percent }, name, hybrid);
        });
        const what = `${name}.${key} = ${percent}, hybrid ${hybrid}`;
        let dropped = 0;
        for (const [v, needs] of Object.entries(NEEDS)) {
          if (needs(hybrid).includes(key)) {
            dropped += 1;
            assert.equal(vars[v], undefined, `${what}: ${v} must be dropped`);
          } else {
            assert.equal(vars[v], clean[v], `${what}: ${v} must not change`);
          }
        }
        assert.equal(warnings.length, dropped, `${what}: one warning per dropped edge`);
        for (const w of warnings) assert.ok(w.includes(percent), `${what}: the warning quotes the value (${w})`);
      }
    }
  }
});

test("ownFillEdgeVars reads only bg, border, borderHybrid and accent", () => {
  const others = {
    surface: "hsl(40 30% 93%)",
    surfaceHybrid: "white",
    accentSoft: "color-mix(in srgb, #b85a18 16%, transparent)",
    text: "black",
    textDim: "rgb(43% 40% 35%)",
    danger: "var(--c-danger)",
  };
  const warnings = captureWarnings(() => {
    for (const [name, p] of Object.entries(palettes(OWN_KEYS))) {
      for (const hybrid of [false, true]) {
        assert.deepEqual(ownFillEdgeVars({ ...p, ...others }, name, hybrid), ownFillEdgeVars(p, name, hybrid), `${name}, hybrid ${hybrid}`);
      }
      assert.deepEqual(ownFillEdgeTokens({ ...p, ...others }, name), ownFillEdgeTokens(p, name), name);
    }
  });
  assert.deepEqual(warnings, [], "no warning for a token outside the four");
});

// ---- Own-fill CSS contract --------------------------------------------------

// The closed list of own-fill readers: each reads its token as
// `var(<token>, <fallback>)` (the fallback is the edge it had before), in
// its own rule (inside `supports` when given), and is filled with what the
// token is composited over (`fill`, set by the reader's top-level rule).
// Adding a reader means checking that its fill is opaque, that nothing else
// ever sits under its edge, and that the layer tree does not grow (see
// KEPT_TRANSLUCENT below).
const BG_FILL = /background-color\s*:\s*var\(\s*--c-bg\s*\)\s*;/;
const CHIP_FILL = /background-color\s*:\s*color-mix\(\s*in oklab\s*,\s*var\(\s*--c-bg\s*\)\s*[\d.]+%\s*,\s*var\(\s*--c-accent\s*\)\s*[\d.]+%\s*\)\s*;/;
const OWN_FILL_READERS = [
  { token: "--c-edge-on-bg", file: "components/ambient/LayoutPi/styles.css", selector: ".mapArea", fill: BG_FILL, fallback: "var(--c-border)" },
  { token: "--c-edge-on-bg", file: "components/ambient/DetailsPopover/styles.css", selector: ".popover", fill: BG_FILL, fallback: "var(--c-border)" },
  { token: "--c-edge-on-bg", file: "components/ambient/HealthIndicator/styles.css", selector: ".popover", fill: BG_FILL, fallback: "var(--c-border)" },
  {
    token: "--c-edge-on-health-chip",
    file: "components/ambient/HealthIndicator/styles.css",
    selector: ".chipButton.chipButton",
    // Without color-mix() the chip has no such fill: the opaque edge only
    // applies where the mix does.
    supports: "@supports (color: color-mix(in oklab, red 50%, blue))",
    fill: CHIP_FILL,
    fallback: "var(--c-border-hybrid, var(--c-border, rgba(255, 255, 255, 0.18)))",
  },
];

// Boxes on their own opaque fill that keep their translucent edge on
// purpose: with an opaque edge, a DPR-1 Linux browser (Chromium's LCD-text
// rule) gives them, or text around them, one more composited layer — 43 × 12
// over the legend chip's label on the 7" MID glance at font size S, 24 × 24
// on the phone's maximized-radar strip — a per-frame cost, against one
// raster-time saveLayer (WeatherMap/styles.css, ROADMAP.md). Re-measure the
// layer tree before moving one into OWN_FILL_READERS.
const KEPT_TRANSLUCENT = [
  { file: "components/WeatherMap/styles.css", selector: ".legend-chip-i" },
  { file: "components/WeatherMap/styles.css", selector: ".legend-info-btn.legend-info-btn" },
];

test("the own-fill edges are read only by the listed boxes, each with its old edge as fallback", () => {
  const seen = new Map();
  for (const file of CSS_FILES) {
    for (const { selectors, body, context } of blocks(fs.readFileSync(file, "utf8"))) {
      for (const m of body.matchAll(/var\(\s*(--c-edge-on-[\w-]+)/g)) {
        const where = `${rel(file)} ${selectors.join(", ")}`;
        const entry = OWN_FILL_READERS.find((r) => r.file === rel(file) && selectors.length === 1 && selectors[0] === r.selector && r.token === m[1]);
        assert.ok(entry, `${where} reads ${m[1]}: not an own-fill reader (list it in OWN_FILL_READERS after checking its fill and the layer tree)`);
        assert.deepEqual(context, entry.supports ? [entry.supports] : [], `${where}: ${m[1]} read in the wrong at-rule context`);
        assert.equal(varAt(body, m.index), `var(${entry.token}, ${entry.fallback})`, `${where}: the fallback must be the old edge`);
        const key = `${entry.file} ${entry.selector} ${entry.token}`;
        seen.set(key, (seen.get(key) || 0) + 1);
      }
    }
  }
  for (const r of OWN_FILL_READERS) {
    assert.equal(seen.get(`${r.file} ${r.selector} ${r.token}`), 1, `${r.file} ${r.selector} must read ${r.token} exactly once`);
  }
});

test("the radar legend's \"i\" boxes keep their translucent edge (LCD-text layer)", () => {
  for (const { file, selector } of KEPT_TRANSLUCENT) {
    const own = blocks(readSrc(file)).filter((b) => b.selectors.includes(selector));
    assert.ok(own.some((b) => /border\s*:\s*1px solid var\(\s*--c-border\s*,/.test(b.body)), `${file} ${selector}: its translucent var(--c-border, …) edge is gone`);
    for (const b of own) {
      assert.doesNotMatch(b.body, /var\(\s*--c-(?:edge-on|card-edge|opaque-edge)/, `${file} ${selector}: an opaque edge here adds a composited layer (KEPT_TRANSLUCENT)`);
    }
  }
});

// [index, body] of a reader's own rules in `all`: `fill` — the one
// top-level rule that sets its fill; `reader` — the rule that reads the
// token (the fill rule itself, or its `@supports` twin).
function readerRules(all, r) {
  const own = (b) => b.selectors.length === 1 && b.selectors[0] === r.selector;
  const fills = all.map((b, i) => [b, i]).filter(([b]) => own(b) && b.context.length === 0 && r.fill.test(b.body));
  assert.equal(fills.length, 1, `${r.file} ${r.selector}: exactly one top-level rule must set the fill ${r.fill}`);
  const fill = fills[0][1];
  const reader = r.supports ? all.findIndex((b) => own(b) && b.context.join(" ") === r.supports) : fill;
  assert.ok(reader !== -1, `${r.file} ${r.selector}: no ${r.supports} rule`);
  return { fill, reader };
}

test("each own-fill reader is filled with what its edge is composited over", () => {
  for (const r of OWN_FILL_READERS) {
    const all = blocks(readSrc(r.file));
    const { fill, reader } = readerRules(all, r);
    if (r.supports) {
      // The reader rule only swaps the colour: the base rule keeps the old
      // edge, which is the fallback, for browsers without the feature, and
      // comes first — at equal specificity a later base `border:` shorthand
      // would silently win over the token.
      assert.ok(
        norm(all[fill].body).includes(`border: 1px solid ${r.fallback};`),
        `${r.file} ${r.selector}: the base rule must keep border: 1px solid ${r.fallback}`,
      );
      assert.match(all[reader].body, /^\s*border-color\s*:[^;]+;\s*$/, `${r.file} ${r.selector}: the @supports rule must set border-color only`);
      assert.ok(reader > fill, `${r.file} ${r.selector}: the ${r.supports} rule must come after the base rule`);
    } else {
      assert.match(all[fill].body, new RegExp(`border\\s*:\\s*1px solid var\\(\\s*${r.token}\\s*,`), `${r.file} ${r.selector}: the fill rule must also read ${r.token}`);
    }
  }
});

// ---- Rules that swap a reader's fill (own-fill and card edges) -------------
//
// An opaque edge is right only over the fill it was composited over. Any rule
// of the reader's stylesheet — any state, any `@media` / `@supports`, any
// context selector — whose last compound targets the reader's element and
// sets a background must therefore set the same fill again, or take the
// edge back to a translucent token (`var(--c-border…)`), an opaque accent
// (`var(--c-accent…)`) or no border at all, and win over the reader rule.

// The last compound of a selector, CSS Modules' `:global(…)` unwrapped;
// null when it targets a pseudo-element (another box).
function lastCompound(selector) {
  const parts = selector.replace(/:global\(([^()]*)\)/g, "$1").split(/\s*[>+~]\s*|\s+/).filter(Boolean);
  const last = parts[parts.length - 1];
  return /::/.test(last) ? null : last;
}
const classesOf = (compound) => new Set((compound.replace(/:[\w-]+\([^()]*\)/g, "").match(/\.[\w-]+/g) || []).map((c) => c.slice(1)));
function targets(selector, readerSelector) {
  const compound = lastCompound(selector);
  if (!compound) return false;
  const have = classesOf(compound);
  return [...classesOf(lastCompound(readerSelector))].every((c) => have.has(c));
}
const specOf = (selector) => specificity(selector.replace(/:global\(([^()]*)\)/g, "$1"));
const SETS_FILL = /(?:^|[;\s])background(?:-color|-image)?\s*:/;
const TAKES_EDGE_BACK = [
  /border-color\s*:\s*var\(\s*--c-(?:border|accent)[\w-]*\s*[,)]/,
  /(?:^|[;\s])border\s*:\s*(?:0|none)\s*(?:;|$)/,
];

// A card-edge rule that swaps its fill without taking the edge back, and
// why that is right. Closed list.
const CARD_FILL_SWAPS = [
  {
    // The maximized slab's --c-bg fill only exists off LayoutPi (on the Pi
    // it is `.slabPiMax`), where nothing sets --c-card-edge.
    file: "components/ambient/ChartTabs/styles.css",
    selector: ".slab.slabMaximized",
    reader: ".slab",
  },
];

// Every reader with the rule that reads its token and the fill its edge is
// composited over: the own-fill list above, and every --c-card-edge* reader
// (over READER_FILL's surface).
function allReaders() {
  const out = OWN_FILL_READERS.map((r) => {
    const all = blocks(readSrc(r.file));
    const { reader } = readerRules(all, r);
    return { file: r.file, selector: r.selector, fill: r.fill, all, reader, what: r.token };
  });
  for (const file of CSS_FILES) {
    const all = blocks(fs.readFileSync(file, "utf8"));
    all.forEach((b, index) => {
      const m = b.body.match(/var\(\s*(--c-card-edge[\w-]*)/);
      if (!m) return;
      for (const selector of b.selectors) {
        out.push({ file: rel(file), selector, fill: READER_FILL[m[1]], all, reader: index, what: m[1] });
      }
    });
  }
  return out;
}

test("every rule that swaps a reader's fill takes its edge back and wins over the reader rule", () => {
  let checked = 0;
  const swaps = new Set();
  for (const r of allReaders()) {
    const readerSel = r.all[r.reader].selectors.find((s) => s === r.selector);
    r.all.forEach((b, index) => {
      if (index === r.reader || !SETS_FILL.test(b.body)) return;
      for (const sel of b.selectors) {
        if (!targets(sel, r.selector)) continue;
        // The reader's own fill (base rule, palette variants of the chip's
        // mix whose ratios HEALTH_CHIP_ACCENT_MIX pins): nothing to undo.
        if (r.fill.test(b.body)) continue;
        const where = `${r.file} ${sel}${b.context.length ? ` (in ${b.context.join(" ")})` : ""}`;
        const listed = CARD_FILL_SWAPS.find((x) => x.file === r.file && x.selector === sel && x.reader === r.selector);
        if (listed) {
          swaps.add(listed);
          continue;
        }
        checked += 1;
        assert.ok(
          TAKES_EDGE_BACK.some((re) => re.test(b.body)),
          `${where} puts another fill under ${r.selector}'s ${r.what} edge: it must also set border-color: var(--c-border…) / var(--c-accent…), or border: 0`,
        );
        const order = compare(specOf(sel), specOf(readerSel));
        assert.ok(order > 0 || (order === 0 && index > r.reader), `${where} must win over ${r.selector}'s edge rule (more specific, or as specific and later)`);
      }
    });
  }
  assert.equal(swaps.size, CARD_FILL_SWAPS.length, "a CARD_FILL_SWAPS entry no longer matches a rule: drop it");
  assert.ok(checked >= 4, `expected the chip's states and the pressed cards to be checked, found ${checked}`);
});

test("no stylesheet sets --c-edge-on-*, or redefines a token they are composited from", () => {
  for (const file of CSS_FILES) {
    for (const { selectors, body } of blocks(fs.readFileSync(file, "utf8"))) {
      const where = `${rel(file)} ${selectors.join(", ")}`;
      assert.doesNotMatch(body, /--c-edge-on-[\w-]*\s*:/, `${where} sets an own-fill edge (only AmbientLayers does)`);
      assert.doesNotMatch(body, /(?:^|[;\s])--c-(?:bg|accent|border|border-hybrid)\s*:/, `${where} redefines a token an own-fill edge is composited from`);
    }
  }
  for (const file of JS_FILES) {
    const src = stripComments(fs.readFileSync(file, "utf8"));
    if (!/["']--c-edge-on-/.test(src)) continue;
    assert.ok(
      ["components/AmbientLayers/index.js", "components/ambient/DetailsPopover/index.js"].includes(rel(file)),
      `${rel(file)} names --c-edge-on-* (only AmbientLayers sets them; DetailsPopover copies --c-edge-on-bg into its portal)`,
    );
  }
});

test("the Firefox rule leaves the own fills and their edges alone", () => {
  const block = rules(readSrc("styles/main.css")).find((r) => r.selectors.join(",") === 'html[data-browser="firefox"] .ambientRoot');
  assert.ok(block, 'styles/main.css has no html[data-browser="firefox"] .ambientRoot rule');
  assert.doesNotMatch(block.body, /--c-(?:bg|accent|border[\w-]*|edge-on-[\w-]*)\s*:/);
});

test("AmbientLayers memoises the own-fill edges on the palette, its name and the hybrid flag", () => {
  const src = readSrc("components/AmbientLayers/index.js");
  assert.match(
    src,
    /useMemo\(\s*\(\)\s*=>\s*ownFillEdgeVars\(palette, tod, isHybrid\),\s*\[palette, tod, isHybrid\],?\s*\)/,
    "AmbientLayers must memoise ownFillEdgeVars(palette, tod, isHybrid) on [palette, tod, isHybrid]",
  );
  assert.match(src, /const palette = getPalette\(tod\);/, "the name passed must be the one the palette comes from");
  assert.match(src, /data-palette=\{tod\}/, "the name passed must be the root's data-palette (the CSS mirror keys on it)");
  // Exactly the variables the readers above use: no token without a reader.
  const set = [...stripComments(src).matchAll(/["'](--c-edge-on-[\w-]+)["']\s*:\s*(\w+)\s*,/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(set, [["--c-edge-on-bg", "edgeOnBg"], ["--c-edge-on-health-chip", "edgeOnHealthChip"]]);
  assert.deepEqual([...new Set(OWN_FILL_READERS.map((r) => r.token))].sort(), set.map(([name]) => name).sort());
});

test("the portaled DetailsPopover copies the edge tokens it needs, and nothing hybrid", () => {
  const src = stripComments(readSrc("components/ambient/DetailsPopover/index.js"));
  const list = src.match(/for \(const name of \[([\s\S]*?)\]\)/);
  assert.ok(list, "DetailsPopover's portal whitelist (`for (const name of [ … ])`) is gone");
  const names = [...list[1].matchAll(/"(--[\w-]+)"/g)].map((m) => m[1]);
  for (const name of ["--c-bg", "--c-border", "--c-surface", "--c-edge-on-bg", "--c-opaque-edge"]) {
    assert.ok(names.includes(name), `the portal whitelist must copy ${name}`);
  }
  // The inner buttons are filled with --c-surface (READER_FILL above): with
  // --c-surface-hybrid copied, a `var(--c-surface-hybrid, …)` fill would
  // start resolving in the portal and leave its card edge. And without it,
  // --c-opaque-edge-hybrid (composited over it) must not be copied either:
  // a `--c-card-edge-hybrid` reader's fill would fall back to the calm
  // --c-surface under an edge made for the 0.96 one.
  assert.ok(!names.includes("--c-surface-hybrid"), "--c-surface-hybrid is not copied into the portal");
  assert.ok(!names.includes("--c-opaque-edge-hybrid"), "--c-opaque-edge-hybrid is not copied into the portal");
});
