import React, { useContext } from "react";
import { AppContext } from "~/AppContext";
import { InlineIcon } from "@iconify/react";
import bxsMoon from '@iconify/icons-bx/bxs-moon';
import bxsSun from '@iconify/icons-bx/bxs-sun';

import styles from "./styles.css";

/**
 * Sunrise / Sunset component — formats sunrise/sunset times (returned
 * as UTC ISO strings by sunrise-sunset.org) in the marker's local
 * timezone (mapTimezone, derived in AppContext via tz-lookup). Without
 * this, viewing a marker in HKT from a Pi in EDT would display
 * "sunrise at 17:43" because the UTC times were being formatted in the
 * Pi's host timezone instead of the location's.
 *
 * @returns {JSX.Element} Sunrise / Sunset component
 */
const SunRiseSet = () => {
  const { sunriseTime, sunsetTime, clockTime, mapTimezone } = useContext(AppContext);
  if (!sunriseTime || !sunsetTime) return null;

  const formatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: clockTime === "12",
    timeZone: mapTimezone, // undefined → host TZ (fallback before lookup resolves)
  });

  return (
    <div className={styles.container}>
      <div>
        <InlineIcon icon={bxsSun} />
        <span>{formatter.format(new Date(sunriseTime))}</span>
      </div>
      <div>
        <InlineIcon icon={bxsMoon} />
        <span>{formatter.format(new Date(sunsetTime))}</span>
      </div>
    </div>
  );
};

export default SunRiseSet;
