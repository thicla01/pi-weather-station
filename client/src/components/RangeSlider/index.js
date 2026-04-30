import React from "react";
import PropTypes from "prop-types";
import styles from "./styles.css";

/**
 * Reusable range slider with project styling (yellow filled track + thumb).
 * Wraps a native HTML5 <input type="range"> so we get touch + keyboard +
 * mouse support for free, then styles it heavily via CSS.
 *
 * @param {object} props
 * @param {number} props.value Current value
 * @param {Function} props.onChange Called with the new number on every change
 * @param {number} [props.min] Minimum value (default 0)
 * @param {number} [props.max] Maximum value (default 100)
 * @param {number} [props.step] Step granularity (default 1)
 * @param {boolean} [props.disabled] Render as read-only / dimmed
 * @param {Function} [props.formatValue] Override how the value is displayed
 *   next to the slider, e.g. (v) => `${Math.round(v * 100)}%`
 * @param {string} [props.ariaLabel] Accessibility label
 * @returns {JSX.Element} Range slider with value readout
 */
const RangeSlider = ({
  value, onChange, min = 0, max = 100, step = 1,
  disabled = false, formatValue, ariaLabel,
}) => {
  const display = formatValue ? formatValue(value) : String(value);
  // Compute the percentage for the filled portion of the track. The slider
  // CSS uses this as a CSS custom property to size the yellow gradient.
  const pct = ((value - min) / (max - min)) * 100;

  return (
    <div className={`${styles.container} ${disabled ? styles.disabled : ""}`}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className={styles.slider}
        style={{ "--fill-pct": `${pct}%` }}
      />
      <span className={styles.value}>{display}</span>
    </div>
  );
};

RangeSlider.propTypes = {
  value: PropTypes.number.isRequired,
  onChange: PropTypes.func.isRequired,
  min: PropTypes.number,
  max: PropTypes.number,
  step: PropTypes.number,
  disabled: PropTypes.bool,
  formatValue: PropTypes.func,
  ariaLabel: PropTypes.string,
};

export default RangeSlider;
