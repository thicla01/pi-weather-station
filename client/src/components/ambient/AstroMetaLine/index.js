import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { InlineIcon } from "@iconify/react";
import bxsSun from "@iconify/icons-bx/bxs-sun";
import arrowRight from "@iconify/icons-carbon/arrow-right";
import { WeatherDataContext, UiPrefsContext, LocationContext } from "~/AppContext";
import { moonPhase } from "~/ui/astronomy";
import MoonGlyph from "~/components/ambient/MoonGlyph";
import MoonDetailsPopover from "~/components/ambient/MoonDetailsPopover";
import SunDetailsPopover from "~/components/ambient/SunDetailsPopover";
import styles from "./styles.css";

// The line only displays hh:mm and a slow-moving phase name — one
// re-render per minute is plenty (same cadence HeroBand settled on).
const TICK_MS = 60 * 1000;

/**
 * Hero meta-line — the single sun/moon home (v3.1 Phase 2, B1·a).
 *
 * Bottom tier of the hero pyramid: `☼ 05:08 → 20:42 · ◐ Gibbeuse
 * croissante · 59%`. Replaces the astro chip rows that used to live
 * in the HeroBand clock panel (desktop) and the TimeBlock
 * (Pi / mobile) — one popover, one trigger per screen. Both triggers
 * carry the dotted-underline affordance with `:active` pressed
 * feedback (zero hover — kiosk rule) and a pseudo-element hit
 * extension so the tap target clears 44 px despite the micro type.
 *
 * The sun trigger opens the existing `SunDetailsPopover`, the moon
 * trigger the existing `MoonDetailsPopover` — content unchanged
 * (the inline phase name itself is the F4 fix). Mutual exclusivity
 * mirrors the old chip rows: opening one closes the other.
 *
 * @param {object} props
 * @param {boolean} [props.shortPhaseName] — render the phase's short
 *   family name (`Gibbeuse`) instead of the full one (`Gibbeuse
 *   croissante`). Used by LayoutPi where the 7" rail is too narrow
 *   for the full string (B4.7 ruling: family-name truncation, never
 *   a mid-word ellipsis).
 * @returns {JSX.Element} the meta-line
 */
const AstroMetaLine = ({ shortPhaseName }) => {
  const { sunriseTime, sunsetTime } = useContext(WeatherDataContext);
  const { clockTime } = useContext(UiPrefsContext);
  const { mapTimezone } = useContext(LocationContext);
  const { t } = useTranslation();

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(tick);
  }, []);

  const hour12 = clockTime === "12";
  // Same fixed-locale formatter the old TimeBlock / HeroBand chip rows
  // used, so the displayed times don't change with the migration.
  const sunFormatter = useMemo(
    () => new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12,
      timeZone: mapTimezone,
    }),
    [hour12, mapTimezone]
  );
  const hasSun = sunriseTime && sunsetTime;

  const moon = moonPhase(now);
  const phaseName = t(
    shortPhaseName
      ? `astronomy.moonPhaseShort.${moon.i18nKey}`
      : `astronomy.moonPhase.${moon.i18nKey}`
  );

  // One open popover at a time — same mutual exclusivity as the chip
  // rows this line replaces.
  const sunRef = useRef(null);
  const moonRef = useRef(null);
  const [sunOpen, setSunOpen] = useState(false);
  const [moonOpen, setMoonOpen] = useState(false);
  const toggleSun = () => { setMoonOpen(false); setSunOpen((v) => !v); };
  const toggleMoon = () => { setSunOpen(false); setMoonOpen((v) => !v); };

  return (
    <div className={styles.metaLine}>
      {hasSun ? (
        <>
          <button
            ref={sunRef}
            type="button"
            className={styles.tap}
            title={t("astronomy.sunDetails")}
            aria-label={t("astronomy.sunDetails")}
            aria-expanded={sunOpen}
            onClick={toggleSun}
          >
            <InlineIcon icon={bxsSun} className={styles.sunIcon} />
            {sunFormatter.format(new Date(sunriseTime))}
            <InlineIcon icon={arrowRight} className={styles.arrow} aria-hidden="true" />
            {sunFormatter.format(new Date(sunsetTime))}
          </button>
          <SunDetailsPopover
            open={sunOpen}
            onClose={() => setSunOpen(false)}
            triggerRef={sunRef}
            anchor="left"
          />
          <span className={styles.sep} aria-hidden="true">·</span>
        </>
      ) : null}
      <button
        ref={moonRef}
        type="button"
        className={styles.tap}
        title={t(`astronomy.moonPhase.${moon.i18nKey}`)}
        aria-label={t(`astronomy.moonPhase.${moon.i18nKey}`)}
        aria-expanded={moonOpen}
        onClick={toggleMoon}
      >
        <span className={styles.moonGlyph}>
          <MoonGlyph fraction={moon.fraction} size="1em" />
        </span>
        {phaseName} · {Math.round(moon.illumination * 100)}%
        <MoonDetailsPopover
          open={moonOpen}
          onClose={() => setMoonOpen(false)}
          now={now}
          triggerRef={moonRef}
          anchor="left"
        />
      </button>
    </div>
  );
};

AstroMetaLine.propTypes = {
  shortPhaseName: PropTypes.bool,
};

AstroMetaLine.defaultProps = {
  shortPhaseName: false,
};

export default AstroMetaLine;
