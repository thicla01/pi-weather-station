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

/**
 * The Settings + Debug overlays house dense forms with several 8–11 px
 * labels. At main-UI scaling (S=0.85 / M=1.0 / L=1.15) those panels
 * read as too small at kiosk distance — the user explicitly asked
 * for "current L to become new S". `PANEL_FONT_ZOOM_BOOST` is the
 * multiplier applied on top of the user's chosen step, so the
 * effective panel zoom is `FONT_SIZE_ZOOM[step] * 1.15` —
 * S(0.85)×1.15 ≈ 0.98 (≈ main M), M(1.0)×1.15 = 1.15 (≈ main L),
 * L(1.15)×1.15 ≈ 1.32. Net effect: panels start one notch larger.
 */
export const PANEL_FONT_ZOOM_BOOST = 1.15;

/**
 * Panel-specific resolver: applies the boost on top of the main step.
 *
 * @param {string} key
 * @returns {number}
 */
export function resolvePanelFontSizeZoom(key) {
  return resolveFontSizeZoom(key) * PANEL_FONT_ZOOM_BOOST;
}
