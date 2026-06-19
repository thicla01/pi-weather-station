import React, { useContext } from "react";
import { useTranslation } from "react-i18next";
import { InlineIcon } from "@iconify/react";
import chevronLeft from "@iconify/icons-carbon/chevron-left";
import { AppActionsContext } from "~/AppContext";
import MetricsGrid from "~/components/ambient/MetricsGrid";
import IndoorBlock from "~/components/ambient/IndoorBlock";
import styles from "./styles.css";

/**
 * v3.3 Conditions priority view — the weather-detail surface reached from
 * the glance Hero's ⤢ on the 7" kiosk (`docs/v3.3-priority-views-design.md`).
 * Now that the clock and the IQA reading live on the glance, the
 * height-starved MID stack's heavy bits (the metric grid + indoor) move here,
 * where the full rail gives them room. Mounted alongside the glance (hidden
 * via `data-pi-state`) so its state survives the round trip.
 *
 * Increment 1 carries the existing MetricsGrid (Wind / Gust / UV / Humidity)
 * + the indoor block; the feels-like line and the extra tiles (Pressure /
 * Visibility / Dew point) that there is finally room for are a follow-up.
 *
 * @returns {JSX.Element} the conditions view
 */
const ConditionsView = () => {
  const { setPiLayoutState } = useContext(AppActionsContext);
  const { t } = useTranslation();

  return (
    <div className={styles.view}>
      <div className={styles.header}>
        <button
          type="button"
          className={styles.back}
          onClick={() => setPiLayoutState("mid")}
          aria-label={t("conditions.back", { defaultValue: "Back to overview" })}
        >
          <InlineIcon icon={chevronLeft} />
          <span>{t("conditions.back", { defaultValue: "Back" })}</span>
        </button>
        <span className={styles.title}>{t("conditions.title", { defaultValue: "Conditions" })}</span>
      </div>
      <div className={styles.body}>
        <MetricsGrid />
        <IndoorBlock />
      </div>
    </div>
  );
};

export default ConditionsView;
