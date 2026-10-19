// Locks in the React Compiler setup that turns a function the compiler
// can't handle into a build failure instead of a silent loss of memoisation.
//
// Background: under Babel 8, babel-plugin-react-compiler 1.0.0 couldn't lower
// a default value in a destructuring pattern (`({ a = 1 }) =>`, the signature
// defaults CLAUDE.md asks for in place of defaultProps). With the default
// panicThreshold ("none") every such component or hook was left uncompiled
// without a word — 25 functions, from the day the compiler was enabled
// (PR 318) until client/react-compiler-babel8.js restored Babel 7's `isLVal()`
// for the compiler's pass. The build itself is the guard now: with
// panicThreshold "all_errors" the compiler throws on the first function it
// can't compile, so `npm run prod` (and CI's client job) fails. This suite
// keeps that guard from being switched off quietly and the exceptions to it
// explicit:
//
//  1. client/.babelrc runs the compiler through ./react-compiler-babel8.js
//     with panicThreshold "all_errors".
//  2. Every "use no memo" opt-out in client/src sits under a comment that
//     starts "Not compiled:" and says why, and the set of opted-out functions
//     matches OPTED_OUT exactly. An opt-out is the one-line way past a build
//     failure, so adding one is a deliberate edit here; making a listed
//     function compile means striking it from the list.
//
// Same spirit as react19Guards.test.js: mechanical, text-level, loud.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CLIENT_DIR = path.join(__dirname, "..", "client");
const SRC_DIR = path.join(CLIENT_DIR, "src");
const SHIM = "./react-compiler-babel8.js";

// Functions opted out of the compiler with "use no memo": file (relative to
// client/src) → names of the functions, sorted. All seven predate the Babel 8
// shim and stay uncompiled exactly as before it; each reason is the comment
// above its directive (and ROADMAP › Technical debt).
const OPTED_OUT = {
  "components/ScreenSaver/index.js": ["ScreenSaver"],
  "components/WeatherMap/index.js": ["ZoomAnchorOffset"],
  "components/ambient/ChartTabs/index.js": ["ChartTabs"],
  "components/ambient/DebugPanel/index.js": ["DebugPanel", "RadarSnapshotsBlock"],
  "components/ambient/HealthIndicator/index.js": ["HealthIndicator"],
  "hooks/useUpdateChecker.js": ["useUpdateChecker"],
};

const DIRECTIVE_RE = /^\s*(["'])use no (memo|forget)\1;?\s*$/;
const COMMENT_RE = /^\s*\/\//;
const FN_NAME_RE = /(?:\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=|\bfunction\s+([A-Za-z_$][\w$]*)\s*\()/;

/**
 * Lists every .js/.jsx file under `dir`, recursively.
 *
 * @param {string} dir - directory to walk
 * @returns {string[]} absolute file paths
 */
function listSources(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSources(full));
    else if (/\.jsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Finds the "use no memo" / "use no forget" directives in client/src, with the
 * comment block above each and the function it opens.
 *
 * @returns {{file: string, line: number, name: string|null, comment: string[]}[]} one per directive
 */
function findOptOuts() {
  const found = [];
  for (const abs of listSources(SRC_DIR)) {
    const file = path.relative(SRC_DIR, abs).split(path.sep).join("/");
    const lines = fs.readFileSync(abs, "utf8").split("\n");
    lines.forEach((text, i) => {
      if (!DIRECTIVE_RE.test(text)) return;
      let start = i;
      while (start > 0 && COMMENT_RE.test(lines[start - 1])) start -= 1;
      const comment = lines.slice(start, i).map((l) => l.trim());
      const opener = start > 0 ? lines[start - 1].match(FN_NAME_RE) : null;
      found.push({ file, line: i + 1, name: opener ? opener[1] || opener[2] : null, comment });
    });
  }
  return found;
}

test("client/.babelrc runs the React Compiler through the Babel 8 shim with panicThreshold all_errors", () => {
  const babelrc = JSON.parse(fs.readFileSync(path.join(CLIENT_DIR, ".babelrc"), "utf8"));
  const entries = (babelrc.plugins || []).map((p) => (Array.isArray(p) ? p : [p, {}]));
  const bare = entries.filter(([name]) => name === "babel-plugin-react-compiler" || name === "react-compiler");
  assert.deepEqual(
    bare.map(([name]) => name),
    [],
    `The compiler must go through ${SHIM}: under Babel 8 the bare plugin skips every default-valued destructuring (see the shim's header). Remove the shim only once the compiler handles Babel 8's LVal itself.`
  );
  const shimmed = entries.filter(([name]) => name === SHIM);
  assert.equal(shimmed.length, 1, `client/.babelrc must list ${SHIM} exactly once`);
  assert.ok(fs.existsSync(path.join(CLIENT_DIR, SHIM)), `${SHIM} is missing from client/`);
  const [, options] = shimmed[0];
  assert.equal(options.target, "19", "the compiler targets React 19 (its runtime ships in react@19)");
  assert.equal(
    options.panicThreshold,
    "all_errors",
    'panicThreshold must stay "all_errors": anything lower lets the compiler skip a function without failing the build — the silent bail-out this guard exists for. Opt a function out with "use no memo" instead (and list it in OPTED_OUT here).'
  );
});

test('every "use no memo" opt-out says why, and the opted-out functions match OPTED_OUT exactly', () => {
  const optOuts = findOptOuts();
  const unexplained = optOuts
    .filter((o) => !(o.comment.length > 0 && /^\/\/ Not compiled: \S/.test(o.comment[0])))
    .map((o) => `${o.file}:${o.line}`);
  assert.deepEqual(
    unexplained,
    [],
    'Put a comment block starting "// Not compiled: <reason>" right above each "use no memo" directive'
  );
  const unnamed = optOuts.filter((o) => !o.name).map((o) => `${o.file}:${o.line}`);
  assert.deepEqual(unnamed, [], 'A "use no memo" directive must open a named function (const X = … => { / function X(), not the module');

  const actual = {};
  for (const o of optOuts) (actual[o.file] = actual[o.file] || []).push(o.name);
  for (const names of Object.values(actual)) names.sort();
  assert.deepEqual(
    actual,
    OPTED_OUT,
    "The functions opted out of the React Compiler changed: adding an opt-out is a deliberate change (prefer making the function compile), and one that compiles again is struck from OPTED_OUT in this test"
  );
});
