import React, { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { InlineIcon } from "@iconify/react";
import bxsSun from "@iconify/icons-bx/bxs-sun";
import bxsMoon from "@iconify/icons-bx/bxs-moon";
import { AppContext } from "~/AppContext";
import styles from "./styles.css";

const I18N_LOCALE = { en: "en-US", fr: "fr-FR", es: "es-ES" };

/**
 * Direction C time slab — date, current time, and sunrise/sunset row.
 *
 * The data flow mirrors the v2 `Clock` and `SunRiseSet` components
 * exactly (timezone follows the marker via `mapTimezone`, 12/24 h
 * via `clockTime`, locale via i18n). The visual treatment is
 * Direction-C-native: large Geist Mono time in `--c-text`, dim date
 * caption above, sunrise/sunset chips inline below.
 *
 * Clock ticks via a 1 s `setInterval`. The interval is cleared on
 * unmount — important for the experimental flag toggle, which
 * unmounts the entire AmbientLayers subtree.
 *
 * @returns {JSX.Element} time slab
 */
const TimeBlock = () => {
  const { clockTime, mapTimezone, sunriseTime, sunsetTime } = useContext(AppContext);
  const { i18n } = useTranslation();
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

  // Sunrise/sunset formatted in the marker's local timezone (same
  // timezone Clock uses) so the kiosk reads sunrise consistently with
  // the AI summary's "ce soir entre 18h et 21h" wording.
  const sunFormatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12,
    timeZone: mapTimezone,
  });
  const hasSun = sunriseTime && sunsetTime;

  return (
    <div className={styles.slab}>
      <div className={styles.date}>{dateStr}</div>
      <div className={styles.time}>
        {hhmm}
        {hour12 && dayPeriod ? <span className={styles.amPm}>{dayPeriod}</span> : null}
      </div>
      {hasSun ? (
        <div className={styles.sunRow}>
          <span className={styles.sunChip}>
            <InlineIcon icon={bxsSun} />
            {sunFormatter.format(new Date(sunriseTime))}
          </span>
          <span className={styles.sunChip}>
            <InlineIcon icon={bxsMoon} />
            {sunFormatter.format(new Date(sunsetTime))}
          </span>
        </div>
      ) : null}
    </div>
  );
};

export default TimeBlock;
