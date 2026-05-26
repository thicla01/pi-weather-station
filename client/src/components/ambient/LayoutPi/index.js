import React, { useContext } from "react";
import { useTranslation } from "react-i18next";
import { InlineIcon } from "@iconify/react";
import chevronLeft from "@iconify/icons-carbon/chevron-left";
import chevronRight from "@iconify/icons-carbon/chevron-right";
import { AppContext } from "~/AppContext";
import WeatherMap from "~/components/WeatherMap";
import HeroCompact from "~/components/ambient/HeroCompact";
import TimeBlock from "~/components/ambient/TimeBlock";
import MetricsGrid from "~/components/ambient/MetricsGrid";
import AlertBanner from "~/components/ambient/AlertBanner";
import AlertDetailInline from "~/components/ambient/AlertDetailInline";
import AlertMiniCards from "~/components/ambient/AlertMiniCards";
import IndoorBlock from "~/components/ambient/IndoorBlock";
import ChartTabs from "~/components/ambient/ChartTabs";
import AiSummaryInline from "~/components/ambient/AiSummaryInline";
import BottomDock from "~/components/ambient/BottomDock";
import FloatingMiniBanner from "~/components/ambient/FloatingMiniBanner";
import styles from "./styles.css";

/**
 * Direction C layout for the 7"/10" Pi touchscreen.
 *
 * Structure (top to bottom × left to right):
 *   ┌──────────────────────────────┬────────────────────────┐
 *   │ FloatingMiniBanner (overlay) │  TimeBlock             │
 *   │                              │  HeroCompact           │
 *   │  WeatherMap (full-bleed)     │  AlertBanner           │
 *   │                              │  AlertDetailInline     │
 *   │                              │  MetricsGrid           │
 *   │           [chevron]          │  IndoorBlock           │
 *   │                              │  ChartTabs             │
 *   │                              │  AiSummaryInline       │
 *   ├──────────────────────────────┴────────────────────────┤
 *   │  BottomDock                                            │
 *   └────────────────────────────────────────────────────────┘
 *
 * The rail is collapsible via a chevron pinned to the map's right
 * edge. Collapse state lives in `infoPanelCollapsed` on AppContext —
 * deliberately shared with the v2 InfoPanel toggle so WeatherMap's
 * existing `MapResizer` reacts to either entry point and re-fits the
 * Leaflet canvas after the column width changes.
 *
 * When the rail is collapsed AND there's an eligible government
 * alert, `FloatingMiniBanner` overlays on the map's top-right so the
 * kiosk doesn't silently hide a severe alert. Tapping the mini-banner
 * re-opens the rail (full UI returns; cycle controls become reachable
 * again).
 *
 * RadarTimeline extraction is deferred — the scrubber currently
 * inlined inside `WeatherMap` already renders correctly inside the
 * map cell. Lifting it into its own ambient component is a Phase 10
 * cleanup item; functionally it's already where it should be.
 *
 * @returns {JSX.Element} Pi layout
 */
const LayoutPi = () => {
  const { t } = useTranslation();
  const {
    darkMode,
    defaultMapZoom,
    infoPanelCollapsed,
    setInfoPanelCollapsed,
    mouseHide,
  } = useContext(AppContext);

  const collapsed = Boolean(infoPanelCollapsed);
  const toggleCollapse = () => setInfoPanelCollapsed(!collapsed);

  return (
    <div
      className={`${styles.layout} ${collapsed ? styles.collapsed : ""}`}
    >
      <div className={`${styles.mapArea} map-container ${darkMode ? "map-dark-mode" : ""} ${mouseHide ? "map-mouse-hide" : ""}`}>
        <WeatherMap zoom={defaultMapZoom} dark={darkMode} />
        {collapsed && <FloatingMiniBanner onExpand={toggleCollapse} />}
        <button
          type="button"
          className={styles.chevron}
          onClick={toggleCollapse}
          aria-label={t(collapsed ? "controls.expandPanel" : "controls.collapsePanel", {
            defaultValue: collapsed ? "Expand panel" : "Collapse panel",
          })}
          title={t(collapsed ? "controls.expandPanel" : "controls.collapsePanel", {
            defaultValue: collapsed ? "Expand panel" : "Collapse panel",
          })}
        >
          <InlineIcon icon={collapsed ? chevronLeft : chevronRight} />
        </button>
      </div>
      <aside className={styles.rail} aria-hidden={collapsed}>
        <TimeBlock />
        {/* AlertBanner + AlertDetailInline kept together at the top
         * of the rail (just under TimeBlock, ABOVE HeroCompact).
         * Restores parity with v2 InfoPanel where gov alerts sat in
         * the .alertArea div between the Clock and CurrentWeather.
         * Both components return null when no eligible alert is
         * active, so this position is invisible in calm weather —
         * no layout cost. When something fires, the alert reads as
         * the highest-priority piece of info in the rail rather
         * than sitting below the location + temperature card. */}
        <AlertBanner />
        <AlertDetailInline />
        <AlertMiniCards />
        <HeroCompact />
        <MetricsGrid />
        <IndoorBlock />
        <ChartTabs />
        <AiSummaryInline />
      </aside>
      <BottomDock />
    </div>
  );
};

export default LayoutPi;
