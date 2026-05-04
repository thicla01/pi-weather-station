import React, { useContext, useEffect, useState } from "react";
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

// AQI rendering data — the badge accepts either an ECCC AQHI value
// (1-10+, Health Canada's four-tier categorisation) or an EPA AQI
// category index (1-6). They use the same category vocabulary in the
// UI ("low/moderate/high/veryHigh") so the badge label and colour
// mapping stay consistent regardless of source.

// AQHI tiers — Health Canada's four risk categories.
function aqhiTier(value) {
  if (value == null) return null;
  if (value > 10)  return { color: "#7e3fb1", label: "veryHigh" };
  if (value >= 7)  return { color: "#e60000", label: "high" };
  if (value >= 4)  return { color: "#f0d000", label: "moderate" };
  return { color: "#5cb85c", label: "low" };
}

// EPA category index (Tomorrow.io's epaIndex returns 1-6) → same
// four-tier vocabulary, with sensitive/unhealthy mapping to "high".
function epaTier(idx) {
  if (idx == null) return null;
  if (idx >= 5) return { color: "#7e3fb1", label: "veryHigh" };
  if (idx >= 3) return { color: "#e60000", label: "high" };
  if (idx >= 2) return { color: "#f0d000", label: "moderate" };
  return { color: "#5cb85c", label: "low" };
}

const ECCC_REFRESH_MS = 30 * 60 * 1000; // 30 min — ECCC publishes hourly

/**
 * Two compact colour-coded badges (UV index + AQI) rendered below
 * CurrentWeather. AQI prefers Environment Canada's AQHI (free, official
 * Canadian source, queried via /api/air-quality and only available
 * inside Canada) and falls back to Tomorrow.io's epaIndex (paid tier
 * only) when ECCC has nothing for the location. Each badge hides
 * individually when its value is missing; the whole row hides when
 * both are absent.
 *
 * @returns {JSX.Element|null} Badges row, or null when nothing to show
 */
const UvAqiBadges = () => {
  const { currentWeatherData, mapGeo, darkMode } = useContext(AppContext);
  const { t } = useTranslation();
  const [aqhi, setAqhi] = useState(null); // { value, category, source, stationName, stationDistanceKm } | null

  // Poll ECCC's AQHI endpoint when the marker moves. 30-min refresh
  // matches the upstream's ~hourly publication cadence; ECCC station
  // observations don't change between API calls within that window
  // (cached server-side too).
  useEffect(() => {
    if (!mapGeo) return undefined;
    let cancelled = false;
    const fetchAqhi = () => {
      const params = new URLSearchParams({
        lat: mapGeo.latitude,
        lon: mapGeo.longitude,
      });
      axios.get(`/api/air-quality?${params}`)
        .then((res) => {
          if (!cancelled) setAqhi(res.data?.available ? res.data : null);
        })
        .catch(() => { if (!cancelled) setAqhi(null); });
    };
    fetchAqhi();
    const interval = setInterval(fetchAqhi, ECCC_REFRESH_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [mapGeo]);

  const values = currentWeatherData?.data?.timelines?.[0]?.intervals?.[0]?.values || {};
  const uv = values.uvIndex;
  const uvT = uvTier(uv);

  // Prefer ECCC. Fall back to Tomorrow.io's epaIndex when ECCC is
  // unavailable (out of Canada / no nearby active station / API down).
  const aqiValue = aqhi?.value ?? values.epaIndex;
  const aqiT = aqhi
    ? aqhiTier(aqhi.value)
    : epaTier(values.epaIndex);
  // Render the value as 1-decimal when it came from ECCC (the upstream
  // returns fractional AQHI like 2.8) and as integer for EPA (which
  // is a category index 1-6).
  const aqiDisplay = aqhi
    ? aqiValue.toFixed(1)
    : Math.round(aqiValue);

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
        <div
          className={styles.badge}
          style={{ backgroundColor: aqiT.color }}
          title={aqhi
            ? `${t("badges.aqiSourceEccc")} — ${aqhi.stationName} (${aqhi.stationDistanceKm} km)`
            : t("badges.aqiSourceEpa")
          }
        >
          <span className={styles.label}>{aqhi ? t("badges.aqhi") : t("badges.aqi")}</span>
          <span className={styles.value}>{aqiDisplay}</span>
          <span className={styles.qualifier}>{t(`badges.aqiLevel.${aqiT.label}`)}</span>
        </div>
      )}
    </div>
  );
};

export default UvAqiBadges;
