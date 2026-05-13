import React, { useEffect, useState } from "react";
import styles from "./styles.css";
import { getPalette } from "~/ui/tokens";
import { useTimeOfDay, useHybridMode } from "~/ui/hybrid";
import LayoutPi from "~/components/ambient/LayoutPi";
import LayoutDesktop from "~/components/ambient/LayoutDesktop";

// Global stylesheets — fonts (@font-face declarations) and the
// scoped CSS reset. Imported via raw style-loader so they emit
// global rules rather than CSS-Module-hashed class names.
import "!style-loader!css-loader!~/ui/fonts.css";
import "!style-loader!css-loader!~/ui/reset.css";

// Desktop breakpoint — viewports at or above 1280 CSS pixels wide
// get the desktop layout (full-bleed map + floating hero band + side
// rail). Below that, the Pi 7"/10" composition takes over (split
// grid + collapsible rail). The cutoff matches the Phase 3 / Phase 4
// plan and lines up with the smallest "HD desktop" target (1366×768
// — the Surface Go's native resolution, which is the floor for the
// desktop variant).
const DESKTOP_MQ = "(min-width: 1280px)";

/**
 * Direction C — Ambient Layers root.
 *
 * Three responsibilities:
 *
 *   1. Resolves the active palette via `useTimeOfDay()` and mirrors it
 *      onto CSS custom properties at the root so every descendant
 *      slab can pull tokens via `var(--c-bg)` etc.
 *   2. Tracks viewport width via `window.matchMedia(DESKTOP_MQ)` and
 *      dispatches to `LayoutPi` (small) or `LayoutDesktop` (HD+).
 *      Live updates on resize.
 *   3. Sets `data-palette` / `data-hybrid` / `data-layout` attributes
 *      for diagnostics.
 *
 * @returns {JSX.Element} the Direction C root surface
 */
const AmbientLayers = () => {
  const tod = useTimeOfDay();
  const palette = getPalette(tod);
  const { level: hybridLevelValue } = useHybridMode();

  // Initialise from the current viewport — SSR not in play here, so
  // window is always defined at first render.
  const [isDesktop, setIsDesktop] = useState(
    () => window.matchMedia(DESKTOP_MQ).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_MQ);
    const handler = (e) => setIsDesktop(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

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
      data-layout={isDesktop ? "desktop" : "pi"}
    >
      {isDesktop ? <LayoutDesktop /> : <LayoutPi />}
    </div>
  );
};

export default AmbientLayers;
