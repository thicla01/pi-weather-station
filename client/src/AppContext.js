import React, { createContext, useState, useEffect, useRef, useCallback } from "react";
import { getSettings } from "~/settings";
import PropTypes from "prop-types";
import { getCoordsFromApi } from "~/services/geolocation";
import axios from "axios";
import tzlookup from "tz-lookup";

export const AppContext = createContext();

const TEMP_UNIT_STORAGE_KEY = "tempUnit";
const SPEED_UNIT_STORAGE_KEY = "speedUnit";
const LENGTH_UNIT_STORAGE_KEY = "lengthUnit";
const DISTANCE_UNIT_STORAGE_KEY = "distanceUnit";
const DEFAULT_MAP_ZOOM_STORAGE_KEY = "defaultMapZoom";
const DEFAULT_MAP_ZOOM_FALLBACK = 7; // historical hard-coded value before the slider
const DARK_MODE_AUTO_STORAGE_KEY = "darkModeAuto";
const CLOCK_UNIT_STORAGE_KEY = "clockTime";
const MOUSE_HIDE_STORAGE_KEY = "mouseHide";
const FONT_SIZE_STORAGE_KEY = "fontSize";
const HIDE_RADAR_LEGEND_STORAGE_KEY = "hideRadarLegend";
const RADAR_SOURCE_STORAGE_KEY = "radarSource";
const RADAR_SOURCE_VALUES = ["rainviewer", "eccc"];
const SKIPPED_SHA_STORAGE_KEY = "skippedSha";
const UPDATE_CHECK_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours

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
  // AirNow API key — drives the EPA AirNow source in /api/air-quality.
  // The badge silently falls through to the next source when this is
  // unset (so a Canadian-only install pays nothing for it). Lifted to
  // AppContext only so the Settings panel can write it back via
  // saveSettingsToJson; nothing else in the client reads the value
  // directly.
  const [airNowApiKey, setAirNowApiKey] = useState(null);
  // OpenAQ API key — drives the global air-quality fallback. Same
  // skip-when-unset semantics as airNowApiKey; only material for
  // kiosks outside the AirNow + Canadian-MELCC + ECCC footprint
  // (i.e. anywhere outside US + Canada).
  const [openAqApiKey, setOpenAqApiKey] = useState(null);
  const [browserGeo, setBrowserGeo] = useState(null);
  const [mapGeo, setMapGeo] = useState(null);
  // IANA timezone derived from mapGeo via tz-lookup. Used by Clock to
  // display the wall-clock time at the marker's location instead of the
  // Pi's host timezone — so a kiosk in Quebec showing a marker on Hong
  // Kong reads "21:00" (HKT) rather than "09:00" (EDT) for the same
  // moment. Falls back to undefined → Intl uses host TZ → Clock
  // behaves like before.
  const [mapTimezone, setMapTimezone] = useState(undefined);
  useEffect(() => {
    if (!mapGeo) return;
    try {
      setMapTimezone(tzlookup(mapGeo.latitude, mapGeo.longitude));
    } catch {
      // tz-lookup throws on out-of-range coords (e.g. ocean buoy with
      // no nearby polygon) — fall back to host timezone silently.
      setMapTimezone(undefined);
    }
  }, [mapGeo]);
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
  // When darkModeAuto is on, an interval flips darkMode at sunrise /
  // sunset based on AppContext's sunriseTime / sunsetTime. Manual taps
  // on the dark/light toggle below disable auto mode (override pattern:
  // user wins). Persisted in localStorage; default OFF so existing
  // installs aren't surprised by sudden theme switches.
  const [darkModeAuto, setDarkModeAuto] = useState(false);
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
  // Map zoom — three pieces of state working together:
  //   - defaultMapZoom : the user's preferred starting zoom, used on next mount
  //                      (Leaflet's MapContainer reads `zoom` only on init).
  //   - currentMapZoom : whatever Leaflet is showing right now, pushed up from
  //                      WeatherMap's zoomend listener so the Debug panel can
  //                      display it without poking into Leaflet.
  //   - zoomToLevel    : transient signal sent when the user moves the
  //                      Settings slider, picked up by WeatherMap's
  //                      ZoomLevelHandler to call map.setZoom for live preview.
  const [defaultMapZoom, setDefaultMapZoom] = useState(DEFAULT_MAP_ZOOM_FALLBACK);
  const [currentMapZoom, setCurrentMapZoom] = useState(DEFAULT_MAP_ZOOM_FALLBACK);
  const [zoomToLevel, setZoomToLevel] = useState(null);
  // Radar-risk levels for the inner / outer dashed circles, populated by
  // WeatherMap's /api/radar-risk poll. Lifted to AppContext so the
  // InfoPanel's AlertBanner can consume the same state without duplicating
  // the polling logic. null = not yet loaded (or fetch failed); strings are
  // "calm" | "yellow" | "orange" | "red".
  const [innerRisk, setInnerRisk] = useState(null);
  const [outerRisk, setOuterRisk] = useState(null);
  // Per-ring trend ("approaching" | "leaving" | "stable") and a `bumped`
  // flag the server emits when the displayed tier ended up higher than
  // the base RISK_LEVELS mapping (i.e. when v2 trend logic pushed it up
  // one notch). The AlertBanner reads `bumped` to pick the softer
  // "alert.approaching" copy in that case — used to be derived client-
  // side from `level vs naturalTier(maxIntensity)`, but that derivation
  // broke once hysteresis decoupled tier from raw max intensity, so the
  // server exposes the boolean directly.
  const [innerTrend, setInnerTrend] = useState("stable");
  const [outerTrend, setOuterTrend] = useState("stable");
  const [innerBumped, setInnerBumped] = useState(false);
  const [outerBumped, setOuterBumped] = useState(false);
  // Last AQHI payload returned by /api/air-quality (lifted from
  // <UvAqiBadges> so the Debug panel can display the chosen station's
  // name, distance, observation/forecast kind without refetching).
  // null = no fetch yet, out of coverage, or upstream failure.
  const [aqhiInfo, setAqhiInfo] = useState(null);
  // Active government weather alerts at mapGeo, sorted server-side by
  // descending severity. NWS for the US, ECCC for Canada — see
  // server/govAlertsCtrl.js. Empty array means "no upstream alert
  // covers this point right now"; the radar-derived banner remains
  // the source of truth in that case. The poll uses the same 10 min
  // cadence the roadmap specified — alerts don't change minute-to-
  // minute and the upstreams already cache aggressively.
  const [govAlerts, setGovAlerts] = useState([]);
  const [clockTime, setClockTime] = useState("12"); // 12h or 24h time for clock
  const [animateWeatherMap, setAnimateWeatherMap] = useState(false);
  // Radar animation playback speed multiplier — 1× / 2× / 4× cycling.
  // Drives the per-frame interval in WeatherMap (MAP_CYCLE_RATE / radarSpeed).
  // Lives in context so the new RadarTimeline overlay can read and write it
  // independently of the rest of WeatherMap. Persisted to localStorage so the
  // setting survives reloads — useful for users who consistently prefer a
  // faster scrub.
  const [radarSpeed, setRadarSpeed] = useState(() => {
    if (typeof window === "undefined") return 1;
    const stored = parseInt(window.localStorage.getItem("radarSpeed"), 10);
    return [1, 2, 4].includes(stored) ? stored : 1;
  });
  const cycleRadarSpeed = useCallback(() => {
    setRadarSpeed((prev) => {
      const next = prev === 1 ? 2 : prev === 2 ? 4 : 1;
      try { window.localStorage.setItem("radarSpeed", String(next)); } catch { /* localStorage may be unavailable */ }
      return next;
    });
  }, []);
  // NOTE: radarFrameIdx (the current playback position in the timeline)
  // intentionally lives in WeatherMap local state, not here. Hoisting it
  // to context made every animation tick re-render all ~50 AppContext
  // consumers — which queued button-click handlers behind a flood of
  // re-renders and made the play/pause toggle take 1-2 seconds to react.
  // Only WeatherMap and its child RadarTimeline need the value, and the
  // child receives it via props, so context offers no benefit here.
  // Whether the radar timeline overlay is visible. Persisted to
  // localStorage as a layout preference (like darkMode, fontSize) so a
  // user who prefers a clean map sees their choice survive reloads.
  // Default true so first-time users see the timeline. Hiding the
  // timeline also pauses any ongoing animation — see toggle below.
  const [radarTimelineVisible, setRadarTimelineVisible] = useState(() => {
    if (typeof window === "undefined") return true;
    const stored = window.localStorage.getItem("radarTimelineVisible");
    return stored === null ? true : stored === "true";
  });
  const toggleRadarTimelineVisible = useCallback(() => {
    setRadarTimelineVisible((prev) => {
      const next = !prev;
      try { window.localStorage.setItem("radarTimelineVisible", String(next)); } catch { /* localStorage may be unavailable */ }
      // Hiding the timeline also stops animation — the user has no UI
      // to control playback while it's hidden, so leaving the radar
      // ticking through frames in the background would be confusing.
      // Showing the timeline doesn't auto-start animation; the user
      // explicitly hits play if they want it.
      if (!next) setAnimateWeatherMap(false);
      return next;
    });
  }, []);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [customLat, setCustomLat] = useState(null);
  const [customLon, setCustomLon] = useState(null);
  const [mouseHide, setMouseHide] = useState(false);
  const [hideRadarLegend, setHideRadarLegend] = useState(false);
  // Visual radar source on the map. "rainviewer" (default) keeps the existing
  // CDN-cached PNG tiles + timeline scrubber; "eccc" swaps to Environment
  // Canada's WMS for fresher (6-min) Canadian-authority radar at the cost of
  // the timeline (ECCC's WMS time-dimension support is a Phase B item). The
  // server-side radar analyzer always uses RainViewer regardless — this
  // setting only affects the visible tile layer.
  const [radarSource, setRadarSource] = useState("rainviewer");
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
  const [changedDeployFiles, setChangedDeployFiles] = useState([]);
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
   * Save radar source preference (rainviewer | eccc).
   *
   * @param {string} newVal
   */
  function saveRadarSource(newVal) {
    if (!RADAR_SOURCE_VALUES.includes(newVal)) return;
    setRadarSource(newVal);
    window.localStorage.setItem(RADAR_SOURCE_STORAGE_KEY, newVal);
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
   * Save the auto-dark-mode preference. Persisted under
   * DARK_MODE_AUTO_STORAGE_KEY; the polling effect below picks it up and
   * starts/stops the sunrise/sunset checks accordingly.
   *
   * @param {Boolean} newVal
   */
  function saveDarkModeAuto(newVal) {
    const next = Boolean(newVal);
    setDarkModeAuto(next);
    window.localStorage.setItem(DARK_MODE_AUTO_STORAGE_KEY, String(next));
  }

  /**
   * Manual dark/light toggle wrapper — same shape as setDarkMode for
   * existing call sites, but also turns off auto mode if it was on.
   * The intuition is "tap to override": the user wins, auto resumes
   * only when they explicitly re-enable it from Settings.
   *
   * @param {Boolean} next
   */
  function setDarkModeManual(next) {
    setDarkMode(next);
    if (darkModeAuto) saveDarkModeAuto(false);
  }

  /**
   * Save default map zoom (used on next page load) and trigger a live preview
   * by signalling the ZoomLevelHandler in WeatherMap to call map.setZoom.
   * Without the live preview, sliding the control would feel inert until the
   * user reloaded — confusing.
   *
   * @param {Number} newVal Zoom level (4–12)
   */
  function saveDefaultMapZoom(newVal) {
    const n = Math.round(Number(newVal));
    if (!Number.isFinite(n)) return;
    setDefaultMapZoom(n);
    setZoomToLevel(n);
    window.localStorage.setItem(DEFAULT_MAP_ZOOM_STORAGE_KEY, String(n));
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
    }).catch(() => {
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

  /**
   * Fetch /api/update-check (or /force) and propagate every relevant field
   * into AppContext state. Shared by the periodic background poll and the
   * Debug panel's "Check for update" button so both call sites end up with
   * the same set of state updates — including changedDeployFiles and
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
      setChangedDeployFiles(Array.isArray(res.data.changedDeployFiles) ? res.data.changedDeployFiles : []);
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
  }, [refreshUpdateCheck]);

  function loadStoredData() {
    const temp = window.localStorage.getItem(TEMP_UNIT_STORAGE_KEY);
    const speed = window.localStorage.getItem(SPEED_UNIT_STORAGE_KEY);
    const length = window.localStorage.getItem(LENGTH_UNIT_STORAGE_KEY);
    const distance = window.localStorage.getItem(DISTANCE_UNIT_STORAGE_KEY);
    const storedZoom = window.localStorage.getItem(DEFAULT_MAP_ZOOM_STORAGE_KEY);
    const storedDarkAuto = window.localStorage.getItem(DARK_MODE_AUTO_STORAGE_KEY);
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

    const storedRadarSource = window.localStorage.getItem(RADAR_SOURCE_STORAGE_KEY);
    if (RADAR_SOURCE_VALUES.includes(storedRadarSource)) {
      setRadarSource(storedRadarSource);
    }

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
    const parsedZoom = parseInt(storedZoom, 10);
    if (Number.isFinite(parsedZoom)) {
      setDefaultMapZoom(parsedZoom);
      setCurrentMapZoom(parsedZoom);
    }
    if (storedDarkAuto === "true") setDarkModeAuto(true);
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
            if (res.airNowApiKey) {
              setAirNowApiKey(res.airNowApiKey);
            }
            if (res.openAqApiKey) {
              setOpenAqApiKey(res.openAqApiKey);
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
   * Saves settings to `settings.json`. Each key maps to a server-side
   * setting whose name is intentionally different (`mapsKey` →
   * `mapApiKey`, etc.) — the rename happens here so the rest of the
   * client can use shorter form names.
   *
   * @param {object} settings User-supplied bundle of settings to persist.
   * @param {String} [settings.mapsKey] Mapbox API key (writes `mapApiKey`).
   * @param {String} [settings.weatherKey] Tomorrow.io API key (writes `weatherApiKey`).
   * @param {String} [settings.geoKey] LocationIQ reverse-geocoding API key (writes `reverseGeoApiKey`).
   * @param {String} [settings.anthropicKey] Anthropic API key for the AI summary (writes `anthropicApiKey`).
   * @param {String} [settings.airNowKey] EPA AirNow API key (writes `airNowApiKey`); enables the US air-quality source.
   * @param {String} [settings.openAqKey] OpenAQ API key (writes `openAqApiKey`); enables the global air-quality fallback.
   * @param {String} [settings.lat] Custom starting latitude as a string (writes `startingLat`).
   * @param {String} [settings.lon] Custom starting longitude as a string (writes `startingLon`).
   * @returns {Promise} Resolves when complete
   */
  function saveSettingsToJson({ mapsKey, weatherKey, geoKey, anthropicKey, airNowKey, openAqKey, lat, lon }) {
    return new Promise((resolve, reject) => {
      axios
        .put("/settings", {
          weatherApiKey: weatherKey,
          mapApiKey: mapsKey,
          reverseGeoApiKey: geoKey,
          anthropicApiKey: anthropicKey,
          airNowApiKey: airNowKey,
          openAqApiKey: openAqKey,
          startingLat: lat,
          startingLon: lon,
        })
        .then((res) => {
          resolve(res);
          setMapApiKey(mapsKey);
          setWeatherApiKey(weatherKey);
          setReverseGeoApiKey(geoKey);
          setAnthropicApiKey(anthropicKey);
          setAirNowApiKey(airNowKey);
          setOpenAqApiKey(openAqKey);
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
      showSamplingPoints,
      [key]: value,
    };
    const nextDisplay = { lightModeStyle, darkModeStyle, radarOpacityLight, radarOpacityDark };
    return axios
      .patch("/setting", { key: "advanced", val: { ai: nextAi, display: nextDisplay } })
      .then(() => {
        if (key === "radarAnalysisEnabled") setRadarAnalysisEnabled(value);
        if (key === "extendedRadius") setExtendedRadarRadius(value);
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

  // Government weather alerts polling. Fires once when mapGeo lands
  // and every GOV_ALERTS_INTERVAL afterwards (10 min — alerts don't
  // change minute-to-minute and the server caches the upstream feeds
  // for 5 min anyway, so a tighter cadence would only generate
  // redundant requests). Failures silently keep the previous list so
  // a transient network blip doesn't blank the banner.
  useEffect(() => {
    if (!mapGeo) return undefined;
    const GOV_ALERTS_INTERVAL = 10 * 60 * 1000;
    const fetchAlerts = () => {
      axios
        .get(`/api/weather-alerts?lat=${mapGeo.latitude}&lon=${mapGeo.longitude}`)
        .then((res) => setGovAlerts(Array.isArray(res.data?.alerts) ? res.data.alerts : []))
        .catch(() => undefined);
    };
    fetchAlerts();
    const interval = setInterval(fetchAlerts, GOV_ALERTS_INTERVAL);
    return () => clearInterval(interval);
  }, [mapGeo]);

  // Auto dark/light at sunrise / sunset. Runs only when the user opted
  // in via Settings AND we have valid sunrise/sunset timestamps. Checks
  // every minute (cheap — no network), plus immediately on mount/toggle.
  // Manual taps on the dark/light button disable auto via the
  // setDarkModeManual wrapper, so the user always wins.
  useEffect(() => {
    if (!darkModeAuto || !sunriseTime || !sunsetTime) return undefined;
    const apply = () => {
      const now = Date.now();
      const sunrise = new Date(sunriseTime).getTime();
      const sunset = new Date(sunsetTime).getTime();
      // sunrise-sunset.org returns today's times; if we're past sunset
      // it's "night" until midnight (and beyond, until tomorrow's
      // sunrise — but the next /api/sunrise-sunset poll refreshes the
      // window). Daytime = sunrise ≤ now < sunset.
      const shouldBeDark = !(now >= sunrise && now < sunset);
      setDarkMode((current) => (current === shouldBeDark ? current : shouldBeDark));
    };
    apply();
    const interval = setInterval(apply, 60_000);
    return () => clearInterval(interval);
  }, [darkModeAuto, sunriseTime, sunsetTime]);

  const defaultContext = {
    weatherApiKey,
    getWeatherApiKey,
    reverseGeoApiKey,
    getReverseGeoApiKey,
    anthropicApiKey,
    airNowApiKey,
    openAqApiKey,
    mapApiKey,
    getMapApiKey,
    browserGeo,
    getBrowserGeo,
    darkMode,
    setDarkMode: setDarkModeManual,
    darkModeAuto,
    saveDarkModeAuto,
    mapGeo,
    setMapGeo,
    mapTimezone,
    aiSummaryAvailable,
    setAiSummaryAvailable,
    radarAnalysisEnabled,
    extendedRadarRadius,
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
    defaultMapZoom,
    saveDefaultMapZoom,
    currentMapZoom,
    setCurrentMapZoom,
    zoomToLevel,
    setZoomToLevel,
    innerRisk,
    setInnerRisk,
    outerRisk,
    setOuterRisk,
    innerTrend,
    setInnerTrend,
    outerTrend,
    setOuterTrend,
    innerBumped,
    setInnerBumped,
    outerBumped,
    setOuterBumped,
    aqhiInfo,
    setAqhiInfo,
    govAlerts,
    animateWeatherMap,
    toggleAnimateWeatherMap,
    radarSpeed,
    cycleRadarSpeed,
    radarTimelineVisible,
    toggleRadarTimelineVisible,
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
    radarSource,
    saveRadarSource,
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
    changedDeployFiles,
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
