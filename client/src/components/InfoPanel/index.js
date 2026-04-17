import React, { useContext, useRef, useEffect } from "react";
import { AppContext } from "~/AppContext";
import Clock from "~/components/Clock";
import WeatherInfo from "~/components/WeatherInfo";
import ControlButtons from "~/components/ControlButtons";
import styles from "./styles.css";

/**
 * Info Panel
 *
 * @returns {JSX.Element} Info Panel
 */
const InfoPanel = () => {
  const { darkMode } = useContext(AppContext);
  const weatherInfoRef = useRef(null);

  useEffect(() => {
    const el = weatherInfoRef.current;
    if (!el) return;

    let startY = 0;
    let startScrollTop = 0;
    let isDragging = false;

    const onPointerDown = (e) => {
      isDragging = true;
      startY = e.clientY;
      startScrollTop = el.scrollTop;
      el.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e) => {
      if (!isDragging) return;
      e.preventDefault();
      el.scrollTop = startScrollTop + (startY - e.clientY);
    };

    const onPointerUp = () => { isDragging = false; };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove, { passive: false });
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);

    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
    };
  }, []);

  return (
    <div className={`${darkMode ? styles.dark : styles.light} ${styles.panel}`}>
      <div className={styles.container}>
        <div className={styles.clockContainer}>
          <Clock />
        </div>
        <div className={styles.weatherInfoContainer} ref={weatherInfoRef}>
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
