import React, { useContext } from "react";
import { useTranslation } from "react-i18next";
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

// EPA AQI category mapping (Tomorrow.io's epaIndex returns 1-6):
//   1 good                          green
//   2 moderate                      yellow
//   3 unhealthy for sensitive       orange
//   4 unhealthy                     red
//   5 very unhealthy                purple
//   6 hazardous                     maroon
//
// Requires the Air Quality data layer in Tomorrow.io. On the free tier
// the field comes back undefined and the badge hides — see InfoPanel
// rendering. UV stays visible regardless since it's on every tier.
const AQI_TIERS = [
  null, // index 0 unused
  { color: "#5cb85c", label: "good" },
  { color: "#f0d000", label: "moderate" },
  { color: "#f08200", label: "sensitive" },
  { color: "#e60000", label: "unhealthy" },
  { color: "#7e3fb1", label: "veryUnhealthy" },
  { color: "#7d1e1e", label: "hazardous" },
];

function aqiTier(value) {
  if (value == null) return null;
  const idx = Math.max(1, Math.min(6, Math.round(value)));
  return AQI_TIERS[idx];
}

/**
 * Two compact colour-coded badges (UV index + EPA AQI) rendered below
 * CurrentWeather. Each badge hides individually when its value is
 * missing (UV is free-tier; AQI requires the Tomorrow.io Air Quality
 * add-on, so it'll often be absent). The whole row hides when both
 * are missing.
 *
 * @returns {JSX.Element|null} Badges row, or null when nothing to show
 */
const UvAqiBadges = () => {
  const { currentWeatherData, darkMode } = useContext(AppContext);
  const { t } = useTranslation();
  const values = currentWeatherData?.data?.timelines?.[0]?.intervals?.[0]?.values || {};
  const uv = values.uvIndex;
  const aqi = values.epaIndex;
  const uvT = uvTier(uv);
  const aqiT = aqiTier(aqi);
  if (!uvT && !aqiT) return null;
  return (
    <div className={`${styles.row} ${darkMode ? styles.dark : styles.light}`}>
      {uvT && (
        <div className={styles.badge} style={{ backgroundColor: uvT.color }}>
          <span className={styles.label}>{t("badges.uv")}</span>
          <span className={styles.value}>{Math.round(uv)}</span>
          <span className={styles.qualifier}>{t(`badges.uvLevel.${uvT.label}`)}</span>
        </div>
      )}
      {aqiT && (
        <div className={styles.badge} style={{ backgroundColor: aqiT.color }}>
          <span className={styles.label}>{t("badges.aqi")}</span>
          <span className={styles.value}>{Math.round(aqi)}</span>
          <span className={styles.qualifier}>{t(`badges.aqiLevel.${aqiT.label}`)}</span>
        </div>
      )}
    </div>
  );
};

export default UvAqiBadges;
