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
    changedDeployFiles,
    needsManualUpgrade,
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

  // Two situations make the one-click updater unsafe:
  //   - needsManualUpgrade: the installed /api/update is too old (pre-v2.4.1)
  //     to run npm install — one-click would leave the post-restart server
  //     crash-looping on missing dependencies. Need install.sh to recover.
  //   - deployArtefactsChanged: one or more installed copies under $HOME
  //     (start-server, the systemd unit, the launchd plist) have diverged
  //     from upstream. The in-app updater pulls new code into the working
  //     copy but doesn't refresh those installed copies; running install.sh
  //     idempotently restores parity.
  // Both disable the auto-update button and show their own notice + recipe.
  // needsManualUpgrade takes precedence — install.sh handles everything,
  // including any deploy/ artefact change.
  const deployArtefactsChanged = changedDeployFiles && changedDeployFiles.length > 0;
  let cmdDisplay;
  if (needsManualUpgrade || deployArtefactsChanged) {
    cmdDisplay = "cd ~/pi-weather-station && git pull && bash deploy/install.sh";
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
                <span className={`${styles.badge} ${
                  commit.type === "feat" ? styles.badgeFeat
                  : commit.type === "perf" ? styles.badgePerf
                  : commit.type === "deps" ? styles.badgeDeps
                  : commit.type === "release" ? styles.badgeRelease
                  : styles.badgeFix
                }`}>
                  {t(`update.${commit.type}`)}
                </span>
                <span className={styles.commitMessage}>{commit.message}</span>
              </div>
            ))
          ) : (
            <div className={styles.noChangelog}>{t("update.noChangelog")}</div>
          )}
        </div>

        {/* Manual-upgrade notice — older installs need install.sh */}
        {needsManualUpgrade && (
          <div className={styles.serviceFileNotice}>
            {t("update.needsManualUpgrade")}
          </div>
        )}

        {/* Deploy/ artefact change notice — only when relevant and the
            broader manual-upgrade notice is not already shown. Lists the
            specific files that have diverged so the user can verify what
            running install.sh would refresh. */}
        {!needsManualUpgrade && deployArtefactsChanged && (
          <div className={styles.serviceFileNotice}>
            {t("update.deployArtefactsChanged")}
            <ul className={styles.deployFileList}>
              {changedDeployFiles.map((file) => (
                <li key={file}><code>{file}</code></li>
              ))}
            </ul>
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
            disabled={isBusy || deployArtefactsChanged || needsManualUpgrade}
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
