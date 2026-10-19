import React, { useEffect, useState } from "react";
import PropTypes from "prop-types";
import { formatAge } from "~/ui/formatAge";

// How often the age is re-derived: date-fns counts whole minutes below
// 45 min, coarser units above.
const AGE_TICK_MS = 60 * 1000;

/**
 * "N minutes ago" for a measurement timestamp, kept current while shown.
 *
 * The air-quality popovers (AirCard, AirAlertCard) render it, and
 * DetailsPopover mounts it only while open, so its clock starts at the
 * exact time on every opening and then advances once a minute. The clock
 * has to live in state: formatAge used to read it itself, and the React
 * Compiler cached the age on the reading, so an open popover kept its first
 * age until the next reading.
 *
 * @param {object} props
 * @param {string|Date} props.observedAt - ISO 8601 timestamp or Date of the measurement
 * @param {string} props.language - i18next language code ("en", "fr-CA", "es", …)
 * @returns {JSX.Element} a span with the localized age (empty when unparseable)
 */
const ReadingAge = ({ observedAt, language }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), AGE_TICK_MS);
    return () => clearInterval(id);
  }, []);
  return <span>{formatAge(observedAt, language, now)}</span>;
};

ReadingAge.propTypes = {
  observedAt: PropTypes.oneOfType([PropTypes.string, PropTypes.instanceOf(Date)]).isRequired,
  language: PropTypes.string.isRequired,
};

export default ReadingAge;
