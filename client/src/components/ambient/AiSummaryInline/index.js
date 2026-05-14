import React, { useEffect, useState, useContext, useRef } from "react";
import { useTranslation } from "react-i18next";
import { InlineIcon } from "@iconify/react";
import chevronUp from "@iconify/icons-carbon/chevron-up";
import chevronDown from "@iconify/icons-carbon/chevron-down";
import maximize from "@iconify/icons-carbon/maximize";
import minimize from "@iconify/icons-carbon/minimize";
import axios from "axios";
import { AppContext } from "~/AppContext";
import styles from "./styles.css";

const LABEL = { en: "AI SUMMARY", fr: "RÉSUMÉ IA", es: "RESUMEN IA" };

const REFRESH_INTERVAL = 15 * 60 * 1000;

/**
 * Direction C AI weather summary slab.
 *
 * Same fetch + refresh contract as the v2 `AiSummary`: hits
 * `/api/weather-summary` with lat/lon + unit preferences, refreshes
 * every 15 minutes, and silently hides itself when the server returns
 * 503 (Anthropic key not configured). The duplication will be
 * collapsed into a shared `useAiSummary()` hook in Phase 10 cleanup.
 *
 * Visual treatment: collapsed by default to keep the right rail
 * compact on the 7" screen, expanded shows three paragraphs. The
 * collapse chevron is part of the slab header (different from v2 where
 * the toggle drove the chart vs summary swap — Phase 3b decouples them
 * because ChartTabs lives independently now).
 *
 * @returns {JSX.Element|null} AI summary slab, or null when feature is unavailable
 */
const AiSummaryInline = () => {
  const {
    mapGeo,
    aiSummaryAvailable: available,
    setAiSummaryAvailable: setAvailable,
    tempUnit,
    speedUnit,
    distanceUnit,
  } = useContext(AppContext);
  const { i18n } = useTranslation();
  const [summary, setSummary] = useState(null);
  const [expanded, setExpanded] = useState(true);
  // Maximize mode: the slab promotes to position:absolute over the
  // rail so the body has the entire rail height to itself. Restores
  // to flex-flow when toggled off. Distinct from `expanded` so the
  // user can still collapse the body while in either layout.
  const [maximized, setMaximized] = useState(false);
  const intervalRef = useRef(null);

  const lang = ["fr", "es"].find((l) => i18n.language.startsWith(l)) || "en";

  useEffect(() => {
    if (!mapGeo || !available) return undefined;

    const fetchSummary = () => {
      const now = new Date();
      const localHour = now.getHours();
      const ts18 = new Date(now); ts18.setHours(18, 0, 0, 0);
      const ts21 = new Date(now); ts21.setHours(21, 0, 0, 0);
      const ts05tomorrow = new Date(now);
      ts05tomorrow.setDate(ts05tomorrow.getDate() + 1);
      ts05tomorrow.setHours(5, 0, 0, 0);

      const params = new URLSearchParams({
        lat: mapGeo.latitude,
        lon: mapGeo.longitude,
        lang,
        localHour,
        ts18: ts18.getTime(),
        ts21: ts21.getTime(),
        ts05tomorrow: ts05tomorrow.getTime(),
        tempUnit,
        speedUnit,
        distanceUnit,
      });

      axios
        .get(`/api/weather-summary?${params}`)
        .then((res) => setSummary(res.data.summary))
        .catch((err) => {
          if (err?.response?.status === 503) {
            // Feature gated server-side (no Anthropic key) — hide.
            setAvailable(false);
          }
          // Other errors: keep the last known summary on screen.
        });
    };

    fetchSummary();
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(fetchSummary, REFRESH_INTERVAL);
    return () => clearInterval(intervalRef.current);
  }, [mapGeo, lang, available, setAvailable, tempUnit, speedUnit, distanceUnit]);

  if (!available || !summary) return null;

  return (
    <div className={`${styles.slab} ${maximized ? styles.slabMaximized : ""}`}>
      <div className={styles.header}>
        <button
          type="button"
          className={styles.toggle}
          onClick={() => setExpanded((p) => !p)}
          aria-expanded={expanded}
        >
          <span className={styles.label}>{LABEL[lang] || LABEL.en}</span>
        </button>
        <div className={styles.headerActions}>
          {/* Maximize / restore — promotes the slab to absolute-
           * positioned overlay over the rail so the body gets the
           * full rail height. Only meaningful when there's a body to
           * see, so we hide it when the slab is collapsed. */}
          {expanded ? (
            <button
              type="button"
              className={styles.actionButton}
              onClick={() => setMaximized((m) => !m)}
              aria-pressed={maximized}
              aria-label={maximized
                ? (lang === "fr" ? "Restaurer" : "Restore")
                : (lang === "fr" ? "Agrandir" : "Maximize")}
              title={maximized
                ? (lang === "fr" ? "Restaurer" : "Restore")
                : (lang === "fr" ? "Agrandir" : "Maximize")}
            >
              <InlineIcon
                icon={maximized ? minimize : maximize}
                className={styles.chevron}
              />
            </button>
          ) : null}
          <button
            type="button"
            className={styles.actionButton}
            onClick={() => setExpanded((p) => !p)}
            aria-expanded={expanded}
            aria-label={expanded
              ? (lang === "fr" ? "Replier" : "Collapse")
              : (lang === "fr" ? "Déplier" : "Expand")}
          >
            <InlineIcon
              icon={expanded ? chevronUp : chevronDown}
              className={styles.chevron}
            />
          </button>
        </div>
      </div>
      {expanded ? (
        <div className={styles.body}>
          {/* Tolerant split: Claude is *supposed* to separate paragraphs
           * with a blank line (\n\n per the prompt), but in practice it
           * sometimes drops to a single \n — the Debug snapshot's <pre>
           * still renders that as visually-distinct lines, which masks
           * the bug until somebody notices that the AiSummary slab
           * shows one giant run-on paragraph. Splitting on `\n+` and
           * dropping empties handles both shapes without ping-ponging
           * with the model. */}
          {summary.split(/\n+/).map((p) => p.trim()).filter(Boolean).map((paragraph, i) => (
            <p key={i} className={styles.text}>{paragraph}</p>
          ))}
        </div>
      ) : null}
    </div>
  );
};

export default AiSummaryInline;
