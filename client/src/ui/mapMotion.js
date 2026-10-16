// Map motion under the OS "reduce motion" preference: the two decisions
// WeatherMap applies to Leaflet from JavaScript.
//
// styles/main.css removes every CSS transition under
// `(prefers-reduced-motion: reduce)`, except Leaflet's zoom transition,
// which it keeps at 0.01 ms: Leaflet ends a zoom on `transitionend`, and
// without a transition it would wait for its 250 ms fallback timer. CSS
// can't reach the motion Leaflet runs in JavaScript, a 0.25 s pan on
// requestAnimationFrame (PosAnimation):
//   - a recentre at the same zoom (`panTo`, or a `setView` / `fitBounds`
//     that lands on the current zoom);
//   - the inertia that carries the map on after a drag is released.
// Under reduced motion the recentre takes `{ animate: false }`: Leaflet
// moves the map pane in one step (`_rawPanBy`) and keeps the tiles. A ZOOM
// change keeps Leaflet's animated path, a CSS zoom that the 0.01 ms
// exception ends at once (the zoom is unchanged by this module): with
// `animate: false`, `setView` would go through `_resetView`, which can
// leave the map without tiles until the new ones arrive (a grey frame,
// seen on a zoom out). Inertia goes off through `map.options.inertia`,
// which Leaflet's Map.Drag reads at every drag start, move and end
// (WeatherMap/MapInertia.js keeps it in step with the OS).
//
// CommonJS on purpose (like ui/opaqueTokens.js): webpack takes it next to
// the ESM tree, and `test/mapMotion.test.js` runs the real module.

/**
 * Whether a recentre issued from JavaScript keeps Leaflet's animated path.
 *
 * "Animated" means: call Leaflet without an `animate` option, exactly as
 * without reduced motion (never `animate: true`, which would also force an
 * animation for a far move that Leaflet otherwise jumps). `false` means:
 * pass `{ animate: false }`.
 *
 * @param {object} args the move
 * @param {boolean} [args.animate] the caller's own choice; false never
 *   animates, whatever the preference (default true)
 * @param {number} args.fromZoom the map's zoom before the move
 * @param {number} args.toZoom the zoom the move lands on
 * @param {boolean} [args.reducedMotion] the OS asks for reduced motion
 *   (default false)
 * @returns {boolean} false when the caller asked for no animation, or under
 *   reduced motion when the zoom stays the same; true otherwise, a zoom
 *   change under reduced motion included
 */
function recenterAnimates({ animate = true, fromZoom, toZoom, reducedMotion = false }) {
  if (!animate) return false;
  if (!reducedMotion) return true;
  return fromZoom !== toZoom;
}

/**
 * Leaflet's drag inertia for the current reduced-motion preference.
 *
 * @param {boolean} baseInertia the map's own `inertia` option, as created
 *   (Leaflet's default is true)
 * @param {boolean} reducedMotion the OS asks for reduced motion
 * @returns {boolean} false under reduced motion, else the map's own option
 */
function mapInertia(baseInertia, reducedMotion) {
  return Boolean(baseInertia) && !reducedMotion;
}

module.exports = { recenterAnimates, mapInertia };
