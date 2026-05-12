import React, { useContext } from "react";
import { useTranslation } from "react-i18next";
import { InlineIcon } from "@iconify/react";
import { AppContext } from "~/AppContext";
import { convertTemp } from "~/services/conversions";
import { parseWeatherCode, isDaylight } from "~/ui/weatherCodes";
import LocationName from "~/components/LocationName";
import styles from "./styles.css";

/**
 * Direction C hero slab — combines location, current temperature,
 * weather icon, and a one-line description into a single compact
 * surface that anchors the right rail.
 *
 * Layout (mobile-first / Pi 7"):
 *   row 1: <LocationName /> (small caps, dim text)
 *   row 2: large temperature numeral + degree unit | weather icon
 *   row 3: weather description (e.g. "Partly cloudy")
 *
 * Reuses the v2 `<LocationName />` directly so the reverse-geocode
 * logic stays in one place. The weather-code parsing was extracted
 * to `ui/weatherCodes.js` in this phase — same icon set, same
 * day/night switching as v2 CurrentWeather.
 *
 * Renders an empty placeholder when current weather data isn't loaded
 * yet so the layout doesn't reflow when the first payload lands.
 *
 * @returns {JSX.Element} hero slab
 */
const HeroCompact = () => {
  const {
    currentWeatherData,
    tempUnit,
    sunriseTime,
    sunsetTime,
  } = useContext(AppContext);
  const { t } = useTranslation();

  const weatherData = currentWeatherData?.data?.timelines?.[0]?.intervals?.[0]?.values;
  if (!weatherData) {
    return (
      <div className={`${styles.slab} ${styles.empty}`}>
        <LocationName />
      </div>
    );
  }

  const { temperature, weatherCode } = weatherData;
  const daylight = sunriseTime && sunsetTime
    ? isDaylight(sunriseTime, sunsetTime)
    : true;
  const parsed = parseWeatherCode(weatherCode, daylight);
  const tempUnitLabel = tempUnit === "k" ? "K" : `°${tempUnit.toUpperCase()}`;

  return (
    <div className={styles.slab}>
      <div className={styles.location}>
        <LocationName />
      </div>
      <div className={styles.tempRow}>
        <div className={styles.tempBlock}>
          <span className={styles.tempValue}>{convertTemp(temperature, tempUnit)}</span>
          <span className={styles.tempUnit}>{tempUnitLabel}</span>
        </div>
        {parsed?.icon ? (
          <div className={styles.iconBlock}>
            <InlineIcon icon={parsed.icon} />
          </div>
        ) : null}
      </div>
      {parsed?.descKey ? (
        <div className={styles.description}>{t(parsed.descKey)}</div>
      ) : null}
    </div>
  );
};

export default HeroCompact;
