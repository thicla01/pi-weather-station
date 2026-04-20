import React, {
  useEffect,
  useContext,
  useState,
  useCallback,
  useMemo,
} from "react";
import {
  MapContainer,
  TileLayer,
  AttributionControl,
  Marker,
  useMap,
  useMapEvents,
} from "react-leaflet";
import PropTypes from "prop-types";
import { AppContext } from "~/AppContext";
import { useTranslation } from "react-i18next";
import debounce from "debounce";
import axios from "axios";
import styles from "./styles.css";

const RADAR_LEGEND_ITEMS = [
  { color: "#00d0d0", key: "veryLight" },
  { color: "#00c800", key: "light"     },
  { color: "#f0e600", key: "moderate"  },
  { color: "#f08200", key: "heavy"     },
  { color: "#e60000", key: "veryHeavy" },
  { color: "#7800b4", key: "extreme"   },
];

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

  useEffect(() => {
    if (mapTimestamps) {
      setMapTimestamp(mapTimestamps[currentMapTimestampIdx]);
    }
  }, [currentMapTimestampIdx, mapTimestamps]);

  // cycle through weather maps when animated is enabled
  useEffect(() => {
    if (mapTimestamps) {
      if (animateWeatherMap) {
        const interval = setInterval(() => {
          let nextIdx;
          if (currentMapTimestampIdx + 1 >= mapTimestamps.length) {
            nextIdx = 0;
          } else {
            nextIdx = currentMapTimestampIdx + 1;
          }
          setCurrentMapTimestampIdx(nextIdx);
        }, MAP_CYCLE_RATE);
        return () => {
          clearInterval(interval);
        };
      } else {
        setCurrentMapTimestampIdx(mapTimestamps.length - 1);
      }
    }
  }, [currentMapTimestampIdx, animateWeatherMap, mapTimestamps]);

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
        <AttributionControl position={"bottomleft"} />
        <TileLayer
          attribution='© <a href="https://www.mapbox.com/feedback/">Mapbox</a>'
          url={`/api/tiles/${dark ? "dark-v10" : "light-v10"}/{z}/{x}/{y}`}
        />
        {mapTimestamp ? (
          <TileLayer
            attribution='<a href="https://www.rainviewer.com/">RainViewer</a>'
            url={`https://tilecache.rainviewer.com${mapTimestamp.path}/512/{z}/{x}/{y}/6/1_1.png`}
            opacity={dark ? 0.3 : 0.6}
            maxNativeZoom={7}
          />
        ) : null}
        {markerIsVisible && markerPosition ? (
          <Marker position={markerPosition} opacity={0.65}></Marker>
        ) : null}
      </MapContainer>
      {mapTimestamp && <RadarLegend dark={dark} />}
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
