import { useState, useEffect, useCallback } from "react";
import axios from "axios";

// After a relaunch is triggered, re-query once the kiosk has had time to come
// back so `applied` reflects the new value. Matters only for a remote/tunnel
// client — the on-Pi kiosk page is gone by then.
const RELAUNCH_REFETCH_MS = 9000;

/**
 * Self-contained state for the kiosk display-scale override
 * (`/api/display-scale`).
 *
 * The scale is a physical-screen setting in the brightness category — read
 * open, written localhost-only — that corrects the auto-detected device-
 * scale-factor when a panel's EDID misreports its physical size (so
 * `detect-display-scale.sh` lands on the wrong factor, usually 1.0). It is
 * NOT a per-viewer preference: it tunes the Pi's kiosk screen and applies on
 * the next kiosk relaunch (a browser launch flag can't change on a live page).
 *
 * Fetched once on mount. `displayScaleAvailable` is false on non-kiosk
 * installs (no browser.conf — macOS dev box, headless) so the Settings
 * control hides, exactly like `brightnessAvailable`. `saveDisplayScale`
 * optimistically updates local state then POSTs; no debounce (it's a discrete
 * picker). `displayScaleAuto` is what Auto resolves to ("1.25" / null ⇒ 1.0);
 * `displayScaleApplied` is the scale on the RUNNING kiosk ("1.25"/"1"/null) so
 * the UI can show the "Relaunch to apply" button only when a relaunch would
 * actually change something. `relaunchKiosk` cycles the kiosk to apply a
 * pending change.
 *
 * @returns {object} display-scale state + saveDisplayScale + relaunchKiosk
 */
export function useDisplayScale() {
  const [displayScaleAvailable, setDisplayScaleAvailable] = useState(false);
  const [displayScaleOverride, setDisplayScaleOverride] = useState("auto");
  const [displayScaleAuto, setDisplayScaleAuto] = useState(null); // null ⇒ 1.0
  const [displayScaleApplied, setDisplayScaleApplied] = useState(null); // running kiosk
  const [displayScalePpi, setDisplayScalePpi] = useState(null);
  const [displayScaleChoices, setDisplayScaleChoices] = useState([]);

  // Query the server: kiosk install? current override? what Auto detects?
  // what's applied to the running kiosk right now?
  const fetchState = useCallback(() => {
    axios.get("/api/display-scale").then((res) => {
      if (res.data?.available) {
        setDisplayScaleAvailable(true);
        setDisplayScaleOverride(res.data.override ?? "auto");
        setDisplayScaleAuto(res.data.autoDetected ?? null);
        setDisplayScaleApplied(res.data.applied ?? null);
        setDisplayScalePpi(typeof res.data.ppi === "number" ? res.data.ppi : null);
        if (Array.isArray(res.data.choices)) setDisplayScaleChoices(res.data.choices);
      }
    }).catch(() => undefined);
  }, []);

  useEffect(() => { fetchState(); }, [fetchState]);

  // Discrete setter — optimistic local flip, then persist. The new value
  // takes effect on the next kiosk relaunch (browser launch flag).
  const saveDisplayScale = useCallback((val) => {
    setDisplayScaleOverride(val);
    axios.post("/api/display-scale", { scale: val }).catch(() => undefined);
  }, []);

  // Relaunch the kiosk to apply a pending scale change. The Pi's own kiosk
  // page is torn down by the relaunch (no UI follow-up needed); a remote /
  // tunnel client survives, so refetch once the kiosk is back to refresh
  // `applied`.
  const relaunchKiosk = useCallback(() => {
    axios.post("/api/relaunch-kiosk").catch(() => undefined);
    setTimeout(fetchState, RELAUNCH_REFETCH_MS);
  }, [fetchState]);

  return {
    displayScaleAvailable,
    displayScaleOverride,
    displayScaleAuto,
    displayScaleApplied,
    displayScalePpi,
    displayScaleChoices,
    saveDisplayScale,
    relaunchKiosk,
  };
}
