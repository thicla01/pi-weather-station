import React, { useContext, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { InlineIcon } from "@iconify/react";
import chevronRight from "@iconify/icons-carbon/chevron-right";
import undoIcon from "@iconify/icons-carbon/undo";
import { AppActionsContext } from "~/AppContext";
import SeverityChip from "~/components/ambient/SeverityChip";
import useDismissedAlerts from "~/hooks/useDismissedAlerts";
import useEligibleGovAlerts from "~/hooks/useEligibleGovAlerts";
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
  const { selectGovAlert } = useContext(AppActionsContext);
  const { t, i18n } = useTranslation();
  const { restoreAll, dismissedCount } = useDismissedAlerts();
  const lang = (i18n.language || "en").slice(0, 2);

  // Eligible (red/orange, non-dismissed) gov alerts and the current
  // primary, from the shared hook — same derivation AlertBanner uses,
  // so the primary never appears BOTH at the top AND as a mini-card
  // (the duplicate bug field-tested 2026-05-25) and the denominators
  // stay in lockstep.
  const { eligibleGovAlerts, currentAlert: primaryAlert } = useEligibleGovAlerts();

  // Other eligible alerts (not the primary). We record each alert's
  // index in `eligibleGovAlerts` because that's the value
  // `selectGovAlert` must set as `govAlertIdx` — AlertBanner re-mods
  // by `eligibleGovAlerts.length`, so any value in [0, len) maps
  // directly to a unique alert in the eligible list.
  const ranked = useMemo(() => {
    const others = eligibleGovAlerts
      .map((alert, eligibleIdx) => ({ alert, eligibleIdx }))
      .filter(({ alert }) => alert !== primaryAlert);
    // Sort the OTHERS by severity desc (warning > watch > advisory),
    // keeping their eligibleIdx unchanged so tap → selectGovAlert
    // still lands on the right alert.
    return others
      .map((entry) => ({
        alert: entry.alert,
        eligibleIdx: entry.eligibleIdx,
        rank: SEVERITY_RANK[entry.alert.severity] || 0,
      }))
      .sort((a, b) => {
        if (a.rank !== b.rank) return b.rank - a.rank;
        return String(a.alert.expiresAt || "").localeCompare(String(b.alert.expiresAt || ""));
      });
  }, [eligibleGovAlerts, primaryAlert]);

  const hasMiniCards = ranked.length > 0;
  const hasDismissals = dismissedCount > 0;
  if (!hasMiniCards && !hasDismissals) return null;

  return (
    <div className={styles.container}>
      {hasMiniCards && (
        <ul className={styles.list}>
          {ranked.map(({ alert, eligibleIdx }) => {
            const title = lang === "fr" ? alert.title_fr : alert.title_en;
            return (
              <li
                key={alert.id || `${eligibleIdx}-${alert.title_en}`}
                className={`${styles.card} ${styles[`tier-${alert.tier}`]}`}
                role="button"
                tabIndex={0}
                onClick={() => selectGovAlert(eligibleIdx)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    selectGovAlert(eligibleIdx);
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
