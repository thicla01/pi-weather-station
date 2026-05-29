// Regression tests for the NWS zone-URL SSRF allowlist
// (nwsZones.__test.isAllowedZoneUrl). The zone URLs we resolve come
// from the NWS alerts response (`properties.affectedZones`), and
// getZoneGeometry fetches them. The allowlist is the defense-in-depth
// guard that keeps a poisoned-upstream / future-misuse scenario from
// turning that fetch into an SSRF foothold (cloud metadata, the
// server's own localhost control endpoints, LAN hosts).
//
// Run: `npm test` (uses Node's built-in `node --test` runner, no deps).

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { __test } = require("../server/govAlertSources/nwsZones");
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
