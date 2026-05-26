import React, { useContext, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { InlineIcon } from "@iconify/react";
import closeIcon from "@iconify/icons-carbon/close";
import chevronDown from "@iconify/icons-carbon/chevron-down";
import { AppContext } from "~/AppContext";
import SourceBadge from "~/components/ambient/SourceBadge";
import ConfidencePill from "~/components/ambient/ConfidencePill";
import SeverityChip from "~/components/ambient/SeverityChip";
import AlertMetaChips from "~/components/ambient/AlertMetaChips";
import useDismissedAlerts from "~/hooks/useDismissedAlerts";
import {
  isCurrentlyPrecipitating,
  getRadarAlertState,
} from "~/ui/alertLogic";
import styles from "./styles.css";

/**
 * Direction C variant of the persistent text alert banner —
 * v3.1 Phase 4 head row.
 *
 * Two distinct render branches:
 *
 *   1. **Government alert** (NWS / ECCC) — full Phase 4 head:
 *      severity chip + title + chevron + meta chips row. The
 *      whole head is clickable: tap toggles `govAlertExpanded`
 *      in AppContext, which `AlertDetailInline` reads to show/
 *      hide the body. Replaces the pre-4 layout of "chips row
 *      with SourceBadge + cycle badge above title".
 *
 *   2. **Radar-derived alert** — keeps the v3.0 slab visual
 *      (chips + title, no expansion). Radar alerts don't have
 *      structured detail to expand into, so the head IS the whole
 *      surface and there's no chevron.
 *
 * Returns `null` when there is no eligible alert — same SHOW gate
 * as v3.0.
 *
 * @returns {JSX.Element|null} the banner, or null when no alert
 *   is active
 */
const AlertBanner = () => {
  const {
    innerRisk, outerRisk,
    innerTrend, outerTrend,
    innerBumped, outerBumped,
    innerTrendConfidence, outerTrendConfidence,
    govAlerts,
    govAlertIdx,
    govAlertExpanded,
    setGovAlertExpanded,
    currentWeatherData,
  } = useContext(AppContext);
  const { t, i18n } = useTranslation();
  const { isDismissed, dismiss } = useDismissedAlerts();

  // Filter user-dismissed alerts before the eligibility / cycling
  // logic. Severity escalations re-surface via useDismissedAlerts
  // (the 4 h auto-resurface floor lives there too) so silencing
  // never goes "stuck closed" on an escalating event.
  const visibleGovAlerts = useMemo(
    () => (Array.isArray(govAlerts) ? govAlerts.filter((a) => !isDismissed(a)) : []),
    [govAlerts, isDismissed],
  );

  const allGovAlerts = visibleGovAlerts;
  const hasEligibleGovAlert = useMemo(
    () => allGovAlerts.some((a) => a?.tier === "red" || a?.tier === "orange"),
    [allGovAlerts],
  );

  if (hasEligibleGovAlert && allGovAlerts.length > 0) {
    const safeIdx = govAlertIdx % allGovAlerts.length;
    const currentAlert = allGovAlerts[safeIdx];
    const lang = (i18n.language || "en").slice(0, 2);
    const title = lang === "fr" ? currentAlert.title_fr : currentAlert.title_en;
    const hasOthers = allGovAlerts.length > 1;

    // v3.1 Phase 4c: the head row is the toggle for
    // `AlertDetailInline` — tap anywhere in the head expands /
    // collapses the body. Multi-alert navigation has moved out
    // of the head entirely (the cycle pill is gone) and into
    // the `AlertMiniCards` list rendered as a sibling below.
    // Here the counter on the meta-chips row stays as a passive
    // text label so the user still sees "1 / 3 active alerts"
    // without it looking like a button.
    const toggleExpanded = () => setGovAlertExpanded(!govAlertExpanded);
    const onKeyDown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleExpanded();
      }
    };

    return (
      <div
        className={`${styles.banner} ${styles[`tier-${currentAlert.tier}`]} ${styles.govAlert}`}
        data-state={govAlertExpanded ? "expanded" : "collapsed"}
      >
        {/* Clickable head — severity chip + title + chevron, then
         * meta-chips row under. The whole head is the toggle so the
         * user doesn't have to aim at the small chevron (design's
         * F15 fix). */}
        <div
          className={styles.head}
          role="button"
          tabIndex={0}
          onClick={toggleExpanded}
          onKeyDown={onKeyDown}
          aria-expanded={govAlertExpanded}
          aria-label={t(govAlertExpanded ? "alert.collapseRow" : "alert.expandRow")}
        >
          <div className={styles.topRow}>
            <SeverityChip severity={currentAlert.severity} />
            <div className={styles.title}>{title}</div>
            <InlineIcon icon={chevronDown} className={styles.chevron} />
          </div>
          {/* Meta-chips row + (when multiple alerts) a passive
           * informational counter on the right. The counter
           * mirrors the design's footer counter — it tells the
           * user how many active alerts exist without doubling
           * as a control. Cycling/navigation between alerts lives
           * in the sibling `AlertMiniCards` list below this
           * banner; tapping a mini-card makes that alert the
           * primary one. */}
          <div className={styles.metaRow}>
            <AlertMetaChips
              source={currentAlert.source}
              senderName={currentAlert.senderName}
              sentAt={currentAlert.sentAt}
              expiresAt={currentAlert.expiresAt}
            />
            {hasOthers && (
              <span
                className={styles.counter}
                aria-label={t("alert.activeAlertsCount", {
                  current: safeIdx + 1,
                  count: allGovAlerts.length,
                })}
              >
                {t("alert.activeAlertsCount", {
                  current: safeIdx + 1,
                  count: allGovAlerts.length,
                })}
              </span>
            )}
          </div>
        </div>

        {/* Dismiss (✕) — top-right, same behaviour as before.
         * stopPropagation so a tap doesn't also toggle the head. */}
        <button
          type="button"
          className={styles.dismissBtn}
          onClick={(e) => { e.stopPropagation(); dismiss(currentAlert); }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") e.stopPropagation();
          }}
          aria-label={t("alert.dismiss", { defaultValue: "Dismiss" })}
          title={t("alert.dismissTooltip", { defaultValue: "Hide for 4 h (re-surfaces if it escalates)" })}
        >
          <InlineIcon icon={closeIcon} />
        </button>
      </div>
    );
  }

  // Radar-derived alert — keeps the pre-4 chips-row + title
  // visual (no severity chip, no expansion). RADAR is a derived
  // source with no upstream "structured body" to expand into.
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
      <div className={styles.title}>{t(radarState.i18nKey)}</div>
    </div>
  );
};

export default AlertBanner;
