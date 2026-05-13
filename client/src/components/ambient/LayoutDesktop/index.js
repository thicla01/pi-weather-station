import React, { useContext } from "react";
import { useTranslation } from "react-i18next";
import { InlineIcon } from "@iconify/react";
import chevronLeft from "@iconify/icons-carbon/chevron-left";
import chevronRight from "@iconify/icons-carbon/chevron-right";
import { AppContext } from "~/AppContext";
import WeatherMap from "~/components/WeatherMap";
import HeroBand from "~/components/ambient/HeroBand";
import MetricsGrid from "~/components/ambient/MetricsGrid";
import AlertBanner from "~/components/ambient/AlertBanner";
import AlertDetailInline from "~/components/ambient/AlertDetailInline";
import IndoorBlock from "~/components/ambient/IndoorBlock";
import ChartTabs from "~/components/ambient/ChartTabs";
import AiSummaryInline from "~/components/ambient/AiSummaryInline";
import BottomDock from "~/components/ambient/BottomDock";
import FloatingMiniBanner from "~/components/ambient/FloatingMiniBanner";
import styles from "./styles.css";

/**
 * Direction C layout for desktop / HD viewports (≥ 1280 px wide).
 *
 * Composition fundamentals diverge from `LayoutPi`:
 *
 *   ┌────────────────────────────────────────────┬──────────────┐
 *   │ HeroBand (location · temp · clock)         │              │
 *   ├────────────────────────────────────────────┤  Right rail  │
 *   │                                            │              │
 *   │  WeatherMap (full-bleed behind everything) │  (overlays)  │
 *   │                                            │              │
 *   │           [chevron]                        │              │
 *   ├────────────────────────────────────────────┴──────────────┤
 *   │  BottomDock                                                │
 *   └────────────────────────────────────────────────────────────┘
 *
 * The map fills the entire main area as the background layer; the
 * HeroBand and the right rail are translucent slabs that float on top
 * of the radar so the kiosk feels like an ambient display rather than
 * a partitioned dashboard. Two breakpoints (≥ 1280 px and ≥ 1600 px)
 * grow the rail width and the hero font sizes so the layout reads
 * proportional on both HD monitors and larger displays.
 *
 * Collapse / mini-banner story mirrors LayoutPi exactly: chevron
 * pinned to the map's right edge toggles `infoPanelCollapsed`, which
 * also drives v2's MapResizer and so Leaflet re-fits the canvas for
 * free when the rail folds away.
 *
 * @returns {JSX.Element} desktop layout
 */
const LayoutDesktop = () => {
  const { t } = useTranslation();
  const {
    darkMode,
    defaultMapZoom,
    infoPanelCollapsed,
    setInfoPanelCollapsed,
  } = useContext(AppContext);

  const collapsed = Boolean(infoPanelCollapsed);
  const toggleCollapse = () => setInfoPanelCollapsed(!collapsed);

  return (
    <div className={`${styles.layout} ${collapsed ? styles.collapsed : ""}`}>
      {/* Full-bleed map fills the entire main area as the background. */}
      <div className={`${styles.mapArea} map-container ${darkMode ? "map-dark-mode" : ""}`}>
        <WeatherMap zoom={defaultMapZoom} dark={darkMode} />
      </div>

      {/* HeroBand pinned to the top-left, leaving the rail's column
          free on the right. */}
      <div className={styles.heroSlot}>
        <HeroBand />
      </div>

      {/* Floating mini-banner overlays the map area when the rail is
          folded and a severe gov alert is active. */}
      {collapsed && <FloatingMiniBanner onExpand={toggleCollapse} />}

      {/* Chevron toggle on the map's right edge. */}
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

      {/* Right rail — overlays the map on the right edge. Translucent
          surface inherits from the active palette so the radar shows
          through subtly. */}
      <aside className={styles.rail} aria-hidden={collapsed}>
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

export default LayoutDesktop;
