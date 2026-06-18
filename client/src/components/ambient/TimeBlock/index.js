import React, { useContext, useEffect, useState } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { InlineIcon } from "@iconify/react";
import sunsetIcon from "@iconify/icons-wi/sunset";
import { UiPrefsContext, LocationContext, WeatherDataContext } from "~/AppContext";
import SeasonsTrigger, { seasonCountdownLabel } from "~/components/ambient/Seasons";
import styles from "./styles.css";

const I18N_LOCALE = { en: "en-US", fr: "fr-FR", es: "es-ES" };

/**
 * Direction C time slab — date and current time (the household's
 * kitchen clock).
 *
 * The data flow mirrors the v2 `Clock` component exactly (timezone
 * follows the marker via `mapTimezone`, 12/24 h via `clockTime`,
 * locale via i18n). The visual treatment is Direction-C-native:
 * large Geist Mono time in `--c-text`, dim date caption above.
 *
 * v3.1 Phase 2 (B1·a migration): the sunrise/sunset chips, the moon
 * chip and their popovers moved into the hero's `AstroMetaLine` —
 * one sun/moon home per screen. The slab keeps its size, position
 * and kitchen-clock role (§5 ruling). The date caption is the
 * year-round trigger for the Saisons popover (`SeasonsTrigger`); the
 * in-window countdown rides below as a plain text line.
 *
 * Clock ticks via a 1 s `setInterval`. The interval is cleared on
 * unmount — important for the experimental flag toggle, which
 * unmounts the entire AmbientLayers subtree.
 *
 * @param {object} props
 * @param {boolean} [props.compact] — v3.2 slim Pi MID layout: a single row
 *   of time + abbreviated date + a sunset chip (the sunset moved here from
 *   the hero's now-hidden AstroMetaLine), dropping the seasonal-countdown
 *   line. The date stays the year-round Saisons-popover trigger.
 * @returns {JSX.Element} time slab
 */
const TimeBlock = ({ compact }) => {
  const { clockTime } = useContext(UiPrefsContext);
  const { mapTimezone } = useContext(LocationContext);
  const { sunsetTime } = useContext(WeatherDataContext);
  const { i18n, t } = useTranslation();
  const localeKey = i18n.language.startsWith("fr")
    ? "fr"
    : i18n.language.startsWith("es")
      ? "es"
      : "en";
  const locale = I18N_LOCALE[localeKey];
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(tick);
  }, []);

  const hour12 = clockTime === "12";
  const dateStr = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: mapTimezone,
  }).format(now).toUpperCase();

  const timeFormatter = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    hour12,
    timeZone: mapTimezone,
  });
  const parts = timeFormatter.formatToParts(now);
  const hhmm = parts
    .filter((p) => ["hour", "minute", "literal"].includes(p.type))
    .map((p) => p.value)
    .join("")
    .trim()
    // FR 24h "21 h 03" → strip trailing " h" so the digit block reads
    // as "HH:mm" same as in EN. Matches v2 Clock behaviour.
    .replace(/\s+h\s*$/i, "");
  const dayPeriod = parts.find((p) => p.type === "dayPeriod")?.value || "";

  // In-window seasonal countdown text shown on its own line below the
  // clock; null the rest of the year.
  const seasonLabel = seasonCountdownLabel(now, t);

  // v3.2 slim Pi MID variant: time + abbreviated date + sunset chip in one
  // row. The sunset lives here now (it left the hero with the lean redesign),
  // so the Pi MID screen doesn't lose it. The date keeps the Saisons trigger.
  if (compact) {
    const dateShort = new Intl.DateTimeFormat(locale, {
      weekday: "short",
      month: "long",
      day: "numeric",
      timeZone: mapTimezone,
    }).format(now);
    const sunsetStr = sunsetTime
      ? timeFormatter.format(new Date(sunsetTime)).replace(/\s+h\s*$/i, "")
      : null;
    return (
      <div className={`${styles.slab} ${styles.compact}`}>
        <div className={styles.time}>
          {hhmm}
          {hour12 && dayPeriod ? <span className={styles.amPm}>{dayPeriod}</span> : null}
        </div>
        <div className={styles.dateCompact}>
          <SeasonsTrigger now={now}>{dateShort}</SeasonsTrigger>
        </div>
        {sunsetStr ? (
          <div className={styles.sunset}>
            <InlineIcon icon={sunsetIcon} aria-hidden="true" />
            <span>{sunsetStr}</span>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={styles.slab}>
      {/* The date is the year-round trigger for the Saisons popover. */}
      <div className={styles.date}>
        <SeasonsTrigger now={now}>{dateStr}</SeasonsTrigger>
      </div>
      <div className={styles.time}>
        {hhmm}
        {hour12 && dayPeriod ? <span className={styles.amPm}>{dayPeriod}</span> : null}
      </div>
      {seasonLabel ? (
        <div className={styles.solarEventMarker}>{seasonLabel}</div>
      ) : null}
    </div>
  );
};

TimeBlock.propTypes = {
  compact: PropTypes.bool,
};

TimeBlock.defaultProps = {
  compact: false,
};

export default TimeBlock;
