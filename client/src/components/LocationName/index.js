import React, { useEffect, useState, useContext } from "react";
import PropTypes from "prop-types";
import { AppContext } from "~/AppContext";
import { InlineIcon } from "@iconify/react";
import reverseGeocode from "~/services/reverseGeocode";
import locationIcon from "@iconify/icons-ion/location-sharp";
import styles from "./styles.css";

/**
 * Map location.
 *
 * @param {object} props
 * @param {boolean} [props.stacked] — When true, render the primary place
 *   (city / first segment) on its own line and the rest (country / region)
 *   below in smaller text. Used by the HeroBand to balance the panel against
 *   the large temperature numeral on wide layouts.
 * @returns {JSX.Element} Location name
 */
const LocationName = ({ stacked = false }) => {
  const { mapGeo, reverseGeoApiKey } = useContext(AppContext);
  const [name, setName] = useState(null);

  useEffect(() => {
    if (mapGeo && reverseGeoApiKey) {
      const { latitude: lat, longitude: lon } = mapGeo;
      reverseGeocode({ lat, lon })
        .then((res) => {
          setName(getName(res));
        })
        .catch((err) => {
          setName(`${lat}, ${lon}`);
          console.log("err!", err);
        });
    } else if (mapGeo && !reverseGeoApiKey) {
      const { latitude: lat, longitude: lon } = mapGeo;
      setName(`${lat}, ${lon}`);
    }
  }, [mapGeo, reverseGeoApiKey]);

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
    return (
      <div className={`${styles.container} ${styles.stacked}`}>
        <div className={styles.primary}>
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
