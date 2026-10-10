// Tests for `client/src/ui/alertTitle.js` — the French ECCC alert titles
// shortened beside a SeverityChip that already prints the product type
// (« Avertissement de pluie verglaçante » → « Pluie verglaçante » beside
// « AVERT. »). The module is CommonJS, so this runs the real code.
//
// The French titles below are ECCC `alert_name_fr` values as the server
// serves them (`capitalizeFirst` in server/govAlertSources/_shared.js):
// the ones measured on the 7" kiosk in October 2026 and ECCC's other
// names. Run: `npm test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  FR_PRODUCT_WORDS,
  shortAlertTitle,
} = require("../client/src/ui/alertTitle");

const FR = { lang: "fr" };

/**
 * Shorthand: shorten `title` for a French UI beside a chip printing
 * `productType`.
 *
 * @param {string} title alert title
 * @param {string} productType chip product type
 * @returns {string} the displayed title
 */
function fr(title, productType) {
  return shortAlertTitle(title, { ...FR, productType });
}

test("warnings measured on the kiosk lead with the hazard", () => {
  const cases = [
    ["Avertissement de pluie verglaçante", "Pluie verglaçante"],
    ["Avertissement de tempête hivernale", "Tempête hivernale"],
    ["Avertissement de tempête tropicale", "Tempête tropicale"],
    ["Avertissement de bourrasques de neige", "Bourrasques de neige"],
    ["Avertissement de submersion côtière", "Submersion côtière"],
    ["Avertissement d'orages violents", "Orages violents"],
    ["Avertissement de froid extrême", "Froid extrême"],
    ["Avertissement de poudrerie", "Poudrerie"],
    ["Avertissement de blizzard", "Blizzard"],
    ["Avertissement de chaleur", "Chaleur"],
    ["Avertissement de neige", "Neige"],
    ["Avertissement de pluie", "Pluie"],
    ["Avertissement de vent", "Vent"],
    ["Avertissement de tornade", "Tornade"],
    ["Avertissement d'ouragan", "Ouragan"],
  ];
  for (const [title, expected] of cases) {
    assert.equal(fr(title, "warning"), expected, title);
  }
});

test("the two storm warnings stay distinguishable", () => {
  // With two alerts the one-line Pi card cut both to « Avertissement de
  // tempête… »; the hazard-first forms differ from their first word on.
  assert.notEqual(
    fr("Avertissement de tempête hivernale", "warning"),
    fr("Avertissement de tempête tropicale", "warning"),
  );
});

test("watches and advisories", () => {
  assert.equal(fr("Veille de tempête hivernale", "watch"), "Tempête hivernale");
  assert.equal(fr("Veille d'orages violents", "watch"), "Orages violents");
  assert.equal(fr("Veille de tornade", "watch"), "Tornade");
  assert.equal(fr("Veille d'ouragan", "watch"), "Ouragan");
  assert.equal(fr("Veille de bourrasques de neige", "watch"), "Bourrasques de neige");
  assert.equal(fr("Avis de gel", "advisory"), "Gel");
  assert.equal(fr("Avis de brouillard", "advisory"), "Brouillard");
  assert.equal(fr("Avis de qualité de l'air", "advisory"), "Qualité de l'air");
});

test("elisions: straight and typographic apostrophes, an article kept", () => {
  assert.equal(fr("Avertissement d'orages violents", "warning"), "Orages violents");
  assert.equal(fr("Avertissement d’orages violents", "warning"), "Orages violents");
  assert.equal(fr("Veille d’orages violents", "watch"), "Orages violents");
  // An article after « de » belongs to the hazard and is capitalised.
  assert.equal(fr("Avertissement de l'ouragan Fiona", "warning"), "L'ouragan Fiona");
  assert.equal(fr("Avertissement de la tempête", "warning"), "La tempête");
  // Contractions of de + le / les.
  assert.equal(fr("Avertissement du suête", "warning"), "Suête");
  assert.equal(fr("Avertissement des vents du Wreckhouse", "warning"), "Vents du Wreckhouse");
  // « de » followed by a word that starts with « de » stays intact.
  assert.equal(fr("Avertissement de dépression tropicale", "warning"), "Dépression tropicale");
});

test("accented first letters are capitalised", () => {
  assert.equal(fr("Avertissement d'érosion côtière", "warning"), "Érosion côtière");
  assert.equal(fr("Avis d'épisode de smog", "advisory"), "Épisode de smog");
  assert.equal(fr("Veille d'éboulis", "watch"), "Éboulis");
  // Decomposed é (e + U+0301) upper-cases its base letter.
  assert.equal(fr("Avertissement d'érosion", "warning"), "Érosion");
});

test("upper- and lower-case titles match; extra spaces are trimmed", () => {
  // The server capitalises only the first letter; ECCC sends lower case.
  assert.equal(fr("avertissement de pluie verglaçante", "warning"), "Pluie verglaçante");
  assert.equal(fr("AVERTISSEMENT DE PLUIE", "warning"), "PLUIE");
  assert.equal(fr("  Avertissement  de   pluie verglaçante  ", "warning"), "Pluie verglaçante");
});

test("a regional suffix stays with the hazard", () => {
  assert.equal(
    fr("Veille d'orages violents — région de Montréal", "watch"),
    "Orages violents — région de Montréal",
  );
});

test("a title naming another product type than the chip stays whole", () => {
  // Stripping would hide that the title contradicts the chip.
  assert.equal(fr("Avertissement de pluie verglaçante", "watch"), "Avertissement de pluie verglaçante");
  assert.equal(fr("Veille de tempête hivernale", "warning"), "Veille de tempête hivernale");
  assert.equal(fr("Avis de gel", "warning"), "Avis de gel");
  assert.equal(fr("Avertissement de vent", "advisory"), "Avertissement de vent");
});

test("no chip word, no stripping", () => {
  // Icon-only chip, or no chip: the prefix is the only product word shown.
  assert.equal(shortAlertTitle("Avertissement de pluie verglaçante", FR), "Avertissement de pluie verglaçante");
  assert.equal(fr("Avertissement de pluie verglaçante", null), "Avertissement de pluie verglaçante");
  assert.equal(fr("Avertissement de pluie verglaçante", ""), "Avertissement de pluie verglaçante");
  assert.equal(fr("Avertissement de pluie verglaçante", "emergency"), "Avertissement de pluie verglaçante");
  // Object.prototype keys are not product types.
  assert.equal(fr("Avertissement de pluie", "constructor"), "Avertissement de pluie");
  assert.equal(fr("Avertissement de pluie", "toString"), "Avertissement de pluie");
});

test("titles without the « <type> de … » pattern stay whole", () => {
  assert.equal(fr("Bulletin météorologique spécial", "statement"), "Bulletin météorologique spécial");
  assert.equal(fr("Bulletin spécial sur la qualité de l'air", "statement"), "Bulletin spécial sur la qualité de l'air");
  assert.equal(fr("Déclaration de tempête", "warning"), "Déclaration de tempête");
  assert.equal(fr("Avertissement météorologique", "warning"), "Avertissement météorologique");
  // The product word must be a whole word followed by a space.
  assert.equal(fr("Avisé de gel", "advisory"), "Avisé de gel");
  assert.equal(fr("Avertissementde pluie", "warning"), "Avertissementde pluie");
  assert.equal(fr("Avertissement dense", "warning"), "Avertissement dense");
  assert.equal(fr("Avertissement durable", "warning"), "Avertissement durable");
  // The word must open the title.
  assert.equal(fr("Nouvel avertissement de pluie", "warning"), "Nouvel avertissement de pluie");
  // An ECCC alert_code slug (the server's last fallback).
  assert.equal(fr("Freezing_rain", "warning"), "Freezing_rain");
});

test("a statement with « de » would be shortened like the others", () => {
  // No such ECCC name today; the rule is the chip's word, whatever it is.
  assert.equal(fr("Bulletin de qualité de l'air", "statement"), "Qualité de l'air");
});

test("an empty remainder keeps the title", () => {
  assert.equal(fr("Avertissement de", "warning"), "Avertissement de");
  assert.equal(fr("Avertissement de ", "warning"), "Avertissement de ");
  assert.equal(fr("Avertissement d'", "warning"), "Avertissement d'");
  assert.equal(fr("Veille d’  ", "watch"), "Veille d’  ");
  assert.equal(fr("Avertissement", "warning"), "Avertissement");
});

test("English and Spanish titles are untouched", () => {
  for (const lang of ["en", "en-US", "es", "es-MX"]) {
    assert.equal(
      shortAlertTitle("Freezing rain warning", { lang, productType: "warning" }),
      "Freezing rain warning",
    );
    // Even a French string (wrong field passed) is left alone outside French.
    assert.equal(
      shortAlertTitle("Avertissement de pluie verglaçante", { lang, productType: "warning" }),
      "Avertissement de pluie verglaçante",
    );
  }
});

test("NWS titles (English event names, also in title_fr) are untouched in French", () => {
  assert.equal(fr("Severe Thunderstorm Warning", "warning"), "Severe Thunderstorm Warning");
  assert.equal(fr("Winter Storm Watch", "watch"), "Winter Storm Watch");
  assert.equal(fr("Heat Advisory", "advisory"), "Heat Advisory");
  assert.equal(fr("Special Weather Statement", "statement"), "Special Weather Statement");
  // The TEST qualifier is prefixed after shortening, so it never matters here.
  assert.equal(fr("TEST · Avertissement de pluie", "warning"), "TEST · Avertissement de pluie");
});

test("French regional tags and missing languages", () => {
  assert.equal(
    shortAlertTitle("Avertissement de pluie", { lang: "fr-CA", productType: "warning" }),
    "Pluie",
  );
  assert.equal(
    shortAlertTitle("Avertissement de pluie", { lang: "FR", productType: "warning" }),
    "Pluie",
  );
  assert.equal(shortAlertTitle("Avertissement de pluie", { productType: "warning" }), "Avertissement de pluie");
  assert.equal(shortAlertTitle("Avertissement de pluie", { lang: null, productType: "warning" }), "Avertissement de pluie");
  assert.equal(shortAlertTitle("Avertissement de pluie"), "Avertissement de pluie");
});

test("non-string titles are returned as received", () => {
  assert.equal(fr(undefined, "warning"), undefined);
  assert.equal(fr(null, "warning"), null);
  assert.equal(fr("", "warning"), "");
});

test("each stripped word is the word the French chip prints", () => {
  // The prefix is dropped BECAUSE the chip shows it: FR_PRODUCT_WORDS
  // must match fr.json's full chip labels (alert.severity<Type>).
  const frLocale = JSON.parse(fs.readFileSync(
    path.join(__dirname, "../client/src/i18n/locales/fr.json"), "utf8",
  ));
  const typeKeys = {
    warning: "severityWarning",
    watch: "severityWatch",
    advisory: "severityAdvisory",
    statement: "severityStatement",
  };
  assert.deepEqual(Object.keys(FR_PRODUCT_WORDS).sort(), Object.keys(typeKeys).sort());
  for (const [type, key] of Object.entries(typeKeys)) {
    assert.equal(FR_PRODUCT_WORDS[type], frLocale.alert[key].toLowerCase(), key);
  }
  assert.ok(Object.isFrozen(FR_PRODUCT_WORDS));
});
