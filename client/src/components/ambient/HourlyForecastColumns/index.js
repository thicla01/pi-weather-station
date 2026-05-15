import React, { useContext } from "react";
import PropTypes from "prop-types";
import { InlineIcon } from "@iconify/react";
import { AppContext } from "~/AppContext";
import { parseWeatherCode } from "~/ui/weatherCodes";
import { convertTemp } from "~/services/conversions";
import styles from "./styles.css";

// Two density modes — both cover the full 24-hour window. Compact mode
// (default rail, ~320 px wide) lays 8 cells out over 2 rows of 4 at a
// 3-hour step; expanded mode (rail widened by ChartTabs maximize,
// ~50 vw) lays 24 cells over 3 rows of 8 at a 1-hour step. Splitting
// vertically lets each cell breathe — at 4 columns the compact cell is
// ~75 px wide (vs ~38 px on a single 8-column row), and the expanded
// 8-column rows give each hourly cell ~75 px too. Visual mass per cell
// is the same in both modes; what changes is the granularity (3 h vs
// 1 h) and the row count.
const COMPACT_HOUR_STEP = 3;
const COMPACT_TOTAL_CELLS = 8;
const COMPACT_COLUMNS_PER_ROW = 4;
const EXPANDED_HOUR_STEP = 1;
const EXPANDED_TOTAL_CELLS = 24;
const EXPANDED_COLUMNS_PER_ROW = 8;

// Threshold below which the precipitation percentage is hidden so
// every column doesn't carry a noisy "0 %" / "5 %" label. Mirrors the
// 30 % cut DailyForecastColumns uses.
const PRECIP_THRESHOLD = 30;

/**
 * Hourly forecast as a horizontal strip of columns, covering the full
 * 24-hour window. Slots into ChartTabs's `.chartArea` as the third
 * view in the 24h-tab cycle, alongside the existing temperature+precip
 * and wind+precip line charts.
 *
 * Density adapts to the available rail width — 8 columns at 3-hour
 * intervals when ChartTabs is compact (default rail), 12 columns at
 * 2-hour intervals when ChartTabs is maximized and the rail widens
 * to ~50 vw. Either way the strip covers the full 24 hours rather
 * than only the next half-day, matching what the "24 heures" tab
 * label promises.
 *
 * Data source: `hourlyWeatherData.data.timelines[0].intervals[]` from
 * `/api/weather/hourly`. Each interval carries `temperature`,
 * `precipitationProbability`, `weatherCode`, and `windSpeed`.
 *
 * @param {object} [props]
 * @param {boolean} [props.expanded] When true, render in the denser
 *   12-column / 2-hour layout (used when ChartTabs is maximized).
 *   Defaults to false (8 columns / 3-hour step).
 * @returns {JSX.Element|null} hourly strip, or null when no payload
 */
const HourlyForecastColumns = ({ expanded = false }) => {
  const { hourlyWeatherData, tempUnit, clockTime } = useContext(AppContext);

  const intervals = hourlyWeatherData?.data?.timelines?.[0]?.intervals;
  if (!Array.isArray(intervals) || intervals.length === 0) {
    return null;
  }

  const hourStep = expanded ? EXPANDED_HOUR_STEP : COMPACT_HOUR_STEP;
  const totalCells = expanded ? EXPANDED_TOTAL_CELLS : COMPACT_TOTAL_CELLS;

  // Pick N hours stepped by hourStep. Start at index 1 so the first
  // cell reflects the upcoming hour, not the current one — current
  // conditions are already in HeroBand / MetricsGrid, repeating them
  // here would be wasteful.
  const slots = [];
  for (let n = 0; n < totalCells; n++) {
    const idx = 1 + n * hourStep;
    if (idx >= intervals.length) break;
    slots.push(intervals[idx]);
  }

  const hour12 = clockTime === "12";

  return (
    <div
      className={`${styles.strip} ${expanded ? styles.expanded : ""}`}
      role="list"
    >
      {slots.map((interval, i) => {
        const { values } = interval;
        const date = new Date(interval.startTime);
        const hourLabel = hour12
          ? date.toLocaleString("en-US", { hour: "numeric", hour12: true })
              .replace(/\s/g, "")
              .toLowerCase()
          : `${String(date.getHours()).padStart(2, "0")}h`;
        const temp = values?.temperature;
        const code = values?.weatherCode;
        const precip = values?.precipitationProbability;
        // Treat "is day" tolerantly — for an hourly forecast we use the
        // hour itself: 6h-19h = day icons, otherwise night. Avoids
        // pulling sunrise/sunset just to colour-match an icon variant
        // (it's a forecast strip, not the hero).
        const localHour = date.getHours();
        const isDay = localHour >= 6 && localHour < 20;
        const { icon } = code != null ? (parseWeatherCode(code, isDay) || {}) : {};
        return (
          <div key={i} className={styles.column} role="listitem">
            <div className={styles.hour}>{hourLabel}</div>
            <div className={styles.iconRow}>
              {icon ? (
                <InlineIcon
                  icon={icon}
                  width={28}
                  height={28}
                  style={{ color: "currentColor" }}
                />
              ) : (
                <span className={styles.iconPlaceholder}>
                  {code != null ? `c${code}` : "—"}
                </span>
              )}
            </div>
            <div className={styles.temp}>
              {temp != null
                ? `${Math.round(convertTemp(temp, tempUnit))}°`
                : "—"}
            </div>
            <div className={styles.precip}>
              {precip != null && precip >= PRECIP_THRESHOLD
                ? `${Math.round(precip)}%`
                : ""}
            </div>
          </div>
        );
      })}
    </div>
  );
};

HourlyForecastColumns.propTypes = {
  expanded: PropTypes.bool,
};

export default HourlyForecastColumns;
