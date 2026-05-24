import React, { useContext } from "react";
import PropTypes from "prop-types";
import { AppContext } from "~/AppContext";
import { InlineIcon } from "@iconify/react";
import locationIcon from "@iconify/icons-ion/location-sharp";
import styles from "./styles.css";

/**
 * Map location.
 *
 * Pure display component — the reverse-geocode fetch lives in
 * `AppContext` (see `reverseGeoResult` + its effect). This component
 * just formats whatever the context currently holds, so any consumer
 * that also wants the raw payload (e.g. `LocationDetailsPopover`)
 * reads from the same source without duplicating the fetch.
 *
 * @param {object} props
 * @param {boolean} [props.stacked] — When true, render the primary place
 *   (city / first segment) on its own line and the rest (country / region)
 *   below in smaller text. Used by the HeroBand to balance the panel against
 *   the large temperature numeral on wide layouts.
 * @returns {JSX.Element} Location name
 */
const LocationName = ({ stacked = false }) => {
  const { mapGeo, reverseGeoResult } = useContext(AppContext);

  // Three-state read on `reverseGeoResult` (see AppContext for the
  // sentinel meanings):
  //   object   → format via getName()
  //   null     → settled empty (no key, 204, failure) → lat/lon fallback
  //   undefined→ in-flight → empty placeholder so the layout doesn't
  //              reflow and we don't flash raw coords pre-resolution
  let name = null;
  if (reverseGeoResult && reverseGeoResult.address) {
    name = getName(reverseGeoResult);
  } else if (reverseGeoResult === null && mapGeo) {
    name = `${mapGeo.latitude}, ${mapGeo.longitude}`;
  }

  if (!name) {
    return <div className={`${styles.container}`} />;
  }

  // Stacked variant — first segment (city / county / state) on the primary
  // line, remainder (country) underneath. Splitting on the LAST comma keeps
  // multi-word regions intact, e.g. "Washington, D.C., USA" stacks as
  // "Washington, D.C." + "USA".
  if (stacked) {
    const lastComma = name.lastIndexOf(",");
    const primary = lastComma === -1 ? name : name.slice(0, lastComma).trim();
    const secondary = lastComma === -1 ? "" : name.slice(lastComma + 1).trim();
    // Adaptive font-size for very long place names so they don't blow
    // out the panel vertically. Real-world worst case in our test set:
    // "Sainte-Madeleine-de-la-Rivière-Madeleine" (40 chars, longest
    // municipality name in Quebec — confirmed by Toponymie Québec).
    // Tier thresholds picked empirically from the names we see most:
    // most US/CA/EU cities fall in the base tier; provincial or
    // historical compound names (Trois-Rivières, Saint-Jean-sur-
    // Richelieu) land in `medium`; the hyphenated outliers land in
    // `long` or `verylong`.
    const len = primary.length;
    let lengthClass = "";
    if (len > 35) lengthClass = styles.verylong;
    else if (len > 26) lengthClass = styles.long;
    else if (len > 18) lengthClass = styles.medium;
    return (
      <div className={`${styles.container} ${styles.stacked}`}>
        <div className={`${styles.primary} ${lengthClass}`}>
          <InlineIcon icon={locationIcon} /> {primary}
        </div>
        {secondary ? <div className={styles.secondary}>{secondary}</div> : null}
      </div>
    );
  }

  return (
    <div className={`${styles.container}`}>
      <div>
        <InlineIcon icon={locationIcon} /> {name}
      </div>
    </div>
  );
};

LocationName.propTypes = {
  stacked: PropTypes.bool,
};

/**
 * Parses name data from results
 *
 * @param {object} res
 * @returns {String} Display name
 */
const getName = (res) => {
  // LocationIQ's address payload uses snake_case (country_code); rename
  // on destructure to avoid bleeding upstream conventions through the
  // rest of the function and to keep camelcase clean in our own code.
  const { city, country, state, country_code: countryCode, county, region } = res.address;
  if (countryCode === "us") {
    if (city) {
      return `${city}, ${state}`;
    } else if (county) {
      return `${county}, ${state}`;
    } else if (state) {
      return `${state}`;
    } else {
      return `${country}`;
    }
  } else {
    if (city) {
      return `${city}, ${country}`;
    } else {
      return `${
        county
          ? `${county}, `
          : region
          ? `${region}, `
          : state
          ? `${state}, `
          : ""
      }${country}`;
    }
  }
};

export default LocationName;
