// Regression tests for the settings controller's two security-critical
// pure helpers: the input whitelist (`sanitizeSettings`) and the remote-
// client masking layer (`maskForRemote`).
//
// Why these are worth dedicated coverage:
//   - sanitizeSettings is the gate that prevents an attacker (or a buggy
//     client) from writing arbitrary keys into settings.json on a PATCH
//     or PUT. Drop the gate by accident and any caller can plant fields
//     the server will then read back as settings.
//   - maskForRemote is the gate that prevents secrets (API keys, the
//     `indoorTemperature` sub-object with Homebridge host + password)
//     from leaving the server when a remote client polls GET /settings.
//     CLAUDE.md is explicit: "host/credentials are not even masked" —
//     the indoorTemperature subtree must be entirely absent from the
//     remote response, not merely null-ed or boolean-ed.
//
// Both helpers are pure and exported via the controller's `__test`
// surface — same pattern as radarAnalyzerCtrl and aiSummaryCtrl.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { __test } = require("../server/settingsCtrl");
const { sanitizeSettings, maskForRemote, preserveServerOwnedAdvanced, ensureSecurePermissions, FILE_MODE, ALLOWED_KEYS, API_KEY_FIELDS, REMOTE_HIDDEN_KEYS } = __test;

// === sanitizeSettings: the input whitelist ===

test("sanitizeSettings: passes through every allowed key", () => {
  const input = {
    weatherApiKey: "abc",
    mapApiKey: "def",
    reverseGeoApiKey: "ghi",
    anthropicApiKey: "jkl",
    airNowApiKey: "mno",
    openAqApiKey: "pqr",
    startingLat: 45.5,
    startingLon: -73.5,
    indoorTemperature: { enabled: true, host: "homebridge.local" },
    advanced: { ai: { extendedRadius: true } },
  };
  const out = sanitizeSettings(input);
  for (const k of Object.keys(input)) {
    assert.ok(k in out, `expected allowed key "${k}" to be preserved`);
  }
  assert.equal(Object.keys(out).length, Object.keys(input).length);
});

test("sanitizeSettings: drops unknown keys silently", () => {
  const out = sanitizeSettings({
    weatherApiKey: "kept",
    __proto__pollution: "evil",
    rogueKey: 123,
    "../../../etc/passwd": "nope",
  });
  assert.equal(out.weatherApiKey, "kept");
  assert.ok(!("__proto__pollution" in out));
  assert.ok(!("rogueKey" in out));
  assert.ok(!("../../../etc/passwd" in out));
});

test("sanitizeSettings: null / undefined / non-object input → {}", () => {
  assert.deepEqual(sanitizeSettings(null), {});
  assert.deepEqual(sanitizeSettings(undefined), {});
  assert.deepEqual(sanitizeSettings(42), {});
  assert.deepEqual(sanitizeSettings("string"), {});
});

test("sanitizeSettings: array input → {} (arrays are typeof 'object' but rejected)", () => {
  assert.deepEqual(sanitizeSettings([{ weatherApiKey: "x" }]), {});
});

test("sanitizeSettings: empty object → {}", () => {
  assert.deepEqual(sanitizeSettings({}), {});
});

test("sanitizeSettings: mixed allowed + unknown keys keeps only allowed", () => {
  const out = sanitizeSettings({
    weatherApiKey: "kept",
    nope: "dropped",
    startingLat: 0,
    moreNope: { nested: "also dropped" },
  });
  assert.deepEqual(out, { weatherApiKey: "kept", startingLat: 0 });
});

// === maskForRemote: the remote-client safety layer ===

test("maskForRemote: every API key field becomes a boolean reflecting truthiness", () => {
  const out = maskForRemote({
    weatherApiKey: "real-key",
    mapApiKey: "",
    reverseGeoApiKey: null,
    anthropicApiKey: "another-real-key",
    airNowApiKey: undefined,
    openAqApiKey: "x",
  });
  assert.equal(out.weatherApiKey, true);
  assert.equal(out.mapApiKey, false);
  assert.equal(out.reverseGeoApiKey, false);
  assert.equal(out.anthropicApiKey, true);
  assert.equal(out.airNowApiKey, false);
  assert.equal(out.openAqApiKey, true);
});

test("maskForRemote: indoorTemperature subtree is entirely absent — not masked, stripped", () => {
  const out = maskForRemote({
    weatherApiKey: "x",
    indoorTemperature: {
      enabled: true,
      host: "homebridge.local",
      username: "admin",
      password: "super-secret",
      sensorName: "Living Room",
    },
  });
  // CLAUDE.md contract: "host/credentials are not even masked — the
  // indoorTemperature subtree must be entirely absent from the remote
  // response, not merely null-ed or boolean-ed."
  assert.ok(!("indoorTemperature" in out));
  // Nothing about it leaks through the key itself either.
  const serialised = JSON.stringify(out);
  assert.ok(!serialised.includes("homebridge.local"));
  assert.ok(!serialised.includes("super-secret"));
  assert.ok(!serialised.includes("admin"));
});

test("maskForRemote: lat / lon pass through unchanged (not secrets)", () => {
  const out = maskForRemote({
    startingLat: 45.5017,
    startingLon: -73.5673,
  });
  assert.equal(out.startingLat, 45.5017);
  assert.equal(out.startingLon, -73.5673);
});

test("maskForRemote: `advanced` subtree passes through unchanged (no secrets)", () => {
  const out = maskForRemote({
    advanced: {
      ai: { extendedRadius: true, showSamplingPoints: false },
      sleep: { stage1Delay: 5 },
      experimental: { uiC: false },
    },
  });
  assert.deepEqual(out.advanced, {
    ai: { extendedRadius: true, showSamplingPoints: false },
    sleep: { stage1Delay: 5 },
    experimental: { uiC: false },
  });
});

test("maskForRemote: default-deny — an unknown top-level key never reaches a remote client", () => {
  // The mask is allow-list driven (sanitizeSettings first), not deny-list:
  // an UNRECOGNISED key (not on the whitelist) must be dropped, so a key
  // hand-added to settings.json — or left over from an older build — can't
  // leak verbatim. (A key deliberately added to ALLOWED_KEYS is whitelisted
  // and still passes; that's the case API_KEY_FIELDS / REMOTE_HIDDEN_KEYS
  // exist to handle.)
  const out = maskForRemote({
    weatherApiKey: "secret-value",
    rogueSecret: "should-never-appear",
    debugToken: "also-secret",
    startingLat: 45.5,
  });
  assert.ok(!("rogueSecret" in out));
  assert.ok(!("debugToken" in out));
  // Known keys still behave: API key booleanised, lat passes through.
  assert.equal(out.weatherApiKey, true);
  assert.equal(out.startingLat, 45.5);
});

test("maskForRemote: an unknown key whose name ends in 'ApiKey' is still dropped, not booleanised", () => {
  // The booleanisation is keyed on the explicit API_KEY_FIELDS set, not a
  // name pattern — and the default-deny projection drops the key entirely
  // before that anyway, so no value (or even its truthiness) escapes.
  const out = maskForRemote({ futureSecretApiKey: "leak" });
  assert.deepEqual(out, {});
});

test("maskForRemote: null / undefined / non-object input → {}", () => {
  assert.deepEqual(maskForRemote(null), {});
  assert.deepEqual(maskForRemote(undefined), {});
  assert.deepEqual(maskForRemote("string"), {});
  assert.deepEqual(maskForRemote([]), {});
});

test("maskForRemote: empty object → empty object", () => {
  assert.deepEqual(maskForRemote({}), {});
});

test("maskForRemote: realistic full-settings input — full strip + mask roundtrip", () => {
  const full = {
    weatherApiKey: "wak-123",
    mapApiKey: "mak-456",
    reverseGeoApiKey: "",
    anthropicApiKey: "ant-789",
    airNowApiKey: "",
    openAqApiKey: "oaq-000",
    startingLat: 45.5,
    startingLon: -73.5,
    indoorTemperature: {
      enabled: true,
      host: "homebridge.local",
      port: 8581,
      username: "admin",
      password: "p4ssw0rd",
      sensorName: "Salon",
    },
    advanced: { ai: { extendedRadius: true } },
  };
  const out = maskForRemote(full);

  // Booleans where real keys were configured
  assert.equal(out.weatherApiKey, true);
  assert.equal(out.mapApiKey, true);
  assert.equal(out.anthropicApiKey, true);
  assert.equal(out.openAqApiKey, true);
  // Booleans (false) where keys were empty / unset
  assert.equal(out.reverseGeoApiKey, false);
  assert.equal(out.airNowApiKey, false);
  // Non-secret data passes through
  assert.equal(out.startingLat, 45.5);
  assert.equal(out.startingLon, -73.5);
  assert.deepEqual(out.advanced, { ai: { extendedRadius: true } });
  // The secrets-bearing subtree is gone
  assert.ok(!("indoorTemperature" in out));
});

// === Sanity checks on the Sets themselves ===

test("ALLOWED_KEYS includes all current top-level setting keys", () => {
  const expected = [
    "weatherApiKey", "mapApiKey", "reverseGeoApiKey", "anthropicApiKey",
    "airNowApiKey", "openAqApiKey",
    "startingLat", "startingLon",
    "indoorTemperature",
    "advanced",
  ];
  for (const k of expected) {
    assert.ok(ALLOWED_KEYS.has(k), `ALLOWED_KEYS missing expected key "${k}"`);
  }
});

test("API_KEY_FIELDS is a subset of ALLOWED_KEYS", () => {
  // Any API key field must also be writable — otherwise it could never be set
  // through the controller in the first place.
  for (const k of API_KEY_FIELDS) {
    assert.ok(ALLOWED_KEYS.has(k), `API key field "${k}" should also be allowed`);
  }
});

test("REMOTE_HIDDEN_KEYS includes indoorTemperature (Homebridge credentials)", () => {
  assert.ok(REMOTE_HIDDEN_KEYS.has("indoorTemperature"));
});

// === preserveServerOwnedAdvanced: don't let a client advanced-PATCH wipe ===
// === the Sense HAT mode/brightness the sensehat endpoints own.            ===
//
// Regression for the live bug: in Radar mode, toggling "sampling points"
// (advanced.ai.showSamplingPoints) PATCHed the whole `advanced` blob rebuilt
// from React state, which has no `sensehat` section — wiping advanced.sensehat
// so resolveMode fell back to "weather" and the Sense HAT switched display.

test("preserveServerOwnedAdvanced: splices existing sensehat into a client advanced PATCH", () => {
  const current = { advanced: { sensehat: { mode: "radar", radarBrightness: 40 }, ai: { extendedRadius: false } } };
  const incoming = { ai: { showSamplingPoints: true }, display: {} }; // client blob — no sensehat
  const out = preserveServerOwnedAdvanced(current, "advanced", incoming);
  assert.deepEqual(out.sensehat, { mode: "radar", radarBrightness: 40 });
  assert.equal(out.ai.showSamplingPoints, true); // client section still applied
});

test("preserveServerOwnedAdvanced: keeps an explicit sensehat in the payload (no override)", () => {
  const current = { advanced: { sensehat: { mode: "radar" } } };
  const incoming = { sensehat: { mode: "clock" }, ai: {} };
  const out = preserveServerOwnedAdvanced(current, "advanced", incoming);
  assert.equal(out.sensehat.mode, "clock"); // caller-supplied sensehat wins
});

test("preserveServerOwnedAdvanced: no-op when there's no existing sensehat", () => {
  const current = { advanced: { ai: {} } };
  const incoming = { ai: { showSamplingPoints: true } };
  const out = preserveServerOwnedAdvanced(current, "advanced", incoming);
  assert.ok(!("sensehat" in out));
});

test("preserveServerOwnedAdvanced: ignores keys other than 'advanced'", () => {
  const current = { advanced: { sensehat: { mode: "radar" } } };
  assert.equal(preserveServerOwnedAdvanced(current, "weatherApiKey", "abc"), "abc");
});

// === ensureSecurePermissions: settings.json must be owner-only (0600) ===
// The file holds the six API keys + the Homebridge credentials, so any other
// local account being able to read it is the vulnerability this closes.

test("FILE_MODE is 0600 (owner read/write only)", () => {
  assert.equal(FILE_MODE, 0o600);
});

test("ensureSecurePermissions: tightens a 0644 file to 0600", () => {
  const tmp = path.join(os.tmpdir(), `settings-perm-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(tmp, "{}");
  fs.chmodSync(tmp, 0o644); // force world-readable regardless of the umask
  assert.equal(fs.statSync(tmp).mode & 0o777, 0o644);
  try {
    ensureSecurePermissions(tmp);
    assert.equal(fs.statSync(tmp).mode & 0o777, 0o600);
  } finally {
    fs.unlinkSync(tmp);
  }
});

test("ensureSecurePermissions: a non-existent path is a silent no-op (no throw)", () => {
  const missing = path.join(os.tmpdir(), `settings-absent-${process.pid}-${Date.now()}.json`);
  assert.doesNotThrow(() => ensureSecurePermissions(missing));
  assert.equal(fs.existsSync(missing), false);
});
