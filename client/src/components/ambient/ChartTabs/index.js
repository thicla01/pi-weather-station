import React, { useEffect, useRef, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import MetricChart from "~/components/ambient/weatherCharts/MetricChart";
import HourlyForecastColumns from "~/components/ambient/HourlyForecastColumns";
import DailyForecastColumns from "~/components/ambient/DailyForecastColumns";
import { ExpandIcon, RestoreIcon } from "~/components/WeatherMap/icons";
import ForecastSummaryPills from "./ForecastSummaryPills";
import SourceBadge from "~/components/ambient/SourceBadge";
import useAutoTabSelector from "~/hooks/useAutoTabSelector";
import styles from "./styles.css";

// Metric tabs, in display order (v3.1 Phase 5). "grid" is the
// hour-by-hour / day-by-day icon grid (the design's "Heures" tab —
// labelled "Jours" when the 5-day period is active).
const METRICS = ["temp", "wind", "precip", "grid"];

// Phase 5 bumped the storage keys: the old hourlyView/dailyView indexes
// pointed into a 3-view cycle whose meaning changed (2 used to be the
// columns view, it now selects Précip) — fresh keys give everyone the
// temp default instead of a silently-shifted preference.
const STORAGE_KEY_HOURLY = "ambient.chartTabs.hourlyMetric";
const STORAGE_KEY_DAILY = "ambient.chartTabs.dailyMetric";
const STORAGE_KEY_OVERLAY = "ambient.chartTabs.precipOverlay";

// Inline SVG tab glyphs, paths straight from the Phase 5 reference
// (thermometer / wind / drop / clock).
const METRIC_ICON_PATHS = {
  temp: "M14 14 V 4 a 2 2 0 0 0 -4 0 V 14 a 4 4 0 1 0 4 0 Z",
  wind: "M3 9 H 14 a 2 2 0 0 0 0 -4 a 2 2 0 0 0 -2 2 M 3 14 H 18 a 2 2 0 0 1 0 4 a 2 2 0 0 1 -2 -2",
  precip: "M12 3 C 12 3 5 11 5 15 a 7 7 0 0 0 14 0 C 19 11 12 3 12 3 Z",
};

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
 * Direction C forecast slab — v3.1 Phase 5 ("Prévisions, nommées").
 *
 * Header: the PRÉVISIONS title, the period toggle (24 h / 5 jours)
 * as pills — period is orthogonal to metric, any combination is
 * valid — and the expand button (bracket-icon pair, 44 px hit area).
 * Below it, a labelled segmented control replaces the old cryptic
 * carousel dots (audit F9): Temp · Vent · Précip · Heures (the last
 * reads "Jours" on the 5-day period). Each metric renders a dedicated
 * mono-metric chart (see MetricChart) plus a numeric summary-pill row;
 * the grid metric reuses the hour/day column strips. Tapping the chart
 * area still cycles metrics — the v2 muscle-memory gesture.
 *
 * The optional "Précip" chip in the summary row (temp/wind tabs)
 * superimposes the precipitation pair on the active chart — the
 * maintainer-chosen replacement for the old always-paired charts.
 *
 * Maximize keeps the v2.14.39 mechanics: the slab promotes to
 * `position: absolute; inset: 12px` over its rail and emits
 * `data-chart-maximized="true"` (LayoutDesktop widens the rail via
 * `:has()`); the grid metric densifies (8 → 24 cells) and the chart
 * area grows.
 *
 * When the user opts in (Settings → "Auto-select forecast tab"),
 * `useAutoTabSelector` may command the active metric from current hazards;
 * a small source-badge reason chip in the header marks an auto-switch, and
 * any manual tap holds the user's choice. Period is never auto-driven.
 *
 * @returns {JSX.Element} forecast slab
 */
const ChartTabs = () => {
  const { t } = useTranslation();
  const [period, setPeriod] = useState("hourly");
  const [hourlyMetric, setHourlyMetric] = useState(() => readStoredView(STORAGE_KEY_HOURLY, METRICS.length));
  const [dailyMetric, setDailyMetric] = useState(() => readStoredView(STORAGE_KEY_DAILY, METRICS.length));
  const [precipOverlay, setPrecipOverlay] = useState(() => {
    try { return window.localStorage.getItem(STORAGE_KEY_OVERLAY) === "1"; } catch { return false; }
  });
  const [maximized, setMaximized] = useState(false);
  const slabRef = useRef(null);

  // Persist on change. Wrapped in try/catch because localStorage can
  // throw in some private-browsing modes — failing silently is
  // preferable to a broken UI for what is purely a comfort feature.
  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY_HOURLY, String(hourlyMetric)); } catch { /* ignore */ }
  }, [hourlyMetric]);
  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY_DAILY, String(dailyMetric)); } catch { /* ignore */ }
  }, [dailyMetric]);
  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY_OVERLAY, precipOverlay ? "1" : "0"); } catch { /* ignore */ }
  }, [precipOverlay]);

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

  const metricIndex = period === "hourly" ? hourlyMetric : dailyMetric;
  const metric = METRICS[metricIndex];
  const setMetricIndex = useCallback((index) => {
    if (period === "hourly") setHourlyMetric(index);
    else setDailyMetric(index);
  }, [period]);

  // Auto-tab selector (Phase 1): the hook commands a metric from active
  // hazards (gov alerts / forecast); we apply it here without ever touching
  // `period`. A user gesture stamps a manual hold the hook honours.
  const { commandedMetric, autoSwitchSource, stampManualHold } = useAutoTabSelector(metric);
  const appliedCmdRef = useRef(null);
  useEffect(() => {
    if (!commandedMetric) {
      appliedCmdRef.current = null;
      return;
    }
    if (appliedCmdRef.current === commandedMetric) return; // already applied this command
    const idx = METRICS.indexOf(commandedMetric);
    if (idx === -1) return;
    appliedCmdRef.current = commandedMetric;
    if (idx !== metricIndex) setMetricIndex(idx); // metric only — never period
  }, [commandedMetric, metricIndex, setMetricIndex]);

  // Tap-on-chart cycles to the next metric (wraps) — kept from the
  // dot-cycle era because users already know the gesture. A cycle is a
  // user gesture, so it also stamps the manual hold.
  const cycleMetric = useCallback(() => {
    setMetricIndex((metricIndex + 1) % METRICS.length);
    stampManualHold();
  }, [metricIndex, setMetricIndex, stampManualHold]);

  const metricLabel = (m) => {
    if (m === "grid") {
      return period === "hourly"
        ? t("charts.tabHours", { defaultValue: "Hours" })
        : t("charts.tabDays", { defaultValue: "Days" });
    }
    return {
      temp: t("charts.tabTemp", { defaultValue: "Temp" }),
      wind: t("charts.tabWind", { defaultValue: "Wind" }),
      precip: t("charts.tabPrecip", { defaultValue: "Precip" }),
    }[m];
  };

  const expandLabel = maximized
    ? t("charts.restore", { defaultValue: "Restore" })
    : t("charts.maximize", { defaultValue: "Maximize" });

  let chartBody;
  if (metric === "grid") {
    const Columns = period === "hourly" ? HourlyForecastColumns : DailyForecastColumns;
    chartBody = (
      <div className={styles.columnsClickable} onClick={cycleMetric} role="button" tabIndex={0}>
        <Columns expanded={maximized} />
      </div>
    );
  } else {
    chartBody = (
      <MetricChart
        cadence={period}
        metric={metric}
        precipOverlay={precipOverlay && metric !== "precip"}
        onCycle={cycleMetric}
      />
    );
  }

  return (
    <div
      ref={slabRef}
      className={`${styles.slab} ${maximized ? styles.slabMaximized : ""}`}
      data-chart-maximized={maximized ? "true" : undefined}
    >
      <div className={styles.headerRow}>
        <span className={styles.headerTitle}>{t("charts.title", { defaultValue: "Forecast" })}</span>
        <span className={styles.periodPills} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={period === "hourly"}
            className={`${styles.periodPill} ${period === "hourly" ? styles.periodPillActive : ""}`}
            onClick={() => setPeriod("hourly")}
          >
            {t("charts.period24h", { defaultValue: "24 h" })}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={period === "daily"}
            className={`${styles.periodPill} ${period === "daily" ? styles.periodPillActive : ""}`}
            onClick={() => setPeriod("daily")}
          >
            {t("charts.period5d", { defaultValue: "5 days" })}
          </button>
        </span>
        {commandedMetric && autoSwitchSource && commandedMetric === metric ? (
          <span
            className={styles.reasonChip}
            aria-label={`${t("charts.autoSelected", { defaultValue: "Auto-selected" })}: ${metricLabel(commandedMetric)}`}
          >
            <SourceBadge source={autoSwitchSource} />
            <span className={styles.reasonChipLabel}>{metricLabel(commandedMetric)}</span>
          </span>
        ) : null}
        <button
          type="button"
          className={styles.actionButton}
          onClick={() => setMaximized((m) => !m)}
          aria-pressed={maximized}
          aria-label={expandLabel}
          title={expandLabel}
        >
          {maximized ? <RestoreIcon className={styles.actionIcon} /> : <ExpandIcon className={styles.actionIcon} />}
        </button>
      </div>
      <div className={styles.metricTabs} role="tablist">
        {METRICS.map((m, i) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={i === metricIndex}
            className={`${styles.metricTab} ${i === metricIndex ? styles.metricTabActive : ""}`}
            onClick={() => { setMetricIndex(i); stampManualHold(); }}
          >
            {m === "grid" ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <polyline points="12 7 12 12 15 14" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d={METRIC_ICON_PATHS[m]} />
              </svg>
            )}
            {metricLabel(m)}
          </button>
        ))}
      </div>
      {/* The grid metric gets a natural-height area: its 2×4 / 3×8
        * cell rows are taller than the fixed chart heights and used to
        * silently overflow into the (now removed) legend/dots cushion
        * rows — visible clipping since Phase 5 (maintainer-reported).
        * Charts keep the fixed height so Chart.js has a sized parent. */}
      <div className={`${styles.chartArea} ${metric === "grid" ? styles.chartAreaGrid : ""}`}>{chartBody}</div>
      {/* Always rendered (empty on the grid tab) so the slab keeps a
        * constant height across the tap-cycle — the v2.14.54 rule that
        * keeps the AI summary card below from jumping. */}
      <div className={styles.summaryWrap}>
        {metric !== "grid" ? (
          <ForecastSummaryPills cadence={period} metric={metric} />
        ) : null}
        {metric === "temp" || metric === "wind" ? (
            <button
              type="button"
              className={`${styles.overlayChip} ${precipOverlay ? styles.overlayChipActive : ""}`}
              onClick={() => setPrecipOverlay((v) => !v)}
              aria-pressed={precipOverlay}
              title={t("charts.overlayPrecip", { defaultValue: "Overlay precipitation" })}
            >
              <span className={styles.overlayChipBox} aria-hidden="true">{precipOverlay ? "✓" : ""}</span>
              {t("charts.tabPrecip", { defaultValue: "Precip" })}
            </button>
        ) : null}
      </div>
    </div>
  );
};

export default ChartTabs;
