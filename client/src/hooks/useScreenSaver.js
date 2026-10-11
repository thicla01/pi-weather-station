import { useState, useEffect, useRef, useCallback } from "react";
import axios from "axios";
import {
  DEFAULT_MIN_BRIGHTNESS_PERCENT,
  isLoopbackHostname,
  planBootBrightness,
  readLastUserBrightness,
  restoreBrightnessVerified,
  takeBrightnessBeforeSleep,
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
 *   A page reloaded during sleep restores the pre-sleep value the App
 *   persisted, and a reading below the floor (panel left dark) is never
 *   adopted: the hook restores the last slider value, or
 *   DEFAULT_RESTORE_BRIGHTNESS_PERCENT (`planBootBrightness` in
 *   `services/brightnessRestore.js`).
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
  const [brightnessMinPercent, setBrightnessMinPercent] = useState(DEFAULT_MIN_BRIGHTNESS_PERCENT);
  // Set once the user moves the slider: a boot restore still in flight
  // must not overwrite their choice with its retries.
  const userSetBrightnessRef = useRef(false);

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
  // A new page always starts awake, so it settles any wake restore the
  // previous page still owed (incident 2026-10-11: a page reloaded during
  // sleep adopted the dark panel's 0 %, and every later wake "restored"
  // it). `planBootBrightness` decides:
  // - the App persisted a pre-sleep value (the page was reloaded during
  //   stage 1 or 2: kiosk relaunch, in-app update, refresh) → restore it;
  // - else a reading at or above the floor → adopt it, as before;
  // - else (panel left dark, no persisted value) → the last slider value,
  //   or the 70 % default.
  // A restore goes through the same verify + bounded retry as the wake
  // restore, since an ED-MONITOR DDC/CI write can time out silently.
  //
  // A reading is never stored as the user's choice: at boot it can't be
  // told apart from a stage-1 dim or an out-of-band write. Only the
  // slider writes `lastUserBrightness`.
  //
  // Only a loopback page writes (a remote viewer's POST would be refused
  // and logged as a blocked request; it shows the raw reading instead).
  // Loopback means the kiosk's own browser OR an SSH-tunnel page: both
  // load https://localhost:8443 and the client can't tell them apart. So
  // a tunnel page opened while the kiosk sleeps in stage 2 relights the
  // kiosk's panel behind its black screensaver, until the kiosk's next
  // stage change. Accepted: telling the kiosk apart would take a marker
  // from the updater-hashed `deploy/start-server`, and an idle tunnel
  // tab already drives the kiosk's dim / off writes through its own
  // sleep cycle.
  useEffect(() => {
    let cancelled = false;
    axios.get("/api/brightness").then((res) => {
      if (cancelled || !res.data?.available) return;
      const { percent, minPercent } = res.data;
      setBrightnessAvailable(true);
      if (typeof minPercent === "number") {
        setBrightnessMinPercent(minPercent);
      }
      const plan = planBootBrightness({
        percent,
        minPercent,
        beforeSleep: takeBrightnessBeforeSleep(),
        stored: readLastUserBrightness(),
        canWrite: isLoopbackHostname(window.location.hostname),
      });
      setBrightnessPercent(plan.percent);
      if (plan.relightTo === null) return;
      console.info(`[brightness] panel at ${percent}% on an awake page, restoring ${plan.relightTo}%`);
      restoreBrightnessVerified({
        target: plan.relightTo,
        http: axios,
        isCancelled: () => cancelled || userSetBrightnessRef.current,
      }).then(({ outcome, attempts, observed }) => {
        if (outcome === "giveup" && typeof observed === "number") {
          console.warn(
            `[brightness] boot restore gave up after ${attempts} attempt(s): ` +
            `asked ${plan.relightTo}%, screen still at ${observed}%`
          );
        }
      });
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  // Debounced setter for the brightness slider — the only path that
  // records the user's choice (`lastUserBrightness`), so sleep-driven
  // writes (App's stage dim / off / wake restore) never become it.
  const brightnessSaveTimerRef = useRef(null);
  const setBrightnessLive = useCallback((v) => {
    userSetBrightnessRef.current = true;
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
