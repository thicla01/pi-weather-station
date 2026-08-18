import React, { useContext, useRef, useState } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { WeatherDataContext } from "~/AppContext";
import { formatAge } from "~/ui/formatAge";
import DetailsPopover from "~/components/ambient/DetailsPopover";
import styles from "./styles.css";

// Source-specific label keys for the AQ detail popover. Mirrors the
// older `UvAqiBadges` mapping verbatim. Falls back to the generic
// ECCC label when an unknown source shows up.
const AQ_SOURCE_LABEL_KEY = {
  "MELCC-Mtl":   "badges.aqiSourceMelccMtl",
  "MELCC-RSQAQ": "badges.aqiSourceMelccRsqaq",
  "ECCC":        "badges.aqiSourceEccc",
  "AirNow":      "badges.aqiSourceAirNow",
  "OpenAQ":      "badges.aqiSourceOpenAq",
};

const AQ_KIND_LABEL_KEY = {
  observation: "badges.aqiKindObservation",
  forecast:    "badges.aqiKindForecast",
  nowcast:     "badges.aqiKindNowcast",
};

// Severity tier → pill/qualifier CSS class. The four classes resolve
// to the `--mx-cat-*` palette tokens (see ui/tokens.js — in nightRed
// they all collapse to the red family and the WORD carries the tier).
const TIER_CLASS = {
  low: "catGood",
  moderate: "catMod",
  high: "catBad",
  veryHigh: "catVhigh",
};

/**
 * Air card — the two air readings (AQI + pollen) as full-width rows
 * above the metrics grid (v3.1 Phase 2, §3 option B).
 *
 * Row grammar: `value · MONO LABEL (dotted-underline) · category pill`. The
 * AQI row is always present (placeholder dash until the blended
 * air-quality pipeline responds); the pollen row only renders when
 * the opt-in setting is on AND upstream returned allergen data —
 * out-of-coverage (`null` everywhere, the North-America common case)
 * degrades to the AQI row alone, identical to the setting being off.
 * The strict 2×2 metrics grid below is never broken by either state.
 *
 * Each row is a full-surface tap target opening the same
 * `DetailsPopover` content the old MetricsGrid cells used — plus,
 * for pollen, the per-allergen tier word and a `—` placeholder for
 * null allergens (no invented "none" tier).
 *
 * @param {object} props
 * @param {boolean} [props.suppressAqRow] — v3.2 Pi MID: when the air-quality
 *   reading has escalated to the top-of-rail `AirAlertCard` (health-risk
 *   band), drop this card's AQ row so the AQHI reading isn't shown twice.
 *   The pollen row (when present) still renders; if neither row remains the
 *   whole card collapses to null.
 * @returns {JSX.Element|null} air card slab
 */
const AirCard = ({ suppressAqRow = false }) => {
  const { aqhiInfo, pollenInfo } = useContext(WeatherDataContext);
  const { t, i18n } = useTranslation();
  const [openKey, setOpenKey] = useState(null);
  const aqRowRef = useRef(null);
  const pollenRowRef = useRef(null);

  const aqi = aqhiInfo?.value;
  const aqiCategory = aqhiInfo?.category;
  // Scale label doubles as the row's mono label — one label, fixing
  // the F5 "IQA · IQA" unit/label duplication the old cell had.
  const aqiScaleLabel = aqhiInfo?.scale === "iqa" ? "IQA"
    : aqhiInfo?.scale === "aqhi" ? "AQHI"
      : aqhiInfo?.scale === "epa" ? "AQI"
        : t("metrics.aqi");
  const aqQualifier = aqiCategory ? t(`badges.aqiLevel.${aqiCategory}`) : null;

  const pollenCategory = pollenInfo?.category;
  const pollenQualifier = pollenCategory ? t(`badges.aqiLevel.${pollenCategory}`) : null;
  const pollenWorstShort = pollenInfo?.worstAllergen
    ? t(`badges.pollenAllergens.${pollenInfo.worstAllergen}`, {
      defaultValue: pollenInfo.worstAllergen.replace("_pollen", ""),
    })
    : null;
  // `available` is false both when the setting is off and when the
  // upstream returned no allergen data for the region — the two
  // degrade states are deliberately identical (B3 ruling).
  const showPollen = !!(pollenInfo && pollenInfo.available);
  // v3.2: when the AQ reading escalated to the top-of-rail AirAlertCard,
  // suppress the AQ row here. If pollen isn't showing either, the card
  // has nothing left to render — collapse it so no empty slab remains.
  const showAqRow = !suppressAqRow;
  if (!showAqRow && !showPollen) return null;

  const toggle = (key) => setOpenKey((cur) => (cur === key ? null : key));

  return (
    <div className={styles.card}>
      {showAqRow ? (
      <Row
        rowRef={aqRowRef}
        value={aqi != null ? aqi : "—"}
        label={aqiScaleLabel}
        qualifier={aqQualifier}
        tier={aqiCategory}
        onClick={aqiCategory ? () => toggle("aq") : undefined}
        ariaExpanded={openKey === "aq"}
      >
        {/* `portal` is load-bearing: the card clips its rounded rows
          * via `overflow: hidden`, so an absolute popover anchored
          * inside a row would be 100 % clipped. Portal mode positions
          * from the row's viewport rect instead (same pattern as the
          * astro popovers). */}
        <DetailsPopover
          open={openKey === "aq"}
          onClose={() => setOpenKey(null)}
          title={t("metrics.aqi")}
          triggerRef={aqRowRef}
          portal
        >
          {aqhiInfo ? (
            <>
              <div className={styles.detailRow}>
                <span className={styles.detailLabel}>{t("metrics.detailValue")}</span>
                <span className={`${styles.detailValue} ${styles[TIER_CLASS[aqiCategory]] || ""}`}>
                  {aqi} {aqiScaleLabel} — {aqQualifier}
                </span>
              </div>
              {aqhiInfo.stationName ? (
                <div className={styles.detailRow}>
                  <span className={styles.detailLabel}>{t("metrics.detailStation")}</span>
                  <span>
                    {aqhiInfo.stationName}
                    {aqhiInfo.stationDistanceKm != null
                      ? ` (${aqhiInfo.stationDistanceKm} km)`
                      : ""}
                  </span>
                </div>
              ) : null}
              {aqhiInfo.source ? (
                <div className={styles.detailRow}>
                  <span className={styles.detailLabel}>{t("metrics.detailSource")}</span>
                  <span>{t(AQ_SOURCE_LABEL_KEY[aqhiInfo.source] || "badges.aqiSourceEccc")}</span>
                </div>
              ) : null}
              {aqhiInfo.kind ? (
                <div className={styles.detailRow}>
                  <span className={styles.detailLabel}>{t("metrics.detailKind")}</span>
                  <span>{t(AQ_KIND_LABEL_KEY[aqhiInfo.kind] || "badges.aqiKindObservation")}</span>
                </div>
              ) : null}
              {aqhiInfo.observedAt ? (
                <div className={styles.detailRow}>
                  <span className={styles.detailLabel}>{t("metrics.detailAge")}</span>
                  <span>{formatAge(aqhiInfo.observedAt, i18n.language)}</span>
                </div>
              ) : null}
              {aqhiInfo.pollutant ? (
                <div className={styles.detailRow}>
                  <span className={styles.detailLabel}>{t("metrics.detailPollutant")}</span>
                  <span>{aqhiInfo.pollutant.toUpperCase()}</span>
                </div>
              ) : null}
            </>
          ) : null}
        </DetailsPopover>
      </Row>
      ) : null}
      {showPollen ? (
        <Row
          rowRef={pollenRowRef}
          value={pollenWorstShort || "—"}
          valueIsText
          label={t("metrics.pollen", { defaultValue: "Pollen" })}
          qualifier={pollenQualifier}
          tier={pollenCategory}
          onClick={() => toggle("pollen")}
          ariaExpanded={openKey === "pollen"}
        >
          <DetailsPopover
            open={openKey === "pollen"}
            onClose={() => setOpenKey(null)}
            title={t("metrics.pollen", { defaultValue: "Pollen" })}
            triggerRef={pollenRowRef}
            portal
          >
            {pollenInfo.allergens ? (
              <div className={styles.allergenList}>
                {pollenInfo.allergens.map((a) => (
                  <div key={a.name} className={styles.allergenRow}>
                    <span className={styles.allergenName}>
                      {t(`badges.pollenAllergens.${a.name}`, {
                        defaultValue: a.name.replace("_pollen", ""),
                      })}
                    </span>
                    <span className={styles.allergenValue}>
                      {a.value != null
                        ? `${a.value.toFixed(1)} ${t("metrics.pollenUnit", { defaultValue: "gr/m³" })}`
                        : ""}
                    </span>
                    <span className={`${styles.allergenTier} ${a.category ? styles[TIER_CLASS[a.category]] || "" : styles.noData}`}>
                      {a.category ? t(`badges.aqiLevel.${a.category}`) : "—"}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </DetailsPopover>
        </Row>
      ) : null}
    </div>
  );
};

/**
 * Single air-card row. When `onClick` is supplied the row becomes a
 * focusable button-like surface (div + role, not a real `<button>`,
 * so the DetailsPopover's close button inside doesn't nest buttons)
 * and renders the `<DetailsPopover>` passed via `children`.
 *
 * @param {object} props
 * @param {string|number} props.value — leading value (AQI number or
 *   worst-allergen name)
 * @param {boolean} [props.valueIsText] — style the value as a body
 *   string (allergen name) rather than a big numeral
 * @param {string} props.label — mono uppercase label (IQA / Pollen)
 * @param {string} [props.qualifier] — category word for the pill
 * @param {string} [props.tier] — severity tier driving the pill colour
 * @param {() => void} [props.onClick] — toggles the row's popover
 * @param {boolean} [props.ariaExpanded] — popover-open state for a11y
 * @param {object} [props.rowRef] — React ref to the row element
 *   (popover anchor)
 * @param {React.ReactNode} [props.children] — the row's DetailsPopover
 * @returns {JSX.Element} air row
 */
const Row = ({ value, valueIsText = false, label, qualifier = null, tier = null, onClick, ariaExpanded, rowRef = null, children = null }) => {
  const interactive = typeof onClick === "function";
  const onKeyDown = interactive
    ? (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onClick();
      }
    }
    : undefined;
  return (
    <div
      ref={rowRef}
      className={`${styles.row} ${interactive ? styles.rowInteractive : ""}`}
      onClick={onClick}
      onKeyDown={onKeyDown}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-expanded={interactive ? ariaExpanded : undefined}
    >
      {/* Value + scale label read as one tappable term. When the row opens a
        * popover the pair carries the house dotted-underline affordance
        * (replacing the old chevron) — modeled on SunMoonBlock's .headLabel.
        * The underline lives on a span, so the `.ambientRoot button` reset
        * doesn't touch it and no doubled-class specificity trick is needed.
        * The pastille (category pill) stays a pure level indicator, never
        * underlined. */}
      <span className={`${styles.valueGroup} ${interactive ? styles.valueUnderline : ""}`}>
        <span className={valueIsText ? styles.valueText : styles.value}>{value}</span>
        <span className={styles.label}>{label}</span>
      </span>
      {qualifier ? (
        <span className={`${styles.pill} ${styles[TIER_CLASS[tier]] || ""}`}>
          <span className={styles.pillDot} aria-hidden="true" />
          {qualifier}
        </span>
      ) : null}
      {children}
    </div>
  );
};

Row.propTypes = {
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  valueIsText: PropTypes.bool,
  label: PropTypes.string.isRequired,
  qualifier: PropTypes.string,
  tier: PropTypes.string,
  onClick: PropTypes.func,
  ariaExpanded: PropTypes.bool,
  rowRef: PropTypes.object,
  children: PropTypes.node,
};

AirCard.propTypes = {
  suppressAqRow: PropTypes.bool,
};

export default AirCard;
