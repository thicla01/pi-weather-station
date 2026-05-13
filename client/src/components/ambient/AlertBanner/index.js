import React, { useContext, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { AppContext } from "~/AppContext";
import SourceBadge from "~/components/ambient/SourceBadge";
import ConfidencePill from "~/components/ambient/ConfidencePill";
import {
  isCurrentlyPrecipitating,
  getRadarAlertState,
} from "~/ui/alertLogic";
import styles from "./styles.css";

/**
 * Direction C variant of the persistent text alert banner.
 *
 * Same data flow and state machine as the v2 banner (`AlertBanner` —
 * pure logic is shared via `ui/alertLogic.js`), but the visual
 * treatment is different:
 *
 *   - Slab-style surface (warm-grey palette) instead of a flat
 *     coloured banner. The tier is communicated via a left-edge
 *     **severity strip** in `warn` (orange tier) or `danger` (red
 *     tier) — not a full-banner colour wash. This keeps the chrome
 *     calm even when something serious is active; the strip is the
 *     loud part.
 *   - `SourceBadge` and `ConfidencePill` come from `ambient/*`
 *     atomic components instead of inline spans. They render against
 *     the slab surface and pick up the active palette automatically.
 *   - Cycling (`+N`) for multi-alert situations is preserved.
 *
 * Returns `null` when there is no eligible alert — same SHOW gate as
 * v2: government alerts surface at orange/red severity, radar-derived
 * alerts surface when the worst ring is at orange/red.
 *
 * @returns {JSX.Element|null} the banner, or null when no alert is active
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

  const allGovAlerts = useMemo(
    () => (Array.isArray(govAlerts) ? govAlerts : []),
    [govAlerts],
  );
  const hasEligibleGovAlert = useMemo(
    () => allGovAlerts.some((a) => a?.tier === "red" || a?.tier === "orange"),
    [allGovAlerts],
  );

  if (hasEligibleGovAlert && allGovAlerts.length > 0) {
    const safeIdx = govAlertIdx % allGovAlerts.length;
    const currentAlert = allGovAlerts[safeIdx];
    const lang = (i18n.language || "en").slice(0, 2);
    const title = lang === "fr" ? currentAlert.title_fr : currentAlert.title_en;
    const extras = allGovAlerts.length - 1;
    const cyclable = extras > 0;
    const handleClick = cyclable ? cycleGovAlert : undefined;
    const handleKey = cyclable
      ? (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          cycleGovAlert();
        }
      }
      : undefined;
    return (
      <div
        className={`${styles.banner} ${styles[`tier-${currentAlert.tier}`]} ${cyclable ? styles.cyclable : ""}`}
        onClick={handleClick}
        onKeyDown={handleKey}
        role={cyclable ? "button" : undefined}
        tabIndex={cyclable ? 0 : undefined}
        aria-label={cyclable ? t("alert.cycleAria", { count: allGovAlerts.length }) : undefined}
      >
        <div className={styles.chips}>
          <SourceBadge source={currentAlert.source} />
          {cyclable && <span className={styles.cycleBadge}>+{extras}</span>}
        </div>
        <div
          className={styles.title}
          data-source={currentAlert.source}
          data-tier={currentAlert.tier}
          style={{ color: "lime", fontSize: "18px", fontWeight: "bold", minHeight: "30px" }}
        >
          GOV-DEBUG[{currentAlert.source}/{currentAlert.tier}]: {title || "(empty title)"}
        </div>
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

  return (
    <div className={`${styles.banner} ${styles[`tier-${radarState.tier}`]}`}>
      <div className={styles.chips}>
        <SourceBadge source="RADAR" />
        <ConfidencePill confidence={radarState.confidence} />
      </div>
      <div
        className={styles.title}
        data-i18n-key={radarState.i18nKey}
        data-tier={radarState.tier}
        data-bucket={radarState.confidenceBucket}
        style={{ color: "lime", fontSize: "18px", fontWeight: "bold", minHeight: "30px" }}
      >
        DEBUG[{String(radarState.i18nKey)}]:{" "}{t(radarState.i18nKey) || "(empty translation)"}
      </div>
    </div>
  );
};

export default AlertBanner;
