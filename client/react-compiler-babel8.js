// Babel 8 compatibility shim for babel-plugin-react-compiler (used from
// .babelrc in place of the bare plugin; same options, passed through).
//
// Babel 8 removed `AssignmentPattern` and `RestElement` from the `LVal`
// alias (babel/babel#17387, "Remove AssignmentPattern and RestElement from
// the LVal alias" in the v8 API migration guide), so `path.isLVal()` is now
// false for the `a = 1` in `{ a = 1 }`. The compiler (1.0.0, and every
// experimental build through 2026-05) was written against Babel 7 and asks
// `isLVal()` before lowering a destructuring target: under Babel 8 every
// component or hook with a default value in an object pattern — the
// signature defaults CLAUDE.md asks for in place of `defaultProps` — threw
// "(BuildHIR::lowerAssignment) Expected object property value to be an
// LVal, got: AssignmentPattern" and, under the default panicThreshold, was
// left UNcompiled without a word: 25 functions in 21 files, never compiled
// since the compiler was enabled (PR 318, on top of the Babel 8 migration of
// PR 287). With the shim, the compiler's output under Babel 8 is the one it
// gives under Babel 7, file for file.
//
// The shim gives `NodePath#isLVal()` its Babel 7 meaning back for the
// duration of the compiler's own pass, and only then: the compiler does all
// of its work synchronously inside its `Program.enter`, so the override is
// installed on entry and removed in `finally`, before any other plugin's
// visitor runs. Nothing else in the build sees it. Under Babel 7 (where
// `isLVal()` already accepts both node types) it is a pass-through.
//
// Remove it once the compiler handles Babel 8's `LVal` itself: delete this
// file, point .babelrc back at "babel-plugin-react-compiler", and run
// `npm run prod` — with `panicThreshold: "all_errors"` (.babelrc) any
// default-valued destructuring the compiler still can't lower fails the
// build instead of shipping uncompiled. test/reactCompilerGuards.test.js
// pins this file in .babelrc, so update it in the same change.

"use strict";

const compilerModule = require("babel-plugin-react-compiler");

const reactCompiler = compilerModule.default || compilerModule;

/**
 * True when this Babel's `LVal` alias leaves out `AssignmentPattern` (Babel 8).
 *
 * @param {object} t - the `@babel/types` API Babel hands the plugin
 * @returns {boolean} whether the compiler needs the Babel 7 `isLVal()`
 */
function lvalExcludesPatterns(t) {
  const pattern = t.assignmentPattern(t.identifier("a"), t.numericLiteral(1));
  return !t.isLVal(pattern);
}

/**
 * Runs `fn` with `NodePath#isLVal()` widened to Babel 7's alias
 * (`LVal` ∪ `AssignmentPattern` ∪ `RestElement`), then restores it.
 *
 * @param {object} path - any NodePath (its prototype is the shared NodePath one)
 * @param {() => (object|undefined)} fn - the work to run under the Babel 7 meaning
 * @returns {object|undefined} whatever `fn` returns
 */
function withBabel7IsLVal(path, fn) {
  // Walk up to the prototype that owns isLVal (NodePath.prototype).
  let proto = Object.getPrototypeOf(path);
  while (proto && !Object.prototype.hasOwnProperty.call(proto, "isLVal")) {
    proto = Object.getPrototypeOf(proto);
  }
  if (!proto) {
    throw new Error("react-compiler-babel8: NodePath#isLVal not found — the shim no longer matches this Babel");
  }
  const babel8IsLVal = proto.isLVal;
  proto.isLVal = function isLValBabel7(opts) {
    return babel8IsLVal.call(this, opts) || this.isAssignmentPattern(opts) || this.isRestElement(opts);
  };
  try {
    return fn();
  } finally {
    proto.isLVal = babel8IsLVal;
  }
}

/**
 * Babel plugin: babel-plugin-react-compiler, with its pass run under the
 * Babel 7 `isLVal()` when the host Babel is 8.
 *
 * @param {object} api - Babel plugin API
 * @param {object} options - React Compiler options (passed through untouched)
 * @param {string} dirname - config dirname
 * @returns {object} the compiler's plugin object, Program.enter wrapped
 */
module.exports = function reactCompilerBabel8(api, options, dirname) {
  const plugin = reactCompiler(api, options, dirname);
  if (!lvalExcludesPatterns(api.types)) return plugin;

  const program = plugin.visitor && plugin.visitor.Program;
  if (!program || typeof program.enter !== "function") {
    throw new Error("react-compiler-babel8: the compiler no longer exposes visitor.Program.enter — revisit the shim");
  }
  const { enter } = program;
  return {
    ...plugin,
    visitor: {
      ...plugin.visitor,
      Program: {
        ...program,
        enter(path, state) {
          return withBabel7IsLVal(path, () => enter.call(this, path, state));
        },
      },
    },
  };
};
