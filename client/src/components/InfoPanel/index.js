import React, { useContext } from "react";
import { AppContext } from "~/AppContext";
import Clock from "~/components/Clock";
import WeatherInfo from "~/components/WeatherInfo";
import ControlButtons from "~/components/ControlButtons";
import useDragScroll from "~/hooks/useDragScroll";
import styles from "./styles.css";

/**
 * Info Panel
 *
 * @returns {JSX.Element} Info Panel
 */
const InfoPanel = () => {
  const { darkMode, infoPanelScrollRef } = useContext(AppContext);
  const weatherInfoRef = useDragScroll();

  return (
    <div className={`${darkMode ? styles.dark : styles.light} ${styles.panel}`}>
      <div className={styles.container}>
        <div className={styles.clockContainer}>
          <Clock />
        </div>
        <div className={styles.weatherInfoContainer} ref={(el) => { weatherInfoRef(el); infoPanelScrollRef.current = el; }}>
          <WeatherInfo />
        </div>
        <div className={styles.controls}>
          <ControlButtons />
        </div>
      </div>
    </div>
  );
};

export default InfoPanel;
