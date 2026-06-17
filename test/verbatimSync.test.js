// Drift guard for the "verbatim copy" test files.
//
// Several sibling test files carry a copy of ESM client source (Node's
// CJS test runner can't `require()` the ESM client files without a
// transpiler) and claim that "if the source drifts, the tests fail
// loudly". Until this file existed, nothing actually compared the copy
// to the source — drift was only caught if it happened to change
// behaviour covered by an assertion. This suite makes the claim true:
// for every copied declaration it extracts both the copy (from the test
// file) and the original (from the client source), applies the same
// mechanical normalization to both, and asserts textual equality.
//
// Covered pairs (the five files audited in quality-audit lot D):
//   test/conversions.test.js  ↔ client/src/services/conversions.js
//   test/alertParser.test.js  ↔ client/src/ui/alertParser.js
//   test/alertLogic.test.js   ↔ client/src/ui/alertLogic.js (+ hybrid.js)
//   test/moonLitPath.test.js  ↔ client/src/ui/astronomy.js
//   test/uiHybrid.test.js     ↔ client/src/ui/hybrid.js
//
// Normalization is deliberately mechanical (regex-based, no JS parser —
// the suite must stay deps-free per CLAUDE.md). It erases formatting
// and a small set of documented, semantics-preserving adaptations the
// copies are allowed to make:
//   - comments and whitespace
//   - the `export ` keyword (copies are plain CJS-file declarations)
//   - `console.log(...)` statements (copies drop leftover diagnostics)
//   - `=> { return X; }`  vs  `=> X` (arrow expression bodies)
//   - `if (c) { return X; }` vs `if (c) return X;` (unbraced returns)
//   - `return X; else Y` vs `return X; Y` (early-return chains)
//   - trailing commas before `)` `]` `}`
// Anything else — including a one-character body edit — produces a
// mismatch and a failing test naming the file, the declaration, and the
// resync direction.
//
// Known limitations (accepted to guarantee zero false failures):
//   - Whitespace adjacent to punctuation is normalized away even inside
//     string/regex literals, so a drift that ONLY changes such spacing
//     (e.g. removing the space in the regex class `[A-Z/ ]`) is not
//     detected. Any other in-literal edit is.
//   - Brace matching is not string-aware. The current sources contain
//     no unbalanced brace inside a literal; if one is ever introduced,
//     extraction throws — a loud failure, never a silent pass.
//
// Run: `npm test` or `node --test test/verbatimSync.test.js`.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.join(__dirname, "..");

// Marker comments used by the test files that delimit their copy block.
// The start marker names the source file — we read it from there so the
// pair stays correct even if a copy is repointed at another module.
const COPY_START_RE = /^\/\/ -{4,} start of verbatim copy from (\S+) -{4,}\s*$/m;
const COPY_END_RE = /^\/\/ -{4,} end of verbatim copy -{4,}\s*$/m;

// Top-level (column-0) declarations inside a copy block. Anchored to
// column 0 on purpose: nested `const`s inside a copied function must
// not be discovered as standalone declarations.
const TOP_LEVEL_DECL_RE = /^(?:export\s+)?(?:async\s+)?(?:function\s+(\w+)\s*\(|const\s+(\w+)\s*=)/gm;

// Inventory size as of 2026-06 (12 + 8 + 6 + 1 + 9 + 4). Guards against the
// discovery silently finding nothing (which would fake-pass the suite).
// If a copied declaration is legitimately removed from a test file,
// lower this consciously.
const EXPECTED_CHECK_COUNT = 40;

/**
 * The six copy-carrying test files and how to find their copies.
 *
 * Marker-delimited files (`conversions`, `alertParser`, `moonLitPath`)
 * need no `sourceFile`/`copiedNames`: the source path comes from the
 * start marker and the copied declarations are auto-discovered inside
 * the block. `alertLogic` and `uiHybrid` predate the marker convention
 * and embed their copies inline, so their pairs are spelled out.
 *
 * `adaptations` documents the places where a copy INTENTIONALLY differs
 * from the source beyond what `normalizeJs` erases:
 *   - `sourceFile`: this declaration is copied from a different module
 *     than the rest of the file (e.g. `confidenceBucket` lives in
 *     `hybrid.js` but is re-copied by `alertLogic.test.js` because
 *     `alertLogic.js` imports it from there).
 *   - `renames`: identifier renames applied to the source snippet
 *     before normalization (word-boundary, mechanical).
 *   - `patches`: literal find/replace pairs applied to the normalized
 *     source snippet. Exact-match by construction: if the source region
 *     a patch targets drifts, the patch no longer applies and the
 *     comparison fails — drift is still caught, never masked.
 */
const PAIRS = [
  {
    // Marker-delimited copy of WeatherMap/geometry.js (12 declarations)
    // — registered the day it was created so its own "fails loudly"
    // header is mechanically true from the start.
    testFile: "test/radarGeometry.test.js",
  },
  {
    testFile: "test/conversions.test.js",
    // Marker-delimited. The copy drops the source's leftover
    // `console.log` diagnostics and condenses `else if` chains into
    // early returns — both normalized away mechanically (see the
    // console.log / unbraced-return / else-after-return rules).
  },
  {
    testFile: "test/alertParser.test.js",
    // Marker-delimited.
    adaptations: {
      classifyHeading: {
        patches: [
          {
            // The source keeps an unused `lang` parameter ("reserved
            // for future locale-specific patterns", eslint-disabled);
            // the copy drops it. Callers in both versions still pass
            // `lang`, so only the declaration line differs.
            find: "function classifyHeading(heading, lang) {",
            replace: "function classifyHeading(heading) {",
          },
        ],
      },
    },
  },
  {
    testFile: "test/moonLitPath.test.js",
    // Marker-delimited, copy is byte-for-byte modulo comments/export.
  },
  {
    testFile: "test/alertLogic.test.js",
    sourceFile: "client/src/ui/alertLogic.js",
    copiedNames: [
      "CONFIDENCE_HIGH",
      "CONFIDENCE_MID",
      "confidenceBucket",
      "severity",
      "isCurrentlyPrecipitating",
      "getRadarAlertState",
      "ELIGIBLE_GOV_TIERS",
      "ELIGIBLE_GOV_TIERS_WITH_ADVISORY",
      "selectEligibleGovAlerts",
    ],
    adaptations: {
      // `alertLogic.js` imports `confidenceBucket` (and its two
      // threshold constants) from `hybrid.js`; the test file inlines a
      // copy of all three, so they are compared against `hybrid.js`.
      CONFIDENCE_HIGH: { sourceFile: "client/src/ui/hybrid.js" },
      CONFIDENCE_MID: { sourceFile: "client/src/ui/hybrid.js" },
      confidenceBucket: { sourceFile: "client/src/ui/hybrid.js" },
      getRadarAlertState: {
        // The copy shortens the two confidence parameter names
        // (signature AND body use them, so a plain rename is exact).
        renames: [
          [/\binnerTrendConfidence\b/g, "innerC"],
          [/\bouterTrendConfidence\b/g, "outerC"],
        ],
        patches: [
          {
            // The source assigns the position-only i18n key to a local
            // `const i18nKey` before returning (twice, identically);
            // the copy inlines the template literal into the returned
            // object. Same value, different shape — inline it here.
            find:
              "const i18nKey = `alert.${tier}${innerIsSource ? \"Near\" : \"Approaching\"}`; "
              + "return { tier, i18nKey, confidence, confidenceBucket: bucket };",
            replace:
              "return { tier, i18nKey: `alert.${tier}${innerIsSource ? \"Near\" : \"Approaching\"}`, "
              + "confidence, confidenceBucket: bucket };",
          },
        ],
      },
    },
  },
  {
    testFile: "test/uiHybrid.test.js",
    sourceFile: "client/src/ui/hybrid.js",
    copiedNames: [
      "CONFIDENCE_HIGH",
      "CONFIDENCE_MID",
      "confidenceBucket",
      "hybridLevel",
    ],
  },
];

/**
 * Read a file relative to the repo root (cached — several checks share
 * the same source module).
 *
 * @param {string} relPath - path relative to the repository root
 * @returns {string} file contents (utf-8)
 */
const fileCache = new Map();
function readRepoFile(relPath) {
  if (!fileCache.has(relPath)) {
    fileCache.set(relPath, fs.readFileSync(path.join(REPO_ROOT, relPath), "utf8"));
  }
  return fileCache.get(relPath);
}

/**
 * Strip block and line comments from JS code. Line comments must be
 * preceded by start-of-line or blank space so protocol-relative
 * sequences inside string literals (`"https://..."`) survive.
 *
 * @param {string} code - raw JS source
 * @returns {string} code without comments
 */
function stripComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[ \t])\/\/[^\n]*/gm, "$1");
}

/**
 * Extract a single top-level declaration from (comment-stripped) code.
 * Handles `function NAME(...) {...}` (brace-depth matched) and
 * `const NAME = ...;` (scan to the `;` at bracket depth 0 — covers
 * arrow functions, arrays, and scalar constants), each with an optional
 * `export ` / `async ` prefix.
 *
 * @param {string} code - comment-stripped JS source to search
 * @param {string} name - declaration identifier
 * @param {string} label - file label used in error messages
 * @returns {string} the exact declaration text, prefix included
 * @throws {Error} when the declaration is missing or braces are unbalanced
 */
function extractDeclaration(code, name, label) {
  const fnRe = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const fnMatch = fnRe.exec(code);
  if (fnMatch) {
    // Walk the parameter list parens, then the body braces.
    let i = code.indexOf("(", fnMatch.index);
    let depth = 0;
    for (; i < code.length; i += 1) {
      if (code[i] === "(") depth += 1;
      else if (code[i] === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const bodyOpen = code.indexOf("{", i);
    if (bodyOpen === -1) {
      throw new Error(`${label}: no body found for function "${name}"`);
    }
    depth = 0;
    for (let j = bodyOpen; j < code.length; j += 1) {
      if (code[j] === "{") depth += 1;
      else if (code[j] === "}") {
        depth -= 1;
        if (depth === 0) return code.slice(fnMatch.index, j + 1);
      }
    }
    throw new Error(`${label}: unbalanced braces extracting function "${name}"`);
  }
  const constRe = new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=`);
  const constMatch = constRe.exec(code);
  if (constMatch) {
    let depth = 0;
    for (let j = constMatch.index; j < code.length; j += 1) {
      const ch = code[j];
      if (ch === "(" || ch === "{" || ch === "[") depth += 1;
      else if (ch === ")" || ch === "}" || ch === "]") depth -= 1;
      else if (ch === ";" && depth === 0) return code.slice(constMatch.index, j + 1);
    }
    throw new Error(`${label}: no terminating ";" extracting const "${name}"`);
  }
  throw new Error(`${label}: declaration "${name}" not found`);
}

/**
 * Normalize a JS snippet so that formatting and the documented set of
 * semantics-preserving adaptations (see file header) compare equal,
 * while any content edit still produces a different string.
 *
 * @param {string} code - a single declaration's source text
 * @returns {string} canonical form for equality comparison
 */
function normalizeJs(code) {
  let out = stripComments(code);
  // Copies are CJS-file declarations; the sources are ESM exports.
  out = out.replace(/\bexport\s+/g, "");
  // Copies drop leftover diagnostic logging (none of the log calls
  // nest parentheses, so the simple character class is exact).
  out = out.replace(/console\.log\([^()]*\);?/g, " ");
  // Collapse all whitespace runs (incl. newlines) to a single space.
  out = out.replace(/\s+/g, " ").trim();
  // `=> { return X; }`  →  `=> X` (arrow expression bodies). Must run
  // before the generic unbraced-return rule below.
  out = out.replace(/=>\s*\{\s*return\b\s*([^;{}]*?);?\s*\}/g, "=> $1");
  // `{ return X; }`  →  `return X;` (single-statement return blocks);
  // repeated because unbracing can expose an enclosing candidate.
  let prev;
  do {
    prev = out;
    out = out.replace(/\{\s*(return\b[^;{}]*;)\s*\}/g, " $1 ");
  } while (out !== prev);
  // `return X; else Y`  →  `return X; Y` (an else after an
  // unconditional return is redundant); repeated for else-if chains.
  do {
    prev = out;
    out = out.replace(/(return\b[^;{}]*;)\s*else\b\s*/g, "$1 ");
  } while (out !== prev);
  // Trailing commas before a closer are style, not content.
  out = out.replace(/,\s*([)\]}])/g, "$1");
  // Drop spaces adjacent to punctuation ("(x" vs "( x", "a;" vs "a ;").
  // `$` is kept word-like so identifiers such as `$1` stay intact.
  out = out.replace(/\s+/g, " ");
  out = out.replace(/\s*([^\w\s$])\s*/g, "$1");
  // A snippet-final semicolon (const form) vs none (function form
  // restated as const, or vice versa) is not content.
  return out.replace(/;+\s*$/, "").trim();
}

/**
 * Locate the marker-delimited copy block in a test file.
 *
 * @param {string} content - raw test-file contents
 * @param {string} testFile - file label used in error messages
 * @returns {{block: string, sourceFile: string}} the copy block text and
 *   the source path named by the start marker
 * @throws {Error} when either marker is missing or out of order
 */
function getMarkerBlock(content, testFile) {
  const start = COPY_START_RE.exec(content);
  const end = COPY_END_RE.exec(content);
  if (!start || !end || end.index <= start.index) {
    throw new Error(`${testFile}: verbatim-copy markers missing or malformed`);
  }
  const blockStart = start.index + start[0].length;
  return { block: content.slice(blockStart, end.index), sourceFile: start[1] };
}

/**
 * Auto-discover the copied top-level declarations inside a copy block.
 *
 * @param {string} strippedBlock - comment-stripped copy-block text
 * @returns {string[]} declaration names in order of appearance
 */
function discoverCopiedNames(strippedBlock) {
  const names = [];
  let m;
  TOP_LEVEL_DECL_RE.lastIndex = 0;
  while ((m = TOP_LEVEL_DECL_RE.exec(strippedBlock)) !== null) {
    names.push(m[1] || m[2]);
  }
  return names;
}

// ── Build the per-declaration check list at load time ──────────────────

const CHECKS = [];
for (const pair of PAIRS) {
  const content = readRepoFile(pair.testFile);
  let copyRegion;
  let defaultSource;
  let names;
  if (pair.copiedNames) {
    // No markers in this file — search the whole file; the explicit
    // name list keeps test-only helpers out of the comparison.
    copyRegion = stripComments(content);
    defaultSource = pair.sourceFile;
    names = pair.copiedNames;
  } else {
    const marker = getMarkerBlock(content, pair.testFile);
    copyRegion = stripComments(marker.block);
    defaultSource = marker.sourceFile;
    names = discoverCopiedNames(copyRegion);
  }
  for (const name of names) {
    const adaptation = (pair.adaptations && pair.adaptations[name]) || {};
    CHECKS.push({
      testFile: pair.testFile,
      name,
      copyRegion,
      sourceFile: adaptation.sourceFile || defaultSource,
      renames: adaptation.renames || [],
      patches: adaptation.patches || [],
    });
  }
}

// ── The drift checks themselves ─────────────────────────────────────────

test("verbatimSync: discovery found the full copied-declaration inventory", () => {
  assert.equal(
    CHECKS.length,
    EXPECTED_CHECK_COUNT,
    `expected ${EXPECTED_CHECK_COUNT} copied declarations across the six test files, `
      + `found ${CHECKS.length} (${CHECKS.map((c) => c.name).join(", ")}) — `
      + "update EXPECTED_CHECK_COUNT if a copy was deliberately added/removed",
  );
});

for (const check of CHECKS) {
  test(`verbatimSync: ${check.testFile} :: ${check.name} matches ${check.sourceFile}`, () => {
    const copySnippet = extractDeclaration(check.copyRegion, check.name, check.testFile);
    const sourceCode = stripComments(readRepoFile(check.sourceFile));
    let sourceSnippet = extractDeclaration(sourceCode, check.name, check.sourceFile);
    for (const [re, replacement] of check.renames) {
      sourceSnippet = sourceSnippet.replace(re, replacement);
    }
    let normSource = normalizeJs(sourceSnippet);
    const normCopy = normalizeJs(copySnippet);
    for (const patch of check.patches) {
      normSource = normSource.split(normalizeJs(patch.find)).join(normalizeJs(patch.replace));
    }
    assert.equal(
      normCopy,
      normSource,
      `${check.testFile}: "${check.name}" copy out of sync — `
        + `resync ${check.testFile} from ${check.sourceFile}`,
    );
  });
}

// ── Harness self-checks ─────────────────────────────────────────────────
// The normalizer is the load-bearing part: it must equate the documented
// formatting adaptations while still telling apart a one-character body
// edit. Mutations are applied in memory only — never to the tree.

test("verbatimSync self-check: formatting-only variants normalize identically", () => {
  const sourceStyle = `export const f = (x) => {
  return x * 2; // doubled
};`;
  const copyStyle = "const f = (x) => x * 2;";
  assert.equal(normalizeJs(sourceStyle), normalizeJs(copyStyle));

  const elseChainSource = `export const g = (u) => {
  if (!u && u !== 0) {
    console.log("missing input!");
    return null;
  }
  if (u === "a") {
    return 1;
  } else if (u === "b") {
    return 2;
  } else {
    console.log("Missing / invalid target unit!", u);
    return null;
  }
};`;
  const elseChainCopy = `const g = (u) => {
  if (!u && u !== 0) return null;
  if (u === "a") return 1;
  if (u === "b") return 2;
  return null;
};`;
  assert.equal(normalizeJs(elseChainSource), normalizeJs(elseChainCopy));
});

test("verbatimSync self-check: a one-character body edit is caught", () => {
  assert.notEqual(
    normalizeJs("function f(c) { if (c >= 70) return \"high\"; }"),
    normalizeJs("function f(c) { if (c >= 71) return \"high\"; }"),
  );
  assert.notEqual(normalizeJs("const T = 70;"), normalizeJs("const T = 71;"));
});

test("verbatimSync self-check: in-memory mutation of a real copy is caught", () => {
  // Take a real extracted copy (severity from alertLogic.test.js) and
  // flip one character — the normalized forms must differ, proving the
  // pipeline doesn't erase content.
  const check = CHECKS.find((c) => c.name === "severity");
  assert.ok(check, "severity check missing from the inventory");
  const copySnippet = extractDeclaration(check.copyRegion, "severity", check.testFile);
  const mutated = copySnippet.replace("return 3", "return 4");
  assert.notEqual(mutated, copySnippet, "mutation target not found in the copy");
  assert.notEqual(normalizeJs(mutated), normalizeJs(copySnippet));
});
