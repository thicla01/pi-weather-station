import React from "react";
import PropTypes from "prop-types";
import styles from "./styles.css";

/**
 * Canonical rail square button — the bordered-surface box (a `--c-border`
 * edge on a `--c-surface-hybrid` fill, a dim bracket icon) shared by the
 * priority-view chrome on the 7" kiosk so every maximize/minimize square
 * reads identically. One source of truth for the box so the views can't
 * drift apart (the recurring inconsistency: the glance maximize ⤢ squares
 * had each grown their own size/border before this was unified).
 *
 * Renders the icon you pass — {@link RestoreIcon} for "minimize back to the
 * glance" (the inverse of the glance's ExpandIcon ⤢), so the maximize/restore
 * pair reads as one toggle. Positioning (corner, right-aligned, etc.) is the
 * caller's job via `className`; this owns only the box + interaction.
 *
 * @param {object} props
 * @param {React.ComponentType<{className?: string}>} props.icon — icon
 *   component (e.g. RestoreIcon); rendered with `currentColor`.
 * @param {(event: React.MouseEvent) => void} [props.onClick] — activation
 *   handler; it receives the click event. Required unless `decorative`.
 * @param {string} [props.ariaLabel] — accessible label (no visible text).
 *   Required unless `decorative`.
 * @param {string} [props.className] — optional positioning class.
 * @param {boolean} [props.back] — a view's back button: carries `data-pi-back`
 *   (the double-tap guard swallows a press on it during its window under the
 *   overlay shell, ui/tapGuard.js) and `data-pi-press` (the overlay shell's
 *   press tint).
 * @param {boolean} [props.decorative] — render the square as a cue inside a
 *   larger control (a `<span>`, hidden from assistive tech, no tap zone or
 *   pressed feedback of its own): the compact alert card, which is one
 *   button.
 * @returns {JSX.Element} the square button (or the decorative square)
 */
const RailSquareButton = ({ icon, onClick, ariaLabel, className, back = false, decorative = false }) => {
  const Icon = icon;
  if (decorative) {
    return (
      <span className={`${styles.square} ${styles.decorative} ${className || ""}`} aria-hidden="true">
        <Icon className={styles.icon} />
      </span>
    );
  }
  return (
    <button
      type="button"
      className={`${styles.square} ${className || ""}`}
      onClick={onClick}
      aria-label={ariaLabel}
      title={ariaLabel}
      data-pi-back={back ? "" : undefined}
      data-pi-press={back ? "" : undefined}
    >
      <Icon className={styles.icon} />
    </button>
  );
};

RailSquareButton.propTypes = {
  icon: PropTypes.elementType.isRequired,
  onClick: PropTypes.func,
  ariaLabel: PropTypes.string,
  className: PropTypes.string,
  back: PropTypes.bool,
  decorative: PropTypes.bool,
};

export default RailSquareButton;
