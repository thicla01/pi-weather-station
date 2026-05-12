import React from "react";
import styles from "./styles.css";
import ControlButtons from "~/components/ControlButtons";
import { getPalette } from "~/ui/tokens";
import { useTimeOfDay, useHybridMode } from "~/ui/hybrid";
import SourceBadge from "~/components/ambient/SourceBadge";
import ConfidencePill from "~/components/ambient/ConfidencePill";
import QrCode from "~/components/ambient/QrCode";
import AmbientAlertBanner from "~/components/ambient/AlertBanner";
import AlertDetailInline from "~/components/ambient/AlertDetailInline";
import IndoorBlock from "~/components/ambient/IndoorBlock";

// Global stylesheets — fonts (@font-face declarations) and the
// scoped CSS reset. Imported via raw style-loader so they emit
// global rules rather than CSS-Module-hashed class names.
import "!style-loader!css-loader!~/ui/fonts.css";
import "!style-loader!css-loader!~/ui/reset.css";

/**
 * Placeholder for Direction C — Ambient Layers.
 *
 * Phase 1 of the UI Direction C rollout (see
 * `docs/ui-direction-c-implementation-plan.md`). The placeholder
 * doubles as a smoke test for the foundation layer: it consumes the
 * design tokens via `useTimeOfDay()`, mirrors the active palette onto
 * CSS custom properties at the root, loads Geist fonts, and runs under
 * the scoped `.ambientRoot` CSS reset.
 *
 * Once Phase 2 (Shared components) lands, this file becomes the entry
 * point that composes the actual Ambient Layers surface.
 *
 * @returns {JSX.Element} construction-state placeholder
 */
const AmbientLayers = () => {
  const tod = useTimeOfDay();
  const palette = getPalette(tod);
  const { level: hybridLevelValue } = useHybridMode();

  // Mirror the active palette onto CSS custom properties so the
  // .css module can read tokens via `var(--c-bg)` etc. — keeping a
  // single source of truth in `tokens.js` while still letting CSS
  // drive the layout. The naming convention is `--c-<role>` (c for
  // "colour"); future non-colour tokens (spacing, radii) would land
  // under `--s-*` and `--r-*`.
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
      <div className={styles.card}>
        <div className={styles.title}>Direction C · Ambient Layers</div>
        <div className={styles.subtitle}>UI preview · foundations wired</div>
        <div className={styles.body}>
          Phase 1 is in place — design tokens, hybrid + time-of-day
          hooks, Geist fonts, and the scoped CSS reset are now loaded.
          The card below renders against the
          <code className={styles.code}>{tod}</code>
          palette; hybrid level is
          <code className={styles.code}>{hybridLevelValue}</code>.
          Subsequent phases will replace this surface with the actual
          Ambient Layers composition.
        </div>
        <div className={styles.swatchRow}>
          <span className={styles.swatch} style={{ background: palette.accent }} title="accent" />
          <span className={styles.swatch} style={{ background: palette.warn }} title="warn" />
          <span className={styles.swatch} style={{ background: palette.danger }} title="danger" />
          <span className={styles.swatch} style={{ background: palette.cool }} title="cool" />
          <span className={`${styles.swatch} ${styles.swatchOutline}`} style={{ background: palette.surface }} title="surface" />
        </div>
        {/* Phase 2a smoke test — verify the three atomic components
            (SourceBadge, ConfidencePill, QrCode) render correctly
            against the active palette. Replaced wholesale in Phase 3
            when these get composed into the real Hero / AlertBanner. */}
        <div className={styles.smokeRow}>
          <SourceBadge source="RADAR" />
          <SourceBadge source="ECCC" />
          <SourceBadge source="NWS" />
          <ConfidencePill confidence={85} />
          <ConfidencePill confidence={55} />
          <ConfidencePill confidence={25} />
        </div>
        <div className={styles.smokeRow}>
          <QrCode value="https://github.com/thicla01/pi-weather-station" title="Project repo" />
        </div>
        {/* Phase 2b smoke test — the three composite slabs render in
            their proper place against the warm-grey surface. Show-gate
            logic still applies: AlertBanner / AlertDetailInline only
            appear when a real alert is active, IndoorBlock only when
            Homebridge is configured. */}
        <div className={styles.compositeStack}>
          <AmbientAlertBanner />
          <AlertDetailInline />
          <IndoorBlock />
        </div>
        <div className={styles.footer}>
          To return to the v2 layout, toggle
          <code className={styles.code}>Direction C UI preview</code>
          off in Settings → Advanced (visible only when DEBUG=true).
        </div>
      </div>
      {/* Phase 0/1 escape hatch — ControlButtons normally lives inside
          the v2 InfoPanel, which is unmounted while the experimental
          flag is on. Render it here so the user can still reach
          Settings (and the toggle to switch back) until Phase 8
          introduces the redesigned BottomDock. */}
      <div className={styles.controlsDock}>
        <ControlButtons />
      </div>
    </div>
  );
};

export default AmbientLayers;
