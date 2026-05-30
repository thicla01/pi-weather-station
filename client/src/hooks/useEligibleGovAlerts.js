import { useContext, useMemo } from "react";
import { AppContext } from "~/AppContext";
import useDismissedAlerts from "~/hooks/useDismissedAlerts";
import { selectEligibleGovAlerts } from "~/ui/alertLogic";

/**
 * Single source of truth for "which government alerts does the v3
 * banner stack display, and which one is currently active".
 *
 * Four ambient components — AlertBanner (head + counter),
 * AlertDetailInline (body), FloatingMiniBanner (collapsed-rail
 * overlay) and AlertMiniCards (other-alerts list) — must agree on
 * both the displayed alert set and the current alert. Before this
 * hook each derived it independently and they diverged:
 *
 *   - AlertBanner / AlertDetailInline indexed into the dismissal-
 *     filtered list of ALL tiers, so the counter and the detail body
 *     counted yellow-tier alerts the UI never actually shows. A
 *     sub-threshold yellow ECCC alert inflated the "1 / 2" counter
 *     without ever becoming a mini-card — the Nicolet report
 *     (2026-05-29): "1 / 2 but no second card".
 *   - FloatingMiniBanner indexed into the raw `govAlerts` array,
 *     not even applying the dismissal filter.
 *   - AlertMiniCards already filtered to red/orange, so it disagreed
 *     with the other three on the denominator.
 *
 * The derivation, in order:
 *   1. Drop alerts the user dismissed (useDismissedAlerts).
 *   2. Keep only displayable tiers (red/orange) via
 *      selectEligibleGovAlerts — yellow-tier alerts are never shown.
 *   3. Resolve the current alert by `govAlertIdx % length`, the same
 *      modulo every consumer used, so one govAlertIdx maps to one
 *      alert across all four surfaces. Mini-cards pass an index into
 *      THIS list to `selectGovAlert`, and the bound in AppContext
 *      (`idx < govAlerts.length`) still holds because the eligible
 *      list is a subset of the raw one.
 *
 * @returns {{
 *   eligibleGovAlerts: Array,
 *   safeIdx: number,
 *   currentAlert: (object|null),
 *   hasEligible: boolean
 * }} the displayable alert set, the resolved index, the current
 *   alert (null when none), and whether any eligible alert exists
 */
export default function useEligibleGovAlerts() {
  const { govAlerts, govAlertIdx } = useContext(AppContext);
  const { isDismissed } = useDismissedAlerts();

  const eligibleGovAlerts = useMemo(() => {
    const visible = Array.isArray(govAlerts)
      ? govAlerts.filter((a) => !isDismissed(a))
      : [];
    return selectEligibleGovAlerts(visible);
  }, [govAlerts, isDismissed]);

  const hasEligible = eligibleGovAlerts.length > 0;
  const safeIdx = hasEligible ? govAlertIdx % eligibleGovAlerts.length : 0;
  const currentAlert = hasEligible ? eligibleGovAlerts[safeIdx] : null;

  return { eligibleGovAlerts, safeIdx, currentAlert, hasEligible };
}
