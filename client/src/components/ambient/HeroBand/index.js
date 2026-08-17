import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { InlineIcon } from "@iconify/react";
import { WeatherDataContext, UiPrefsContext, LocationContext } from "~/AppContext";
import { convertTemp } from "~/services/conversions";
import { parseWeatherCode, isDaylight } from "~/ui/weatherCodes";
import AstroMetaLine from "~/components/ambient/AstroMetaLine";
import FeelsLikeLine from "~/components/ambient/FeelsLikeLine";
import SeasonsTrigger, { seasonCountdownLabel } from "~/components/ambient/Seasons";
import LocationDetailsPopover from "~/components/ambient/LocationDetailsPopover";
import LocationName from "~/components/LocationName";
import styles from "./styles.css";

const I18N_LOCALE = { en: "en-US", fr: "fr-FR", es: "es-ES" };

/**
 * Direction C desktop hero band — v3.1 Phase 2 composition: a flex
 * band of two cards floating over the full-bleed map.
 *
 *   ┌───────────────────────────────┬──────────────┐
 *   │ hero card                     │ clock card   │
 *   │  · place micro-row (popover)  │  WEEKDAY     │  ← tier 1 (aligned)
 *   │  · 72px temp + condition +    │  time        │
 *   │    feels-like (+delta chip)   │  ─────────── │  ← shared hairline
 *   │  · sun/moon meta-line ──────  │  date · C2   │  ← tier 3 (aligned)
 *   └───────────────────────────────┴──────────────┘
 *
 * The hero card interior follows the P2 pyramid: micro place label
 * (tier 1), dominant temperature + condition + always-on feels-like
 * (tier 2), sun/moon meta-line (tier 3 — the ONLY sun/moon home on
 * screen, B1·a migration).
 *
 * The clock card mirrors the same three tiers (v3.1 Phase 2 C1, desktop
 * band only): weekday eyebrow / focal time / hairline + date — so tier 1
 * and the bottom hairline land on the same lines across the band, and it
 * reads as one system. Size and role are unchanged from B1 (no astro
 * chips — date + time only). During the 14-day window before a solstice
 * or equinox the C2 countdown joins the date behind the hairline
 * (« 11 juin · Solstice dans 9 j », dim, no accent). The Pi/mobile
 * TimeBlock keeps its compact stacked form (nothing to mirror).
 *
 * @returns {JSX.Element} hero band (two floating cards)
 */
const HeroBand = () => {
  const { currentWeatherData, sunriseTime, sunsetTime } = useContext(WeatherDataContext);
  const { tempUnit, clockTime } = useContext(UiPrefsContext);
  const { mapTimezone, reverseGeoResult } = useContext(LocationContext);
  const { t, i18n } = useTranslation();
  const localeKey = i18n.language.startsWith("fr")
    ? "fr"
    : i18n.language.startsWith("es")
      ? "es"
      : "en";
  const locale = I18N_LOCALE[localeKey];

  // Tick the clock once per minute, aligned on the minute boundary —
  // the display has no seconds, so the previous 1 Hz tick re-rendered
  // the whole hero band (and re-ran the astronomy + formatting work
  // below) 60× more often than anything on screen could change.
  //
  // Chained setTimeout, NOT setInterval: each tick re-computes the next
  // minute boundary, so the phase self-heals after background-tab timer
  // throttling (Chromium coalesces hidden-tab timers onto its own ~1/min
  // wake grid), a laptop sleep/wake, or an NTP clock step — a fixed-phase
  // interval would roll the displayed minute late, permanently, after any
  // of those. The visibilitychange resync covers the return-to-foreground
  // moment itself, when the pending (throttled) timeout may still be far
  // past its boundary. HeroBand is the desktop layout — exactly the
  // background-tab/laptop case; the kiosk is always visible.
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

  const values = currentWeatherData?.data?.timelines?.[0]?.intervals?.[0]?.values;
  const temperature = values?.temperature;
  const temperatureApparent = values?.temperatureApparent;
  const weatherCode = values?.weatherCode;
  const daylight = sunriseTime && sunsetTime
    ? isDaylight(sunriseTime, sunsetTime)
    : true;
  const parsed = parseWeatherCode(weatherCode, daylight);
  const tempUnitLabel = tempUnit === "k" ? "K" : `°${tempUnit.toUpperCase()}`;

  // Feels-like always-on (v2.15.16 ruling) — the delta-chip rendering
  // rule lives in the shared FeelsLikeLine.
  const tempConverted = temperature != null ? convertTemp(temperature, tempUnit) : null;
  const feelsConverted = temperatureApparent != null
    ? convertTemp(temperatureApparent, tempUnit)
    : null;
  const showFeelsLike = tempConverted != null && feelsConverted != null;

  const hour12 = clockTime === "12";
  // Intl.DateTimeFormat construction is the expensive half of date
  // formatting (locale data lookup) — memoized so each render only pays
  // for format(), not for rebuilding the formatters.
  // C1 splits the date across two clock-card tiers: the weekday is
  // the eyebrow (top), the day+month is the bottom hairline meta —
  // so two formatters instead of one full-date string.
  const weekdayFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, {
      weekday: "long",
      timeZone: mapTimezone,
    }),
    [locale, mapTimezone]
  );
  const dayMonthFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, {
      month: "long",
      day: "numeric",
      timeZone: mapTimezone,
    }),
    [locale, mapTimezone]
  );
  const timeFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, {
      hour: "numeric",
      minute: "2-digit",
      hour12,
      timeZone: mapTimezone,
    }),
    [locale, hour12, mapTimezone]
  );
  // Eyebrow is uppercased in CSS (text-transform); the day+month meta
  // stays sentence-case ("11 juin" / "June 11").
  const weekdayStr = weekdayFormatter.format(now);
  const dayMonthStr = dayMonthFormatter.format(now);
  const parts = timeFormatter.formatToParts(now);
  const hhmm = parts
    .filter((p) => ["hour", "minute", "literal"].includes(p.type))
    .map((p) => p.value)
    .join("")
    .trim()
    .replace(/\s+h\s*$/i, "");
  const dayPeriod = parts.find((p) => p.type === "dayPeriod")?.value || "";

  // In-window seasonal countdown text (« · Solstice dans 8 j ») that
  // rides inside the date trigger; null the rest of the year.
  const seasonLabel = seasonCountdownLabel(now, t);

  // Tap-for-details on the place row — surfaces the full LocationIQ
  // reverse-geocode payload (admin hierarchy, postcode, precise
  // coords) that `LocationName` necessarily truncates. Only wire up
  // the button when we actually have geocode data; otherwise the row
  // is just a placeholder and a tap would open an empty popover.
  const locationRef = useRef(null);
  const [locationOpen, setLocationOpen] = useState(false);
  const toggleLocation = () => setLocationOpen((v) => !v);
  const locationClickable = !!reverseGeoResult;

  return (
    <div className={styles.band}>
      <div className={styles.heroCard}>
        {/* Tier 1 — place micro-row */}
        <div className={styles.placeRow}>
          {locationClickable ? (
            <button
              ref={locationRef}
              type="button"
              className={styles.placeButton}
              onClick={toggleLocation}
              aria-expanded={locationOpen}
              aria-label={t("location.details")}
              title={t("location.details")}
            >
              <LocationName />
            </button>
          ) : (
            <LocationName />
          )}
          {/* Mounted only while open so its transient pin-failure state
            * drops on close instead of resurfacing on the next open —
            * same contract as PlacesPopover in ControlButtons. */}
          {locationOpen ? (
            <LocationDetailsPopover
              open
              onClose={() => setLocationOpen(false)}
              triggerRef={locationRef}
              anchor="left"
            />
          ) : null}
        </div>
        {/* Tier 2 — focal: dominant temp + condition + feels-like */}
        {temperature != null ? (
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
        ) : null}
        {/* Tier 3 — sun/moon meta-line (the only astro home, B1·a) */}
        <AstroMetaLine />
      </div>
      {/* Clock card — C1 mirrors the hero's three tiers so tier 1 and
        * the bottom hairline align across the band (eyebrow weekday /
        * focal time / hairline date). Desktop band only; the Pi/mobile
        * TimeBlock keeps its compact form. */}
      <div className={styles.clockCard}>
        <div className={styles.clockEyebrow}>{weekdayStr}</div>
        <div className={styles.clockTime}>
          {hhmm}
          {hour12 && dayPeriod ? <span className={styles.clockAmPm}>{dayPeriod}</span> : null}
        </div>
        {/* The date is the year-round trigger for the Saisons popover;
          * the in-window countdown rides inline after it as enriching
          * text (part of the same tap target). */}
        <div className={styles.clockDateMeta}>
          <SeasonsTrigger now={now}>
            {dayMonthStr}
            {seasonLabel ? (
              <span className={styles.clockCountdown}> · {seasonLabel}</span>
            ) : null}
          </SeasonsTrigger>
        </div>
      </div>
    </div>
  );
};

export default HeroBand;
