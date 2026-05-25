import React from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { InlineIcon } from "@iconify/react";
import calendarIcon from "@iconify/icons-carbon/calendar";
import timeIcon from "@iconify/icons-carbon/time";
import styles from "./styles.css";

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
 * an em-dash placeholder.
 *
 * @param {string|null} sentAt - ISO timestamp from the alert payload
 * @param {Function} t - i18next translator
 * @returns {string|null} localized "Issued ... ago" string or null
 */
function formatIssued(sentAt, t) {
  if (!sentAt) return null;
  const issuedMs = new Date(sentAt).getTime();
  if (Number.isNaN(issuedMs)) return null;
  const diffMs = Date.now() - issuedMs;
  if (diffMs < 0) return null;          // upstream clock ahead of ours
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return t("alert.issuedJustNow");
  if (diffMin < 60) return t("alert.issuedMinutesAgo", { minutes: diffMin });
  const diffH = Math.round(diffMin / 60);
  if (diffH < 36) return t("alert.issuedHoursAgo", { hours: diffH });
  const diffD = Math.round(diffH / 24);
  return t("alert.issuedDaysAgo", { days: diffD });
}

/**
 * Format the expiration timestamp into a short localized form.
 * Same-day → "HH:MM", different day → "<weekday> HH:MM".
 *
 * @param {string|null} expiresAt - ISO timestamp
 * @param {string} lang - 'en' | 'fr' | 'es'
 * @returns {string|null} short localized "Expires" body, or null
 */
function formatExpires(expiresAt, lang) {
  if (!expiresAt) return null;
  const d = new Date(expiresAt);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();
  const hhmm = d.toLocaleTimeString(lang === "en" ? "en-US" : `${lang}-CA`, {
    hour: "2-digit", minute: "2-digit", hour12: lang === "en",
  });
  if (sameDay) return hhmm;
  if (isTomorrow) {
    // Locale-specific shorthand for "tomorrow"
    const tom = lang === "fr" ? "demain"
      : lang === "es" ? "mañana"
        : "tomorrow";
    return `${tom} ${hhmm}`;
  }
  // > 2 days out — show the weekday short form ("Wed 14:30")
  const weekday = d.toLocaleDateString(lang === "en" ? "en-US" : `${lang}-CA`, {
    weekday: "short",
  });
  return `${weekday} ${hhmm}`;
}

/**
 * Row of three metadata chips that sit under the alert title:
 *   1. Source — issuing office (NWS Gray ME, ECCC ON) or fallback
 *      to the source slug. Always rendered when a source is provided.
 *   2. Freshness — "Issued Nh ago" with the palette `--c-accent`
 *      colouring (the design's `.chip.fresh` variant). Hidden when
 *      `sentAt` is missing.
 *   3. Expiration — "Expires HH:MM" / "Expires tomorrow HH:MM" /
 *      "Expires Wed HH:MM". Hidden when `expiresAt` is missing.
 *
 * The chips collapse individually rather than rendering em-dash
 * placeholders so the row's density matches the data actually
 * available for each alert source.
 *
 * @param {object} props
 * @param {string} [props.source]   - "NWS" | "ECCC" | other
 * @param {string} [props.senderName] - Pretty issuing-office name
 *   (e.g. "NWS Gray ME"). Falls back to `source` when missing.
 * @param {string} [props.sentAt]   - ISO timestamp the alert was
 *   issued at
 * @param {string} [props.expiresAt] - ISO timestamp the alert
 *   expires at
 * @returns {JSX.Element|null} the chip row, or null when no chip
 *   has any data to render
 */
const AlertMetaChips = ({ source, senderName, sentAt, expiresAt }) => {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language || "en").slice(0, 2);

  const sourceLabel = senderName || source;
  const issuedLabel = formatIssued(sentAt, t);
  const expiresLabel = formatExpires(expiresAt, lang);

  if (!sourceLabel && !issuedLabel && !expiresLabel) return null;

  return (
    <div className={styles.row}>
      {sourceLabel && (
        <span className={styles.chip}>
          <InlineIcon icon={calendarIcon} />
          {sourceLabel}
        </span>
      )}
      {issuedLabel && (
        <span className={`${styles.chip} ${styles.fresh}`}>
          <InlineIcon icon={timeIcon} />
          {issuedLabel}
        </span>
      )}
      {expiresLabel && (
        <span className={styles.chip}>
          {t("alert.expiresAt", { when: expiresLabel })}
        </span>
      )}
    </div>
  );
};

AlertMetaChips.propTypes = {
  source: PropTypes.string,
  senderName: PropTypes.string,
  sentAt: PropTypes.string,
  expiresAt: PropTypes.string,
};

export default AlertMetaChips;
