import React, { useContext } from "react";
import { useTranslation } from "react-i18next";
import { RestoreIcon } from "~/components/WeatherMap/icons";
import { AppActionsContext, WeatherDataContext, UiPrefsContext } from "~/AppContext";
import { convertTemp } from "~/services/conversions";
import MetricsGrid from "~/components/ambient/MetricsGrid";
import IndoorBlock from "~/components/ambient/IndoorBlock";
import FeelsLikeLine from "~/components/ambient/FeelsLikeLine";
import SunMoonBlock from "~/components/ambient/SunMoonBlock";
import RailSquareButton from "~/components/ambient/RailSquareButton";
import styles from "./styles.css";

/**
 * v3.3 Conditions priority view — the weather-detail surface reached from
 * the glance Hero's ⤢ on the 7" kiosk (`docs/v3.3-priority-views-design.md`).
 * Now that the clock and the IQA reading live on the glance, the
 * height-starved MID stack's heavy bits (the metric grid + indoor) move here,
 * where the full rail gives them room. Mounted alongside the glance (hidden
 * via `data-pi-state`) so its state survives the round trip.
 *
 * Order (priority for the household majority): feels-like → outdoor metrics →
 * indoor → sun/moon almanac. The metric grid is EXTENDED + 3-column here (the
 * wide view), reading as two themed rows (Wind/Gust/UV · Humidity/Pressure/
 * Visibility). The Soleil/Lune section closes it, its headers opening the same
 * detail popovers the desktop hero uses.
 *
 * @returns {JSX.Element} the conditions view
 */
const ConditionsView = () => {
  const { setPiLayoutState } = useContext(AppActionsContext);
  const { currentWeatherData } = useContext(WeatherDataContext);
  const { tempUnit } = useContext(UiPrefsContext);
  const { t } = useTranslation();

  // Feels-like — relocated off the glance Hero into this view (design §5.2).
  const vals = currentWeatherData?.data?.timelines?.[0]?.intervals?.[0]?.values;
  const temp = vals?.temperature != null ? convertTemp(vals.temperature, tempUnit) : null;
  const feels = vals?.temperatureApparent != null ? convertTemp(vals.temperatureApparent, tempUnit) : null;
  const showFeels = temp != null && feels != null;

  return (
    <div className={styles.view}>
      <div className={styles.header}>
        <span className={styles.title}>{t("conditions.title", { defaultValue: "Conditions" })}</span>
        <RailSquareButton
          icon={RestoreIcon}
          onClick={() => setPiLayoutState("mid")}
          ariaLabel={t("conditions.back", { defaultValue: "Back to overview" })}
          className={styles.minimize}
        />
      </div>
      <div className={styles.body}>
        {showFeels ? (
          <div className={styles.feels}>
            <FeelsLikeLine temp={temp} feels={feels} />
          </div>
        ) : null}
        <MetricsGrid extended columns={3} />
        <IndoorBlock />
        <SunMoonBlock />
      </div>
    </div>
  );
};

export default ConditionsView;
