import React, {
  useEffect,
  useContext,
  useState,
  useCallback,
  useMemo,
  useRef,
} from "react";
import {
  MapContainer,
  TileLayer,
  WMSTileLayer,
  AttributionControl,
  Marker,
  Circle,
  CircleMarker,
  Polyline,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
// Bundle Leaflet's stylesheet via webpack instead of the CDN <link>
// that index.html used to carry. The CDN <link> + <script> were
// failing SRI checks after unpkg shipped a re-encoded build whose
// SHA-256 no longer matched the pinned hash; the <script> was also
// dead weight since react-leaflet pulls its Leaflet JS from the npm
// package above. Importing the CSS here ties stylesheet loading to
// the component that actually needs it.
import "leaflet/dist/leaflet.css";
// Default marker icons — bundle them via webpack and re-point
// L.Icon.Default so `<Marker>` without an explicit `icon` prop
// renders correctly. Leaflet's defaults assume the images live
// next to leaflet.js at runtime, which isn't the case when
// react-leaflet pulls leaflet from the npm bundle. Without this
// remap the marker fetches resolve to the site root and 404.
import markerIconUrl from "leaflet/dist/images/marker-icon.png";
import markerIcon2xUrl from "leaflet/dist/images/marker-icon-2x.png";
import markerShadowUrl from "leaflet/dist/images/marker-shadow.png";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIconUrl,
  iconRetinaUrl: markerIcon2xUrl,
  shadowUrl: markerShadowUrl,
});
import PropTypes from "prop-types";
import { AppContext } from "~/AppContext";
import { useTimeOfDay } from "~/ui/hybrid";
import { useTranslation } from "react-i18next";
import debounce from "debounce";
import axios from "axios";
import styles from "./styles.css";

// Sampling geometry — must match server/radarAnalyzerCtrl.js exactly so the
// dots rendered on the map line up with the points the AI summary actually
// reads from RainViewer. Bearings clockwise from north (deg). Distances in
// the user's chosen unit (km or mi); KM_PER_UNIT converts to km for the
// great-circle math, and METERS_PER_UNIT for Leaflet circle radii.
//
// Dense layout (May 2026): 16 inner directions, 32 outer directions, 10
// distance steps per ring per unit (every 5 km / 3 mi). 481 points total
// when extendedRadius is on.
const INNER_BEARINGS = Array.from({ length: 16 }, (_, i) => i * 22.5);
const OUTER_BEARINGS = Array.from({ length: 32 }, (_, i) => i * 11.25);
const KM_PER_UNIT = { km: 1, mi: 1.609344 };
const METERS_PER_UNIT = { km: 1000, mi: 1609.344 };
const RADAR_GEOMETRY = {
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
function offsetLatLon(lat, lon, distanceKm, bearingDeg) {
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
 * Build the list of sampling points around a center, using the same geometry
 * as the server radar analyzer. Accepts the same `[lat, lng]` array format
 * used elsewhere in WeatherMap for marker/circle positions. Inner ring is
 * always 8 directions; outer ring (when extended) is 8 or 16 directions
 * depending on doubleOuter. Sample distances vary by unit (km or mi).
 *
 * @param {Array<Number>} center [lat, lng] pair
 * @param {Boolean} extended Whether to include the outer ring
 * @param {Boolean} doubleOuter Whether to use 16 directions on the outer ring
 * @param {String} unit "km" or "mi" — selects the geometry table
 * @returns {Array<[Number, Number]>} Array of [lat, lng] pairs
 */
// Bearing → direction-name maps. Names must match the server side
// (radarAnalyzerCtrl.js INNER_DIRECTIONS / OUTER_DIRECTIONS) exactly so
// the per-sample lookup key `${direction}:${distance}` resolves.
// - INNER (16 directions): standard compass names (N, NNE, NE, …, NNW)
// - OUTER (32 directions): compass name where bearing matches one of the
//   16 main bearings, otherwise the bearing value itself as a string
//   ("11.25", "33.75", …, "348.75").
const COMPASS_16 = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
                    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const BEARING_TO_DIR_INNER = Object.fromEntries(
  INNER_BEARINGS.map((b, i) => [b, COMPASS_16[i]])
);
const BEARING_TO_DIR_OUTER = Object.fromEntries(
  OUTER_BEARINGS.map((b, i) => [b, i % 2 === 0 ? COMPASS_16[i / 2] : b.toString()])
);

// Reverse direction-name → bearing maps so the arrow renderer can place
// each arrow at the right azimuth. Server's directionVectors only
// carries the label; the lat/lon position is computed client-side via
// offsetLatLon, same approach as buildSamplingPoints.
const DIR_INNER_TO_BEARING = Object.fromEntries(
  Object.entries(BEARING_TO_DIR_INNER).map(([b, d]) => [d, Number(b)])
);
const DIR_OUTER_TO_BEARING = Object.fromEntries(
  Object.entries(BEARING_TO_DIR_OUTER).map(([b, d]) => [d, Number(b)])
);

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
 * @param {String} trend "approaching" | "leaving"
 * @param {Number} kmPerUnit Conversion factor for offsetLatLon
 * @returns {Array<Array<Number>>} Polyline positions [[lat,lng], ...]
 */
function buildArrowPath(center, bearing, peakDistance, magnitude, trend, kmPerUnit) {
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

// Stroke colour by trend. Approaching uses a warm hue (alarm-leaning),
// leaving a cool hue (relaxed), and drifting an amber middle hue —
// "movement detected, not urgent". All independent of the dashed-circle
// tier colour so the arrows don't blend into the ring they sit on.
const ARROW_COLOR = {
  approaching: { dark: "#f87171", light: "#dc2626" }, // red-400 / red-600
  leaving: { dark: "#60a5fa", light: "#2563eb" },     // blue-400 / blue-600
  drifting: { dark: "#fbbf24", light: "#d97706" },    // amber-400 / amber-700
};

function buildSamplingPoints(center, extended, unit) {
  const [centerLat, centerLng] = center;
  const geometry = RADAR_GEOMETRY[unit];
  const kmPerUnit = KM_PER_UNIT[unit];
  // Each entry carries the lat/lng pair plus a `${direction}:${distance}`
  // key that matches the server's per-sample shape. The renderer uses the
  // key to look up the sample's intensity in the polled risk payload and
  // colour the dot accordingly.
  // Centre point — matches the "C" direction the server samples directly at
  // (lat, lon) so a cell sitting right on the marker still registers in the
  // analyzer and the risk score. The dot sits under the location marker so
  // it's mostly hidden visually, but stays consistent with the principle
  // that every analysed point gets a corresponding overlay dot.
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

// Intensity → tier mapping matching the server's RISK_LEVELS array.
// Returns null for clear (intensity 0) so the caller can keep the
// neutral default colour for that case.
function tierForIntensity(intensity) {
  if (intensity == null || intensity <= 0) return null;
  if (intensity >= 5) return "red";
  if (intensity >= 4) return "orange";
  return "yellow";
}

// Sampling-point dot palette. Diverges from RING_RISK_STYLE only on the
// light-mode yellow: the rings' goldenrod (#c9a200) reads cleanly as a
// 4-px stroke but drowns as a small filled disc on cream — bright pure
// yellow #f0e600 has more visible area at dot scale. Orange and red
// have enough mid-tone luminance to stay readable in either treatment.
const DOT_COLOR_BY_TIER = {
  light: { yellow: "#f0e600", orange: "#f08200", red: "#e60000" },
  dark:  { yellow: "#f0e600", orange: "#f08200", red: "#e60000" },
};

// Risk-level colour mapping for the dashed radar circles. The four tiers
// match the server's RISK_LEVELS in radarAnalyzerCtrl.js. Both themes
// now use the radar-tile palette directly (yellow / orange / red); the
// pure yellow used to drown against the cream basemap as a 3-px stroke,
// but buildRingPathOptions now renders coloured rings as a dark outline
// + bright stroke on top in light mode (the same trick the dot renderer
// uses) — that gives the bright tier colours back without sacrificing
// readability. Dark mode keeps the single-stroke look since the dark
// basemap gives the colours enough contrast on its own. Bumped weight
// on the red tier makes the severe-tier alert glanceable at the
// 7" / 10" kiosk distance.
const RING_RISK_STYLE = {
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
  // nightRed (sleep-stage-1 long-wavelength palette) — keeps every tier
  // inside the red family so the radar rings don't visually break the
  // night-vision palette. The bright yellow / orange / red used in
  // light + dark mode read as alien intrusions against the
  // anthracite-red background. Alarm escalation here works on THREE
  // axes (the colour hue contribution is intentionally narrow):
  //
  //   1. Saturation: warn (muted) → mid (mid) → danger (deepest)
  //   2. Stroke weight: 4 → 5 → 7 (vs 2 for calm)
  //   3. Pattern: dashed 6 6 → dashed 4 4 → SOLID
  //
  // The solid stroke for the severe-tier creates a clear visual
  // rupture from the dashed tiers below — readable even on a 7"
  // kiosk at glance distance, and survives the dark-adapted vision
  // the nightRed palette aims to preserve.
  nightRed: {
    yellow: { color: "#a82828", weight: 4, dashArray: "6 6" },
    orange: { color: "#8c1818", weight: 5, dashArray: "4 4" },
    red:    { color: "#6b0808", weight: 7, solid: true },
  },
};
const RING_OUTLINE_COLOR = "#3a3938";   // dark-grey halo behind coloured strokes in light mode
const RING_OUTLINE_EXTRA_WEIGHT = 2;    // outline extends ~1 px on each side of the coloured stroke

/**
 * Build the custom DivIcon used for the user's location marker. v2.14.64
 * replaces Leaflet's default blue teardrop pin — that bright blue
 * stood out against every palette (especially nightRed where it
 * looked alien) and was hard to see on the 7" kiosk at glance
 * distance. The target-style marker (outer ring + filled centre dot)
 * picks up `--c-accent` from the active palette via CSS variables, so
 * it auto-tints with day / dusk / night / nightRed without per-palette
 * overrides. Sized at 22 × 22 with the anchor centred so the dot sits
 * exactly on the selected coordinates.
 *
 * @returns {import("leaflet").DivIcon} Leaflet DivIcon ready for `<Marker icon={…}>`
 */
function buildLocationMarkerIcon() {
  return L.divIcon({
    className: "weather-station-target",
    html:
      '<div class="weather-station-target__ring">' +
      '<div class="weather-station-target__dot"></div>' +
      '</div>',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}
const LOCATION_MARKER_ICON = buildLocationMarkerIcon();

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
 * @returns {Array<object>} Ordered list of pathOptions; render in order
 *   so the coloured stroke sits on top of the outline.
 */
function buildRingLayers(risk, dark, aiOff = false, nightRed = false) {
  // Pick the palette: nightRed wins over dark when both are active.
  const paletteKey = nightRed ? "nightRed" : (dark ? "dark" : "light");
  const overlay = risk && RING_RISK_STYLE[paletteKey][risk];
  const baseDash = "6 6";
  // Calm / not yet loaded — single neutral ring, theme-aware.
  // nightRed (sleep-stage-1 long-wavelength mode) tints the ring to
  // match the rest of the palette. Originally tried #8c5a5a (brick
  // grey) but the user wanted the dominant red that defines the
  // night-red look — same hue family as the card text & surfaces.
  // `#c04848` is exactly the nightRed.text token — it harmonises
  // the ring with the rest of the UI without crossing into "alert"
  // territory (deeper reds are still reserved for the actual risk
  // overlays, which use both deeper saturation and wider strokes).
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
  // (6 6 → 4 4 → solid). All tiers stay in the deep-red family so
  // the alert reads as "more of the same" rather than introducing a
  // colour-mode-breaking yellow / bright-red against the
  // anthracite-red basemap. See RING_RISK_STYLE.nightRed for the
  // per-tier rationale.
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
 * Wrapper that renders one or two stacked dashed circles based on the
 * risk tier — see buildRingLayers for the layering logic.
 *
 * @param {object} props
 * @param {Array<Number>} props.center [lat, lng] pair for the circle centre
 * @param {Number} props.radius Circle radius in metres
 * @param {String|null} props.risk Risk level, or null when not yet loaded
 * @param {Boolean} props.dark Dark-mode flag
 * @param {Boolean} [props.aiOff] AI summary unavailable — see buildRingLayers
 * @returns {JSX.Element} One or two stacked Circles
 */
const RiskRing = ({ center, radius, risk, dark, aiOff, nightRed }) => {
  const layers = buildRingLayers(risk, dark, aiOff, nightRed);
  return (
    <>
      {layers.map((opts, i) => (
        <Circle key={i} center={center} radius={radius} pathOptions={opts} />
      ))}
    </>
  );
};

RiskRing.propTypes = {
  center: PropTypes.array.isRequired,
  radius: PropTypes.number.isRequired,
  risk: PropTypes.string,
  dark: PropTypes.bool,
  aiOff: PropTypes.bool,
  nightRed: PropTypes.bool,
};

const RADAR_LEGEND_ITEMS = [
  { color: "#00d0d0", key: "veryLight" },
  { color: "#00c800", key: "light"     },
  { color: "#f0e600", key: "moderate"  },
  { color: "#f08200", key: "heavy"     },
  { color: "#e60000", key: "veryHeavy" },
  { color: "#7800b4", key: "extreme"   },
];

// Mapbox basemaps served via the server proxy (keeps the API key off the client).
const MAPBOX_ATTRIBUTION = '© <a href="https://www.mapbox.com/feedback/">Mapbox</a>';

/**
 * Radar precipitation legend overlay
 *
 * @param {object} props
 * @param {boolean} props.dark Dark mode
 * @returns {JSX.Element} Legend overlay
 */
const RadarLegend = ({ dark }) => {
  const { t } = useTranslation();
  return (
    <div className={`${styles.radarLegend} ${dark ? styles.radarLegendDark : styles.radarLegendLight}`}>
      <div className={styles.radarLegendTitle}>{t("radar.legend")}</div>
      {RADAR_LEGEND_ITEMS.map(({ color, key }) => (
        <div key={key} className={styles.radarLegendItem}>
          <span className={styles.radarLegendSwatch} style={{ background: color }} />
          <span className={styles.radarLegendLabel}>{t(`radar.${key}`)}</span>
        </div>
      ))}
    </div>
  );
};

RadarLegend.propTypes = {
  dark: PropTypes.bool,
};

const RADAR_SPEED_LABELS = { 1: "1×", 2: "2×", 4: "4×" };

/**
 * Radar animation timeline overlay — bottom-centre of the map. Surfaces
 * the playhead (current frame), a scrubber slider, and a speed cycler
 * (1× / 2× / 4×). The slider track is split into past and nowcast halves
 * via a CSS gradient so the user can see at a glance where the present
 * moment sits inside the available frames. Absolute-positioned over the
 * map; auto-hides when no frames are loaded so it doesn't show up as an
 * empty bar on initial mount or during a network blip.
 *
 * @param {object} props
 * @param {Array} props.frames Combined past+nowcast frame list from RainViewer
 * @param {number} props.currentIdx Resolved index into `frames`
 * @param {Function} props.onScrub Called with the new index when user scrubs
 * @param {String} props.timezone IANA timezone for the time-of-day label
 * @param {Boolean} props.dark
 * @returns {JSX.Element|null} Timeline overlay
 */
const RadarTimeline = ({ frames, currentIdx, onScrub, timezone, dark }) => {
  const { t } = useTranslation();
  const {
    radarSpeed,
    cycleRadarSpeed,
    animateWeatherMap,
    toggleAnimateWeatherMap,
    clockTime,
  } = useContext(AppContext);

  // Manual pointer-event handling on the scrubber input. Native
  // <input type="range"> on touch devices is heuristic-driven — Chrome
  // tries to decide whether a touchstart on the thumb is the start of
  // a drag or a tap-on-track, and the heuristic is fragile enough on
  // the Pi kiosk's touchscreen that quick taps often miss. Field
  // observation: holding the finger longer on the thumb makes the
  // success rate jump from ~20 % to ~80 %, which is the smoking gun
  // — Chrome wants more dwell time before committing to drag mode.
  // Override by capturing pointerdown ourselves and updating the
  // value directly from the touch x-coordinate. setPointerCapture
  // ensures subsequent moves stick to this element even when the
  // finger drifts off the input. e.preventDefault() suppresses the
  // native input's own touch handling so the two don't fight.
  // onChange is preserved for keyboard accessibility (arrow keys
  // still tab-navigate and step through frames natively). Mouse
  // works through the same pointer-event path since Chrome unifies
  // mouse and touch into pointer events.
  const scrubberRef = useRef(null);
  const updateFromClientX = useCallback((clientX) => {
    const el = scrubberRef.current;
    if (!el || !frames || frames.length < 2) return;
    const rect = el.getBoundingClientRect();
    const cs = window.getComputedStyle(el);
    const padLeft = parseFloat(cs.paddingLeft) || 0;
    const padRight = parseFloat(cs.paddingRight) || 0;
    const trackable = Math.max(1, rect.width - padLeft - padRight);
    const xRel = clientX - rect.left - padLeft;
    const frac = Math.max(0, Math.min(1, xRel / trackable));
    onScrub(Math.round(frac * (frames.length - 1)));
  }, [frames, onScrub]);
  const handleScrubberPointerDown = useCallback((e) => {
    if (e.button > 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    updateFromClientX(e.clientX);
  }, [updateFromClientX]);
  const handleScrubberPointerMove = useCallback((e) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    updateFromClientX(e.clientX);
  }, [updateFromClientX]);
  const handleScrubberPointerUp = useCallback((e) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  if (!frames || frames.length === 0) return null;
  const frame = frames[currentIdx];
  if (!frame) return null;

  // Index of the most recent past frame — that's the playhead's "home"
  // position (where it sits on initial mount). Used to expose a quick
  // "return to now" affordance when the user has scrubbed elsewhere.
  const lastPastIdx = frames.reduce(
    (acc, f, i) => (f.kind === "past" ? i : acc),
    -1
  );
  const atNow = currentIdx === lastPastIdx;

  // Build the time labels. "Now" is wall-clock at the kiosk; the frame
  // offset compares against it in minutes (negative for past frames,
  // positive for nowcast). Round to the nearest minute so a 9-minute
  // -aged frame doesn't read as -8.97 min.
  const nowSec = Math.floor(Date.now() / 1000);
  const offsetMin = Math.round((frame.time - nowSec) / 60);
  // Honour the user's 12h/24h preference from Settings — toLocaleTimeString
  // would otherwise pick the locale's default, which produced "22:30" on a
  // French-Canadian browser regardless of the kiosk's clock setting.
  const timeStr = new Date(frame.time * 1000).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: clockTime === "12",
    timeZone: timezone || undefined,
  });
  let offsetStr;
  if (Math.abs(offsetMin) < 1)      offsetStr = t("radar.timeline.now");
  else if (offsetMin > 0)           offsetStr = t("radar.timeline.plusMin", { min: offsetMin });
  else                              offsetStr = t("radar.timeline.minusMin", { min: -offsetMin });

  // Past portion of the slider track, expressed as a unitless fraction
  // (0 to 1), so the gradient colour split can be aligned in CSS with
  // the thumb's travel range using a calc() that accounts for the
  // input's horizontal padding (the padding insets the thumb at the
  // extremes so it stays fully within the input's hit area — see
  // styles.css for the full explanation).
  const pastFrac = lastPastIdx >= 0 && frames.length > 1
    ? lastPastIdx / (frames.length - 1)
    : 1;

  const isNowcast = frame.kind === "nowcast";

  return (
    <div className={`${styles.radarTimeline} ${dark ? styles.radarTimelineDark : styles.radarTimelineLight}`}>
      <div className={styles.radarTimelineLabels}>
        <span className={styles.radarTimelineTime}>{timeStr}</span>
        <span className={`${styles.radarTimelineOffset} ${isNowcast ? styles.radarTimelineForecast : ""}`}>
          {isNowcast ? t("radar.timeline.forecast") + " · " : ""}{offsetStr}
        </span>
        {!atNow && lastPastIdx >= 0 && (
          <button
            type="button"
            onClick={() => onScrub(lastPastIdx)}
            className={styles.radarTimelineNow}
            aria-label={t("radar.timeline.returnToNowAria")}
            title={t("radar.timeline.returnToNowAria")}
          >
            ⟲ {t("radar.timeline.now")}
          </button>
        )}
        <button
          type="button"
          onClick={cycleRadarSpeed}
          className={styles.radarTimelineSpeed}
          aria-label={t("radar.timeline.speedAria")}
        >
          {RADAR_SPEED_LABELS[radarSpeed] || `${radarSpeed}×`}
        </button>
      </div>
      <div className={styles.radarTimelineControls}>
        <button
          type="button"
          onClick={() => onScrub(Math.max(0, currentIdx - 1))}
          disabled={currentIdx <= 0}
          className={styles.radarTimelineStep}
          aria-label={t("radar.timeline.stepBackAria")}
          title={t("radar.timeline.stepBackAria")}
        >
          ◀
        </button>
        <button
          type="button"
          onClick={toggleAnimateWeatherMap}
          className={`${styles.radarTimelinePlay} ${animateWeatherMap ? styles.radarTimelinePlayActive : ""}`}
          aria-label={t(animateWeatherMap ? "radar.timeline.pauseAria" : "radar.timeline.playAria")}
          title={t(animateWeatherMap ? "radar.timeline.pauseAria" : "radar.timeline.playAria")}
        >
          {animateWeatherMap ? "⏸" : "▶"}
        </button>
        <button
          type="button"
          onClick={() => onScrub(Math.min(frames.length - 1, currentIdx + 1))}
          disabled={currentIdx >= frames.length - 1}
          className={styles.radarTimelineStep}
          aria-label={t("radar.timeline.stepForwardAria")}
          title={t("radar.timeline.stepForwardAria")}
        >
          ▶
        </button>
        {/* Wrapper around the native range input so we can render the "now"
            tick marks (small vertical hairlines above and below the visible
            track at the past→nowcast boundary) via pseudo-elements. Pseudo-
            elements aren't supported on <input> directly, hence the wrapper.
            CSS variables (--past-frac, --show-now-marker) are set inline here
            so the input inherits them, and the wrapper's ::before/::after use
            them to position the ticks. --show-now-marker hides the ticks
            when there are no nowcast frames (past-frac = 1, nothing past
            "now" to mark). */}
        <div
          className={`${styles.radarTimelineScrubberWrap} ${pastFrac < 1 ? styles.radarTimelineScrubberWrapWithNow : ""}`}
          style={{ "--past-frac": pastFrac }}
        >
          <input
            ref={scrubberRef}
            type="range"
            min="0"
            max={frames.length - 1}
            step="1"
            value={currentIdx}
            onChange={(e) => onScrub(parseInt(e.target.value, 10))}
            onPointerDown={handleScrubberPointerDown}
            onPointerMove={handleScrubberPointerMove}
            onPointerUp={handleScrubberPointerUp}
            onPointerCancel={handleScrubberPointerUp}
            className={styles.radarTimelineScrubber}
            aria-label={t("radar.timeline.scrubberAria")}
          />
        </div>
      </div>
    </div>
  );
};

RadarTimeline.propTypes = {
  frames: PropTypes.array,
  currentIdx: PropTypes.number,
  onScrub: PropTypes.func.isRequired,
  timezone: PropTypes.string,
  dark: PropTypes.bool,
};

/**
 * Handles map click events from inside the MapContainer context
 *
 * @param {object} props
 * @param {Function} props.onClick click handler
 * @returns {null} renders nothing
 */
const MapClickHandler = ({ onClick }) => {
  useMapEvents({ click: onClick });
  return null;
};

MapClickHandler.propTypes = {
  onClick: PropTypes.func.isRequired,
};

/**
 * Invalidates the Leaflet map size when the info panel collapses or expands
 *
 * @param {object} props
 * @param {boolean} props.infoPanelCollapsed whether the info panel is collapsed
 * @returns {null} renders nothing
 */
const MapResizer = ({ infoPanelCollapsed, mobileRadarMaximized, desktopRadarMaximized, latitude, longitude, zoom }) => {
  const map = useMap();
  useEffect(() => {
    // Two invalidateSize() calls bracket the CSS grid-template-columns
    // transition. The LayoutPi `.layout` rule transitions on
    // grid-template-columns over 200 ms — invalidating at 50 ms made
    // Leaflet snapshot the map container mid-transition, so its
    // internal `_size` cache held a value smaller than the final
    // visible map. Later pans (e.g. the Reset Map button after a
    // collapse) computed centres against that stale size and the
    // marker landed off-centre. The 50 ms call still gives a
    // live-feedback refresh as the rail slides in/out; the 250 ms
    // call (50 ms after the 200 ms transition ends) latches the
    // final size for pan math. */
    const live = setTimeout(() => map.invalidateSize(), 50);
    const final = setTimeout(() => map.invalidateSize(), 250);
    return () => {
      clearTimeout(live);
      clearTimeout(final);
    };
    // desktopRadarMaximized in the deps list lets the same
    // invalidateSize brackets fire when the user toggles full-radar
    // focus mode on LayoutDesktop (HeroBand + rail get hidden, so
    // the Leaflet container gains roughly 320 + viewport-top px of
    // canvas — needs a re-measure so tiles fill the new area).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- desktopRadarMaximized purposely re-triggers the same handler
  }, [infoPanelCollapsed, desktopRadarMaximized, map]);

  // Mobile radar maximize / minimize — same `invalidateSize` brackets
  // as the LayoutPi rail collapse PLUS a `setView` recenter on the
  // user's coordinates. Leaflet keeps the same geographic centre
  // across a container resize, so when the 220 px mini card pops up
  // to fill the scroll (and back), the marker drifted to the top
  // edge of the new viewport (user-reported on iOS). The recenter
  // pins the marker back to the geometric centre of whatever size
  // the card just became. Skipped when no valid coords are passed
  // (defensive — should never happen since the parent only mounts
  // when coords are set). */
  useEffect(() => {
    // Bail when LayoutMobile isn't active — AppContext seeds
    // `mobileRadarMaximized` to `null` and LayoutMobile flips it to
    // `false` on mount (and back to `null` on unmount). The previous
    // `=== undefined` guard didn't catch the `null` initial value,
    // so on LayoutPi / LayoutDesktop this effect fired on every
    // latitude / longitude / zoom change with a parasitic
    // `invalidateSize()` + `setView()` that snapshotted a transient
    // grid-template-columns size during boot — the marker ended up
    // off-centre (NE on user-reported screens > 7"). Tapping the
    // recenter button worked because resetMapPosition does its own
    // setView against the correctly-measured container.
    if (mobileRadarMaximized == null) return undefined;
    const live = setTimeout(() => {
      map.invalidateSize();
      if (hasVal(latitude) && hasVal(longitude) && zoom) {
        map.setView([latitude, longitude], zoom, { animate: false });
      }
    }, 50);
    const final = setTimeout(() => {
      map.invalidateSize();
      if (hasVal(latitude) && hasVal(longitude) && zoom) {
        map.setView([latitude, longitude], zoom, { animate: false });
      }
    }, 350);
    return () => {
      clearTimeout(live);
      clearTimeout(final);
    };
  }, [mobileRadarMaximized, map, latitude, longitude, zoom]);
  return null;
};

MapResizer.propTypes = {
  infoPanelCollapsed: PropTypes.bool,
  mobileRadarMaximized: PropTypes.bool,
  desktopRadarMaximized: PropTypes.bool,
  latitude: PropTypes.number,
  longitude: PropTypes.number,
  zoom: PropTypes.number,
};

/**
 * Direction-arrow toggle rendered as a proper Leaflet control so it
 * inherits the same DOM styling and event handling as the built-in
 * zoom +/- buttons. The first version of this toggle was a plain
 * absolutely-positioned <button> at z-index 1000, which looked right
 * but propagated clicks straight through to the Leaflet map underneath
 * — the user kept "selecting a new location" instead of toggling the
 * overlay (caught immediately during validation).
 *
 * `L.control` is created once on mount; subsequent prop changes are
 * reflected onto the existing DOM element via a separate effect to
 * avoid tearing down and re-adding the control on every toggle.
 *
 * @param {Object} props
 * @param {Boolean} props.active Whether the arrow overlay is currently on
 * @param {Function} props.onToggle Click handler — toggles `active`
 * @param {String} props.titleOn Tooltip when active (i.e. "Hide …")
 * @param {String} props.titleOff Tooltip when inactive ("Show …")
 * @returns {null} Renders nothing — the control is added to the map
 *   imperatively through Leaflet's API.
 */
const ArrowToggleControl = ({ active, onToggle, titleOn, titleOff }) => {
  const map = useMap();
  const linkRef = useRef(null);
  const onToggleRef = useRef(onToggle);
  // Latest handler always called via ref so the once-mounted Leaflet
  // listener doesn't capture a stale closure.
  onToggleRef.current = onToggle;

  useEffect(() => {
    const control = L.control({ position: "topleft" });
    control.onAdd = () => {
      // .leaflet-bar + .leaflet-control gives us the same border, shadow,
      // and rounded corners as the zoom buttons. The <a> inside is
      // styled by Leaflet's default .leaflet-bar a rule (white bg,
      // hover state, 30 px square).
      const container = L.DomUtil.create("div", "leaflet-bar leaflet-control");
      const link = L.DomUtil.create("a", "", container);
      link.href = "#";
      link.setAttribute("role", "button");
      link.innerHTML = "↗";
      // The default `.leaflet-touch .leaflet-bar a` rule sets the cell to
      // 30×30 with a 22 px glyph — calibrated for `+` and `−`, which fill
      // their cell much more aggressively than the unicode arrow ↗
      // (U+2197). At 22 px the arrow visibly reads as smaller than the
      // adjacent zoom buttons. Bumping the glyph to 26 px and setting an
      // explicit line-height pulls it back to visual parity with +/−
      // without changing the cell geometry.
      link.style.fontWeight = "bold";
      link.style.fontSize = "26px";
      link.style.lineHeight = "30px";
      // Stop click + scroll propagation so taps on this control don't
      // bubble down to the MapClickHandler (which would re-centre the
      // map and "select a new location").
      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);
      L.DomEvent.on(link, "click", (e) => {
        L.DomEvent.preventDefault(e);
        L.DomEvent.stopPropagation(e);
        onToggleRef.current?.();
      });
      linkRef.current = link;
      return container;
    };
    control.addTo(map);
    return () => {
      control.remove();
      linkRef.current = null;
    };
  }, [map]);

  // Reflect prop changes onto the existing DOM element. Avoids
  // re-creating the control on every toggle (which would lose its
  // place in the topleft stack and flash the +/- buttons next to it).
  useEffect(() => {
    const link = linkRef.current;
    if (!link) return;
    link.title = active ? titleOn : titleOff;
    link.setAttribute("aria-pressed", String(active));
    if (active) {
      // CSS variables in inline style — Chromium resolves them against
      // the nearest ancestor's computed value, so inside .ambientRoot
      // we pick up the active palette automatically (warm orange on
      // day/dusk/night, red on nightRed). Outside ambientRoot (v2
      // layouts) the variables are unset, the property falls back to
      // its initial value, and the link reads as transparent — which
      // would be wrong. Fallback to the original #2563eb/#fff via the
      // var() default so v2 keeps its blue active state.
      link.style.backgroundColor = "var(--c-accent, #2563eb)";
      link.style.color = "var(--c-bg, #fff)";
    } else {
      link.style.backgroundColor = "";
      link.style.color = "";
    }
  }, [active, titleOn, titleOff]);

  return null;
};

ArrowToggleControl.propTypes = {
  active: PropTypes.bool,
  onToggle: PropTypes.func.isRequired,
  titleOn: PropTypes.string.isRequired,
  titleOff: PropTypes.string.isRequired,
};

/**
 * Radar-focus toggle rendered as a Leaflet control in the topleft
 * stack (sits under the zoom +/- and the direction-arrow toggle).
 * Used on LayoutDesktop only: tapping it hides HeroBand and the
 * right rail so the radar fills the entire viewport. Same imperative
 * Leaflet control pattern as ArrowToggleControl above so the icon
 * stack reads as a coherent set of map controls — no new visual
 * vocabulary, and the click+scroll propagation is killed at the
 * Leaflet layer so we don't re-centre the map underneath.
 *
 * @param {Object} props
 * @param {Boolean} props.active Whether focus mode is currently on
 * @param {Function} props.onToggle Click handler — flips `active`
 * @param {String} props.titleOn Tooltip when active (e.g. "Restore panels")
 * @param {String} props.titleOff Tooltip when inactive (e.g. "Hide panels")
 * @returns {null} Renders nothing — control is added imperatively
 */
const RadarFocusControl = ({ active, onToggle, titleOn, titleOff }) => {
  const map = useMap();
  const linkRef = useRef(null);
  const onToggleRef = useRef(onToggle);
  onToggleRef.current = onToggle;

  useEffect(() => {
    const control = L.control({ position: "topleft" });
    control.onAdd = () => {
      const container = L.DomUtil.create("div", "leaflet-bar leaflet-control");
      const link = L.DomUtil.create("a", "", container);
      link.href = "#";
      link.setAttribute("role", "button");
      // U+26F6 (squared four-corner): renders as four L-brackets
      // pointing outward — the universal "maximize / fill" affordance.
      // When active we switch to a "←→ inward" approximation via a
      // contrasting fill colour so the user gets a clear toggle signal
      // without juggling two unicode glyphs (most fonts don't carry a
      // matching "minimize" symbol).
      link.innerHTML = "⛶";
      link.style.fontWeight = "bold";
      link.style.fontSize = "22px";
      link.style.lineHeight = "30px";
      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);
      L.DomEvent.on(link, "click", (e) => {
        L.DomEvent.preventDefault(e);
        L.DomEvent.stopPropagation(e);
        onToggleRef.current?.();
        // Blur immediately so the anchor doesn't keep keyboard focus
        // after the click. Without this the :focus / :focus-visible
        // pseudo stayed on the link and (combined with sticky :hover
        // while the cursor was still over the button) painted the
        // accent-soft hover fill — user-reported as "the button
        // stays pale after I tap to deactivate". Browsers don't
        // promote mouse-click focus to :focus-visible, but blurring
        // is the cleanest defence against the next user not getting
        // bitten by future Chrome behaviour changes here.
        link.blur();
      });
      linkRef.current = link;
      return container;
    };
    control.addTo(map);
    return () => {
      control.remove();
      linkRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    const link = linkRef.current;
    if (!link) return;
    link.title = active ? titleOn : titleOff;
    link.setAttribute("aria-pressed", String(active));
    // Toggle a class instead of setting inline styles. The Leaflet
    // base rules in ui/reset.css use !important, so inline styles
    // without !important can't win — and even if they did, the
    // :hover rule (also !important) sticks after a tap on touch /
    // devtools and the button never visually resets when the user
    // toggles focus off. The radar-focus-active CSS rule (also in
    // reset.css, with matching !important) wins cleanly both ways.
    link.classList.toggle("radar-focus-active", !!active);
  }, [active, titleOn, titleOff]);

  return null;
};

RadarFocusControl.propTypes = {
  active: PropTypes.bool,
  onToggle: PropTypes.func.isRequired,
  titleOn: PropTypes.string.isRequired,
  titleOff: PropTypes.string.isRequired,
};

/**
 * Pans the map when panToCoords changes
 *
 * @param {object} props
 * @param {object} props.panToCoords target coordinates
 * @param {Function} props.setPanToCoords resets panToCoords to null
 * @returns {null} renders nothing
 */
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
 * When `railOffset` is 0 (v2 layout, rail collapsed, full-screen
 * radar mode in Phase 11) the function falls back to a plain panTo
 * / setView and the marker sits at the true viewport centre.
 *
 * @param {object} map — Leaflet map instance
 * @param {Array<Number>} latLng — `[lat, lon]`
 * @param {Number} railOffset — visible rail width in pixels (0 if
 *   no rail is currently covering the right edge)
 * @param {object} [opts]
 * @param {boolean} [opts.animate=true] — true for panTo, false for setView
 *   without animation (used on initial mount where animation looks janky)
 */
function panWithRailOffset(map, latLng, offset, opts = {}) {
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
 * Read the visible rail's pixel width once on mount + whenever the
 * collapsed/experimental flags toggle. Queries the DOM directly
 * because the value lives in CSS variables on `.ambientRoot` and on
 * the rail's actual rendered bounding rect (the `--c-rail-width`
 * value differs between LayoutDesktop and LayoutPi, and is bumped
 * to 360 px on wide displays via a media query). Returns 0 when
 * there's no rail to worry about (v2 layout, rail collapsed, no
 * ambientRoot present).
 *
 * The 1-frame timeout is load-bearing for the initial measurement:
 * WeatherMap mounts inside the rail-bearing layout, so the rail's
 * geometry isn't yet laid out when this effect's first synchronous
 * pass runs. Deferring by a frame lets the browser commit the
 * stylesheet before we measure.
 *
 * @returns {Number} rail width in pixels (0 if no offset needed)
 */
function useRailOffset() {
  const { experimentalUiC, infoPanelCollapsed, desktopRadarMaximized } = useContext(AppContext);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  useEffect(() => {
    // Focus mode hides HeroBand + rail via display:none. Bail with
    // a zero offset so the marker pans to the geometric centre of
    // the now-empty viewport. The flag is also in the dep array so
    // toggling focus re-runs this effect (without it the offset
    // stayed at the last-measured value and the marker stayed
    // shifted as if the rail were still visible).
    if (!experimentalUiC || infoPanelCollapsed || desktopRadarMaximized) {
      setOffset({ x: 0, y: 0 });
      return undefined;
    }
    let cancelled = false;
    const measure = () => {
      if (cancelled) return;
      const rail = document.querySelector(".ambientRoot aside");
      const hero = document.querySelector(".ambientRoot [data-ambient-hero]");
      // `data-ambient-hero` is only set in LayoutDesktop, where the map
      // is full-bleed and BOTH the HeroBand (top) and the rail (right
      // edge) OVERLAY the map. On LayoutPi the map sits in its own
      // grid column with the rail in a separate column, so the visible
      // map area is already the full map — no shift needed at all.
      // Pre-v2.14.68 the horizontal offset was applied on every
      // layout, which pushed the marker to the far left on LayoutPi
      // (rail offset shifted the map centre right when the marker was
      // already in the clear). Gating BOTH axes on `hero` keeps the
      // overlay correction limited to LayoutDesktop where it belongs.
      const railOverlaysMap = !!hero;
      const x = (rail && railOverlaysMap) ? Math.round(rail.getBoundingClientRect().width) : 0;
      const y = hero ? Math.round(hero.getBoundingClientRect().height) : 0;
      setOffset({ x, y });
    };
    const handle = requestAnimationFrame(measure);
    // Re-measure on viewport size changes — LayoutDesktop bumps rail
    // width from 320 → 360 px above 1900 px wide via a media query,
    // and the HeroBand's height can shift if its content reflows.
    window.addEventListener("resize", measure);
    return () => {
      cancelled = true;
      cancelAnimationFrame(handle);
      window.removeEventListener("resize", measure);
    };
  }, [experimentalUiC, infoPanelCollapsed, desktopRadarMaximized]);
  return offset;
}

const PanHandler = ({ panToCoords, setPanToCoords, railOffset }) => {
  const map = useMap();
  useEffect(() => {
    if (panToCoords) {
      panWithRailOffset(map, [panToCoords.latitude, panToCoords.longitude], railOffset);
      setPanToCoords(null);
    }
  }, [panToCoords, map, setPanToCoords, railOffset]);
  return null;
};

PanHandler.propTypes = {
  panToCoords: PropTypes.object,
  setPanToCoords: PropTypes.func.isRequired,
  railOffset: PropTypes.shape({ x: PropTypes.number, y: PropTypes.number }),
};

/**
 * Re-centres the map whenever `railOffset` changes — collapsing or
 * expanding the rail, or switching layouts, would otherwise leave
 * the marker in the wrong visual position. Pulls the current marker
 * latLng from context and re-applies the offset trick. Skipped when
 * `markerPosition` isn't yet set (initial load before mapGeo lands).
 */
const RailOffsetTracker = ({ railOffset, markerPosition }) => {
  const map = useMap();
  const lastOffsetRef = useRef(railOffset);
  useEffect(() => {
    // useRailOffset returns a fresh object every render even when
    // values haven't changed, so compare by x/y rather than identity.
    // Skip the first run so the initial mount doesn't double-pan —
    // InitialOffsetCentering handles the boot case explicitly.
    const prev = lastOffsetRef.current;
    if (prev && prev.x === railOffset.x && prev.y === railOffset.y) return;
    lastOffsetRef.current = railOffset;
    if (!markerPosition) return;
    panWithRailOffset(map, markerPosition, railOffset, { animate: true });
  }, [railOffset, markerPosition, map]);
  return null;
};

RailOffsetTracker.propTypes = {
  railOffset: PropTypes.shape({ x: PropTypes.number, y: PropTypes.number }),
  markerPosition: PropTypes.array,
};

/**
 * Applies the rail offset on initial mount — MapContainer's `center`
 * prop is read once and never re-applied, so without this effect the
 * marker would stay at viewport-centre (behind the rail) until the
 * user clicks somewhere. Runs once when both map and marker are ready.
 */
const InitialOffsetCentering = ({ railOffset, markerPosition }) => {
  const map = useMap();
  const appliedRef = useRef(false);
  useEffect(() => {
    if (appliedRef.current) return;
    if (!markerPosition || !railOffset) return;
    if (!railOffset.x && !railOffset.y) return;
    appliedRef.current = true;
    panWithRailOffset(map, markerPosition, railOffset, { animate: false });
  }, [map, markerPosition, railOffset]);
  return null;
};

InitialOffsetCentering.propTypes = {
  railOffset: PropTypes.shape({ x: PropTypes.number, y: PropTypes.number }),
  markerPosition: PropTypes.array,
};

/**
 * Pushes the current Leaflet zoom up to AppContext on every zoomend event,
 * plus once on mount so the Debug panel doesn't read a stale fallback. The
 * Debug panel reads currentMapZoom from context instead of poking into the
 * Leaflet instance.
 *
 * @param {object} props
 * @param {Function} props.onZoomChange called with the new zoom on every change
 * @returns {null} renders nothing
 */
const MapZoomTracker = ({ onZoomChange }) => {
  const map = useMapEvents({
    zoomend: () => onZoomChange(map.getZoom()),
  });
  useEffect(() => {
    onZoomChange(map.getZoom());
  }, [map, onZoomChange]);
  return null;
};

MapZoomTracker.propTypes = {
  onZoomChange: PropTypes.func.isRequired,
};

/**
 * Live preview for the Settings → Default Map Zoom slider. When the user
 * moves the slider, AppContext sets zoomToLevel; this handler picks it up
 * and calls map.setZoom, then resets zoomToLevel to null. Without this,
 * the slider would only take effect on next page load — confusing UX.
 *
 * @param {object} props
 * @param {Number|null} props.zoomToLevel target zoom level, or null when idle
 * @param {Function} props.setZoomToLevel resets zoomToLevel to null
 * @returns {null} renders nothing
 */
const ZoomLevelHandler = ({ zoomToLevel, setZoomToLevel }) => {
  const map = useMap();
  useEffect(() => {
    if (zoomToLevel !== null && zoomToLevel !== undefined) {
      map.setZoom(zoomToLevel);
      setZoomToLevel(null);
    }
  }, [zoomToLevel, map, setZoomToLevel]);
  return null;
};

ZoomLevelHandler.propTypes = {
  zoomToLevel: PropTypes.number,
  setZoomToLevel: PropTypes.func.isRequired,
};

/**
 * Weather map
 *
 * @param {object} props
 * @param {Number} props.zoom zoom level
 * @param {Boolean} [props.dark] dark mode
 * @returns {JSX.Element} Weather map
 */
const WeatherMap = ({ zoom, dark }) => {
  const MAP_CLICK_DEBOUNCE_TIME = 200; //ms
  // `nightRed` is the long-wavelength sleep-stage-1 mode. Used here
  // to red-tint the dashed radar circles so they match the rest of
  // the UI when the night-red palette is active. WeatherMap is mounted
  // by both v2 and v3 layouts, so reading from useTimeOfDay keeps the
  // logic palette-aware without coupling to either layout.
  const nightRed = useTimeOfDay() === "nightRed";
  const { t } = useTranslation();
  // Pixel width of the v3 right rail when visible. Drives the
  // off-centre projection trick that keeps the marker at the visual
  // centre of the non-rail area; see panWithRailOffset for the math.
  // Returns 0 in v2 layouts, when the rail is collapsed, or in
  // (future) full-screen radar mode.
  const railOffset = useRailOffset();
  const {
    setMapPosition,
    panToCoords,
    setPanToCoords,
    browserGeo,
    mapGeo,
    mapTimezone,
    mapApiKey,
    getMapApiKey,
    markerIsVisible,
    animateWeatherMap,
    radarSpeed,
    radarTimelineVisible,
    radarSource,
    infoPanelCollapsed,
    mobileRadarMaximized,
    hideRadarLegend,
    aiSummaryAvailable,
    radarAnalysisEnabled,
    extendedRadarRadius,
    showSamplingPoints,
    lightModeStyle,
    darkModeStyle,
    radarOpacityLight,
    radarOpacityDark,
    distanceUnit,
    setCurrentMapZoom,
    zoomToLevel,
    setZoomToLevel,
    innerRisk,
    setInnerRisk,
    outerRisk,
    setOuterRisk,
    setInnerTrend,
    setOuterTrend,
    setInnerBumped,
    setOuterBumped,
    setInnerTrendConfidence,
    setOuterTrendConfidence,
    setInnerDirectionVectors,
    setOuterDirectionVectors,
    showDirectionArrows,
    innerDirectionVectors,
    outerDirectionVectors,
    desktopRadarMaximized,
    setDesktopRadarMaximized,
  } = useContext(AppContext);

  // Largest sample in each ring drives the circle radius. Multiplied by
  // METERS_PER_UNIT because Leaflet's Circle takes meters.
  const innerRadiusMeters =
    RADAR_GEOMETRY[distanceUnit].inner[RADAR_GEOMETRY[distanceUnit].inner.length - 1] *
    METERS_PER_UNIT[distanceUnit];
  const outerRadiusMeters =
    RADAR_GEOMETRY[distanceUnit].outer[RADAR_GEOMETRY[distanceUnit].outer.length - 1] *
    METERS_PER_UNIT[distanceUnit];

  const handleMapClick = useCallback((e) => {
    const { lat: latitude, lng: longitude } = e.latlng;
    const newCoords = { latitude, longitude };
    setMapPosition(newCoords);
  }, [setMapPosition]);

  const mapClickHandler = useMemo(
    () => debounce(handleMapClick, MAP_CLICK_DEBOUNCE_TIME),
    [handleMapClick]
  );

  const [mapTimestamps, setMapTimestamps] = useState(null);
  const [mapTimestamp, setMapTimestamp] = useState(null);
  // Current playback position in the timeline. -1 = "use the most recent
  // past frame" (initial mount). Kept as local state — earlier we tried
  // hoisting it to AppContext for theoretical centralisation, but every
  // animation tick (1× per second at 1× speed) then re-rendered all of
  // AppContext's ~50 consumers, which queued button-click handlers
  // behind a flood of re-renders and made the play/pause button take
  // 1-2 s to react. RadarTimeline is rendered by us and receives the
  // index via props, so context buys nothing.
  const [radarFrameIdx, setRadarFrameIdx] = useState(-1);
  const animationIntervalRef = useRef(null);

  // Small-screen detection used to auto-hide the radar legend while
  // the radar timeline is open. On the 7" Pi kiosk (height ≤ 520 px,
  // panel deployed) the timeline's right edge ends up sliding under
  // the legend's bottom-right block — the legend has higher z-index
  // (1000 vs 500) so it visually masks the rightmost portion of the
  // scrubber. Both elements are pinned to `bottom: 24px`, so there's
  // no clean way to keep them side by side at this width. Same media
  // query (max-height: 520px) used in App / WeatherInfo / styles.css
  // for other small-screen behaviour.
  const SMALL_SCREEN_MQ = "(max-height: 520px)";
  const [isSmallScreen, setIsSmallScreen] = useState(
    () => typeof window !== "undefined" && window.matchMedia(SMALL_SCREEN_MQ).matches
  );
  useEffect(() => {
    const mq = window.matchMedia(SMALL_SCREEN_MQ);
    const handler = (e) => setIsSmallScreen(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Risk levels for the dashed circles live in AppContext (see InfoPanel's
  // AlertBanner, which reads the same state to surface the alert text). We
  // only keep the polling logic here because it's gated by the same
  // conditions as the circles themselves.
  // Per-point intensities for colouring sampling-point dots stay local —
  // only the renderer below cares about them. Map keyed by `${dir}:${dist}`
  // so the dot lookup is O(1) regardless of how many points are visible.
  const [riskSamples, setRiskSamples] = useState(() => new Map());
  const riskIntervalRef = useRef(null);

  const MAP_TIMESTAMP_REFRESH_FREQUENCY = 1000 * 60 * 10; //update every 10 minutes
  const MAP_CYCLE_RATE = 1000; //ms
  const RISK_REFRESH_INTERVAL = 5 * 60 * 1000; // RainViewer cycles every 10 min; 5 min keeps us close to fresh

  const getMapApiKeyCallback = useCallback(() => getMapApiKey(), [
    getMapApiKey,
  ]);

  useEffect(() => {
    getMapApiKeyCallback().catch((err) => {
      console.log("err!", err);
    });

    const updateTimeStamps = () => {
      getMapTimestamps()
        .then((res) => {
          setMapTimestamps(res);
        })
        .catch((err) => {
          console.log("err", err);
        });
    };

    const mapTimestampsInterval = setInterval(
      updateTimeStamps,
      MAP_TIMESTAMP_REFRESH_FREQUENCY
    );
    updateTimeStamps(); //initial update
    return () => {
      clearInterval(mapTimestampsInterval);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- initialization, runs once on mount

  const { latitude, longitude } = browserGeo || {};

  // Resolve the radarFrameIdx (which may be -1 = "default to latest past
  // frame") into a concrete index of the loaded `mapTimestamps` array.
  // Centralised so both the tile renderer and the animation effect read
  // the same value. The "latest past frame" default is the index of the
  // last `kind: "past"` entry — putting playhead there means the user
  // initially sees current radar (not the first past frame, which is 90
  // minutes old).
  const lastPastIdx = useMemo(() => {
    if (!mapTimestamps || mapTimestamps.length === 0) return 0;
    let idx = -1;
    mapTimestamps.forEach((f, i) => { if (f.kind === "past") idx = i; });
    return idx >= 0 ? idx : mapTimestamps.length - 1;
  }, [mapTimestamps]);
  const currentMapTimestampIdx = useMemo(() => {
    if (!mapTimestamps || mapTimestamps.length === 0) return 0;
    if (radarFrameIdx < 0 || radarFrameIdx >= mapTimestamps.length) return lastPastIdx;
    return radarFrameIdx;
  }, [radarFrameIdx, mapTimestamps, lastPastIdx]);

  // Keep the displayed timestamp in sync with the current index
  useEffect(() => {
    if (mapTimestamps) {
      setMapTimestamp(mapTimestamps[currentMapTimestampIdx]);
    }
  }, [currentMapTimestampIdx, mapTimestamps]);

  // Poll /api/radar-risk every 5 min (and on mapGeo / config changes) to
  // colour the dashed circles by intensity. Gated by the same conditions
  // as the circles themselves — fetching when the rings aren't visible
  // would be wasted work.
  // The risk fetch is intentionally NOT gated on aiSummaryAvailable. The
  // /api/radar-risk endpoint is purely deterministic — RainViewer tile
  // sampling + tier classification, no LLM call — so the AlertBanner and
  // dashed circles it feeds are useful even without an Anthropic key. The
  // AI summary's third paragraph is the only Claude-dependent surface,
  // and that's gated server-side in aiSummaryCtrl.js.
  const riskFetchEnabled = radarAnalysisEnabled && Boolean(mapGeo);
  useEffect(() => {
    if (!riskFetchEnabled) {
      setInnerRisk(null);
      setOuterRisk(null);
      setInnerTrend("stable");
      setOuterTrend("stable");
      setInnerBumped(false);
      setOuterBumped(false);
      setInnerTrendConfidence(0);
      setOuterTrendConfidence(0);
      setInnerDirectionVectors([]);
      setOuterDirectionVectors([]);
      setRiskSamples(new Map());
      return undefined;
    }
    const fetchRisk = () => {
      const params = new URLSearchParams({
        lat: mapGeo.latitude,
        lon: mapGeo.longitude,
        distanceUnit,
      });
      axios
        .get(`/api/radar-risk?${params}`)
        .then((res) => {
          setInnerRisk(res.data?.inner?.level || "calm");
          setOuterRisk(res.data?.outer?.level || null);
          setInnerTrend(res.data?.inner?.trend || "stable");
          setOuterTrend(res.data?.outer?.trend || "stable");
          setInnerBumped(Boolean(res.data?.inner?.bumped));
          setOuterBumped(Boolean(res.data?.outer?.bumped));
          setInnerTrendConfidence(Number(res.data?.inner?.trendConfidence) || 0);
          setOuterTrendConfidence(Number(res.data?.outer?.trendConfidence) || 0);
          setInnerDirectionVectors(Array.isArray(res.data?.inner?.directionVectors) ? res.data.inner.directionVectors : []);
          setOuterDirectionVectors(Array.isArray(res.data?.outer?.directionVectors) ? res.data.outer.directionVectors : []);
          // Build the lookup map from inner + outer samples. Same
          // direction:distance keying as buildSamplingPoints, so the
          // renderer can colour each dot in O(1).
          const map = new Map();
          for (const s of res.data?.inner?.samples || []) {
            map.set(`${s.direction}:${s.distance}`, s.intensity);
          }
          for (const s of res.data?.outer?.samples || []) {
            map.set(`${s.direction}:${s.distance}`, s.intensity);
          }
          setRiskSamples(map);
        })
        .catch(() => {
          // Non-fatal — leave the previous colour in place. The endpoint
          // returns 503 when RainViewer is unreachable; clearing here would
          // make the ring flash neutral on every transient failure.
        });
    };
    fetchRisk();
    riskIntervalRef.current = setInterval(fetchRisk, RISK_REFRESH_INTERVAL);
    return () => {
      clearInterval(riskIntervalRef.current);
      riskIntervalRef.current = null;
    };
  }, [riskFetchEnabled, mapGeo, distanceUnit, RISK_REFRESH_INTERVAL, setInnerRisk, setOuterRisk, setInnerTrend, setOuterTrend, setInnerBumped, setOuterBumped]);

  // Radar animation: start/stop interval based on animateWeatherMap toggle.
  // Per-frame interval is MAP_CYCLE_RATE / radarSpeed so 1× / 2× / 4× cycling
  // from the timeline's speed selector takes effect immediately. Using a ref
  // for the interval avoids recreating it on every frame tick.
  useEffect(() => {
    if (animationIntervalRef.current) {
      clearInterval(animationIntervalRef.current);
      animationIntervalRef.current = null;
    }

    if (mapTimestamps && animateWeatherMap) {
      animationIntervalRef.current = setInterval(() => {
        setRadarFrameIdx((prev) => {
          // Advance from the resolved current index — which collapses
          // -1 (uninitialised) and out-of-range values into a valid one
          // — so a fresh play after a scrub or a frame-list reload
          // always picks up at the right position.
          const start = prev < 0 || prev >= mapTimestamps.length ? lastPastIdx : prev;
          return start + 1 >= mapTimestamps.length ? 0 : start + 1;
        });
      }, MAP_CYCLE_RATE / radarSpeed);
    }

    return () => {
      if (animationIntervalRef.current) {
        clearInterval(animationIntervalRef.current);
        animationIntervalRef.current = null;
      }
    };
    // radarFrameIdx is intentionally NOT in the deps — the function
    // updater inside setInterval reads the latest value via React's
    // closure over `prev`, so we don't need to recreate the interval
    // on every frame tick. Including it would clear and re-create the
    // interval every second, which previously starved button clicks.
  }, [animateWeatherMap, mapTimestamps, radarSpeed, lastPastIdx]);

  // Initial mount: anchor the playhead at the most recent past frame
  // once the timestamps load, so the first paint shows current radar
  // (not the 90-min-old first historical frame). One-shot — once the
  // user scrubs or starts animation, radarFrameIdx is no longer < 0.
  useEffect(() => {
    if (mapTimestamps && radarFrameIdx < 0) {
      setRadarFrameIdx(lastPastIdx);
    }
  }, [mapTimestamps, lastPastIdx, radarFrameIdx]);

  // When the timeline overlay is hidden, snap the playhead back to the
  // most recent past frame so the user is never left looking at a stale
  // historical frame or a forecast frame they had been scrubbing
  // through. The toggleRadarTimelineVisible callback in AppContext also
  // pauses any running animation, so the combination is "hide the bar
  // and show me current radar."
  useEffect(() => {
    if (!radarTimelineVisible && mapTimestamps) {
      setRadarFrameIdx(lastPastIdx);
    }
  }, [radarTimelineVisible, mapTimestamps, lastPastIdx]);

  if (!hasVal(latitude) || !hasVal(longitude) || !zoom || !mapApiKey) {
    return (
      <div className={`${styles.noMap} ${dark ? styles.dark : styles.light}`}>
        <div>Cannot retrieve map data.</div>
        <div>Did you enter an API key?</div>
      </div>
    );
  }
  const markerPosition = mapGeo ? [mapGeo.latitude, mapGeo.longitude] : null;

  return (
    <div className={styles.mapWrapper}>
      <MapContainer
        center={[latitude, longitude]}
        zoom={zoom}
        /* Capped at 16 (was 20) so the map peaks at "city block /
         * street" detail rather than indoor / building zoom — which
         * Mapbox raster doesn't have meaningful detail for anyway,
         * and which made Safari iPad freeze under the cumulative
         * memory pressure of tile cache + CSS transforms.
         *
         * User-reported (May 2026, brother + M4 iPad Pro): zooming
         * progressively from z=9 (50 km circle visible) to z=17
         * showed a step-function degradation — slight slowdown at
         * z=11, 1 s response delay at z=13, 5-7 s at z=15, frozen
         * white-screen at z=17. The radar TileLayer has a tighter
         * cap (12) — see below — and the basemap below adds
         * `updateWhenIdle` + a tighter keepBuffer to throttle
         * Safari's continuous-redraw behaviour. */
        maxZoom={16}
        style={{ width: "100%", height: "100%" }}
        attributionControl={false}
        touchZoom={true}
        dragging={true}
        fadeAnimation={false}
      >
        <MapClickHandler onClick={mapClickHandler} />
        <PanHandler panToCoords={panToCoords} setPanToCoords={setPanToCoords} railOffset={railOffset} />
        <InitialOffsetCentering railOffset={railOffset} markerPosition={markerPosition} />
        <RailOffsetTracker railOffset={railOffset} markerPosition={markerPosition} />
        <MapZoomTracker onZoomChange={setCurrentMapZoom} />
        <ZoomLevelHandler zoomToLevel={zoomToLevel} setZoomToLevel={setZoomToLevel} />
        <MapResizer
          infoPanelCollapsed={infoPanelCollapsed}
          mobileRadarMaximized={mobileRadarMaximized}
          desktopRadarMaximized={desktopRadarMaximized}
          latitude={latitude}
          longitude={longitude}
          zoom={zoom}
        />
        {/* Focus / unfocus the radar — Leaflet control rendered only
         * when LayoutDesktop is active (sentinel !== null). Sits in
         * the topleft Leaflet bar alongside zoom +/− and the
         * direction-arrow toggle. Tapping it hides HeroBand + rail
         * so the radar fills the entire viewport. The dock stays
         * uncluttered. */}
        {desktopRadarMaximized !== null && desktopRadarMaximized !== undefined && (
          <RadarFocusControl
            active={desktopRadarMaximized}
            onToggle={() => setDesktopRadarMaximized(!desktopRadarMaximized)}
            titleOn={t("controls.restorePanels", { defaultValue: "Restore panels" })}
            titleOff={t("controls.focusRadar", { defaultValue: "Focus radar" })}
          />
        )}
        {/* ArrowToggleControl lived here pre-2.14.15 as an imperative
         * Leaflet control at the topleft. Moved to BottomDock so the
         * top-left of the map stays uncluttered (and the dock has
         * plenty of room for related radar toggles now that v3 gives
         * it a dedicated slab). See ControlButtons for the new entry,
         * gated on the same `radarAnalysisEnabled` flag. */}
        {/* v2.14.66: the Ukrainian flag (added by Leaflet v1.9.3 as a
         * humanitarian gesture) stays visible in every palette except
         * nightRed — its yellow stripe disrupts the dark-red basemap.
         * Earlier (v2.14.65) we toggled the `prefix` prop with a
         * `key`, which forced a remount and duplicated the tile-
         * layer attribution strings on every palette switch. Replaced
         * the React-side toggle with a pure CSS rule that hides
         * `.leaflet-attribution-flag` only when `data-palette` on
         * `.ambientRoot` resolves to `nightRed`. See ui/reset.css.
         * No remount, no duplicated attributions. */}
        <AttributionControl position="bottomleft" />
        <TileLayer
          attribution={MAPBOX_ATTRIBUTION}
          url={`/api/tiles/${dark ? darkModeStyle : lightModeStyle}/{z}/{x}/{y}`}
          tileSize={512}
          zoomOffset={-1}
          maxZoom={16}
          /* `keepBuffer: 2` (Leaflet default, was 4 in v2.15.4) —
           * the wider buffer made zoom-out seamless on desktop but
           * doubled the resident tile count, which combined with
           * the 512px @2x tiles to balloon Safari iPad's tile-cache
           * memory at high zoom (the freeze trigger in May 2026
           * reports). 2 trades a brief white flash on rapid zoom-
           * out for ~half the memory footprint — acceptable since
           * the Mapbox tile proxy caches server-side and re-fetches
           * are essentially free. */
          keepBuffer={2}
          /* `updateWhenIdle: true` defers tile re-rendering until
           * the user finishes panning / zooming. Safari iOS's
           * default redraw-on-every-move was the dominant cost
           * during a sustained pan at z=14+: every touchmove
           * fired tile checks, transforms, and decode. Idle-mode
           * defers all that until the gesture ends. Lower CPU
           * on Pi kiosk too. */
          updateWhenIdle={true}
        />
        {radarSource === "eccc" ? (
          // Environment Canada radar (RADAR_1KM_RRAI = rain precipitation rate
          // at 1 km, NA composite). 6-min update cadence vs RainViewer's ~10
          // min, dedicated authority for the Canadian fleet. No time-dimension
          // here — Phase A surfaces only the current frame; the timeline
          // scrubber and animation are hidden when this source is active.
          // Attribution per ECCC terms of use: "Canadian radar data was
          // provided courtesy of Environment Canada".
          <WMSTileLayer
            attribution='Radar courtesy <a href="https://www.canada.ca/en/environment-climate-change.html">Environment Canada</a>'
            url="https://geo.weather.gc.ca/geomet"
            params={{
              layers: "RADAR_1KM_RRAI",
              format: "image/png",
              transparent: true,
              version: "1.3.0",
            }}
            opacity={dark ? radarOpacityDark : radarOpacityLight}
            /* Radar has no useful resolution beyond z=12 (~1 km
             * per pixel native). Capping here also stops Safari
             * from upscaling the WMS PNG response via CSS transform
             * past ~z=15, which is the iPad freeze trigger. The
             * basemap keeps zooming up to z=18; only radar disappears. */
            maxZoom={12}
          />
        ) : mapTimestamp ? (
          <TileLayer
            attribution='<a href="https://www.rainviewer.com/">RainViewer</a>'
            url={`https://tilecache.rainviewer.com${mapTimestamp.path}/512/{z}/{x}/{y}/6/1_1.png`}
            opacity={dark ? radarOpacityDark : radarOpacityLight}
            tileSize={512}
            zoomOffset={-1}
            maxNativeZoom={8}
            /* Radar tiles disappear at z=13+. RainViewer's native
             * zoom maxes at 8; the previous config inherited the
             * map's maxZoom (20), so Leaflet upscaled z=8 tiles by
             * up to 4096× via CSS transform — which crashed Safari
             * iPad Pro M4 and earlier on extended street-level
             * zoom. Capping at 12 keeps the radar useful (still
             * showing 1 km resolution at city blocks) without the
             * extreme upscale that iOS's tile compositor can't
             * keep up with. The basemap below keeps zooming up to
             * 18; only the radar overlay disappears past z=12. */
            maxZoom={12}
            /* `updateWhenIdle: true` defers tile re-rendering until
             * the user finishes panning / zooming — easier on
             * Safari iOS's GPU than the default continuous redraw
             * on every move event. Side benefit: lower CPU on the
             * Pi kiosk too. */
            updateWhenIdle={true}
            /* keepBuffer matched to the basemap (2, default) so the
             * cache footprint stays bounded. */
            keepBuffer={2}
          />
        ) : null}
        {markerIsVisible && markerPosition ? (
          /* v2.14.65: custom target icon only in nightRed mode. In every
           * other palette the default Leaflet blue teardrop pin stays —
           * it's a familiar map idiom and reads cleanly on the day /
           * dusk / night basemaps. nightRed is the one palette where
           * a bright blue clashes hard with the deep-red background,
           * so we swap to the palette-aware target marker there. The
           * `key` forces the marker DOM to be recreated when nightRed
           * flips so Leaflet picks up the new icon. */
          nightRed ? (
            <Marker
              key="target"
              position={markerPosition}
              icon={LOCATION_MARKER_ICON}
              opacity={1}
            />
          ) : (
            <Marker
              key="default"
              position={markerPosition}
              opacity={0.65}
            />
          )
        ) : null}
        {/* Radar-analysis overlays — only visible when the AI summary feature
            is configured AND the radar analysis is enabled in advanced
            settings. Inner circle marks the default analysis zone (50 km or
            30 mi depending on distanceUnit); when extendedRadius is on, a
            second outer circle (100 km or 60 mi) joins it with the same
            dashed style. Sampling-point dots opt-in via a separate toggle
            so curious users can see exactly what the analyzer reads. Inner
            ring is always 16 directions × 10 distances; outer ring is 32
            directions × 10 distances when extendedRadius is on. */}
        {radarAnalysisEnabled && markerPosition ? (
          <RiskRing center={markerPosition} radius={innerRadiusMeters} risk={innerRisk} dark={dark} aiOff={!aiSummaryAvailable} nightRed={nightRed} />
        ) : null}
        {radarAnalysisEnabled && markerPosition && extendedRadarRadius ? (
          <RiskRing center={markerPosition} radius={outerRadiusMeters} risk={outerRisk} dark={dark} aiOff={!aiSummaryAvailable} nightRed={nightRed} />
        ) : null}
        {radarAnalysisEnabled && markerPosition && showSamplingPoints
          ? buildSamplingPoints(markerPosition, extendedRadarRadius, distanceUnit).map(
              ({ position, key }, idx) => {
                // Each dot picks its colour from the sample's own intensity.
                // Clear (intensity 0 or unknown) keeps the neutral default
                // — same colour the dots had before this change. Coloured
                // tiers reuse RING_RISK_STYLE so the dots and the dashed
                // circle they belong to speak the same visual language.
                const intensity = riskSamples.get(key);
                const tier = tierForIntensity(intensity);
                const fillColor = tier
                  ? DOT_COLOR_BY_TIER[dark ? "dark" : "light"][tier]
                  : (dark ? "#f6f6f4" : "#3a3938");
                // Light-mode dots get a slightly larger radius and a solid
                // fill — the cream basemap eats thin strokes and low-opacity
                // fills. For coloured tiers in light mode, also wrap a
                // darker outline around the fill so an orange dot sitting on
                // an orange radar tile (same hue!) still reads as a marker
                // and not as part of the underlying band. Dark mode keeps
                // the original subtler look — the dark basemap provides
                // enough contrast that no separate outline is needed.
                const outlineNeeded = !dark && tier;
                return (
                  <CircleMarker
                    key={`sp-${idx}`}
                    center={position}
                    radius={dark ? 3 : 4}
                    pathOptions={{
                      color: outlineNeeded ? "#3a3938" : fillColor,
                      fillColor,
                      weight: outlineNeeded ? 1.5 : 1,
                      opacity: 0.85,
                      fillOpacity: dark ? 0.5 : 1,
                    }}
                  />
                );
              }
            )
          : null}
        {radarAnalysisEnabled && markerPosition && showDirectionArrows
          ? [
              ...innerDirectionVectors.map((v) => ({ ...v, _ring: "inner" })),
              ...outerDirectionVectors.map((v) => ({ ...v, _ring: "outer" })),
            ].map((v, idx) => {
              const bearingMap = v._ring === "inner" ? DIR_INNER_TO_BEARING : DIR_OUTER_TO_BEARING;
              const bearing = bearingMap[v.direction];
              if (bearing == null) return null;
              const path = buildArrowPath(
                markerPosition, bearing, v.peakDistance, v.magnitude, v.trend,
                KM_PER_UNIT[distanceUnit],
              );
              const baseColor = (ARROW_COLOR[v.trend] || ARROW_COLOR.approaching)[dark ? "dark" : "light"];
              // Opacity reflects confidence — the user sees at a glance which
              // arrows are well-supported by the data and which are tentative.
              // Floor at 0.25 so even low-confidence arrows stay visible
              // (they're already filtered to non-stable directions, so we
              // want to surface them; we just want them visually "softer").
              const opacity = Math.max(0.25, Math.min(1, (v.confidence || 0) / 100));
              // Stroke weight scales gently with peak intensity so heavier
              // bands read as thicker arrows. Cap at 4 px to avoid clutter.
              const weight = Math.min(4, 1.5 + (v.peakIntensity || 0) * 0.4);
              return (
                <Polyline
                  key={`arrow-${v._ring}-${v.direction}-${idx}`}
                  positions={path}
                  pathOptions={{
                    color: baseColor,
                    weight,
                    opacity,
                    lineCap: "round",
                    lineJoin: "round",
                  }}
                />
              );
            })
          : null}
      </MapContainer>
      {/* Legend + timeline are RainViewer-specific (the legend's colour
          scale matches RainViewer's intensity-encoded palette, and the
          timeline drives RainViewer's frame URLs). Hidden entirely when
          radarSource is ECCC — Phase A doesn't bring scrubbing across. */}
      {mapTimestamps && radarSource === "rainviewer" && !hideRadarLegend && !(radarTimelineVisible && isSmallScreen) && <RadarLegend dark={dark} />}
      {mapTimestamps && radarSource === "rainviewer" && radarTimelineVisible && (
        <RadarTimeline
          frames={mapTimestamps}
          currentIdx={currentMapTimestampIdx}
          onScrub={setRadarFrameIdx}
          timezone={mapTimezone}
          dark={dark}
        />
      )}
    </div>
  );
};

WeatherMap.propTypes = {
  zoom: PropTypes.number.isRequired,
  dark: PropTypes.bool,
};

/**
 * Weather layer — OpenWeatherMap tile overlay. Inert in the current
 * deployment (the project moved to RainViewer + Tomorrow.io for radar
 * and conditions); kept around for the eventual return-to-OWM path
 * tracked in the OpenWeatherMap variant of CurrentWeather.
 *
 * @param {object} props
 * @param {String} props.layer One of OpenWeatherMap's tile layer names — `precipitation_new`, `clouds_new`, `temp_new`, etc.
 * @param {String} props.weatherApiKey OpenWeatherMap API key, appended to the tile URL as the `appid` query parameter.
 * @returns {JSX.Element} Weather layer
 */
const WeatherLayer = ({ layer, weatherApiKey }) => {
  return (
    <TileLayer
      attribution='&amp;copy <a href="https://openweathermap.org/">OpenWeather</a>'
      url={`https://tile.openweathermap.org/map/${layer}/{z}/{x}/{y}.png?appid=${weatherApiKey}`}
      apiKey
    />
  );
};

WeatherLayer.propTypes = {
  layer: PropTypes.string.isRequired,
  weatherApiKey: PropTypes.string,
};

/**
 * Determines if truthy, but returns true for 0
 *
 * @param {*} i
 * @returns {Boolean} If truthy or zero
 */
function hasVal(i) {
  return !!(i || i === 0);
}

/**
 * Fetches the RainViewer frame index and returns past + nowcast frames as
 * a single time-ordered array, with each frame tagged `kind: "past" | "nowcast"`.
 * The nowcast frames (3 entries, every 10 min into the future) are RainViewer's
 * short-range precipitation forecast — surfacing them in the timeline lets the
 * user scrub past the present moment to see what's expected to drift in next.
 *
 * @returns {Promise<Array<{time: number, path: string, kind: "past"|"nowcast"}>>} Combined past + nowcast frames in time order.
 */
function getMapTimestamps() {
  return new Promise((resolve, reject) => {
    axios
      .get("https://api.rainviewer.com/public/weather-maps.json")
      .then((res) => {
        const past = (res.data?.radar?.past ?? []).map((f) => ({ ...f, kind: "past" }));
        const nowcast = (res.data?.radar?.nowcast ?? []).map((f) => ({ ...f, kind: "nowcast" }));
        resolve([...past, ...nowcast]);
      })
      .catch((err) => {
        reject(err);
      });
  });
}

export default WeatherMap;
