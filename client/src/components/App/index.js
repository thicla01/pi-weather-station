import React, { useEffect, useContext, useState, useRef } from "react";
import axios from "axios";
import styles from "./styles.css";
import { AppContext } from "~/AppContext";

import WeatherMap from "~/components/WeatherMap";
import InfoPanel from "~/components/InfoPanel";
import Settings from "~/components/Settings";
import Debug from "~/components/Debug";
import UpdateModal from "~/components/UpdateModal";
import ScreenSaver from "~/components/ScreenSaver";
import useIdleDetection from "~/hooks/useIdleDetection";

import "!style-loader!css-loader!./overrides.css";

// Breakpoint for offering an InfoPanel-collapse toggle. Covers both the
// 7" Pi kiosk (~480 px height) and the 10" Pi touchscreen (1280×800,
// height = 800 px) — both benefit from a way to free up the radar map
// view on demand. Most desktop monitors (1080+ px) stay above this and
// won't see the toggle. Decoupled from the `(max-height: 520px)` query
// used in WeatherInfo / WeatherMap, which controls a denser layout (chart
// tabs, compact timeline) and shouldn't trigger at 800 px.
const PANEL_TOGGLE_MQ = "(max-height: 820px)";

/**
 * Main component
 *
 * @returns {JSX.Element} Main component
 */
const App = () => {
  const {
    getBrowserGeo,
    getCustomLatLon,
    loadStoredData,
    darkMode,
    mouseHide,
    checkIsLocal,
    infoPanelCollapsed,
    setInfoPanelCollapsed,
    fontSize,
    defaultMapZoom,
    sleepEnabled,
    sleepStage1Delay,
    sleepStage1Brightness,
    sleepStage2Enabled,
    sleepStage2Delay,
    brightnessAvailable,
    brightnessPercent,
    brightnessMinPercent,
  } = useContext(AppContext);

  // Idle detection drives the screensaver. The hook is a no-op when
  // sleepEnabled is false (no listeners attached, stage stays 0), so the
  // cost is zero for users who haven't opted in.
  const { stage } = useIdleDetection({
    enabled: sleepEnabled,
    stage1Delay: sleepStage1Delay,
    stage2Enabled: sleepStage2Enabled,
    stage2Delay: sleepStage2Delay,
  });

  // Hardware-brightness orchestration on stage transitions.
  //
  // Entering stage 1 → save the user's current brightness, apply the
  //   sleep-mode dim level (POST /api/brightness).
  // Entering stage 2 → drop further to the hardware floor.
  // Returning to stage 0 → restore the saved value.
  //
  // The save/restore pair is wrapped in a ref so React's state updates
  // (which would otherwise race with the API call) don't interfere. Calls
  // are best-effort: failure (HDMI monitor, no backlight driver, write
  // permission missing) is silently ignored — the screensaver visual
  // still renders correctly without the hardware dim.
  const brightnessBeforeSleepRef = useRef(null);
  useEffect(() => {
    if (!brightnessAvailable) return undefined;
    if (stage === 1) {
      // Capture the current value once on entry into stage 1, then
      // dim. If the user changes brightness while stage 1 is active
      // (e.g. by swiping in from a wake event), we deliberately don't
      // re-capture — restoring on wake puts us back to whatever was
      // active at sleep onset, which is the principle-of-least-surprise
      // behaviour.
      if (brightnessBeforeSleepRef.current === null) {
        brightnessBeforeSleepRef.current = brightnessPercent;
      }
      axios.post("/api/brightness", { percent: sleepStage1Brightness })
        .catch(() => undefined);
    } else if (stage === 2) {
      // Stage 2 always writes brightness 0 with allowOff: true so the
      // server bypasses its 10 % MIN_PERCENT floor. On panels that
      // honour 0, the backlight goes fully off (cleanest anti-burn-in
      // and bleed mitigation). On panels whose driver clamps internally
      // (some industrial all-in-ones, e.g. ED-HMI3010), the hardware
      // floor takes over — same end result either way, no user knob is
      // useful in between because the floor is hardware-bound. Earlier
      // iteration exposed a `sleepStage2Brightness` slider; field
      // testing showed it added UI clutter without buying anything, so
      // it was removed.
      axios.post("/api/brightness", { percent: 0, allowOff: true })
        .catch(() => undefined);
    } else {
      // stage 0 — restore. Nothing to do if we never dimmed.
      if (brightnessBeforeSleepRef.current !== null) {
        const restoreTo = brightnessBeforeSleepRef.current;
        brightnessBeforeSleepRef.current = null;
        axios.post("/api/brightness", { percent: restoreTo })
          .catch(() => undefined);
      }
    }
    return undefined;
    // brightnessPercent intentionally NOT in the deps — it's read once via
    // the ref on stage-1 entry; including it would re-trigger the dim API
    // call every time the user nudged the brightness slider.
  }, [stage, brightnessAvailable, sleepStage1Brightness, brightnessMinPercent]); // eslint-disable-line react-hooks/exhaustive-deps -- brightnessPercent intentionally omitted, see comment above

  const [canCollapsePanel, setCanCollapsePanel] = useState(
    () => window.matchMedia(PANEL_TOGGLE_MQ).matches
  );

  const fontSizeZoom = { s: 0.85, m: 1.0, l: 1.15 }[fontSize] || 1.0;
  // Panel width scales with the font-size zoom so the contents always see
  // ~300 CSS pixels of internal layout space regardless of size. Without
  // this, fontSize=L kept the column at a fixed 300 screen px while
  // zooming the contents up 15 %, which made the right column of stats
  // (precip / cloud / wind / humidity) overflow and the panel's right
  // edge clip the trailing "%" on every value.
  const PANEL_BASE_WIDTH = 300;
  const panelWidthPx = Math.round(PANEL_BASE_WIDTH * fontSizeZoom);
  const gridTemplateColumns = canCollapsePanel && infoPanelCollapsed
    ? "1fr 0"
    : `auto ${panelWidthPx}px`;

  useEffect(() => {
    const mq = window.matchMedia(PANEL_TOGGLE_MQ);
    const handler = (e) => {
      setCanCollapsePanel(e.matches);
      // If the viewport grew past the breakpoint while the panel was
      // collapsed (e.g. user attached an external monitor mid-session),
      // restore the panel — otherwise it stays hidden with no toggle to
      // bring it back.
      if (!e.matches) {
        setInfoPanelCollapsed(false);
      }
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [setInfoPanelCollapsed]);

  useEffect(() => {
    getCustomLatLon();
    getBrowserGeo();
    loadStoredData();
    checkIsLocal();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- initialization, runs once on mount

  return (
    <div
      className={`${darkMode ? styles.dark : styles.light} ${
        mouseHide ? styles.hideMouse : ""
      }`}
    >
      <div
        className={styles.container}
        style={{ gridTemplateColumns, "--info-col-width": `${panelWidthPx}px` }}
      >
        <div className={styles.settingsContainer}>
          <Settings />
          <Debug />
        </div>
        <UpdateModal />
        <div
          className={`${styles.weatherMap} map-container ${
            mouseHide ? "map-mouse-hide" : ""
          } ${darkMode ? "map-dark-mode" : ""}`}
        >
          <WeatherMap zoom={defaultMapZoom} dark={darkMode} />
          {canCollapsePanel && (
            <button
              className={`${styles.panelToggle} ${darkMode ? styles.panelToggleDark : styles.panelToggleLight}`}
              onClick={() => setInfoPanelCollapsed(!infoPanelCollapsed)}
            >
              {infoPanelCollapsed ? "‹" : "›"}
            </button>
          )}
        </div>
        <div
          className={styles.infoContainer}
          style={{ zoom: fontSizeZoom, height: `calc(100dvh / ${fontSizeZoom})` }}
        >
          <InfoPanel />
        </div>
      </div>
      {/* Sleep-mode overlay — rendered outside the main grid so it
          covers everything (settings, debug, info panel) when active.
          Stage 0 = unmounted entirely. */}
      <ScreenSaver stage={stage} />
    </div>
  );
};

export default App;
