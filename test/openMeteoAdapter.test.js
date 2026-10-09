// Unit-contract tests for the Open-Meteo PoC adapter
// (server/openMeteoCtrl.js, GET /api/weather/openmeteo).
//
// History (2026-10 audit): the adapter requested wind without
// `wind_speed_unit`, so Open-Meteo answered in its default km/h while
// the Tomorrow.io envelope it imitates (and every consumer: client
// `services/conversions.js`, `aiSummaryCtrl`) is in m/s. `windSpeed`
// came back 3.6× too high, and tools/compare-weather.js compared the
// two raw numbers as if they shared a unit. These tests pin the fix:
// the upstream URL asks for m/s, and the adapters pass the value
// through unchanged (no second ÷3.6 on top of the upstream one).
//
// Same class of bug, found in review: `current.precipitation` is the
// mm that fell over the preceding `current.interval` seconds (900 =
// 15 min), but it was served as `precipitationIntensity`, which is
// mm/h in the Tomorrow.io envelope — about 4× too low. The adapter now
// scales it by 3600 / interval; the hourly block (a 1 h sum) is left
// as is.
//
// Run: `npm test` (Node's built-in `node --test` runner, no deps).

const { test, mock } = require("node:test");
const assert = require("node:assert/strict");

const axios = require("axios").default;

const { getOpenMeteoWeather, __test } = require("../server/openMeteoCtrl");
const { buildForecastUrl, precipitationRatePerHour, adaptCurrent, adaptHourly, adaptDaily } = __test;

// Open-Meteo's `current.interval` today: values are 15-minutely.
const CURRENT_INTERVAL_SEC = 900;

// Montréal — the default coordinates of tools/compare-weather.js.
const LAT = 45.5;
const LON = -73.6;

/**
 * Parse the query string of the URL the adapter would send upstream.
 *
 * @param {string} tz Timezone argument
 * @returns {URLSearchParams} Its search params
 */
function upstreamParams(tz = "auto") {
  return new URL(buildForecastUrl(LAT, LON, tz)).searchParams;
}

/**
 * Minimal Express response double that records status + JSON body.
 *
 * @returns {{status: Function, json: Function, end: Function, statusCode: number, body: *}} The double
 */
function fakeRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) { res.statusCode = code; return res; },
    json(body) { res.body = body; return res; },
    end() { return res; },
  };
  return res;
}

// ───────────────────────────────────────────────────────────────────────
// buildForecastUrl — the unit contract sent upstream
// ───────────────────────────────────────────────────────────────────────

test("buildForecastUrl: requests wind in m/s, exactly once", () => {
  const params = upstreamParams();
  assert.deepEqual(params.getAll("wind_speed_unit"), ["ms"],
    "Open-Meteo defaults to km/h; the Tomorrow.io envelope is m/s");
});

test("buildForecastUrl: pins temperature (°C) and precipitation (mm) explicitly", () => {
  const params = upstreamParams();
  assert.equal(params.get("temperature_unit"), "celsius");
  // mm is also what keeps snowfall_sum in cm, which adaptDaily ×10s.
  assert.equal(params.get("precipitation_unit"), "mm");
});

test("buildForecastUrl: every block that carries wind is covered by the one unit param", () => {
  // The unit param is global to the request, so it applies to current
  // AND hourly — guard that both still ask for wind_speed_10m and
  // the param isn't silently dropped by a future rewrite of the URL.
  const params = upstreamParams();
  assert.ok(params.get("current").split(",").includes("wind_speed_10m"));
  assert.ok(params.get("hourly").split(",").includes("wind_speed_10m"));
});

test("buildForecastUrl: keeps location, timezone and forecast length", () => {
  const params = upstreamParams("America/Toronto");
  assert.equal(params.get("latitude"), String(LAT));
  assert.equal(params.get("longitude"), String(LON));
  assert.equal(params.get("timezone"), "America/Toronto");
  assert.equal(params.get("forecast_days"), "5");
});

// ───────────────────────────────────────────────────────────────────────
// Adapters — values pass through untouched (no double conversion)
// ───────────────────────────────────────────────────────────────────────

test("adaptCurrent: windSpeed is the upstream m/s value, unconverted", () => {
  const env = adaptCurrent({ time: "2026-10-09T04:30", wind_speed_10m: 3.02 });
  assert.equal(env.data.timelines[0].intervals[0].values.windSpeed, 3.02);
});

test("adaptHourly: windSpeed is the upstream m/s value, unconverted", () => {
  const env = adaptHourly({
    time: ["2026-10-09T04:00", "2026-10-09T05:00"],
    wind_speed_10m: [1.5, 4.25],
  });
  const speeds = env.data.timelines[0].intervals.map((iv) => iv.values.windSpeed);
  assert.deepEqual(speeds, [1.5, 4.25]);
});

// ───────────────────────────────────────────────────────────────────────
// Precipitation — current is a per-interval amount, the envelope a rate
// ───────────────────────────────────────────────────────────────────────

test("precipitationRatePerHour: scales a per-interval amount to mm/h", () => {
  assert.equal(precipitationRatePerHour(0.1, CURRENT_INTERVAL_SEC), 0.4);
  assert.equal(precipitationRatePerHour(1.5, CURRENT_INTERVAL_SEC), 6);
  assert.equal(precipitationRatePerHour(2, 3600), 2, "a 1 h sum already reads as mm/h");
  assert.equal(precipitationRatePerHour(0, CURRENT_INTERVAL_SEC), 0, "dry stays 0, not null");
});

test("precipitationRatePerHour: null when the amount or the interval is unusable", () => {
  assert.equal(precipitationRatePerHour(null, CURRENT_INTERVAL_SEC), null);
  assert.equal(precipitationRatePerHour(undefined, CURRENT_INTERVAL_SEC), null);
  assert.equal(precipitationRatePerHour(0.3, undefined), null,
    "without the interval a raw amount must not masquerade as mm/h");
  assert.equal(precipitationRatePerHour(0.3, 0), null);
  assert.equal(precipitationRatePerHour(0.3, -900), null);
  assert.equal(precipitationRatePerHour(Number.NaN, CURRENT_INTERVAL_SEC), null);
});

test("adaptCurrent: precipitationIntensity is mm/h, not the raw 15-min amount", () => {
  const env = adaptCurrent({ time: "2026-10-09T04:30", interval: CURRENT_INTERVAL_SEC, precipitation: 0.3 });
  assert.equal(env.data.timelines[0].intervals[0].values.precipitationIntensity, 1.2);
});

test("adaptHourly: precipitationIntensity passes the 1 h sum through as mm/h", () => {
  const env = adaptHourly({ time: ["2026-10-09T04:00"], precipitation: [0.7] });
  assert.equal(env.data.timelines[0].intervals[0].values.precipitationIntensity, 0.7);
});

test("adaptDaily: snowfall cm → mm ×10; wind stays unmapped", () => {
  const env = adaptDaily({ time: ["2026-10-09"], snowfall_sum: [1.2] }, null);
  const { values } = env.data.timelines[0].intervals[0];
  assert.equal(values.snowAccumulation, 12);
  assert.equal(values.windSpeed, null);
});

// ───────────────────────────────────────────────────────────────────────
// Handler end to end — the URL actually sent, and the envelope served
// ───────────────────────────────────────────────────────────────────────

test("GET /api/weather/openmeteo: asks upstream for m/s and serves it as-is", async () => {
  const upstream = {
    current_units: { interval: "seconds", wind_speed_10m: "m/s", precipitation: "mm" },
    current: {
      time: "2026-10-09T04:30", interval: CURRENT_INTERVAL_SEC,
      wind_speed_10m: 3.02, precipitation: 0.1, weather_code: 3,
    },
    hourly: { time: ["2026-10-09T04:00"], wind_speed_10m: [2.8], weather_code: [3] },
    daily: { time: ["2026-10-09"], weather_code: [3] },
  };
  const getMock = mock.method(axios, "get", async () => ({ data: upstream }));
  try {
    const res = fakeRes();
    await getOpenMeteoWeather({ query: { lat: String(LAT), lon: String(LON) } }, res);

    assert.equal(getMock.mock.calls.length, 1);
    const [url, config] = getMock.mock.calls[0].arguments;
    assert.equal(new URL(url).searchParams.get("wind_speed_unit"), "ms");
    assert.equal(config.timeout, 10_000, "outbound calls keep the 10 s timeout");

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.current.data.timelines[0].intervals[0].values.windSpeed, 3.02);
    assert.equal(res.body.hourly.data.timelines[0].intervals[0].values.windSpeed, 2.8);
    assert.equal(res.body.current.data.timelines[0].intervals[0].values.precipitationIntensity, 0.4,
      "0.1 mm over 15 min is served as 0.4 mm/h");
    assert.equal(res.body._raw.current.precipitation, 0.1, "_raw stays unaltered");
  } finally {
    getMock.mock.restore();
  }
});
