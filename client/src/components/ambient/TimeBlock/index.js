import React, { useContext, useEffect, useState } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { InlineIcon } from "@iconify/react";
import sunsetIcon from "@iconify/icons-wi/sunset";
import sunriseIcon from "@iconify/icons-wi/sunrise";
import { UiPrefsContext, LocationContext, WeatherDataContext } from "~/AppContext";
import { isDaylight } from "~/ui/weatherCodes";
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
 * Clock ticks once per minute, aligned on the minute boundary — the
 * slab shows only HH:mm (no seconds). The timer is cleared on unmount
 * — important for the experimental flag toggle, which unmounts the
 * entire AmbientLayers subtree.
 *
 * @param {object} props
 * @param {boolean} [props.compact] — slim Pi glance layout: the big time
 *   beside a right-aligned 2-line meta column — abbreviated day/date/month on
 *   top, the next sun event (sunrise/sunset) below. Drops the seasonal-
 *   countdown line; the date stays the year-round Saisons-popover trigger.
 * @returns {JSX.Element} time slab
 */
const TimeBlock = ({ compact }) => {
  const { clockTime } = useContext(UiPrefsContext);
  const { mapTimezone } = useContext(LocationContext);
  const { sunriseTime, sunsetTime } = useContext(WeatherDataContext);
  const { i18n, t } = useTranslation();
  const localeKey = i18n.language.startsWith("fr")
    ? "fr"
    : i18n.language.startsWith("es")
      ? "es"
      : "en";
  const locale = I18N_LOCALE[localeKey];
  // Tick once per minute, aligned on the minute boundary. The slab shows
  // only HH:mm, so the previous 1 Hz `setInterval` re-rendered the whole
  // slab and re-ran the Intl date/time formatting 60× more often than the
  // display could change — pure renderer waste on the always-on kiosk.
  // This is the same fix already applied to HeroBand; TimeBlock is the
  // Pi/mobile clock and was the live 1 Hz tick on the 7" screen.
  //
  // Chained setTimeout, NOT setInterval: each tick re-computes the next
  // minute boundary, so the phase self-heals after background-tab timer
  // throttling, a sleep/wake, or an NTP clock step. The visibilitychange
  // resync covers a backgrounded tab (mobile layout) returning to view.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const MINUTE_MS = 60 * 1000;
    let timerId = null;
    const scheduleNext = () => {
      timerId = setTimeout(() => {
        setNow(new Date());
        scheduleNext();
      }, MINUTE_MS - (Date.now() % MINUTE_MS));
    };
    scheduleNext();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        setNow(new Date());
        clearTimeout(timerId);
        scheduleNext();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearTimeout(timerId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
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

  // Slim Pi glance variant: big time beside a 2-line meta column — date on
  // top, the next sun event below. The sun reading lives here (it left the
  // hero with the lean redesign); the date keeps the Saisons trigger.
  if (compact) {
    const dateShort = new Intl.DateTimeFormat(locale, {
      weekday: "short",
      month: "long",
      day: "numeric",
      timeZone: mapTimezone,
    }).format(now);
    // Sun line shows the NEXT solar event: sunset while it's daytime, sunrise
    // overnight (after sunset / before sunrise). Both times arrive together in
    // the weather payload; overnight the sunrise time is today's — a ~1 min
    // proxy for tomorrow's, and the clock time shown is what matters.
    const hasSun = sunriseTime && sunsetTime;
    const isDay = hasSun && isDaylight(sunriseTime, sunsetTime);
    const nextSunTime = hasSun ? (isDay ? sunsetTime : sunriseTime) : null;
    const sunStr = nextSunTime
      ? timeFormatter.format(new Date(nextSunTime)).replace(/\s+h\s*$/i, "")
      : null;
    return (
      <div className={`${styles.slab} ${styles.compact}`}>
        <div className={styles.time}>
          {hhmm}
          {hour12 && dayPeriod ? <span className={styles.amPm}>{dayPeriod}</span> : null}
        </div>
        {/* Right-side meta column: day/date/month on top, the next sun event
         * below (maintainer request). The date stays the Saisons-popover
         * trigger. */}
        <div className={styles.meta}>
          <div className={styles.dateCompact}>
            <SeasonsTrigger now={now}>{dateShort}</SeasonsTrigger>
          </div>
          {sunStr ? (
            <div
              className={styles.sun}
              aria-label={`${t(isDay ? "astronomy.sunset" : "astronomy.sunrise")} ${sunStr}`}
            >
              <InlineIcon icon={isDay ? sunsetIcon : sunriseIcon} aria-hidden="true" />
              <span>{sunStr}</span>
            </div>
          ) : null}
        </div>
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
