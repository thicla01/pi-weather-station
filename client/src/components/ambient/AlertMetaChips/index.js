import React, { useEffect, useState } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { InlineIcon } from "@iconify/react";
import calendarIcon from "@iconify/icons-carbon/calendar";
import timeIcon from "@iconify/icons-carbon/time";
import { formatExpires, formatIssued } from "~/ui/alertMetaFormat";
import styles from "./styles.css";

// How often the issued and expiry labels are re-derived: their finest unit
// is the minute.
const LABEL_TICK_MS = 60 * 1000;

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

  // Clock for the labels, held in state so the compiled component re-derives
  // them: the React Compiler caches each label on its inputs, so without a
  // clock among them "Issued 5 min ago" stayed for as long as the banner did.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), LABEL_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const sourceLabel = senderName || source;
  const issuedLabel = formatIssued(sentAt, t, now);
  const expiresLabel = formatExpires(expiresAt, lang, t, now);

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
