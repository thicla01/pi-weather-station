import React from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { eventProductType } from "~/ui/alertLogic";
import styles from "./styles.css";

/**
 * Map a gov-alert `severity` to the chip's COLOUR tier (low / med / high).
 * The 3-colour collapse is intentional (v3.1 design): the colour reads
 * urgency at a glance — yellow (low) / orange (med) / red (high) — while the
 * chip's WORD carries the actual product type (see the component doc). Both
 * severe and extreme collapse to the red `high` tier; an extreme alert's
 * extra urgency is carried by the wall-of-red banner, not a 4th colour.
 *
 * Returns a slug used as the CSS class (`tier-${slug}` → `--sev-${slug}-*`
 * palette tokens) and the `data-severity` attribute.
 *
 * @param {string} severity - "minor" | "moderate" | "severe" | "extreme"
 * @returns {"low"|"med"|"high"} colour-tier slug
 */
function severityToColourTier(severity) {
  switch (severity) {
    case "minor":    return "low";
    case "moderate": return "med";
    case "severe":   return "high";
    case "extreme":  return "high";
    default:         return "low";
  }
}

/**
 * Fallback WORD when the event name carries no recognizable product type
 * (rare — e.g. an ECCC payload exposing only a slug). Derives a sensible
 * word from severity, mirroring the pre-2026-06 behaviour.
 *
 * @param {string} severity - normalized severity
 * @returns {"advisory"|"watch"|"warning"} product-type word slug
 */
function severityFallbackWord(severity) {
  switch (severity) {
    case "minor":    return "advisory";
    case "moderate": return "watch";
    case "severe":   return "warning";
    case "extreme":  return "warning";
    default:         return "advisory";
  }
}

/**
 * Severity chip — triangle icon + uppercase label, palette-coloured by the
 * alert's COLOUR tier (from severity), with the WORD reflecting the actual
 * NWS / ECCC PRODUCT TYPE (Warning / Watch / Advisory / Statement) parsed
 * from the event name. Decoupling the two fixes the long-standing mislabel
 * where a Heat *Advisory* (CAP severity Moderate → orange) printed "Veille"
 * (watch) just because moderate mapped to the watch tier: it now reads
 * "Avis", in orange. When the product type can't be parsed, the word falls
 * back to a severity-derived word.
 *
 * Three signals carried simultaneously (design F17):
 *   1. Shape  — triangle icon reads as "warning" universally
 *   2. Colour — low / med / high palette via `--sev-*` tokens (from severity)
 *   3. Word   — the localized product type ("Watch" / "Veille" / …)
 * The triple redundancy survives night-red (all colours collapse to red —
 * icon + word still discriminate) and colour blindness.
 *
 * @param {object} props
 * @param {string} props.severity - "minor" | "moderate" | "severe" | "extreme"
 * @param {string} [props.eventName] - the alert's English event name
 *   (`title_en` / `eventType`); drives the product-type word. Default "".
 * @param {boolean} [props.compact] - When true, render label-less for tight
 *   spaces (mini-card list). Default false — full icon + label.
 * @returns {JSX.Element} the chip
 */
const SeverityChip = ({ severity, eventName = "", compact = false }) => {
  const { t } = useTranslation();
  const colourTier = severityToColourTier(severity);
  const word = eventProductType(eventName) || severityFallbackWord(severity);
  const labelKey = `alert.severity${word.charAt(0).toUpperCase() + word.slice(1)}`;
  return (
    <span
      className={`${styles.chip} ${styles[`tier-${colourTier}`]}`}
      data-severity={colourTier}
      title={t(labelKey)}
    >
      {/* Triangle with exclamation mark — same SVG shape the design's
       * `.severity-chip svg` uses, kept inline so the icon family stays
       * consistent with the rest of the chip and follows `currentColor`
       * from the palette tier rules. */}
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
  eventName: PropTypes.string,
  compact: PropTypes.bool,
};

export default SeverityChip;
