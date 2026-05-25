import React from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import styles from "./styles.css";

/**
 * Map a gov-alert `severity` value (NWS / ECCC vocabulary) to the
 * v3.1 design's three-tier scheme — advisory / watch / warning. The
 * design intentionally collapses any "emergency"-class label into
 * "warning" visually (the wall-of-red treatment carries the urgency;
 * the chip's purpose is to be a calm signal that sorts the list).
 *
 * Returns the tier slug used as both:
 *   - the CSS class (`tier-${slug}` → palette colour tokens
 *     `--sev-${slug}-bg/border/ink`)
 *   - the i18n suffix (`alert.severity${Capitalised}`)
 *
 * @param {string} severity - One of "minor" | "moderate" | "severe" | "extreme"
 * @returns {"advisory"|"watch"|"warning"} tier slug
 */
function severityToTierSlug(severity) {
  switch (severity) {
    case "minor":    return "advisory";
    case "moderate": return "watch";
    case "severe":   return "warning";
    case "extreme":  return "warning";
    default:         return "advisory";
  }
}

/**
 * Severity chip — triangle icon + uppercase label, palette-coloured
 * by the alert's tier. Used as the leading marker in the v3.1
 * AlertBanner head row, and as the leading badge in the mini-card
 * list of other active alerts (Phase 4c).
 *
 * Three signals carried simultaneously per the design's F17 finding:
 *   1. Shape — triangle icon reads as "warning" universally
 *   2. Colour — yellow / orange / red palette via `--sev-*` tokens
 *   3. Word — the localized label itself ("Watch" / "Veille" /
 *      "Vigilancia")
 *
 * The triple redundancy survives:
 *   - night-red palette (all severity colours collapse to red — the
 *     icon + word still discriminate)
 *   - colour blindness (red/green/yellow/orange aren't distinguish-
 *     able for some users — the icon + word still discriminate)
 *
 * @param {object} props
 * @param {string} props.severity - "minor" | "moderate" | "severe" | "extreme"
 * @param {boolean} [props.compact] - When true, render label-less for
 *   tight spaces (mini-card list). Default false — full icon + label.
 * @returns {JSX.Element} the chip
 */
const SeverityChip = ({ severity, compact = false }) => {
  const { t } = useTranslation();
  const tier = severityToTierSlug(severity);
  const labelKey = `alert.severity${tier.charAt(0).toUpperCase() + tier.slice(1)}`;
  return (
    <span
      className={`${styles.chip} ${styles[`tier-${tier}`]}`}
      data-severity={tier}
      title={t(labelKey)}
    >
      {/* Triangle with exclamation mark — same SVG shape the design's
       * `.severity-chip svg` uses, kept inline so the icon family
       * stays consistent with the rest of the chip and follows
       * `currentColor` from the palette tier rules. */}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
        <path d="M12 2 L 22 20 L 2 20 Z" strokeLinejoin="round" />
        <line x1="12" y1="9" x2="12" y2="14" strokeLinecap="round" />
        <circle cx="12" cy="17.5" r="0.5" fill="currentColor" />
      </svg>
      {!compact && <span className={styles.label}>{t(labelKey)}</span>}
    </span>
  );
};

SeverityChip.propTypes = {
  severity: PropTypes.string.isRequired,
  compact: PropTypes.bool,
};

export default SeverityChip;
