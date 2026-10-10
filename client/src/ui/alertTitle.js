// Alert titles shortened for the surfaces that print them beside a
// SeverityChip. ECCC's French alert names put the product type first and
// the hazard last (« Avertissement de pluie verglaçante », « Veille
// d'orages violents », « Avis de gel »), while the chip next to the title
// already prints that product type (« AVERT. » on the Pi compact card,
// « Avertissement » elsewhere). On the one-line Pi card the repeated
// prefix pushed the hazard past the ellipsis: with two alerts,
// « Avertissement de pluie ver… » read as a rainfall warning, and the
// winter- and tropical-storm warnings both became « Avertissement de
// tempête… ». Beside the chip the title now leads with the hazard
// (« Pluie verglaçante »). Display only: the server payload and the
// Sense HAT feed keep the full titles.
//
// English and Spanish need nothing (the hazard already comes first, and
// the Spanish UI shows the English title), and neither do NWS titles,
// whose `title_fr` is the English event name.
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

// One anchored pattern per product type, built once. Group 1 is the
// hazard. The whitespace after the product word means « Avisé de … »
// never matches « avis ».
const FR_PREFIX_RES = Object.freeze(Object.fromEntries(
  Object.entries(FR_PRODUCT_WORDS).map(([type, word]) => [
    type,
    new RegExp(`^\\s*${word}\\s+${FR_LINK}(.*)$`, "iu"),
  ]),
));

/**
 * An alert title as shown beside a SeverityChip that prints the alert's
 * product type. When the UI language is French and the title opens with
 * that same product word followed by « de » / « d' » / « du » / « des »,
 * returns the hazard alone with its first letter capitalised
 * (« Avertissement de tempête hivernale » → « Tempête hivernale »).
 * Every other case returns the title unchanged: another language, a
 * title that names a different product type than the chip (it would
 * contradict the chip, so the reader needs it), a title without the
 * « <type> de … » pattern (« Bulletin météorologique spécial »), or a
 * prefix with nothing after it.
 *
 * Pass `productType` only where the chip actually shows its word (full
 * or abbreviated). Beside an icon-only chip, or where there is no chip,
 * the prefix is the only place the product type appears: omit it and
 * the title stays whole.
 *
 * @param {?string} title the alert title in the UI language (`title_fr`
 *   in French)
 * @param {object} [options]
 * @param {?string} [options.lang] UI language as i18next reports it
 *   ("fr", "fr-CA", "en", "es"…)
 * @param {?string} [options.productType] the product type the chip beside
 *   the title prints ("warning" | "watch" | "advisory" | "statement", as
 *   `chipProductType` in ui/alertLogic.js returns it)
 * @returns {?string} the title to display; a non-string title is returned
 *   unchanged
 */
function shortAlertTitle(title, { lang, productType } = {}) {
  if (typeof title !== "string") return title;
  if (String(lang || "").slice(0, 2).toLowerCase() !== PREFIXED_LANG) return title;
  // Own keys only: a stray productType such as "constructor" must not
  // reach Object.prototype.
  const prefixRe = Object.prototype.hasOwnProperty.call(FR_PREFIX_RES, productType)
    ? FR_PREFIX_RES[productType]
    : null;
  if (!prefixRe) return title;
  const match = prefixRe.exec(title);
  if (!match) return title;
  const hazard = match[1].trim();
  if (!hazard) return title;
  return capitalizeFirst(hazard, CAPITALIZE_LOCALE);
}

module.exports = {
  FR_PRODUCT_WORDS,
  shortAlertTitle,
};
