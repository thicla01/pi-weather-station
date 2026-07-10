// Regression tests for the ECCC bbox cell geometry
// (server/govAlertSources/eccc.js → cellFor / cellTouchesCA).
//
// Both properties below were review findings on the 2026-07 perf lot:
//   1. ECCC's pygeoapi answers HTTP 500 {NoApplicableCode} for a bbox
//      edge past ±180 / ±90 (verified live near the antimeridian and
//      the pole), so cellFor must clamp the emitted box to valid WGS84
//      ranges — and cellTouchesCA must let callers skip the fetch when
//      the cell can't intersect Canada at all.
//   2. The 100 km nearby circle must be fully covered in longitude for
//      every latitude CA_BBOX allows (up to 84°N): the half-width is
//      computed with cos() at the POLEWARD cell edge (not the centre),
//      clamped at 85°. The old centre + 80°-clamp variant left up to a
//      ~34 km uncovered sliver at 83°N.
//
// Run: `npm test` (Node's built-in `node --test` runner, no deps).

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { __test } = require("../server/govAlertSources/eccc");
const { cellFor, cellTouchesCA } = __test;

const COVER_RADIUS_KM = 100; // mirrors NEARBY_MAX_RADIUS_KM (govAlertsCtrl)
const EARTH_RADIUS_KM = 6371;

test("bbox is always inside valid WGS84 ranges (pygeoapi 500s otherwise)", () => {
  // Sweep the whole globe on a coarse grid, plus the exact live-500 cases.
  const probes = [[-16.4, 179.4], [71, -179.5], [89.2, -100], [-89.2, 10]];
  for (let lat = -89; lat <= 89; lat += 8) {
    for (let lon = -179; lon <= 179; lon += 8) probes.push([lat, lon]);
  }
  for (const [lat, lon] of probes) {
    const c = cellFor(lat, lon);
    assert.ok(c.latMin >= -90 && c.latMax <= 90, `lat range @${lat},${lon}: ${c.bbox}`);
    assert.ok(c.lonMin >= -180 && c.lonMax <= 180, `lon range @${lat},${lon}: ${c.bbox}`);
    assert.ok(c.latMin < c.latMax && c.lonMin < c.lonMax, `degenerate box @${lat},${lon}`);
  }
});

test("the 100 km circle is fully covered for every latitude Canada reaches", () => {
  // Worst case per cell: query point at the poleward cell corner. The
  // geodesic longitude half-extent of a 100 km circle at latitude φ is
  // asin(sin(r/R) / cos φ). The box must cover that from the snapped
  // cell centre, i.e. halfLon ≥ 0.5° (snap) + Δλ(cell edge).
  for (let cLat = 40; cLat <= 84; cLat += 1) {
    const c = cellFor(cLat, -100);
    const halfLon = c.lonMax - (-100);
    const edgeLat = (Math.abs(cLat) + 0.5) * Math.PI / 180;
    const dLambda = Math.asin(Math.sin(COVER_RADIUS_KM / EARTH_RADIUS_KM) / Math.cos(edgeLat)) * 180 / Math.PI;
    assert.ok(
      halfLon >= 0.5 + dLambda,
      `lon coverage @cLat=${cLat}: have ${halfLon.toFixed(3)}°, need ${(0.5 + dLambda).toFixed(3)}°`,
    );
    const halfLat = c.latMax - cLat;
    const dPhi = (COVER_RADIUS_KM / 111) + 0.5;
    assert.ok(halfLat >= dPhi - 0.11, `lat coverage @cLat=${cLat}`); // 0.1° slack is part of the margin
  }
});

test("cellTouchesCA gates far-away queries but keeps the US border case", () => {
  assert.equal(cellTouchesCA(cellFor(45.5, -73.6)), true,  "Montréal");
  assert.equal(cellTouchesCA(cellFor(82.5, -62.3)), true,  "Alert, NU");
  assert.equal(cellTouchesCA(cellFor(39.5, -105.0)), true, "Denver — box top crosses lat 40");
  assert.equal(cellTouchesCA(cellFor(-16.4, 179.4)), false, "Fiji");
  assert.equal(cellTouchesCA(cellFor(48.8, 2.3)), false,   "Paris");
  assert.equal(cellTouchesCA(cellFor(29.45, -96.85)), false, "Lavaca County, TX — interior");
});
