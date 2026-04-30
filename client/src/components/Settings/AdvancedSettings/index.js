import React, { useContext, useState } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import styles from "./styles.css";
import { AppContext } from "~/AppContext";

/**
 * Swallow errors from the save promise. The UI does not roll back on failure
 * because the next page reload re-hydrates from settings.json, which is
 * always the source of truth — a failed write simply means no observable
 * state change, which is acceptable for non-critical toggles.
 *
 * @returns {undefined}
 */
const ignoreSaveError = () => undefined;

/**
 * Inline N-button toggle. Saves on click via the provided callback; the
 * callback is expected to return a Promise so we can keep the UI in sync if
 * the write fails. When `readOnly` is true, clicks do nothing and the toggle
 * is rendered with reduced opacity to signal the disabled state — used on
 * remote clients where settings writes are localhostOnly.
 *
 * Two API shapes:
 *   - Boolean shape (legacy): pass {value: bool, onLabel, offLabel} and the
 *     toggle renders an "On / Off"-style 2-button group.
 *   - Multi shape: pass {value: any, options: [{label, val}, ...]} and the
 *     toggle renders one button per option. The button whose val equals
 *     value is highlighted as selected.
 *
 * @param {object} props Component props
 * @param {*} props.value Current value of the toggle
 * @param {Function} props.onChange Async setter (returns a Promise)
 * @param {Array<{label: string, val: *}>} [props.options] Multi-option items
 * @param {string} [props.onLabel] Label for the "On" button (boolean shape)
 * @param {string} [props.offLabel] Label for the "Off" button (boolean shape)
 * @param {boolean} [props.readOnly] When true, the toggle is read-only
 * @returns {JSX.Element} Inline toggle
 */
const InlineToggle = ({ value, onChange, onLabel, offLabel, options, readOnly }) => {
  const items = options || [
    { label: onLabel, val: true },
    { label: offLabel, val: false },
  ];
  return (
    <div className={styles.toggleContainer || "toggle-container"} style={{ display: "flex", gap: "0.3em", opacity: readOnly ? 0.5 : 1 }}>
      {items.map(({ label, val }) => (
        <div
          key={String(val)}
          onClick={() => {
            if (readOnly) return;
            if (val !== value) onChange(val).catch(ignoreSaveError);
          }}
          style={{
            padding: "0.3em 0.7em",
            border: "1px solid rgba(255,255,255,0.3)",
            borderRadius: "3px",
            cursor: readOnly ? "default" : "pointer",
            background: val === value ? "rgba(255,255,255,0.2)" : "transparent",
            fontSize: "0.85em",
            minWidth: "2.5em",
            textAlign: "center",
          }}
        >
          {label}
        </div>
      ))}
    </div>
  );
};

InlineToggle.propTypes = {
  value: PropTypes.oneOfType([PropTypes.bool, PropTypes.string, PropTypes.number]).isRequired,
  onChange: PropTypes.func.isRequired,
  options: PropTypes.arrayOf(PropTypes.shape({
    label: PropTypes.string.isRequired,
    val: PropTypes.any.isRequired,
  })),
  onLabel: PropTypes.string,
  offLabel: PropTypes.string,
  readOnly: PropTypes.bool,
};

/**
 * Collapsible "Advanced settings" section at the bottom of the Settings panel.
 * Keeps expert toggles out of the way for casual users while making them
 * one-click accessible. Toggles save to settings.json on click — no separate
 * Save button — via the AppContext's saveAdvancedAiFlag helper.
 *
 * On remote clients, where settings writes are localhostOnly, the section is
 * still shown but the toggles are read-only and a notice points the user
 * toward the SSH-tunnel workflow for actual changes.
 *
 * @param {object} props Component props
 * @param {boolean} [props.readOnly] When true, toggles are disabled (remote)
 * @returns {JSX.Element} Advanced settings section
 */
const AdvancedSettings = ({ readOnly }) => {
  const { t } = useTranslation();
  const {
    radarAnalysisEnabled,
    extendedRadarRadius,
    doubleOuterPoints,
    showSamplingPoints,
    saveAdvancedAiFlag,
    lightModeStyle,
    saveAdvancedDisplayFlag,
  } = useContext(AppContext);
  const [open, setOpen] = useState(false);

  return (
    <div className={styles.advancedSection}>
      <div
        className={styles.advancedToggle}
        onClick={() => setOpen((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setOpen((v) => !v);
        }}
      >
        <span className={`${styles.chevron} ${open ? styles.open : ""}`}>›</span>
        <span>{t("settings.advanced.title")}</span>
      </div>

      {open && (
        <div className={styles.advancedBody}>
          {readOnly && (
            <div className={styles.readOnlyNotice}>
              {t("settings.advanced.readOnlyNotice")}
            </div>
          )}

          <div className={styles.groupLabel}>{t("settings.advanced.displayGroup")}</div>

          <div className={styles.row}>
            <div className={styles.rowLabel}>
              {t("settings.advanced.lightModeStyle")}
              <span className={styles.rowHint}>
                {t("settings.advanced.lightModeStyleHint")}
              </span>
            </div>
            <InlineToggle
              value={lightModeStyle}
              onChange={(v) => saveAdvancedDisplayFlag("lightModeStyle", v)}
              options={[
                { label: "v10", val: "light-v10" },
                { label: "v11", val: "light-v11" },
                { label: "Streets", val: "streets-v12" },
              ]}
              readOnly={readOnly}
            />
          </div>

          <div className={styles.groupLabel} style={{ marginTop: "1em" }}>{t("settings.advanced.aiGroup")}</div>

          <div className={styles.row}>
            <div className={styles.rowLabel}>
              {t("settings.advanced.radarAnalysisEnabled")}
              <span className={styles.rowHint}>
                {t("settings.advanced.radarAnalysisEnabledHint")}
              </span>
            </div>
            <InlineToggle
              value={radarAnalysisEnabled}
              onChange={(v) => saveAdvancedAiFlag("radarAnalysisEnabled", v)}
              onLabel={t("settings.on")}
              offLabel={t("settings.off")}
              readOnly={readOnly}
            />
          </div>

          <div className={styles.row}>
            <div className={styles.rowLabel}>
              {t("settings.advanced.extendedRadius")}
              <span className={styles.rowHint}>
                {t("settings.advanced.extendedRadiusHint")}
              </span>
            </div>
            <InlineToggle
              value={extendedRadarRadius}
              onChange={(v) => saveAdvancedAiFlag("extendedRadius", v)}
              onLabel={t("settings.on")}
              offLabel={t("settings.off")}
              readOnly={readOnly}
            />
          </div>

          <div className={styles.row}>
            <div className={styles.rowLabel}>
              {t("settings.advanced.doubleOuterPoints")}
              <span className={styles.rowHint}>
                {t("settings.advanced.doubleOuterPointsHint")}
              </span>
            </div>
            <InlineToggle
              value={doubleOuterPoints}
              onChange={(v) => saveAdvancedAiFlag("doubleOuterPoints", v)}
              onLabel={t("settings.on")}
              offLabel={t("settings.off")}
              readOnly={readOnly}
            />
          </div>

          <div className={styles.row}>
            <div className={styles.rowLabel}>
              {t("settings.advanced.showSamplingPoints")}
              <span className={styles.rowHint}>
                {t("settings.advanced.showSamplingPointsHint")}
              </span>
            </div>
            <InlineToggle
              value={showSamplingPoints}
              onChange={(v) => saveAdvancedAiFlag("showSamplingPoints", v)}
              onLabel={t("settings.on")}
              offLabel={t("settings.off")}
              readOnly={readOnly}
            />
          </div>
        </div>
      )}
    </div>
  );
};

AdvancedSettings.propTypes = {
  readOnly: PropTypes.bool,
};

export default AdvancedSettings;
