import { useState, useEffect, useCallback } from "react";
import axios from "axios";

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
export function useSenseHatMode() {
  const [available, setAvailable] = useState(false);
  const [mode, setMode] = useState("weather");

  useEffect(() => {
    let cancelled = false;
    axios.get("/api/sensehat-available")
      .then((res) => { if (!cancelled) setAvailable(Boolean(res?.data?.available)); })
      .catch(() => undefined);
    axios.get("/api/sensehat-mode")
      .then((res) => {
        if (!cancelled) {
          const m = res?.data?.mode;
          if (m === "weather" || m === "clock") setMode(m);
        }
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const saveMode = useCallback((newMode) => {
    if (newMode !== "weather" && newMode !== "clock") return Promise.resolve();
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

  return {
    senseHatAvailable: available,
    senseHatMode: mode,
    saveSenseHatMode: saveMode,
  };
}
