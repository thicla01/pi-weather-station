import React, { useContext, useState, useRef, useEffect } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import styles from "./styles.css";
import { AppContext } from "~/AppContext";
import RangeSlider from "~/components/RangeSlider";

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
    showSamplingPoints,
    calmDayFastPath,
    saveAdvancedAiFlag,
    lightModeStyle,
    darkModeStyle,
    saveAdvancedDisplayFlag,
    radarOpacityLight,
    radarOpacityDark,
    setRadarOpacityLightLive,
    setRadarOpacityDarkLive,
    brightnessAvailable,
    brightnessPercent,
    brightnessMinPercent,
    setBrightnessLive,
    sleepEnabled,
    sleepStage1Delay,
    sleepStage1Brightness,
    sleepStage2Enabled,
    sleepStage2Delay,
    sleepNightMode,
    saveAdvancedSleepFlag,
    experimentalUiC,
    saveAdvancedExperimentalFlag,
    debugEnabled,
  } = useContext(AppContext);
  const [open, setOpen] = useState(false);
  const sectionRef = useRef(null);

  // When the section opens, scroll its toggle row to the top of the
  // surrounding scrollable Settings panel so the freshly-revealed body
  // is immediately in view. Without this, on the 7" touchscreen the
  // toggle sits at the bottom of the panel and the user has to scroll
  // manually to see what they just opened. Wrapped in requestAnimationFrame
  // to wait for the body to be rendered (open flips before paint).
  //
  // We deliberately do NOT use Element.scrollIntoView here: on iPad
  // Safari, scrollIntoView walks every scrollable ancestor and scrolls
  // each one — including the InfoPanel's weather-info-container on the
  // right side of the screen, which is a sibling scroller, not an
  // ancestor of this section. The right panel + control buttons would
  // visibly shift up when the user tapped the toggle and stay shifted
  // until the entire Settings panel was closed. Walking up the DOM to
  // find the nearest scrollable ancestor and setting its scrollTop
  // explicitly keeps the scroll scoped to where it belongs.
  useEffect(() => {
    if (!open || !sectionRef.current) return;
    requestAnimationFrame(() => {
      const section = sectionRef.current;
      let scroller = section.parentElement;
      while (scroller) {
        const style = window.getComputedStyle(scroller);
        if (/(auto|scroll)/.test(style.overflowY)) break;
        scroller = scroller.parentElement;
      }
      if (!scroller) return;
      const scrollerRect = scroller.getBoundingClientRect();
      const sectionRect = section.getBoundingClientRect();
      scroller.scrollTo({
        top: scroller.scrollTop + (sectionRect.top - scrollerRect.top),
        behavior: "smooth",
      });
    });
  }, [open]);

  return (
    <div className={styles.advancedSection} ref={sectionRef}>
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

          <div className={styles.row}>
            <div className={styles.rowLabel}>
              {t("settings.advanced.darkModeStyle")}
              <span className={styles.rowHint}>
                {t("settings.advanced.darkModeStyleHint")}
              </span>
            </div>
            <InlineToggle
              value={darkModeStyle}
              onChange={(v) => saveAdvancedDisplayFlag("darkModeStyle", v)}
              options={[
                { label: "v10", val: "dark-v10" },
                { label: "v11", val: "dark-v11" },
              ]}
              readOnly={readOnly}
            />
          </div>

          <div className={styles.row}>
            <div className={styles.rowLabel}>
              {t("settings.advanced.radarOpacityLight")}
              <span className={styles.rowHint}>
                {t("settings.advanced.radarOpacityLightHint")}
              </span>
            </div>
            <RangeSlider
              value={radarOpacityLight}
              onChange={setRadarOpacityLightLive}
              min={0.05}
              max={1}
              step={0.05}
              disabled={readOnly}
              formatValue={(v) => `${Math.round(v * 100)}%`}
              ariaLabel={t("settings.advanced.radarOpacityLight")}
            />
          </div>

          <div className={styles.row}>
            <div className={styles.rowLabel}>
              {t("settings.advanced.radarOpacityDark")}
              <span className={styles.rowHint}>
                {t("settings.advanced.radarOpacityDarkHint")}
              </span>
            </div>
            <RangeSlider
              value={radarOpacityDark}
              onChange={setRadarOpacityDarkLive}
              min={0.05}
              max={1}
              step={0.05}
              disabled={readOnly}
              formatValue={(v) => `${Math.round(v * 100)}%`}
              ariaLabel={t("settings.advanced.radarOpacityDark")}
            />
          </div>

          {brightnessAvailable && brightnessPercent !== null && (
            <div className={styles.row}>
              <div className={styles.rowLabel}>
                {t("settings.advanced.brightness")}
                <span className={styles.rowHint}>
                  {t("settings.advanced.brightnessHint")}
                </span>
              </div>
              <RangeSlider
                value={brightnessPercent}
                onChange={setBrightnessLive}
                min={brightnessMinPercent}
                max={100}
                step={5}
                disabled={readOnly}
                formatValue={(v) => `${Math.round(v)}%`}
                ariaLabel={t("settings.advanced.brightness")}
              />
            </div>
          )}

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

          <div className={styles.row}>
            <div className={styles.rowLabel}>
              {t("settings.advanced.calmDayFastPath")}
              <span className={styles.rowHint}>
                {t("settings.advanced.calmDayFastPathHint")}
              </span>
            </div>
            <InlineToggle
              value={calmDayFastPath}
              onChange={(v) => saveAdvancedAiFlag("calmDayFastPath", v)}
              onLabel={t("settings.on")}
              offLabel={t("settings.off")}
              readOnly={readOnly}
            />
          </div>

          {/* ──────────────── Sleep mode group ────────────────
              Two-stage screensaver. Stage 1 fades to a minimal clock at
              reduced brightness after sleepStage1Delay; stage 2 (optional)
              switches to a black screen with anti-burn-in dot at the
              brightness floor after a further sleepStage2Delay. Sub-controls
              only render when the parent toggle is on, to keep the section
              compact. */}
          <div className={styles.groupLabel} style={{ marginTop: "1em" }}>
            {t("settings.advanced.sleepGroup")}
          </div>

          <div className={styles.row}>
            <div className={styles.rowLabel}>
              {t("settings.advanced.sleepEnabled")}
              <span className={styles.rowHint}>
                {t("settings.advanced.sleepEnabledHint")}
              </span>
            </div>
            <InlineToggle
              value={sleepEnabled}
              onChange={(v) => saveAdvancedSleepFlag("enabled", v)}
              onLabel={t("settings.on")}
              offLabel={t("settings.off")}
              readOnly={readOnly}
            />
          </div>

          {sleepEnabled && (
            <>
              <div className={styles.row}>
                <div className={styles.rowLabel}>
                  {t("settings.advanced.sleepStage1Delay")}
                  <span className={styles.rowHint}>
                    {t("settings.advanced.sleepStage1DelayHint")}
                  </span>
                </div>
                <select
                  className={styles.select}
                  value={sleepStage1Delay}
                  disabled={readOnly}
                  onChange={(e) => saveAdvancedSleepFlag("stage1Delay", parseInt(e.target.value, 10))}
                >
                  {[1, 2, 5, 10, 15, 30].map((m) => (
                    <option key={m} value={m}>{t("settings.advanced.sleepMinutes", { count: m })}</option>
                  ))}
                </select>
              </div>

              {brightnessAvailable && (
                <div className={styles.row}>
                  <div className={styles.rowLabel}>
                    {t("settings.advanced.sleepStage1Brightness")}
                    <span className={styles.rowHint}>
                      {t("settings.advanced.sleepStage1BrightnessHint")}
                    </span>
                  </div>
                  <RangeSlider
                    value={sleepStage1Brightness}
                    onChange={(v) => saveAdvancedSleepFlag("stage1Brightness", Math.round(v))}
                    min={brightnessMinPercent}
                    max={100}
                    step={5}
                    disabled={readOnly}
                    formatValue={(v) => `${Math.round(v)}%`}
                    ariaLabel={t("settings.advanced.sleepStage1Brightness")}
                  />
                </div>
              )}

              <div className={styles.row}>
                <div className={styles.rowLabel}>
                  {t("settings.advanced.sleepStage2Enabled")}
                  <span className={styles.rowHint}>
                    {t("settings.advanced.sleepStage2EnabledHint")}
                  </span>
                </div>
                <InlineToggle
                  value={sleepStage2Enabled}
                  onChange={(v) => saveAdvancedSleepFlag("stage2Enabled", v)}
                  onLabel={t("settings.on")}
                  offLabel={t("settings.off")}
                  readOnly={readOnly}
                />
              </div>

              {sleepStage2Enabled && (
                <div className={styles.row}>
                  <div className={styles.rowLabel}>
                    {t("settings.advanced.sleepStage2Delay")}
                    <span className={styles.rowHint}>
                      {t("settings.advanced.sleepStage2DelayHint")}
                    </span>
                  </div>
                  <select
                    className={styles.select}
                    value={sleepStage2Delay}
                    disabled={readOnly}
                    onChange={(e) => saveAdvancedSleepFlag("stage2Delay", parseInt(e.target.value, 10))}
                  >
                    {[5, 10, 20, 30, 60].map((m) => (
                      <option key={m} value={m}>{t("settings.advanced.sleepMinutes", { count: m })}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className={styles.row}>
                <div className={styles.rowLabel}>
                  {t("settings.advanced.sleepNightMode")}
                  <span className={styles.rowHint}>
                    {t("settings.advanced.sleepNightModeHint")}
                  </span>
                </div>
                <InlineToggle
                  value={sleepNightMode}
                  onChange={(v) => saveAdvancedSleepFlag("nightMode", v)}
                  onLabel={t("settings.on")}
                  offLabel={t("settings.off")}
                  readOnly={readOnly}
                />
              </div>
            </>
          )}

          {/* Experimental group — DEBUG=true only during the v3.0.0
              rollout (Phase 0+). Once Phase 8 (Settings refresh) lands,
              this group migrates into the new "Expérimental" section
              and becomes visible to all local users. Hidden entirely
              for remote and for production kiosks until then.
              See `docs/ui-direction-c-implementation-plan.md`. */}
          {debugEnabled && (
            <>
              <div className={styles.groupLabel} style={{ marginTop: "1em" }}>
                {t("settings.advanced.experimentalGroup")}
              </div>
              <div className={styles.row}>
                <div className={styles.rowLabel}>
                  {t("settings.advanced.experimentalUiC")}
                  <span className={styles.rowHint}>
                    {t("settings.advanced.experimentalUiCHint")}
                  </span>
                </div>
                <InlineToggle
                  value={experimentalUiC}
                  onChange={(v) => saveAdvancedExperimentalFlag("uiC", v)}
                  onLabel={t("settings.on")}
                  offLabel={t("settings.off")}
                  readOnly={readOnly}
                />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

AdvancedSettings.propTypes = {
  readOnly: PropTypes.bool,
};

export default AdvancedSettings;
