// Tests for `client/src/ui/alertTitle.js` — the alert titles shortened
// beside a SeverityChip that already prints the product type: the French
// ECCC prefix (« Avertissement de pluie verglaçante » → « Pluie
// verglaçante » beside « AVERT. ») and, in English and Spanish, the
// trailing English product word ("Heavy Freezing Spray Warning" → "Heavy
// Freezing Spray" beside "WARNING"). The module is CommonJS, so this runs
// the real code.
//
// The French titles below are ECCC `alert_name_fr` values as the server
// serves them (`capitalizeFirst` in server/govAlertSources/_shared.js):
// the ones measured on the 7" kiosk in October 2026 and ECCC's other
// names. The English ones are NWS `event` values (Title Case) and ECCC
// `alert_name_en` values (lower case, first letter capitalised by the
// server), both as seen in the live feeds on 2026-10-10. The
// `alertDisplayTitle` tests check the TEST qualifier goes on after the
// shortening. The last test checks the components: every one that prints
// a worded chip (full or abbreviated) shortens its title.
// `test/alertTestQualifier.test.js` checks they all mark test alerts.
// Run: `npm test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  FR_PRODUCT_WORDS,
  EN_PRODUCT_WORDS,
  shortAlertTitle,
  alertDisplayTitle,
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

/**
 * Shorthand: shorten `title` for an English UI (or `lang`) beside a chip
 * printing `productType`.
 *
 * @param {string} title alert title
 * @param {string} productType chip product type
 * @param {string} [lang] UI language, "en" by default
 * @returns {string} the displayed title
 */
function en(title, productType, lang = "en") {
  return shortAlertTitle(title, { lang, productType });
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

test("English: NWS event names drop the trailing product word", () => {
  // Title Case kept: the hazard is printed as NWS names it.
  const cases = [
    ["Heavy Freezing Spray Warning", "warning", "Heavy Freezing Spray"],
    ["Severe Thunderstorm Warning", "warning", "Severe Thunderstorm"],
    ["Winter Storm Warning", "warning", "Winter Storm"],
    ["Tornado Warning", "warning", "Tornado"],
    ["Flood Watch", "watch", "Flood"],
    ["Tropical Storm Watch", "watch", "Tropical Storm"],
    ["Winter Storm Watch", "watch", "Winter Storm"],
    ["Frost Advisory", "advisory", "Frost"],
    ["Small Craft Advisory", "advisory", "Small Craft"],
    ["Winter Weather Advisory", "advisory", "Winter Weather"],
  ];
  for (const [title, productType, expected] of cases) {
    assert.equal(en(title, productType), expected, title);
  }
});

test("English: ECCC names drop the trailing product word, sentence case kept", () => {
  // ECCC's alert_name_en is lower case; the server capitalises only the
  // first letter, and the hazard stays that way (no Title Case added).
  const cases = [
    ["Snowfall warning", "warning", "Snowfall"],
    ["Freezing rain warning", "warning", "Freezing rain"],
    ["Storm surge warning", "warning", "Storm surge"],
    ["Severe thunderstorm watch", "watch", "Severe thunderstorm"],
    ["Frost advisory", "advisory", "Frost"],
    ["Fog advisory", "advisory", "Fog"],
  ];
  for (const [title, productType, expected] of cases) {
    assert.equal(en(title, productType), expected, title);
  }
});

test("Spanish shows the English title and drops its product word too", () => {
  // The Spanish chip prints « ADVERT. » / « VIGIL. » / « AVISO » beside the
  // English title, so the English word is just as redundant there.
  for (const lang of ["es", "es-MX", "ES"]) {
    assert.equal(en("Heavy Freezing Spray Warning", "warning", lang), "Heavy Freezing Spray", lang);
    assert.equal(en("Freezing rain warning", "warning", lang), "Freezing rain", lang);
    assert.equal(en("Flood Watch", "watch", lang), "Flood", lang);
    assert.equal(en("Frost advisory", "advisory", lang), "Frost", lang);
    assert.equal(en("Special Weather Statement", "statement", lang), "Special Weather Statement", lang);
  }
});

test("English regional and upper-case language tags", () => {
  for (const lang of ["en-CA", "en-US", "EN"]) {
    assert.equal(en("Heavy Freezing Spray Warning", "warning", lang), "Heavy Freezing Spray", lang);
  }
  // Another language, or none, keeps the English title whole.
  assert.equal(en("Heavy Freezing Spray Warning", "warning", "de"), "Heavy Freezing Spray Warning");
  assert.equal(en("Heavy Freezing Spray Warning", "warning", ""), "Heavy Freezing Spray Warning");
  assert.equal(
    shortAlertTitle("Heavy Freezing Spray Warning", { productType: "warning" }),
    "Heavy Freezing Spray Warning",
  );
});

test("English: a hazard too generic to stand alone keeps its word", () => {
  assert.equal(en("Weather warning", "warning"), "Weather warning");
  assert.equal(en("Weather advisory", "advisory"), "Weather advisory");
  assert.equal(en("Special Marine Warning", "warning"), "Special Marine Warning");
  assert.equal(en("Hydrologic Advisory", "advisory"), "Hydrologic Advisory");
  assert.equal(en("WEATHER WARNING", "warning"), "WEATHER WARNING");
  assert.equal(en("Weather warning", "warning", "es"), "Weather warning");
  // The list holds whole hazards only: a longer hazard still shortens.
  assert.equal(en("Special Marine Fog Warning", "warning"), "Special Marine Fog");
  assert.equal(en("Fire Weather Watch", "watch"), "Fire Weather");
});

test("English: a statement always keeps its word", () => {
  // "Special Weather" or "Hurricane Local" would no longer say what they are.
  assert.equal(en("Special Weather Statement", "statement"), "Special Weather Statement");
  assert.equal(en("Special weather statement", "statement"), "Special weather statement");
  assert.equal(en("Hurricane Local Statement", "statement"), "Hurricane Local Statement");
  assert.equal(en("Tropical Cyclone Local Statement", "statement"), "Tropical Cyclone Local Statement");
  assert.equal(en("Rip Current Statement", "statement"), "Rip Current Statement");
  assert.ok(!Object.prototype.hasOwnProperty.call(EN_PRODUCT_WORDS, "statement"));
});

test("English: a title naming another product type than the chip stays whole", () => {
  // Stripping would hide that the title contradicts the chip.
  assert.equal(en("Flood Advisory", "warning"), "Flood Advisory");
  assert.equal(en("Winter Storm Watch", "warning"), "Winter Storm Watch");
  assert.equal(en("Wind warning", "advisory"), "Wind warning");
  assert.equal(en("Frost advisory", "watch"), "Frost advisory");
  // No product word at all: the chip's word came from the severity fallback.
  assert.equal(en("Air Quality Alert", "warning"), "Air Quality Alert");
  assert.equal(en("Hydrologic Outlook", "advisory"), "Hydrologic Outlook");
});

test("English: only a whole last word matches", () => {
  // A word that merely starts or ends with the product word.
  assert.equal(en("Old Watchtower", "watch"), "Old Watchtower");
  assert.equal(en("Fire Stopwatch", "watch"), "Fire Stopwatch");
  assert.equal(en("Coastal Warnings", "warning"), "Coastal Warnings");
  assert.equal(en("Frost-advisory", "advisory"), "Frost-advisory");
  // ECCC's short-name fallback (used only when alert_name_en is missing).
  assert.equal(en("Frost (advisory)", "advisory"), "Frost (advisory)");
  // A product word that doesn't end the title, whatever follows it: a
  // regional tag, or a "<colour> warning - <hazard>" form (not one ECCC
  // serves today: its colour has its own field, risk_colour_en).
  assert.equal(
    en("Severe thunderstorm warning — Montréal area", "warning"),
    "Severe thunderstorm warning — Montréal area",
  );
  assert.equal(en("Yellow warning - rainfall", "warning"), "Yellow warning - rainfall");
  assert.equal(en("Warning area tornado", "warning"), "Warning area tornado");
  // An ECCC alert_code slug (the server's last fallback).
  assert.equal(en("Freezing_rain", "warning"), "Freezing_rain");
});

test("English: upper and lower case match; spaces around the words are trimmed", () => {
  assert.equal(en("HEAVY FREEZING SPRAY WARNING", "warning"), "HEAVY FREEZING SPRAY");
  assert.equal(en("heavy freezing spray warning", "warning"), "heavy freezing spray");
  assert.equal(en("Heavy Freezing Spray Warning  ", "warning"), "Heavy Freezing Spray");
  assert.equal(en("  Wind   Warning", "warning"), "Wind");
  assert.equal(en("Wind\tWarning\n", "warning"), "Wind");
});

test("English: an empty remainder keeps the title", () => {
  assert.equal(en("Warning", "warning"), "Warning");
  assert.equal(en("  Warning", "warning"), "  Warning");
  assert.equal(en("Watch ", "watch"), "Watch ");
  assert.equal(en("advisory", "advisory"), "advisory");
});

test("English: no chip word, no stripping", () => {
  // Icon-only chip, or no chip: the title is the only place the type shows.
  assert.equal(shortAlertTitle("Heavy Freezing Spray Warning", { lang: "en" }), "Heavy Freezing Spray Warning");
  assert.equal(en("Heavy Freezing Spray Warning", null), "Heavy Freezing Spray Warning");
  assert.equal(en("Heavy Freezing Spray Warning", ""), "Heavy Freezing Spray Warning");
  assert.equal(en("Heavy Freezing Spray Warning", "emergency"), "Heavy Freezing Spray Warning");
  // Object.prototype keys are not product types.
  assert.equal(en("Wind Warning", "constructor"), "Wind Warning");
  assert.equal(en("Wind Warning", "toString"), "Wind Warning");
  // A French string (wrong field passed) never ends with an English word.
  assert.equal(en("Avertissement de pluie verglaçante", "warning"), "Avertissement de pluie verglaçante");
  assert.equal(en("Avertissement de pluie verglaçante", "warning", "es"), "Avertissement de pluie verglaçante");
});

test("NWS titles (English event names, also in title_fr) are untouched in French", () => {
  // The English rule runs only in the English and Spanish UIs; a French UI
  // printing an NWS title beside « AVERTISSEMENT » keeps it whole.
  assert.equal(fr("Severe Thunderstorm Warning", "warning"), "Severe Thunderstorm Warning");
  assert.equal(fr("Heavy Freezing Spray Warning", "warning"), "Heavy Freezing Spray Warning");
  assert.equal(fr("Flood Watch", "watch"), "Flood Watch");
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

test("each English stripped word is the word the English chip prints", () => {
  // EN_PRODUCT_WORDS must match en.json's full chip labels; the Spanish
  // chip prints their translation beside the same English title. No
  // statement entry: a statement's title keeps its word.
  const enLocale = JSON.parse(fs.readFileSync(
    path.join(__dirname, "../client/src/i18n/locales/en.json"), "utf8",
  ));
  const typeKeys = {
    warning: "severityWarning",
    watch: "severityWatch",
    advisory: "severityAdvisory",
  };
  assert.deepEqual(Object.keys(EN_PRODUCT_WORDS).sort(), Object.keys(typeKeys).sort());
  for (const [type, key] of Object.entries(typeKeys)) {
    assert.equal(EN_PRODUCT_WORDS[type], enLocale.alert[key].toLowerCase(), key);
  }
  assert.ok(Object.isFrozen(EN_PRODUCT_WORDS));
});

test("alertDisplayTitle: the TEST prefix goes on AFTER the shortening", () => {
  const opts = { lang: "fr", productType: "warning", isTest: true, testLabel: "TEST" };
  // Shortened first, then prefixed: the hazard follows the qualifier.
  assert.equal(alertDisplayTitle("Avertissement de pluie verglaçante", opts), "TEST · Pluie verglaçante");
  assert.equal(alertDisplayTitle("Veille d'orages violents", { ...opts, productType: "watch" }), "TEST · Orages violents");
  // The other order would have blocked the match and kept the product word.
  assert.notEqual(
    alertDisplayTitle("Avertissement de pluie", opts),
    shortAlertTitle("TEST · Avertissement de pluie", opts),
  );
  // English and Spanish: the trailing word goes first, then the prefix.
  const enOpts = { lang: "en", productType: "warning", isTest: true, testLabel: "TEST" };
  assert.equal(alertDisplayTitle("Tornado Warning", enOpts), "TEST · Tornado");
  assert.equal(alertDisplayTitle("Heavy Freezing Spray Warning", enOpts), "TEST · Heavy Freezing Spray");
  assert.equal(alertDisplayTitle("Flood Watch", { ...enOpts, productType: "watch" }), "TEST · Flood");
  assert.equal(
    alertDisplayTitle("Heavy Freezing Spray Warning", { ...enOpts, lang: "es" }),
    "TEST · Heavy Freezing Spray",
  );
  // A statement keeps its word, and still takes the prefix.
  assert.equal(
    alertDisplayTitle("Special Weather Statement", { ...enOpts, productType: "statement" }),
    "TEST · Special Weather Statement",
  );
  // An NWS title in a French UI is never shortened; it only takes the prefix.
  assert.equal(alertDisplayTitle("Tornado Warning", { ...opts }), "TEST · Tornado Warning");
});

test("alertDisplayTitle: a real alert is shortened exactly like shortAlertTitle", () => {
  for (const isTest of [false, undefined, null, 0]) {
    assert.equal(
      alertDisplayTitle("Avertissement de pluie", { lang: "fr", productType: "warning", isTest, testLabel: "TEST" }),
      "Pluie",
    );
    assert.equal(alertDisplayTitle("Tornado Warning", { lang: "en", productType: "warning", isTest }), "Tornado");
  }
  // No productType (the extreme band, the "Also active" chips): whole title.
  assert.equal(alertDisplayTitle("Avertissement de pluie", { lang: "fr" }), "Avertissement de pluie");
  assert.equal(alertDisplayTitle("Tornado Warning", { lang: "en" }), "Tornado Warning");
  assert.equal(
    alertDisplayTitle("Tornado Warning", { lang: "en", isTest: true, testLabel: "TEST" }),
    "TEST · Tornado Warning",
  );
  assert.equal(
    alertDisplayTitle("Avertissement de pluie", { lang: "fr", isTest: true, testLabel: "TEST" }),
    "TEST · Avertissement de pluie",
  );
  assert.equal(alertDisplayTitle("Avertissement de pluie"), "Avertissement de pluie");
  assert.equal(alertDisplayTitle(undefined), undefined);
  assert.equal(alertDisplayTitle(null), null);
});

test("alertDisplayTitle: label fallback and a test alert without a title", () => {
  // No label passed (or an empty one) → "TEST", the alert.testTag value.
  assert.equal(alertDisplayTitle("Tornado Warning", { isTest: true }), "TEST · Tornado Warning");
  assert.equal(alertDisplayTitle("Tornado Warning", { isTest: true, testLabel: "" }), "TEST · Tornado Warning");
  assert.equal(alertDisplayTitle("Tornado Warning", { isTest: true, testLabel: "ESSAI" }), "ESSAI · Tornado Warning");
  // Never "TEST · undefined": the qualifier alone.
  assert.equal(alertDisplayTitle(undefined, { isTest: true, testLabel: "TEST" }), "TEST");
  assert.equal(alertDisplayTitle(null, { isTest: true }), "TEST");
  assert.equal(alertDisplayTitle("", { isTest: true }), "TEST");
  assert.equal(alertDisplayTitle("   ", { isTest: true }), "TEST");
});

test("alertDisplayTitle's default label is the alert.testTag value in every locale", () => {
  for (const lang of ["en", "fr", "es"]) {
    const strings = JSON.parse(fs.readFileSync(
      path.join(__dirname, `../client/src/i18n/locales/${lang}.json`), "utf8",
    ));
    assert.equal(
      alertDisplayTitle("X", { isTest: true }),
      `${strings.alert.testTag} · X`,
      `${lang}: alert.testTag`,
    );
  }
});

test("every component that prints a worded SeverityChip shortens the title beside it", () => {
  // A chip that prints its word, full or `abbreviated` (« AVERT. »),
  // repeats the French prefix or the English trailing word, so its
  // component must pass the title through shortAlertTitle, directly or
  // through alertDisplayTitle with a productType. Only an icon-only `compact` chip leaves the
  // title whole; no surface has used one since the FloatingMiniBanner
  // moved to `abbreviated` (2026-10).
  const clientSrc = path.join(__dirname, "../client/src");
  const worded = [];
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith(".js")) continue;
      const src = fs.readFileSync(full, "utf8");
      const chips = [...src.matchAll(/<SeverityChip\b[^>]*>/g)].map((m) => m[0]);
      if (!chips.some((chip) => !/\bcompact\b/.test(chip))) continue;
      const rel = path.relative(clientSrc, full).split(path.sep).join("/");
      worded.push(rel);
      const shortens = /\bshortAlertTitle\(/.test(src)
        || /\balertDisplayTitle\([\s\S]*?\bproductType\b/.test(src);
      if (!shortens) offenders.push(rel);
    }
  };
  walk(clientSrc);
  assert.deepEqual(offenders, []);
  // The radar-focus mini banner prints the abbreviated chip and so the
  // short French title, like the Pi alert card.
  assert.ok(worded.includes("components/ambient/FloatingMiniBanner/index.js"), worded.join(", "));
  assert.ok(worded.includes("components/ambient/AlertBanner/index.js"), worded.join(", "));
});
