// The overlay shell's tracked elements that LayoutPi does not render
// itself (so a view switch's click walks no DOM tree).
// LayoutPi/useShellTiming.js would otherwise find them with
// `root.querySelector(All)` in each switch's commit and in its click
// listener: the map overlays (`[data-pi-overlay-el]`: RadarLegend's chip,
// raised chip and card, RadarTimeline, FloatingMiniBanner), the live
// scrubber among them, and Leaflet's bottom-right control corner (the
// attribution, which slides with the shell). Each such query walks
// LayoutPi's whole subtree, the map's tiles included, up to the match
// (0.2-0.3 ms per click at CPU ×4).
// Here they register themselves instead, through ref callbacks LayoutPi
// hands down (overlay shell only), so the hook reads a set and a variable:
//   - `overlayRef`: a React 19 ref callback for every element carrying
//     `data-pi-overlay-el` (added when React attaches it, removed by the
//     cleanup it returns when React detaches it, in the commit that
//     unmounts it, before that commit's layout effects);
//   - `attributionRef`: the same, for the attribution corner (WeatherMap
//     registers it from inside the map, once per Leaflet map).
// Both are stable functions (made once per registry), so React never
// re-attaches them on a re-render.
//
// The chrome presentation (so the map chrome kept mounted under the
// overlay shell renders nothing on a switch). The shell's timing calls
// `present(chromeState, scrubberOpen)` in the commit of every chrome
// change (a layout effect, before the frame that paints it), and the
// registry sets, by hand, the `inert` attribute that these elements would
// otherwise take from a React prop and that their overlay-shell CSS reads
// for their visibility (WeatherMap/styles.css):
//   - RadarLegend's three presentations (its registered overlays "chip",
//     "chip-raised" and "card"): inert unless overlayPresentation names
//     them live;
//   - the chrome that hides in the views (`viewChromeRef`: the radar-focus
//     button): inert in a view state.
// The scrubber and FloatingMiniBanner keep theirs from React: they render
// on their own changes anyway (the scrubber's clock and engagement, the
// banner's alert), and a view switch changes neither. Components read the
// presentation during render through `presentation()` and `viewHidden()`
// (React's useSyncExternalStore; `subscribe` is told after each change):
// one that renders for its own reasons renders the attribute the registry
// has set, and one with something open (the legend's detail sheet, the
// focus button's toast) subscribes while it is open, to close it when the
// chrome leaves its state. Before the first `present`, the registry
// presents MID, LayoutPi's state at mount. A Leaflet-built element (the
// zoom bar) has no React ref: WeatherMap's ShellZoomInert subscribes and
// sets it from `viewHidden()`.
//
// The registry owns the `inert` it sets, and gives it back when an element
// leaves it: the cleanup of a legend presentation's or a view chrome
// element's ref removes the attribute. The element is then either being
// unmounted (nothing to show) or staying mounted without the shell (the
// shell turning off under a mounted LayoutPi: its ref goes from the
// registry's to none), where the component renders no `inert` and React,
// whose last render may have written none while the registry set it,
// would write nothing either (defensive: the compiled LayoutPi reads the
// shell's gate once per mount, see LayoutPi/useShellTiming.js). Whether
// an overlay is a legend
// presentation is read when it registers, its OVERLAY_ATTRIBUTE then
// React's own. The scrubber's and the banner's `inert` stay React's.
//
// MODULE FORMAT: CommonJS on purpose (like ui/pressTint.js), so
// test/shellElements.test.js runs the real module against stand-in
// elements.

const { isViewState, overlayPresentation } = require("./piShellGeometry");

/** The attribute every map overlay of the overlay shell carries (its value names it). */
const OVERLAY_ATTRIBUTE = "data-pi-overlay-el";

/** RadarTimeline's value of OVERLAY_ATTRIBUTE. */
const SCRUBBER_OVERLAY = "scrubber";

/** The chrome state the registry presents before the first `present` (LayoutPi mounts in MID). */
const INITIAL_CHROME_STATE = "mid";

/**
 * RadarLegend's presentations: their OVERLAY_ATTRIBUTE value → the
 * `legend` value of overlayPresentation that makes each one live.
 */
const LEGEND_OVERLAYS = new Map([
  ["chip", "chip"],
  ["chip-raised", "chipRaised"],
  ["card", "card"],
]);

/**
 * A registry of the shell's map overlays, attribution corner and view
 * chrome, and of the chrome presentation they follow (see the header).
 * One per LayoutPi.
 *
 * @returns {{overlayRef: function(?Element): (function(): void|undefined), attributionRef: function(?Element): (function(): void|undefined), viewChromeRef: function(?Element): (function(): void|undefined), overlays: function(): Element[], liveScrubber: function(): boolean, attribution: function(): ?Element, viewChrome: function(): Element[], present: function(string, boolean): void, presentation: function(): {legend: string, scrubber: boolean, banner: boolean}, viewHidden: function(): boolean, subscribe: function(function(): void): function(): void}}
 *   the three ref callbacks; the readers: the overlays mounted now, whether one of them is a live
 *   (not inert) scrubber, the attribution corner (null before the map exists), and the view chrome
 *   mounted now (the style warm-up, ui/styleWarmup.js, writes its `inert` as a view's opening does, and puts it back); and the chrome
 *   presentation: `present` (for the shell's timing), its two snapshots (a frozen
 *   overlayPresentation object, and whether a view hides the view chrome) and `subscribe`.
 */
function createShellElements() {
  const overlays = new Set();
  const viewChrome = new Set();
  const listeners = new Set();
  let attribution = null;
  let presentation = overlayPresentation(INITIAL_CHROME_STATE, false);
  let viewHidden = isViewState(INITIAL_CHROME_STATE);
  return {
    overlayRef: (el) => {
      if (!el) return undefined;
      overlays.add(el);
      const ownsInert = LEGEND_OVERLAYS.has(el.getAttribute(OVERLAY_ATTRIBUTE));
      return () => {
        overlays.delete(el);
        if (ownsInert) el.removeAttribute("inert");
      };
    },
    attributionRef: (el) => {
      if (!el) return undefined;
      attribution = el;
      return () => {
        if (attribution === el) attribution = null;
      };
    },
    viewChromeRef: (el) => {
      if (!el) return undefined;
      viewChrome.add(el);
      return () => {
        viewChrome.delete(el);
        el.removeAttribute("inert");
      };
    },
    overlays: () => [...overlays],
    // True while a registered overlay named SCRUBBER_OVERLAY has no
    // `inert`: a mounted scrubber that takes input.
    liveScrubber: () => {
      for (const el of overlays) {
        if (el.getAttribute(OVERLAY_ATTRIBUTE) === SCRUBBER_OVERLAY && !el.hasAttribute("inert")) return true;
      }
      return false;
    },
    attribution: () => attribution,
    // The view chrome registered now (the radar-focus button): read by the
    // style warm-up (ui/styleWarmup.js), which writes and puts back its
    // `inert` in one task.
    viewChrome: () => [...viewChrome],
    // The chrome now shows `chromeState` (with the scrubber flag): set the
    // registered elements' `inert` (toggleAttribute changes nothing where
    // it is already right), then tell the subscribers. Nothing at all when
    // neither snapshot changes (from a view to another view, say).
    present: (chromeState, scrubberOpen) => {
      const nextPresentation = overlayPresentation(chromeState, scrubberOpen);
      const nextViewHidden = isViewState(chromeState);
      if (nextPresentation === presentation && nextViewHidden === viewHidden) return;
      presentation = nextPresentation;
      viewHidden = nextViewHidden;
      for (const el of overlays) {
        const live = LEGEND_OVERLAYS.get(el.getAttribute(OVERLAY_ATTRIBUTE));
        if (live !== undefined) el.toggleAttribute("inert", live !== presentation.legend);
      }
      for (const el of viewChrome) el.toggleAttribute("inert", viewHidden);
      for (const listener of [...listeners]) listener();
    },
    presentation: () => presentation,
    viewHidden: () => viewHidden,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

module.exports = { OVERLAY_ATTRIBUTE, SCRUBBER_OVERLAY, LEGEND_OVERLAYS, createShellElements };
