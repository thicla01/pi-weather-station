import React, { useContext, useEffect } from "react";
import { UiPrefsContext, SystemContext, AppActionsContext } from "~/AppContext";
import WeatherMap from "~/components/WeatherMap";
import HeroCompact from "~/components/ambient/HeroCompact";
import TimeBlock from "~/components/ambient/TimeBlock";
import MetricsGrid from "~/components/ambient/MetricsGrid";
import AirCard from "~/components/ambient/AirCard";
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
 *   │ RadarFocusControl (Leaflet,  │  HeroCompact           │
 *   │  top-left under +/-)         │  AlertBanner           │
 *   │  WeatherMap (full-bleed)     │  AlertDetailInline     │
 *   │                              │  AirCard               │
 *   │                              │  MetricsGrid           │
 *   │                              │  IndoorBlock           │
 *   │                              │  ChartTabs             │
 *   │                              │  AiSummaryInline       │
 *   ├──────────────────────────────┴────────────────────────┤
 *   │  BottomDock                                            │
 *   └────────────────────────────────────────────────────────┘
 *
 * Focus mode (toggled by the Leaflet RadarFocusControl in WeatherMap's
 * topleft control bar, sitting under the zoom +/- buttons) hides the
 * entire rail so the radar fills the available column. `piRadarMaximized`
 * carries the state — flipped to `false` on mount and back to `null` on
 * unmount, mirroring the LayoutDesktop sentinel pattern. The
 * RadarFocusControl renders only when one of `piRadarMaximized` or
 * `desktopRadarMaximized` is non-null, and routes its toggle to whichever
 * is active.
 *
 * Legacy note (2026-05-28 consolidation): the right-edge chevron that
 * used to toggle `infoPanelCollapsed` was removed in favour of the
 * shared RadarFocusControl. The chevron's tactile sticky-hover (audit
 * finding B2) disappeared mechanically because the component no longer
 * exists. `infoPanelCollapsed` still lives in AppContext for v2
 * InfoPanel back-compat but no longer carries any v3 LayoutPi role.
 *
 * When focus mode is on AND there's an eligible government alert,
 * `FloatingMiniBanner` overlays on the map's top-right so the kiosk
 * doesn't silently hide a severe alert. Tapping the mini-banner exits
 * focus mode (full UI returns; cycle controls become reachable again).
 *
 * RadarTimeline extraction is deferred — the scrubber currently
 * inlined inside `WeatherMap` already renders correctly inside the
 * map cell. Lifting it into its own ambient component is a Phase 10
 * cleanup item; functionally it's already where it should be.
 *
 * @returns {JSX.Element} Pi layout
 */
const LayoutPi = () => {
  const { darkMode, defaultMapZoom, mouseHide } = useContext(UiPrefsContext);
  const { piRadarMaximized } = useContext(SystemContext);
  const { setPiRadarMaximized } = useContext(AppActionsContext);

  // Sentinel pattern: flip to `false` on mount so WeatherMap renders
  // the Leaflet focus control for this layout, and back to `null` on
  // unmount so the control disappears when the user switches to
  // LayoutDesktop / LayoutMobile (no orphan button on those layouts).
  // Mirrors what LayoutDesktop already does for desktopRadarMaximized.
  useEffect(() => {
    setPiRadarMaximized(false);
    return () => setPiRadarMaximized(null);
  }, [setPiRadarMaximized]);

  const focused = piRadarMaximized === true;

  return (
    <div
      className={`${styles.layout} ${focused ? styles.focused : ""}`}
    >
      <div className={`${styles.mapArea} map-container ${darkMode ? "map-dark-mode" : ""} ${mouseHide ? "map-mouse-hide" : ""}`}>
        <WeatherMap zoom={defaultMapZoom} dark={darkMode} />
        {focused && <FloatingMiniBanner onExpand={() => setPiRadarMaximized(false)} />}
      </div>
      <aside className={styles.rail} aria-hidden={focused}>
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
        {/* shortPhaseName: the 7" rail is too narrow for the full
         * moon-phase string ("Gibbeuse croissante") in the hero
         * meta-line — B4.7 ruling: short family name, no ellipsis. */}
        <HeroCompact shortPhaseName />
        <AirCard />
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
