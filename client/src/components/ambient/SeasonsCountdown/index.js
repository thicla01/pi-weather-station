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
 * Seasonal countdown — the in-window « Solstice dans 8 j » line, now a
 * tap target that opens a "Saisons" popover listing the next four
 * solstices/equinoxes with their dates and day-counts (v3.1 Phase 2
 * follow-up).
 *
 * Renders nothing outside the 14-day window before an event (same gate
 * as before — `upcomingSolarEvent` returns null), so the surface stays
 * calm the rest of the year and the popover is reachable exactly when
 * a seasonal turn is near, which is when the question gets asked.
 *
 * Two placements share one component so the solar logic + popover live
 * in a single place:
 *   - `inline` (desktop HeroBand) — rides after the date behind the
 *     clock-panel hairline, led by a `·` separator.
 *   - `block`  (Pi/mobile TimeBlock) — its own line under the time.
 *
 * The trigger carries the house tap affordance (dotted underline,
 * `:active` pressed state, ≥44 px hit area via an invisible
 * pseudo-element); zero hover, per the kiosk rule.
 *
 * @param {object} props
 * @param {Date} props.now — current time (the parent's minute/second
 *   tick) driving the countdown + the listed day-counts
 * @param {"inline"|"block"} [props.variant] — placement style
 * @returns {JSX.Element|null} the countdown trigger + popover, or null
 *   when no event is within the window
 */
const SeasonsCountdown = ({ now, variant }) => {
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

  const upcoming = upcomingSolarEvent(now);
  if (!upcoming) return null;

  const label = t("astronomy.solarEventIn", {
    event: t(`astronomy.solarEventShort.${solarEventType(upcoming.event)}`),
    count: upcoming.daysAway,
  });

  // Only build the list when the popover is open — the parent ticks
  // every second (TimeBlock), and the 8-candidate sort is wasted work
  // while the popover is closed.
  const events = open ? nextSolarEvents(now, EVENT_COUNT) : [];

  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      className={styles.trigger}
      aria-label={t("astronomy.seasonsTitle")}
      aria-expanded={open}
      onClick={() => setOpen((v) => !v)}
    >
      {label}
    </button>
  );

  const popover = (
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
            <span className={styles.name}>{t(`astronomy.solarEvent.${ev.event}`)}</span>
            <span className={styles.date}>{dateFormatter.format(ev.date)}</span>
            <span className={styles.days}>
              {t("astronomy.solarEventDays", { count: ev.daysAway })}
            </span>
          </div>
        ))}
      </div>
    </DetailsPopover>
  );

  // Inline: a leading separator + the trigger, so the whole unit
  // disappears cleanly (no orphan « · ») when out of window. Block:
  // its own line.
  if (variant === "inline") {
    return (
      <>
        <span className={styles.sep} aria-hidden="true"> · </span>
        {trigger}
        {popover}
      </>
    );
  }
  return (
    <div className={styles.block}>
      {trigger}
      {popover}
    </div>
  );
};

SeasonsCountdown.propTypes = {
  // eslint-disable-next-line react/forbid-prop-types -- Date instance, opaque shape
  now: PropTypes.object.isRequired,
  variant: PropTypes.oneOf(["inline", "block"]),
};

SeasonsCountdown.defaultProps = {
  variant: "inline",
};

export default SeasonsCountdown;
