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
//   - `snowfall_sum` is in cm (Tomorrow.io: mm) — multiplied here
//     for parity with `rainAccumulation` units (mm).
//   - Wind in km/h, temperature in °C — same as Tomorrow.io.

const axios = require("axios");
const { recordServiceCall } = require("./serviceStatus");

const SERVICE_NAME = "Open-Meteo (PoC)";
const API_TIMEOUT_MS = 10_000;

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
 * envelope. Mirrors the field set returned by `/api/weather/current`
 * — same key names so client code doesn't need to branch on source.
 *
 * @param {Object} src Open-Meteo `current` block + units context
 * @returns {Object} envelope or null if no payload
 */
function adaptCurrent(src) {
  if (!src) return null;
  return asEnvelope([asInterval(src.time, {
    cloudCover: src.cloud_cover,
    humidity: src.relative_humidity_2m,
    precipitationIntensity: src.precipitation,
    // Open-Meteo current doesn't return precip probability — only
    // hourly does. Surfacing null here matches Tomorrow.io's behaviour
    // when a field is missing (clients already guard with `?? null`).
    precipitationProbability: null,
    precipitationType: 0,
    temperature: src.temperature_2m,
    temperatureApparent: src.apparent_temperature,
    uvIndex: src.uv_index,
    weatherCode: mapWmoCode(src.weather_code),
    windSpeed: src.wind_speed_10m,
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
    precipitationIntensity: hourly.precipitation ? hourly.precipitation[i] : null,
    precipitationProbability: hourly.precipitation_probability ? hourly.precipitation_probability[i] : null,
    temperature: hourly.temperature_2m ? hourly.temperature_2m[i] : null,
    weatherCode: hourly.weather_code ? mapWmoCode(hourly.weather_code[i]) : null,
    windSpeed: hourly.wind_speed_10m ? hourly.wind_speed_10m[i] : null,
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
 * GET /api/weather/openmeteo?lat&lon[&tz]
 *
 * Side-by-side PoC endpoint for evaluating Open-Meteo as a possible
 * Tomorrow.io replacement. Returns current + hourly + daily in three
 * sub-keys, each shaped exactly like the corresponding Tomorrow.io
 * endpoint so a client can compare values without re-normalising.
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

  const url = "https://api.open-meteo.com/v1/forecast"
    + `?latitude=${lat}&longitude=${lon}`
    + "&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,uv_index"
    + "&hourly=temperature_2m,relative_humidity_2m,precipitation,precipitation_probability,weather_code,wind_speed_10m,uv_index"
    + "&daily=weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_sum,rain_sum,snowfall_sum,precipitation_probability_max,uv_index_max,sunrise,sunset"
    + `&timezone=${encodeURIComponent(tz)}`
    + "&forecast_days=5";

  try {
    const result = await axios.get(url, { timeout: API_TIMEOUT_MS });
    recordServiceCall(SERVICE_NAME, 200, "OK");
    const { current, hourly, daily } = result.data;
    return res.status(200).json({
      current: adaptCurrent(current),
      hourly: adaptHourly(hourly),
      daily: adaptDaily(daily, hourly),
      // Raw passthrough kept for debugging / spot-checks. Drop once
      // the PoC moves to a real integration.
      _raw: result.data,
    }).end();
  } catch (err) {
    const status = err?.response?.status || 500;
    const message = err?.response?.data?.reason || err?.message || "Open-Meteo fetch failed";
    recordServiceCall(SERVICE_NAME, status, String(message).slice(0, 100));
    return res.status(status >= 400 && status < 600 ? status : 500).json({ error: message }).end();
  }
}

module.exports = { getOpenMeteoWeather };
