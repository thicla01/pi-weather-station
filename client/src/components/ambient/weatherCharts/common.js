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
 * @param {Boolean} [nightRed] whether the long-wavelength
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
 * @param {Boolean} [nightRed] whether the long-wavelength
 *   night palette is active (only meaningful when darkMode is true)
 * @returns {String} CSS colour usable by Chart.js options
 */
export const gridColor = (darkMode, nightRed = false) => {
  if (darkMode && nightRed) return "rgba(192, 72, 72, 0.16)";
  return darkMode ? "rgba(246, 246, 244, 0.14)" : "rgba(58, 57, 56, 0.18)";
};

/**
 * Per-metric series colours for the v3.1 Phase 5 forecast charts —
 * straight from the Phase 5 design reference's per-mode tokens
 * (`--line` / `--line-low` / `--line-precip` / probability accent).
 * Canvas-drawn series can't read CSS variables, hence JS values.
 * In nightRed every series collapses to the red family (the design's
 * night-vision constraint); the dashed/solid/bar shapes then carry
 * the series discrimination.
 *
 * @param {Boolean} darkMode whether dark mode is active
 * @param {Boolean} [nightRed] whether the night-vision palette is active
 * @returns {{line: String, gusts: String, precip: String, prob: String}} series colours
 */
export const metricColors = (darkMode, nightRed = false) => {
  if (darkMode && nightRed) {
    return { line: "#d04848", gusts: "#8a3434", precip: "#8a3434", prob: "#e85858" };
  }
  if (darkMode) {
    return { line: "#e89657", gusts: "#6db5b8", precip: "#5a8db8", prob: "#e89657" };
  }
  return { line: "#c97a4a", gusts: "#5a6e7a", precip: "#5a8db8", prob: "#b85a2d" };
};

/**
 * Hex colour → rgba() string at the given alpha. Series fills (the
 * temp area, the subdued precip overlay) reuse the metric colours at
 * reduced opacity; Chart.js needs the literal rgba string.
 *
 * @param {String} hex 6-digit hex colour (leading #)
 * @param {Number} alpha 0-1 opacity
 * @returns {String} rgba() colour
 */
export const withAlpha = (hex, alpha) => {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

// 8-point compass, clockwise from north. Index = round(deg / 45) % 8.
// Neutral keys — the display labels live in the locale files
// (`compass.n` … `compass.nw`).
export const COMPASS_KEYS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];

/**
 * Wind-direction degrees → 8-point compass key ("n" … "nw").
 *
 * @param {Number} deg meteorological direction (degrees, FROM which the wind blows)
 * @returns {String|null} compass key, or null for a missing reading
 */
export const compassKey = (deg) => {
  if (deg == null || Number.isNaN(deg)) return null;
  return COMPASS_KEYS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
};
