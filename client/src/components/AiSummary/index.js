import React, { useEffect, useState, useContext, useRef } from "react";
import { useTranslation } from "react-i18next";
import { AppContext } from "~/AppContext";
import styles from "./styles.css";
import axios from "axios";

const LABEL = { en: "AI SUMMARY", fr: "RÉSUMÉ IA", es: "RESUMEN IA" };

const REFRESH_INTERVAL = 15 * 60 * 1000;

/**
 * AI-generated weather summary powered by Claude.
 * Renders nothing if the Anthropic API key is not configured (feature is optional).
 *
 * @returns {JSX.Element|null} AI summary block, or null if unavailable
 */
const AiSummary = () => {
  const { mapGeo, darkMode } = useContext(AppContext);
  const { i18n } = useTranslation();
  const [summary, setSummary] = useState(null);
  const [available, setAvailable] = useState(true);
  const intervalRef = useRef(null);

  const lang = ["fr", "es"].find((l) => i18n.language.startsWith(l)) || "en";

  useEffect(() => {
    if (!mapGeo || !available) return;

    const { latitude, longitude } = mapGeo;

    const fetchSummary = () => {
      const now = new Date();
      const localHour = now.getHours();

      const ts18 = new Date(now); ts18.setHours(18, 0, 0, 0);
      const ts21 = new Date(now); ts21.setHours(21, 0, 0, 0);
      const ts05tomorrow = new Date(now); ts05tomorrow.setDate(ts05tomorrow.getDate() + 1); ts05tomorrow.setHours(5, 0, 0, 0);

      const params = new URLSearchParams({
        lat: latitude,
        lon: longitude,
        lang,
        localHour,
        ts18: ts18.getTime(),
        ts21: ts21.getTime(),
        ts05tomorrow: ts05tomorrow.getTime(),
      });

      axios
        .get(`/api/weather-summary?${params}`)
        .then((res) => {
          setSummary(res.data.summary);
        })
        .catch((err) => {
          if (err?.response?.status === 503) {
            // Anthropic key not configured — hide the feature silently
            setAvailable(false);
          }
          // On other errors, keep displaying the last known summary
        });
    };

    fetchSummary();

    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(fetchSummary, REFRESH_INTERVAL);

    return () => clearInterval(intervalRef.current);
  }, [mapGeo, lang, available]);

  if (!available || !summary) return null;

  return (
    <div className={`${styles.container} ${darkMode ? styles.dark : styles.light}`}>
      <div className={styles.header}>
        <div className={styles.line} />
        <span className={styles.label}>{LABEL[lang] || LABEL.en}</span>
        <div className={styles.line} />
      </div>
      {summary.split("\n\n").map((paragraph, i) => (
        <p key={i} className={styles.text}>{paragraph}</p>
      ))}
    </div>
  );
};

export default AiSummary;
