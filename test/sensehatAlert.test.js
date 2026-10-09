// Regression tests for the `alert` field of GET /api/sensehat
// (server/sensehatCtrl.js → _buildAlertField).
//
// History (2026-10-08 docs audit): the controller built the field with
// `event: top.event`, but the normalised gov alerts produced by
// govAlertSources/nws.js and eccc.js have no `event` property — they carry
// `eventType` + `title_en` / `title_fr`. So `alert.event` was always
// undefined, JSON.stringify dropped it, and the LED daemons
// (tools/sensehat_weather.py, tools/horloge.py) logged "event=None" for
// every alert while docs/api.md promised e.g. "Tornado Warning".
//
// The alerts here go through each source's REAL normaliser (NWS directly
// via its __test export, ECCC via fetchAllNormalized over a stubbed feed),
// so a future rename of the normalised fields breaks this test instead of
// silently blanking the field again.

const { test, mock } = require("node:test");
const assert = require("node:assert/strict");

const axios = require("axios").default;

const { __test: nwsTest } = require("../server/govAlertSources/nws");
const eccc = require("../server/govAlertSources/eccc");
const { __test: senseTest } = require("../server/sensehatCtrl");

const { _buildAlertField } = senseTest;

// Montréal — inside the ECCC coverage bbox.
const LAT = 45.5017;
const LON = -73.5673;

/**
 * Minimal NWS /alerts/active feature.
 * @param {Object} props properties overriding the Tornado Warning defaults
 * @returns {Object} GeoJSON feature
 */
const nwsFeature = (props) => ({
  id: "urn:oid:nws.fixture",
  geometry: null,
  properties: { event: "Tornado Warning", severity: "Extreme", status: "Actual", ...props },
});

/**
 * Normalise one ECCC pygeoapi feature through the real feed path.
 * @param {Object} props feature properties
 * @returns {Promise<Object>} the normalised alert
 */
async function normalizeEccc(props) {
  const feed = {
    data: {
      features: [{
        id: "urn:oid:eccc.fixture",
        properties: props,
        geometry: {
          type: "Polygon",
          coordinates: [[[-74.5, 45.0], [-72.5, 45.0], [-72.5, 46.0], [-74.5, 46.0], [-74.5, 45.0]]],
        },
      }],
    },
  };
  const getMock = mock.method(axios, "get", async () => feed);
  try {
    eccc.__test._resetFeedCache();
    const [alert] = await eccc.fetchAllNormalized(LAT, LON);
    return alert;
  } finally {
    getMock.mock.restore();
    eccc.__test._resetFeedCache();
  }
}

test("NWS alert: event is the CAP event name and survives JSON serialisation", () => {
  const field = _buildAlertField([nwsTest.normalize(nwsFeature({}))]);
  assert.deepEqual(field, {
    tier: "red",
    severity: "extreme",
    source: "NWS",
    event: "Tornado Warning",
  });
  // The bug shape: an undefined `event` is silently dropped by res.json().
  assert.equal(JSON.parse(JSON.stringify(field)).event, "Tornado Warning");
});

// Property values mirror a live ECCC rainfall warning (2026-10-08): the
// upstream `alert_code` is a terse code ("RFW"; "SFW" snowfall, "SPS"
// special weather statement), not a readable name.
test("ECCC alert: event is the English alert name, not the alert_code", async () => {
  const alert = await normalizeEccc({
    alert_code: "RFW",
    alert_type: "warning",
    alert_name_en: "rainfall warning",
    alert_name_fr: "avertissement de pluie",
    alert_short_name_en: "Rainfall",
    alert_short_name_fr: "Pluie",
    impact_en: "Moderate",
    alert_text_en: "What: an additional 5 to 10 millimetres of rain.",
    alert_text_fr: "Quoi : pluie supplémentaire de 5 à 10 millimètres.",
    province: "QC",
  });
  assert.ok(alert, "the fixture normalises");
  assert.equal(alert.eventType, "RFW", "eventType stays the raw code");
  assert.deepEqual(_buildAlertField([alert]), {
    tier: "orange",
    severity: "moderate",
    source: "ECCC",
    event: "Rainfall warning",
  });
});

test("the first red/orange alert wins; yellow advisories are skipped", () => {
  const yellow = nwsTest.normalize(nwsFeature({ event: "Wind Advisory", severity: "Minor" }));
  const orange = nwsTest.normalize(nwsFeature({ event: "Winter Storm Warning", severity: "Moderate" }));
  assert.equal(yellow.tier, "yellow");
  assert.equal(orange.tier, "orange");
  assert.equal(_buildAlertField([yellow, orange]).event, "Winter Storm Warning");
  assert.equal(_buildAlertField([yellow]), undefined, "below the override threshold → no field");
  assert.equal(_buildAlertField([]), undefined);
});

test("event falls back to eventType when an alert has no English title", () => {
  const field = _buildAlertField([{ tier: "orange", severity: "moderate", source: "ECCC", eventType: "RFW" }]);
  assert.equal(field.event, "RFW");
});
