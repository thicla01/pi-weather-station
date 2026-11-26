import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import PropTypes from "prop-types";

import { ExpandIcon, RestoreIcon } from "./icons";
import styles from "./styles.css";

const TOAST_TIMEOUT_MS = 2000;

// The overlay shell registry's `viewHidden` read without a subscription
// (no toast pending, or no shell: the grid shell, the desktop).
const NO_UNSUBSCRIBE = () => undefined;
const subscribeNothing = () => NO_UNSUBSCRIBE;
const readNotHidden = () => false;

/**
 * Radar-focus toggle — the standalone 40 × 40 px button under the zoom
 * stack (v3.1 Phase 3). Tapping it hides HeroBand and the right rail so
 * the radar fills the viewport; tapping again restores them. Rendered
 * as a plain absolutely-positioned button over the map (same overlay
 * pattern as RadarTimeline / RadarLegend), replacing the previous
 * Leaflet-bar control whose U+26F6 glyph rendered inconsistently
 * across platforms — the four-corner-bracket SVG pair (outward =
 * expand, inward = restore) is the cross-platform replacement, and
 * `aria-pressed` carries the toggle state for both a11y and the active
 * CSS paint.
 *
 * Each toggle confirms with a short self-dismissing toast next to the
 * button (the action's effect — panels vanishing — happens away from
 * where the finger is, so the confirmation anchors the cause).
 *
 * @param {object} props
 * @param {boolean} props.active Whether focus mode is currently on
 * @param {() => void} props.onToggle Called with no arguments on each tap;
 *   the parent owns `active` and flips it (the toast is rendered here, so the
 *   handler need not return anything)
 * @param {string} props.titleOn Tooltip + toast when active (e.g. "Restore panels")
 * @param {string} props.titleOff Tooltip + toast when inactive (e.g. "Focus radar")
 * @param {{viewChromeRef: function(?Element): (function(): void|undefined), viewHidden: function(): boolean, subscribe: function(function(): void): function(): void}} [props.shell]
 *   Overlay shell only: LayoutPi's shell registry (ui/shellElements.js).
 *   With a view open the button stays mounted, inert and, by the overlay
 *   shell's rule in styles.css, hidden, and a pending toast is dropped. The
 *   registry sets that `inert` by hand in the view switch's commit (the
 *   button registers through `viewChromeRef`), so a view switch doesn't
 *   render this component; undefined everywhere else (the grid shell
 *   unmounts it in the views)
 * @returns {JSX.Element} Focus toggle button + transient toast
 */
const RadarFocusControl = ({ active, onToggle, titleOn, titleOff, shell }) => {
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);

  // The toast names the action the tap just performed — i.e. the title
  // the button was showing when pressed (`active` still holds the
  // pre-toggle state here). Pressing "Focus radar" toasts "Focus
  // radar"; pressing "Restore panels" toasts "Restore panels".
  const handleClick = (e) => {
    // Defensive: keep the click from bubbling out of the overlay (the
    // map container is a sibling, but ancestors register handlers too).
    e.stopPropagation();
    setToast(active ? titleOn : titleOff);
    onToggle();
    // Blur so the button doesn't keep keyboard focus after a tap
    // (legacy lesson from the Leaflet-anchor version of this control:
    // lingering focus + sticky hover painted a stuck active state).
    e.currentTarget.blur();
  };

  // The overlay shell keeps the button mounted while a view is open, where
  // the grid shell unmounts it with its toast. Left alone, a pending
  // toast would stay over the view's map strip for the rest of its 2 s,
  // through the slide, and past the close if the view closes first (its
  // place is in the strip, never under the sheet). So it is dropped when
  // the button goes hidden. Whether it is hidden is the shell registry's
  // (ui/shellElements.js), read in every render, which then renders the
  // `inert` the registry has set by hand; subscribed only while a toast
  // is pending: otherwise a view switch, which the
  // registry tells in its commit, renders nothing here. With a toast
  // pending, that commit's change renders this component once more, still
  // before the frame that paints the switch, and the toast goes in that
  // render (adjusted during render: a toast can only be shown while the
  // button is visible); the effect below then clears its timer. That
  // render is a second commit, synchronous (React flushes it before the
  // switch's commit returns, in the same task), rather than in the
  // switch's own commit, which only a prop could do, and a prop renders
  // this component at every switch. Nothing differs on screen, and it
  // happens only while a toast is pending. Off the overlay shell nothing
  // is subscribed and this reads false.
  const shellHidden = useSyncExternalStore(
    shell && toast != null ? shell.subscribe : subscribeNothing,
    shell ? shell.viewHidden : readNotHidden,
  );
  if (shellHidden && toast != null) setToast(null);

  useEffect(() => {
    if (toast == null) return undefined;
    toastTimerRef.current = setTimeout(() => setToast(null), TOAST_TIMEOUT_MS);
    return () => clearTimeout(toastTimerRef.current);
  }, [toast]);

  return (
    <>
      <button
        ref={shell ? shell.viewChromeRef : undefined}
        type="button"
        className={styles.radarFocusBtn}
        onClick={handleClick}
        onDoubleClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        aria-pressed={active}
        inert={shellHidden || undefined}
        aria-label={active ? titleOn : titleOff}
        title={active ? titleOn : titleOff}
      >
        {active ? <RestoreIcon /> : <ExpandIcon />}
      </button>
      {toast != null && (
        <div className={styles.radarFocusToast} role="status">
          {toast}
        </div>
      )}
    </>
  );
};

RadarFocusControl.propTypes = {
  active: PropTypes.bool,
  onToggle: PropTypes.func.isRequired,
  titleOn: PropTypes.string.isRequired,
  titleOff: PropTypes.string.isRequired,
  shell: PropTypes.shape({
    viewChromeRef: PropTypes.func.isRequired,
    viewHidden: PropTypes.func.isRequired,
    subscribe: PropTypes.func.isRequired,
  }),
};

export default RadarFocusControl;
