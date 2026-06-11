import React, { useContext } from "react";
import PropTypes from "prop-types";
import { InlineIcon } from "@iconify/react";
import { AppContext } from "~/AppContext";
import { parseWeatherCode } from "~/ui/weatherCodes";
import { convertTemp, convertLength } from "~/services/conversions";
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
const EXPANDED_HOUR_STEP = 1;
const EXPANDED_TOTAL_CELLS = 24;
// Columns-per-row (4 compact, 8 expanded) is enforced by the CSS Grid
// `grid-template-columns: repeat(N, 1fr)` rule in styles.css — keeping
// the count out of JS avoids two sources of truth. CSS Grid auto-flow
// lays the remaining cells onto subsequent rows automatically.

// Threshold (mm) below which the accumulation label collapses to a
// neutral "·" — every column carrying "0 mm" would be noise. The cell
// shows QUANTITY since v3.1 Phase 5 (design: "0.8 mm" per cell, dot
// when dry); probability stays on the Précip chart tab.
const PRECIP_MM_THRESHOLD = 0.1;

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
  const { hourlyWeatherData, tempUnit, clockTime, lengthUnit } = useContext(AppContext);

  const intervals = hourlyWeatherData?.data?.timelines?.[0]?.intervals;
  if (!Array.isArray(intervals) || intervals.length === 0) {
    return null;
  }

  // The dense layout (24 cells × 1-hour step over 8 cols × 3 rows) is
  // applied whenever ChartTabs is maximized — both LayoutPi (v2.14.46
  // widened the rail to `min(60vw, 600px)`) and LayoutDesktop (rail
  // widens to `min(60vw, 960px)`) physically fit the cells now. The
  // CSS `.expanded` typography overrides stay gated on
  // `(min-width: 1280px)` so the small-screen rail keeps the compact
  // 26-px icon / 14-px temperature sizes — the dense GRID fits in
  // ~55 px cells but the desktop's 38-px icons would not.
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
        // mm/h over a 1-hour step ≈ mm for the hour; at the 3-hour
        // compact step it reads as the rate at that hour, which is
        // what the glanceable grid wants.
        const precipMm = values?.precipitationIntensity;
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
              {/* Unit-aware decimals: 0.1-1.26 mm converts below the
                * 1-decimal inch resolution and would read "0.0 in". */}
              {precipMm != null && precipMm >= PRECIP_MM_THRESHOLD
                ? `${convertLength(precipMm, lengthUnit).toFixed(lengthUnit === "in" ? 2 : 1)} ${lengthUnit}`
                : "·"}
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
