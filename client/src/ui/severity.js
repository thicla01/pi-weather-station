/* Severity helpers for UV index and air-quality readings.
 *
 * The same colour scale + tier vocabulary used by the v2
 * `UvAqiBadges` component and the v3 `MetricsGrid` cells, kept in
 * one place so both code paths stay aligned (and so any future
 * tweak — extra tier, palette adjustment — happens once).
 *
 * Colours: WMO UV palette for UV, normalised to the same four-tier
 * vocabulary for AQ. Bright on purpose — these are status indicators
 * and need to read at a glance over both light (cream) and dark
 * (anthracite) palettes.
 */

/**
 * UV index → tier + colour. WMO categorisation.
 *
 * @param {number|null|undefined} value
 * @returns {{color: string, label: "low"|"moderate"|"high"|"veryHigh"|"extreme"}|null}
 */
export function uvTier(value) {
  if (value == null) return null;
  if (value >= 11) return { color: "#7e3fb1", label: "extreme" };
  if (value >= 8)  return { color: "#e60000", label: "veryHigh" };
  if (value >= 6)  return { color: "#f08200", label: "high" };
  if (value >= 3)  return { color: "#f0d000", label: "moderate" };
  return { color: "#5cb85c", label: "low" };
}

/**
 * Four-tier AQ colour map. Every server-side source (ECCC AQHI,
 * MELCC IQA, EPA AQI, OpenAQ) is normalised to this vocabulary
 * before reaching the client.
 */
export const CATEGORY_COLORS = {
  low:      "#5cb85c",
  moderate: "#f0d000",
  high:     "#e60000",
  veryHigh: "#7e3fb1",
};

/**
 * EPA AQI value (Tomorrow.io's `epaIndex`, raw 0-500 scale per
 * 40 CFR Part 58 App. G) → same four-tier vocabulary. Used only
 * for the Tomorrow.io fallback path; the server-side orchestrator
 * already returns `category` for every other source via
 * `categoryForEpaAqi` in `server/airQualitySources/_shared.js`.
 *
 * History: an earlier version of this function bucketed by a 1-6
 * index (1→low, 2→moderate, 3-4→high, 5+→veryHigh) under the
 * (mistaken) assumption that Tomorrow.io's `epaIndex` field was
 * the EPA category number rather than the raw AQI. In fact
 * Tomorrow.io returns the canonical 0-500 EPA AQI, so the old
 * thresholds were wildly off — a "Good" value of 29 was labeled
 * "very high" (issue #149, mlcampbe). Thresholds now mirror the
 * server-side function exactly.
 *
 * @param {number|null|undefined} value EPA AQI value (0-500)
 * @returns {"low"|"moderate"|"high"|"veryHigh"|null}
 */
export function epaCategory(value) {
  if (value == null) return null;
  if (value > 150) return "veryHigh";
  if (value > 100) return "high";
  if (value > 50) return "moderate";
  return "low";
}

/**
 * Darker variants of CATEGORY_COLORS tuned for *text rendering* on
 * the warm-cream day palette where bright #f0d000 yellow on
 * #f4f0e8 cream measured ~1.4:1 contrast — effectively invisible.
 * The hues stay in the same semantic family (still reads as
 * green / amber / red / purple) but are dark enough to clear 4.5:1
 * on day mode and still visible on dusk / night palettes.
 *
 * CATEGORY_COLORS is left untouched so the v2 UvAqiBadges (which
 * uses the bright variants as solid badge backgrounds with
 * adapted text colour) keeps its existing look.
 */
export const CATEGORY_TEXT_COLORS = {
  low:      "#3a8a3a",
  moderate: "#9b6e00",
  high:     "#c44000",
  veryHigh: "#b30000",
  extreme:  "#6b3399",
};

/**
 * UV index → text colour. Wrapper that pulls the darker text
 * variant matching the tier returned by `uvTier`.
 *
 * @param {number|null|undefined} value
 * @returns {string|null}
 */
export function uvTextColor(value) {
  const tier = uvTier(value);
  return tier ? CATEGORY_TEXT_COLORS[tier.label] : null;
}
