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
const INNER_BEARINGS = [0, 45, 90, 135, 180, 225, 270, 315];
const OUTER_BEARINGS_DOUBLED = [
  0, 22.5, 45, 67.5, 90, 112.5, 135, 157.5,
  180, 202.5, 225, 247.5, 270, 292.5, 315, 337.5,
];
const KM_PER_UNIT = { km: 1, mi: 1.609344 };
const METERS_PER_UNIT = { km: 1000, mi: 1609.344 };
const RADAR_GEOMETRY = {
  km: {
    inner: [5, 15, 30, 50],
    outer: [65, 80, 100],
  },
  mi: {
    inner: [3, 10, 20, 30],
    outer: [40, 50, 60],
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
function buildSamplingPoints(center, extended, doubleOuter, unit) {
  const [centerLat, centerLng] = center;
  const geometry = RADAR_GEOMETRY[unit];
  const kmPerUnit = KM_PER_UNIT[unit];
  const points = [];
  for (const bearing of INNER_BEARINGS) {
    for (const distance of geometry.inner) {
      const p = offsetLatLon(centerLat, centerLng, distance * kmPerUnit, bearing);
      points.push([p.lat, p.lon]);
    }
  }
  if (extended) {
    const outerBearings = doubleOuter ? OUTER_BEARINGS_DOUBLED : INNER_BEARINGS;
    for (const bearing of outerBearings) {
      for (const distance of geometry.outer) {
        const p = offsetLatLon(centerLat, centerLng, distance * kmPerUnit, bearing);
        points.push([p.lat, p.lon]);
      }
    }
  }
  return points;
}

// Risk-level colour mapping for the dashed radar circles. The four tiers
// match the server's RISK_LEVELS in radarAnalyzerCtrl.js. Theme-aware:
// dark mode echoes the radar-tile palette directly (high contrast against
// the dark basemap); light mode shifts yellow to a deeper amber because
// the radar's pure yellow stroke (~93% luminance) drowns against the
// cream basemap (~92% luminance) — fine for filled tiles, useless for a
// 3-px line. Orange and red have enough mid-tone luminance to read on
// both themes unchanged. Bumped weight on the red tier makes the
// severe-tier alert glanceable at the 7" / 10" kiosk distance.
const RING_RISK_STYLE = {
  light: {
    yellow: { color: "#c9a200", weight: 4 },
    orange: { color: "#f08200", weight: 4 },
    red:    { color: "#e60000", weight: 4 },
  },
  dark: {
    yellow: { color: "#f0e600", weight: 3 },
    orange: { color: "#f08200", weight: 3 },
    red:    { color: "#e60000", weight: 4 },
  },
};

/**
 * Build the Leaflet pathOptions for a dashed radar circle, given the
 * current risk level (null while loading, "calm" otherwise) and the
 * theme. Falls back to the original neutral dashed stroke when the
 * level is null/calm.
 *
 * @param {String|null} risk Risk level, or null when not yet loaded
 * @param {Boolean} dark Dark-mode flag
 * @returns {object} pathOptions ready to spread onto a Circle
 */
function buildRingPathOptions(risk, dark) {
  const overlay = risk && RING_RISK_STYLE[dark ? "dark" : "light"][risk];
  // Dark-mode calm uses a warm desaturated grey instead of near-white. The
  // previous #f6f6f4 read as "alarm" against the dark basemap even when
  // there was no precipitation; #a8a097 picks up the dark-panel tones,
  // stays visible without competing with the radar tile colours, and lets
  // the risk tiers (yellow / orange / red) actually pop when they fire.
  return {
    color: overlay ? overlay.color : (dark ? "#a8a097" : "#3a3938"),
    weight: overlay ? overlay.weight : 2,
    opacity: 0.85,
    dashArray: "6 6",
    fill: false,
  };
}

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
    doubleOuterPoints,
    showSamplingPoints,
    lightModeStyle,
    darkModeStyle,
    radarOpacityLight,
    radarOpacityDark,
    distanceUnit,
    setCurrentMapZoom,
    zoomToLevel,
    setZoomToLevel,
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

  // Risk levels for the dashed circles. Each is "calm" | "yellow" |
  // "orange" | "red" — see RING_RISK_STYLE below for the colour mapping.
  // Null means "not loaded yet" (or fetch failed) → ring renders neutral.
  const [innerRisk, setInnerRisk] = useState(null);
  const [outerRisk, setOuterRisk] = useState(null);
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
  }, [riskFetchEnabled, mapGeo, distanceUnit, RISK_REFRESH_INTERVAL]);

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
            maxNativeZoom={7}
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
            ring is always 8 directions; outer ring uses 16 when
            doubleOuterPoints is on. */}
        {aiSummaryAvailable && radarAnalysisEnabled && markerPosition ? (
          <Circle
            center={markerPosition}
            radius={innerRadiusMeters}
            pathOptions={buildRingPathOptions(innerRisk, dark)}
          />
        ) : null}
        {aiSummaryAvailable && radarAnalysisEnabled && markerPosition && extendedRadarRadius ? (
          <Circle
            center={markerPosition}
            radius={outerRadiusMeters}
            pathOptions={buildRingPathOptions(outerRisk, dark)}
          />
        ) : null}
        {aiSummaryAvailable && radarAnalysisEnabled && markerPosition && showSamplingPoints
          ? buildSamplingPoints(markerPosition, extendedRadarRadius, doubleOuterPoints, distanceUnit).map(
              ([lat, lng], idx) => (
                <CircleMarker
                  key={`sp-${idx}`}
                  center={[lat, lng]}
                  radius={3}
                  pathOptions={{
                    color: dark ? "#f6f6f4" : "#3a3938",
                    weight: 1,
                    opacity: 0.7,
                    fillOpacity: 0.5,
                  }}
                />
              )
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
 * Weather layer
 *
 * @param {object} props
 * @param {String} props.layer
 * @param {String} props.weatherApiKey
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
