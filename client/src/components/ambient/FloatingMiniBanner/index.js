import React from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import SourceBadge from "~/components/ambient/SourceBadge";
import SeverityChip from "~/components/ambient/SeverityChip";
import useEligibleGovAlerts from "~/hooks/useEligibleGovAlerts";
import styles from "./styles.css";

/**
 * Compact alert banner anchored over the map whenever a full-screen
 * map state hides the regular AlertBanner slab: the collapsed rail /
 * radar-focus mode on LayoutDesktop + LayoutPi, and the maximized
 * radar card on LayoutMobile. Without this overlay a severe alert
 * could be active with no on-screen indication — exactly the wrong
 * outcome on a weather kiosk.
 *
 * SHOW gate matches AlertBanner / AlertDetailInline (≥ 1 orange/red
 * gov alert at the point). Renders the currently-displayed alert
 * (mirrors `govAlertIdx`) so tapping the v3 banner to cycle in the
 * full layout, then collapsing the rail, still shows the same alert
 * here.
 *
 * Visual treatment: floating chip pinned to the top-right of the map
 * area, with the active palette's surface + left severity strip,
 * a compact SeverityChip, a "1 / N" counter when several alerts are
 * active, and a trailing chevron — pixel-parity with the Synthèse's
 * compact alert card (P4 audit follow-up, 2026-06-11). The
 * `belowControls` placement drops the chip under a 44 px control row
 * instead — LayoutMobile's maximized card already has its restore
 * button in the top-right corner and the Leaflet zoom stack at the
 * top-left. Tapping the chip exits the full-screen map state
 * (signalled via `onExpand`); the cycle controls aren't exposed here
 * on purpose — restoring the layout gives the user the full UI.
 *
 * @param {object} props
 * @param {() => void} props.onExpand — called when the banner is tapped. Bound
 *   directly to `onClick`, so React passes a SyntheticMouseEvent; the type is
 *   zero-arity because callers ignore it.
 *   parent exits the full-screen map state (un-collapses the rail /
 *   restores the mobile radar card)
 * @param {string} [props.placement] — `"topRight"` (default, rail
 *   layouts) or `"belowControls"` (mobile maximized card: right-aligned
 *   under the restore button, clear of the zoom stack)
 * @returns {JSX.Element|null} mini-banner, or null when no alert is eligible
 */
const FloatingMiniBanner = ({ onExpand, placement = "topRight" }) => {
  const { i18n } = useTranslation();
  // Same eligible-alert derivation as AlertBanner — shared hook so the
  // collapsed-rail overlay shows the exact alert the full banner would,
  // dismissal filter included (this overlay previously skipped it).
  const { eligibleGovAlerts, safeIdx, currentAlert } = useEligibleGovAlerts();

  if (!currentAlert) return null;

  const lang = (i18n.language || "en").slice(0, 2);
  const title = lang === "fr" ? currentAlert.title_fr : currentAlert.title_en;

  return (
    <button
      type="button"
      className={`${styles.banner} ${placement === "belowControls" ? styles.belowControls : ""} ${styles[`tier-${currentAlert.tier}`]}`}
      onClick={onExpand}
    >
      <SourceBadge source={currentAlert.source} />
      <SeverityChip severity={currentAlert.severity} eventName={currentAlert.title_en} compact />
      <span className={styles.title}>{title}</span>
      {eligibleGovAlerts.length > 1 ? (
        <span className={styles.counter}>{safeIdx + 1} / {eligibleGovAlerts.length}</span>
      ) : null}
      {/* Inline SVG chevron (house rule: no Unicode glyphs) — signals
        * "tap to open" exactly like the mini-cards' trailing chevron. */}
      <svg className={styles.chevron} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M9 6 L 15 12 L 9 18" />
      </svg>
    </button>
  );
};

FloatingMiniBanner.propTypes = {
  onExpand: PropTypes.func.isRequired,
  placement: PropTypes.oneOf(["topRight", "belowControls"]),
};

export default FloatingMiniBanner;
