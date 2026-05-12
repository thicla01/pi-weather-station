import React, { useContext, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { AppContext } from "~/AppContext";
import styles from "./styles.css";
// Pure alert-state logic now lives in `ui/alertLogic.js` so the
// Direction C `ambient/AlertBanner` can render off the same machine.
// See that file for full documentation of the state transitions.
import {
  isCurrentlyPrecipitating,
  getRadarAlertState,
} from "~/ui/alertLogic";

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
 * When multiple government alerts are active at the user's point, the
 * banner becomes tappable: a "+N" pill next to the source badge
 * indicates how many additional alerts exist, and each tap cycles to
 * the next one (A → B → C → A). The cycle includes minor/yellow alerts
 * too — once the banner is shown because a severe one exists, the
 * minor ones are surfaced in the same context. The banner's background
 * colour follows the currently-displayed alert's tier, so cycling into
 * a minor alert visually softens the banner (mustard for yellow) and
 * cycling back to a severe one returns it to red. The user is never
 * shown a banner for minor-only situations — the SHOW gate still
 * requires at least one orange/red alert to keep noise down.
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
    govAlertIdx,
    cycleGovAlert,
    currentWeatherData,
  } = useContext(AppContext);
  const { t, i18n } = useTranslation();

  // Two distinct slices of the gov-alert array:
  //   - `hasEligibleGovAlert` — does the SHOW gate clear? We only show
  //     a gov banner when at least one orange/red alert is active.
  //     Minor-only situations (e.g. a single Frost Advisory) stay
  //     silent so the banner doesn't become noise.
  //   - `allGovAlerts` — the entire array, used for cycling. Once the
  //     banner is up because a severe alert is active, the user can
  //     tap to see the minor ones too in the same context.
  // govAlertIdx and cycleGovAlert live in AppContext so the new
  // GovAlertDetail section stays in lockstep with the banner's
  // current alert (tap banner → both update together).
  const allGovAlerts = useMemo(
    () => (Array.isArray(govAlerts) ? govAlerts : []),
    [govAlerts]
  );
  const hasEligibleGovAlert = useMemo(
    () => allGovAlerts.some((a) => a?.tier === "red" || a?.tier === "orange"),
    [allGovAlerts]
  );

  if (hasEligibleGovAlert && allGovAlerts.length > 0) {
    const safeIdx = govAlertIdx % allGovAlerts.length;
    const currentAlert = allGovAlerts[safeIdx];
    // The gov payload carries title_en and title_fr; ECCC publishes
    // both natively, NWS mirrors EN into FR. Spanish has no native
    // upstream, so it falls back to English.
    const lang = (i18n.language || "en").slice(0, 2);
    const title = lang === "fr" ? currentAlert.title_fr : currentAlert.title_en;
    const extras = allGovAlerts.length - 1;
    const cyclable = extras > 0;
    const handleClick = cyclable ? cycleGovAlert : undefined;
    const handleKey = cyclable
      ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); cycleGovAlert(); } }
      : undefined;
    return (
      <div
        className={`${styles.banner} ${styles[currentAlert.tier]} ${cyclable ? styles.bannerCyclable : ""}`}
        onClick={handleClick}
        onKeyDown={handleKey}
        role={cyclable ? "button" : undefined}
        tabIndex={cyclable ? 0 : undefined}
        aria-label={cyclable ? t("alert.cycleAria", { count: allGovAlerts.length }) : undefined}
      >
        <span className={styles.sourceBadge}>{currentAlert.source}</span>
        {cyclable && <span className={styles.cycleBadge}>+{extras}</span>}
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
