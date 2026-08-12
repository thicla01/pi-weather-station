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
 * Compute the boot values for all seven preferences, plus the localStorage
 * writes the first-launch seeding pass owes. Called once, lazily, from the
 * hook's first `useState` initializer — localStorage is only READ here; the
 * writes are returned as `pendingWrites` for the mount effect to flush, so
 * nothing mutates external state during render and no setState ever runs
 * inside an effect (react-hooks/set-state-in-effect, v7). Bonus over the
 * old mount-effect bootstrap: state is correct from the very first render,
 * with no default→stored flash.
 *
 * @returns {{values: object, pendingWrites: Array<Array<string>>}} boot
 *   values keyed by preference name + `[key, value]` pairs to persist
 */
function readBootPrefs() {
  const temp = window.localStorage.getItem(TEMP_UNIT_STORAGE_KEY);
  const speed = window.localStorage.getItem(SPEED_UNIT_STORAGE_KEY);
  const length = window.localStorage.getItem(LENGTH_UNIT_STORAGE_KEY);
  const distance = window.localStorage.getItem(DISTANCE_UNIT_STORAGE_KEY);
  const clock = window.localStorage.getItem(CLOCK_UNIT_STORAGE_KEY);
  const pressure = window.localStorage.getItem(PRESSURE_UNIT_STORAGE_KEY);
  const fs = window.localStorage.getItem(FONT_SIZE_STORAGE_KEY);

  const alreadySeeded = window.localStorage.getItem(SYSTEM_PREFS_SEEDED_KEY) === "true";
  const noUnitKeysSet = !temp && !speed && !length && !distance && !clock;
  const sys = (!alreadySeeded && noUnitKeysSet) ? detectSystemDefaults() : null;

  const pendingWrites = [];
  if (sys || !alreadySeeded) {
    // Either we actively seeded, or this is an existing install where
    // the marker just hadn't been flipped yet — either way we record
    // "seeding pass complete" so future loads skip the work.
    pendingWrites.push([SYSTEM_PREFS_SEEDED_KEY, "true"]);
  }

  const values = {
    tempUnit: "f",
    speedUnit: "mph",
    lengthUnit: "in",
    distanceUnit: "mi",
    pressureUnit: "hpa",
    clockTime: "12",
    fontSize: "m",
  };

  if (temp) {
    values.tempUnit = temp;
  } else if (sys) {
    values.tempUnit = sys.tempUnit;
    pendingWrites.push([TEMP_UNIT_STORAGE_KEY, sys.tempUnit]);
  }
  if (speed) {
    values.speedUnit = speed;
  } else if (sys) {
    values.speedUnit = sys.speedUnit;
    pendingWrites.push([SPEED_UNIT_STORAGE_KEY, sys.speedUnit]);
  }
  if (length) {
    values.lengthUnit = length;
  } else if (sys) {
    values.lengthUnit = sys.lengthUnit;
    pendingWrites.push([LENGTH_UNIT_STORAGE_KEY, sys.lengthUnit]);
  }
  if (distance === "mi" || distance === "km") {
    values.distanceUnit = distance;
  } else if (sys) {
    values.distanceUnit = sys.distanceUnit;
    pendingWrites.push([DISTANCE_UNIT_STORAGE_KEY, sys.distanceUnit]);
  }
  // Pressure (v3.1 Phase 2). Three paths: stored value wins; fresh
  // installs seed from the locale like the other units; existing
  // installs (seeded long before this key existed) derive a one-time
  // default from their stored length unit — an imperial-precip user
  // expects inHg on the barometer tile, everyone else gets hPa.
  if (pressure === "hpa" || pressure === "inhg" || pressure === "kpa") {
    values.pressureUnit = pressure;
  } else if (sys) {
    values.pressureUnit = sys.pressureUnit;
    pendingWrites.push([PRESSURE_UNIT_STORAGE_KEY, sys.pressureUnit]);
  } else if (length === "in") {
    values.pressureUnit = "inhg";
    pendingWrites.push([PRESSURE_UNIT_STORAGE_KEY, "inhg"]);
  }
  if (clock) {
    values.clockTime = clock;
  } else if (sys) {
    values.clockTime = sys.clockTime;
    pendingWrites.push([CLOCK_UNIT_STORAGE_KEY, sys.clockTime]);
  }
  if (fs) values.fontSize = fs;

  return { values, pendingWrites };
}

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
  // Boot snapshot: computed once via the lazy initializer (localStorage
  // reads + locale detection only — see readBootPrefs). State is seeded
  // correct from the first render; the old mount-effect bootstrap and its
  // eight synchronous setState calls are gone.
  const [boot] = useState(readBootPrefs);
  const [tempUnit, setTempUnit] = useState(boot.values.tempUnit);
  const [speedUnit, setSpeedUnit] = useState(boot.values.speedUnit);
  const [lengthUnit, setLengthUnit] = useState(boot.values.lengthUnit);
  const [distanceUnit, setDistanceUnit] = useState(boot.values.distanceUnit);
  const [pressureUnit, setPressureUnit] = useState(boot.values.pressureUnit);
  const [clockTime, setClockTime] = useState(boot.values.clockTime);
  const [fontSize, setFontSize] = useState(boot.values.fontSize);

  // Flush the seeding writes the boot snapshot owes — after mount, so the
  // localStorage mutations stay out of render. `boot` is state and never
  // changes, so this runs exactly once.
  useEffect(() => {
    boot.pendingWrites.forEach(([key, val]) => {
      window.localStorage.setItem(key, val);
    });
  }, [boot]);

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
