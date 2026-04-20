import React, { useContext, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import styles from "./styles.css";
import { AppContext } from "~/AppContext";
import useDragScroll from "~/hooks/useDragScroll";
import { CSSTransition } from "react-transition-group";
import { InlineIcon } from "@iconify/react";
import closeFilled from "@iconify/icons-carbon/close-filled";
import roundSaveAlt from "@iconify/icons-ic/round-save-alt";
import undoIcon from "@iconify/icons-carbon/undo";
import closeSharp from "@iconify/icons-ion/close-sharp";
import PropTypes from "prop-types";
import "!style-loader!css-loader!./animations.css";

/**
 * Settings page
 *
 * @returns {JSX.Element} Settings page
 */
const Settings = () => {
  const {
    settingsMenuOpen,
    weatherApiKey,
    mapApiKey,
    reverseGeoApiKey,
    anthropicApiKey,
    customLat,
    customLon,
    setSettingsMenuOpen,
    mouseHide,
    saveMouseHide,
    isLocal,
    remoteSecurityEnabled,
  } = useContext(AppContext);
  const { t, i18n } = useTranslation();

  const [mapsKey, setMapsKey] = useState(null);
  const [weatherKey, setWeatherKey] = useState(null);
  const [geoKey, setGeoKey] = useState(null);
  const [anthropicKey, setAnthropicKey] = useState(null);
  const [lat, setLat] = useState(null);
  const [lon, setLon] = useState(null);

  const [currentMapsKey, setCurrentMapsKey] = useState(null);
  const [currentWeatherKey, setCurrentWeatherKey] = useState(null);
  const [currentGeoKey, setCurrentGeoKey] = useState(null);
  const [currentAnthropicKey, setCurrentAnthropicKey] = useState(null);
  const [currentLat, setCurrentLat] = useState(null);
  const [currentLon, setCurrentLon] = useState(null);

  useEffect(() => {
    setCurrentMapsKey(mapApiKey);
    setCurrentWeatherKey(weatherApiKey);
    setCurrentGeoKey(reverseGeoApiKey);
    setCurrentAnthropicKey(anthropicApiKey);
    setCurrentLat(customLat);
    setCurrentLon(customLon);
  }, [
    mapApiKey,
    weatherApiKey,
    reverseGeoApiKey,
    anthropicApiKey,
    customLat,
    customLon,
    currentGeoKey,
    mouseHide,
    saveMouseHide,
  ]);

  useEffect(() => {
    if (mapApiKey) {
      setMapsKey(mapApiKey);
    }
    if (weatherApiKey) {
      setWeatherKey(weatherApiKey);
    }
    if (reverseGeoApiKey) {
      setGeoKey(reverseGeoApiKey);
    }
    if (anthropicApiKey) {
      setAnthropicKey(anthropicApiKey);
    }
    if (customLat) {
      setLat(customLat);
    }
    if (customLon) {
      setLon(customLon);
    }
  }, [mapApiKey, weatherApiKey, reverseGeoApiKey, anthropicApiKey, customLon, customLat]);

  const isRemoteRestricted = !isLocal && remoteSecurityEnabled;
  const settingsScrollRef = useDragScroll();

  return (
    <CSSTransition
      in={settingsMenuOpen}
      unmountOnExit
      timeout={300}
      classNames="animate"
    >
      <div className={styles.container}>
        <div className={styles.header}>{t("settings.title")}</div>
        <div
          className={styles.closeButton}
          onClick={() => {
            setSettingsMenuOpen(false);
          }}
        >
          <InlineIcon icon={closeSharp} />
        </div>
        <div className={styles.settingsContainer} ref={settingsScrollRef}>
          <ToggleButtons />
          {!isRemoteRestricted && (
            <>
              <Input
                label={t("settings.mapsApiKey")}
                val={mapsKey}
                current={currentMapsKey}
                cb={setMapsKey}
                required={true}
              />
              <Input
                label={t("settings.weatherApiKey")}
                val={weatherKey}
                current={currentWeatherKey}
                cb={setWeatherKey}
                required={true}
              />
              <Input
                label={t("settings.geoApiKey")}
                val={geoKey}
                current={currentGeoKey}
                cb={setGeoKey}
              />
              <Input
                label={t("settings.anthropicApiKey")}
                val={anthropicKey}
                current={currentAnthropicKey}
                cb={setAnthropicKey}
              />
              <Input
                label={t("settings.customLat")}
                val={lat}
                cb={setLat}
                current={currentLat}
              />
              <Input
                label={t("settings.customLon")}
                val={lon}
                cb={setLon}
                current={currentLon}
              />
            </>
          )}
          <div className={styles.bottomButtonContainer}>
            <div className={styles.bottomButtonGroup}>
              <div>
                <div className={styles.label}>{t("settings.hideMouse")}</div>
                <ToggleButton
                  button1Label={t("settings.on")}
                  button2Label={t("settings.off")}
                  val={mouseHide}
                  button1Val={true}
                  button2Val={false}
                  cb={saveMouseHide}
                />
              </div>
              <div>
                <div className={styles.label}>{t("settings.language")}</div>
                <ToggleButton
                  options={[
                    { label: "EN", value: "en" },
                    { label: "FR", value: "fr" },
                    { label: "ES", value: "es" },
                  ]}
                  val={["fr", "es"].find((l) => i18n.language.startsWith(l)) || "en"}
                  cb={(lang) => i18n.changeLanguage(lang)}
                />
              </div>
            </div>
            {!isRemoteRestricted && (
              <div className={styles.saveButtonContainer}>
                <SaveButton
                  mapsKey={mapsKey}
                  weatherKey={weatherKey}
                  geoKey={geoKey}
                  anthropicKey={anthropicKey}
                  lat={lat}
                  lon={lon}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </CSSTransition>
  );
};

export default Settings;

/**
 * Save button
 *
 * @param {object} props
 * @param {String} [props.mapsKey]
 * @param {String} [props.weatherKey]
 * @param {String} [props.geoKey]
 * @param {String} [props.anthropicKey]
 * @param {String} [props.lat]
 * @param {String} [props.lon]
 * @returns {JSX.Element} Save button
 */
const SaveButton = ({ mapsKey, weatherKey, geoKey, anthropicKey, lat, lon }) => {
  const { saveSettingsToJson, setSettingsMenuOpen, mouseHide } = useContext(
    AppContext
  );
  const { t } = useTranslation();
  return (
    <div
      className={`${styles.button} ${styles.saveButton} ${
        !mouseHide ? styles.showMouse : ""
      }`}
      onClick={() => {
        saveSettingsToJson({ mapsKey, weatherKey, geoKey, anthropicKey, lat, lon })
          .then(() => {
            setSettingsMenuOpen(false);
          })
          .catch((err) => {
            console.log("err!", err);
          });
      }}
    >
      <div className={styles.label}>{t("settings.save")}</div>
      <div>
        <InlineIcon icon={roundSaveAlt} />
      </div>
    </div>
  );
};

SaveButton.propTypes = {
  mapsKey: PropTypes.string,
  weatherKey: PropTypes.string,
  geoKey: PropTypes.string,
  anthropicKey: PropTypes.string,
  lat: PropTypes.string,
  lon: PropTypes.string,
};

/**
 * Toggle Buttons Group
 *
 * @returns {JSX.Element} A grouping of toggle buttons
 */
const ToggleButtons = () => {
  const {
    tempUnit,
    saveTempUnit,
    speedUnit,
    saveSpeedUnit,
    lengthUnit,
    saveLengthUnit,
    clockTime,
    saveClockTime,
    fontSize,
    saveFontSize,
  } = useContext(AppContext);
  const { t } = useTranslation();

  return (
    <div>
      <div className={styles.label}>{t("settings.units")}</div>

      <div className={styles.toggleButtons}>
        <div>
          <ToggleButton
            options={[
              { label: "F", value: "f" },
              { label: "C", value: "c" },
              { label: "K", value: "k" },
            ]}
            val={tempUnit}
            cb={saveTempUnit}
          />
        </div>
        <div>
          <ToggleButton
            options={[
              { label: "mph",  value: "mph" },
              { label: "m/s",  value: "ms"  },
              { label: "kph",  value: "kmh" },
            ]}
            val={speedUnit}
            cb={saveSpeedUnit}
          />
        </div>
        <div>
          <ToggleButton
            button1Label={"in"}
            button2Label={"mm"}
            val={lengthUnit}
            button1Val={"in"}
            button2Val={"mm"}
            cb={saveLengthUnit}
          />
        </div>
        <div>
          <ToggleButton
            button1Label={"12h"}
            button2Label={"24h"}
            val={clockTime}
            button1Val={"12"}
            button2Val={"24"}
            cb={saveClockTime}
          />
        </div>
      </div>

      <div className={styles.label}>{t("settings.fontSize")}</div>
      <div className={styles.toggleButtons}>
        <div>
          <ToggleButton
            options={[
              { label: t("settings.fontS"), value: "s" },
              { label: t("settings.fontM"), value: "m" },
              { label: t("settings.fontL"), value: "l" },
            ]}
            val={fontSize}
            cb={saveFontSize}
          />
        </div>
      </div>
    </div>
  );
};

/**
 * Toggle buttons — supports 2 buttons (button1/button2 props) or N buttons (options prop)
 *
 * @param {object} props
 * @param {Array} [props.options] Array of {label, value} for variable number of buttons
 * @param {String} [props.button1Label]
 * @param {String} [props.button2Label]
 * @param {*} props.val Current selected value
 * @param {*} [props.button1Val]
 * @param {*} [props.button2Val]
 * @param {Function} props.cb Callback when a button is clicked
 * @returns {JSX.Element} Toggle buttons
 */
const ToggleButton = ({
  options,
  button1Label,
  button2Label,
  val,
  button1Val,
  button2Val,
  cb,
}) => {
  const items = options || [
    { label: button1Label, value: button1Val },
    { label: button2Label, value: button2Val },
  ];
  return (
    <div className={styles.toggleContainer}>
      {items.map(({ label, value }) => (
        <div
          key={value}
          className={`${styles.button} ${value === val ? styles.down : ""}`}
          onClick={() => cb(value)}
        >
          {label}
        </div>
      ))}
    </div>
  );
};

ToggleButton.propTypes = {
  options: PropTypes.arrayOf(PropTypes.shape({
    label: PropTypes.string.isRequired,
    value: PropTypes.any.isRequired,
  })),
  button1Label: PropTypes.string,
  button2Label: PropTypes.string,
  val: PropTypes.any.isRequired,
  button1Val: PropTypes.any,
  button2Val: PropTypes.any,
  cb: PropTypes.func.isRequired,
};

/**
 * Delete button
 *
 * @param {object} props
 * @param {Function} props.cb callback
 * @returns {JSX.Element} Delete button
 */
const DeleteButton = ({ cb }) => {
  return (
    <div className={styles.button} onClick={cb}>
      <InlineIcon icon={closeFilled} />
    </div>
  );
};

DeleteButton.propTypes = {
  cb: PropTypes.func.isRequired,
};

/**
 * Undo button, restores input to default value
 *
 * @param {object} props
 * @param {Function} props.cb callback
 * @returns {JSX.Element} Undo button
 */
const UndoButton = ({ cb }) => {
  return (
    <div className={styles.button} onClick={cb}>
      <InlineIcon icon={undoIcon} />
    </div>
  );
};

UndoButton.propTypes = {
  cb: PropTypes.func.isRequired,
};

/**
 * Settings input
 *
 * @param {object} props
 * @param {String} props.label Label
 * @param {String} props.val value
 * @param {Function} props.cb change callback
 * @param {String} props.current current default value
 * @param {Boolean} [props.required] If input is required
 * @returns {JSX.Element} Input
 */
const Input = ({ label, val, cb, required, current }) => {
  const { t } = useTranslation();
  const [inputValue, setInputValue] = useState(val);
  const [defaultValue, setDefaultValue] = useState(null);

  useEffect(() => {
    if ((val || val === "") && (!defaultValue || defaultValue === "")) {
      setDefaultValue(val);
    }
    setInputValue(val);
  }, [val, defaultValue]);
  return (
    <div className={styles.settingsItem}>
      <div className={styles.label}>{label}</div>
      <div
        className={`${styles.inputContainer} ${
          required && !val ? styles.invalid : ""
        }`}
      >
        <input
          type="text"
          placeholder={t("settings.none")}
          value={inputValue || ""}
          onChange={(e) => {
            const { value } = e.target;
            setInputValue(value);
            cb(value);
          }}
        />

        <div className={styles.buttonContainer}>
          <DeleteButton
            cb={() => {
              setInputValue("");
              cb("");
            }}
          />
          <UndoButton
            cb={() => {
              setInputValue(current);
              cb(current);
            }}
          />
        </div>
      </div>
    </div>
  );
};

Input.propTypes = {
  label: PropTypes.string,
  val: PropTypes.string,
  cb: PropTypes.func.isRequired,
  required: PropTypes.bool,
  current: PropTypes.string,
};
