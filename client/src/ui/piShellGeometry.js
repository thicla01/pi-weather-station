// LayoutPi's overlay shell (`data-pi-shell="d1"` on LayoutPi's root).
//
// LayoutPi takes it whenever the v3.3 priority-views model is on
// (`priorityViewsEnabled()`, through `piShellVariant()` in ui/piLayout.js;
// no localStorage key of its own), and keeps the grid shell on the stacked
// rail of the taller panels (above 540 CSS px). In the overlay shell the
// radar map fills the viewport (800 × 480 on the 7") in every state and is
// never resized; everything else floats over it:
//   - MID: the rail is an unzoomed frame 10 px from the top and right
//     edges (x 490–790, y 10 to at most 412 on 800 × 480), its cards
//     zoomed inside it; the dock is an opaque full-width band, 58 px
//     tall, at the bottom. The cleared map zone is 490 × 422 and the
//     marker sits at its centre, (245, 211).
//   - MIN: the rail slides out to the right (310 px) and the dock down
//     (58 px), both fading; the map pans so the marker returns to the
//     screen centre.
//   - Views (max / alert / conditions / ai): an opaque sheet covers
//     x 210–800 and slides in from the right; the 210 px strip of map
//     left of it is gesture-locked, with the marker at its horizontal
//     centre, at MID's height, (105, 211).
// Two fallback forms are kept but unreachable (nothing selects them; see
// PI_SHELL_VARIANTS below and ROADMAP.md, technical debt): form 2
// ("d1-form2") clips the map to the cleared zone instead of passing it
// under the rail and dock, for Pis that composite on the CPU with a
// screen rotated in software; "d1-still" keeps MID's offset in MIN.
//
// This module holds the numbers: the variant values, the shell geometry,
// the map-offset table WeatherMap's centring consumes, the map-chrome
// insets per state, the dock toast's place, the survey popup's auto-pan
// padding, the map overlays' places and which of them is live per state,
// and the timing rules (which frame the chrome and the map each change
// on, which shield is up and for how long, what waits for the motion's
// end signal), which LayoutPi/useShellTiming.js runs. It is
// CommonJS so `test/piShellGeometry.test.js` exercises the real values
// (same precedent as ui/radarFrameStack.js); ESM callers import it
// through webpack's CommonJS interop. The CSS custom properties declared
// on `.layout[data-pi-shell]` in `components/ambient/LayoutPi/styles.css`
// must match SHELL_GEOMETRY, SHELL_MOTION, toastPlacement and, per
// state, chromeFor, and the overlay shell dock's `--ctrl-btn-size` in
// `components/ambient/BottomDock/styles.css` must match
// SHELL_GEOMETRY.dockButtonSize; the test compares them.
//
// Offsets follow `panWithRailOffset` (WeatherMap/geometry.js): `x` is the
// width of map hidden at the RIGHT edge, `y` the height hidden at the TOP;
// a negative `y` means a band hidden at the BOTTOM (the dock). The marker
// then lands at (W/2 − x/2, H/2 + y/2), which is also the anchor
// ZoomAnchorOffset zooms around.

// The shell's variants. LayoutPi takes SHIPPED_SHELL_VARIANT ("d1", form
// 1) whenever the v3.3 priority-views model is on, and the grid shell
// otherwise (`shellVariantFor` below, called by `piShellVariant()` in
// ui/piLayout.js); no localStorage key of its own selects or disables
// it. The two other forms are fallbacks kept from the shell's development
// (form 2 was abandoned): nothing selects them, and their branches here,
// in LayoutPi and in its stylesheet stay unreachable until they are
// removed (ROADMAP.md, technical debt).
const PI_SHELL_VARIANTS = Object.freeze([
  // Form 1: map under the rail and dock, sliding transitions.
  "d1",
  // Form 2: map clipped to the cleared zone, rail and dock on --c-bg,
  // one-frame switches, no slides.
  "d1-form2",
  // Form 1, but MIN keeps the MID offset: the map does not pan on
  // MIN ↔ MID, so in MIN the marker stays 155 px left of (and 29 px
  // above) the screen centre. A fallback in case the recentring slide
  // failed on a kiosk.
  "d1-still",
]);
// The form the priority views ship with.
const SHIPPED_SHELL_VARIANT = "d1";

// Mirror of MAX_VIEWS in ui/piLayout.js (ESM, so it can't be required
// here); the test checks the two lists stay equal.
const VIEW_STATES = Object.freeze(["max", "alert", "conditions", "ai"]);

// Shell geometry, in CSS px on the unzoomed screen. The rail's cards are
// zoomed inside the frame (`--c-font-scale`); the frame itself never is.
const RAIL_RIGHT = 10; // gap between the rail frame and the right edge
const RAIL_TOP = 10; // gap between the rail frame and the top edge
const RAIL_WIDTH = 300; // rail frame width
const RAIL_DOCK_GAP = 10; // gap between the rail frame's bottom and the dock
const DOCK_BUTTON_SIZE = 44; // dock touch targets (`--ctrl-btn-size` on the overlay shell's dock; 40 px elsewhere)
const DOCK_HEIGHT = 58; // dock band: 1 px top hairline + 6 px + 44 px button + 6 px, rounded up
const SHEET_LEFT = 210; // a view sheet's left edge = width of the map strip beside it
// The map chrome's own numbers that the dock toast stacks on: the legend
// chip's gap above the dock band and its height (WeatherMap/styles.css
// `.legend-chip.legend-chip`), and the toast's gap above the chip.
const MAP_CHROME_GAP = 16; // legend chip / card / timeline above the dock (MID) or the screen edge (MIN)
const LEGEND_CHIP_HEIGHT = 34;
const TOAST_CHIP_GAP = 8;
const TOAST_SIDE_GAP = 16; // the toast's widest box keeps 16 px from each side of the cleared zone
// The radar scrubber's corner radius (12 px, as in the base
// `.radar-timeline` rule). Under the overlay shell its box (MAP_CHROME_GAP from the left,
// right and bottom edges) and this radius are root properties
// (`--pi-scrubber-inset`, `--pi-scrubber-radius`), read by its own
// overlay-shell rule (WeatherMap/styles.css)
// and by the dock band shield's cut-out (LayoutPi/styles.css), which must
// uncover exactly that box.
const SCRUBBER_RADIUS = 12;
// The dock band's double-tap guard (useShellTiming): a dock button's
// 44 px plus this slack on each side, centred on the click that started
// the switch, so the second tap of a double tap, which lands within a few
// px of the first, can't reach the scrubber arriving over the band.
const DOCK_GUARD_SLACK = 8;

const SHELL_GEOMETRY = Object.freeze({
  railRight: RAIL_RIGHT,
  railTop: RAIL_TOP,
  railWidth: RAIL_WIDTH,
  railDockGap: RAIL_DOCK_GAP,
  dockButtonSize: DOCK_BUTTON_SIZE,
  dockHeight: DOCK_HEIGHT,
  sheetLeft: SHEET_LEFT,
  mapChromeGap: MAP_CHROME_GAP,
  legendChipHeight: LEGEND_CHIP_HEIGHT,
  toastChipGap: TOAST_CHIP_GAP,
  toastSideGap: TOAST_SIDE_GAP,
  scrubberRadius: SCRUBBER_RADIUS,
  dockGuardWidth: DOCK_BUTTON_SIZE + 2 * DOCK_GUARD_SLACK,
});

// Rail, dock and sheet transitions: the 250 ms of the map's recentring
// pan, on a cubic Bézier that APPROXIMATES Leaflet's pan curve,
// 1 − (1 − t)² (leaflet-src.js, PosAnimation) — the chrome trails the
// map by at most 2.9 % of the travel (at t ≈ 0.41: ~4.6 px of the
// marker's 155 px MIN ↔ MID move, ~9 px of the rail's 310 px slide).
// The chrome pieces share this curve, so they stay in lockstep with each
// other. cubic-bezier(1/3, 2/3, 2/3, 1) would match Leaflet exactly; the
// value below is the maintainer's choice.
// No rail fade beside a view: the rail stays painted under the sheet, at
// opacity 1, and only MIN ↔ MID moves it.
// `overlayOutMs` / `overlayInDelayMs` / `overlayInMs`: the map overlays on
// MIN ↔ MID (legend chip, legend card, raised chip, radar scrubber,
// FloatingMiniBanner). The ones leaving fade out in 100 ms as the slide
// starts; the ones arriving wait 150 ms (a CSS transition-delay, on the
// same clock as the slide), once those leaving are gone, and fade in over
// 150 ms, so the whole choreography is over by 150 + 150 = 300 ms. Back to
// MID it is the mirror: the card, the scrubber
// and the banner fade out in 100 ms and the chip fades in at 150–300 ms,
// ending with the choreography. The scrubber also rises 8 px as it fades
// in (and sinks as it fades out), the FloatingMiniBanner drops 8 px from
// above: `overlayShiftPx`.
// `sheetPrerollMs`: a view's sheet starts its opening slide one 60 Hz
// frame into its curve (a CSS transition-delay of −17 ms) and lasts 17 ms
// longer, so it still lands at `durationMs`: its first composited frame
// already shows the sheet moved (about 70 px of it on 800 × 480), where
// the frame at progress 0 was entirely off screen (measured on a Mac: one
// frame more than the grid shell before anything showed).
// 0 in form 2 and under reduced motion, like the other delays.
const SHELL_MOTION = Object.freeze({
  durationMs: 250,
  easing: "cubic-bezier(0, 0, 0.5, 1)",
  overlayOutMs: 100,
  overlayInDelayMs: 150,
  overlayInMs: 150,
  overlayShiftPx: 8,
  sheetPrerollMs: 17,
});

// The motion's end signal is the CSS transitions' own `Animation.finished`
// (useShellTiming). This fallback only covers a transition that never
// reports: it is armed at the motion's real start — once the tracked
// transitions' `Animation.ready` has settled, i.e. their start time is
// resolved after the frame that presents the commit (the long one on a
// Pi 3B, 150-266 ms for the forecast view), and no earlier than the read
// of the transitions, on the frame after that one (so the commit forces
// no style recalc); without the Web Animations API, one animation frame
// after that read — and allows 650 ms from there: the slide's 250 ms
// plus a wide margin for event dispatch (and, on the no-API path, for
// that long frame). Even then it is guarded:
// while a tracked transition still runs it waits SHELL_END_RECHECK_MS
// more and looks again, so it can never end a motion early. (A 400 ms
// timer armed at the commit recentred the map under the forecast sheet
// before the sheet had landed in 28 of 32 opens on the Pi 3B.)
const SHELL_SLIDE_END_FALLBACK_MS = 650;
const SHELL_END_RECHECK_MS = 100;

// How long a shield stays up after a switch that takes one frame (reduced
// motion, form 2, a view's close): long enough to swallow the second tap
// of a double tap on the control that triggered it (maintainer decision).
const SHELL_ONE_FRAME_SHIELD_MS = 300;

// Horizontal span the rail hides at the right edge: the MID x-offset and
// the distance the rail frame slides in MIN.
const RAIL_SPAN = RAIL_WIDTH + RAIL_RIGHT;

const ZERO_OFFSET = Object.freeze({ x: 0, y: 0 });
const MID_OFFSET = Object.freeze({ x: RAIL_SPAN, y: -DOCK_HEIGHT });

// Map-chrome insets (WeatherMap attribution, legend sheet, timeline's
// right edge). The attribution never sits under the rail, the sheet or the
// dock (test/mapAttribution.test.js forbids fading it instead).
const ATTRIBUTION_EDGE_GAP = 6; // between the attribution and the rail / sheet / right screen edge
const ATTRIBUTION_BOTTOM_GAP = 2; // between the attribution and the dock (MID) or screen bottom (MIN, views)
const ATTRIBUTION_VIEW_MAX_WIDTH = 192; // two lines inside the 210 px view strip

/**
 * Where the dock toast sits under the overlay shell (ControlButtons'
 * toast, fired from the MID dock): centred on the cleared map zone, 8 px
 * above the legend chip, and never wider than that zone minus 16 px a side.
 *
 * @param {number} viewportWidth - CSS px.
 * @returns {{centreX: number, bottom: number, maxWidth: number}} CSS px (245, 116, 458 on 800 px).
 */
function toastPlacement(viewportWidth) {
  const zone = viewportWidth - RAIL_SPAN;
  return {
    centreX: zone / 2,
    bottom: DOCK_HEIGHT + MAP_CHROME_GAP + LEGEND_CHIP_HEIGHT + TOAST_CHIP_GAP,
    maxWidth: zone - 2 * TOAST_SIDE_GAP,
  };
}

// Gap an auto-panned Leaflet popup keeps from the edge of the visible map:
// Leaflet's own `autoPanPadding` default ([5, 5]).
const POPUP_EDGE_PADDING = 5;

const NO_ATTRIBUTES = Object.freeze({});
const ROOT_ATTRIBUTES = Object.freeze({
  d1: Object.freeze({ "data-pi-shell": "d1", "data-pi-form": "1" }),
  "d1-form2": Object.freeze({ "data-pi-shell": "d1", "data-pi-form": "2" }),
  "d1-still": Object.freeze({ "data-pi-shell": "d1", "data-pi-form": "1", "data-pi-variant": "still" }),
});

/**
 * Validates a shell variant.
 *
 * @param {?string} raw - A candidate variant (null for none).
 * @returns {?string} The variant ("d1" | "d1-form2" | "d1-still"), or null for the grid shell.
 */
function parsePiShellVariant(raw) {
  return PI_SHELL_VARIANTS.includes(raw) ? raw : null;
}

/**
 * Rendering form of a variant: 2 for the clipped fallback, 1 otherwise.
 *
 * @param {?string} variant - A value returned by parsePiShellVariant.
 * @returns {?number} 1 or 2, or null when the variant is null (the grid shell).
 */
function piShellForm(variant) {
  if (!parsePiShellVariant(variant)) return null;
  return variant === "d1-form2" ? 2 : 1;
}

/**
 * Data attributes LayoutPi spreads on its root. Empty for the grid shell
 * (the taller panels, e.g. the 10.1"), so its root is unchanged; under the
 * overlay shell they gate every shell rule in LayoutPi/styles.css
 * (measurement tooling reads them too).
 *
 * @param {?string} variant - A value returned by parsePiShellVariant.
 * @returns {Readonly<object>} `data-pi-shell` / `data-pi-form` / `data-pi-variant` attributes, or an empty object.
 */
function piShellRootAttributes(variant) {
  const key = parsePiShellVariant(variant);
  return key ? ROOT_ATTRIBUTES[key] : NO_ATTRIBUTES;
}

/**
 * The LayoutPi shell for the priority-views gate's value: the overlay
 * shell's form 1 under the priority views (the 7" 800 × 480 panel, any
 * LayoutPi viewport 540 CSS px tall or less, or `forcePriorityViews` =
 * "on"), the grid shell otherwise (the taller panels, e.g. the 10.1"
 * 1024 × 640). The gate alone decides.
 *
 * @param {boolean} priorityViews - `priorityViewsEnabled()`.
 * @returns {?string} SHIPPED_SHELL_VARIANT ("d1"), or null for the grid shell.
 */
function shellVariantFor(priorityViews) {
  return priorityViews ? SHIPPED_SHELL_VARIANT : null;
}

/**
 * Left edge of the rail frame for a viewport width.
 *
 * @param {number} viewportWidth - CSS px.
 * @returns {number} CSS px (490 at 800).
 */
function railLeft(viewportWidth) {
  return viewportWidth - RAIL_SPAN;
}

/**
 * Tallest the rail frame may grow for a viewport height (it is
 * content-sized below that, so short content leaves the map tappable).
 *
 * @param {number} viewportHeight - CSS px.
 * @returns {number} CSS px (402 at 480).
 */
function railMaxHeight(viewportHeight) {
  return viewportHeight - RAIL_TOP - DOCK_HEIGHT - RAIL_DOCK_GAP;
}

/**
 * Map area left clear by the MID rail and dock (and the form 2 clip).
 *
 * @param {number} viewportWidth - CSS px.
 * @param {number} viewportHeight - CSS px.
 * @returns {{width: number, height: number}} CSS px (490 × 422 on 800 × 480).
 */
function clearedZone(viewportWidth, viewportHeight) {
  return { width: viewportWidth - RAIL_SPAN, height: viewportHeight - DOCK_HEIGHT };
}

// Last view pane shift handed out, so repeated calls at one width return
// the same object (stable for React dependency arrays).
let lastViewShift = null;

/**
 * Map offset for a LayoutPi state under the overlay shell, derived from
 * the state alone (never measured: the MID x of 310 includes the rail's
 * 10 px right gap, which no box's width carries, and a rect's left/right
 * read during a slide is shifted by the transform). Fed to WeatherMap's
 * centring (useRailOffset → panWithRailOffset, RailOffsetTracker,
 * ZoomAnchorOffset) and to the survey popup's auto-pan padding.
 * The views take MID's offset: Leaflet stays
 * at its MID pose during a view, never panned, and the map's panes move by
 * a CSS `translate` instead (viewPaneShift, WeatherMap/styles.css).
 *
 * @param {?string} state - `piLayoutState` ("min" | "mid" | a view | null).
 * @param {?string} variant - A value returned by parsePiShellVariant.
 * @returns {?{x: number, y: number}} Frozen offset, or null off the overlay shell, or when the state is null or unknown.
 */
function railOffsetFor(state, variant) {
  if (!parsePiShellVariant(variant) || state == null) return null;
  if (state === "mid") return MID_OFFSET;
  if (state === "min") return variant === "d1-still" ? MID_OFFSET : ZERO_OFFSET;
  if (isViewState(state)) return MID_OFFSET;
  return null;
}

/**
 * The CSS `translate` of Leaflet's map pane during a view: the MID
 * marker (centre of the area the rail and dock leave clear) moves to the
 * centre of the strip left of the sheet, at the same height — (245, 211)
 * to (105, 211) on 800 × 480, a shift of (−140, 0). Tiles, rings, marker,
 * arrows and polygons move together (they are all in the map pane); the
 * attribution, in Leaflet's control corner, stays put. WeatherMap/styles.css
 * computes the same value from the root's `--pi-sheet-left` and
 * `--pi-rail-span` (test/piShellGeometry.test.js ties the two).
 *
 * @param {number} viewportWidth - CSS px (the map's width).
 * @returns {{x: number, y: number}} Frozen shift, CSS px.
 */
function viewPaneShift(viewportWidth) {
  const x = (SHEET_LEFT + RAIL_SPAN - viewportWidth) / 2;
  if (!lastViewShift || lastViewShift.x !== x) lastViewShift = Object.freeze({ x, y: 0 });
  return lastViewShift;
}

/**
 * Where the marker lands for an offset — panWithRailOffset's target and
 * ZoomAnchorOffset's anchor.
 *
 * @param {{x: number, y: number}} offset - A railOffsetFor result.
 * @param {number} viewportWidth - CSS px.
 * @param {number} viewportHeight - CSS px.
 * @returns {{x: number, y: number}} Container point, CSS px.
 */
function markerPoint(offset, viewportWidth, viewportHeight) {
  return {
    x: viewportWidth / 2 - offset.x / 2,
    y: viewportHeight / 2 + offset.y / 2,
  };
}

/**
 * Map-chrome insets for a LayoutPi state under the overlay shell, in two
 * groups that follow different states while a switch is in flight (see
 * Timing below):
 *   - with the CHROME state (`data-pi-state`): `railVisibleWidth`, the
 *     map hidden at the right (the existing `--c-rail-visible-width`
 *     contract), and `mapBottomInset`, which lifts the legend's detail
 *     sheet above the dock. Nothing that moves reads them: the overlays
 *     that fade on MIN ↔ MID each keep one place (overlayPlacement), so
 *     none jumps when the state changes under it;
 *   - with the MAP state (`data-pi-map`): the attribution's `attrRight`
 *     and `attrBottom` (its transform) and `attrMaxWidth` (null =
 *     unconstrained, one line), so it moves in the frame the map
 *     recentres — when a view opens, at the end of the sheet's slide.
 * The attribution always keeps 6 px from what it borders on the right
 * (the rail, the sheet, the screen edge in MIN) and 2 px from what it
 * borders below (the dock, the screen edge), so between MID and MIN it
 * travels exactly the rail's 310 px and the dock's 58 px: the design
 * canvas's `translate(310px, 58px)`, in lockstep with them on the shared
 * curve, ending on MIN's place (right 6, bottom 2) with nothing left to
 * set.
 *
 * @param {?string} state - `piLayoutState`.
 * @param {number} viewportWidth - CSS px (only views depend on it).
 * @returns {?{railVisibleWidth: number, mapBottomInset: number, attrRight: number, attrBottom: number, attrMaxWidth: ?number}} CSS px, or null for a null / unknown state.
 */
function chromeFor(state, viewportWidth) {
  if (state === "mid") {
    const right = RAIL_SPAN + ATTRIBUTION_EDGE_GAP;
    return {
      railVisibleWidth: right,
      mapBottomInset: DOCK_HEIGHT,
      attrRight: right,
      attrBottom: DOCK_HEIGHT + ATTRIBUTION_BOTTOM_GAP,
      attrMaxWidth: null,
    };
  }
  if (state === "min") {
    return {
      railVisibleWidth: 0,
      mapBottomInset: 0,
      attrRight: ATTRIBUTION_EDGE_GAP,
      attrBottom: ATTRIBUTION_BOTTOM_GAP,
      attrMaxWidth: null,
    };
  }
  if (isViewState(state)) {
    const right = viewportWidth - SHEET_LEFT + ATTRIBUTION_EDGE_GAP;
    return {
      railVisibleWidth: right,
      mapBottomInset: 0,
      attrRight: right,
      attrBottom: ATTRIBUTION_BOTTOM_GAP,
      attrMaxWidth: ATTRIBUTION_VIEW_MAX_WIDTH,
    };
  }
  return null;
}

/**
 * Auto-pan padding for a Leaflet popup over the overlay shell's map
 * (WeatherMap's nearby-alerts survey popup), from a railOffsetFor offset:
 * `x` is hidden at the right edge, a negative `y` at the bottom (the dock
 * band), a positive `y` at the top. Leaflet pans the map until the popup clears
 * that padding, so a popup opened beside the rail or above the dock lands
 * in the visible map instead of under them. Spread as `<Popup>` props
 * (Leaflet reads `autoPanPaddingTopLeft` / `autoPanPaddingBottomRight`
 * when the popup opens).
 *
 * @param {?{x: number, y: number}} offset - A railOffsetFor result (null = no overlay).
 * @returns {{autoPanPaddingTopLeft: number[], autoPanPaddingBottomRight: number[]}} `[x, y]` CSS px each; Leaflet's [5, 5] default on both corners for a zero or null offset.
 */
function popupAutoPanPadding(offset) {
  const x = (offset && offset.x) || 0;
  const y = (offset && offset.y) || 0;
  return {
    autoPanPaddingTopLeft: [POPUP_EDGE_PADDING, Math.max(0, y) + POPUP_EDGE_PADDING],
    autoPanPaddingBottomRight: [Math.max(0, x) + POPUP_EDGE_PADDING, Math.max(0, -y) + POPUP_EDGE_PADDING],
  };
}

// ---------------------------------------------------------------------
// Map overlays: one place each, one state each.
//
// The overlays that differ between MID and MIN are all mounted under the
// overlay shell (pre-mounted, hidden and inert outside their state,
// nothing running), so a switch only flips which ones are live:
//   - the legend chip, MID only, above the dock band (bottom 74);
//   - the legend card, MIN without the scrubber, in the corner (bottom 16);
//   - the raised legend chip, MIN with the scrubber, above it (bottom 122,
//     the base `.with-timeline` place); a second chip rather than the MID
//     one moved, since it fades out at 74 and back in at 122;
//   - the radar scrubber, MIN with the scrubber (bottom 16);
//   - the FloatingMiniBanner, MIN (when an eligible alert exists).
// None of them ever changes place, so none moves while visible. Views
// keep the legend and the scrubber mounted, hidden and inert (WeatherMap
// `chromeMounted`, `scrubberMounted`), and hide the banner.

// Bottom edge of each overlay, CSS px from the screen's bottom edge. The
// base rules' MIN places (16 and 122, WeatherMap/styles.css) and the MID
// chip above the dock band.
const RAISED_CHIP_BOTTOM = 122;

/**
 * Where each map overlay sits under the overlay shell — one place per
 * overlay, the same in every state.
 *
 * @returns {{chip: number, chipRaised: number, card: number, scrubber: number}} Bottom edges, CSS px (74, 122, 16, 16).
 */
function overlayPlacement() {
  return {
    chip: DOCK_HEIGHT + MAP_CHROME_GAP,
    chipRaised: RAISED_CHIP_BOTTOM,
    card: MAP_CHROME_GAP,
    scrubber: MAP_CHROME_GAP,
  };
}

const NO_OVERLAYS = Object.freeze({ legend: "none", scrubber: false, banner: false });
const MID_OVERLAYS = Object.freeze({ legend: "chip", scrubber: false, banner: false });
const MIN_OVERLAYS = Object.freeze({ legend: "card", scrubber: false, banner: true });
const MIN_SCRUBBER_OVERLAYS = Object.freeze({ legend: "chipRaised", scrubber: true, banner: true });

/**
 * Which map overlays are live for a chrome state (the rest are mounted,
 * hidden and inert). Under the overlay shell the MID legend is always the
 * chip: the cleared zone is 490 × 422, too small for the card, whatever
 * the screen height.
 *
 * @param {?string} chromeState - The chrome state ("mid" | "min" | a view).
 * @param {boolean} scrubberOpen - `piScrubberOpen`.
 * @returns {{legend: string, scrubber: boolean, banner: boolean}} `legend` "chip" | "chipRaised" | "card" | "none"; frozen.
 */
function overlayPresentation(chromeState, scrubberOpen) {
  if (chromeState === "mid") return MID_OVERLAYS;
  if (chromeState === "min") return scrubberOpen ? MIN_SCRUBBER_OVERLAYS : MIN_OVERLAYS;
  return NO_OVERLAYS;
}

// ---------------------------------------------------------------------
// Timing: one React update per switch.
//
// A switch between two LayoutPi states is ONE state update, at the tap.
// That commit stamps the new state on the root (`data-pi-state`, and the
// switch's kind, `data-pi-switch`), sets `inert` on the boxes and overlays
// leaving and clears it on those arriving, and every motion then runs in
// CSS from that one style change, all started together on the
// compositor's clock:
//   - the rail frame, the dock band and the view sheet stay laid out in
//     every state, except the dock band in MIN once its slide is over:
//     there it leaves the render, behind an
//     `@supports (transition-behavior: allow-discrete)` gate
//     (LayoutPi/styles.css). Out, they are `visibility: hidden` and inert.
//     Leaving, their `visibility` waits for the end of their slide or fade
//     (`visibility 0s linear <duration>`); arriving, it returns at once
//     (`visibility 0s`), so the entry starts in the tap's own frame;
//   - the map overlays (above): those leaving fade out in 100 ms, those
//     arriving wait 150 ms (transition-delay) and fade in over 150 ms, so
//     everything is over by 300 ms;
//   - the attribution slides with the rail and dock on MIN ↔ MID.
// No React render is scheduled inside the motion. What must follow it
// runs on its end signal — the CSS transitions' own `Animation.finished`
// (useShellTiming), with the guarded fallback above — and one more frame:
//   - opening a view (form 1 with motion): once the SHEET's own transform
//     transition has ended, the MAP state follows in one frame: the map
//     recentres without animation under the sheet, the radar loop stops,
//     the attribution wraps onto two lines;
//   - the dock band's shield lifts when the DOCK's own transform
//     transition has ended (dockShieldMode);
//   - the root's `data-pi-moving` drops one frame after the last moving
//     element has ended (after the recentre, opening a view);
//   - then a "settled" render: the views' shield lifts after a close
//     (viewShieldHeld), the scrubber's engagement work (playhead snap,
//     RainViewer frame window) starts if it settled in MIN with the
//     scrubber — unless the scrubber's first input started it earlier,
//     in one synchronous commit inside that input's event, the only
//     render a switch may take inside its motion (useShellTiming
//     `engageTimeline`; a visible control never ignores an input) — it
//     stops in the commit of the switch out of MIN — and its flag clears
//     once out of MIN (scrubberFlagClears).
// The states that can trail `piLayoutState`:
//   - the CHROME state: the rail frame, the dock band, the view sheet, the
//     map overlays and the map's own chrome (zoom, focus button);
//   - the MAP state: the recentring offset, the radar loop, and the
//     attribution's place and width.
// `shellSwitchPlan` says which of the two waits, and for what:
//   - "sheet": opening a view under form 1 with motion, the map waits for
//     the sheet's slide (above);
//   - "frame": one frame later (useShellTiming's afterNextFrame). No plan
//     uses it: rather than a two-frame MIN ↔ MID under reduced motion (the
//     map's work on a frame of its own), every reduced-motion switch takes
//     one frame. The hook keeps the generic wait.
// Every other switch is one frame for both: closing a view (sheet hidden,
// map recentred without animation, attribution back on one line; the
// dock then slides back), every reduced-motion switch, and form 2
// everywhere. The `kind` of a switch ("view" when a view opens, closes or
// changes, "slide" for MIN ↔ MID) picks the rail's motion (none beside a
// view, the 250 ms slide otherwise) and whether the map
// recentres with Leaflet's animated pan (slides only).

const SHELL_MODES = Object.freeze({
  // Form 1, motion allowed: slides and fades, the MIN ↔ MID pan animated.
  animated: "animated",
  // prefers-reduced-motion under form 1: no transition, every switch in one
  // frame.
  reduced: "reduced",
  // The grid shell, where nothing waits, and form 2 (unreachable): every
  // switch in one frame.
  instant: "instant",
});

/**
 * True for the four full-rail view states (forecast, alert, conditions, AI).
 *
 * @param {?string} state - `piLayoutState`.
 * @returns {boolean} Whether the state shows a view sheet.
 */
function isViewState(state) {
  return VIEW_STATES.includes(state);
}

/**
 * Timing mode of the shell for a variant and the reduced-motion preference.
 *
 * @param {?string} variant - A value returned by parsePiShellVariant.
 * @param {boolean} reducedMotion - prefers-reduced-motion: reduce.
 * @returns {string} A SHELL_MODES value ("instant" for the grid shell, where nothing waits).
 */
function shellMode(variant, reducedMotion) {
  if (piShellForm(variant) !== 1) return SHELL_MODES.instant;
  return reducedMotion ? SHELL_MODES.reduced : SHELL_MODES.animated;
}

const SAME_STATE_PLAN = Object.freeze({ kind: "slide", chromeWait: null, mapWait: null });

/**
 * What waits, and for what, when the shell switches from one LayoutPi
 * state to another (see the section comment above).
 *
 * @param {?string} from - The previous `piLayoutState`.
 * @param {?string} to - The new `piLayoutState`.
 * @param {string} mode - A SHELL_MODES value.
 * @returns {{kind: string, chromeWait: ?string, mapWait: ?string}} `kind` "view" | "slide"; each wait null (this frame), "frame" or "sheet".
 */
function shellSwitchPlan(from, to, mode) {
  if (from === to) return SAME_STATE_PLAN;
  const kind = isViewState(from) || isViewState(to) ? "view" : "slide";
  let chromeWait = null;
  let mapWait = null;
  // Reduced motion and form 2: everything in the switch's own frame.
  if (mode === SHELL_MODES.animated && isViewState(to) && !isViewState(from)) mapWait = "sheet";
  return Object.freeze({ kind, chromeWait, mapWait });
}

/**
 * The shell's switch record before any switch (useShellTiming): number 0,
 * from and to the state LayoutPi mounts in, planned in the mode current
 * then.
 *
 * @param {string} state - The state at mount ("mid" when unset).
 * @param {string} mode - A SHELL_MODES value.
 * @returns {{id: number, from: string, to: string, mode: string, plan: object}} The record.
 */
function initialShellSwitch(state, mode) {
  return Object.freeze({ id: 0, from: state, to: state, mode, plan: shellSwitchPlan(state, state, mode) });
}

/**
 * The switch a render of useShellTiming runs. While `state` is still the
 * target of `committed` (the last switch a committed render ran), that
 * same record, so its effects never re-run; otherwise the next switch:
 * numbered after it, from its target to `state`, planned in `mode` (the
 * reduced-motion mode current at this render), which the record then
 * keeps for the switch's whole life. The render that first sees a new
 * state records it, in the commit of that state (derived from the
 * committed record, no state update during render).
 *
 * @param {{id: number, to: string}} committed - The last committed switch record.
 * @param {string} state - The state this render shows ("mid" when unset).
 * @param {string} mode - A SHELL_MODES value, the mode current at this render.
 * @returns {{id: number, from: string, to: string, mode: string, plan: object}} `committed`, or the new record.
 */
function nextShellSwitch(committed, state, mode) {
  if (committed.to === state) return committed;
  return Object.freeze({ id: committed.id + 1, from: committed.to, to: state, mode, plan: shellSwitchPlan(committed.to, state, mode) });
}

/**
 * Whether the map recentres without animation after a switch: always in
 * form 2 and under reduced motion, and on every view switch (opening:
 * once the sheet has landed; closing: in the frame the sheet disappears).
 * Only MIN ↔ MID under form 1 uses Leaflet's animated pan.
 *
 * @param {string} mode - A SHELL_MODES value.
 * @param {string} kind - The switch's `kind` from shellSwitchPlan.
 * @returns {boolean} True for an instant (animate: false) recentre.
 */
function recentresInstantly(mode, kind) {
  return mode !== SHELL_MODES.animated || kind === "view";
}

/**
 * How the end of a switch's motion is found: form 1 with motion waits for
 * its CSS transitions to finish ("transitions"); reduced motion and form 2
 * have none, so the motion is over with the switch's commit, and
 * `data-pi-moving` drops one frame after it ("frame"). Form 2's durations
 * are 0 ms; under reduced motion LayoutPi/styles.css turns off every
 * transition in the moving set — the boxes and everything inside them —
 * kept as a guard behind styles/main.css, which removes every transition
 * under reduced motion since PR 411.
 *
 * @param {string} mode - A SHELL_MODES value.
 * @returns {string} "transitions" or "frame".
 */
function motionEnd(mode) {
  return mode === SHELL_MODES.animated ? "transitions" : "frame";
}

/**
 * The dock band's shield for a switch. It catches the taps in the band
 * that neither the moving dock nor the inert, fading map overlays take,
 * so they can't reach the map there and move the station (WeatherMap's
 * MapClickHandler relocates on any map tap) — the second tap of a quick
 * double tap on a dock button (the timeline's; touch chatter on a cheap
 * panel). The dock (z 1100) stays above it, so it takes its taps from the
 * first frame it is back. Mounted once; this only says when it is up:
 *   - "dockEnd": MIN ↔ MID under form 1 with motion, from the switch's
 *     commit until the DOCK's own transform transition has ended;
 *   - "hold": MIN ↔ MID in one frame (reduced motion; form 2):
 *     SHELL_ONE_FRAME_SHIELD_MS from the commit (maintainer
 *     decision: a double tap after a one-frame switch must not land on
 *     what it uncovered);
 *   - "none": no switch, or a view switch, where the views' full-screen
 *     shield is up instead (viewShieldHeld).
 *
 * @param {?string} from - The previous `piLayoutState`.
 * @param {?string} to - The new `piLayoutState`.
 * @param {string} mode - A SHELL_MODES value.
 * @returns {string} "dockEnd", "hold" or "none".
 */
function dockShieldMode(from, to, mode) {
  if (from === to || isViewState(from) || isViewState(to)) return "none";
  return mode === SHELL_MODES.animated ? "dockEnd" : "hold";
}

/**
 * Whether the views' gesture shield (the full screen, under the sheet) is
 * up: for as long as the chrome shows a view, then, once a view has
 * closed, until the switch has settled — the dock back at rest (form 1
 * with motion) and SHELL_ONE_FRAME_SHIELD_MS gone since the close
 * (settleHoldMs), so a tap where the dock is still sliding up, or the
 * second tap of a double tap on the view's close button, can't reach the
 * map or the MID rail under it. MIN ↔ MID never raises it: the dock
 * band's own shield covers a slide (dockShieldMode).
 *
 * @param {string} chromeState - The chrome state ("mid" | "min" | a view).
 * @param {string} kind - The last switch's `kind` from shellSwitchPlan.
 * @param {boolean} settled - The last switch has settled (useShellTiming).
 * @returns {boolean} True while the shield must cover the map and the rail.
 */
function viewShieldHeld(chromeState, kind, settled) {
  if (isViewState(chromeState)) return true;
  return kind === "view" && !settled;
}

/**
 * The least time, from its commit, before a switch may settle: closing a
 * view is a one-frame switch (the sheet goes in the close's own frame, in
 * every mode), so the views' shield stays up SHELL_ONE_FRAME_SHIELD_MS
 * after it whatever the dock does; nothing else waits.
 *
 * @param {?string} from - The previous `piLayoutState`.
 * @param {?string} to - The new `piLayoutState`.
 * @returns {number} ms.
 */
function settleHoldMs(from, to) {
  return isViewState(from) && !isViewState(to) ? SHELL_ONE_FRAME_SHIELD_MS : 0;
}

/**
 * Whether LayoutPi may clear the radar scrubber's ephemeral
 * `piScrubberOpen` flag. The grid shell: once `piLayoutState` has left MIN.
 * The overlay shell: also only once the switch has settled — never inside
 * the motion (the flag is in PiLayoutContext, so clearing it re-renders every
 * reader of that context), and never on the way in, where the dock's timeline
 * button sets the flag and MIN in one commit. The scrubber is hidden and
 * inert outside MIN as soon as the switch commits (overlayPresentation),
 * whatever the flag says meanwhile.
 *
 * @param {?string} layoutState - `piLayoutState` (null outside LayoutPi).
 * @param {boolean} [settled] - Overlay shell: the last switch has settled; undefined on the grid shell.
 * @returns {boolean} True when the flag may be cleared.
 */
function scrubberFlagClears(layoutState, settled) {
  if (!layoutState || layoutState === "min") return false;
  return settled !== false;
}

module.exports = {
  PI_SHELL_VARIANTS,
  SHIPPED_SHELL_VARIANT,
  VIEW_STATES,
  SHELL_GEOMETRY,
  SHELL_MOTION,
  SHELL_SLIDE_END_FALLBACK_MS,
  SHELL_END_RECHECK_MS,
  SHELL_ONE_FRAME_SHIELD_MS,
  SHELL_MODES,
  isViewState,
  shellMode,
  shellSwitchPlan,
  initialShellSwitch,
  nextShellSwitch,
  recentresInstantly,
  motionEnd,
  dockShieldMode,
  viewShieldHeld,
  settleHoldMs,
  scrubberFlagClears,
  overlayPlacement,
  overlayPresentation,
  toastPlacement,
  ATTRIBUTION_EDGE_GAP,
  ATTRIBUTION_VIEW_MAX_WIDTH,
  ATTRIBUTION_BOTTOM_GAP,
  POPUP_EDGE_PADDING,
  parsePiShellVariant,
  piShellForm,
  piShellRootAttributes,
  shellVariantFor,
  railLeft,
  railMaxHeight,
  clearedZone,
  railOffsetFor,
  viewPaneShift,
  markerPoint,
  chromeFor,
  popupAutoPanPadding,
};
