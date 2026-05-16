import React, { useEffect, useState, useContext, useRef } from "react";
import { useTranslation } from "react-i18next";
import { InlineIcon } from "@iconify/react";
import chevronUp from "@iconify/icons-carbon/chevron-up";
import chevronDown from "@iconify/icons-carbon/chevron-down";
import PropTypes from "prop-types";
import { AppContext } from "~/AppContext";
import styles from "./styles.css";
import axios from "axios";

const LABEL = { en: "AI SUMMARY", fr: "RÉSUMÉ IA", es: "RESUMEN IA" };

const REFRESH_INTERVAL = 15 * 60 * 1000;

/**
 * AI-generated weather summary powered by Claude.
 * Renders nothing if the Anthropic API key is not configured (feature is optional).
 *
 * @param {object} props
 * @param {boolean} props.expanded Whether the summary is in expanded mode (charts hidden)
 * @param {Function} props.onToggle Callback to toggle expanded state
 * @param {object} props.containerRef Ref forwarded to the root container div
 * @returns {JSX.Element|null} AI summary block, or null if unavailable
 */
const AiSummary = ({ expanded, onToggle, containerRef }) => {
  const {
    mapGeo,
    darkMode,
    aiSummaryAvailable: serverAvailable,
    setAiSummaryAvailable: setAvailable,
    aiSummaryUserVisible,
    tempUnit,
    speedUnit,
    distanceUnit,
  } = useContext(AppContext);
  // See AiSummaryInline for the rationale on splitting server vs.
  // user visibility — same pattern here for the v2 layout's
  // AiSummary panel.
  const available = serverAvailable && aiSummaryUserVisible;
  const { i18n } = useTranslation();
  const [summary, setSummary] = useState(null);
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
        // Unit preferences — server formats prompt values to match and
        // instructs Claude to keep these units throughout its response.
        tempUnit,
        speedUnit,
        distanceUnit,
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
  }, [mapGeo, lang, available, setAvailable, tempUnit, speedUnit, distanceUnit]);

  if (!available || !summary) return null;

  return (
    <div
      ref={containerRef}
      className={`${styles.container} ${darkMode ? styles.dark : styles.light}`}
    >
      <div className={styles.header}>
        <div className={styles.line} />
        <button
          className={`${styles.toggleButton} ${darkMode ? styles.toggleButtonDark : styles.toggleButtonLight}`}
          onClick={onToggle}
        >
          <span className={styles.label}>{LABEL[lang] || LABEL.en}</span>
          <InlineIcon
            icon={expanded ? chevronDown : chevronUp}
            className={styles.chevron}
          />
        </button>
        <div className={styles.line} />
      </div>
      {/* Tolerant split — see AiSummaryInline for rationale. Claude
       * occasionally separates paragraphs with a single \n instead of
       * the prompted \n\n; splitting on `\n+` keeps the rendering
       * resilient to that. */}
      {summary.split(/\n+/).map((p) => p.trim()).filter(Boolean).map((paragraph, i) => (
        <p key={i} className={styles.text}>{paragraph}</p>
      ))}
    </div>
  );
};

AiSummary.propTypes = {
  expanded: PropTypes.bool,
  onToggle: PropTypes.func,
  containerRef: PropTypes.object,
};

// eslint-disable-next-line no-empty-function -- intentional default-prop placeholder; the consumer either passes a real onToggle or the toggle UI is non-functional, both of which are valid.
const noop = () => {};

AiSummary.defaultProps = {
  expanded: false,
  onToggle: noop,
  containerRef: null,
};

export default AiSummary;
