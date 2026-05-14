/**
 * Font-size zoom map. Drives `--c-font-scale` (consumed by zoomable
 * subtrees inside the ambient layout) AND the inline `zoom` style on
 * sibling components like SettingsPanel and DebugPanel that render
 * outside `.ambientRoot` and so can't pick up the CSS variable.
 *
 * Three steps were chosen empirically: 0.85 is the smallest size that
 * keeps the 9-10 px labels in the Settings panel still legible on a
 * 7" kiosk at 1 m viewing distance; 1.15 is the largest size that
 * still fits the side rail's content without horizontal scroll.
 */
export const FONT_SIZE_ZOOM = { s: 0.85, m: 1.0, l: 1.15 };

/**
 * Safe lookup: unknown keys (or null/undefined fontSize on first
 * render) fall back to 1.0 so consumers always get a valid number.
 *
 * @param {string} key — `s` / `m` / `l`
 * @returns {number} zoom multiplier
 */
export function resolveFontSizeZoom(key) {
  return FONT_SIZE_ZOOM[key] || 1;
}
