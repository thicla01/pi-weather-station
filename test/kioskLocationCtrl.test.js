// Regression tests for `server/kioskLocationCtrl.js`.
//
// The cache is intentionally trivial (in-memory, no TTL, no
// persistence), so the tests focus on the validation surface — the
// only place where a bad input can cause real harm by feeding
// nonsensical coordinates to the Sense HAT alert lookup. The
// in-memory read path is also exercised so a refactor that
// accidentally swaps the cache slot doesn't silently regress.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const ctrl = require("../server/kioskLocationCtrl");
const { postKioskLocation, getKioskLocation } = ctrl;
const { _setForTest } = ctrl.__test;

// Tiny Express stub — only the surface postKioskLocation actually uses.
function makeReq(body) {
  return { body };
}

function makeRes() {
  const res = {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    end() { return this; },
  };
  return res;
}

// ─── Validation ────────────────────────────────────────────────────────

test("postKioskLocation: rejects missing body", () => {
  _setForTest(null);
  const res = makeRes();
  postKioskLocation(makeReq(undefined), res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /Invalid lat/);
  assert.equal(getKioskLocation(), null);
});

test("postKioskLocation: rejects out-of-range lat (> 90)", () => {
  _setForTest(null);
  const res = makeRes();
  postKioskLocation(makeReq({ lat: 91, lon: 0 }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(getKioskLocation(), null);
});

test("postKioskLocation: rejects out-of-range lat (< -90)", () => {
  _setForTest(null);
  const res = makeRes();
  postKioskLocation(makeReq({ lat: -90.1, lon: 0 }), res);
  assert.equal(res.statusCode, 400);
});

test("postKioskLocation: rejects out-of-range lon (> 180)", () => {
  _setForTest(null);
  const res = makeRes();
  postKioskLocation(makeReq({ lat: 0, lon: 181 }), res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /Invalid lon/);
});

test("postKioskLocation: rejects out-of-range lon (< -180)", () => {
  _setForTest(null);
  const res = makeRes();
  postKioskLocation(makeReq({ lat: 0, lon: -181 }), res);
  assert.equal(res.statusCode, 400);
});

test("postKioskLocation: rejects non-numeric lat", () => {
  _setForTest(null);
  const res = makeRes();
  postKioskLocation(makeReq({ lat: "not a number", lon: 0 }), res);
  assert.equal(res.statusCode, 400);
});

test("postKioskLocation: rejects NaN lat", () => {
  _setForTest(null);
  const res = makeRes();
  postKioskLocation(makeReq({ lat: NaN, lon: 0 }), res);
  assert.equal(res.statusCode, 400);
});

test("postKioskLocation: rejects Infinity lon", () => {
  _setForTest(null);
  const res = makeRes();
  postKioskLocation(makeReq({ lat: 0, lon: Infinity }), res);
  assert.equal(res.statusCode, 400);
});

// ─── Happy path ────────────────────────────────────────────────────────

test("postKioskLocation: accepts valid coords, stores them, returns 204", () => {
  _setForTest(null);
  const res = makeRes();
  postKioskLocation(makeReq({ lat: 33.018956, lon: -94.791412 }), res);
  assert.equal(res.statusCode, 204);
  assert.deepEqual(getKioskLocation(), { lat: 33.018956, lon: -94.791412 });
});

test("postKioskLocation: accepts string-encoded numerics (Number coerces)", () => {
  _setForTest(null);
  const res = makeRes();
  postKioskLocation(makeReq({ lat: "45.5", lon: "-73.6" }), res);
  assert.equal(res.statusCode, 204);
  assert.deepEqual(getKioskLocation(), { lat: 45.5, lon: -73.6 });
});

test("postKioskLocation: last write wins (no TTL)", () => {
  _setForTest(null);
  const r1 = makeRes();
  postKioskLocation(makeReq({ lat: 10, lon: 20 }), r1);
  const r2 = makeRes();
  postKioskLocation(makeReq({ lat: 30, lon: 40 }), r2);
  assert.deepEqual(getKioskLocation(), { lat: 30, lon: 40 });
});

test("postKioskLocation: edge coords — exact poles + dateline", () => {
  _setForTest(null);
  const tests = [
    { lat: 90, lon: 180 },
    { lat: -90, lon: -180 },
    { lat: 0, lon: 0 },
  ];
  for (const { lat, lon } of tests) {
    const res = makeRes();
    postKioskLocation(makeReq({ lat, lon }), res);
    assert.equal(res.statusCode, 204, `should accept ${lat}, ${lon}`);
    assert.deepEqual(getKioskLocation(), { lat, lon });
  }
});

// ─── Read path ─────────────────────────────────────────────────────────

test("getKioskLocation: returns null when cache is empty", () => {
  _setForTest(null);
  assert.equal(getKioskLocation(), null);
});

test("getKioskLocation: returns a clean copy (no internal fields leak)", () => {
  _setForTest({ lat: 1, lon: 2, updatedAt: 12345 });
  const out = getKioskLocation();
  assert.deepEqual(out, { lat: 1, lon: 2 });
  assert.equal(out.updatedAt, undefined);
});
