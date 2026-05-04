// Shared helpers used by every air-quality source. Each source module
// runs its own upstream lookup and returns a normalised payload that
// matches what the orchestrator (`airQualityCtrl.js`) sends to the
// client; centralising the distance, category mapping, and value
// formatting here keeps the per-source files focused on their
// upstream's quirks.

const TIMEOUT_MS = 10_000;

/**
 * Great-circle distance between two points in km.
 *
 * @param {Number} lat1
 * @param {Number} lon1
 * @param {Number} lat2
 * @param {Number} lon2
 * @returns {Number} kilometres
 */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
          + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Map a Health Canada AQHI value (1–10+) to one of the four risk
 * categories the badge knows how to colour.
 *
 * @param {Number} value AQHI value
 * @returns {"low" | "moderate" | "high" | "veryHigh" | null}
 */
function categoryForAqhi(value) {
  if (value == null || isNaN(value)) return null;
  if (value > 10) return "veryHigh";
  if (value >= 7) return "high";
  if (value >= 4) return "moderate";
  return "low";
}

/**
 * Map a Quebec MELCC IQA value (1–100+) to one of the four risk
 * categories. The official MELCC categorisation is three tiers (Bon
 * 1-25 / Acceptable 26-50 / Mauvais 51+); we split "Mauvais" at 100
 * so the badge keeps the 4-tier vocabulary it shares with AQHI and
 * EPA AQI — values up to 100 stay "high", anything past 100 becomes
 * "veryHigh".
 *
 * @param {Number} value IQA value
 * @returns {"low" | "moderate" | "high" | "veryHigh" | null}
 */
function categoryForIqa(value) {
  if (value == null || isNaN(value)) return null;
  if (value > 100) return "veryHigh";
  if (value > 50) return "high";
  if (value > 25) return "moderate";
  return "low";
}

/**
 * Map an EPA AQI value (0–500 scale) to one of the four risk
 * categories. EPA officially defines six tiers (Good 0-50, Moderate
 * 51-100, Unhealthy for Sensitive Groups 101-150, Unhealthy 151-200,
 * Very Unhealthy 201-300, Hazardous 301+), but the badge already
 * shares a four-tier vocabulary with AQHI and IQA: we collapse the
 * top three EPA tiers into "veryHigh" so the colour palette stays
 * consistent across sources. The boundary between high and veryHigh
 * sits at 150 (USG/Unhealthy split) — the same point at which the
 * official EPA palette transitions from orange to red.
 *
 * @param {Number} value EPA AQI value (0-500)
 * @returns {"low" | "moderate" | "high" | "veryHigh" | null}
 */
function categoryForEpaAqi(value) {
  if (value == null || isNaN(value)) return null;
  if (value > 150) return "veryHigh";
  if (value > 100) return "high";
  if (value > 50) return "moderate";
  return "low";
}

module.exports = {
  TIMEOUT_MS,
  haversineKm,
  categoryForAqhi,
  categoryForIqa,
  categoryForEpaAqi,
};
