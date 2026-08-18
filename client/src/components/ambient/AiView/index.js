import React, { useContext, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { RestoreIcon } from "~/components/WeatherMap/icons";
import { AppActionsContext } from "~/AppContext";
import useAiSummary from "~/components/hooks/useAiSummary";
import RailSquareButton from "~/components/ambient/RailSquareButton";
import styles from "./styles.css";

// The radar paragraph's leading label, per language — Claude is instructed to
// open the third paragraph with exactly this (see aiSummaryCtrl's
// CALM_RADAR_BY_LANG / the prompt prefix). We strip it because the section
// already carries a "Analyse radar" heading, so keeping the inline prefix
// would read redundantly ("Analyse radar — Analyse radar : …").
const RADAR_PREFIX = /^(analyse radar|radar analysis|análisis radar)\s*:\s*/i;

// Server-derived forecast period kinds → their own i18n title key under
// aiView.period. Any other value (incl. null) falls back to the generic
// "next period" label.
const KNOWN_PERIODS = ["evening", "overnight", "tomorrow"];

/**
 * Split the raw Claude summary string into the three priority-view sections.
 *
 * The summary is up to three paragraphs (blank-line separated, but tolerant of
 * a single newline — same split as AiSummaryInline): current conditions, the
 * forecast period, and the radar analysis. The radar paragraph is identified by
 * its language-specific prefix (not by position) so a missing forecast doesn't
 * mislabel it; the prefix is stripped from the body. Anything beyond the first
 * non-radar paragraph folds into the forecast section so no text is dropped.
 *
 * The first two sections are titled by their REAL period name — "Now" for the
 * current conditions, and the concrete forecast period ("This evening" /
 * "Overnight" / "Tomorrow", from the server's `period` kind) for the second —
 * rather than the generic "Current/Next period".
 *
 * @param {string} summary raw multi-paragraph summary text
 * @param {(key: string, opts?: object) => string} t i18next translate — called with a key and
 *   an optional `{ defaultValue }` bag; returns the localized string
 * @param {?string} period server-derived forecast period kind
 * @returns {{key: string, title: string, text: string}[]} ordered sections
 */
function splitSummary(summary, t, period) {
  const paras = summary.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  const radarIdx = paras.findIndex((p) => RADAR_PREFIX.test(p));
  // Radar is the last section by prompt contract, so take everything from its
  // labelled paragraph onward as the radar body (stripping the label) — this way
  // a stray internal newline that splits the radar paragraph doesn't leak its
  // tail into the forecast section. Paragraphs before it are current/forecast.
  const radar = radarIdx >= 0
    ? paras.slice(radarIdx).join("\n\n").replace(RADAR_PREFIX, "").trim()
    : null;
  const rest = radarIdx >= 0 ? paras.slice(0, radarIdx) : paras;

  const nextTitle = KNOWN_PERIODS.includes(period)
    ? t(`aiView.period.${period}`)
    : t("aiView.nextPeriod", { defaultValue: "Next period" });

  const sections = [];
  if (rest[0]) {
    sections.push({ key: "current", title: t("aiView.now", { defaultValue: "Now" }), text: rest[0] });
  }
  const next = rest.slice(1).join("\n\n");
  if (next) {
    sections.push({ key: "next", title: nextTitle, text: next });
  }
  if (radar) {
    sections.push({ key: "radar", title: t("aiView.radar", { defaultValue: "Radar analysis" }), text: radar });
  }
  return sections;
}

/**
 * v3.3 IA priority view — the Claude weather summary as a full-rail surface,
 * reached from the dock's IA button on the 7" kiosk (the button was a dead
 * toggle in the priority model since the AI prose was dropped from the glance).
 *
 * Mounted lazily (LayoutPi renders it only in the "ai" state) so the paid
 * Anthropic call fires on demand via `useAiSummary`, not as background
 * overhead. Presents the summary's three paragraphs as labelled sections titled
 * by their real period — Now / [this evening|overnight|tomorrow] / Radar
 * analysis — with a loading state for the first fetch and an "unavailable"
 * fallback when the key is missing or a fetch fails.
 *
 * @returns {JSX.Element} the IA view
 */
const AiView = () => {
  const { setPiLayoutState } = useContext(AppActionsContext);
  const { t } = useTranslation();
  const { summary, available, period, errored } = useAiSummary();
  const sections = useMemo(() => (summary ? splitSummary(summary, t, period) : []), [summary, t, period]);

  return (
    <div className={styles.view}>
      <div className={styles.header}>
        <span className={styles.title}>{t("aiView.title", { defaultValue: "AI summary" })}</span>
        <RailSquareButton
          icon={RestoreIcon}
          onClick={() => setPiLayoutState("mid")}
          ariaLabel={t("aiView.back", { defaultValue: "Back to overview" })}
          className={styles.minimize}
        />
      </div>
      <div className={styles.body}>
        {!available || (errored && !summary) ? (
          <p className={styles.state}>
            {t("aiView.unavailable", { defaultValue: "AI summary unavailable." })}
          </p>
        ) : !summary ? (
          <p className={styles.state}>
            {t("aiView.loading", { defaultValue: "Generating summary…" })}
          </p>
        ) : (
          sections.map((s) => (
            <section key={s.key} className={styles.section}>
              <h3 className={styles.sectionTitle}>{s.title}</h3>
              <p className={styles.sectionText}>{s.text}</p>
            </section>
          ))
        )}
      </div>
    </div>
  );
};

export default AiView;
