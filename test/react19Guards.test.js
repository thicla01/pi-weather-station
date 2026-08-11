// Locks in the two silent React 19 regressions the 2026-08 migration fixed
// (background: docs/react19-migration-handoff.md). Both fail with ZERO
// build-time or lint signal — the prod build is byte-identically green with
// or without them — so a mechanical text-level guard is the only cheap
// tripwire:
//
//  1. `X.defaultProps = {…}` on a function component is silently IGNORED by
//     React 19's automatic JSX runtime (the only element path this client
//     compiles to — .babelrc pins `runtime: "automatic"` and there is no
//     React.createElement in src): props arrive `undefined` with no warning
//     in any build. Any reappearance is dead code at best, a silent bug at
//     worst — use destructuring defaults in the signature instead, with a
//     module-scope constant for array/object defaults so the reference stays
//     stable across renders (see NO_ALERTS in WeatherMap/index.js).
//
//  2. A react-transition-group component without `nodeRef` falls back to
//     ReactDOM.findDOMNode, which React 19 removed — the resulting throw
//     unmounts the entire React root (there is no error boundary above App):
//     blank kiosk until reload.
//
// Same spirit as verbatimSync.test.js: mechanical, text-level, loud.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC_DIR = path.join(__dirname, "..", "client", "src");

/**
 * Recursively collect every .js file under a directory.
 *
 * @param {string} dir directory to walk
 * @returns {string[]} absolute paths of the .js files found
 */
const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(p);
    return p.endsWith(".js") ? [p] : [];
  });

test("no defaultProps assignment reappears in client/src", () => {
  const offenders = walk(SRC_DIR).filter((f) =>
    /\.defaultProps\s*=/.test(fs.readFileSync(f, "utf8"))
  );
  assert.deepEqual(
    offenders.map((f) => path.relative(SRC_DIR, f)),
    [],
    "React 19's automatic JSX runtime silently ignores defaultProps — use destructuring defaults in the signature"
  );
});

test("every react-transition-group consumer passes nodeRef", () => {
  const missing = walk(SRC_DIR).filter((f) => {
    const src = fs.readFileSync(f, "utf8");
    return src.includes("react-transition-group") && !src.includes("nodeRef");
  });
  assert.deepEqual(
    missing.map((f) => path.relative(SRC_DIR, f)),
    [],
    "without nodeRef, react-transition-group calls the removed findDOMNode and the throw unmounts the whole root"
  );
});
