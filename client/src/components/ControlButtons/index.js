import React, { useContext, useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
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
import axios from "axios";

// Update states
const UPDATE_IDLE        = "idle";
const UPDATE_UPDATING    = "updating";   // git pull in progress
const UPDATE_RESTARTING  = "restarting"; // waiting for server to come back
const UPDATE_FAILED      = "failed";

const POLL_INTERVAL_MS  = 2000;
const POLL_MAX_ATTEMPTS = 30; // 60 s

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
    latestVersion,
    isSystemd,
  } = useContext(AppContext);

  const { t } = useTranslation();
  const [updateTooltipOpen, setUpdateTooltipOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [updateState, setUpdateState] = useState(UPDATE_IDLE);
  const pollRef = useRef(null);

  const cmdDisplay = isSystemd
    ? `cd ~/pi-weather-station\ngit pull\nsystemctl --user restart pi-weather-server`
    : `cd ~/pi-weather-station\ngit pull`;

  const cmdClipboard = isSystemd
    ? "cd ~/pi-weather-station && git pull && systemctl --user restart pi-weather-server"
    : "cd ~/pi-weather-station && git pull";

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(cmdClipboard).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [cmdClipboard]);

  /** Poll /api/is-local until the server responds, then reload the page. */
  const pollUntilReady = useCallback(() => {
    let attempts = 0;
    const poll = () => {
      attempts++;
      if (attempts > POLL_MAX_ATTEMPTS) {
        setUpdateState(UPDATE_FAILED);
        return;
      }
      axios.get("/api/is-local")
        .then(() => window.location.reload())
        .catch(() => { pollRef.current = setTimeout(poll, POLL_INTERVAL_MS); });
    };
    // Give the server a head-start before the first poll.
    pollRef.current = setTimeout(poll, 3000);
  }, []);

  const handleUpdate = useCallback(() => {
    setUpdateState(UPDATE_UPDATING);
    axios.post("/api/update")
      .then(() => {
        setUpdateState(UPDATE_RESTARTING);
        pollUntilReady();
      })
      .catch(() => setUpdateState(UPDATE_FAILED));
  }, [pollUntilReady]);

  const isBusy = updateState === UPDATE_UPDATING || updateState === UPDATE_RESTARTING;

  return (
    <div
      className={`${styles.container} ${
        darkMode ? styles.dark : styles.light
      } ${!mouseHide ? styles.showMouse : ""}`}
    >
      {isLocal && updateAvailable && updateTooltipOpen && (
        <div className={`${styles.updateTooltip} ${darkMode ? styles.updateTooltipDark : styles.updateTooltipLight}`}>
          <div className={styles.updateTooltipTitle}>
            {latestVersion
              ? t("update.available", { version: latestVersion })
              : t("update.availableNoVersion")}
          </div>
          <code className={styles.updateTooltipCmd}>
            {cmdDisplay}
          </code>
          {!isSystemd && (
            <div className={styles.updateTooltipNote}>
              {t("update.noSystemd")}
              <code className={styles.updateTooltipRestartCmd}>npm start</code>
            </div>
          )}
          <div className={styles.updateTooltipActions}>
            <button
              className={`${styles.updateTooltipCopy} ${copied ? styles.updateTooltipCopied : ""}`}
              onClick={handleCopy}
            >
              {copied ? t("update.copied") : t("update.copy")}
            </button>
            <button
              className={`${styles.updateTooltipRun} ${isBusy ? styles.updateTooltipRunBusy : ""} ${updateState === UPDATE_FAILED ? styles.updateTooltipRunFailed : ""}`}
              onClick={updateState === UPDATE_FAILED ? () => setUpdateState(UPDATE_IDLE) : handleUpdate}
              disabled={isBusy}
            >
              {updateState === UPDATE_IDLE      && t("update.update")}
              {updateState === UPDATE_UPDATING  && t("update.updating")}
              {updateState === UPDATE_RESTARTING && t("update.restarting")}
              {updateState === UPDATE_FAILED    && t("update.failed")}
            </button>
          </div>
        </div>
      )}
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
          onClick={() => setUpdateTooltipOpen(!updateTooltipOpen)}
          className={`${styles.updateButton} ${updateTooltipOpen ? styles.buttonDown : ""}`}
        >
          <InlineIcon icon={upgradeIcon} />
          <span className={styles.updateBadge} />
        </div>
      )}
    </div>
  );
};

export default ControlButtons;
