import React, { useContext, useEffect, useState } from "react";
import { UiPrefsContext } from "~/AppContext";
import styles from "./styles.css";
import { getPalette } from "~/ui/tokens";
import { useTimeOfDay, useHybridMode } from "~/ui/hybrid";
import LayoutPi from "~/components/ambient/LayoutPi";
import LayoutDesktop from "~/components/ambient/LayoutDesktop";
import LayoutMobile from "~/components/ambient/LayoutMobile";
import { FONT_SIZE_ZOOM } from "~/ui/fontSize";

// Global stylesheets — fonts (@font-face declarations) and the
// scoped CSS reset. Imported via raw style-loader so they emit
// global rules rather than CSS-Module-hashed class names.
import "!style-loader!css-loader!~/ui/fonts.css";
import "!style-loader!css-loader!~/ui/reset.css";

// Breakpoints. Three layouts now coexist:
//   <  800 px  → LayoutMobile  (Variant A — Compagnon nomade)
//   800-1279   → LayoutPi      (7"/10" Pi kiosk + small windows)
//   ≥ 1280     → LayoutDesktop (full-bleed map + floating rail)
//
// 800 px matches the Pi 7" official screen width — anything below is
// in phone-portrait territory (375-430 px iPhone/Android). 1280 px
// matches the smallest HD desktop target (1366×768 minus chrome).
// Both cutoffs are live-watched via `matchMedia` `change` events so
// orientation changes and window resizes flip layouts without a
// reload.
const MOBILE_MQ = "(max-width: 799px)";
const DESKTOP_MQ = "(min-width: 1280px)";

// Font-size scaling — mirrors the v2 fontSize setting (S / M / L)
// so users who picked a custom zoom in Settings get the same
// behaviour under Direction C. Same scalar values v2 uses on its
// info-container; applied via the `zoom` property on the AmbientLayers
// root (zoom is non-standard but supported in all the kiosk browsers
// the project targets — Chromium, Firefox, Safari/WebKit). When
// fontSize is unset or unrecognised, the scalar falls back to 1.0.
// FONT_SIZE_ZOOM is imported at the top from `~/ui/fontSize` — shared
// with SettingsPanel + DebugPanel so the user's text-size preference
// reaches every UI surface, including the overlays that mount outside
// `.ambientRoot` and so can't read the `--c-font-scale` CSS variable.

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
  const { fontSize } = useContext(UiPrefsContext);
  // FONT_SIZE_ZOOM kept in the module for the future fix — the
  // attribute hook is below.
  const fontSizeKey = fontSize && FONT_SIZE_ZOOM[fontSize] ? fontSize : "m";

  // v2.16.3: mirror the active palette's background onto `<html>` and
  // `<body>` so iOS PWA standalone mode doesn't fill the layout's
  // safe-area gap with its default black. In standalone PWA on
  // notched iPhones, `100dvh` doesn't always equal the physical
  // screen height — iOS reserves the home-indicator zone (~34 px)
  // PLUS sometimes additional rendering padding (~50 px observed),
  // and fills any uncovered area with the body's background colour.
  // The body had no explicit bg before, so iOS defaulted to black —
  // user-reported "barre grise dans le bas" on PWA-installed iPhone.
  //
  // v2.16.5: nightRed bg (`#100404`) reads as essentially black on
  // a phone — even though it's technically a dark red, the gap zone
  // visually contrasts with the dock's brighter `surfaceHybrid` red
  // tone above it. Use a derived "effective surface" colour for
  // nightRed (computed from `surface` rgba composited over `bg`)
  // so the gap blends with the dock instead of looking like a black
  // stripe under it. Other palettes use `palette.bg` directly since
  // the contrast is subtle enough to be invisible.
  const bodyBg = tod === "nightRed" ? "#270c0c" : palette.bg;
  useEffect(() => {
    const prevBody = document.body.style.backgroundColor;
    const prevHtml = document.documentElement.style.backgroundColor;
    document.body.style.backgroundColor = bodyBg;
    document.documentElement.style.backgroundColor = bodyBg;
    return () => {
      document.body.style.backgroundColor = prevBody;
      document.documentElement.style.backgroundColor = prevHtml;
    };
  }, [bodyBg]);

  // Initialise from the current viewport — SSR not in play here, so
  // window is always defined at first render.
  const [isDesktop, setIsDesktop] = useState(
    () => window.matchMedia(DESKTOP_MQ).matches,
  );
  const [isMobile, setIsMobile] = useState(
    () => window.matchMedia(MOBILE_MQ).matches,
  );

  useEffect(() => {
    const desktopMq = window.matchMedia(DESKTOP_MQ);
    const mobileMq = window.matchMedia(MOBILE_MQ);
    const onDesktop = (e) => setIsDesktop(e.matches);
    const onMobile = (e) => setIsMobile(e.matches);
    desktopMq.addEventListener("change", onDesktop);
    mobileMq.addEventListener("change", onMobile);
    return () => {
      desktopMq.removeEventListener("change", onDesktop);
      mobileMq.removeEventListener("change", onMobile);
    };
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
    "--c-advisory": palette.advisory,
    "--c-cool": palette.cool,
    "--c-strip-color": stripColor,
    // v3.1 Phase 4 — severity-chip palette tokens. Three tiers
    // (advisory / watch / warning) each with bg/border/ink triplets
    // so the chip surface, outline, and label colour all rotate
    // through the palette in lockstep. Components read these via
    // `var(--sev-{adv|watch|warn}-{bg|border|ink})`.
    "--sev-adv-bg": palette.sevAdvBg,
    "--sev-adv-border": palette.sevAdvBorder,
    "--sev-adv-ink": palette.sevAdvInk,
    "--sev-watch-bg": palette.sevWatchBg,
    "--sev-watch-border": palette.sevWatchBorder,
    "--sev-watch-ink": palette.sevWatchInk,
    "--sev-warn-bg": palette.sevWarnBg,
    "--sev-warn-border": palette.sevWarnBorder,
    "--sev-warn-ink": palette.sevWarnInk,
    // Moon-glyph palette tokens (used by `MoonGlyph`). Names match
    // what each token paints, not relative brightness — day palette
    // has a DARK `moonLit` because the lit shape is rendered as a
    // dark silhouette on a light page.
    "--c-moon-lit": palette.moonLit,
    "--c-moon-dark": palette.moonDark,
    // v3.1 Phase 2 — category-qualifier tokens (`--mx-*` family from
    // the Claude Design P2 handoff; names kept verbatim for handoff
    // traceability). Tier mapping documented in `ui/tokens.js`:
    // good=low · mod=moderate · bad=high · vhigh=veryHigh(+extreme).
    // Consumed by the AirCard pills and the MetricsGrid qualifiers;
    // in nightRed all four resolve to the same red.
    "--mx-cat-good": palette.catGood,
    "--mx-cat-mod": palette.catMod,
    "--mx-cat-bad": palette.catBad,
    "--mx-cat-vhigh": palette.catVhigh,
    // Font-size scaling is exposed as `--c-font-scale` and consumed by
    // the scrollable subtrees (rail in both layouts, heroSlot in
    // LayoutDesktop). Applying `zoom` here on the root broke
    // positioning of absolute children (Phase 7 incident) because
    // 100dvh references inside the layout no longer matched the
    // zoomed root. Scoping the zoom to scrollable subtrees keeps the
    // map at native resolution while the user's text-density
    // preference still has visible effect on the slabs and metrics.
    "--c-font-scale": FONT_SIZE_ZOOM[fontSizeKey],
    // Tells the UA to render native form-control chrome (select
    // dropdown panel, scrollbars, focus rings) in light or dark
    // tone. Without this, Chromium falls back to the OS theme and
    // ignores our palette — most visibly on the sleep-stage delay
    // <select> in Settings, where night/nightRed produced an
    // unreadable dark-on-dark popup.
    colorScheme: tod === "day" ? "light" : "dark",
  };

  // Layout dispatch — mobile takes precedence over desktop because
  // `MOBILE_MQ` (≤ 799 px) and `DESKTOP_MQ` (≥ 1280 px) can't both
  // match at the same time, but reading mobile first keeps the
  // ternary unambiguous (and lets `isMobile` short-circuit the Pi
  // path for the 0-799 range).
  // eslint-disable-next-line no-nested-ternary -- the three-layout dispatch reads more cleanly inline than via a temporary
  const ActiveLayout = isMobile ? LayoutMobile : isDesktop ? LayoutDesktop : LayoutPi;
  const layoutAttr = isMobile ? "mobile" : isDesktop ? "desktop" : "pi";

  return (
    <div
      className={`ambientRoot ${styles.container}`}
      style={cssVars}
      data-palette={tod}
      data-hybrid={hybridLevelValue}
      data-layout={layoutAttr}
      data-font-size={fontSizeKey}
    >
      <ActiveLayout />
    </div>
  );
};

export default AmbientLayers;
