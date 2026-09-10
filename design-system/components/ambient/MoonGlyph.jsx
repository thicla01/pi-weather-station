import React from "react";

/**
 * Build the SVG `d` for the LIT area of the moon at a synodic phase
 * (0 new · 0.25 first quarter · 0.5 full · 0.75 last quarter). Northern-
 * hemisphere convention: waxing lit on the right, waning on the left.
 * Verbatim port of `moonLitPath()` in client/src/ui/astronomy.js.
 */
export function moonLitPath(fraction, cx, cy, r) {
  let f = Number.isFinite(fraction) ? fraction : 0;
  f = ((f % 1) + 1) % 1;
  const k = (1 - Math.cos(2 * Math.PI * f)) / 2;
  if (k < 0.005) return "";
  if (k > 0.995) {
    return `M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy} Z`;
  }
  const waxing = f < 0.5;
  const gibbous = k > 0.5;
  const txRaw = r * Math.abs(Math.cos(2 * Math.PI * f));
  const tx = txRaw < 1e-6 ? 0 : txRaw;
  const outerSweep = waxing ? 1 : 0;
  const innerSweep = gibbous ? outerSweep : 1 - outerSweep;
  return `M ${cx} ${cy - r} A ${r} ${r} 0 0 ${outerSweep} ${cx} ${cy + r} A ${tx} ${r} 0 0 ${innerSweep} ${cx} ${cy - r} Z`;
}

/**
 * Palette-aware moon-phase glyph: a dark disc (--c-moon-dark) with the lit
 * shape (--c-moon-lit) on top — the emoji convention, in every palette.
 * Replaces Unicode emoji, which rendered mirrored on the Pi's Noto font.
 * Port of client/src/components/ambient/MoonGlyph.
 */
export function MoonGlyph({ fraction, size = "1.2em", title }) {
  const d = moonLitPath(fraction, 10, 10, 9);
  return (
    <svg viewBox="0 0 20 20" style={{ width: size, height: size, display: "inline-block", verticalAlign: "middle", flexShrink: 0 }} role={title ? "img" : undefined} aria-label={title || undefined} aria-hidden={title ? undefined : true} focusable="false">
      <circle cx="10" cy="10" r="9" style={{ fill: "var(--c-moon-dark)" }} />
      {d ? <path d={d} style={{ fill: "var(--c-moon-lit)" }} /> : null}
    </svg>
  );
}
