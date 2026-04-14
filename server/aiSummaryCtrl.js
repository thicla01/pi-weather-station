const Anthropic = require("@anthropic-ai/sdk");
const axios = require("axios").default;
const { getSettingsData } = require("./settingsCtrl");
const { weatherCache } = require("./proxyCtrl");
const { recordServiceCall } = require("./serviceStatus");

const SUMMARY_CACHE_TTL = 15 * 60 * 1000; // 15 minutes
const summaryCache = {};

const LANG_NAMES = { en: "English", fr: "French", es: "Spanish" };

const WEATHER_CODE_LABELS = {
  1000: "Clear", 1001: "Cloudy", 1100: "Mostly Clear", 1101: "Partly Cloudy",
  1102: "Mostly Cloudy", 2000: "Fog", 2100: "Light Fog", 3000: "Light Wind",
  3001: "Wind", 3002: "Strong Wind", 4000: "Drizzle", 4001: "Rain",
  4200: "Light Rain", 4201: "Heavy Rain", 5000: "Snow", 5001: "Flurries",
  5100: "Light Snow", 5101: "Heavy Snow", 6000: "Freezing Drizzle",
  6001: "Freezing Rain", 6200: "Light Freezing Rain", 6201: "Heavy Freezing Rain",
  7000: "Ice Pellets", 7101: "Heavy Ice Pellets", 7102: "Light Ice Pellets",
  8000: "Thunderstorm",
};

function getWeatherFromSharedCache(lat, lon) {
  const key = `current:${lat.toFixed(4)}:${lon.toFixed(4)}`;
  const entry = weatherCache[key];
  if (!entry || Date.now() > entry.expiresAt) return null;
  return entry.data;
}

function getDailyFromSharedCache(lat, lon) {
  const key = `daily:${lat.toFixed(4)}:${lon.toFixed(4)}`;
  const entry = weatherCache[key];
  if (!entry || Date.now() > entry.expiresAt) return null;
  return entry.data;
}

/**
 * GET /api/weather-summary
 * Returns an AI-generated natural language weather summary.
 * Returns 503 if the Anthropic API key is not configured (feature is optional).
 *
 * @param {Object} req
 * @param {Object} req.query
 * @param {String} req.query.lat
 * @param {String} req.query.lon
 * @param {String} [req.query.lang] Language code: en, fr, es (default: en)
 * @param {Object} res
 */
async function getWeatherSummary(req, res) {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  const lang = req.query.lang || "en";

  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return res.status(400).json("Invalid coordinates").end();
  }

  let settings;
  try {
    settings = await getSettingsData();
  } catch {
    return res.status(500).json("Could not read settings").end();
  }

  if (!settings.anthropicApiKey || settings.anthropicApiKey === "key") {
    return res.status(503).json("Anthropic API key not configured").end();
  }

  const cacheKey = `${lat.toFixed(4)}:${lon.toFixed(4)}:${lang}`;
  const cached = summaryCache[cacheKey];
  if (cached && Date.now() < cached.expiresAt) {
    return res.status(200).json({ summary: cached.summary }).end();
  }

  // Use shared weather cache to avoid duplicate Tomorrow.io calls
  let weatherData = getWeatherFromSharedCache(lat, lon);

  if (!weatherData) {
    if (!settings.weatherApiKey) {
      return res.status(503).json("Weather API key not configured").end();
    }
    try {
      const fields = ["temperature", "humidity", "windSpeed",
        "precipitationProbability", "weatherCode", "cloudCover"].join("%2c");
      const result = await axios.get(
        `https://api.tomorrow.io/v4/timelines?location=${lat}%2C${lon}&fields=${fields}&timesteps=current&apikey=${settings.weatherApiKey}`
      );
      weatherData = result.data;
    } catch {
      return res.status(500).json("Could not fetch weather data").end();
    }
  }

  const values = weatherData?.data?.timelines?.[0]?.intervals?.[0]?.values || {};
  const temp     = values.temperature              !== undefined ? `${Math.round(values.temperature)}°C`           : null;
  const humidity = values.humidity                 !== undefined ? `${Math.round(values.humidity)}%`               : null;
  const wind     = values.windSpeed                !== undefined ? `${Math.round(values.windSpeed)} km/h`          : null;
  const precip   = values.precipitationProbability !== undefined ? `${Math.round(values.precipitationProbability)}%` : null;
  const cond     = WEATHER_CODE_LABELS[values.weatherCode] || null;
  const cloud    = values.cloudCover               !== undefined ? `${Math.round(values.cloudCover)}%`             : null;

  const currentLines = [
    temp     && `- Temperature: ${temp}`,
    cond     && `- Conditions: ${cond}`,
    humidity && `- Humidity: ${humidity}`,
    wind     && `- Wind: ${wind}`,
    precip   && `- Precipitation probability: ${precip}`,
    cloud    && `- Cloud cover: ${cloud}`,
  ].filter(Boolean).join("\n");

  // Tomorrow's forecast from daily cache (index 1 = tomorrow)
  const dailyData = getDailyFromSharedCache(lat, lon);
  const tomorrowValues = dailyData?.data?.timelines?.[0]?.intervals?.[1]?.values || null;
  let tomorrowSection = "";
  if (tomorrowValues) {
    const tTemp   = tomorrowValues.temperature              !== undefined ? `${Math.round(tomorrowValues.temperature)}°C`              : null;
    const tWind   = tomorrowValues.windSpeed                !== undefined ? `${Math.round(tomorrowValues.windSpeed)} km/h`             : null;
    const tPrecip = tomorrowValues.precipitationProbability !== undefined ? `${Math.round(tomorrowValues.precipitationProbability)}%`  : null;
    const tLines = [
      tTemp   && `- Temperature: ${tTemp}`,
      tWind   && `- Wind: ${tWind}`,
      tPrecip && `- Precipitation probability: ${tPrecip}`,
    ].filter(Boolean).join("\n");
    tomorrowSection = `\n\nTomorrow's forecast:\n${tLines}`;
  }

  const language = LANG_NAMES[lang] || "English";
  const prompt = `Write a weather summary in ${language} with two short paragraphs. The first paragraph covers current conditions (2-3 sentences). The second paragraph covers tomorrow's forecast (1-2 sentences). Be concise and conversational. Reply with plain text only — no title, no markdown, no labels before each paragraph.\n\nCurrent conditions:\n${currentLines}${tomorrowSection}`;

  try {
    const client = new Anthropic({ apiKey: settings.anthropicApiKey });
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 150,
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    });
    const summary = message.content[0].text.trim();
    summaryCache[cacheKey] = { summary, expiresAt: Date.now() + SUMMARY_CACHE_TTL };
    recordServiceCall("Claude (AI summary)", 200, "OK");
    return res.status(200).json({ summary }).end();
  } catch (err) {
    const status = err?.status || 500;
    recordServiceCall("Claude (AI summary)", status, (err?.message || "AI summary failed").slice(0, 100));
    return res.status(500).json("AI summary failed").end();
  }
}

module.exports = { getWeatherSummary };
