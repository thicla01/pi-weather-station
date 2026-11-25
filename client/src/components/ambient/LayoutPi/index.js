import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { UiPrefsContext, PiLayoutContext, AppActionsContext, WeatherDataContext } from "~/AppContext";
import { getAirAlertState } from "~/ui/alertLogic";
import { isPiMaxView, piShellVariant, priorityViewsEnabled } from "~/ui/piLayout";
import { piShellForm, piShellRootAttributes, scrubberFlagClears } from "~/ui/piShellGeometry";
import { createShellElements } from "~/ui/shellElements";
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
import BottomDock from "~/components/ambient/BottomDock";
import FloatingMiniBanner from "~/components/ambient/FloatingMiniBanner";
import useShellTiming from "./useShellTiming";
import useHostWarmup from "./useHostWarmup";
import usePressTint from "./usePressTint";
import useTouchCancel from "./useTouchCancel";
import styles from "./styles.css";

// No view host to lay out and paint ahead (useHostWarmup): off the overlay
// shell, or without the priority views (no conditions or alert host).
const NO_WARM_HOSTS = Object.freeze([]);

/**
 * Direction C layout for the 7"/10" Pi touchscreen.
 *
 * Structure (top to bottom × left to right):
 *   ┌──────────────────────────────┬────────────────────────┐
 *   │ FloatingMiniBanner (overlay) │  AlertBanner           │
 *   │ RadarFocusControl (overlay,  │  AlertDetailInline †   │
 *   │  top-left under +/-)         │  AlertMiniCards        │
 *   │  WeatherMap (full-bleed)     │  AirAlertCard          │
 *   │                              │  TimeBlock             │
 *   │                              │  HeroCompact           │
 *   │                              │  NowcastLine           │
 *   │                              │  AirCard               │
 *   │                              │  MetricsGrid †         │
 *   │                              │  IndoorBlock †         │
 *   │                              │  (ChartTabs: MAX only) │
 *   │                              │  (ConditionsView ‡)    │
 *   │                              │  (AlertView ‡)         │
 *   │                              │  (AiView: "ai" only)   │
 *   ├──────────────────────────────┴────────────────────────┤
 *   │  BottomDock                                           │
 *   └───────────────────────────────────────────────────────┘
 *   The first four rail rows are the alert stack. † v3.2 stacked rail
 *   only. ‡ v3.3 priority views only (shown in the "conditions" /
 *   "alert" state).
 *
 * v3.2 "3 états radar": one `piLayoutState` enum ("min" | "mid" | "max"
 * | null) drives the shell via `data-pi-state` on the root. MID (default)
 * is the split above — radar map + the lean "radar-companion" rail
 * (alerts · clock · hero/feels-like · NowcastLine · air · 2×2 metrics ·
 * indoor); the forecast chart and AI
 * prose are NOT in the glance (the chart lives in MAX). MIN collapses the
 * rail so the radar fills the screen — a pure radar focus with no hero
 * card; only (when an eligible gov alert is active) a FloatingMiniBanner is
 * pinned over the map, and the dock is hidden. MAX shrinks the map to a
 * thumbnail and gives the rail's
 * `forecastHost` (ChartTabs, maximized) the screen — reached from the
 * forecast dock button (the "views" group), left via the chart's restore
 * button. (The NowcastLine no longer maximizes — rail-affordance redesign
 * 2026-06-24: it is a status-only radar line; forecast access lives in the
 * dock.) The dock's IA button opens the AI view the same way (`"ai"` state,
 * left via its back button) on every Pi panel, priority gate or not.
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
 * exists.
 *
 * When focus mode is on AND there's an eligible government alert,
 * `FloatingMiniBanner` overlays on the map's top-right so the kiosk
 * doesn't silently hide a severe alert. Tapping the mini-banner exits
 * focus mode (full UI returns; cycle controls become reachable again).
 *
 * The radar scrubber is `WeatherMap/RadarTimeline` (rendered by
 * WeatherMap inside the map cell); no ambient-level wrapper is needed.
 *
 * Everything above describes the grid shell: a CSS grid whose columns
 * and rows morph between the states (the map card resizes, MapResizer
 * re-fits Leaflet on every frame), now used only with the priority views
 * off (the stacked rail of the taller panels). Under the priority-views
 * model (`piShellVariant()`, ui/piLayout.js; no localStorage key of its
 * own selects it) LayoutPi renders the "overlay shell" instead, the same
 * components in a different arrangement:
 *
 *   ┌──────────────────────────────────────┬─────────────────┐
 *   │ WeatherMap, full screen, every state │ rail frame      │
 *   │ (never resized)                      │ (unzoomed box,  │
 *   │                                      │  zoomed scroller│
 *   │                                      │  = midPanel)    │
 *   │                                      └─────────────────┤
 *   ├────────────────────────────────────────────────────────┤
 *   │ BottomDock: opaque full-width band, 58 px, 44 px       │
 *   │ buttons, a "···" menu for the least-used ones          │
 *   └────────────────────────────────────────────────────────┘
 *   MIN: the rail frame slides out right, the dock down, the attribution
 *   with them (310, 58). The map overlays that differ between MID and MIN
 *   (legend chip, legend card, raised chip, scrubber, FloatingMiniBanner)
 *   are all mounted, each live in one state and hidden and inert in the
 *   others: those leaving fade out in 100 ms as the slide starts, those
 *   arriving fade in at 150–300 ms; the same, mirrored, back to MID. While
 *   the dock moves, a transparent shield over its band catches the taps the
 *   inert dock and the hidden overlays don't take, so they can't reach the
 *   map; an arriving scrubber takes its own from the moment it shows (the
 *   shield leaves its box uncovered), engaging its work on the first one if
 *   the switch hasn't settled yet — except the second tap of a double tap on
 *   the dock's timeline button, which can't seek the radar: where the
 *   switch's own click on the dock landed, a guard as wide as a dock button
 *   plus 8 px a side, the band's height, stays over that spot while the
 *   shield is up, and the button also arms the event guard (ui/tapGuard.js),
 *   which swallows a press within 300 ms in a 60 × 58 px box centred on its
 *   click, the whole gesture with it. The shields and that guard cancel the
 *   touches they take (the views' shield by useTouchCancel; the dock band's
 *   two only while raised, by useShellTiming), so none leaks a click once
 *   they lift.
 *   Views: an opaque sheet (x 210 → right edge) slides in over the rail and
 *   holds the four view hosts, stacked in one cell and always laid out (the
 *   AI view's included), those of the other states skipped by
 *   `content-visibility: hidden`, so an opening only switches which one
 *   shows, each laid out and painted once ahead, out of sight, in an idle
 *   frame at rest (useHostWarmup: the closed sheet in place at opacity 0.001
 *   for that frame, its layer dropped on the next); the slide starts one
 *   frame into its curve, so its first frame already shows the sheet moved;
 *   a transparent full-screen shield under the sheet gesture-locks the map
 *   and the rail from the first frame of the slide (the 210 px strip of map
 *   left of the sheet, once it lands) until the dock is back after the view
 *   closes; the rail stays painted under the sheet, at opacity 1 and inert
 *   (no fade either way), and the dock hides as in MIN. The map holds still
 *   under the slide, then recentres in one frame once the sheet has landed;
 *   closing a view is one frame too, the rail already there, then the dock
 *   comes back.
 *   Timing (`useShellTiming`): a switch is ONE state update;
 *   its commit sets `inert` on what leaves and clears it on what arrives,
 *   and CSS runs every slide and fade from that style change. Once out,
 *   the rail, the dock and the sheet stay laid out, `visibility: hidden`
 *   and inert; an arriving one moves from the tap's own frame. Whatever
 *   must follow the motion (the view's recentre, the shields' release,
 *   the scrubber's work) waits for its transitions' own end.
 *   Form 2 ("d1-form2", a fallback the shipped code never selects): the
 *   map sits in a clip the size of the cleared area (one-frame switches,
 *   no slides). Reduced motion: no transition; every switch in one frame,
 *   MIN ↔ MID and the views alike.
 *   Rail cards, now over the live radar: 10 px gaps on screen at every
 *   density, nightRed surfaces at 96 % (styles.css), NowcastLine's alarm
 *   tiers opaque and its calm line on --c-surface (NowcastLine's own
 *   overlay-shell rules), and HeroCompact's condition icon on the label's
 *   line (`inlineConditionIcon`) so the hero keeps 82 internal px.
 * The root then carries `data-pi-shell` / `data-pi-form` (and
 * `data-pi-variant="still"` for the unreachable fallback "d1-still"), plus
 * the timing attributes of `useShellTiming` (`data-pi-map`,
 * `data-pi-switch`, and, from a switch's commit to one frame after its
 * motion's end, `data-pi-moving`), the warm-up's `data-pi-warm` (a host's
 * one warm frame) and `data-pi-warmed` (the warm hosts, for measurement
 * tooling: nothing in the app reads it) from `useHostWarmup`, and
 * `data-pi-state` becomes the state the chrome shows; the dock band's shield
 * is a child mounted once, `[data-pi-dock-shield]` with `data-active`, and
 * so is its double-tap guard, `[data-pi-dock-guard]` with `data-active` (and
 * `--pi-dock-guard-x`, the click's x, inline); geometry and timing rules in
 * `ui/piShellGeometry.js`, CSS in styles.css. Off the priority views none of
 * this renders.
 *
 * @returns {JSX.Element} Pi layout
 */
const LayoutPi = () => {
  const { darkMode, defaultMapZoom, mouseHide } = useContext(UiPrefsContext);
  const { piLayoutState, piScrubberOpen } = useContext(PiLayoutContext);
  const { setPiLayoutState, setPiScrubberOpen } = useContext(AppActionsContext);
  const { aqhiInfo, currentWeatherData } = useContext(WeatherDataContext);

  // v3.2 air-quality alert: escalate to a top-of-rail AIR card only at the
  // health-risk band (high/veryHigh). Computed once here so the inline
  // AirCard's AQ row can be suppressed in the same render — no duplicate
  // AQHI reading (the AIR card carries it, with its own tap-for-detail).
  const airAlert = getAirAlertState(aqhiInfo?.category);

  // v3.3 priority-views model — opt-in/short-7" only. When on, the rail is a
  // compact glance whose Hero ⤢ opens the Conditions view (metrics + indoor
  // move there); off, it's the v3.2 stacked rail (unchanged).
  const priority = priorityViewsEnabled();

  // Sentinel pattern: set `piLayoutState` to "mid" on mount (so the
  // derived piRadarMaximized is false and WeatherMap renders its
  // RadarFocusControl for this layout), and back to `null` on
  // unmount so the control disappears when the user switches to
  // LayoutDesktop / LayoutMobile (no orphan button on those layouts).
  // Mirrors what LayoutDesktop already does for desktopRadarMaximized.
  useEffect(() => {
    setPiLayoutState("mid");
    return () => setPiLayoutState(null);
  }, [setPiLayoutState]);

  // The overlay shell (on under the priority-views model, see ui/piLayout.js
  // piShellVariant). null = the grid shell: no root attribute, so every
  // overlay-shell rule in styles.css (all keyed on `[data-pi-shell]` /
  // `[data-pi-form]`) stays inert, and the timing hook tracks nothing (its
  // states are piLayoutState itself).
  const shellVariant = piShellVariant();
  const shellForm = piShellForm(shellVariant);
  // The boxes useShellTiming waits on (read in its effects only): its own
  // refs, the dock cell's (BottomDock's wrapper), and, for the boxes other
  // components render (the map overlays, Leaflet's attribution corner),
  // the shell registry, whose ref callbacks go down under the overlay shell
  // only (ui/shellElements.js) — so no switch looks anything up in the
  // DOM.
  const rootRef = useRef(null);
  const railRef = useRef(null);
  const sheetRef = useRef(null);
  const dockShieldRef = useRef(null);
  const dockGuardRef = useRef(null);
  const dockCellRef = useRef(null);
  const [shellElements] = useState(createShellElements);
  const shell = useShellTiming(shellVariant, piLayoutState || "mid", piScrubberOpen, rootRef, railRef, sheetRef, dockShieldRef, dockGuardRef, dockCellRef, shellElements);
  // Overlay shell: the shields and the dock band's guard cancel the
  // touches they take, so no compatibility mouse event or click reaches
  // what lies beneath once they stop blocking. The views' shield while it
  // is mounted (useTouchCancel); the dock band's two, mounted once, only
  // while they block — useShellTiming turns their cancellation on and off
  // with their `data-active` (setDockShield / setDockGuard, ui/tapGuard.js
  // toggleTouchCancel), so at rest they leave no touch-handler region over
  // the dock.
  const shieldRef = useRef(null);
  useTouchCancel(shieldRef, shell.shield);
  // Overlay shell: the press tint on view triggers (usePressTint), always
  // on under the shell, with no setting — the rail's triggers, the dock's
  // view buttons and the views' back buttons.
  usePressTint(shellVariant !== null, rootRef, shell.settled);
  // Under the overlay shell the chrome shows `shell.chromeState`, which no
  // plan holds behind piLayoutState (useShellTiming); the grid shell shows
  // piLayoutState itself.
  const shownState = shellVariant ? shell.chromeState : piLayoutState || "mid";
  const focused = shownState === "min";
  const inView = isPiMaxView(shownState);
  // Under the overlay shell, the rail and the dock are live in MID only
  // (laid out, hidden and inert elsewhere), the sheet in the views only.
  const atMid = shownState === "mid";
  // Overlay shell: with the sheet closed, the shell at rest and the
  // data in, lay out AND paint the hidden view hosts ahead, out of sight,
  // one idle frame each (and again when content mounts at a host's top: an
  // alert arriving), so a view's first opening since load doesn't pay
  // their layout or the first rasterization of their content
  // (useHostWarmup, ui/sheetWarmup.js): the conditions and alert hosts
  // first (their first openings skipped a frame at the slide's start),
  // then the AI and forecast hosts.
  const conditionsHostRef = useRef(null);
  const alertHostRef = useRef(null);
  const aiHostRef = useRef(null);
  const forecastHostRef = useRef(null);
  const warmHosts = useMemo(
    () => (shellVariant !== null && priority
      ? [
        { state: "conditions", ref: conditionsHostRef },
        { state: "alert", ref: alertHostRef },
        { state: "ai", ref: aiHostRef },
        { state: "max", ref: forecastHostRef },
      ]
      : NO_WARM_HOSTS),
    [shellVariant, priority],
  );
  // Then, once the alert host is warm, the style warm-up of the alert
  // view's switch — the switch's writes posed, style forced and everything
  // put back in one task at rest in MID (ui/styleWarmup.js), under the
  // overlay shell with the priority views only.
  const styleWarm = useMemo(
    () => (shellVariant !== null && priority
      ? { railRef, dockCellRef, dockShieldRef, dockGuardRef, alertHostRef, shieldClassName: styles.shield, shellElements }
      : null),
    [shellVariant, priority, shellElements],
  );
  useHostWarmup(warmHosts, shellVariant !== null && (atMid || focused) && shell.settled && currentWeatherData != null, rootRef, sheetRef, styleWarm);

  // v3.3 priority: the radar scrubber is a fullscreen-radar (MIN) tool, tracked
  // by the ephemeral `piScrubberOpen` flag (the dock timeline button sets it +
  // maximizes to MIN). Whenever we leave MIN by ANY path (focus square,
  // mini-banner), clear it so the glance never shows the cramped half-width
  // timeline and the next MIN entry via the focus square is clean — the scrubber
  // returns only via its dedicated button. The flag is in-memory only, so this
  // never mutates the shared, persisted `radarTimelineVisible` pref.
  // (Overlay shell: only once the switch out of MIN has settled, never inside
  // its motion — clearing the flag re-renders every PiLayoutContext
  // reader — and the scrubber is hidden and inert from the switch's own
  // commit anyway; see ui/piShellGeometry.js scrubberFlagClears.)
  const scrubberGone = scrubberFlagClears(piLayoutState, shellVariant ? shell.settled : undefined);
  useEffect(() => {
    if (priority && scrubberGone && piScrubberOpen) {
      setPiScrubberOpen(false);
    }
  }, [priority, scrubberGone, piScrubberOpen, setPiScrubberOpen]);

  const mapArea = (
    <div className={`${styles.mapArea} map-container ${darkMode ? "map-dark-mode" : ""} ${mouseHide ? "map-mouse-hide" : ""}`}>
      {/* The shell props (overlay shell only; undefined otherwise) hand
       * WeatherMap the states its chrome (zoom, focus, legend, scrubber)
       * and its map follow, whether this switch recentres without
       * animation, whether the scrubber's work runs, how its first input
       * engages it before the switch has settled (useShellTiming), and the
       * shell registry its overlays and attribution corner register
       * with. */}
      <WeatherMap
        zoom={defaultMapZoom}
        dark={darkMode}
        shellChromeState={shellVariant ? shell.chromeState : undefined}
        shellMapState={shellVariant ? shell.mapState : undefined}
        shellInstantRecentre={shellVariant ? shell.instantRecentre : undefined}
        shellTimelineEngaged={shellVariant ? shell.timelineEngaged : undefined}
        shellEngageTimeline={shellVariant ? shell.engageTimeline : undefined}
        shellElements={shellVariant ? shellElements : undefined}
      />
      {/* MIN overlay: when an eligible gov alert is active, a
       * FloatingMiniBanner pinned over the fullscreen radar so the kiosk
       * never silently hides a severe alert; tapping it restores MID.
       * Deliberately NO hero card here (removed 2026-07-03) — MIN is a
       * pure radar focus reached via the focus square OR the scrubber
       * button, and the place/temp hero lives in the rail one tap away
       * (toggle the focus square back to MID). Do not re-add an overlay
       * hero on top of the radar. Overlay shell: always mounted, live in MIN
       * only (hidden and inert elsewhere), so it fades in 150–300 ms after
       * the slide to MIN starts and fades out in 100 ms as the slide back
       * starts (FloatingMiniBanner's styles.css). `guardTaps`: the model
       * this layout renders (`priority`), so the banner's tap arms the
       * double-tap guard on the priority views only
       * (FloatingMiniBanner). */}
      {shellVariant
        ? <FloatingMiniBanner guardTaps={priority} onExpand={() => setPiLayoutState("mid")} shellLive={focused} overlayRef={shellElements.overlayRef} />
        : focused && <FloatingMiniBanner guardTaps={priority} onExpand={() => setPiLayoutState("mid")} />}
    </div>
  );

  // MID lean panel — the radar's temporal + felt-conditions companion.
  // Out of sight in the full-rail views (their hosts take over). The alert
  // stack leads and returns null in calm weather (so it costs nothing
  // then); the forecast chart and AI prose are deliberately absent from
  // the glance — the chart lives in MAX.
  const midPanel = (
    <div className={styles.midPanel}>
      <AlertBanner />
      {/* v3.2 inline expansion — in the v3.3 priority model the alert
        * card opens the full AlertView instead, so drop the inline body. */}
      {!priority && <AlertDetailInline />}
      {/* AlertMiniCards on Pi renders ONLY its "restore N hidden alerts"
       * pill (the mini-card list is dropped — the Alert view's Also active
       * row under the priority views, the compact card's counter on the
       * stacked rail, step through the alerts instead). Without it a
       * dismissed alert (via the detail footer's "Masquer") was
       * unrecoverable on the 7" until the 4 h auto-resurface. */}
      <AlertMiniCards />
      {/* AIR — air-quality alert card (v3.2). Renders only at the
       * health-risk band; stacks under the gov alert (mockup case 4). */}
      {airAlert && <AirAlertCard alert={airAlert} />}
      <TimeBlock compact />
      {/* shortPhaseName: the 7" rail is too narrow for the full
       * moon-phase string ("Gibbeuse croissante") in the hero
       * meta-line — B4.7 ruling: short family name, no ellipsis.
       * inlineConditionIcon (overlay shell only): the condition icon joins
       * the label's line so the hero keeps 82 internal px; false (the grid
       * shell) renders HeroCompact's usual markup. */}
      <HeroCompact
        shortPhaseName
        hideAstro
        hideFeelsLike={priority}
        onMaximize={priority ? () => setPiLayoutState("conditions") : undefined}
        inlineConditionIcon={shellVariant !== null}
      />
      {/* NowcastLine (v3.2 keystone): ALWAYS present — an active radar
       * echo shows the verdict, otherwise a quiet radar-anchored calm
       * state ("No rain within X") with a sky-adaptive icon and a leading
       * RADAR badge. Status-only since the rail-affordance redesign
       * (2026-06-24): it no longer maximizes — forecast access lives in
       * the BottomDock's "views" group (forecast button). */}
      <NowcastLine />
      <AirCard suppressAqRow={!!airAlert} />
      {/* Metrics + indoor: in the v3.3 glance these relocate to the
        * Conditions view (the glance stays compact for the font-size
        * budget); the v3.2 stacked rail keeps them inline. */}
      {!priority && <MetricsGrid />}
      {!priority && <IndoorBlock />}
    </div>
  );

  // The full-rail view hosts. Rendered once, in the rail (the grid shell)
  // or in the view sheet (the overlay shell); each is shown only in its own
  // state by the `data-pi-state` rules in styles.css (overlay shell:
  // stacked in the sheet's one cell, the other states'
  // `content-visibility: hidden`).
  const viewHosts = (
    <>
      {/* Forecast host — shown only in MAX, where ChartTabs renders its
       * maximized detail view (it reads piLayoutState === "max"). Kept
       * mounted (display:none in MID) so its metric/period state and the
       * auto-tab selector survive the mid↔max round trip. Overlay shell
       * (`piSheet`): ChartTabs renders its maximized layout in every
       * state, as this host only ever shows in MAX, so opening the view
       * changes nothing in it, and sizes its chart from its box (the
       * hidden host reports no resize). */}
      <div ref={forecastHostRef} className={styles.forecastHost}>
        <ChartTabs piSheet={shellVariant !== null} />
      </div>
      {/* v3.3 Conditions view host — mounted alongside the glance, shown
       * only in the "conditions" state (same pattern as forecastHost). */}
      {priority && (
        <div ref={conditionsHostRef} className={styles.conditionsHost}>
          <ConditionsView />
        </div>
      )}
      {/* v3.3 Alert view host — shown only in the "alert" state. */}
      {priority && (
        <div ref={alertHostRef} className={styles.alertHost}>
          <AlertView />
        </div>
      )}
      {/* IA view host — mounted LAZILY (only in the "ai" state), unlike
        * the always-mounted hosts above: the AI view has no interactive state
        * to preserve, and lazy mount means the paid Anthropic fetch fires on
        * open rather than as background overhead. NOT gated on `priority`:
        * the v3.2 stacked rail has no inline AI summary either, so the dock's
        * IA button opens this view on every Pi panel (the taller 10.1"
        * panels, CSS 1024×640, sit outside the priority gate). Overlay
        * shell: mounted at all times, like the other hosts (the tap's commit
        * then mounts nothing), but `active` only in the "ai" state: the paid
        * request starts in the tap's commit, as elsewhere, and nothing is
        * requested or polled while the view is closed; closing it clears
        * the summary, so each opening shows the loading caption, as a
        * fresh mount does, never the previous summary. The reply is held
        * outside React state until the opening has settled — the sheet
        * landed and the map recentred under it (`mapState`), then the
        * motion's end (`settled`), and then one more animation frame
        * (useAiSummary) — so even an instant reply renders no frame
        * inside the slide. */}
      {(shellVariant !== null || piLayoutState === "ai") && (
        <div ref={aiHostRef} className={styles.aiHost}>
          <AiView
            active={piLayoutState === "ai"}
            replyReady={!shellVariant || (shell.mapState === "ai" && shell.settled)}
          />
        </div>
      )}
    </>
  );

  return (
    <div
      ref={rootRef}
      className={styles.layout}
      data-pi-state={shownState}
      {...piShellRootAttributes(shellVariant)}
      {...shell.attributes}
    >
      {shellVariant ? (
        <>
          {/* Form 2 (an unreachable fallback) clips the map to the area
           * the rail and dock leave clear; the map inside keeps its
           * full-screen size, so Leaflet never resizes (styles.css
           * .mapClip). */}
          {shellForm === 2 ? <div className={styles.mapClip}>{mapArea}</div> : mapArea}
          {/* The rail is two boxes: an unzoomed frame that carries the
           * position, size and MIN slide, and a zoomed scroller inside it.
           * CSS `zoom` on the positioned box would scale its own left,
           * top and width too. Inert outside MID (from the switch's own
           * commit: no tap, focus or assistive tech while it slides or
           * fades out, then `visibility: hidden`, styles.css). */}
          <aside ref={railRef} className={styles.railFrame} inert={!atMid}>
            <div className={styles.railScroll}>{midPanel}</div>
          </aside>
          {/* Gesture lock for the map and the rail during a view: full
           * screen under the sheet, so the parts the sliding sheet hasn't
           * covered yet are locked too, then the strip of map left of it;
           * held after the view closes until the dock is back, so a tap
           * in the dock's area while it slides up can't reach the map.
           * `pointer-events: none` on the map would not do: Leaflet forces
           * `pointer-events: auto` on its interactive paths and marker
           * icons. A tap here does nothing, and its touch is cancelled
           * (useTouchCancel above), so no compatibility click can reach
           * the map or the rail once the shield unmounts. */}
          {shell.shield && <div ref={shieldRef} className={styles.shield} aria-hidden="true" />}
          {/* Gesture lock for the dock's band on a MIN ↔ MID switch, until
           * the dock has finished moving: the dock is inert from its first
           * exit frame and the scrubber or legend card arriving over the
           * band stays hidden for the first 150 ms, so without it the
           * second tap of a quick double tap on the dock's timeline button
           * would land on the map and move the station. Mounted once:
           * useShellTiming raises and lowers it through `data-active`
           * (which its CSS turns into pointer-events), by hand, so lifting
           * it costs no render; React only ever renders "false". Under the
           * dock, which takes its taps again as soon as it is back in. A
           * tap here does nothing, and its touch is cancelled (useShellTiming
           * turns that on with `data-active`, and off once it is lowered and
           * the touches begun on it have ended), so its click can't land on
           * the scrubber once the cut-out below opens. useShellTiming also sets
           * `data-scrubber` on it, by hand, in a switch's commit when a
           * live scrubber is mounted: a cut-out over the scrubber's box
           * opens from the frame the bar shows (styles.css), so the
           * visible bar takes its own taps even while the dock still
           * slides out — bar the second tap of a double tap on the
           * timeline button, which the guard below and the event guard
           * that button arms (ControlButtons, ui/tapGuard.js) swallow. */}
          <div
            ref={dockShieldRef}
            className={styles.dockShield}
            data-pi-dock-shield=""
            data-active="false"
            aria-hidden="true"
          />
          {/* The dock band shield's double-tap guard: the cut-out above
           * uncovers the scrubber's track right over the dock buttons'
           * row, so the second tap of a double tap on the dock's timeline
           * button would land on it and seek the radar back in time.
           * Raised with the shield, only when the click that started the
           * switch was on the dock, over that click's spot (a dock
           * button's width plus 8 px a side, the band's height); lowered
           * with the shield. Mounted once, flipped by hand by
           * useShellTiming like the shield (`data-active`, and
           * `--pi-dock-guard-x` on its inline style); React only ever
           * renders "false". After the shield, at the same z, so over the
           * map's overlays and under the dock. A tap here does nothing, and
           * its touch is cancelled while it is raised (useShellTiming, like
           * the shield's). Kept beside the event guard the timeline button
           * arms: this one spans the band's height until the dock's slide
           * has ended, that one a 60 × 58 px box for 300 ms from the click,
           * the whole gesture with it. */}
          <div
            ref={dockGuardRef}
            className={styles.dockGuard}
            data-pi-dock-guard=""
            data-active="false"
            aria-hidden="true"
          />
          {/* View sheet: always laid out at its final width, off the right
           * edge, hidden and inert outside the views; it slides in by
           * transform from the opening's own frame (styles.css), and its
           * transition's end is what recentres the map (useShellTiming). */}
          <div ref={sheetRef} className={styles.sheet} inert={!inView}>
            <div className={styles.sheetInner}>{viewHosts}</div>
          </div>
        </>
      ) : (
        <>
          {mapArea}
          <aside className={styles.rail} aria-hidden={focused}>
            {midPanel}
            {viewHosts}
          </aside>
        </>
      )}
      {/* BottomDock must stay the LAST child: styles.css places the dock
       * cell with `.layout > :last-child` (both shells), so anything new
       * goes above this line, never after it. Everything that follows the
       * state finds it by its `data-pi-dock-cell` attribute instead
       * (`piDockCell`: styles.css's state rules, the overlay-shell rules
       * and useShellTiming), so a switch restyles the dock, not the root's
       * whole subtree. Under the overlay shell it is inert outside MID, set
       * by hand on the cell (`cellRef`) by useShellTiming in the commit of
       * each chrome change, so a switch renders neither the dock nor its
       * buttons and health chip (it mounts in MID, with LayoutPi). */}
      <BottomDock piDockCell cellRef={shellVariant ? dockCellRef : undefined} />
    </div>
  );
};

export default LayoutPi;
