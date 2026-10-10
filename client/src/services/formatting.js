// MODULE FORMAT: CommonJS on purpose (like ui/autoTabSelector.js and
// services/brightnessRestore.js) so test/formatting.test.js can require()
// the REAL module. Webpack imports CJS into the ESM client fine.

/**
 * Upper-case the first character of a formatted string, locale-aware, and
 * leave the rest untouched. Replaces CSS `text-transform: capitalize`, which
 * upper-cases EVERY word ("Ven. 9 Octobre", "Vie, 9 De Octubre") — wrong in
 * French and Spanish, which write month and weekday names in lower case.
 *
 * @param {string} text formatted string (e.g. Intl.DateTimeFormat output)
 * @param {string} [locale] BCP-47 tag for toLocaleUpperCase (e.g. "fr-FR")
 * @returns {string} the string with only its first character upper-cased;
 *   a non-string or empty input is returned unchanged
 */
function capitalizeFirst(text, locale) {
  if (typeof text !== "string" || text === "") return text;
  // Code point, not charAt(0) — never split a surrogate pair.
  const first = String.fromCodePoint(text.codePointAt(0));
  return first.toLocaleUpperCase(locale) + text.slice(first.length);
}

module.exports = { capitalizeFirst };
