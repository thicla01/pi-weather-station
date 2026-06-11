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
  // PM2.5 24h average, μg/m³ — the May-2024 EPA revision (89 FR 16202,
  // effective 2024-05-06): Good tightened 12.0 → 9.0 µg/m³, Unhealthy
  // bands compressed, and the former 301-400/401-500 split collapsed
  // into a single 301-500 band ending at 325.4. The pre-2024 table
  // lived here until 2026-06 and made the OpenAQ path read one
  // category lower than AirNow (which relays EPA's upstream AQI).
  pm25: [
    [0.0, 9.0,     0,  50],
    [9.1, 35.4,   51, 100],
    [35.5, 55.4, 101, 150],
    [55.5, 125.4, 151, 200],
    [125.5, 225.4, 201, 300],
    [225.5, 325.4, 301, 500],
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
  // SO2 1h average, ppb. Per EPA, AQI values above 200 are defined
  // only on the 24h average, which we never have (sources hand us
  // the latest ~1h reading) — so for 1h readings above 304 ppb,
  // `epaAqiFromConcentration` returns the EPA-prescribed fallback of
  // exactly 200 (see SO2_1H_OFFSCALE_AQI) instead of going off the
  // 1h scale or dropping the reading.
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

// Decimal precision of each breakpoint table, per the EPA TAD: the
// measured concentration must be TRUNCATED to the table's granularity
// before band lookup (PM2.5 → 0.1 μg/m³, PM10 → 1 μg/m³, O3 → 0.001
// ppm, CO → 0.1 ppm, NO2/SO2 → 1 ppb). Without this, raw/converted
// floats fall into the gaps between bands (e.g. PM2.5 12.05 sits in
// ]12.0, 12.1[) and the lookup wrongly returns null.
const EPA_TRUNCATION_DECIMALS = {
  pm25: 1,
  pm10: 0,
  o3_8h: 3,
  o3_1h: 3,
  no2: 0,
  so2: 0,
  co: 1,
};

// EPA-prescribed handling for 1h SO2 readings above the top of the 1h
// table (304 ppb): AQI values above 200 are defined only on the 24h
// average; when only a 1h value is available, EPA says to report 200.
const SO2_1H_MAX_PPB = 304;
const SO2_1H_OFFSCALE_AQI = 200;

// Scale factor used to strip float-representation noise before
// truncating (e.g. 55.4 * 10 could evaluate to 553.9999999999999 on
// some inputs; rounding at the 1e-6 sub-step level restores the
// intended 554 without affecting genuinely-below values).
const FLOAT_NOISE_SCALE = 1e6;

/**
 * Truncate a positive concentration to a fixed number of decimals
 * (EPA's prescribed pre-lookup step). Float-representation noise is
 * rounded away at the 1e-6 sub-step level first, so a value that is
 * mathematically on a breakpoint never truncates one step low.
 *
 * @param {Number} value Concentration (>= 0)
 * @param {Number} decimals Decimal places to keep (0-3)
 * @returns {Number} value truncated to `decimals` decimal places
 */
function truncateTo(value, decimals) {
  const factor = 10 ** decimals;
  const scaled = Math.round(value * factor * FLOAT_NOISE_SCALE) / FLOAT_NOISE_SCALE;
  return Math.trunc(scaled) / factor;
}

/**
 * Convert a raw concentration in EPA-canonical units to the
 * corresponding EPA AQI sub-index. The value is first truncated to
 * the breakpoint table's decimal precision (EPA TAD requirement —
 * this is also what closes the gaps between bands, e.g. PM2.5
 * ]12.0, 12.1[). Returns null when the truncated value is below or
 * above every band defined for the parameter (above-range is rare in
 * practice — only the PM bands cap at 500 — but we'd rather skip
 * than emit an unbounded number), except 1h SO2 above 304 ppb which
 * returns the EPA-prescribed 200.
 *
 * @param {String} parameter "pm25" | "pm10" | "o3_1h" | "o3_8h" | "no2" | "so2" | "co"
 * @param {Number} value Concentration in the canonical unit (see EPA_BREAKPOINTS comments)
 * @returns {Number|null} EPA AQI sub-index (0-500), or null if unmappable
 */
function epaAqiFromConcentration(parameter, value) {
  if (value == null || isNaN(value) || value < 0) return null;
  const table = EPA_BREAKPOINTS[parameter];
  if (!table) return null;
  const truncated = truncateTo(value, EPA_TRUNCATION_DECIMALS[parameter]);
  for (const [cLow, cHigh, iLow, iHigh] of table) {
    if (truncated >= cLow && truncated <= cHigh) {
      return Math.round(((iHigh - iLow) / (cHigh - cLow)) * (truncated - cLow) + iLow);
    }
  }
  // 1h SO2 above the top of the 1h table: EPA defines AQI > 200 only
  // on the 24h average, which our sources never have — report the
  // prescribed 200 so an extreme spike still reads as "very high".
  if (parameter === "so2" && truncated > SO2_1H_MAX_PPB) {
    return SO2_1H_OFFSCALE_AQI;
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
  // Internal helpers exposed for unit tests only — not part of the
  // module's public surface.
  __test: { truncateTo, EPA_TRUNCATION_DECIMALS },
};
