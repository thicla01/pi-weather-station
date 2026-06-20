import React, { useContext, useEffect } from "react";
import { UiPrefsContext, SystemContext, AppActionsContext, WeatherDataContext } from "~/AppContext";
import { getAirAlertState } from "~/ui/alertLogic";
import { priorityViewsEnabled } from "~/ui/piLayout";
import WeatherMap from "~/components/WeatherMap";
import ConditionsView from "~/components/ambient/ConditionsView";
import AlertView from "~/components/ambient/AlertView";
import AiView from "~/components/ambient/AiView";
import HeroCompact from "~/components/ambient/HeroCompact";
import TimeBlock from "~/components/ambient/TimeBlock";
import MetricsGrid from "~/components/ambient/MetricsGrid";
import AirCard from "~/components/ambient/AirCard";
import AirAlertCard from "~/components/ambient/AirAlertCard";
import AlertBanner from "~/components/ambient/AlertBanner";
import AlertDetailInline from "~/components/ambient/AlertDetailInline";
import AlertMiniCards from "~/components/ambient/AlertMiniCards";
import IndoorBlock from "~/components/ambient/IndoorBlock";
import ChartTabs from "~/components/ambient/ChartTabs";
import NowcastLine from "~/components/ambient/NowcastLine";
import HeroOverlayMin from "~/components/ambient/HeroOverlayMin";
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
 * v3.2 "3 états radar": one `piLayoutState` enum ("min" | "mid" | "max"
 * | null) drives the shell via `data-pi-state` on the root. MID (default)
 * is the split above — radar map + the lean "radar-companion" rail
 * (alerts · clock · hero/feels-like · NowcastLine · air · 2×2 metrics ·
 * indoor · a "Prévisions" button into MAX); the forecast chart and AI
 * prose are NOT in the glance (the chart lives in MAX). MIN collapses the
 * rail so the radar fills the screen, with HeroOverlayMin + (when an
 * eligible gov alert is active) FloatingMiniBanner pinned over the map and
 * the dock hidden. MAX shrinks the map to a thumbnail and gives the rail's
 * `forecastHost` (ChartTabs, maximized) the screen — reached from the
 * "Prévisions" button or by tapping the NowcastLine, left via the chart's
 * restore button.
 *
 * The sentinel: `piLayoutState` is "mid" on mount / `null` on unmount
 * (mirroring LayoutDesktop). `null` keeps the WeatherMap RadarFocusControl
 * from rendering on other layouts; the derived `piRadarMaximized` boolean
 * shim (MIN ⇔ true) still drives that control's MIN↔MID toggle.
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
  const { piLayoutState, piScrubberOpen } = useContext(SystemContext);
  const { setPiLayoutState, setPiScrubberOpen } = useContext(AppActionsContext);
  const { aqhiInfo } = useContext(WeatherDataContext);

  // v3.2 air-quality alert: escalate to a top-of-rail AIR card only at the
  // health-risk band (high/veryHigh). Computed once here so the inline
  // AirCard's AQ row can be suppressed in the same render — no duplicate
  // AQHI reading (the AIR card carries it, with its own tap-for-detail).
  const airAlert = getAirAlertState(aqhiInfo?.category);

  // v3.3 priority-views model — opt-in/short-7" only. When on, the rail is a
  // compact glance whose Hero ⤢ opens the Conditions view (metrics + indoor
  // move there); off, it's the v3.2 stacked rail (unchanged).
  const priority = priorityViewsEnabled();

  // Sentinel pattern: flip to `false` on mount so WeatherMap renders
  // the Leaflet focus control for this layout, and back to `null` on
  // unmount so the control disappears when the user switches to
  // LayoutDesktop / LayoutMobile (no orphan button on those layouts).
  // Mirrors what LayoutDesktop already does for desktopRadarMaximized.
  useEffect(() => {
    setPiLayoutState("mid");
    return () => setPiLayoutState(null);
  }, [setPiLayoutState]);

  // v3.3 priority: the radar scrubber is a fullscreen-radar (MIN) tool, tracked
  // by the ephemeral `piScrubberOpen` flag (the dock timeline button sets it +
  // maximizes to MIN). Whenever we leave MIN by ANY path (focus square,
  // mini-banner), clear it so the glance never shows the cramped half-width
  // timeline and the next MIN entry via the focus square is clean — the scrubber
  // returns only via its dedicated button. The flag is in-memory only, so this
  // never mutates the shared, persisted `radarTimelineVisible` pref.
  useEffect(() => {
    if (priority && piLayoutState && piLayoutState !== "min" && piScrubberOpen) {
      setPiScrubberOpen(false);
    }
  }, [priority, piLayoutState, piScrubberOpen, setPiScrubberOpen]);

  const focused = piLayoutState === "min";

  return (
    <div
      className={styles.layout}
      data-pi-state={piLayoutState || "mid"}
    >
      <div className={`${styles.mapArea} map-container ${darkMode ? "map-dark-mode" : ""} ${mouseHide ? "map-mouse-hide" : ""}`}>
        <WeatherMap zoom={defaultMapZoom} dark={darkMode} />
        {/* MIN overlays: a compact place/temp hero + (when an eligible
         * gov alert is active) FloatingMiniBanner, both pinned over the
         * fullscreen radar. HeroOverlayMin is purely presentational;
         * tapping the mini-banner restores MID. */}
        {focused && <HeroOverlayMin />}
        {focused && <FloatingMiniBanner onExpand={() => setPiLayoutState("mid")} />}
      </div>
      <aside className={styles.rail} aria-hidden={focused}>
        {/* MID lean panel — the radar's temporal + felt-conditions
         * companion. Hidden in MAX (the forecastHost below takes over).
         * The alert stack leads and returns null in calm weather (so it
         * costs nothing then); the forecast chart and AI prose are
         * deliberately absent from the glance — the chart lives in MAX. */}
        <div className={styles.midPanel}>
          <AlertBanner />
          {/* v3.2 inline expansion — in the v3.3 priority model the alert
            * card opens the full AlertView instead, so drop the inline body. */}
          {!priority && <AlertDetailInline />}
          {/* AlertMiniCards on Pi renders ONLY its "restore N hidden alerts"
           * pill (the mini-card list is dropped — the compact AlertBanner
           * counter cycles instead). Without it a dismissed alert (via the
           * detail footer's "Masquer") was unrecoverable on the 7" until the
           * 4 h auto-resurface. */}
          <AlertMiniCards />
          {/* AIR — air-quality alert card (v3.2). Renders only at the
           * health-risk band; stacks under the gov alert (mockup case 4). */}
          {airAlert && <AirAlertCard alert={airAlert} />}
          <TimeBlock compact />
          {/* shortPhaseName: the 7" rail is too narrow for the full
           * moon-phase string ("Gibbeuse croissante") in the hero
           * meta-line — B4.7 ruling: short family name, no ellipsis. */}
          <HeroCompact
            shortPhaseName
            hideAstro
            hideFeelsLike={priority}
            onMaximize={priority ? () => setPiLayoutState("conditions") : undefined}
          />
          {/* NowcastLine (v3.2 keystone): ALWAYS present — an active radar
           * echo shows the verdict, otherwise a quiet sky-adaptive calm
           * state. Tapping it (the square maximize affordance) is the MID
           * column's single entry into MAX, so there is no separate
           * "Prévisions" button. */}
          <NowcastLine />
          <AirCard suppressAqRow={!!airAlert} />
          {/* Metrics + indoor: in the v3.3 glance these relocate to the
            * Conditions view (the glance stays compact for the font-size
            * budget); the v3.2 stacked rail keeps them inline. */}
          {!priority && <MetricsGrid />}
          {!priority && <IndoorBlock />}
        </div>
        {/* Forecast host — shown only in MAX, where ChartTabs renders its
         * maximized detail view (it reads piLayoutState === "max"). Kept
         * mounted (display:none in MID) so its metric/period state and the
         * auto-tab selector survive the mid↔max round trip. */}
        <div className={styles.forecastHost}>
          <ChartTabs />
        </div>
        {/* v3.3 Conditions view host — mounted alongside the glance, shown
         * only in the "conditions" state (same pattern as forecastHost). */}
        {priority && (
          <div className={styles.conditionsHost}>
            <ConditionsView />
          </div>
        )}
        {/* v3.3 Alert view host — shown only in the "alert" state. */}
        {priority && (
          <div className={styles.alertHost}>
            <AlertView />
          </div>
        )}
        {/* v3.3 IA view host — mounted LAZILY (only in the "ai" state), unlike
          * the always-mounted hosts above: the AI view has no interactive state
          * to preserve, and lazy mount means the paid Anthropic fetch fires on
          * open rather than as background overhead. */}
        {priority && piLayoutState === "ai" && (
          <div className={styles.aiHost}>
            <AiView />
          </div>
        )}
      </aside>
      <BottomDock />
    </div>
  );
};

export default LayoutPi;
