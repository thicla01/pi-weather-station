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
 * its tier (v1 — heavy precip is actually present), was bumped one notch
 * by the v2 trend logic (intensity below the natural threshold +
 * trend === "approaching"), or is currently moving away (trend ===
 * "leaving"). Softening rules:
 *   - v2-bumped → "précipitations approchent" — saying "fortes" when the
 *     actual measured intensity is 1 would be misleading; the threat is
 *     "a band is moving in fast", not "heavy rain is here".
 *   - leaving → "{tier} mais s'éloignent" — the dashed-circle tier still
 *     reflects the present intensity, but the banner copy shouldn't read
 *     alarmist for a band already on its way out (the morning false-positive
 *     screenshot from May 5 captured this exact case).
 *
 * @param {String|null} innerRisk
 * @param {String|null} outerRisk
 * @param {String} innerTrend "approaching" | "leaving" | "stable"
 * @param {String} outerTrend "approaching" | "leaving" | "stable"
 * @param {Number} innerMaxIntensity 0-6
 * @param {Number} outerMaxIntensity 0-6
 * @returns {{tier: String, i18nKey: String} | null} Banner state, or null when no alert needs to be shown
 */
function getRadarAlertState(innerRisk, outerRisk, innerTrend, outerTrend, innerMaxIntensity, outerMaxIntensity) {
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
  if (sourceTrend === "leaving") {
    return { tier, i18nKey: `alert.${tier}Leaving` };
  }
  // Existing wording: "near" when inner is the source, "approaching"
  // (location-based, not trend-based) when outer is.
  const i18nKey = `alert.${tier}${innerIsSource ? "Near" : "Approaching"}`;
  return { tier, i18nKey };
}

/**
 * Pick the highest-severity government alert eligible for banner
 * display. We surface only orange/red tiers — minor/yellow advisories
 * fire often enough (small craft advisories, frost watches) that
 * promoting them to a permanent banner would devalue the louder ones.
 * Returns null when no alert clears the bar.
 *
 * @param {Array<Object>} govAlerts Sorted by severity server-side
 * @returns {Object|null} The first orange/red alert, or null when nothing qualifies
 */
function pickGovBanner(govAlerts) {
  if (!Array.isArray(govAlerts)) return null;
  for (const a of govAlerts) {
    if (a?.tier === "red" || a?.tier === "orange") return a;
  }
  return null;
}

/**
 * Persistent text alert banner shown in the InfoPanel. A government
 * alert from NWS or ECCC outranks the radar-derived tier — when one is
 * active at orange/red severity, its localized title plus a source
 * badge ("NWS" / "ECCC") replaces the radar wording. Otherwise the
 * radar-tier banner from the original logic still drives the display.
 * Hidden when neither source has anything to surface.
 *
 * @returns {JSX.Element|null} Banner, or null when no alert is active
 */
const AlertBanner = () => {
  const {
    innerRisk, outerRisk,
    innerTrend, outerTrend,
    innerMaxIntensity, outerMaxIntensity,
    govAlerts,
  } = useContext(AppContext);
  const { t, i18n } = useTranslation();

  const govAlert = pickGovBanner(govAlerts);
  if (govAlert) {
    // The gov payload carries title_en and title_fr; ECCC publishes
    // both natively, NWS mirrors EN into FR. Spanish has no native
    // upstream, so it falls back to English.
    const lang = (i18n.language || "en").slice(0, 2);
    const title = lang === "fr" ? govAlert.title_fr : govAlert.title_en;
    return (
      <div className={`${styles.banner} ${styles[govAlert.tier]}`}>
        <span className={styles.sourceBadge}>{govAlert.source}</span>
        {title}
      </div>
    );
  }

  const radarState = getRadarAlertState(
    innerRisk, outerRisk,
    innerTrend, outerTrend,
    innerMaxIntensity, outerMaxIntensity,
  );
  if (!radarState) return null;
  return (
    <div className={`${styles.banner} ${styles[radarState.tier]}`}>
      {t(radarState.i18nKey)}
    </div>
  );
};

export default AlertBanner;
