import React from "react";
import styles from "./styles.css";
import { getPalette } from "~/ui/tokens";
import { useTimeOfDay, useHybridMode } from "~/ui/hybrid";
import LayoutPi from "~/components/ambient/LayoutPi";

// Global stylesheets — fonts (@font-face declarations) and the
// scoped CSS reset. Imported via raw style-loader so they emit
// global rules rather than CSS-Module-hashed class names.
import "!style-loader!css-loader!~/ui/fonts.css";
import "!style-loader!css-loader!~/ui/reset.css";

/**
 * Direction C — Ambient Layers root.
 *
 * Phase 3a milestone: the construction-state placeholder card is
 * retired and the real composition takes over. This component now
 * does three things:
 *
 *   1. Resolves the active palette via `useTimeOfDay()` and mirrors
 *      it onto CSS custom properties at the root so every descendant
 *      slab can pull tokens via `var(--c-bg)` etc.
 *   2. Sets `data-palette` and `data-hybrid` attributes for diagnostics
 *      (visible in dev tools, and useful when Phase 5 sleep-mode
 *      transitions need to read the current state).
 *   3. Renders the appropriate layout. Today there's only `LayoutPi`
 *      — Phase 4 adds `LayoutDesktop` and the breakpoint dispatch.
 *
 * The `.ambientRoot` class enables the scoped CSS reset from
 * `~/ui/reset.css`.
 *
 * @returns {JSX.Element} the Direction C root surface
 */
const AmbientLayers = () => {
  const tod = useTimeOfDay();
  const palette = getPalette(tod);
  const { level: hybridLevelValue } = useHybridMode();

  const cssVars = {
    "--c-bg": palette.bg,
    "--c-text": palette.text,
    "--c-text-dim": palette.textDim,
    "--c-accent": palette.accent,
    "--c-accent-soft": palette.accentSoft,
    "--c-surface": palette.surface,
    "--c-surface-hybrid": palette.surfaceHybrid,
    "--c-border": palette.border,
    "--c-border-hybrid": palette.borderHybrid,
    "--c-warn": palette.warn,
    "--c-danger": palette.danger,
    "--c-cool": palette.cool,
  };

  return (
    <div
      className={`ambientRoot ${styles.container}`}
      style={cssVars}
      data-palette={tod}
      data-hybrid={hybridLevelValue}
    >
      <LayoutPi />
    </div>
  );
};

export default AmbientLayers;
