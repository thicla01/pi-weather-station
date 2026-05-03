import React, { useEffect, useState, useContext } from "react";
import { AppContext } from "~/AppContext";
import { useTranslation } from "react-i18next";
import styles from "./styles.css";
import SunRiseSet from "~/components/SunRiseSet";

const I18N_LOCALE = { en: "en-US", fr: "fr-FR", es: "es-ES" };

/**
 * Displays time and date — at the marker's local timezone when known
 * (mapTimezone resolved from mapGeo via tz-lookup in AppContext), or
 * the host timezone as a fallback. So a kiosk in Quebec showing a
 * marker on Shanwei reads "21:00 HKT" instead of "09:00 EDT", which
 * matches the AI summary's reasoning ("ce soir entre 18h et 21h" =
 * Shanwei evening, not Quebec evening) and the auto dark/light mode
 * (which already follows the marker's sunrise/sunset).
 *
 * @returns {JSX.Element} Clock component
 */
const Clock = () => {
  const { clockTime, mapTimezone } = useContext(AppContext);
  const { i18n } = useTranslation();
  const locale = I18N_LOCALE[i18n.language.startsWith("fr") ? "fr" : i18n.language.startsWith("es") ? "es" : "en"];
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(tick);
  }, []);

  // Date line — long form ("samedi 3 mai 2026" / "Saturday May 3, 2026"),
  // localised, in the marker's timezone.
  const dateStr = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: mapTimezone, // undefined → host TZ
  }).format(now).toUpperCase();

  // Time line — split hours+minutes from the AM/PM marker so we can size
  // the AM/PM smaller via .amPm, like the previous date-fns formatter did.
  const hour12 = clockTime === "12";
  const timeFormatter = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    hour12,
    timeZone: mapTimezone,
  });
  // Intl returns parts so we can safely separate the literal "AM"/"PM"
  // from the digits without locale-specific string surgery.
  const parts = timeFormatter.formatToParts(now);
  const hhmm = parts
    .filter((p) => ["hour", "minute", "literal"].includes(p.type))
    .map((p) => p.value)
    .join("")
    .trim()
    // 24h locales sometimes append a trailing space + " h" in French
    // ("21 h 03"); strip the trailing " h" so "HH:mm" stays compact.
    .replace(/\s+h\s*$/i, "");
  const dayPeriod = parts.find((p) => p.type === "dayPeriod")?.value || "";

  return (
    <div>
      <div className={styles.date}>{dateStr}</div>
      <div className={styles.time}>
        {hour12 ? (
          <>
            {hhmm}
            <span className={styles.amPm}>{dayPeriod}</span>
          </>
        ) : (
          hhmm
        )}
      </div>
      <div className={styles.sunRiseSetContainer}>
        <SunRiseSet/>
      </div>
    </div>
  );
};

export default Clock;
