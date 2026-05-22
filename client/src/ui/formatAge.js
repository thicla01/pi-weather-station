import { formatDistanceToNow } from "date-fns";
import { getDateLocale } from "~/i18n/dateLocale";

/**
 * Locale-aware "N minutes ago" / "il y a N minutes" / "hace N
 * minutos" formatter for measurement timestamps. Built on
 * `date-fns/formatDistanceToNow` with `addSuffix: true`, so the
 * returned string already includes the "ago" / "il y a" framing
 * appropriate to the locale — callers just interpolate it.
 *
 * Returns null when the input is missing or unparseable so callers
 * can `&&` it into a template without an explicit conditional.
 *
 * @param {String|Date|null|undefined} observedAt ISO 8601 string or Date
 * @param {String} language i18next language code ("en", "fr-CA", "es", …)
 * @returns {String|null} Formatted relative time, or null when input is unparseable
 */
export function formatAge(observedAt, language) {
  if (!observedAt) return null;
  const date = observedAt instanceof Date ? observedAt : new Date(observedAt);
  if (isNaN(date.getTime())) return null;
  return formatDistanceToNow(date, { addSuffix: true, locale: getDateLocale(language) });
}
