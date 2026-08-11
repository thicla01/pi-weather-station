import React, { useContext } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import DetailsPopover from "~/components/ambient/DetailsPopover";
import { AppContext } from "~/AppContext";
import styles from "./styles.css";

const I18N_LOCALE = { en: "en-US", fr: "fr-FR", es: "es-ES" };

/**
 * Format a day length expressed in seconds as a localised "Xh Ymin"
 * string. The upstream sunrise-sunset.org API returns `day_length` as
 * an integer second count (with `formatted=0`).
 *
 * Polar edge case: when the sun never rises (or never sets) at high
 * latitudes, the upstream value is 0 (or 86400). We render those as
 * "—" rather than "0h 0min" / "24h 0min" because the popover already
 * shows em-dashes in the time rows for those days, and a non-zero
 * length next to em-dash times is misleading.
 *
 * @param {Number|null|undefined} secs day_length in seconds
 * @returns {String} localised "Xh YYmin" or em-dash on missing/extreme values
 */
const formatDayLength = (secs) => {
  if (typeof secs !== "number" || secs <= 0 || secs >= 86400) return "—";
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  return `${h} h ${String(m).padStart(2, "0")} min`;
};

/**
 * Tap-for-details popover for the sunrise / sunset chips — shared
 * between TimeBlock (Pi / mobile clock slab) and HeroBand (desktop
 * hero band).
 *
 * Content:
 *   1. "Today" section
 *      - First light (civil twilight begin)
 *      - Last light (civil twilight end)
 *      - Day length
 *      Sunrise / sunset themselves are intentionally omitted — the
 *      chips that opened the popover already display them, repeating
 *      would be visual noise. (Per maintainer's call.)
 *   2. "Tomorrow" section
 *      - First light
 *      - Sunrise
 *      - Sunset
 *      - Last light
 *      - Day length
 *
 * Data source: `sunriseSunsetToday` / `sunriseSunsetTomorrow` in
 * AppContext, populated by `updateSunriseSunset()` which calls
 * `/api/sunrise-sunset?...&tomorrow=1`. The endpoint proxies
 * sunrise-sunset.org (NOT Tomorrow.io) — same source as the chips
 * themselves, so the popover values are guaranteed consistent with
 * what the user sees on the kiosk surface.
 *
 * Falls back to em-dashes on any null field — the upstream API can
 * legitimately return null in polar regions (sun never rises / sets)
 * or when the tomorrow upstream call failed (degraded gracefully
 * server-side; see `proxyCtrl.sunriseSunset`).
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {Function} props.onClose
 * @param {object} [props.triggerRef] anchor for outside-click exclusion
 * @param {"left"|"right"} [props.anchor]
 * @returns {JSX.Element} popover anchored to the sun chip
 */
const SunDetailsPopover = ({ open, onClose, triggerRef = null, anchor = "right" }) => {
  const { sunriseSunsetToday, sunriseSunsetTomorrow, mapTimezone, clockTime } = useContext(AppContext);
  const { i18n, t } = useTranslation();
  const localeKey = i18n.language.startsWith("fr")
    ? "fr"
    : i18n.language.startsWith("es")
      ? "es"
      : "en";
  const locale = I18N_LOCALE[localeKey];
  const hour12 = clockTime === "12";

  const timeFormatter = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    hour12,
    timeZone: mapTimezone,
  });
  const fmtTime = (iso) => (iso ? timeFormatter.format(new Date(iso)) : "—");

  const today = sunriseSunsetToday || {};
  const tomorrow = sunriseSunsetTomorrow || {};

  return (
    <DetailsPopover
      open={open}
      onClose={onClose}
      title={t("astronomy.sunDetails")}
      anchor={anchor}
      triggerRef={triggerRef}
      portal
    >
      <div className={styles.sectionHead}>{t("astronomy.today")}</div>
      <div className={styles.detailRow}>
        <span className={styles.detailLabel}>{t("astronomy.firstLight")}</span>
        <span className={styles.detailValue}>{fmtTime(today.civil_twilight_begin)}</span>
      </div>
      <div className={styles.detailRow}>
        <span className={styles.detailLabel}>{t("astronomy.lastLight")}</span>
        <span className={styles.detailValue}>{fmtTime(today.civil_twilight_end)}</span>
      </div>
      <div className={styles.detailRow}>
        <span className={styles.detailLabel}>{t("astronomy.dayLength")}</span>
        <span className={styles.detailValue}>{formatDayLength(today.day_length)}</span>
      </div>

      <div className={styles.sectionHead}>{t("astronomy.tomorrow")}</div>
      <div className={styles.detailRow}>
        <span className={styles.detailLabel}>{t("astronomy.firstLight")}</span>
        <span className={styles.detailValue}>{fmtTime(tomorrow.civil_twilight_begin)}</span>
      </div>
      <div className={styles.detailRow}>
        <span className={styles.detailLabel}>{t("astronomy.sunrise")}</span>
        <span className={styles.detailValue}>{fmtTime(tomorrow.sunrise)}</span>
      </div>
      <div className={styles.detailRow}>
        <span className={styles.detailLabel}>{t("astronomy.sunset")}</span>
        <span className={styles.detailValue}>{fmtTime(tomorrow.sunset)}</span>
      </div>
      <div className={styles.detailRow}>
        <span className={styles.detailLabel}>{t("astronomy.lastLight")}</span>
        <span className={styles.detailValue}>{fmtTime(tomorrow.civil_twilight_end)}</span>
      </div>
      <div className={styles.detailRow}>
        <span className={styles.detailLabel}>{t("astronomy.dayLength")}</span>
        <span className={styles.detailValue}>{formatDayLength(tomorrow.day_length)}</span>
      </div>
    </DetailsPopover>
  );
};

SunDetailsPopover.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  triggerRef: PropTypes.object,
  anchor: PropTypes.oneOf(["left", "right"]),
};

export default SunDetailsPopover;
