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
 * @param {() => void} props.onClick — activation handler.
 * @param {string} props.ariaLabel — accessible label (no visible text).
 * @param {string} [props.className] — optional positioning class.
 * @returns {JSX.Element} the square button
 */
const RailSquareButton = ({ icon, onClick, ariaLabel, className }) => {
  const Icon = icon;
  return (
    <button
      type="button"
      className={`${styles.square} ${className || ""}`}
      onClick={onClick}
      aria-label={ariaLabel}
      title={ariaLabel}
    >
      <Icon className={styles.icon} />
    </button>
  );
};

RailSquareButton.propTypes = {
  icon: PropTypes.elementType.isRequired,
  onClick: PropTypes.func.isRequired,
  ariaLabel: PropTypes.string.isRequired,
  className: PropTypes.string,
};

RailSquareButton.defaultProps = {
  className: "",
};

export default RailSquareButton;
