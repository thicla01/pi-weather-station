/**
 * Returns the appropriate font color for Chart.js axes / titles. Chart.js
 * draws on canvas so it can't inherit CSS variables — the colour has to
 * be passed in JS. Three branches:
 *
 *   - day / light: muted dark-grey ink
 *   - dark (regular night): warm near-white
 *   - nightRed (sleep-stage-1 long-wavelength palette): muted red that
 *     matches the rest of the UI when night-mode is on
 *
 * @param {Boolean} darkMode whether dark mode is active
 * @param {Boolean} [nightRed=false] whether the long-wavelength
 *   night palette is active (only meaningful when darkMode is true)
 * @returns {String} CSS colour usable by Chart.js options
 */
export const fontColor = (darkMode, nightRed = false) => {
  if (darkMode && nightRed) return "rgba(192, 72, 72, 0.85)"; // matches nightRed.text
  return darkMode ? "rgba(246, 246, 244, 0.8)" : "rgba(58, 57, 56, 0.8)";
};

/**
 * Returns the appropriate grid-line color for Chart.js axes. Chart.js's
 * default `rgba(0, 0, 0, 0.1)` is fine on light surfaces but disappears
 * almost entirely against the dark anthracite / night-red surfaces — the
 * grid was reported as "almost invisible" in dark mode (v2.14.53).
 *
 *   - day / light: low-contrast warm grey at 18 % alpha (slightly
 *     stronger than Chart.js's default but still secondary to the data)
 *   - dark (regular night): warm near-white at 14 % alpha
 *   - nightRed: muted red at 16 % alpha so the grid harmonises with
 *     the other red-tinted UI rather than introducing a neutral
 *
 * @param {Boolean} darkMode whether dark mode is active
 * @param {Boolean} [nightRed=false] whether the long-wavelength
 *   night palette is active (only meaningful when darkMode is true)
 * @returns {String} CSS colour usable by Chart.js options
 */
export const gridColor = (darkMode, nightRed = false) => {
  if (darkMode && nightRed) return "rgba(192, 72, 72, 0.16)";
  return darkMode ? "rgba(246, 246, 244, 0.14)" : "rgba(58, 57, 56, 0.18)";
};
