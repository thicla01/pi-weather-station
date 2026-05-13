import React, { useContext } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { InlineIcon } from "@iconify/react";
import strongWind from "@iconify/icons-wi/strong-wind";
import humidityAlt from "@iconify/icons-carbon/humidity-alt";
import sunIcon from "@iconify/icons-wi/day-sunny";
import leafIcon from "@iconify/icons-carbon/tree";
import { AppContext } from "~/AppContext";
import { convertSpeed, speedUnitLabel } from "~/services/conversions";
import styles from "./styles.css";

/**
 * Direction C metrics tile — 2×2 grid of compact stat cells, one for
 * each of Wind / Humidity / UV / AQI. Each cell shows an icon, the
 * value (large), and the unit / label (dim).
 *
 * Wind and humidity come from Tomorrow.io's `currentWeatherData`
 * payload (same source as v2 `CurrentWeather`). UV is read from the
 * same payload. AQI comes from the project's blended air-quality
 * pipeline (`aqhiInfo` in AppContext — server merges MELCC / AirNow /
 * OpenAQ / ECCC). When AQ data isn't yet loaded the cell renders the
 * label only so the grid keeps its shape.
 *
 * Renders an empty 2×2 skeleton when no payload has landed.
 *
 * @returns {JSX.Element} metrics grid slab
 */
const MetricsGrid = () => {
  const {
    currentWeatherData,
    speedUnit,
    aqhiInfo,
  } = useContext(AppContext);
  const { t } = useTranslation();

  const values = currentWeatherData?.data?.timelines?.[0]?.intervals?.[0]?.values;
  const windSpeed = values?.windSpeed;
  const humidity = values?.humidity;
  const uvIndex = values?.uvIndex;
  const aqi = aqhiInfo?.value;
  const aqiCategory = aqhiInfo?.category;
  // The scale identifier ("IQA" for Quebec, "AQHI" for ECCC fallback,
  // "AQI" for EPA AirNow / OpenAQ) anchors the meaning of the number —
  // a 5 means "good" on IQA (max ~50) but "moderate" on AQHI (max 10+).
  // Render it in the unit slot, similar to how "kph" anchors the wind
  // value. Falls back to the generic "metrics.aqi" translation when
  // we don't yet have a payload so the cell label still reads clearly.
  const aqiScaleLabel = aqhiInfo?.scale === "iqa" ? "IQA"
    : aqhiInfo?.scale === "aqhi" ? "AQHI"
      : aqhiInfo?.scale === "epa" ? "AQI"
        : "";

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
        icon={sunIcon}
        value={uvIndex != null ? Math.round(uvIndex) : "—"}
        unit=""
        label={t("metrics.uv")}
      />
      <Cell
        icon={leafIcon}
        value={aqi != null ? aqi : "—"}
        unit={aqiScaleLabel}
        label={aqiCategory ? t(`badges.aqiLevel.${aqiCategory}`) : t("metrics.aqi")}
      />
    </div>
  );
};

/**
 * Single metric cell inside the grid.
 *
 * @param {object} props
 * @param {object} props.icon — Iconify icon object
 * @param {string|number} props.value — primary stat value
 * @param {string} props.unit — unit suffix (e.g. "%", "kph")
 * @param {string} props.label — caption shown below the value
 * @returns {JSX.Element} grid cell
 */
const Cell = ({ icon, value, unit, label }) => (
  <div className={styles.cell}>
    <div className={styles.iconRow}>
      <InlineIcon icon={icon} className={styles.icon} />
    </div>
    <div className={styles.valueRow}>
      <span className={styles.value}>{value}</span>
      {unit ? <span className={styles.unit}>{unit}</span> : null}
    </div>
    <div className={styles.label}>{label}</div>
  </div>
);

Cell.propTypes = {
  icon: PropTypes.object.isRequired,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  unit: PropTypes.string,
  label: PropTypes.string.isRequired,
};

Cell.defaultProps = {
  unit: "",
};

export default MetricsGrid;
