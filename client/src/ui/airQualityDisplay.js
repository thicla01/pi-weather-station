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

// Fallback for a scale the client doesn't know (none today; defensive).
const FALLBACK_LABEL_KEY = "metrics.aqi";

/**
 * Locale key of the short label for an air-quality index — "AQHI" (FR
 * "CAS"), "IQA" or "AQI". Used for the AirCard row label, the AIR card's
 * index SourceBadge and the "value label — level" popover line.
 *
 * @param {?string} scale the payload's `scale` ("aqhi" | "iqa" | "epa")
 * @returns {string} an i18next key; `metrics.aqi` for an unknown scale
 */
function aqScaleLabelKey(scale) {
  return SCALE_LABEL_KEY[scale] || FALLBACK_LABEL_KEY;
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
  aqScaleLabelKey,
  formatAqValue,
};
