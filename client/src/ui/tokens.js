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
// Three tiers (low / med / high severity colours) each carry a bg / border /
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
  // Bumped 0.10 → 0.16 (v3.1 Phase 2 polish): dark-on-cream at 10 %
  // alpha read as near-invisible in daylight — the structural
  // hairlines (clock panel C1, card edges, grid + air-card dividers)
  // were getting lost. 0.16 stays clearly below the hybrid/alert
  // weight (0.18) so calm light mode still reads calm. Dark-on-light
  // is intrinsically fainter than light-on-dark at equal alpha, which
  // is why only day needed the lift (dusk/night/nightRed read fine).
  border: "rgba(42, 38, 32, 0.16)",
  borderHybrid: "rgba(42, 38, 32, 0.18)",
  warn: "#c47a18",
  danger: "#b03028",
  cool: "#3a5a78",
  // Advisory (yellow) tier accent — the solid alert-gold used for the
  // AlertBanner / FloatingMiniBanner left severity strip. Matches the
  // gold the WeatherMap alert-zone polygon paints (#f0c000) so the
  // banner strip and the map zone agree. Distinct from `sevLowInk`,
  // which is a DARK text-ink colour (dark-on-light) — using it on the
  // strip rendered as a muddy olive instead of yellow.
  advisory: "#f0c000",
  sevLowBg: "rgba(232, 200, 122, 0.18)",
  sevLowBorder: "rgba(232, 200, 122, 0.5)",
  sevLowInk: "#8a6a18",
  sevMedBg: "rgba(232, 150, 87, 0.20)",
  sevMedBorder: "rgba(232, 150, 87, 0.55)",
  sevMedInk: "#b85a2d",
  sevHighBg: "rgba(220, 80, 80, 0.18)",
  sevHighBorder: "rgba(220, 80, 80, 0.55)",
  sevHighInk: "#b03030",
  // Moon-phase glyph (used by `MoonGlyph` SVG component). Naming
  // follows what each token PAINTS:
  //   - moonLit  : colour of the LIT-side path (the phase outline)
  //   - moonDark : colour of the dark/shadow disc behind it
  // All four palettes use the same convention: a DARK disc with
  // a BRIGHT lit shape on top. That matches the universal emoji
  // convention (Apple Color Emoji draws moons this way) so a
  // waxing crescent reads as "bright sliver on the right" in
  // every mode. The synthesis design's clair mode originally
  // inverted this (light disc + dark "lit" silhouette) but field-
  // tested as confusing: users read the dark crescent as the
  // SHADOW side and mistook a waxing crescent for waning
  // gibbous. Aligning all palettes on dark-disc/bright-lit
  // removes the cross-mode reading ambiguity.
  moonLit: "#f4e4a8",
  moonDark: "#7a6a48",
  // Category-qualifier tokens (v3.1 Phase 2, normative `--mx-*` table
  // from the Claude Design P2 v2.1 handoff). One token per severity
  // tier of the app's category system (`ui/severity.js`):
  //   catGood → low · catMod → moderate · catBad → high ·
  //   catVhigh → veryHigh (UV "extreme" aliases catVhigh — no 5th token).
  // These drive the air-card pills and the metric-tile qualifiers so
  // the words stay legible per palette — including nightRed, where all
  // four tiers collapse to the red family and the WORD alone carries
  // the meaning (this closes the known nightRed-override gap).
  catGood: "#3e7d52",
  catMod: "#a8801f",
  catBad: "#b54848",
  catVhigh: "#7e3fb1",
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
  advisory: "#f0c000",
  sevLowBg: "rgba(232, 200, 122, 0.12)",
  sevLowBorder: "rgba(232, 200, 122, 0.40)",
  sevLowInk: "#e8c87a",
  sevMedBg: "rgba(232, 150, 87, 0.15)",
  sevMedBorder: "rgba(232, 150, 87, 0.48)",
  sevMedInk: "#f0b27a",
  sevHighBg: "rgba(220, 80, 80, 0.16)",
  sevHighBorder: "rgba(220, 80, 80, 0.48)",
  sevHighInk: "#ee9090",
  // Warm cream lit side on a dim brown dark side — both contrast
  // with the dusk bg #1c1a17.
  moonLit: "#f0ddb8",
  moonDark: "#3a3528",
  // Category tokens — see the `day` palette for the tier mapping.
  catGood: "#79b389",
  catMod: "#d3a953",
  catBad: "#d97070",
  catVhigh: "#a778d0",
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
  advisory: "#f0c000",
  sevLowBg: "rgba(232, 200, 122, 0.10)",
  sevLowBorder: "rgba(232, 200, 122, 0.35)",
  sevLowInk: "#e8c87a",
  sevMedBg: "rgba(232, 150, 87, 0.14)",
  sevMedBorder: "rgba(232, 150, 87, 0.45)",
  sevMedInk: "#f0b27a",
  sevHighBg: "rgba(220, 80, 80, 0.14)",
  sevHighBorder: "rgba(220, 80, 80, 0.45)",
  sevHighInk: "#ee9090",
  // Same warm-cream / dim-brown pair as dusk — both palettes share
  // the "dark surface, warm lit side" treatment. Tested against the
  // night bg #0e0c0a for the night-vision palette criterion: cream
  // (#f0ddb8) on near-black gives ~10:1 contrast which is well
  // above the AA threshold for non-text decoration.
  moonLit: "#f0ddb8",
  moonDark: "#3a3528",
  // Category tokens — see the `day` palette for the tier mapping.
  catGood: "#6db582",
  catMod: "#d9b260",
  catBad: "#d56f6f",
  catVhigh: "#a87fd4",
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
  // `advisory` therefore collapses to red here too (it would otherwise
  // be the alert-gold #f0c000), so the banner strip stays night-safe.
  advisory: "#c44040",
  sevLowBg: "rgba(232, 80, 80, 0.10)",
  sevLowBorder: "rgba(232, 80, 80, 0.30)",
  sevLowInk: "#d04848",
  sevMedBg: "rgba(232, 80, 80, 0.14)",
  sevMedBorder: "rgba(232, 80, 80, 0.40)",
  sevMedInk: "#e05858",
  sevHighBg: "rgba(232, 80, 80, 0.20)",
  sevHighBorder: "rgba(232, 80, 80, 0.55)",
  sevHighInk: "#f06060",
  // Night-red mode: red lit side on a deeper red dark side. Both
  // stay within the red-only constraint that the palette is
  // designed for, so the moon glyph doesn't break the night-vision
  // intent the way a warm-cream lit side would.
  moonLit: "#d04848",
  moonDark: "#2a0e0e",
  // Category tokens collapse to a single red — night-vision rule. The
  // pill/qualifier WORD carries the tier; colour only signals "category".
  catGood: "#d04848",
  catMod: "#d04848",
  catBad: "#d04848",
  catVhigh: "#d04848",
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
