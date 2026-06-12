import React from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import styles from "./styles.css";

// Gap (in display-unit degrees) from which the signed delta chip is
// appended. Below the threshold the line shows the value alone — the
// 2° gate controls the ornament, never the line's presence (v2.15.16
// always-on ruling, reaffirmed in the P2 v2.1 handoff §4).
const DELTA_CHIP_THRESHOLD = 2;

/**
 * Always-on feels-like line — `RESSENTI 6° −6°` (v3.1 Phase 2).
 *
 * Shared by `HeroBand` (desktop) and `HeroCompact` (Pi / mobile) so
 * the delta-chip rule lives in exactly one place. The line itself is
 * always rendered when a feels-like value exists; when the gap
 * between feels-like and the actual temperature reaches
 * `DELTA_CHIP_THRESHOLD`, a signed chip (`+3°` / `−6°`) makes the
 * gap legible at a glance. Both props arrive already converted to
 * the display unit (the threshold is intentionally unit-agnostic).
 *
 * @param {object} props
 * @param {number} props.temp — current temperature, converted (int)
 * @param {number} props.feels — feels-like temperature, converted (int)
 * @returns {JSX.Element} the feels-like line
 */
const FeelsLikeLine = ({ temp, feels }) => {
  const { t } = useTranslation();
  const delta = feels - temp;
  const showChip = Math.abs(delta) >= DELTA_CHIP_THRESHOLD;
  return (
    <span className={styles.line}>
      <span className={styles.label}>{t("weather.feelsLike")}</span>
      <span className={styles.value}>{feels}°</span>
      {showChip ? (
        <span className={styles.deltaChip}>
          {/* U+2212 minus (not hyphen) so the sign reads cleanly in
            * Geist Mono at micro size. */}
          {delta > 0 ? "+" : "−"}
          {Math.abs(delta)}°
        </span>
      ) : null}
    </span>
  );
};

FeelsLikeLine.propTypes = {
  temp: PropTypes.number.isRequired,
  feels: PropTypes.number.isRequired,
};

export default FeelsLikeLine;
