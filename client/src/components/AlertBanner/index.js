import React, { useContext } from "react";
import { useTranslation } from "react-i18next";
import { AppContext } from "~/AppContext";
import styles from "./styles.css";

// Mapping from (innerRisk, outerRisk) → (i18n key, tier).
// "Tier" drives the banner colour; the i18n key picks the wording. We only
// surface orange and red — yellow stays signalled by the ring colour alone
// to avoid alert fatigue. The "approaching" wording is used when the outer
// ring is the source of the worst tier (i.e. the threat is further out and
// hasn't reached the inner zone yet).
//
// When both rings sit at orange or both at red, the message is the
// "near"/"on you" variant — that's the more urgent of the two states for a
// given tier and matches what the user actually needs to act on.
function getAlertState(innerRisk, outerRisk) {
  const innerSev = severity(innerRisk);
  const outerSev = severity(outerRisk);
  const maxSev = Math.max(innerSev, outerSev);
  if (maxSev < 2) return null; // calm or yellow → no banner

  const tier = maxSev === 3 ? "red" : "orange";
  // "Near" wording when the inner ring is at the worst tier we're showing;
  // "approaching" when only the outer ring is.
  const near = innerSev === maxSev;
  const i18nKey = `alert.${tier}${near ? "Near" : "Approaching"}`;
  return { tier, i18nKey };
}

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
 * Persistent text alert banner shown in the InfoPanel when the radar-risk
 * analyser reports orange or red on either ring. Hidden otherwise — this
 * component returns null when nothing needs surfacing, so it doesn't take
 * any vertical space in the calm case.
 *
 * @returns {JSX.Element|null} Banner, or null when no alert is active
 */
const AlertBanner = () => {
  const { innerRisk, outerRisk } = useContext(AppContext);
  const { t } = useTranslation();
  const state = getAlertState(innerRisk, outerRisk);
  if (!state) return null;
  return (
    <div className={`${styles.banner} ${styles[state.tier]}`}>
      {t(state.i18nKey)}
    </div>
  );
};

export default AlertBanner;
