import React, { useEffect, useState, useContext } from "react";
import { AppContext } from "~/AppContext";
import { format } from "date-fns";
import { useTranslation } from "react-i18next";
import { getDateLocale } from "~/i18n/dateLocale";
import styles from "./styles.css";
import SunRiseSet from "~/components/SunRiseSet";

/**
 * Displays time and date
 *
 * @returns {JSX.Element} Clock component
 */
const Clock = () => {
  const { clockTime } = useContext(AppContext);
  const { t, i18n } = useTranslation();
  const [date, setDate] = useState(new Date().getTime());
  const locale = getDateLocale(i18n.language);

  useEffect(() => {
    const clockInterval = setInterval(() => {
      setDate(new Date().getTime());
    }, 1000);
    return () => {
      clearInterval(clockInterval);
    };
  }, []);

  return (
    <div>
      <div className={styles.date}>
        {format(date, t("dateFormat"), { locale }).toUpperCase()}
      </div>
      <div className={styles.time}>
        {clockTime === "12" ? (
          <>
            {format(date, "h:mm")}
            <span className={styles.amPm}>{format(date, "a")}</span>
          </>
        ) : (
          format(date, "HH:mm")
        )}
      </div>
      <div className={styles.sunRiseSetContainer}>
        <SunRiseSet/>
      </div>
    </div>
  );
};

export default Clock;
