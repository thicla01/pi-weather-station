import React, { createContext, useState, useEffect, useRef, useCallback } from "react";
import { getSettings } from "~/settings";
import PropTypes from "prop-types";
import { getCoordsFromApi } from "~/services/geolocation";
import axios from "axios";

export const AppContext = createContext();

const TEMP_UNIT_STORAGE_KEY = "tempUnit";
const SPEED_UNIT_STORAGE_KEY = "speedUnit";
const LENGTH_UNIT_STORAGE_KEY = "lengthUnit";
const DISTANCE_UNIT_STORAGE_KEY = "distanceUnit";
const CLOCK_UNIT_STORAGE_KEY = "clockTime";
const MOUSE_HIDE_STORAGE_KEY = "mouseHide";
const FONT_SIZE_STORAGE_KEY = "fontSize";
const HIDE_RADAR_LEGEND_STORAGE_KEY = "hideRadarLegend";
const SKIPPED_SHA_STORAGE_KEY = "skippedSha";

/**
 * App context provider
 *
 * @param {object} props
 * @param {Node} props.children
 * @returns {JSX.Element} Context provider
 */
export function AppContextProvider({ children }) {
  const [weatherApiKey, setWeatherApiKey] = useState(null);
  const [mapApiKey, setMapApiKey] = useState(null);
  const [reverseGeoApiKey, setReverseGeoApiKey] = useState(null);
  const [anthropicApiKey, setAnthropicApiKey] = useState(null);
  const [browserGeo, setBrowserGeo] = useState(null);
  const [mapGeo, setMapGeo] = useState(null);
  // Whether the AI weather summary feature is operational on this Pi.
  // Starts true (optimistic) and is flipped to false when the server returns
  // 503 (no Anthropic API key configured). Used by WeatherMap to conditionally
  // show the 45 km radar-analysis circle around mapGeo.
  const [aiSummaryAvailable, setAiSummaryAvailable] = useState(true);
  // Advanced settings (advanced.ai.* in settings.json). Defaults mirror the
  // v2.6 baseline (radar analysis on, no extended radius, no doubled outer
  // points, no sampling-point overlay). Toggles flip independently and
  // persist via saveAdvancedAiFlag (no Save button — instant write on click).
  const [radarAnalysisEnabled, setRadarAnalysisEnabled] = useState(true);
  const [extendedRadarRadius, setExtendedRadarRadius] = useState(false);
  const [doubleOuterPoints, setDoubleOuterPoints] = useState(false);
  const [showSamplingPoints, setShowSamplingPoints] = useState(false);
  // Display sub-tree (advanced.display.* in settings.json).
  // lightModeStyle / darkModeStyle drive the Mapbox style for each theme.
  // For light mode, the panel background tint also follows via the
  // --light-panel-bg-rgb CSS variable. Dark mode keeps a fixed panel
  // colour regardless of style — both dark Mapbox variants harmonize
  // with the same dark grey panel.
  const [lightModeStyle, setLightModeStyle] = useState("streets-v12");
  const [darkModeStyle, setDarkModeStyle] = useState("dark-v10");
  // Radar layer opacity per theme — defaults are the historical hard-coded
  // values from before the slider was introduced (a memory note documents
  // these as deliberately tuned: 0.7 light, 0.3 dark). Range 0.05-1; the
  // floor of 0.05 prevents the radar from disappearing entirely.
  const [radarOpacityLight, setRadarOpacityLight] = useState(0.7);
  const [radarOpacityDark, setRadarOpacityDark] = useState(0.3);
  // Display brightness — null until the server reports its state. If the
  // server says no backlight device is exposed (HDMI screens, x86, missing
  // overlay), brightnessAvailable stays false and the slider is hidden.
  const [brightnessPercent, setBrightnessPercent] = useState(null);
  const [brightnessAvailable, setBrightnessAvailable] = useState(false);
  const [brightnessMinPercent, setBrightnessMinPercent] = useState(10);
  const [darkMode, setDarkMode] = useState(true);
  const [currentWeatherData, setCurrentWeatherData] = useState(null);
  const [currentWeatherDataErr, setCurrentWeatherDataErr] = useState(null);
  const [currentWeatherDataErrMsg, setCurrentWeatherDataErrMsg] = useState(
    null
  );
  const [hourlyWeatherData, setHourlyWeatherData] = useState(null);
  const [hourlyWeatherDataErr, setHourlyWeatherDataErr] = useState(null);
  const [hourlyWeatherDataErrMsg, setHourlyWeatherDataErrMsg] = useState(null);
  const [dailyWeatherData, setDailyWeatherData] = useState(null);
  const [dailyWeatherDataErr, setDailyWeatherDataErr] = useState(null);
  const [dailyWeatherDataErrMsg, setDailyWeatherDataErrMsg] = useState(null);
  const [panToCoords, setPanToCoords] = useState(null);
  const [markerIsVisible, setMarkerIsVisible] = useState(true);
  const [tempUnit, setTempUnit] = useState("f"); // fahrenheit or celsius
  const [speedUnit, setSpeedUnit] = useState("mph"); // mph or ms for m/s
  const [lengthUnit, setLengthUnit] = useState("in"); // in or mm
  const [distanceUnit, setDistanceUnit] = useState("mi"); // mi or km — drives radar circles, AI summary
  const [clockTime, setClockTime] = useState("12"); // 12h or 24h time for clock
  const [animateWeatherMap, setAnimateWeatherMap] = useState(false);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [customLat, setCustomLat] = useState(null);
  const [customLon, setCustomLon] = useState(null);
  const [mouseHide, setMouseHide] = useState(false);
  const [hideRadarLegend, setHideRadarLegend] = useState(false);
  const [infoPanelCollapsed, setInfoPanelCollapsed] = useState(false);
  const [fontSize, setFontSize] = useState("m"); // s, m, l
  const [sunriseTime, setSunriseTime] = useState(null);
  const [sunsetTime, setSunsetTime] = useState(null);
  const [isLocal, setIsLocal] = useState(true);
  const [remoteSecurityEnabled, setRemoteSecurityEnabled] = useState(false);
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [debugMenuOpen, setDebugMenuOpen] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [latestVersion, setLatestVersion] = useState(null);
  const [latestSha, setLatestSha] = useState(null);
  const [updateCommits, setUpdateCommits] = useState([]);
  const [serviceFileChanged, setServiceFileChanged] = useState(false);
  const [needsManualUpgrade, setNeedsManualUpgrade] = useState(false);
  const [skippedSha, setSkippedSha] = useState(null);
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [updateState, setUpdateState] = useState("idle"); // idle|updating|restarting|stopped|failed
  const [updateErrorMessage, setUpdateErrorMessage] = useState(null);
  const updatePollRef = useRef(null);
  const infoPanelScrollRef = useRef(null); // set by InfoPanel on the scroll container
  const [serverPlatform, setServerPlatform] = useState(null);
  const [isSystemd, setIsSystemd] = useState(false);

  /**
   * Save mouse hide state
   *
   * @param {Boolean} newVal
   */
  function saveMouseHide(newVal) {
    let newState;
    try {
      newState = JSON.parse(newVal);
    } catch (e) {
      console.log("saveMouseHide", e);
      return;
    }
    setMouseHide(newState);
    window.localStorage.setItem(MOUSE_HIDE_STORAGE_KEY, newState);
  }

  /**
   * Save hide radar legend state
   *
   * @param {Boolean} newVal
   */
  function saveHideRadarLegend(newVal) {
    let newState;
    try {
      newState = JSON.parse(newVal);
    } catch (e) {
      console.log("saveHideRadarLegend", e);
      return;
    }
    setHideRadarLegend(newState);
    window.localStorage.setItem(HIDE_RADAR_LEGEND_STORAGE_KEY, newState);
  }

  /**
   * Save skipped update SHA so the indicator is suppressed for that version
   *
   * @param {string} sha Short commit SHA returned by /api/update-check
   */
  function saveSkippedSha(sha) {
    setSkippedSha(sha);
    window.localStorage.setItem(SKIPPED_SHA_STORAGE_KEY, sha);
  }

  /** Poll /api/is-local until the server responds, then reload the page. */
  const pollUntilReady = useCallback(() => {
    let attempts = 0;
    const poll = () => {
      attempts++;
      if (attempts > 30) { setUpdateState("failed"); return; }
      axios.get("/api/is-local")
        .then(() => window.location.reload())
        .catch(() => { updatePollRef.current = setTimeout(poll, 2000); });
    };
    updatePollRef.current = setTimeout(poll, 3000);
  }, []);

  /**
   * Trigger an automatic update via the server API
   */
  const triggerUpdate = useCallback(() => {
    setUpdateState("updating");
    setUpdateErrorMessage(null);
    axios.post("/api/update")
      .then(() => {
        if (isSystemd) {
          setUpdateState("restarting");
          pollUntilReady();
        } else {
          setUpdateState("stopped");
        }
      })
      .catch((err) => {
        // The server returns a structured { error, reason, message } body
        // for known failure modes (detached HEAD, wrong branch, local
        // changes, npm install failure...). Surface the message so the
        // user sees what to fix instead of a generic "Failed".
        const message = err?.response?.data?.message || err?.message || null;
        setUpdateErrorMessage(message);
        setUpdateState("failed");
      });
  }, [isSystemd, pollUntilReady]);

  /**
   * Save clock time
   *
   * @param {String} newVal `12` or `24`
   */
  function saveClockTime(newVal) {
    setClockTime(newVal);
    window.localStorage.setItem(CLOCK_UNIT_STORAGE_KEY, newVal);
  }

  /**
   * Save temp unit
   *
   * @param {String} newVal `f` or `c`
   */
  function saveTempUnit(newVal) {
    setTempUnit(newVal);
    window.localStorage.setItem(TEMP_UNIT_STORAGE_KEY, newVal);
  }

  /**
   * Save speed unit
   *
   * @param {String} newVal `mph` or `ms`
   */
  function saveSpeedUnit(newVal) {
    setSpeedUnit(newVal);
    window.localStorage.setItem(SPEED_UNIT_STORAGE_KEY, newVal);
  }

  /**
   * Save length unit
   *
   * @param {String} newVal  `in` or `mm`
   */
  function saveLengthUnit(newVal) {
    setLengthUnit(newVal);
    window.localStorage.setItem(LENGTH_UNIT_STORAGE_KEY, newVal);
  }

  /**
   * Save distance unit
   *
   * @param {String} newVal `mi` or `km`
   */
  function saveDistanceUnit(newVal) {
    setDistanceUnit(newVal);
    window.localStorage.setItem(DISTANCE_UNIT_STORAGE_KEY, newVal);
  }

  /**
   * Save font size preference
   *
   * @param {String} newVal `s`, `m`, or `l`
   */
  function saveFontSize(newVal) {
    setFontSize(newVal);
    window.localStorage.setItem(FONT_SIZE_STORAGE_KEY, newVal);
  }

  function checkIsLocal() {
    axios.get("/api/is-local").then((res) => {
      setIsLocal(res.data.isLocal);
      setRemoteSecurityEnabled(res.data.securityEnabled ?? false);
      setDebugEnabled(res.data.debugEnabled ?? false);
    // eslint-disable-next-line no-unused-vars
    }).catch((_err) => {
      // non-critical — defaults stay (localhost assumed, security disabled)
    });
  }

  /**
   * Toggles debug menu open/closed — closes settings panel if open
   */
  function toggleDebugMenuOpen() {
    if (!debugMenuOpen) setSettingsMenuOpen(false);
    setDebugMenuOpen(!debugMenuOpen);
  }

  const UPDATE_CHECK_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours

  /**
   * Fetch /api/update-check (or /force) and propagate every relevant field
   * into AppContext state. Shared by the periodic background poll and the
   * Debug panel's "Check for update" button so both call sites end up with
   * the same set of state updates — including serviceFileChanged and
   * needsManualUpgrade, which UpdateModal reads to gate the Update button.
   *
   * @param {Boolean} [force] When true, hits /api/update-check/force which
   *   clears the server cache before re-evaluating
   * @returns {Promise<Object|null>} Resolves with the response data, or null
   *   on network error
   */
  const refreshUpdateCheck = useCallback((force) => {
    const url = force ? "/api/update-check/force" : "/api/update-check";
    return axios.get(url).then((res) => {
      setUpdateAvailable(res.data.updateAvailable ?? false);
      setLatestVersion(res.data.latestVersion ?? null);
      setLatestSha(res.data.latestSha ?? null);
      setUpdateCommits(res.data.commits ?? []);
      setServiceFileChanged(Boolean(res.data.serviceFileChanged));
      setNeedsManualUpgrade(Boolean(res.data.needsManualUpgrade));
      setServerPlatform(res.data.platform ?? null);
      setIsSystemd(res.data.isSystemd ?? false);
      return res.data;
    }).catch(() => {
      // non-critical — silently ignore errors
      return null;
    });
  }, []);

  useEffect(() => {
    const fetchUpdateStatus = () => {
      refreshUpdateCheck();
    };

    fetchUpdateStatus();
    const interval = setInterval(fetchUpdateStatus, UPDATE_CHECK_INTERVAL);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function loadStoredData() {
    const temp = window.localStorage.getItem(TEMP_UNIT_STORAGE_KEY);
    const speed = window.localStorage.getItem(SPEED_UNIT_STORAGE_KEY);
    const length = window.localStorage.getItem(LENGTH_UNIT_STORAGE_KEY);
    const distance = window.localStorage.getItem(DISTANCE_UNIT_STORAGE_KEY);
    const clock = window.localStorage.getItem(CLOCK_UNIT_STORAGE_KEY);

    let mouseHide;
    try {
      mouseHide = JSON.parse(
        window.localStorage.getItem(MOUSE_HIDE_STORAGE_KEY)
      );
    } catch (e) {
      console.log("mouseHide", e);
    }

    setMouseHide(!!mouseHide);

    let hideRadarLegend;
    try {
      hideRadarLegend = JSON.parse(
        window.localStorage.getItem(HIDE_RADAR_LEGEND_STORAGE_KEY)
      );
    } catch (e) {
      console.log("hideRadarLegend", e);
    }
    setHideRadarLegend(!!hideRadarLegend);

    const savedSkippedSha = window.localStorage.getItem(SKIPPED_SHA_STORAGE_KEY);
    if (savedSkippedSha) setSkippedSha(savedSkippedSha);

    if (temp) {
      setTempUnit(temp);
    }
    if (speed) {
      setSpeedUnit(speed);
    }
    if (length) {
      setLengthUnit(length);
    }
    if (distance === "mi" || distance === "km") {
      setDistanceUnit(distance);
    }
    if (clock) {
      setClockTime(clock);
    }
    const fs = window.localStorage.getItem(FONT_SIZE_STORAGE_KEY);
    if (fs) {
      setFontSize(fs);
    }
  }

  /**
   * Set custom starting lat/lon
   *
   * @returns {Promise} lat/lon
   * @private
   */
  function getCustomLatLon() {
    return new Promise((resolve, reject) => {
      getSettings()
        .then((res) => {
          if (res) {
            const { startingLat, startingLon } = res;
            if (startingLat) {
              setCustomLat(startingLat);
            }
            if (startingLon) {
              setCustomLon(startingLon);
            }
            if (res.anthropicApiKey) {
              setAnthropicApiKey(res.anthropicApiKey);
            }
            // Advanced settings — radar analysis defaults to ON (matches the
            // baseline behaviour where the third paragraph always renders
            // when an Anthropic key is configured); the other three default
            // to OFF if absent.
            const advancedAi = res.advanced && res.advanced.ai;
            if (advancedAi) {
              if (advancedAi.radarAnalysisEnabled !== undefined) {
                setRadarAnalysisEnabled(Boolean(advancedAi.radarAnalysisEnabled));
              }
              setExtendedRadarRadius(Boolean(advancedAi.extendedRadius));
              setDoubleOuterPoints(Boolean(advancedAi.doubleOuterPoints));
              setShowSamplingPoints(Boolean(advancedAi.showSamplingPoints));
            }
            const advancedDisplay = res.advanced && res.advanced.display;
            if (advancedDisplay) {
              if (advancedDisplay.lightModeStyle) {
                setLightModeStyle(advancedDisplay.lightModeStyle);
              }
              if (advancedDisplay.darkModeStyle) {
                setDarkModeStyle(advancedDisplay.darkModeStyle);
              }
              if (typeof advancedDisplay.radarOpacityLight === "number") {
                setRadarOpacityLight(advancedDisplay.radarOpacityLight);
              }
              if (typeof advancedDisplay.radarOpacityDark === "number") {
                setRadarOpacityDark(advancedDisplay.radarOpacityDark);
              }
            }
          }
          resolve(res);
        })
        .catch((err) => {
          console.log("could not read settings.json", err);
          reject(err);
        });
    });
  }

  /**
   * Set the map to a given position
   *
   * @param {object} coords coordinates
   * @param {String} coords.latitude
   * @param {String} coords.longitude
   */
  function setMapPosition(coords) {
    updateCurrentWeatherData(coords);
    updateHourlyWeatherData(coords);
    updateDailyWeatherData(coords);
    setMapGeo(coords);
    setPanToCoords(coords);
  }

  /**
   * Return the map position to browser geolocation coordinates
   */
  function resetMapPosition() {
    setMapPosition(browserGeo);
  }

  /**
   * Gets geolocation and sets it, unless custom starting coordinates are provided.
   *
   * @returns {object} coords
   */
  function getBrowserGeo() {
    return new Promise((resolve, reject) => {
      getCustomLatLon()
        .then((res) => {
          const { startingLat, startingLon } = res;
          if (startingLat && startingLon) {
            const latLon = {
              latitude: parseFloat(startingLat),
              longitude: parseFloat(startingLon),
            };
            setBrowserGeo(latLon);
            setMapGeo(latLon); //Set initial map coords to custom lat/lon
            resolve(latLon);
          } else {
            getCoordsFromApi()
              .then((res) => {
                if (!res) {
                  return reject("Could not get browser geolocation data");
                }
                const { latitude, longitude } = res;
                setBrowserGeo({ latitude, longitude });
                setMapGeo({ latitude, longitude }); //Set initial map coords to browser geolocation
                resolve(res);
              })
              .catch((err) => {
                reject(err);
              });
          }
        })
        .catch((err) => {
          console.log("err!", err);
        });
    });
  }

  /**
   * Retrieves weather API key and sets it
   *
   * @returns {Promise} Weather API Key
   */
  function getWeatherApiKey() {
    return new Promise((resolve, reject) => {
      getSettings()
        .then((res) => {
          if (!res || (res && !res.weatherApiKey)) {
            setSettingsMenuOpen(true);
            return reject("Weather API key missing");
          }
          setWeatherApiKey(res && res.weatherApiKey ? res.weatherApiKey : null);
          resolve();
        })
        .catch((err) => {
          reject(err);
        });
    });
  }

  /**
   * Retrieves map API key and sets it
   *
   * @returns {Promise} Weather API Key
   */
  function getMapApiKey() {
    return new Promise((resolve, reject) => {
      getSettings()
        .then((res) => {
          if (!res || (res && !res.mapApiKey)) {
            setSettingsMenuOpen(true);
            return reject("Map API key missing!");
          }
          setMapApiKey(res && res.mapApiKey ? res.mapApiKey : null);
          resolve();
        })
        .catch((err) => {
          reject(err);
        });
    });
  }

  /**
   * Retrieves reverse geolocation API key and sets it
   *
   * @returns {Promise} Weather API Key
   */
  function getReverseGeoApiKey() {
    return new Promise((resolve, reject) => {
      getSettings()
        .then((res) => {
          if (!res || (res && !res.reverseGeoApiKey)) {
            return reject("Reverse geolocation API key missing!");
          }
          setReverseGeoApiKey(
            res && res.reverseGeoApiKey ? res.reverseGeoApiKey : null
          );
          resolve();
        })
        .catch((err) => {
          reject(err);
        });
    });
  }

  /**
   * Updates hourly weather data
   *
   * @param {object} coords
   * @param {Number} coords.latitude latitude
   * @param {Number} coords.longitude longitude
   *
   * @returns {Promise} hourly weather data
   */
  function updateHourlyWeatherData(coords) {
    setHourlyWeatherDataErr(null);
    setHourlyWeatherDataErrMsg(null);
    const { latitude, longitude } = coords;

    return new Promise((resolve, reject) => {
      if (!coords) {
        setHourlyWeatherDataErr(true);
        return reject("No coords");
      }
      if (!weatherApiKey) {
        setHourlyWeatherDataErr(true);
        setSettingsMenuOpen(true);
        return reject("Missing weather API key");
      }

      axios
        .get(`/api/weather/hourly?lat=${latitude}&lon=${longitude}`)
        .then((res) => {
          if (!res) {
            return reject({ message: "No response" });
          }
          const { data } = res;
          setHourlyWeatherData(data);
          resolve(data);
        })
        .catch((err) => {
          setHourlyWeatherDataErr(true);
          if (err && err.message) {
            setHourlyWeatherDataErrMsg(err.message);
          }

          reject(err);
        });
    });
  }

  /**
   * Updates daily  weather data
   *
   * @param {object} coords
   * @param {Number} coords.latitude latitude
   * @param {Number} coords.longitude longitude
   *
   * @returns {Promise} daily weather data
   */
  function updateDailyWeatherData(coords) {
    setDailyWeatherDataErr(null);
    setDailyWeatherDataErrMsg(null);
    const { latitude, longitude } = coords;

    return new Promise((resolve, reject) => {
      if (!coords) {
        setDailyWeatherDataErr(true);
        return reject("No coords");
      }
      if (!weatherApiKey) {
        setDailyWeatherDataErr(true);
        setSettingsMenuOpen(true);
        return reject("Missing weather API key");
      }
      axios
        .get(`/api/weather/daily?lat=${latitude}&lon=${longitude}`)
        .then((res) => {
          if (!res) {
            return reject({ message: "No response" });
          }
          const { data } = res;
          setDailyWeatherData(data);
          resolve(data);
        })
        .catch((err) => {
          setDailyWeatherDataErr(true);
          if (err && err.message) {
            setDailyWeatherDataErrMsg(err.message);
          }
          reject(err);
        });
    });
  }

  function updateSunriseSunset(coords) {
    return new Promise((resolve, reject) => {
      if (!coords) {
        setSunriseTime(null);
        setSunsetTime(null);
        return reject("No coords");
      }
      const { latitude, longitude } = coords;

      axios
        .get(`/api/sunrise-sunset?lat=${latitude}&lon=${longitude}`)
        .then((res) => {
          const { results } = res.data;
          if (results) {
            const { sunrise, sunset } = results;
            setSunriseTime(sunrise);
            setSunsetTime(sunset);
          } else {
            setSunriseTime(null);
            setSunsetTime(null);
          }
          resolve(results);
        })
        .catch((err) => {
          setSunriseTime(null);
          setSunsetTime(null);
          reject(err);
        });
    });
  }

  /**
   * Updates current weather data
   *
   * @param {object} coords
   * @param {Number} coords.latitude latitude
   * @param {Number} coords.longitude longitude
   *
   * @returns {Promise} current weather data
   */
  function updateCurrentWeatherData(coords) {
    setCurrentWeatherDataErr(null);
    setCurrentWeatherDataErrMsg(null);
    const { latitude, longitude } = coords;

    return new Promise((resolve, reject) => {
      if (!coords) {
        setCurrentWeatherDataErr(true);
        return reject("No coords");
      }
      if (!weatherApiKey) {
        setCurrentWeatherDataErr(true);
        setSettingsMenuOpen(true);
        return reject("Missing weather API key");
      }

      axios
        .get(`/api/weather/current?lat=${latitude}&lon=${longitude}`)
        .then((res) => {
          if (!res) {
            return reject({ message: "No response" });
          }
          const { data } = res;
          setCurrentWeatherData(data);
          resolve(data);
        })
        .catch((err) => {
          setCurrentWeatherDataErr(true);
          if (err && err.message) {
            setCurrentWeatherDataErrMsg(err.message);
          }
          reject(err);
        });
    });
  }

  /**
   * Toggles the marker on and off
   */
  function toggleMarker() {
    setMarkerIsVisible(!markerIsVisible);
  }

  /**
   * Toggles weather map animation on/off
   */
  function toggleAnimateWeatherMap() {
    setAnimateWeatherMap(!animateWeatherMap);
  }

  /**
   * Toggles settings menu open/closed — closes debug panel if open
   */
  function toggleSettingsMenuOpen() {
    if (!settingsMenuOpen) setDebugMenuOpen(false);
    setSettingsMenuOpen(!settingsMenuOpen);
  }

  /**
   * Saves settings to `settings.json`
   *
   * @param {object} settings
   * @param {String} [settings.mapsKey]
   * @param {String} [settings.weatherKey]
   * @param {String} [settings.geoKey]
   * @param {String} [settings.anthropicKey]
   * @param {String} [settings.lat]
   * @param {String} [settings.lon]
   * @returns {Promise} Resolves when complete
   */
  function saveSettingsToJson({ mapsKey, weatherKey, geoKey, anthropicKey, lat, lon }) {
    return new Promise((resolve, reject) => {
      axios
        .put("/settings", {
          weatherApiKey: weatherKey,
          mapApiKey: mapsKey,
          reverseGeoApiKey: geoKey,
          anthropicApiKey: anthropicKey,
          startingLat: lat,
          startingLon: lon,
        })
        .then((res) => {
          resolve(res);
          setMapApiKey(mapsKey);
          setWeatherApiKey(weatherKey);
          setReverseGeoApiKey(geoKey);
          setAnthropicApiKey(anthropicKey);
          setCustomLat(lat);
          setCustomLon(lon);
        })
        .catch((err) => {
          reject(err);
        });
    });
  }

  /**
   * Persist a single advanced.ai.* flag to settings.json.
   * Toggles save instantly on click — no separate Save button — and update
   * local state on success so the UI reflects the new value immediately.
   *
   * @param {String} key one of "extendedRadius", "showSamplingPoints"
   * @param {Boolean} value new value
   * @returns {Promise} Resolves when saved
   */
  function saveAdvancedAiFlag(key, value) {
    const nextAi = {
      radarAnalysisEnabled,
      extendedRadius: extendedRadarRadius,
      doubleOuterPoints,
      showSamplingPoints,
      [key]: value,
    };
    const nextDisplay = { lightModeStyle, darkModeStyle, radarOpacityLight, radarOpacityDark };
    return axios
      .patch("/setting", { key: "advanced", val: { ai: nextAi, display: nextDisplay } })
      .then(() => {
        if (key === "radarAnalysisEnabled") setRadarAnalysisEnabled(value);
        if (key === "extendedRadius") setExtendedRadarRadius(value);
        if (key === "doubleOuterPoints") setDoubleOuterPoints(value);
        if (key === "showSamplingPoints") setShowSamplingPoints(value);
      });
  }

  /**
   * Persist a single advanced.display.* flag. Same instant-save pattern as
   * saveAdvancedAiFlag — toggles flip immediately on click.
   *
   * @param {String} key one of "lightModeStyle"
   * @param {String} value new value
   * @returns {Promise} Resolves when saved
   */
  function saveAdvancedDisplayFlag(key, value) {
    const nextDisplay = { lightModeStyle, radarOpacityLight, radarOpacityDark, [key]: value };
    const nextAi = {
      radarAnalysisEnabled,
      extendedRadius: extendedRadarRadius,
      doubleOuterPoints,
      showSamplingPoints,
    };
    return axios
      .patch("/setting", { key: "advanced", val: { ai: nextAi, display: nextDisplay } })
      .then(() => {
        if (key === "lightModeStyle") setLightModeStyle(value);
        if (key === "darkModeStyle") setDarkModeStyle(value);
        if (key === "radarOpacityLight") setRadarOpacityLight(value);
        if (key === "radarOpacityDark") setRadarOpacityDark(value);
      });
  }

  // Debounced setters for the radar opacity sliders. State updates
  // immediately on each tick (live preview on the map); the network
  // PATCH /setting is delayed so we don't spam the server while dragging.
  // 500 ms feels right — long enough to coalesce a drag, short enough
  // that releasing the slider feels responsive.
  const radarOpacitySaveTimerRef = useRef(null);
  const setRadarOpacityLightLive = (v) => {
    setRadarOpacityLight(v);
    clearTimeout(radarOpacitySaveTimerRef.current);
    radarOpacitySaveTimerRef.current = setTimeout(() => {
      saveAdvancedDisplayFlag("radarOpacityLight", v).catch(() => undefined);
    }, 500);
  };
  const setRadarOpacityDarkLive = (v) => {
    setRadarOpacityDark(v);
    clearTimeout(radarOpacitySaveTimerRef.current);
    radarOpacitySaveTimerRef.current = setTimeout(() => {
      saveAdvancedDisplayFlag("radarOpacityDark", v).catch(() => undefined);
    }, 500);
  };

  // Brightness state is fetched once on mount from /api/brightness. The
  // server tells us whether the device exposes a backlight (sysfs path),
  // the current value, and the floor — so the client doesn't have to
  // hardcode anything platform-specific.
  useEffect(() => {
    axios.get("/api/brightness").then((res) => {
      if (res.data?.available) {
        setBrightnessAvailable(true);
        setBrightnessPercent(res.data.percent);
        if (typeof res.data.minPercent === "number") {
          setBrightnessMinPercent(res.data.minPercent);
        }
      }
    }).catch(() => undefined);
  }, []);

  // Debounced setter for the brightness slider. Same pattern as the radar
  // opacity sliders — local state updates immediately so the slider thumb
  // tracks the cursor smoothly, but the actual brightness write to sysfs
  // is debounced. 250 ms here (faster than radar opacity) because users
  // typically expect dimming to react quickly to feedback.
  const brightnessSaveTimerRef = useRef(null);
  const setBrightnessLive = (v) => {
    setBrightnessPercent(v);
    clearTimeout(brightnessSaveTimerRef.current);
    brightnessSaveTimerRef.current = setTimeout(() => {
      axios.post("/api/brightness", { percent: v }).catch(() => undefined);
    }, 250);
  };

  // Reflect lightModeStyle into a CSS custom property so the panel,
  // panel-toggle and radar legend backgrounds tint to match the Mapbox
  // style. The native Mapbox styles (light-v10 / light-v11) are very pale,
  // so a near-white panel reads better; streets-v12 has a warmer beige
  // base, so a cream panel harmonizes with it.
  useEffect(() => {
    const rgb = lightModeStyle === "streets-v12"
      ? "238, 236, 232"  // cream
      : "247, 247, 247"; // near-white for light-v10 / light-v11
    document.documentElement.style.setProperty("--light-panel-bg-rgb", rgb);
  }, [lightModeStyle]);

  const defaultContext = {
    weatherApiKey,
    getWeatherApiKey,
    reverseGeoApiKey,
    getReverseGeoApiKey,
    anthropicApiKey,
    mapApiKey,
    getMapApiKey,
    browserGeo,
    getBrowserGeo,
    darkMode,
    setDarkMode,
    mapGeo,
    setMapGeo,
    aiSummaryAvailable,
    setAiSummaryAvailable,
    radarAnalysisEnabled,
    extendedRadarRadius,
    doubleOuterPoints,
    showSamplingPoints,
    saveAdvancedAiFlag,
    lightModeStyle,
    darkModeStyle,
    saveAdvancedDisplayFlag,
    radarOpacityLight,
    radarOpacityDark,
    setRadarOpacityLightLive,
    setRadarOpacityDarkLive,
    brightnessAvailable,
    brightnessPercent,
    brightnessMinPercent,
    setBrightnessLive,
    setMapPosition,
    resetMapPosition,
    panToCoords,
    setPanToCoords,
    markerIsVisible,
    toggleMarker,
    tempUnit,
    saveTempUnit,
    speedUnit,
    saveSpeedUnit,
    lengthUnit,
    saveLengthUnit,
    distanceUnit,
    saveDistanceUnit,
    animateWeatherMap,
    toggleAnimateWeatherMap,
    settingsMenuOpen,
    setSettingsMenuOpen,
    toggleSettingsMenuOpen,
    getCustomLatLon,
    customLat,
    customLon,
    loadStoredData,
    clockTime,
    saveClockTime,
    saveSettingsToJson,
    updateCurrentWeatherData,
    updateDailyWeatherData,
    updateHourlyWeatherData,
    currentWeatherData,
    currentWeatherDataErr,
    currentWeatherDataErrMsg,
    hourlyWeatherData,
    hourlyWeatherDataErr,
    hourlyWeatherDataErrMsg,
    dailyWeatherData,
    dailyWeatherDataErr,
    dailyWeatherDataErrMsg,
    mouseHide,
    saveMouseHide,
    hideRadarLegend,
    saveHideRadarLegend,
    infoPanelCollapsed,
    setInfoPanelCollapsed,
    fontSize,
    saveFontSize,
    updateSunriseSunset,
    sunriseTime,
    sunsetTime,
    isLocal,
    remoteSecurityEnabled,
    checkIsLocal,
    debugEnabled,
    debugMenuOpen,
    setDebugMenuOpen,
    toggleDebugMenuOpen,
    updateAvailable: updateAvailable && latestSha !== skippedSha,
    setUpdateAvailable,
    latestVersion,
    setLatestVersion,
    latestSha,
    setLatestSha,
    updateCommits,
    setUpdateCommits,
    serviceFileChanged,
    needsManualUpgrade,
    refreshUpdateCheck,
    skippedSha,
    saveSkippedSha,
    updateModalOpen,
    setUpdateModalOpen,
    updateState,
    setUpdateState,
    updateErrorMessage,
    triggerUpdate,
    serverPlatform,
    isSystemd,
    infoPanelScrollRef,
  };

  return (
    <AppContext.Provider value={defaultContext}>{children}</AppContext.Provider>
  );
}

AppContextProvider.propTypes = {
  children: PropTypes.oneOfType([
    PropTypes.arrayOf(PropTypes.node),
    PropTypes.node,
  ]).isRequired,
};
