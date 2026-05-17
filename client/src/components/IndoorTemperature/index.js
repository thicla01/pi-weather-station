import React, { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { InlineIcon } from "@iconify/react";
import humidityAlt from "@iconify/icons-carbon/humidity-alt";
import axios from "axios";
import { AppContext } from "~/AppContext";
import { convertTemp } from "~/services/conversions";
import styles from "./styles.css";

const POLL_INTERVAL_MS = 60 * 1000;

/**
 * Indoor temperature readout, displayed to the left of the clock.
 * Renders nothing when the experimental feature is not configured on this Pi
 * or when no valid reading is available yet.
 *
 * @returns {JSX.Element|null} Indoor temperature panel, or null when hidden
 */
const IndoorTemperature = () => {
  const { t } = useTranslation();
  const { tempUnit } = useContext(AppContext);
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const fetchData = () => {
      axios
        .get("/api/indoor-temperature", { validateStatus: () => true })
        .then((r) => {
          if (cancelled) return;
          // 200 + { enabled: false } = feature not configured →
          // hide. Was 404 before — the previous status code spammed
          // devtools as a network error on every poll.
          if (r.status === 200 && r.data?.enabled) {
            setData(r.data);
          } else {
            setData(null);
          }
        })
        .catch(() => {
          // Network blip — keep showing the last good value
        });
    };

    fetchData();
    const id = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!data || data.value == null) return null;

  const displayTemp = convertTemp(data.value, tempUnit);
  const unitLabel = tempUnit === "f" ? "°F" : tempUnit === "k" ? "K" : "°C";

  return (
    <div className={`${styles.container} ${data.isStale ? styles.stale : ""}`}>
      <div className={styles.label}>{t("indoor.label")}</div>
      <div className={styles.temp}>{displayTemp}{unitLabel}</div>
      {data.humidity != null && (
        <div className={styles.humidity}>
          <InlineIcon icon={humidityAlt} />
          <span>{Math.round(data.humidity)}%</span>
        </div>
      )}
      {data.airQuality != null && (
        <div className={styles.airQuality}>
          <span className={`${styles.dot} ${styles[`aq${data.airQuality}`]}`} />
          <span>{t(`indoor.airQuality.${data.airQuality}`)}</span>
        </div>
      )}
    </div>
  );
};

export default IndoorTemperature;
