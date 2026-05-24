import React, { useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { InlineIcon } from "@iconify/react";
import bxsSun from "@iconify/icons-bx/bxs-sun";
import bxsMoon from "@iconify/icons-bx/bxs-moon";
import { AppContext } from "~/AppContext";
import { convertTemp } from "~/services/conversions";
import { parseWeatherCode, isDaylight } from "~/ui/weatherCodes";
import { moonPhase, upcomingSolarEvent } from "~/ui/astronomy";
import MoonDetailsPopover from "~/components/ambient/MoonDetailsPopover";
import SunDetailsPopover from "~/components/ambient/SunDetailsPopover";
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
  const temperatureApparent = values?.temperatureApparent;
  const weatherCode = values?.weatherCode;
  const daylight = sunriseTime && sunsetTime
    ? isDaylight(sunriseTime, sunsetTime)
    : true;
  const parsed = parseWeatherCode(weatherCode, daylight);
  const tempUnitLabel = tempUnit === "k" ? "K" : `°${tempUnit.toUpperCase()}`;

  // Feels-like — parity with HeroCompact (LayoutPi / LayoutMobile),
  // where this chip ships always-on whenever Tomorrow.io returns a
  // value. Without it the desktop hero panel reads as "missing" data
  // that mobile/Pi users can see.
  const feelsConverted = temperatureApparent != null
    ? convertTemp(temperatureApparent, tempUnit)
    : null;
  const showFeelsLike = feelsConverted != null;

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

  // Astronomy add-ons (v2.16.x) — mirror TimeBlock so the desktop
  // hero band carries the moon-phase chip and the optional
  // solstice/equinox marker just like the Pi/mobile clock slab.
  const moon = moonPhase(now);
  const upcoming = upcomingSolarEvent(now);

  // Tap-for-details on the moon chip (same pattern as TimeBlock).
  // Anchored to the LEFT of the chip so the popover extends rightward
  // and stays inside the desktop clock panel rather than hanging off
  // the right edge.
  const moonChipRef = useRef(null);
  const [moonOpen, setMoonOpen] = useState(false);
  // Tap-for-details on the sun chips (sunrise + sunset). Both chips
  // open the same SunDetailsPopover anchored to the sunrise chip;
  // opening one closes the moon popover so the two never visually
  // collide in the narrow clock panel.
  const sunChipRef = useRef(null);
  const [sunOpen, setSunOpen] = useState(false);
  const toggleSun = () => { setMoonOpen(false); setSunOpen((v) => !v); };
  const toggleMoon = () => { setSunOpen(false); setMoonOpen((v) => !v); };

  return (
    <div className={styles.band}>
      <div className={styles.panelPlace}>
        <div className={styles.placeLabel}>
          <LocationName stacked />
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
            {(parsed?.descKey || showFeelsLike) ? (
              <div className={styles.tempInfo}>
                {parsed?.descKey ? (
                  <div className={styles.tempDesc}>{t(parsed.descKey)}</div>
                ) : null}
                {showFeelsLike ? (
                  <div className={styles.feelsLike}>
                    <span className={styles.feelsLikeLabel}>{t("weather.feelsLike")}</span>
                    <span className={styles.feelsLikeValue}>{feelsConverted}°</span>
                  </div>
                ) : null}
              </div>
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
            <button
              ref={sunChipRef}
              type="button"
              className={`${styles.clockSunChip} ${styles.moonChip}`}
              title={t("astronomy.sunDetails")}
              aria-label={t("astronomy.sunDetails")}
              aria-expanded={sunOpen}
              onClick={toggleSun}
            >
              <InlineIcon icon={bxsSun} />
              {sunFormatter.format(new Date(sunriseTime))}
            </button>
            <button
              type="button"
              className={`${styles.clockSunChip} ${styles.moonChip}`}
              title={t("astronomy.sunDetails")}
              aria-label={t("astronomy.sunDetails")}
              aria-expanded={sunOpen}
              onClick={toggleSun}
            >
              <InlineIcon icon={bxsMoon} />
              {sunFormatter.format(new Date(sunsetTime))}
            </button>
            <button
              ref={moonChipRef}
              type="button"
              className={`${styles.clockSunChip} ${styles.moonChip}`}
              title={t(`astronomy.moonPhase.${moon.i18nKey}`)}
              aria-label={t(`astronomy.moonPhase.${moon.i18nKey}`)}
              aria-expanded={moonOpen}
              onClick={toggleMoon}
            >
              <span className={styles.moonGlyph}>{moon.glyph}</span>
              {Math.round(moon.illumination * 100)}%
              <MoonDetailsPopover
                open={moonOpen}
                onClose={() => setMoonOpen(false)}
                now={now}
                triggerRef={moonChipRef}
                anchor="right"
              />
            </button>
            <SunDetailsPopover
              open={sunOpen}
              onClose={() => setSunOpen(false)}
              triggerRef={sunChipRef}
              anchor="right"
            />
          </div>
        ) : null}
        {upcoming ? (
          <div className={styles.solarEventMarker}>
            {t("astronomy.solarEventIn", {
              event: t(`astronomy.solarEvent.${upcoming.event}`),
              days: upcoming.daysAway,
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default HeroBand;
