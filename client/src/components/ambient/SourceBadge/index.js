import React from "react";
import PropTypes from "prop-types";
import styles from "./styles.css";

/**
 * Pill identifying the authority behind a piece of data — RADAR for
 * the local heuristic, ECCC / NWS / MELCC etc. for official feeds.
 *
 * Direction C variant: rendered against the warm-grey slab surface
 * (not against a coloured alert banner), so the pill uses the
 * `accentSoft` token for fill and `text` for the label rather than
 * the white-on-banner pattern of v2 AlertBanner.
 *
 * The label is the `source` prop rendered verbatim (uppercased via
 * CSS). Unknown sources still render — we deliberately don't
 * whitelist here because new feeds get added over time (OpenAQ,
 * AirNow, etc.) and a strict allowlist would just turn into
 * maintenance debt.
 *
 * @param {object} props
 * @param {string} props.source — short authority key ("RADAR", "ECCC",
 *   "NWS", "MELCC", "AIRNOW", "OPENAQ", etc.). Rendered as-is.
 * @returns {JSX.Element} pill element
 */
const SourceBadge = ({ source }) => (
  <span className={styles.badge}>{source}</span>
);

SourceBadge.propTypes = {
  source: PropTypes.string.isRequired,
};

export default SourceBadge;
