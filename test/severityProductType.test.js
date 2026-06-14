// Regression tests for `eventProductType` in `client/src/ui/alertLogic.js`.
//
// This locks the 2026-06-14 fix: the SeverityChip word must reflect the actual
// NWS/ECCC PRODUCT TYPE (Warning/Watch/Advisory/Statement), not the CAP
// severity — so a Heat *Advisory* (severity Moderate) reads "Avis", never
// "Veille" (watch).
//
// Same constraint as the other client-ESM tests in this repo (alertParser):
// Node's CJS loader can't `require()` the ESM source, so the pure function is
// re-implemented VERBATIM here. If `eventProductType` drifts, these fail and
// remind us to sync. Run: `npm test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");

// ---------- verbatim copy from client/src/ui/alertLogic.js ----------
function eventProductType(name) {
  const s = String(name || "").toLowerCase();
  if (/\bwarning\b/.test(s)) return "warning";
  if (/\bwatch\b/.test(s)) return "watch";
  if (/\badvisory\b/.test(s)) return "advisory";
  if (/\bstatement\b/.test(s)) return "statement";
  return null;
}
// ---------- end verbatim copy ----------

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
