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

// EPA AQI breakpoint tables, per the EPA Technical Assistance
// Document for Reporting AQI (40 CFR Part 58, App. G). Each entry
// is [concentrationLow, concentrationHigh, aqiLow, aqiHigh] for one
// AQI sub-band; AQI is computed as a linear interpolation inside
// the band. We keep the official EPA averaging windows as the
// canonical input — the OpenAQ source decides whether the latest
// raw measurement is close enough to a 1h/8h/24h average to use it
// (most stations now publish 1h or sub-hourly averaged readings, so
// the "raw" reading is in practice the right input).
//
// Units are EPA-canonical: μg/m³ for particulates, ppm for O3 / CO,
// ppb for NO2 / SO2. The OpenAQ source converts to these units
// before calling `epaAqiFromConcentration`.
const EPA_BREAKPOINTS = {
  // PM2.5 24h average, μg/m³
  pm25: [
    [0.0, 12.0,    0,  50],
    [12.1, 35.4,  51, 100],
    [35.5, 55.4, 101, 150],
    [55.5, 150.4, 151, 200],
    [150.5, 250.4, 201, 300],
    [250.5, 500.4, 301, 500],
  ],
  // PM10 24h average, μg/m³
  pm10: [
    [0,    54,    0,  50],
    [55,  154,   51, 100],
    [155, 254,  101, 150],
    [255, 354,  151, 200],
    [355, 424,  201, 300],
    [425, 604,  301, 500],
  ],
  // O3 8h average, ppm — preferred for AQI ≤ 100
  o3_8h: [
    [0.000, 0.054,   0,  50],
    [0.055, 0.070,  51, 100],
    [0.071, 0.085, 101, 150],
    [0.086, 0.105, 151, 200],
    [0.106, 0.200, 201, 300],
  ],
  // O3 1h average, ppm — used only for AQI > 100; below 0.125 ppm
  // the 8h band is the EPA-defined input.
  o3_1h: [
    [0.125, 0.164, 101, 150],
    [0.165, 0.204, 151, 200],
    [0.205, 0.404, 201, 300],
    [0.405, 0.604, 301, 500],
  ],
  // NO2 1h average, ppb
  no2: [
    [0,     53,     0,  50],
    [54,    100,   51, 100],
    [101,   360,  101, 150],
    [361,   649,  151, 200],
    [650,  1249,  201, 300],
    [1250, 2049,  301, 500],
  ],
  // SO2 1h average, ppb (above 304 ppb the 24h average drives AQI;
  // we cap at the 1h band's top so an extreme spike still reads as
  // "very high" rather than going off the scale.)
  so2: [
    [0,    35,    0,  50],
    [36,   75,   51, 100],
    [76,  185,  101, 150],
    [186, 304,  151, 200],
  ],
  // CO 8h average, ppm
  co: [
    [0.0,  4.4,    0,  50],
    [4.5,  9.4,   51, 100],
    [9.5, 12.4,  101, 150],
    [12.5, 15.4, 151, 200],
    [15.5, 30.4, 201, 300],
    [30.5, 50.4, 301, 500],
  ],
};

/**
 * Convert a raw concentration in EPA-canonical units to the
 * corresponding EPA AQI sub-index. Returns null when the value is
 * below or above every band defined for the parameter (above-range
 * is rare in practice — only the PM bands cap at 500 — but we'd
 * rather skip than emit an unbounded number).
 *
 * @param {String} parameter "pm25" | "pm10" | "o3_1h" | "o3_8h" | "no2" | "so2" | "co"
 * @param {Number} value Concentration in the canonical unit (see EPA_BREAKPOINTS comments)
 * @returns {Number|null} EPA AQI sub-index (0-500), or null if unmappable
 */
function epaAqiFromConcentration(parameter, value) {
  if (value == null || isNaN(value) || value < 0) return null;
  const table = EPA_BREAKPOINTS[parameter];
  if (!table) return null;
  for (const [cLow, cHigh, iLow, iHigh] of table) {
    if (value >= cLow && value <= cHigh) {
      return Math.round(((iHigh - iLow) / (cHigh - cLow)) * (value - cLow) + iLow);
    }
  }
  // Below the lowest band — only happens for O3 1h (band starts at
  // 0.125 ppm); the caller is expected to have already tried the 8h
  // band first. Above the highest band — out of EPA's defined range.
  return null;
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
  epaAqiFromConcentration,
};
