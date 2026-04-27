import React, { useContext, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { CSSTransition } from "react-transition-group";
import { AppContext } from "~/AppContext";
import styles from "./styles.css";
import "!style-loader!css-loader!./animations.css";

/**
 * Update modal — shows changelog (feat/fix commits) and provides
 * Skip and Update actions. Slides up from the bottom over the InfoPanel.
 *
 * @returns {JSX.Element|null} Modal overlay
 */
const UpdateModal = () => {
  const {
    updateModalOpen,
    setUpdateModalOpen,
    latestVersion,
    latestSha,
    updateCommits,
    serviceFileChanged,
    saveSkippedSha,
    updateState,
    setUpdateState,
    updateErrorMessage,
    triggerUpdate,
    isSystemd,
    darkMode,
    mouseHide,
  } = useContext(AppContext);

  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const isBusy = updateState === "updating" || updateState === "restarting";
  const isReset = updateState === "failed"  || updateState === "stopped";

  // When the systemd service file itself changed, the in-app updater cannot
  // safely overwrite it (the installed copy may have user customizations
  // like ALLOW_REMOTE=true). Surface the full manual recipe instead.
  let cmdDisplay;
  if (serviceFileChanged) {
    cmdDisplay =
      "cd ~/pi-weather-station && git pull && npm install && " +
      "cp deploy/pi-weather-server.service ~/.config/systemd/user/ && " +
      "systemctl --user daemon-reload && " +
      "systemctl --user restart pi-weather-server";
  } else if (isSystemd) {
    cmdDisplay = "cd ~/pi-weather-station && git pull && systemctl --user restart pi-weather-server";
  } else {
    cmdDisplay = "cd ~/pi-weather-station && git pull";
  }

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(cmdDisplay).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [cmdDisplay]);

  const handleSkip = () => {
    if (latestSha) saveSkippedSha(latestSha);
    setUpdateModalOpen(false);
    setUpdateState("idle");
  };

  const handleClose = () => {
    setUpdateModalOpen(false);
    setUpdateState("idle");
  };

  const handleUpdate = () => {
    if (isReset) {
      setUpdateState("idle");
    } else {
      triggerUpdate();
    }
  };

  const themeClass = darkMode ? styles.containerDark : styles.containerLight;
  const cursorClass = !mouseHide ? styles.showMouse : "";

  return (
    <CSSTransition
      in={updateModalOpen}
      unmountOnExit
      timeout={300}
      classNames="animate"
    >
      <div className={`${styles.container} ${themeClass} ${cursorClass}`}>
        {/* Header */}
        <div className={styles.header}>
          <span className={styles.title}>{t("update.whatsNew")}</span>
          <span className={styles.version}>
            {latestVersion ? `v${latestVersion}` : ""}
          </span>
          <button className={styles.closeButton} onClick={handleClose}>×</button>
        </div>

        {/* Changelog */}
        <div className={styles.changelog}>
          {updateCommits.length > 0 ? (
            updateCommits.map((commit, i) => (
              <div key={i} className={styles.commitItem}>
                <span className={`${styles.badge} ${commit.type === "feat" ? styles.badgeFeat : styles.badgeFix}`}>
                  {commit.type === "feat" ? t("update.feat") : t("update.fix")}
                </span>
                <span className={styles.commitMessage}>{commit.message}</span>
              </div>
            ))
          ) : (
            <div className={styles.noChangelog}>{t("update.noChangelog")}</div>
          )}
        </div>

        {/* Service file change notice — only when relevant */}
        {serviceFileChanged && (
          <div className={styles.serviceFileNotice}>
            {t("update.serviceFileChanged")}
          </div>
        )}

        {/* Manual command */}
        <div className={styles.cmdSection}>
          <div className={styles.cmdRow}>
            <code className={styles.cmdCode}>{cmdDisplay}</code>
            <button
              className={`${styles.copyButton} ${copied ? styles.copyButtonCopied : ""}`}
              onClick={handleCopy}
            >
              {copied ? t("update.copied") : t("update.copy")}
            </button>
          </div>
          {!isSystemd && updateState === "stopped" && (
            <div className={styles.noSystemdNote}>
              {t("update.noSystemd")}
              <code className={styles.noSystemdCmd}>npm start</code>
            </div>
          )}
          {updateState === "failed" && updateErrorMessage && (
            <div className={styles.errorMessage}>
              {updateErrorMessage}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className={styles.actions}>
          <button
            className={styles.skipButton}
            onClick={handleSkip}
            disabled={isBusy}
          >
            {t("update.skip")}
          </button>
          <button
            className={`${styles.updateButton} ${updateState === "failed" ? styles.updateButtonFailed : ""} ${updateState === "stopped" ? styles.updateButtonStopped : ""}`}
            onClick={handleUpdate}
            disabled={isBusy || serviceFileChanged}
          >
            {updateState === "idle"        && t("update.update")}
            {updateState === "updating"    && t("update.updating")}
            {updateState === "restarting"  && t("update.restarting")}
            {updateState === "stopped"     && t("update.done")}
            {updateState === "failed"      && t("update.failed")}
          </button>
        </div>
      </div>
    </CSSTransition>
  );
};

export default UpdateModal;
