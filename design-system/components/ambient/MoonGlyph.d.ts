import * as React from "react";
/** Inline-SVG moon phase on --c-moon-dark / --c-moon-lit (NH orientation). */
export interface MoonGlyphProps {
  /** Synodic phase 0..1 — 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter. */
  fraction: number;
  /** CSS size, default "1.2em" (matches the former emoji footprint). */
  size?: string;
  /** Accessible label; when omitted the SVG is aria-hidden (put the title on the chip). */
  title?: string;
}
export function MoonGlyph(props: MoonGlyphProps): JSX.Element;
/** SVG path of the lit area for a phase; "" at new moon. */
export function moonLitPath(fraction: number, cx: number, cy: number, r: number): string;
