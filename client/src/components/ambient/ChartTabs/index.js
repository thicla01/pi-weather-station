import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { InlineIcon } from "@iconify/react";
import maximize from "@iconify/icons-carbon/maximize";
import minimize from "@iconify/icons-carbon/minimize";
import HourlyChart from "~/components/weatherCharts/HourlyChart";
import DailyForecastColumns from "~/components/ambient/DailyForecastColumns";
import styles from "./styles.css";

/**
 * Direction C chart slab — tabbed switcher between the hourly (24 h)
 * and daily (5 day) forecast charts.
 *
 * The split-into-tabs pattern is the same one v2 uses on small screens
 * (`(max-height: 520px)` media query) — kiosk vertical space is too
 * scarce to show both charts stacked. For Direction C the tabs are
 * unconditional: the right rail is 300/340px wide and a stacked layout
 * would always feel cramped, regardless of viewport height.
 *
 * Maximize toggle (added in v2.14.39): the slab can promote to
 * `position: absolute; inset: 12px` over its rail and emit a stable
 * `data-chart-maximized="true"` data attribute on its root. LayoutDesktop's
 * stylesheet uses `:has([data-chart-maximized="true"])` to detect the
 * maximized state and grow `--c-rail-width` from its default 320 / 360 px
 * to `min(50vw, 720px)`, giving the chart canvas roughly half the screen
 * width and pushing the HeroBand leftward via its existing `right:
 * calc(var(--c-rail-width) * …)` rule. On LayoutPi the rail is already
 * ~half the screen so no width growth is needed; the maximize just hides
 * sibling rail items behind the now-opaque slab. Pattern mirrors
 * AiSummaryInline's maximize.
 *
 * The actual chart components (`HourlyChart`, `DailyForecastColumns`)
 * are reused verbatim — they already use `<ResponsiveContainer>` (or fill
 * their parent box) so the larger chartArea simply gives them more room.
 *
 * @returns {JSX.Element} chart slab with tab header
 */
const ChartTabs = () => {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState("hourly");
  // Maximize mode: the slab pins to its rail's inner bounds so the chart
  // gets the full rail height; on LayoutDesktop the rail also widens via
  // the `:has()` rule keyed off `data-chart-maximized` (see header
  // comment). Local state — the lift-to-context refactor for mutually
  // exclusive Chart/AiSummary maximize will land in a follow-up if the
  // overlap turns out to be common in real use.
  const [maximized, setMaximized] = useState(false);
  const slabRef = useRef(null);

  // Same scroll-rail-to-top trick AiSummaryInline uses on maximize: the
  // absolutely-positioned slab anchors to its rail ancestor's content
  // origin, so if the user scrolled the rail before pressing maximize
  // the slab would render above the viewport and be invisible until
  // the user manually scrolled back up. Walk to the scrollable ancestor
  // and set its scrollTop to 0 whenever we enter maximize mode.
  useEffect(() => {
    if (!maximized || !slabRef.current) return;
    let el = slabRef.current.parentElement;
    while (el && el !== document.body) {
      const overflowY = window.getComputedStyle(el).overflowY;
      if (overflowY === "auto" || overflowY === "scroll") {
        el.scrollTop = 0;
        break;
      }
      el = el.parentElement;
    }
  }, [maximized]);

  const lang = ["fr", "es"].find((l) => i18n.language.startsWith(l)) || "en";
  const maximizeLabel = maximized
    ? { fr: "Restaurer", es: "Restaurar", en: "Restore" }[lang]
    : { fr: "Agrandir", es: "Ampliar", en: "Maximize" }[lang];

  return (
    <div
      ref={slabRef}
      className={`${styles.slab} ${maximized ? styles.slabMaximized : ""}`}
      data-chart-maximized={maximized ? "true" : undefined}
    >
      <div className={styles.tabRow} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "hourly"}
          className={`${styles.tab} ${tab === "hourly" ? styles.active : ""}`}
          onClick={() => setTab("hourly")}
        >
          {t("charts.tab24h", { defaultValue: "24 hours" })}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "daily"}
          className={`${styles.tab} ${tab === "daily" ? styles.active : ""}`}
          onClick={() => setTab("daily")}
        >
          {t("charts.tab5d", { defaultValue: "5 days" })}
        </button>
        <button
          type="button"
          className={styles.actionButton}
          onClick={() => setMaximized((m) => !m)}
          aria-pressed={maximized}
          aria-label={maximizeLabel}
          title={maximizeLabel}
        >
          <InlineIcon icon={maximized ? minimize : maximize} className={styles.actionIcon} />
        </button>
      </div>
      <div className={styles.chartArea}>
        {/* Hourly stays the existing Chart.js line — a temperature
         * curve over 24 h is the right shape for that range. Daily
         * switches to the column strip (DailyForecastColumns):
         * 5 days × {day · icon · high · low · precip %}, mirroring
         * the Claude Design "Next 5 days" mockup. v2 DailyChart is
         * still present in the bundle and used by v2 layouts. */}
        {tab === "hourly" ? <HourlyChart /> : <DailyForecastColumns />}
      </div>
    </div>
  );
};

export default ChartTabs;
