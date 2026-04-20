import React, { useEffect, useContext, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import Spinner from "~/components/Spinner";
import { AppContext } from "~/AppContext";
import styles from "./styles.css";
import LocationName from "~/components/LocationName";
import CurrentWeather from "~/components/CurrentWeather";
import DailyChart from "~/components/weatherCharts/DailyChart";
import HourlyChart from "~/components/weatherCharts/HourlyChart";
import AiSummary from "~/components/AiSummary";

const CURRENT_WEATHER_DATA_UPDATE_INTERVAL = 10 * 60 * 1000; //every 10 minutes
const HOURLY_WEATHER_DATA_UPDATE_INTERVAL = 60 * 60 * 1000; //every hour
const DAILY_WEATHER_DATA_UPDATE_INTERVAL = 24 * 60 * 60 * 1000; //every day

/**
 * Creates an interval to call a weather update callback
 *
 * @param {object} params
 * @param {object} params.stateInterval Interval in state
 * @param {Function} params.stateIntervalSetter state interval setter
 * @param {Function} params.cb callback to invoke on each interval
 * @param {Number} params.intervalTime interval frequency, ms
 * @param {String} params.weatherApiKey weather API key
 * @param {object} params.mapGeo coordinates to get weather for
 */
function createWeatherUpdateInterval({
  stateInterval,
  stateIntervalSetter,
  cb,
  intervalTime,
  weatherApiKey,
  mapGeo,
}) {
  if (stateInterval) {
    clearInterval(stateInterval);
    stateIntervalSetter(null);
  }
  if (weatherApiKey && mapGeo) {
    const interval = setInterval(cb, intervalTime);
    cb();
    stateIntervalSetter(interval);
  }
}

/**
 * Displays weather info
 *
 * @returns {JSX.Element} Clock component
 */
const WeatherInfo = () => {
  const {
    getWeatherApiKey,
    getReverseGeoApiKey,
    reverseGeoApiKey,
    updateCurrentWeatherData,
    updateHourlyWeatherData,
    updateDailyWeatherData,
    mapGeo,
    weatherApiKey,
    currentWeatherDataErr,
    currentWeatherDataErrMsg,
    darkMode,
    setSettingsMenuOpen,
    currentWeatherData,
    updateSunriseSunset,
    fontSize,
  } = useContext(AppContext);

  const fontSizeZoom = { s: 0.85, m: 1.0, l: 1.15 }[fontSize] || 1.0;
  const chartWrapperStyle = { zoom: +(1 / fontSizeZoom).toFixed(4) };

  const [activeChart, setActiveChart] = useState("hourly");
  const [isSmallScreen, setIsSmallScreen] = useState(
    () => window.matchMedia("(max-height: 520px)").matches
  );

  useEffect(() => {
    const mq = window.matchMedia("(max-height: 520px)");
    const handler = (e) => setIsSmallScreen(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  const { t } = useTranslation();

  const [
    currentWeatherUpdateInterval,
    setCurrentWeatherUpdateInterval,
  ] = useState(null);
  const [
    hourlyWeatherUpdateInterval,
    setHourlyWeatherUpdateInterval,
  ] = useState(null);
  const [dailyWeatherUpdateInterval, setDailyWeatherUpdateInterval] = useState(
    null
  );
  const [err, setErr] = useState(null);

  const hourlyWeatherUpdateCb = useCallback(() => {
    updateSunriseSunset(mapGeo);
    updateHourlyWeatherData(mapGeo).catch((err) => {
      console.log("err", err);
    });
  }, [updateHourlyWeatherData, updateSunriseSunset, mapGeo]);

  const dailyWeatherUpdateCb = useCallback(() => {
    updateDailyWeatherData(mapGeo).catch((err) => {
      console.log("err", err);
    });
  }, [updateDailyWeatherData, mapGeo]);

  const currentWeatherUpdateCb = useCallback(() => {
    updateCurrentWeatherData(mapGeo).catch((err) => {
      console.log("err", err);
    });
  }, [updateCurrentWeatherData, mapGeo]);

  useEffect(() => {
    setErr(false);
    if (!weatherApiKey) {
      getWeatherApiKey().catch((err) => {
        console.log("error getting weather api key:", err);
        setErr(true);
        setSettingsMenuOpen(true);
      });
    }
    if (!reverseGeoApiKey) {
      getReverseGeoApiKey().catch((err) => {
        console.log("error getting reverse geo api key:", err);
      });
    }
  }, [weatherApiKey, reverseGeoApiKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    createWeatherUpdateInterval({
      stateInterval: currentWeatherUpdateInterval,
      stateIntervalSetter: setCurrentWeatherUpdateInterval,
      cb: currentWeatherUpdateCb,
      intervalTime: CURRENT_WEATHER_DATA_UPDATE_INTERVAL,
      weatherApiKey,
      mapGeo,
    });
    createWeatherUpdateInterval({
      stateInterval: hourlyWeatherUpdateInterval,
      stateIntervalSetter: setHourlyWeatherUpdateInterval,
      cb: hourlyWeatherUpdateCb,
      intervalTime: HOURLY_WEATHER_DATA_UPDATE_INTERVAL,
      weatherApiKey,
      mapGeo,
    });
    createWeatherUpdateInterval({
      stateInterval: dailyWeatherUpdateInterval,
      stateIntervalSetter: setDailyWeatherUpdateInterval,
      cb: dailyWeatherUpdateCb,
      intervalTime: DAILY_WEATHER_DATA_UPDATE_INTERVAL,
      weatherApiKey,
      mapGeo,
    });
    return () => {
      clearInterval(currentWeatherUpdateInterval);
      clearInterval(hourlyWeatherUpdateInterval);
      clearInterval(dailyWeatherUpdateInterval);
    };
  }, [weatherApiKey, mapGeo]); // eslint-disable-line react-hooks/exhaustive-deps

  if (currentWeatherData) {
    return (
      <div className={styles.container}>
        <div className={styles.location}>
          <LocationName />
        </div>
        <div>
          <CurrentWeather />
        </div>
        <div className={styles.chartLegend}>
          <span className={styles.legendItem}>
            <span className={`${styles.legendDot} ${styles.legendDotGray}`} />
            {t("charts.temp")} / {t("charts.windSpeed")}
          </span>
          <span className={styles.legendItem}>
            <span className={`${styles.legendDot} ${styles.legendDotBlue}`} />
            {t("charts.precipitation")}
          </span>
        </div>
        {isSmallScreen ? (
          <>
            <div className={styles.chartTabs}>
              <button
                className={`${styles.chartTab} ${darkMode ? styles.chartTabDark : styles.chartTabLight} ${activeChart === "hourly" ? styles.chartTabActive : ""}`}
                onClick={() => setActiveChart("hourly")}
              >
                {t("charts.tab24h")}
              </button>
              <button
                className={`${styles.chartTab} ${darkMode ? styles.chartTabDark : styles.chartTabLight} ${activeChart === "daily" ? styles.chartTabActive : ""}`}
                onClick={() => setActiveChart("daily")}
              >
                {t("charts.tab5d")}
              </button>
            </div>
            <div className={styles.weatherChart} style={chartWrapperStyle}>
              {activeChart === "hourly" ? <HourlyChart /> : <DailyChart />}
            </div>
          </>
        ) : (
          <>
            <div className={styles.weatherChart} style={chartWrapperStyle}>
              <HourlyChart />
            </div>
            <div className={styles.weatherChart} style={chartWrapperStyle}>
              <DailyChart />
            </div>
          </>
        )}
        <AiSummary />
      </div>
    );
  } else if (currentWeatherData || currentWeatherDataErr || err) {
    return (
      <div
        className={`${styles.errContainer} ${
          darkMode ? styles.dark : styles.light
        }`}
      >
        <div>{t("errors.weatherDataFailed")}</div>
        <div>{t("errors.weatherApiKeyInvalid")}</div>
        {currentWeatherDataErr ? (
          <div className={styles.message}>{currentWeatherDataErrMsg}</div>
        ) : null}
      </div>
    );
  } else {
    return (
      <div className={styles.loadingContainer}>
        <Spinner size={"20px"} color={darkMode ? "#f6f6f444" : "#3a393844"} />
      </div>
    );
  }
};

export default WeatherInfo;
