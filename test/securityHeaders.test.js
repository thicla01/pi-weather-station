// Regression tests for the baseline HTTP security-header middleware
// (server/securityHeaders.js). These lock down that every response carries
// the anti-sniff / anti-frame / referrer / frame-ancestors headers and that
// the middleware always continues the chain.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { securityHeaders, SECURITY_HEADERS } = require("../server/securityHeaders");

// Minimal Express res stand-in that records setHeader calls.
function fakeRes() {
  const headers = {};
  return {
    headers,
    setHeader(name, value) {
      headers[name] = value;
    },
  };
}

test("securityHeaders: stamps every header in SECURITY_HEADERS and calls next()", () => {
  const res = fakeRes();
  let nextCalled = false;
  securityHeaders({}, res, () => {
    nextCalled = true;
  });

  assert.ok(nextCalled, "next() must be called so the chain continues");
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    assert.equal(res.headers[name], value, `${name} must be set to ${value}`);
  }
});

test("securityHeaders: sets the four expected hardening headers", () => {
  // Lock the exact contract so a stray edit (e.g. weakening X-Frame-Options
  // to SAMEORIGIN, or dropping nosniff) trips a test.
  assert.equal(SECURITY_HEADERS["X-Content-Type-Options"], "nosniff");
  assert.equal(SECURITY_HEADERS["X-Frame-Options"], "DENY");
  assert.equal(SECURITY_HEADERS["Referrer-Policy"], "no-referrer");
  assert.equal(SECURITY_HEADERS["Content-Security-Policy"], "frame-ancestors 'none'");
});

test("securityHeaders: does not set HSTS (self-signed cert + HTTP fallback target)", () => {
  // Deliberately absent — pinning HTTPS would harm the self-signed kiosk.
  const res = fakeRes();
  securityHeaders({}, res, () => {});
  assert.ok(!("Strict-Transport-Security" in res.headers));
});
