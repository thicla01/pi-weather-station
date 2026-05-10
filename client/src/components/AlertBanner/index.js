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
 * True when the user's current weather code reports active precipitation —
 * rain, snow, freezing rain, ice pellets, or thunderstorm. Used to choose
 * "intensifying" wording over "approaching" wording when the trend-bump
 * fires while precipitation is already falling at the location (otherwise
 * the banner reads as a contradiction: "approaching" while the user can
 * see rain on the radar tile right under the marker, on the chart, and
 * out the window).
 *
 * Tomorrow.io codes — see https://docs.tomorrow.io/reference/data-layers-weather-codes
 *   4000-4201  drizzle / rain (light, moderate, heavy)
 *   5000-5101  snow / flurries
 *   6000-6201  freezing rain / drizzle
 *   7000-7102  ice pellets
 *   8000       thunderstorm
 *
 * @param {Number|undefined} weatherCode Current Tomorrow.io weather code
 * @returns {Boolean} True iff the code indicates active precipitation
 */
function isCurrentlyPrecipitating(weatherCode) {
  if (typeof weatherCode !== "number") return false;
  if (weatherCode >= 4000 && weatherCode <= 4201) return true;
  if (weatherCode >= 5000 && weatherCode <= 5101) return true;
  if (weatherCode >= 6000 && weatherCode <= 6201) return true;
  if (weatherCode >= 7000 && weatherCode <= 7102) return true;
  if (weatherCode === 8000) return true;
  return false;
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
 * @param {Boolean} currentlyPrecipitating Whether Tomorrow.io reports
 *   active precipitation right now at the user's location. Disambiguates
 *   the bumped-tier wording: "approaching" when the user is dry and a
 *   severe band is moving in, "intensifying" when they're already in
 *   precipitation and a worse band is moving in.
 * @returns {{tier: String, i18nKey: String} | null} Banner state, or null when no alert needs to be shown
 */
// Confidence buckets used to soften wording and colour the confidence pill.
// Thresholds tuned around the natural breakpoints in computeTrendConfidence:
//   - high (≥70) typically means inward shift well above threshold AND
//     monotonic across the mid frame AND intensity persistence;
//   - mid (40-69) usually means one of those three factors is missing;
//   - low (<40) means the data only barely supports the label, often a
//     direction sitting near the unit-aware threshold.
const CONFIDENCE_HIGH = 70;
const CONFIDENCE_MID = 40;
function confidenceBucket(c) {
  if (c >= CONFIDENCE_HIGH) return "high";
  if (c >= CONFIDENCE_MID) return "mid";
  return "low";
}

/**
 * Pick the i18n key + confidence bucket for the banner. Adds two layers
 * on top of the original logic:
 *   1. The trend-derived wording can be softened ("Hedged" suffix) when
 *      confidence sits in the middle bucket — the data points the right
 *      way but doesn't overwhelm the threshold.
 *   2. When confidence is below the low cutoff, the trend label is
 *      considered too weak to drive the wording at all and we fall back
 *      to the position-only wording (`Near` / `Approaching` by ring),
 *      same as if no trend signal had been computed. The banner still
 *      shows up — the tier is real — but doesn't claim a movement
 *      direction it isn't sure of.
 *
 * @param {String|null} innerRisk
 * @param {String|null} outerRisk
 * @param {String} innerTrend
 * @param {String} outerTrend
 * @param {Boolean} innerBumped
 * @param {Boolean} outerBumped
 * @param {Number} innerTrendConfidence 0-100
 * @param {Number} outerTrendConfidence 0-100
 * @param {Boolean} currentlyPrecipitating
 * @returns {{tier: String, i18nKey: String, confidence: Number, confidenceBucket: String} | null}
 */
function getRadarAlertState(innerRisk, outerRisk, innerTrend, outerTrend, innerBumped, outerBumped, innerTrendConfidence, outerTrendConfidence, currentlyPrecipitating) {
  const innerSev = severity(innerRisk);
  const outerSev = severity(outerRisk);
  const maxSev = Math.max(innerSev, outerSev);
  if (maxSev < 2) return null; // calm or yellow → no banner

  const tier = maxSev === 3 ? "red" : "orange";
  const innerIsSource = innerSev === maxSev;
  const sourceTrend = innerIsSource ? innerTrend : outerTrend;
  const sourceBumped = innerIsSource ? innerBumped : outerBumped;
  const confidence = Math.max(0, Math.min(100, Math.round(
    innerIsSource ? innerTrendConfidence : outerTrendConfidence,
  )));
  const bucket = confidenceBucket(confidence);

  if (sourceBumped) {
    // The bump means the analyzer raised the tier one notch because a
    // more severe band is approaching from elsewhere. Two distinct
    // user contexts to differentiate:
    //   - currently dry → "approaching" reads naturally
    //   - currently wet → "intensifying" — saying "approaching" while
    //     rain is falling at the marker is a contradiction (observed
    //     in the May 9 St. Louis screenshot: red ring + bumped, user
    //     in 98%-prob rain, banner read "Precipitation approaching"
    //     with rain visibly hammering the area on the radar). The new
    //     "intensifying" wording is semantically accurate (the bump
    //     does signal "things are about to get worse") and matches
    //     what the user is actually experiencing. Bumped wording is not
    //     hedged — the bump itself already encodes "the analyzer thinks
    //     this is real enough to escalate the tier".
    const variant = currentlyPrecipitating ? "Intensifying" : "Approaching";
    return { tier, i18nKey: `alert.${tier}${variant}`, confidence, confidenceBucket: bucket };
  }

  if (bucket === "low") {
    // Trend signal too weak to claim a direction — fall back to
    // position-only wording (same as the no-bump, stable path).
    const i18nKey = `alert.${tier}${innerIsSource ? "Near" : "Approaching"}`;
    return { tier, i18nKey, confidence, confidenceBucket: bucket };
  }

  if (sourceTrend === "leaving") {
    const suffix = bucket === "mid" ? "LeavingHedged" : "Leaving";
    return { tier, i18nKey: `alert.${tier}${suffix}`, confidence, confidenceBucket: bucket };
  }

  if (sourceTrend === "approaching") {
    const suffix = bucket === "mid" ? "ApproachingHedged" : "Approaching";
    return { tier, i18nKey: `alert.${tier}${suffix}`, confidence, confidenceBucket: bucket };
  }

  // Existing wording: "near" when inner is the source, "approaching"
  // (location-based, not trend-based) when outer is.
  const i18nKey = `alert.${tier}${innerIsSource ? "Near" : "Approaching"}`;
  return { tier, i18nKey, confidence, confidenceBucket: bucket };
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
 * Persistent text alert banner shown in the InfoPanel. Every banner
 * carries a leading source badge so the user can distinguish between
 * authoritative government alerts and the project's own radar-derived
 * detection:
 *   - "ECCC" — Environment and Climate Change Canada (official Canadian alerts)
 *   - "NWS"  — US National Weather Service (official US alerts)
 *   - "RADAR" — derived locally from RainViewer pixel analysis via radarAnalyzerCtrl
 *
 * A government alert outranks the radar-derived tier — when one is
 * active at orange/red severity, its localized title with the gov
 * source badge replaces the radar wording. Otherwise the radar-tier
 * banner with the RADAR badge surfaces. Hidden when neither source has
 * anything to surface.
 *
 * @returns {JSX.Element|null} Banner, or null when no alert is active
 */
const AlertBanner = () => {
  const {
    innerRisk, outerRisk,
    innerTrend, outerTrend,
    innerBumped, outerBumped,
    innerTrendConfidence, outerTrendConfidence,
    govAlerts,
    currentWeatherData,
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

  const weatherCode = currentWeatherData?.data?.timelines?.[0]?.intervals?.[0]?.values?.weatherCode;
  const radarState = getRadarAlertState(
    innerRisk, outerRisk,
    innerTrend, outerTrend,
    innerBumped, outerBumped,
    innerTrendConfidence, outerTrendConfidence,
    isCurrentlyPrecipitating(weatherCode),
  );
  if (!radarState) return null;
  // Confidence pill colour follows the bucket: green (high) → yellow (mid)
  // → orange (low). Saturation is intentionally bumped above the banner
  // background's so the low-confidence orange pill stays distinguishable
  // on the orange-tier banner. CSS class is composed (`confidenceBadge` +
  // `confidenceHigh|Mid|Low`) so the base pill geometry stays in one
  // place and only the colour changes per bucket.
  const confidenceClass = `${styles.confidenceBadge} ${styles[`confidence${radarState.confidenceBucket.charAt(0).toUpperCase()}${radarState.confidenceBucket.slice(1)}`]}`;
  return (
    <div className={`${styles.banner} ${styles[radarState.tier]}`}>
      <span className={styles.sourceBadge}>RADAR</span>
      <span className={confidenceClass}>{radarState.confidence}%</span>
      {t(radarState.i18nKey)}
    </div>
  );
};

export default AlertBanner;
