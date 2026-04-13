import React, { useContext, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { AppContext } from "~/AppContext";
import styles from "../styles.css";
import { Line } from "react-chartjs-2";
import { format } from "date-fns";
import {
  convertTemp,
  convertLength,
  convertSpeed,
} from "~/services/conversions";
import { fontColor } from "../common";

const buildChartOptions = ({
  darkMode,
  tempUnit,
  speedUnit,
  lengthUnit,
  altMode,
  title,
}) => {
  return {
    maintainAspectRatio: false,
    legend: {
      display: false,
    },
    responsive: true,
    hoverMode: "index",
    stacked: false,
    title: {
      display: true,
      text: title,
      fontColor: fontColor(darkMode),
      fontFamily: "Rubik, sans-serif",
    },
    scales: {
      xAxes: [
        {
          ticks: {
            fontColor: fontColor(darkMode),
            fontFamily: "Rubik, sans-serif",
          },
        },
      ],
      yAxes: [
        {
          type: "linear",
          display: true,
          position: "left",
          id: "y-axis-1",
          ticks: {
            fontColor: fontColor(darkMode),
            fontFamily: "Rubik, sans-serif",
            maxTicksLimit: 5,
            callback: (val) => {
              return altMode
                ? `${val} ${speedUnit === "mph" ? "mph" : "m/s"}`
                : `${val} ${tempUnit.toUpperCase()}`;
            },
          },
        },
        {
          type: "linear",
          display: true,
          position: "right",
          id: "y-axis-2",
          ticks: {
            fontColor: fontColor(darkMode),
            fontFamily: "Rubik, sans-serif",
            maxTicksLimit: 5,
            suggestedMin: 0,
            callback: (val) => {
              return `${val}${altMode ? ` ${lengthUnit}` : "%"}`;
            },
          },
          gridLines: {
            drawOnChartArea: false,
          },
        },
      ],
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
        label: labelMain,
        data: data.map((e) => {
          const {
            values: { windSpeed, temperature },
          } = e;
          return altMode
            ? convertSpeed(windSpeed, speedUnit)
            : convertTemp(temperature, tempUnit);
        }),
        yAxisID: "y-axis-1",
        borderColor: chartColors.gray,
        backgroundColor: chartColors.gray,
        fill: false,
      },
      {
        radius: 0,
        label: labelPrecip,
        data: data.map((e) => {
          const {
            values: { precipitationIntensity, precipitationProbability },
          } = e;
          return altMode
            ? convertLength(precipitationIntensity, lengthUnit)
            : precipitationProbability;
        }),
        yAxisID: "y-axis-2",
        borderColor: chartColors.blue,
        backgroundColor: chartColors.blue,
        fill: false,
      },
    ],
  };
};

/**
 * Hourly forecast chart
 *
 * @returns {JSX.Element} Hourly forecast chart
 */
const HourlyChart = () => {
  const {
    hourlyWeatherData,
    tempUnit,
    darkMode,
    clockTime,
    lengthUnit,
    speedUnit,
    hourlyWeatherDataErr,
    hourlyWeatherDataErrMsg,
  } = useContext(AppContext);
  const { t } = useTranslation();

  const [altMode, setAltMode] = useState(false);
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

  if (chartData) {
    return (
      <div
        className={styles.container}
        onClick={() => {
          setAltMode(!altMode);
        }}
      >
        <Line
          data={chartData}
          options={buildChartOptions({
            tempUnit,
            darkMode,
            lengthUnit,
            speedUnit,
            altMode,
            title,
          })}
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
        <div>{t("errors.hourlyForecastFailed")}</div>
        <div className={styles.message}>{hourlyWeatherDataErrMsg}</div>
      </div>
    );
  } else {
    return null;
  }
};

export default HourlyChart;
