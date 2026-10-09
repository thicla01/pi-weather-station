// Locks two Places (favorite locations) interaction contracts that fail with
// ZERO build-time, lint or console signal — there is no client test harness
// (tech-debt D2), so a mechanical text-level guard is the only cheap tripwire.
// Same spirit as react19Guards.test.js: mechanical, text-level, loud.
//
//  1. Esc while renaming a favorite cancels the rename ONLY. The rename
//     input marks the keystroke consumed with `e.preventDefault()`, and the
//     DetailsPopover shell's document-level Esc-to-close listener skips a
//     `defaultPrevented` event. Before 2026-10-08 the shell closed on every
//     Esc, so the same keystroke also unmounted the whole panel and dropped
//     Edit mode. The input must NOT `stopPropagation()` instead: that would
//     hide the keystroke from useIdleDetection's window-level listener.
//
//  2. "↺ back to automatic" is offered on whichever row represents home —
//     the ⌂ pseudo-row AND the ⌂-badged stored favorite — gated on a stored
//     manual override. Until 2026-10-08 it rendered on the pseudo-row only,
//     which the badged favorite suppresses, so a home chosen with ⌂ on a
//     saved row (or pinned with ★) had no way back to automatic in Places.
//
// Background: docs/favorite-locations-design.md §7.3 Rename and §7.5 Reset
// to automatic (INV-12 / INV-13 in §2 Invariants).
//
// Known limit: brace matching is not string-aware. Neither source holds an
// unbalanced brace inside a literal; if one ever does, extraction throws or
// mismatches — a loud failure, never a silent pass.
//
// Run: `npm test` or `node --test test/placesPopoverContracts.test.js`.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const AMBIENT_DIR = path.join(__dirname, "..", "client", "src", "components", "ambient");
const DETAILS_SRC = fs.readFileSync(path.join(AMBIENT_DIR, "DetailsPopover", "index.js"), "utf8");
const PLACES_SRC = fs.readFileSync(path.join(AMBIENT_DIR, "PlacesPopover", "index.js"), "utf8");

/**
 * Return the balanced `{…}` block that opens at the first `{` at or after
 * `from`. Not string-aware (see the header's known limit).
 *
 * @param {string} src source text
 * @param {number} from index to start scanning at
 * @returns {string} the block, braces included
 */
const blockFrom = (src, from) => {
  const open = src.indexOf("{", from);
  assert.ok(open !== -1, "no opening brace found");
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    if (src[i] === "}") depth -= 1;
    if (depth === 0) return src.slice(open, i + 1);
  }
  throw new Error("unbalanced braces — see the known limit in this file's header");
};

/**
 * Body of `const <name> = (…) => { … }` in `src`.
 *
 * @param {string} src source text
 * @param {string} name the const's identifier
 * @returns {string} the arrow function's block body
 */
const arrowBody = (src, name) => {
  const m = new RegExp(`const ${name} = \\([^)]*\\) => \\{`).exec(src);
  assert.ok(m, `\`const ${name} = (…) => {…}\` not found — if it was renamed or inlined, repoint this guard`);
  return blockFrom(src, m.index + m[0].length - 1);
};

test("DetailsPopover: the Esc-to-close listener skips an Esc a descendant consumed", () => {
  const reg = /document\.addEventListener\("keydown",\s*(\w+)\)/.exec(DETAILS_SRC);
  assert.ok(reg, "DetailsPopover no longer registers a document keydown listener — repoint this guard");
  const body = arrowBody(DETAILS_SRC, reg[1]);
  assert.match(body, /"Escape"/, "the keydown listener no longer handles Escape — repoint this guard");
  assert.match(
    body,
    /\.defaultPrevented/,
    "DetailsPopover must ignore a defaultPrevented Esc: without it, Esc in the Places "
      + "rename field also closes the whole panel (docs/favorite-locations-design.md §7.3)",
  );
  // Polarity: a consumed Esc must BAIL (`… || e.defaultPrevented) return;`
  // or `!e.defaultPrevented`), not be the thing that triggers the close.
  assert.match(
    body,
    /defaultPrevented\)\s*return\b|!\s*e\.defaultPrevented/,
    "the defaultPrevented check must skip the close, not trigger it",
  );
});

test("PlacesPopover: Esc in the rename field is marked consumed, never stop-propagated", () => {
  const input = PLACES_SRC.indexOf("className={styles.renameInput}");
  assert.ok(input !== -1, "rename input not found — repoint this guard");
  const tagEnd = PLACES_SRC.indexOf("/>", input);
  const tag = PLACES_SRC.slice(input, tagEnd);
  const onKeyDown = /onKeyDown=\{\(e\) => (\w+)\(e, \w+\)\}/.exec(tag);
  // Inline handler or a named one — check whichever the input actually uses.
  const handler = onKeyDown ? arrowBody(PLACES_SRC, onKeyDown[1]) : blockFrom(tag, tag.indexOf("onKeyDown="));
  const escIdx = handler.indexOf('"Escape"');
  assert.ok(escIdx !== -1, "the rename field no longer handles Escape — repoint this guard");
  const escBranch = blockFrom(handler, escIdx);
  assert.match(
    escBranch,
    /e\.preventDefault\(\)/,
    "the rename field's Escape branch must call e.preventDefault() so the DetailsPopover "
      + "shell does not also close the panel (docs/favorite-locations-design.md §7.3)",
  );
  assert.doesNotMatch(
    handler,
    /stopPropagation/,
    "do not stopPropagation() the rename keystroke: it would also hide it from "
      + "useIdleDetection's window listener — preventDefault() is the contract",
  );
});

// Alias chains in the gate are short (`offerReset` → `isHome` → `isDefault(f)`);
// the cap only stops a pathological self-reference from looping.
const MAX_EXPANSION_DEPTH = 4;

/**
 * Expand `renderRow`-local consts, so a gate written as
 * `const offerReset = isHome && hasManualDefault` (with
 * `const isHome = isDefault(f)`) reads as the expression it stands for.
 *
 * @param {string} expr the gate expression as written
 * @param {string} scope the source the consts are declared in
 * @returns {string} the expression with each local const replaced by its initializer
 */
const expandLocals = (expr, scope) => {
  let out = expr;
  for (let i = 0; i < MAX_EXPANSION_DEPTH; i += 1) {
    const next = out.replace(/\b[A-Za-z_]\w*\b/g, (id) => {
      const def = new RegExp(`const ${id} = ([^;]+);`).exec(scope);
      return def ? `(${def[1].trim()})` : id;
    });
    if (next === out) break;
    out = next;
  }
  return out;
};

test("PlacesPopover: ↺ is offered on the ⌂-badged favorite, not only on the pseudo-row", () => {
  const resetSites = PLACES_SRC.match(/onClick=\{handleResetHome\}/g) || [];
  assert.ok(
    resetSites.length >= 2,
    `expected ↺ (handleResetHome) on both home representations, found ${resetSites.length} site(s)`,
  );
  const row = arrowBody(PLACES_SRC, "renderRow");
  const resetAt = row.indexOf("onClick={handleResetHome}");
  assert.ok(resetAt !== -1, "renderRow (stored rows) no longer offers ↺");
  assert.match(row, /t\("favorites\.resetHome"\)/, "the stored-row ↺ must reuse the favorites.resetHome label");

  // The JSX conditional that wraps the stored-row ↺ is the nearest
  // `{<gate> ? (` / `{<gate> && (` before it. Pin what the gate MEANS — the
  // ⌂ badge AND a stored override — not merely that both names appear
  // somewhere in renderRow (`isDefault(f)` also drives the badge itself, so a
  // presence check would pass with the gate reduced to `hasManualDefault`,
  // which would put ↺ on every row and strip ⌂ from all of them).
  const gates = [...row.slice(0, resetAt).matchAll(/\{\s*([^{}?]+?)\s*(?:\?|&&)\s*\(/g)];
  assert.ok(gates.length > 0, "no JSX conditional found around the stored-row ↺ — repoint this guard");
  const gate = expandLocals(gates[gates.length - 1][1], row);
  assert.match(gate, /isDefault\(f\)/, `the stored-row ↺ must be keyed on the ⌂ badge (isDefault); gate reads: ${gate}`);
  assert.match(
    gate,
    /(?<!!\s*)\bhasManualDefault\b/,
    `the stored-row ↺ must be gated on a stored manual override, like the pseudo-row's; gate reads: ${gate}`,
  );
  assert.match(gate, /&&/, `the stored-row ↺ needs BOTH conditions (badge && override); gate reads: ${gate}`);
  assert.doesNotMatch(gate, /\|\|/, `the stored-row ↺ gate must not be a disjunction; gate reads: ${gate}`);

  // Every other stored row (and the badged one with no override) keeps ⌂.
  assert.match(row, /handleSetDefault\(f\)/, "renderRow no longer offers ⌂ (set as default) on stored rows");
});
