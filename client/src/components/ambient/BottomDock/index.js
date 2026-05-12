import React from "react";
import ControlButtons from "~/components/ControlButtons";
import styles from "./styles.css";

/**
 * Direction C bottom dock — anchors the row of control icons (reset
 * map / marker / timeline / dark mode / settings / debug / update)
 * along the bottom edge of the Pi layout.
 *
 * Today this is a thin slab around the existing v2 `ControlButtons`
 * component, restyled to match the warm-grey palette. The Phase 3
 * plan calls for permanent text labels under each icon (44×44 min
 * touch target, active state with accent underline) — that lands as
 * part of Phase 8 (Settings refresh) when the icon set itself gets
 * reviewed, because labelling them in isolation risks introducing
 * naming inconsistencies with the redesigned Settings panel. For
 * Phase 3 the wrapper exists so the layout slot is reserved and we
 * stop relying on the Phase 0/1 floating-dock hack.
 *
 * @returns {JSX.Element} bottom-dock slab
 */
const BottomDock = () => (
  <div className={styles.dock}>
    <ControlButtons />
  </div>
);

export default BottomDock;
