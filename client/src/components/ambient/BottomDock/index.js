import React from "react";
import PropTypes from "prop-types";
import ControlButtons from "~/components/ambient/ControlButtons";
import HealthIndicator from "~/components/ambient/HealthIndicator";
import styles from "./styles.css";

/**
 * Direction C bottom dock — anchors the row of control icons (reset
 * map / marker / timeline / dark mode / settings / debug / update)
 * along the bottom edge of every ambient layout (Pi, Desktop, Mobile).
 *
 * v3.1 Phase 1: `ControlButtons` and `HealthIndicator` are now
 * wired in their grouped / chip variants. The icons split into
 * three labelled groups (Map · Display · System) with hairline
 * separators between them (a fourth group, Views, was added in the
 * 2026-06-24 rail-affordance redesign: the Pi dock's AI and forecast
 * view-opens; off the Pi it holds at most the localhost + debug
 * AI-summary toggle and is omitted when empty), and the health dot
 * is replaced by a status chip ("Services · OK / Dégradé / Critique /
 * Hors ligne") anchored to the right edge of the dock. Both component-side
 * styles include their own narrow-viewport collapse rules so the
 * 7" Pi (932 px) and phones get tighter layouts without changing
 * the dock wrapper itself.
 *
 * On LayoutPi's overlay shell (under the priority views) LayoutPi repaints
 * this wrapper as an opaque 58 px band over the map, its stylesheet sets
 * `--ctrl-btn-size: 44px` for the buttons inside, and ControlButtons moves
 * four of them into a "···" overflow menu (DockOverflowMenu). Out of MID the
 * band stays laid out, slid down and `visibility: hidden`
 * (LayoutPi/styles.css; in MIN, once its slide is over, out of the render),
 * and LayoutPi's shell timing makes this wrapper inert from the commit that
 * sends it away (the band must take no tap, focus or assistive-tech visit on
 * the way), by hand on the element `cellRef` names, so a switch renders
 * neither this component nor its buttons and health chip (an `inert` prop
 * would re-render all three at every view switch).
 *
 * Memoized (React.memo): its props are constants or a stable ref in every
 * layout, so a parent's render never renders it, its buttons or its health
 * chip, whatever the React Compiler does with the layouts. ControlButtons
 * and HealthIndicator still render on their own contexts and state.
 *
 * @param {object} props
 * @param {boolean} [props.piDockCell] LayoutPi (both shells): stamps
 *   `data-pi-dock-cell` on the wrapper, the attribute by which LayoutPi's
 *   stylesheet and its overlay-shell timing hook find the dock cell (a state
 *   change then restyles the dock, not the layout's whole subtree, as a
 *   `:last-child` rule keyed on the state did). False elsewhere, which
 *   renders nothing.
 * @param {{current: ?Element}} [props.cellRef] Overlay shell only: a ref
 *   to this wrapper (the dock cell), through which LayoutPi's timing hook
 *   reads the dock's motion, tells a click on the dock without walking the
 *   DOM and sets the cell's `inert` outside MID. Undefined everywhere else.
 * @returns {JSX.Element} bottom-dock slab
 */
const BottomDock = ({ piDockCell = false, cellRef }) => (
  <div ref={cellRef} className={styles.dock} data-pi-dock-cell={piDockCell ? "" : undefined}>
    <ControlButtons />
    <HealthIndicator chip />
  </div>
);

BottomDock.propTypes = {
  piDockCell: PropTypes.bool,
  cellRef: PropTypes.shape({ current: PropTypes.object }),
};

export default React.memo(BottomDock);
