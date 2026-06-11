// Regression tests for the CSV cell-quoting guard in
// `client/src/ui/exportDebugCsv.js` (q helper).
//
// Two concerns are locked down:
//   1. RFC 4180 quoting — embedded `"` doubled, cell wrapped in quotes.
//   2. Formula-injection guard (OWASP CSV injection) — cells starting
//      with a formula trigger get a leading `'` so spreadsheet apps
//      render them as text instead of evaluating them. `+`/`-` only
//      trigger when the cell is NOT a plain number, so negative
//      coordinates keep importing as numbers.
//
// Run: `npm test`

const { test } = require("node:test");
const assert = require("node:assert/strict");

// Same duplication pattern as `alertLogic.test.js` / `uiHybrid.test.js`
// — the helper is re-implemented here deps-free (the source module is
// ESM with DOM calls; the node test runner stays require-only). If
// `exportDebugCsv.js` drifts from this copy, update both.
const q = (val) => {
  let s = String(val ?? "");
  if (/^[=@\t\r]/.test(s)
    || (/^[+-]/.test(s) && !/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s))) {
    s = `'${s}`;
  }
  return `"${s.replace(/"/g, '""')}"`;
};

test("q: plain strings pass through quoted, unprefixed", () => {
  assert.equal(q("hello"), '"hello"');
  assert.equal(q(""), '""');
  assert.equal(q(null), '""');
  assert.equal(q(undefined), '""');
});

test("q: embedded double quotes are doubled (RFC 4180)", () => {
  assert.equal(q('say "hi"'), '"say ""hi"""');
});

test("q: formula triggers =, @, tab, CR get the apostrophe prefix", () => {
  assert.equal(q("=SUM(A1:A9)"), "\"'=SUM(A1:A9)\"");
  assert.equal(q("@cmd"), "\"'@cmd\"");
  assert.equal(q("\t=1+1"), "\"'\t=1+1\"");
  assert.equal(q("\r=1+1"), "\"'\r=1+1\"");
});

test("q: +/- prefix only when the cell is not a plain number", () => {
  // Attack shapes — prefixed.
  assert.equal(q("+cmd|' /C calc'!A0"), "\"'+cmd|' /C calc'!A0\"");
  assert.equal(q("-2+3+cmd"), "\"'-2+3+cmd\"");
  // Plain numbers — NOT prefixed, so Excel keeps them numeric.
  // Negative longitude is the live case (Sorel: -73.076935).
  assert.equal(q("-73.076935"), '"-73.076935"');
  assert.equal(q("+5"), '"+5"');
  assert.equal(q("-40"), '"-40"');
  assert.equal(q("-1.2e-3"), '"-1.2e-3"');
  assert.equal(q(-73.076935), '"-73.076935"');
});

test("q: formula attempt with embedded quotes gets both protections", () => {
  assert.equal(q('=HYPERLINK("http://evil","x")'),
    "\"'=HYPERLINK(\"\"http://evil\"\",\"\"x\"\")\"");
});
