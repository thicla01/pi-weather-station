// Regression tests for the eccc.alerts request-counter semantics and the
// national-feed cache (server/govAlertSources/eccc.js).
//
// History (2026-06-11, SenseHat Pi): the request counters showed eccc.alerts
// at 729 calls/day (~66/h — exactly the Sense HAT daemon's 60 s poll cadence)
// vs nws.alerts at 134/day, which read as "the ECCC path bypasses its cache
// and hammers the government feed once a minute". The 5-min feed cache was
// actually fine — real upstream traffic was already ~134/day, same as NWS.
// The bug was the COUNTER: increment("eccc", "alerts") sat in tryAlerts
// after the point-in-polygon scan, so it ticked once per invocation (every
// HAT/kiosk poll), not per upstream HTTP request — unlike NWS, which returns
// early on a cache hit, before its increment. These tests pin the contract:
// one upstream fetch per cache window, and one counter tick per FETCH, not
// per poll.
//
// node --test runs each file in its own process, so the module-level feed
// cache and in-memory counters start fresh here regardless of the rest of
// the suite.

const { test, mock } = require("node:test");
const assert = require("node:assert/strict");

const axios = require("axios").default;

const eccc = require("../server/govAlertSources/eccc");
const { getCounters } = require("../server/requestCounter");
const { getServiceStatus } = require("../server/serviceStatus");

// Montréal — inside CA_BBOX and inside the fixture polygon below.
const LAT = 45.5017;
const LON = -73.5673;

// Minimal ECCC pygeoapi feature: a heat warning whose polygon is a box
// around Montréal (GeoJSON [lon, lat] order).
const FEED_RESPONSE = {
  data: {
    features: [
      {
        id: "urn:oid:2.49.0.1.124.fixture",
        properties: {
          alert_code: "heat",
          alert_name_en: "Heat warning",
          alert_name_fr: "Avertissement de chaleur",
          impact_en: "Moderate",
          alert_text_en: "It is hot.",
          alert_text_fr: "Il fait chaud.",
          publication_datetime: "2026-06-11T12:00:00Z",
          expiration_datetime: "2026-06-12T12:00:00Z",
          province: "QC",
          feature_name_en: "Montréal",
        },
        geometry: {
          type: "Polygon",
          coordinates: [[[-74.5, 45.0], [-72.5, 45.0], [-72.5, 46.0], [-74.5, 46.0], [-74.5, 45.0]]],
        },
      },
    ],
  },
};

const ecccAlertsDay = () => getCounters().eccc?.endpoints?.alerts?.day || 0;

test("N polls within the TTL → one upstream fetch, one counter tick (the 729/day bug shape)", async () => {
  const getMock = mock.method(axios, "get", async () => FEED_RESPONSE);
  try {
    eccc.__test._resetFeedCache();
    const before = ecccAlertsDay();

    const first = await eccc.tryAlerts(LAT, LON);
    const second = await eccc.tryAlerts(LAT, LON);
    const third = await eccc.tryAlerts(LAT, LON);

    // The point-in-polygon matching still works through the cached feed.
    assert.equal(first.length, 1);
    assert.equal(first[0].source, "ECCC");
    assert.equal(first[0].title_fr, "Avertissement de chaleur");
    assert.deepEqual(second, first);
    assert.deepEqual(third, first);

    assert.equal(getMock.mock.calls.length, 1, "one upstream fetch per cache window");
    assert.equal(ecccAlertsDay(), before + 1, "the counter ticks per fetch, not per poll");
  } finally {
    getMock.mock.restore();
    eccc.__test._resetFeedCache();
  }
});

test("expired cache window → exactly one new fetch and one new tick", async () => {
  const getMock = mock.method(axios, "get", async () => FEED_RESPONSE);
  try {
    eccc.__test._resetFeedCache();
    const before = ecccAlertsDay();

    await eccc.tryAlerts(LAT, LON);
    eccc.__test._expireFeedCache();
    await eccc.tryAlerts(LAT, LON);
    await eccc.tryAlerts(LAT, LON); // back inside the fresh window

    assert.equal(getMock.mock.calls.length, 2, "expiry forces one refresh, then caching resumes");
    assert.equal(ecccAlertsDay(), before + 2);
  } finally {
    getMock.mock.restore();
    eccc.__test._resetFeedCache();
  }
});

test("concurrent polls on a cold cache share one in-flight upstream fetch", async () => {
  const getMock = mock.method(axios, "get", async () => {
    await new Promise((resolve) => setImmediate(resolve)); // yield so both callers land while in flight
    return FEED_RESPONSE;
  });
  try {
    eccc.__test._resetFeedCache();
    const before = ecccAlertsDay();

    const [a, b] = await Promise.all([
      eccc.tryAlerts(LAT, LON),
      eccc.tryAlerts(LAT, LON),
    ]);

    assert.equal(a.length, 1);
    assert.deepEqual(b, a);
    assert.equal(getMock.mock.calls.length, 1, "single-flight: no duplicate fetch race");
    assert.equal(ecccAlertsDay(), before + 1);
  } finally {
    getMock.mock.restore();
    eccc.__test._resetFeedCache();
  }
});

test("upstream failure → null result, no counter tick, failure recorded in serviceStatus", async () => {
  const getMock = mock.method(axios, "get", async () => {
    throw Object.assign(new Error("boom"), { response: { status: 503 } });
  });
  try {
    eccc.__test._resetFeedCache();
    const before = ecccAlertsDay();

    const result = await eccc.tryAlerts(LAT, LON);

    assert.equal(result, null, "null lets the orchestrator keep the previous list");
    assert.equal(ecccAlertsDay(), before, "failed fetches are never quota-counted (NWS convention)");
    assert.equal(getServiceStatus()[eccc.SERVICE_NAME].status, 503);
  } finally {
    getMock.mock.restore();
    eccc.__test._resetFeedCache();
  }
});

test("fetchAllNormalized reuses the warmed cache — no extra fetch, no extra tick", async () => {
  const getMock = mock.method(axios, "get", async () => FEED_RESPONSE);
  try {
    eccc.__test._resetFeedCache();
    const before = ecccAlertsDay();

    await eccc.tryAlerts(LAT, LON); // warms the feed cache (same grid cell)
    const all = await eccc.fetchAllNormalized(LAT, LON);

    assert.equal(all.length, 1);
    assert.equal(all[0].source, "ECCC");
    assert.equal(getMock.mock.calls.length, 1, "the nearby-alerts path shares the same feed window");
    assert.equal(ecccAlertsDay(), before + 1);
  } finally {
    getMock.mock.restore();
    eccc.__test._resetFeedCache();
  }
});

test("out-of-Canada point short-circuits before the feed and the counter", async () => {
  const getMock = mock.method(axios, "get", async () => FEED_RESPONSE);
  try {
    eccc.__test._resetFeedCache();
    const before = ecccAlertsDay();

    const result = await eccc.tryAlerts(29.45, -96.85); // Lavaca County, TX

    assert.deepEqual(result, []);
    assert.equal(getMock.mock.calls.length, 0, "no upstream traffic for out-of-coverage points");
    assert.equal(ecccAlertsDay(), before);
  } finally {
    getMock.mock.restore();
    eccc.__test._resetFeedCache();
  }
});
