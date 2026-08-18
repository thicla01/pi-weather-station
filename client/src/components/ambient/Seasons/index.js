import React, { useContext, useMemo, useRef, useState } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { LocationContext } from "~/AppContext";
import { upcomingSolarEvent, nextSolarEvents, solarEventType } from "~/ui/astronomy";
import DetailsPopover from "~/components/ambient/DetailsPopover";
import styles from "./styles.css";

const I18N_LOCALE = { en: "en-US", fr: "fr-FR", es: "es-ES" };

// How many upcoming events the popover lists (one full seasonal cycle).
const EVENT_COUNT = 4;

/**
 * The in-window enriching countdown label (« Solstice dans 8 j ») or
 * null outside the 14-day window. This is plain text rendered next to
 * the date by the parent — NOT the popover trigger (the date is). Copy
 * is tightened to the generic event type (only one event is possible
 * in-window, so the month is redundant).
 *
 * @param {Date} now — current time (the parent's tick)
 * @param {(key: string, opts?: object) => string} t — i18next translate
 *   fn from the caller
 * @returns {string|null} the countdown label, or null out of window
 */
export function seasonCountdownLabel(now, t) {
  const upcoming = upcomingSolarEvent(now);
  if (!upcoming) return null;
  return t("astronomy.solarEventIn", {
    event: t(`astronomy.solarEventShort.${solarEventType(upcoming.event)}`),
    count: upcoming.daysAway,
  });
}

/**
 * Seasons trigger — wraps the clock's date in a tap target that opens
 * a "Saisons" popover listing the next four solstices/equinoxes (full
 * name + date + day-count). v3.1 Phase 2 follow-up.
 *
 * The trigger is the **date** (always on screen) rather than the
 * in-window countdown, so the list is reachable year-round — the
 * maintainer's "useful at all times" ask. The countdown stays as
 * enriching text beside the date (see `seasonCountdownLabel`); on
 * desktop it rides inside this trigger (same line), on Pi/mobile it's
 * a separate line below the clock.
 *
 * Carries the house tap affordance (dotted underline, `:active`
 * pressed state, ≥44 px hit area via an invisible pseudo-element);
 * zero hover, per the kiosk rule. The popover reuses `DetailsPopover`
 * (portal-anchored, palette-aware) — same shape as the sun/moon
 * popovers.
 *
 * @param {object} props
 * @param {Date} props.now — current time, driving the listed day-counts
 * @param {React.ReactNode} props.children — the trigger's visible
 *   content (the date, plus the inline countdown on desktop)
 * @returns {JSX.Element} the date trigger + its popover
 */
const SeasonsTrigger = ({ now, children }) => {
  const { t, i18n } = useTranslation();
  const { mapTimezone } = useContext(LocationContext);
  const localeKey = i18n.language.startsWith("fr")
    ? "fr"
    : i18n.language.startsWith("es")
      ? "es"
      : "en";
  const locale = I18N_LOCALE[localeKey];

  const triggerRef = useRef(null);
  const [open, setOpen] = useState(false);

  // Date formatter for the popover rows ("20 juin" / "Jun 20"),
  // memoized like the other date formatters in the band.
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      timeZone: mapTimezone,
    }),
    [locale, mapTimezone]
  );

  // Only build the list when the popover is open — the parent ticks
  // every second (TimeBlock), and the 8-candidate sort is wasted work
  // while the popover is closed.
  const events = open ? nextSolarEvents(now, EVENT_COUNT) : [];

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-label={t("astronomy.seasonsTitle")}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {children}
      </button>
      <DetailsPopover
        open={open}
        onClose={() => setOpen(false)}
        title={t("astronomy.seasonsTitle")}
        triggerRef={triggerRef}
        anchor="left"
        portal
      >
        <div className={styles.list}>
          {events.map((ev) => (
            <div key={ev.event} className={styles.row}>
              <span className={styles.evName}>{t(`astronomy.solarEvent.${ev.event}`)}</span>
              <span className={styles.evDate}>{dateFormatter.format(ev.date)}</span>
              <span className={styles.evDays}>
                {t("astronomy.solarEventDays", { count: ev.daysAway })}
              </span>
            </div>
          ))}
        </div>
      </DetailsPopover>
    </>
  );
};

SeasonsTrigger.propTypes = {
  now: PropTypes.object.isRequired,
  children: PropTypes.node.isRequired,
};

export default SeasonsTrigger;
