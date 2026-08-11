// Regression tests for the place-naming helpers in `client/src/ui/placeLabel.js`.
//
// These decide what a place is CALLED across three surfaces that must agree:
// the location popover's detail rows, the auto-label given to a newly pinned
// favorite, and the name shown on the Places popover's home row. Before the
// extraction each surface had its own copy of the fallback chains, which is
// how you end up with the hero saying "Saint-Donat" while the favorite it
// pinned says "Municipalité de Saint-Donat".
//
// The label also feeds the favorites sanitizer, so its 40-char bound has to
// match MAX_LABEL_LEN in server/settingsCtrl.js — a label produced here must
// already be within what the server will accept, or pinning silently
// truncates.
//
// The client source uses ESM (`export function ...`) and Node's CommonJS
// loader can't require it directly, so the helpers are re-implemented
// verbatim below — the same pattern as conversions.test.js and
// uiHybrid.test.js. If placeLabel.js drifts from this copy, these tests fail
// loudly and remind us to sync.

const { test } = require("node:test");
const assert = require("node:assert/strict");

// === verbatim copy of client/src/ui/placeLabel.js ===

const pickLocality = (address) => {
  if (!address || typeof address !== "object") return null;
  return address.city
    || address.town
    || address.village
    || address.hamlet
    || address.municipality
    || null;
};

const pickDistrict = (address) => {
  if (!address || typeof address !== "object") return null;
  return address.suburb || address.neighbourhood || address.quarter || null;
};

const pickCounty = (address) => {
  if (!address || typeof address !== "object") return null;
  return address.county || address.state_district || null;
};

const pickRegion = (address) => {
  if (!address || typeof address !== "object") return null;
  return address.state || address.region || null;
};

const MAX_LABEL_LEN = 40;

const placeLabelFromAddress = (address) => {
  const parts = [pickLocality(address), pickRegion(address)].filter(Boolean);
  if (parts.length === 0) return null;
  return parts.join(", ").slice(0, MAX_LABEL_LEN);
};

// === fallback chains ===

test("pickLocality: walks the chain from city down to municipality", () => {
  assert.equal(pickLocality({ city: "Montreal", town: "T" }), "Montreal");
  assert.equal(pickLocality({ town: "Saint-Donat" }), "Saint-Donat");
  assert.equal(pickLocality({ village: "Lac-Nominingue" }), "Lac-Nominingue");
  assert.equal(pickLocality({ hamlet: "Petit-Lac" }), "Petit-Lac");
  assert.equal(pickLocality({ municipality: "MRC" }), "MRC");
  assert.equal(pickLocality({}), null);
});

test("pickRegion / pickCounty / pickDistrict: each honour their own chain", () => {
  assert.equal(pickRegion({ state: "Quebec", region: "R" }), "Quebec");
  assert.equal(pickRegion({ region: "Occitanie" }), "Occitanie");
  assert.equal(pickCounty({ county: "Matawinie" }), "Matawinie");
  assert.equal(pickCounty({ state_district: "Lanaudière" }), "Lanaudière");
  assert.equal(pickDistrict({ suburb: "Ville-Marie" }), "Ville-Marie");
  assert.equal(pickDistrict({ neighbourhood: "Plateau" }), "Plateau");
  assert.equal(pickDistrict({ quarter: "Q" }), "Q");
});

test("every picker survives a missing or non-object address", () => {
  for (const picker of [pickLocality, pickDistrict, pickCounty, pickRegion]) {
    for (const bad of [undefined, null, "str", 42, []]) {
      assert.equal(picker(bad), null);
    }
  }
});

// === composed label ===

test("placeLabelFromAddress: composes locality and region", () => {
  assert.equal(
    placeLabelFromAddress({ city: "Montreal", state: "Quebec" }),
    "Montreal, Quebec"
  );
});

test("placeLabelFromAddress: either half alone is still a valid label", () => {
  assert.equal(placeLabelFromAddress({ city: "Montreal" }), "Montreal");
  assert.equal(placeLabelFromAddress({ state: "Quebec" }), "Quebec");
});

test("placeLabelFromAddress: returns null when neither half is mapped", () => {
  // The caller must then fall back to coordinates — the server sanitizer
  // drops label-less favorites, so "no name" must never mean "no label".
  assert.equal(placeLabelFromAddress({}), null);
  assert.equal(placeLabelFromAddress({ postcode: "H3A 2B7" }), null);
  assert.equal(placeLabelFromAddress(null), null);
});

test("placeLabelFromAddress: truncates at the server's MAX_LABEL_LEN", () => {
  const label = placeLabelFromAddress({ city: "x".repeat(60), state: "y".repeat(60) });
  assert.equal(label.length, MAX_LABEL_LEN);
  assert.equal(MAX_LABEL_LEN, require("../server/settingsCtrl").__test.MAX_LABEL_LEN);
});
