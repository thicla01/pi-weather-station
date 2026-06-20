import React, { useContext, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { InlineIcon } from "@iconify/react";
import { WeatherDataContext, UiPrefsContext, LocationContext } from "~/AppContext";
import { convertTemp } from "~/services/conversions";
import { parseWeatherCode, isDaylight } from "~/ui/weatherCodes";
import FeelsLikeLine from "~/components/ambient/FeelsLikeLine";
import LocationName from "~/components/LocationName";
import LocationDetailsPopover from "~/components/ambient/LocationDetailsPopover";
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
 * Reads the same already-fetched plumbing `HeroCompact` does (no refetch) and
 * never writes `piLayoutState` (its only local state is the location popover's
 * open flag). Reuses `LocationName`, `FeelsLikeLine`, and the shared
 * `parseWeatherCode` / `isDaylight` helpers so the condition mapping,
 * delta-chip rule, and reverse-geocode logic each live in exactly
 * one place.
 *
 * The location row carries the same tap-for-details affordance as the rail
 * `HeroCompact`: a dotted-underline trigger opening `LocationDetailsPopover`
 * (which portals + viewport-clamps, so it escapes this small map-pinned card).
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
  const { reverseGeoResult } = useContext(LocationContext);
  const { t } = useTranslation();

  // Tap-for-details on the location row — same affordance as the rail
  // HeroCompact. LocationDetailsPopover portals + viewport-clamps, so it
  // escapes this small map-pinned card cleanly. Interactive only once the
  // reverse-geocode payload exists; otherwise the plain readout shows.
  const locationRef = useRef(null);
  const [locationOpen, setLocationOpen] = useState(false);
  const locationClickable = !!reverseGeoResult;
  const locationRow = locationClickable ? (
    <button
      ref={locationRef}
      type="button"
      className={styles.locationButton}
      onClick={() => setLocationOpen((v) => !v)}
      aria-expanded={locationOpen}
      aria-label={t("location.details")}
      title={t("location.details")}
    >
      <LocationName />
    </button>
  ) : (
    <LocationName />
  );

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
        {locationRow}
        <LocationDetailsPopover
          open={locationOpen}
          onClose={() => setLocationOpen(false)}
          triggerRef={locationRef}
          anchor="left"
        />
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
