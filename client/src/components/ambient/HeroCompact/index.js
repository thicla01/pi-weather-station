import React, { useContext, useRef, useState } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { InlineIcon } from "@iconify/react";
import { WeatherDataContext, UiPrefsContext, LocationContext } from "~/AppContext";
import { convertTemp } from "~/services/conversions";
import { parseWeatherCode, isDaylight } from "~/ui/weatherCodes";
import AstroMetaLine from "~/components/ambient/AstroMetaLine";
import FeelsLikeLine from "~/components/ambient/FeelsLikeLine";
import LocationName from "~/components/LocationName";
import LocationDetailsPopover from "~/components/ambient/LocationDetailsPopover";
import { ExpandIcon } from "~/components/WeatherMap/icons";
import styles from "./styles.css";

/**
 * Direction C compact hero slab (Pi 7" + mobile) — v3.1 Phase 2
 * pyramid:
 *
 *   tier 1: place micro-row (popover trigger)
 *   tier 2: large temperature numeral | condition icon + text +
 *           always-on feels-like (+ delta chip)
 *   tier 3: sun/moon meta-line — the ONLY sun/moon home on screen
 *           (B1·a migration: the TimeBlock keeps its kitchen-clock
 *           role but its astro chips moved here)
 *
 * Reuses the v2 `<LocationName />` directly so the reverse-geocode
 * logic stays in one place; the shared `FeelsLikeLine` and
 * `AstroMetaLine` carry the §4 delta-chip rule and the B4.7
 * phase-name rule (short family name on the 7" rail).
 *
 * Renders a placeholder (location + meta-line only) when current
 * weather data isn't loaded yet so the layout doesn't reflow when
 * the first payload lands.
 *
 * @param {object} props
 * @param {boolean} [props.shortPhaseName] — forwarded to
 *   `AstroMetaLine`; LayoutPi passes true (7" rail too narrow for
 *   "Gibbeuse croissante"), LayoutMobile keeps the full name.
 * @param {boolean} [props.hideAstro] — drop the sun/moon meta-line
 *   entirely. The v3.2 lean Pi MID hero is anchored on feels-like and the
 *   sunrise/sunset already lives on the clock card, so LayoutPi passes true
 *   to avoid the redundant (and taller) hero.
 * @param {boolean} [props.hideFeelsLike] — drop the feels-like line. The
 *   v3.3 glance hero shows place + temp + condition only; the feels-like
 *   moves into the Conditions view.
 * @param {() => void} [props.onMaximize] — when set, the slab carries a ⤢
 *   corner affordance (the radar screen's four-corner square) that calls
 *   this; the v3.3 glance hero opens the Conditions view with it. Adds no
 *   card height (absolute corner).
 * @returns {JSX.Element} hero slab
 */
const HeroCompact = ({ shortPhaseName, hideAstro, hideFeelsLike, onMaximize }) => {
  const { currentWeatherData, sunriseTime, sunsetTime } = useContext(WeatherDataContext);
  const { tempUnit } = useContext(UiPrefsContext);
  const { reverseGeoResult } = useContext(LocationContext);
  const { t } = useTranslation();

  // v3.3 glance: a corner ⤢ that opens the Conditions view. Rendered in both
  // the placeholder and populated slabs so the affordance doesn't pop in when
  // the first payload lands. Absolute-positioned — costs no card height.
  const maximizeBtn = onMaximize ? (
    <button
      type="button"
      className={styles.maximize}
      onClick={onMaximize}
      aria-label={t("conditions.openAria", { defaultValue: "Open conditions" })}
    >
      <ExpandIcon className={styles.maximizeIcon} />
    </button>
  ) : null;

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
        {maximizeBtn}
        <div className={styles.location}>
          {locationRow}
          {locationPopover}
        </div>
        {!hideAstro && <AstroMetaLine shortPhaseName={shortPhaseName} />}
      </div>
    );
  }

  const { temperature, temperatureApparent, weatherCode } = weatherData;
  const daylight = sunriseTime && sunsetTime
    ? isDaylight(sunriseTime, sunsetTime)
    : true;
  const parsed = parseWeatherCode(weatherCode, daylight);
  const tempUnitLabel = tempUnit === "k" ? "K" : `°${tempUnit.toUpperCase()}`;

  // Feels-like always-on (v2.15.16 ruling — see FeelsLikeLine for the
  // delta-chip rule). Tomorrow.io's `temperatureApparent` accounts for
  // wind chill (cold + wind) and heat index (hot + humid); when
  // neither applies it falls back to the actual temperature, which is
  // fine — the line just confirms there's no perceived correction.
  const tempConverted = convertTemp(temperature, tempUnit);
  const feelsConverted = temperatureApparent != null
    ? convertTemp(temperatureApparent, tempUnit)
    : null;
  const showFeelsLike = !hideFeelsLike && tempConverted != null && feelsConverted != null;

  return (
    <div className={styles.slab}>
      {maximizeBtn}
      <div className={styles.location}>
        {locationRow}
        {locationPopover}
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
      {!hideAstro && <AstroMetaLine shortPhaseName={shortPhaseName} />}
    </div>
  );
};

HeroCompact.propTypes = {
  shortPhaseName: PropTypes.bool,
  hideAstro: PropTypes.bool,
  hideFeelsLike: PropTypes.bool,
  onMaximize: PropTypes.func,
};

HeroCompact.defaultProps = {
  shortPhaseName: false,
  hideAstro: false,
  hideFeelsLike: false,
  onMaximize: undefined,
};

export default HeroCompact;
