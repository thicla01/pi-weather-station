import React, { useContext } from "react";
import { useTranslation } from "react-i18next";
import { AppContext } from "~/AppContext";
import styles from "./styles.css";

/**
 * Numeric severity for risk-level comparison.
 *
 * @param {String|null} level "calm" | "yellow" | "orange" | "red" | null
 * @returns {Number} 0-3
 */
function severity(level) {
  if (level === "red") return 3;
  if (level === "orange") return 2;
  if (level === "yellow") return 1;
  return 0;
}

// What tier a given raw maxIntensity would map to without any v2 trend
// bump. Mirrors the server's RISK_LEVELS array (radarAnalyzerCtrl.js):
//   intensity 0     → calm
//   intensity 1-3   → yellow
//   intensity 4     → orange
//   intensity 5-6   → red
function naturalTier(maxIntensity) {
  if (maxIntensity >= 5) return "red";
  if (maxIntensity >= 4) return "orange";
  if (maxIntensity >= 1) return "yellow";
  return "calm";
}

/**
 * Pick the i18n key for the banner based on which ring is the source of
 * the worst tier and whether that source is showing a real intensity at
 * its tier (v1 — heavy precip is actually present) or was bumped one
 * notch by the v2 trend logic (intensity below the natural threshold +
 * trend === "approaching"). The v2-bumped case gets a softer, neutral
 * wording ("précipitations approchent") because saying "précipitations
 * fortes" when the actual measured intensity is 1 (very light) would be
 * misleading — what's happening is "a band is moving in fast", not
 * "heavy rain is here".
 *
 * @param {String|null} innerRisk
 * @param {String|null} outerRisk
 * @param {String} innerTrend "approaching" | "stable"
 * @param {String} outerTrend "approaching" | "stable"
 * @param {Number} innerMaxIntensity 0-6
 * @param {Number} outerMaxIntensity 0-6
 * @returns {{tier: String, i18nKey: String} | null} Banner state, or null when no alert needs to be shown
 */
function getAlertState(innerRisk, outerRisk, innerTrend, outerTrend, innerMaxIntensity, outerMaxIntensity) {
  const innerSev = severity(innerRisk);
  const outerSev = severity(outerRisk);
  const maxSev = Math.max(innerSev, outerSev);
  if (maxSev < 2) return null; // calm or yellow → no banner

  const tier = maxSev === 3 ? "red" : "orange";
  const innerIsSource = innerSev === maxSev;
  const sourceTrend = innerIsSource ? innerTrend : outerTrend;
  const sourceMaxIntensity = innerIsSource ? innerMaxIntensity : outerMaxIntensity;
  const sourceLevel = innerIsSource ? innerRisk : outerRisk;
  // v2 bump is when the displayed level is higher than what the raw
  // maxIntensity would map to. trend === "approaching" is the tell, but
  // we also check the level mismatch so a moving cell that ALREADY has
  // real heavy intensity keeps its "fortes" wording (it's both heavy
  // AND moving — still "fortes").
  const bumpedByV2 = sourceTrend === "approaching" && sourceLevel !== naturalTier(sourceMaxIntensity);
  if (bumpedByV2) {
    return { tier, i18nKey: "alert.approaching" };
  }
  // Existing wording: "near" when inner is the source, "approaching"
  // (location-based, not trend-based) when outer is.
  const i18nKey = `alert.${tier}${innerIsSource ? "Near" : "Approaching"}`;
  return { tier, i18nKey };
}

/**
 * Persistent text alert banner shown in the InfoPanel when the radar-risk
 * analyser reports orange or red on either ring. Hidden otherwise — this
 * component returns null when nothing needs surfacing, so it doesn't take
 * any vertical space in the calm case.
 *
 * @returns {JSX.Element|null} Banner, or null when no alert is active
 */
const AlertBanner = () => {
  const {
    innerRisk, outerRisk,
    innerTrend, outerTrend,
    innerMaxIntensity, outerMaxIntensity,
  } = useContext(AppContext);
  const { t } = useTranslation();
  const state = getAlertState(
    innerRisk, outerRisk,
    innerTrend, outerTrend,
    innerMaxIntensity, outerMaxIntensity,
  );
  if (!state) return null;
  return (
    <div className={`${styles.banner} ${styles[state.tier]}`}>
      {t(state.i18nKey)}
    </div>
  );
};

export default AlertBanner;
