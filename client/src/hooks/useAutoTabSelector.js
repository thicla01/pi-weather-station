import { useContext, useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  SystemContext,
  AlertsContext,
  WeatherDataContext,
  UiPrefsContext,
  RadarStateContext,
} from "~/AppContext";
import { useTimeOfDay } from "~/ui/hybrid";
import { getRadarAlertState, severity } from "~/ui/alertLogic";
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
 * Driver for the auto-tab selector. Subscribes to the existing contexts,
 * assembles the native-unit signals snapshot (gov alerts, radar nowcast,
 * Tomorrow.io forecast), evaluates the pure reducer
 * (client/src/ui/autoTabSelector.js) on data-refresh ticks (debounced), and
 * exposes the commanded metric + a manual-hold stamper.
 *
 * Phase 2: the radar nowcast is wired (Class 3 + the A2 red-radar override),
 * and the active-reader inhibit is scoped to the forecast card (LLD §13) — the
 * caller passes a ref it stamps on slab interaction.
 *
 * The reducer is pure; all the React-specific plumbing (context reads, the
 * debounce, the manual-hold round-trip through localStorage, the
 * stage-2→stage-0 hold clear) lives here.
 *
 * @param {?String} activeMetric the metric currently shown (the active
 *   period's tab — "temp" | "wind" | "precip" | "grid")
 * @param {?{current: Number}} cardActivityRef a ref whose `.current` holds the
 *   epoch ms of the last interaction with the forecast card (touch inhibit)
 * @returns {{commandedMetric: ?String, autoSwitchSource: ?String, stampManualHold: (function(): void)}}
 *   the commanded metric (null = leave the user's tab), the source badge for
 *   the reason chip, and a callback to stamp the manual hold on a user tap
 */
export default function useAutoTabSelector(activeMetric, cardActivityRef) {
  const ui = useContext(UiPrefsContext);
  const system = useContext(SystemContext);
  const alerts = useContext(AlertsContext);
  const weather = useContext(WeatherDataContext);
  const radar = useContext(RadarStateContext);
  const palette = useTimeOfDay();

  const autoSelectTab = !!(ui && ui.autoSelectTab);
  const sleepStage = system ? system.sleepStage : 0;
  const govAlerts = (alerts && alerts.govAlerts) || null;
  const currentWeatherData = weather && weather.currentWeatherData;
  const hourlyWeatherData = weather && weather.hourlyWeatherData;

  // Radar nowcast → the reducer's Class 3 (Phase 2). Reduce the radar slice to
  // the verdict the reducer needs: { tier, confidenceBucket, approaching }.
  // `approaching` mirrors getRadarAlertState's source-trend pick (bumped, or a
  // genuine "approaching" trend on the higher-severity ring). Memoized on the
  // 8 risk/trend fields ONLY — never on currentMapZoom — so a map pan can't
  // re-trigger the eval. currentlyPrecipitating only changes the (unused)
  // i18nKey, so it's passed false.
  const innerRisk = radar && radar.innerRisk;
  const outerRisk = radar && radar.outerRisk;
  const innerTrend = radar && radar.innerTrend;
  const outerTrend = radar && radar.outerTrend;
  const innerBumped = radar && radar.innerBumped;
  const outerBumped = radar && radar.outerBumped;
  const innerConf = radar && radar.innerTrendConfidence;
  const outerConf = radar && radar.outerTrendConfidence;
  const radarAlertState = useMemo(() => {
    const rs = getRadarAlertState(
      innerRisk, outerRisk, innerTrend, outerTrend,
      innerBumped, outerBumped, innerConf, outerConf, false,
    );
    if (!rs) return null;
    const innerIsSource = severity(innerRisk) >= severity(outerRisk);
    const srcTrend = innerIsSource ? innerTrend : outerTrend;
    const srcBumped = innerIsSource ? innerBumped : outerBumped;
    return {
      tier: rs.tier,
      confidenceBucket: rs.confidenceBucket,
      approaching: !!(srcBumped || srcTrend === "approaching"),
    };
  }, [innerRisk, outerRisk, innerTrend, outerTrend, innerBumped, outerBumped, innerConf, outerConf]);

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
        // Active-reader inhibit is scoped to the FORECAST CARD (LLD §13): the
        // most recent interaction timestamp on the slab, read at eval time.
        lastCardActivityAt:
          cardActivityRef && cardActivityRef.current ? cardActivityRef.current : null,
        nightQuiet: palette === "nightRed",
      };
      const signals = { govAlerts, radarAlertState, forecast, env };
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
    radarAlertState,
    autoSelectTab,
    palette,
    activeMetric,
    cardActivityRef,
  ]);

  return {
    commandedMetric: commanded.metric,
    autoSwitchSource: commanded.source,
    stampManualHold,
  };
}
