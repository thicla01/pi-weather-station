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

  const { temperature, temperatureApparent, weatherCode } = weatherData;
  const daylight = sunriseTime && sunsetTime
    ? isDaylight(sunriseTime, sunsetTime)
    : true;
  const parsed = parseWeatherCode(weatherCode, daylight);
  const tempUnitLabel = tempUnit === "k" ? "K" : `°${tempUnit.toUpperCase()}`;

  // Feels-like always-on. v2.15.15 gated rendering on
  // |feels - temp| ≥ 1 to avoid redundancy in calm-warm conditions,
  // but that meant the chip disappeared most of the time and the
  // user couldn't tell whether the feature was working. v2.15.16
  // shows it whenever the server has a value — same consistency the
  // mainstream weather apps (Apple, Google, Weather Channel) use.
  // Tomorrow.io's `temperatureApparent` accounts for wind chill
  // (cold + wind) and heat index (hot + humid); when neither applies
  // it falls back to the actual temperature, which is fine — the
  // chip just confirms there's no perceived correction today.
  const tempConverted = convertTemp(temperature, tempUnit);
  const feelsConverted = temperatureApparent != null
    ? convertTemp(temperatureApparent, tempUnit)
    : null;
  const showFeelsLike = feelsConverted != null;

  return (
    <div className={styles.slab}>
      <div className={styles.location}>
        <LocationName />
      </div>
      <div className={styles.tempRow}>
        <div className={styles.tempBlock}>
          <span className={styles.tempValue}>{tempConverted}</span>
          <span className={styles.tempUnit}>{tempUnitLabel}</span>
        </div>
        {parsed?.icon ? (
          <div className={styles.iconBlock}>
            <InlineIcon icon={parsed.icon} />
          </div>
        ) : null}
        {showFeelsLike ? (
          <div className={styles.feelsLike}>
            <span className={styles.feelsLikeLabel}>{t("weather.feelsLike")}</span>
            <span className={styles.feelsLikeValue}>
              {feelsConverted}°
            </span>
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
