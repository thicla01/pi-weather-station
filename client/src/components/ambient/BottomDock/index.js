import React from "react";
import ControlButtons from "~/components/ambient/ControlButtons";
import HealthIndicator from "~/components/ambient/HealthIndicator";
import styles from "./styles.css";

/**
 * Direction C bottom dock — anchors the row of control icons (reset
 * map / marker / timeline / dark mode / settings / debug / update)
 * along the bottom edge of the Pi layout.
 *
 * v3.1 Phase 1: `ControlButtons` and `HealthIndicator` are now
 * wired in their grouped / chip variants. The icons split into
 * three labelled groups (Map · Display · System) with hairline
 * separators between them, and the health dot is replaced by a
 * status chip ("Services · OK / Dégradé / Critique / Hors ligne")
 * anchored to the right edge of the dock. Both component-side
 * styles include their own narrow-viewport collapse rules so the
 * 7" Pi (932 px) and phones get tighter layouts without changing
 * the dock wrapper itself.
 *
 * @returns {JSX.Element} bottom-dock slab
 */
const BottomDock = () => (
  <div className={styles.dock}>
    <ControlButtons />
    <HealthIndicator chip />
  </div>
);

export default BottomDock;
