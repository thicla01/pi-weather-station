// Shared geometry + styling for the radar overlay. Pure JS, no
// react-leaflet / no hooks / no styles.css — every export here works
// equally well in a sub-component file, in `index.js`, or in a unit
// test under node:test.
//
// Three families of exports live together because they share concepts:
//
//   1. Sampling geometry — direction tables, distance grids, the
//      great-circle `offsetLatLon` formula. Mirrors
//      `server/radarAnalyzerCtrl.js` so a client-side sample dot lines
//      up exactly with the point the AI summary reads from RainViewer.
//
//   2. Style tables — the colour palettes for the dashed risk rings,
//      the sample-point dots, and the motion-trend arrows. All keyed
//      by theme (light / dark / nightRed) so a palette switch resolves
//      via lookup rather than per-component branching.
//
//   3. Pure helpers — small standalone functions: `tierForIntensity`,
//      `buildRingLayers`, `buildArrowPath`, `buildSamplingPoints`,
//      `panWithRailOffset`, `hasVal`. None take React state, none
//      mutate anything outside their return value (or — in
//      panWithRailOffset's case — the Leaflet map argument the caller
//      passes in).

// ─── Sampling geometry ──────────────────────────────────────────────

// Sampling-point bearings (clockwise from north). Dense layout
// (May 2026): 16 inner directions, 32 outer directions, 10 distance
// steps per ring per unit (every 5 km / 3 mi). 481 points total when
// extendedRadius is on. KM_PER_UNIT converts user units to km for the
// great-circle math; METERS_PER_UNIT is what Leaflet's Circle takes.
export const INNER_BEARINGS = Array.from({ length: 16 }, (_, i) => i * 22.5);
export const OUTER_BEARINGS = Array.from({ length: 32 }, (_, i) => i * 11.25);
export const KM_PER_UNIT = { km: 1, mi: 1.609344 };
export const METERS_PER_UNIT = { km: 1000, mi: 1609.344 };
export const RADAR_GEOMETRY = {
  km: {
    inner: [5, 10, 15, 20, 25, 30, 35, 40, 45, 50],
    outer: [55, 60, 65, 70, 75, 80, 85, 90, 95, 100],
  },
  mi: {
    inner: [3, 6, 9, 12, 15, 18, 21, 24, 27, 30],
    outer: [33, 36, 39, 42, 45, 48, 51, 54, 57, 60],
  },
};
const EARTH_R_KM = 6371;

// Bearing → direction-name maps. Names must match the server side
// (radarAnalyzerCtrl.js INNER_DIRECTIONS / OUTER_DIRECTIONS) exactly
// so the per-sample lookup key `${direction}:${distance}` resolves.
// - INNER (16 directions): standard compass names (N, NNE, NE, …, NNW)
// - OUTER (32 directions): compass name where bearing matches one of
//   the 16 main bearings, otherwise the bearing value itself as a
//   string ("11.25", "33.75", …, "348.75").
const COMPASS_16 = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
                    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
export const BEARING_TO_DIR_INNER = Object.fromEntries(
  INNER_BEARINGS.map((b, i) => [b, COMPASS_16[i]])
);
export const BEARING_TO_DIR_OUTER = Object.fromEntries(
  OUTER_BEARINGS.map((b, i) => [b, i % 2 === 0 ? COMPASS_16[i / 2] : b.toString()])
);

// Reverse direction-name → bearing maps so the arrow renderer can
// place each arrow at the right azimuth. Server's directionVectors
// only carries the label; the lat/lon position is computed client-
// side via offsetLatLon, same approach as buildSamplingPoints.
export const DIR_INNER_TO_BEARING = Object.fromEntries(
  Object.entries(BEARING_TO_DIR_INNER).map(([b, d]) => [d, Number(b)])
);
export const DIR_OUTER_TO_BEARING = Object.fromEntries(
  Object.entries(BEARING_TO_DIR_OUTER).map(([b, d]) => [d, Number(b)])
);

// ─── Style tables ───────────────────────────────────────────────────

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

// Sampling-point dot palette. Diverges from RING_RISK_STYLE only on
// the light-mode yellow: the rings' goldenrod (#c9a200) reads cleanly
// as a 4-px stroke but drowns as a small filled disc on cream —
// bright pure yellow #f0e600 has more visible area at dot scale.
// Orange and red have enough mid-tone luminance to stay readable in
// either treatment.
export const DOT_COLOR_BY_TIER = {
  light: { yellow: "#f0e600", orange: "#f08200", red: "#e60000" },
  dark:  { yellow: "#f0e600", orange: "#f08200", red: "#e60000" },
};

// Stroke colour by trend. Approaching uses a warm hue (alarm-leaning),
// leaving a cool hue (relaxed), and drifting an amber middle hue —
// "movement detected, not urgent". All independent of the dashed-
// circle tier colour so the arrows don't blend into the ring they
// sit on.
export const ARROW_COLOR = {
  approaching: { dark: "#f87171", light: "#dc2626" }, // red-400 / red-600
  leaving: { dark: "#60a5fa", light: "#2563eb" },     // blue-400 / blue-600
  drifting: { dark: "#fbbf24", light: "#d97706" },    // amber-400 / amber-700
};

// ─── Pure helpers ───────────────────────────────────────────────────

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

/**
 * Intensity → tier mapping matching the server's RISK_LEVELS array.
 * Returns null for clear (intensity 0) so the caller can keep the
 * neutral default colour for that case.
 *
 * @param {Number|null} intensity
 * @returns {"red"|"orange"|"yellow"|null}
 */
export function tierForIntensity(intensity) {
  if (intensity == null || intensity <= 0) return null;
  if (intensity >= 5) return "red";
  if (intensity >= 4) return "orange";
  return "yellow";
}

/**
 * Compute a destination lat/lon from a starting point, distance, and bearing.
 * Mirrors offsetLatLon in server/radarAnalyzerCtrl.js (great-circle formula).
 *
 * @param {Number} lat Starting latitude (deg)
 * @param {Number} lon Starting longitude (deg)
 * @param {Number} distanceKm Distance in kilometres
 * @param {Number} bearingDeg Bearing clockwise from north (deg)
 * @returns {{lat: Number, lon: Number}} Destination coordinates
 */
export function offsetLatLon(lat, lon, distanceKm, bearingDeg) {
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;
  const bearing = (bearingDeg * Math.PI) / 180;
  const d = distanceKm / EARTH_R_KM;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(bearing)
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
    );
  return { lat: (lat2 * 180) / Math.PI, lon: (lon2 * 180) / Math.PI };
}

/**
 * Build the polyline points for a single direction arrow. Anchors the
 * tail at the peak sample (peakDistance along the bearing) and points
 * the head toward the centre when the band is approaching, away from
 * the centre when leaving. The head includes a small V (~30° wing
 * angle) so the direction reads even at a glance on a busy radar map.
 *
 * Length scales with magnitude (clamped 0.4× to 1.5× of half the peak
 * distance) so a fast-moving band reads visually heavier than a small
 * drift, but a single long arrow can't cross the entire ring and
 * obscure other arrows. All distances are in the user's distance unit
 * for the offsetLatLon math; result is an array of [lat, lng] pairs
 * suitable for direct use as Polyline `positions`.
 *
 * @param {Array<Number>} center [lat, lng] pair (the user's location)
 * @param {Number} bearing Bearing of this direction in degrees from north
 * @param {Number} peakDistance Distance to the peak sample, in user units
 * @param {Number} magnitude Inward shift over the trend window, in user units
 * @param {String} trend "approaching" | "leaving" | "drifting"
 * @param {Number} kmPerUnit Conversion factor for offsetLatLon
 * @returns {Array<Array<Number>>} Polyline positions [[lat,lng], ...]
 */
export function buildArrowPath(center, bearing, peakDistance, magnitude, trend, kmPerUnit) {
  const [centerLat, centerLng] = center;
  // Arrow length: between 0.4× and 1.5× of half the peak distance, with
  // magnitude (inward shift over 45 min) driving the scaling. A 5 km
  // shift on a 100 km outer ring gets a short arrow; a 40 km shift gets
  // a long one. Lower bound keeps tiny shifts visible at all.
  const halfPeak = peakDistance * 0.5;
  const scale = Math.max(0.4, Math.min(1.5, magnitude / 20));
  const arrowLen = halfPeak * scale;
  // Tail anchored at the peak sample; head offset by arrowLen along the
  // bearing toward (approaching/drifting) or away from (leaving) the
  // centre. Drifting bands are technically moving inward — they just
  // didn't pass the ETA gate — so geometrically they look like
  // approaching arrows. The colour distinguishes them.
  const inward = trend === "approaching" || trend === "drifting";
  const tail = offsetLatLon(centerLat, centerLng, peakDistance * kmPerUnit, bearing);
  const headDistance = inward
    ? Math.max(0, peakDistance - arrowLen)
    : peakDistance + arrowLen;
  const head = offsetLatLon(centerLat, centerLng, headDistance * kmPerUnit, bearing);
  // V-shape arrowhead: two short wings angled 30° from the line at the
  // head, pointing BACK toward the tail. The wings should open opposite
  // to the direction of motion so the V reads as a normal arrow tip
  // (apex forward, legs trailing). Direction of motion:
  //   - approaching: tail far → head near = inward (bearing + 180)
  //     → wings should trail outward (bearing).
  //   - leaving: tail near → head far = outward (bearing)
  //     → wings should trail inward (bearing + 180).
  // The previous implementation had this inverted, which placed the
  // wings forward of the head and made arrows read like Y-shapes —
  // user reported "j'ai de la difficulté à interpréter les flèches".
  const wingLen = arrowLen * 0.25;
  const wingBearing = (inward ? bearing : bearing + 180) % 360;
  const leftWing = offsetLatLon(head.lat, head.lon, wingLen * kmPerUnit, (wingBearing - 30 + 360) % 360);
  const rightWing = offsetLatLon(head.lat, head.lon, wingLen * kmPerUnit, (wingBearing + 30) % 360);
  return [
    [tail.lat, tail.lon],
    [head.lat, head.lon],
    [leftWing.lat, leftWing.lon],
    [head.lat, head.lon],
    [rightWing.lat, rightWing.lon],
  ];
}

/**
 * Build the list of sampling points around a center, using the same
 * geometry as the server radar analyzer. Each entry carries the
 * lat/lng pair plus a `${direction}:${distance}` key that matches the
 * server's per-sample shape — the renderer uses the key to look up
 * the sample's intensity in the polled risk payload and colour the
 * dot accordingly. Inner ring is always 16 directions; outer ring
 * (when extended) is 32 directions. Sample distances vary by unit
 * (km or mi). The centre point matches the "C" direction the server
 * samples directly at (lat, lon) so a cell sitting right on the
 * marker still registers in the analyzer and the risk score.
 *
 * @param {Array<Number>} center [lat, lng] pair
 * @param {Boolean} extended Whether to include the outer ring
 * @param {String} unit "km" or "mi" — selects the geometry table
 * @returns {Array<{position: Array<Number>, key: String}>} Sample points
 */
export function buildSamplingPoints(center, extended, unit) {
  const [centerLat, centerLng] = center;
  const geometry = RADAR_GEOMETRY[unit];
  const kmPerUnit = KM_PER_UNIT[unit];
  const points = [{ position: [centerLat, centerLng], key: "C:0" }];
  for (const bearing of INNER_BEARINGS) {
    const dir = BEARING_TO_DIR_INNER[bearing];
    for (const distance of geometry.inner) {
      const p = offsetLatLon(centerLat, centerLng, distance * kmPerUnit, bearing);
      points.push({ position: [p.lat, p.lon], key: `${dir}:${distance}` });
    }
  }
  if (extended) {
    for (const bearing of OUTER_BEARINGS) {
      const dir = BEARING_TO_DIR_OUTER[bearing];
      for (const distance of geometry.outer) {
        const p = offsetLatLon(centerLat, centerLng, distance * kmPerUnit, bearing);
        points.push({ position: [p.lat, p.lon], key: `${dir}:${distance}` });
      }
    }
  }
  return points;
}

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
 * Pan the map so `latLng` ends up at the *visual* centre of the area
 * NOT covered by the right rail. Leaflet's stock centring puts the
 * latLng at viewport-centre, but in v3 ambient layouts the rail
 * covers the right ~320 px of the map; that shifts the marker to the
 * north-east visually even though it's geographically centred.
 *
 * Trick: project the target latLng to pixel coords at the current
 * zoom, push the pixel point right by half the rail width, then
 * unproject. The new map centre is geographically to the right of
 * the marker — Leaflet centres on it, which puts the marker visually
 * to the LEFT of viewport-centre, which is exactly the centre of the
 * non-rail area.
 *
 * When `offset` is zero (no rail overlaying the map, full-screen radar
 * mode) the function falls back to a plain panTo / setView and the
 * marker sits at the true viewport centre.
 *
 * Not a hook — takes the Leaflet map as an argument, returns nothing,
 * has no React state. Safe to call from any component or imperative
 * handler that has a map reference.
 *
 * @param {object} map — Leaflet map instance
 * @param {Array<Number>} latLng — `[lat, lon]`
 * @param {{x: Number, y: Number}} offset — pixels covered by rail / HeroBand
 * @param {object} [opts]
 * @param {boolean} [opts.animate] — true for panTo, false for
 *   setView without animation (used on initial mount where animation
 *   looks janky)
 */
export function panWithRailOffset(map, latLng, offset, opts = {}) {
  const { animate = true } = opts;
  const offsetX = (offset && offset.x) || 0;
  const offsetY = (offset && offset.y) || 0;
  if (!offsetX && !offsetY) {
    if (animate) map.panTo(latLng);
    else map.setView(latLng, map.getZoom(), { animate: false });
    return;
  }
  const zoom = map.getZoom();
  const point = map.project(latLng, zoom);
  // X: positive offset means rail covers the right edge; push the
  //    map centre RIGHT, which moves the marker visually LEFT.
  // Y: positive offset means the HeroBand covers the top; push the
  //    map centre UP (smaller pixel Y), which moves the marker
  //    visually DOWN past the band. Subtract because Leaflet's
  //    pixel Y points DOWN.
  const adjusted = point.add([offsetX / 2, -offsetY / 2]);
  const newCenter = map.unproject(adjusted, zoom);
  if (animate) map.panTo(newCenter);
  else map.setView(newCenter, zoom, { animate: false });
}

/**
 * Tier → display colour for an alert polygon / chip. Matches the
 * SeverityChip + AlertBanner palette so the map overlay and the banner
 * agree. Falls back to a neutral grey for an unexpected tier value.
 *
 * In nightRed, app-painted alert chrome collapses to the red family
 * (Phase 3 design rule A1) — opacity steps carry the tier hierarchy.
 * The values mirror the `--rc-alert-*` nightRed tokens in styles.css
 * so the on-map polygons/markers and the legend key recolour together.
 *
 * @param {?String} tier "red" | "orange" | "yellow"
 * @param {Boolean} [nightRed] Night-vision palette active
 * @returns {String} CSS colour (hex or rgba)
 */
export function tierColour(tier, nightRed = false) {
  if (nightRed) {
    if (tier === "red") return "#e85858";
    if (tier === "orange") return "rgba(232, 88, 88, 0.6)";
    if (tier === "yellow") return "rgba(232, 88, 88, 0.32)";
    return "rgba(232, 88, 88, 0.4)";
  }
  if (tier === "red") return "#e60000";
  if (tier === "orange") return "#ee7710";
  if (tier === "yellow") return "#f0c000";
  return "#888888";
}

/**
 * Tier → Leaflet path layers for an alert polygon. Returned innermost-first
 * so the caller maps them to stacked layers in z-order, exactly like
 * `RiskRing` does with `buildRingLayers`.
 *
 * Light/day mode gets the same dark-casing contrast trick as the radar
 * rings: the warm alert hues lose contrast against the warm, light basemap
 * (orange ≈ 2.3:1, yellow ≈ 1.3:1 — below the 3:1 floor for a graphical
 * boundary), so a solid `RING_OUTLINE_COLOR` casing is drawn beneath the
 * coloured stroke (weight 2 + RING_OUTLINE_EXTRA_WEIGHT) to restore a
 * glanceable edge. Dark mode already contrasts the same hues against the
 * near-black basemap, and nightRed deliberately keeps a single red family
 * (Phase 3 A1) that a grey casing would break — both render the single
 * coloured layer only. The 15 % fill rides the coloured (top) layer; the
 * casing is stroke-only so the interior isn't double-filled.
 *
 * @param {?String} tier "red" | "orange" | "yellow"
 * @param {Boolean} [nightRed] night-vision palette active (tiers → red family)
 * @param {Boolean} [dark] dark-mode flag
 * @returns {Array<object>} one (dark / nightRed) or two (light) path-option objects
 */
export function buildAlertPolygonLayers(tier, nightRed = false, dark = false) {
  const colour = tierColour(tier, nightRed);
  const fill = {
    color: colour,
    weight: 2,
    fillColor: colour,
    fillOpacity: 0.15,
    // Solid border — distinct from the dashed radar circles, so the user
    // reads "real alert boundary" vs "derived radar ring" at a glance.
    dashArray: null,
  };
  if (nightRed || dark) return [fill];
  return [
    {
      color: RING_OUTLINE_COLOR,
      weight: 2 + RING_OUTLINE_EXTRA_WEIGHT,
      opacity: 0.85,
      fill: false,
      dashArray: null,
    },
    fill,
  ];
}

/**
 * Leaflet pathOptions for the "nearby alerts" radius ring — the user's
 * chosen survey extent, drawn as a persistent circle kept visually
 * distinct from the radar risk rings. Day / dusk / night use the cool
 * blue, dotted; nightRed keeps the red family (night-vision) and
 * separates itself by a long dash-dot pattern instead of hue. Stroke
 * only, matching the radar rings' stroke-only language.
 *
 * @param {Boolean} dark dark-mode flag
 * @param {Boolean} [nightRed] sleep-stage night-red palette override
 * @returns {object} Leaflet path options for the radius ring circle
 */
export function buildRadiusRingOptions(dark, nightRed = false) {
  if (nightRed) {
    return { color: "#e07070", weight: 2.5, dashArray: "11 5 2 5", lineCap: "round", fill: false };
  }
  return {
    // Light-mode value is a clearly-saturated blue (#1565c0), NOT a muted
    // slate. The radar calm-rings are #3a3938; a desaturated blue like the
    // former #3a5a78 shares their exact red channel (0x3a) and is close in
    // green, so only the blue channel differed — it read as "grey with a
    // hint of blue" against the light, colourful basemap and was
    // indistinguishable from the radar rings (reported 2026-06-13).
    // Dark mode keeps the lighter cool blue — it reads cool against the
    // dark basemap, distinct from the warm-grey (#a8a097) radar rings.
    color: dark ? "#6a8ca8" : "#1565c0",
    weight: 2.5,
    dashArray: "2 7",
    lineCap: "round",
    fill: false,
  };
}

/**
 * Ray-casting point-in-polygon for a single GeoJSON ring ([lon, lat]
 * pairs, GeoJSON order). Boundary cases aren't special-cased — a
 * one-pixel miss at the edge is irrelevant for tap detection.
 *
 * @param {Number} lat
 * @param {Number} lon
 * @param {Array<Array<Number>>} ring
 * @returns {Boolean} true when the point is inside the ring
 */
function pointInRing(lat, lon, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = ((yi > lat) !== (yj > lat))
      && (lon < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Is (lat, lon) inside a GeoJSON Polygon / MultiPolygon? Holes are
 * honoured (XOR across each polygon's rings). The client mirror of the
 * server's `_shared.pointInPolygon`, used to detect which nearby-alert
 * polygons a map tap landed in (Phase 3b survey popup).
 *
 * @param {Number} lat
 * @param {Number} lon
 * @param {object} geometry GeoJSON Polygon | MultiPolygon
 * @returns {Boolean} true when the point falls inside the polygon
 */
export function pointInGeometry(lat, lon, geometry) {
  if (!geometry) return false;
  const polys = geometry.type === "MultiPolygon"
    ? geometry.coordinates
    : geometry.type === "Polygon"
      ? [geometry.coordinates]
      : [];
  for (const poly of polys) {
    let inside = false;
    for (const ring of poly) {
      if (pointInRing(lat, lon, ring)) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}
