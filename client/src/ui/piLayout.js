/**
 * Helpers for the v3.3 "priority views" model — the short-viewport
 * kiosk variant of LayoutPi where the rail is a compact glance whose
 * entry points each expand into a full-rail priority view. See
 * `docs/v3.3-priority-views-design.md`.
 *
 * No React — safe to import anywhere (WeatherMap, LayoutPi). Loading it
 * makes the gate's cached flags (one MediaQueryList, made now, and one
 * localStorage read deferred to its first use; ui/cachedFlags.js).
 */

import { shellVariantFor } from "./piShellGeometry";
import { createMediaQueryFlag, createStorageFlag } from "./cachedFlags";

// The `piLayoutState` values that render as a full-rail "maximized" view —
// on the grid shell the map shrinks to a thumbnail and the rail takes the
// screen. v3.2 had only "max" (forecast); v3.3 adds "alert", "conditions"
// and "ai" as siblings. Kept as a single list so WeatherMap's
// thumbnail/freeze logic covers every view, not just the forecast.
const MAX_VIEWS = ["max", "alert", "conditions", "ai"];

// The flags behind the gate below, each made when this module loads
// (ui/cachedFlags.js): the short-viewport media query, one list whose
// cached `matches` its own `change` listener keeps current (made before
// any component's list, so AmbientLayers re-rendering from its breakpoint
// lists already reads the new value), and the `forcePriorityViews`
// switch, read at its first read and again only after another document
// changes it (reload after changing it by hand). A render reads a
// variable, not a new MediaQueryList (these reads ran several times in
// each LayoutPi view switch's click).
const priorityViewport = createMediaQueryFlag("(max-height: 540px)");
const forcePriorityViews = createStorageFlag("forcePriorityViews");

/**
 * True when the layout state is one of the full-rail views (forecast /
 * alert / conditions / ai). Used by WeatherMap to freeze the radar
 * animation for ANY of them and, on the grid shell, to switch the map to
 * its thumbnail mode.
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
 * non-touch monitors) keep the v3.2 stacked rail; LayoutDesktop and
 * LayoutMobile never render the priority views. Under LayoutPi the gate
 * is on for any viewport 540 CSS px tall or less — a phone held sideways
 * whose CSS viewport is 800 px wide or more included (untested) — and the
 * overlay shell with it (`piShellVariant()` below).
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
 *      `.rail` subtree (under the overlay shell, `.railScroll` and the view
 *      sheet's `.sheetInner`), which never changes the viewport, so the
 *      media query is independent of the S/M/L setting (the model can't
 *      flip between font sizes on the same screen). This is the property
 *      the earlier `screen.height` gate was chosen for; `matchMedia` height
 *      keeps it while also being correct under the display scale.
 *
 * Read from a cached value (`priorityViewport` above), which its own
 * `change` listener keeps current: a kiosk viewport is fixed anyway (a
 * DISPLAY_SCALE change relaunches the kiosk), so the value is effectively
 * static per device — same as the old `screen.height` read. A caller reads
 * it as often as its render calls this, which the React Compiler decides:
 * the compiled LayoutPi memoizes this argument-less call once per mount
 * (and AlertBanner once per LayoutPi mount, with its "on the Pi rail"
 * flag), so a resized desktop window takes the other model only on
 * LayoutPi's next mount, as with the per-call `matchMedia` read before
 * (the compiled output, not the source, says when it runs).
 *
 * A `localStorage` override (`forcePriorityViews` = "on") forces the model on a
 * TALLER viewport — for dev / windowed testing, where the viewport is the host
 * window rather than a kiosk panel. Both are independent: either turns it on.
 * The override is read once per page load (and again if another tab changes
 * it): reload after setting it by hand.
 *
 * Purity (React Compiler; CLAUDE.md, "Client build"): a render that calls
 * this reads no DOM (the MediaQueryList is made when this module loads and
 * `matches()` returns the value its listener keeps; a list without
 * `addEventListener`, Safari < 14, is read live) and, on a short viewport,
 * no storage. On a taller one the override's localStorage read happens at
 * the first call, which is a render, and again at the first call after
 * another document changes the key: a switch meant to hold for the page
 * load, like a lazy `useState` initializer, so a caller keeping it is the
 * intent, not the stale value the rule guards against.
 *
 * @returns {boolean} true when the priority-views model should be used
 */
export function priorityViewsEnabled() {
  if (typeof window === "undefined") return false;
  // Automatic: a height-starved CSS viewport (the 7" 800×480 kiosk, or a
  // display-scaled panel squeezed to the same height). False in headless /
  // embedded WebViews without `matchMedia` (ui/cachedFlags.js).
  if (priorityViewport.matches()) return true;
  // Manual override: force on a taller viewport (dev / windowed testing).
  // Null when localStorage is blocked (private mode / sandboxed): the
  // stacked rail, never a throw during render.
  return forcePriorityViews.read() === "on";
}

/**
 * The LayoutPi shell: the overlay shell (map never resized; rail, dock
 * and view sheet floating over it; geometry and timing in
 * `ui/piShellGeometry.js`) whenever the priority-views model is on — the
 * 7" 800×480 panel, any LayoutPi viewport 540 CSS px tall or less, or
 * `forcePriorityViews` = "on" in a desktop window — and null otherwise:
 * the grid shell, on the stacked rail of the taller panels (e.g. the
 * 10.1" 1024×640). The priority-views gate alone decides; no localStorage
 * key of its own selects or disables the overlay shell.
 *
 * A non-null result alone does not mean LayoutPi is mounted (with
 * `forcePriorityViews` on, a 1280 px window renders LayoutDesktop): callers
 * outside LayoutPi must also require a non-null `piLayoutState`.
 *
 * Reads the priority-views gate only (no storage flag of its own), so a
 * render that calls it reads what the gate reads (`priorityViewsEnabled()`,
 * Purity). How often each caller reads it is decided by its compiled
 * render, not by this source: in the compiled bundle,
 * LayoutPi reads it once per mount, WeatherMap's useRailOffset again when
 * the shell's map state changes, ControlButtons when `inPiDock` changes,
 * and nothing pins LayoutPi's memoization (LayoutPi/useShellTiming.js). A
 * viewport crossing 540 px under a mounted LayoutPi (a resized desktop
 * window, never a kiosk) can therefore leave the map's offset and the
 * shell disagreeing until LayoutPi's next mount: reload (ROADMAP.md,
 * technical debt).
 *
 * @returns {?string} "d1" (the overlay shell) under the priority views, or null for the grid shell
 */
export function piShellVariant() {
  return shellVariantFor(priorityViewsEnabled());
}
