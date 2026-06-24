import { useState, useEffect, useCallback } from "react";
import axios from "axios";

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
 * optimistically updates local state then POSTs; no debounce (it's a
 * discrete picker, not a slider). `displayScaleAuto` is what Auto currently
 * resolves to ("1.25", or null ⇒ 1.0) — surfaced so the UI can show
 * "Auto · {N} %".
 *
 * @returns {object} display-scale state + saveDisplayScale
 */
export function useDisplayScale() {
  const [displayScaleAvailable, setDisplayScaleAvailable] = useState(false);
  const [displayScaleOverride, setDisplayScaleOverride] = useState("auto");
  const [displayScaleAuto, setDisplayScaleAuto] = useState(null); // null ⇒ 1.0
  const [displayScalePpi, setDisplayScalePpi] = useState(null);
  const [displayScaleChoices, setDisplayScaleChoices] = useState([]);

  // Initial fetch — server tells us whether this is a kiosk install
  // (browser.conf present), the current override, and what Auto detects.
  useEffect(() => {
    axios.get("/api/display-scale").then((res) => {
      if (res.data?.available) {
        setDisplayScaleAvailable(true);
        setDisplayScaleOverride(res.data.override ?? "auto");
        setDisplayScaleAuto(res.data.autoDetected ?? null);
        setDisplayScalePpi(typeof res.data.ppi === "number" ? res.data.ppi : null);
        if (Array.isArray(res.data.choices)) setDisplayScaleChoices(res.data.choices);
      }
    }).catch(() => undefined);
  }, []);

  // Discrete setter — optimistic local flip, then persist. The new value
  // takes effect on the next kiosk relaunch (browser launch flag).
  const saveDisplayScale = useCallback((val) => {
    setDisplayScaleOverride(val);
    axios.post("/api/display-scale", { scale: val }).catch(() => undefined);
  }, []);

  return {
    displayScaleAvailable,
    displayScaleOverride,
    displayScaleAuto,
    displayScalePpi,
    displayScaleChoices,
    saveDisplayScale,
  };
}
