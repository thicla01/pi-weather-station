import React, { useContext, useState, useEffect, useMemo } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { UiPrefsContext, WeatherDataContext } from "~/AppContext";
import styles from "../styles.css";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { format } from "date-fns";
import {
  convertTemp,
  convertLength,
  convertSpeed,
  speedUnitLabel,
} from "~/services/conversions";
import { fontColor, gridColor } from "../common";
import { useTimeOfDay } from "~/ui/hybrid";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

const buildChartOptions = ({
  darkMode,
  nightRed,
  tempUnit,
  speedUnit,
  lengthUnit,
  altMode,
  title,
}) => {
  return {
    maintainAspectRatio: false,
    responsive: true,
    interaction: {
      mode: "index",
    },
    plugins: {
      legend: {
        display: false,
      },
      title: {
        display: true,
        text: title,
        color: fontColor(darkMode, nightRed),
        font: { family: "Geist, system-ui, -apple-system, sans-serif" },
      },
    },
    scales: {
      x: {
        ticks: {
          color: fontColor(darkMode, nightRed),
          font: { family: "Geist, system-ui, -apple-system, sans-serif" },
        },
        // Explicit grid colour — Chart.js's default `rgba(0,0,0,0.1)`
        // disappears against dark / nightRed surfaces. See gridColor()
        // in ../common.js for the per-palette values.
        grid: {
          color: gridColor(darkMode, nightRed),
        },
      },
      y: {
        type: "linear",
        display: true,
        position: "left",
        ticks: {
          color: fontColor(darkMode, nightRed),
          font: { family: "Geist, system-ui, -apple-system, sans-serif" },
          maxTicksLimit: 5,
          callback: (val) => {
            return altMode
              ? `${val} ${speedUnitLabel(speedUnit)}`
              : `${val} ${tempUnit.toUpperCase()}`;
          },
        },
        grid: {
          color: gridColor(darkMode, nightRed),
        },
      },
      y1: {
        type: "linear",
        display: true,
        position: "right",
        ticks: {
          color: fontColor(darkMode, nightRed),
          font: { family: "Geist, system-ui, -apple-system, sans-serif" },
          maxTicksLimit: 5,
          suggestedMin: 0,
          callback: (val) => {
            return `${val}${altMode ? ` ${lengthUnit}` : "%"}`;
          },
        },
        // y1 is the right-side axis for precipitation %. Its grid lines
        // are intentionally suppressed so we don't get double horizontal
        // grids — only the left y axis draws horizontals.
        grid: {
          drawOnChartArea: false,
        },
      },
    },
  };
};

const chartColors = {
  blue: "rgba(63, 127, 191, 0.5)",
  gray: "rgba(127, 127, 127, 0.5)",
};

const mapChartData = ({
  data: weatherData,
  tempUnit,
  speedUnit,
  clockTime,
  altMode,
  lengthUnit,
  labelMain,
  labelPrecip,
}) => {
  const data = weatherData?.data?.timelines?.[0]?.intervals;
  if (!data) {
    return null;
  }
  return {
    labels: data.map((e) => {
      if (clockTime === "12") {
        return `${format(new Date(e.startTime), "h")}${format(
          new Date(e.startTime),
          "aaaaa"
        )}`;
      } else {
        return `${format(new Date(e.startTime), "HH")}`;
      }
    }),
    datasets: [
      {
        radius: 0,
        tension: 0.4,
        label: labelMain,
        data: data.map((e) => {
          const {
            values: { windSpeed, temperature },
          } = e;
          return altMode
            ? convertSpeed(windSpeed, speedUnit)
            : convertTemp(temperature, tempUnit);
        }),
        yAxisID: "y",
        borderColor: chartColors.gray,
        backgroundColor: chartColors.gray,
        fill: false,
      },
      {
        radius: 0,
        tension: 0.4,
        label: labelPrecip,
        data: data.map((e) => {
          const {
            values: { precipitationIntensity, precipitationProbability },
          } = e;
          return altMode
            ? convertLength(precipitationIntensity, lengthUnit)
            : precipitationProbability;
        }),
        yAxisID: "y1",
        borderColor: chartColors.blue,
        backgroundColor: chartColors.blue,
        fill: false,
      },
    ],
  };
};

/**
 * Hourly forecast chart.
 *
 * Supports two modes — temperature + precipitation, or wind speed +
 * precipitation. By default the component manages the mode internally
 * and toggles it on chart-area tap (v2 behaviour). When the parent
 * passes `altMode` + `onAltToggle` (controlled), the chart respects the
 * parent's state and forwards taps to the callback instead — used by
 * v3's `ChartTabs` so the cycle indicator dots and the tap gesture stay
 * in sync.
 *
 * @param {object} [props]
 * @param {boolean} [props.altMode] Controlled mode flag (false = temp, true = wind). When omitted, the component falls back to internal state.
 * @param {Function} [props.onAltToggle] Called on chart-area tap when controlled. Receives no arguments — parents decide what the next state is.
 * @returns {JSX.Element} Hourly forecast chart
 */
const HourlyChart = ({ altMode: altModeProp, onAltToggle }) => {
  const {
    hourlyWeatherData,
    hourlyWeatherDataErr,
  } = useContext(WeatherDataContext);
  const {
    tempUnit,
    darkMode,
    clockTime,
    lengthUnit,
    speedUnit,
  } = useContext(UiPrefsContext);
  const { t } = useTranslation();
  // Canvas-drawn chart text can't inherit CSS variables — pass the
  // active palette flag through to fontColor() so the title and axes
  // pick up the night-red tint when the sleep-stage-1 palette is on.
  const nightRed = useTimeOfDay() === "nightRed";

  // Controlled-vs-uncontrolled: prop wins when provided. The internal
  // state stays around so v2's InfoPanel (which doesn't pass altMode)
  // keeps its tap-to-toggle behaviour without further changes.
  const [altModeLocal, setAltModeLocal] = useState(false);
  const altMode = altModeProp !== undefined ? altModeProp : altModeLocal;
  const handleClick = () => {
    if (onAltToggle) onAltToggle();
    else setAltModeLocal((m) => !m);
  };
  const [chartData, setChartData] = useState(null);
  useEffect(() => {
    if (hourlyWeatherData) {
      setChartData(
        mapChartData({
          data: hourlyWeatherData,
          tempUnit,
          clockTime,
          lengthUnit,
          speedUnit,
          altMode,
          labelMain: altMode ? t("charts.windSpeed") : t("charts.temp"),
          labelPrecip: t("charts.precipitation"),
        })
      );
    }
  }, [hourlyWeatherData, tempUnit, clockTime, lengthUnit, altMode, speedUnit, t]);

  const title = altMode
    ? t("charts.24hourWind", { unit: lengthUnit })
    : t("charts.24hourTemp");

  // Memoized: react-chartjs-2 compares `options` by reference, so a
  // fresh object every render forced chart.update() (full canvas
  // re-layout + redraw) on every app-wide re-render — each context
  // poll, dock toggle or zoomend repainted an identical chart. Same
  // intent as DailyChart's state-held options, expressed as a memo.
  const chartOptions = useMemo(
    () => buildChartOptions({
      tempUnit,
      darkMode,
      nightRed,
      lengthUnit,
      speedUnit,
      altMode,
      title,
    }),
    [tempUnit, darkMode, nightRed, lengthUnit, speedUnit, altMode, title]
  );

  if (chartData) {
    return (
      <div
        className={styles.container}
        onClick={handleClick}
      >
        <Line
          data={chartData}
          options={chartOptions}
        />
      </div>
    );
  } else if (hourlyWeatherDataErr) {
    return (
      <div
        className={`${darkMode ? styles.dark : styles.light} ${
          styles.errContainer
        }`}
      >
        {/* Raw axios error string (e.g. "Request failed with status code 429")
         * is intentionally not shown — it's meaningless to a kiosk user and
         * leaks HTTP internals. The translated label is enough; detailed
         * diagnostics are available in the Debug panel. */}
        <div>{t("errors.hourlyForecastFailed")}</div>
      </div>
    );
  } else {
    return null;
  }
};

HourlyChart.propTypes = {
  altMode: PropTypes.bool,
  onAltToggle: PropTypes.func,
};

export default HourlyChart;
