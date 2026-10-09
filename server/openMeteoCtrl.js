// PoC adapter for Open-Meteo as a potential Tomorrow.io replacement.
// Single endpoint `GET /api/weather/openmeteo?lat&lon` returns
// current + hourly + daily in the same envelope shape as the
// Tomorrow.io proxy endpoints (`data.timelines[0].intervals[]`)
// so a client can compare both sources field-by-field via two
// parallel curl calls without normalising shapes itself.
//
// Open-Meteo specifics:
//   - No API key required; free tier 10k calls/day non-commercial.
//   - One request returns current+hourly+daily (vs Tomorrow.io's
//     three separate endpoints).
//   - Weather codes are WMO 0-99 (mapped here to the existing
//     Tomorrow.io-style codes via WMO_TO_TOMORROW_CODE so the
//     client's `parseWeatherCode` can render icons unchanged).
//   - Units must match the Tomorrow.io envelope, which is metric
//     because the proxy sends no `units` param: °C, wind in m/s,
//     precipitation in mm (mm/h for intensities), pressure in hPa.
//     Every consumer of that envelope assumes it (client
//     `services/conversions.js` converts FROM m/s; `aiSummaryCtrl`
//     formats m/s), so a swap-in must too. Open-Meteo's
//     own default wind unit is km/h, so the request pins every unit
//     explicitly — see OPEN_METEO_UNIT_PARAMS. Until 2026-10 it did
//     not, and `windSpeed` came back 3.6× too high.
//   - `current.precipitation` is a sum in mm over the preceding
//     `current.interval` seconds (900 = 15 min), not a rate, so the
//     adapter scales it to mm/h (Tomorrow.io's `precipitationIntensity`
//     unit) — see precipitationRatePerHour. Until 2026-10 it was passed
//     through raw, about 4× too low. `hourly.precipitation` is a 1 h
//     sum, so it already reads as mm/h.
//   - `snowfall_sum` is in cm even with `precipitation_unit=mm`
//     (Tomorrow.io: mm) — multiplied here for parity with
//     `rainAccumulation` units (mm).

const axios = require("axios");
const { recordServiceCall } = require("./serviceStatus");

const SERVICE_NAME = "Open-Meteo (PoC)";
const API_TIMEOUT_MS = 10_000;
const OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const FORECAST_DAYS = 5;
const SECONDS_PER_HOUR = 3600;

// Units requested from Open-Meteo, chosen to equal the Tomorrow.io
// envelope's. Only `wind_speed_unit` changes the payload (Open-Meteo
// defaults to km/h); the other two restate Open-Meteo's defaults so
// the whole unit contract sits in one place.
//
// Wind is converted upstream rather than ÷3.6 in the adapters because
// one parameter covers every wind variable in every block: current,
// hourly and daily, plus the gust variables (`wind_gusts_10m`,
// `wind_gusts_10m_max`) once they are mapped (they are km/h by
// default too). A per-field conversion would have to be remembered at
// each new mapping. It also keeps the `_raw` passthrough in the same
// units as the adapted envelope, so comparing the two for a spot-check
// shows no false 3.6× gap.
const OPEN_METEO_UNIT_PARAMS = Object.freeze({
  temperature_unit: "celsius",
  wind_speed_unit: "ms",
  // mm is also what keeps `snowfall_sum` in cm (the ×10 in
  // adaptDaily). With "inch", Open-Meteo returns snowfall in inches.
  precipitation_unit: "mm",
});

// WMO code → Tomorrow.io-style code used everywhere else in the
// codebase. Mapping is best-effort — WMO has ~30 codes vs
// Tomorrow.io's ~80, so we collapse to the closest semantic match.
// Anything unknown falls through to `1001` (cloudy) so the icon
// renderer doesn't draw a placeholder "?".
const WMO_TO_TOMORROW_CODE = {
  0:  1000, // clear sky → clear
  1:  1100, // mainly clear → mostly clear
  2:  1101, // partly cloudy
  3:  1001, // overcast → cloudy
  45: 2000, // fog
  48: 2000, // depositing rime fog → fog
  51: 4200, // drizzle light → light rain
  53: 4001, // drizzle moderate → rain
  55: 4201, // drizzle dense → heavy rain
  56: 6200, // light freezing drizzle → light freezing rain
  57: 6001, // freezing drizzle → freezing rain
  61: 4200, // rain slight → light rain
  63: 4001, // rain moderate
  65: 4201, // rain heavy
  66: 6200, // freezing rain light
  67: 6001, // freezing rain
  71: 5100, // snow slight → light snow
  73: 5000, // snow moderate
  75: 5101, // snow heavy
  77: 5001, // snow grains → flurries
  80: 4200, // rain showers slight → light rain
  81: 4001, // rain showers moderate
  82: 4201, // rain showers heavy
  85: 5100, // snow showers slight → light snow
  86: 5101, // snow showers heavy
  95: 8000, // thunderstorm → thunderstorm
  96: 8000, // thunderstorm with hail
  99: 8000, // thunderstorm with heavy hail
};

function mapWmoCode(wmo) {
  if (wmo == null) return null;
  return WMO_TO_TOMORROW_CODE[wmo] != null ? WMO_TO_TOMORROW_CODE[wmo] : 1001;
}

/**
 * Turn Open-Meteo's `current.precipitation` — the amount in mm that
 * fell over the preceding `current.interval` seconds (900 = 15 min) —
 * into a rate in mm/h, the unit of Tomorrow.io's
 * `precipitationIntensity`. A rate can't be derived without the
 * interval, so a missing or non-positive one yields null rather than
 * a raw amount that would read as mm/h.
 *
 * @param {number|null|undefined} amountMm Precipitation sum over the interval, in mm
 * @param {number|null|undefined} intervalSec Length of that interval, in seconds
 * @returns {number|null} Rate in mm/h, or null when either input is missing or invalid
 */
function precipitationRatePerHour(amountMm, intervalSec) {
  if (typeof amountMm !== "number" || !Number.isFinite(amountMm)) return null;
  if (typeof intervalSec !== "number" || !Number.isFinite(intervalSec) || intervalSec <= 0) return null;
  return (amountMm * SECONDS_PER_HOUR) / intervalSec;
}

/**
 * Wrap a single `values` object into the Tomorrow.io envelope shape
 * that the rest of the codebase already consumes.
 *
 * @param {string} startTime ISO timestamp
 * @param {Object} values
 * @returns {{startTime: string, values: Object}}
 */
function asInterval(startTime, values) {
  return { startTime, values };
}

/**
 * Wrap an array of intervals into the full Tomorrow.io response
 * envelope: `data.timelines[0].intervals`.
 *
 * @param {Array} intervals
 * @returns {Object} envelope
 */
function asEnvelope(intervals) {
  return { data: { timelines: [{ intervals }] } };
}

/**
 * Pull the `current` block from Open-Meteo into a Tomorrow.io-shaped
 * envelope. Covers a subset of the `/api/weather/current` field set
 * (no windGust / visibility / epaIndex), using the same key names so
 * client code doesn't need to branch on source.
 *
 * @param {Object} src Open-Meteo `current` block + units context
 * @returns {Object} envelope or null if no payload
 */
function adaptCurrent(src) {
  if (!src) return null;
  return asEnvelope([asInterval(src.time, {
    cloudCover: src.cloud_cover,
    humidity: src.relative_humidity_2m,
    // mm per `interval` seconds upstream → mm/h, like Tomorrow.io.
    precipitationIntensity: precipitationRatePerHour(src.precipitation, src.interval),
    // Open-Meteo current doesn't return precip probability — only
    // hourly does. Surfacing null here matches Tomorrow.io's behaviour
    // when a field is missing (clients already guard with `?? null`).
    precipitationProbability: null,
    precipitationType: 0,
    temperature: src.temperature_2m,
    temperatureApparent: src.apparent_temperature,
    uvIndex: src.uv_index,
    // v3.1 Phase 2 envelope parity — the kiosk's 4th metric tile reads
    // pressureSurfaceLevel; Open-Meteo's surface_pressure is hPa too.
    pressureSurfaceLevel: src.surface_pressure ?? null,
    weatherCode: mapWmoCode(src.weather_code),
    windSpeed: src.wind_speed_10m, // m/s, via wind_speed_unit=ms
  })]);
}

/**
 * Pull the `hourly` block (parallel arrays) into per-interval
 * Tomorrow.io-shaped intervals.
 *
 * @param {Object} hourly Open-Meteo `hourly` block
 * @returns {Object} envelope or null
 */
function adaptHourly(hourly) {
  if (!hourly || !Array.isArray(hourly.time)) return null;
  const intervals = hourly.time.map((t, i) => asInterval(t, {
    // Preceding-hour sum in mm, i.e. already mm/h — no rescaling.
    precipitationIntensity: hourly.precipitation ? hourly.precipitation[i] : null,
    precipitationProbability: hourly.precipitation_probability ? hourly.precipitation_probability[i] : null,
    temperature: hourly.temperature_2m ? hourly.temperature_2m[i] : null,
    weatherCode: hourly.weather_code ? mapWmoCode(hourly.weather_code[i]) : null,
    windSpeed: hourly.wind_speed_10m ? hourly.wind_speed_10m[i] : null, // m/s, via wind_speed_unit=ms
  }));
  return asEnvelope(intervals);
}

/**
 * Pull the `daily` block into per-day Tomorrow.io-shaped intervals.
 * Snow accumulation converted cm → mm to match Tomorrow.io units.
 * Day/night weather codes derived by sampling the hourly array at
 * midday and midnight of each local date — Open-Meteo doesn't split
 * daily codes the way Tomorrow.io does.
 *
 * @param {Object} daily Open-Meteo `daily` block
 * @param {Object} hourly Open-Meteo `hourly` block (used for day/night code derivation)
 * @returns {Object} envelope or null
 */
function adaptDaily(daily, hourly) {
  if (!daily || !Array.isArray(daily.time)) return null;

  // Build a quick lookup of `YYYY-MM-DDTHH:00` → wmoCode from the
  // hourly array so we can pick the noon / midnight value cheaply.
  const hourlyByHour = {};
  if (hourly && Array.isArray(hourly.time)) {
    hourly.time.forEach((t, i) => {
      hourlyByHour[t] = hourly.weather_code ? hourly.weather_code[i] : null;
    });
  }

  const intervals = daily.time.map((d, i) => {
    const noonKey = `${d}T13:00`; // 1 pm local — peak insolation
    const midnightKey = `${d}T01:00`; // 1 am local — deepest night
    const codeDay = mapWmoCode(hourlyByHour[noonKey]);
    const codeNight = mapWmoCode(hourlyByHour[midnightKey]);
    const codeMax = mapWmoCode(daily.weather_code ? daily.weather_code[i] : null);

    return asInterval(d, {
      precipitationIntensity: null,
      precipitationProbability: daily.precipitation_probability_max ? daily.precipitation_probability_max[i] : null,
      precipitationProbabilityMax: daily.precipitation_probability_max ? daily.precipitation_probability_max[i] : null,
      rainAccumulation: daily.rain_sum ? daily.rain_sum[i] : null,
      snowAccumulation: daily.snowfall_sum != null ? daily.snowfall_sum[i] * 10 : null,
      temperature: daily.temperature_2m_max ? daily.temperature_2m_max[i] : null,
      temperatureMax: daily.temperature_2m_max ? daily.temperature_2m_max[i] : null,
      temperatureMin: daily.temperature_2m_min ? daily.temperature_2m_min[i] : null,
      temperatureApparentMax: daily.apparent_temperature_max ? daily.apparent_temperature_max[i] : null,
      temperatureApparentMin: daily.apparent_temperature_min ? daily.apparent_temperature_min[i] : null,
      weatherCodeMax: codeMax,
      weatherCodeDay: codeDay,
      weatherCodeNight: codeNight,
      windSpeed: null,
    });
  });
  return asEnvelope(intervals);
}

/**
 * Build the Open-Meteo forecast URL for one location. Pure, so the
 * unit parameters it carries can be pinned by a test.
 *
 * @param {number} lat Validated latitude
 * @param {number} lon Validated longitude
 * @param {string} tz IANA timezone or "auto", already regex-checked
 * @returns {string} The full upstream URL, units included
 */
function buildForecastUrl(lat, lon, tz) {
  const unitParams = Object.entries(OPEN_METEO_UNIT_PARAMS)
    .map(([key, value]) => `&${key}=${value}`)
    .join("");
  return OPEN_METEO_FORECAST_URL
    + `?latitude=${lat}&longitude=${lon}`
    + "&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,uv_index,surface_pressure"
    + "&hourly=temperature_2m,relative_humidity_2m,precipitation,precipitation_probability,weather_code,wind_speed_10m,uv_index"
    + "&daily=weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_sum,rain_sum,snowfall_sum,precipitation_probability_max,uv_index_max,sunrise,sunset"
    + unitParams
    + `&timezone=${encodeURIComponent(tz)}`
    + `&forecast_days=${FORECAST_DAYS}`;
}

/**
 * GET /api/weather/openmeteo?lat&lon[&tz]
 *
 * Side-by-side PoC endpoint for evaluating Open-Meteo as a possible
 * Tomorrow.io replacement. Returns current + hourly + daily in three
 * sub-keys, each shaped exactly like the corresponding Tomorrow.io
 * endpoint (same keys, same metric units: °C, m/s, mm, hPa) so a
 * client can compare values without re-normalising.
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function getOpenMeteoWeather(req, res) {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return res.status(400).json({ error: "Invalid coordinates" }).end();
  }
  // Optional timezone (e.g. "America/Toronto") so the daily/hourly
  // timestamps line up with the user's clock instead of UTC. Strict
  // regex match prevents arbitrary upstream values reaching the URL.
  const tz = typeof req.query.tz === "string" && /^[A-Za-z_/+\-0-9]{1,64}$/.test(req.query.tz)
    ? req.query.tz : "auto";

  const url = buildForecastUrl(lat, lon, tz);

  try {
    const result = await axios.get(url, { timeout: API_TIMEOUT_MS });
    recordServiceCall(SERVICE_NAME, 200, "OK");
    const { current, hourly, daily } = result.data;
    return res.status(200).json({
      current: adaptCurrent(current),
      hourly: adaptHourly(hourly),
      daily: adaptDaily(daily, hourly),
      // Raw passthrough kept for debugging / spot-checks. Drop once
      // the PoC moves to a real integration. Same units as the
      // envelope (see OPEN_METEO_UNIT_PARAMS; `_raw.current_units`
      // and friends name them), except `current.precipitation`, which
      // stays a per-`interval` amount (mm per 15 min) where the
      // envelope's `precipitationIntensity` is the mm/h rate (×4).
      _raw: result.data,
    }).end();
  } catch (err) {
    const status = err?.response?.status || 500;
    const message = err?.response?.data?.reason || err?.message || "Open-Meteo fetch failed";
    recordServiceCall(SERVICE_NAME, status, String(message).slice(0, 100));
    return res.status(status >= 400 && status < 600 ? status : 500).json({ error: message }).end();
  }
}

module.exports = {
  getOpenMeteoWeather,
  // Exposed for test/openMeteoAdapter.test.js only.
  __test: { buildForecastUrl, precipitationRatePerHour, adaptCurrent, adaptHourly, adaptDaily },
};
