import React, { useContext } from "react";
import { useTranslation } from "react-i18next";
import { InlineIcon } from "@iconify/react";
import { AppContext } from "~/AppContext";
import { parseWeatherCode } from "~/ui/weatherCodes";
import { convertTemp } from "~/services/conversions";
import styles from "./styles.css";

// Step in hours between displayed columns. Compact mode (320 px rail)
// fits ~6 columns comfortably; with a 2-hour step we cover 12 h, which
// is the right "next half-day glance" window. In the maximized chart
// view (~700 px) the same 6 columns get more breathing room rather
// than packing in more — adding a 7th would shrink each cell below the
// touch-target threshold without delivering meaningful extra signal.
const HOUR_STEP = 2;
const COLUMN_COUNT = 6;

// Threshold below which the precipitation percentage is hidden so
// every column doesn't carry a noisy "0 %" / "5 %" label. Mirrors the
// 30 % cut DailyForecastColumns uses.
const PRECIP_THRESHOLD = 30;

/**
 * Hourly forecast as a horizontal strip of 6 columns, covering the
 * next 12 hours at 2-hour intervals. Designed to slot into ChartTabs's
 * `.chartArea` as a third view in the 24h-tab cycle, alongside the
 * existing temperature+precip and wind+precip line charts.
 *
 * Data source: `hourlyWeatherData.data.timelines[0].intervals[]` from
 * `/api/weather/hourly`. Each interval carries `temperature`,
 * `precipitationProbability`, `weatherCode`, and `windSpeed`.
 *
 * @returns {JSX.Element|null} hourly strip, or null when no payload
 */
const HourlyForecastColumns = () => {
  const { hourlyWeatherData, tempUnit, clockTime } = useContext(AppContext);
  const { t } = useTranslation();

  const intervals = hourlyWeatherData?.data?.timelines?.[0]?.intervals;
  if (!Array.isArray(intervals) || intervals.length === 0) {
    return null;
  }

  // Pick the next N hours, stepped by HOUR_STEP. Start at index 1 so
  // the first column reflects the upcoming hour, not the current one
  // (the current conditions are already visible in HeroBand /
  // MetricsGrid — repeating them here would be wasteful).
  const slots = [];
  for (let n = 0; n < COLUMN_COUNT; n++) {
    const idx = 1 + n * HOUR_STEP;
    if (idx >= intervals.length) break;
    slots.push(intervals[idx]);
  }

  const hour12 = clockTime === "12";

  return (
    <div className={styles.strip} role="list">
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
      <div className={styles.title} aria-hidden="true">
        {t("charts.hourlyColumnsTitle", { defaultValue: "Next 12 hours" })}
      </div>
    </div>
  );
};

export default HourlyForecastColumns;
