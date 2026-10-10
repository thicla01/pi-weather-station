// Alert titles shortened for the surfaces that print them beside a
// SeverityChip. The chip already prints the alert's product type
// (« AVERT. » / "WARNING" on the Pi compact card, the full word
// elsewhere), so the title beside it drops the word the chip repeats.
//
// French: ECCC's French alert names put the product type first and the
// hazard last (« Avertissement de pluie verglaçante », « Veille d'orages
// violents », « Avis de gel »). On the one-line Pi card the repeated
// prefix pushed the hazard past the ellipsis: with two alerts,
// « Avertissement de pluie ver… » read as a rainfall warning, and the
// winter- and tropical-storm warnings both became « Avertissement de
// tempête… ». Beside the chip the title now leads with the hazard
// (« Pluie verglaçante »).
//
// English and Spanish: both UIs show the English title (`title_en`; the
// Spanish UI beside a Spanish chip, « ADVERT. »), which puts the product
// type LAST: NWS event names in Title Case ("Heavy Freezing Spray
// Warning", "Flood Watch", "Frost Advisory") and ECCC's `alert_name_en`,
// lower case until the server capitalises its first letter ("Snowfall
// warning", "Frost advisory"). With two alerts the Pi card cut the first
// to "Heavy Freezing Spray Warn…"; beside the chip it now reads "Heavy
// Freezing Spray". A statement keeps its word ("Special Weather
// Statement" would become "Special Weather"), and so does a title whose
// product word isn't its last one (ECCC's short-name fallback "Frost
// (advisory)"). NWS titles in a French UI, whose `title_fr` is the
// English event name, are left as they are.
//
// Display only: the server payload and the Sense HAT feed keep the full
// titles.
//
// The module also holds `alertDisplayTitle`, the one title every alert
// surface prints: the short title above, then, for an NWS test/exercise
// alert, the « TEST · » prefix CLAUDE.md requires beside the TEST badge.
//
// CommonJS on purpose (like ui/airQualityDisplay.js): webpack accepts it
// next to the ESM tree, and `test/alertTitle.test.js` runs the real module
// under `node --test`. Its one import, services/formatting.js, is
// CommonJS for the same reason.

const { capitalizeFirst } = require("../services/formatting");

// The language whose alert titles carry the product prefix.
const PREFIXED_LANG = "fr";

// Locale for upper-casing the hazard's first letter (« É », « Ê »…).
const CAPITALIZE_LOCALE = "fr-CA";

// The French word each chip product type prints in full — the
// `alert.severity*` values of fr.json — which is also the word ECCC's
// French alert names start with. Lower case; matched case-insensitively.
// `test/alertTitle.test.js` checks it against fr.json. « Bulletin » is
// listed for completeness: ECCC's statements (« Bulletin météorologique
// spécial ») have no « de », so they never match.
const FR_PRODUCT_WORDS = Object.freeze({
  warning: "avertissement",
  watch: "veille",
  advisory: "avis",
  statement: "bulletin",
});

// What joins the product word to the hazard in an ECCC French name:
// « de », its elision « d' » (straight or typographic apostrophe), and the
// contractions « du » and « des ». An article after « de » (« de la »,
// « de l' ») stays with the hazard.
const FR_LINK = "(?:de\\s+|d['’]\\s*|du\\s+|des\\s+)";

// The languages whose UI shows the English alert title, product word
// last. Spanish has no alert title of its own: it shows the English one.
const SUFFIXED_LANGS = Object.freeze(["en", "es"]);

// The English word each chip product type prints in full — the
// `alert.severity*` values of en.json — which is also the word NWS event
// names and ECCC's `alert_name_en` end with. Lower case; matched
// case-insensitively. `test/alertTitle.test.js` checks it against en.json.
// No statement: "Special Weather Statement" → "Special Weather" and
// "Hurricane Local Statement" → "Hurricane Local" would no longer say
// what they are, so a statement's title always keeps its word.
const EN_PRODUCT_WORDS = Object.freeze({
  warning: "warning",
  watch: "watch",
  advisory: "advisory",
});

// Hazards too generic to stand without their product word, for the same
// reason a statement keeps its word: ECCC's "Weather warning" / "Weather
// advisory" would read "Weather" (its French name, « Avertissement
// météorologique », has no « de » and stays whole too), NWS's "Special
// Marine Warning" would read "Special Marine", and "Hydrologic Advisory"
// "Hydrologic". Lower case; compared case-insensitively.
const EN_KEEP_WHOLE = Object.freeze(new Set(["weather", "special marine", "hydrologic"]));

// The TEST qualifier's label when the caller passes none: the value of
// the `alert.testTag` locale key in all three languages.
const DEFAULT_TEST_LABEL = "TEST";

// Between the TEST qualifier and the title: « TEST · Tornado Warning ».
const TEST_PREFIX_SEPARATOR = " · ";

// One anchored pattern per product type, built once. Group 1 is the
// hazard. The whitespace after the product word means « Avisé de … »
// never matches « avis ».
const FR_PREFIX_RES = Object.freeze(Object.fromEntries(
  Object.entries(FR_PRODUCT_WORDS).map(([type, word]) => [
    type,
    new RegExp(`^\\s*${word}\\s+${FR_LINK}(.*)$`, "iu"),
  ]),
));

// One pattern per product type for the English word that ends a title,
// built once; the hazard is everything before the match. The whitespace
// in front of the word means "Stopwatch" never matches "watch", and the
// end anchor (trailing spaces allowed) means "Watchtower" and "Frost
// (advisory)" never do either.
const EN_SUFFIX_RES = Object.freeze(Object.fromEntries(
  Object.entries(EN_PRODUCT_WORDS).map(([type, word]) => [
    type,
    new RegExp(`\\s+${word}\\s*$`, "iu"),
  ]),
));

/**
 * The pattern `table` holds for `productType`, or null. Own keys only: a
 * stray productType such as "constructor" must not reach
 * Object.prototype.
 *
 * @param {object} table FR_PREFIX_RES or EN_SUFFIX_RES
 * @param {?string} productType the chip's product type
 * @returns {?RegExp} the pattern, or null when the table has none
 */
function patternFor(table, productType) {
  return Object.prototype.hasOwnProperty.call(table, productType)
    ? table[productType]
    : null;
}

/**
 * A French title without the product prefix the chip prints: the hazard
 * after « <type> de / d' / du / des », its first letter capitalised, or
 * the title unchanged when it doesn't open that way or nothing follows.
 *
 * @param {string} title the alert title (`title_fr`)
 * @param {?string} productType the chip's product type
 * @returns {string} the title to display
 */
function dropFrenchPrefix(title, productType) {
  const prefixRe = patternFor(FR_PREFIX_RES, productType);
  if (!prefixRe) return title;
  const match = prefixRe.exec(title);
  if (!match) return title;
  const hazard = match[1].trim();
  if (!hazard) return title;
  return capitalizeFirst(hazard, CAPITALIZE_LOCALE);
}

/**
 * An English title without the product word the chip prints: the hazard
 * before that last word, its capitalisation kept (NWS "Heavy Freezing
 * Spray", ECCC "Freezing rain"), or the title unchanged when the word
 * doesn't end it, nothing precedes it, or what precedes it is too generic
 * to stand alone (EN_KEEP_WHOLE).
 *
 * @param {string} title the alert title (`title_en`)
 * @param {?string} productType the chip's product type
 * @returns {string} the title to display
 */
function dropEnglishSuffix(title, productType) {
  const suffixRe = patternFor(EN_SUFFIX_RES, productType);
  if (!suffixRe) return title;
  const match = suffixRe.exec(title);
  if (!match) return title;
  const hazard = title.slice(0, match.index).trim();
  if (!hazard || EN_KEEP_WHOLE.has(hazard.toLowerCase())) return title;
  return hazard;
}

/**
 * An alert title as shown beside a SeverityChip that prints the alert's
 * product type. Returns the hazard alone when the title carries that same
 * product word where its language puts it:
 *
 *   - French: the title opens with the word followed by « de » / « d' » /
 *     « du » / « des »; the hazard gets its first letter capitalised
 *     (« Avertissement de tempête hivernale » → « Tempête hivernale »).
 *   - English and Spanish (both show the English title): the title ends
 *     with the word, for a warning, a watch or an advisory; the hazard
 *     keeps its capitalisation ("Heavy Freezing Spray Warning" → "Heavy
 *     Freezing Spray", "Freezing rain warning" → "Freezing rain"). Never
 *     for a statement: "Special Weather Statement" stays whole.
 *
 * Every other case returns the title unchanged: another language, a
 * title that names a different product type than the chip (it would
 * contradict the chip, so the reader needs it), a title without the
 * pattern (« Bulletin météorologique spécial », "Air Quality Alert"), or
 * a product word with nothing beside it.
 *
 * Pass `productType` only where the chip actually shows its word (full
 * or abbreviated). Beside an icon-only chip, or where there is no chip,
 * the title is the only place the product type appears: omit it and
 * the title stays whole.
 *
 * @param {?string} title the alert title in the UI language (`title_fr`
 *   in French, `title_en` in English and Spanish)
 * @param {object} [options]
 * @param {?string} [options.lang] UI language as i18next reports it
 *   ("fr", "fr-CA", "en", "en-CA", "es"…)
 * @param {?string} [options.productType] the product type the chip beside
 *   the title prints ("warning" | "watch" | "advisory" | "statement", as
 *   `chipProductType` in ui/alertLogic.js returns it)
 * @returns {?string} the title to display; a non-string title is returned
 *   unchanged
 */
function shortAlertTitle(title, { lang, productType } = {}) {
  if (typeof title !== "string") return title;
  const code = String(lang || "").slice(0, 2).toLowerCase();
  if (code === PREFIXED_LANG) return dropFrenchPrefix(title, productType);
  if (SUFFIXED_LANGS.includes(code)) return dropEnglishSuffix(title, productType);
  return title;
}

/**
 * The alert title an alert surface prints. Shortens it first, exactly as
 * `shortAlertTitle` does (pass `productType` only beside a chip that
 * prints its word; omit it and the title stays whole), THEN, for a
 * test/exercise alert (an NWS alert with CAP status other than `Actual`,
 * which only the localhost-only "Show test alerts" toggle reveals), puts
 * the TEST qualifier in front: « TEST · Tornado » beside a chip that
 * prints "Warning", « TEST · Tornado Warning » where no chip does. The
 * order matters twice: the prefix in front would stop a French title from
 * matching « Avertissement de … », and it must lead the shortened title
 * so a one-line card's ellipsis can never cut it. A test alert with no
 * title prints the qualifier alone.
 *
 * Surfaces that print a SourceBadge also render the neutral TEST badge
 * beside it (`<SourceBadge source={testLabel} variant="test" />`); the
 * prefix is what marks the surfaces that have no badge (mini-cards, the
 * alert view's "Also active" chips) and keeps the word on screen when a
 * narrow card ellipsizes.
 *
 * @param {?string} title the alert title in the UI language (`title_fr`
 *   in French, `title_en` in English and Spanish)
 * @param {object} [options]
 * @param {?string} [options.lang] UI language as i18next reports it
 * @param {?string} [options.productType] the product type the chip beside
 *   the title prints (see `shortAlertTitle`); omit to keep the title whole
 * @param {?boolean} [options.isTest] the alert's `isTest` flag (set by the
 *   server's NWS source)
 * @param {?string} [options.testLabel] the qualifier's text, from the
 *   `alert.testTag` locale key; defaults to "TEST"
 * @returns {?string} the title to display
 */
function alertDisplayTitle(title, { lang, productType, isTest, testLabel } = {}) {
  const short = shortAlertTitle(title, { lang, productType });
  if (!isTest) return short;
  const label = typeof testLabel === "string" && testLabel !== "" ? testLabel : DEFAULT_TEST_LABEL;
  if (typeof short !== "string" || short.trim() === "") return label;
  return `${label}${TEST_PREFIX_SEPARATOR}${short}`;
}

module.exports = {
  FR_PRODUCT_WORDS,
  EN_PRODUCT_WORDS,
  shortAlertTitle,
  alertDisplayTitle,
};
