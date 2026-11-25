import React, { useCallback, useContext, useMemo } from "react";
import PropTypes from "prop-types";
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
 * Upper-case the first character of a section body. Stripping the radar label
 * leaves the sentence that followed the colon, which French and Spanish (and
 * often English) write lower-case after a colon — correct inline, but once the
 * label becomes a section heading the body reads as a sentence that opens in
 * lower case ("les précipitations…").
 *
 * @param {string} text section body
 * @returns {string} the body with its first character upper-cased
 */
function capitalizeFirst(text) {
  return text ? text.charAt(0).toLocaleUpperCase() + text.slice(1) : text;
}

/**
 * Split the raw Claude summary string into the three priority-view sections.
 *
 * The summary is up to three paragraphs (blank-line separated, but tolerant of
 * a single newline — same split as AiSummaryInline): current conditions, the
 * forecast period, and the radar analysis. The radar paragraph is identified by
 * its language-specific prefix (not by position) so a missing forecast doesn't
 * mislabel it; the prefix is stripped from the body, whose first letter is then
 * upper-cased (see `capitalizeFirst`). Anything beyond the first
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
    ? capitalizeFirst(paras.slice(radarIdx).join("\n\n").replace(RADAR_PREFIX, "").trim())
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
 * reached from the dock's IA button on every Pi panel — the 7" priority model
 * and, since 2026-10, the taller 10.1" panels' v3.2 stacked rail (neither rail
 * shows the AI prose inline, so without this view the summary is unreadable).
 *
 * Mounted lazily (LayoutPi's grid shell renders it only in the "ai" state)
 * so the paid Anthropic call fires on demand via `useAiSummary`, not as
 * background overhead. (The overlay shell mounts it at all times and gates the
 * call on `active` instead.) Presents the summary's three paragraphs as labelled sections titled
 * by their real period — Now / [this evening|overnight|tomorrow] / Radar
 * analysis — with a loading state for the first fetch and an "unavailable"
 * fallback when a fetch fails (no summary yet) or the server answers its
 * no-key 503. A failure that is not "no key" — the transient "no weather
 * data" 502 among them — keeps an already-shown summary, and the next poll
 * retries. A missing key is normally caught before the view can open: the
 * boot settings read (local raw value or remote masked boolean alike)
 * clears `aiSummaryAvailable`, which hides the dock's IA button. A keyless
 * "unavailable" therefore shows only when the 503 is the first signal (a
 * settings.json edited after boot, or a failed boot settings read) or when
 * the key is cleared in Settings while the view is open.
 *
 * @param {object} props
 * @param {boolean} [props.active] Overlay shell only: LayoutPi's overlay
 *   shell keeps this view mounted at all times, in a host skipped by
 *   `content-visibility: hidden` outside the "ai" state, and passes true
 *   only in that state: the summary is requested (and polled) only while
 *   it is true, from the tap's own commit, and turning false clears it,
 *   so the next opening shows the loading caption, as a fresh mount does,
 *   never the previous summary (useAiSummary `active`). Defaults to true
 *   (always so elsewhere: the lazy mount is the gate).
 * @param {boolean} [props.replyReady] Overlay shell only: the shell's
 *   view opens under a sheet that then slides in. The summary request
 *   starts at once, as elsewhere; it passes false until the opening has
 *   settled (the sheet landed, the map recentred under it), and the reply
 *   is held outside React state until then (useAiSummary `ready`), so
 *   even an instant reply renders no frame inside the slide — the loading
 *   caption shows meanwhile. Defaults to true (always so elsewhere).
 *
 * Exported through React.memo: the overlay shell keeps this view mounted in
 * every state, and LayoutPi re-renders at each switch, so without memo every
 * view switch would re-render it, while closed, with the same two props.
 * Memoized, it renders for its own state only — the "ai" opening
 * (`active`), its settle (`replyReady`) and its close — and for its own
 * subscriptions (the summary's state, the language, the contexts
 * useAiSummary reads); still mounted, so the paint prewarm and the opening
 * in the tap's own commit are unchanged. Elsewhere it renders only in the
 * "ai" state anyway.
 * @returns {JSX.Element} the IA view
 */
const AiView = ({ active = true, replyReady = true }) => {
  const { setPiLayoutState } = useContext(AppActionsContext);
  const { t } = useTranslation();
  const { summary, available, period, errored } = useAiSummary(replyReady, active);
  const sections = useMemo(() => (summary ? splitSummary(summary, t, period) : []), [summary, t, period]);
  // The back button, one element while its handler and label hold, across
  // the renders of this view's own state (the opening, its settle, the
  // reply, the close).
  const back = useCallback(() => setPiLayoutState("mid"), [setPiLayoutState]);
  const backLabel = t("aiView.back", { defaultValue: "Back to overview" });
  const backButton = useMemo(() => (
    <RailSquareButton
      icon={RestoreIcon}
      back
      onClick={back}
      ariaLabel={backLabel}
      className={styles.minimize}
    />
  ), [back, backLabel]);

  return (
    <div className={styles.view}>
      <div className={styles.header}>
        <span className={styles.title}>{t("aiView.title", { defaultValue: "AI summary" })}</span>
        {backButton}
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

AiView.propTypes = {
  active: PropTypes.bool,
  replyReady: PropTypes.bool,
};

export default React.memo(AiView);
