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
    favorites, mapGeo, browserGeo, isLocal, homeLabel,
    canPinFavorite, pinFavorite,
    canRenameFavorite, removeFavorite, renameFavorite, setFavoriteAsDefault,
    setMapPosition, resetMapPosition,
  } = useContext(AppContext);
  const { t } = useTranslation();

  const [editing, setEditing] = useState(false);
  const [armedId, setArmedId] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [failed, setFailed] = useState(false);
  const armTimerRef = useRef(null);

  // Clear the pending disarm timer on unmount. ControlButtons mounts this
  // component only while it is open, so unmounting IS the close path and
  // every piece of transient state (edit mode, armed remove, rename draft,
  // error text) resets by construction. If that render site ever moves to
  // an always-mounted popover, this cleanup stops covering close and the
  // transient state must instead be reset on the open→closed transition.
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
  // The default location gets a row of its own at the top, but it is NOT a
  // stored favorite: it is not written to settings.json and does not count
  // against the 6-entry cap. Without it the `⌂` badge would only ever appear
  // if the user happened to pin their own default — half the design would
  // never render — and "go back to where the app starts" would be reachable
  // only from the dock.
  //
  // Suppressed when a real favorite already sits on those coordinates: that
  // row carries the `⌂` badge itself, and two rows for one place is exactly
  // the redundant-affordance problem the rail redesign spent a session
  // removing.
  //
  // `browserGeo` is the single source of truth for "home", not
  // `customLat`/`customLon`. The two agree whenever a default is saved (the
  // AppContext actions keep them in step), but `browserGeo` also covers the
  // case where no default was ever saved and the app fell back to IP
  // geolocation. Keying the `⌂` badge on the saved pair instead would give
  // the badge and the home row two different meanings in the same popover:
  // a favorite sitting exactly on an IP-derived home would render unbadged
  // right after the home row it duplicates.
  const homeCoords = browserGeo && browserGeo.latitude != null ? browserGeo : null;
  const isDefault = (f) => !!homeCoords
    && round4(f.lat) === round4(homeCoords.latitude)
    && round4(f.lon) === round4(homeCoords.longitude);
  const homeIsPinned = !!homeCoords && favorites.some(isDefault);
  const showHomeRow = !!homeCoords && !homeIsPinned;
  const homeIsCurrent = !!homeCoords && !!mapGeo
    && round4(homeCoords.latitude) === round4(mapGeo.latitude)
    && round4(homeCoords.longitude) === round4(mapGeo.longitude);

  // Home is ALWAYS the first row — as the pseudo-row when unpinned, as the
  // ⌂-badged stored favorite when pinned. Display-only reordering: storage
  // keeps insertion order (ids and PATCH bodies are untouched), but pinning
  // home must not visually teleport "my home" from the top of the list to
  // the bottom just because it changed representation.
  const homeFav = homeCoords ? favorites.find(isDefault) : null;
  const orderedFavorites = homeFav
    ? [homeFav, ...favorites.filter((f) => f !== homeFav)]
    : favorites;

  // Pinning the home row converts it into a stored favorite: the
  // suppression above then hides the pseudo-row and the stored row carries
  // the ⌂ badge — and, being stored, it becomes renamable and removable
  // through the existing edit flow. This is the one-tap answer to "rename
  // my default location" (issue 319), with no parallel persistence for a
  // home label. No zoom is captured: the map isn't necessarily framing
  // home when this pin happens. Label falls back to the rounded
  // coordinates when the boot reverse-geocode never resolved — the server
  // drops label-less entries, so pinning must not depend on homeLabel.
  const handlePinHome = () => {
    if (!homeCoords) return;
    setFailed(false);
    const fallback = `${round4(homeCoords.latitude)}, ${round4(homeCoords.longitude)}`;
    pinFavorite({
      label: homeLabel || fallback,
      lat: homeCoords.latitude,
      lon: homeCoords.longitude,
    }).then((ok) => setFailed(!ok));
  };

  // Selecting a favorite pans and NEVER changes the zoom (LLD §12 Q1,
  // reversed 2026-08-17). Two reasons, and either alone is sufficient:
  //   1. The user's zoom is theirs. They zoom to a working scale, then jump
  //      between places at that scale; snapping back to whatever zoom the
  //      place happened to be pinned at fights them every time.
  //   2. Setting zoom right after a pan visibly drifts the marker on the
  //      layouts where the rail overlays the map. `panWithRailOffset` puts
  //      the map's TRUE centre north-east of the marker by a fixed PIXEL
  //      amount so the marker lands at the visual centre of the uncovered
  //      area — but `map.setZoom` holds that true centre while the
  //      pixels-per-degree scale changes underneath it, so the marker slides
  //      by an amount that depends on the zoom you started from. (The +/-
  //      buttons escape this: `ZoomAnchorOffset` patches `zoomIn`/`zoomOut`
  //      to `setZoomAround` the non-rail centre. It does not patch
  //      `setZoom`.)
  const handleSelect = (f) => {
    if (editing) return;
    setMapPosition({ latitude: f.lat, longitude: f.lon });
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
            title={t("favorites.renameHint")}
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
      // The worst-case list is 7 rows (home pseudo-row + 6 favorites),
      // ~433 px of content: the shell's default 420 px portal cap clipped
      // the footer by 13 px (field-confirmed on the 7", 2026-08-16). The
      // content is bounded by MAX_FAVORITES, so opting out of the cap is
      // safe on every viewport.
      fitViewport
    >
      <div className={styles.list}>
        {showHomeRow ? (
          <div className={`${styles.row} ${styles.rowHome} ${homeIsCurrent ? styles.rowCurrent : ""}`}>
            <button
              type="button"
              className={styles.rowLabel}
              onClick={() => { resetMapPosition(); onClose(); }}
              disabled={editing}
              title={homeLabel || t("favorites.homeFallback")}
            >
              <span className={styles.homeBadge} aria-hidden="true">⌂</span>
              <span className={styles.labelText}>
                {homeLabel || t("favorites.homeFallback")}
              </span>
            </button>
            {editing && isLocal ? (
              <div className={styles.rowActions}>
                <button
                  type="button"
                  className={styles.action}
                  onClick={handlePinHome}
                  disabled={!canPinFavorite}
                  title={canPinFavorite ? t("favorites.pin") : t("favorites.full")}
                  aria-label={t("favorites.pin")}
                >
                  ★
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
        {orderedFavorites.map(renderRow)}
      </div>

      {favorites.length === 0 ? (
        <div className={styles.empty}>{t("favorites.empty")}</div>
      ) : null}

      <div className={styles.footer}>
        {/* Edit mode must be reachable with ZERO stored favorites: the home
          * row is then the only content, and its pin affordance — the path
          * to a renamable default (issue 319) — lives in Edit mode. Keying
          * this only on favorites.length made that state a dead end. */}
        {isLocal && (favorites.length > 0 || showHomeRow) ? (
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
