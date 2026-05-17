import React, { useContext } from "react";
import { useTranslation } from "react-i18next";
import { AppContext } from "~/AppContext";
import { uvTier, CATEGORY_COLORS, epaCategory } from "~/ui/severity";
import styles from "./styles.css";

// AQI_REFRESH_MS lived here when this component owned the polling;
// the interval now lives in AppContext alongside the weather refresh.

// Source-specific label keys for the tooltip. Falls back to the
// generic ECCC label if a new source ever ships without a matching
// translation key (defensive — every active source does have one).
const SOURCE_LABEL_KEY = {
  "MELCC-Mtl":   "badges.aqiSourceMelccMtl",
  "MELCC-RSQAQ": "badges.aqiSourceMelccRsqaq",
  "ECCC":        "badges.aqiSourceEccc",
  "AirNow":      "badges.aqiSourceAirNow",
  "OpenAQ":      "badges.aqiSourceOpenAq",
};

// Source-reported reading method, surfaced in the tooltip so the
// user can tell live observations from forecasts or weighted
// averages. AQHI uses observation/forecast; AirNow uses NowCast
// (12-h weighted for PM2.5/PM10, 1-h for ozone — both are EPA's
// "current observation" methodology, but neither is an instantaneous
// spot reading, so the more honest label is "NowCast").
const KIND_LABEL_KEY = {
  observation: "badges.aqiKindObservation",
  forecast:    "badges.aqiKindForecast",
  nowcast:     "badges.aqiKindNowcast",
};

// Per-scale formatting and badge label. AQHI is fractional (2.8);
// IQA and EPA are integers.
const SCALE_BADGE_LABEL = {
  aqhi: "badges.aqhi",
  iqa:  "badges.iqa",
};
function formatValueForScale(scale, value) {
  if (scale === "aqhi") return Number(value).toFixed(1);
  return String(Math.round(Number(value)));
}

/**
 * Two compact colour-coded badges (UV index + AQI) rendered below
 * CurrentWeather. AQI walks a server-side priority chain (MELCC
 * Montreal → MELCC RSQAQ → ECCC AQHI) via /api/air-quality, and
 * falls back to Tomorrow.io's epaIndex (paid tier only) when every
 * Canadian source comes up empty. Each badge hides individually
 * when its value is missing; the whole row hides when both are
 * absent.
 *
 * @returns {JSX.Element|null} Badges row, or null when nothing to show
 */
const UvAqiBadges = () => {
  const { currentWeatherData, darkMode, aqhiInfo } = useContext(AppContext);
  const { t } = useTranslation();
  const aqi = aqhiInfo; // { value, category, source, scale, kind, stationName, stationDistanceKm } | null

  // Air-quality polling now lives in AppContext (see the "Air-quality"
  // useEffect there) so v3 layouts — which don't mount UvAqiBadges —
  // also keep `aqhiInfo` fresh. Reading the value here is enough.

  const values = currentWeatherData?.data?.timelines?.[0]?.intervals?.[0]?.values || {};
  const uv = values.uvIndex;
  const uvT = uvTier(uv);

  // The orchestrator returns {value, category, source, scale, ...}
  // pre-normalised; the only locally-computed branch is the
  // Tomorrow.io fallback (which doesn't go through the orchestrator).
  let aqiCategory = null;
  let aqiValue = null;
  let aqiScale = null;
  let aqiSource = null; // null sentinel = Tomorrow.io fallback
  if (aqi) {
    aqiCategory = aqi.category;
    aqiValue = aqi.value;
    aqiScale = aqi.scale || "aqhi";
    aqiSource = aqi.source;
  } else if (values.epaIndex != null) {
    aqiCategory = epaCategory(values.epaIndex);
    aqiValue = values.epaIndex;
    aqiScale = "epa";
  }
  const aqiColor = aqiCategory ? CATEGORY_COLORS[aqiCategory] : null;
  const aqiBadgeLabel = aqiScale === "epa"
    ? t("badges.aqi")
    : t(SCALE_BADGE_LABEL[aqiScale] || "badges.aqi");
  const aqiDisplay = aqiValue != null && aqiScale ? formatValueForScale(aqiScale, aqiValue) : null;

  const aqiTooltip = aqi
    ? `${t(SOURCE_LABEL_KEY[aqiSource] || "badges.aqiSourceEccc")} — ${aqi.stationName} (${aqi.stationDistanceKm} km, ${t(KIND_LABEL_KEY[aqi.kind] || "badges.aqiKindObservation")})`
    : t("badges.aqiSourceEpa");

  // Yellow "moderate" tier is light enough that the default white
  // text drowns; switch to dark text on that tier only.
  const uvBadgeClass = `${styles.badge} ${uvT?.label === "moderate" ? styles.badgeOnLight : ""}`;
  const aqiBadgeClass = `${styles.badge} ${aqiCategory === "moderate" ? styles.badgeOnLight : ""}`;

  if (!uvT && !aqiCategory) return null;
  return (
    <div className={`${styles.row} ${darkMode ? styles.dark : styles.light}`}>
      {uvT && (
        <div className={uvBadgeClass} style={{ backgroundColor: uvT.color }}>
          <span className={styles.label}>{t("badges.uv")}</span>
          <span className={styles.value}>{Math.round(uv)}</span>
          <span className={styles.qualifier}>{t(`badges.uvLevel.${uvT.label}`)}</span>
        </div>
      )}
      {aqiCategory && (
        <div
          className={aqiBadgeClass}
          style={{ backgroundColor: aqiColor }}
          title={aqiTooltip}
        >
          <span className={styles.label}>{aqiBadgeLabel}</span>
          <span className={styles.value}>{aqiDisplay}</span>
          <span className={styles.qualifier}>{t(`badges.aqiLevel.${aqiCategory}`)}</span>
        </div>
      )}
    </div>
  );
};

export default UvAqiBadges;
