import { useState, useEffect, useRef, useCallback } from "react";
import axios from "axios";
import {
  isLoopbackHostname,
  readLastUserBrightness,
  resolveUserBrightness,
  writeLastUserBrightness,
} from "~/services/brightnessRestore";

const BRIGHTNESS_SAVE_DEBOUNCE_MS = 250;

/**
 * Self-contained state for the screen-saver / brightness subsystem.
 *
 * Owns:
 * - `brightness*` triplet — fetched once on mount from `/api/brightness`,
 *   exposes the current percent + the device's min floor + whether the
 *   screen brightness is controllable on this hardware (a sysfs
 *   backlight, or DDC/CI on an EDATEC ED-MONITOR via `ed-ddc-server`;
 *   other HDMI monitors, x86 dev boxes, etc. expose `available: false`).
 *   A reading below the floor (panel left dark by sleep stage 2 across a
 *   page reload) is never adopted: the hook relights the screen to the
 *   last slider value, or DEFAULT_RESTORE_BRIGHTNESS_PERCENT
 *   (`services/brightnessRestore.js`).
 * - `setBrightnessLive` — debounced setter for the slider. Local state
 *   flips immediately so the thumb tracks the cursor smoothly; the
 *   active backend's write (sysfs or ed-ddc-server) is debounced 250 ms
 *   (faster than the radar opacity slider's 500 ms because users expect
 *   dimming to react quickly). The debounced write also stores the value
 *   per device in localStorage (`lastUserBrightness`).
 * - The six sleep-mode preference values (`sleepEnabled`, `sleepStage1*`,
 *   `sleepStage2*`, `sleepNightMode`) — exposed with their raw setters so
 *   `saveAdvancedSleepFlag` in AppContext can still flip them
 *   optimistically before the PATCH. The save chain stays in AppContext
 *   because it rebuilds the full `advanced.*` tree (which spans ai +
 *   display + sleep + pollen + alerts, assembled by AppContext's
 *   `buildAdvancedSubtree()`, centralised 2026-05-23); pulling it in
 *   here would require either parameter-passing every other branch's
 *   current value, or duplicating the assembly.
 *
 * @returns {object} brightness + sleep state with their raw setters
 */
export function useScreenSaver() {
  // Display brightness — null until the server reports its state. If the
  // server reports `available: false` (no sysfs backlight and no
  // ed-ddc-server DDC/CI monitor, e.g. a generic HDMI monitor),
  // brightnessAvailable stays false and the slider is hidden.
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
  // brightness backend (sysfs backlight or ed-ddc-server DDC/CI), the
  // current value, and the floor.
  //
  // A reading at or above the floor is adopted as is (unchanged
  // behaviour). A reading below it means the page booted awake on a
  // panel left dark — sleep stage 2 writes 0 and only the old page knew
  // the pre-sleep value — so the hook adopts the last slider value (or
  // the default) and writes it once to relight the screen. Without this
  // the awake page sat on a black screen and later wakes "restored" 0.
  //
  // The reading is never stored as the user's choice, even when nothing
  // is stored yet: at boot it can't be told apart from a stage-1 dim
  // (a reload during stage 1 reads e.g. 30) or an out-of-band write, and
  // seeding from it would let a sleep value pose as the user's setting.
  // A reload during stage 1 therefore keeps today's behaviour: the dim
  // level is adopted, the screen stays visible, and the slider fixes it.
  useEffect(() => {
    axios.get("/api/brightness").then((res) => {
      if (!res.data?.available) return;
      const { percent, minPercent } = res.data;
      setBrightnessAvailable(true);
      if (typeof minPercent === "number") {
        setBrightnessMinPercent(minPercent);
      }
      const userPercent = resolveUserBrightness({
        percent,
        minPercent,
        stored: readLastUserBrightness(),
      });
      setBrightnessPercent(userPercent);
      // Only the kiosk's own (loopback) page can write: a remote viewer's
      // POST would be refused and logged as a blocked request.
      if (userPercent !== percent && isLoopbackHostname(window.location.hostname)) {
        console.info(`[brightness] panel at ${percent}% on an awake page, relighting to ${userPercent}%`);
        axios.post("/api/brightness", { percent: userPercent }).catch(() => undefined);
      }
    }).catch(() => undefined);
  }, []);

  // Debounced setter for the brightness slider — the only path that
  // records the user's choice (`lastUserBrightness`), so sleep-driven
  // writes (App's stage dim / off / wake restore) never become it.
  const brightnessSaveTimerRef = useRef(null);
  const setBrightnessLive = useCallback((v) => {
    setBrightnessPercent(v);
    clearTimeout(brightnessSaveTimerRef.current);
    brightnessSaveTimerRef.current = setTimeout(() => {
      writeLastUserBrightness(v);
      axios.post("/api/brightness", { percent: v }).catch(() => undefined);
    }, BRIGHTNESS_SAVE_DEBOUNCE_MS);
  }, []);

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
