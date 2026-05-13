import React, { useContext } from "react";
import { AppContext } from "~/AppContext";
import WeatherMap from "~/components/WeatherMap";
import HeroCompact from "~/components/ambient/HeroCompact";
import TimeBlock from "~/components/ambient/TimeBlock";
import MetricsGrid from "~/components/ambient/MetricsGrid";
import AlertBanner from "~/components/ambient/AlertBanner";
import AlertDetailInline from "~/components/ambient/AlertDetailInline";
import IndoorBlock from "~/components/ambient/IndoorBlock";
import ChartTabs from "~/components/ambient/ChartTabs";
import AiSummaryInline from "~/components/ambient/AiSummaryInline";
import BottomDock from "~/components/ambient/BottomDock";
import styles from "./styles.css";

/**
 * Direction C layout for the 7"/10" Pi touchscreen.
 *
 * Structure (top to bottom × left to right):
 *   ┌──────────────────────────────┬────────────────────────┐
 *   │                              │  HeroCompact           │
 *   │                              │  AlertBanner           │
 *   │  WeatherMap (full-bleed)     │  AlertDetailInline     │
 *   │                              │  MetricsGrid           │
 *   │                              │  IndoorBlock           │
 *   ├──────────────────────────────┴────────────────────────┤
 *   │  BottomDock                                            │
 *   └────────────────────────────────────────────────────────┘
 *
 * Phase 3a delivers the grid + right-rail composition. The collapse
 * chevron pinned to the map's right edge, the floating mini-banner
 * overlay when the rail is collapsed, the ChartTabs slab, the
 * AiSummaryInline slab, and the extracted RadarTimeline all land in
 * Phase 3b. Reuses the v2 `<WeatherMap />` directly — extracting
 * RadarTimeline from it requires deciding on the timeline anchor
 * first, which is part of 3b.
 *
 * @returns {JSX.Element} Pi layout
 */
const LayoutPi = () => {
  const { darkMode, defaultMapZoom } = useContext(AppContext);

  return (
    <div className={styles.layout}>
      <div className={`${styles.mapArea} map-container ${darkMode ? "map-dark-mode" : ""}`}>
        <WeatherMap zoom={defaultMapZoom} dark={darkMode} />
      </div>
      <aside className={styles.rail}>
        <TimeBlock />
        <HeroCompact />
        <AlertBanner />
        <AlertDetailInline />
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
