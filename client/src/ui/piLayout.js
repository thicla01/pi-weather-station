/**
 * Helpers for the v3.3 "priority views" model — the 7" low-resolution
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
 * Gate for the v3.3 priority-views model. It targets ONLY the short 7"
 * 800×480 touchscreen; every other surface (the tall 10.1" Pi panel, the
 * 15" non-touch monitors, desktop, mobile) keeps the v3.2 stacked rail.
 *
 * Activates **automatically on a physically short screen** — the 7" 800×480
 * kiosk. We key on `window.screen.height` (the DEVICE's height in CSS px),
 * not `innerHeight`: it's independent of the font-size zoom AND the viewport,
 * so the model stays stable per device (it never flips on the same screen).
 * The 7" official panel reports ~480 (≤ 540, with margin); the tall 10.1"
 * (~1280) and any desktop monitor stay above it and keep the v3.2 stacked rail.
 *
 * A `localStorage` override (`forcePriorityViews` = "on") forces the model on a
 * TALLER screen — for dev / windowed testing, where `screen.height` is the host
 * monitor rather than the kiosk panel. Both are independent: either turns it on.
 *
 * @returns {boolean} true when the priority-views model should be used
 */
export function priorityViewsEnabled() {
  if (typeof window === "undefined") return false;
  // Automatic: physically short screen (the 7" kiosk). Guarded against a
  // missing/zero `screen.height` (some headless / embedded WebViews).
  try {
    if (window.screen && window.screen.height > 0 && window.screen.height <= 540) {
      return true;
    }
  } catch {
    // window.screen unavailable — fall through to the manual override.
  }
  // Manual override: force on a taller screen (dev / windowed testing).
  try {
    return window.localStorage.getItem("forcePriorityViews") === "on";
  } catch {
    // localStorage blocked (private mode / sandboxed) — stay on the
    // stacked rail rather than throwing during render.
    return false;
  }
}
