// Regression tests for `moonLitPath()` in `client/src/ui/astronomy.js`.
// The helper produces the SVG `d` attribute that draws the LIT side of
// the moon at a given synodic phase fraction — driving the v3.1
// `MoonGlyph` component that replaced the platform-dependent Unicode
// emoji glyphs (Apple Color Emoji vs. Linux Noto Color Emoji rendered
// the same codepoints with different orientations on the Pi kiosk).
//
// Run: `npm test`.
//
// Same pattern as `test/conversions.test.js` / `test/alertParser.test.js`
// — the client source is ESM and Node's CJS loader can't `require()` it.
// Re-implement the helper verbatim so tests are self-contained; if the
// source drifts the tests fail loudly and remind us to sync.

const { test } = require("node:test");
const assert = require("node:assert/strict");

// ---------- start of verbatim copy from client/src/ui/astronomy.js ----------

function moonLitPath(fraction, cx, cy, r) {
  let f = Number.isFinite(fraction) ? fraction : 0;
  f = ((f % 1) + 1) % 1;
  const k = (1 - Math.cos(2 * Math.PI * f)) / 2;
  if (k < 0.005) return "";
  if (k > 0.995) {
    return `M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy} Z`;
  }
  const waxing = f < 0.5;
  const gibbous = k > 0.5;
  const txRaw = r * Math.abs(Math.cos(2 * Math.PI * f));
  const tx = txRaw < 1e-6 ? 0 : txRaw;
  const outerSweep = waxing ? 1 : 0;
  const innerSweep = gibbous ? outerSweep : 1 - outerSweep;
  return `M ${cx} ${cy - r} A ${r} ${r} 0 0 ${outerSweep} ${cx} ${cy + r} A ${tx} ${r} 0 0 ${innerSweep} ${cx} ${cy - r} Z`;
}

// ---------- end of verbatim copy ----------

// Reference SVG coordinates the MoonGlyph component uses: a 20×20
// viewBox with a disc of radius 9 centred at (10, 10). Tests use the
// same so the expected strings match what the renderer outputs.
const CX = 10, CY = 10, R = 9;

test("moonLitPath: new moon → empty path (no lit area to draw)", () => {
  // Exactly at the synodic boundary the illumination is ~0 → return
  // an empty string so the SVG component renders only the dark disc.
  assert.equal(moonLitPath(0, CX, CY, R), "");
});

test("moonLitPath: near-new-moon (illumination < 0.5 %) → still empty", () => {
  // The 0.005 threshold guards against rendering an effectively-
  // invisible sliver at very small phase fractions. Use 0.005 of a
  // synodic cycle (~3.5 hours after new moon) — illumination
  // ≈ (1 - cos(2π × 0.005)) / 2 ≈ 0.00049 < 0.005 → empty.
  assert.equal(moonLitPath(0.001, CX, CY, R), "");
});

test("moonLitPath: full moon → closed double-arc circle (entire disc lit)", () => {
  // At fraction 0.5 the illumination is 1. The path returned must be
  // a closed shape that fills the whole disc; we build it from two
  // semicircular arcs so the React renderer paints a single closed
  // path identical to the `<circle r="9" />` underneath. Lock the
  // exact string so regressions show up immediately.
  assert.equal(
    moonLitPath(0.5, CX, CY, R),
    "M 1 10 A 9 9 0 1 1 19 10 A 9 9 0 1 1 1 10 Z",
  );
});

test("moonLitPath: near-full-moon (illumination > 99.5 %) → uses the full-disc shape", () => {
  // Symmetric threshold to the new-moon empty path. Anything within
  // 0.5 % of full collapses to the cleaner two-arc shape rather than
  // a near-degenerate ellipse that could render imperceptibly differently.
  const out = moonLitPath(0.499, CX, CY, R);
  assert.match(out, /^M 1 10 A 9 9 0 1 1 19 10/, "near-full should snap to full-disc path");
});

test("moonLitPath: first quarter → right semicircle (NH waxing convention)", () => {
  // Fraction 0.25 = first quarter. The terminator is a straight
  // vertical line (tx = 0). The lit area is the RIGHT half of the
  // disc. Outer sweep = 1 (CW from top to bottom along the right
  // edge), inner sweep = 0 (the degenerate ellipse goes back up).
  const out = moonLitPath(0.25, CX, CY, R);
  assert.ok(out.startsWith("M 10 1 A 9 9 0 0 1 10 19"), "outer arc should be the right semicircle");
  assert.ok(/A 0 9 0 0 0 10 1/.test(out), "inner arc should be a degenerate straight ellipse");
});

test("moonLitPath: last quarter → left semicircle (NH waning convention)", () => {
  // Fraction 0.75 = last quarter. Mirror of first quarter — lit on
  // the LEFT (`outerSweep = 0` traces the left edge CCW from top to
  // bottom in SVG's Y-down coords).
  const out = moonLitPath(0.75, CX, CY, R);
  assert.ok(out.startsWith("M 10 1 A 9 9 0 0 0 10 19"), "outer arc should be the left semicircle");
});

test("moonLitPath: waxing crescent → terminator bulges into the lit area (inner sweep ≠ outer)", () => {
  // Fraction 0.125 = waxing crescent (illumination ≈ 0.146, less
  // than 0.5). For NH waxing, outer sweep = 1; for a crescent
  // (k < 0.5), inner sweep is OPPOSITE so the ellipse bulges
  // toward the lit side and the resulting path is a thin sliver
  // on the right side of the disc.
  const out = moonLitPath(0.125, CX, CY, R);
  assert.ok(/A 9 9 0 0 1 10 19/.test(out), "outer right semicircle (sweep=1)");
  // Inner ellipse: rx ≈ 9 × |cos(π/4)| ≈ 6.36
  assert.ok(/A [56]\.\d+ 9 0 0 0 10 1/.test(out), "inner ellipse with sweep=0 (opposite outer)");
});

test("moonLitPath: waxing gibbous → terminator bulges AWAY from lit (inner sweep == outer)", () => {
  // Fraction 0.375 = waxing gibbous (illumination ≈ 0.854 > 0.5).
  // Same outer sweep as the crescent above (still NH waxing), but
  // inner sweep MATCHES outer so the ellipse bulges OUTWARD into
  // the dark side — the lit area now spans most of the disc.
  const out = moonLitPath(0.375, CX, CY, R);
  assert.ok(/A 9 9 0 0 1 10 19/.test(out), "outer right semicircle (sweep=1, same as crescent)");
  assert.ok(/A [56]\.\d+ 9 0 0 1 10 1/.test(out), "inner ellipse with sweep=1 (matches outer)");
});

test("moonLitPath: waning crescent → mirror of waxing crescent", () => {
  // Fraction 0.875 = waning crescent. Outer sweep = 0 (left
  // semicircle), inner sweep = 1 (opposite). Thin lit sliver on
  // the LEFT side of the disc.
  const out = moonLitPath(0.875, CX, CY, R);
  assert.ok(/A 9 9 0 0 0 10 19/.test(out), "outer left semicircle (sweep=0)");
  assert.ok(/A [56]\.\d+ 9 0 0 1 10 1/.test(out), "inner ellipse with sweep=1 (opposite outer)");
});

test("moonLitPath: terminator width tracks the cosine", () => {
  // The horizontal radius of the terminator ellipse should be
  // `r × |cos(2π × fraction)|`. At fraction 0.1 (early waxing
  // crescent), tx = 9 × cos(0.2π) ≈ 9 × 0.809 ≈ 7.28.
  // Match the INNER A only by anchoring on the trailing ` Z` — the
  // outer arc ends at `10 19` (cy+r), the inner ends at `10 1` (cy-r)
  // immediately followed by the path-close `Z`.
  const out = moonLitPath(0.1, CX, CY, R);
  const m = out.match(/A ([\d.]+) 9 0 0 \d 10 1 Z$/);
  assert.ok(m, "should have an inner ellipse arc terminating the path");
  const tx = parseFloat(m[1]);
  assert.ok(Math.abs(tx - 7.28) < 0.05, `terminator rx should be ~7.28 (got ${tx})`);
});

test("moonLitPath: non-finite input wraps safely", () => {
  // Robustness — a caller passing NaN / undefined / Infinity should
  // get the new-moon shape (empty string), not an exception.
  assert.equal(moonLitPath(NaN, CX, CY, R), "");
  assert.equal(moonLitPath(undefined, CX, CY, R), "");
  assert.equal(moonLitPath(Infinity, CX, CY, R), "");
});

test("moonLitPath: fractions outside [0, 1) wrap modulo 1", () => {
  // Synodic phase wraps every cycle — 1.5 is functionally the same
  // as 0.5 (full moon). Negative fractions (timezone math edge cases)
  // wrap forward.
  assert.equal(moonLitPath(1.5, CX, CY, R), moonLitPath(0.5, CX, CY, R));
  assert.equal(moonLitPath(-0.25, CX, CY, R), moonLitPath(0.75, CX, CY, R));
});
