// Air-quality display helpers — the index's short label and the way a
// reading is printed, shared by the inline AirCard row and the AIR alert
// card (and their detail popovers) so the two surfaces never disagree.
//
// CommonJS on purpose (like ui/radarFrameStack.js): webpack accepts it
// next to the ESM tree, and `test/airQualityDisplay.test.js` runs the real
// module under `node --test`. Keep the file free of imports.

// Top of the AQHI number scale. Above it, Health Canada and ECCC report
// "10+" ("When the amount of air pollution is very high, the number is
// reported as 10+").
const AQHI_TOP = 10;

// `scale` (from /api/air-quality) → locale key of the index's short label.
// The labels live in the locale files because one of them is translated:
// ECCC names the AQHI « cote air santé (CAS) » in French. IQA (Quebec's
// own index) and AQI (US EPA) keep their acronym in every language.
const SCALE_LABEL_KEY = {
  aqhi: "metrics.aqScale.aqhi",
  iqa: "metrics.aqScale.iqa",
  epa: "metrics.aqScale.epa",
};

// Neutral label — "Air quality" — for when no index is known: before the
// first /api/air-quality response, when no source covers the place, and
// for a scale the client doesn't know (none today; defensive). It names
// the subject, not an index. The language's generic acronym it replaces
// (EN "AQI", FR "IQA", ES "ICA") is itself the name of an index (EPA's,
// Quebec's), so the row read "— IQA" in Florida before "57 AQI" landed.
// Also the title of both cards' detail popovers, for the same reason.
const AQ_NEUTRAL_LABEL_KEY = "metrics.airQuality";

/**
 * Locale key of the short label for an air-quality index — "AQHI" (FR
 * "CAS"), "IQA" or "AQI". Used for the AirCard row label, the AIR card's
 * index SourceBadge and the "value label — level" popover line. With no
 * known index (no reading yet, or none available) it returns the neutral
 * "Air quality" key, so the row never names an index the source may not
 * use and only switches from the neutral label to the real one.
 *
 * @param {?string} scale the payload's `scale` ("aqhi" | "iqa" | "epa"),
 *   or undefined when there is no reading
 * @returns {string} an i18next key; `metrics.airQuality` when the scale is
 *   missing or unknown
 */
function aqScaleLabelKey(scale) {
  return SCALE_LABEL_KEY[scale] || AQ_NEUTRAL_LABEL_KEY;
}

/**
 * How an air-quality reading is printed. The server already sends the
 * AQHI as the whole number ECCC publishes; above 10 it is printed "10+",
 * as ECCC does, while the category ("veryHigh") comes from the number.
 * IQA and EPA AQI readings print as received.
 *
 * @param {?number} value the payload's `value`
 * @param {?string} scale the payload's `scale`
 * @returns {?(number|string)} the value to show, or null when there is
 *   no reading (the caller prints its placeholder)
 */
function formatAqValue(value, scale) {
  if (value == null) return null;
  if (scale === "aqhi" && value > AQHI_TOP) return `${AQHI_TOP}+`;
  return value;
}

module.exports = {
  AQHI_TOP,
  AQ_NEUTRAL_LABEL_KEY,
  aqScaleLabelKey,
  formatAqValue,
};
