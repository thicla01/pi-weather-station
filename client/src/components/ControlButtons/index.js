import React, { useContext, useState, useRef, useEffect, useLayoutEffect } from "react";
import { useTranslation } from "react-i18next";
import { AppContext } from "~/AppContext";
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
import contrastIcon from "@iconify/icons-carbon/contrast";
import automaticIcon from "@iconify/icons-carbon/automatic";
import moonIcon from "@iconify/icons-carbon/moon";
import settingsIcon from "@iconify/icons-carbon/settings";
import bugIcon from "@iconify/icons-carbon/debug";
import upgradeIcon from "@iconify/icons-carbon/upgrade";
import circleDashIcon from "@iconify/icons-carbon/circle-dash";
import botIcon from "@iconify/icons-carbon/bot";
import renewIcon from "@iconify/icons-carbon/renew";

// Inline color for the moon icon — the "blood moon" / lunar-eclipse
// red that's also the nightRed palette's accent. Applied as a literal
// because we want the same red regardless of the active palette so
// the icon reads as a constant "this button is about the red palette"
// signal. See ControlButtons styles + state-rendering notes below.
const MOON_COLOR = "#c44040";

// Toast auto-dismiss window. 2500 ms is long enough to read a short
// localized phrase ("Mode auto activé") on a 7" kiosk without dragging
// past the user's next intended tap.
const TOAST_TIMEOUT = 2500;

/**
 * Buttons group component
 *
 * @returns {JSX.Element} Control buttons
 */
const ControlButtons = () => {
  const { t } = useTranslation();
  const {
    darkMode,
    setDarkMode,
    darkModeAuto,
    saveDarkModeAuto,
    sleepNightMode,
    saveAdvancedSleepFlag,
    radarAnalysisEnabled,
    saveAdvancedAiFlag,
    aiSummaryAvailable,
    aiSummaryUserVisible,
    saveAiSummaryUserVisible,
    resetMapPosition,
    markerIsVisible,
    toggleMarker,
    radarTimelineVisible,
    toggleRadarTimelineVisible,
    radarSource,
    showDirectionArrows,
    toggleDirectionArrows,
    hideRadarLegend,
    saveHideRadarLegend,
    toggleSettingsMenuOpen,
    settingsMenuOpen,
    mouseHide,
    isLocal,
    debugEnabled,
    toggleDebugMenuOpen,
    debugMenuOpen,
    updateAvailable,
    updateModalOpen,
    setUpdateModalOpen,
    mobileRadarMaximized,
  } = useContext(AppContext);

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

  // Toast state — short transient label shown just above the dock to
  // confirm "what just happened" when the user taps a toggle. Each
  // tap bumps `toastId` so a fresh CSS animation re-fires even if the
  // text content happens to be identical to the previous toast. The
  // timeout ref lets us cancel a pending dismissal when a new toast
  // supersedes the current one.
  const [toast, setToast] = useState({ id: 0, message: "", x: null, bottom: null });
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
  }, [toast.id, toast.message, toast.x]);

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
    if (e && e.currentTarget) {
      const buttonRect = e.currentTarget.getBoundingClientRect();
      x = buttonRect.left + buttonRect.width / 2;
      bottom = window.innerHeight - buttonRect.top + 8;
    }
    toastIdRef.current += 1;
    const id = toastIdRef.current;
    setToast({ id, message: t(key), x, bottom });
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => {
      setToast((prev) => (prev.id === id ? { ...prev, message: "" } : prev));
    }, TOAST_TIMEOUT);
  };

  return (
    <div
      ref={containerRef}
      className={`${styles.container} ${
        darkMode ? styles.dark : styles.light
      } ${!mouseHide ? styles.showMouse : ""}`}
    >
      <div
        onClick={(e) => { resetMapPosition(); notify("toasts.mapRecentered", e); }}
        title={t("controls.resetMapPosition")}
        aria-label={t("controls.resetMapPosition")}
      >
        <InlineIcon icon={centerCircleIcon} />
      </div>
      {/* Location marker visibility toggle. State-based icon: filled
       * pin when the marker is visible, outline pin when hidden. The
       * filled-vs-outline pair reads as "this is the current state"
       * (rather than the older "show the action" convention, which
       * had a slash-through icon when the marker was ON — confusing
       * because the slash visually said "off" while the marker was
       * actually showing). */}
      <div
        onClick={(e) => { toggleMarker(); notify(markerIsVisible ? "toasts.markerHidden" : "toasts.markerShown", e); }}
        title={t(markerIsVisible ? "controls.hideMarker" : "controls.showMarker")}
        aria-label={t(markerIsVisible ? "controls.hideMarker" : "controls.showMarker")}
      >
        <InlineIcon
          icon={markerIsVisible ? locationFilledIcon : locationOutlineIcon}
        />
      </div>
      {/* Toggles visibility of the radar timeline overlay over the
          map. The icon (time-plot) signals "this opens time / chrono
          controls" — the previous play-triangle was misleading because
          tapping doesn't start playback, it just shows the scrubber UI
          which has its own play button inside. Hidden when radarSource
          is ECCC (the timeline scrubber drives RainViewer frame URLs
          and has no equivalent on the WMS layer). */}
      {radarSource === "rainviewer" && (
        <div
          onClick={(e) => {
            if (radarOverlaysDisabled) {
              // Mobile mini mode — scrubber is hidden, tapping the
              // button would have no visible effect. Surface a hint
              // pointing the user to the radar's maximize button.
              notify("toasts.radarOverlaysNeedMaximize", e);
              return;
            }
            toggleRadarTimelineVisible();
            notify(radarTimelineVisible ? "toasts.timelineHidden" : "toasts.timelineShown", e);
          }}
          className={`${radarOverlaysDisabled ? styles.buttonDisabled : ""} ${radarTimelineVisible && !radarOverlaysDisabled ? styles.buttonDown : ""}`}
          title={radarOverlaysDisabled
            ? t("controls.radarOverlaysNeedMaximize")
            : t(radarTimelineVisible ? "controls.hideTimeline" : "controls.showTimeline")}
          aria-label={radarOverlaysDisabled
            ? t("controls.radarOverlaysNeedMaximize")
            : t(radarTimelineVisible ? "controls.hideTimeline" : "controls.showTimeline")}
          aria-disabled={radarOverlaysDisabled || undefined}
        >
          <InlineIcon icon={timePlotIcon} />
        </div>
      )}
      {/* Direction-arrows toggle. The wind-gusts glyph reads as
       * "directional weather phenomenon" — more specific than a
       * generic arrow and lit the feature better than the previous
       * near-me arrow which read as a generic "external link".
       *
       * v2.14.74: when `radarAnalysisEnabled` is false the button stays
       * in the DOM but renders with `.buttonDisabled` (reduced opacity
       * + `pointer-events: none`) instead of being removed. This
       * preserves its slot in the flex row so toggling the debug
       * "radar rings" button doesn't make the remaining buttons slide
       * left/right to fill the gap, and the dimmed glyph still tells
       * the user "this control exists but needs the analysis rings to
       * be on". The title is rewritten to a hint ("Enable radar rings
       * first…") so a tooltip / aria-label still communicates why the
       * control is inactive. */}
      <div
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
      {/* Legend visibility toggle. v2.14.72: dropped the `mapTimestamps`
       * part of the gate — that state lives in WeatherMap, not in
       * AppContext, so the check was always falsy and the button
       * never rendered (latent bug since the original v2 wiring).
       * The button now shows whenever the radar source is RainViewer;
       * clicking it just flips `hideRadarLegend` regardless of whether
       * a legend is currently painted. When timestamps eventually
       * load, the legend follows the preference. */}
      {radarSource === "rainviewer" && (
        <div
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
      )}
      <div
        onClick={(e) => { setDarkMode(!darkMode); notify(darkMode ? "toasts.lightModeOn" : "toasts.darkModeOn", e); }}
        title={t(darkMode ? "controls.lightMode" : "controls.darkMode")}
        aria-label={t(darkMode ? "controls.lightMode" : "controls.darkMode")}
      >
        <InlineIcon icon={contrastIcon} />
      </div>
      {/* Auto dark/light toggle (v2.14.71). Flips darkMode at the
       * local sunrise / sunset times pulled from sunrise-sunset.org.
       * `.buttonDown` active state mirrors the timeline + legend
       * toggles: when ON, the button reads as "pressed in" via the
       * palette's accent-soft fill. */}
      <div
        onClick={(e) => { saveDarkModeAuto(!darkModeAuto); notify(darkModeAuto ? "toasts.autoModeOff" : "toasts.autoModeOn", e); }}
        className={`${darkModeAuto ? styles.buttonDown : ""}`}
        title={t(darkModeAuto ? "controls.disableAutoMode" : "controls.enableAutoMode")}
        aria-label={t(darkModeAuto ? "controls.disableAutoMode" : "controls.enableAutoMode")}
      >
        <InlineIcon icon={automaticIcon} />
      </div>
      {/* Night-red (sleep-stage-1) palette toggle (v2.14.71). The
       * moon icon is rendered in MOON_COLOR (#c44040 — same as the
       * nightRed accent and matches "blood moon" / lunar eclipse
       * iconography) regardless of palette. When the mode is OFF
       * (day / dusk / night palettes) the red moon on the standard
       * dock surface reads as "dormant, ready to activate". When ON
       * (nightRed palette) the `.buttonDown` accent-soft fill behind
       * the moon signals "currently active, tap to deactivate" —
       * same toggle affordance as the timeline button. */}
      <div
        onClick={(e) => { saveAdvancedSleepFlag("nightMode", !sleepNightMode); notify(sleepNightMode ? "toasts.nightRedOff" : "toasts.nightRedOn", e); }}
        className={`${sleepNightMode ? styles.buttonDown : ""}`}
        title={t(sleepNightMode ? "controls.disableNightRed" : "controls.enableNightRed")}
        aria-label={t(sleepNightMode ? "controls.disableNightRed" : "controls.enableNightRed")}
      >
        <InlineIcon icon={moonIcon} style={{ color: MOON_COLOR }} />
      </div>
      {/* App refresh — primarily for PWA standalone mode on iOS/Android
       * where the browser's reload UI isn't reachable. Useful elsewhere
       * too (Pi kiosk has no keyboard for Cmd/Ctrl+R). Short toast then
       * a small delay so the user sees the confirmation before the page
       * tears down. */}
      <div
        onClick={(e) => {
          notify("toasts.refreshing", e);
          setTimeout(() => window.location.reload(), 200);
        }}
        title={t("controls.refreshApp")}
        aria-label={t("controls.refreshApp")}
      >
        <InlineIcon icon={renewIcon} />
      </div>
      <div
        onClick={(e) => { toggleSettingsMenuOpen(); notify(settingsMenuOpen ? "toasts.settingsClosed" : "toasts.settingsOpened", e); }}
        className={`${settingsMenuOpen ? styles.buttonDown : ""}`}
        title={t(settingsMenuOpen ? "controls.closeSettings" : "controls.openSettings")}
        aria-label={t(settingsMenuOpen ? "controls.closeSettings" : "controls.openSettings")}
      >
        <InlineIcon icon={settingsIcon} />
      </div>
      {isLocal && debugEnabled && (
        <div
          onClick={(e) => { toggleDebugMenuOpen(); notify(debugMenuOpen ? "toasts.debugClosed" : "toasts.debugOpened", e); }}
          className={`${debugMenuOpen ? styles.buttonDown : ""}`}
          title={t(debugMenuOpen ? "controls.closeDebug" : "controls.openDebug")}
          aria-label={t(debugMenuOpen ? "controls.closeDebug" : "controls.openDebug")}
        >
          <InlineIcon icon={bugIcon} />
        </div>
      )}
      {/* Debug-only — quick toggle for the dashed analysis rings on
       * the map. Mirrors the `radarAnalysisEnabled` setting that
       * lives in AdvancedSettings → AI section; the dock button is
       * a convenience for live development / on-screen debugging.
       * The same `saveAdvancedAiFlag` setter is used so the change
       * round-trips to settings.json the same way the panel toggle
       * does. `carbon:circle-dash` literally depicts the dashed
       * rings the button controls. */}
      {isLocal && debugEnabled && (
        <div
          onClick={(e) => { saveAdvancedAiFlag("radarAnalysisEnabled", !radarAnalysisEnabled); notify(radarAnalysisEnabled ? "toasts.radarRingsOff" : "toasts.radarRingsOn", e); }}
          className={`${radarAnalysisEnabled ? styles.buttonDown : ""}`}
          title={t(radarAnalysisEnabled ? "controls.disableRadarRings" : "controls.enableRadarRings")}
          aria-label={t(radarAnalysisEnabled ? "controls.disableRadarRings" : "controls.enableRadarRings")}
        >
          <InlineIcon icon={circleDashIcon} />
        </div>
      )}
      {/* Debug-only — hide the entire AI summary section without
       * touching the Anthropic key (which keeps server availability
       * = true). `aiSummaryAvailable` is the server-driven flag (key
       * is configured + reachable); `aiSummaryUserVisible` is this
       * user-controlled override. Both AI summary components render
       * only when both are true. */}
      {isLocal && debugEnabled && aiSummaryAvailable && (
        <div
          onClick={(e) => { saveAiSummaryUserVisible(!aiSummaryUserVisible); notify(aiSummaryUserVisible ? "toasts.aiSummaryHidden" : "toasts.aiSummaryShown", e); }}
          className={`${aiSummaryUserVisible ? styles.buttonDown : ""}`}
          title={t(aiSummaryUserVisible ? "controls.hideAiSummary" : "controls.showAiSummary")}
          aria-label={t(aiSummaryUserVisible ? "controls.hideAiSummary" : "controls.showAiSummary")}
        >
          <InlineIcon icon={botIcon} />
        </div>
      )}
      {updateAvailable && isLocal && (
        <div
          onClick={() => setUpdateModalOpen(!updateModalOpen)}
          className={`${styles.updateButton} ${updateModalOpen ? styles.buttonDown : ""}`}
          title={t(updateModalOpen ? "controls.closeUpdate" : "controls.openUpdate")}
          aria-label={t(updateModalOpen ? "controls.closeUpdate" : "controls.openUpdate")}
        >
          <InlineIcon icon={upgradeIcon} />
          <span className={styles.updateBadge} />
        </div>
      )}
      {/* Transient toast — floats just above the dock to confirm
       * the effect of the last toggle. Rendered conditionally so the
       * CSS animation re-fires on each new tap; the `key` bound to
       * `toast.id` guarantees React unmounts the previous instance
       * even when consecutive toasts share the same message text. */}
      {toast.message && (
        <div
          key={toast.id}
          ref={toastRef}
          className={styles.toast}
          role="status"
          aria-live="polite"
          /* When anchored on a specific button, inline `left` and
           * `bottom` position the toast in viewport coordinates (the
           * CSS uses `position: fixed`). `translateX(-50%)` in CSS
           * centres the toast on its anchor X. When `toast.x` is null
           * (no event available — defensive fallback only) the CSS
           * defaults take over (left:50%, bottom: dock height + 8px). */
          style={toast.x !== null
            ? { left: `${toast.x}px`, bottom: `${toast.bottom}px` }
            : undefined}
        >
          {toast.message}
        </div>
      )}
      {updateAvailable && !isLocal && (
        <div
          className={`${styles.updateButton} ${styles.updateButtonRemote}`}
          title={t("controls.updateAvailableRemote")}
          aria-label={t("controls.updateAvailableRemote")}
          aria-disabled="true"
        >
          <InlineIcon icon={upgradeIcon} />
          <span className={styles.updateBadge} />
        </div>
      )}
    </div>
  );
};

export default ControlButtons;
