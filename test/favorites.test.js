// Regression tests for the favorite-locations value sanitizer
// (design: docs/favorite-locations-design.md §5 Server — the sanitizer).
//
// Why this needs dedicated coverage, beyond the usual "validate your input":
//
//   1. Under React 19 the client's PropTypes no longer run at runtime
//      (CLAUDE.md, decision 2026-08) — no console warning will ever fire for a
//      malformed favorite. `sanitizeFavorites` is therefore the ONLY real
//      validation of this shape anywhere in the system. If it thins out,
//      nothing catches a bad entry.
//
//   2. The 4-decimal rounding is a load-bearing contract, not tidiness. The
//      weather proxy caches upstream responses under
//      `type:fieldsHash:lat(4dp):lon(4dp)` (proxyCtrl.getCacheKey), so frozen
//      rounded coordinates make a return visit to a favorite a cache hit
//      instead of three fresh Tomorrow.io calls — which matters on a fleet
//      where two Pis share a 25 req/h key. A refactor that drops the rounding
//      would be invisible in the UI and only show up as quota pressure weeks
//      later.
//
//   3. `favorites` membership in ALLOWED_KEYS is what stops a Settings-panel
//      save from wiping the list (the same class of bug that already bit
//      `advanced` and `indoorTemperature`).
//
// Helpers are reached through the controller's `__test` surface, same pattern
// as settingsCtrl.test.js / radarAnalyzerCtrl. The handler-level tests drive
// the real setSetting / replaceSettings against a temp settings.json, through
// the test-only `__test.setSettingsPathForTest` path seam.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const settingsCtrl = require("../server/settingsCtrl");

const { __test } = settingsCtrl;
const {
  sanitizeFavorites,
  sanitizeSettings,
  sanitizeValue,
  maskForRemote,
  round4,
  setSettingsPathForTest,
  MAX_FAVORITES,
  MAX_LABEL_LEN,
  FILE_MODE,
  ALLOWED_KEYS,
  API_KEY_FIELDS,
  REMOTE_HIDDEN_KEYS,
} = __test;

const valid = (over = {}) => ({ id: "f1", label: "Saint-Donat", lat: 46.3172, lon: -74.2205, ...over });

/**
 * Call an Express-style handler with a mock `res`; resolves once the handler
 * sends its response — on `.json()` or `.end()`, whichever comes first (in
 * Express `res.json()` sends by itself, so the suite must not depend on the
 * redundant `.end()` settingsCtrl chains after it). Same harness as
 * settingsCtrl.test.js.
 *
 * @param {Function} handler controller handler (req, res)
 * @param {Object} req mock request
 * @returns {Promise<{statusCode: number, body: *}>} the captured response
 */
function invokeHandler(handler, req) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: undefined,
      body: undefined,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; resolve(this); return this; },
      end() { resolve(this); return this; },
    };
    try {
      handler(req, res);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Run `fn` with the controller pointed at `settings.json` inside a fresh temp
 * dir (absent until something writes it); always restores the previous path
 * and removes the dir.
 *
 * @param {Function} fn async (target) => *
 * @returns {Promise<*>} whatever `fn` resolves to
 */
async function withTempSettings(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "favorites-handler-"));
  const target = path.join(dir, "settings.json");
  const previous = setSettingsPathForTest(target);
  try {
    return await fn(target);
  } finally {
    setSettingsPathForTest(previous);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const readDisk = (target) => JSON.parse(fs.readFileSync(target, "utf8"));

// === shape gate ===

test("sanitizeFavorites: non-array input collapses to an empty list", () => {
  for (const bad of [undefined, null, "nope", 42, true, { a: 1 }]) {
    assert.deepEqual(sanitizeFavorites(bad), [], `expected [] for ${JSON.stringify(bad)}`);
  }
});

test("sanitizeFavorites: non-object entries are dropped, valid siblings survive", () => {
  const out = sanitizeFavorites([null, "x", 7, [], valid()]);
  assert.equal(out.length, 1);
  assert.equal(out[0].label, "Saint-Donat");
});

test("sanitizeFavorites: rebuilds entries, so unknown properties cannot ride along", () => {
  const out = sanitizeFavorites([valid({ evil: "payload", __proto__: { polluted: true } })]);
  assert.deepEqual(Object.keys(out[0]).sort(), ["id", "label", "lat", "lon"]);
});

// === coordinates ===

test("sanitizeFavorites: drops non-finite or out-of-range coordinates", () => {
  const bad = [
    valid({ lat: NaN }), valid({ lat: Infinity }), valid({ lat: "abc" }),
    valid({ lat: 90.1 }), valid({ lat: -90.1 }),
    valid({ lon: 180.1 }), valid({ lon: -180.1 }),
    valid({ lat: undefined }), valid({ lon: null }),
  ];
  assert.deepEqual(sanitizeFavorites(bad), []);
});

test("sanitizeFavorites: keeps the exact range boundaries", () => {
  const out = sanitizeFavorites([
    valid({ id: "a", lat: 90, lon: 180 }),
    valid({ id: "b", lat: -90, lon: -180 }),
  ]);
  assert.equal(out.length, 2);
});

test("sanitizeFavorites: coerces numeric strings", () => {
  const out = sanitizeFavorites([valid({ lat: "46.3172", lon: "-74.2205" })]);
  assert.equal(out[0].lat, 46.3172);
  assert.equal(out[0].lon, -74.2205);
});

// === the cache contract ===

test("round4: rounds to 4 decimals", () => {
  assert.equal(round4(46.31728394), 46.3173);
  assert.equal(round4(-74.22051), -74.2205);
  assert.equal(round4(0), 0);
});

test("sanitizeFavorites: coordinates are rounded to 4 decimals (proxy cache-key contract)", () => {
  const out = sanitizeFavorites([valid({ lat: 46.317283941, lon: -74.220512345 })]);
  assert.equal(out[0].lat, 46.3173);
  assert.equal(out[0].lon, -74.2205);
  // The contract that matters: two pins of "the same place" at sub-metre
  // jitter must land on ONE cache key, not two.
  const a = sanitizeFavorites([valid({ lat: 46.31730001, lon: -74.22050001 })])[0];
  const b = sanitizeFavorites([valid({ lat: 46.31729998, lon: -74.22049998 })])[0];
  assert.equal(a.lat, b.lat);
  assert.equal(a.lon, b.lon);
});

// === label ===

test("sanitizeFavorites: drops entries with an empty or non-string label", () => {
  const bad = [
    valid({ label: "" }), valid({ label: "   " }), valid({ label: null }),
    valid({ label: 42 }), valid({ label: undefined }), valid({ label: ["x"] }),
  ];
  assert.deepEqual(sanitizeFavorites(bad), []);
});

test("sanitizeFavorites: trims the label and truncates it at MAX_LABEL_LEN", () => {
  const out = sanitizeFavorites([valid({ label: `  ${"x".repeat(80)}  ` })]);
  assert.equal(out[0].label.length, MAX_LABEL_LEN);
  const trimmed = sanitizeFavorites([valid({ label: "  Chalet  " })]);
  assert.equal(trimmed[0].label, "Chalet");
});

// === id ===

test("sanitizeFavorites: synthesises an id when one is missing, and caps its length", () => {
  const out = sanitizeFavorites([valid({ id: undefined }), valid({ id: "" }), valid({ id: "z".repeat(200) })]);
  assert.equal(out[0].id, "fav_0");
  assert.equal(out[1].id, "fav_1");
  assert.equal(out[2].id.length, 64);
});

// === cap ===

test("sanitizeFavorites: truncates at MAX_FAVORITES, preserving order", () => {
  const many = Array.from({ length: MAX_FAVORITES + 4 }, (_, i) =>
    valid({ id: `f${i}`, label: `Place ${i}` }));
  const out = sanitizeFavorites(many);
  assert.equal(out.length, MAX_FAVORITES);
  assert.deepEqual(out.map((f) => f.id), many.slice(0, MAX_FAVORITES).map((f) => f.id));
});

test("MAX_FAVORITES is the 7-row budget, not the 6-place UX cap", () => {
  // The server bounds the resource; the client applies the finer rule (6
  // ordinary places, 7 when one of them is the home location, so the Places
  // popover never renders an 8th row). Pinning that down here because the two
  // numbers are deliberately different and a future "align them" cleanup
  // would silently re-charge users a slot for pinning their own home.
  assert.equal(MAX_FAVORITES, 7);
});

test("sanitizeFavorites: the cap counts VALID entries, not raw input rows", () => {
  // A run of junk at the head must not consume the budget — otherwise a
  // corrupted file could silently hide the user's real favorites.
  const input = [
    null, valid({ label: "" }), "junk",
    ...Array.from({ length: MAX_FAVORITES }, (_, i) => valid({ id: `k${i}` })),
  ];
  assert.equal(sanitizeFavorites(input).length, MAX_FAVORITES);
});

// === zoom is NOT part of the schema ===

test("sanitizeFavorites: a stored zoom is dropped, whatever its value", () => {
  // The schema carried an optional `zoom` in 3.2.x, until selecting a
  // favorite was changed to leave the user's zoom alone (restoring the
  // pin-time zoom fought the user, and setting zoom right after a pan
  // drifted the marker on rail-overlay layouts). Entries pinned during that
  // window still carry the field on disk; the rebuild drops it on the next
  // write, so no migration is needed. This test is the guard against
  // re-introducing it by accident.
  for (const z of [9, 1, 18, "9", 0, 19, 9.5, null, true]) {
    assert.ok(
      !("zoom" in sanitizeFavorites([valid({ zoom: z })])[0]),
      `expected zoom ${JSON.stringify(z)} to be dropped`
    );
  }
});

// === integration with the settings whitelist ===

test("sanitizeValue: coerces registered keys and passes everything else through", () => {
  // This is the seam PATCH /setting uses. `setSetting` writes a single value
  // and never calls sanitizeSettings, so testing only the whole-object path
  // leaves the single most-used write path unguarded — which is exactly how
  // the first cut of this feature shipped a PATCH that persisted `"garbage"`
  // verbatim under `favorites`. Found by an end-to-end curl, not by a unit
  // test of the pure helper (the handler-level tests below now cover it).
  assert.deepEqual(sanitizeValue("favorites", "garbage"), []);
  assert.equal(sanitizeValue("favorites", [valid()]).length, 1);
  // Keys with no registered sanitizer must be untouched — `advanced` and
  // `indoorTemperature` are deliberately opaque.
  const advanced = { ai: { extendedRadius: true } };
  assert.equal(sanitizeValue("advanced", advanced), advanced);
  assert.equal(sanitizeValue("startingLat", "45.5"), "45.5");
});

// === INV-2 at the handler level: PATCH /setting, both branches ===
// The pure-helper test above proves sanitizeValue coerces; these prove
// setSetting actually CALLS it on each branch. The create branch is the one
// that slipped: it wrote `{ [key]: val }` raw, so a PATCH of `favorites` on a
// kiosk with no settings.json yet stored the payload verbatim.

test("PATCH /setting creating settings.json: a garbage favorites value is stored as [], not verbatim", async () => {
  await withTempSettings(async (target) => {
    const res = await invokeHandler(settingsCtrl.setSetting, { body: { key: "favorites", val: "garbage" } });
    assert.equal(res.statusCode, 201);
    assert.deepEqual(res.body, { favorites: [] });
    assert.deepEqual(readDisk(target), { favorites: [] });
  });
});

test("PATCH /setting creating settings.json: entries are rebuilt, rounded and capped", async () => {
  await withTempSettings(async (target) => {
    const many = Array.from({ length: MAX_FAVORITES + 2 }, (_, i) =>
      valid({ id: `f${i}`, label: `Place ${i}`, lat: 46.317283941, zoom: 9 }));
    const res = await invokeHandler(settingsCtrl.setSetting, { body: { key: "favorites", val: many } });
    assert.equal(res.statusCode, 201);
    const stored = readDisk(target).favorites;
    assert.equal(stored.length, MAX_FAVORITES);
    for (const f of stored) {
      assert.deepEqual(Object.keys(f).sort(), ["id", "label", "lat", "lon"]);
      assert.equal(f.lat, 46.3173);
    }
  });
});

test("PATCH /setting on an existing settings.json: favorites are sanitized and other keys kept", async () => {
  await withTempSettings(async (target) => {
    fs.writeFileSync(target, JSON.stringify({ weatherApiKey: "k" }), { mode: FILE_MODE });
    const res = await invokeHandler(settingsCtrl.setSetting, {
      body: { key: "favorites", val: [valid({ evil: 1 }), { label: "" }] },
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(readDisk(target), {
      weatherApiKey: "k",
      favorites: [{ id: "f1", label: "Saint-Donat", lat: 46.3172, lon: -74.2205 }],
    });
  });
});

test("sanitizeSettings: runs the favorites sanitizer (POST / PUT path)", () => {
  const out = sanitizeSettings({ favorites: [valid({ lat: 46.317283941 }), { label: "" }] });
  assert.equal(out.favorites.length, 1);
  assert.equal(out.favorites[0].lat, 46.3173);
});

test("sanitizeSettings: a garbage favorites value degrades to [] instead of passing through", () => {
  assert.deepEqual(sanitizeSettings({ favorites: "pwned" }).favorites, []);
});

test("sanitizeSettings: leaves the opaque sub-objects untouched", () => {
  // `advanced` and `indoorTemperature` are deliberately NOT in
  // VALUE_SANITIZERS — adding a sanitizer for them is a separate decision.
  const advanced = { ai: { extendedRadius: true }, sensehat: { mode: "clock" } };
  assert.deepEqual(sanitizeSettings({ advanced }).advanced, advanced);
});

test("maskForRemote: favorites reach remote clients (Q2 decision, pinned)", () => {
  // Deliberate: the list is readable over the SSH tunnel and from a LAN
  // client, matching the exposure startingLat/startingLon already have.
  // Flipping this is a policy change, not a refactor — if `favorites` is ever
  // added to REMOTE_HIDDEN_KEYS, this test must be updated on purpose.
  const masked = maskForRemote({ favorites: [valid()], weatherApiKey: "secret" });
  assert.equal(masked.favorites.length, 1);
  assert.equal(masked.favorites[0].label, "Saint-Donat");
  assert.equal(masked.weatherApiKey, true, "API keys stay masked to booleans");
  assert.ok(!API_KEY_FIELDS.has("favorites"));
  assert.ok(!REMOTE_HIDDEN_KEYS.has("favorites"));
});

test("ALLOWED_KEYS contains favorites — this is what stops a Settings save from wiping it", () => {
  // replaceSettings (PUT /settings) preserves every top-level key that is BOTH
  // in ALLOWED_KEYS and absent from the request body. The v3 Settings panel
  // sends only API keys + lat/lon, so this single membership is the whole
  // anti-wipe guarantee — the same one `advanced` and `indoorTemperature`
  // needed after they were silently clobbered. The next test checks the same
  // guarantee through the handler itself.
  assert.ok(ALLOWED_KEYS.has("favorites"));
});

test("PUT /settings (Settings-panel save) keeps a stored favorites list the body omits", async () => {
  await withTempSettings(async (target) => {
    const favorites = [{ id: "f1", label: "Saint-Donat", lat: 46.3172, lon: -74.2205 }];
    fs.writeFileSync(target, JSON.stringify({ weatherApiKey: "old", favorites }), { mode: FILE_MODE });
    const res = await invokeHandler(settingsCtrl.replaceSettings, {
      body: { weatherApiKey: "new", startingLat: "45.5", startingLon: "-73.5" },
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(readDisk(target), {
      weatherApiKey: "new", startingLat: "45.5", startingLon: "-73.5", favorites,
    });
  });
});
