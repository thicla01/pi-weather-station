import React, { useContext, useState, useRef, useEffect, useLayoutEffect } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import {
  AppActionsContext,
  SystemContext,
  UiPrefsContext,
  AlertsContext,
} from "~/AppContext";
import { priorityViewsEnabled } from "~/ui/piLayout";
import styles from "./styles.css";
import { InlineIcon } from "@iconify/react";

/* All icons unified to the IBM Carbon family (v2.14.71) — pre-v2.14.71
 * the dock mixed 5 different icon sets (carbon / ic / material-symbols
 * / map) with inconsistent stroke weights and corner radii. Carbon
 * gives a single 24×24 grid with a 2-px stroke across every glyph for
 * a coherent visual rhythm in the dock. */
import centerCircleIcon from "@iconify/icons-carbon/center-circle";
import locationFilledIcon from "@iconify/icons-carbon/location-filled";
import locationOutlineIcon from "@iconify/icons-carbon/location";
import timePlotIcon from "@iconify/icons-carbon/time-plot";
import windGustsIcon from "@iconify/icons-carbon/wind-gusts";
import legendIcon from "@iconify/icons-carbon/legend";
import warningAltIcon from "@iconify/icons-carbon/warning-alt";
import contrastIcon from "@iconify/icons-carbon/contrast";
import automaticIcon from "@iconify/icons-carbon/automatic";
import moonIcon from "@iconify/icons-carbon/moon";
import settingsIcon from "@iconify/icons-carbon/settings";
import bugIcon from "@iconify/icons-carbon/debug";
import upgradeIcon from "@iconify/icons-carbon/upgrade";
import circleDashIcon from "@iconify/icons-carbon/circle-dash";
/* Per the v3.1 synthesis design (Claude Design), the AI summary
 * toggle uses the universal 4-point-sparkle "auto-awesome" glyph
 * — the de-facto AI icon across modern UIs (Gemini, Copilot, ChatGPT).
 * Carbon's family doesn't ship a clean 4-point star equivalent
 * (`asterisk` is 6-point, `magic-wand` is a wand + sparkles, `bot`
 * was a robot face that read as "automated chatbot" rather than
 * "Claude-generated summary"). Breaking the Carbon-only convention
 * for this single icon is the right trade — the visual semantics
 * matter more than the family purity. */
import sparkleIcon from "@iconify/icons-material-symbols/auto-awesome-outline";
/* Forecast view-open (rail-affordance redesign 2026-06-24). A vertical
 * column-chart Carbon glyph — deliberately NOT a weather glyph and NOT a
 * generic expand/⤢ (that would re-introduce the maximize ambiguity the
 * redesign removed from NowcastLine). Visually distinct from `timePlotIcon`
 * (the timeline button), so no collision in the dock set. */
import chartColumnIcon from "@iconify/icons-carbon/chart-column";
import renewIcon from "@iconify/icons-carbon/renew";

// Inline color for the moon icon — the "blood moon" / lunar-eclipse
// red that's also the nightRed palette's accent. Applied as a literal
// because we want the same red regardless of the active palette so
// the icon reads as a constant "this button is about the red palette"
// signal. See ControlButtons styles + state-rendering notes below.
const MOON_COLOR = "#c44040";

// Worst-tier colour for the nearby-alerts count badge. Dark ink on the
// yellow tier (the gold is too light for white text); white otherwise.
const NEARBY_TIER_BADGE = {
  red: { bg: "#e60000", fg: "#fff" },
  orange: { bg: "#ee7710", fg: "#fff" },
  yellow: { bg: "#f0c000", fg: "#2a2008" },
};

// Toast auto-dismiss window. 2500 ms is long enough to read a short
// localized phrase ("Mode auto activé") on a 7" kiosk without dragging
// past the user's next intended tap.
const TOAST_TIMEOUT = 2500;

/**
 * Buttons group component.
 *
 * Two rendering modes:
 *
 *   - **flat** (default, used by the legacy v2 `InfoPanel`): renders
 *     every button as a sibling in a `space-evenly` flex row. Keeps
 *     the v2 visual untouched while the v2 tree is on death row.
 *   - **grouped** (`grouped={true}`, used by v3 `BottomDock`): splits
 *     the same buttons into three labelled categories — Map (radar
 *     view controls), Display (palette / mode), System (app-level
 *     actions) — with hairline separators between groups. Matches
 *     the Phase 1 toolbar of the v3.1 synthesis design. Group labels
 *     are CSS-hidden on the 7" Pi kiosk and on mobile to save
 *     horizontal room.
 *
 * Whichever the mode, the same per-button `<div onClick>` wrappers
 * are reused so the toast positioning logic (which measures the
 * tapped button's bounding rect via `e.currentTarget`) works
 * identically.
 *
 * @param {object} props - Component props
 * @param {boolean} [props.grouped] - When true, render the three
 *   category groups instead of the flat row. Default false.
 * @returns {JSX.Element} Control buttons
 */
const ControlButtons = ({ grouped = false }) => {
  const { t } = useTranslation();
  const {
    setDarkMode,
    saveDarkModeAuto,
    saveAdvancedSleepFlag,
    saveAdvancedAiFlag,
    saveAiSummaryUserVisible,
    resetMapPosition,
    toggleMarker,
    toggleRadarTimelineVisible,
    toggleDirectionArrows,
    toggleWeatherAlerts,
    saveHideRadarLegend,
    toggleSettingsMenuOpen,
    toggleDebugMenuOpen,
    setUpdateModalOpen,
    setPiLayoutState,
    setPiScrubberOpen,
  } = useContext(AppActionsContext);
  const {
    sleepNightMode,
    isLocal,
    debugEnabled,
    settingsMenuOpen,
    debugMenuOpen,
    updateAvailable,
    updateModalOpen,
    mobileRadarMaximized,
    piLayoutState,
  } = useContext(SystemContext);
  const {
    darkMode,
    darkModeAuto,
    radarAnalysisEnabled,
    aiSummaryAvailable,
    aiSummaryUserVisible,
    markerIsVisible,
    radarTimelineVisible,
    radarSource,
    showDirectionArrows,
    hideRadarLegend,
    mouseHide,
  } = useContext(UiPrefsContext);
  const {
    showWeatherAlerts,
    nearbyAlerts,
  } = useContext(AlertsContext);

  // v3.3 priority-views dock context: true only inside LayoutPi (piLayoutState
  // is set) with the opt-in flag on. Drives the IA button (opens AiView) and
  // the radar-timeline button (maximizes to MIN so the scrubber gets the full
  // radar width instead of the cramped MID half-pane).
  const inPriorityDock = priorityViewsEnabled() && piLayoutState != null;

  // When LayoutMobile is active and the radar card is in mini mode,
  // the timeline scrubber and the precipitation legend are CSS-hidden
  // (the 220 px mini card doesn't have readable room for either —
  // see `LayoutMobile/styles.css`). Tapping the timeline / legend dock
  // buttons in that state would flip state without any visible effect,
  // confusing the user. Grey both buttons out and surface a short
  // toast hint when tapped — same disabled-button pattern the
  // direction-arrows button uses when `radarAnalysisEnabled` is off.
  //
  // The check uses strict `=== false` because the tri-state value is
  // `null` on Pi / Desktop layouts (where the timeline + legend are
  // always visible over the full-bleed map) — we only want to disable
  // when actively on mobile mini.
  const radarOverlaysDisabled = mobileRadarMaximized === false;

  // Nearby-alerts count badge — number in the radius, coloured to the
  // worst tier present. nearbyAlerts is server-sorted severity-desc, so
  // entry 0 is the worst. Feeds the badge only; never the trigger path.
  const nearbyAlertCount = Array.isArray(nearbyAlerts) ? nearbyAlerts.length : 0;
  const nearbyWorst = NEARBY_TIER_BADGE[nearbyAlerts && nearbyAlerts[0] && nearbyAlerts[0].tier] || { bg: "#888888", fg: "#fff" };

  // Toast state — short transient label shown just above the dock to
  // confirm "what just happened" when the user taps a toggle. Each
  // tap bumps `toastId` so a fresh CSS animation re-fires even if the
  // text content happens to be identical to the previous toast. The
  // timeout ref lets us cancel a pending dismissal when a new toast
  // supersedes the current one.
  const [toast, setToast] = useState({ id: 0, message: "", x: null, bottom: null, fullWidth: false });
  const toastTimeoutRef = useRef(null);
  const toastIdRef = useRef(0);
  const containerRef = useRef(null);
  const toastRef = useRef(null);

  useEffect(() => () => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
  }, []);

  // After the toast renders, clamp its horizontal position so the box
  // stays fully inside the viewport even when the tapped button is at
  // a screen edge. Without this, the leftmost button's toast bleeds
  // off the left edge and the rightmost button's toast bleeds off the
  // right edge — first / last characters get clipped. We measure the
  // rendered width here (vs. estimating from max-width) so short toasts
  // stay tightly anchored on the button while long ones get nudged
  // inward only as much as needed.
  //
  // Implementation: shift the toast's `translateX(-50%)` by an extra
  // delta via the `--toast-tx` custom property so the keyframes inherit
  // the same offset for free (their `translate(var(--toast-tx), …)`
  // pulls from the same variable). 12 px viewport margin matches the
  // `padding: 12px` on `.dock`.
  useLayoutEffect(() => {
    if (!toast.message || !toastRef.current || toast.x === null) return;
    // Runs in both modes — viewport-centred (`fullWidth`) and
    // button-anchored. In viewport-centred mode the clamp is a
    // safety net: `max-width: min(360px, calc(100vw - 24px))` keeps
    // the box inside the viewport so `shift` resolves to 0, but
    // leaving the check active defends against future content that
    // overflows via padding / border math.
    const el = toastRef.current;
    el.style.setProperty("--toast-tx", "-50%");
    const rect = el.getBoundingClientRect();
    const margin = 12;
    let shift = 0;
    if (rect.left < margin) shift = margin - rect.left;
    else if (rect.right > window.innerWidth - margin) {
      shift = (window.innerWidth - margin) - rect.right;
    }
    if (shift !== 0) {
      el.style.setProperty("--toast-tx", `calc(-50% + ${shift}px)`);
    }
  }, [toast.id, toast.message, toast.x, toast.fullWidth]);

  // Notify is called from each toggle's onClick. The optional event lets
  // us anchor the toast horizontally above the actual button that was
  // tapped (rather than always centred on the dock) — important on the
  // 7" kiosk where the leftmost button's toast appearing in the middle
  // of the screen reads as "nothing happened, that button is broken".
  //
  // v2.14.75: coordinates are now viewport-relative (used with
  // `position: fixed` in CSS) because the LayoutPi root has
  // `overflow: hidden` on `.layout`, which clipped the previous
  // container-relative `position: absolute` toast — on the 7" screen
  // and on any browser window resized below ~1280 px, the toast bled
  // upward out of the dock cell into the clipped region and only a
  // tiny sliver of its border was visible. Switching to fixed makes
  // the toast escape every ancestor's overflow clip.
  //
  // `x` is the centre X of the tapped button in viewport coordinates;
  // `bottom` is the distance from the viewport bottom to the top of
  // the tapped button (plus an 8 px gap), so the toast sits just above
  // the button regardless of where the dock lives in the layout.
  // Falls back to centred when no event is provided.
  const notify = (key, e) => {
    let x = null;
    let bottom = null;
    let fullWidth = false;
    if (e && e.currentTarget) {
      const buttonRect = e.currentTarget.getBoundingClientRect();
      x = buttonRect.left + buttonRect.width / 2;
      bottom = window.innerHeight - buttonRect.top + 8;
      // On narrow viewports (≤ 600 px) the per-button anchoring
      // is dropped in favour of viewport centring. Two reasons,
      // resolved together by the same mode flip:
      //
      // (1) Per-button `left + transform: translateX(-50%)` lets
      //     the toast clip off-screen when the tapped button sits
      //     near the dock's right edge — the clamp `useLayoutEffect`
      //     shifts it back, but the rendered box is already
      //     narrow because the browser's shrink-to-fit width =
      //     `viewport - left` was tiny to start with. Symptom: a
      //     70-char French toast wrapping to 6+ lines that should
      //     fit on 2.
      //
      // (2) An earlier "fix" set both `left: 12px` and `right: 12px`
      //     to force the box wide enough to fit long toasts. That
      //     solved (1) but flipped to the opposite problem: short
      //     toasts ("Marqueur affiché", "Mode jour activé") stretched
      //     full-screen-width on phones with masses of empty
      //     horizontal space — read as "this is a bigger banner
      //     than it should be".
      //
      // Current mode: `left: 50%; --toast-tx: -50%` centres the
      // toast on the VIEWPORT (not the button). Width is intrinsic,
      // capped by the CSS `max-width: min(360px, calc(100vw - 24px))`
      // so long toasts get 360 px (~ 2 lines on Geist 13) and short
      // toasts stay as wide as their text. We lose the per-button
      // visual anchor on phones — accepted trade-off: on phones the
      // dock is small, the user's finger is right there, and
      // honest sizing wins over precise pointing.
      fullWidth = window.innerWidth <= 600;
    }
    toastIdRef.current += 1;
    const id = toastIdRef.current;
    setToast({ id, message: t(key), x, bottom, fullWidth });
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => {
      setToast((prev) => (prev.id === id ? { ...prev, message: "" } : prev));
    }, TOAST_TIMEOUT);
  };

  // Each button JSX is built once and assigned to a named key. The
  // same nodes are reused in both flat (v2 InfoPanel) and grouped
  // (v3 BottomDock) layouts so toast positioning (anchored on
  // `e.currentTarget.getBoundingClientRect()`) behaves identically.
  // Conditional buttons collapse to `null` when their gate is off,
  // and React skips rendering them without disturbing siblings.
  const btnRecenter = (
    <div
      key="recenter"
      onClick={(e) => { resetMapPosition(); notify("toasts.mapRecentered", e); }}
      title={t("controls.resetMapPosition")}
      aria-label={t("controls.resetMapPosition")}
    >
      <InlineIcon icon={centerCircleIcon} />
    </div>
  );
  // Location marker visibility toggle. State-based icon: filled
  // pin when the marker is visible, outline pin when hidden. The
  // filled-vs-outline pair reads as "this is the current state"
  // (rather than the older "show the action" convention, which
  // had a slash-through icon when the marker was ON — confusing
  // because the slash visually said "off" while the marker was
  // actually showing).
  const btnMarker = (
    <div
      key="marker"
      onClick={(e) => { toggleMarker(); notify(markerIsVisible ? "toasts.markerHidden" : "toasts.markerShown", e); }}
      title={t(markerIsVisible ? "controls.hideMarker" : "controls.showMarker")}
      aria-label={t(markerIsVisible ? "controls.hideMarker" : "controls.showMarker")}
    >
      <InlineIcon
        icon={markerIsVisible ? locationFilledIcon : locationOutlineIcon}
      />
    </div>
  );
  // Toggles visibility of the radar timeline overlay over the
  // map. The icon (time-plot) signals "this opens time / chrono
  // controls" — the previous play-triangle was misleading because
  // tapping doesn't start playback, it just shows the scrubber UI
  // which has its own play button inside. Hidden when radarSource
  // is ECCC (the timeline scrubber drives RainViewer frame URLs
  // and has no equivalent on the WMS layer).
  const btnTimeline = radarSource === "rainviewer" ? (
    <div
      key="timeline"
      /* `data-dock-priority="secondary"` flags this button for
       * the dock's narrow-portrait collapse rule (see
       * BottomDock/styles.css). On phones in portrait the dock
       * hides secondary buttons to keep room for the essentials
       * (recenter, marker, contrast, refresh, settings, health
       * dot); rotating to landscape brings them back.
       *
       * Phase 3 follow-up: when the MOBILE RADAR IS MAXIMIZED the
       * flag is dropped — the timeline/legend are exactly the
       * controls that matter in that mode, and portrait had no way
       * to reach them (maintainer-reported; the only workaround was
       * toggling from a wide window/landscape). Mini mode keeps the
       * lean dock. */
      data-dock-priority={mobileRadarMaximized === true ? undefined : "secondary"}
      onClick={(e) => {
        if (radarOverlaysDisabled) {
          // Mobile mini mode — scrubber is hidden, tapping the
          // button would have no visible effect. Surface a hint
          // pointing the user to the radar's maximize button.
          notify("toasts.radarOverlaysNeedMaximize", e);
          return;
        }
        if (inPriorityDock) {
          // v3.3 priority: the scrubber belongs on the fullscreen radar. Open it
          // on MIN via the EPHEMERAL piScrubberOpen flag — never the shared,
          // persisted radarTimelineVisible (a layout transition must not mutate
          // that v2/desktop/mobile pref). The dock is hidden in MIN, so this only
          // ever fires from the MID glance.
          setPiScrubberOpen(true);
          setPiLayoutState("min");
          notify("toasts.timelineShown", e);
        } else {
          toggleRadarTimelineVisible();
          notify(radarTimelineVisible ? "toasts.timelineHidden" : "toasts.timelineShown", e);
        }
      }}
      className={`${radarOverlaysDisabled ? styles.buttonDisabled : ""} ${!inPriorityDock && radarTimelineVisible && !radarOverlaysDisabled ? styles.buttonDown : ""}`}
      title={radarOverlaysDisabled
        ? t("controls.radarOverlaysNeedMaximize")
        : t(!inPriorityDock && radarTimelineVisible ? "controls.hideTimeline" : "controls.showTimeline")}
      aria-label={radarOverlaysDisabled
        ? t("controls.radarOverlaysNeedMaximize")
        : t(!inPriorityDock && radarTimelineVisible ? "controls.hideTimeline" : "controls.showTimeline")}
      aria-disabled={radarOverlaysDisabled || undefined}
    >
      <InlineIcon icon={timePlotIcon} />
    </div>
  ) : null;
  // Direction-arrows toggle. The wind-gusts glyph reads as
  // "directional weather phenomenon" — more specific than a
  // generic arrow and lit the feature better than the previous
  // near-me arrow which read as a generic "external link".
  //
  // v2.14.74: when `radarAnalysisEnabled` is false the button stays
  // in the DOM but renders with `.buttonDisabled` (reduced opacity
  // + `pointer-events: none`) instead of being removed. This
  // preserves its slot in the flex row so toggling the debug
  // "radar rings" button doesn't make the remaining buttons slide
  // left/right to fill the gap, and the dimmed glyph still tells
  // the user "this control exists but needs the analysis rings to
  // be on". The title is rewritten to a hint ("Enable radar rings
  // first…") so a tooltip / aria-label still communicates why the
  // control is inactive.
  const btnArrows = (
    <div
      key="arrows"
      data-dock-priority="secondary"
      onClick={(e) => {
        if (!radarAnalysisEnabled) {
          // Tap on the disabled (dimmed) button surfaces a short
          // explanation toast instead of silently doing nothing —
          // the user sees the icon and tries it; without feedback
          // they would conclude the button is broken.
          notify("toasts.directionArrowsNeedRings", e);
          return;
        }
        toggleDirectionArrows();
        notify(showDirectionArrows ? "toasts.directionArrowsOff" : "toasts.directionArrowsOn", e);
      }}
      className={`${!radarAnalysisEnabled ? styles.buttonDisabled : ""} ${showDirectionArrows ? styles.buttonDown : ""}`}
      title={radarAnalysisEnabled
        ? t(showDirectionArrows ? "radar.hideDirectionArrows" : "radar.showDirectionArrows")
        : t("radar.directionArrowsNeedRings")}
      aria-label={radarAnalysisEnabled
        ? t(showDirectionArrows ? "radar.hideDirectionArrows" : "radar.showDirectionArrows")
        : t("radar.directionArrowsNeedRings")}
      aria-disabled={!radarAnalysisEnabled || undefined}
    >
      <InlineIcon icon={windGustsIcon} />
    </div>
  );
  // Legend visibility toggle. v2.14.72: dropped the `mapTimestamps`
  // part of the gate — that state lives in WeatherMap, not in
  // AppContext, so the check was always falsy and the button
  // never rendered (latent bug since the original v2 wiring).
  // The button now shows whenever the radar source is RainViewer;
  // clicking it just flips `hideRadarLegend` regardless of whether
  // a legend is currently painted. When timestamps eventually
  // load, the legend follows the preference.
  const btnLegend = radarSource === "rainviewer" ? (
    <div
      key="legend"
      /* Same maximized-mobile promotion as the timeline button above. */
      data-dock-priority={mobileRadarMaximized === true ? undefined : "secondary"}
      onClick={(e) => {
        if (radarOverlaysDisabled) {
          notify("toasts.radarOverlaysNeedMaximize", e);
          return;
        }
        saveHideRadarLegend(!hideRadarLegend);
        notify(hideRadarLegend ? "toasts.legendShown" : "toasts.legendHidden", e);
      }}
      className={`${radarOverlaysDisabled ? styles.buttonDisabled : ""} ${!hideRadarLegend && !radarOverlaysDisabled ? styles.buttonDown : ""}`}
      title={radarOverlaysDisabled
        ? t("controls.radarOverlaysNeedMaximize")
        : t(hideRadarLegend ? "controls.showRadarLegend" : "controls.hideRadarLegend")}
      aria-label={radarOverlaysDisabled
        ? t("controls.radarOverlaysNeedMaximize")
        : t(hideRadarLegend ? "controls.showRadarLegend" : "controls.hideRadarLegend")}
      aria-disabled={radarOverlaysDisabled || undefined}
    >
      <InlineIcon icon={legendIcon} />
    </div>
  ) : null;
  // Nearby-alerts overlay toggle (Phase 3). Warning-triangle glyph; same
  // localStorage-instant idiom + radarOverlaysDisabled gate as the legend
  // button. When ON and alerts are in range, a count badge coloured to
  // the worst tier present sits on the corner. Display-only — toggling
  // never touches the banner / SenseHat / eligibility path.
  const btnWeatherAlerts = (
    <div
      key="weatherAlerts"
      data-dock-priority="secondary"
      onClick={(e) => {
        if (radarOverlaysDisabled) {
          notify("toasts.radarOverlaysNeedMaximize", e);
          return;
        }
        toggleWeatherAlerts();
        notify(showWeatherAlerts ? "toasts.nearbyAlertsOff" : "toasts.nearbyAlertsOn", e);
      }}
      className={`${styles.alertToggle} ${radarOverlaysDisabled ? styles.buttonDisabled : ""} ${showWeatherAlerts && !radarOverlaysDisabled ? styles.buttonDown : ""}`}
      title={radarOverlaysDisabled
        ? t("controls.radarOverlaysNeedMaximize")
        : t(showWeatherAlerts ? "controls.hideNearbyAlerts" : "controls.showNearbyAlerts")}
      aria-label={radarOverlaysDisabled
        ? t("controls.radarOverlaysNeedMaximize")
        : t(showWeatherAlerts ? "controls.hideNearbyAlerts" : "controls.showNearbyAlerts")}
      aria-disabled={radarOverlaysDisabled || undefined}
    >
      <InlineIcon icon={warningAltIcon} />
      {showWeatherAlerts && nearbyAlertCount > 0 ? (
        <span
          className={styles.alertCountBadge}
          style={{ backgroundColor: nearbyWorst.bg, color: nearbyWorst.fg }}
        >
          {nearbyAlertCount}
        </span>
      ) : null}
    </div>
  );
  const btnContrast = (
    <div
      key="contrast"
      onClick={(e) => { setDarkMode(!darkMode); notify(darkMode ? "toasts.lightModeOn" : "toasts.darkModeOn", e); }}
      title={t(darkMode ? "controls.lightMode" : "controls.darkMode")}
      aria-label={t(darkMode ? "controls.lightMode" : "controls.darkMode")}
    >
      <InlineIcon icon={contrastIcon} />
    </div>
  );
  // Auto dark/light toggle (v2.14.71). Flips darkMode at the
  // local sunrise / sunset times pulled from sunrise-sunset.org.
  // `.buttonDown` active state mirrors the timeline + legend
  // toggles: when ON, the button reads as "pressed in" via the
  // palette's accent-soft fill.
  const btnAuto = (
    <div
      key="auto"
      data-dock-priority="secondary"
      onClick={(e) => { saveDarkModeAuto(!darkModeAuto); notify(darkModeAuto ? "toasts.autoModeOff" : "toasts.autoModeOn", e); }}
      className={`${darkModeAuto ? styles.buttonDown : ""}`}
      title={t(darkModeAuto ? "controls.disableAutoMode" : "controls.enableAutoMode")}
      aria-label={t(darkModeAuto ? "controls.disableAutoMode" : "controls.enableAutoMode")}
    >
      <InlineIcon icon={automaticIcon} />
    </div>
  );
  // Night-red (sleep-stage-1) palette toggle (v2.14.71). The
  // moon icon is rendered in MOON_COLOR (#c44040 — same as the
  // nightRed accent and matches "blood moon" / lunar eclipse
  // iconography) regardless of palette. When the mode is OFF
  // (day / dusk / night palettes) the red moon on the standard
  // dock surface reads as "dormant, ready to activate". When ON
  // (nightRed palette) the `.buttonDown` accent-soft fill behind
  // the moon signals "currently active, tap to deactivate" —
  // same toggle affordance as the timeline button.
  const btnNightRed = (
    <div
      key="nightRed"
      data-dock-priority="secondary"
      onClick={(e) => { saveAdvancedSleepFlag("nightMode", !sleepNightMode); notify(sleepNightMode ? "toasts.nightRedOff" : "toasts.nightRedOn", e); }}
      className={`${sleepNightMode ? styles.buttonDown : ""}`}
      title={t(sleepNightMode ? "controls.disableNightRed" : "controls.enableNightRed")}
      aria-label={t(sleepNightMode ? "controls.disableNightRed" : "controls.enableNightRed")}
    >
      <InlineIcon icon={moonIcon} style={{ color: MOON_COLOR }} />
    </div>
  );
  // App refresh — primarily for PWA standalone mode on iOS/Android
  // where the browser's reload UI isn't reachable. Useful elsewhere
  // too (Pi kiosk has no keyboard for Cmd/Ctrl+R). Short toast then
  // a small delay so the user sees the confirmation before the page
  // tears down.
  const btnRefresh = (
    <div
      key="refresh"
      onClick={(e) => {
        notify("toasts.refreshing", e);
        setTimeout(() => window.location.reload(), 200);
      }}
      title={t("controls.refreshApp")}
      aria-label={t("controls.refreshApp")}
    >
      <InlineIcon icon={renewIcon} />
    </div>
  );
  const btnSettings = (
    <div
      key="settings"
      onClick={(e) => { toggleSettingsMenuOpen(); notify(settingsMenuOpen ? "toasts.settingsClosed" : "toasts.settingsOpened", e); }}
      className={`${settingsMenuOpen ? styles.buttonDown : ""}`}
      title={t(settingsMenuOpen ? "controls.closeSettings" : "controls.openSettings")}
      aria-label={t(settingsMenuOpen ? "controls.closeSettings" : "controls.openSettings")}
    >
      <InlineIcon icon={settingsIcon} />
    </div>
  );
  const btnDebug = isLocal && debugEnabled ? (
    <div
      key="debug"
      onClick={(e) => { toggleDebugMenuOpen(); notify(debugMenuOpen ? "toasts.debugClosed" : "toasts.debugOpened", e); }}
      className={`${debugMenuOpen ? styles.buttonDown : ""}`}
      title={t(debugMenuOpen ? "controls.closeDebug" : "controls.openDebug")}
      aria-label={t(debugMenuOpen ? "controls.closeDebug" : "controls.openDebug")}
    >
      <InlineIcon icon={bugIcon} />
    </div>
  ) : null;
  // Debug-only — quick toggle for the dashed analysis rings on
  // the map. Mirrors the `radarAnalysisEnabled` setting that
  // lives in AdvancedSettings → AI section; the dock button is
  // a convenience for live development / on-screen debugging.
  // The same `saveAdvancedAiFlag` setter is used so the change
  // round-trips to settings.json the same way the panel toggle
  // does. `carbon:circle-dash` literally depicts the dashed
  // rings the button controls.
  const btnRings = isLocal && debugEnabled ? (
    <div
      key="rings"
      onClick={(e) => { saveAdvancedAiFlag("radarAnalysisEnabled", !radarAnalysisEnabled); notify(radarAnalysisEnabled ? "toasts.radarRingsOff" : "toasts.radarRingsOn", e); }}
      className={`${radarAnalysisEnabled ? styles.buttonDown : ""}`}
      title={t(radarAnalysisEnabled ? "controls.disableRadarRings" : "controls.enableRadarRings")}
      aria-label={t(radarAnalysisEnabled ? "controls.disableRadarRings" : "controls.enableRadarRings")}
    >
      <InlineIcon icon={circleDashIcon} />
    </div>
  ) : null;
  // IA button — two behaviours sharing the sparkle glyph:
  //  • v3.3 priority model (LayoutPi, flag on → `piLayoutState != null`):
  //    opens the full-rail AiView (the Claude summary was dropped from the
  //    glance, so the toggle had nothing to act on). Shown whenever the AI is
  //    configured server-side — NOT debug-gated, it's a real feature. It does
  //    NOT gate on `aiSummaryUserVisible`: that's the v2 "hide the inline
  //    section" debug toggle, meaningless for a deliberate view open (and it
  //    persists, so a stale `false` would wrongly suppress the view).
  //  • v2 / desktop: the original debug-only toggle that hides the inline AI
  //    summary section without touching the Anthropic key (`aiSummaryAvailable`
  //    = server key reachable; `aiSummaryUserVisible` = this override).
  const btnBot = inPriorityDock
    ? (aiSummaryAvailable ? (
      <div
        key="bot"
        onClick={() => setPiLayoutState("ai")}
        className={`${piLayoutState === "ai" ? styles.buttonDown : ""}`}
        title={t("controls.openAiView")}
        aria-label={t("controls.openAiView")}
      >
        <InlineIcon icon={sparkleIcon} />
      </div>
    ) : null)
    : (isLocal && debugEnabled && aiSummaryAvailable ? (
      <div
        key="bot"
        onClick={(e) => { saveAiSummaryUserVisible(!aiSummaryUserVisible); notify(aiSummaryUserVisible ? "toasts.aiSummaryHidden" : "toasts.aiSummaryShown", e); }}
        className={`${aiSummaryUserVisible ? styles.buttonDown : ""}`}
        title={t(aiSummaryUserVisible ? "controls.hideAiSummary" : "controls.showAiSummary")}
        aria-label={t(aiSummaryUserVisible ? "controls.hideAiSummary" : "controls.showAiSummary")}
      >
        <InlineIcon icon={sparkleIcon} />
      </div>
    ) : null);
  // Forecast view-open (rail-affordance redesign 2026-06-24). Shown on the
  // Pi dock in BOTH v3.2 (classic 3-states) and v3.3 (priority views) — the
  // gate is `piLayoutState != null`, which LayoutPi sets ("mid") on mount in
  // both, NOT the v3.3-only `inPriorityDock`. This is deliberate: NowcastLine
  // lost its maximize in both layouts, so the forecast MUST be reachable from
  // the dock in both or the v3.2 user is stranded (LLD §2.8 / §3.4). It is a
  // silent view-open (no toast: opening a full-rail view IS the visible
  // result, mirroring btnBot above) that promotes the layout to MAX where
  // ChartTabs renders the maximized forecast. This is now the ONLY forecast
  // entry point on the Pi. The down-state is a plain `.buttonDown` class
  // toggle when MAX is active — no animated highlight (kiosk-GPU rule #264).
  // No legacy v2 (non-Pi) analogue, so off the Pi dock the button is `null`.
  const inPiDock = piLayoutState != null;
  const btnForecast = inPiDock ? (
    <div
      key="forecast"
      onClick={() => setPiLayoutState("max")}
      className={`${piLayoutState === "max" ? styles.buttonDown : ""}`}
      title={t("controls.openForecast")}
      aria-label={t("controls.openForecast")}
    >
      <InlineIcon icon={chartColumnIcon} />
    </div>
  ) : null;
  const btnUpdateLocal = updateAvailable && isLocal ? (
    <div
      key="updateLocal"
      onClick={() => setUpdateModalOpen(!updateModalOpen)}
      className={`${styles.updateButton} ${updateModalOpen ? styles.buttonDown : ""}`}
      title={t(updateModalOpen ? "controls.closeUpdate" : "controls.openUpdate")}
      aria-label={t(updateModalOpen ? "controls.closeUpdate" : "controls.openUpdate")}
    >
      <InlineIcon icon={upgradeIcon} />
      <span className={styles.updateBadge} />
    </div>
  ) : null;
  const btnUpdateRemote = updateAvailable && !isLocal ? (
    <div
      key="updateRemote"
      className={`${styles.updateButton} ${styles.updateButtonRemote}`}
      title={t("controls.updateAvailableRemote")}
      aria-label={t("controls.updateAvailableRemote")}
      aria-disabled="true"
      role="button"
      onClick={(e) => notify("toasts.updateRemoteNotice", e)}
    >
      <InlineIcon icon={upgradeIcon} />
      <span className={styles.updateBadge} />
    </div>
  ) : null;

  // Transient toast — floats just above the dock to confirm
  // the effect of the last toggle. Rendered conditionally so the
  // CSS animation re-fires on each new tap; the `key` bound to
  // `toast.id` guarantees React unmounts the previous instance
  // even when consecutive toasts share the same message text.
  const toastNode = toast.message ? (
    <div
      key={toast.id}
      ref={toastRef}
      className={styles.toast}
      role="status"
      aria-live="polite"
      /* Three positioning modes:
       *   1. Button-anchored (wide viewport with `toast.x` set):
       *      inline `left` + `bottom` place the toast at the
       *      tapped button's centre in viewport coords; CSS
       *      `transform: translate(var(--toast-tx, -50%), …)`
       *      then centres it visually. `useLayoutEffect` clamps
       *      `--toast-tx` if the box overflows a viewport edge.
       *   2. Viewport-centred (narrow viewport ≤ 600 px,
       *      `toast.fullWidth` true): `left: 50%` + the same
       *      `--toast-tx: -50%` translate centres on the
       *      VIEWPORT — width is intrinsic to the content,
       *      capped by the CSS `max-width`. Drops the per-button
       *      anchor in exchange for honest sizing (short toasts
       *      no longer span the full screen, long toasts get up
       *      to 360 px instead of clipping at the dock edges).
       *   3. Default (no event provided): CSS handles it
       *      (left:50%, default bottom). */
      style={(() => {
        if (toast.x === null) return undefined;
        if (toast.fullWidth) {
          // `left: 50%` + the CSS default `--toast-tx: -50%`
          // centres on the viewport. Width is intrinsic to the
          // text content, capped by the CSS `max-width` so the
          // toast never overflows the screen edges.
          return { left: "50%", bottom: `${toast.bottom}px` };
        }
        return { left: `${toast.x}px`, bottom: `${toast.bottom}px` };
      })()}
    >
      {toast.message}
    </div>
  ) : null;

  const containerClass = `${styles.container} ${grouped ? styles.grouped : ""} ${
    darkMode ? styles.dark : styles.light
  } ${!mouseHide ? styles.showMouse : ""}`;

  if (grouped) {
    // Grouped layout (v3 BottomDock). Three labelled groups with
    // hairline separators in CSS; group labels CSS-hide on the 7"
    // Pi kiosk and on mobile (see styles.css). Map = view-affecting
    // toggles; Display = palette / mode; System = app-level actions.
    return (
      <div ref={containerRef} className={containerClass}>
        <div className={styles.group}>
          <span className={styles.groupLabel}>{t("controls.groupMap")}</span>
          {btnRecenter}
          {btnMarker}
          {btnTimeline}
          {btnArrows}
          {btnLegend}
          {btnWeatherAlerts}
          {btnRings}
        </div>
        {/* Views group (rail-affordance redesign 2026-06-24) — "change topic
          * to a full-rail content view", distinct from the Map group's
          * "manipulate the map in place". Holds the IA/sparkle view-open
          * (relocated out of the Map group) and the new forecast view-open.
          * Both buttons are Pi-dock-only (btnForecast on `inPiDock`, btnBot's
          * view-open on `inPriorityDock`); off the Pi they are both `null`. The
          * wrapper `.group` div + `.groupLabel` span are ALWAYS in the JSX, so
          * the group does NOT collapse on its own when empty — it would leave
          * an orphan "VIEWS" label (desktop) and a stray separator hairline.
          * Guard the whole wrapper on having at least one button so it
          * disappears entirely off the Pi. On the Pi this is never empty. */}
        {(btnBot || btnForecast) ? (
          <div className={styles.group}>
            <span className={styles.groupLabel}>{t("controls.groupViews")}</span>
            {btnBot}
            {btnForecast}
          </div>
        ) : null}
        <div className={styles.group}>
          <span className={styles.groupLabel}>{t("controls.groupDisplay")}</span>
          {btnContrast}
          {btnAuto}
          {btnNightRed}
        </div>
        <div className={styles.group}>
          <span className={styles.groupLabel}>{t("controls.groupSystem")}</span>
          {btnRefresh}
          {btnSettings}
          {btnDebug}
          {btnUpdateLocal}
          {btnUpdateRemote}
        </div>
        {toastNode}
      </div>
    );
  }

  // Flat layout (v2 InfoPanel). Preserves the historical order so
  // the v2 visual is untouched until v2 is removed.
  return (
    <div ref={containerRef} className={containerClass}>
      {btnRecenter}
      {btnMarker}
      {btnTimeline}
      {btnArrows}
      {btnLegend}
      {btnWeatherAlerts}
      {btnContrast}
      {btnAuto}
      {btnNightRed}
      {btnRefresh}
      {btnSettings}
      {btnDebug}
      {btnRings}
      {btnBot}
      {btnUpdateLocal}
      {toastNode}
      {btnUpdateRemote}
    </div>
  );
};

ControlButtons.propTypes = {
  grouped: PropTypes.bool,
};

export default ControlButtons;
