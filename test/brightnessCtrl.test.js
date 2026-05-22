// Regression tests for `server/brightnessCtrl.js`.
//
// Today's coverage focuses on `edDdcParsePercent` — the only pure
// helper in the ed-ddc-server backend, and the one most likely to
// break if EDATEC ever changes the CLI output format. The format
// was confirmed on a Pi 5 + ED-MONITOR-156C (May 2026, EDATEC
// `ed-ddcci-mib-tool` 1.x): one line, `Backlight: [N]`, integer 0-100
// inside square brackets. We anchor the regex on that exact shape so
// neither incidental digits in unrelated logs nor a future verbose
// mode can produce a false positive.
//
// The two real-I/O halves of each backend (sysfs + ed-ddc-server
// read/write) are covered end-to-end by field testing on the actual
// hardware: the Pi 7" DSI for sysfs, the ED-MONITOR series for
// ed-ddc-server.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { __test } = require("../server/brightnessCtrl");
const { edDdcParsePercent } = __test;

// ─── Canonical format ──────────────────────────────────────────────

test("edDdcParsePercent: canonical 'Backlight: [N]' format — full brightness", () => {
  assert.equal(edDdcParsePercent("Backlight: [100]"), 100);
});

test("edDdcParsePercent: canonical format — half", () => {
  assert.equal(edDdcParsePercent("Backlight: [50]"), 50);
});

test("edDdcParsePercent: canonical format — minimum", () => {
  assert.equal(edDdcParsePercent("Backlight: [0]"), 0);
});

test("edDdcParsePercent: canonical format with trailing newline (as captured from execSync)", () => {
  assert.equal(edDdcParsePercent("Backlight: [75]\n"), 75);
});

test("edDdcParsePercent: canonical format with surrounding whitespace", () => {
  assert.equal(edDdcParsePercent("  Backlight: [42]  \n"), 42);
});

// ─── Format flexibility ────────────────────────────────────────────

test("edDdcParsePercent: tolerates extra whitespace between label and bracket", () => {
  assert.equal(edDdcParsePercent("Backlight:    [88]"), 88);
});

test("edDdcParsePercent: tolerates no whitespace between label and bracket", () => {
  assert.equal(edDdcParsePercent("Backlight:[33]"), 33);
});

test("edDdcParsePercent: picks the canonical reading even when prologue lines precede it", () => {
  // Defensive — if EDATEC ever adds a banner or warning line above
  // the value, the regex still finds it.
  const out = "i2c-1: opened\nBacklight: [60]\n";
  assert.equal(edDdcParsePercent(out), 60);
});

// ─── Out-of-band and malformed inputs ──────────────────────────────

test("edDdcParsePercent: out-of-range integer (101) → null", () => {
  assert.equal(edDdcParsePercent("Backlight: [101]"), null);
});

test("edDdcParsePercent: out-of-range integer (255 — common VCP max) → null", () => {
  // ddcutil-style tools sometimes report VCP code 0x10's raw value
  // (0-255). If a future build of ed-ddc-server ever leaks that, we
  // explicitly DON'T want to render it as a percent — better to
  // surface "unavailable" until the format is understood.
  assert.equal(edDdcParsePercent("Backlight: [255]"), null);
});

test("edDdcParsePercent: missing brackets → null (won't pick up bare numbers)", () => {
  assert.equal(edDdcParsePercent("Backlight: 50"), null);
});

test("edDdcParsePercent: i2c-bus name with digit doesn't trigger a false match", () => {
  // The earlier draft heuristic (first integer in [0,100]) was fooled
  // by the "2" in "i2c". Anchoring on the label + brackets eliminates
  // this class of bug entirely.
  assert.equal(edDdcParsePercent("opening /dev/i2c-1"), null);
});

test("edDdcParsePercent: hex-addr-looking string → null", () => {
  // "0x42" — "0" is technically in [0, 100] but isn't a brightness reading.
  // The label anchor blocks this.
  assert.equal(edDdcParsePercent("addr: 0x42, status: ok"), null);
});

test("edDdcParsePercent: error string → null", () => {
  assert.equal(edDdcParsePercent("Error: no monitor"), null);
});

test("edDdcParsePercent: empty string → null", () => {
  assert.equal(edDdcParsePercent(""), null);
});

test("edDdcParsePercent: null input → null", () => {
  assert.equal(edDdcParsePercent(null), null);
});

test("edDdcParsePercent: undefined input → null", () => {
  assert.equal(edDdcParsePercent(undefined), null);
});

test("edDdcParsePercent: non-string input → null", () => {
  assert.equal(edDdcParsePercent(123), null);
});
