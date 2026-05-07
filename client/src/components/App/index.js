import React, { useEffect, useContext, useState } from "react";
import styles from "./styles.css";
import { AppContext } from "~/AppContext";

import WeatherMap from "~/components/WeatherMap";
import InfoPanel from "~/components/InfoPanel";
import Settings from "~/components/Settings";
import Debug from "~/components/Debug";
import UpdateModal from "~/components/UpdateModal";

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
  } = useContext(AppContext);

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
    </div>
  );
};

export default App;
