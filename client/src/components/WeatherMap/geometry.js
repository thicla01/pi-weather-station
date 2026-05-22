// Shared geometry + styling for the radar dashed circles. This is the
// FIRST file of the planned `WeatherMap/geometry.js` accretion: more
// pure helpers (offsetLatLon, buildArrowPath, buildSamplingPoints,
// panWithRailOffset, hasVal, getMapTimestamps, the bearing tables)
// will move here in follow-up slices. Today's extraction focuses on
// what RiskRing needed to be liberated from index.js — the four
// items below were inlined in WeatherMap/index.js for historical
// reasons; nothing about them depends on react-leaflet, hooks, or
// styles.css.

// Risk-level colour mapping for the dashed radar circles. The three
// tiers match the server's RISK_LEVELS in radarAnalyzerCtrl.js. Both
// "light" and "dark" themes use the radar-tile palette directly
// (yellow / orange / red); `buildRingLayers` below handles the
// light-mode contrast trick (dark outline + bright dashed stroke on
// top) so the bright tier colours don't drown against the cream
// basemap. The bumped weight on the red tier makes the severe-tier
// alert glanceable at the 7" / 10" kiosk distance.
//
// `nightRed` (sleep-stage-1 long-wavelength palette) keeps every tier
// inside the red family so the radar rings don't visually break the
// night-vision palette — bright yellow / orange / red would read as
// alien intrusions against the anthracite-red background. Alarm
// escalation here works on THREE axes (the colour hue contribution
// is intentionally narrow):
//   1. Saturation: warn (muted) → mid (mid) → danger (deepest)
//   2. Stroke weight: 4 → 5 → 7 (vs 2 for calm)
//   3. Pattern: dashed 6 6 → dashed 4 4 → SOLID
// The solid stroke for the severe tier creates a clear visual rupture
// from the dashed tiers below — readable even on a 7" kiosk at glance
// distance, and survives the dark-adapted vision the nightRed palette
// aims to preserve.
export const RING_RISK_STYLE = {
  light: {
    yellow: { color: "#f0e600", weight: 3 },
    orange: { color: "#f08200", weight: 3 },
    red:    { color: "#e60000", weight: 4 },
  },
  dark: {
    yellow: { color: "#f0e600", weight: 3 },
    orange: { color: "#f08200", weight: 3 },
    red:    { color: "#e60000", weight: 4 },
  },
  nightRed: {
    yellow: { color: "#a82828", weight: 4, dashArray: "6 6" },
    orange: { color: "#8c1818", weight: 5, dashArray: "4 4" },
    red:    { color: "#6b0808", weight: 7, solid: true },
  },
};

export const RING_OUTLINE_COLOR = "#3a3938";   // dark-grey halo behind coloured strokes in light mode
export const RING_OUTLINE_EXTRA_WEIGHT = 2;    // outline extends ~1 px on each side of the coloured stroke

/**
 * Build the Leaflet pathOptions stack for a dashed radar circle. Returns
 * one or two layers: a single neutral stroke for calm rings (and dark-
 * mode coloured rings, where the dark basemap provides natural contrast),
 * or a darker outline + bright coloured stroke pair for light-mode
 * coloured rings. The two-layer trick lets us keep the bright radar-tile
 * palette (#f0e600 / #f08200 / #e60000) without it drowning against the
 * cream basemap — the outline does the heavy lifting on contrast.
 *
 * Dark-mode calm uses a warm desaturated grey instead of near-white. The
 * previous #f6f6f4 read as "alarm" against the dark basemap even when
 * there was no precipitation; #a8a097 picks up the dark-panel tones.
 *
 * @param {String|null} risk Risk level, or null when not yet loaded
 * @param {Boolean} dark Dark-mode flag
 * @param {Boolean} [aiOff] When true, the AI summary is unavailable
 *   (no Anthropic key). Calm-tier rings are rendered with reduced
 *   opacity and a sparser dash pattern to signal "analysis zone
 *   present, AI narrative absent". Coloured tiers (yellow / orange /
 *   red) intentionally ignore this flag — alerts need to be loud
 *   regardless of the AI's availability.
 * @param {Boolean} [nightRed] sleep-stage-1 palette override
 * @returns {Array<object>} Ordered list of pathOptions; render in order
 *   so the coloured stroke sits on top of the outline.
 */
export function buildRingLayers(risk, dark, aiOff = false, nightRed = false) {
  const paletteKey = nightRed ? "nightRed" : (dark ? "dark" : "light");
  const overlay = risk && RING_RISK_STYLE[paletteKey][risk];
  const baseDash = "6 6";
  // Calm / not yet loaded — single neutral ring, theme-aware. nightRed
  // tints the ring to match the rest of the palette: `#c04848` is the
  // nightRed.text token — same hue family as the card text & surfaces,
  // harmonises without crossing into "alert" territory (deeper reds
  // stay reserved for the actual risk overlays, which use both deeper
  // saturation and wider strokes).
  if (!overlay) {
    return [{
      color: nightRed ? "#c04848" : (dark ? "#a8a097" : "#3a3938"),
      weight: 2,
      // Subdued treatment when AI is off: opacity dropped from 0.85
      // to 0.35 and the dash made sparser ("3 9" gives short marks
      // with wide gaps, reading as a faint guide line). The zone is
      // still locatable but visually recedes, so users without an
      // Anthropic key understand the AlertBanner driving them is
      // computed locally rather than narrated by Claude.
      opacity: aiOff ? 0.35 : 0.85,
      dashArray: aiOff ? "3 9" : baseDash,
      fill: false,
    }];
  }
  // nightRed coloured tier — single stroke, alarm conveyed by the
  // per-tier weight escalation (4 → 5 → 7) and dash pattern
  // (6 6 → 4 4 → solid).
  if (nightRed) {
    const layer = {
      color: overlay.color,
      weight: overlay.weight,
      opacity: 0.95,
      fill: false,
    };
    if (!overlay.solid) {
      layer.dashArray = overlay.dashArray || baseDash;
    }
    return [layer];
  }
  // Dark mode coloured tier — single bright stroke; basemap contrasts it.
  if (dark) {
    return [{
      color: overlay.color,
      weight: overlay.weight,
      opacity: 0.85,
      dashArray: baseDash,
      fill: false,
    }];
  }
  // Light mode coloured tier — dark continuous outline beneath, bright
  // dashed stroke on top. The outline is intentionally NOT dashed: if it
  // shared the dash pattern, the gap zones would have no outline either
  // and the visual effect collapsed to "fat coloured dashes". A solid
  // outline gives a clean dark ring with bright dashes embedded in it.
  return [
    {
      color: RING_OUTLINE_COLOR,
      weight: overlay.weight + RING_OUTLINE_EXTRA_WEIGHT,
      opacity: 0.85,
      fill: false,
    },
    {
      color: overlay.color,
      weight: overlay.weight,
      opacity: 1,
      dashArray: baseDash,
      fill: false,
    },
  ];
}

/**
 * Truthy-aware predicate that treats the integer 0 as a valid value.
 * Used by MapResizer to gate `setView` calls on the user's coordinates —
 * `latitude === 0` is the equator (legitimate), but `latitude === null`
 * or `latitude === undefined` is "not yet loaded" and must skip the
 * setView. A plain `!!latitude` check would conflate the two.
 *
 * @param {*} i
 * @returns {Boolean} true if `i` is truthy OR exactly the number 0
 */
export function hasVal(i) {
  return !!(i || i === 0);
}
