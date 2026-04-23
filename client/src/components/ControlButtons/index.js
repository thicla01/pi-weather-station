import React, { useContext } from "react";
import { AppContext } from "~/AppContext";
import styles from "./styles.css";
import { InlineIcon } from "@iconify/react";
import locationArrow from "@iconify/icons-map/location-arrow";
import contrastIcon from "@iconify/icons-carbon/contrast";
import sharpSettings from "@iconify/icons-ic/sharp-settings";
import roundLocationOn from "@iconify/icons-ic/round-location-on";
import roundLocationOff from "@iconify/icons-ic/round-location-off";
import playFilledAlt from "@iconify/icons-carbon/play-filled-alt";
import stopFilledAlt from "@iconify/icons-carbon/stop-filled-alt";
import bugIcon from "@iconify/icons-carbon/debug";
import upgradeIcon from "@iconify/icons-carbon/upgrade";

/**
 * Buttons group component
 *
 * @returns {JSX.Element} Control buttons
 */
const ControlButtons = () => {
  const {
    darkMode,
    setDarkMode,
    resetMapPosition,
    markerIsVisible,
    toggleMarker,
    toggleAnimateWeatherMap,
    animateWeatherMap,
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
      <div onClick={resetMapPosition}>
        <InlineIcon icon={locationArrow} />
      </div>
      <div onClick={toggleMarker}>
        <InlineIcon
          icon={markerIsVisible ? roundLocationOff : roundLocationOn}
        />
      </div>
      <div
        onClick={toggleAnimateWeatherMap}
        className={`${animateWeatherMap ? styles.buttonDown : ""}`}
      >
        <InlineIcon icon={animateWeatherMap ? stopFilledAlt : playFilledAlt} />
      </div>
      <div onClick={() => setDarkMode(!darkMode)}>
        <InlineIcon icon={contrastIcon} />
      </div>
      <div
        onClick={toggleSettingsMenuOpen}
        className={`${settingsMenuOpen ? styles.buttonDown : ""}`}
      >
        <InlineIcon icon={sharpSettings} />
      </div>
      {isLocal && debugEnabled && (
        <div
          onClick={toggleDebugMenuOpen}
          className={`${debugMenuOpen ? styles.buttonDown : ""}`}
        >
          <InlineIcon icon={bugIcon} />
        </div>
      )}
      {isLocal && updateAvailable && (
        <div
          onClick={() => setUpdateModalOpen(!updateModalOpen)}
          className={`${styles.updateButton} ${updateModalOpen ? styles.buttonDown : ""}`}
        >
          <InlineIcon icon={upgradeIcon} />
          <span className={styles.updateBadge} />
        </div>
      )}
    </div>
  );
};

export default ControlButtons;
