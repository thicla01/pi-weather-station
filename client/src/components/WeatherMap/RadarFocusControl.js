import React, { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";

import { ExpandIcon, RestoreIcon } from "./icons";
import styles from "./styles.css";

const TOAST_TIMEOUT_MS = 2000;

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
 * @returns {JSX.Element} Focus toggle button + transient toast
 */
const RadarFocusControl = ({ active, onToggle, titleOn, titleOff }) => {
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

  useEffect(() => {
    if (toast == null) return undefined;
    toastTimerRef.current = setTimeout(() => setToast(null), TOAST_TIMEOUT_MS);
    return () => clearTimeout(toastTimerRef.current);
  }, [toast]);

  return (
    <>
      <button
        type="button"
        className={styles.radarFocusBtn}
        onClick={handleClick}
        onDoubleClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        aria-pressed={active}
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
};

export default RadarFocusControl;
