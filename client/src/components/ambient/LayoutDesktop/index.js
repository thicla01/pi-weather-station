import React, { useContext, useEffect } from "react";
import { UiPrefsContext, SystemContext, AppActionsContext } from "~/AppContext";
import WeatherMap from "~/components/WeatherMap";
import HeroBand from "~/components/ambient/HeroBand";
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
 *   │  RadarFocusControl (Leaflet topleft)       │              │
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
 * Focus mode (toggled by the Leaflet RadarFocusControl in WeatherMap's
 * topleft control bar, sitting under the zoom +/- buttons) hides
 * HeroBand + the right rail so the radar fills the entire viewport.
 * `desktopRadarMaximized` carries the state — flipped to `false` on
 * mount and back to `null` on unmount so the focus control disappears
 * when the user switches to LayoutPi / LayoutMobile.
 *
 * Legacy note (2026-05-28 consolidation): the right-edge chevron that
 * used to toggle `infoPanelCollapsed` was removed in favour of the
 * shared RadarFocusControl. The chevron's tactile sticky-hover (audit
 * finding B2) disappeared mechanically because the component no longer
 * exists. `infoPanelCollapsed` still lives in AppContext for v2
 * InfoPanel back-compat but no longer carries any v3 LayoutDesktop
 * role.
 *
 * When focus mode is on AND there's an eligible government alert,
 * `FloatingMiniBanner` overlays on the map's top-right so the kiosk
 * doesn't silently hide a severe alert. Tapping the banner in focus
 * mode exits focus AND re-opens the rail so the full alert detail is
 * one tap away.
 *
 * @returns {JSX.Element} desktop layout
 */
const LayoutDesktop = () => {
  const { darkMode, defaultMapZoom, mouseHide } = useContext(UiPrefsContext);
  const { desktopRadarMaximized } = useContext(SystemContext);
  const { setDesktopRadarMaximized } = useContext(AppActionsContext);

  // Sentinel pattern: flip to `false` on mount so the Leaflet focus
  // control inside WeatherMap renders, and back to `null` on unmount
  // so the control disappears when the user switches to LayoutPi /
  // LayoutMobile (no orphaned button on those layouts). LayoutPi
  // mirrors this for piRadarMaximized.
  useEffect(() => {
    setDesktopRadarMaximized(false);
    return () => setDesktopRadarMaximized(null);
  }, [setDesktopRadarMaximized]);

  const focused = desktopRadarMaximized === true;

  return (
    <div className={`${styles.layout} ${focused ? styles.focused : ""}`}>
      {/* Full-bleed map fills the entire main area as the background. */}
      <div className={`${styles.mapArea} map-container ${darkMode ? "map-dark-mode" : ""} ${mouseHide ? "map-mouse-hide" : ""}`}>
        <WeatherMap zoom={defaultMapZoom} dark={darkMode} />
      </div>

      {/* HeroBand pinned to the top-left, leaving the rail's column
          free on the right. The `data-ambient-hero` attribute is a
          stable hook for WeatherMap's `useRailOffset` so it can
          measure the actual rendered HeroBand height and push the
          marker visually down past it without hardcoding pixel values
          that would drift if the slab ever changes height. */}
      <div className={styles.heroSlot} data-ambient-hero>
        <HeroBand />
      </div>

      {/* Floating mini-banner overlays the map area whenever the
          radar focus mode is on AND a red/orange gov alert is active.
          Severe-alert visibility is a kiosk-grade safety property —
          we should never make the user blind to an active Tornado
          Warning just because they're zoomed into the radar. Tapping
          the banner exits focus mode so the full alert detail is one
          tap away. */}
      {focused && (
        <FloatingMiniBanner
          onExpand={() => setDesktopRadarMaximized(false)}
        />
      )}

      {/* Right rail — overlays the map on the right edge. Translucent
          surface inherits from the active palette so the radar shows
          through subtly. */}
      <aside className={styles.rail} aria-hidden={focused}>
        <AlertBanner />
        <AlertDetailInline />
        <AlertMiniCards />
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

export default LayoutDesktop;
