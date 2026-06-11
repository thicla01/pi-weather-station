import React, { useEffect, useContext, useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import Spinner from "~/components/Spinner";
import { AppContext } from "~/AppContext";
import styles from "./styles.css";
import LocationName from "~/components/LocationName";
import CurrentWeather from "~/components/CurrentWeather";
import UvAqiBadges from "~/components/UvAqiBadges";
import DailyChart from "~/components/ambient/weatherCharts/DailyChart";
import HourlyChart from "~/components/ambient/weatherCharts/HourlyChart";
import AiSummary from "~/components/AiSummary";

const CHART_CYCLE_DURATION = 150_000; // 2.5 minutes — auto-cycle on small screens

// Weather data polling (current / hourly / daily) was previously
// created here, but it now lives in AppContext so v3 layouts — which
// don't mount WeatherInfo — also get periodic refreshes. See the
// "Periodic weather data refresh" comment in AppContext.js.

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
    weatherApiKey,
    currentWeatherDataErr,
    currentWeatherDataErrMsg,
    darkMode,
    setSettingsMenuOpen,
    currentWeatherData,
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

  // Auto-cycle between charts on small screens. cycleKey doubles as the
  // React key on the progress-ring SVG (animation restart) and as the
  // useEffect dependency that lets a user tap reset the interval — bumping
  // cycleKey tears down the current interval and creates a fresh one.
  const [cycleKey, setCycleKey] = useState(0);

  const restartCycle = useCallback(() => {
    setCycleKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (!isSmallScreen) return undefined;
    const id = setInterval(() => {
      setActiveChart((prev) => (prev === "hourly" ? "daily" : "hourly"));
      setCycleKey((k) => k + 1);
    }, CHART_CYCLE_DURATION);
    return () => clearInterval(id);
  }, [isSmallScreen, cycleKey]);

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
      const scrollEl = infoPanelScrollRef?.current;
      const chartsEl = chartsRef?.current;

      // After charts collapse, scroll DOWN so AiSummary's top aligns with the
      // viewport top — the AI text fills the entire panel (Option B).
      const scrollToAi = () => {
        if (!scrollEl || !aiRef.current) return;
        const containerTop = scrollEl.getBoundingClientRect().top;
        const aiTop = aiRef.current.getBoundingClientRect().top;
        scrollEl.scrollTop += aiTop - containerTop;
      };

      // Fire exactly when the 350ms collapse transition ends
      const onTransitionEnd = () => scrollToAi();
      if (chartsEl) {
        chartsEl.addEventListener("transitionend", onTransitionEnd, { once: true });
      }
      // Fallback in case transitionend doesn't fire
      const fallback = setTimeout(scrollToAi, 500);

      return () => {
        if (chartsEl) chartsEl.removeEventListener("transitionend", onTransitionEnd);
        clearTimeout(fallback);
      };
    }

    if (!aiExpanded && wasExpanded) {
      // Collapsing: wait for charts to re-expand, then scroll back to top
      const scrollEl = infoPanelScrollRef?.current;
      const timer = setTimeout(() => {
        if (scrollEl) scrollEl.scrollTo({ top: 0, behavior: "smooth" });
      }, 400);
      return () => clearTimeout(timer);
    }
  }, [aiExpanded]); // eslint-disable-line react-hooks/exhaustive-deps -- infoPanelScrollRef is a stable ref object

  const { t } = useTranslation();

  const [err, setErr] = useState(null);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the AppContext getter/setter functions used in this effect are stable per provider mount but not memoized, so listing them would cause the effect to re-run on every parent render. Keying on the actual API keys is the intent.
  }, [weatherApiKey, reverseGeoApiKey]);

  // The shell is always rendered so a single Tomorrow.io failure doesn't
  // black out everything in the panel — LocationName (LocationIQ),
  // AiSummary (cached or independent), and the chart components' own
  // error states stay visible. CurrentWeather surfaces the
  // "could not retrieve weather data" message inline; the charts each
  // carry their own per-endpoint error rendering already. Pre-refactor,
  // a missing currentWeatherData hid LocationName and the AI summary
  // too, even though neither depends on the current-weather endpoint —
  // that asymmetry is the bug this fixes.
  const showCurrentWeatherError = !currentWeatherData && (currentWeatherDataErr || err);
  return (
    <div className={styles.container} ref={panelRef}>
      <div className={styles.location} ref={locationRef}>
        <LocationName />
      </div>
      <div style={{ display: aiExpanded ? "none" : undefined }}>
        {showCurrentWeatherError ? (
          <div className={`${styles.errContainer} ${darkMode ? styles.dark : styles.light}`}>
            <div>{t("errors.weatherDataFailed")}</div>
            <div>{t("errors.weatherApiKeyInvalid")}</div>
            {currentWeatherDataErr ? (
              <div className={styles.message}>{currentWeatherDataErrMsg}</div>
            ) : null}
          </div>
        ) : currentWeatherData ? (
          <>
            <CurrentWeather />
            <UvAqiBadges />
          </>
        ) : (
          <div className={styles.loadingContainer}>
            <Spinner size={"20px"} color={darkMode ? "#f6f6f444" : "#3a393844"} />
          </div>
        )}
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
};

export default WeatherInfo;
