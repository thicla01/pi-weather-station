import React, { useContext, useRef, useState } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { InlineIcon } from "@iconify/react";
import strongWind from "@iconify/icons-wi/strong-wind";
import windGusts from "@iconify/icons-carbon/wind-gusts";
import humidityAlt from "@iconify/icons-carbon/humidity-alt";
import sunIcon from "@iconify/icons-wi/day-sunny";
import chevronRight from "@iconify/icons-carbon/chevron-right";
import barometer from "@iconify/icons-wi/barometer";
import viewIcon from "@iconify/icons-carbon/view";
import { WeatherDataContext, UiPrefsContext } from "~/AppContext";
import { convertSpeed, speedUnitLabel, convertPressure, pressureUnitLabel } from "~/services/conversions";
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
 * Wind / Gust / UV / Humidity (v3.2 — the decision-grade set for a
 * glanceable kiosk: wind + gust + UV are radar-invisible outdoor-
 * activity inputs, humidity is the year-round comfort signal. The
 * v3.1 enthusiast tile, surface pressure, was dropped because it
 * drives no everyday household decision).
 *
 * Wind, gust, UV and humidity all come from Tomorrow.io's
 * `currentWeatherData` payload. The UV cell is a full-surface tap
 * target (SVG chevron affordance — F6) that opens a `DetailsPopover`
 * with the WMO category + guidance; the other cells carry no chevron
 * because they have no detail surface behind them — an affordance
 * that leads nowhere is worse than none.
 *
 * @param {object} props
 * @param {boolean} [props.extended] — v3.3 Conditions view: append the
 *   Pressure + Visibility tiles. Default false — the glance keeps the strict
 *   2×2 (the v3.2 stacked rail is unchanged).
 * @param {2|3} [props.columns] — grid columns. Default 2 (glance / stacked
 *   rail); 3 for the wide Conditions view (6 tiles → two themed rows).
 * @returns {JSX.Element} metrics grid slab
 */
const MetricsGrid = ({ extended = false, columns = 2 }) => {
  const { currentWeatherData } = useContext(WeatherDataContext);
  const { speedUnit, pressureUnit, distanceUnit } = useContext(UiPrefsContext);
  const { t } = useTranslation();
  // Single source of truth for which cell's popover is open. Tapping
  // a cell flips this; tapping the same cell again, the close icon,
  // outside the popover, or pressing Esc all close it.
  const [openKey, setOpenKey] = useState(null);
  const uvCellRef = useRef(null);

  const values = currentWeatherData?.data?.timelines?.[0]?.intervals?.[0]?.values;
  const windSpeed = values?.windSpeed;
  const windGust = values?.windGust;
  const humidity = values?.humidity;
  const uvIndex = values?.uvIndex;
  // Extended set (v3.3 Conditions view only) — pressure + visibility, the
  // enthusiast data the glance has no room for but the full-rail view does.
  const pressure = values?.pressureSurfaceLevel;
  const visibility = values?.visibility;

  const uvT = uvTier(uvIndex);
  const uvQualifier = uvT ? t(`badges.uvLevel.${uvT.label}`) : null;

  const toggle = (key) => setOpenKey((cur) => (cur === key ? null : key));

  return (
    <div className={`${styles.grid} ${columns === 3 ? styles.cols3 : ""}`}>
      <Cell
        icon={strongWind}
        value={windSpeed != null ? convertSpeed(windSpeed, speedUnit) : "—"}
        unit={speedUnitLabel(speedUnit)}
        label={t("metrics.wind")}
      />
      <Cell
        icon={windGusts}
        value={windGust != null ? convertSpeed(windGust, speedUnit) : "—"}
        unit={speedUnitLabel(speedUnit)}
        label={t("metrics.gust")}
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
        icon={humidityAlt}
        value={humidity != null ? Math.round(humidity) : "—"}
        unit="%"
        label={t("metrics.humidity")}
      />
      {extended ? (
        <Cell
          icon={barometer}
          value={pressure != null ? convertPressure(pressure, pressureUnit) : "—"}
          unit={pressureUnitLabel(pressureUnit)}
          label={t("metrics.pressure")}
        />
      ) : null}
      {extended ? (
        <Cell
          icon={viewIcon}
          value={visibility != null
            ? Math.round(distanceUnit === "mi" ? visibility * 0.621371 : visibility)
            : "—"}
          unit={distanceUnit === "mi" ? "mi" : "km"}
          label={t("metrics.visibility")}
        />
      ) : null}
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
const Cell = ({ icon, value, unit = "", label, qualifier = null, qualifierTier = null, onClick, ariaExpanded, cellRef = null, children = null }) => {
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
      {/* Icon INLINE with the value (one row) — "icon 21 kph" — so the tile
        * is two rows (value-row + label) and stays compact, matching the
        * mockup. The icon on its own row made the tiles a third taller. */}
      <div className={styles.topRow}>
        <span className={styles.icon}>
          <InlineIcon icon={icon} />
        </span>
        <span className={styles.valueGroup}>
          <span className={styles.value}>{value}</span>
          {unit ? <span className={styles.unit}>{unit}</span> : null}
        </span>
      </div>
      {/* The severity qualifier (UV "modéré") rides INLINE in the label —
        * "UV · modéré" on one line — so the cell stays the same height as
        * the non-qualified tiles (Wind / Gust / Humidity) and the 2×2 reads
        * as four uniform rectangles. The tier colour stays on the qualifier
        * word so the UV severity is still glanceable. */}
      <div className={styles.label}>
        {label}
        {qualifier ? (
          <span className={(qualifierTier && styles[TIER_CLASS[qualifierTier]]) || undefined}>
            {" · "}
            {qualifier}
          </span>
        ) : null}
      </div>
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
  cellRef: PropTypes.object,
  children: PropTypes.node,
};

MetricsGrid.propTypes = {
  // v3.3 Conditions view: add the Pressure + Visibility tiles (the glance
  // keeps the strict 2×2). Default false — the v3.2 stacked rail is unchanged.
  extended: PropTypes.bool,
  // Column count. 2 (default) for the glance/stacked rail; 3 for the wide
  // Conditions view, where the 6 extended tiles read as two themed rows
  // (Wind/Gust/UV · Humidity/Pressure/Visibility).
  columns: PropTypes.oneOf([2, 3]),
};

export default MetricsGrid;
