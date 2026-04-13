import { fr, es } from "date-fns/locale";

/**
 * Returns the date-fns locale object for a given i18next language code.
 * Defaults to undefined (date-fns en-US) when no match is found.
 *
 * @param {String} language i18next language code (e.g. "fr", "fr-CA", "en", "es")
 * @returns {Object|undefined} date-fns locale
 */
export function getDateLocale(language) {
  if (language && language.startsWith("fr")) return fr;
  if (language && language.startsWith("es")) return es;
  return undefined;
}
