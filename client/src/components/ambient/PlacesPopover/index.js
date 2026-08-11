import React, { useContext, useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import DetailsPopover from "~/components/ambient/DetailsPopover";
import { AppContext } from "~/AppContext";
import styles from "./styles.css";

// Two-tap confirm window for the destructive Remove action, mirroring
// RELAUNCH_CONFIRM_MS in SettingsPanel's RelaunchButton. First tap arms and
// relabels, second fires, and the armed state reverts on its own so a
// forgotten arm never sits waiting for a stray finger.
const REMOVE_CONFIRM_MS = 4000;

/**
 * Places — the favorites picker behind the dock's bookmark button.
 *
 * Two modes, deliberately exclusive:
 *   - **navigate** (default): a row is a jump target. One tap moves the map
 *     and everything that follows `mapGeo` — weather, alerts, air quality,
 *     the Sense HAT. No confirmation, because it is fully reversible.
 *   - **edit**: rows stop being jump targets and become edit targets. Going
 *     somewhere else mid-edit would close the popover under the user's
 *     finger, so the two modes cannot overlap.
 *
 * Edit affordances are gated twice over: `isLocal` (the writes are
 * localhost-only server-side, so a remote client would just collect 403s) and,
 * for rename specifically, a non-touch device — this project ships no
 * on-screen keyboard, so a text input on the 7" kiosk would lead nowhere.
 *
 * @param {object} props
 * @param {boolean} props.open whether the popover is visible
 * @param {() => void} props.onClose called on dismiss
 * @param {object} [props.triggerRef] ref to the dock button that opens it
 * @param {(key: string) => void} [props.onNotify] optional toast emitter
 * @returns {JSX.Element} the popover shell with the favorites list
 */
const PlacesPopover = ({ open, onClose, triggerRef = null, onNotify = null }) => {
  const {
    favorites, mapGeo, customLat, customLon, isLocal,
    canRenameFavorite, removeFavorite, renameFavorite, setFavoriteAsDefault,
    setMapPosition, resetMapPosition, saveDefaultMapZoom,
  } = useContext(AppContext);
  const { t } = useTranslation();

  const [editing, setEditing] = useState(false);
  const [armedId, setArmedId] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [failed, setFailed] = useState(false);
  const armTimerRef = useRef(null);

  // Clear the pending disarm timer on unmount — the popover is conditionally
  // rendered, so it unmounts on every close, armed or not.
  useEffect(() => () => clearTimeout(armTimerRef.current), []);

  // Leaving edit mode (or closing) must not leave a row armed or a rename
  // half-open: reopening would show a confirm state the user never asked for.
  const resetTransientState = () => {
    clearTimeout(armTimerRef.current);
    setArmedId(null);
    setRenamingId(null);
    setDraftLabel("");
  };

  const round4 = (n) => Math.round(n * 1e4) / 1e4;
  const isCurrent = (f) => !!mapGeo
    && round4(f.lat) === round4(mapGeo.latitude)
    && round4(f.lon) === round4(mapGeo.longitude);
  const isDefault = (f) => customLat != null && customLon != null
    && round4(f.lat) === round4(parseFloat(customLat))
    && round4(f.lon) === round4(parseFloat(customLon));

  const handleSelect = (f) => {
    if (editing) return;
    setMapPosition({ latitude: f.lat, longitude: f.lon });
    if (f.zoom && typeof saveDefaultMapZoom === "function") saveDefaultMapZoom(f.zoom);
    onClose();
  };

  const handleRemove = (f) => {
    if (armedId !== f.id) {
      clearTimeout(armTimerRef.current);
      setArmedId(f.id);
      armTimerRef.current = setTimeout(() => setArmedId(null), REMOVE_CONFIRM_MS);
      return;
    }
    clearTimeout(armTimerRef.current);
    setArmedId(null);
    removeFavorite(f.id).then((ok) => setFailed(!ok));
  };

  const handleSetDefault = (f) => {
    setFailed(false);
    setFavoriteAsDefault(f.id).then((ok) => {
      setFailed(!ok);
      if (ok && onNotify) onNotify("toasts.favoriteDefaultSet");
    });
  };

  const commitRename = (f) => {
    const next = draftLabel.trim();
    setRenamingId(null);
    setDraftLabel("");
    // An empty commit reverts instead of saving: the server drops label-less
    // entries, so "save nothing" would read as "renaming deleted my place".
    if (!next || next === f.label) return;
    renameFavorite(f.id, next).then((ok) => setFailed(!ok));
  };

  const renderRow = (f) => {
    const renaming = renamingId === f.id;
    const rowClass = [
      styles.row,
      isCurrent(f) ? styles.rowCurrent : "",
      editing ? styles.rowEditing : "",
    ].filter(Boolean).join(" ");

    return (
      <div key={f.id} className={rowClass}>
        {renaming ? (
          <input
            className={styles.renameInput}
            type="text"
            value={draftLabel}
            maxLength={40}
            autoFocus
            aria-label={t("favorites.rename")}
            onChange={(e) => setDraftLabel(e.target.value)}
            onBlur={() => commitRename(f)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename(f);
              if (e.key === "Escape") { setRenamingId(null); setDraftLabel(""); }
            }}
          />
        ) : (
          <button
            type="button"
            className={styles.rowLabel}
            onClick={() => handleSelect(f)}
            disabled={editing}
            title={f.label}
          >
            {isDefault(f) ? <span className={styles.homeBadge} aria-hidden="true">⌂</span> : null}
            <span className={styles.labelText}>{f.label}</span>
          </button>
        )}

        {editing && !renaming ? (
          <div className={styles.rowActions}>
            <button
              type="button"
              className={styles.action}
              onClick={() => handleSetDefault(f)}
              title={t("favorites.setDefault")}
              aria-label={t("favorites.setDefault")}
            >
              ⌂
            </button>
            {canRenameFavorite ? (
              <button
                type="button"
                className={styles.action}
                onClick={() => { setRenamingId(f.id); setDraftLabel(f.label); }}
                title={t("favorites.rename")}
                aria-label={t("favorites.rename")}
              >
                ✎
              </button>
            ) : null}
            <button
              type="button"
              className={`${styles.action} ${armedId === f.id ? styles.actionArmed : ""}`}
              onClick={() => handleRemove(f)}
              title={t("favorites.remove")}
              aria-label={t("favorites.remove")}
            >
              {armedId === f.id ? t("favorites.removeConfirm") : "✕"}
            </button>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <DetailsPopover
      open={open}
      onClose={onClose}
      title={t("favorites.title")}
      anchor="right"
      triggerRef={triggerRef}
      portal
    >
      {favorites.length === 0 ? (
        <div className={styles.empty}>{t("favorites.empty")}</div>
      ) : (
        <div className={styles.list}>{favorites.map(renderRow)}</div>
      )}

      <div className={styles.footer}>
        <button
          type="button"
          className={styles.currentPosition}
          onClick={() => { resetMapPosition(); onClose(); }}
          disabled={editing}
        >
          {t("favorites.currentPosition")}
        </button>

        {isLocal && favorites.length > 0 ? (
          <button
            type="button"
            className={styles.editToggle}
            onClick={() => {
              resetTransientState();
              setFailed(false);
              setEditing((prev) => !prev);
            }}
          >
            {editing ? t("favorites.done") : t("favorites.edit")}
          </button>
        ) : null}

        {!isLocal && favorites.length > 0 ? (
          <span className={styles.note}>{t("favorites.remoteReadOnly")}</span>
        ) : null}

        {failed ? <span className={styles.error}>{t("favorites.saveFailed")}</span> : null}
      </div>
    </DetailsPopover>
  );
};

PlacesPopover.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  triggerRef: PropTypes.object,
  onNotify: PropTypes.func,
};

export default PlacesPopover;
