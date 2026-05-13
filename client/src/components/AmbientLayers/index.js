import React, { useContext, useEffect, useState } from "react";
import { AppContext } from "~/AppContext";
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

// Font-size scaling — mirrors the v2 fontSize setting (S / M / L)
// so users who picked a custom zoom in Settings get the same
// behaviour under Direction C. Same scalar values v2 uses on its
// info-container; applied via the `zoom` property on the AmbientLayers
// root (zoom is non-standard but supported in all the kiosk browsers
// the project targets — Chromium, Firefox, Safari/WebKit). When
// fontSize is unset or unrecognised, the scalar falls back to 1.0.
const FONT_SIZE_ZOOM = { s: 0.85, m: 1.0, l: 1.15 };

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
  const { fontSize } = useContext(AppContext);
  const fontSizeZoom = FONT_SIZE_ZOOM[fontSize] || 1.0;

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

  // Hybrid mode escalates the visual treatment when a severe gov alert
  // is active. Three knobs surfaced through CSS custom properties so
  // every slab in the tree picks up the change without any per-component
  // logic:
  //
  //   --c-surface         bumped from 0.85 → 0.96 alpha so the slabs
  //                       read as more solid (less radar showing through)
  //   --c-border          stronger edge to match the bumped surface
  //   --c-strip-color     drives an inset box-shadow strip on slabs that
  //                       opt in via `box-shadow: inset 4px 0 0 var(--c-strip-color)`
  //
  // `light` level (moderate alert) uses warn (amber); `full` level
  // (severe / extreme alert) uses danger (red). `none` keeps everything
  // calm — strip resolves to transparent so the slabs render unchanged.
  const isHybridFull = hybridLevelValue === "full";
  const isHybridLight = hybridLevelValue === "light";
  const surfaceVar = isHybridFull || isHybridLight
    ? palette.surfaceHybrid
    : palette.surface;
  const borderVar = isHybridFull || isHybridLight
    ? palette.borderHybrid
    : palette.border;
  const stripColor = isHybridFull
    ? palette.danger
    : isHybridLight
      ? palette.warn
      : "transparent";

  const cssVars = {
    "--c-bg": palette.bg,
    "--c-text": palette.text,
    "--c-text-dim": palette.textDim,
    "--c-accent": palette.accent,
    "--c-accent-soft": palette.accentSoft,
    "--c-surface": surfaceVar,
    "--c-surface-hybrid": palette.surfaceHybrid,
    "--c-border": borderVar,
    "--c-border-hybrid": palette.borderHybrid,
    "--c-warn": palette.warn,
    "--c-danger": palette.danger,
    "--c-cool": palette.cool,
    "--c-strip-color": stripColor,
    // Note: a previous Phase 7 iteration applied `zoom` here to scale
    // the entire tree by `fontSizeZoom`. That broke positioning of
    // absolute-positioned children (mapArea, BottomDock) because the
    // 100dvh references inside the layout no longer matched the zoomed
    // root. v2 applies `zoom` only to its info-container (the right
    // column), not the whole page — that's the pattern Direction C
    // needs to adopt. Deferred to a follow-up: scale slabs / rails via
    // a different mechanism (per-rail zoom or CSS font-size cascade)
    // so the map stays at native resolution.
    // The fontSizeZoom is still computed above for future use; for now
    // we expose it via the `data-font-size` attribute only.
  };

  return (
    <div
      className={`ambientRoot ${styles.container}`}
      style={cssVars}
      data-palette={tod}
      data-hybrid={hybridLevelValue}
      data-layout={isDesktop ? "desktop" : "pi"}
      data-font-size={fontSize || "m"}
    >
      {isDesktop ? <LayoutDesktop /> : <LayoutPi />}
    </div>
  );
};

export default AmbientLayers;
