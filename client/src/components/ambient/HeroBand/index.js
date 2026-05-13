import React, { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { InlineIcon } from "@iconify/react";
import bxsSun from "@iconify/icons-bx/bxs-sun";
import bxsMoon from "@iconify/icons-bx/bxs-moon";
import { AppContext } from "~/AppContext";
import { convertTemp } from "~/services/conversions";
import { parseWeatherCode, isDaylight } from "~/ui/weatherCodes";
import LocationName from "~/components/LocationName";
import styles from "./styles.css";

const I18N_LOCALE = { en: "en-US", fr: "fr-FR", es: "es-ES" };

/**
 * Direction C desktop hero band — a single wide slab anchored at the
 * top of the viewport, split into three logical panels:
 *
 *   ┌─────────────┬─────────────────┬───────────────┐
 *   │  Location   │  Temperature    │  Date / Time  │
 *   │  (caps)     │  + weather icon │  + sun row    │
 *   └─────────────┴─────────────────┴───────────────┘
 *
 * The plan called for three separate `HeroPlaceDesktop`,
 * `HeroTempDesktop`, `HeroClockDesktop` components — collapsed here
 * into a single `HeroBand` slab because the three panels share
 * surface, padding, and divider lines. Splitting into three slabs
 * would have introduced gap visual noise that doesn't match the
 * "wide single band" the Direction C mockups call for.
 *
 * Sizes the temperature numeral relative to the band height (64 px
 * on the 140 px band ≥1280, 88 px on the 180 px band ≥1600) so the
 * hero scales with the viewport without re-rendering layout.
 *
 * @returns {JSX.Element} hero band slab
 */
const HeroBand = () => {
  const {
    currentWeatherData,
    tempUnit,
    clockTime,
    mapTimezone,
    sunriseTime,
    sunsetTime,
  } = useContext(AppContext);
  const { t, i18n } = useTranslation();
  const localeKey = i18n.language.startsWith("fr")
    ? "fr"
    : i18n.language.startsWith("es")
      ? "es"
      : "en";
  const locale = I18N_LOCALE[localeKey];

  // Tick the clock every second so the time stays live without a
  // separate Clock component instance.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const values = currentWeatherData?.data?.timelines?.[0]?.intervals?.[0]?.values;
  const temperature = values?.temperature;
  const weatherCode = values?.weatherCode;
  const daylight = sunriseTime && sunsetTime
    ? isDaylight(sunriseTime, sunsetTime)
    : true;
  const parsed = parseWeatherCode(weatherCode, daylight);
  const tempUnitLabel = tempUnit === "k" ? "K" : `°${tempUnit.toUpperCase()}`;

  const hour12 = clockTime === "12";
  const dateStr = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: mapTimezone,
  }).format(now).toUpperCase();
  const timeFormatter = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    hour12,
    timeZone: mapTimezone,
  });
  const parts = timeFormatter.formatToParts(now);
  const hhmm = parts
    .filter((p) => ["hour", "minute", "literal"].includes(p.type))
    .map((p) => p.value)
    .join("")
    .trim()
    .replace(/\s+h\s*$/i, "");
  const dayPeriod = parts.find((p) => p.type === "dayPeriod")?.value || "";
  const sunFormatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12,
    timeZone: mapTimezone,
  });

  return (
    <div className={styles.band}>
      <div className={styles.panelPlace}>
        <div className={styles.placeLabel}>
          <LocationName />
        </div>
      </div>
      <div className={styles.divider} />
      <div className={styles.panelTemp}>
        {temperature != null ? (
          <>
            <div className={styles.tempBlock}>
              <span className={styles.tempValue}>{convertTemp(temperature, tempUnit)}</span>
              <span className={styles.tempUnit}>{tempUnitLabel}</span>
            </div>
            {parsed?.icon ? (
              <div className={styles.tempIcon}>
                <InlineIcon icon={parsed.icon} />
              </div>
            ) : null}
            {parsed?.descKey ? (
              <div className={styles.tempDesc}>{t(parsed.descKey)}</div>
            ) : null}
          </>
        ) : null}
      </div>
      <div className={styles.divider} />
      <div className={styles.panelClock}>
        <div className={styles.clockDate}>{dateStr}</div>
        <div className={styles.clockTime}>
          {hhmm}
          {hour12 && dayPeriod ? <span className={styles.clockAmPm}>{dayPeriod}</span> : null}
        </div>
        {sunriseTime && sunsetTime ? (
          <div className={styles.clockSunRow}>
            <span className={styles.clockSunChip}>
              <InlineIcon icon={bxsSun} />
              {sunFormatter.format(new Date(sunriseTime))}
            </span>
            <span className={styles.clockSunChip}>
              <InlineIcon icon={bxsMoon} />
              {sunFormatter.format(new Date(sunsetTime))}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default HeroBand;
