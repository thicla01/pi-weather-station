import React, { useContext, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { InlineIcon } from "@iconify/react";
import daySunny from "@iconify/icons-wi/day-sunny";
import nightClear from "@iconify/icons-wi/night-clear";
import daySunnyOvercast from "@iconify/icons-wi/day-sunny-overcast";
import nightAltCloudy from "@iconify/icons-wi/night-alt-cloudy";
import cloudyIcon from "@iconify/icons-wi/cloudy";
import fogIcon from "@iconify/icons-wi/fog";
import rainMix from "@iconify/icons-wi/rain-mix";
import snowIcon from "@iconify/icons-ion/snow";
import { ExpandIcon } from "~/components/WeatherMap/icons";
import {
  RadarStateContext,
  WeatherDataContext,
  SystemContext,
  AppActionsContext,
} from "~/AppContext";
import { getRadarAlertState, severity } from "~/ui/alertLogic";
import { isDaylight } from "~/ui/weatherCodes";
import styles from "./styles.css";

// The layout state NowcastLine promotes to on tap — the forecast-forward
// MAX state of the v3.2 "3 états radar" Pi layout. Named so the single
// transition target is obvious and editable in one place.
const MAX_STATE = "max";

// `currentlyPrecipitating` is passed false on purpose. It only affects the
// bumped-tier wording (alert.*Intensifying vs alert.*Approaching) inside
// getRadarAlertState; the "approaching" wording reads correctly in the
// dry-onset case this kiosk most cares about. (The component DOES read the
// weather code now — for the calm-state message below — so the original
// "don't subscribe to WeatherDataContext" trade-off no longer applies; the
// re-render on the 10-min current-conditions poll is cheap.)
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
 * Calm-state verdict — when the radar shows no notable echo
 * (getRadarAlertState === null), the line still renders (maintainer ruling:
 * NowcastLine is ALWAYS present), reflecting the sky: a sun on a clear day,
 * the moon on a clear night, clouds, fog, or a light-precip note. The
 * message adapts to the Tomorrow.io weather code AND the day/night phase.
 *
 * @param {?number} code — Tomorrow.io weatherCode (4- or 5-digit variant)
 * @param {boolean} isDay — true during daylight hours
 * @returns {{ i18nKey: string, icon: object }} calm message key + icon
 */
function calmNowcast(code, isDay) {
  const base = code != null && code > 9999 ? Math.floor(code / 10) : code;
  // Precip below the radar-alarm threshold (light/isolated) — the verdict is
  // null but the weather code still reports falling precip.
  if (base >= 5000 && base < 6000) return { i18nKey: "nowcast.calm.lightSnow", icon: snowIcon };
  if (base >= 4000 && base < 9000) return { i18nKey: "nowcast.calm.lightPrecip", icon: rainMix };
  switch (base) {
    case 1000:
    case 1100:
      return isDay
        ? { i18nKey: "nowcast.calm.clearDay", icon: daySunny }
        : { i18nKey: "nowcast.calm.clearNight", icon: nightClear };
    case 1101:
    case 1103:
      return { i18nKey: "nowcast.calm.partly", icon: isDay ? daySunnyOvercast : nightAltCloudy };
    case 1001:
    case 1102:
      return { i18nKey: "nowcast.calm.cloudy", icon: cloudyIcon };
    case 2000:
    case 2100:
    case 2101:
    case 2102:
    case 2103:
    case 2106:
    case 2107:
    case 2108:
      return { i18nKey: "nowcast.calm.fog", icon: fogIcon };
    default:
      return { i18nKey: "nowcast.calm.none", icon: cloudyIcon };
  }
}

/**
 * NowcastLine — the keystone glanceable line of the lean MID column on the
 * 7" Pi kiosk (v3.2 "3 états radar"). It is ALWAYS present (maintainer
 * ruling): when an orange/red radar echo is active it translates the
 * radar's verdict into a temporal sentence ("Heavy precipitation nearby")
 * with a trend arrow + accent tint; otherwise it shows a quiet, sky-adaptive
 * calm state ("Soleil radieux" by day, "Nuit claire" at night, "Ciel
 * couvert", etc.). Tapping anywhere on the line — or its trailing square
 * maximize affordance — promotes the layout to MAX (forecast-forward) via
 * setPiLayoutState("max"); it is the MID column's single entry into MAX.
 *
 * The alarm verdict reuses the EXISTING radar state machine
 * (getRadarAlertState, the same one the RADAR banner + auto-tab selector
 * consume) so it invents no new severity opinion; the calm state is derived
 * from the Tomorrow.io weather code + day/night phase (`calmNowcast`).
 *
 * @returns {JSX.Element|null} the nowcast line (null only when the layout
 *   shell isn't mounted — defensive; NowcastLine only mounts inside LayoutPi)
 */
const NowcastLine = () => {
  const { t } = useTranslation();
  const radar = useContext(RadarStateContext);
  const weather = useContext(WeatherDataContext);
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

  // Defensive: NowcastLine only ever mounts inside LayoutPi.
  if (!system) return null;

  // The trailing maximize affordance — the SAME four-corner "expand" square
  // the radar screen uses (WeatherMap's `ExpandIcon`, the RadarFocusControl
  // glyph), set in a bordered box so it reads as a button. Shared across both
  // states; the whole line is the tap target, this is the visual hint that
  // tapping opens the forecast (MAX). The aria on the button carries the action.
  const maximizeIcon = (
    <span className={styles.maximize} aria-hidden="true">
      <ExpandIcon className={styles.maximizeIcon} />
    </span>
  );

  // ALARM tiers (orange / red) — an active radar echo drives the line.
  if (verdict) {
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
        {/* Confidence dot — bucket-coloured (high/mid/low), a passive nuance
          * pip read off the verdict object. */}
        <span className={`${styles.dot} ${styles[`dot-${verdict.confidenceBucket}`]}`} aria-hidden="true" />
        {maximizeIcon}
      </button>
    );
  }

  // CALM tier — always present, sky- and time-of-day-adaptive.
  const values = weather && weather.currentWeatherData?.data?.timelines?.[0]?.intervals?.[0]?.values;
  const isDay = weather && weather.sunriseTime && weather.sunsetTime
    ? isDaylight(weather.sunriseTime, weather.sunsetTime)
    : true;
  const calm = calmNowcast(values?.weatherCode, isDay);
  const calmText = t(calm.i18nKey);
  return (
    <button
      type="button"
      className={`${styles.line} ${styles.line} ${styles["tier-calm"]}`}
      onClick={enterMax}
      aria-label={t("nowcast.aria", { verdict: calmText })}
    >
      <span className={styles.icon} aria-hidden="true">
        <InlineIcon icon={calm.icon} />
      </span>
      <span className={styles.verdict}>{calmText}</span>
      {maximizeIcon}
    </button>
  );
};

export default NowcastLine;
