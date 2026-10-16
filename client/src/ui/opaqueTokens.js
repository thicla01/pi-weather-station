// Opaque card edges — the colour a slab's translucent edge shows over the
// opaque `--c-bg`, as an opaque `#rrggbb`.
//
// Why: Blink paints a rounded box that has a painted background and a
// border side that is not "opaque and solid" (alpha below 1, or dashed /
// dotted) through an offscreen clip layer (a Skia saveLayer:
// BoxDecorationData::ComputeBleedAvoidance → kBackgroundBleedClipLayer), one
// per card. With an opaque, solid border it shrinks the background under the
// border instead (kBackgroundBleedShrinkBackground): no layer. Measured on
// the P9 kiosk (Pi 4, 2026-10-14 Skia traces): 10 saveLayer → 0 on the
// Conditions view once the edges were opaque.
//
// Only the EDGE turns opaque. The fill keeps its translucent token: an
// opaque background under text adds compositing layers on a Linux kiosk at
// DPR 1 (the LCD-text rule), and the edge alone decides Blink's paint mode.
// Over an opaque backdrop the translucent chain border → fill → bg resolves
// to one fixed colour, so the opaque edge looks the same (to one level per
// channel) wherever the card really sits on `--c-bg`. AmbientLayers mirrors
// the values onto `--c-opaque-edge` / `--c-opaque-edge-hybrid`; only an
// opaque container (LayoutPi's rail and dock cell) maps them to the
// `--c-card-edge*` variables the cards read, so a card anywhere else keeps
// its translucent `--c-border`.
//
// The result is rounded once, at the end, to an integer `#rrggbb`. Never
// emit a near-opaque form instead: `rgb(… / 0.999)` and `#rrggbbfe` stay
// translucent to Blink (the layer stays), while `rgba(…, 0.999)` only turns
// opaque through 8-bit rounding — a trap measured on the bench.
//
// Colour forms. `parseColor` reads only the forms `ui/tokens.js` uses
// today: `#rgb`, `#rrggbb`, and `rgb()` / `rgba()` whose three channels
// are NUMBERS from 0 to 255 (comma or space syntax; the alpha may be a
// number or a percentage). It refuses, among others, percentage channels
// (`rgb(50% 40% 30%)`), `hsl()` and the other colour functions,
// `color-mix()`, `var()`, named colours (`white`, `transparent`) and 4- or
// 8-digit hex. One of the five tokens `opaqueEdgeTokens` reads (`bg`,
// `surface`, `surfaceHybrid`, `border`, `borderHybrid`) in such a form
// does not break the kiosk: `opaqueEdgeTokens` throws, `opaqueEdgeVars`
// catches it, logs a warning that quotes the offending value (not the
// token's name) and returns no edges, AmbientLayers leaves
// `--c-opaque-edge*` unset, the containers' `--c-card-edge*` variables
// (`--c-card-edge: var(--c-opaque-edge)` and `--c-card-edge-hybrid:
// var(--c-opaque-edge-hybrid)`) then have no value, and every card takes
// the fallback of its `var(--c-card-edge, var(--c-border))` or
// `var(--c-card-edge-hybrid, var(--c-border))`: the translucent edge it
// had before the opaque edges, clip layer included. So nothing looks
// wrong; the layers just come back. Any other palette token (an accent in
// `hsl()`, say) never reaches `parseColor`: no warning, no effect on the
// edges. Before writing one of the five in a new form, extend
// `parseColor` (`test/opaqueTokens.test.js` pins this fallback for a
// percentage channel, and pins that the other tokens are not read).
//
// CommonJS on purpose (like ui/alertTitle.js and ui/radarFrameStack.js):
// webpack accepts it next to the ESM tree (AmbientLayers imports it with an
// ESM named import), and `test/opaqueTokens.test.js` runs the real module
// under `node --test`.

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
// rgb()/rgba(), comma or space syntax, optional alpha (number or %).
const RGB_RE = /^rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/i;

/**
 * Parse one token colour. Accepts the forms `ui/tokens.js` uses: `#rgb`,
 * `#rrggbb`, `rgb()` and `rgba()` with number channels (comma or space
 * syntax, alpha as a number or a percentage). Percentage channels,
 * `hsl()`, `color-mix()`, named colours and every other form throw (see
 * the module header for what that does to the edges).
 *
 * @param {string} str colour string
 * @returns {{r: number, g: number, b: number, a: number}} channels 0-255,
 *   alpha 0-1
 * @throws {Error} when the string is not one of those forms
 */
function parseColor(str) {
  const s = String(str).trim();
  const hex = s.match(HEX_RE);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, "$&$&") : hex[1];
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: 1,
    };
  }
  const rgb = s.match(RGB_RE);
  if (rgb) {
    const [, r, g, b, alpha] = rgb;
    let a = 1;
    if (alpha !== undefined) {
      a = alpha.endsWith("%") ? parseFloat(alpha) / 100 : parseFloat(alpha);
    }
    const color = { r: Number(r), g: Number(g), b: Number(b), a };
    const inRange = [color.r, color.g, color.b].every((v) => v >= 0 && v <= 255) && a >= 0 && a <= 1;
    if (inRange) return color;
  }
  throw new Error(`opaqueTokens: unsupported colour "${str}"`);
}

/**
 * Source-over of `fg` on an OPAQUE `bg`, in sRGB with straight alpha:
 * `c = fg·a + bg·(1 − a)`. The channels stay unrounded so composites chain
 * without drift; `toHex` rounds once at the end.
 *
 * @param {{r: number, g: number, b: number, a: number}} fg foreground, any
 *   alpha
 * @param {{r: number, g: number, b: number, a: number}} bg backdrop; its
 *   alpha must be 1
 * @returns {{r: number, g: number, b: number, a: number}} the opaque
 *   composite (`a` = 1)
 * @throws {Error} when `bg` is not opaque
 */
function compositeOver(fg, bg) {
  if (bg.a !== 1) {
    throw new Error("opaqueTokens: the backdrop of a composite must be opaque");
  }
  const mix = (f, b) => f * fg.a + b * (1 - fg.a);
  return { r: mix(fg.r, bg.r), g: mix(fg.g, bg.g), b: mix(fg.b, bg.b), a: 1 };
}

/**
 * Format an opaque colour as `#rrggbb`, each channel rounded to the
 * nearest integer level.
 *
 * @param {{r: number, g: number, b: number, a?: number}} color channels
 *   0-255, may be fractional; `a`, when given, must be 1
 * @returns {string} the `#rrggbb` string
 * @throws {Error} when the colour is translucent (`#rrggbb` would silently
 *   make it opaque)
 */
function toHex(color) {
  if (color.a != null && color.a < 1) {
    throw new Error("opaqueTokens: toHex needs an opaque colour (composite it first)");
  }
  return `#${[color.r, color.g, color.b]
    .map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * The three opaque edge colours of one palette: each is a border token
 * composited over the fill it is drawn on, over the palette's opaque `bg`.
 *
 * @param {object} palette a `ui/tokens.js` palette (reads `bg`, `surface`,
 *   `surfaceHybrid`, `border`, `borderHybrid`)
 * @returns {{edge: string, edgeHybridFill: string, edgeHybridState: string}}
 *   `#rrggbb` values: `edge` — calm `border` on calm `surface` (the edge of
 *   a card filled with `--c-surface`, calm); `edgeHybridFill` — calm
 *   `border` on `surfaceHybrid` (the edge of a box filled with
 *   `--c-surface-hybrid`, calm); `edgeHybridState` — `borderHybrid` on
 *   `surfaceHybrid` (the edge of either box in hybrid mode, where
 *   AmbientLayers raises `--c-surface` / `--c-border` to their hybrid
 *   values)
 */
function opaqueEdgeTokens(palette) {
  const bg = parseColor(palette.bg);
  const surface = compositeOver(parseColor(palette.surface), bg);
  const surfaceHybrid = compositeOver(parseColor(palette.surfaceHybrid), bg);
  const border = parseColor(palette.border);
  const borderHybrid = parseColor(palette.borderHybrid);
  return {
    edge: toHex(compositeOver(border, surface)),
    edgeHybridFill: toHex(compositeOver(border, surfaceHybrid)),
    edgeHybridState: toHex(compositeOver(borderHybrid, surfaceHybrid)),
  };
}

/**
 * The values AmbientLayers mirrors onto the root for the current alert
 * state, switched by the same hybrid flag that raises `--c-surface` and
 * `--c-border`.
 *
 * @param {object} palette a `ui/tokens.js` palette
 * @param {boolean} hybrid true in hybrid mode (hybrid level `light` or
 *   `full`)
 * @returns {{opaqueEdge: (string|undefined), opaqueEdgeHybrid: (string|undefined)}}
 *   `#rrggbb` values: `opaqueEdge` → `--c-opaque-edge` (the current
 *   `--c-border` on the current `--c-surface`) and `opaqueEdgeHybrid` →
 *   `--c-opaque-edge-hybrid` (the current `--c-border` on
 *   `--c-surface-hybrid`). Both `undefined` when one of the five tokens
 *   `opaqueEdgeTokens` reads cannot be parsed (a warning quotes the
 *   value): AmbientLayers then leaves the variables unset, every card falls
 *   back to its translucent `--c-border`, and the kiosk keeps rendering
 *   instead of throwing in the root's render.
 */
function opaqueEdgeVars(palette, hybrid) {
  let tokens;
  try {
    tokens = opaqueEdgeTokens(palette);
  } catch (err) {
    if (typeof console !== "undefined") console.warn(err.message);
    return { opaqueEdge: undefined, opaqueEdgeHybrid: undefined };
  }
  const { edge, edgeHybridFill, edgeHybridState } = tokens;
  return hybrid
    ? { opaqueEdge: edgeHybridState, opaqueEdgeHybrid: edgeHybridState }
    : { opaqueEdge: edge, opaqueEdgeHybrid: edgeHybridFill };
}

module.exports = {
  parseColor,
  compositeOver,
  toHex,
  opaqueEdgeTokens,
  opaqueEdgeVars,
};
