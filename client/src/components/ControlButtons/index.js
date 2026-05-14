import React, { useContext } from "react";
import { useTranslation } from "react-i18next";
import { AppContext } from "~/AppContext";
import styles from "./styles.css";
import { InlineIcon } from "@iconify/react";
import locationArrow from "@iconify/icons-map/location-arrow";
import contrastIcon from "@iconify/icons-carbon/contrast";
import sharpSettings from "@iconify/icons-ic/sharp-settings";
import roundLocationOn from "@iconify/icons-ic/round-location-on";
import roundLocationOff from "@iconify/icons-ic/round-location-off";
import timelineIcon from "@iconify/icons-material-symbols/timeline";
import bugIcon from "@iconify/icons-carbon/debug";
import upgradeIcon from "@iconify/icons-carbon/upgrade";
import nearMeIcon from "@iconify/icons-material-symbols/near-me-outline";
import legendIcon from "@iconify/icons-carbon/legend";

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
    resetMapPosition,
    markerIsVisible,
    toggleMarker,
    radarTimelineVisible,
    toggleRadarTimelineVisible,
    radarSource,
    radarAnalysisEnabled,
    showDirectionArrows,
    toggleDirectionArrows,
    mapTimestamps,
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
        <InlineIcon icon={locationArrow} />
      </div>
      <div
        onClick={toggleMarker}
        title={t(markerIsVisible ? "controls.hideMarker" : "controls.showMarker")}
        aria-label={t(markerIsVisible ? "controls.hideMarker" : "controls.showMarker")}
      >
        <InlineIcon
          icon={markerIsVisible ? roundLocationOff : roundLocationOn}
        />
      </div>
      {/* Toggles visibility of the radar timeline overlay over the
          map. Replaces the previous standalone play/stop control —
          play/pause now lives in the timeline itself, and this button
          gives the user an escape hatch when they want a clean map.
          Hidden when radarSource is ECCC (the timeline scrubber drives
          RainViewer frame URLs and has no equivalent on the WMS layer). */}
      {radarSource === "rainviewer" && (
        <div
          onClick={toggleRadarTimelineVisible}
          className={`${radarTimelineVisible ? styles.buttonDown : ""}`}
          title={t(radarTimelineVisible ? "controls.hideTimeline" : "controls.showTimeline")}
          aria-label={t(radarTimelineVisible ? "controls.hideTimeline" : "controls.showTimeline")}
        >
          <InlineIcon icon={timelineIcon} />
        </div>
      )}
      {/* Direction-arrows toggle. Previously rendered as an imperative
       * Leaflet control at the map's top-left (next to the zoom +/-);
       * moved to the bottom dock so the top-left of the map can stay
       * uncluttered. Same `radarAnalysisEnabled` gate — when the
       * analysis pipeline is off, there are no arrows to toggle. */}
      {radarAnalysisEnabled && (
        <div
          onClick={toggleDirectionArrows}
          className={`${showDirectionArrows ? styles.buttonDown : ""}`}
          title={t(showDirectionArrows ? "radar.hideDirectionArrows" : "radar.showDirectionArrows")}
          aria-label={t(showDirectionArrows ? "radar.hideDirectionArrows" : "radar.showDirectionArrows")}
        >
          <InlineIcon icon={nearMeIcon} />
        </div>
      )}
      {/* Radar legend visibility toggle. The legend exists when
       * RainViewer is the active radar source AND there's at least
       * one timestamp landed; we gate the button on the same
       * conditions so users can't toggle an absent overlay. The
       * persisted preference lives in `hideRadarLegend` on context
       * (advanced setting since v2.x). */}
      {radarSource === "rainviewer" && mapTimestamps && (
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
      <div
        onClick={toggleSettingsMenuOpen}
        className={`${settingsMenuOpen ? styles.buttonDown : ""}`}
        title={t(settingsMenuOpen ? "controls.closeSettings" : "controls.openSettings")}
        aria-label={t(settingsMenuOpen ? "controls.closeSettings" : "controls.openSettings")}
      >
        <InlineIcon icon={sharpSettings} />
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
        // Remote-viewer indicator (requested by @k5map on a headless RPi
        // setup, May 2026). Same icon + pulsing badge as the local
        // version so the affordance is recognisable, but rendered as a
        // passive indicator: no onClick, no role="button", and a tooltip
        // explaining that installation has to happen from localhost
        // (the /api/update endpoint is gated by `localhostOnly`
        // middleware — a security boundary we keep). Reduced opacity
        // communicates "informational, not interactive" at a glance.
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
