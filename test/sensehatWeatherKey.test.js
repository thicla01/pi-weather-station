// Regression test for the shared weather-cache key contract between
// sensehatCtrl and proxyCtrl.
//
// History: proxyCtrl's cache keys gained a fieldsHash segment in 2026-05
// (`type:fieldsHash:lat:lon`). aiSummaryCtrl was migrated to build its
// keys through proxyCtrl's getCacheKey at the time, but sensehatCtrl
// kept a hand-rolled 3-segment `current:lat:lon` literal — so its reads
// of the shared cache missed FOREVER, and every /api/sensehat poll
// (60 s cadence from the LED daemon) fell back to an internal
// /api/weather/current call, silently burning Tomorrow.io quota
// (25 req/h free tier). Found by the 2026-06-10 quality audit.
//
// What we lock down here: sensehatCtrl resolves entries that proxyCtrl
// wrote under its canonical key. If the key schema evolves again, this
// test fails instead of the Sense HAT path silently regressing.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { weatherCache, getCacheKey, CURRENT_FIELDS_HASH } = require("../server/proxyCtrl");
const { __test: senseTest } = require("../server/sensehatCtrl");

test("sensehat reads current weather through proxyCtrl's canonical cache key", () => {
  const lat = 45.5017;
  const lon = -73.5673;
  const key = getCacheKey("current", CURRENT_FIELDS_HASH, lat, lon);
  const payload = { data: { timelines: [{ intervals: [{ values: { temperature: 21 } }] }] } };
  weatherCache[key] = { data: payload, expiresAt: Date.now() + 60_000 };
  try {
    assert.equal(senseTest._weatherFromCache(lat, lon), payload);
  } finally {
    delete weatherCache[key];
  }
});

test("expired shared-cache entries are not served to the Sense HAT path", () => {
  const lat = 46.8139;
  const lon = -71.2082;
  const key = getCacheKey("current", CURRENT_FIELDS_HASH, lat, lon);
  weatherCache[key] = { data: { stale: true }, expiresAt: Date.now() - 1 };
  try {
    assert.equal(senseTest._weatherFromCache(lat, lon), null);
  } finally {
    delete weatherCache[key];
  }
});

test("a legacy 3-segment key is NOT resolvable (the old bug shape)", () => {
  const lat = 48.4284;
  const lon = -68.5235;
  // Seed under the pre-2026-05 key shape; the controller must not find it.
  weatherCache[`current:${lat.toFixed(4)}:${lon.toFixed(4)}`] = {
    data: { legacy: true },
    expiresAt: Date.now() + 60_000,
  };
  try {
    assert.equal(senseTest._weatherFromCache(lat, lon), null);
  } finally {
    delete weatherCache[`current:${lat.toFixed(4)}:${lon.toFixed(4)}`];
  }
});
