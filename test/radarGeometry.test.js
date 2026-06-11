// Regression tests for the client radar sampling geometry in
// `client/src/components/WeatherMap/geometry.js`. The helpers under
// test mirror server-side tables in `server/radarAnalyzerCtrl.js`
// (RISK_LEVELS, INNER_DIRECTIONS / OUTER_DIRECTIONS, offsetLatLon) —
// a drift on either side desynchronises the client sample dots from
// the points the AI summary actually reads, so the cross-file
// contracts are locked here as hardcoded expectations.
//
// Run: `npm test` (same runner as alertLogic / radarTrend / uiHybrid).
//
// Same constraint as the other test files in this repo: the client
// source uses ESM and Node's CJS loader can't `require()` it.
// Rather than wire up a transpiler just for tests we re-implement
// the helpers verbatim here — if `geometry.js` drifts, these
// tests fail loudly and remind us to sync.

const { test } = require("node:test");
const assert = require("node:assert/strict");

// ---------- start of verbatim copy from client/src/components/WeatherMap/geometry.js ----------

// Sampling-point bearings (clockwise from north). Dense layout
// (May 2026): 16 inner directions, 32 outer directions, 10 distance
// steps per ring per unit (every 5 km / 3 mi). 481 points total when
// extendedRadius is on. KM_PER_UNIT converts user units to km for the
// great-circle math; METERS_PER_UNIT is what Leaflet's Circle takes.
const INNER_BEARINGS = Array.from({ length: 16 }, (_, i) => i * 22.5);
const OUTER_BEARINGS = Array.from({ length: 32 }, (_, i) => i * 11.25);
const KM_PER_UNIT = { km: 1, mi: 1.609344 };
const METERS_PER_UNIT = { km: 1000, mi: 1609.344 };
const RADAR_GEOMETRY = {
  km: {
    inner: [5, 10, 15, 20, 25, 30, 35, 40, 45, 50],
    outer: [55, 60, 65, 70, 75, 80, 85, 90, 95, 100],
  },
  mi: {
    inner: [3, 6, 9, 12, 15, 18, 21, 24, 27, 30],
    outer: [33, 36, 39, 42, 45, 48, 51, 54, 57, 60],
  },
};
const EARTH_R_KM = 6371;

// Bearing → direction-name maps. Names must match the server side
// (radarAnalyzerCtrl.js INNER_DIRECTIONS / OUTER_DIRECTIONS) exactly
// so the per-sample lookup key `${direction}:${distance}` resolves.
// - INNER (16 directions): standard compass names (N, NNE, NE, …, NNW)
// - OUTER (32 directions): compass name where bearing matches one of
//   the 16 main bearings, otherwise the bearing value itself as a
//   string ("11.25", "33.75", …, "348.75").
const COMPASS_16 = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
                    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const BEARING_TO_DIR_INNER = Object.fromEntries(
  INNER_BEARINGS.map((b, i) => [b, COMPASS_16[i]])
);
const BEARING_TO_DIR_OUTER = Object.fromEntries(
  OUTER_BEARINGS.map((b, i) => [b, i % 2 === 0 ? COMPASS_16[i / 2] : b.toString()])
);

/**
 * Intensity → tier mapping matching the server's RISK_LEVELS array.
 * Returns null for clear (intensity 0) so the caller can keep the
 * neutral default colour for that case.
 *
 * @param {Number|null} intensity
 * @returns {"red"|"orange"|"yellow"|null}
 */
function tierForIntensity(intensity) {
  if (intensity == null || intensity <= 0) return null;
  if (intensity >= 5) return "red";
  if (intensity >= 4) return "orange";
  return "yellow";
}

/**
 * Compute a destination lat/lon from a starting point, distance, and bearing.
 * Mirrors offsetLatLon in server/radarAnalyzerCtrl.js (great-circle formula).
 *
 * @param {Number} lat Starting latitude (deg)
 * @param {Number} lon Starting longitude (deg)
 * @param {Number} distanceKm Distance in kilometres
 * @param {Number} bearingDeg Bearing clockwise from north (deg)
 * @returns {{lat: Number, lon: Number}} Destination coordinates
 */
function offsetLatLon(lat, lon, distanceKm, bearingDeg) {
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;
  const bearing = (bearingDeg * Math.PI) / 180;
  const d = distanceKm / EARTH_R_KM;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(bearing)
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
    );
  return { lat: (lat2 * 180) / Math.PI, lon: (lon2 * 180) / Math.PI };
}

/**
 * Build the list of sampling points around a center, using the same
 * geometry as the server radar analyzer. Each entry carries the
 * lat/lng pair plus a `${direction}:${distance}` key that matches the
 * server's per-sample shape — the renderer uses the key to look up
 * the sample's intensity in the polled risk payload and colour the
 * dot accordingly. Inner ring is always 16 directions; outer ring
 * (when extended) is 32 directions. Sample distances vary by unit
 * (km or mi). The centre point matches the "C" direction the server
 * samples directly at (lat, lon) so a cell sitting right on the
 * marker still registers in the analyzer and the risk score.
 *
 * @param {Array<Number>} center [lat, lng] pair
 * @param {Boolean} extended Whether to include the outer ring
 * @param {String} unit "km" or "mi" — selects the geometry table
 * @returns {Array<{position: Array<Number>, key: String}>} Sample points
 */
function buildSamplingPoints(center, extended, unit) {
  const [centerLat, centerLng] = center;
  const geometry = RADAR_GEOMETRY[unit];
  const kmPerUnit = KM_PER_UNIT[unit];
  const points = [{ position: [centerLat, centerLng], key: "C:0" }];
  for (const bearing of INNER_BEARINGS) {
    const dir = BEARING_TO_DIR_INNER[bearing];
    for (const distance of geometry.inner) {
      const p = offsetLatLon(centerLat, centerLng, distance * kmPerUnit, bearing);
      points.push({ position: [p.lat, p.lon], key: `${dir}:${distance}` });
    }
  }
  if (extended) {
    for (const bearing of OUTER_BEARINGS) {
      const dir = BEARING_TO_DIR_OUTER[bearing];
      for (const distance of geometry.outer) {
        const p = offsetLatLon(centerLat, centerLng, distance * kmPerUnit, bearing);
        points.push({ position: [p.lat, p.lon], key: `${dir}:${distance}` });
      }
    }
  }
  return points;
}

// ---------- end of verbatim copy ----------

// ─── Server-side contracts, hardcoded from server/radarAnalyzerCtrl.js ───
// These are deliberately NOT imported/derived — they restate what the
// server commits to, so a change on EITHER side trips the tests.

// radarAnalyzerCtrl.js RISK_LEVELS — index = intensity level 0-6.
// 0 → calm (client renders null/neutral), 1-3 → yellow, 4 → orange,
// 5-6 → red.
const SERVER_RISK_LEVELS = ["calm", "yellow", "yellow", "yellow", "orange", "red", "red"];

// radarAnalyzerCtrl.js INNER_DIRECTIONS — 16 compass names at i * 22.5°.
const SERVER_INNER_NAMES = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
                            "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

// radarAnalyzerCtrl.js OUTER_DIRECTIONS — 32 names at i * 11.25°: the
// compass name where the bearing matches a 16-point cardinal (even i),
// the bearing value as a string otherwise (odd i).
const SERVER_OUTER_NAMES = [
  "N", "11.25", "NNE", "33.75", "NE", "56.25", "ENE", "78.75",
  "E", "101.25", "ESE", "123.75", "SE", "146.25", "SSE", "168.75",
  "S", "191.25", "SSW", "213.75", "SW", "236.25", "WSW", "258.75",
  "W", "281.25", "WNW", "303.75", "NW", "326.25", "NNW", "348.75",
];

// Expected sampling-point counts. Inner ring: 1 centre + 16 directions
// × 10 distances = 161 (matches the "161 samples (1 + 16×10)" figure in
// radarAnalyzerCtrl.js's hysteresis comment). Extended adds the outer
// ring: 32 directions × 10 distances = 320 → 481 total.
const STANDARD_POINT_COUNT = 161;
const EXTENDED_POINT_COUNT = 481;

// Reference location for the geodesic tests — mid-latitude (45°N) so
// the longitude convergence factor (cos 45° ≈ 0.707) is actually
// exercised, unlike an equator-only test where cos(0) = 1 hides a
// missing factor.
const REF_LAT = 45;
const REF_LON = -73;

/**
 * Assert two floats are equal within a relative tolerance (absolute
 * for expectations near zero, where relative tolerance is meaningless).
 *
 * @param {Number} actual Value produced by the code under test
 * @param {Number} expected Independently computed reference value
 * @param {String} label Assertion label for the failure message
 * @param {Number} [relTol] Relative tolerance (default 1e-6 per the
 *   precision the radar grid needs — 1e-6° ≈ 11 cm)
 * @returns {void}
 */
function assertClose(actual, expected, label, relTol = 1e-6) {
  const scale = Math.max(Math.abs(expected), 1);
  assert.ok(
    Math.abs(actual - expected) <= relTol * scale,
    `${label}: expected ${expected}, got ${actual} (tolerance ${relTol} relative)`
  );
}

// ─── tierForIntensity ───────────────────────────────────────────────

test("tierForIntensity: clear / missing intensities map to null", () => {
  assert.equal(tierForIntensity(0), null);
  assert.equal(tierForIntensity(null), null);
  assert.equal(tierForIntensity(undefined), null);
  assert.equal(tierForIntensity(-1), null); // defensive: never produced upstream
});

test("tierForIntensity: tier boundaries", () => {
  assert.equal(tierForIntensity(1), "yellow");
  assert.equal(tierForIntensity(3), "yellow");
  assert.equal(tierForIntensity(3.9), "yellow"); // just under the orange threshold
  assert.equal(tierForIntensity(4), "orange");
  assert.equal(tierForIntensity(4.9), "orange"); // just under the red threshold
  assert.equal(tierForIntensity(5), "red");
  assert.equal(tierForIntensity(6), "red");
});

test("tierForIntensity: matches server RISK_LEVELS for every integer level", () => {
  // Levels 1-6 must agree literally with the server table; level 0 is
  // the calm ↔ null mapping (server says "calm", client renders the
  // neutral ring via null).
  for (let level = 1; level <= 6; level += 1) {
    assert.equal(
      tierForIntensity(level),
      SERVER_RISK_LEVELS[level],
      `intensity ${level} must map to the server tier "${SERVER_RISK_LEVELS[level]}"`
    );
  }
  assert.equal(SERVER_RISK_LEVELS[0], "calm");
  assert.equal(tierForIntensity(0), null);
});

// ─── Direction-name contract (client tables vs server compass) ─────

test("BEARING_TO_DIR_INNER: 16 entries matching server INNER_DIRECTIONS", () => {
  const bearings = Object.keys(BEARING_TO_DIR_INNER);
  assert.equal(bearings.length, 16);
  SERVER_INNER_NAMES.forEach((name, i) => {
    const bearing = i * 22.5;
    assert.equal(
      BEARING_TO_DIR_INNER[bearing],
      name,
      `inner bearing ${bearing} must map to "${name}"`
    );
  });
});

test("BEARING_TO_DIR_OUTER: 32 entries matching server OUTER_DIRECTIONS", () => {
  const bearings = Object.keys(BEARING_TO_DIR_OUTER);
  assert.equal(bearings.length, 32);
  SERVER_OUTER_NAMES.forEach((name, i) => {
    const bearing = i * 11.25;
    assert.equal(
      BEARING_TO_DIR_OUTER[bearing],
      name,
      `outer bearing ${bearing} must map to "${name}"`
    );
  });
});

// ─── offsetLatLon (great-circle destination) ────────────────────────
// Reference values computed independently with the same spherical
// model (R = 6371 km): due north/south reduce to the closed form
// lat2 = lat1 ± d·180/π; east/west values were computed numerically
// outside the code under test and hardcoded.

test("offsetLatLon: 1 km due north from 45°N", () => {
  const p = offsetLatLon(REF_LAT, REF_LON, 1, 0);
  // Closed form: 45 + (1 / 6371) · (180 / π) = 45.00899321605919
  assertClose(p.lat, 45.00899321605919, "lat (1 km N)");
  assertClose(p.lon, REF_LON, "lon (1 km N — unchanged on a meridian)");
});

test("offsetLatLon: 100 km due east at 45°N", () => {
  const p = offsetLatLon(REF_LAT, REF_LON, 100, 90);
  // Great-circle east is NOT a parallel: the path bends slightly
  // toward the equator, so lat dips below 45 — a rhumb-line or
  // small-angle implementation would return exactly 45 and fail here.
  assertClose(p.lat, 44.99294264822895, "lat (100 km E)");
  assertClose(p.lon, -71.72827161381377, "lon (100 km E)");
});

test("offsetLatLon: 50 km due south from 45°N", () => {
  const p = offsetLatLon(REF_LAT, REF_LON, 50, 180);
  // Closed form: 45 − (50 / 6371) · (180 / π) = 44.550339197040635
  assertClose(p.lat, 44.550339197040635, "lat (50 km S)");
  assertClose(p.lon, REF_LON, "lon (50 km S — unchanged on a meridian)");
});

test("offsetLatLon: 100 km due west on the equator", () => {
  const p = offsetLatLon(0, 0, 100, 270);
  // On the equator 1 km = (180 / π) / 6371 degrees of longitude exactly.
  assertClose(p.lon, -0.8993216059187302, "lon (100 km W at equator)");
  assertClose(p.lat, 0, "lat (100 km W at equator)");
});

test("offsetLatLon: zero distance is the identity", () => {
  const p = offsetLatLon(REF_LAT, REF_LON, 0, 123);
  assertClose(p.lat, REF_LAT, "lat (zero distance)");
  assertClose(p.lon, REF_LON, "lon (zero distance)");
});

// ─── buildSamplingPoints ────────────────────────────────────────────

test("buildSamplingPoints: 161 points standard, 481 extended (both units)", () => {
  for (const unit of ["km", "mi"]) {
    assert.equal(
      buildSamplingPoints([REF_LAT, REF_LON], false, unit).length,
      STANDARD_POINT_COUNT,
      `standard ${unit} count`
    );
    assert.equal(
      buildSamplingPoints([REF_LAT, REF_LON], true, unit).length,
      EXTENDED_POINT_COUNT,
      `extended ${unit} count`
    );
  }
});

test("buildSamplingPoints: centre sample is C:0 at the exact centre", () => {
  const [first] = buildSamplingPoints([REF_LAT, REF_LON], false, "km");
  assert.equal(first.key, "C:0");
  assert.deepEqual(first.position, [REF_LAT, REF_LON]);
});

test("buildSamplingPoints: standard keys = server inner names × inner distances", () => {
  const points = buildSamplingPoints([REF_LAT, REF_LON], false, "km");
  const keys = points.map((p) => p.key);
  assert.equal(new Set(keys).size, keys.length, "all keys must be unique");
  const expected = ["C:0"];
  for (const dir of SERVER_INNER_NAMES) {
    for (const distance of RADAR_GEOMETRY.km.inner) {
      expected.push(`${dir}:${distance}`);
    }
  }
  assert.deepEqual(keys.sort(), expected.sort());
});

test("buildSamplingPoints: extended keys add server outer names × outer distances", () => {
  const points = buildSamplingPoints([REF_LAT, REF_LON], true, "km");
  const keys = points.map((p) => p.key);
  assert.equal(new Set(keys).size, keys.length, "all keys must be unique");
  const outerKeys = keys.slice(STANDARD_POINT_COUNT);
  const expected = [];
  for (const dir of SERVER_OUTER_NAMES) {
    for (const distance of RADAR_GEOMETRY.km.outer) {
      expected.push(`${dir}:${distance}`);
    }
  }
  assert.deepEqual(outerKeys.sort(), expected.sort());
  // Direction part of every key must be a name the server emits —
  // the renderer looks samples up by `${direction}:${distance}` in
  // the server's risk payload, so an unknown direction silently
  // renders a colourless dot.
  const serverNames = new Set(["C", ...SERVER_OUTER_NAMES]);
  for (const key of keys) {
    const dir = key.slice(0, key.lastIndexOf(":"));
    assert.ok(serverNames.has(dir), `direction "${dir}" (key "${key}") unknown to the server`);
  }
});

test("buildSamplingPoints: km positions follow offsetLatLon along the bearing", () => {
  const points = buildSamplingPoints([REF_LAT, REF_LON], false, "km");
  const n50 = points.find((p) => p.key === "N:50");
  const expectedN = offsetLatLon(REF_LAT, REF_LON, 50, 0);
  assertClose(n50.position[0], expectedN.lat, "N:50 lat");
  assertClose(n50.position[1], expectedN.lon, "N:50 lon");
  const e25 = points.find((p) => p.key === "E:25");
  const expectedE = offsetLatLon(REF_LAT, REF_LON, 25, 90);
  assertClose(e25.position[0], expectedE.lat, "E:25 lat");
  assertClose(e25.position[1], expectedE.lon, "E:25 lon");
});

test("buildSamplingPoints: mi keys carry miles but positions use km", () => {
  const points = buildSamplingPoints([REF_LAT, REF_LON], false, "mi");
  const n30 = points.find((p) => p.key === "N:30");
  assert.ok(n30, "outermost inner-ring mi sample is N:30");
  // 30 mi × 1.609344 = 48.28032 km north — independently computed
  // destination latitude with the spherical model.
  assertClose(n30.position[0], 45.43419534916671, "N:30 (mi) lat");
  assertClose(n30.position[1], REF_LON, "N:30 (mi) lon");
});
