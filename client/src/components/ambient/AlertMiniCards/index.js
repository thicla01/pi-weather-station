import React, { useContext, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { InlineIcon } from "@iconify/react";
import chevronRight from "@iconify/icons-carbon/chevron-right";
import undoIcon from "@iconify/icons-carbon/undo";
import { AppContext } from "~/AppContext";
import SeverityChip from "~/components/ambient/SeverityChip";
import useDismissedAlerts from "~/hooks/useDismissedAlerts";
import styles from "./styles.css";

// Severity-to-rank table for the descending sort in the component
// below. The numeric ordering means a warning (3) sorts before a
// watch (2) sorts before an advisory (1). Matches the orchestrator's
// CAP vocabulary (server/govAlertSources/_shared.js). Ties on
// severity are broken by expiration time — alerts expiring sooner
// sit higher because the user is more likely to want to act on
// those first.
const SEVERITY_RANK = {
  extreme: 4,
  severe: 3,
  moderate: 2,
  minor: 1,
};

/**
 * v3.1 Phase 4c — list of OTHER active gov alerts (those not
 * currently shown as the primary banner card), sorted by
 * severity descending. Each mini-card carries:
 *
 *   - A `SeverityChip` (icon + tier label)
 *   - The alert's title (localized, single-line, ellipsis)
 *   - A chevron pointing right ("tap to open")
 *   - A tier-coloured left border (mirrors the primary card's
 *     severity strip)
 *
 * Tapping a card calls `selectGovAlert(originalIdx)` which makes
 * that alert the primary one. The current primary then either
 * moves down into the mini-cards list (if it's still active and
 * not dismissed) or disappears (if it expired or was dismissed).
 *
 * Replaces the cycle pill in `AlertBanner` as the user-facing
 * multi-alert navigation surface. Renders nothing when there is
 * 0 or 1 active eligible alert (the head IS the whole UX in
 * those cases).
 *
 * A "Restore N hidden alerts" pill at the bottom calls
 * `restoreAll()` from `useDismissedAlerts` when the user wants
 * to recover dismissals — the UX recovery path that 4a feedback
 * surfaced as missing.
 *
 * @returns {JSX.Element|null} mini-cards list + optional restore
 *   pill, or null when there's nothing to render
 */
const AlertMiniCards = () => {
  const { govAlerts, govAlertIdx, selectGovAlert } = useContext(AppContext);
  const { t, i18n } = useTranslation();
  const { isDismissed, restoreAll, dismissedCount } = useDismissedAlerts();
  const lang = (i18n.language || "en").slice(0, 2);

  // Same filter chain AlertBanner runs — keep the two components
  // synchronised so neither shows an alert the other has hidden.
  const visibleGovAlerts = useMemo(
    () => (Array.isArray(govAlerts) ? govAlerts.filter((a) => !isDismissed(a)) : []),
    [govAlerts, isDismissed],
  );
  const hasEligible = useMemo(
    () => visibleGovAlerts.some((a) => a?.tier === "red" || a?.tier === "orange"),
    [visibleGovAlerts],
  );

  // Compute the primary alert the SAME way AlertBanner does — by
  // visibleGovAlerts index, NOT by govAlerts absolute index.
  // AlertBanner: `safeIdx = govAlertIdx % visibleGovAlerts.length`
  // → primary = `visibleGovAlerts[safeIdx]`. If we filter mini-cards
  // by absolute govAlerts index instead, dismissals shift the visible
  // position and the primary appears BOTH at the top AND as a
  // mini-card (the duplicate bug field-tested 2026-05-25). Filter by
  // object identity to stay in lockstep with the banner.
  const primaryAlert = useMemo(() => {
    if (!hasEligible || visibleGovAlerts.length === 0) return null;
    const safeIdx = govAlertIdx % visibleGovAlerts.length;
    return visibleGovAlerts[safeIdx];
  }, [hasEligible, visibleGovAlerts, govAlertIdx]);

  // Other eligible alerts (red/orange tier, not the primary). We
  // record each alert's position in `visibleGovAlerts` because that's
  // what `selectGovAlert` needs to set as `govAlertIdx` — AlertBanner
  // re-mods by visibleGovAlerts.length, so any value in [0, len) maps
  // directly to a unique alert in the visible list.
  const ranked = useMemo(() => {
    const others = visibleGovAlerts
      .map((alert, visibleIdx) => ({ alert, visibleIdx }))
      .filter(({ alert }) => (
        (alert?.tier === "red" || alert?.tier === "orange")
        && alert !== primaryAlert
      ));
    // Sort the OTHERS by severity desc (warning > watch > advisory),
    // keeping their visibleIdx unchanged so tap → selectGovAlert
    // still lands on the right alert.
    return others
      .map((entry) => ({
        alert: entry.alert,
        visibleIdx: entry.visibleIdx,
        rank: SEVERITY_RANK[entry.alert.severity] || 0,
      }))
      .sort((a, b) => {
        if (a.rank !== b.rank) return b.rank - a.rank;
        return String(a.alert.expiresAt || "").localeCompare(String(b.alert.expiresAt || ""));
      });
  }, [visibleGovAlerts, primaryAlert]);

  const hasMiniCards = ranked.length > 0;
  const hasDismissals = dismissedCount > 0;
  if (!hasMiniCards && !hasDismissals) return null;

  return (
    <div className={styles.container}>
      {hasMiniCards && (
        <ul className={styles.list}>
          {ranked.map(({ alert, visibleIdx }) => {
            const title = lang === "fr" ? alert.title_fr : alert.title_en;
            return (
              <li
                key={alert.id || `${visibleIdx}-${alert.title_en}`}
                className={`${styles.card} ${styles[`tier-${alert.tier}`]}`}
                role="button"
                tabIndex={0}
                onClick={() => selectGovAlert(visibleIdx)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    selectGovAlert(visibleIdx);
                  }
                }}
                aria-label={t("alert.selectAlertAria")}
              >
                <SeverityChip severity={alert.severity} />
                <span className={styles.title}>{title}</span>
                <InlineIcon icon={chevronRight} className={styles.chevron} />
              </li>
            );
          })}
        </ul>
      )}
      {hasDismissals && (
        <button
          type="button"
          className={styles.restoreBtn}
          onClick={() => restoreAll()}
          aria-label={t("alert.restoreDismissedAria")}
          title={t("alert.restoreDismissedAria")}
        >
          <InlineIcon icon={undoIcon} className={styles.restoreIcon} />
          {t("alert.restoreDismissed", { count: dismissedCount })}
        </button>
      )}
    </div>
  );
};

export default AlertMiniCards;
