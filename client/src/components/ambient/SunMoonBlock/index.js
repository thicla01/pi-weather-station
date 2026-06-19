import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { InlineIcon } from "@iconify/react";
import bxsSun from "@iconify/icons-bx/bxs-sun";
import sunriseIcon from "@iconify/icons-wi/sunrise";
import sunsetIcon from "@iconify/icons-wi/sunset";
import timeIcon from "@iconify/icons-carbon/time";
import arrowUp from "@iconify/icons-carbon/arrow-up";
import arrowDown from "@iconify/icons-carbon/arrow-down";
import { WeatherDataContext, UiPrefsContext, LocationContext } from "~/AppContext";
import { moonPhase } from "~/ui/astronomy";
import MoonGlyph from "~/components/ambient/MoonGlyph";
import SunDetailsPopover from "~/components/ambient/SunDetailsPopover";
import MoonDetailsPopover from "~/components/ambient/MoonDetailsPopover";
import styles from "./styles.css";

const I18N_LOCALE = { en: "en-US", fr: "fr-FR", es: "es-ES" };
// The phase name + rise/set times move slowly — one re-render per minute is
// plenty (same cadence AstroMetaLine settled on).
const TICK_MS = 60 * 1000;

/**
 * v3.3 Conditions view — Soleil / Lune section. Two columns: the sun's rise /
 * set / day length, and the moon's phase / illumination / rise / set. The
 * essentials show inline; each column's header (`Soleil` / `Lune`, dotted
 * underline) opens the SAME `SunDetailsPopover` / `MoonDetailsPopover` the
 * desktop hero uses — first/last light, tomorrow, next full/new moon. This
 * also restores sun/moon detail on the 7" kiosk, where the hero's
 * `AstroMetaLine` (and so those popovers) is hidden in the glance.
 *
 * @returns {JSX.Element} the sun/moon section
 */
const SunMoonBlock = () => {
  const { sunriseTime, sunsetTime, dailyWeatherData } = useContext(WeatherDataContext);
  const { clockTime } = useContext(UiPrefsContext);
  const { mapTimezone } = useContext(LocationContext);
  const { i18n, t } = useTranslation();

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(tick);
  }, []);

  const localeKey = i18n.language.startsWith("fr")
    ? "fr"
    : i18n.language.startsWith("es")
      ? "es"
      : "en";
  const locale = I18N_LOCALE[localeKey];
  const hour12 = clockTime === "12";
  const timeFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, {
      hour: "numeric",
      minute: "2-digit",
      hour12,
      timeZone: mapTimezone,
    }),
    [locale, hour12, mapTimezone]
  );
  const fmt = (iso) => (iso ? timeFmt.format(new Date(iso)) : "—");

  const hasSun = sunriseTime && sunsetTime;
  // Day length = sunset − sunrise (both today's, from the same feed), so it's
  // correct regardless of the current time. Formatted "15 h 40 min" to mirror
  // SunDetailsPopover.
  let dayLength = "—";
  if (hasSun) {
    const totalMin = Math.max(0, Math.round((new Date(sunsetTime) - new Date(sunriseTime)) / 60000));
    dayLength = `${Math.floor(totalMin / 60)} h ${String(totalMin % 60).padStart(2, "0")} min`;
  }

  const moon = moonPhase(now);
  const moonName = t(`astronomy.moonPhaseShort.${moon.i18nKey}`);

  // Today's moonrise / moonset from the daily timeline (mirrors
  // MoonDetailsPopover): the bucket whose startTime is the latest still ≤ now.
  // Tomorrow.io returns ISO strings or null (polar / month-edge).
  const intervals = dailyWeatherData?.data?.timelines?.[0]?.intervals || [];
  const todayInterval = [...intervals]
    .reverse()
    .find((iv) => new Date(iv.startTime).getTime() <= now.getTime()) || intervals[0];
  const moonriseTime = todayInterval?.values?.moonriseTime || null;
  const moonsetTime = todayInterval?.values?.moonsetTime || null;

  // One popover open at a time (mirrors AstroMetaLine's mutual exclusivity).
  const sunRef = useRef(null);
  const moonRef = useRef(null);
  const [sunOpen, setSunOpen] = useState(false);
  const [moonOpen, setMoonOpen] = useState(false);
  const toggleSun = () => { setMoonOpen(false); setSunOpen((v) => !v); };
  const toggleMoon = () => { setSunOpen(false); setMoonOpen((v) => !v); };

  return (
    <div className={styles.grid}>
      <div className={styles.card}>
        <button
          ref={sunRef}
          type="button"
          className={styles.head}
          onClick={toggleSun}
          aria-expanded={sunOpen}
          aria-label={t("astronomy.sunDetails")}
        >
          <InlineIcon icon={bxsSun} className={styles.headIcon} aria-hidden="true" />
          <span className={styles.headLabel}>{t("astronomy.sunDetails")}</span>
        </button>
        <SunDetailsPopover open={sunOpen} onClose={() => setSunOpen(false)} triggerRef={sunRef} anchor="left" />
        <div className={styles.row}>
          <span className={styles.rowLabel}><InlineIcon icon={sunriseIcon} className={styles.rowIcon} aria-hidden="true" />{t("astronomy.sunrise")}</span>
          <span className={styles.rowVal}>{fmt(sunriseTime)}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.rowLabel}><InlineIcon icon={sunsetIcon} className={styles.rowIcon} aria-hidden="true" />{t("astronomy.sunset")}</span>
          <span className={styles.rowVal}>{fmt(sunsetTime)}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.rowLabel}><InlineIcon icon={timeIcon} className={styles.rowIcon} aria-hidden="true" />{t("astronomy.dayLength")}</span>
          <span className={styles.rowVal}>{dayLength}</span>
        </div>
      </div>

      <div className={styles.card}>
        <button
          ref={moonRef}
          type="button"
          className={styles.head}
          onClick={toggleMoon}
          aria-expanded={moonOpen}
          aria-label={t("astronomy.moonDetails")}
        >
          <span className={styles.headGlyph}><MoonGlyph fraction={moon.fraction} size="1em" /></span>
          <span className={styles.headLabel}>{t("astronomy.moonDetails")}</span>
        </button>
        <MoonDetailsPopover open={moonOpen} onClose={() => setMoonOpen(false)} now={now} triggerRef={moonRef} anchor="left" />
        <div className={styles.row}>
          <span className={styles.rowLabel}>{t("astronomy.phase")}</span>
          <span className={styles.rowVal}>{moonName} · {Math.round(moon.illumination * 100)}%</span>
        </div>
        <div className={styles.row}>
          <span className={styles.rowLabel}><InlineIcon icon={arrowUp} className={styles.rowIcon} aria-hidden="true" />{t("astronomy.sunrise")}</span>
          <span className={styles.rowVal}>{fmt(moonriseTime)}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.rowLabel}><InlineIcon icon={arrowDown} className={styles.rowIcon} aria-hidden="true" />{t("astronomy.sunset")}</span>
          <span className={styles.rowVal}>{fmt(moonsetTime)}</span>
        </div>
      </div>
    </div>
  );
};

export default SunMoonBlock;
