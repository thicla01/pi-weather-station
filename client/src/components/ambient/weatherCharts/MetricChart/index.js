import React, { useContext, useMemo } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  LineController,
  BarController,
  Filler,
  Tooltip,
} from "chart.js";
import ChartDataLabels from "chartjs-plugin-datalabels";
import { Chart } from "react-chartjs-2";
import { format } from "date-fns";
import { UiPrefsContext, WeatherDataContext } from "~/AppContext";
import { getDateLocale } from "~/i18n/dateLocale";
import {
  convertTemp,
  convertLength,
  convertSpeed,
  speedUnitLabel,
} from "~/services/conversions";
import { fontColor, gridColor, metricColors, withAlpha } from "../common";
import { useTimeOfDay } from "~/ui/hybrid";
import styles from "../styles.css";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  LineController,
  BarController,
  // Filler paints the temp tab's area fill — `fill: true` is a silent
  // no-op without it in Chart.js v4's tree-shakeable entry.
  Filler,
  Tooltip
);

// Direction arrows under the Vent chart — cap so the row stays
// scannable (hourly: every 3rd hour ≈ 8 arrows; daily: one per day).
const MAX_DIR_ARROWS = 8;

/**
 * Pull the interval list out of a Tomorrow.io envelope.
 *
 * @param {object} weatherData Tomorrow.io response envelope
 * @returns {Array|null} intervals, or null when absent
 */
function getIntervals(weatherData) {
  return weatherData?.data?.timelines?.[0]?.intervals || null;
}

/**
 * Mono-metric forecast chart (v3.1 Phase 5) — one chart per metric tab:
 *
 *   temp   → accent line + 10 % area fill, key-point value labels on
 *            the max/min (chartjs-plugin-datalabels), `14°` axis (F13)
 *   wind   → speed line + dashed teal gust line + a wind-direction
 *            arrow row under the axis (unit once, on the top tick)
 *   precip → accumulation bars + dashed probability line (right axis
 *            hidden — the shape carries it, the summary pill quantifies)
 *
 * The optional `precipOverlay` (maintainer decision, Phase 5 review)
 * superimposes the precip pair — subdued bars + dashed probability —
 * on the temp/wind tabs for users who relied on the old paired charts.
 *
 * Used by the v3 ChartTabs only; the v2 tree keeps the legacy paired
 * HourlyChart/DailyChart until its scheduled removal. The in-canvas
 * title is gone — the panel header (`PRÉVISIONS` + period pills) owns
 * naming now, per the design.
 *
 * @param {object} props
 * @param {string} props.cadence "hourly" (24 h) or "daily" (5 days)
 * @param {string} props.metric "temp" | "wind" | "precip"
 * @param {boolean} props.precipOverlay Superimpose subdued precip bars + probability on temp/wind
 * @param {Function} [props.onCycle] Chart-area tap handler (cycles the metric, the v2 muscle-memory gesture)
 * @returns {JSX.Element|null} the chart (plus the wind-direction row), an error label, or null while loading
 */
const MetricChart = ({ cadence, metric, precipOverlay, onCycle }) => {
  const {
    hourlyWeatherData,
    hourlyWeatherDataErr,
    dailyWeatherData,
    dailyWeatherDataErr,
  } = useContext(WeatherDataContext);
  const {
    tempUnit,
    darkMode,
    clockTime,
    lengthUnit,
    speedUnit,
  } = useContext(UiPrefsContext);
  const { t, i18n } = useTranslation();
  const nightRed = useTimeOfDay() === "nightRed";

  const weatherData = cadence === "hourly" ? hourlyWeatherData : dailyWeatherData;
  const dataErr = cadence === "hourly" ? hourlyWeatherDataErr : dailyWeatherDataErr;
  const intervals = getIntervals(weatherData);
  // Memoized: a fresh object every render would defeat the chartData
  // memo below and force a canvas update on every parent re-render.
  const colors = useMemo(() => metricColors(darkMode, nightRed), [darkMode, nightRed]);

  // ---- labels -------------------------------------------------------
  const labels = useMemo(() => {
    if (!intervals) return null;
    const dateLocale = getDateLocale(i18n.language);
    return intervals.map((e) => {
      const date = new Date(e.startTime);
      if (cadence === "hourly") {
        return clockTime === "12"
          ? `${format(date, "h")}${format(date, "aaaaa")}`
          : format(date, "HH");
      }
      // Daily timestamps are date-anchored UTC — shift so the weekday
      // letter doesn't slip a day in western timezones (same fix the
      // legacy DailyChart carries).
      const adjusted = date.getTime() + date.getTimezoneOffset() * 60 * 1000;
      return format(new Date(adjusted), "EEEEE", { locale: dateLocale });
    });
  }, [intervals, cadence, clockTime, i18n.language]);

  // ---- per-metric series --------------------------------------------
  const series = useMemo(() => {
    if (!intervals) return null;
    const tempValues = intervals.map((e) => convertTemp(e.values?.temperature, tempUnit));
    const speedValues = intervals.map((e) => convertSpeed(e.values?.windSpeed, speedUnit));
    const gustRaw = intervals.map((e) => {
      const g = cadence === "hourly" ? e.values?.windGust : e.values?.windGustMax;
      return g == null ? null : convertSpeed(g, speedUnit);
    });
    const hasGusts = gustRaw.some((v) => v != null);
    const quantityValues = intervals.map((e) => {
      if (cadence === "hourly") {
        // mm/h over 1-hour intervals ≈ mm for the hour.
        return convertLength(e.values?.precipitationIntensity || 0, lengthUnit);
      }
      const rain = e.values?.rainAccumulation || 0;
      const snow = e.values?.snowAccumulation || 0;
      return convertLength(rain + snow, lengthUnit);
    });
    const probValues = intervals.map((e) => (
      cadence === "hourly"
        ? e.values?.precipitationProbability
        : (e.values?.precipitationProbabilityMax ?? e.values?.precipitationProbability)
    ));
    const directions = intervals.map((e) => e.values?.windDirection ?? null);
    return { tempValues, speedValues, gustRaw, hasGusts, quantityValues, probValues, directions };
  }, [intervals, cadence, tempUnit, speedUnit, lengthUnit]);

  // Key points (temp tab): indexes of the max and min — they get a dot
  // and a value label, per the design's "key points with labels".
  const keyIdx = useMemo(() => {
    if (!series || metric !== "temp") return [];
    const vals = series.tempValues;
    let maxI = -1;
    let minI = -1;
    vals.forEach((v, i) => {
      if (v == null) return;
      if (maxI < 0 || v > vals[maxI]) maxI = i;
      if (minI < 0 || v < vals[minI]) minI = i;
    });
    if (maxI < 0) return [];
    return maxI === minI ? [maxI] : [maxI, minI];
  }, [series, metric]);

  const chartData = useMemo(() => {
    if (!series || !labels) return null;
    const datasets = [];
    if (metric === "temp") {
      datasets.push({
        type: "line",
        label: t("charts.tabTemp"),
        data: series.tempValues,
        yAxisID: "y",
        borderColor: colors.line,
        backgroundColor: withAlpha(colors.line, 0.10),
        fill: true,
        tension: 0.4,
        borderWidth: 2.2,
        pointRadius: (ctx) => (keyIdx.includes(ctx.dataIndex) ? 3.5 : 0),
        pointBackgroundColor: colors.line,
        borderCapStyle: "round",
      });
    } else if (metric === "wind") {
      datasets.push({
        type: "line",
        label: t("charts.tabWind"),
        data: series.speedValues,
        yAxisID: "y",
        borderColor: colors.line,
        backgroundColor: colors.line,
        fill: false,
        tension: 0.4,
        borderWidth: 2.2,
        pointRadius: 0,
        borderCapStyle: "round",
      });
      if (series.hasGusts) {
        datasets.push({
          type: "line",
          label: t("charts.pillGusts"),
          data: series.gustRaw,
          yAxisID: "y",
          borderColor: colors.gusts,
          backgroundColor: colors.gusts,
          fill: false,
          tension: 0.4,
          borderWidth: 1.5,
          borderDash: [4, 3],
          pointRadius: 0,
          spanGaps: true,
        });
      }
    } else {
      datasets.push({
        type: "bar",
        label: t("charts.precipitation"),
        data: series.quantityValues,
        yAxisID: "y",
        backgroundColor: withAlpha(colors.precip, 0.75),
        borderRadius: 2,
      });
      datasets.push({
        type: "line",
        label: t("charts.pillProb"),
        data: series.probValues,
        yAxisID: "yProb",
        borderColor: colors.prob,
        backgroundColor: colors.prob,
        fill: false,
        tension: 0.4,
        borderWidth: 1.8,
        borderDash: [3, 3],
        pointRadius: 0,
      });
    }
    // Optional subdued precip pair over temp/wind — quantity bars +
    // probability line, both dimmed so the primary series stays primary.
    if (precipOverlay && metric !== "precip") {
      datasets.push({
        type: "bar",
        label: t("charts.precipitation"),
        data: series.quantityValues,
        yAxisID: "yQty",
        backgroundColor: withAlpha(colors.precip, 0.3),
        borderRadius: 2,
      });
      datasets.push({
        type: "line",
        label: t("charts.pillProb"),
        data: series.probValues,
        yAxisID: "yProb",
        borderColor: withAlpha(colors.prob, 0.5),
        backgroundColor: withAlpha(colors.prob, 0.5),
        fill: false,
        tension: 0.4,
        borderWidth: 1.5,
        borderDash: [3, 3],
        pointRadius: 0,
      });
    }
    return { labels, datasets };
  }, [series, labels, metric, precipOverlay, colors, keyIdx, t]);

  const chartOptions = useMemo(() => {
    const axisFont = { family: "Geist, system-ui, -apple-system, sans-serif" };
    const tickColor = fontColor(darkMode, nightRed);
    // Unit shown ONCE, on the top tick (F13: "14°" everywhere on temp;
    // kph / mm only where they're not obvious).
    const yCallback = (val, index, ticks) => {
      if (metric === "temp") return `${val}°`;
      const unit = metric === "wind" ? speedUnitLabel(speedUnit) : lengthUnit;
      return index === ticks.length - 1 ? `${val} ${unit}` : `${val}`;
    };
    return {
      maintainAspectRatio: false,
      responsive: true,
      interaction: { mode: "index" },
      // Headroom so the key-point value labels don't clip at the top.
      layout: { padding: { top: metric === "temp" ? 16 : 4 } },
      plugins: {
        legend: { display: false },
        datalabels: {
          display: (ctx) => metric === "temp"
            && ctx.datasetIndex === 0
            && keyIdx.includes(ctx.dataIndex),
          anchor: "end",
          align: "top",
          offset: 2,
          clip: false,
          color: tickColor,
          font: { ...axisFont, size: 11, weight: 500 },
          formatter: (v) => `${Math.round(v)}°`,
        },
      },
      scales: {
        x: {
          ticks: { color: tickColor, font: axisFont },
          grid: { color: gridColor(darkMode, nightRed) },
        },
        y: {
          type: "linear",
          position: "left",
          // Explicit per-metric zero behaviour: the chart's base type
          // is "bar", whose controller override would otherwise force
          // beginAtZero on EVERY value axis — squashing a 12-26° curve
          // against a 0-anchored axis (review finding). Wind/precip
          // genuinely start at zero.
          beginAtZero: metric !== "temp",
          // Temp only: a grace band above the max (and below the min) so
          // the key-point value labels — drawn ABOVE their points
          // (`align: "top"`) — sit inside the plot area instead of
          // clipping at the canvas top when the data max coincides with
          // the top gridline (e.g. an 82° peak landing exactly on the
          // 82° tick). The `layout.padding.top` alone wasn't enough: the
          // label height + offset ≈ the padding, leaving its top row to
          // clip. `grace` pushes the peak down by a fraction of the data
          // range — pixel-independent, so it holds across font-size zoom
          // and any range. Wind/precip carry no key-point labels.
          grace: metric === "temp" ? "10%" : 0,
          ticks: {
            color: tickColor,
            font: axisFont,
            maxTicksLimit: 5,
            callback: yCallback,
          },
          grid: { color: gridColor(darkMode, nightRed) },
        },
        // Probability rides a hidden 0-100 axis — the dashed shape reads
        // as "chance", the summary pill quantifies it. Declared even
        // when unused: an absent axis would crash the dataset binding.
        yProb: { type: "linear", display: false, min: 0, max: 100 },
        // Hidden axis for the overlay's quantity bars (temp/wind tabs).
        yQty: { type: "linear", display: false, suggestedMin: 0 },
      },
    };
  }, [metric, darkMode, nightRed, speedUnit, lengthUnit, keyIdx]);

  // Wind-direction arrow row — sampled so the row never exceeds
  // MAX_DIR_ARROWS. Arrows point WHERE the wind goes (meteorological
  // direction + 180°); rotated inline SVG, no font-glyph dependence.
  const dirArrows = useMemo(() => {
    if (metric !== "wind" || !series) return null;
    const step = Math.max(1, Math.ceil(series.directions.length / MAX_DIR_ARROWS));
    const sampled = series.directions.filter((_, i) => i % step === 0);
    if (!sampled.some((d) => d != null)) return null;
    return sampled;
  }, [metric, series]);

  if (!chartData) {
    if (dataErr) {
      return (
        <div className={`${darkMode ? styles.dark : styles.light} ${styles.errContainer}`}>
          <div>{t(cadence === "hourly" ? "errors.hourlyForecastFailed" : "errors.dailyForecastFailed")}</div>
        </div>
      );
    }
    return null;
  }

  return (
    <div className={styles.container} onClick={onCycle}>
      {/* Dedicated sized box for the canvas: Chart.js measures its
        * PARENT — without this wrapper the wind tab's arrow row would
        * shrink the canvas's flex box while the bitmap stayed full
        * height (vertical squash + DPR blur, review finding). */}
      <div className={styles.canvasBox}>
        <Chart
          type="bar"
          data={chartData}
          options={chartOptions}
          plugins={[ChartDataLabels]}
        />
      </div>
      {dirArrows ? (
        <div className={styles.windDirRow} aria-hidden="true">
          {dirArrows.map((deg, i) => (
            <span key={`dir-${i}`} className={styles.windDirCell}>
              {deg == null ? "" : (
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  style={{ transform: `rotate(${(deg + 180) % 360}deg)` }}
                >
                  <path d="M12 4 L12 20 M7 15 L12 20 L17 15" />
                </svg>
              )}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
};

MetricChart.propTypes = {
  cadence: PropTypes.oneOf(["hourly", "daily"]).isRequired,
  metric: PropTypes.oneOf(["temp", "wind", "precip"]).isRequired,
  precipOverlay: PropTypes.bool,
  onCycle: PropTypes.func,
};

export default MetricChart;
