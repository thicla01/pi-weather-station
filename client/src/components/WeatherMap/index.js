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
// reads from RainViewer. Bearings clockwise from north (deg).
const SAMPLE_BEARINGS = [0, 45, 90, 135, 180, 225, 270, 315];
const SAMPLE_DISTANCES_KM = [5, 15, 30, 45];
const SAMPLE_DISTANCES_KM_EXTENDED = [5, 15, 30, 45, 60, 75, 90];
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
 * used elsewhere in WeatherMap for marker/circle positions.
 *
 * @param {Array<Number>} center [lat, lng] pair
 * @param {Boolean} extended Whether to include the 60/75/90 km rings
 * @returns {Array<[Number, Number]>} Array of [lat, lng] pairs
 */
function buildSamplingPoints(center, extended) {
  const [centerLat, centerLng] = center;
  const distances = extended ? SAMPLE_DISTANCES_KM_EXTENDED : SAMPLE_DISTANCES_KM;
  const points = [];
  for (const bearing of SAMPLE_BEARINGS) {
    for (const distance of distances) {
      const p = offsetLatLon(centerLat, centerLng, distance, bearing);
      points.push([p.lat, p.lon]);
    }
  }
  return points;
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
    extendedRadarRadius,
    showSamplingPoints,
  } = useContext(AppContext);

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

  const MAP_TIMESTAMP_REFRESH_FREQUENCY = 1000 * 60 * 10; //update every 10 minutes
  const MAP_CYCLE_RATE = 1000; //ms

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
        style={{ width: "100%", height: "100%" }}
        attributionControl={false}
        touchZoom={true}
        dragging={true}
        fadeAnimation={false}
      >
        <MapClickHandler onClick={mapClickHandler} />
        <PanHandler panToCoords={panToCoords} setPanToCoords={setPanToCoords} />
        <MapResizer infoPanelCollapsed={infoPanelCollapsed} />
        <AttributionControl position={"bottomleft"} />
        <TileLayer
          attribution={MAPBOX_ATTRIBUTION}
          url={`/api/tiles/${dark ? "dark-v10" : "light-v10"}/{z}/{x}/{y}`}
        />
        {mapTimestamp ? (
          <TileLayer
            attribution='<a href="https://www.rainviewer.com/">RainViewer</a>'
            url={`https://tilecache.rainviewer.com${mapTimestamp.path}/512/{z}/{x}/{y}/6/1_1.png`}
            opacity={dark ? 0.3 : 0.7}
            maxNativeZoom={7}
          />
        ) : null}
        {markerIsVisible && markerPosition ? (
          <Marker position={markerPosition} opacity={0.65}></Marker>
        ) : null}
        {/* Radar-analysis circles — only visible when the AI summary feature
            is configured and we have a center point. The 45 km circle is the
            default analysis zone. When the extended-radius advanced setting
            is on, a second 90 km circle is drawn outside it (same dashed
            style) so the larger sampling area is also visible. */}
        {aiSummaryAvailable && markerPosition ? (
          <Circle
            center={markerPosition}
            radius={45000}
            pathOptions={{
              color: dark ? "#f6f6f4" : "#3a3938",
              weight: 1,
              opacity: 0.45,
              dashArray: "6 6",
              fill: false,
            }}
          />
        ) : null}
        {aiSummaryAvailable && markerPosition && extendedRadarRadius ? (
          <Circle
            center={markerPosition}
            radius={90000}
            pathOptions={{
              color: dark ? "#f6f6f4" : "#3a3938",
              weight: 1,
              opacity: 0.45,
              dashArray: "6 6",
              fill: false,
            }}
          />
        ) : null}
        {/* Sampling-point markers — small dots at every (direction, distance)
            position fed to the AI summary. Off by default; enabled via the
            advanced settings toggle so curious users can see exactly what
            the analyzer is reading. */}
        {aiSummaryAvailable && markerPosition && showSamplingPoints
          ? buildSamplingPoints(markerPosition, extendedRadarRadius).map(
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
