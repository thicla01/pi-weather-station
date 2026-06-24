// Regression tests for the kiosk display-scale override controller. Pure-
// function coverage of the four helpers exposed as `__test` on
// displayScaleCtrl: the browser.conf override parser, the detect-script
// diagnostic parser, the value validator, and the managed-line rewriter.
//
// Run: `npm test` (uses Node's built-in `node --test` runner, no deps).
//
// These encode the contract the Settings UI relies on: "auto" is the
// absence of a line; only clean quarters in (1, 2] are accepted; the
// rewrite preserves every other browser.conf line.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { __test } = require("../server/displayScaleCtrl");
const { parseOverrideLine, parseDetectDiag, validateScale, rewriteBrowserConf } = __test;

// ───────────────────────────────────────────────────────────────────────
// parseOverrideLine — read DISPLAY_SCALE out of browser.conf
// ───────────────────────────────────────────────────────────────────────

test("parseOverrideLine: no line / empty ⇒ auto", () => {
  assert.equal(parseOverrideLine(""), "auto");
  assert.equal(parseOverrideLine('BROWSER_CMD="chromium"\nBROWSER_FAMILY="chromium"\n'), "auto");
  assert.equal(parseOverrideLine(null), "auto");
});

test("parseOverrideLine: bare, quoted, and single-quoted values", () => {
  assert.equal(parseOverrideLine("DISPLAY_SCALE=1.25"), "1.25");
  assert.equal(parseOverrideLine('DISPLAY_SCALE="1.25"'), "1.25");
  assert.equal(parseOverrideLine("DISPLAY_SCALE='off'"), "off");
});

test("parseOverrideLine: tolerates inline comment + surrounding whitespace", () => {
  assert.equal(parseOverrideLine('DISPLAY_SCALE="1.5"   # set via Settings UI'), "1.5");
  assert.equal(parseOverrideLine("  DISPLAY_SCALE = off  "), "off");
});

test("parseOverrideLine: last assignment wins (matches shell source)", () => {
  const conf = 'DISPLAY_SCALE="1.25"\nBROWSER_CMD="firefox"\nDISPLAY_SCALE="off"\n';
  assert.equal(parseOverrideLine(conf), "off");
});

// ───────────────────────────────────────────────────────────────────────
// parseDetectDiag — pull PPI/raw from detect-display-scale.sh stderr
// ───────────────────────────────────────────────────────────────────────

test("parseDetectDiag: parses the no-scaling diagnostic line (the 133C case)", () => {
  const stderr = "detect-display-scale: source=wlr-randr geom='350x190 1920x1080'\n"
    + "detect-display-scale: PPI=141 raw=1.081 -> 1.0 (no scaling needed)\n";
  assert.deepEqual(parseDetectDiag(stderr), { ppi: 141, raw: 1.081 });
});

test("parseDetectDiag: parses the scaling diagnostic line", () => {
  const stderr = "detect-display-scale: PPI=151 raw=1.162 -> scale 1.25\n";
  assert.deepEqual(parseDetectDiag(stderr), { ppi: 151, raw: 1.162 });
});

test("parseDetectDiag: no match / garbage ⇒ null", () => {
  assert.equal(parseDetectDiag("no geometry available -> no scaling"), null);
  assert.equal(parseDetectDiag(""), null);
  assert.equal(parseDetectDiag(undefined), null);
});

// ───────────────────────────────────────────────────────────────────────
// validateScale — gate the POST body
// ───────────────────────────────────────────────────────────────────────

test("validateScale: accepts auto/off verbatim", () => {
  assert.equal(validateScale("auto"), "auto");
  assert.equal(validateScale("off"), "off");
});

test("validateScale: accepts clean quarters, normalized", () => {
  assert.equal(validateScale("1.25"), "1.25");
  assert.equal(validateScale("1.5"), "1.5");
  assert.equal(validateScale("1.50"), "1.5");
  assert.equal(validateScale("2"), "2");
  assert.equal(validateScale("2.0"), "2");
  assert.equal(validateScale(1.75), "1.75");
});

test("validateScale: rejects non-quarters, ≤1, >MAX, and junk", () => {
  assert.equal(validateScale("1.3"), null);   // not a quarter
  assert.equal(validateScale("1"), null);     // ≤ 1 (use "off")
  assert.equal(validateScale("0.5"), null);   // never shrinks
  assert.equal(validateScale("2.25"), null);  // above the 2.0 UI ceiling
  assert.equal(validateScale("4"), null);
  assert.equal(validateScale("big"), null);
  assert.equal(validateScale(undefined), null);
});

// ───────────────────────────────────────────────────────────────────────
// rewriteBrowserConf — managed DISPLAY_SCALE line, preserve the rest
// ───────────────────────────────────────────────────────────────────────

const BASE = 'BROWSER_CMD="chromium"\nBROWSER_FAMILY="chromium"\n';

test("rewriteBrowserConf: adds the line when absent, preserves others", () => {
  const out = rewriteBrowserConf(BASE, "1.25");
  assert.match(out, /BROWSER_CMD="chromium"/);
  assert.match(out, /BROWSER_FAMILY="chromium"/);
  assert.match(out, /^DISPLAY_SCALE="1\.25"/m);
});

test("rewriteBrowserConf: replaces an existing line (no duplication)", () => {
  const withScale = `${BASE}DISPLAY_SCALE="1.5"\n`;
  const out = rewriteBrowserConf(withScale, "2");
  const hits = out.split("\n").filter((l) => /^\s*DISPLAY_SCALE\s*=/.test(l));
  assert.equal(hits.length, 1);
  assert.match(out, /^DISPLAY_SCALE="2"/m);
});

test("rewriteBrowserConf: 'auto' removes the line entirely", () => {
  const withScale = `${BASE}DISPLAY_SCALE="1.25"   # set via Settings UI\n`;
  const out = rewriteBrowserConf(withScale, "auto");
  assert.equal(/DISPLAY_SCALE/.test(out), false);
  assert.match(out, /BROWSER_CMD="chromium"/);
});

test("rewriteBrowserConf: idempotent for a repeated same-value write", () => {
  const once = rewriteBrowserConf(BASE, "1.25");
  const twice = rewriteBrowserConf(once, "1.25");
  assert.equal(once, twice);
});
