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
//     with exactly COMPILER_OPTIONS (panicThreshold "all_errors", and closure
//     dependencies treated as conditional, see below), and nothing else
//     configures Babel for client/src: no `env` / `overrides` block, no other
//     config file, no babel-loader options in webpack.config.js, no "babel"
//     key in client/package.json. Any of those could switch the compiler off
//     or lower the threshold while this file still looked right.
//  2. Every "use no memo" opt-out in client/src sits under a comment that
//     starts "Not compiled:" and says why, and the set of opted-out functions
//     matches OPTED_OUT exactly. An opt-out is the one-line way past a build
//     failure, so adding one is a deliberate edit here; making a listed
//     function compile means striking it from the list. A directive this
//     test can't parse (a trailing comment, or on the function's opening
//     line) fails too: the compiler honours it all the same.
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
// client/src) → names of the functions, sorted. Empty: the seven opt-outs
// that predated the Babel 8 shim were rewritten to compile (a try/catch
// moved into a plain helper, a suppressed react-hooks rule fixed, a counter
// passed as an argument, the Leaflet zoom patch moved out of the
// component). Add an entry only with the reason above its directive, and a
// ROADMAP › Technical debt item to remove it.
const OPTED_OUT = {};

// The compiler options, whole. `environment.enableTreatFunctionDepsAsConditional`
// stops the compiler from reading, during render, a property that only a
// closure reads (it keys the cached closure on the object instead): left
// at its default, LocationDetailsPopover's cached pin handler read
// `mapGeo.latitude` while rendering and threw when mapGeo was null.
const COMPILER_OPTIONS = {
  target: "19",
  panicThreshold: "all_errors",
  environment: { enableTreatFunctionDepsAsConditional: true },
};

const DIRECTIVE_RE = /^\s*(["'])use no (memo|forget)\1;?\s*$/;
// Any mention of the directive in code, parsable or not.
const DIRECTIVE_ANYWHERE_RE = /(["'])use no (memo|forget)\1/;
const COMMENT_LINE_RE = /^\s*(\/\/|\/\*|\*)/;
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
 * @returns {{file: string, line: number, name: string|null, comment: string[], malformed?: boolean}[]}
 *   one per directive; `malformed` when the line holds more than the directive
 */
function findOptOuts() {
  const found = [];
  for (const abs of listSources(SRC_DIR)) {
    const file = path.relative(SRC_DIR, abs).split(path.sep).join("/");
    const lines = fs.readFileSync(abs, "utf8").split("\n");
    lines.forEach((text, i) => {
      if (!DIRECTIVE_RE.test(text)) {
        if (DIRECTIVE_ANYWHERE_RE.test(text) && !COMMENT_LINE_RE.test(text)) {
          found.push({ file, line: i + 1, name: null, comment: [], malformed: true });
        }
        return;
      }
      let start = i;
      while (start > 0 && COMMENT_RE.test(lines[start - 1])) start -= 1;
      const comment = lines.slice(start, i).map((l) => l.trim());
      const opener = start > 0 ? lines[start - 1].match(FN_NAME_RE) : null;
      found.push({ file, line: i + 1, name: opener ? opener[1] || opener[2] : null, comment });
    });
  }
  return found;
}

test("client/.babelrc runs the React Compiler through the Babel 8 shim with exactly COMPILER_OPTIONS", () => {
  const babelrc = JSON.parse(fs.readFileSync(path.join(CLIENT_DIR, ".babelrc"), "utf8"));
  assert.deepEqual(
    Object.keys(babelrc).sort(),
    ["plugins", "presets"],
    "client/.babelrc holds only `presets` and `plugins`: an `env` or `overrides` block can re-list the compiler with other options for one build"
  );
  const entries = babelrc.plugins.map((p) => (Array.isArray(p) ? p : [p, {}]));
  const bare = entries.filter(([name]) => name === "babel-plugin-react-compiler" || name === "react-compiler");
  assert.deepEqual(
    bare.map(([name]) => name),
    [],
    `The compiler must go through ${SHIM}: under Babel 8 the bare plugin skips every default-valued destructuring (see the shim's header). Remove the shim only once the compiler handles Babel 8's LVal itself.`
  );
  const shimmed = entries.filter(([name]) => name === SHIM);
  assert.equal(shimmed.length, 1, `client/.babelrc must list ${SHIM} exactly once`);
  assert.ok(fs.existsSync(path.join(CLIENT_DIR, SHIM)), `${SHIM} is missing from client/`);
  assert.match(
    fs.readFileSync(path.join(CLIENT_DIR, SHIM), "utf8"),
    /reactCompiler\(api, options, dirname\)/,
    "the shim must hand the compiler the options it receives, untouched"
  );
  const [, options] = shimmed[0];
  assert.deepEqual(
    options,
    COMPILER_OPTIONS,
    'The compiler options changed. panicThreshold must stay "all_errors" (anything lower lets the compiler skip a function without failing the build — the silent bail-out this guard exists for; opt a function out with "use no memo" instead), and an option such as compilationMode or sources can stop it compiling whole components without any error. Change COMPILER_OPTIONS here only on purpose.'
  );
});

test("nothing else configures Babel for client/src", () => {
  const strays = [];
  const walkConfigs = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walkConfigs(full);
      else if (/^(\.babelrc(\..+)?|babel\.config\..+)$/.test(entry.name)) strays.push(path.relative(CLIENT_DIR, full));
    }
  };
  walkConfigs(CLIENT_DIR);
  assert.deepEqual(strays, [".babelrc"], "client/.babelrc must be the only Babel config under client/ (a babel.config.* or a nested .babelrc merges with it)");
  const pkg = JSON.parse(fs.readFileSync(path.join(CLIENT_DIR, "package.json"), "utf8"));
  assert.equal(pkg.babel, undefined, 'client/package.json must not carry a "babel" key');
  const webpackConfig = fs.readFileSync(path.join(CLIENT_DIR, "webpack.config.js"), "utf8");
  assert.match(
    webpackConfig,
    /use:\s*{\s*loader:\s*"babel-loader",?\s*}/,
    "webpack.config.js must call babel-loader without options, so client/.babelrc alone configures the build"
  );
});

test('every "use no memo" opt-out says why, and the opted-out functions match OPTED_OUT exactly', () => {
  const all = findOptOuts();
  const malformed = all.filter((o) => o.malformed).map((o) => `${o.file}:${o.line}`);
  assert.deepEqual(
    malformed,
    [],
    'Write a "use no memo" directive alone on its line, as the first statement of the function body, with its "// Not compiled:" reason on the lines above (the compiler honours a directive followed by a comment, or on the opening line, but this test could not see it)'
  );
  const optOuts = all.filter((o) => !o.malformed);
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
