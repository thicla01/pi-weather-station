/* Severity helpers for UV index and air-quality readings.
 *
 * The colour scale + tier vocabulary used by the `MetricsGrid`
 * cells, kept in one place so any future tweak — extra tier,
 * palette adjustment — happens once.
 *
 * Colours: WMO UV palette for UV, normalised to the same four-tier
 * vocabulary for AQ. Bright on purpose — these are status indicators
 * and need to read at a glance over both light (cream) and dark
 * (anthracite) palettes.
 */

/**
 * UV index → tier + colour. WMO categorisation.
 *
 * @param {number|null|undefined} value UV index — unitless WMO scale, 0 upward
 *   (11+ is the top "extreme" band).
 * @returns {{color: string, label: "low"|"moderate"|"high"|"veryHigh"|"extreme"}|null}
 *   The bright badge colour as a hex string (for dots/fills — use `uvTextColor`
 *   for text) plus the tier label, or `null` when `value` is `null`/`undefined`
 *   so the caller can skip rendering the indicator entirely.
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
 * Darker tier colours tuned for *text rendering* on
 * the warm-cream day palette where bright #f0d000 yellow on
 * #f4f0e8 cream measured ~1.4:1 contrast — effectively invisible.
 * The hues stay in the same semantic family (still reads as
 * green / amber / red / purple) but are dark enough to clear 4.5:1
 * on day mode and still visible on dusk / night palettes.
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
 * @param {number|null|undefined} value UV index — same unitless WMO scale as `uvTier`.
 * @returns {string|null} Hex colour from `CATEGORY_TEXT_COLORS` for the matching
 *   tier (darkened so it clears 4.5:1 on the cream day palette), or `null` when
 *   `value` is `null`/`undefined`.
 */
export function uvTextColor(value) {
  const tier = uvTier(value);
  return tier ? CATEGORY_TEXT_COLORS[tier.label] : null;
}
