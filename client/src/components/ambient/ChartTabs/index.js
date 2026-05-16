import React, { useEffect, useRef, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { InlineIcon } from "@iconify/react";
import maximize from "@iconify/icons-carbon/maximize";
import minimize from "@iconify/icons-carbon/minimize";
import HourlyChart from "~/components/weatherCharts/HourlyChart";
import DailyChart from "~/components/weatherCharts/DailyChart";
import HourlyForecastColumns from "~/components/ambient/HourlyForecastColumns";
import DailyForecastColumns from "~/components/ambient/DailyForecastColumns";
import styles from "./styles.css";

// View identifiers per tab. Treated as a 0-indexed cycle: tap on the
// chart area (or on a dot) advances to the next view; the last view
// wraps back to the first. Stored in localStorage so the user's
// preferred view per tab survives reloads.
const HOURLY_VIEWS = ["temp", "wind", "columns"];
const DAILY_VIEWS = ["temp", "wind", "columns"];

const STORAGE_KEY_HOURLY = "ambient.chartTabs.hourlyView";
const STORAGE_KEY_DAILY = "ambient.chartTabs.dailyView";

/**
 * Read a non-negative integer from localStorage, clamped to a maximum.
 * Falls back to 0 on any parse error or when the value is out of range.
 *
 * @param {String} key localStorage key
 * @param {Number} max exclusive upper bound (returned value is < max)
 * @returns {Number} integer in [0, max), defaulting to 0
 */
function readStoredView(key, max) {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return 0;
    const n = parseInt(raw, 10);
    if (Number.isNaN(n) || n < 0 || n >= max) return 0;
    return n;
  } catch {
    return 0;
  }
}

/**
 * Direction C chart slab — tabbed switcher between the hourly (24 h)
 * and daily (5 day) forecasts, each cycling through three views:
 *
 *   24h tab → temp+precip line / wind+precip line / hourly columns
 *   5d tab  → temp+precip line / wind+precip line / 5-day columns
 *
 * The cycle is driven by either tapping the chart area itself (the v2
 * tap-to-toggle gesture, kept because users already know it) or
 * tapping one of the dots in the indicator row beneath the chart. Dots
 * make the affordance visible — without them users wouldn't know the
 * tap exists. The per-tab view index is persisted to localStorage so
 * the user's preference survives reloads.
 *
 * Maximize toggle (v2.14.39): the slab promotes to `position: absolute;
 * inset: 12px` over its rail and emits `data-chart-maximized="true"`.
 * LayoutDesktop's stylesheet uses `:has([data-chart-maximized="true"])`
 * to grow `--c-rail-width` from 320 / 360 px to `min(50vw, 720px)`,
 * giving the chart roughly half the screen.
 *
 * @returns {JSX.Element} chart slab with tab header, cycle dots, and chart body
 */
const ChartTabs = () => {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState("hourly");
  const [hourlyView, setHourlyView] = useState(() => readStoredView(STORAGE_KEY_HOURLY, HOURLY_VIEWS.length));
  const [dailyView, setDailyView] = useState(() => readStoredView(STORAGE_KEY_DAILY, DAILY_VIEWS.length));
  const [maximized, setMaximized] = useState(false);
  const slabRef = useRef(null);

  // Persist on change. Wrapped in try/catch because localStorage can
  // throw in some private-browsing modes — failing silently is
  // preferable to a broken UI for what is purely a comfort feature.
  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY_HOURLY, String(hourlyView)); } catch { /* ignore */ }
  }, [hourlyView]);
  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY_DAILY, String(dailyView)); } catch { /* ignore */ }
  }, [dailyView]);

  // Scroll the rail to the top when maximizing (same trick AiSummaryInline
  // uses) so the absolutely-positioned slab is in the visible viewport.
  useEffect(() => {
    if (!maximized || !slabRef.current) return;
    let el = slabRef.current.parentElement;
    while (el && el !== document.body) {
      const { overflowY } = window.getComputedStyle(el);
      if (overflowY === "auto" || overflowY === "scroll") {
        el.scrollTop = 0;
        break;
      }
      el = el.parentElement;
    }
  }, [maximized]);

  const lang = ["fr", "es"].find((l) => i18n.language.startsWith(l)) || "en";
  const maximizeLabel = maximized
    ? { fr: "Restaurer", es: "Restaurar", en: "Restore" }[lang]
    : { fr: "Agrandir", es: "Ampliar", en: "Maximize" }[lang];

  // Cycle handler: advance the active tab's view index by one, wrapping
  // back to 0 after the last view. Wrapped in useCallback so the chart
  // components don't re-render needlessly when the parent re-renders
  // for unrelated reasons (palette change, etc.).
  const cycleActiveView = useCallback(() => {
    if (tab === "hourly") {
      setHourlyView((v) => (v + 1) % HOURLY_VIEWS.length);
    } else {
      setDailyView((v) => (v + 1) % DAILY_VIEWS.length);
    }
  }, [tab]);

  // Set the active tab's view explicitly (for dot taps).
  const setActiveView = useCallback((index) => {
    if (tab === "hourly") setHourlyView(index);
    else setDailyView(index);
  }, [tab]);

  const activeViews = tab === "hourly" ? HOURLY_VIEWS : DAILY_VIEWS;
  const activeIndex = tab === "hourly" ? hourlyView : dailyView;
  const activeView = activeViews[activeIndex];
  // altMode mapping: the two line-chart views ("temp" and "wind") map
  // to the chart components' boolean altMode. The "columns" view
  // renders the dedicated column-strip component instead and altMode
  // is irrelevant.
  const altMode = activeView === "wind";

  // The chart components already render their click handler on the
  // chart container — we forward the cycle action through their
  // `onAltToggle` prop so the existing tap gesture keeps working. For
  // the columns view there's no chart container, so we wrap that one
  // in a clickable div directly.
  let chartBody;

  // The line-chart views render a 2-series graph (grey for temp/wind,
  // blue for precipitation) but the Chart.js native legend is disabled
  // for vertical-space reasons. Surface a small custom legend above the
  // canvas so users can map colours to meaning without guessing.
  // Hidden for the columns view (its icons + temp/precip labels are
  // self-descriptive). Mirrors the v2 InfoPanel pattern.
  const showLegend = activeView !== "columns";
  const mainSeriesLabel = activeView === "wind"
    ? t("charts.windSpeed", { defaultValue: "Wind" })
    : t("charts.temp", { defaultValue: "Temp" });

  if (tab === "hourly") {
    if (activeView === "columns") {
      chartBody = (
        <div className={styles.columnsClickable} onClick={cycleActiveView} role="button" tabIndex={0}>
          <HourlyForecastColumns expanded={maximized} />
        </div>
      );
    } else {
      chartBody = <HourlyChart altMode={altMode} onAltToggle={cycleActiveView} />;
    }
  } else {
    if (activeView === "columns") {
      chartBody = (
        <div className={styles.columnsClickable} onClick={cycleActiveView} role="button" tabIndex={0}>
          <DailyForecastColumns expanded={maximized} />
        </div>
      );
    } else {
      chartBody = <DailyChart altMode={altMode} onAltToggle={cycleActiveView} />;
    }
  }

  return (
    <div
      ref={slabRef}
      className={`${styles.slab} ${maximized ? styles.slabMaximized : ""}`}
      data-chart-maximized={maximized ? "true" : undefined}
    >
      <div className={styles.tabRow} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "hourly"}
          className={`${styles.tab} ${tab === "hourly" ? styles.active : ""}`}
          onClick={() => setTab("hourly")}
        >
          {t("charts.tab24h", { defaultValue: "24 hours" })}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "daily"}
          className={`${styles.tab} ${tab === "daily" ? styles.active : ""}`}
          onClick={() => setTab("daily")}
        >
          {t("charts.tab5d", { defaultValue: "5 days" })}
        </button>
        <button
          type="button"
          className={styles.actionButton}
          onClick={() => setMaximized((m) => !m)}
          aria-pressed={maximized}
          aria-label={maximizeLabel}
          title={maximizeLabel}
        >
          <InlineIcon icon={maximized ? minimize : maximize} className={styles.actionIcon} />
        </button>
      </div>
      {/* Always render the legend row so it reserves vertical space —
       * cycling through views keeps the slab the same height, which
       * keeps the AI summary card below at a stable position. When
       * the columns view is active there's no colour key to show
       * (the icons + temperature labels speak for themselves), so the
       * row renders empty but with the same min-height as when
       * populated. See styles.css `.legendRow` for the reservation
       * height. */}
      <div className={styles.legendRow} aria-hidden="true">
        {showLegend ? (
          <>
            <span className={styles.legendItem}>
              <span className={`${styles.legendDot} ${styles.legendDotMain}`} />
              {mainSeriesLabel}
            </span>
            <span className={styles.legendItem}>
              <span className={`${styles.legendDot} ${styles.legendDotPrecip}`} />
              {t("charts.precipitation", { defaultValue: "Precipitation" })}
            </span>
          </>
        ) : null}
      </div>
      <div className={styles.chartArea}>{chartBody}</div>
      <div
        className={styles.cycleDots}
        role="tablist"
        aria-label={t("charts.cycleView", { defaultValue: "Cycle view" })}
      >
        {activeViews.map((view, i) => {
          const labelKey = tab === "hourly"
            ? { temp: "charts.viewTempPrecip", wind: "charts.viewWindPrecip", columns: "charts.viewHourlyColumns" }[view]
            : { temp: "charts.viewTempPrecip", wind: "charts.viewWindPrecip", columns: "charts.viewDailyColumns" }[view];
          const label = t(labelKey);
          return (
            <button
              key={view}
              type="button"
              role="tab"
              aria-selected={i === activeIndex}
              aria-label={label}
              title={label}
              className={`${styles.dot} ${i === activeIndex ? styles.dotActive : ""}`}
              onClick={() => setActiveView(i)}
            />
          );
        })}
        {/* The view label ("température + précipitations" etc.) used
         * to render to the right of the dots. v2.14.74 removed it —
         * the dots themselves carry enough state (aria-label / title
         * for accessibility, position + accent fill for sight). The
         * .cycleDots flex container now centres the remaining dots
         * horizontally since there's no trailing label to anchor
         * them off-centre. */}
      </div>
    </div>
  );
};

export default ChartTabs;
