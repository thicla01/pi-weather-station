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
// only "max" (forecast); v3.3 adds "alert" and "conditions" as siblings.
// Kept as a single list so WeatherMap's thumbnail/freeze logic covers every
// view, not just the forecast.
const MAX_VIEWS = ["max", "alert", "conditions"];

/**
 * True when the layout state is one of the full-rail views (forecast /
 * alert / conditions). Used by WeatherMap to switch the map to its
 * thumbnail + frozen-animation mode for ANY of them.
 *
 * @param {?string} state — the `piLayoutState` value
 * @returns {boolean}
 */
export function isPiMaxView(state) {
  return MAX_VIEWS.includes(state);
}

/**
 * Gate for the v3.3 priority-views model. It targets ONLY the short 7"
 * 800×480 touchscreen; every other surface (the tall 10.1" Pi panel, the
 * 15" non-touch monitors, desktop, mobile) keeps the v3.2 stacked rail.
 *
 * While v3.3 is being built this is **opt-in** via `localStorage`
 * (`forcePriorityViews` = "on"), so the in-progress model never disrupts
 * the fleet — the branch is inert until the flag is set. The final phase
 * adds the automatic physical-short-screen detection
 * (`window.screen.height <= 540`, font-size-zoom independent so the model
 * stays stable per device) alongside this override.
 *
 * @returns {boolean}
 */
export function priorityViewsEnabled() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem("forcePriorityViews") === "on";
  } catch {
    // localStorage blocked (private mode / sandboxed) — stay on the
    // stacked rail rather than throwing during render.
    return false;
  }
}
