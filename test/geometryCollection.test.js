// Regression tests for GeoJSON GeometryCollection handling in the gov-alert
// geometry helpers (server/govAlertSources/_shared.js) and the ECCC source.
//
// History (2026-10-07 audit): eccc.js hands each feature's raw geometry to
// _shared.pointInPolygon, which accepted only Polygon / MultiPolygon and
// returned false for anything else. An ECCC alert served as a
// GeometryCollection would therefore have matched no point at all — no
// banner, no map overlay, nothing on the Sense HAT — and the nearby-alerts
// radius test (circleIntersectsPolygon, via geometryRings) would have culled
// it as well. Never observed on ECCC, but its targeted warning polygons "can
// be split and merged", and NWS already hit the same hole with forecast zones
// (TXZ213, the 2026-06-14 Houston Flood Watch — see test/nwsZones.test.js).
// The fix puts the flattening in one shared helper (polygonsOf) that
// pointInPolygon, geometryRings and mergeAsMultiPolygon all build on.
//
// Run: `npm test` (Node's built-in `node --test` runner, no deps).

const { test, mock } = require("node:test");
const assert = require("node:assert/strict");

const axios = require("axios").default;

const { pointInPolygon, circleIntersectsPolygon, mergeAsMultiPolygon, __test } = require("../server/govAlertSources/_shared");
const { geometryRings } = __test;
const nwsZones = require("../server/govAlertSources/nwsZones");
const eccc = require("../server/govAlertSources/eccc");
const { getActiveAlertsAt, getNearbyAlertsAt } = require("../server/govAlertsCtrl");

// Montréal — inside CA_BBOX, so eccc.tryAlerts reaches the (stubbed) feed.
const LAT = 45.5017;
const LON = -73.5673;

// A box given as [west, east, south, north] → closed GeoJSON ring ([lon, lat]).
const ring = (w, e, s, n) => [[w, s], [e, s], [e, n], [w, n], [w, s]];
const polygon = (...rings) => ({ type: "Polygon", coordinates: rings });
const multiPolygon = (...polys) => ({ type: "MultiPolygon", coordinates: polys.map((p) => p.coordinates) });
const collection = (...geometries) => ({ type: "GeometryCollection", geometries });

const AROUND = polygon(ring(-74.5, -72.5, 45.0, 46.0));    // contains the test point
const FAR = polygon(ring(-71.5, -71.0, 46.6, 47.0));       // Québec City area, ≈ 200 km away
const NEAR_EAST = polygon(ring(-73.0, -72.5, 45.3, 45.7)); // western edge ≈ 44 km east of the point
// A donut whose hole contains the test point.
const DONUT = polygon(ring(-75.0, -72.0, 44.5, 46.5), ring(-74.0, -73.0, 45.2, 45.8));

// Non-areal geometries sitting exactly ON the test point — the strongest
// negative: a point or a line through the location still covers no area.
const POINT_AT = { type: "Point", coordinates: [LON, LAT] };
const LINE_THROUGH = { type: "LineString", coordinates: [[LON - 1, LAT], [LON + 1, LAT]] };
const MULTI_POINT_AT = { type: "MultiPoint", coordinates: [[LON, LAT]] };
const MULTI_LINE_THROUGH = { type: "MultiLineString", coordinates: [[[LON, LAT - 1], [LON, LAT + 1]]] };

// ── pointInPolygon ──────────────────────────────────────────────────────────

test("pointInPolygon: a GeometryCollection holding a polygon around the point matches (the ECCC hole)", () => {
  assert.equal(pointInPolygon(LAT, LON, collection(AROUND)), true);
  // Non-areal members next to the polygon are ignored, not fatal.
  assert.equal(pointInPolygon(LAT, LON, collection(LINE_THROUGH, POINT_AT, AROUND)), true);
  // The covering polygon may come from a MultiPolygon member.
  assert.equal(pointInPolygon(LAT, LON, collection(FAR, multiPolygon(FAR, AROUND))), true);
});

test("pointInPolygon: a collection of only points and lines never matches, even through the point", () => {
  assert.equal(pointInPolygon(LAT, LON, collection(POINT_AT, LINE_THROUGH, MULTI_POINT_AT, MULTI_LINE_THROUGH)), false);
  assert.equal(pointInPolygon(LAT, LON, collection()), false);
});

test("pointInPolygon: a collection whose polygons all miss the point doesn't match", () => {
  assert.equal(pointInPolygon(LAT, LON, collection(FAR, NEAR_EAST, LINE_THROUGH)), false);
});

test("pointInPolygon: nested collections are flattened recursively", () => {
  assert.equal(pointInPolygon(LAT, LON, collection(FAR, collection(collection(AROUND)))), true);
});

test("pointInPolygon: holes still apply inside a collection, and overlapping members don't cancel out", () => {
  // The flattening keeps each polygon's rings together: the donut's hole
  // still excludes the point…
  assert.equal(pointInPolygon(LAT, LON, collection(DONUT)), false);
  // …and members that both cover the point (legal in a collection) are
  // tested independently — an XOR across every ring would cancel them out.
  assert.equal(pointInPolygon(LAT, LON, collection(AROUND, AROUND)), true);
  assert.equal(pointInPolygon(LAT, LON, collection(DONUT, AROUND)), true);
});

test("pointInPolygon: plain Polygon / MultiPolygon unchanged (regression)", () => {
  assert.equal(pointInPolygon(LAT, LON, AROUND), true);
  assert.equal(pointInPolygon(LAT, LON, FAR), false);
  assert.equal(pointInPolygon(LAT, LON, DONUT), false); // hole honoured
  assert.equal(pointInPolygon(LAT, LON, multiPolygon(FAR, AROUND)), true);
  assert.equal(pointInPolygon(LAT, LON, multiPolygon(FAR, NEAR_EAST)), false);
});

test("pointInPolygon: no geometry, a non-areal one, or missing coordinates → false", () => {
  assert.equal(pointInPolygon(LAT, LON, null), false);
  assert.equal(pointInPolygon(LAT, LON, undefined), false);
  assert.equal(pointInPolygon(LAT, LON, POINT_AT), false);
  assert.equal(pointInPolygon(LAT, LON, LINE_THROUGH), false);
  // These two used to throw a TypeError ("not iterable") out of tryAlerts.
  assert.equal(pointInPolygon(LAT, LON, { type: "Polygon" }), false);
  assert.equal(pointInPolygon(LAT, LON, { type: "MultiPolygon" }), false);
  assert.equal(pointInPolygon(LAT, LON, { type: "GeometryCollection" }), false);
});

// ── circleIntersectsPolygon / geometryRings (nearby-alerts radius test) ─────

test("circleIntersectsPolygon: a GeometryCollection area is circle-tested like its polygons", () => {
  // Centre inside a member polygon.
  assert.equal(circleIntersectsPolygon(LAT, LON, 5, collection(LINE_THROUGH, AROUND)), true);
  // A member's edge clips the circle although the centre is outside it.
  assert.equal(circleIntersectsPolygon(LAT, LON, 50, collection(POINT_AT, NEAR_EAST)), true);
  assert.equal(circleIntersectsPolygon(LAT, LON, 20, collection(POINT_AT, NEAR_EAST)), false);
  // No area at all → nothing for the overlay to intersect.
  assert.equal(circleIntersectsPolygon(LAT, LON, 100, collection(POINT_AT, LINE_THROUGH)), false);
});

test("geometryRings: every ring of a collection's polygons, nothing from its points and lines", () => {
  const rings = geometryRings(collection(DONUT, LINE_THROUGH, collection(AROUND), POINT_AT));
  assert.deepEqual(rings, [...DONUT.coordinates, ...AROUND.coordinates]);
  assert.deepEqual(geometryRings(collection(POINT_AT, LINE_THROUGH)), []);
  // Plain shapes unchanged (regression).
  assert.deepEqual(geometryRings(DONUT), DONUT.coordinates);
  assert.deepEqual(geometryRings(multiPolygon(AROUND, FAR)), [...AROUND.coordinates, ...FAR.coordinates]);
});

// ── mergeAsMultiPolygon — one implementation for both sources ───────────────

test("mergeAsMultiPolygon: NWS zones and ECCC share the one _shared implementation", () => {
  assert.equal(nwsZones.mergeAsMultiPolygon, mergeAsMultiPolygon);
});

test("mergeAsMultiPolygon: keeps a collection's polygons in order, drops its points and lines", () => {
  const merged = mergeAsMultiPolygon([collection(POINT_AT, AROUND, LINE_THROUGH, collection(FAR))]);
  assert.deepEqual(merged, { type: "MultiPolygon", coordinates: [AROUND.coordinates, FAR.coordinates] });
  assert.equal(mergeAsMultiPolygon([collection(POINT_AT, LINE_THROUGH)]), null);
});

// ── ECCC end to end: feed → banner / Sense HAT and the nearby overlay ───────

// Synthetic pygeoapi features: a GeometryCollection warning around Montréal,
// a GeometryCollection with no area, and a plain Polygon warning.
const ecccFeature = (id, geometry) => ({
  id,
  properties: {
    alert_code: "thunderstorm",
    alert_name_en: "severe thunderstorm warning",
    alert_name_fr: "avertissement d'orages violents",
    impact_en: "High",
    alert_text_en: "Severe thunderstorms are occurring.",
    alert_text_fr: "Des orages violents se produisent.",
    publication_datetime: "2026-10-07T18:00:00Z",
    expiration_datetime: "2026-10-07T22:00:00Z",
    province: "QC",
    feature_name_en: "Montréal",
  },
  geometry,
});
const GC_ALERT = ecccFeature("eccc-gc", collection(LINE_THROUGH, AROUND, POINT_AT));
const LINES_ALERT = ecccFeature("eccc-lines", collection(POINT_AT, LINE_THROUGH));
const POLY_ALERT = ecccFeature("eccc-poly", AROUND);
const ECCC_FEED = { data: { features: [GC_ALERT, LINES_ALERT, POLY_ALERT] } };

/**
 * Stub axios for one test: the ECCC feed above, and an empty answer from
 * every NWS endpoint (no US alerts here, no US state under the circle).
 * @returns {Object} the node:test mock, to restore in `finally`
 */
function stubFeeds() {
  return mock.method(axios, "get", async (url) => (
    url.startsWith("https://api.weather.gc.ca/") ? ECCC_FEED : { data: { features: [] } }
  ));
}

test("ECCC: a GeometryCollection alert around the point reaches the banner and the Sense HAT, as a MultiPolygon", async () => {
  const getMock = stubFeeds();
  try {
    eccc.__test._resetFeedCache();
    // getActiveAlertsAt is what GET /api/weather-alerts and the Sense HAT both call.
    const alerts = await getActiveAlertsAt(LAT, LON);
    assert.deepEqual(alerts.map((a) => a.id).sort(), ["eccc-gc", "eccc-poly"]);
    const gc = alerts.find((a) => a.id === "eccc-gc");
    assert.equal(gc.tier, "red");
    // Served as the polygonal part only — the line and the point are gone.
    assert.deepEqual(gc.geometry, { type: "MultiPolygon", coordinates: [AROUND.coordinates] });
    // A plain Polygon is passed through untouched.
    assert.equal(alerts.find((a) => a.id === "eccc-poly").geometry, POLY_ALERT.geometry);
  } finally {
    getMock.mock.restore();
    eccc.__test._resetFeedCache();
  }
});

test("ECCC nearby overlay: the collection is drawn, a collection without area counts as not mapped", async () => {
  const getMock = stubFeeds();
  try {
    eccc.__test._resetFeedCache();
    const { alerts, residualCount } = await getNearbyAlertsAt(LAT, LON, 50);
    assert.deepEqual(alerts.map((a) => a.id).sort(), ["eccc-gc", "eccc-poly"]);
    assert.equal(alerts.find((a) => a.id === "eccc-gc").geometry.type, "MultiPolygon");
    assert.equal(residualCount, 1, "the lines-only alert has no area to draw: the client's \"+N not mapped\"");
  } finally {
    getMock.mock.restore();
    eccc.__test._resetFeedCache();
  }
});
