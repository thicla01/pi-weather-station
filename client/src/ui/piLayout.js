/**
 * Helpers for the v3.3 "priority views" model — the short-viewport
 * kiosk variant of LayoutPi where the rail is a compact glance whose
 * entry points each expand into a full-rail priority view. See
 * `docs/v3.3-priority-views-design.md`.
 *
 * Pure, no React — safe to import anywhere (WeatherMap, LayoutPi).
 */

// The `piLayoutState` values that render as a full-rail "maximized" view —
// the map shrinks to a thumbnail and the rail takes the screen. v3.2 had
// only "max" (forecast); v3.3 adds "alert", "conditions" and "ai" as siblings.
// Kept as a single list so WeatherMap's thumbnail/freeze logic covers every
// view, not just the forecast.
const MAX_VIEWS = ["max", "alert", "conditions", "ai"];

/**
 * True when the layout state is one of the full-rail views (forecast /
 * alert / conditions). Used by WeatherMap to switch the map to its
 * thumbnail + frozen-animation mode for ANY of them.
 *
 * @param {?string} state — the `piLayoutState` value
 * @returns {boolean} true when the state renders as a full-rail view
 */
export function isPiMaxView(state) {
  return MAX_VIEWS.includes(state);
}

/**
 * Gate for the v3.3 priority-views model. It targets a **height-starved
 * viewport** — the 7" 800×480 touchscreen AND any panel the kiosk display
 * scale squeezes to the same CSS height (e.g. a 1024×600 panel at scale 1.25
 * → 480 CSS px). Roomier surfaces (the 1024×640 10.1" panel, the 15"
 * non-touch monitors, desktop, mobile) keep the v3.2 stacked rail.
 *
 * Activates **automatically on a short CSS viewport** via
 * `matchMedia("(max-height: 540px)")` — the CSS *viewport* height, NOT
 * `window.screen.height`. This matters on three counts:
 *   1. Correctness — the v2/v3.2 stacked rail overflows as a function of the
 *      CSS height available to it (`native ÷ DISPLAY_SCALE`). `screen.height`
 *      is blind to the display scale, so it left a scaled 1024×600 panel
 *      (CSS 480, as height-starved as the 7") on the overflowing v3.2 rail.
 *   2. Browser-agnostic — `screen.height` reports native px on Chromium but
 *      (reportedly) CSS px on Firefox under a devicePixelRatio pref, so it
 *      could classify identical hardware differently per browser; the CSS
 *      viewport height reads the same on both.
 *   3. Font-size-stable — the v3 text-size preference is `zoom` scoped to the
 *      `.rail` subtree, which never changes the viewport, so the media query
 *      is independent of the S/M/L setting (the model can't flip between font
 *      sizes on the same screen). This is the property the earlier
 *      `screen.height` gate was chosen for; `matchMedia` height keeps it while
 *      also being correct under the display scale.
 *
 * Read per render, no listener: a kiosk viewport is fixed (a DISPLAY_SCALE
 * change relaunches the kiosk), so the value is effectively static per device
 * — same as the old `screen.height` read.
 *
 * A `localStorage` override (`forcePriorityViews` = "on") forces the model on a
 * TALLER viewport — for dev / windowed testing, where the viewport is the host
 * window rather than a kiosk panel. Both are independent: either turns it on.
 *
 * @returns {boolean} true when the priority-views model should be used
 */
export function priorityViewsEnabled() {
  if (typeof window === "undefined") return false;
  // Automatic: a height-starved CSS viewport (the 7" 800×480 kiosk, or a
  // display-scaled panel squeezed to the same height). Guarded for headless /
  // embedded WebViews without `matchMedia`.
  try {
    if (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(max-height: 540px)").matches
    ) {
      return true;
    }
  } catch {
    // matchMedia unavailable — fall through to the manual override.
  }
  // Manual override: force on a taller viewport (dev / windowed testing).
  try {
    return window.localStorage.getItem("forcePriorityViews") === "on";
  } catch {
    // localStorage blocked (private mode / sandboxed) — stay on the
    // stacked rail rather than throwing during render.
    return false;
  }
}
