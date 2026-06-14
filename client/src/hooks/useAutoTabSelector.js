import { useContext, useEffect, useRef, useState, useCallback } from "react";
import {
  SystemContext,
  AlertsContext,
  WeatherDataContext,
  UiPrefsContext,
} from "~/AppContext";
import { useTimeOfDay } from "~/ui/hybrid";
import {
  selectAutoTab,
  hazardTab,
  summarizeForecast,
  severeAlertKeys,
} from "~/ui/autoTabSelector";

// localStorage key written on a user metric tap (the manual-hold stamp).
// The pure reducer reads it back through `state.manualHoldAt`.
const MANUAL_HOLD_KEY = "ambient.chartTabs.manualHold";

// Evaluate only on data-refresh ticks, coalesced with a debounce so three
// async payloads landing together produce one decision (LLD §9, brake 1).
const EVAL_DEBOUNCE_MS = 30 * 1000;

/**
 * Read the manual-hold timestamp (epoch ms) from localStorage, or null.
 *
 * @returns {?Number} epoch ms, or null when absent / unparseable
 */
function readManualHold() {
  try {
    const raw = window.localStorage.getItem(MANUAL_HOLD_KEY);
    if (raw == null) return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * Phase-1 driver for the auto-tab selector. Subscribes to the existing
 * contexts, assembles the native-unit signals snapshot, evaluates the pure
 * reducer (client/src/ui/autoTabSelector.js) on data-refresh ticks
 * (debounced), and exposes the commanded metric + a manual-hold stamper.
 *
 * NO radar in Phase 1: `radarAlertState` is always null, so the reducer's
 * radar class is skipped (it is partial-data-tolerant). Radar is Phase 2.
 *
 * The reducer is pure; all the React-specific plumbing (context reads, the
 * debounce, the manual-hold round-trip through localStorage, the
 * stage-2→stage-0 hold clear) lives here.
 *
 * @param {?String} activeMetric the metric currently shown (the active
 *   period's tab — "temp" | "wind" | "precip" | "grid")
 * @returns {{commandedMetric: ?String, autoSwitchSource: ?String, stampManualHold: (function(): void)}}
 *   the commanded metric (null = leave the user's tab), the source badge for
 *   the reason chip, and a callback to stamp the manual hold on a user tap
 */
export default function useAutoTabSelector(activeMetric) {
  const ui = useContext(UiPrefsContext);
  const system = useContext(SystemContext);
  const alerts = useContext(AlertsContext);
  const weather = useContext(WeatherDataContext);
  const palette = useTimeOfDay();

  const autoSelectTab = !!(ui && ui.autoSelectTab);
  const sleepStage = system ? system.sleepStage : 0;
  const govAlerts = (alerts && alerts.govAlerts) || null;
  const currentWeatherData = weather && weather.currentWeatherData;
  const hourlyWeatherData = weather && weather.hourlyWeatherData;

  // The metric the hook is currently commanding (null = leave the user's
  // tab; the null-on-calm contract). Source is the badge for the chip.
  const [commanded, setCommanded] = useState({ metric: null, source: null });

  const lastAutoSwitchAtRef = useRef(null);
  const knownSevereRef = useRef(null); // null = not yet seeded
  const prevStageRef = useRef(sleepStage);

  // Clear the manual hold on a stage-2 → stage-0 wake (a genuinely new
  // viewing session). Returning to stage 0 from stage 1 does NOT clear it
  // (same person, still mid-read) — LLD §8.
  useEffect(() => {
    if (prevStageRef.current === 2 && sleepStage === 0) {
      try {
        window.localStorage.removeItem(MANUAL_HOLD_KEY);
      } catch {
        /* ignore */
      }
    }
    prevStageRef.current = sleepStage;
  }, [sleepStage]);

  // A user tap takes back control: stamp the hold and drop any command.
  const stampManualHold = useCallback(() => {
    try {
      window.localStorage.setItem(MANUAL_HOLD_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    setCommanded({ metric: null, source: null });
  }, []);

  // Turning the feature off clears any standing command. Turning it back on
  // resets the dwell floor + known-severe seed so a re-enable behaves like a
  // fresh mount (no stale dwell silently suppressing the first switch).
  useEffect(() => {
    if (!autoSelectTab) {
      setCommanded({ metric: null, source: null });
    } else {
      lastAutoSwitchAtRef.current = null;
      knownSevereRef.current = null;
    }
  }, [autoSelectTab]);

  // Evaluate on data-refresh ticks (currentWeatherData / hourlyWeatherData /
  // govAlerts / sleepStage landings), debounced. NEVER on a setInterval.
  useEffect(() => {
    // Seed the known-severe set on first run so a pre-existing alert at
    // mount doesn't false-puncture an (absent) manual hold.
    if (knownSevereRef.current === null) {
      knownSevereRef.current = severeAlertKeys(govAlerts);
    }
    const timer = setTimeout(() => {
      const now = Date.now();
      const currentInterval =
        currentWeatherData?.data?.timelines?.[0]?.intervals?.[0];
      const hourlyIntervals =
        hourlyWeatherData?.data?.timelines?.[0]?.intervals;
      const forecast = summarizeForecast(currentInterval, hourlyIntervals, now);
      const env = {
        autoSelectEnabled: autoSelectTab,
        touchCapable:
          typeof navigator !== "undefined" && navigator.maxTouchPoints > 0,
        sleepStage,
        nightQuiet: palette === "nightRed",
      };
      const signals = { govAlerts, radarAlertState: null, forecast, env };
      const state = {
        currentTab: activeMetric,
        manualHoldAt: readManualHold(),
        lastAutoSwitchAt: lastAutoSwitchAtRef.current,
        knownSevereAlertKeys: knownSevereRef.current,
      };
      const decision = selectAutoTab(signals, state, now);
      // The ungated live verdict drives the chip's lifetime (separate from
      // the gated switch decision): when the weather goes calm, clear a
      // standing command so the chip can't outlive its hazard; if the same
      // tab is now justified by a different source, keep the badge honest.
      const verdict = hazardTab(signals, activeMetric);
      if (decision) {
        lastAutoSwitchAtRef.current = now;
        setCommanded({ metric: decision.tab, source: decision.sourceBadge });
      } else {
        setCommanded((prev) => {
          if (!prev.metric) return prev;
          // The commanded tab is no longer the live verdict (calm, or the
          // hazard moved to another tab) → drop it so the chip clears.
          if (!verdict || verdict.tab !== prev.metric) return { metric: null, source: null };
          // Same tab, different source now justifies it → keep the badge honest.
          if (verdict.sourceBadge !== prev.source) return { metric: prev.metric, source: verdict.sourceBadge };
          return prev;
        });
      }
      // Fold the current severe alerts into the known set so a NEW one is
      // "new" exactly once, then never re-punctures.
      knownSevereRef.current = severeAlertKeys(govAlerts);
    }, EVAL_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [
    currentWeatherData,
    hourlyWeatherData,
    govAlerts,
    sleepStage,
    autoSelectTab,
    palette,
    activeMetric,
  ]);

  return {
    commandedMetric: commanded.metric,
    autoSwitchSource: commanded.source,
    stampManualHold,
  };
}
