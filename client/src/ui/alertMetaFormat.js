// Labels of the alert banner's meta chips (ambient/AlertMetaChips): how long
// ago the alert was issued, and when it expires.
//
// Both take the current time as an argument instead of reading the clock.
// The React Compiler caches a call on its arguments: while these read the
// clock themselves, the compiled AlertMetaChips kept "Issued 5 min ago" on
// screen for as long as the banner stayed up. The component now passes a
// clock it holds in state. CommonJS so test/alertMetaFormat.test.js runs the
// real code.

// How far ahead of `now` an issue time may be and still read as "just
// issued". AlertMetaChips' clock advances once a minute, so an alert issued
// since its last tick is up to a minute ahead of it; past that, the issuer's
// clock is ahead of ours and the chip is dropped.
const ISSUED_AHEAD_TOLERANCE_MS = 60 * 1000;

/**
 * Format the freshness chip's relative-time label.
 *
 * Heuristic:
 *   < 1 min       → "Just issued"
 *   < 60 min      → "Issued N min ago"
 *   < 36 h        → "Issued Nh ago"
 *   else          → "Issued Nd ago"
 *
 * Falls back to null when the sentAt timestamp is missing or
 * unparseable — the caller drops the chip rather than rendering
 * an em-dash placeholder — or when it lies more than
 * ISSUED_AHEAD_TOLERANCE_MS ahead of `now`.
 *
 * @param {string|null} sentAt - ISO timestamp from the alert payload
 * @param {(key: string, opts?: object) => string} t - i18next translate; called with
 *   an `alert.issued*` key and the matching count bag (`{ minutes }` / `{ hours }` /
 *   `{ days }`) for interpolation
 * @param {number} now - the current time, epoch ms
 * @returns {string|null} localized "Issued ... ago" string or null
 */
function formatIssued(sentAt, t, now) {
  if (!sentAt) return null;
  const issuedMs = new Date(sentAt).getTime();
  if (Number.isNaN(issuedMs)) return null;
  const diffMs = now - issuedMs;
  if (diffMs < -ISSUED_AHEAD_TOLERANCE_MS) return null; // upstream clock ahead of ours
  const diffMin = Math.max(0, Math.round(diffMs / 60_000));
  if (diffMin < 1) return t("alert.issuedJustNow");
  if (diffMin < 60) return t("alert.issuedMinutesAgo", { minutes: diffMin });
  const diffH = Math.round(diffMin / 60);
  if (diffH < 36) return t("alert.issuedHoursAgo", { hours: diffH });
  const diffD = Math.round(diffH / 24);
  return t("alert.issuedDaysAgo", { days: diffD });
}

/**
 * Format the expiration timestamp into a short localized form.
 * Same day as `now` → "HH:MM", the next day → "<tomorrow> HH:MM",
 * later → "<weekday> HH:MM".
 *
 * @param {string|null} expiresAt - ISO timestamp
 * @param {string} lang - 'en' | 'fr' | 'es'
 * @param {(key: string) => string} t - i18next translate; used for the single key
 *   `alert.tomorrowShort`, the word prefixed to next-day times
 * @param {number} now - the current time, epoch ms
 * @returns {string|null} short localized "Expires" body, or null
 */
function formatExpires(expiresAt, lang, t, now) {
  if (!expiresAt) return null;
  const d = new Date(expiresAt);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date(now);
  const sameDay = d.toDateString() === today.toDateString();
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();
  const hhmm = d.toLocaleTimeString(lang === "en" ? "en-US" : `${lang}-CA`, {
    hour: "2-digit", minute: "2-digit", hour12: lang === "en",
  });
  if (sameDay) return hhmm;
  if (isTomorrow) {
    // "tomorrow" comes from the locale files like every other
    // user-facing string — this is an alert surface, so the
    // lbl()-style inline-trilingual exception (CLAUDE.md, Settings/
    // Debug panels only) does NOT apply here.
    return `${t("alert.tomorrowShort")} ${hhmm}`;
  }
  // > 2 days out — show the weekday short form ("Wed 14:30")
  const weekday = d.toLocaleDateString(lang === "en" ? "en-US" : `${lang}-CA`, {
    weekday: "short",
  });
  return `${weekday} ${hhmm}`;
}

module.exports = {
  ISSUED_AHEAD_TOLERANCE_MS,
  formatIssued,
  formatExpires,
};
