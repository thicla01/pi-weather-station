// Regression tests for the NWS zone-URL SSRF allowlist
// (nwsZones.__test.isAllowedZoneUrl). The zone URLs we resolve come
// from the NWS alerts response (`properties.affectedZones`), and
// getZoneGeometry fetches them. The allowlist is the defense-in-depth
// guard that keeps a poisoned-upstream / future-misuse scenario from
// turning that fetch into an SSRF foothold (cloud metadata, the
// server's own localhost control endpoints, LAN hosts).
//
// Run: `npm test` (uses Node's built-in `node --test` runner, no deps).

const { test, mock } = require("node:test");
const assert = require("node:assert/strict");

const axios = require("axios").default;
const nwsZones = require("../server/govAlertSources/nwsZones");
const { mergeAsMultiPolygon, getZoneGeometry, clearZoneCache, __test } = nwsZones;
const { isAllowedZoneUrl } = __test;

test("accepts canonical https api.weather.gov zone URLs", () => {
  assert.equal(isAllowedZoneUrl("https://api.weather.gov/zones/fire/AZZ112"), true);
  assert.equal(isAllowedZoneUrl("https://api.weather.gov/zones/forecast/MEZ027"), true);
  assert.equal(isAllowedZoneUrl("https://api.weather.gov/zones/county/AZC025"), true);
});

test("rejects non-https schemes on the right host", () => {
  // http:// downgrade — must be rejected (no plaintext fetch of zone data,
  // and prevents a downgrade-then-MITM path).
  assert.equal(isAllowedZoneUrl("http://api.weather.gov/zones/fire/AZZ112"), false);
});

test("rejects lookalike hostnames (exact-match, not suffix-match)", () => {
  // The classic SSRF-allowlist bypass — a host that merely ENDS WITH the
  // allowed string. Exact hostname comparison defeats it.
  assert.equal(isAllowedZoneUrl("https://api.weather.gov.evil.com/zones/fire/AZZ112"), false);
  assert.equal(isAllowedZoneUrl("https://evil-api.weather.gov/zones/fire/AZZ112"), false);
  assert.equal(isAllowedZoneUrl("https://api.weather.govX/zones/fire/AZZ112"), false);
});

test("rejects internal / metadata / loopback SSRF targets", () => {
  // The targets a blind fetch would be most dangerous against.
  assert.equal(isAllowedZoneUrl("http://169.254.169.254/latest/meta-data/"), false);
  assert.equal(isAllowedZoneUrl("https://localhost:8443/api/debug"), false);
  assert.equal(isAllowedZoneUrl("http://127.0.0.1:8443/settings"), false);
  assert.equal(isAllowedZoneUrl("http://192.168.1.10/admin"), false);
});

test("rejects non-http(s) and credential-embedding schemes", () => {
  assert.equal(isAllowedZoneUrl("file:///etc/passwd"), false);
  assert.equal(isAllowedZoneUrl("ftp://api.weather.gov/zones/fire/AZZ112"), false);
  // userinfo trick: the real host is still evil.com, hostname parses correctly
  assert.equal(isAllowedZoneUrl("https://api.weather.gov@evil.com/zones"), false);
});

test("rejects empty / non-string / unparseable input", () => {
  assert.equal(isAllowedZoneUrl(""), false);
  assert.equal(isAllowedZoneUrl(null), false);
  assert.equal(isAllowedZoneUrl(undefined), false);
  assert.equal(isAllowedZoneUrl(42), false);
  assert.equal(isAllowedZoneUrl({}), false);
  assert.equal(isAllowedZoneUrl("not a url"), false);
});

// ── GeometryCollection flattening — the Houston Flood Watch fix (2026-06-14).
// NWS serves some forecast zones (e.g. TXZ213 "Inland Harris", over Houston)
// as a GeometryCollection mixing Polygon + MultiPolygon members. Before the
// fix, mergeAsMultiPolygon / getZoneGeometry only accepted Polygon +
// MultiPolygon, so such a zone was silently dropped — punching a hole in the
// rendered alert footprint exactly over that zone while every neighbour drew.

const POLY_A = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] };
const POLY_B = { type: "Polygon", coordinates: [[[5, 5], [6, 5], [6, 6], [5, 6], [5, 5]]] };
const MULTI = { type: "MultiPolygon", coordinates: [[[[2, 2], [3, 2], [3, 3], [2, 3], [2, 2]]]] };
// The TXZ213 shape: a GeometryCollection of a Polygon + a MultiPolygon.
const GC = { type: "GeometryCollection", geometries: [POLY_A, MULTI] };

test("mergeAsMultiPolygon: flattens a GeometryCollection into a MultiPolygon", () => {
  const merged = mergeAsMultiPolygon([GC]);
  assert.equal(merged.type, "MultiPolygon");
  assert.equal(merged.coordinates.length, 2); // POLY_A (1) + MULTI (1)
});

test("mergeAsMultiPolygon: a GeometryCollection zone merges with plain-polygon siblings (the real shape, no hole)", () => {
  // The Houston scenario: most zones are plain; one (TXZ213) is a GC. ALL
  // must contribute, or the GC zone leaves a hole.
  const merged = mergeAsMultiPolygon([POLY_B, GC, MULTI]);
  assert.equal(merged.coordinates.length, 4); // POLY_B(1) + GC[A(1)+MULTI(1)] + MULTI(1)
});

test("mergeAsMultiPolygon: a GeometryCollection with no polygonal members contributes nothing", () => {
  const gcPoints = { type: "GeometryCollection", geometries: [{ type: "Point", coordinates: [0, 0] }] };
  assert.equal(mergeAsMultiPolygon([gcPoints]), null);
  // …but it must not poison valid siblings.
  assert.equal(mergeAsMultiPolygon([POLY_A, gcPoints]).coordinates.length, 1);
});

test("mergeAsMultiPolygon: nested GeometryCollection is flattened recursively", () => {
  const nested = { type: "GeometryCollection", geometries: [{ type: "GeometryCollection", geometries: [POLY_A] }, POLY_B] };
  assert.equal(mergeAsMultiPolygon([nested]).coordinates.length, 2);
});

test("mergeAsMultiPolygon: plain Polygon/MultiPolygon still merge; empty/null → null (regression)", () => {
  assert.equal(mergeAsMultiPolygon([POLY_A, MULTI]).coordinates.length, 2);
  assert.equal(mergeAsMultiPolygon([]), null);
  assert.equal(mergeAsMultiPolygon([null, undefined]), null);
  assert.equal(mergeAsMultiPolygon(null), null);
});

test("getZoneGeometry: a GeometryCollection zone resolves to a MultiPolygon (Houston regression)", async () => {
  clearZoneCache();
  const getMock = mock.method(axios, "get", async () => ({ data: { geometry: GC } }));
  try {
    const geo = await getZoneGeometry("https://api.weather.gov/zones/forecast/TXZ213");
    assert.ok(geo, "a GeometryCollection zone must NOT resolve to null (that's the hole)");
    assert.equal(geo.type, "MultiPolygon");
    assert.equal(geo.coordinates.length, 2);
  } finally {
    getMock.mock.restore();
    clearZoneCache();
  }
});

test("getZoneGeometry: a plain Polygon zone still resolves; a geometry-less zone → null (regression)", async () => {
  clearZoneCache();
  const polyMock = mock.method(axios, "get", async () => ({ data: { geometry: POLY_A } }));
  try {
    assert.equal((await getZoneGeometry("https://api.weather.gov/zones/forecast/MEZ027")).type, "Polygon");
  } finally {
    polyMock.mock.restore();
    clearZoneCache();
  }
  const nullMock = mock.method(axios, "get", async () => ({ data: {} }));
  try {
    assert.equal(await getZoneGeometry("https://api.weather.gov/zones/forecast/MEZ099"), null);
  } finally {
    nullMock.mock.restore();
    clearZoneCache();
  }
});
