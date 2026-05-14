import React, { useContext } from "react";
import { useTranslation } from "react-i18next";
import { InlineIcon } from "@iconify/react";
import { format } from "date-fns";
import { fr, es, enUS } from "date-fns/locale";
import { AppContext } from "~/AppContext";
import { parseWeatherCode } from "~/ui/weatherCodes";
import { convertTemp } from "~/services/conversions";
import styles from "./styles.css";

/**
 * 5-day forecast as a horizontal strip of columns, replacing the
 * Chart.js line graph for the "5 jours / 5 days" view inside
 * ChartTabs.
 *
 * Design reference: Claude Design "Next 5 days" panel — each column
 * gets the day abbreviation, weather icon, high temp (bold), low
 * temp (dim), and precipitation % when meaningful (≥ 30 %).
 *
 * Data source: `dailyWeatherData.data.timelines[0].intervals[]` from
 * `/api/weather/daily`. Fields used: `temperatureMax`,
 * `temperatureMin`, `weatherCodeMax`, `precipitationProbabilityMax`
 * (server-side fields list updated at the same time as this
 * component; see proxyCtrl.js > weatherDaily). Reads `tempUnit` from
 * AppContext for °C / °F / K conversion via the existing
 * `convertTemp` helper.
 *
 * The PRECIP_THRESHOLD const filters out token "0 %" / "10 %"
 * values that would clutter every column with noise — only days
 * with a credible chance of rain show the percentage. The 30 %
 * cut matches what the Tomorrow.io UI itself surfaces as
 * "noteworthy".
 *
 * The PRECIP_THRESHOLD const lives outside the component so a future
 * settings hook can override it without re-rendering the column.
 */
const PRECIP_THRESHOLD = 30;

/**
 * @returns {JSX.Element|null} 5-day strip, or null when no payload
 */
const DailyForecastColumns = () => {
  const { dailyWeatherData, tempUnit } = useContext(AppContext);
  const { i18n } = useTranslation();
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
    <div className={styles.strip} role="list">
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
        const code = values?.weatherCodeMax ?? values?.weatherCodeFullDay ?? values?.weatherCodeDay ?? values?.weatherCode;
        const precip = values?.precipitationProbabilityMax ?? values?.precipitationProbability;
        // Daily icons always render the daytime variant — the high
        // temp and weather are characterised by the day, not the
        // overnight tail, so `isDay=true` is the right pick.
        const { icon } = code != null ? (parseWeatherCode(code, true) || {}) : {};
        return (
          <div key={i} className={styles.column} role="listitem">
            <div className={styles.day}>{dayLabel}</div>
            <div className={styles.iconRow}>
              {/* Explicit pixel sizing + currentColor on the SVG to
               * rule out any ambient font-size / line-height / flex
               * interaction. Iconify's `style` prop wins over the
               * 1em-based defaults. Diagnostic fallback below: if
               * `icon` is truthy but the SVG still doesn't paint, the
               * numeric weather code shows so we know whether the
               * problem is rendering or data. */}
              {icon ? (
                <InlineIcon
                  icon={icon}
                  width={30}
                  height={30}
                  style={{ color: "currentColor" }}
                />
              ) : (
                <span className={styles.iconPlaceholder}>
                  {code != null ? `code ${code}` : "—"}
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
      })}
    </div>
  );
};

export default DailyForecastColumns;
