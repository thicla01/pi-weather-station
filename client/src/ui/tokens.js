/**
 * Design tokens for UI Direction C — Ambient Layers.
 *
 * Four palettes (day / dusk / night / nightRed) selected at runtime by
 * `useTimeOfDay()` (see `hybrid.js`). Each palette exposes the same set of
 * semantic roles so components can be written palette-agnostic — they just
 * pull `tokens[role]` against whichever palette the AmbientLayers root has
 * activated.
 *
 * Anchor values for the `dusk` palette come from the Phase 0 placeholder
 * card and the references in `docs/settings-debug-design-request.md`
 * (`bg: #1c1a17`, `surface: rgba(38,34,30,0.85)`, `accent: #e8a050`).
 * The other three palettes were derived from those anchors for internal
 * coherence; expect a final pass against a Claude Design mockup once
 * Phase 3's Hero composition lands and we have something to look at.
 *
 * Semantic roles
 * --------------
 *   bg           — page background, always opaque
 *   text         — primary text colour
 *   textDim      — secondary / metadata text
 *   accent       — brand accent (warm amber across palettes)
 *   accentSoft   — accent at low opacity, for tints and outlines
 *   surface      — translucent slab fill (calm mode)
 *   surfaceHybrid — slab fill bumped opaque for severe-alert "hybrid" mode
 *   border       — calm slab edge
 *   borderHybrid — stronger slab edge for hybrid mode
 *   warn         — moderate severity (amber)
 *   danger       — severe / urgent (red)
 *   cool         — informational / calm (blue-grey)
 *
 * Why these are JS not CSS variables: components need to read tokens from
 * JS for inline style overrides (animations driven by easing libs, dynamic
 * shadow stacks, etc.) and we don't want two sources of truth.
 * `AmbientLayers` mirrors the active palette onto CSS custom properties at
 * the root so CSS Modules can also read them via `var(--c-bg)` etc.
 */

// Severity sub-palettes — used by the v3.1 Phase 4 alert chips.
// Three tiers (advisory / watch / warning) each carry a bg / border /
// ink triplet so a chip can be painted with consistent visual weight
// across palettes. Values mirror the synthesis design's `--sev-*`
// tokens. The `_emergency` slug doesn't exist as a distinct tier —
// `extreme`-severity alerts collapse to `warning` visually (the
// wall-of-red palette + the `EMERGENCY` label inside the chip carry
// the extra urgency).
const day = {
  bg: "#f4f0e8",
  text: "#2a2620",
  textDim: "#6d655a",
  accent: "#b85a18",
  accentSoft: "rgba(184, 90, 24, 0.18)",
  surface: "rgba(255, 250, 240, 0.85)",
  surfaceHybrid: "rgba(255, 250, 240, 0.96)",
  border: "rgba(42, 38, 32, 0.10)",
  borderHybrid: "rgba(42, 38, 32, 0.18)",
  warn: "#c47a18",
  danger: "#b03028",
  cool: "#3a5a78",
  sevAdvBg: "rgba(232, 200, 122, 0.18)",
  sevAdvBorder: "rgba(232, 200, 122, 0.5)",
  sevAdvInk: "#8a6a18",
  sevWatchBg: "rgba(232, 150, 87, 0.20)",
  sevWatchBorder: "rgba(232, 150, 87, 0.55)",
  sevWatchInk: "#b85a2d",
  sevWarnBg: "rgba(220, 80, 80, 0.18)",
  sevWarnBorder: "rgba(220, 80, 80, 0.55)",
  sevWarnInk: "#b03030",
};

const dusk = {
  bg: "#1c1a17",
  text: "#d8d4cc",
  textDim: "#8a8680",
  accent: "#e8a050",
  accentSoft: "rgba(232, 160, 80, 0.18)",
  surface: "rgba(38, 34, 30, 0.85)",
  surfaceHybrid: "rgba(38, 34, 30, 0.96)",
  border: "rgba(216, 212, 204, 0.10)",
  borderHybrid: "rgba(216, 212, 204, 0.20)",
  warn: "#e8a050",
  danger: "#d8503c",
  cool: "#7a98b8",
  sevAdvBg: "rgba(232, 200, 122, 0.12)",
  sevAdvBorder: "rgba(232, 200, 122, 0.40)",
  sevAdvInk: "#e8c87a",
  sevWatchBg: "rgba(232, 150, 87, 0.15)",
  sevWatchBorder: "rgba(232, 150, 87, 0.48)",
  sevWatchInk: "#f0b27a",
  sevWarnBg: "rgba(220, 80, 80, 0.16)",
  sevWarnBorder: "rgba(220, 80, 80, 0.48)",
  sevWarnInk: "#ee9090",
};

const night = {
  bg: "#0e0c0a",
  text: "#c4c0b8",
  textDim: "#6a6660",
  accent: "#c47030",
  accentSoft: "rgba(196, 112, 48, 0.16)",
  surface: "rgba(28, 26, 22, 0.85)",
  surfaceHybrid: "rgba(28, 26, 22, 0.96)",
  border: "rgba(196, 192, 184, 0.08)",
  borderHybrid: "rgba(196, 192, 184, 0.16)",
  warn: "#c47030",
  danger: "#b04030",
  cool: "#5a7898",
  sevAdvBg: "rgba(232, 200, 122, 0.10)",
  sevAdvBorder: "rgba(232, 200, 122, 0.35)",
  sevAdvInk: "#e8c87a",
  sevWatchBg: "rgba(232, 150, 87, 0.14)",
  sevWatchBorder: "rgba(232, 150, 87, 0.45)",
  sevWatchInk: "#f0b27a",
  sevWarnBg: "rgba(220, 80, 80, 0.14)",
  sevWarnBorder: "rgba(220, 80, 80, 0.45)",
  sevWarnInk: "#ee9090",
};

const nightRed = {
  bg: "#100404",
  // text bumped from #c04848 → #d05050: contrast vs dark card surface
  // goes from ~4:1 to ~5.1:1, clearing WCAG AA for normal-weight text.
  text: "#d05050",
  // textDim was #783030 (contrast ~2.25:1 — unreadable for small text,
  // confirmed by k5map feedback). Bumped to #b84848 → ~4:1 contrast,
  // matching the original text token's previous level and making
  // secondary labels (unit suffixes, sub-labels) legible in night mode.
  textDim: "#b84848",
  accent: "#c44040",
  accentSoft: "rgba(196, 64, 64, 0.18)",
  surface: "rgba(40, 12, 12, 0.85)",
  surfaceHybrid: "rgba(40, 12, 12, 0.96)",
  border: "rgba(176, 64, 64, 0.10)",
  borderHybrid: "rgba(176, 64, 64, 0.22)",
  warn: "#c44040",
  danger: "#e04040",
  cool: "#783838",
  // In night-red mode every severity tier collapses to the palette's
  // red — the design's deliberate constraint for night-vision
  // preservation. The icon + label inside the chip carry the tier
  // discrimination; the colour just signals "alert" generically.
  sevAdvBg: "rgba(232, 80, 80, 0.10)",
  sevAdvBorder: "rgba(232, 80, 80, 0.30)",
  sevAdvInk: "#d04848",
  sevWatchBg: "rgba(232, 80, 80, 0.14)",
  sevWatchBorder: "rgba(232, 80, 80, 0.40)",
  sevWatchInk: "#e05858",
  sevWarnBg: "rgba(232, 80, 80, 0.20)",
  sevWarnBorder: "rgba(232, 80, 80, 0.55)",
  sevWarnInk: "#f06060",
};

export const tokens = { day, dusk, night, nightRed };

export const PALETTES = Object.keys(tokens);

/**
 * Resolve a palette object by name with a safe fallback. Components
 * shouldn't index `tokens` directly — using this helper guarantees we
 * never crash if a stored preference ends up out of sync with the code.
 *
 * @param {String} name — palette name (`day` / `dusk` / `night` / `nightRed`)
 * @returns {object} the matching palette, or `dusk` if `name` is unknown
 */
export function getPalette(name) {
  return tokens[name] || tokens.dusk;
}
