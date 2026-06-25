import React, { useContext, useMemo } from "react";
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
import SourceBadge from "~/components/ambient/SourceBadge";
import { RADAR_GEOMETRY } from "~/components/WeatherMap/geometry";
import {
  RadarStateContext,
  WeatherDataContext,
  SystemContext,
  UiPrefsContext,
} from "~/AppContext";
import { getRadarAlertState } from "~/ui/alertLogic";
import { isDaylight } from "~/ui/weatherCodes";
import styles from "./styles.css";

// Radar-freshness gate for the calm copy. "No rain within X" is only honest
// when the radar data is current; on a stall the last-good ring values
// persist and the calm copy would assert clear skies on stale data. If the
// newest *actual* RainViewer frame is older than this, the line falls back to
// "Radar unavailable". 15 min ≈ 1.5 RainViewer publish cycles (~10 min each)
// — long enough that one missed cycle never false-triggers, short enough to
// catch a real stall. Measured on the FRAME timestamp (RadarStateContext
// .radarFrameTs), not our own fetch-success, so a successful poll that
// returned a stale newest-frame is still treated as stale.
const RADAR_STALE_MS = 15 * 60 * 1000;

// `currentlyPrecipitating` is passed false on purpose. It only affects the
// bumped-tier wording (alert.*Intensifying vs alert.*Approaching) inside
// getRadarAlertState; the "approaching" wording reads correctly in the
// dry-onset case this kiosk most cares about. (The component DOES read the
// weather code now — for the calm-state message below — so the original
// "don't subscribe to WeatherDataContext" trade-off no longer applies; the
// re-render on the 10-min current-conditions poll is cheap.)
const ASSUME_PRECIPITATING = false;

/**
 * Calm-state sky cue — when the radar shows no notable echo
 * (getRadarAlertState === null), the line still renders (maintainer ruling:
 * NowcastLine is ALWAYS present). Option C re-anchors the calm TEXT to the
 * radar's coverage ("No rain within X") rather than restating the sky, so the
 * six dry sky codes (clear/partly/cloudy/fog/none) become ICON-ONLY
 * selectors: they keep choosing the sun/moon/cloud/fog glyph but no longer
 * carry the calm text. The two light-precip sub-states (light snow / light
 * precip) DO keep their own text — radar shows weak echoes there, so "no rain
 * within X" would be a lie. The icon adapts to the Tomorrow.io weather code
 * AND the day/night phase.
 *
 * @param {?number} code — Tomorrow.io weatherCode (4- or 5-digit variant)
 * @param {boolean} isDay — true during daylight hours
 * @returns {{ i18nKey: ?string, icon: object }} icon for every calm state,
 *   plus a text i18nKey ONLY for the light-precip sub-states (null otherwise,
 *   signalling the caller to use the radar-anchored `noRainWithin` text)
 */
function calmNowcast(code, isDay) {
  const base = code != null && code > 9999 ? Math.floor(code / 10) : code;
  // Precip below the radar-alarm threshold (light/isolated) — the verdict is
  // null but the weather code still reports falling precip. These keep their
  // own text (radar shows weak echoes; "no rain within X" would be wrong).
  if (base >= 5000 && base < 6000) return { i18nKey: "nowcast.calm.lightSnow", icon: snowIcon };
  if (base >= 4000 && base < 9000) return { i18nKey: "nowcast.calm.lightPrecip", icon: rainMix };
  // Dry calm — icon only; the text comes from the radar-anchored noRainWithin.
  switch (base) {
    case 1000:
    case 1100:
      return { i18nKey: null, icon: isDay ? daySunny : nightClear };
    case 1101:
    case 1103:
      return { i18nKey: null, icon: isDay ? daySunnyOvercast : nightAltCloudy };
    case 1001:
    case 1102:
      return { i18nKey: null, icon: cloudyIcon };
    case 2000:
    case 2100:
    case 2101:
    case 2102:
    case 2103:
    case 2106:
    case 2107:
    case 2108:
      return { i18nKey: null, icon: fogIcon };
    default:
      return { i18nKey: null, icon: cloudyIcon };
  }
}

/**
 * NowcastLine — the keystone glanceable line of the lean MID column on the
 * 7" Pi kiosk (v3.2 "3 états radar" + v3.3 priority views). It is ALWAYS
 * present (maintainer ruling): when an orange/red radar echo is active it
 * translates the radar's verdict into a temporal sentence ("Heavy
 * precipitation nearby") with a confidence dot + accent tint; otherwise it
 * shows a quiet radar-anchored calm state ("No rain within 100 km", with a
 * sky-adaptive icon) — or "Radar unavailable" when the radar data has gone
 * stale (see RADAR_STALE_MS).
 *
 * Per the rail-affordance redesign (2026-06-24) the line is **status-only**:
 * it no longer maximizes to the forecast on tap (that topic-change moves to
 * the dedicated forecast dock button), so it is a plain container, not a
 * button. A leading RADAR source badge (ambient/SourceBadge) marks every
 * render path so the line's origin is honest, matching the project's
 * banner-source convention.
 *
 * The alarm verdict reuses the EXISTING radar state machine
 * (getRadarAlertState, the same one the RADAR banner + auto-tab selector
 * consume) so it invents no new severity opinion; the calm state is derived
 * from the radar outer-ring radius (RADAR_GEOMETRY + the active distanceUnit)
 * plus the Tomorrow.io weather code + day/night phase (`calmNowcast`, for the
 * icon and the light-precip text exceptions).
 *
 * Context dependencies (no props): RadarStateContext (risk/trend fields +
 * `radarFrameTs` freshness), WeatherDataContext (weather code + sunrise/set),
 * SystemContext (mount sentinel), UiPrefsContext (`distanceUnit`).
 *
 * @returns {JSX.Element|null} the nowcast line (null only when the layout
 *   shell isn't mounted — defensive; NowcastLine only mounts inside LayoutPi)
 */
const NowcastLine = () => {
  const { t } = useTranslation();
  const radar = useContext(RadarStateContext);
  const weather = useContext(WeatherDataContext);
  const system = useContext(SystemContext);
  const { distanceUnit } = useContext(UiPrefsContext);

  const innerRisk = radar && radar.innerRisk;
  const outerRisk = radar && radar.outerRisk;
  const innerTrend = radar && radar.innerTrend;
  const outerTrend = radar && radar.outerTrend;
  const innerBumped = radar && radar.innerBumped;
  const outerBumped = radar && radar.outerBumped;
  const innerConf = radar && radar.innerTrendConfidence;
  const outerConf = radar && radar.outerTrendConfidence;
  const radarFrameTs = radar && radar.radarFrameTs;

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

  // Defensive: NowcastLine only ever mounts inside LayoutPi.
  if (!system) return null;

  // The RADAR source badge — leads every render path so the line is
  // unambiguously radar-sourced (CLAUDE.md banner-source convention; the
  // RADAR tag is the documented label for the local radar heuristic). The
  // AlertBanner's RADAR badge is gated off on Pi, so NowcastLine is the
  // Pi-side radar surface and the badge belongs here.
  const radarBadge = <SourceBadge source="RADAR" />;

  // ALARM tiers (orange / red) — an active radar echo drives the line.
  if (verdict) {
    const verdictText = t(verdict.i18nKey);
    const { tier } = verdict; // "orange" | "red"
    return (
      <div
        className={`${styles.line} ${styles.line} ${styles[`tier-${tier}`]}`}
        role="status"
        aria-label={t("nowcast.aria", { verdict: verdictText })}
      >
        {radarBadge}
        <span className={styles.verdict}>{verdictText}</span>
        {/* Confidence dot — bucket-coloured (high/mid/low), a passive nuance
          * pip read off the verdict object. */}
        <span className={`${styles.dot} ${styles[`dot-${verdict.confidenceBucket}`]}`} aria-hidden="true" />
      </div>
    );
  }

  // CALM tier — always present, sky-adaptive icon + radar-anchored text.
  const values = weather && weather.currentWeatherData?.data?.timelines?.[0]?.intervals?.[0]?.values;
  const isDay = weather && weather.sunriseTime && weather.sunsetTime
    ? isDaylight(weather.sunriseTime, weather.sunsetTime)
    : true;
  const calm = calmNowcast(values?.weatherCode, isDay);

  // Radar-freshness gate: when the newest actual frame is stale (or never
  // loaded), the radar can't honestly say "no rain within X" — fall back to
  // "Radar unavailable". The light-precip sub-states keep their own text.
  const radarStale = radarFrameTs == null || (Date.now() - radarFrameTs > RADAR_STALE_MS);

  let calmText;
  if (calm.i18nKey) {
    // Light snow / light precip — keep the explicit wording.
    calmText = t(calm.i18nKey);
  } else if (radarStale) {
    calmText = t("nowcast.calm.radarUnavailable");
  } else {
    // Dry calm — radar-anchored coverage statement built from the outer-ring
    // radius and the active distance unit (100 km / 60 mi).
    const ring = RADAR_GEOMETRY[distanceUnit] || RADAR_GEOMETRY.km;
    const distance = ring.outer[ring.outer.length - 1];
    calmText = t("nowcast.calm.noRainWithin", { distance, unit: distanceUnit });
  }

  return (
    <div
      className={`${styles.line} ${styles.line} ${styles["tier-calm"]}`}
      role="status"
      aria-label={t("nowcast.aria", { verdict: calmText })}
    >
      {radarBadge}
      <span className={styles.icon} aria-hidden="true">
        <InlineIcon icon={calm.icon} />
      </span>
      <span className={styles.verdict}>{calmText}</span>
    </div>
  );
};

export default NowcastLine;
