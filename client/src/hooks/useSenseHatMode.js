import { useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";

// The four Sense HAT display modes the server accepts (mirrors VALID_MODES in
// server/sensehatModeCtrl.js). "clock" runs its own daemon; weather/radar/auto
// share the weather daemon and differ only in the render personality.
const VALID_MODES = ["weather", "clock", "radar", "auto"];

/**
 * Self-contained state for the Sense HAT display-mode toggle.
 *
 * Two probes at mount:
 *   - GET /api/sensehat-available — sets `available` once. The
 *     v3 SettingsPanel uses this flag to hide the toggle on the
 *     fleet's Pis that don't have a Sense HAT (6 of 7 as of
 *     2026-05).
 *   - GET /api/sensehat-mode — initial `mode`. Falls back to
 *     "weather" on any error so the UI doesn't render an empty
 *     segmented control.
 *
 * `saveMode(newMode)` POSTs the new value. The server-side
 * handler is responsible for persisting to settings.json AND
 * flipping the systemd services; on success it returns the new
 * mode, on error it returns a structured 4xx/5xx. We update the
 * local state optimistically and roll back on failure so the
 * toggle never lies about what the server actually has.
 *
 * @returns {object} { senseHatAvailable, senseHatMode, saveSenseHatMode }
 */
// Debounce window for clock-brightness writes. Same rationale as the
// radar-opacity sliders elsewhere — local state flips immediately as
// the user drags so the UI is responsive, but the POST to the server
// (which restarts the systemd service) is coalesced into one call
// when the drag settles.
// Bumped 500 → 1500 ms: the clock-brightness POST still restarts its systemd
// unit, so coalescing fast slider moves into one settle avoids a restart storm
// (overlapping restarts left a stuck black frame, most visible on the v1 HAT).
// The radar slider applies live with no restart, but shares this debounce.
const BRIGHTNESS_SAVE_DEBOUNCE_MS = 1500;

/**
 * Hook owning the Sense HAT toggle + clock brightness state. Returns
 * `senseHatAvailable`, `senseHatMode`, `saveSenseHatMode(mode)`,
 * `senseHatClockBrightness`, `setSenseHatClockBrightnessLive(percent)`.
 *
 * @returns {{
 *   senseHatAvailable: boolean,
 *   senseHatMode: "weather"|"clock"|"radar"|"auto",
 *   saveSenseHatMode: (mode: string) => Promise<void>,
 *   senseHatClockBrightness: number,
 *   setSenseHatClockBrightnessLive: (percent: number) => void,
 *   senseHatRadarBrightness: number,
 *   setSenseHatRadarBrightnessLive: (percent: number) => void
 * }}
 *   `senseHatAvailable` is `false` until `/api/sensehat-available` answers
 *   affirmatively (so the toggle stays hidden on the Pis with no HAT, and on any
 *   probe failure). `senseHatMode` starts at `"weather"` and only changes to a
 *   value in `VALID_MODES`. `saveSenseHatMode` updates local state optimistically,
 *   POSTs, and rolls back on failure; it never rejects, and no-ops on an
 *   unrecognised mode. Note the resolved value is NOT uniform: `.catch`
 *   passes the fulfillment through, so a successful POST resolves with the
 *   AxiosResponse, while the rejected and unrecognised-mode paths resolve
 *   with `undefined`. Callers should await it for sequencing only, never
 *   read the value. The two brightness values are
 *   percentages, 0-100 (clock defaults to 50, radar to 60); their `…Live` setters
 *   apply immediately in the UI and coalesce the POST until the slider has been
 *   still for `BRIGHTNESS_SAVE_DEBOUNCE_MS` (1.5 s).
 */
export function useSenseHatMode() {
  const [available, setAvailable] = useState(false);
  const [mode, setMode] = useState("weather");
  const [clockBrightness, setClockBrightness] = useState(50);
  const [radarBrightness, setRadarBrightness] = useState(60);

  useEffect(() => {
    let cancelled = false;
    axios.get("/api/sensehat-available")
      .then((res) => { if (!cancelled) setAvailable(Boolean(res?.data?.available)); })
      .catch(() => undefined);
    axios.get("/api/sensehat-mode")
      .then((res) => {
        if (!cancelled) {
          const m = res?.data?.mode;
          if (VALID_MODES.includes(m)) setMode(m);
        }
      })
      .catch(() => undefined);
    axios.get("/api/sensehat-clock-brightness")
      .then((res) => {
        if (!cancelled) {
          const b = res?.data?.brightness;
          if (typeof b === "number" && b >= 0 && b <= 100) setClockBrightness(b);
        }
      })
      .catch(() => undefined);
    axios.get("/api/sensehat-radar-brightness")
      .then((res) => {
        if (!cancelled) {
          const b = res?.data?.brightness;
          if (typeof b === "number" && b >= 0 && b <= 100) setRadarBrightness(b);
        }
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const saveMode = useCallback((newMode) => {
    if (!VALID_MODES.includes(newMode)) return Promise.resolve();
    const previous = mode;
    setMode(newMode);
    return axios.post("/api/sensehat-mode", { mode: newMode })
      .catch((err) => {
        // Roll back the optimistic update so the UI matches the
        // server. 403 = remote client (POST is localhostOnly) — log
        // only; other errors get console.warn.
        setMode(previous);
        if (err && err.response && err.response.status === 403) return;
        console.warn("[sensehat] mode switch failed:", err && err.message);
      });
  }, [mode]);

  // Debounced live setter for the clock-brightness slider. UI state
  // flips on every drag tick, but the POST (which restarts the
  // systemd unit) only fires after the user pauses dragging for
  // ~500 ms — avoids restart-storming the service.
  const brightnessSaveTimerRef = useRef(null);
  const setClockBrightnessLive = useCallback((v) => {
    setClockBrightness(v);
    if (brightnessSaveTimerRef.current) clearTimeout(brightnessSaveTimerRef.current);
    brightnessSaveTimerRef.current = setTimeout(() => {
      axios.post("/api/sensehat-clock-brightness", { brightness: v })
        .catch((err) => {
          if (err && err.response && err.response.status === 403) return;
          console.warn("[sensehat] brightness save failed:", err && err.message);
        });
    }, BRIGHTNESS_SAVE_DEBOUNCE_MS);
  }, []);

  // Same debounced-save pattern for the radar night-brightness slider.
  // The weather daemon picks up the new value the next time it polls
  // /api/sensehat, but the POST also restarts pi-sensehat.service so the
  // change is visible immediately rather than up to a poll-interval later.
  const radarBrightnessSaveTimerRef = useRef(null);
  const setRadarBrightnessLive = useCallback((v) => {
    setRadarBrightness(v);
    if (radarBrightnessSaveTimerRef.current) clearTimeout(radarBrightnessSaveTimerRef.current);
    radarBrightnessSaveTimerRef.current = setTimeout(() => {
      axios.post("/api/sensehat-radar-brightness", { brightness: v })
        .catch((err) => {
          if (err && err.response && err.response.status === 403) return;
          console.warn("[sensehat] radar brightness save failed:", err && err.message);
        });
    }, BRIGHTNESS_SAVE_DEBOUNCE_MS);
  }, []);

  return {
    senseHatAvailable: available,
    senseHatMode: mode,
    saveSenseHatMode: saveMode,
    senseHatClockBrightness: clockBrightness,
    setSenseHatClockBrightnessLive: setClockBrightnessLive,
    senseHatRadarBrightness: radarBrightness,
    setSenseHatRadarBrightnessLive: setRadarBrightnessLive,
  };
}
