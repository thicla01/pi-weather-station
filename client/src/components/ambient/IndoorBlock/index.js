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
 * Direction C variant of the indoor sensor block — temperature,
 * humidity, and indoor-air-quality grouped into a single slab. Data
 * shape and polling cadence (`GET /api/indoor-temperature` once a
 * minute) match the v2 `IndoorTemperature` component exactly; the
 * only divergence is presentation.
 *
 * Renders nothing in three cases, same SHOW gate as v2:
 *   - feature disabled on this Pi (server returns 404)
 *   - no valid reading received yet
 *   - reading available but `value` is null (the upstream sensor
 *     hasn't reported a temperature)
 *
 * Visual model:
 *   - Slab-style surface (warm-grey palette via tokens).
 *   - Temperature in Geist Bold (hero-style numerals), units in dim
 *     text alongside.
 *   - Humidity + AQ as a row of metadata chips below.
 *   - Stale readings (server hasn't seen the sensor in a while) fade
 *     the slab by reducing text opacity — calmer than v2's red dot.
 *
 * @returns {JSX.Element|null} indoor sensor slab, or null when hidden
 */
const IndoorBlock = () => {
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
          if (r.status === 404) {
            setData(null);
            return;
          }
          if (r.status === 200 && r.data?.enabled) {
            setData(r.data);
          }
        })
        .catch(() => {
          // Network blip — keep showing the last good value.
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
    <div className={`${styles.slab} ${data.isStale ? styles.stale : ""}`}>
      <div className={styles.label}>{t("indoor.label")}</div>
      <div className={styles.tempRow}>
        <span className={styles.tempValue}>{displayTemp}</span>
        <span className={styles.tempUnit}>{unitLabel}</span>
      </div>
      <div className={styles.meta}>
        {data.humidity != null && (
          <div className={styles.metaItem}>
            <InlineIcon icon={humidityAlt} />
            <span>{Math.round(data.humidity)}%</span>
          </div>
        )}
        {data.airQuality != null && (
          <div className={styles.metaItem}>
            <span className={`${styles.dot} ${styles[`aq-${data.airQuality}`]}`} />
            <span>{t(`indoor.airQuality.${data.airQuality}`)}</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default IndoorBlock;
