import React, { useEffect, useContext, useState, useCallback, useRef } from "react";
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
const CHART_CYCLE_DURATION = 150_000; // 2.5 minutes — auto-cycle on small screens

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
    infoPanelScrollRef,
  } = useContext(AppContext);

  const fontSizeZoom = { s: 0.85, m: 1.0, l: 1.15 }[fontSize] || 1.0;
  const chartWrapperStyle = { zoom: +(1 / fontSizeZoom).toFixed(4) };

  const [activeChart, setActiveChart] = useState("hourly");
  const [aiExpanded, setAiExpanded] = useState(false);
  const aiRef = useRef(null);
  const panelRef = useRef(null); // ref on the WeatherInfo root div
  const locationRef = useRef(null); // ref on the LocationName wrapper div
  const chartsRef = useRef(null); // ref on the chartsCollapsible div
  const prevAiExpandedRef = useRef(false);
  const [isSmallScreen, setIsSmallScreen] = useState(
    () => window.matchMedia("(max-height: 520px)").matches
  );

  // Auto-cycle between charts on small screens
  const [cycleKey, setCycleKey] = useState(0);
  const cycleTimerRef = useRef(null);

  const restartCycle = useCallback(() => {
    clearTimeout(cycleTimerRef.current);
    cycleTimerRef.current = setTimeout(() => {
      setActiveChart((prev) => (prev === "hourly" ? "daily" : "hourly"));
      setCycleKey((k) => k + 1);
      restartCycle();
    }, CHART_CYCLE_DURATION);
  }, []);

  useEffect(() => {
    if (isSmallScreen) {
      restartCycle();
    } else {
      clearTimeout(cycleTimerRef.current);
    }
    return () => clearTimeout(cycleTimerRef.current);
  }, [isSmallScreen, restartCycle]);

  useEffect(() => {
    const mq = window.matchMedia("(max-height: 520px)");
    const handler = (e) => setIsSmallScreen(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const handleAiToggle = useCallback((e) => {
    // Blur the button so the browser does not auto-scroll to keep it in focus
    e?.currentTarget?.blur();
    setAiExpanded((prev) => !prev);
  }, []);

  useEffect(() => {
    const wasExpanded = prevAiExpandedRef.current;
    prevAiExpandedRef.current = aiExpanded;

    if (aiExpanded) {
      // Scroll the info panel to top so LocationName is visible after charts collapse.
      // We trigger on transitionend of the charts div so timing is exact regardless
      // of hardware speed. A fallback timeout fires if transitionend never arrives.
      const scrollEl = infoPanelScrollRef?.current;
      const chartsEl = chartsRef?.current;

      const scrollToTop = () => { if (scrollEl) scrollEl.scrollTop = 0; };

      // Immediate scroll (handles case where panel is already idle)
      scrollToTop();

      // Fire again exactly when the collapse transition ends
      if (chartsEl) {
        chartsEl.addEventListener("transitionend", scrollToTop, { once: true });
      }
      // Fallback: in case transitionend doesn't fire (e.g. no overflow on this screen)
      const fallback = setTimeout(scrollToTop, 600);

      return () => {
        if (chartsEl) chartsEl.removeEventListener("transitionend", scrollToTop);
        clearTimeout(fallback);
      };
    }

    if (!aiExpanded && wasExpanded && aiRef.current) {
      // Collapsing: scroll the info panel back to top after charts re-expand.
      // Find the ancestor that is actually scrolled (scrollTop > 0) rather than
      // the first one with overflow-y: auto, since WeatherInfo's own container
      // also carries that property without ever scrolling.
      const timer = setTimeout(() => {
        let el = aiRef.current.parentElement;
        while (el) {
          const { overflowY } = window.getComputedStyle(el);
          if ((overflowY === "auto" || overflowY === "scroll") && el.scrollTop > 0) {
            el.scrollTo({ top: 0, behavior: "smooth" });
            break;
          }
          el = el.parentElement;
        }
      }, 380);
      return () => clearTimeout(timer);
    }
  }, [aiExpanded]); // eslint-disable-line react-hooks/exhaustive-deps -- infoPanelScrollRef is a stable ref object

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
      <div className={styles.container} ref={panelRef}>
        <div className={styles.location} ref={locationRef}>
          <LocationName />
        </div>
        <div>
          <CurrentWeather />
        </div>
        <div
          className={styles.chartsCollapsible}
          style={{ maxHeight: aiExpanded ? 0 : "1200px" }}
          ref={chartsRef}
        >
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
                  onClick={() => { setActiveChart("hourly"); setCycleKey((k) => k + 1); restartCycle(); }}
                >
                  {t("charts.tab24h")}
                </button>
                <button
                  className={`${styles.chartTab} ${darkMode ? styles.chartTabDark : styles.chartTabLight} ${activeChart === "daily" ? styles.chartTabActive : ""}`}
                  onClick={() => { setActiveChart("daily"); setCycleKey((k) => k + 1); restartCycle(); }}
                >
                  {t("charts.tab5d")}
                </button>
                <svg width="12" height="12" viewBox="0 0 12 12" className={styles.chartTabTimer}>
                  <circle
                    cx="6" cy="6" r="4"
                    className={`${styles.chartTabTimerTrack} ${darkMode ? styles.chartTabTimerTrackDark : styles.chartTabTimerTrackLight}`}
                  />
                  <circle
                    key={cycleKey}
                    cx="6" cy="6" r="4"
                    transform="rotate(-90 6 6)"
                    className={`${styles.chartTabTimerProgress} ${darkMode ? styles.chartTabTimerProgressDark : styles.chartTabTimerProgressLight}`}
                    style={{ animationDuration: `${CHART_CYCLE_DURATION / 1000}s` }}
                  />
                </svg>
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
        </div>
        <AiSummary
          expanded={aiExpanded}
          onToggle={handleAiToggle}
          containerRef={aiRef}
        />
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
