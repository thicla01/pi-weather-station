import React, { useContext } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import DetailsPopover from "~/components/ambient/DetailsPopover";
import MoonGlyph from "~/components/ambient/MoonGlyph";
import { AppContext } from "~/AppContext";
import { moonPhase, nextFullMoon, nextNewMoon } from "~/ui/astronomy";
import styles from "./styles.css";

const I18N_LOCALE = { en: "en-US", fr: "fr-FR", es: "es-ES" };

/**
 * Tap-for-details popover for the moon-phase chip — shared between
 * TimeBlock (Pi / mobile clock slab) and HeroBand (desktop hero
 * band).
 *
 * Content:
 *   1. Phase name + illuminated fraction (translated, with the glyph)
 *   2. Moonrise / moonset for today, from Tomorrow.io's daily payload
 *      (`moonriseTime` / `moonsetTime`). Formatted in the marker's
 *      local timezone so the values line up with the sunrise/sunset
 *      chips next door.
 *   3. Next full moon and next new moon dates, computed locally from
 *      the synodic-month model — no API call, accurate to ~1 h.
 *
 * Falls back gracefully when Tomorrow.io hasn't returned daily data
 * yet (or returned `null` for moonrise/moonset on a polar day): just
 * shows an em-dash in those rows. The next-phase rows are always
 * present since they're purely time-driven.
 *
 * @param {object} props
 * @param {boolean} props.open Whether the popover is displayed;
 *   forwarded verbatim to `DetailsPopover`.
 * @param {() => void} props.onClose Invoked with no arguments when the
 *   user dismisses the popover (outside pointerdown, Esc, close
 *   button). The parent owns `open` and must set it false here.
 * @param {Date} props.now Reference instant. Selects today's 1-day
 *   interval from the Tomorrow.io daily timeline (latest interval whose
 *   `startTime` is ≤ `now`) and seeds the phase / next-full / next-new
 *   computations in `~/ui/astronomy`.
 * @param {object} [props.triggerRef] React ref to the moon chip that
 *   opens this popover. Used by `DetailsPopover` to position the
 *   portaled box and to exclude the chip from outside-click dismissal.
 * @param {"left"|"right"} [props.anchor] Edge of the trigger the
 *   popover aligns to; `"right"` (default) makes it extend leftward.
 * @returns {JSX.Element} The portaled `DetailsPopover` shell holding the
 *   phase row (glyph + translated name + illumination as a whole
 *   percentage), moonrise / moonset formatted in `mapTimezone` (em-dash
 *   when Tomorrow.io has no daily data or returned `null`), and the
 *   next full / new moon dates. Always an element — the shell itself
 *   renders `null` while `open` is false.
 */
const MoonDetailsPopover = ({ open, onClose, now, triggerRef = null, anchor = "right" }) => {
  const { dailyWeatherData, mapTimezone, clockTime } = useContext(AppContext);
  const { i18n, t } = useTranslation();
  const localeKey = i18n.language.startsWith("fr")
    ? "fr"
    : i18n.language.startsWith("es")
      ? "es"
      : "en";
  const locale = I18N_LOCALE[localeKey];
  const hour12 = clockTime === "12";

  const moon = moonPhase(now);

  // Pull today's moonrise / moonset from the daily timeline. The
  // intervals are 1-day buckets keyed by `startTime`; the bucket
  // covering `now` is whichever interval's startTime is the latest
  // that's still ≤ now. Tomorrow.io's `moonriseTime` / `moonsetTime`
  // are ISO strings or `null` (polar regions / edge-of-month transitions).
  const intervals = dailyWeatherData?.data?.timelines?.[0]?.intervals || [];
  const todayInterval = [...intervals]
    .reverse()
    .find((iv) => new Date(iv.startTime).getTime() <= now.getTime()) || intervals[0];
  const moonriseTime = todayInterval?.values?.moonriseTime || null;
  const moonsetTime = todayInterval?.values?.moonsetTime || null;

  const timeFormatter = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    hour12,
    timeZone: mapTimezone,
  });
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: mapTimezone,
  });

  const fmtTime = (iso) => (iso ? timeFormatter.format(new Date(iso)) : "—");
  const fmtDate = (date) => dateFormatter.format(date);

  const nextFull = nextFullMoon(now);
  const nextNew = nextNewMoon(now);

  return (
    <DetailsPopover
      open={open}
      onClose={onClose}
      title={t("astronomy.moonDetails")}
      anchor={anchor}
      triggerRef={triggerRef}
      portal
    >
      <div className={styles.detailRow}>
        <span className={styles.detailLabel}>{t("astronomy.phase")}</span>
        <span className={styles.detailValue}>
          <span className={styles.glyph}>
            {/* `size="1em"` — see HeroBand for the compound-em rationale. */}
            <MoonGlyph fraction={moon.fraction} size="1em" />
          </span>
          {t(`astronomy.moonPhase.${moon.i18nKey}`)} — {Math.round(moon.illumination * 100)}%
        </span>
      </div>
      <div className={styles.detailRow}>
        <span className={styles.detailLabel}>{t("astronomy.moonrise")}</span>
        <span className={styles.detailValue}>{fmtTime(moonriseTime)}</span>
      </div>
      <div className={styles.detailRow}>
        <span className={styles.detailLabel}>{t("astronomy.moonset")}</span>
        <span className={styles.detailValue}>{fmtTime(moonsetTime)}</span>
      </div>
      <div className={styles.detailRow}>
        <span className={styles.detailLabel}>{t("astronomy.nextFullMoon")}</span>
        <span className={styles.detailValue}>{fmtDate(nextFull)}</span>
      </div>
      <div className={styles.detailRow}>
        <span className={styles.detailLabel}>{t("astronomy.nextNewMoon")}</span>
        <span className={styles.detailValue}>{fmtDate(nextNew)}</span>
      </div>
    </DetailsPopover>
  );
};

MoonDetailsPopover.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  now: PropTypes.instanceOf(Date).isRequired,
  triggerRef: PropTypes.object,
  anchor: PropTypes.oneOf(["left", "right"]),
};

export default MoonDetailsPopover;
