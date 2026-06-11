import React, { useContext, useMemo } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { UiPrefsContext, WeatherDataContext } from "~/AppContext";
import { getDateLocale } from "~/i18n/dateLocale";
import {
  convertTemp,
  convertLength,
  convertSpeed,
  speedUnitLabel,
} from "~/services/conversions";
import { compassKey } from "~/components/ambient/weatherCharts/common";
import styles from "./styles.css";

/**
 * Format an interval's start time for a pill ("14h00" / "2 pm" style
 * hourly, weekday name daily).
 *
 * @param {string} startTime ISO timestamp of the interval
 * @param {string} cadence "hourly" or "daily"
 * @param {string} clockTime "12" or "24"
 * @param {object} dateLocale date-fns locale for weekday names
 * @returns {string} display label
 */
function timeLabel(startTime, cadence, clockTime, dateLocale) {
  const date = new Date(startTime);
  if (cadence === "hourly") {
    return clockTime === "12" ? format(date, "h aaa") : format(date, "HH'h'mm");
  }
  const adjusted = date.getTime() + date.getTimezoneOffset() * 60 * 1000;
  return format(new Date(adjusted), "EEEE", { locale: dateLocale });
}

/**
 * Summary pills under the forecast chart (v3.1 Phase 5, "Résumé
 * chiffré"): 3-4 pills that carry the essential numbers so a user who
 * never reads the curve still gets the story —
 *
 *   temp   → max · min · time of peak · time of trough
 *   wind   → average · max gust · dominant compass direction, plus a
 *            line-style key ("trait : vitesse · pointillé : rafales")
 *   precip → period total · max probability · time of heaviest fall,
 *            plus the probability-line key
 *
 * Reads the same Tomorrow.io intervals as MetricChart; renders nothing
 * while data is loading (the chart's own loading/error state leads).
 *
 * @param {object} props
 * @param {string} props.cadence "hourly" (24 h) or "daily" (5 days)
 * @param {string} props.metric "temp" | "wind" | "precip"
 * @returns {JSX.Element|null} the pill row, or null without data
 */
const ForecastSummaryPills = ({ cadence, metric }) => {
  const { t, i18n } = useTranslation();
  const { hourlyWeatherData, dailyWeatherData } = useContext(WeatherDataContext);
  const { tempUnit, speedUnit, lengthUnit, clockTime } = useContext(UiPrefsContext);

  const weatherData = cadence === "hourly" ? hourlyWeatherData : dailyWeatherData;
  const intervals = weatherData?.data?.timelines?.[0]?.intervals;

  const pills = useMemo(() => {
    if (!intervals || intervals.length === 0) return null;
    const dateLocale = getDateLocale(i18n.language);

    if (metric === "temp") {
      let maxI = 0;
      let minI = 0;
      intervals.forEach((e, i) => {
        const v = e.values?.temperature;
        if (v == null) return;
        if (v > (intervals[maxI].values?.temperature ?? -Infinity)) maxI = i;
        if (v < (intervals[minI].values?.temperature ?? Infinity)) minI = i;
      });
      const maxV = intervals[maxI].values?.temperature;
      const minV = intervals[minI].values?.temperature;
      if (maxV == null || minV == null) return null;
      return [
        { v: `${Math.round(convertTemp(maxV, tempUnit))}°`, label: t("charts.pillMax") },
        { v: `${Math.round(convertTemp(minV, tempUnit))}°`, label: t("charts.pillMin") },
        { v: timeLabel(intervals[maxI].startTime, cadence, clockTime, dateLocale), label: t("charts.pillPeak") },
        { v: timeLabel(intervals[minI].startTime, cadence, clockTime, dateLocale), label: t("charts.pillTrough") },
      ];
    }

    if (metric === "wind") {
      const speeds = intervals.map((e) => e.values?.windSpeed).filter((v) => v != null);
      if (speeds.length === 0) return null;
      const avg = speeds.reduce((a, b) => a + b, 0) / speeds.length;
      const gusts = intervals
        .map((e) => (cadence === "hourly" ? e.values?.windGust : e.values?.windGustMax))
        .filter((v) => v != null);
      // Dominant direction: modal 8-point compass bin across the window.
      const counts = {};
      intervals.forEach((e) => {
        const key = compassKey(e.values?.windDirection);
        if (key) counts[key] = (counts[key] || 0) + 1;
      });
      const dominant = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
      const unit = speedUnitLabel(speedUnit);
      const out = [
        { v: `${Math.round(convertSpeed(avg, speedUnit))} ${unit}`, label: t("charts.pillAvg") },
      ];
      if (gusts.length > 0) {
        out.push({ v: `${Math.round(convertSpeed(Math.max(...gusts), speedUnit))} ${unit}`, label: t("charts.pillGusts") });
      }
      if (dominant) {
        out.push({ v: t(`compass.${dominant}`), label: t("charts.pillDominant") });
      }
      if (gusts.length > 0) {
        // Two short key pills instead of one long sentence — the FR/ES
        // long form overflowed the rail as a single nowrap pill
        // (review finding).
        out.push({ v: "—", label: t("charts.legendSpeed"), accent: true });
        out.push({ v: "┄", label: t("charts.pillGusts"), accent: true });
      }
      return out;
    }

    // precip
    const quantities = intervals.map((e) => {
      if (cadence === "hourly") return e.values?.precipitationIntensity || 0;
      return (e.values?.rainAccumulation || 0) + (e.values?.snowAccumulation || 0);
    });
    const total = quantities.reduce((a, b) => a + b, 0);
    const probs = intervals
      .map((e) => (cadence === "hourly"
        ? e.values?.precipitationProbability
        : (e.values?.precipitationProbabilityMax ?? e.values?.precipitationProbability)))
      .filter((v) => v != null);
    const peakI = quantities.reduce((best, v, i) => (v > quantities[best] ? i : best), 0);
    // Inches convert small mm totals below toFixed(1) resolution —
    // unit-aware decimals so drizzle doesn't read "0.0 in".
    const totalConverted = convertLength(total, lengthUnit);
    const out = [
      {
        v: `${totalConverted.toFixed(lengthUnit === "in" ? 2 : 1)} ${lengthUnit}`,
        label: t(cadence === "hourly" ? "charts.period24h" : "charts.period5d"),
      },
    ];
    if (probs.length > 0) {
      out.push({ v: `${Math.round(Math.max(...probs))}%`, label: t("charts.pillProb") });
    }
    if (quantities[peakI] > 0) {
      out.push({
        v: timeLabel(intervals[peakI].startTime, cadence, clockTime, getDateLocale(i18n.language)),
        label: t("charts.pillPeak"),
      });
    }
    out.push({ v: "···", label: t("charts.legendProb"), accent: true });
    return out;
  }, [intervals, metric, cadence, tempUnit, speedUnit, lengthUnit, clockTime, i18n.language, t]);

  if (!pills) return null;

  return (
    <div className={styles.summaryRow}>
      {pills.map(({ v, label, accent }) => (
        <span key={`${label}-${v}`} className={`${styles.summaryPill} ${accent ? styles.summaryPillAccent : ""}`}>
          <strong>{v}</strong> {label}
        </span>
      ))}
    </div>
  );
};

ForecastSummaryPills.propTypes = {
  cadence: PropTypes.oneOf(["hourly", "daily"]).isRequired,
  metric: PropTypes.oneOf(["temp", "wind", "precip"]).isRequired,
};

export default ForecastSummaryPills;
