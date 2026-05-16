import React, { useContext } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { InlineIcon } from "@iconify/react";
import { format } from "date-fns";
import { fr, es, enUS } from "date-fns/locale";
import { AppContext } from "~/AppContext";
import { parseWeatherCode } from "~/ui/weatherCodes";
import { convertTemp, convertLength } from "~/services/conversions";
import styles from "./styles.css";

/**
 * 5-day forecast as a horizontal strip of columns, replacing the
 * Chart.js line graph for the "5 jours / 5 days" view inside
 * ChartTabs.
 *
 * Two layout modes:
 *   - Compact (default): single day icon + day label + max/min temps
 *     + precip probability when ≥ PRECIP_THRESHOLD. Matches what the
 *     rail's 320 px width can comfortably show.
 *   - Expanded (`expanded` prop, used when ChartTabs is maximized on
 *     LayoutDesktop): pairs a `weatherCodeDay` icon with the max temp
 *     and a `weatherCodeNight` icon with the min temp — the icon ↔
 *     temp pairing creates a stronger semantic link than the single
 *     `weatherCodeMax` icon. Adds a precipitation accumulation row
 *     (rain mm or snow cm) when there's enough to be worth noting.
 *
 * Data source: `dailyWeatherData.data.timelines[0].intervals[]` from
 * `/api/weather/daily`. Fields used (added in v2.14.57 for expanded):
 *   `temperatureMax`, `temperatureMin`,
 *   `weatherCodeMax` (compact), `weatherCodeDay` / `weatherCodeNight`
 *     (expanded — fall back to weatherCodeMax if missing),
 *   `precipitationProbabilityMax`,
 *   `rainAccumulation`, `snowAccumulation`.
 *
 * Reads `tempUnit` and `lengthUnit` from AppContext.
 *
 * @param {object} [props]
 * @param {boolean} [props.expanded] When true, render the richer
 *   day/night-split layout. Pass it from ChartTabs based on the
 *   maximize state.
 * @returns {JSX.Element|null} 5-day strip, or null when no payload
 */

// Threshold below which the precipitation probability is hidden so
// every column doesn't carry a noisy "0 %" / "10 %" label. Lives
// outside the component so a future settings hook can override it
// without forcing a re-render.
const PRECIP_THRESHOLD = 30;

// Accumulation thresholds — below these, the line is hidden rather
// than show "0.2 mm" or "0.5 cm" which would clutter without adding
// signal. Tomorrow.io reports rainAccumulation in mm and
// snowAccumulation in mm; we convert snow → cm at display time so
// the values stay readable ("8 cm" vs "80 mm" of snow).
const RAIN_ACCUMULATION_MIN_MM = 0.5;
const SNOW_ACCUMULATION_MIN_MM = 5; // = 0.5 cm

/**
 * @param {object} props
 * @param {boolean} [props.expanded] Render the richer day/night-split
 *   layout (used when ChartTabs is maximized on LayoutDesktop).
 * @returns {JSX.Element|null} 5-day strip, or null when no payload
 */
const DailyForecastColumns = ({ expanded = false }) => {
  const { dailyWeatherData, tempUnit, lengthUnit } = useContext(AppContext);
  const { t, i18n } = useTranslation();
  // v2.14.60: the expanded JSX (day/night icon split + accumulation
  // row) now renders on every viewport, not just LayoutDesktop. The
  // v2.14.59 `effectiveExpanded = expanded && isDesktop` gate kept
  // the 7" on the compact 1-icon layout, but that lost the night
  // icons the user wanted to see and left the daily compact strip
  // (~100 px) floating in a 280 px chartArea with too much
  // top/bottom margin. CSS for the expanded layout below now has a
  // sub-1280 baseline with smaller sizes that fit ~92 px cells, and
  // the @media (min-width: 1280px) overrides bump the sizes for the
  // desktop rail. The `isDesktop` hook is kept so future cell-specific
  // tweaks can still branch JSX if needed.
  const effectiveExpanded = expanded;
  const dateLocale = i18n.language.startsWith("fr") ? fr
    : i18n.language.startsWith("es") ? es : enUS;

  const intervals = dailyWeatherData?.data?.timelines?.[0]?.intervals;
  if (!Array.isArray(intervals) || intervals.length === 0) {
    return null;
  }
  // Five columns to match the Claude Design mockup. The daily timeline
  // can return more than five days (we request a 4-day window so the
  // 0th interval is "today" and the strip shows today + next 4); cap
  // here so a slightly longer payload doesn't blow out the layout.
  const days = intervals.slice(0, 5);

  return (
    <div
      className={`${styles.strip} ${effectiveExpanded ? styles.expanded : ""}`}
      role="list"
    >
      {days.map((interval, i) => {
        const { values } = interval;
        const date = new Date(interval.startTime);
        // Adjust to local-tz so weekdays align with the user's clock
        // rather than the server's UTC interpretation (matches the
        // existing v2 DailyChart "EEEEE" label logic).
        const adjusted = new Date(date.getTime() + date.getTimezoneOffset() * 60 * 1000);
        const dayLabel = format(adjusted, "EEE", { locale: dateLocale }).toUpperCase();
        // Tolerant field lookup: prefer the daily-aggregate variants
        // (added to the proxy request in 2.14.2) but fall back to the
        // plain field name if the server is still serving a cached
        // pre-2.14.2 response, or if Tomorrow.io returns a different
        // shape for some endpoints. When max isn't available we use
        // the avg as both high and low — a single readable value beats
        // two "—" placeholders. */
        const tempMax = values?.temperatureMax ?? values?.temperatureApparentMax ?? values?.temperature;
        const tempMin = values?.temperatureMin ?? values?.temperatureApparentMin ?? values?.temperature;
        // Compact mode uses the single aggregated code; expanded mode
        // splits day vs. night. Each has its own fallback chain so a
        // stale cache without the new fields still renders cleanly.
        const codeAggregate = values?.weatherCodeMax ?? values?.weatherCodeFullDay ?? values?.weatherCodeDay ?? values?.weatherCode;
        const codeDay = values?.weatherCodeDay ?? codeAggregate;
        const codeNight = values?.weatherCodeNight ?? codeAggregate;
        const precip = values?.precipitationProbabilityMax ?? values?.precipitationProbability;
        const rainAcc = values?.rainAccumulation;
        const snowAcc = values?.snowAccumulation;
        // Daily aggregate icon (compact mode) uses the daytime variant.
        const { icon: iconAggregate } = codeAggregate != null
          ? (parseWeatherCode(codeAggregate, true) || {})
          : {};
        // Expanded mode: separate icons. weatherCodeDay → isDay=true,
        // weatherCodeNight → isDay=false so the parser picks the
        // night variant of the matching code (moon over cloud, etc.).
        const { icon: iconDay } = codeDay != null
          ? (parseWeatherCode(codeDay, true) || {})
          : {};
        const { icon: iconNight } = codeNight != null
          ? (parseWeatherCode(codeNight, false) || {})
          : {};

        // Accumulation display string. Tomorrow.io reports both
        // accumulations in mm; we show rain in mm/in directly and
        // snow as a cm/in conversion (mm × 0.1 → cm for metric,
        // or via convertLength for imperial). Only show one line —
        // if both are non-zero we prioritise snow (more impactful).
        let accumulationLine = null;
        if (snowAcc != null && snowAcc >= SNOW_ACCUMULATION_MIN_MM) {
          // Snow: show in cm (metric) or in (imperial). `lengthUnit`
          // from context: "mm" → metric, "in" → imperial.
          if (lengthUnit === "in") {
            // mm → inches: divide by 25.4. convertLength handles the
            // sign and rounding for us.
            const inches = convertLength(snowAcc, "in");
            accumulationLine = { kind: "snow", label: `${inches.toFixed(1)} in` };
          } else {
            const cm = snowAcc / 10;
            accumulationLine = { kind: "snow", label: `${cm.toFixed(1)} cm` };
          }
        } else if (rainAcc != null && rainAcc >= RAIN_ACCUMULATION_MIN_MM) {
          if (lengthUnit === "in") {
            const inches = convertLength(rainAcc, "in");
            accumulationLine = { kind: "rain", label: `${inches.toFixed(2)} in` };
          } else {
            accumulationLine = { kind: "rain", label: `${rainAcc.toFixed(1)} mm` };
          }
        }

        if (!effectiveExpanded) {
          // Compact layout — unchanged from v2.14.2.
          return (
            <div key={i} className={styles.column} role="listitem">
              <div className={styles.day}>{dayLabel}</div>
              <div className={styles.iconRow}>
                {iconAggregate ? (
                  <InlineIcon
                    icon={iconAggregate}
                    width={30}
                    height={30}
                    style={{ color: "currentColor" }}
                  />
                ) : (
                  <span className={styles.iconPlaceholder}>
                    {codeAggregate != null ? `code ${codeAggregate}` : "—"}
                  </span>
                )}
              </div>
              <div className={styles.tempMax}>
                {tempMax != null ? `${Math.round(convertTemp(tempMax, tempUnit))}°` : "—"}
              </div>
              <div className={styles.tempMin}>
                {tempMin != null ? `${Math.round(convertTemp(tempMin, tempUnit))}°` : "—"}
              </div>
              <div className={styles.precip}>
                {precip != null && precip >= PRECIP_THRESHOLD
                  ? `${Math.round(precip)}%`
                  : ""}
              </div>
            </div>
          );
        }

        // Expanded layout: each cell pairs a day-icon with the max temp
        // on one row, and a night-icon with the min temp on the next.
        // Adds precip probability and accumulation rows when meaningful.
        return (
          <div key={i} className={styles.column} role="listitem">
            <div className={styles.day}>{dayLabel}</div>
            <div className={styles.dayNightRow}>
              <span className={styles.iconCell}>
                {iconDay ? (
                  <InlineIcon icon={iconDay} style={{ color: "currentColor" }} />
                ) : (
                  <span className={styles.iconPlaceholder}>
                    {codeDay != null ? `c${codeDay}` : "—"}
                  </span>
                )}
              </span>
              <span className={styles.tempMax}>
                {tempMax != null ? `${Math.round(convertTemp(tempMax, tempUnit))}°` : "—"}
              </span>
            </div>
            <div className={styles.dayNightRow}>
              <span className={styles.iconCellDim}>
                {iconNight ? (
                  <InlineIcon icon={iconNight} style={{ color: "currentColor" }} />
                ) : (
                  <span className={styles.iconPlaceholder}>
                    {codeNight != null ? `c${codeNight}` : "—"}
                  </span>
                )}
              </span>
              <span className={styles.tempMin}>
                {tempMin != null ? `${Math.round(convertTemp(tempMin, tempUnit))}°` : "—"}
              </span>
            </div>
            {precip != null && precip >= PRECIP_THRESHOLD ? (
              <div className={styles.precipLine}>
                <span className={styles.dropletIcon} aria-hidden="true">💧</span>
                <span>{Math.round(precip)}%</span>
              </div>
            ) : null}
            {accumulationLine ? (
              <div
                className={
                  accumulationLine.kind === "snow"
                    ? styles.snowLine
                    : styles.rainLine
                }
              >
                <span aria-hidden="true">
                  {accumulationLine.kind === "snow"
                    ? t("charts.snow", { defaultValue: "❄" })
                    : "─"}
                </span>
                <span>{accumulationLine.label}</span>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};

DailyForecastColumns.propTypes = {
  expanded: PropTypes.bool,
};

export default DailyForecastColumns;
