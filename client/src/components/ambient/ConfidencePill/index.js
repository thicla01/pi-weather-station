import React from "react";
import PropTypes from "prop-types";
import styles from "./styles.css";
import { confidenceBucket } from "~/ui/hybrid";

/**
 * Pill displaying a 0–100 confidence percentage with a bucket-coloured
 * background — green at ≥ 70 %, amber at 40–69 %, red below 40 %.
 *
 * Direction C variant: mirrors `SourceBadge`'s pill geometry exactly so
 * the two read as a single chip-cluster when sat side by side. The
 * background tint is taken from the active palette's semantic tokens
 * (`warn` / `danger` / no special token for "high" — we use the
 * accent at low alpha because there's no `success` token by design,
 * the warm-grey palette stays calm even when things are going well).
 *
 * @param {object} props
 * @param {number} props.confidence — 0 to 100; values outside the
 *   range are clamped for display but the bucket still resolves
 *   correctly via `confidenceBucket()`.
 * @returns {JSX.Element} pill element
 */
const ConfidencePill = ({ confidence }) => {
  const clamped = Math.max(0, Math.min(100, Math.round(confidence)));
  const bucket = confidenceBucket(clamped);
  return (
    <span className={`${styles.pill} ${styles[`bucket-${bucket}`]}`}>
      {clamped}%
    </span>
  );
};

ConfidencePill.propTypes = {
  confidence: PropTypes.number.isRequired,
};

export default ConfidencePill;
