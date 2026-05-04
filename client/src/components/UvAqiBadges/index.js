import React, { useContext, useEffect } from "react";
import { useTranslation } from "react-i18next";
import axios from "axios";
import { AppContext } from "~/AppContext";
import styles from "./styles.css";

// UV index colour scale, WMO categorisation:
//   0-2  low        green
//   3-5  moderate   yellow
//   6-7  high       orange
//   8-10 very high  red
//   11+  extreme    purple
function uvTier(value) {
  if (value == null) return null;
  if (value >= 11) return { color: "#7e3fb1", label: "extreme" };
  if (value >= 8)  return { color: "#e60000", label: "veryHigh" };
  if (value >= 6)  return { color: "#f08200", label: "high" };
  if (value >= 3)  return { color: "#f0d000", label: "moderate" };
  return { color: "#5cb85c", label: "low" };
}

// Shared four-tier colour map for the AQI badge — every source
// (ECCC AQHI, MELCC IQA, EPA AQI) gets normalised to this four-tier
// vocabulary on the server (or below for the Tomorrow.io fallback)
// before reaching the badge.
const CATEGORY_COLORS = {
  low:      "#5cb85c",
  moderate: "#f0d000",
  high:     "#e60000",
  veryHigh: "#7e3fb1",
};

// EPA category index (Tomorrow.io's epaIndex returns 1-6) → same
// four-tier vocabulary, with sensitive/unhealthy mapping to "high".
// Used only for the Tomorrow.io fallback path; the server-side
// orchestrator already returns `category` for every other source.
function epaCategory(idx) {
  if (idx == null) return null;
  if (idx >= 5) return "veryHigh";
  if (idx >= 3) return "high";
  if (idx >= 2) return "moderate";
  return "low";
}

const AQI_REFRESH_MS = 30 * 60 * 1000; // 30 min — every upstream publishes hourly

// Source-specific label keys for the tooltip. Falls back to the
// generic ECCC label if a new source ever ships without a matching
// translation key (defensive — every active source does have one).
const SOURCE_LABEL_KEY = {
  "MELCC-Mtl":   "badges.aqiSourceMelccMtl",
  "MELCC-RSQAQ": "badges.aqiSourceMelccRsqaq",
  "ECCC":        "badges.aqiSourceEccc",
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
  const { currentWeatherData, mapGeo, darkMode, aqhiInfo, setAqhiInfo } = useContext(AppContext);
  const { t } = useTranslation();
  const aqi = aqhiInfo; // { value, category, source, scale, kind, stationName, stationDistanceKm } | null

  // Poll the air-quality endpoint when the marker moves. 30-min
  // refresh matches every upstream's ~hourly publication cadence;
  // server-side caches keep the cost flat regardless of how many
  // remote clients are hitting the kiosk. State lives in AppContext
  // so the Debug panel can show the chosen station + kind without
  // refetching.
  useEffect(() => {
    if (!mapGeo) return undefined;
    let cancelled = false;
    const fetchAqi = () => {
      const params = new URLSearchParams({
        lat: mapGeo.latitude,
        lon: mapGeo.longitude,
      });
      axios.get(`/api/air-quality?${params}`)
        .then((res) => {
          if (!cancelled) setAqhiInfo(res.data?.available ? res.data : null);
        })
        .catch(() => { if (!cancelled) setAqhiInfo(null); });
    };
    fetchAqi();
    const interval = setInterval(fetchAqi, AQI_REFRESH_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [mapGeo, setAqhiInfo]);

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
    ? `${t(SOURCE_LABEL_KEY[aqiSource] || "badges.aqiSourceEccc")} — ${aqi.stationName} (${aqi.stationDistanceKm} km, ${t(`badges.aqiKind${aqi.kind === "forecast" ? "Forecast" : "Observation"}`)})`
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
