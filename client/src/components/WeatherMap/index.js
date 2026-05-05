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
  AttributionControl,
  Marker,
  Circle,
  CircleMarker,
  useMap,
  useMapEvents,
} from "react-leaflet";
import PropTypes from "prop-types";
import { AppContext } from "~/AppContext";
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
};
const RING_OUTLINE_COLOR = "#3a3938";   // dark-grey halo behind coloured strokes in light mode
const RING_OUTLINE_EXTRA_WEIGHT = 2;    // outline extends ~1 px on each side of the coloured stroke

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
 * @returns {Array<object>} Ordered list of pathOptions; render in order
 *   so the coloured stroke sits on top of the outline.
 */
function buildRingLayers(risk, dark) {
  const overlay = risk && RING_RISK_STYLE[dark ? "dark" : "light"][risk];
  const baseDash = "6 6";
  // Calm / not yet loaded — single neutral ring, theme-aware.
  if (!overlay) {
    return [{
      color: dark ? "#a8a097" : "#3a3938",
      weight: 2,
      opacity: 0.85,
      dashArray: baseDash,
      fill: false,
    }];
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
 * @returns {JSX.Element} One or two stacked Circles
 */
const RiskRing = ({ center, radius, risk, dark }) => {
  const layers = buildRingLayers(risk, dark);
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
const MapResizer = ({ infoPanelCollapsed }) => {
  const map = useMap();
  useEffect(() => {
    // Small delay lets the CSS transition finish before recalculating
    const timer = setTimeout(() => map.invalidateSize(), 50);
    return () => clearTimeout(timer);
  }, [infoPanelCollapsed, map]);
  return null;
};

MapResizer.propTypes = {
  infoPanelCollapsed: PropTypes.bool,
};

/**
 * Pans the map when panToCoords changes
 *
 * @param {object} props
 * @param {object} props.panToCoords target coordinates
 * @param {Function} props.setPanToCoords resets panToCoords to null
 * @returns {null} renders nothing
 */
const PanHandler = ({ panToCoords, setPanToCoords }) => {
  const map = useMap();
  useEffect(() => {
    if (panToCoords) {
      map.panTo([panToCoords.latitude, panToCoords.longitude]);
      setPanToCoords(null);
    }
  }, [panToCoords, map, setPanToCoords]);
  return null;
};

PanHandler.propTypes = {
  panToCoords: PropTypes.object,
  setPanToCoords: PropTypes.func.isRequired,
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
  const {
    setMapPosition,
    panToCoords,
    setPanToCoords,
    browserGeo,
    mapGeo,
    mapApiKey,
    getMapApiKey,
    markerIsVisible,
    animateWeatherMap,
    infoPanelCollapsed,
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
    setInnerMaxIntensity,
    setOuterMaxIntensity,
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
  const [currentMapTimestampIdx, setCurrentMapTimestampIdx] = useState(0);
  const animationIntervalRef = useRef(null);

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
  const riskFetchEnabled = aiSummaryAvailable && radarAnalysisEnabled && Boolean(mapGeo);
  useEffect(() => {
    if (!riskFetchEnabled) {
      setInnerRisk(null);
      setOuterRisk(null);
      setInnerTrend("stable");
      setOuterTrend("stable");
      setInnerMaxIntensity(0);
      setOuterMaxIntensity(0);
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
          setInnerMaxIntensity(res.data?.inner?.maxIntensity ?? 0);
          setOuterMaxIntensity(res.data?.outer?.maxIntensity ?? 0);
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
  }, [riskFetchEnabled, mapGeo, distanceUnit, RISK_REFRESH_INTERVAL, setInnerRisk, setOuterRisk, setInnerTrend, setOuterTrend, setInnerMaxIntensity, setOuterMaxIntensity]);

  // Radar animation: start/stop interval based on animateWeatherMap toggle.
  // Using a ref for the interval avoids recreating it on every frame tick.
  useEffect(() => {
    if (animationIntervalRef.current) {
      clearInterval(animationIntervalRef.current);
      animationIntervalRef.current = null;
    }

    if (mapTimestamps && animateWeatherMap) {
      animationIntervalRef.current = setInterval(() => {
        setCurrentMapTimestampIdx((prev) =>
          prev + 1 >= mapTimestamps.length ? 0 : prev + 1
        );
      }, MAP_CYCLE_RATE);
    } else if (mapTimestamps) {
      // When animation is off, show the most recent frame
      setCurrentMapTimestampIdx(mapTimestamps.length - 1);
    }

    return () => {
      if (animationIntervalRef.current) {
        clearInterval(animationIntervalRef.current);
        animationIntervalRef.current = null;
      }
    };
  }, [animateWeatherMap, mapTimestamps]);

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
        maxZoom={20}
        style={{ width: "100%", height: "100%" }}
        attributionControl={false}
        touchZoom={true}
        dragging={true}
        fadeAnimation={false}
      >
        <MapClickHandler onClick={mapClickHandler} />
        <PanHandler panToCoords={panToCoords} setPanToCoords={setPanToCoords} />
        <MapZoomTracker onZoomChange={setCurrentMapZoom} />
        <ZoomLevelHandler zoomToLevel={zoomToLevel} setZoomToLevel={setZoomToLevel} />
        <MapResizer infoPanelCollapsed={infoPanelCollapsed} />
        <AttributionControl position={"bottomleft"} />
        <TileLayer
          attribution={MAPBOX_ATTRIBUTION}
          url={`/api/tiles/${dark ? darkModeStyle : lightModeStyle}/{z}/{x}/{y}`}
          tileSize={512}
          zoomOffset={-1}
          maxZoom={20}
        />
        {mapTimestamp ? (
          <TileLayer
            attribution='<a href="https://www.rainviewer.com/">RainViewer</a>'
            url={`https://tilecache.rainviewer.com${mapTimestamp.path}/512/{z}/{x}/{y}/6/1_1.png`}
            opacity={dark ? radarOpacityDark : radarOpacityLight}
            tileSize={512}
            zoomOffset={-1}
            maxNativeZoom={8}
          />
        ) : null}
        {markerIsVisible && markerPosition ? (
          <Marker position={markerPosition} opacity={0.65}></Marker>
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
        {aiSummaryAvailable && radarAnalysisEnabled && markerPosition ? (
          <RiskRing center={markerPosition} radius={innerRadiusMeters} risk={innerRisk} dark={dark} />
        ) : null}
        {aiSummaryAvailable && radarAnalysisEnabled && markerPosition && extendedRadarRadius ? (
          <RiskRing center={markerPosition} radius={outerRadiusMeters} risk={outerRisk} dark={dark} />
        ) : null}
        {aiSummaryAvailable && radarAnalysisEnabled && markerPosition && showSamplingPoints
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
      </MapContainer>
      {mapTimestamps && !hideRadarLegend && <RadarLegend dark={dark} />}
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
 * Get timestamps for weather map
 *
 * @returns {Promise} Promise of timestamps
 */
function getMapTimestamps() {
  return new Promise((resolve, reject) => {
    axios
      .get("https://api.rainviewer.com/public/weather-maps.json")
      .then((res) => {
        const frames = res.data.radar.past;
        resolve(frames);
      })
      .catch((err) => {
        reject(err);
      });
  });
}

export default WeatherMap;
