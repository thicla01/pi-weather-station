import React, { useContext, useMemo } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { AppContext } from "~/AppContext";
import SourceBadge from "~/components/ambient/SourceBadge";
import styles from "./styles.css";

/**
 * Compact alert banner anchored over the map when the right rail is
 * collapsed. The kiosk loses the full AlertBanner slab when the rail
 * folds away, so without this overlay a severe alert could be active
 * with no on-screen indication — exactly the wrong outcome on a
 * weather kiosk.
 *
 * SHOW gate matches AlertBanner / AlertDetailInline (≥ 1 orange/red
 * gov alert at the point). Renders the currently-displayed alert
 * (mirrors `govAlertIdx`) so tapping the v3 banner to cycle in the
 * full layout, then collapsing the rail, still shows the same alert
 * here.
 *
 * Visual treatment: floating chip pinned to the top-right of the map
 * area, with the active palette's surface + left severity strip.
 * Tapping it un-collapses the rail (signalled via `onExpand`); the
 * cycle controls aren't exposed here on purpose — re-opening the rail
 * gives the user the full UI.
 *
 * @param {object} props
 * @param {Function} props.onExpand — called when the banner is tapped;
 *   parent un-collapses the rail
 * @returns {JSX.Element|null} mini-banner, or null when no alert is eligible
 */
const FloatingMiniBanner = ({ onExpand }) => {
  const { govAlerts, govAlertIdx } = useContext(AppContext);
  const { i18n } = useTranslation();

  const allGovAlerts = useMemo(
    () => (Array.isArray(govAlerts) ? govAlerts : []),
    [govAlerts],
  );
  const hasEligible = useMemo(
    () => allGovAlerts.some((a) => a?.tier === "red" || a?.tier === "orange"),
    [allGovAlerts],
  );

  if (!hasEligible || allGovAlerts.length === 0) return null;

  const safeIdx = govAlertIdx % allGovAlerts.length;
  const currentAlert = allGovAlerts[safeIdx];
  if (!currentAlert) return null;

  const lang = (i18n.language || "en").slice(0, 2);
  const title = lang === "fr" ? currentAlert.title_fr : currentAlert.title_en;

  return (
    <button
      type="button"
      className={`${styles.banner} ${styles[`tier-${currentAlert.tier}`]}`}
      onClick={onExpand}
    >
      <SourceBadge source={currentAlert.source} />
      <span className={styles.title}>{title}</span>
    </button>
  );
};

FloatingMiniBanner.propTypes = {
  onExpand: PropTypes.func.isRequired,
};

export default FloatingMiniBanner;
