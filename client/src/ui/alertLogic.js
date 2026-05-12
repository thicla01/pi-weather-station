/**
 * Pure logic for the radar-derived alert banner — extracted from
 * `components/AlertBanner/index.js` so both the v2 banner and the
 * Direction C `ambient/AlertBanner` can render off the same state
 * machine. No React, no JSX, no DOM — safe to test under `node:test`.
 *
 * The exports here cover three concerns:
 *
 *   - `severity(level)` — risk-level → numeric tier for comparison.
 *   - `isCurrentlyPrecipitating(weatherCode)` — Tomorrow.io weather-code
 *     check used to disambiguate "approaching" vs "intensifying" wording
 *     when the analyzer bumps the tier.
 *   - `getRadarAlertState(...)` — the main state machine. Returns an
 *     `{ tier, i18nKey, confidence, confidenceBucket }` object or
 *     `null` when the user shouldn't see a radar-derived banner.
 *
 * The wording rules and softening logic are documented inline at the
 * call sites — see the comments around the `bumped` / `drifting` /
 * `bucket === "low"` branches in `getRadarAlertState`.
 */

import { confidenceBucket } from "./hybrid";

/**
 * Numeric severity for risk-level comparison.
 *
 * @param {string|null} level — "calm" | "yellow" | "orange" | "red" | null
 * @returns {number} 0-3
 */
export function severity(level) {
  if (level === "red") return 3;
  if (level === "orange") return 2;
  if (level === "yellow") return 1;
  return 0;
}

/**
 * True when the user's current weather code reports active precipitation —
 * rain, snow, freezing rain, ice pellets, or thunderstorm. Used to choose
 * "intensifying" wording over "approaching" wording when the trend-bump
 * fires while precipitation is already falling at the location.
 *
 * Tomorrow.io codes — see https://docs.tomorrow.io/reference/data-layers-weather-codes
 *   4000-4201  drizzle / rain (light, moderate, heavy)
 *   5000-5101  snow / flurries
 *   6000-6201  freezing rain / drizzle
 *   7000-7102  ice pellets
 *   8000       thunderstorm
 *
 * @param {number|undefined} weatherCode — current Tomorrow.io weather code
 * @returns {boolean} true iff the code indicates active precipitation
 */
export function isCurrentlyPrecipitating(weatherCode) {
  if (typeof weatherCode !== "number") return false;
  if (weatherCode >= 4000 && weatherCode <= 4201) return true;
  if (weatherCode >= 5000 && weatherCode <= 5101) return true;
  if (weatherCode >= 6000 && weatherCode <= 6201) return true;
  if (weatherCode >= 7000 && weatherCode <= 7102) return true;
  if (weatherCode === 8000) return true;
  return false;
}

/**
 * Pick the i18n key + confidence bucket for the radar-derived banner.
 * Returns `null` when the SHOW gate doesn't clear (calm/yellow only) —
 * the caller is expected to render nothing in that case.
 *
 * Softening rules layered on top of the original logic:
 *   1. Mid-confidence trend wording gets a `Hedged` suffix.
 *   2. Low-confidence trend signal falls back to position-only wording
 *      (the banner still shows — the tier is real — but doesn't claim
 *      a movement direction it isn't sure of).
 *   3. `drifting` always shows drifting wording regardless of bucket;
 *      the confidence pill alone carries the nuance.
 *
 * The `bumped` boolean comes from the server (radarAnalyzerCtrl) and
 * tells us whether the analyzer raised the tier one notch because a
 * more severe band is approaching from elsewhere. When the user is
 * currently dry, this reads as "approaching"; when they're already in
 * precipitation, "intensifying" is the more accurate word.
 *
 * @param {string|null} innerRisk
 * @param {string|null} outerRisk
 * @param {string} innerTrend — "approaching" | "leaving" | "stable" | "drifting"
 * @param {string} outerTrend — same vocabulary as innerTrend
 * @param {boolean} innerBumped — server flag: inner tier bumped by trend
 * @param {boolean} outerBumped — server flag: outer tier bumped by trend
 * @param {number} innerTrendConfidence — 0-100
 * @param {number} outerTrendConfidence — 0-100
 * @param {boolean} currentlyPrecipitating — Tomorrow.io says it's raining now
 * @returns {{tier: string, i18nKey: string, confidence: number, confidenceBucket: string} | null}
 */
export function getRadarAlertState(
  innerRisk, outerRisk,
  innerTrend, outerTrend,
  innerBumped, outerBumped,
  innerTrendConfidence, outerTrendConfidence,
  currentlyPrecipitating,
) {
  const innerSev = severity(innerRisk);
  const outerSev = severity(outerRisk);
  const maxSev = Math.max(innerSev, outerSev);
  if (maxSev < 2) return null;

  const tier = maxSev === 3 ? "red" : "orange";
  const innerIsSource = innerSev === maxSev;
  const sourceTrend = innerIsSource ? innerTrend : outerTrend;
  const sourceBumped = innerIsSource ? innerBumped : outerBumped;
  const confidence = Math.max(0, Math.min(100, Math.round(
    innerIsSource ? innerTrendConfidence : outerTrendConfidence,
  )));
  const bucket = confidenceBucket(confidence);

  if (sourceBumped) {
    const variant = currentlyPrecipitating ? "Intensifying" : "Approaching";
    return { tier, i18nKey: `alert.${tier}${variant}`, confidence, confidenceBucket: bucket };
  }

  if (sourceTrend === "drifting") {
    return { tier, i18nKey: `alert.${tier}Drifting`, confidence, confidenceBucket: bucket };
  }

  if (bucket === "low") {
    const i18nKey = `alert.${tier}${innerIsSource ? "Near" : "Approaching"}`;
    return { tier, i18nKey, confidence, confidenceBucket: bucket };
  }

  if (sourceTrend === "leaving") {
    const suffix = bucket === "mid" ? "LeavingHedged" : "Leaving";
    return { tier, i18nKey: `alert.${tier}${suffix}`, confidence, confidenceBucket: bucket };
  }

  if (sourceTrend === "approaching") {
    const suffix = bucket === "mid" ? "ApproachingHedged" : "Approaching";
    return { tier, i18nKey: `alert.${tier}${suffix}`, confidence, confidenceBucket: bucket };
  }

  const i18nKey = `alert.${tier}${innerIsSource ? "Near" : "Approaching"}`;
  return { tier, i18nKey, confidence, confidenceBucket: bucket };
}
