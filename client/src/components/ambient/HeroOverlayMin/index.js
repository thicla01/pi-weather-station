import React, { useContext } from "react";
import { useTranslation } from "react-i18next";
import { InlineIcon } from "@iconify/react";
import { WeatherDataContext, UiPrefsContext } from "~/AppContext";
import { convertTemp } from "~/services/conversions";
import { parseWeatherCode, isDaylight } from "~/ui/weatherCodes";
import FeelsLikeLine from "~/components/ambient/FeelsLikeLine";
import LocationName from "~/components/LocationName";
import styles from "./styles.css";

/**
 * MIN-state hero overlay (v3.2 — « 3 états radar »).
 *
 * A compact, map-pinned variant of `HeroCompact`'s focal block,
 * shown ONLY when LayoutPi is in the MIN state (`piLayoutState ===
 * "min"`, i.e. radar fullscreen with the rail collapsed). In that
 * state the whole rail — and with it `HeroCompact` — is hidden, so
 * the at-a-glance « where + how warm + what » readout would vanish.
 * This slab restores it: pinned top-left over the radar, clear of
 * the 44 px Leaflet zoom column.
 *
 * Scope is deliberately narrower than `HeroCompact`:
 *   tier 1: location micro-row (pin + place, via `<LocationName />`)
 *   tier 2: large temperature numeral | condition icon + word +
 *           compact feels-like line
 * NO astro/moon meta-line and NO forecast — the radar is the focus
 * in MIN; the slab is a quiet anchor, not a second hero.
 *
 * Purely presentational: it reads the same already-fetched plumbing
 * `HeroCompact` does (no refetch) and never writes `piLayoutState`.
 * Reuses `LocationName`, `FeelsLikeLine`, and the shared
 * `parseWeatherCode` / `isDaylight` helpers so the condition mapping,
 * delta-chip rule, and reverse-geocode logic each live in exactly
 * one place.
 *
 * Unlike `HeroCompact`, the location row is non-interactive here (no
 * tap-for-details popover): MIN is radar-first and the slab stays a
 * glanceable readout, so there is no tappable control to gate.
 *
 * Renders `null` until the first current-weather payload lands — the
 * overlay only ever appears in MIN, so there's no reflow cost to
 * waiting (no placeholder needed, unlike the in-rail `HeroCompact`).
 *
 * @returns {JSX.Element|null} the MIN-state hero overlay, or `null`
 *   before current weather data is available
 */
const HeroOverlayMin = () => {
  const { currentWeatherData, sunriseTime, sunsetTime } = useContext(WeatherDataContext);
  const { tempUnit } = useContext(UiPrefsContext);
  const { t } = useTranslation();

  const weatherData = currentWeatherData?.data?.timelines?.[0]?.intervals?.[0]?.values;
  if (!weatherData) return null;

  const { temperature, temperatureApparent, weatherCode } = weatherData;
  const daylight = sunriseTime && sunsetTime
    ? isDaylight(sunriseTime, sunsetTime)
    : true;
  const parsed = parseWeatherCode(weatherCode, daylight);
  const tempUnitLabel = tempUnit === "k" ? "K" : `°${tempUnit.toUpperCase()}`;

  // Feels-like always-on (v2.15.16 ruling — see FeelsLikeLine for the
  // delta-chip rule). Both values arrive converted to the display unit
  // before being handed to FeelsLikeLine, matching HeroCompact.
  const tempConverted = convertTemp(temperature, tempUnit);
  const feelsConverted = temperatureApparent != null
    ? convertTemp(temperatureApparent, tempUnit)
    : null;
  const showFeelsLike = tempConverted != null && feelsConverted != null;

  return (
    <div className={styles.overlay}>
      <div className={styles.location}>
        <LocationName />
      </div>
      <div className={styles.focal}>
        <div className={styles.tempBlock}>
          <span className={styles.tempValue}>{tempConverted}</span>
          <span className={styles.tempUnit}>{tempUnitLabel}</span>
        </div>
        <div className={styles.condCol}>
          {parsed?.icon ? (
            <span className={styles.condIcon}>
              <InlineIcon icon={parsed.icon} />
            </span>
          ) : null}
          {parsed?.descKey ? (
            <div className={styles.condText}>{t(parsed.descKey)}</div>
          ) : null}
          {showFeelsLike ? (
            <FeelsLikeLine temp={tempConverted} feels={feelsConverted} />
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default HeroOverlayMin;
