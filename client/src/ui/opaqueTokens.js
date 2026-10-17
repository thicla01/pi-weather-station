// Opaque edges — the colour a rounded box's translucent edge shows over an
// opaque backdrop, as an opaque `#rrggbb`: the card edges, over the cards'
// fill on `--c-bg`, and the own-fill edges, over a box's own opaque fill
// (see "Own-fill edges" below).
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
// `hsl()`, say) never reaches `parseColor` through the card edges: no
// warning, no effect on them. The own-fill edges below read one more
// token, `accent`, for the health chip only: an `accent` in `hsl()` drops
// `--c-edge-on-health-chip` alone, with a warning. Before writing one of
// these tokens in a new form, extend `parseColor`
// (`test/opaqueTokens.test.js` pins this fallback for a percentage
// channel, and pins which tokens each function reads).
//
// Own-fill edges. A few rounded boxes paint their OWN opaque fill under a
// translucent border: the LayoutPi map frame and the popovers (health,
// DetailsPopover) on `--c-bg`, the dock's health chip on a `color-mix()`
// of `--c-bg` and `--c-accent`. Their edge composites over that fill
// alone, whatever lies beneath the box, so each fill gets its own opaque
// token, read directly by the box (no container): `--c-edge-on-bg`,
// `--c-edge-on-health-chip` (set by AmbientLayers from
// `ownFillEdgeVars`). The chip's mix ratios live in CSS, not in
// `ui/tokens.js`, so they are mirrored here (`HEALTH_CHIP_ACCENT_MIX`) and
// pinned against the stylesheet by the test. Each own-fill token fails
// alone: a token it needs that `parseColor` refuses, or a palette name
// with no mirror, leaves that variable unset and its boxes on the old
// translucent edge (a warning quotes the value); the other variable still
// resolves. (The radar legend's "i" discs, on their own opaque
// `--rc-surface-2`, keep their translucent edge on purpose: an opaque one
// costs a composited layer on a DPR-1 Linux kiosk. See WeatherMap's
// stylesheet and ROADMAP.md.)
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

// ---- Own-fill edges ---------------------------------------------------------

/**
 * Accent share of the health chip's fill, per palette: the `t` of
 * `color-mix(in oklab, var(--c-bg) (1 − t), var(--c-accent) t)` in
 * `HealthIndicator/styles.css` (8 % in the base `.chipButton.chipButton`
 * rule, i.e. day; 18 % in its `[data-palette="dusk" | "night" |
 * "nightRed"]` rule). A mirror of the stylesheet, pinned by the test.
 */
const HEALTH_CHIP_ACCENT_MIX = Object.freeze({ day: 0.08, dusk: 0.18, night: 0.18, nightRed: 0.18 });

// sRGB ↔ OKLab with Björn Ottosson's published sRGB matrices (CSS Color 4
// defines `in oklab` through XYZ with matrices equal to about 1e-4, far
// below one 8-bit level), straight alpha, channels 0-255.
const toLinear = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (c) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function rgbToOklab({ r, g, b }) {
  const [R, G, B] = [r, g, b].map(toLinear);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToRgb([L, A, B]) {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const clip = (v) => Math.min(255, Math.max(0, fromLinear(v)));
  return {
    r: clip(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: clip(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: clip(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    a: 1,
  };
}

/**
 * CSS `color-mix(in oklab, a (1 − t), b t)` of two OPAQUE colours:
 * linear interpolation in OKLab, back to sRGB, clipped to the sRGB gamut.
 * Channels stay unrounded (a fill for `compositeOver`). Checked against
 * Chrome 155's display list for the health chip's fills (day #f0e4d8,
 * dusk #3c2f22, night red #2b0c0c).
 *
 * @param {{r: number, g: number, b: number, a: number}} a first colour
 *   (weight 1 − t); its alpha must be 1
 * @param {{r: number, g: number, b: number, a: number}} b second colour
 *   (weight t); its alpha must be 1
 * @param {number} t weight of `b`, 0-1
 * @returns {{r: number, g: number, b: number, a: number}} the opaque mix
 * @throws {Error} when either colour is translucent (CSS would premultiply)
 */
function mixOklab(a, b, t) {
  if (a.a !== 1 || b.a !== 1) {
    throw new Error("opaqueTokens: mixOklab mixes opaque colours only");
  }
  const A = rgbToOklab(a);
  const B = rgbToOklab(b);
  return oklabToRgb(A.map((v, i) => v * (1 - t) + B[i] * t));
}

/**
 * One border token composited over an opaque fill, as `#rrggbb`.
 *
 * @param {string} edge the border token (any alpha)
 * @param {{r: number, g: number, b: number, a: number}} fill the box's own
 *   fill; its alpha must be 1
 * @returns {string} the opaque `#rrggbb` edge
 * @throws {Error} when `edge` is not a `parseColor` form, or `fill` is
 *   translucent
 */
function opaqueEdgeOver(edge, fill) {
  return toHex(compositeOver(parseColor(edge), fill));
}

function mirrored(table, what, name) {
  if (!Object.prototype.hasOwnProperty.call(table, name)) {
    throw new Error(`opaqueTokens: no ${what} mirror for palette "${name}"`);
  }
  return table[name];
}

// The health chip's fill: `--c-bg` mixed with `--c-accent` in OKLab.
function healthChipFill(palette, name) {
  const t = mirrored(HEALTH_CHIP_ACCENT_MIX, "health-chip mix", name);
  return mixOklab(parseColor(palette.bg), parseColor(palette.accent), t);
}

/**
 * The three own-fill edge colours of one palette.
 *
 * @param {object} palette a `ui/tokens.js` palette (reads `bg`, `border`,
 *   `borderHybrid`, `accent`)
 * @param {string} name its key in `ui/tokens.js` (`day`, `dusk`, `night`,
 *   `nightRed`): selects the mirrored chip mix
 * @returns {{onBg: string, onBgHybrid: string, onHealthChip: string}}
 *   `#rrggbb` values: `onBg` / `onBgHybrid` — calm `border` /
 *   `borderHybrid` on `bg` (map frame, popovers); `onHealthChip` —
 *   `borderHybrid` on the chip's mix (the chip reads `--c-border-hybrid`
 *   in every state, so one value)
 * @throws {Error} when one of the four tokens is not a `parseColor` form,
 *   or `name` has no mirror
 */
function ownFillEdgeTokens(palette, name) {
  const bg = parseColor(palette.bg);
  const chip = healthChipFill(palette, name);
  return {
    onBg: opaqueEdgeOver(palette.border, bg),
    onBgHybrid: opaqueEdgeOver(palette.borderHybrid, bg),
    onHealthChip: opaqueEdgeOver(palette.borderHybrid, chip),
  };
}

// One own-fill token, fail-soft: `undefined` and a warning quoting the
// offending value instead of a throw in the root's render.
function softEdge(compute) {
  try {
    return compute();
  } catch (err) {
    if (typeof console !== "undefined") console.warn(err.message);
    return undefined;
  }
}

/**
 * The own-fill edges AmbientLayers mirrors onto the root for the current
 * palette and alert state, switched by the same hybrid flag that raises
 * `--c-border` (the chip's edge reads `--c-border-hybrid`, so it does not
 * switch).
 *
 * @param {object} palette a `ui/tokens.js` palette
 * @param {string} name its key in `ui/tokens.js` (AmbientLayers'
 *   `useTimeOfDay()` value, the root's `data-palette`)
 * @param {boolean} hybrid true in hybrid mode (hybrid level `light` or
 *   `full`)
 * @returns {{edgeOnBg: (string|undefined), edgeOnHealthChip: (string|undefined)}}
 *   `#rrggbb` values for `--c-edge-on-bg` (the current `--c-border` on
 *   `--c-bg`) and `--c-edge-on-health-chip` (`--c-border-hybrid` on the
 *   chip's fill). Each is computed alone and is `undefined` when a token it
 *   needs cannot be parsed or `name` has no mirror (a warning quotes the
 *   value): AmbientLayers then leaves that variable unset and its boxes
 *   keep their translucent fallback. Never throws.
 */
function ownFillEdgeVars(palette, name, hybrid) {
  const border = hybrid ? palette.borderHybrid : palette.border;
  return {
    edgeOnBg: softEdge(() => opaqueEdgeOver(border, parseColor(palette.bg))),
    edgeOnHealthChip: softEdge(() => opaqueEdgeOver(palette.borderHybrid, healthChipFill(palette, name))),
  };
}

module.exports = {
  parseColor,
  compositeOver,
  toHex,
  opaqueEdgeTokens,
  opaqueEdgeVars,
  HEALTH_CHIP_ACCENT_MIX,
  mixOklab,
  opaqueEdgeOver,
  ownFillEdgeTokens,
  ownFillEdgeVars,
};
