import React, { useEffect, useContext, useState } from "react";
import styles from "./styles.css";
import { AppContext } from "~/AppContext";

import WeatherMap from "~/components/WeatherMap";
import InfoPanel from "~/components/InfoPanel";
import Settings from "~/components/Settings";
import Debug from "~/components/Debug";
import UpdateModal from "~/components/UpdateModal";

import "!style-loader!css-loader!./overrides.css";

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

  const [isSmallScreen, setIsSmallScreen] = useState(
    () => window.matchMedia("(max-height: 520px)").matches
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
  const gridTemplateColumns = isSmallScreen && infoPanelCollapsed
    ? "1fr 0"
    : `auto ${panelWidthPx}px`;

  useEffect(() => {
    const mq = window.matchMedia("(max-height: 520px)");
    const handler = (e) => setIsSmallScreen(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

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
          {isSmallScreen && (
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
