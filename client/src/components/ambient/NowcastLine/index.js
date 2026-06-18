import React, { useContext, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  RadarStateContext,
  SystemContext,
  AppActionsContext,
} from "~/AppContext";
import { getRadarAlertState, severity } from "~/ui/alertLogic";
import styles from "./styles.css";

// The layout state NowcastLine promotes to on tap — the forecast-forward
// MAX state of the v3.2 "3 états radar" Pi layout. Named so the single
// transition target is obvious and editable in one place.
const MAX_STATE = "max";

// `currentlyPrecipitating` is passed false on purpose. It only affects the
// bumped-tier wording (alert.*Intensifying vs alert.*Approaching) inside
// getRadarAlertState, and reading the live weather code would force this
// component to subscribe to WeatherDataContext and re-render on every 10-min
// current-conditions poll. The auto-tab selector
// (hooks/useAutoTabSelector.js) makes the same trade-off for the same reason
// — the radar slice alone is enough to drive the verdict, and the
// "approaching" wording reads correctly in the dry-onset case this kiosk
// most cares about.
const ASSUME_PRECIPITATING = false;

/**
 * Reduce the source ring's trend to one of four glyph directions for the
 * trend arrow. Mirrors getRadarAlertState's source-ring pick (the
 * higher-severity ring drives the verdict) so the arrow agrees with the
 * verdict text. `bumped` reads as "approaching" because the server raised
 * the tier on an incoming band.
 *
 * @param {string|null} innerRisk
 * @param {string|null} outerRisk
 * @param {string} innerTrend — "approaching" | "leaving" | "stable" | "drifting"
 * @param {string} outerTrend — same vocabulary as innerTrend
 * @param {boolean} innerBumped — server flag: inner tier bumped by trend
 * @param {boolean} outerBumped — server flag: outer tier bumped by trend
 * @returns {"approaching"|"leaving"|"drifting"|"near"} arrow direction slug
 */
function arrowDirection(innerRisk, outerRisk, innerTrend, outerTrend, innerBumped, outerBumped) {
  const innerIsSource = severity(innerRisk) >= severity(outerRisk);
  const srcTrend = innerIsSource ? innerTrend : outerTrend;
  const srcBumped = innerIsSource ? innerBumped : outerBumped;
  if (srcBumped || srcTrend === "approaching") return "approaching";
  if (srcTrend === "leaving") return "leaving";
  if (srcTrend === "drifting") return "drifting";
  return "near";
}

/**
 * NowcastLine — the keystone glanceable line of the lean MID column on the
 * 7" Pi kiosk (v3.2 "3 états radar"). It translates the radar's spatial
 * verdict into a single temporal sentence (e.g. "Heavy precipitation
 * nearby") with a trend arrow, accent-tinted with a left accent border so
 * it reads as the one thing happening right now. Tapping anywhere on the
 * line — or its trailing square maximize affordance — promotes the layout
 * to MAX (forecast-forward) via setPiLayoutState("max").
 *
 * It reuses the EXISTING radar verdict (getRadarAlertState, the same state
 * machine + i18n keys the RADAR alert banner and the auto-tab selector
 * consume) so it invents no new severity opinion. The verdict text comes
 * straight from the `alert.*` locale block; only the line's own aria
 * strings are new (`nowcast.*`).
 *
 * SHOW gate: identical to the banner — getRadarAlertState returns non-null
 * only at orange/red tier. When it returns null (calm / yellow-only / no
 * echo) this component renders null, so it costs zero layout in calm
 * weather and the MID column stays lean.
 *
 * @returns {JSX.Element|null} the nowcast line, or null when there is no
 *   notable radar verdict to surface
 */
const NowcastLine = () => {
  const { t } = useTranslation();
  const radar = useContext(RadarStateContext);
  const system = useContext(SystemContext);
  const { setPiLayoutState } = useContext(AppActionsContext);

  const innerRisk = radar && radar.innerRisk;
  const outerRisk = radar && radar.outerRisk;
  const innerTrend = radar && radar.innerTrend;
  const outerTrend = radar && radar.outerTrend;
  const innerBumped = radar && radar.innerBumped;
  const outerBumped = radar && radar.outerBumped;
  const innerConf = radar && radar.innerTrendConfidence;
  const outerConf = radar && radar.outerTrendConfidence;

  // Memoize on the eight risk/trend fields ONLY (never on currentMapZoom,
  // which also lives in RadarStateContext) so a map pan/zoom can't churn the
  // verdict — same field set the auto-tab selector memoizes on.
  const verdict = useMemo(
    () =>
      getRadarAlertState(
        innerRisk, outerRisk, innerTrend, outerTrend,
        innerBumped, outerBumped, innerConf, outerConf,
        ASSUME_PRECIPITATING,
      ),
    [innerRisk, outerRisk, innerTrend, outerTrend, innerBumped, outerBumped, innerConf, outerConf],
  );

  const direction = useMemo(
    () => arrowDirection(innerRisk, outerRisk, innerTrend, outerTrend, innerBumped, outerBumped),
    [innerRisk, outerRisk, innerTrend, outerTrend, innerBumped, outerBumped],
  );

  const enterMax = useCallback(() => {
    setPiLayoutState(MAX_STATE);
  }, [setPiLayoutState]);

  // Same null contract as the banner: no notable verdict → no line, no
  // layout cost. Also bail if the layout shell isn't mounted (defensive —
  // NowcastLine only ever mounts inside LayoutPi).
  if (!verdict || !system) return null;

  const verdictText = t(verdict.i18nKey);
  const { tier } = verdict; // "orange" | "red"

  return (
    <button
      type="button"
      className={`${styles.line} ${styles.line} ${styles[`tier-${tier}`]}`}
      onClick={enterMax}
      aria-label={t("nowcast.aria", { verdict: verdictText })}
    >
      {/* Trend arrow — inline SVG (house rule: no Unicode glyphs), rotated
        * per direction via a CSS data-attribute hook. Follows currentColor
        * so it inherits the tier accent set on the line. */}
      <svg
        className={styles.arrow}
        data-direction={direction}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        aria-hidden="true"
      >
        <path d="M5 12 H 19" strokeLinecap="round" />
        <path d="M13 6 L 19 12 L 13 18" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className={styles.verdict}>{verdictText}</span>
      {/* Confidence dot — bucket-coloured (high/mid/low), purely a passive
        * nuance pip. confidenceBucket already rode into verdict, so we read
        * it off the verdict object rather than recomputing. */}
      <span className={`${styles.dot} ${styles[`dot-${verdict.confidenceBucket}`]}`} aria-hidden="true" />
      {/* Square maximize affordance — visual hint that tapping opens the
        * forecast (MAX). It shares the line's single onClick (the whole line
        * is the tap target); the icon is decorative, the aria on the button
        * carries the action. */}
      <svg
        className={styles.maximize}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M9 15 L 15 9 M15 9 H 10 M15 9 V 14" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
};

export default NowcastLine;
