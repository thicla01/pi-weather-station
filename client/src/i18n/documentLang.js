// Page language — keeps `<html lang>` equal to the language the UI is
// rendered in.
//
// index.html can only declare a fixed `lang`, but the UI language is picked
// at runtime by i18next (localStorage, then the browser's languages). A page
// declared `en` that renders French makes Chromium offer to translate it
// (see the notranslate meta in index.html, which is what keeps the bubble
// off the kiosk) and makes screen readers read French with English rules.
// i18n/index.js calls syncDocumentLang on every `languageChanged`, the
// first one included.
//
// MODULE FORMAT: CommonJS on purpose, like ui/radarFrameStack.js, so
// test/documentLang.test.js runs the real module under `node --test`.

/**
 * Picks the `lang` value to declare for the page: the primary subtag of
 * the language the UI is rendered in, when the UI ships that language,
 * else the fallback (the language i18next falls back to).
 *
 * @param {?string} language - i18next's resolved language (e.g. "fr",
 *   "fr-CA"), or null/undefined before i18next has resolved one.
 * @param {string[]} supported - Languages the UI ships.
 * @param {string} fallback - Language the UI falls back to.
 * @returns {string} Primary language subtag, lowercase (e.g. "fr").
 */
function documentLangFor(language, supported, fallback) {
  const primary = typeof language === "string"
    ? language.split(/[-_]/)[0].toLowerCase()
    : "";
  return supported.includes(primary) ? primary : fallback;
}

/**
 * Sets `lang` on the document's root element when it differs.
 *
 * @param {?Document} doc - Document to update (absent outside a browser).
 * @param {?string} language - i18next's resolved language.
 * @param {string[]} supported - Languages the UI ships.
 * @param {string} fallback - Language the UI falls back to.
 * @returns {?string} The `lang` now on the root element, or null when
 *   there is no document.
 */
function syncDocumentLang(doc, language, supported, fallback) {
  const root = doc && doc.documentElement;
  if (!root) return null;
  const lang = documentLangFor(language, supported, fallback);
  if (root.lang !== lang) root.lang = lang;
  return lang;
}

module.exports = { documentLangFor, syncDocumentLang };
