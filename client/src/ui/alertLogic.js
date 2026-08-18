/**
 * Pure logic for the radar-derived alert banner, kept out of
 * `ambient/AlertBanner` so the state machine can be exercised
 * directly. No React, no JSX, no DOM — safe to test under `node:test`.
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
 * Government-alert tiers the v3 banner stack displays by default.
 * `severityToTier` (server/govAlertSources/_shared.js) emits "red",
 * "orange" or "yellow"; only red/orange clear the default SHOW gate.
 * Yellow-tier (minor/low severity) alerts are hidden unless the user
 * opts into them — see `ELIGIBLE_GOV_TIERS_WITH_ADVISORY`.
 */
export const ELIGIBLE_GOV_TIERS = ["red", "orange"];

/**
 * Tiers shown when the user has enabled the "show advisory alerts"
 * preference: red/orange plus the yellow tier (NWS/ECCC advisories —
 * Flood / Heat / Wind Advisory, CAP severity minor/low). Opt-in and
 * off by default. Requested by a flood-prone user (k5map, TX) whose
 * Flood Advisories frequently escalate to Warnings; gating it behind a
 * per-device toggle keeps the quieter default for everyone else.
 */
export const ELIGIBLE_GOV_TIERS_WITH_ADVISORY = ["red", "orange", "yellow"];

/**
 * Filter a list of government alerts down to the displayable tiers.
 * Single source of truth shared — via the `useEligibleGovAlerts` hook
 * — by the AlertBanner counter + primary index, AlertDetailInline,
 * FloatingMiniBanner and AlertMiniCards, so none of them disagree on
 * what "N active alerts" means. Before this existed, the banner counter
 * counted ALL tiers while the mini-cards list only showed red/orange,
 * so a sub-threshold yellow ECCC alert inflated "1 / 2" without ever
 * appearing as a card (the Nicolet report, 2026-05-29).
 *
 * @param {Array<{tier?: string}>} alerts
 * @param {boolean} [showAdvisory] — when true, also keep the
 *   yellow (advisory) tier; otherwise red/orange only
 * @returns {Array} the subset whose tier is in the active set
 */
export function selectEligibleGovAlerts(alerts, showAdvisory = false) {
  if (!Array.isArray(alerts)) return [];
  const tiers = showAdvisory ? ELIGIBLE_GOV_TIERS_WITH_ADVISORY : ELIGIBLE_GOV_TIERS;
  return alerts.filter((a) => tiers.includes(a?.tier));
}

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
 * Classify an NWS/ECCC alert's English event name to its PRODUCT TYPE
 * (Warning > Watch > Advisory > Statement), independent of CAP severity.
 * Both sources expose an English name carrying the product word: NWS
 * `event` / `title_en` ("Heat Advisory", "Flood Watch"), ECCC `alert_name_en`
 * / `title_en` ("Wind warning", "Special weather statement"). This lets the
 * SeverityChip print the real product word — so a Heat *Advisory* (CAP
 * severity Moderate) reads "Avis", never "Veille" (watch). Returns null when
 * no product type is recognizable (caller falls back to a severity word).
 * Order matters: a "Severe Thunderstorm Warning" is a warning, not a "severe".
 *
 * @param {?string} name — the English event name (alert.title_en / eventType)
 * @returns {?string} the product-type slug ("warning" | "watch" | "advisory" |
 *   "statement"), or null when none is recognizable
 */
export function eventProductType(name) {
  const s = String(name || "").toLowerCase();
  if (/\bwarning\b/.test(s)) return "warning";
  if (/\bwatch\b/.test(s)) return "watch";
  if (/\badvisory\b/.test(s)) return "advisory";
  if (/\bstatement\b/.test(s)) return "statement";
  return null;
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

/**
 * Map a server-normalised air-quality category to a top-of-rail alert
 * state, or `null` when air quality doesn't warrant escalating beyond
 * the inline AirCard reading.
 *
 * Threshold = the health-risk level (maintainer decision 2026-06-18,
 * "afficher lorsqu'il y a des risques pour la santé"):
 *   - "veryHigh" → red    (AQHI ≥ 10 / IQA > 100 / EPA AQI > 150)
 *   - "high"     → orange  (AQHI 7-10 — the band where the official
 *                           AQHI message tells the general population to
 *                           reduce or reschedule strenuous outdoor activity)
 *   - "moderate" / "low" / unknown → null (AirCard inline only —
 *                           escalating "moderate" would keep the card up
 *                           nearly year-round, defeating the glance)
 *
 * Keying on `category` (the four-tier word every AQ source is normalised
 * to server-side via `_shared.js`) rather than the raw value means one
 * threshold covers AQHI, IQA and EPA AQI without per-scale logic — the
 * same reason the AirCard pill reads `category`, not the number.
 *
 * Mirrors `getRadarAlertState`'s tier vocabulary ("red" | "orange") so the
 * AIR card shares the AlertBanner tier-strip colours.
 *
 * @param {?string} category — "low" | "moderate" | "high" | "veryHigh"
 * @returns {{ tier: "red"|"orange", category: string } | null} the alert
 *   tier + echoed category, or null below the health-risk band
 */
export function getAirAlertState(category) {
  if (category === "veryHigh") return { tier: "red", category };
  if (category === "high") return { tier: "orange", category };
  return null;
}
