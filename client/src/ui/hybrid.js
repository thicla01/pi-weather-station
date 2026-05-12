/**
 * Hybrid-mode + time-of-day helpers for UI Direction C.
 *
 * "Hybrid" refers to the instrumentation-style visual escalation that
 * triggers when severe alerts are active: severity strip across the top
 * of slabs, monospace numerals on key metrics, surface opacity bumped
 * from 0.85 → 0.96, and chip-style metadata. Hybrid mode is a property
 * of the *current weather state*, not a user toggle — it kicks in
 * automatically so the kiosk visually signals "something is happening"
 * without the user needing to look closely.
 *
 * "Time of day" picks one of the four palettes (day / dusk / night /
 * nightRed) based on local solar position + the existing
 * `advanced.sleep.nightMode` flag. Day and night are obvious; dusk is
 * the ~1h around sunrise/sunset; nightRed is the long-wavelength
 * melatonin-friendly variant carried over from v2.13.
 */

import { useContext, useMemo } from "react";
import { AppContext } from "~/AppContext";

// Confidence buckets — duplicated from AlertBanner so we have a single
// source of truth in `ui/` going forward. Thresholds match the v2.13
// behaviour exactly so AlertBanner can switch to importing from here
// without changing what users see.
const CONFIDENCE_HIGH = 70;
const CONFIDENCE_MID = 40;

/**
 * Bucket a 0–100 confidence value into one of three tiers.
 *
 * @param {Number} c — confidence percentage, 0 to 100
 * @returns {"high"|"mid"|"low"} bucket label used for colour-coding pills
 */
export function confidenceBucket(c) {
  if (c >= CONFIDENCE_HIGH) return "high";
  if (c >= CONFIDENCE_MID) return "mid";
  return "low";
}

/**
 * Decide the hybrid escalation level from the current data envelope.
 *
 * Returns one of:
 *   - `"none"` — no escalation; calm slabs, full transparency.
 *   - `"light"` — moderate alert active; severity strip on slabs that
 *     reference the alert, but body styling stays calm.
 *   - `"full"` — severe alert (`severe`/`extreme`); bumped opacity,
 *     monospace numerals, severity strip everywhere.
 *
 * The function is intentionally tolerant of partial / missing data so
 * it's safe to call before the first weather payload arrives — undefined
 * branches just route to `"none"`.
 *
 * @param {object} [data] — weather state envelope (may be partial)
 * @param {Array}  [data.alerts] — active alert objects with a `severity`
 * @param {String} [data.alerts[].severity] — `"minor"|"moderate"|"severe"|"extreme"`
 * @returns {"none"|"light"|"full"} escalation tier
 */
export function hybridLevel(data) {
  if (!data || !Array.isArray(data.alerts) || data.alerts.length === 0) {
    return "none";
  }
  const severities = data.alerts.map((a) => (a && a.severity) || "minor");
  if (severities.some((s) => s === "severe" || s === "extreme")) {
    return "full";
  }
  if (severities.some((s) => s === "moderate")) {
    return "light";
  }
  return "none";
}

/**
 * React hook — exposes the current hybrid level (and a convenience
 * boolean) based on whatever the active alert state is in AppContext.
 *
 * The hook is memoized on the alert list reference, so consumers that
 * read `level` or `isHybrid` only re-render when the alert payload
 * actually changes (not on every weather refresh).
 *
 * @returns {{ level: "none"|"light"|"full", isHybrid: Boolean }} current escalation tier and a convenience boolean
 */
export function useHybridMode() {
  const ctx = useContext(AppContext);
  // AppContext exposes government weather alerts as `govAlerts`. Other
  // alert sources (Tomorrow.io advisories etc.) could be folded in here
  // later — for now the gov feed is the authoritative severity signal.
  const alerts = ctx && ctx.govAlerts;
  return useMemo(() => {
    const level = hybridLevel({ alerts });
    return { level, isHybrid: level !== "none" };
  }, [alerts]);
}

/**
 * React hook — resolves the active palette key from local solar
 * position + the user's nightMode preference.
 *
 * Today this returns a single key based on `darkMode` + `nightMode`
 * because solar-position wiring lives in Phase 5 (sleep mode integration).
 * Phase 5 will replace this with proper sunrise/sunset awareness so the
 * UI gradually shifts day → dusk → night without the user toggling
 * anything.
 *
 * @returns {"day"|"dusk"|"night"|"nightRed"} active palette key
 */
export function useTimeOfDay() {
  const ctx = useContext(AppContext);
  const darkMode = ctx && ctx.darkMode;
  // `nightMode` is the long-wavelength-red preference from
  // `advanced.sleep.nightMode`. It's only meaningful when darkMode is on
  // — daytime kiosks ignore it.
  const nightMode = ctx && ctx.sleepNightMode;
  if (!darkMode) return "day";
  if (nightMode) return "nightRed";
  // Without solar wiring we can't yet distinguish dusk from night.
  // Default to `dusk` because that's the palette the Phase 0 anchors
  // were drawn from and it reads correctly at any hour. Phase 5 swaps
  // this for a real solar check.
  return "dusk";
}
