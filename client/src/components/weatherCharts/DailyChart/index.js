import React, { useContext, useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { AppContext } from "~/AppContext";
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
import { fontColor } from "../common";
import { useTimeOfDay } from "~/ui/hybrid";
import { getDateLocale } from "~/i18n/dateLocale";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

const createChartOptions = ({
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
        font: { family: "Rubik, sans-serif" },
      },
    },
    scales: {
      x: {
        ticks: {
          color: fontColor(darkMode, nightRed),
          font: { family: "Rubik, sans-serif" },
        },
      },
      y: {
        type: "linear",
        display: true,
        position: "left",
        ticks: {
          color: fontColor(darkMode, nightRed),
          font: { family: "Rubik, sans-serif" },
          maxTicksLimit: 5,
          callback: (val) => {
            return altMode
              ? `${val} ${speedUnitLabel(speedUnit)}`
              : `${val} ${tempUnit.toUpperCase()}`;
          },
        },
      },
      y1: {
        type: "linear",
        display: true,
        position: "right",
        ticks: {
          color: fontColor(darkMode, nightRed),
          font: { family: "Rubik, sans-serif" },
          maxTicksLimit: 5,
          suggestedMin: 0,
          callback: (val) => {
            return `${val}${altMode ? ` ${lengthUnit}` : "%"}`;
          },
        },
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
  altMode,
  lengthUnit,
  labelMain,
  labelPrecip,
  dateLocale,
}) => {
  const data = weatherData?.data?.timelines?.[0]?.intervals;
  if (!data) {
    return null;
  }
  return {
    labels: data.map((e) => {
      const date = new Date(e.startTime);
      const adjustedTimestamp =
        date.getTime() + date.getTimezoneOffset() * 60 * 1000;
      return format(new Date(adjustedTimestamp), "EEEEE", { locale: dateLocale });
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
 * Daily forecast chart
 *
 * @returns {JSX.Element} Hourly forecast chart
 */
const DailyChart = () => {
  const {
    dailyWeatherData,
    dailyWeatherDataErr,
    dailyWeatherDataErrMsg,
    tempUnit,
    darkMode,
    lengthUnit,
    speedUnit,
  } = useContext(AppContext);
  const { t, i18n } = useTranslation();
  // Canvas-drawn chart text: pass the active palette into fontColor()
  // so axes / title pick up the nightRed tint when active.
  const nightRed = useTimeOfDay() === "nightRed";

  const [altMode, setAltMode] = useState(false);
  const [chartData, setChartData] = useState(null);
  const [chartOptions, setChartOptions] = useState(null);

  const setChartDataCallback = useCallback((e) => setChartData(e), []);
  const setChartOptionsCallback = useCallback((e) => setChartOptions(e), []);

  useEffect(() => {
    if (dailyWeatherData) {
      const title = altMode
        ? t("charts.5dayWind", { unit: lengthUnit })
        : t("charts.5dayTemp");
      const labelMain = altMode ? t("charts.windSpeed") : t("charts.temp");
      const labelPrecip = t("charts.precipitation");

      setChartDataCallback(
        mapChartData({
          data: dailyWeatherData,
          tempUnit,
          lengthUnit,
          speedUnit,
          altMode,
          labelMain,
          labelPrecip,
          dateLocale: getDateLocale(i18n.language),
        })
      );

      setChartOptionsCallback(
        createChartOptions({
          tempUnit,
          darkMode,
          nightRed,
          lengthUnit,
          speedUnit,
          altMode,
          title,
        })
      );
    }
  }, [
    dailyWeatherData,
    tempUnit,
    lengthUnit,
    altMode,
    speedUnit,
    darkMode,
    nightRed,
    t,
    i18n.language,
    setChartOptionsCallback,
    setChartDataCallback,
  ]);

  if (chartData && chartOptions) {
    return (
      <div
        className={styles.container}
        onClick={() => {
          setAltMode(!altMode);
        }}
      >
        <Line options={chartOptions} data={chartData} />
      </div>
    );
  } else if (dailyWeatherDataErr) {
    return (
      <div
        className={`${darkMode ? styles.dark : styles.light} ${
          styles.errContainer
        }`}
      >
        <div>{t("errors.dailyForecastFailed")}</div>
        <div className={styles.message}>{dailyWeatherDataErrMsg}</div>
      </div>
    );
  } else {
    return null;
  }
};

export default DailyChart;
