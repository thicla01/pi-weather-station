// Regression tests for `eventProductType` and `chipProductType` in
// `client/src/ui/alertLogic.js`.
//
// This locks the 2026-06-14 fix: the SeverityChip word must reflect the actual
// NWS/ECCC PRODUCT TYPE (Warning/Watch/Advisory/Statement), not the CAP
// severity — so a Heat *Advisory* (severity Moderate) reads "Avis", never
// "Veille" (watch). `chipProductType` (2026-10) is the word the chip prints,
// parsed or severity-derived; the French titles beside the chip drop that
// same word (test/alertTitle.test.js).
//
// Same constraint as the other client-ESM tests in this repo (alertParser):
// Node's CJS loader can't `require()` the ESM source, so the pure functions are
// re-implemented VERBATIM here. The copy is registered in
// test/verbatimSync.test.js, which fails on any drift from the source (not
// only drift that changes a behaviour asserted below) — resync this block from
// alertLogic.js when it does. Run: `npm test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");

// ---------- start of verbatim copy from client/src/ui/alertLogic.js ----------
function eventProductType(name) {
  const s = String(name || "").toLowerCase();
  if (/\bwarning\b/.test(s)) return "warning";
  if (/\bwatch\b/.test(s)) return "watch";
  if (/\badvisory\b/.test(s)) return "advisory";
  if (/\bstatement\b/.test(s)) return "statement";
  return null;
}

function severityFallbackWord(severity) {
  switch (severity) {
    case "minor":    return "advisory";
    case "moderate": return "watch";
    case "severe":   return "warning";
    case "extreme":  return "warning";
    default:         return "advisory";
  }
}

function chipProductType(eventName, severity) {
  return eventProductType(eventName) || severityFallbackWord(severity);
}
// ---------- end of verbatim copy ----------

test("eventProductType: NWS English event names", () => {
  // THE bug: a Heat Advisory is an advisory, never a watch.
  assert.equal(eventProductType("Heat Advisory"), "advisory");
  assert.equal(eventProductType("Flood Watch"), "watch");
  assert.equal(eventProductType("Severe Thunderstorm Warning"), "warning");
  assert.equal(eventProductType("Tornado Watch"), "watch");
  assert.equal(eventProductType("Special Weather Statement"), "statement");
  assert.equal(eventProductType("Wind Advisory"), "advisory");
});

test("eventProductType: ECCC English names (lowercased product word)", () => {
  assert.equal(eventProductType("Wind warning"), "warning");
  assert.equal(eventProductType("Snow squall watch"), "watch");
  assert.equal(eventProductType("Frost advisory"), "advisory");
  assert.equal(eventProductType("Special weather statement"), "statement");
});

test("eventProductType: precedence — Warning > Watch > Advisory > Statement", () => {
  // A name mentioning more than one product word resolves to the strongest.
  assert.equal(eventProductType("Severe Thunderstorm Warning (replaces Watch)"), "warning");
});

test("eventProductType: unrecognized / empty → null (caller falls back to severity word)", () => {
  assert.equal(eventProductType("Dense Fog"), null); // no product word
  assert.equal(eventProductType(""), null);
  assert.equal(eventProductType(null), null);
  assert.equal(eventProductType(undefined), null);
  // a bare ECCC slug with no product word
  assert.equal(eventProductType("heat"), null);
});

test("chipProductType: the parsed product type wins over severity", () => {
  // A moderate Frost advisory prints "Avis", not the moderate fallback "Veille".
  assert.equal(chipProductType("Frost advisory", "moderate"), "advisory");
  assert.equal(chipProductType("Freezing rain warning", "moderate"), "warning");
  assert.equal(chipProductType("Severe thunderstorm watch", "severe"), "watch");
  assert.equal(chipProductType("Special weather statement", "minor"), "statement");
});

test("chipProductType: no product word → severity-derived word", () => {
  assert.equal(chipProductType("heat", "minor"), "advisory");
  assert.equal(chipProductType("heat", "moderate"), "watch");
  assert.equal(chipProductType("heat", "severe"), "warning");
  assert.equal(chipProductType("heat", "extreme"), "warning");
  assert.equal(chipProductType("", "unknown"), "advisory");
  assert.equal(chipProductType(undefined, undefined), "advisory");
});
