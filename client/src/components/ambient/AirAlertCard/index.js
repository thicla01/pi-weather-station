import React, { useContext, useRef, useState } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { InlineIcon } from "@iconify/react";
import windGusts from "@iconify/icons-carbon/wind-gusts";
import { WeatherDataContext } from "~/AppContext";
import { formatAge } from "~/ui/formatAge";
import SourceBadge from "~/components/ambient/SourceBadge";
import DetailsPopover from "~/components/ambient/DetailsPopover";
import styles from "./styles.css";

// Tier (from getAirAlertState) → strip/badge CSS class. Mirrors the
// AlertBanner tier-strip vocabulary so the AIR card and the gov card
// share the same orange/red severity language.
const TIER_CLASS = {
  orange: "tierOrange",
  red: "tierRed",
};

// AQ source key → the detail popover's source label. Same mapping the
// inline AirCard uses; falls back to the generic ECCC label.
const AQ_SOURCE_LABEL_KEY = {
  "MELCC-Mtl":   "badges.aqiSourceMelccMtl",
  "MELCC-RSQAQ": "badges.aqiSourceMelccRsqaq",
  "ECCC":        "badges.aqiSourceEccc",
  "AirNow":      "badges.aqiSourceAirNow",
  "OpenAQ":      "badges.aqiSourceOpenAq",
};

/**
 * Resolve the scale's short badge label (IQA / AQHI / AQI). Same
 * mapping the inline AirCard row uses — the scale doubles as the
 * SourceBadge text so the user sees which authority's index it is.
 *
 * @param {?string} scale — "iqa" | "aqhi" | "epa" | other
 * @param {Function} t — i18next translator (fallback label)
 * @returns {string} the badge text
 */
function scaleLabel(scale, t) {
  if (scale === "iqa") return "IQA";
  if (scale === "aqhi") return "AQHI";
  if (scale === "epa") return "AQI";
  return t("metrics.aqi");
}

/**
 * AIR — air-quality alert card (v3.2 "3 états radar", new banner-producing
 * source, tag `AIR`). When air quality reaches the health-risk band
 * (`getAirAlertState(category)` ≠ null — "high" → orange, "veryHigh" → red)
 * it escalates beyond the inline AirCard reading into a top-of-rail card that
 * shares the gov AlertBanner's compact grammar: a tier-coloured left strip,
 * a tinted `AIR` badge + the index's source badge (IQA / AQHI / AQI), and the
 * reading as `value · category` in the project's existing AQ vocabulary
 * ("8 · Élevé"). Tapping the card opens a `DetailsPopover` with the station,
 * source, dominant pollutant and observation age — the "tap for more" detail
 * that keeps the glance minimal (maintainer's space-budget direction).
 *
 * Rendered only inside LayoutPi (the 7" MID rail); the caller computes the
 * alert state once and passes it so the inline AirCard's AQ row can be
 * suppressed in the same render (no duplicate AQHI reading). Returns null
 * when there is no alert-level reading.
 *
 * @param {object} props
 * @param {{tier: "orange"|"red", category: string}} props.alert — the
 *   pre-computed air-alert state (from `getAirAlertState`)
 * @returns {JSX.Element|null} the AIR card, or null when AQ data is missing
 */
const AirAlertCard = ({ alert }) => {
  const { aqhiInfo } = useContext(WeatherDataContext);
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const cardRef = useRef(null);

  // Defensive: the caller only renders this when getAirAlertState != null,
  // but guard so a stale prop / missing payload can't throw.
  if (!alert || !aqhiInfo) return null;

  const { tier, category } = alert;
  const { value } = aqhiInfo;
  const scale = scaleLabel(aqhiInfo.scale, t);
  const levelWord = t(`badges.aqiLevel.${category}`);

  return (
    <div
      ref={cardRef}
      className={`${styles.card} ${styles[TIER_CLASS[tier]] || ""}`}
      role="button"
      tabIndex={0}
      onClick={() => setOpen((v) => !v)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setOpen((v) => !v);
        }
      }}
      aria-expanded={open}
      aria-label={t("alert.airQualityAria", { value, scale, level: levelWord })}
    >
      <div className={styles.row}>
        {/* Tinted AIR badge — the category pill, tier-coloured like the
          * gov SeverityChip (orange/red) so both alert families read the
          * same. A wind glyph anchors it; "AIR" is the documented source
          * tag (CLAUDE.md), rendered literally like RADAR/ECCC. */}
        <span className={styles.airBadge}>
          <InlineIcon icon={windGusts} className={styles.airIcon} aria-hidden="true" />
          AIR
        </span>
        <SourceBadge source={scale} />
        <span className={styles.reading}>
          <span className={styles.value}>{value != null ? value : "—"}</span>
          <span className={styles.sep}> · </span>
          <span className={styles.level}>{levelWord}</span>
        </span>
      </div>

      <DetailsPopover
        open={open}
        onClose={() => setOpen(false)}
        title={t("metrics.aqi")}
        triggerRef={cardRef}
        portal
      >
        <div className={styles.detailRow}>
          <span className={styles.detailLabel}>{t("metrics.detailValue")}</span>
          <span className={`${styles.detailValue} ${styles[TIER_CLASS[tier]] || ""}`}>
            {value} {scale} — {levelWord}
          </span>
        </div>
        {aqhiInfo.stationName ? (
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>{t("metrics.detailStation")}</span>
            <span>
              {aqhiInfo.stationName}
              {aqhiInfo.stationDistanceKm != null ? ` (${aqhiInfo.stationDistanceKm} km)` : ""}
            </span>
          </div>
        ) : null}
        {aqhiInfo.source ? (
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>{t("metrics.detailSource")}</span>
            <span>{t(AQ_SOURCE_LABEL_KEY[aqhiInfo.source] || "badges.aqiSourceEccc")}</span>
          </div>
        ) : null}
        {aqhiInfo.pollutant ? (
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>{t("metrics.detailPollutant")}</span>
            <span>{aqhiInfo.pollutant.toUpperCase()}</span>
          </div>
        ) : null}
        {aqhiInfo.observedAt ? (
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>{t("metrics.detailAge")}</span>
            <span>{formatAge(aqhiInfo.observedAt, i18n.language)}</span>
          </div>
        ) : null}
      </DetailsPopover>
    </div>
  );
};

AirAlertCard.propTypes = {
  alert: PropTypes.shape({
    tier: PropTypes.oneOf(["orange", "red"]).isRequired,
    category: PropTypes.string.isRequired,
  }).isRequired,
};

export default AirAlertCard;
