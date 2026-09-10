// Locks the font-weight ↔ @font-face contract of the Ambient Layers surface
// (client/src/ui/fonts.css): the client self-hosts Geist 400 / 500 / 700 and
// Geist Mono 500 — nothing else. A rule asking for any other weight fails
// with ZERO build-time or lint signal; the browser just substitutes:
//
//  - a heavier loaded face when one exists (600 → Bold on Geist Sans), so
//    the stylesheet says "semibold" while the screen shows "bold";
//  - a synthesized faux-bold when none does (600 / 700 on Geist Mono, which
//    only ships Medium), which Skia (Chromium on the Pi kiosk) and CoreText
//    (WebKit in the iOS PWA) draw differently — the same badge renders at
//    two visibly different weights across the fleet.
//
// 43 rules had drifted that way by 2026-09 (normalized in the same commit as
// this test). Same spirit as react19Guards.test.js: mechanical, text-level,
// loud. The allowed weights are READ from fonts.css, so adding a face there
// (e.g. a real SemiBold) widens the contract without touching this file.
//
// Known limit: a rule that INHERITS Geist Mono from an ancestor and asks for
// 700 cannot be told apart from a Sans rule here (a text scan has no
// cascade), so it is only checked against the union of loaded weights.
// Declare the family in the same rule when you need mono emphasis — and
// prefer colour over weight there, see the DebugPanel latency tiers.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC_DIR = path.join(__dirname, "..", "client", "src");
const FONTS_CSS = path.join(SRC_DIR, "ui", "fonts.css");

// Stylesheets that deliberately target the OS font stack instead of Geist
// and may therefore ask for weights fonts.css never loads. Each entry needs a
// reason; keep the list short.
const SYSTEM_STACK_FILES = new Set([
  // Sleep-mode clock: `--sans` is `ui-sans-serif, system-ui, …` by design
  // (port of docs/design-references/sleep-mode.html); its 200 takes the
  // platform's thinnest face and degrades gracefully where none exists.
  "components/ScreenSaver/styles.css",
]);

const KEYWORD_WEIGHTS = { normal: 400, bold: 700 };
// Values that resolve through the cascade rather than to a face — nothing
// to check at this level.
const PASS_THROUGH = new Set(["inherit", "initial", "unset", "revert"]);

/**
 * Recursively collect every file with the given extension under a directory.
 *
 * @param {string} dir directory to walk
 * @param {string} ext extension to keep, including the dot
 * @returns {string[]} absolute paths of the matching files
 */
const walk = (dir, ext) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(p, ext);
    return p.endsWith(ext) ? [p] : [];
  });

/**
 * Blank out CSS comments while preserving newlines, so offsets still map to
 * the original line numbers.
 *
 * @param {string} css stylesheet source
 * @returns {string} the source with every comment replaced by its newlines
 */
const stripComments = (css) =>
  css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ""));

/**
 * 1-based line number of a character offset.
 *
 * @param {string} text source text
 * @param {number} offset character offset into `text`
 * @returns {number} line number
 */
const lineOf = (text, offset) => text.slice(0, offset).split("\n").length;

/**
 * Resolve a `font-weight` value to a number.
 *
 * @param {string} raw the declaration value as written
 * @returns {number|null} the numeric weight, `null` when the value defers to
 *   the cascade, or `NaN` when it cannot be resolved statically
 *   (`bolder`, `lighter`, `var(...)`)
 */
const resolveWeight = (raw) => {
  const v = raw.trim().toLowerCase();
  if (PASS_THROUGH.has(v)) return null;
  if (v in KEYWORD_WEIGHTS) return KEYWORD_WEIGHTS[v];
  return /^\d+$/.test(v) ? Number(v) : NaN;
};

/**
 * Parse fonts.css into the faces it actually declares.
 *
 * @returns {Map<string, Set<number>>} font-family → set of loaded weights
 */
const loadedFaces = () => {
  const faces = new Map();
  const css = stripComments(fs.readFileSync(FONTS_CSS, "utf8"));
  for (const [, body] of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const family = /font-family:\s*"([^"]+)"/.exec(body)?.[1];
    const weight = /font-weight:\s*(\d+)/.exec(body)?.[1];
    if (!family || !weight) continue;
    if (!faces.has(family)) faces.set(family, new Set());
    faces.get(family).add(Number(weight));
  }
  return faces;
};

const fmt = (set) => [...set].sort((a, b) => a - b).join("/");

test("fonts.css declares at least one face per Geist family", () => {
  const faces = loadedFaces();
  assert.ok(faces.get("Geist")?.size, "no Geist (sans) @font-face found in fonts.css");
  assert.ok(faces.get("Geist Mono")?.size, "no Geist Mono @font-face found in fonts.css");
});

test("every font-weight in client/src CSS names a loaded Geist face", () => {
  const faces = loadedFaces();
  const sans = faces.get("Geist");
  const mono = faces.get("Geist Mono");
  const union = new Set([...sans, ...mono]);
  const offenders = [];

  for (const file of walk(SRC_DIR, ".css")) {
    if (file === FONTS_CSS) continue;
    const rel = path.relative(SRC_DIR, file);
    if (SYSTEM_STACK_FILES.has(rel)) continue;
    const css = stripComments(fs.readFileSync(file, "utf8"));
    // Innermost `{ … }` blocks are declaration lists (rules inside @media /
    // @keyframes included); outer at-rule braces never match `[^{}]*`.
    for (const block of css.matchAll(/\{([^{}]*)\}/g)) {
      const body = block[1];
      const family = /font-family:\s*([^;]+)/.exec(body)?.[1]?.trim() ?? "";
      const [allowed, label] = /Geist Mono/.test(family)
        ? [mono, `Geist Mono (loaded: ${fmt(mono)})`]
        : /Geist/.test(family)
          ? [sans, `Geist (loaded: ${fmt(sans)})`]
          : [union, `inherited family (loaded: ${fmt(union)})`];
      for (const decl of body.matchAll(/font-weight:\s*([^;]+)/g)) {
        const weight = resolveWeight(decl[1]);
        if (weight === null || allowed.has(weight)) continue;
        const line = lineOf(css, block.index + 1 + decl.index);
        offenders.push(`${rel}:${line} font-weight: ${decl[1].trim()} on ${label}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "font-weight without a self-hosted face — the browser will snap to another weight or synthesize a faux-bold (see client/src/ui/fonts.css)"
  );
});

test("no inline style sets a font weight outside the loaded faces", () => {
  const union = new Set([...loadedFaces().values()].flatMap((s) => [...s]));
  const offenders = [];
  for (const file of walk(SRC_DIR, ".js")) {
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(/fontWeight:\s*["']?([A-Za-z0-9]+)/g)) {
      const weight = resolveWeight(m[1]);
      if (weight === null || union.has(weight)) continue;
      offenders.push(`${path.relative(SRC_DIR, file)}:${lineOf(src, m.index)} fontWeight ${m[1]}`);
    }
  }
  assert.deepEqual(offenders, [], "inline fontWeight without a self-hosted face");
});
