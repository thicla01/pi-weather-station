import { useState, useEffect, useRef } from "react";
import axios from "axios";

const BRIGHTNESS_SAVE_DEBOUNCE_MS = 250;

/**
 * Self-contained state for the screen-saver / brightness subsystem.
 *
 * Owns:
 * - `brightness*` triplet — fetched once on mount from `/api/brightness`,
 *   exposes the current percent + the device's min floor + whether the
 *   backlight is even controllable on this hardware (HDMI monitors,
 *   x86 dev boxes, etc. expose `available: false`).
 * - `setBrightnessLive` — debounced setter for the slider. Local state
 *   flips immediately so the thumb tracks the cursor smoothly; the
 *   sysfs write is debounced 250 ms (faster than the radar opacity
 *   slider's 500 ms because users expect dimming to react quickly).
 * - The six sleep-mode preference values (`sleepEnabled`, `sleepStage1*`,
 *   `sleepStage2*`, `sleepNightMode`) — exposed with their raw setters so
 *   `saveAdvancedSleepFlag` in AppContext can still flip them
 *   optimistically before the PATCH. The save chain stays in AppContext
 *   because it rebuilds the full `advanced.*` tree (which spans ai +
 *   display + sleep + experimental + pollen); pulling it in here would
 *   require either parameter-passing every other branch's current value,
 *   or duplicating the assembly. Tracked as a follow-up — extracting
 *   `buildAdvancedSubtree()` is a separate refactor.
 *
 * @returns {object} brightness + sleep state with their raw setters
 */
export function useScreenSaver() {
  // Display brightness — null until the server reports its state. If the
  // server reports `available: false` (HDMI monitor without backlight
  // overlay), brightnessAvailable stays false and the slider is hidden.
  const [brightnessPercent, setBrightnessPercent] = useState(null);
  const [brightnessAvailable, setBrightnessAvailable] = useState(false);
  const [brightnessMinPercent, setBrightnessMinPercent] = useState(10);

  // Sleep mode — stage 1 fades to a stylish minimal clock at reduced
  // brightness after sleepStage1Delay minutes of inactivity; stage 2
  // (optional) goes to a black screen with an anti-burn-in moving dot
  // at minimum brightness after another sleepStage2Delay minutes.
  // sleepNightMode flips the stage-1 palette to deep red for a
  // night-friendly readout.
  const [sleepEnabled, setSleepEnabled] = useState(false);
  const [sleepStage1Delay, setSleepStage1Delay] = useState(10); // minutes
  const [sleepStage1Brightness, setSleepStage1Brightness] = useState(30); // percent
  const [sleepStage2Enabled, setSleepStage2Enabled] = useState(true);
  const [sleepStage2Delay, setSleepStage2Delay] = useState(20); // minutes (after stage 1)
  const [sleepNightMode, setSleepNightMode] = useState(true);

  // Initial fetch — server tells us whether the device exposes a
  // backlight (sysfs path), the current value, and the floor.
  useEffect(() => {
    axios.get("/api/brightness").then((res) => {
      if (res.data?.available) {
        setBrightnessAvailable(true);
        setBrightnessPercent(res.data.percent);
        if (typeof res.data.minPercent === "number") {
          setBrightnessMinPercent(res.data.minPercent);
        }
      }
    }).catch(() => undefined);
  }, []);

  // Debounced setter for the brightness slider.
  const brightnessSaveTimerRef = useRef(null);
  const setBrightnessLive = (v) => {
    setBrightnessPercent(v);
    clearTimeout(brightnessSaveTimerRef.current);
    brightnessSaveTimerRef.current = setTimeout(() => {
      axios.post("/api/brightness", { percent: v }).catch(() => undefined);
    }, BRIGHTNESS_SAVE_DEBOUNCE_MS);
  };

  return {
    // Brightness
    brightnessPercent,
    brightnessAvailable,
    brightnessMinPercent,
    setBrightnessLive,
    // Sleep mode — setters exposed for saveAdvancedSleepFlag's
    // optimistic-update path in AppContext.
    sleepEnabled, setSleepEnabled,
    sleepStage1Delay, setSleepStage1Delay,
    sleepStage1Brightness, setSleepStage1Brightness,
    sleepStage2Enabled, setSleepStage2Enabled,
    sleepStage2Delay, setSleepStage2Delay,
    sleepNightMode, setSleepNightMode,
  };
}
