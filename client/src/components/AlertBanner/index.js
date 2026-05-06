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

/**
 * Pick the i18n key for the banner based on which ring is the source of
 * the worst tier and whether that source is showing a real intensity at
 * its tier (v1 — heavy precip is actually present), was bumped one notch
 * by the v2 trend logic, or is currently moving away. Softening rules:
 *   - bumped (server says trend pushed the tier up) → "précipitations
 *     approchent" — saying "fortes" when the bump came from trend rather
 *     than sustained heavy intensity would be misleading; the threat is
 *     "a band is moving in fast", not "heavy rain is here".
 *   - leaving → "{tier} mais s'éloignent" — the dashed-circle tier still
 *     reflects the present intensity, but the banner copy shouldn't read
 *     alarmist for a band already on its way out (the morning false-positive
 *     screenshot from May 5 captured this exact case).
 *
 * The bumped boolean comes straight from the server now — it used to be
 * derived client-side from `level vs naturalTier(maxIntensity)`, but
 * once hysteresis decoupled tier from raw max intensity that derivation
 * stopped being reliable. The server already knows whether it bumped,
 * so it just tells us.
 *
 * @param {String|null} innerRisk
 * @param {String|null} outerRisk
 * @param {String} innerTrend "approaching" | "leaving" | "stable"
 * @param {String} outerTrend "approaching" | "leaving" | "stable"
 * @param {Boolean} innerBumped Server flag — inner tier bumped by trend
 * @param {Boolean} outerBumped Server flag — outer tier bumped by trend
 * @returns {{tier: String, i18nKey: String} | null} Banner state, or null when no alert needs to be shown
 */
function getRadarAlertState(innerRisk, outerRisk, innerTrend, outerTrend, innerBumped, outerBumped) {
  const innerSev = severity(innerRisk);
  const outerSev = severity(outerRisk);
  const maxSev = Math.max(innerSev, outerSev);
  if (maxSev < 2) return null; // calm or yellow → no banner

  const tier = maxSev === 3 ? "red" : "orange";
  const innerIsSource = innerSev === maxSev;
  const sourceTrend = innerIsSource ? innerTrend : outerTrend;
  const sourceBumped = innerIsSource ? innerBumped : outerBumped;
  if (sourceBumped) {
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
    innerBumped, outerBumped,
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
    innerBumped, outerBumped,
  );
  if (!radarState) return null;
  return (
    <div className={`${styles.banner} ${styles[radarState.tier]}`}>
      {t(radarState.i18nKey)}
    </div>
  );
};

export default AlertBanner;
