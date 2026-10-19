import { formatDistance } from "date-fns";
import { getDateLocale } from "~/i18n/dateLocale";

/**
 * Locale-aware "N minutes ago" / "il y a N minutes" / "hace N
 * minutos" formatter for measurement timestamps. Built on
 * `date-fns/formatDistance` with `addSuffix: true`, so the
 * returned string already includes the "ago" / "il y a" framing
 * appropriate to the locale — callers just interpolate it.
 *
 * `now` is an argument (it used to be `formatDistanceToNow`, which reads
 * the clock): the React Compiler caches a call on its arguments, so a
 * component passes a clock it holds in state — see ambient/ReadingAge.
 *
 * Returns null when the input is missing or unparseable so callers
 * can `&&` it into a template without an explicit conditional.
 *
 * @param {String|Date|null|undefined} observedAt ISO 8601 string or Date
 * @param {String} language i18next language code ("en", "fr-CA", "es", …)
 * @param {Date|number} now the time to measure the age at (a Date or epoch ms)
 * @returns {String|null} Formatted relative time, or null when input is unparseable
 */
export function formatAge(observedAt, language, now) {
  if (!observedAt) return null;
  const date = observedAt instanceof Date ? observedAt : new Date(observedAt);
  if (isNaN(date.getTime())) return null;
  return formatDistance(date, now, { addSuffix: true, locale: getDateLocale(language) });
}
