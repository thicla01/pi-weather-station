// Regression tests for the nearby-alerts radius geometry
// (_shared.circleIntersectsPolygon + helpers). This is the load-bearing
// correctness piece of GET /api/nearby-alerts: the point-based sources ask
// "is (lat,lon) inside this alert?", but the radius overlay asks "does this
// alert's polygon come within R km of (lat,lon)?". The case that motivated
// the dedicated helper is a large county whose polygon EDGE clips the circle
// even though its centroid sits well outside — a centre-only
// point-in-polygon test would wrongly miss it.
//
// Run: `npm test` (Node's built-in `node --test` runner, no deps).

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { circleIntersectsPolygon, __test } = require("../server/govAlertSources/_shared");
const { distPointToSegmentKm } = __test;
const { __test: nwsTest } = require("../server/govAlertSources/nws");
const { circleBboxCorners } = nwsTest;

// Query point used throughout (Lavaca County, TX — the live worked-example
// area). kmPerDegLon(29.45°) ≈ 96.95, so 1° of longitude ≈ 96.95 km here.
const LAT = 29.45;
const LON = -96.85;

const polygon = (ring) => ({ type: "Polygon", coordinates: [ring] });
// A box given as [west, east, south, north] → closed GeoJSON ring.
const box = (w, e, s, n) => polygon([[w, s], [e, s], [e, n], [w, n], [w, s]]);

test("centre inside the polygon → true (any positive radius)", () => {
  const g = box(-97.0, -96.7, 29.3, 29.6); // contains the query point
  assert.equal(circleIntersectsPolygon(LAT, LON, 5, g), true);
  assert.equal(circleIntersectsPolygon(LAT, LON, 100, g), true);
});

test("KEY CASE: large polygon whose edge clips the circle, centroid outside", () => {
  // Box to the east: centroid ≈ (-96.0, 29.5) ≈ 82 km away (outside 50 km),
  // but its western edge sits ≈ 34 km east of the query point.
  const g = box(-96.5, -95.5, 29.0, 30.0);
  // Sanity: the centre is NOT inside this polygon (it's west of the box).
  // radius 50 reaches the western edge (≈34 km) → intersects.
  assert.equal(circleIntersectsPolygon(LAT, LON, 50, g), true);
  // radius 20 cannot reach the western edge → no intersection.
  assert.equal(circleIntersectsPolygon(LAT, LON, 20, g), false);
});

test("polygon entirely outside the radius → false (bbox reject + edge test)", () => {
  const g = box(-90.0, -89.0, 35.0, 36.0); // far NE — bbox can't overlap
  assert.equal(circleIntersectsPolygon(LAT, LON, 50, g), false);
  assert.equal(circleIntersectsPolygon(LAT, LON, 100, g), false);
});

test("small polygon fully inside the circle (centre not in it) → true", () => {
  const g = box(-96.75, -96.70, 29.46, 29.50); // ≈10–15 km NE, doesn't contain centre
  assert.equal(circleIntersectsPolygon(LAT, LON, 50, g), true);
  // Nearest vertex ≈ 9.8 km away → a 5 km circle doesn't reach it.
  assert.equal(circleIntersectsPolygon(LAT, LON, 5, g), false);
});

test("MultiPolygon is handled like its constituent polygons", () => {
  const east = box(-96.5, -95.5, 29.0, 30.0);
  const multi = { type: "MultiPolygon", coordinates: [east.coordinates] };
  assert.equal(circleIntersectsPolygon(LAT, LON, 50, multi), true);
  assert.equal(circleIntersectsPolygon(LAT, LON, 20, multi), false);
});

test("degenerate inputs → false", () => {
  const g = box(-97.0, -96.7, 29.3, 29.6);
  assert.equal(circleIntersectsPolygon(LAT, LON, 0, g), false);      // zero radius
  assert.equal(circleIntersectsPolygon(LAT, LON, -10, g), false);    // negative radius
  assert.equal(circleIntersectsPolygon(LAT, LON, 50, null), false);  // no geometry
  assert.equal(circleIntersectsPolygon(LAT, LON, 50, { type: "Point", coordinates: [LON, LAT] }), false);
});

test("distPointToSegmentKm: planar point-to-segment distance", () => {
  // Horizontal segment from (-10,0) to (10,0).
  assert.equal(distPointToSegmentKm(0, 5, -10, 0, 10, 0), 5);   // perpendicular
  assert.equal(distPointToSegmentKm(0, 0, -10, 0, 10, 0), 0);   // on the segment
  assert.equal(distPointToSegmentKm(20, 0, -10, 0, 10, 0), 10); // beyond the +x endpoint
  assert.equal(distPointToSegmentKm(-20, 0, -10, 0, 10, 0), 10);// beyond the -x endpoint
});

test("circleBboxCorners: centre + four corners, correctly offset", () => {
  const corners = circleBboxCorners(LAT, LON, 50);
  assert.equal(corners.length, 5);
  assert.deepEqual(corners[0], [LAT, LON]); // centre first
  const dLat = 50 / 110.574; // ≈ 0.452°
  assert.ok(Math.abs((corners[1][0] - LAT) - dLat) < 1e-6); // north corner lat
  assert.ok(Math.abs((corners[3][0] - LAT) + dLat) < 1e-6); // south corner lat
  // Longitude offset is wider in degrees than latitude (cos(lat) < 1).
  assert.ok(Math.abs(corners[1][1] - LON) > dLat);
});
