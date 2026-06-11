import React, { useContext, useRef, useState } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { InlineIcon } from "@iconify/react";
import strongWind from "@iconify/icons-wi/strong-wind";
import humidityAlt from "@iconify/icons-carbon/humidity-alt";
import sunIcon from "@iconify/icons-wi/day-sunny";
import leafIcon from "@iconify/icons-carbon/tree";
import sproutIcon from "@iconify/icons-carbon/sprout";
import informationIcon from "@iconify/icons-carbon/information";
import { WeatherDataContext, UiPrefsContext } from "~/AppContext";
import { convertSpeed, speedUnitLabel } from "~/services/conversions";
import { uvTier, uvTextColor, CATEGORY_TEXT_COLORS } from "~/ui/severity";
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

/**
 * Direction C metrics tile — 2×2 grid of compact stat cells, one for
 * each of Wind / Humidity / UV / AQI. Each cell shows an icon, the
 * value (large), and the unit / label (dim). UV and AQ cells are
 * tap-targets that open a `<DetailsPopover>` with richer per-source
 * information (WMO category + guidance for UV; station name +
 * source + pollutant for AQ).
 *
 * Wind and humidity come from Tomorrow.io's `currentWeatherData`
 * payload (same source as v2 `CurrentWeather`). UV is read from the
 * same payload. AQI comes from the project's blended air-quality
 * pipeline (`aqhiInfo` in AppContext — server merges MELCC / AirNow /
 * OpenAQ / ECCC). When AQ data isn't yet loaded the cell renders the
 * label only so the grid keeps its shape.
 *
 * @returns {JSX.Element} metrics grid slab
 */
const MetricsGrid = () => {
  const { currentWeatherData, aqhiInfo, pollenInfo } = useContext(WeatherDataContext);
  const { speedUnit } = useContext(UiPrefsContext);
  const { t, i18n } = useTranslation();
  // Single source of truth for which cell's popover is open. Tapping
  // a cell flips this; tapping the same cell again, the close icon,
  // outside the popover, or pressing Esc all close it.
  const [openKey, setOpenKey] = useState(null);
  const uvCellRef = useRef(null);
  const aqCellRef = useRef(null);
  const pollenCellRef = useRef(null);

  const values = currentWeatherData?.data?.timelines?.[0]?.intervals?.[0]?.values;
  const windSpeed = values?.windSpeed;
  const humidity = values?.humidity;
  const uvIndex = values?.uvIndex;
  const aqi = aqhiInfo?.value;
  const aqiCategory = aqhiInfo?.category;
  const aqiScaleLabel = aqhiInfo?.scale === "iqa" ? "IQA"
    : aqhiInfo?.scale === "aqhi" ? "AQHI"
      : aqhiInfo?.scale === "epa" ? "AQI"
        : "";

  const uvT = uvTier(uvIndex);
  const uvColor = uvTextColor(uvIndex);
  const uvQualifier = uvT ? t(`badges.uvLevel.${uvT.label}`) : null;
  const aqColor = aqiCategory ? CATEGORY_TEXT_COLORS[aqiCategory] : null;
  const aqQualifier = aqiCategory ? t(`badges.aqiLevel.${aqiCategory}`) : null;

  // Pollen — opt-in (advanced.pollen.enabled), hides silently when
  // upstream returns no allergen data for the user's region (common
  // in NA where CAMS coverage is sparse). Reuses the AQ tier
  // vocabulary (low/moderate/high/veryHigh) so the badge colour is
  // consistent across UV/AQ/Pollen.
  const pollenCategory = pollenInfo?.category;
  const pollenColor = pollenCategory ? CATEGORY_TEXT_COLORS[pollenCategory] : null;
  const pollenQualifier = pollenCategory ? t(`badges.aqiLevel.${pollenCategory}`) : null;
  const pollenWorstShort = pollenInfo?.worstAllergen
    ? t(`badges.pollenAllergens.${pollenInfo.worstAllergen}`, {
      defaultValue: pollenInfo.worstAllergen.replace("_pollen", ""),
    })
    : null;

  const toggle = (key) => setOpenKey((cur) => (cur === key ? null : key));

  return (
    <div className={styles.grid}>
      <Cell
        icon={strongWind}
        value={windSpeed != null ? convertSpeed(windSpeed, speedUnit) : "—"}
        unit={speedUnitLabel(speedUnit)}
        label={t("metrics.wind")}
      />
      <Cell
        icon={humidityAlt}
        value={humidity != null ? Math.round(humidity) : "—"}
        unit="%"
        label={t("metrics.humidity")}
      />
      <Cell
        cellRef={uvCellRef}
        icon={sunIcon}
        iconColor={uvColor}
        value={uvIndex != null ? Math.round(uvIndex) : "—"}
        unit=""
        label={t("metrics.uv")}
        qualifier={uvQualifier}
        qualifierColor={uvColor}
        onClick={uvT ? () => toggle("uv") : undefined}
        ariaExpanded={openKey === "uv"}
      >
        <DetailsPopover
          open={openKey === "uv"}
          onClose={() => setOpenKey(null)}
          title={t("metrics.uv")}
          anchor="left"
          triggerRef={uvCellRef}
        >
          {uvT ? (
            <>
              <div className={styles.detailRow}>
                <span className={styles.detailLabel}>{t("metrics.detailValue")}</span>
                <span className={styles.detailValue} style={{ color: uvColor }}>
                  {Math.round(uvIndex)} — {uvQualifier}
                </span>
              </div>
              <p className={styles.detailGuidance}>
                {t(`badges.uvGuidance.${uvT.label}`)}
              </p>
            </>
          ) : null}
        </DetailsPopover>
      </Cell>
      <Cell
        cellRef={aqCellRef}
        icon={leafIcon}
        iconColor={aqColor}
        value={aqi != null ? aqi : "—"}
        unit={aqiScaleLabel}
        label={t("metrics.aqi")}
        qualifier={aqQualifier}
        qualifierColor={aqColor}
        onClick={aqiCategory ? () => toggle("aq") : undefined}
        ariaExpanded={openKey === "aq"}
      >
        <DetailsPopover
          open={openKey === "aq"}
          onClose={() => setOpenKey(null)}
          title={t("metrics.aqi")}
          triggerRef={aqCellRef}
        >
          {aqhiInfo ? (
            <>
              <div className={styles.detailRow}>
                <span className={styles.detailLabel}>{t("metrics.detailValue")}</span>
                <span className={styles.detailValue} style={{ color: aqColor }}>
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
      </Cell>
      {pollenInfo && pollenInfo.available ? (
        <Cell
          cellRef={pollenCellRef}
          icon={sproutIcon}
          iconColor={pollenColor}
          value={pollenInfo.worstValue != null ? Math.round(pollenInfo.worstValue) : "—"}
          unit={t("metrics.pollenUnit", { defaultValue: "gr/m³" })}
          label={t("metrics.pollen", { defaultValue: "Pollen" })}
          qualifier={pollenQualifier}
          qualifierColor={pollenColor}
          spanFull
          onClick={() => toggle("pollen")}
          ariaExpanded={openKey === "pollen"}
        >
          <DetailsPopover
            open={openKey === "pollen"}
            onClose={() => setOpenKey(null)}
            title={t("metrics.pollen", { defaultValue: "Pollen" })}
            triggerRef={pollenCellRef}
          >
            {pollenInfo.allergens ? (
              <>
                {pollenWorstShort ? (
                  <div className={styles.detailRow}>
                    <span className={styles.detailLabel}>{t("metrics.detailWorst", { defaultValue: "Highest" })}</span>
                    <span className={styles.detailValue} style={{ color: pollenColor }}>
                      {pollenWorstShort} — {pollenQualifier}
                    </span>
                  </div>
                ) : null}
                <div className={styles.detailRow}>
                  <span className={styles.detailLabel}>{t("metrics.detailAllergens", { defaultValue: "Allergens" })}</span>
                  <div className={styles.allergenList}>
                    {pollenInfo.allergens.map((a) => (
                      <div key={a.name} className={styles.allergenRow}>
                        <span>
                          {t(`badges.pollenAllergens.${a.name}`, {
                            defaultValue: a.name.replace("_pollen", ""),
                          })}
                        </span>
                        <span style={{ color: a.category ? CATEGORY_TEXT_COLORS[a.category] : "var(--c-text-dim)" }}>
                          {a.value != null ? `${a.value.toFixed(1)} gr/m³` : "—"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : null}
          </DetailsPopover>
        </Cell>
      ) : null}
    </div>
  );
};

/**
 * Single metric cell inside the grid. When `onClick` is supplied
 * the cell becomes a focusable button and renders the
 * `<DetailsPopover>` passed in via `children` anchored to its
 * bottom-right corner (the cell's `position: relative` provides
 * the absolute-positioning context).
 *
 * @param {object} props
 * @param {object} props.icon — Iconify icon object
 * @param {string|number} props.value — primary stat value
 * @param {string} props.unit — unit suffix (e.g. "%", "kph")
 * @param {string} props.label — caption shown below the value
 * @param {Function} [props.onClick] — when provided, makes the cell
 *   a button that toggles a popover
 * @returns {JSX.Element} grid cell
 */
const Cell = ({ icon, iconColor, value, unit, label, qualifier, qualifierColor, onClick, ariaExpanded, spanFull, cellRef, children }) => {
  const interactive = typeof onClick === "function";
  // Use a `<div role="button">` (not a real `<button>`) so we don't
  // inherit the user-agent's button defaults (background, color,
  // font), AND so the DetailsPopover's close-button inside the
  // cell doesn't trigger React's "button cannot be a descendant of
  // button" hydration warning.
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
      ref={cellRef}
      className={`${styles.cell} ${interactive ? styles.cellInteractive : ""} ${spanFull ? styles.cellSpanFull : ""}`}
      onClick={onClick}
      onKeyDown={onKeyDown}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-expanded={interactive ? ariaExpanded : undefined}
    >
      {interactive ? (
        <InlineIcon icon={informationIcon} className={styles.cellInfoHint} aria-hidden="true" />
      ) : null}
      <div className={styles.iconRow}>
        <InlineIcon
          icon={icon}
          className={styles.icon}
          style={iconColor ? { color: iconColor } : undefined}
        />
      </div>
      <div className={styles.valueRow}>
        <span className={styles.value}>{value}</span>
        {unit ? <span className={styles.unit}>{unit}</span> : null}
      </div>
      <div className={styles.label}>{label}</div>
      {qualifier ? (
        <div
          className={styles.qualifier}
          style={qualifierColor ? { color: qualifierColor } : undefined}
        >
          {qualifier}
        </div>
      ) : null}
      {children}
    </div>
  );
};

Cell.propTypes = {
  icon: PropTypes.object.isRequired,
  iconColor: PropTypes.string,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  unit: PropTypes.string,
  label: PropTypes.string.isRequired,
  qualifier: PropTypes.string,
  qualifierColor: PropTypes.string,
  onClick: PropTypes.func,
  ariaExpanded: PropTypes.bool,
  spanFull: PropTypes.bool,
  // eslint-disable-next-line react/forbid-prop-types -- React ref shape is opaque
  cellRef: PropTypes.object,
  children: PropTypes.node,
};

Cell.defaultProps = {
  iconColor: undefined,
  unit: "",
  qualifier: null,
  qualifierColor: undefined,
  onClick: undefined,
  ariaExpanded: undefined,
  spanFull: false,
  cellRef: null,
  children: null,
};

export default MetricsGrid;
