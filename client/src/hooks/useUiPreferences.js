import { useState, useEffect, useCallback } from "react";

import { detectSystemDefaults } from "~/ui/systemPrefs";

const TEMP_UNIT_STORAGE_KEY = "tempUnit";
const SPEED_UNIT_STORAGE_KEY = "speedUnit";
const LENGTH_UNIT_STORAGE_KEY = "lengthUnit";
const DISTANCE_UNIT_STORAGE_KEY = "distanceUnit";
const PRESSURE_UNIT_STORAGE_KEY = "pressureUnit";
const CLOCK_UNIT_STORAGE_KEY = "clockTime";
const FONT_SIZE_STORAGE_KEY = "fontSize";

// Marker that flags "we've completed the one-time first-launch seeding
// of unit + clock defaults from the browser's locale". The version
// suffix lets us re-seed in a future release if the seeding logic
// changes — `_v1` users keep their current settings; `_v2` would
// re-seed if the rules ever changed materially.
const SYSTEM_PREFS_SEEDED_KEY = "systemPrefsSeeded_v1";

/**
 * Self-contained state for the user's display preferences — the units
 * the dashboard renders weather data in (temperature, wind speed,
 * precipitation length, radius distance, surface pressure), the clock
 * format (12 vs 24 h), and the global font-size zoom.
 *
 * All seven values are persisted to localStorage so they survive reloads
 * (the kiosk's own browser writes them via the save* helpers exposed
 * here; remote clients also persist their per-device override). On
 * first mount the hook hydrates from localStorage, and for genuinely
 * fresh installs (cold browser profile, freshly imaged Pi) it seeds
 * sensible defaults from the browser's locale: en-US → imperial + 12 h,
 * fr-CA → metric + 24 h, en-GB → metric weather + imperial vehicular,
 * etc. The seeding is one-time per device — existing installs that
 * already had any persisted unit value are NEVER re-seeded, so a
 * v2 → v2.18 upgrade can't accidentally flip a user from °F to °C
 * because their browser language happens to say fr-CA.
 *
 * @returns {object} the seven values + their save* helpers (each save*
 *   updates React state AND writes the localStorage key in one step)
 */
export function useUiPreferences() {
  const [tempUnit, setTempUnit] = useState("f");
  const [speedUnit, setSpeedUnit] = useState("mph");
  const [lengthUnit, setLengthUnit] = useState("in");
  const [distanceUnit, setDistanceUnit] = useState("mi");
  const [pressureUnit, setPressureUnit] = useState("hpa");
  const [clockTime, setClockTime] = useState("12");
  const [fontSize, setFontSize] = useState("m");

  // One-time bootstrap from localStorage + first-launch system-prefs
  // seeding. Runs on mount only (deps `[]`); subsequent updates flow
  // through the save* helpers.
  useEffect(() => {
    const temp = window.localStorage.getItem(TEMP_UNIT_STORAGE_KEY);
    const speed = window.localStorage.getItem(SPEED_UNIT_STORAGE_KEY);
    const length = window.localStorage.getItem(LENGTH_UNIT_STORAGE_KEY);
    const distance = window.localStorage.getItem(DISTANCE_UNIT_STORAGE_KEY);
    const clock = window.localStorage.getItem(CLOCK_UNIT_STORAGE_KEY);

    const alreadySeeded = window.localStorage.getItem(SYSTEM_PREFS_SEEDED_KEY) === "true";
    const noUnitKeysSet = !temp && !speed && !length && !distance && !clock;
    const sys = (!alreadySeeded && noUnitKeysSet) ? detectSystemDefaults() : null;
    if (sys || !alreadySeeded) {
      // Either we actively seeded, or this is an existing install where
      // the marker just hadn't been flipped yet — either way we record
      // "seeding pass complete" so future loads skip the work.
      window.localStorage.setItem(SYSTEM_PREFS_SEEDED_KEY, "true");
    }

    if (temp) {
      setTempUnit(temp);
    } else if (sys) {
      setTempUnit(sys.tempUnit);
      window.localStorage.setItem(TEMP_UNIT_STORAGE_KEY, sys.tempUnit);
    }
    if (speed) {
      setSpeedUnit(speed);
    } else if (sys) {
      setSpeedUnit(sys.speedUnit);
      window.localStorage.setItem(SPEED_UNIT_STORAGE_KEY, sys.speedUnit);
    }
    if (length) {
      setLengthUnit(length);
    } else if (sys) {
      setLengthUnit(sys.lengthUnit);
      window.localStorage.setItem(LENGTH_UNIT_STORAGE_KEY, sys.lengthUnit);
    }
    if (distance === "mi" || distance === "km") {
      setDistanceUnit(distance);
    } else if (sys) {
      setDistanceUnit(sys.distanceUnit);
      window.localStorage.setItem(DISTANCE_UNIT_STORAGE_KEY, sys.distanceUnit);
    }
    // Pressure (v3.1 Phase 2). Three paths: stored value wins; fresh
    // installs seed from the locale like the other units; existing
    // installs (seeded long before this key existed) derive a one-time
    // default from their stored length unit — an imperial-precip user
    // expects inHg on the barometer tile, everyone else gets hPa.
    const pressure = window.localStorage.getItem(PRESSURE_UNIT_STORAGE_KEY);
    if (pressure === "hpa" || pressure === "inhg" || pressure === "kpa") {
      setPressureUnit(pressure);
    } else if (sys) {
      setPressureUnit(sys.pressureUnit);
      window.localStorage.setItem(PRESSURE_UNIT_STORAGE_KEY, sys.pressureUnit);
    } else if (length === "in") {
      setPressureUnit("inhg");
      window.localStorage.setItem(PRESSURE_UNIT_STORAGE_KEY, "inhg");
    }
    if (clock) {
      setClockTime(clock);
    } else if (sys) {
      setClockTime(sys.clockTime);
      window.localStorage.setItem(CLOCK_UNIT_STORAGE_KEY, sys.clockTime);
    }
    const fs = window.localStorage.getItem(FONT_SIZE_STORAGE_KEY);
    if (fs) setFontSize(fs);
  }, []);

  const saveTempUnit = useCallback((val) => {
    setTempUnit(val);
    window.localStorage.setItem(TEMP_UNIT_STORAGE_KEY, val);
  }, []);
  const saveSpeedUnit = useCallback((val) => {
    setSpeedUnit(val);
    window.localStorage.setItem(SPEED_UNIT_STORAGE_KEY, val);
  }, []);
  const saveLengthUnit = useCallback((val) => {
    setLengthUnit(val);
    window.localStorage.setItem(LENGTH_UNIT_STORAGE_KEY, val);
  }, []);
  const saveDistanceUnit = useCallback((val) => {
    setDistanceUnit(val);
    window.localStorage.setItem(DISTANCE_UNIT_STORAGE_KEY, val);
  }, []);
  const savePressureUnit = useCallback((val) => {
    setPressureUnit(val);
    window.localStorage.setItem(PRESSURE_UNIT_STORAGE_KEY, val);
  }, []);
  const saveClockTime = useCallback((val) => {
    setClockTime(val);
    window.localStorage.setItem(CLOCK_UNIT_STORAGE_KEY, val);
  }, []);
  const saveFontSize = useCallback((val) => {
    setFontSize(val);
    window.localStorage.setItem(FONT_SIZE_STORAGE_KEY, val);
  }, []);

  return {
    tempUnit, saveTempUnit,
    speedUnit, saveSpeedUnit,
    lengthUnit, saveLengthUnit,
    distanceUnit, saveDistanceUnit,
    pressureUnit, savePressureUnit,
    clockTime, saveClockTime,
    fontSize, saveFontSize,
  };
}
