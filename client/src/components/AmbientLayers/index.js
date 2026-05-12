import React from "react";
import styles from "./styles.css";
import ControlButtons from "~/components/ControlButtons";

/**
 * Placeholder for Direction C — Ambient Layers.
 *
 * Phase 0 of the UI Direction C rollout (see
 * `docs/ui-direction-c-implementation-plan.md`). This component is rendered
 * in place of the v2 layout when `advanced.experimental.uiC === true`.
 *
 * Today, it just confirms the feature flag wiring works end-to-end — once
 * Phase 1 (Foundations) lands, this file becomes the real entry point for
 * the Ambient Layers composition.
 *
 * @returns {JSX.Element} construction-state placeholder
 */
const AmbientLayers = () => (
  <div className={styles.container}>
    <div className={styles.card}>
      <div className={styles.title}>Direction C · Ambient Layers</div>
      <div className={styles.subtitle}>UI preview · under construction</div>
      <div className={styles.body}>
        Phase 0 of the UI refresh is in place — feature flag wired,
        wrapper conditional active, placeholder rendered. Subsequent phases
        will replace this surface with the actual Ambient Layers
        composition.
      </div>
      <div className={styles.footer}>
        To return to the v2 layout, toggle
        <code className={styles.code}>Direction C UI preview</code>
        off in Settings → Advanced (visible only when DEBUG=true).
      </div>
    </div>
    {/* Phase 0 escape hatch — ControlButtons normally lives inside the
        v2 InfoPanel, which is unmounted while the experimental flag is
        on. Render it here so the user can still reach Settings (and the
        toggle to switch back) until Phase 8 introduces the redesigned
        BottomDock. */}
    <div className={styles.controlsDock}>
      <ControlButtons />
    </div>
  </div>
);

export default AmbientLayers;
