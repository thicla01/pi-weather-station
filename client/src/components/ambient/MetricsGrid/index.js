import React, { useContext, useRef, useState } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { InlineIcon } from "@iconify/react";
import strongWind from "@iconify/icons-wi/strong-wind";
import humidityAlt from "@iconify/icons-carbon/humidity-alt";
import sunIcon from "@iconify/icons-wi/day-sunny";
import barometerIcon from "@iconify/icons-wi/barometer";
import chevronRight from "@iconify/icons-carbon/chevron-right";
import { WeatherDataContext, UiPrefsContext } from "~/AppContext";
import { convertSpeed, speedUnitLabel } from "~/services/conversions";
import { uvTier } from "~/ui/severity";
import DetailsPopover from "~/components/ambient/DetailsPopover";
import styles from "./styles.css";

// Severity tier → qualifier CSS class. Resolves to the `--mx-cat-*`
// palette tokens (ui/tokens.js) so the wording stays legible per
// palette — including nightRed, where every tier collapses to red
// and the word alone carries the meaning (the formerly-missing
// nightRed override). UV "extreme" aliases the veryHigh token —
// no fifth tier exists in the colour system.
const TIER_CLASS = {
  low: "catGood",
  moderate: "catMod",
  high: "catBad",
  veryHigh: "catVhigh",
  extreme: "catVhigh",
};

/**
 * Direction C metrics tile — strict 2×2 grid of compact stat cells:
 * Wind / Humidity / UV / Pressure (v3.1 Phase 2 — AQI moved out to
 * the dedicated `AirCard`, the opt-in pollen row joined it, and the
 * grid gained surface pressure as its 4th tile so the 2×2 is never
 * broken by any setting).
 *
 * Wind, humidity, UV and pressure all come from Tomorrow.io's
 * `currentWeatherData` payload. The UV cell is a full-surface tap
 * target (SVG chevron affordance — F6) that opens a `DetailsPopover`
 * with the WMO category + guidance; the other cells carry no chevron
 * because they have no detail surface behind them — an affordance
 * that leads nowhere is worse than none.
 *
 * @returns {JSX.Element} metrics grid slab
 */
const MetricsGrid = () => {
  const { currentWeatherData } = useContext(WeatherDataContext);
  const { speedUnit } = useContext(UiPrefsContext);
  const { t } = useTranslation();
  // Single source of truth for which cell's popover is open. Tapping
  // a cell flips this; tapping the same cell again, the close icon,
  // outside the popover, or pressing Esc all close it.
  const [openKey, setOpenKey] = useState(null);
  const uvCellRef = useRef(null);

  const values = currentWeatherData?.data?.timelines?.[0]?.intervals?.[0]?.values;
  const windSpeed = values?.windSpeed;
  const humidity = values?.humidity;
  const uvIndex = values?.uvIndex;
  // Tomorrow.io serves `pressureSurfaceLevel` in hPa under the metric
  // unit system the proxy requests. hPa is the display unit for now;
  // the tile's unit slot is deliberately non-load-bearing (quiet
  // suffix) so a future hPa/inHg preference swaps without reflow.
  const pressure = values?.pressureSurfaceLevel;

  const uvT = uvTier(uvIndex);
  const uvQualifier = uvT ? t(`badges.uvLevel.${uvT.label}`) : null;

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
        value={uvIndex != null ? Math.round(uvIndex) : "—"}
        unit=""
        label={t("metrics.uv")}
        qualifier={uvQualifier}
        qualifierTier={uvT?.label}
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
                <span className={`${styles.detailValue} ${styles[TIER_CLASS[uvT.label]] || ""}`}>
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
        icon={barometerIcon}
        value={pressure != null ? Math.round(pressure) : "—"}
        unit="hPa"
        label={t("metrics.pressure")}
      />
    </div>
  );
};

/**
 * Single metric cell inside the grid. When `onClick` is supplied
 * the cell becomes a focusable full-surface tap target with an SVG
 * chevron affordance (top-right) and renders the `<DetailsPopover>`
 * passed in via `children` anchored to its bottom corner (the cell's
 * `position: relative` provides the absolute-positioning context).
 *
 * @param {object} props
 * @param {object} props.icon — Iconify icon object
 * @param {string|number} props.value — primary stat value
 * @param {string} props.unit — unit suffix (e.g. "%", "kph", "hPa")
 * @param {string} props.label — caption shown below the value
 * @param {string} [props.qualifier] — severity wording under the label
 * @param {string} [props.qualifierTier] — severity tier (low …
 *   extreme) mapped onto the `--mx-cat-*` colour classes
 * @param {() => void} [props.onClick] — when provided, makes the cell
 *   a button that toggles a popover
 * @param {boolean} [props.ariaExpanded] — popover-open state for a11y
 * @param {object} [props.cellRef] — React ref to the cell element
 *   (popover anchor)
 * @param {React.ReactNode} [props.children] — the cell's DetailsPopover
 * @returns {JSX.Element} grid cell
 */
const Cell = ({ icon, value, unit, label, qualifier, qualifierTier, onClick, ariaExpanded, cellRef, children }) => {
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
      className={`${styles.cell} ${interactive ? styles.cellInteractive : ""}`}
      onClick={onClick}
      onKeyDown={onKeyDown}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-expanded={interactive ? ariaExpanded : undefined}
    >
      {interactive ? (
        <InlineIcon icon={chevronRight} className={styles.cellChevron} aria-hidden="true" />
      ) : null}
      <div className={styles.iconRow}>
        <InlineIcon icon={icon} />
      </div>
      <div className={styles.valueRow}>
        <span className={styles.value}>{value}</span>
        {unit ? <span className={styles.unit}>{unit}</span> : null}
      </div>
      <div className={styles.label}>{label}</div>
      {qualifier ? (
        <div className={`${styles.qualifier} ${(qualifierTier && styles[TIER_CLASS[qualifierTier]]) || ""}`}>
          {qualifier}
        </div>
      ) : null}
      {children}
    </div>
  );
};

Cell.propTypes = {
  icon: PropTypes.object.isRequired,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  unit: PropTypes.string,
  label: PropTypes.string.isRequired,
  qualifier: PropTypes.string,
  qualifierTier: PropTypes.string,
  onClick: PropTypes.func,
  ariaExpanded: PropTypes.bool,
  // eslint-disable-next-line react/forbid-prop-types -- React ref shape is opaque
  cellRef: PropTypes.object,
  children: PropTypes.node,
};

Cell.defaultProps = {
  unit: "",
  qualifier: null,
  qualifierTier: null,
  onClick: undefined,
  ariaExpanded: undefined,
  cellRef: null,
  children: null,
};

export default MetricsGrid;
