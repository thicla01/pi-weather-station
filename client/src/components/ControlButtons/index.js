import React, { useContext } from "react";
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

// Inline color for the moon icon — the "blood moon" / lunar-eclipse
// red that's also the nightRed palette's accent. Applied as a literal
// because we want the same red regardless of the active palette so
// the icon reads as a constant "this button is about the red palette"
// signal. See ControlButtons styles + state-rendering notes below.
const MOON_COLOR = "#c44040";

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
    resetMapPosition,
    markerIsVisible,
    toggleMarker,
    radarTimelineVisible,
    toggleRadarTimelineVisible,
    radarSource,
    radarAnalysisEnabled,
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
  } = useContext(AppContext);

  return (
    <div
      className={`${styles.container} ${
        darkMode ? styles.dark : styles.light
      } ${!mouseHide ? styles.showMouse : ""}`}
    >
      <div
        onClick={resetMapPosition}
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
        onClick={toggleMarker}
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
          onClick={toggleRadarTimelineVisible}
          className={`${radarTimelineVisible ? styles.buttonDown : ""}`}
          title={t(radarTimelineVisible ? "controls.hideTimeline" : "controls.showTimeline")}
          aria-label={t(radarTimelineVisible ? "controls.hideTimeline" : "controls.showTimeline")}
        >
          <InlineIcon icon={timePlotIcon} />
        </div>
      )}
      {/* Direction-arrows toggle. The wind-gusts glyph reads as
       * "directional weather phenomenon" — more specific than a
       * generic arrow and lit the feature better than the previous
       * near-me arrow which read as a generic "external link". */}
      {radarAnalysisEnabled && (
        <div
          onClick={toggleDirectionArrows}
          className={`${showDirectionArrows ? styles.buttonDown : ""}`}
          title={t(showDirectionArrows ? "radar.hideDirectionArrows" : "radar.showDirectionArrows")}
          aria-label={t(showDirectionArrows ? "radar.hideDirectionArrows" : "radar.showDirectionArrows")}
        >
          <InlineIcon icon={windGustsIcon} />
        </div>
      )}
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
          onClick={() => saveHideRadarLegend(!hideRadarLegend)}
          className={`${!hideRadarLegend ? styles.buttonDown : ""}`}
          title={t(hideRadarLegend ? "controls.showRadarLegend" : "controls.hideRadarLegend")}
          aria-label={t(hideRadarLegend ? "controls.showRadarLegend" : "controls.hideRadarLegend")}
        >
          <InlineIcon icon={legendIcon} />
        </div>
      )}
      <div
        onClick={() => setDarkMode(!darkMode)}
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
        onClick={() => saveDarkModeAuto(!darkModeAuto)}
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
        onClick={() => saveAdvancedSleepFlag("nightMode", !sleepNightMode)}
        className={`${sleepNightMode ? styles.buttonDown : ""}`}
        title={t(sleepNightMode ? "controls.disableNightRed" : "controls.enableNightRed")}
        aria-label={t(sleepNightMode ? "controls.disableNightRed" : "controls.enableNightRed")}
      >
        <InlineIcon icon={moonIcon} style={{ color: MOON_COLOR }} />
      </div>
      <div
        onClick={toggleSettingsMenuOpen}
        className={`${settingsMenuOpen ? styles.buttonDown : ""}`}
        title={t(settingsMenuOpen ? "controls.closeSettings" : "controls.openSettings")}
        aria-label={t(settingsMenuOpen ? "controls.closeSettings" : "controls.openSettings")}
      >
        <InlineIcon icon={settingsIcon} />
      </div>
      {isLocal && debugEnabled && (
        <div
          onClick={toggleDebugMenuOpen}
          className={`${debugMenuOpen ? styles.buttonDown : ""}`}
          title={t(debugMenuOpen ? "controls.closeDebug" : "controls.openDebug")}
          aria-label={t(debugMenuOpen ? "controls.closeDebug" : "controls.openDebug")}
        >
          <InlineIcon icon={bugIcon} />
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
