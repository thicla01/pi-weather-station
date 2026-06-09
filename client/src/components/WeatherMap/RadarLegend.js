import React, { useContext } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";

import { AppContext } from "~/AppContext";
import styles from "./styles.css";

const RADAR_LEGEND_ITEMS = [
  { color: "#00d0d0", key: "veryLight" },
  { color: "#00c800", key: "light"     },
  { color: "#f0e600", key: "moderate"  },
  { color: "#f08200", key: "heavy"     },
  { color: "#e60000", key: "veryHeavy" },
  { color: "#7800b4", key: "extreme"   },
];

// Nearby-alerts tier swatches (Phase 3) — the polygon fill/border
// colours, shown as a key when the survey overlay is on. Labels reuse
// the SeverityChip i18n keys (alert.severityWarning/Watch/Advisory).
const NEARBY_TIER_ITEMS = [
  { color: "#e60000", key: "Warning"  },
  { color: "#ee7710", key: "Watch"    },
  { color: "#f0c000", key: "Advisory" },
];

/**
 * Radar precipitation legend overlay. When the nearby-alerts survey
 * overlay is active, a compact alert-tier key + an in-radius count
 * (and an honest "+N not mapped" note) is appended below the
 * precipitation scale.
 *
 * @param {object} props
 * @param {boolean} props.dark Dark mode
 * @returns {JSX.Element} Legend overlay
 */
const RadarLegend = ({ dark }) => {
  const { t } = useTranslation();
  const {
    showWeatherAlerts,
    nearbyAlerts,
    nearbyResidualCount,
    alertRadiusKm,
    distanceUnit,
  } = useContext(AppContext);
  const nearbyCount = Array.isArray(nearbyAlerts) ? nearbyAlerts.length : 0;
  const radiusDisplay = distanceUnit === "mi" ? Math.round(alertRadiusKm / 1.609344) : alertRadiusKm;
  const unitLabel = distanceUnit === "mi" ? "mi" : "km";
  return (
    <div className={`${styles.radarLegend} ${dark ? styles.radarLegendDark : styles.radarLegendLight}`}>
      <div className={styles.radarLegendTitle}>{t("radar.legend")}</div>
      {RADAR_LEGEND_ITEMS.map(({ color, key }) => (
        <div key={key} className={styles.radarLegendItem}>
          <span className={styles.radarLegendSwatch} style={{ background: color }} />
          <span className={styles.radarLegendLabel}>{t(`radar.${key}`)}</span>
        </div>
      ))}
      {showWeatherAlerts ? (
        <div className={styles.nearbyBlock}>
          <div className={styles.radarLegendTitle}>{t("radar.nearbyTitle")}</div>
          {NEARBY_TIER_ITEMS.map(({ color, key }) => (
            <div key={key} className={styles.radarLegendItem}>
              <span className={styles.radarLegendSwatch} style={{ background: color }} />
              <span className={styles.radarLegendLabel}>{t(`alert.severity${key}`)}</span>
            </div>
          ))}
          <div className={styles.nearbyCount}>
            {t("radar.nearbyWithin", { count: nearbyCount, radius: radiusDisplay, unit: unitLabel })}
            {nearbyResidualCount > 0 ? (
              <span className={styles.nearbyMore}>{t("radar.nearbyNotMapped", { count: nearbyResidualCount })}</span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
};

RadarLegend.propTypes = {
  dark: PropTypes.bool,
};

export default RadarLegend;
