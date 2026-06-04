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
  CircleMarker,
  Polyline,
  GeoJSON,
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
import useEligibleGovAlerts from "~/hooks/useEligibleGovAlerts";
import { useTimeOfDay } from "~/ui/hybrid";
import { useTranslation } from "react-i18next";
import debounce from "debounce";
import axios from "axios";
import styles from "./styles.css";
import RadarLegend from "./RadarLegend";
import RadarTimeline from "./RadarTimeline";
import RiskRing from "./RiskRing";
import MapResizer from "./MapResizer";
import RadarFocusControl from "./RadarFocusControl";
import {
  hasVal,
  tierForIntensity,
  buildArrowPath,
  buildSamplingPoints,
  panWithRailOffset,
  KM_PER_UNIT,
  METERS_PER_UNIT,
  RADAR_GEOMETRY,
  DIR_INNER_TO_BEARING,
  DIR_OUTER_TO_BEARING,
  ARROW_COLOR,
  DOT_COLOR_BY_TIER,
} from "./geometry";


/* Zoom threshold above which the analysis-zone dashed circles AND
 * the sampling-point dots stop rendering. At z=13 the inner 50 km
 * circle has a pixel radius of ~3700 px (≈ 2.7× the iPad viewport
 * width) so most of it is already off-screen; by z=14 it's ~7460 px
 * (entirely off-screen). Beyond that the SVG element is dead
 * weight in the DOM — invisible but still maintained by the
 * renderer, contributing to the pan-jank observed on macOS Firefox
 * and Safari iPad at high zoom. Hiding them frees the SVG layer
 * and restores smooth panning. */
const RING_HIDE_ZOOM = 13;

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




// Mapbox basemaps served via the server proxy (keeps the API key off the client).
const MAPBOX_ATTRIBUTION = '© <a href="https://www.mapbox.com/feedback/">Mapbox</a>';


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
 * Pans the map when panToCoords changes
 *
 * @param {object} props
 * @param {object} props.panToCoords target coordinates
 * @param {Function} props.setPanToCoords resets panToCoords to null
 * @returns {null} renders nothing
 */

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
  const { experimentalUiC, infoPanelCollapsed, desktopRadarMaximized, piRadarMaximized } = useContext(AppContext);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  useEffect(() => {
    // Focus mode hides HeroBand + rail via display:none. Bail with
    // a zero offset so the marker pans to the geometric centre of
    // the now-empty viewport. The flag is also in the dep array so
    // toggling focus re-runs this effect (without it the offset
    // stayed at the last-measured value and the marker stayed
    // shifted as if the rail were still visible).
    if (!experimentalUiC || infoPanelCollapsed || desktopRadarMaximized || piRadarMaximized) {
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
  }, [experimentalUiC, infoPanelCollapsed, desktopRadarMaximized, piRadarMaximized]);
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
 * Phase 4d (2026-05-28): GeoJSON overlay for the alert zone the user
 * picked via the AlertBanner's "Voir sur la carte" button. Renders a
 * tier-coloured polygon (red / orange / yellow) and zoom-to-fits when
 * `highlightedAlertId` changes. Clears entirely when the id is null
 * or when no matching alert with geometry is found.
 *
 * The fitBounds runs INSIDE the `MapContainer` context — that's why
 * this is a child component using `useMap` rather than a prop on
 * the parent. The `key` on the `<GeoJSON>` element is the alert id so
 * Leaflet re-creates the layer when the user switches between alerts
 * (Leaflet's internal cache wouldn't re-render the path on a plain
 * data prop change).
 *
 * @param {object} props
 * @param {?string} props.highlightedAlertId — id of the alert whose
 *   polygon is currently shown; null = no overlay
 * @param {Array} props.govAlerts — list of active alerts
 * @returns {JSX.Element|null}
 */
const AlertGeometryOverlay = ({ highlightedAlertId, govAlerts }) => {
  const map = useMap();
  // Find the matching alert. Memo because govAlerts changes on every
  // poll cycle but we only care about the active highlight.
  const alert = useMemo(() => {
    if (!highlightedAlertId || !Array.isArray(govAlerts)) return null;
    return govAlerts.find((a) => a && a.id === highlightedAlertId && a.geometry) || null;
  }, [govAlerts, highlightedAlertId]);
  // Tier → colour mapping. Aligned with the SeverityChip palette and
  // the AlertBanner tier styling so the overlay visually agrees with
  // the banner the user just tapped. `red` for warning-grade alerts
  // (severe / extreme), `orange` for watch-grade (moderate),
  // `yellow` for advisory (minor). Falls back to a neutral grey if
  // the tier value is unexpected.
  const colour = useMemo(() => {
    if (!alert) return null;
    if (alert.tier === "red") return "#e60000";
    if (alert.tier === "orange") return "#ee7710";
    if (alert.tier === "yellow") return "#f0c000";
    return "#888";
  }, [alert]);
  // GeoJSON style — 2 px border + 15 % fill so the polygon reads
  // clearly against the radar tiles without obscuring them.
  const style = useMemo(() => (colour ? {
    color: colour,
    weight: 2,
    fillColor: colour,
    fillOpacity: 0.15,
    // `dashArray: null` keeps the border solid — distinct from the
    // dashed radar circles, which use 6/4 dash arrays. The user
    // should be able to tell at a glance "this is a real alert
    // boundary, not a derived radar ring".
    dashArray: null,
  } : null), [colour]);
  // fitBounds when the alert (or its geometry) changes. Generous
  // padding via `padding: [40, 40]` so the polygon doesn't sit
  // edge-to-edge against the map viewport — gives the user context
  // (surrounding towns, radar tiles outside the zone). `maxZoom: 11`
  // prevents an over-zoom on tiny polygons (a single-county polygon
  // would otherwise pin to z 13-14, losing the radar context).
  useEffect(() => {
    if (!alert || !alert.geometry || !map) return;
    try {
      const tmp = L.geoJSON(alert.geometry);
      const bounds = tmp.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 11 });
      }
    } catch {
      // GeoJSON parsing failed — silently skip the fitBounds. The
      // <GeoJSON> render below will also bail out gracefully if
      // Leaflet can't parse the geometry.
    }
  }, [alert, map]);
  if (!alert || !style) return null;
  return (
    <GeoJSON
      key={alert.id}
      data={alert.geometry}
      style={() => style}
    />
  );
};

AlertGeometryOverlay.propTypes = {
  highlightedAlertId: PropTypes.string,
  // eslint-disable-next-line react/forbid-prop-types -- alert objects are payload-shaped, not statically typed
  govAlerts: PropTypes.array,
};

AlertGeometryOverlay.defaultProps = {
  highlightedAlertId: null,
  govAlerts: [],
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
    currentMapZoom,
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
    piRadarMaximized,
    setPiRadarMaximized,
    // Phase 4d (2026-05-28): id of the alert whose `geometry` is
    // overlaid on the map + the full govAlerts list for the lookup.
    // Consumed by the `<AlertGeometryOverlay>` child inside the
    // MapContainer below.
    highlightedAlertId,
    setHighlightedAlertId,
    govAlerts,
  } = useContext(AppContext);

  // Clear the map-zone highlight when the alert it points at is no
  // longer displayable — turned off via the "Show advisory alerts"
  // opt-in, dismissed, or expired off the feed. Without this the
  // polygon strands on the map with no way to remove it: the only
  // "Hide zone" control lives in the alert detail, which is gone once
  // the alert stops showing. AlertDetailInline's own clear-on-collapse/
  // unmount cleanup (commit 8bf5cc6) misses this case because the
  // detail renders null internally instead of unmounting. Matching the
  // *eligible* set (not raw govAlerts) also covers dismissal + expiry
  // in one place.
  const { eligibleGovAlerts } = useEligibleGovAlerts();
  useEffect(() => {
    if (highlightedAlertId && !eligibleGovAlerts.some((a) => a.id === highlightedAlertId)) {
      setHighlightedAlertId(null);
    }
  }, [highlightedAlertId, eligibleGovAlerts, setHighlightedAlertId]);

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
          piRadarMaximized={piRadarMaximized}
          latitude={latitude}
          longitude={longitude}
          zoom={zoom}
        />
        {/* Focus / unfocus the radar — Leaflet control rendered when
         * LayoutDesktop OR LayoutPi is the active layout (one of the
         * two sentinels is non-null). Sits in the topleft Leaflet bar
         * alongside zoom +/− and the direction-arrow toggle. Tapping
         * it hides HeroBand + rail so the radar fills the entire
         * viewport. The dock stays uncluttered. The 2026-05-28 v3.1
         * consolidation extended this control from Desktop-only to
         * Desktop + Pi, replacing the legacy chevron rail-collapse
         * toggle that used to live on the right edge of the map on
         * both layouts. The same Leaflet control now serves both
         * layouts; we route the toggle to whichever sentinel is
         * active (mutually exclusive — only one layout is mounted
         * at a time). */}
        {((desktopRadarMaximized !== null && desktopRadarMaximized !== undefined)
          || (piRadarMaximized !== null && piRadarMaximized !== undefined)) && (
          <RadarFocusControl
            active={Boolean(piRadarMaximized != null ? piRadarMaximized : desktopRadarMaximized)}
            onToggle={() => {
              if (piRadarMaximized != null) {
                setPiRadarMaximized(!piRadarMaximized);
              } else {
                setDesktopRadarMaximized(!desktopRadarMaximized);
              }
            }}
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
        {radarAnalysisEnabled && markerPosition && currentMapZoom < RING_HIDE_ZOOM ? (
          <RiskRing center={markerPosition} radius={innerRadiusMeters} risk={innerRisk} dark={dark} aiOff={!aiSummaryAvailable} nightRed={nightRed} />
        ) : null}
        {radarAnalysisEnabled && markerPosition && extendedRadarRadius && currentMapZoom < RING_HIDE_ZOOM ? (
          <RiskRing center={markerPosition} radius={outerRadiusMeters} risk={outerRisk} dark={dark} aiOff={!aiSummaryAvailable} nightRed={nightRed} />
        ) : null}
        {radarAnalysisEnabled && markerPosition && showSamplingPoints && currentMapZoom < RING_HIDE_ZOOM
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
        {/* Phase 4d (2026-05-28): polygon overlay of the alert zone
          * the user picked via the AlertBanner "Voir sur la carte"
          * button. Renders nothing when highlightedAlertId is null
          * or the matching alert has no geometry. The component
          * fitBounds-zooms on mount via useMap so the polygon is
          * actually visible after the user taps. */}
        <AlertGeometryOverlay
          highlightedAlertId={highlightedAlertId}
          govAlerts={govAlerts}
        />
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
