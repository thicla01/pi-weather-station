import React, { useState } from "react";
import { useTranslation } from "react-i18next";
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
 * The actual chart components (`HourlyChart`, `DailyChart`) are reused
 * verbatim from v2 — they're already Chart.js wrappers that read the
 * data and unit preferences from AppContext, so plugging them into a
 * new container "just works". Phase 10 cleanup will give them a
 * Direction C makeover (warm-grey grid lines, Geist font on axis
 * labels, etc.) but the wiring stays the same.
 *
 * @returns {JSX.Element} chart slab with tab header
 */
const ChartTabs = () => {
  const { t } = useTranslation();
  const [tab, setTab] = useState("hourly");

  return (
    <div className={styles.slab}>
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
