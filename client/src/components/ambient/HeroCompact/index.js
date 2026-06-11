import React, { useContext, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { InlineIcon } from "@iconify/react";
import { WeatherDataContext, UiPrefsContext, LocationContext } from "~/AppContext";
import { convertTemp } from "~/services/conversions";
import { parseWeatherCode, isDaylight } from "~/ui/weatherCodes";
import LocationName from "~/components/LocationName";
import LocationDetailsPopover from "~/components/ambient/LocationDetailsPopover";
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
  const { currentWeatherData, sunriseTime, sunsetTime } = useContext(WeatherDataContext);
  const { tempUnit } = useContext(UiPrefsContext);
  const { reverseGeoResult } = useContext(LocationContext);
  const { t } = useTranslation();

  // Tap-for-details on the location row (same UX as HeroBand on desktop).
  // Anchored to the left edge so the popover extends rightward — the
  // HeroCompact slab is right-side-of-rail in mobile/Pi layouts, but
  // its location row hugs the slab's left edge, so left-anchored is
  // the safer choice across viewports.
  const locationRef = useRef(null);
  const [locationOpen, setLocationOpen] = useState(false);
  const toggleLocation = () => setLocationOpen((v) => !v);
  const locationClickable = !!reverseGeoResult;

  // Reusable location row — same markup in the empty placeholder and
  // the populated layout, so the popover trigger is consistent across
  // both states. When we don't yet have geocode data the row falls
  // back to the non-interactive <div> variant.
  const locationRow = locationClickable ? (
    <button
      ref={locationRef}
      type="button"
      className={styles.locationButton}
      onClick={toggleLocation}
      aria-expanded={locationOpen}
      aria-label={t("location.details")}
      title={t("location.details")}
    >
      <LocationName />
    </button>
  ) : (
    <LocationName />
  );
  const locationPopover = (
    <LocationDetailsPopover
      open={locationOpen}
      onClose={() => setLocationOpen(false)}
      triggerRef={locationRef}
      anchor="left"
    />
  );

  const weatherData = currentWeatherData?.data?.timelines?.[0]?.intervals?.[0]?.values;
  if (!weatherData) {
    return (
      <div className={`${styles.slab} ${styles.empty}`}>
        {locationRow}
        {locationPopover}
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
        {locationRow}
        {locationPopover}
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
