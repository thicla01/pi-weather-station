// Regression tests for the auto-select forecast-tab router in
// `client/src/ui/autoTabSelector.js`.
//
// Unlike the parser tests (which re-implement client ESM verbatim), this
// module is authored as CommonJS specifically so these tests exercise the
// REAL code — the empirical thresholds (gust 25 m/s, precip 70 %, …) and
// the gating logic must not silently drift, exactly like the server-side
// radar-trend suite. Run: `npm test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const A = require("../client/src/ui/autoTabSelector");
const {
  selectAutoTab,
  hazardTab,
  classifyAlertTab,
  summarizeForecast,
  firstNewSevereAlert,
  alertKey,
  TABS,
  HOLD_MS,
  DWELL_MS,
  CARD_ACTIVE_MS,
} = A;

const NOW = 1_700_000_000_000; // fixed epoch ms — pure, no Date.now()

// ── helpers ────────────────────────────────────────────────────────────
const govAlert = (over = {}) => ({
  source: "NWS",
  id: "id-1",
  severity: "severe",
  tier: "red",
  eventType: "Wind Warning",
  title_en: "Wind Warning",
  expiresAt: "2026-06-14T23:00:00Z",
  ...over,
});

const env = (over = {}) => ({
  autoSelectEnabled: true,
  touchCapable: true,
  lastCardActivityAt: null, // no recent forecast-card interaction → not inhibited
  nightQuiet: false,
  ...over,
});

const baseState = (over = {}) => ({
  currentTab: TABS.GRID,
  manualHoldAt: null,
  lastAutoSwitchAt: null,
  knownSevereAlertKeys: [],
  ...over,
});

// ───────────────────────── classifyAlertTab ────────────────────────────
test("classifyAlertTab: NWS English event names", () => {
  const t = (eventType) => classifyAlertTab({ title_en: eventType, eventType });
  assert.equal(t("Wind Warning"), TABS.WIND);
  assert.equal(t("High Wind Warning"), TABS.WIND);
  assert.equal(t("Severe Thunderstorm Warning"), TABS.PRECIP);
  assert.equal(t("Tornado Warning"), TABS.PRECIP);
  assert.equal(t("Flash Flood Warning"), TABS.PRECIP);
  assert.equal(t("Winter Storm Warning"), TABS.PRECIP);
  assert.equal(t("Excessive Heat Warning"), TABS.TEMP);
  assert.equal(t("Extreme Cold Warning"), TABS.TEMP);
  assert.equal(t("Frost Advisory"), TABS.TEMP);
  // wind CHILL is a temperature event — must beat the bare "wind" keyword
  assert.equal(t("Wind Chill Warning"), TABS.TEMP);
  // genuinely metric-less → null (no guess)
  assert.equal(t("Dense Fog Advisory"), null);
  assert.equal(t("Special Weather Statement"), null);
});

test("classifyAlertTab: ECCC slug + English name (both match)", () => {
  // ECCC: title_en is the English name, eventType is the alert_code slug.
  const ec = (alert_code, name) => classifyAlertTab({ title_en: name, eventType: alert_code });
  assert.equal(ec("heat", "Heat warning"), TABS.TEMP); // the live fixture pair
  assert.equal(ec("wind", "Wind warning"), TABS.WIND);
  assert.equal(ec("rainfall", "Rainfall warning"), TABS.PRECIP);
  assert.equal(ec("snowfall", "Snowfall warning"), TABS.PRECIP);
  assert.equal(ec("snowsquall", "Snow squall warning"), TABS.PRECIP);
  assert.equal(ec("blowingsnow", "Blowing snow advisory"), TABS.PRECIP);
  // "freezing rain" must be Precip, NOT Temp (the order-matters case)
  assert.equal(ec("freezingrain", "Freezing rain warning"), TABS.PRECIP);
  assert.equal(ec("extremecold", "Extreme cold warning"), TABS.TEMP);
  assert.equal(ec("arcticoutflow", "Arctic outflow warning"), TABS.TEMP);
  assert.equal(ec("fog", "Fog advisory"), null);
});

test("classifyAlertTab: null / empty → null", () => {
  assert.equal(classifyAlertTab(null), null);
  assert.equal(classifyAlertTab({}), null);
});

// ───────────────────────── opt-in / calm ───────────────────────────────
test("opt-out: autoSelectEnabled=false → always null", () => {
  const r = selectAutoTab(
    { govAlerts: [govAlert()], env: env({ autoSelectEnabled: false }) },
    baseState(),
    NOW,
  );
  assert.equal(r, null);
});

test("calm: no signals → null (keep the user's tab)", () => {
  const r = selectAutoTab({ govAlerts: [], env: env() }, baseState(), NOW);
  assert.equal(r, null);
});

// ───────────────────────── gov-alert class ─────────────────────────────
test("active red gov wind alert → wind, badge = source", () => {
  const r = selectAutoTab({ govAlerts: [govAlert()], env: env() }, baseState(), NOW);
  assert.equal(r.tab, TABS.WIND);
  assert.equal(r.sourceBadge, "NWS");
});

test("gov alert maps to the tab already shown → null (no needless switch)", () => {
  const r = selectAutoTab(
    { govAlerts: [govAlert()], env: env() },
    baseState({ currentTab: TABS.WIND }),
    NOW,
  );
  assert.equal(r, null);
});

test("red/orange but unmappable event (fog) → falls through to calm → null", () => {
  const fog = govAlert({ eventType: "Fog Advisory", title_en: "Dense Fog Advisory", severity: "moderate", tier: "orange" });
  const r = selectAutoTab({ govAlerts: [fog], env: env() }, baseState(), NOW);
  assert.equal(r, null);
});

// ───────────────────────── gating ──────────────────────────────────────
// Non-severe (orange) alert so the new-severe puncture doesn't fire — we're
// isolating a gate, which a severe alert would (correctly) override.
const orangeWind = govAlert({ severity: "moderate", tier: "orange" });

test("B2: recent forecast-card activity on a TOUCH device → inhibited", () => {
  const r = selectAutoTab(
    { govAlerts: [orangeWind], env: env({ touchCapable: true, lastCardActivityAt: NOW - 10_000 }) },
    baseState(),
    NOW,
  );
  assert.equal(r, null); // reading/scrolling the card → don't switch under them
});

test("B2: recent card activity on a NON-touch display → NOT inhibited (stable case, §6.1)", () => {
  const r = selectAutoTab(
    { govAlerts: [orangeWind], env: env({ touchCapable: false, lastCardActivityAt: NOW - 10_000 }) },
    baseState(),
    NOW,
  );
  assert.equal(r.tab, TABS.WIND); // no reader to protect on a non-touch monitor
});

test("B2: STALE card activity (> CARD_ACTIVE_MS) on touch → NOT inhibited", () => {
  const r = selectAutoTab(
    { govAlerts: [orangeWind], env: env({ touchCapable: true, lastCardActivityAt: NOW - (CARD_ACTIVE_MS + 1000) }) },
    baseState(),
    NOW,
  );
  assert.equal(r.tab, TABS.WIND); // grace expired → free to switch
});

test("manual hold active → forecast/gov suppressed", () => {
  const r = selectAutoTab(
    { govAlerts: [govAlert({ severity: "moderate", tier: "orange" })], env: env() },
    baseState({ manualHoldAt: NOW - (HOLD_MS - 1000) }), // still within hold
    NOW,
  );
  assert.equal(r, null);
});

test("manual hold expired → switching resumes", () => {
  const r = selectAutoTab(
    { govAlerts: [govAlert({ severity: "moderate", tier: "orange" })], env: env() },
    baseState({ manualHoldAt: NOW - (HOLD_MS + 1000) }),
    NOW,
  );
  assert.equal(r.tab, TABS.WIND);
});

test("min dwell active → suppressed", () => {
  const r = selectAutoTab(
    { govAlerts: [govAlert({ severity: "moderate", tier: "orange" })], env: env() },
    baseState({ lastAutoSwitchAt: NOW - (DWELL_MS - 1000) }),
    NOW,
  );
  assert.equal(r, null);
});

test("night quiet → forecast suppressed", () => {
  const r = selectAutoTab(
    {
      forecast: { maxPrecipProb: 90 },
      env: env({ nightQuiet: true }),
    },
    baseState(),
    NOW,
  );
  assert.equal(r, null);
});

// ───────────────────────── severe-alert puncture ───────────────────────
test("NEW severe alert punctures an active manual hold", () => {
  const r = selectAutoTab(
    { govAlerts: [govAlert({ id: "new-1", severity: "extreme", eventType: "Tornado Warning", title_en: "Tornado Warning" })], env: env() },
    baseState({ manualHoldAt: NOW - 1000, knownSevereAlertKeys: [] }),
    NOW,
  );
  assert.equal(r.tab, TABS.PRECIP); // tornado → precip, despite the hold
  assert.equal(r.reason.puncture, true);
});

test("ALREADY-KNOWN severe alert does NOT puncture the hold", () => {
  const known = alertKey(govAlert({ id: "known-1", severity: "extreme" }));
  const r = selectAutoTab(
    { govAlerts: [govAlert({ id: "known-1", severity: "extreme", eventType: "Tornado Warning", title_en: "Tornado Warning" })], env: env() },
    baseState({ manualHoldAt: NOW - 1000, knownSevereAlertKeys: [known] }),
    NOW,
  );
  assert.equal(r, null); // hold respected — the warning isn't new
});

test("severe puncture overrides night quiet AND dwell too", () => {
  const r = selectAutoTab(
    { govAlerts: [govAlert({ id: "n2", severity: "severe", eventType: "Hurricane Warning", title_en: "Hurricane Warning" })], env: env({ nightQuiet: true }) },
    baseState({ lastAutoSwitchAt: NOW - 1000, knownSevereAlertKeys: [] }),
    NOW,
  );
  assert.equal(r.tab, TABS.WIND); // hurricane → wind
});

// ───────────────────────── radar class ─────────────────────────────────
test("radar mid/high confidence → precip; low → falls through", () => {
  const mid = selectAutoTab(
    { radarAlertState: { tier: "orange", confidenceBucket: "mid" }, env: env() },
    baseState(),
    NOW,
  );
  assert.equal(mid.tab, TABS.PRECIP);
  assert.equal(mid.sourceBadge, "RADAR");

  const low = selectAutoTab(
    { radarAlertState: { tier: "orange", confidenceBucket: "low" }, env: env() },
    baseState(),
    NOW,
  );
  assert.equal(low, null);
});

test("priority: gov alert beats radar nowcast", () => {
  const r = selectAutoTab(
    {
      govAlerts: [govAlert()], // wind, red
      radarAlertState: { tier: "red", confidenceBucket: "high" }, // would say precip
      env: env(),
    },
    baseState(),
    NOW,
  );
  assert.equal(r.tab, TABS.WIND); // gov wins
});

// ───────────────────────── A2: radar override (Phase 2) ────────────────
const orangeHeat = govAlert({ severity: "moderate", tier: "orange", eventType: "Heat Advisory", title_en: "Heat Advisory" });
const redRadarApproaching = { tier: "red", approaching: true, confidenceBucket: "high" };

test("A2: red + approaching + high-conf radar beats an ORANGE gov advisory → Precip", () => {
  const r = selectAutoTab(
    { govAlerts: [orangeHeat], radarAlertState: redRadarApproaching, env: env() },
    baseState(),
    NOW,
  );
  assert.equal(r.tab, TABS.PRECIP);
  assert.equal(r.sourceBadge, "RADAR"); // the imminent storm the warning hasn't caught yet
});

test("A2: a RED (severe/extreme) gov alert still beats the radar override", () => {
  // Already-known red gov so the puncture doesn't fire — this tests the ladder.
  const redWind = govAlert({ id: "rw", severity: "severe", tier: "red", eventType: "High Wind Warning", title_en: "High Wind Warning" });
  const r = selectAutoTab(
    { govAlerts: [redWind], radarAlertState: redRadarApproaching, env: env() },
    baseState({ knownSevereAlertKeys: [alertKey(redWind)] }),
    NOW,
  );
  assert.equal(r.tab, TABS.WIND);
  assert.equal(r.sourceBadge, "NWS"); // authoritative red alert wins outright
});

test("A2: the override needs BOTH approaching AND high confidence — else orange gov keeps the tab", () => {
  const notApproaching = selectAutoTab(
    { govAlerts: [orangeHeat], radarAlertState: { tier: "red", approaching: false, confidenceBucket: "high" }, env: env() },
    baseState(),
    NOW,
  );
  assert.equal(notApproaching.tab, TABS.TEMP);
  const midConf = selectAutoTab(
    { govAlerts: [orangeHeat], radarAlertState: { tier: "red", approaching: true, confidenceBucket: "mid" }, env: env() },
    baseState(),
    NOW,
  );
  assert.equal(midConf.tab, TABS.TEMP);
});

test("A2: an ORANGE radar (not red) never overrides an orange gov", () => {
  const r = selectAutoTab(
    { govAlerts: [orangeHeat], radarAlertState: { tier: "orange", approaching: true, confidenceBucket: "high" }, env: env() },
    baseState(),
    NOW,
  );
  assert.equal(r.tab, TABS.TEMP); // override is red-tier only; orange gov keeps it
});

// ───────────────────────── forecast class + hysteresis ─────────────────
test("forecast gust at exactly the ENTER band (25.0 m/s) → wind", () => {
  const r = selectAutoTab({ forecast: { maxGustMs: 25.0 }, env: env() }, baseState(), NOW);
  assert.equal(r.tab, TABS.WIND);
  assert.equal(r.sourceBadge, "FCST");
});

test("forecast precip prob hovering 68-72 % does NOT flap (hysteresis)", () => {
  // 72 % while on grid → enters precip
  const enter = selectAutoTab({ forecast: { maxPrecipProb: 72 }, env: env() }, baseState(), NOW);
  assert.equal(enter.tab, TABS.PRECIP);

  // 68 % while already on precip → stays (above EXIT band) → no switch (null)
  const stay = selectAutoTab(
    { forecast: { maxPrecipProb: 68 }, env: env() },
    baseState({ currentTab: TABS.PRECIP }),
    NOW,
  );
  assert.equal(stay, null);

  // 68 % while NOT on precip → below ENTER, does not fire
  const noFire = selectAutoTab({ forecast: { maxPrecipProb: 68 }, env: env() }, baseState(), NOW);
  assert.equal(noFire, null);
});

test("forecast hazardous code now (8000 thunder) → precip", () => {
  const r = selectAutoTab({ forecast: { currentWeatherCode: 8000 }, env: env() }, baseState(), NOW);
  assert.equal(r.tab, TABS.PRECIP);
});

test("forecast apparent-temp extremes → temp", () => {
  const hot = selectAutoTab({ forecast: { currentApparentC: 34 }, env: env() }, baseState(), NOW);
  assert.equal(hot.tab, TABS.TEMP);
  const cold = selectAutoTab({ forecast: { currentApparentC: -27 }, env: env() }, baseState(), NOW);
  assert.equal(cold.tab, TABS.TEMP);
  const mild = selectAutoTab({ forecast: { currentApparentC: 18 }, env: env() }, baseState(), NOW);
  assert.equal(mild, null);
});

// ───────────────────────── summarizeForecast ───────────────────────────
test("summarizeForecast: max over next 6 h, ignores beyond-window intervals", () => {
  const iso = (h) => new Date(NOW + h * 3600_000).toISOString();
  const hourly = [
    { startTime: iso(1), values: { windGust: 10, precipitationProbability: 30 } },
    { startTime: iso(3), values: { windGust: 26, precipitationProbability: 80 } }, // in window
    { startTime: iso(9), values: { windGust: 99, precipitationProbability: 99 } }, // beyond 6 h → ignored
  ];
  const current = { values: { weatherCode: 1000, temperatureApparent: 21 } };
  const fc = summarizeForecast(current, hourly, NOW);
  assert.equal(fc.maxGustMs, 26);
  assert.equal(fc.maxPrecipProb, 80);
  assert.equal(fc.currentWeatherCode, 1000);
  assert.equal(fc.currentApparentC, 21);
});

test("summarizeForecast: partial data → nulls, no crash", () => {
  const fc = summarizeForecast(null, [], NOW);
  assert.equal(fc.maxGustMs, null);
  assert.equal(fc.maxPrecipProb, null);
  assert.equal(fc.currentWeatherCode, null);
});

// ───────────────────────── hazardTab (chip lifetime) ───────────────────
test("hazardTab: ungated live verdict — gov/forecast/calm", () => {
  // gov wind alert → wind, badge = source (ungated: no env needed)
  const gov = hazardTab({ govAlerts: [govAlert()] }, TABS.GRID);
  assert.equal(gov.tab, TABS.WIND);
  assert.equal(gov.sourceBadge, "NWS");

  // forecast precip → precip, FCST
  const fcst = hazardTab({ forecast: { maxPrecipProb: 85 } }, TABS.GRID);
  assert.equal(fcst.tab, TABS.PRECIP);
  assert.equal(fcst.sourceBadge, "FCST");

  // calm → null (this is what clears the chip on a passive display)
  assert.equal(hazardTab({ govAlerts: [], forecast: {} }, TABS.GRID), null);
});

test("hazardTab: verdict is gate-independent (fires even when a switch would be held)", () => {
  // No env / no gates passed in — hazardTab reflects the weather only, so a
  // standing chip stays lit while a hazard persists even under a manual hold.
  const v = hazardTab({ forecast: { currentWeatherCode: 8000 } }, TABS.PRECIP);
  assert.equal(v.tab, TABS.PRECIP);
});

// ───────────────────────── firstNewSevereAlert ─────────────────────────
test("firstNewSevereAlert: composite key when id is null", () => {
  const a = govAlert({ id: null, severity: "extreme", eventType: "tornado", expiresAt: "X" });
  assert.equal(firstNewSevereAlert([a], []).eventType, "tornado");
  const known = alertKey(a);
  assert.equal(firstNewSevereAlert([a], [known]), null);
  // a non-severe alert is never "new severe"
  assert.equal(firstNewSevereAlert([govAlert({ severity: "moderate" })], []), null);
});
