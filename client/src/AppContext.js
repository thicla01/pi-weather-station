import React, { createContext, useState, useEffect, useRef, useCallback, useMemo } from "react";
import { getSettings } from "~/settings";
import PropTypes from "prop-types";
import { getCoordsFromApi } from "~/services/geolocation";
import reverseGeocode from "~/services/reverseGeocode";
import { useUpdateChecker } from "~/hooks/useUpdateChecker";
import { useScreenSaver } from "~/hooks/useScreenSaver";
import { useUiPreferences } from "~/hooks/useUiPreferences";
import { useSenseHatMode } from "~/hooks/useSenseHatMode";
import useIdleDetection from "~/hooks/useIdleDetection";
import axios from "axios";
import tzlookup from "tz-lookup";

export const AppContext = createContext();

// ——— Context slices (step 2b of the AppContext split) ———
// The seven contexts below partition the legacy AppContext value into
// DISJOINT slices grouped by update cadence. The provider feeds all of
// them; AppContext (above) keeps receiving the spread union of the
// seven slices, so unmigrated consumers see the exact pre-split
// surface. New and hot-path components should subscribe to the
// narrowest slice they need instead of the union.

/**
 * Actions slice — field domain: every function exposed by the provider
 * (the get* / save* / toggle* / cycle* / select* / update* / check* /
 * load* / trigger* / refresh* helpers, the raw setState setters, the
 * debounced set*Live setters, setMapPosition / resetMapPosition,
 * saveSettingsToJson, and the setDarkMode alias of setDarkModeManual)
 * plus the shared `infoPanelScrollRef`. Update cadence: effectively
 * never — all members are identity-stable (step 2a), so the slice
 * identity survives every data refresh. The only re-mints left are
 * boot-time settles: `weatherApiKey` arriving re-mints the
 * update*WeatherData → setMapPosition → resetMapPosition chain, and
 * `browserGeo` arriving re-mints resetMapPosition. Subscribe here from
 * dispatch-only components (buttons, toggles, sliders).
 */
export const AppActionsContext = createContext(null);

/**
 * System slice — field domain: server/platform facts (API key values,
 * isLocal, remoteSecurityEnabled, debugEnabled, serverPlatform,
 * isSystemd, experimentalUiC), brightness + sleep + Sense HAT hardware
 * state, in-app updater state, and global panel/layout flags (settings
 * + debug menus, infoPanelCollapsed, the radar-maximized sentinels).
 * Update cadence: a burst at boot while settings, /api/is-local and
 * /api/update-check resolve, then rare — user panel toggles, the
 * periodic update check, brightness slider drags, sleep-stage flips.
 */
export const SystemContext = createContext(null);

/**
 * Location slice — field domain: the geographic position of record
 * (mapGeo, browserGeo, customLat/customLon, panToCoords) and its
 * derived lookups (mapTimezone, reverseGeoResult). Update cadence:
 * once at boot, then only when the user pans the map or moves the
 * marker.
 */
export const LocationContext = createContext(null);

/**
 * UI-preferences slice — field domain: per-device display preferences
 * (dark mode, units, clock, fontSize, Mapbox styles, radar opacity /
 * source / legend / timeline / speed, marker + overlay visibility,
 * advanced AI flags, AI-summary visibility, pollenEnabled,
 * defaultMapZoom, animation prefs, showAdvisoryAlerts). Update
 * cadence: only on direct user interaction with a settings control,
 * plus the sunrise/sunset auto dark-mode flip at most twice a day.
 */
export const UiPrefsContext = createContext(null);

/**
 * Weather-data slice — field domain: polled environmental payloads —
 * current / hourly / daily weather and their error states, sunrise /
 * sunset times and full payloads, air quality (aqhiInfo), pollen.
 * Update cadence: periodic — 10 min current, 30 min air quality,
 * hourly forecast + pollen, daily forecast — plus a refetch burst
 * whenever the map position changes.
 */
export const WeatherDataContext = createContext(null);

/**
 * Alerts slice — field domain: government alerts at the marker
 * (govAlerts list + the banner's cycle / expand / highlight UI state),
 * the nearby-alerts radius survey (nearbyAlerts, nearbyResidualCount,
 * showWeatherAlerts, alertRadiusKm). Update cadence: 10 min gov-alert
 * poll, 5 min nearby-alerts poll (only while the overlay is on), and
 * user taps on the banner.
 */
export const AlertsContext = createContext(null);

/**
 * Radar-state slice — field domain: the radar-risk ring levels, the
 * per-ring trend / bumped / confidence / direction-vector data pushed
 * up by WeatherMap's /api/radar-risk poll, and the live map zoom pair
 * (currentMapZoom, zoomToLevel). Update cadence: the hottest slice —
 * every radar-risk poll plus every Leaflet zoom change.
 */
export const RadarStateContext = createContext(null);

const DEFAULT_MAP_ZOOM_STORAGE_KEY = "defaultMapZoom";
const DEFAULT_MAP_ZOOM_FALLBACK = 7; // historical hard-coded value before the slider
const DARK_MODE_STORAGE_KEY = "darkMode";
// v2.15.5: sleepNightMode is *also* mirrored to localStorage so remote
// clients can persist their own palette preference across reloads. The
// canonical store is still `settings.json` (only the kiosk can write
// it via the localhost-gated PATCH), but localStorage acts as the
// per-device override when present. See `loadStoredData` and
// `saveAdvancedSleepFlag` for the read/write sides.
const NIGHT_MODE_STORAGE_KEY = "sleepNightMode";
const DARK_MODE_AUTO_STORAGE_KEY = "darkModeAuto";
const MARKER_VISIBLE_STORAGE_KEY = "markerIsVisible";
const AI_USER_VISIBLE_STORAGE_KEY = "aiSummaryUserVisible";
const MOUSE_HIDE_STORAGE_KEY = "mouseHide";
const SHOW_ADVISORY_ALERTS_STORAGE_KEY = "showAdvisoryAlerts";
const AUTO_SELECT_TAB_STORAGE_KEY = "autoSelectTab";
const SHOW_ALERT_RING_STORAGE_KEY = "showAlertRing";
const HIDE_RADAR_LEGEND_STORAGE_KEY = "hideRadarLegend";
const RADAR_SOURCE_STORAGE_KEY = "radarSource";
const RADAR_SOURCE_VALUES = ["rainviewer", "eccc"];

/**
 * App context provider.
 *
 * Architecture (step 2b of the AppContext split): one state tree feeds
 * eight providers. The seven slice contexts (AppActions, System,
 * Location, UiPrefs, WeatherData, Alerts, RadarState) partition the
 * state into disjoint groups by update cadence — each slice value is
 * its own useMemo over only its own fields, so subscribing to a slice
 * re-renders a component only when that slice's data changes. The
 * innermost AppContext.Provider receives the spread union of the seven
 * slices (memoized over the slice identities), which keeps every
 * unmigrated consumer working unchanged and makes union completeness
 * true by construction.
 *
 * Migration policy: NEW components — and existing hot-path components
 * being touched anyway — subscribe to the narrowest slice(s) they
 * need; the AppContext union is legacy compatibility only and should
 * not gain new consumers.
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

  // Full LocationIQ reverse-geocode payload for the current `mapGeo`.
  // Hoisted from `LocationName` so a second consumer
  // (`LocationDetailsPopover` on the v3 ambient hero) reads from the
  // same source without duplicating the fetch. The underlying service
  // caches by coord pair so re-pointing the marker at a previously
  // seen location is free.
  //
  // Three states the consumers care about:
  //   `undefined` — initial / fetch in-flight (no settle yet for the
  //                 current mapGeo). Consumers wait.
  //   `null`      — settled with no usable address: no mapGeo, no
  //                 API key, 204 (ocean), or upstream failure.
  //                 Consumers fall back to lat/lon.
  //   object      — the LocationIQ payload (with `.address`).
  //
  // Initial state is undefined so LocationName doesn't briefly flash
  // raw lat/lon before the first fetch resolves on a cold boot.
  // Across a mapGeo change we deliberately leave the *previous*
  // result in place until the new fetch settles, so the panel shows
  // the old city for a beat rather than going blank — matches the
  // pre-hoist LocationName behaviour.
  const [reverseGeoResult, setReverseGeoResult] = useState(undefined);
  useEffect(() => {
    if (!mapGeo || !reverseGeoApiKey) {
      setReverseGeoResult(null);
      return undefined;
    }
    let cancelled = false;
    reverseGeocode({ lat: mapGeo.latitude, lon: mapGeo.longitude })
      .then((res) => { if (!cancelled) setReverseGeoResult(res || null); })
      .catch(() => { if (!cancelled) setReverseGeoResult(null); });
    return () => { cancelled = true; };
  }, [mapGeo, reverseGeoApiKey]);

  // Push the current map view to the server's kiosk-location cache so
  // background daemons that don't know about React state — currently
  // just `tools/sensehat_weather.py` via `/api/sensehat` — can follow
  // what the user is looking at. Debounced 1 s so a quick pan across
  // the map doesn't spam the endpoint with every interim coordinate.
  // The post is best-effort: on a remote client (POST is
  // localhostOnly) the server returns 403, which we swallow — the
  // SenseHat at the friend's place still tracks its own kiosk, not
  // ours, which is the intended per-Pi semantics.
  useEffect(() => {
    if (!mapGeo || mapGeo.latitude == null || mapGeo.longitude == null) return undefined;
    const t = setTimeout(() => {
      axios.post("/api/kiosk-location", {
        lat: mapGeo.latitude,
        lon: mapGeo.longitude,
      }).catch(() => undefined);
    }, 1000);
    return () => clearTimeout(t);
  }, [mapGeo]);
  // Whether the AI weather summary feature is operational on this Pi.
  // Starts true (optimistic) and is flipped to false when the server returns
  // 503 (no Anthropic API key configured). Used by WeatherMap to conditionally
  // show the 50 km radar-analysis circle around mapGeo.
  const [aiSummaryAvailable, setAiSummaryAvailable] = useState(true);
  // v2.14.74: user-controlled AI summary visibility. `aiSummaryAvailable`
  // tracks whether the server has an Anthropic key configured (server-
  // driven, flipped to false on a 503 response). This is the user's
  // override — when false, the AI summary stays hidden even if the
  // server has the key. Exposed via a dock toggle button (debug-mode
  // only) so users can hide the section temporarily without removing
  // their key. Default true, persisted in localStorage.
  const [aiSummaryUserVisible, setAiSummaryUserVisible] = useState(true);
  // Advanced settings (advanced.ai.* in settings.json). Defaults mirror the
  // v2.6 baseline (radar analysis on, no extended radius, no doubled outer
  // points, no sampling-point overlay). Toggles flip independently and
  // persist via saveAdvancedAiFlag (no Save button — instant write on click).
  const [radarAnalysisEnabled, setRadarAnalysisEnabled] = useState(true);
  const [extendedRadarRadius, setExtendedRadarRadius] = useState(false);
  const [showSamplingPoints, setShowSamplingPoints] = useState(false);
  // Calm-day fast path — when current conditions are clearly benign (no
  // active precipitation, low precip probability, period forecast also
  // clear), the server skips the Claude call entirely and returns a
  // templated summary. Default on; opt-out via Advanced settings → AI
  // weather summary → "Calm-day fast path".
  const [calmDayFastPath, setCalmDayFastPath] = useState(true);
  // Experimental sub-tree (advanced.experimental.* in settings.json).
  // Hosts feature flags. `experimentalUiC` originally toggled the new
  // "Ambient Layers" v3 interface as an opt-in preview; v2.18 flipped
  // the default to true so every install gets v3 by default. The flag
  // stays for now as an escape hatch: a user who hits a v3-only bug can
  // flip it off in Advanced settings and fall back to the v2 stack
  // until a fix ships. v3-default + v2-fallback is a transition arc
  // — once the v3 stack absorbs a few weeks of field testing without
  // user-visible regressions, both the flag and the entire
  // `components/Settings/`, `components/Debug/`, and other v2 trees
  // will be removed in a single dedicated PR. Tracked in ROADMAP under
  // "experimentalUiC migration".
  const [experimentalUiC, setExperimentalUiC] = useState(true);
  // Mobile-only radar maximize state. LayoutMobile's `.mapCard` is
  // 220 px tall by default; tapping the maximize chevron in the
  // card's top-right corner promotes it to fill the scroll container
  // so the radar timeline scrubber and the precipitation legend
  // become readable. The flag lives in context (not local to
  // LayoutMobile) so two consumers outside the layout can react:
  //   (1) `WeatherMap` re-invalidates Leaflet's tile grid and
  //       recenters on the user's lat/lon when the flag flips, so
  //       the rings + marker stay centred after the container
  //       resizes (Leaflet keeps the same geographic centre across
  //       a size change, which made the marker drift to the top
  //       edge after maximize — user-reported on iOS).
  //   (2) `ControlButtons` greys out the radar-timeline + legend
  //       dock toggles while the card is mini and the LayoutMobile
  //       is active — the overlays they control are CSS-hidden in
  //       mini mode (no readable real estate), so the buttons
  //       would otherwise tap silently.
  // Tri-state to let ControlButtons distinguish mobile-mini from
  // non-mobile layouts (where the dock buttons should stay active):
  //   `null`  — not on LayoutMobile (Pi / Desktop). Buttons enabled.
  //   `false` — on LayoutMobile in mini mode. Timeline + legend
  //             buttons disabled with a hint toast.
  //   `true`  — on LayoutMobile, radar maximized. Buttons enabled.
  // LayoutMobile owns the lifecycle: sets `false` on mount, toggles
  // to `true` on user tap, resets to `null` on unmount. Session-only
  // state; never persisted.
  const [mobileRadarMaximized, setMobileRadarMaximized] = useState(null);
  // Same sentinel pattern as mobileRadarMaximized — `null` means
  // LayoutDesktop is not the active layout (so the focus control
  // shouldn't render anywhere); LayoutDesktop flips it to false on
  // mount and back to null on unmount. The Leaflet focus control
  // in WeatherMap reads this to decide whether to render itself.
  const [desktopRadarMaximized, setDesktopRadarMaximized] = useState(null);
  // Same sentinel pattern again, this time for LayoutPi. Added as
  // part of the v3.1 chevron → RadarFocusControl consolidation
  // (2026-05-28): the legacy chevron-driven `infoPanelCollapsed`
  // mode on LayoutPi was replaced by the same focus-mode toggle
  // LayoutDesktop already used, so the three layouts now share one
  // mental model — "tap to focus the radar, tap again to restore."
  // The WeatherMap RadarFocusControl renders whenever *either*
  // `piRadarMaximized` or `desktopRadarMaximized` is non-null, and
  // routes its toggle to whichever sentinel is active.
  // v3.2 "3 états radar": the 7" Pi screen now has THREE layout states
  // (MIN fullscreen radar / MID split / MAX forecast-forward), carried by a
  // single enum `piLayoutState: "min" | "mid" | "max" | null`. `null` keeps
  // the sentinel meaning "LayoutPi not mounted" (the WeatherMap
  // RadarFocusControl gate keys on non-null). MIN maps to the old focus-mode
  // `true`; MID/MAX map to `false`.
  const [piLayoutState, setPiLayoutState] = useState(null);
  // Back-compat shim for the still-boolean Leaflet-side consumers (WeatherMap
  // focus gate + MapResizer): they read `piRadarMaximized` (MIN ⇔ true) and
  // call `setPiRadarMaximized(bool)`. Both are projected onto the enum so
  // those files can migrate independently rather than all in one commit.
  const piRadarMaximized = piLayoutState == null ? null : piLayoutState === "min";
  const setPiRadarMaximized = useCallback((value) => {
    setPiLayoutState(value == null ? null : value ? "min" : "mid");
  }, []);
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
  // Brightness + sleep-mode state live in `~/hooks/useScreenSaver`.
  // The hook owns the /api/brightness fetch + the debounced slider
  // setter; the sleep setters are exposed back through here so
  // saveAdvancedSleepFlag below can still flip them optimistically
  // before the localhost-only PATCH that persists the value to
  // settings.json. (All sleep defaults match settings.json fallbacks:
  // disabled by default, two-stage with night-mode red palette.)
  const {
    brightnessPercent,
    brightnessAvailable,
    brightnessMinPercent,
    setBrightnessLive,
    sleepEnabled, setSleepEnabled,
    sleepStage1Delay, setSleepStage1Delay,
    sleepStage1Brightness, setSleepStage1Brightness,
    sleepStage2Enabled, setSleepStage2Enabled,
    sleepStage2Delay, setSleepStage2Delay,
    sleepNightMode, setSleepNightMode,
  } = useScreenSaver();

  // Runtime sleep-stage value (0/1/2). Hoisted into AppContext (rather
  // than living in App/index.js) so background-fetching components can
  // suspend their polling while the screensaver is up — currently
  // consumed by AiSummary + AiSummaryInline to stop the 15 min Claude
  // poll during sleep mode (each unwatched poll either burns a cache
  // miss → one Anthropic call, or a cache hit → still wasted CPU for
  // a screen nobody is looking at). The hook returns stage=0 when
  // sleepEnabled is false, so the cost stays zero for opt-out users.
  const { stage: sleepStage } = useIdleDetection({
    enabled: sleepEnabled,
    stage1Delay: sleepStage1Delay,
    stage2Enabled: sleepStage2Enabled,
    stage2Delay: sleepStage2Delay,
  });
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
  // Display preferences (units + clock + fontSize) — localStorage-backed
  // with one-time first-launch seeding from the browser locale. Owned by
  // ~/hooks/useUiPreferences. The save* helpers each update React state
  // AND write localStorage in one step (the same pattern AppContext used
  // inline before the extraction).
  const {
    tempUnit, saveTempUnit,
    speedUnit, saveSpeedUnit,
    lengthUnit, saveLengthUnit,
    distanceUnit, saveDistanceUnit,
    pressureUnit, savePressureUnit,
    clockTime, saveClockTime,
    fontSize, saveFontSize,
  } = useUiPreferences();

  // Sense HAT display-mode toggle — server side probes `import sense_hat`
  // once and toggles between pi-sensehat.service (weather animations) and
  // pi-sensehat-clock.service (HH:MM clock). Available only on the one
  // Pi in the current fleet that has the HAT physically attached;
  // `senseHatAvailable` gates the UI toggle on every other host.
  const {
    senseHatAvailable,
    senseHatMode,
    saveSenseHatMode,
    senseHatClockBrightness,
    setSenseHatClockBrightnessLive,
    senseHatRadarBrightness,
    setSenseHatRadarBrightnessLive,
  } = useSenseHatMode();

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
  // Confidence score (0-100) for each ring's trend label. Surfaced from
  // the server's intensity-weighted summarizeRingTrend so consumers (debug
  // panel, future banner-hedging logic, AI-summary prompt) can hedge
  // wording when the data only weakly supports the chosen trend.
  const [innerTrendConfidence, setInnerTrendConfidence] = useState(0);
  const [outerTrendConfidence, setOuterTrendConfidence] = useState(0);
  // Per-direction vectors surfaced from /api/radar-risk for the optional
  // arrow overlay on the map. Each entry: { direction, peakDistance,
  // peakIntensity, magnitude, trend, confidence }. Stable directions are
  // already filtered server-side so the array is "actionable directions
  // only". Empty by default; populated by the WeatherMap fetcher.
  const [innerDirectionVectors, setInnerDirectionVectors] = useState([]);
  const [outerDirectionVectors, setOuterDirectionVectors] = useState([]);
  // Toggle for the arrow overlay. Persisted in localStorage so power users
  // who keep arrows on while debugging don't have to re-enable on every
  // reload. Default OFF — kiosk view should stay clean.
  const [showDirectionArrows, setShowDirectionArrows] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("showDirectionArrows") === "true";
  });
  const toggleDirectionArrows = useCallback(() => {
    setShowDirectionArrows((prev) => {
      const next = !prev;
      try { window.localStorage.setItem("showDirectionArrows", String(next)); } catch { /* localStorage may be unavailable */ }
      return next;
    });
  }, []);
  // Nearby-alerts overlay — a display-only radius survey of active
  // government alerts (the map layer added in Phase 2). On/off is a
  // per-device view preference like showDirectionArrows (localStorage,
  // default OFF so the kiosk stays quiet until opted in); the radius
  // magnitude is a configured value persisted server-side in
  // advanced.alerts.radius. The dock toggle, tap popup and radius slider
  // arrive in Phase 3 — Phase 2 wires the data + map layer only.
  const [showWeatherAlerts, setShowWeatherAlerts] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("showWeatherAlerts") === "true";
  });
  const toggleWeatherAlerts = useCallback(() => {
    setShowWeatherAlerts((prev) => {
      const next = !prev;
      try { window.localStorage.setItem("showWeatherAlerts", String(next)); } catch { /* localStorage may be unavailable */ }
      return next;
    });
  }, []);
  // Whether the dashed radius ring is drawn alongside the nearby-alerts
  // layer. Per-device display preference (localStorage), DEFAULT ON so the
  // existing "polygons + ring" look is preserved; a user who wants the bare
  // alert polygons (no proxy circle) turns it off. Gates only the <Circle>
  // in WeatherMap — the polygons stay on showWeatherAlerts alone. Settings
  // toggle via saveBoolFlag → saveShowAlertRing.
  const [showAlertRing, setShowAlertRing] = useState(() => {
    if (typeof window === "undefined") return true;
    // Default ON — only an explicit stored "false" hides the ring.
    return window.localStorage.getItem(SHOW_ALERT_RING_STORAGE_KEY) !== "false";
  });
  // Canonical alert-survey radius in KILOMETRES (the Phase 3 slider derives
  // its mi labels from this). Default 50 km — the quietest stop; overwritten
  // from advanced.alerts.radius on settings load.
  const [alertRadiusKm, setAlertRadiusKm] = useState(50);
  // In-radius alerts (each with geometry) from /api/nearby-alerts, plus the
  // count of active alerts in the queried area that have no mappable polygon
  // (the "+N not mapped" legend note, surfaced in Phase 3).
  const [nearbyAlerts, setNearbyAlerts] = useState([]);
  const [nearbyResidualCount, setNearbyResidualCount] = useState(0);
  // Last AQHI payload returned by /api/air-quality (lifted from
  // <UvAqiBadges> so the Debug panel can display the chosen station's
  // name, distance, observation/forecast kind without refetching).
  // null = no fetch yet, out of coverage, or upstream failure.
  const [aqhiInfo, setAqhiInfo] = useState(null);
  // Pollen badge — opt-in (advanced.pollen.enabled). Coverage is
  // strong in Europe (CAMS native) and acceptable in North America
  // (CAMS global via GEOS-CF), but blank in many regions. When
  // /api/pollen returns `available: false` the MetricsGrid hides
  // the 5th cell silently.
  const [pollenInfo, setPollenInfo] = useState(null);
  const [pollenEnabled, setPollenEnabled] = useState(false);
  // Active government weather alerts at mapGeo, sorted server-side by
  // descending severity. NWS for the US, ECCC for Canada — see
  // server/govAlertsCtrl.js. Empty array means "no upstream alert
  // covers this point right now"; the radar-derived banner remains
  // the source of truth in that case. The poll uses the same 10 min
  // cadence the roadmap specified — alerts don't change minute-to-
  // minute and the upstreams already cache aggressively.
  const [govAlerts, setGovAlerts] = useState([]);
  // Mirror ref (same convention as LayoutMobile's pullArmedRef):
  // `govAlerts` is replaced by the 10-min poll further down, and having
  // the two alert-index callbacks below close over it gave them a fresh
  // identity on every poll payload — which rippled a new context value
  // to every consumer. They only need the list length *at call time*
  // (user taps the banner / a mini-card), so they read through the ref
  // and keep empty dep arrays. The mirror effect re-runs on every
  // govAlerts commit, so the ref is always current before any tap can
  // land.
  const govAlertsRef = useRef(govAlerts);
  useEffect(() => { govAlertsRef.current = govAlerts; }, [govAlerts]);
  // Cycle index shared between AlertBanner (taps cycle the banner content)
  // and GovAlertDetail (the description section that mirrors the banner's
  // currently-displayed alert). Lives in context so the two components
  // stay in sync without prop-drilling or a duplicate state machine. The
  // cycleGovAlert callback wraps the modulo and the bounds check so
  // callers don't need to know the list length.
  const [govAlertIdx, setGovAlertIdx] = useState(0);
  const cycleGovAlert = useCallback(() => {
    const alerts = govAlertsRef.current;
    const len = Array.isArray(alerts) ? alerts.length : 0;
    setGovAlertIdx((prev) => (len > 0 ? (prev + 1) % len : 0));
  }, []);
  // v3.1 Phase 4c: explicit jump-to-alert by absolute index, used
  // when the user taps a mini-card in the "other active alerts"
  // list under the primary card. `cycleGovAlert` still exists for
  // any caller that wants the forward-cycle semantics (none in v3
  // post-4c, but kept for v2 InfoPanel compatibility). Bounds-
  // checked: out-of-range arguments collapse to 0 so a stale
  // mini-card click after the list shrinks can't put us into a
  // bad index.
  const selectGovAlert = useCallback((idx) => {
    const alerts = govAlertsRef.current;
    const len = Array.isArray(alerts) ? alerts.length : 0;
    if (len === 0) { setGovAlertIdx(0); return; }
    const safe = Number.isInteger(idx) && idx >= 0 && idx < len ? idx : 0;
    setGovAlertIdx(safe);
  }, []);
  // Reset cycle when the alert list shrinks (an alert expired, a new
  // payload landed with fewer entries). Otherwise the index could point
  // past the end and render the wrong description.
  useEffect(() => {
    const len = Array.isArray(govAlerts) ? govAlerts.length : 0;
    if (len > 0 && govAlertIdx >= len) setGovAlertIdx(0);
  }, [govAlerts, govAlertIdx]);
  // v3.1 Phase 4: the alert head (AlertBanner) is now the user-facing
  // toggle for the detail body (AlertDetailInline). Hoisting the
  // `expanded` state to context lets both components read/write a
  // shared truth without prop-drilling through the layout shell.
  // Default false — alerts arrive collapsed; the user opts in to
  // reading the body. Same maintainer-stated rationale documented in
  // `CLAUDE.md` under "Gov-alert detail section — reading-first UX".
  const [govAlertExpanded, setGovAlertExpanded] = useState(false);
  // Phase 4d (2026-05-28): id of the alert whose `geometry` is
  // currently overlaid on the radar via a Leaflet GeoJSON layer.
  // Null = no overlay. Set by the AlertBanner's "Voir sur la carte"
  // button (which also triggers a fitBounds on the WeatherMap so
  // the user actually sees the zone). Persists until the user taps
  // the button again to clear, or until a new alert replaces the
  // active one (effect below). The button only renders when the
  // current alert has a non-null geometry; ECCC always carries one
  // (server-side pointInPolygon depends on it), NWS only carries
  // one for geo-targeted alerts (Tornado Warning, etc.) and not for
  // broad zone-based alerts (Special Weather Statement, advisory
  // products) where the upstream omits the polygon.
  const [highlightedAlertId, setHighlightedAlertId] = useState(null);
  // Collapse the detail whenever the active alert changes (cycle bumps
  // the index or a new payload lands). Avoids the case where the user
  // expanded alert A's description, the list reshuffles, and they're
  // suddenly reading alert B's body without realising it.
  useEffect(() => {
    setGovAlertExpanded(false);
    // Same logic for the map overlay (Phase 4d): if the active alert
    // changes (cycle / new payload), clear the geometry overlay so
    // the new alert's "Voir sur la carte" is a fresh affordance
    // rather than the previous alert's polygon ghost.
    setHighlightedAlertId(null);
  }, [govAlertIdx]);
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
  // Per-device opt-in to surface yellow-tier (advisory) government
  // alerts. Off by default; persisted to localStorage like mouseHide.
  // Threaded into selectEligibleGovAlerts via useEligibleGovAlerts.
  const [showAdvisoryAlerts, setShowAdvisoryAlerts] = useState(false);
  // Per-device opt-in to auto-select the forecast chart's metric tab from
  // active hazards (gov alerts / forecast). Off by default (LLD §7);
  // persisted to localStorage like showAdvisoryAlerts. Consumed by
  // useAutoTabSelector via UiPrefsContext.
  const [autoSelectTab, setAutoSelectTab] = useState(false);
  const [hideRadarLegend, setHideRadarLegend] = useState(false);
  // Visual radar source on the map. "rainviewer" (default) keeps the existing
  // CDN-cached PNG tiles + timeline scrubber; "eccc" swaps to Environment
  // Canada's WMS for fresher (6-min) Canadian-authority radar at the cost of
  // the timeline (ECCC's WMS time-dimension support is a Phase B item). The
  // server-side radar analyzer always uses RainViewer regardless — this
  // setting only affects the visible tile layer.
  const [radarSource, setRadarSource] = useState("rainviewer");
  const [infoPanelCollapsed, setInfoPanelCollapsed] = useState(false);
  const [sunriseTime, setSunriseTime] = useState(null);
  const [sunsetTime, setSunsetTime] = useState(null);
  // Full sunrise-sunset.org payloads for today AND tomorrow, used by
  // SunDetailsPopover. Keys mirror the upstream API ('sunrise', 'sunset',
  // 'civil_twilight_begin', 'civil_twilight_end', 'day_length') so the
  // popover can read fields directly without renaming. Each side is
  // `null` until the first fetch resolves, or if the upstream call for
  // that day failed (the popover renders em-dashes in that case).
  const [sunriseSunsetToday, setSunriseSunsetToday] = useState(null);
  const [sunriseSunsetTomorrow, setSunriseSunsetTomorrow] = useState(null);
  const [isLocal, setIsLocal] = useState(true);
  const [remoteSecurityEnabled, setRemoteSecurityEnabled] = useState(false);
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [debugMenuOpen, setDebugMenuOpen] = useState(false);
  const infoPanelScrollRef = useRef(null); // set by InfoPanel on the scroll container

  // In-app update flow — state, the periodic /api/update-check poll, and
  // the three actions (refreshUpdateCheck, triggerUpdate, saveSkippedSha)
  // live in `~/hooks/useUpdateChecker`. The setters are still surfaced
  // through this context for back-compat with Debug/index.js, which
  // seeds updateInfo from /api/debug rather than calling
  // refreshUpdateCheck directly.
  const {
    updateAvailable, setUpdateAvailable,
    latestVersion, setLatestVersion,
    latestSha, setLatestSha,
    updateCommits, setUpdateCommits,
    changedDeployFiles,
    needsManualUpgrade,
    skippedSha,
    updateModalOpen, setUpdateModalOpen,
    updateState, setUpdateState,
    updateErrorMessage,
    serverPlatform,
    isSystemd,
    refreshUpdateCheck,
    triggerUpdate,
    saveSkippedSha,
  } = useUpdateChecker();

  /**
   * Save mouse hide state
   *
   * @param {Boolean} newVal
   */
  const saveMouseHide = useCallback((newVal) => {
    let newState;
    try {
      newState = JSON.parse(newVal);
    } catch (e) {
      console.log("saveMouseHide", e);
      return;
    }
    setMouseHide(newState);
    window.localStorage.setItem(MOUSE_HIDE_STORAGE_KEY, newState);
  }, []);

  /**
   * Save the "show advisory alerts" opt-in (per-device).
   *
   * @param {Boolean} newVal — JSON-encoded boolean, passed by the
   *   Settings toggle via saveBoolFlag
   */
  const saveShowAdvisoryAlerts = useCallback((newVal) => {
    let newState;
    try {
      newState = JSON.parse(newVal);
    } catch (e) {
      console.log("saveShowAdvisoryAlerts", e);
      return;
    }
    setShowAdvisoryAlerts(newState);
    window.localStorage.setItem(SHOW_ADVISORY_ALERTS_STORAGE_KEY, newState);
  }, []);

  /**
   * Save the per-device "auto-select forecast tab" opt-in. Mirrors
   * saveShowAdvisoryAlerts (JSON-encoded boolean from the Settings Toggle).
   *
   * @param {String} newVal JSON-encoded boolean ("true" / "false")
   */
  const saveAutoSelectTab = useCallback((newVal) => {
    let newState;
    try {
      newState = JSON.parse(newVal);
    } catch (e) {
      console.log("saveAutoSelectTab", e);
      return;
    }
    setAutoSelectTab(newState);
    window.localStorage.setItem(AUTO_SELECT_TAB_STORAGE_KEY, newState);
  }, []);

  /**
   * Save the "show alert radius ring" preference (per-device).
   *
   * @param {Boolean} newVal — JSON-encoded boolean, passed by the
   *   Settings toggle via saveBoolFlag
   */
  const saveShowAlertRing = useCallback((newVal) => {
    let newState;
    try {
      newState = JSON.parse(newVal);
    } catch (e) {
      console.log("saveShowAlertRing", e);
      return;
    }
    setShowAlertRing(newState);
    window.localStorage.setItem(SHOW_ALERT_RING_STORAGE_KEY, newState);
  }, []);

  /**
   * Save hide radar legend state
   *
   * @param {Boolean} newVal
   */
  const saveHideRadarLegend = useCallback((newVal) => {
    let newState;
    try {
      newState = JSON.parse(newVal);
    } catch (e) {
      console.log("saveHideRadarLegend", e);
      return;
    }
    setHideRadarLegend(newState);
    window.localStorage.setItem(HIDE_RADAR_LEGEND_STORAGE_KEY, newState);
  }, []);

  /**
   * Save radar source preference (rainviewer | eccc).
   *
   * @param {string} newVal
   */
  const saveRadarSource = useCallback((newVal) => {
    if (!RADAR_SOURCE_VALUES.includes(newVal)) return;
    setRadarSource(newVal);
    window.localStorage.setItem(RADAR_SOURCE_STORAGE_KEY, newVal);
  }, []);

  // saveClockTime / saveTempUnit / saveSpeedUnit / saveLengthUnit /
  // saveDistanceUnit / saveFontSize all live in ~/hooks/useUiPreferences
  // now and are destructured at the top of this provider.

  /**
   * Save the auto-dark-mode preference. Persisted under
   * DARK_MODE_AUTO_STORAGE_KEY; the polling effect below picks it up and
   * starts/stops the sunrise/sunset checks accordingly.
   *
   * @param {Boolean} newVal
   */
  const saveDarkModeAuto = useCallback((newVal) => {
    const next = Boolean(newVal);
    setDarkModeAuto(next);
    window.localStorage.setItem(DARK_MODE_AUTO_STORAGE_KEY, String(next));
  }, []);

  /**
   * Set AI summary user-visible preference + persist to localStorage.
   * Separate from the server-driven `aiSummaryAvailable` so a user can
   * hide the section temporarily without losing it when their Anthropic
   * key still works server-side. Components rendering the AI summary
   * should check both: `aiSummaryAvailable && aiSummaryUserVisible`.
   *
   * @param {Boolean} newVal next visibility
   */
  const saveAiSummaryUserVisible = useCallback((newVal) => {
    const next = Boolean(newVal);
    setAiSummaryUserVisible(next);
    try { window.localStorage.setItem(AI_USER_VISIBLE_STORAGE_KEY, String(next)); } catch { /* localStorage may be unavailable */ }
  }, []);

  /**
   * Manual dark/light toggle wrapper — same shape as setDarkMode for
   * existing call sites. v2.14.72: stopped silently disabling auto
   * mode here. Once the dock got a dedicated auto-mode toggle the
   * "tap contrast = disable auto" side effect became surprising
   * (the auto button is visibly ON, and toggling contrast shouldn't
   * silently turn it off — the user can see auto's state at a glance
   * and disable it explicitly if they want). The auto interval will
   * re-flip the manual choice at the next sunrise / sunset boundary
   * if auto is still on; that's the trade-off the user accepted by
   * leaving auto enabled.
   *
   * @param {Boolean} next
   */
  const setDarkModeManual = useCallback((next) => {
    setDarkMode(next);
    // v2.14.74: persist the manual choice. If auto-mode is on, the
    // next interval check will potentially flip it back based on
    // sunrise/sunset — that's expected behaviour. The persisted
    // value is the last manual flip, restored at boot via
    // loadStoredData().
    try { window.localStorage.setItem(DARK_MODE_STORAGE_KEY, String(Boolean(next))); } catch { /* localStorage may be unavailable */ }
  }, []);

  /**
   * Save default map zoom (used on next page load) and trigger a live preview
   * by signalling the ZoomLevelHandler in WeatherMap to call map.setZoom.
   * Without the live preview, sliding the control would feel inert until the
   * user reloaded — confusing.
   *
   * @param {Number} newVal Zoom level (4–12)
   */
  const saveDefaultMapZoom = useCallback((newVal) => {
    const n = Math.round(Number(newVal));
    if (!Number.isFinite(n)) return;
    setDefaultMapZoom(n);
    setZoomToLevel(n);
    window.localStorage.setItem(DEFAULT_MAP_ZOOM_STORAGE_KEY, String(n));
  }, []);

  const checkIsLocal = useCallback(() => {
    axios.get("/api/is-local").then((res) => {
      setIsLocal(res.data.isLocal);
      setRemoteSecurityEnabled(res.data.securityEnabled ?? false);
      setDebugEnabled(res.data.debugEnabled ?? false);
    }).catch(() => {
      // non-critical — defaults stay (localhost assumed, security disabled)
    });
  }, []);

  // Mirror refs for the two menu-open flags (LayoutMobile pullArmedRef
  // convention). The toggle callbacks below can't be plain functional
  // updates: each one conditionally closes the *other* panel based on
  // the current value, and calling a second setter from inside a
  // functional updater would make the updater impure (StrictMode
  // double-invokes updaters). Reading the current value through the
  // ref keeps the cross-close logic in the callback body, the dep
  // arrays empty, and the identities stable. The mirror effects also
  // track direct external writes via the raw setters exposed in the
  // context value (e.g. getWeatherApiKey's setSettingsMenuOpen(true)).
  const settingsMenuOpenRef = useRef(settingsMenuOpen);
  useEffect(() => { settingsMenuOpenRef.current = settingsMenuOpen; }, [settingsMenuOpen]);
  const debugMenuOpenRef = useRef(debugMenuOpen);
  useEffect(() => { debugMenuOpenRef.current = debugMenuOpen; }, [debugMenuOpen]);

  /**
   * Toggles debug menu open/closed — closes settings panel if open
   */
  const toggleDebugMenuOpen = useCallback(() => {
    const next = !debugMenuOpenRef.current;
    if (next) setSettingsMenuOpen(false);
    setDebugMenuOpen(next);
  }, []);

  const loadStoredData = useCallback(() => {
    // Unit + clock + fontSize prefs (including first-launch system-prefs
    // seeding from the browser locale) are owned by useUiPreferences —
    // see `~/hooks/useUiPreferences`. That hook runs its own one-time
    // bootstrap effect on AppContext mount, so by the time App calls
    // loadStoredData() the unit state is already hydrated. The rest of
    // this function handles the other localStorage-backed keys.
    const storedZoom = window.localStorage.getItem(DEFAULT_MAP_ZOOM_STORAGE_KEY);
    const storedDarkAuto = window.localStorage.getItem(DARK_MODE_AUTO_STORAGE_KEY);

    let mouseHide;
    try {
      mouseHide = JSON.parse(
        window.localStorage.getItem(MOUSE_HIDE_STORAGE_KEY)
      );
    } catch (e) {
      console.log("mouseHide", e);
    }

    setMouseHide(!!mouseHide);

    let showAdvisoryAlerts;
    try {
      showAdvisoryAlerts = JSON.parse(
        window.localStorage.getItem(SHOW_ADVISORY_ALERTS_STORAGE_KEY)
      );
    } catch (e) {
      console.log("showAdvisoryAlerts", e);
    }
    setShowAdvisoryAlerts(!!showAdvisoryAlerts);

    let autoSelectTab;
    try {
      autoSelectTab = JSON.parse(
        window.localStorage.getItem(AUTO_SELECT_TAB_STORAGE_KEY)
      );
    } catch (e) {
      console.log("autoSelectTab", e);
    }
    setAutoSelectTab(!!autoSelectTab);

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

    const parsedZoom = parseInt(storedZoom, 10);
    if (Number.isFinite(parsedZoom)) {
      setDefaultMapZoom(parsedZoom);
      setCurrentMapZoom(parsedZoom);
    }
    if (storedDarkAuto === "true") setDarkModeAuto(true);
    // v2.14.74: restore the manual dark-mode choice. When auto-mode
    // is also on, the polling interval (further down in this file)
    // re-evaluates on mount and will override this restored value
    // if the time of day says otherwise — that's intentional, the
    // restored value is just a "last known state" so cold boots
    // don't surprise the user by flipping back to the useState
    // default while the auto-poll catches up.
    const storedDark = window.localStorage.getItem(DARK_MODE_STORAGE_KEY);
    if (storedDark === "true" || storedDark === "false") {
      setDarkMode(storedDark === "true");
    }
    // Restore marker visibility — default useState is `true`, so we
    // only override when the persisted value is explicitly "false".
    const storedMarker = window.localStorage.getItem(MARKER_VISIBLE_STORAGE_KEY);
    if (storedMarker === "false") setMarkerIsVisible(false);
    // AI summary user-visible — same pattern: default true, override
    // only on explicit "false".
    const storedAiVisible = window.localStorage.getItem(AI_USER_VISIBLE_STORAGE_KEY);
    if (storedAiVisible === "false") setAiSummaryUserVisible(false);
    // sleepNightMode override — restored AFTER any server fetch in
    // `loadStoredData`'s caller chain so it wins. This makes the
    // remote-client palette toggle stick across reloads (user-
    // reported on iOS: tapping the moon button flipped the palette
    // but a reload reverted it because the server `nightMode` value
    // had stayed `true` while the local PATCH was 403'd).
    const storedNightMode = window.localStorage.getItem(NIGHT_MODE_STORAGE_KEY);
    if (storedNightMode === "true" || storedNightMode === "false") {
      setSleepNightMode(storedNightMode === "true");
    }
  }, [setSleepNightMode]);

  /**
   * Set custom starting lat/lon
   *
   * @returns {Promise} lat/lon
   * @private
   */
  const getCustomLatLon = useCallback(() => {
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
              if (advancedAi.calmDayFastPath !== undefined) {
                setCalmDayFastPath(Boolean(advancedAi.calmDayFastPath));
              }
            }
            // Pollen badge — opt-in via advanced.pollen.enabled.
            // Defaults to OFF so installs that don't care about
            // pollen never burn the upstream quota or grow the grid.
            const advancedPollen = res.advanced && res.advanced.pollen;
            if (advancedPollen && advancedPollen.enabled !== undefined) {
              setPollenEnabled(Boolean(advancedPollen.enabled));
            }
            // Experimental sub-tree — opt-in feature flags. The first
            // one is experimentalUiC (Direction C UI preview, Phase 0+
            // of the v3.0.0 rollout). Defaults to false; ignored unless
            // present in the payload. See
            // `docs/ui-direction-c-implementation-plan.md`.
            const advancedExperimental = res.advanced && res.advanced.experimental;
            if (advancedExperimental) {
              setExperimentalUiC(Boolean(advancedExperimental.uiC));
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
            // Nearby-alerts radius (advanced.alerts.radius), canonical km.
            const advancedAlerts = res.advanced && res.advanced.alerts;
            if (advancedAlerts && typeof advancedAlerts.radius === "number") {
              setAlertRadiusKm(advancedAlerts.radius);
            }
            // Sleep mode (advanced.sleep.*). All optional — fall back to
            // defaults already declared in useState if absent or malformed.
            const advancedSleep = res.advanced && res.advanced.sleep;
            if (advancedSleep) {
              if (typeof advancedSleep.enabled === "boolean") {
                setSleepEnabled(advancedSleep.enabled);
              }
              if (typeof advancedSleep.stage1Delay === "number") {
                setSleepStage1Delay(advancedSleep.stage1Delay);
              }
              if (typeof advancedSleep.stage1Brightness === "number") {
                setSleepStage1Brightness(advancedSleep.stage1Brightness);
              }
              if (typeof advancedSleep.stage2Enabled === "boolean") {
                setSleepStage2Enabled(advancedSleep.stage2Enabled);
              }
              if (typeof advancedSleep.stage2Delay === "number") {
                setSleepStage2Delay(advancedSleep.stage2Delay);
              }
              if (typeof advancedSleep.nightMode === "boolean") {
                // localStorage takes precedence over the server-side
                // value: a remote client's saveAdvancedSleepFlag
                // optimistic-flips the local state but its PATCH is
                // 403'd, so the server's settings.json keeps its old
                // value. Without this guard, the next page load would
                // pull the server's old value back into state and
                // override the user's choice — the symptom reported
                // on iOS ("le réglage du mode rouge n'est pas
                // mémorisé"). On the kiosk's own browser the two
                // stores agree (the PATCH succeeds AND localStorage
                // gets the same value), so the guard is a no-op there.
                const storedNightMode = (() => {
                  try { return window.localStorage.getItem(NIGHT_MODE_STORAGE_KEY); }
                  catch { return null; }
                })();
                if (storedNightMode !== "true" && storedNightMode !== "false") {
                  setSleepNightMode(advancedSleep.nightMode);
                }
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
  }, [
    setSleepEnabled,
    setSleepStage1Delay,
    setSleepStage1Brightness,
    setSleepStage2Enabled,
    setSleepStage2Delay,
    setSleepNightMode,
  ]);

  // NOTE: setMapPosition / resetMapPosition are declared further down,
  // after the updateCurrent/Hourly/DailyWeatherData callbacks they call —
  // `const` + useCallback declarations aren't hoisted like the old
  // `function` forms were, so the callees must come first (TDZ).

  /**
   * Gets geolocation and sets it, unless custom starting coordinates are provided.
   *
   * @returns {object} coords
   */
  const getBrowserGeo = useCallback(() => {
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
  }, [getCustomLatLon]);

  /**
   * Retrieves weather API key and sets it
   *
   * @returns {Promise} Weather API Key
   */
  const getWeatherApiKey = useCallback(() => {
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
  }, []);

  /**
   * Retrieves map API key and sets it
   *
   * @returns {Promise} Weather API Key
   */
  const getMapApiKey = useCallback(() => {
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
  }, []);

  /**
   * Retrieves reverse geolocation API key and sets it
   *
   * @returns {Promise} Weather API Key
   */
  const getReverseGeoApiKey = useCallback(() => {
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
  }, []);

  // Load the weather + reverse-geo API keys on AppContext mount.
  // Historically this was triggered by the v2 `WeatherInfo` component
  // mounting (see `components/WeatherInfo/index.js`). v2.18 made v3
  // the default, and v3 layouts (LayoutPi / LayoutDesktop / LayoutMobile)
  // don't mount WeatherInfo at all — so the two keys stayed null
  // forever and the useEffect at the weather-poll site never fired,
  // leaving `currentWeatherData` null + `LocationName` falling back to
  // raw lat/lon. Same mount-trigger bug pattern the air-quality fetch
  // already had to solve (see the `aqhiInfo` polling effect below).
  // The map API key isn't loaded here because WeatherMap still mounts
  // in both v2 and v3 and triggers its own getMapApiKey().
  useEffect(() => {
    if (!weatherApiKey) {
      getWeatherApiKey().catch((err) => {
        console.log("error getting weather api key:", err);
      });
    }
    if (!reverseGeoApiKey) {
      getReverseGeoApiKey().catch((err) => {
        console.log("error getting reverse geo api key:", err);
      });
    }
  }, [weatherApiKey, reverseGeoApiKey, getWeatherApiKey, getReverseGeoApiKey]);

  /**
   * Updates hourly weather data
   *
   * @param {object} coords
   * @param {Number} coords.latitude latitude
   * @param {Number} coords.longitude longitude
   *
   * @returns {Promise} hourly weather data
   */
  const updateHourlyWeatherData = useCallback((coords) => {
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
  }, [weatherApiKey]);

  /**
   * Updates daily  weather data
   *
   * @param {object} coords
   * @param {Number} coords.latitude latitude
   * @param {Number} coords.longitude longitude
   *
   * @returns {Promise} daily weather data
   */
  const updateDailyWeatherData = useCallback((coords) => {
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
  }, [weatherApiKey]);

  const updateSunriseSunset = useCallback((coords) => {
    return new Promise((resolve, reject) => {
      if (!coords) {
        setSunriseTime(null);
        setSunsetTime(null);
        return reject("No coords");
      }
      const { latitude, longitude } = coords;

      // Pass today's LOCAL date so the upstream API returns sunrise /
      // sunset for the user's day rather than "today UTC" — which,
      // for users west of UTC during evening hours, is already the
      // next UTC day and skips over today's local sunset (auto
      // dark-mode flipped early as a result).
      const d = new Date();
      const localDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      axios
        .get(`/api/sunrise-sunset?lat=${latitude}&lon=${longitude}&date=${localDate}&tomorrow=1`)
        .then((res) => {
          const { results, tomorrowResults } = res.data;
          if (results) {
            const { sunrise, sunset } = results;
            setSunriseTime(sunrise);
            setSunsetTime(sunset);
            setSunriseSunsetToday(results);
          } else {
            setSunriseTime(null);
            setSunsetTime(null);
            setSunriseSunsetToday(null);
          }
          // `tomorrowResults` is only present when the upstream
          // tomorrow call succeeded server-side (failure there is
          // non-fatal and just omits the field). Mirror that here.
          setSunriseSunsetTomorrow(tomorrowResults || null);
          resolve(results);
        })
        .catch((err) => {
          setSunriseTime(null);
          setSunsetTime(null);
          setSunriseSunsetToday(null);
          setSunriseSunsetTomorrow(null);
          reject(err);
        });
    });
  }, []);

  /**
   * Updates current weather data
   *
   * @param {object} coords
   * @param {Number} coords.latitude latitude
   * @param {Number} coords.longitude longitude
   *
   * @returns {Promise} current weather data
   */
  const updateCurrentWeatherData = useCallback((coords) => {
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
  }, [weatherApiKey]);

  /**
   * Set the map to a given position
   *
   * @param {object} coords coordinates
   * @param {String} coords.latitude
   * @param {String} coords.longitude
   */
  const setMapPosition = useCallback((coords) => {
    updateCurrentWeatherData(coords);
    updateHourlyWeatherData(coords);
    updateDailyWeatherData(coords);
    setMapGeo(coords);
    setPanToCoords(coords);
  }, [updateCurrentWeatherData, updateHourlyWeatherData, updateDailyWeatherData]);

  /**
   * Return the map position to browser geolocation coordinates
   */
  const resetMapPosition = useCallback(() => {
    setMapPosition(browserGeo);
  }, [setMapPosition, browserGeo]);

  // Mirror ref for markerIsVisible (same convention as the menu-open
  // refs above). The toggle persists to localStorage, and a side effect
  // is not allowed inside a functional setState updater (updaters must
  // stay pure — StrictMode double-invokes them), so the toggle reads
  // the current value through the ref and keeps the write in its own
  // body. The mirror effect also tracks the loadStoredData() restore
  // path, which sets the state directly.
  const markerIsVisibleRef = useRef(markerIsVisible);
  useEffect(() => { markerIsVisibleRef.current = markerIsVisible; }, [markerIsVisible]);

  /**
   * Toggles the marker on and off
   */
  const toggleMarker = useCallback(() => {
    const next = !markerIsVisibleRef.current;
    setMarkerIsVisible(next);
    // v2.14.74: persist the visibility choice. Default true on first
    // boot; restored from localStorage on subsequent boots.
    try { window.localStorage.setItem(MARKER_VISIBLE_STORAGE_KEY, String(next)); } catch { /* localStorage may be unavailable */ }
  }, []);

  /**
   * Toggles weather map animation on/off
   */
  const toggleAnimateWeatherMap = useCallback(() => {
    // Pure flip, no side effects — a functional update keeps the
    // identity stable without needing a mirror ref.
    setAnimateWeatherMap((prev) => !prev);
  }, []);

  /**
   * Toggles settings menu open/closed — closes debug panel if open
   */
  const toggleSettingsMenuOpen = useCallback(() => {
    const next = !settingsMenuOpenRef.current;
    if (next) setDebugMenuOpen(false);
    setSettingsMenuOpen(next);
  }, []);

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
  const saveSettingsToJson = useCallback(({ mapsKey, weatherKey, geoKey, anthropicKey, airNowKey, openAqKey, lat, lon }) => {
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
  }, []);

  // Single object-ref mirroring the 17 advanced.* atoms that feed the
  // PATCH payload below (LayoutMobile pullArmedRef convention, batched).
  // Pre-step-2a, buildAdvancedSubtree listed all 17 atoms as deps, so
  // any advanced.* change minted a new builder identity AND new
  // identities for its eight dependents (the saveAdvanced*Flag helpers
  // + the three debounced slider setters) — a fresh context value for
  // every consumer on every slider tick. The builder now reads through
  // this ref at call time instead, so the whole chain is
  // identity-stable. The mirror effect is cheap: it runs only when one
  // of the 17 atoms actually changes. Seeded with the first-render
  // values (useRef ignores the initializer afterwards) so the ref is
  // never null even before the first effect commit.
  const advancedStateRef = useRef({
    radarAnalysisEnabled,
    extendedRadarRadius,
    showSamplingPoints,
    calmDayFastPath,
    lightModeStyle,
    darkModeStyle,
    radarOpacityLight,
    radarOpacityDark,
    sleepEnabled,
    sleepStage1Delay,
    sleepStage1Brightness,
    sleepStage2Enabled,
    sleepStage2Delay,
    sleepNightMode,
    experimentalUiC,
    pollenEnabled,
    alertRadiusKm,
  });
  useEffect(() => {
    advancedStateRef.current = {
      radarAnalysisEnabled,
      extendedRadarRadius,
      showSamplingPoints,
      calmDayFastPath,
      lightModeStyle,
      darkModeStyle,
      radarOpacityLight,
      radarOpacityDark,
      sleepEnabled,
      sleepStage1Delay,
      sleepStage1Brightness,
      sleepStage2Enabled,
      sleepStage2Delay,
      sleepNightMode,
      experimentalUiC,
      pollenEnabled,
      alertRadiusKm,
    };
  }, [
    radarAnalysisEnabled,
    extendedRadarRadius,
    showSamplingPoints,
    calmDayFastPath,
    lightModeStyle,
    darkModeStyle,
    radarOpacityLight,
    radarOpacityDark,
    sleepEnabled,
    sleepStage1Delay,
    sleepStage1Brightness,
    sleepStage2Enabled,
    sleepStage2Delay,
    sleepNightMode,
    experimentalUiC,
    pollenEnabled,
    alertRadiusKm,
  ]);

  /**
   * Build the full `advanced.*` PATCH payload as a single object,
   * optionally with per-section overrides spliced in. The server-side
   * PATCH /setting endpoint replaces the entire `advanced` blob when
   * called with `key: "advanced"`, so the body must always carry every
   * section the kiosk still cares about — omitting one wipes it.
   *
   * Pre-2026-05-23 each saveAdvanced*Flag function re-assembled the
   * tree inline, and three of them silently dropped sections
   * (saveAdvancedDisplayFlag missed `darkModeStyle` inside its display
   * branch; saveAdvancedDisplayFlag, saveAdvancedSleepFlag, and
   * saveAdvancedExperimentalFlag all missed `pollen` entirely — toggling
   * any of those flags would wipe `pollen.enabled` on the server side,
   * silently disabling the pollen badge for that install). Centralising
   * the assembly here fixes those by construction.
   *
   * Read-at-call-time semantics (step 2a): the 17 atom values are read
   * through `advancedStateRef` when the function is INVOKED, not closed
   * over at render time — that's what keeps this builder's identity
   * stable. For the immediate callers (saveAdvanced*Flag) the changed
   * key always arrives via `overrides`, so the ref only supplies the
   * unchanged siblings — same payload as the old closure version. For
   * the debounced callers (radar-opacity + alert-radius sliders) the
   * PATCH fires 500 ms after the last state update; the mirror effect
   * above has refreshed the ref long before send time, so the payload
   * carries the freshest committed values.
   *
   * @param {object} [overrides] optional per-section override, e.g.
   *   `{ sleep: { nightMode: true } }` to flip one key while preserving
   *   the rest of the sleep branch.
   * @returns {object} the full `advanced.*` blob ready for PATCH
   */
  const buildAdvancedSubtree = useCallback((overrides = {}) => {
    const s = advancedStateRef.current;
    return {
      ai: {
        radarAnalysisEnabled: s.radarAnalysisEnabled,
        extendedRadius: s.extendedRadarRadius,
        showSamplingPoints: s.showSamplingPoints,
        calmDayFastPath: s.calmDayFastPath,
        ...(overrides.ai || {}),
      },
      display: {
        lightModeStyle: s.lightModeStyle,
        darkModeStyle: s.darkModeStyle,
        radarOpacityLight: s.radarOpacityLight,
        radarOpacityDark: s.radarOpacityDark,
        ...(overrides.display || {}),
      },
      sleep: {
        enabled: s.sleepEnabled,
        stage1Delay: s.sleepStage1Delay,
        stage1Brightness: s.sleepStage1Brightness,
        stage2Enabled: s.sleepStage2Enabled,
        stage2Delay: s.sleepStage2Delay,
        nightMode: s.sleepNightMode,
        ...(overrides.sleep || {}),
      },
      experimental: {
        uiC: s.experimentalUiC,
        ...(overrides.experimental || {}),
      },
      pollen: {
        enabled: s.pollenEnabled,
        ...(overrides.pollen || {}),
      },
      // Nearby-alerts radius. MUST stay in the builder: this function
      // replaces the whole advanced blob on every PATCH, so any sub-tree
      // omitted here is wiped (the documented 2026-05-23 clobber class).
      alerts: {
        radius: s.alertRadiusKm,
        ...(overrides.alerts || {}),
      },
    };
  }, []);

  /**
   * Persist a single advanced.ai.* flag to settings.json.
   * Toggles save instantly on click — no separate Save button — and update
   * local state on success so the UI reflects the new value immediately.
   *
   * @param {String} key one of "radarAnalysisEnabled", "extendedRadius", "showSamplingPoints", "calmDayFastPath"
   * @param {Boolean} value new value
   * @returns {Promise} Resolves when saved
   */
  const saveAdvancedAiFlag = useCallback((key, value) => {
    // v2.15.2: optimistic local update — see saveAdvancedSleepFlag for
    // the rationale. Remote clients hit `localhostOnly` (HTTP 403);
    // flipping state before the PATCH lets the UI reflect the toggle
    // even when the server rejects the write. Note: the legacy ai
    // key `extendedRadius` maps to React state `extendedRadarRadius`
    // — settings.json uses the shorter name for compatibility with
    // earlier installs.
    if (key === "radarAnalysisEnabled") setRadarAnalysisEnabled(value);
    if (key === "extendedRadius") setExtendedRadarRadius(value);
    if (key === "showSamplingPoints") setShowSamplingPoints(value);
    if (key === "calmDayFastPath") setCalmDayFastPath(value);
    return axios
      .patch("/setting", { key: "advanced", val: buildAdvancedSubtree({ ai: { [key]: value } }) })
      .catch((err) => {
        if (err && err.response && err.response.status === 403) return;
        console.warn("saveAdvancedAiFlag PATCH failed:", err && err.message);
      });
  }, [buildAdvancedSubtree]);

  /**
   * Persist advanced.pollen.enabled to settings.json. Same instant-save
   * pattern as saveAdvancedAiFlag.
   *
   * @param {Boolean} value new value
   * @returns {Promise} Resolves when saved
   */
  const savePollenEnabled = useCallback((value) => {
    setPollenEnabled(value);
    return axios
      .patch("/setting", { key: "advanced", val: buildAdvancedSubtree({ pollen: { enabled: value } }) })
      .catch((err) => {
        if (err && err.response && err.response.status === 403) return;
        console.warn("savePollenEnabled PATCH failed:", err && err.message);
      });
  }, [buildAdvancedSubtree]);

  /**
   * Persist a single advanced.display.* flag. Same instant-save pattern as
   * saveAdvancedAiFlag — toggles flip immediately on click.
   *
   * @param {String} key one of "lightModeStyle"
   * @param {String} value new value
   * @returns {Promise} Resolves when saved
   */
  const saveAdvancedDisplayFlag = useCallback((key, value) => {
    return axios
      .patch("/setting", { key: "advanced", val: buildAdvancedSubtree({ display: { [key]: value } }) })
      .then(() => {
        if (key === "lightModeStyle") setLightModeStyle(value);
        if (key === "darkModeStyle") setDarkModeStyle(value);
        if (key === "radarOpacityLight") setRadarOpacityLight(value);
        if (key === "radarOpacityDark") setRadarOpacityDark(value);
      });
  }, [buildAdvancedSubtree]);

  /**
   * Persist a single advanced.sleep.* flag. Same instant-save pattern as
   * saveAdvancedAiFlag / saveAdvancedDisplayFlag — toggles flip immediately
   * on click. Builds the full advanced tree (ai + display + sleep with the
   * one key overridden) so the server-side write doesn't clobber unrelated
   * branches.
   *
   * @param {String} key one of "enabled", "stage1Delay", "stage1Brightness",
   *   "stage2Enabled", "stage2Delay", "nightMode"
   * @param {*} value new value (boolean for toggles, number for delays/brightness)
   * @returns {Promise} Resolves when saved
   */
  const saveAdvancedSleepFlag = useCallback((key, value) => {
    // v2.15.2: optimistic local update — flip React state BEFORE the
    // PATCH so remote clients get UI feedback even though the server
    // rejects their write. Pre-v2.15.2 the setter calls lived inside
    // `.then()`, which never fired on remote because `localhostOnly`
    // returns 403. Symptom the user reported: nightRed palette
    // wouldn't disengage when tapping the moon button from an iOS
    // browser hitting the Pi over the LAN. The kiosk's persisted
    // setting is intentionally unchanged on remote (PATCH still
    // 403's); the local state flip is session-only for that client.
    if (key === "enabled") setSleepEnabled(value);
    if (key === "stage1Delay") setSleepStage1Delay(value);
    if (key === "stage1Brightness") setSleepStage1Brightness(value);
    if (key === "stage2Enabled") setSleepStage2Enabled(value);
    if (key === "stage2Delay") setSleepStage2Delay(value);
    if (key === "nightMode") {
      setSleepNightMode(value);
      // Mirror to localStorage so the choice survives a page reload
      // on remote clients (where the server PATCH below will 403 and
      // settings.json stays unchanged). On the kiosk's own browser
      // this is harmless — the PATCH succeeds AND localStorage gets
      // the same value, so the two stores agree.
      try {
        window.localStorage.setItem(NIGHT_MODE_STORAGE_KEY, String(Boolean(value)));
      } catch { /* localStorage may be unavailable */ }
    }
    return axios
      .patch("/setting", { key: "advanced", val: buildAdvancedSubtree({ sleep: { [key]: value } }) })
      .catch((err) => {
        // 403 = remote client hit `localhostOnly`. Expected; UI state
        // already updated above. Log other errors for diagnostics.
        if (err && err.response && err.response.status === 403) return;
        console.warn("saveAdvancedSleepFlag PATCH failed:", err && err.message);
      });
  }, [
    buildAdvancedSubtree,
    setSleepEnabled,
    setSleepStage1Delay,
    setSleepStage1Brightness,
    setSleepStage2Enabled,
    setSleepStage2Delay,
    setSleepNightMode,
  ]);

  /**
   * Persist a single advanced.experimental.* flag. Same instant-save
   * pattern as the other saveAdvanced*Flag helpers — toggles flip
   * immediately and write the full advanced tree so unrelated branches
   * aren't clobbered.
   *
   * Phase 0 of the v3.0.0 rollout (see
   * `docs/ui-direction-c-implementation-plan.md`). Today the only key
   * is `uiC`; future experimental flags land alongside.
   *
   * @param {String} key one of "uiC"
   * @param {Boolean} value new value
   * @returns {Promise} Resolves when saved
   */
  const saveAdvancedExperimentalFlag = useCallback((key, value) => {
    return axios
      .patch("/setting", { key: "advanced", val: buildAdvancedSubtree({ experimental: { [key]: value } }) })
      .then(() => {
        if (key === "uiC") setExperimentalUiC(value);
      });
  }, [buildAdvancedSubtree]);

  // Debounced setters for the radar opacity sliders. State updates
  // immediately on each tick (live preview on the map); the network
  // PATCH /setting is delayed so we don't spam the server while dragging.
  // 500 ms feels right — long enough to coalesce a drag, short enough
  // that releasing the slider feels responsive.
  const radarOpacitySaveTimerRef = useRef(null);
  const setRadarOpacityLightLive = useCallback((v) => {
    setRadarOpacityLight(v);
    clearTimeout(radarOpacitySaveTimerRef.current);
    radarOpacitySaveTimerRef.current = setTimeout(() => {
      saveAdvancedDisplayFlag("radarOpacityLight", v).catch(() => undefined);
    }, 500);
  }, [saveAdvancedDisplayFlag]);
  const setRadarOpacityDarkLive = useCallback((v) => {
    setRadarOpacityDark(v);
    clearTimeout(radarOpacitySaveTimerRef.current);
    radarOpacitySaveTimerRef.current = setTimeout(() => {
      saveAdvancedDisplayFlag("radarOpacityDark", v).catch(() => undefined);
    }, 500);
  }, [saveAdvancedDisplayFlag]);

  // Debounced setter for the nearby-alerts radius slider. State updates
  // immediately (the survey ring redraws live and the next fetch keys on
  // the new value); the PATCH is delayed 500 ms so dragging doesn't spam
  // the server. Persisted under advanced.alerts.radius via
  // buildAdvancedSubtree — same pattern as the radar-opacity sliders.
  const alertRadiusSaveTimerRef = useRef(null);
  const setAlertRadiusKmLive = useCallback((v) => {
    setAlertRadiusKm(v);
    clearTimeout(alertRadiusSaveTimerRef.current);
    alertRadiusSaveTimerRef.current = setTimeout(() => {
      axios
        .patch("/setting", { key: "advanced", val: buildAdvancedSubtree({ alerts: { radius: v } }) })
        .catch(() => undefined);
    }, 500);
  }, [buildAdvancedSubtree]);

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
    // Cancellation flag (same pattern as the AQI / pollen effects below):
    // without it, a slow response keyed to the PREVIOUS position can
    // resolve after this effect re-ran for a new position and overwrite
    // the fresh alerts with the old location's — visible for up to a
    // full poll interval after a map pan.
    let cancelled = false;
    const fetchAlerts = () => {
      axios
        .get(`/api/weather-alerts?lat=${mapGeo.latitude}&lon=${mapGeo.longitude}`)
        .then((res) => {
          if (!cancelled) setGovAlerts(Array.isArray(res.data?.alerts) ? res.data.alerts : []);
        })
        .catch(() => undefined);
    };
    fetchAlerts();
    const interval = setInterval(fetchAlerts, GOV_ALERTS_INTERVAL);
    return () => { cancelled = true; clearInterval(interval); };
  }, [mapGeo]);

  // Nearby-alerts radius survey (display-only overlay). Only polls while
  // the layer is toggled ON; clears immediately when it's off so the map
  // doesn't keep stale polygons. Re-fetches when the radius changes. 5 min
  // cadence — the server caches the upstream feeds and the survey isn't
  // time-critical. Failures silently keep the previous list.
  useEffect(() => {
    if (!showWeatherAlerts || !mapGeo) {
      setNearbyAlerts([]);
      setNearbyResidualCount(0);
      return undefined;
    }
    const NEARBY_ALERTS_INTERVAL = 5 * 60 * 1000;
    // Cancellation flag: a late response for the previous position (or
    // one that lands after the toggle just cleared the state above)
    // must not repopulate the overlay with stale polygons.
    let cancelled = false;
    const fetchNearby = () => {
      axios
        .get(`/api/nearby-alerts?lat=${mapGeo.latitude}&lon=${mapGeo.longitude}&radiusKm=${alertRadiusKm}`)
        .then((res) => {
          if (cancelled) return;
          setNearbyAlerts(Array.isArray(res.data?.alerts) ? res.data.alerts : []);
          setNearbyResidualCount(Number(res.data?.residualCount) || 0);
        })
        .catch(() => undefined);
    };
    fetchNearby();
    const interval = setInterval(fetchNearby, NEARBY_ALERTS_INTERVAL);
    return () => { cancelled = true; clearInterval(interval); };
  }, [showWeatherAlerts, mapGeo, alertRadiusKm]);

  // Periodic weather data refresh. Previously this lived in the v2
  // WeatherInfo component, but v3 layouts (LayoutLarge / LayoutMedium)
  // don't mount WeatherInfo — so without this effect, the initial fetch
  // triggered by setMapPosition was the only weather pull, and data went
  // stale after the first session-hours (observed: still showing morning
  // values 5 h later). Lifting the polling into AppContext means every
  // layout — v2 and v3 alike — gets fresh current/hourly/daily data
  // without depending on which UI is rendered. The initial setMapPosition
  // call still fires its one-shot fetches; the immediate call below is
  // redundant on first mount but covers the case where weatherApiKey
  // becomes available *after* mapGeo (and matches v2 behaviour).
  useEffect(() => {
    if (!weatherApiKey || !mapGeo) return undefined;
    const CURRENT_INTERVAL = 10 * 60 * 1000;
    const HOURLY_INTERVAL = 60 * 60 * 1000;
    const DAILY_INTERVAL = 24 * 60 * 60 * 1000;
    const runCurrent = () => updateCurrentWeatherData(mapGeo).catch(() => undefined);
    const runHourly = () => {
      updateSunriseSunset(mapGeo);
      updateHourlyWeatherData(mapGeo).catch(() => undefined);
    };
    const runDaily = () => updateDailyWeatherData(mapGeo).catch(() => undefined);
    // Stagger the three pollers so current / hourly / daily never fire in
    // the same instant. Two wins: (1) no synchronized burst onto
    // Tomorrow.io that trips the per-second rate limit (429), and (2) the
    // offsets permanently phase-shift the intervals — without them the
    // hourly tick realigns with a current tick every 60 min and the daily
    // tick every 24 h. The server-side dispatch spacer (proxyCtrl) is the
    // hard guarantee; this is cheap client-side defence-in-depth.
    const POLLER_STAGGER_MS = 2000;
    const pollers = [
      { run: runCurrent, interval: CURRENT_INTERVAL, offset: 0 },
      { run: runHourly, interval: HOURLY_INTERVAL, offset: POLLER_STAGGER_MS },
      { run: runDaily, interval: DAILY_INTERVAL, offset: 2 * POLLER_STAGGER_MS },
    ];
    const startTimers = [];
    const intervalTimers = [];
    for (const poller of pollers) {
      const startId = setTimeout(() => {
        poller.run();
        intervalTimers.push(setInterval(poller.run, poller.interval));
      }, poller.offset);
      startTimers.push(startId);
    }
    return () => {
      startTimers.forEach((id) => clearTimeout(id));
      intervalTimers.forEach((id) => clearInterval(id));
    };
    // The update* callbacks only change identity when weatherApiKey does
    // (their sole useCallback dep), so listing them keeps the restart
    // pattern identical to the old [weatherApiKey, mapGeo] keying.
  }, [weatherApiKey, mapGeo, updateCurrentWeatherData, updateHourlyWeatherData, updateDailyWeatherData, updateSunriseSunset]);

  // Air-quality (AQHI / AQI / IQA) polling. Previously lived inside the
  // v2 UvAqiBadges component, but v3 layouts (MetricsGrid in LayoutPi /
  // LayoutDesktop) read `aqhiInfo` from context without mounting that
  // component — so the IQA tile stayed on "—" forever. Lifting the
  // fetch here keeps the air-quality state alive regardless of which
  // UI is rendered, exactly like the weather-data refresh effect above.
  //
  // 30 min cadence matches every upstream's hourly publication; the
  // server caches each source so the cost is flat across remote clients.
  useEffect(() => {
    if (!mapGeo) return undefined;
    const AQI_REFRESH_MS = 30 * 60 * 1000;
    let cancelled = false;
    const fetchAqi = () => {
      const params = new URLSearchParams({
        lat: mapGeo.latitude,
        lon: mapGeo.longitude,
      });
      axios.get(`/api/air-quality?${params}`)
        .then((res) => {
          if (!cancelled) setAqhiInfo(res.data?.available ? res.data : null);
        })
        .catch(() => { if (!cancelled) setAqhiInfo(null); });
    };
    fetchAqi();
    const interval = setInterval(fetchAqi, AQI_REFRESH_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [mapGeo]);

  // Pollen — same cadence + skip pattern as the AQ poll above.
  // Gated on the opt-in `advanced.pollen.enabled` flag so installs
  // that don't care about pollen never burn the upstream quota.
  useEffect(() => {
    if (!mapGeo || !pollenEnabled) {
      setPollenInfo(null);
      return undefined;
    }
    const POLLEN_REFRESH_MS = 60 * 60 * 1000;
    let cancelled = false;
    const fetchPollen = () => {
      const params = new URLSearchParams({
        lat: mapGeo.latitude,
        lon: mapGeo.longitude,
      });
      axios.get(`/api/pollen?${params}`)
        .then((res) => {
          if (!cancelled) setPollenInfo(res.data?.available ? res.data : null);
        })
        .catch(() => { if (!cancelled) setPollenInfo(null); });
    };
    fetchPollen();
    const interval = setInterval(fetchPollen, POLLEN_REFRESH_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [mapGeo, pollenEnabled]);

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

  // ——— Context slices (step 2b) ———
  // Seven DISJOINT slices, each memoized over only its own fields, so a
  // slice's identity changes only when one of its fields does. The
  // legacy `defaultContext` union further down spreads the seven
  // slices, which makes union completeness true by construction (every
  // slice key reaches the union). Membership must stay disjoint — a key
  // present in two slices would silently shadow in the spread. When
  // adding a field, put it in exactly ONE slice (functions and shared
  // refs go in actionsSlice; data goes with its cadence group).

  // Actions: identity-stable functions + the shared scroll ref. The
  // deps list every member for exhaustive-deps correctness; in practice
  // only the weatherApiKey/browserGeo-driven fetcher chain re-mints
  // (once, at boot), so this slice's identity is permanent afterwards.
  const actionsSlice = useMemo(() => ({
    getWeatherApiKey,
    getReverseGeoApiKey,
    getMapApiKey,
    getBrowserGeo,
    getCustomLatLon,
    setDarkMode: setDarkModeManual,
    saveDarkModeAuto,
    setMapGeo,
    setAiSummaryAvailable,
    saveAiSummaryUserVisible,
    saveAdvancedAiFlag,
    saveAdvancedDisplayFlag,
    setRadarOpacityLightLive,
    setRadarOpacityDarkLive,
    setBrightnessLive,
    saveAdvancedSleepFlag,
    saveSenseHatMode,
    setSenseHatClockBrightnessLive,
    setSenseHatRadarBrightnessLive,
    saveAdvancedExperimentalFlag,
    setMobileRadarMaximized,
    setDesktopRadarMaximized,
    setPiRadarMaximized,
    setPiLayoutState,
    setMapPosition,
    resetMapPosition,
    setPanToCoords,
    toggleMarker,
    saveTempUnit,
    saveSpeedUnit,
    saveLengthUnit,
    saveDistanceUnit,
    savePressureUnit,
    saveDefaultMapZoom,
    setCurrentMapZoom,
    setZoomToLevel,
    setInnerRisk,
    setOuterRisk,
    setInnerTrend,
    setOuterTrend,
    setInnerBumped,
    setOuterBumped,
    setInnerTrendConfidence,
    setOuterTrendConfidence,
    setInnerDirectionVectors,
    setOuterDirectionVectors,
    toggleDirectionArrows,
    toggleWeatherAlerts,
    setAlertRadiusKmLive,
    setAqhiInfo,
    savePollenEnabled,
    cycleGovAlert,
    selectGovAlert,
    setGovAlertExpanded,
    setHighlightedAlertId,
    toggleAnimateWeatherMap,
    cycleRadarSpeed,
    toggleRadarTimelineVisible,
    setSettingsMenuOpen,
    toggleSettingsMenuOpen,
    loadStoredData,
    saveClockTime,
    saveSettingsToJson,
    updateCurrentWeatherData,
    updateDailyWeatherData,
    updateHourlyWeatherData,
    saveMouseHide,
    saveShowAdvisoryAlerts,
    saveAutoSelectTab,
    saveShowAlertRing,
    saveHideRadarLegend,
    saveRadarSource,
    setInfoPanelCollapsed,
    saveFontSize,
    updateSunriseSunset,
    checkIsLocal,
    setDebugMenuOpen,
    toggleDebugMenuOpen,
    setUpdateAvailable,
    setLatestVersion,
    setLatestSha,
    setUpdateCommits,
    refreshUpdateCheck,
    saveSkippedSha,
    setUpdateModalOpen,
    setUpdateState,
    triggerUpdate,
    infoPanelScrollRef,
  }), [
    getWeatherApiKey,
    getReverseGeoApiKey,
    getMapApiKey,
    getBrowserGeo,
    getCustomLatLon,
    setDarkModeManual,
    saveDarkModeAuto,
    setMapGeo,
    setAiSummaryAvailable,
    saveAiSummaryUserVisible,
    saveAdvancedAiFlag,
    saveAdvancedDisplayFlag,
    setRadarOpacityLightLive,
    setRadarOpacityDarkLive,
    setBrightnessLive,
    saveAdvancedSleepFlag,
    saveSenseHatMode,
    setSenseHatClockBrightnessLive,
    setSenseHatRadarBrightnessLive,
    saveAdvancedExperimentalFlag,
    setMobileRadarMaximized,
    setDesktopRadarMaximized,
    setPiRadarMaximized,
    setPiLayoutState,
    setMapPosition,
    resetMapPosition,
    setPanToCoords,
    toggleMarker,
    saveTempUnit,
    saveSpeedUnit,
    saveLengthUnit,
    saveDistanceUnit,
    savePressureUnit,
    saveDefaultMapZoom,
    setCurrentMapZoom,
    setZoomToLevel,
    setInnerRisk,
    setOuterRisk,
    setInnerTrend,
    setOuterTrend,
    setInnerBumped,
    setOuterBumped,
    setInnerTrendConfidence,
    setOuterTrendConfidence,
    setInnerDirectionVectors,
    setOuterDirectionVectors,
    toggleDirectionArrows,
    toggleWeatherAlerts,
    setAlertRadiusKmLive,
    setAqhiInfo,
    savePollenEnabled,
    cycleGovAlert,
    selectGovAlert,
    setGovAlertExpanded,
    setHighlightedAlertId,
    toggleAnimateWeatherMap,
    cycleRadarSpeed,
    toggleRadarTimelineVisible,
    setSettingsMenuOpen,
    toggleSettingsMenuOpen,
    loadStoredData,
    saveClockTime,
    saveSettingsToJson,
    updateCurrentWeatherData,
    updateDailyWeatherData,
    updateHourlyWeatherData,
    saveMouseHide,
    saveShowAdvisoryAlerts,
    saveAutoSelectTab,
    saveShowAlertRing,
    saveHideRadarLegend,
    saveRadarSource,
    setInfoPanelCollapsed,
    saveFontSize,
    updateSunriseSunset,
    checkIsLocal,
    setDebugMenuOpen,
    toggleDebugMenuOpen,
    setUpdateAvailable,
    setLatestVersion,
    setLatestSha,
    setUpdateCommits,
    refreshUpdateCheck,
    saveSkippedSha,
    setUpdateModalOpen,
    setUpdateState,
    triggerUpdate,
    infoPanelScrollRef,
  ]);

  // System: platform facts, hardware state, updater state, panel flags.
  // `updateAvailable` keeps its derived form (raw flag gated by the
  // user's skipped SHA) — consumers see the same boolean as before.
  const systemSlice = useMemo(() => ({
    weatherApiKey,
    reverseGeoApiKey,
    anthropicApiKey,
    airNowApiKey,
    openAqApiKey,
    mapApiKey,
    isLocal,
    remoteSecurityEnabled,
    debugEnabled,
    serverPlatform,
    isSystemd,
    experimentalUiC,
    brightnessAvailable,
    brightnessPercent,
    brightnessMinPercent,
    sleepEnabled,
    sleepStage1Delay,
    sleepStage1Brightness,
    sleepStage2Enabled,
    sleepStage2Delay,
    sleepNightMode,
    sleepStage,
    senseHatAvailable,
    senseHatMode,
    senseHatClockBrightness,
    senseHatRadarBrightness,
    updateAvailable: updateAvailable && latestSha !== skippedSha,
    latestVersion,
    latestSha,
    updateCommits,
    changedDeployFiles,
    needsManualUpgrade,
    skippedSha,
    updateModalOpen,
    updateState,
    updateErrorMessage,
    settingsMenuOpen,
    debugMenuOpen,
    infoPanelCollapsed,
    mobileRadarMaximized,
    desktopRadarMaximized,
    piRadarMaximized,
    piLayoutState,
  }), [
    weatherApiKey,
    reverseGeoApiKey,
    anthropicApiKey,
    airNowApiKey,
    openAqApiKey,
    mapApiKey,
    isLocal,
    remoteSecurityEnabled,
    debugEnabled,
    serverPlatform,
    isSystemd,
    experimentalUiC,
    brightnessAvailable,
    brightnessPercent,
    brightnessMinPercent,
    sleepEnabled,
    sleepStage1Delay,
    sleepStage1Brightness,
    sleepStage2Enabled,
    sleepStage2Delay,
    sleepNightMode,
    sleepStage,
    senseHatAvailable,
    senseHatMode,
    senseHatClockBrightness,
    senseHatRadarBrightness,
    updateAvailable,
    latestVersion,
    latestSha,
    updateCommits,
    changedDeployFiles,
    needsManualUpgrade,
    skippedSha,
    updateModalOpen,
    updateState,
    updateErrorMessage,
    settingsMenuOpen,
    debugMenuOpen,
    infoPanelCollapsed,
    mobileRadarMaximized,
    desktopRadarMaximized,
    piRadarMaximized,
    piLayoutState,
  ]);

  // Location: the position of record + its derived lookups.
  const locationSlice = useMemo(() => ({
    mapGeo,
    browserGeo,
    customLat,
    customLon,
    mapTimezone,
    reverseGeoResult,
    panToCoords,
  }), [
    mapGeo,
    browserGeo,
    customLat,
    customLon,
    mapTimezone,
    reverseGeoResult,
    panToCoords,
  ]);

  // UI preferences: per-device display choices, user-interaction driven.
  const uiPrefsSlice = useMemo(() => ({
    darkMode,
    darkModeAuto,
    tempUnit,
    speedUnit,
    lengthUnit,
    distanceUnit,
    pressureUnit,
    clockTime,
    fontSize,
    lightModeStyle,
    darkModeStyle,
    radarOpacityLight,
    radarOpacityDark,
    mouseHide,
    hideRadarLegend,
    radarSource,
    markerIsVisible,
    showDirectionArrows,
    showSamplingPoints,
    radarAnalysisEnabled,
    extendedRadarRadius,
    calmDayFastPath,
    aiSummaryAvailable,
    aiSummaryUserVisible,
    pollenEnabled,
    defaultMapZoom,
    animateWeatherMap,
    radarSpeed,
    radarTimelineVisible,
    showAdvisoryAlerts,
    autoSelectTab,
  }), [
    darkMode,
    darkModeAuto,
    tempUnit,
    speedUnit,
    lengthUnit,
    distanceUnit,
    pressureUnit,
    clockTime,
    fontSize,
    lightModeStyle,
    darkModeStyle,
    radarOpacityLight,
    radarOpacityDark,
    mouseHide,
    hideRadarLegend,
    radarSource,
    markerIsVisible,
    showDirectionArrows,
    showSamplingPoints,
    radarAnalysisEnabled,
    extendedRadarRadius,
    calmDayFastPath,
    aiSummaryAvailable,
    aiSummaryUserVisible,
    pollenEnabled,
    defaultMapZoom,
    animateWeatherMap,
    radarSpeed,
    radarTimelineVisible,
    showAdvisoryAlerts,
    autoSelectTab,
  ]);

  // Weather data: polled environmental payloads + their error states.
  const weatherDataSlice = useMemo(() => ({
    currentWeatherData,
    currentWeatherDataErr,
    currentWeatherDataErrMsg,
    hourlyWeatherData,
    hourlyWeatherDataErr,
    hourlyWeatherDataErrMsg,
    dailyWeatherData,
    dailyWeatherDataErr,
    dailyWeatherDataErrMsg,
    sunriseTime,
    sunsetTime,
    sunriseSunsetToday,
    sunriseSunsetTomorrow,
    aqhiInfo,
    pollenInfo,
  }), [
    currentWeatherData,
    currentWeatherDataErr,
    currentWeatherDataErrMsg,
    hourlyWeatherData,
    hourlyWeatherDataErr,
    hourlyWeatherDataErrMsg,
    dailyWeatherData,
    dailyWeatherDataErr,
    dailyWeatherDataErrMsg,
    sunriseTime,
    sunsetTime,
    sunriseSunsetToday,
    sunriseSunsetTomorrow,
    aqhiInfo,
    pollenInfo,
  ]);

  // Alerts: gov-alert list + banner UI state + nearby-alerts survey.
  const alertsSlice = useMemo(() => ({
    govAlerts,
    govAlertIdx,
    govAlertExpanded,
    highlightedAlertId,
    nearbyAlerts,
    nearbyResidualCount,
    showWeatherAlerts,
    showAlertRing,
    alertRadiusKm,
  }), [
    govAlerts,
    govAlertIdx,
    govAlertExpanded,
    highlightedAlertId,
    nearbyAlerts,
    nearbyResidualCount,
    showWeatherAlerts,
    showAlertRing,
    alertRadiusKm,
  ]);

  // Radar state: ring risk/trend data + live zoom — the hottest slice.
  const radarStateSlice = useMemo(() => ({
    innerRisk,
    outerRisk,
    innerTrend,
    outerTrend,
    innerBumped,
    outerBumped,
    innerTrendConfidence,
    outerTrendConfidence,
    innerDirectionVectors,
    outerDirectionVectors,
    currentMapZoom,
    zoomToLevel,
  }), [
    innerRisk,
    outerRisk,
    innerTrend,
    outerTrend,
    innerBumped,
    outerBumped,
    innerTrendConfidence,
    outerTrendConfidence,
    innerDirectionVectors,
    outerDirectionVectors,
    currentMapZoom,
    zoomToLevel,
  ]);

  // Legacy union — the exact pre-split AppContext surface, rebuilt by
  // spreading the seven slices (disjoint keys, so no shadowing).
  // Memoized over the slice identities: it re-mints only when a slice
  // does, and unmigrated consumers keep working unchanged.
  const defaultContext = useMemo(() => ({
    ...actionsSlice,
    ...systemSlice,
    ...locationSlice,
    ...uiPrefsSlice,
    ...weatherDataSlice,
    ...alertsSlice,
    ...radarStateSlice,
  }), [
    actionsSlice,
    systemSlice,
    locationSlice,
    uiPrefsSlice,
    weatherDataSlice,
    alertsSlice,
    radarStateSlice,
  ]);

  return (
    <AppActionsContext.Provider value={actionsSlice}>
      <SystemContext.Provider value={systemSlice}>
        <LocationContext.Provider value={locationSlice}>
          <UiPrefsContext.Provider value={uiPrefsSlice}>
            <WeatherDataContext.Provider value={weatherDataSlice}>
              <AlertsContext.Provider value={alertsSlice}>
                <RadarStateContext.Provider value={radarStateSlice}>
                  <AppContext.Provider value={defaultContext}>
                    {children}
                  </AppContext.Provider>
                </RadarStateContext.Provider>
              </AlertsContext.Provider>
            </WeatherDataContext.Provider>
          </UiPrefsContext.Provider>
        </LocationContext.Provider>
      </SystemContext.Provider>
    </AppActionsContext.Provider>
  );
}

AppContextProvider.propTypes = {
  children: PropTypes.oneOfType([
    PropTypes.arrayOf(PropTypes.node),
    PropTypes.node,
  ]).isRequired,
};
