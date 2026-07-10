import React, { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { InlineIcon } from "@iconify/react";
import humidityAlt from "@iconify/icons-carbon/humidity-alt";
import axios from "axios";
import { UiPrefsContext } from "~/AppContext";
import { convertTemp } from "~/services/conversions";
import styles from "./styles.css";

const POLL_INTERVAL_MS = 60 * 1000;
// When the server says the feature is disabled (no Homebridge
// configured), re-checking once a minute is pure waste — 1,440
// no-op XHR/day on a default install (perf audit 2026-07-09). Back
// off to a slow probe that still notices a later enablement in
// settings without a kiosk reload.
const DISABLED_RECHECK_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Direction C variant of the indoor sensor block — temperature,
 * humidity, and indoor-air-quality grouped into a single slab. Data
 * shape and polling cadence (`GET /api/indoor-temperature` once a
 * minute) match the v2 `IndoorTemperature` component exactly; the
 * only divergence is presentation.
 *
 * Renders nothing in three cases, same SHOW gate as v2:
 *   - feature disabled on this Pi (server returns `enabled: false` —
 *     polling then backs off to a 10 min re-check instead of 60 s)
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
  const { tempUnit } = useContext(UiPrefsContext);
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let timerId = null;

    const fetchData = () => {
      axios
        .get("/api/indoor-temperature", { validateStatus: () => true })
        .then((r) => {
          if (cancelled) return;
          // Server returns 200 + { enabled: false } when Homebridge
          // isn't configured (was 404 before — the previous status
          // code spammed devtools as a network error on every poll).
          const enabled = r.status === 200 && r.data?.enabled;
          setData(enabled ? r.data : null);
          // Back off ONLY on an explicit "feature disabled" answer.
          // A 5xx / malformed response is a server hiccup, not a
          // configuration state — keep the 60 s cadence so recovery
          // is as fast as it was before the backoff existed.
          const explicitlyDisabled = r.status === 200 && r.data && r.data.enabled === false;
          schedule(explicitlyDisabled ? DISABLED_RECHECK_INTERVAL_MS : POLL_INTERVAL_MS);
        })
        .catch(() => {
          // Network blip — keep showing the last good value.
          schedule(POLL_INTERVAL_MS);
        });
    };

    // Self-rescheduling timeout instead of setInterval so the cadence
    // can stretch while the feature is disabled and snap back to 60 s
    // as soon as a poll finds it enabled.
    const schedule = (delayMs) => {
      if (cancelled) return;
      timerId = setTimeout(fetchData, delayMs);
    };

    fetchData();
    return () => {
      cancelled = true;
      clearTimeout(timerId);
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
