const Anthropic = require("@anthropic-ai/sdk");
const axios = require("axios").default;
const { getSettingsData } = require("./settingsCtrl");
const { weatherCache } = require("./proxyCtrl");
const { recordServiceCall } = require("./serviceStatus");
const { increment } = require("./requestCounter");
const { analyzeRadar } = require("./radarAnalyzerCtrl");

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

function getHourlyFromSharedCache(lat, lon) {
  const key = `hourly:${lat.toFixed(4)}:${lon.toFixed(4)}`;
  const entry = weatherCache[key];
  if (!entry || Date.now() > entry.expiresAt) return null;
  return entry.data;
}

/**
 * Extract forecast from hourly data for a given time window
 */
function getHourlyForecast(hourlyData, fromTs, toTs) {
  const intervals = hourlyData?.data?.timelines?.[0]?.intervals;
  if (!intervals) return null;

  const window = intervals.filter((i) => {
    const t = new Date(i.startTime).getTime();
    return t >= fromTs && t < toTs;
  });

  if (window.length === 0) return null;

  const avgTemp = Math.round(
    window.reduce((s, i) => s + i.values.temperature, 0) / window.length
  );
  const maxPrecip = Math.round(
    Math.max(...window.map((i) => i.values.precipitationProbability || 0))
  );
  const avgWind = Math.round(
    window.reduce((s, i) => s + i.values.windSpeed, 0) / window.length
  );

  return { avgTemp, maxPrecip, avgWind };
}

/**
 * Determine period label and time window based on local hour
 * - Morning/Afternoon (5h-18h) → "ce soir"   (18h–21h)
 * - Evening (18h-21h)          → "cette nuit" (21h–5h)
 * - Night (21h+/0h-5h)         → "demain"     (daily)
 */
function getPeriod(localHour) {
  if (localHour >= 5 && localHour < 18) return "morning";
  if (localHour >= 18 && localHour < 21) return "evening";
  return "night";
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
  const lang       = req.query.lang || "en";
  const localHour  = parseInt(req.query.localHour, 10) || 0;
  const ts18       = parseInt(req.query.ts18, 10) || null;
  const ts21       = parseInt(req.query.ts21, 10) || null;
  const ts05tomorrow = parseInt(req.query.ts05tomorrow, 10) || null;
  const period     = getPeriod(localHour);

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

  const cacheKey = `${lat.toFixed(4)}:${lon.toFixed(4)}:${lang}:${period}`;
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
        `https://api.tomorrow.io/v4/timelines?location=${lat}%2C${lon}&fields=${fields}&timesteps=current&apikey=${settings.weatherApiKey}`,
        { timeout: 10_000 }
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

  // Second paragraph — period determines what we show and which data we use
  let secondSection = "";
  let secondPeriodLabel = "";

  const hourlyData = getHourlyFromSharedCache(lat, lon);

  if (period === "morning" && ts18 && ts21) {
    // Matin/après-midi → ce soir (18h–21h)
    const forecast = hourlyData ? getHourlyForecast(hourlyData, ts18, ts21) : null;
    if (forecast) {
      secondSection = `\n\nTonight's evening forecast (18h-21h):\n` +
        `- Average temperature: ${forecast.avgTemp}°C\n` +
        `- Max precipitation probability: ${forecast.maxPrecip}%\n` +
        `- Average wind: ${forecast.avgWind} km/h`;
      secondPeriodLabel = "tonight's evening (18h–21h)";
    }
  } else if (period === "evening" && ts21 && ts05tomorrow) {
    // Soir → cette nuit (21h–5h)
    const forecast = hourlyData ? getHourlyForecast(hourlyData, ts21, ts05tomorrow) : null;
    if (forecast) {
      secondSection = `\n\nOvernight forecast (21h-5h):\n` +
        `- Average temperature: ${forecast.avgTemp}°C\n` +
        `- Max precipitation probability: ${forecast.maxPrecip}%\n` +
        `- Average wind: ${forecast.avgWind} km/h`;
      secondPeriodLabel = "tonight overnight (21h–5h)";
    }
  }

  if (!secondSection) {
    // Nuit ou données horaires absentes → demain (daily)
    const dailyData = getDailyFromSharedCache(lat, lon);
    const tomorrowValues = dailyData?.data?.timelines?.[0]?.intervals?.[1]?.values || null;
    if (tomorrowValues) {
      const tTemp   = tomorrowValues.temperature              !== undefined ? `${Math.round(tomorrowValues.temperature)}°C`             : null;
      const tWind   = tomorrowValues.windSpeed                !== undefined ? `${Math.round(tomorrowValues.windSpeed)} km/h`            : null;
      const tPrecip = tomorrowValues.precipitationProbability !== undefined ? `${Math.round(tomorrowValues.precipitationProbability)}%` : null;
      const tLines = [
        tTemp   && `- Temperature: ${tTemp}`,
        tWind   && `- Wind: ${tWind}`,
        tPrecip && `- Precipitation probability: ${tPrecip}`,
      ].filter(Boolean).join("\n");
      secondSection = `\n\nTomorrow's forecast:\n${tLines}`;
      secondPeriodLabel = "tomorrow";
    }
  }

  // Radar analysis — fetched in parallel with the prompt assembly. Any failure
  // is non-fatal: we just drop the third paragraph and behave like before.
  let radarText = null;
  try {
    radarText = await analyzeRadar(lat, lon);
  } catch {
    radarText = null;
  }

  const language = LANG_NAMES[lang] || "English";
  const paragraphCount = 1 + (secondPeriodLabel ? 1 : 0) + (radarText ? 1 : 0);
  const paragraphWord = paragraphCount === 1
    ? "one short paragraph"
    : paragraphCount === 2 ? "two short paragraphs" : "three short paragraphs";
  const secondInstruction = secondPeriodLabel
    ? ` The second paragraph covers ${secondPeriodLabel} (1-2 sentences).`
    : "";
  const radarInstruction = radarText
    ? ` The ${secondPeriodLabel ? "third" : "second"} paragraph MUST start with the literal label "Analyse radar : " (in ${language === "French" ? "French — keep this exact wording" : `${language}, translated as appropriate`}) and describe where precipitation is right now relative to the user, whether it is approaching, and an estimated arrival time if a band is moving toward them. Use the radar snapshots below to reason about movement. 1-3 sentences.`
    : "";
  const radarSection = radarText
    ? `\n\nRadar samples (8 directions × 4 distances around the user, intensity 0-6):\n${radarText}`
    : "";

  const prompt =
    `Write a weather summary in ${language} with ${paragraphWord}. The first paragraph covers current conditions (2-3 sentences).${secondInstruction}${radarInstruction} ` +
    `Be concise and conversational. Reply with plain text only — no title, no markdown, no labels before each paragraph (except the radar label described above).\n\n` +
    `Current conditions:\n${currentLines}${secondSection}${radarSection}`;

  try {
    const client = new Anthropic({ apiKey: settings.anthropicApiKey });
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: radarText ? 280 : 150,
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    });
    const summary = message.content[0].text.trim();
    summaryCache[cacheKey] = { summary, expiresAt: Date.now() + SUMMARY_CACHE_TTL };
    recordServiceCall("Claude (AI summary)", 200, "OK");
    increment("anthropic", "summary");
    return res.status(200).json({ summary }).end();
  } catch (err) {
    const status = err?.status || 500;
    recordServiceCall("Claude (AI summary)", status, (err?.message || "AI summary failed").slice(0, 100));
    return res.status(500).json("AI summary failed").end();
  }
}

module.exports = { getWeatherSummary, summaryCache };
