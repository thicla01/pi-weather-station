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

// ── Unit conversion helpers ───────────────────────────────────────────────
// Source values from Tomorrow.io are always metric (°C, m/s). The client
// passes the user's preferred display units; we convert here so the prompt
// values match what the rest of the UI shows, and we tell Claude to use the
// matching unit symbols throughout its response.

/**
 * Format a temperature in the requested unit.
 *
 * @param {Number} c Temperature in degrees Celsius
 * @param {String} unit "f" (Fahrenheit), "c" (Celsius), "k" (Kelvin)
 * @returns {String} Formatted value with unit symbol, e.g. "53°F"
 */
function fmtTemp(c, unit) {
  if (c === undefined || c === null) return null;
  if (unit === "f") return `${Math.round(c * 9 / 5 + 32)}°F`;
  if (unit === "k") return `${Math.round(c + 273.15)}K`;
  return `${Math.round(c)}°C`;
}

/**
 * Format a wind speed in the requested unit. Tomorrow.io returns m/s.
 *
 * @param {Number} ms Wind speed in m/s
 * @param {String} unit "mph", "ms", or "kmh"
 * @returns {String} Formatted value with unit symbol
 */
function fmtSpeed(ms, unit) {
  if (ms === undefined || ms === null) return null;
  if (unit === "mph") return `${Math.round(ms / 0.44704)} mph`;
  if (unit === "ms") return `${Math.round(ms)} m/s`;
  return `${Math.round(ms * 3.6)} km/h`;
}

/**
 * Human-readable unit name for inclusion in the prompt instruction to Claude.
 *
 * @param {String} tempUnit "f" / "c" / "k"
 * @param {String} speedUnit "mph" / "kmh" / "ms"
 * @returns {String} A clause like "use Fahrenheit for temperatures and mph for wind speeds"
 */
function unitInstruction(tempUnit, speedUnit) {
  const tempName = tempUnit === "f" ? "Fahrenheit"
                 : tempUnit === "k" ? "Kelvin"
                 : "Celsius";
  const speedName = speedUnit === "mph" ? "mph"
                  : speedUnit === "ms"  ? "m/s"
                  : "km/h";
  return `use ${tempName} for temperatures and ${speedName} for wind speeds`;
}

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
  // User unit preferences. Default to metric so older clients that don't
  // pass these params still get sensible output.
  const tempUnit  = req.query.tempUnit  || "c";
  const speedUnit = req.query.speedUnit || "kmh";
  // Distance unit is explicit since v2.7. Older clients that don't pass it
  // fall back to inferring from the speed unit (mph → mi, otherwise km) so
  // they keep producing sensible prompts until they upgrade.
  const distanceUnit = req.query.distanceUnit === "mi" || req.query.distanceUnit === "km"
    ? req.query.distanceUnit
    : (speedUnit === "mph" ? "mi" : "km");

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

  // Cache key includes unit preferences so toggling Settings (e.g. °C → °F)
  // doesn't keep serving a stale summary built with the previous units.
  const cacheKey = `${lat.toFixed(4)}:${lon.toFixed(4)}:${lang}:${period}:${tempUnit}:${speedUnit}:${distanceUnit}`;
  const cached = summaryCache[cacheKey];
  if (cached && Date.now() < cached.expiresAt) {
    return res.status(200).json({ summary: cached.summary }).end();
  }

  // Use shared weather cache to avoid duplicate Tomorrow.io calls
  let weatherData = getWeatherFromSharedCache(lat, lon);

  if (!weatherData && settings.weatherApiKey) {
    // Try to backfill from Tomorrow.io. A failure here is no longer fatal:
    // we proceed with weatherData = null, the prompt drops the "Current
    // conditions" section, and we rely on whatever forecast / radar context
    // we already have so the summary still appears (it would otherwise
    // disappear entirely whenever Tomorrow.io throttles us with a 429).
    try {
      const fields = ["temperature", "humidity", "windSpeed",
        "precipitationProbability", "weatherCode", "cloudCover"].join("%2c");
      const result = await axios.get(
        `https://api.tomorrow.io/v4/timelines?location=${lat}%2C${lon}&fields=${fields}&timesteps=current&apikey=${settings.weatherApiKey}`,
        { timeout: 10_000 }
      );
      weatherData = result.data;
    } catch (err) {
      recordServiceCall("Tomorrow.io (current)", err?.response?.status || 500, "fetch failed in AI summary path");
      // Leave weatherData null and continue — sections are independent.
    }
  }

  const values = weatherData?.data?.timelines?.[0]?.intervals?.[0]?.values || {};
  const temp     = fmtTemp(values.temperature, tempUnit);
  const humidity = values.humidity                 !== undefined ? `${Math.round(values.humidity)}%`               : null;
  const wind     = fmtSpeed(values.windSpeed, speedUnit);
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
        `- Average temperature: ${fmtTemp(forecast.avgTemp, tempUnit)}\n` +
        `- Max precipitation probability: ${forecast.maxPrecip}%\n` +
        `- Average wind: ${fmtSpeed(forecast.avgWind, speedUnit)}`;
      secondPeriodLabel = "tonight's evening (18h–21h)";
    }
  } else if (period === "evening" && ts21 && ts05tomorrow) {
    // Soir → cette nuit (21h–5h)
    const forecast = hourlyData ? getHourlyForecast(hourlyData, ts21, ts05tomorrow) : null;
    if (forecast) {
      secondSection = `\n\nOvernight forecast (21h-5h):\n` +
        `- Average temperature: ${fmtTemp(forecast.avgTemp, tempUnit)}\n` +
        `- Max precipitation probability: ${forecast.maxPrecip}%\n` +
        `- Average wind: ${fmtSpeed(forecast.avgWind, speedUnit)}`;
      secondPeriodLabel = "tonight overnight (21h–5h)";
    }
  }

  if (!secondSection) {
    // Nuit ou données horaires absentes → demain (daily)
    const dailyData = getDailyFromSharedCache(lat, lon);
    const tomorrowValues = dailyData?.data?.timelines?.[0]?.intervals?.[1]?.values || null;
    if (tomorrowValues) {
      const tTemp   = fmtTemp(tomorrowValues.temperature, tempUnit);
      const tWind   = fmtSpeed(tomorrowValues.windSpeed, speedUnit);
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
  // The radarAnalysisEnabled flag (default true) lets users opt out entirely;
  // when off, we short-circuit here and the prompt falls back to two paragraphs.
  let radarText = null;
  const aiSettings = settings?.advanced?.ai || {};
  const radarEnabled = aiSettings.radarAnalysisEnabled !== false; // default true
  if (radarEnabled) {
    try {
      radarText = await analyzeRadar(lat, lon, {
        extendedRadius: Boolean(aiSettings.extendedRadius),
        distanceUnit,
      });
    } catch {
      radarText = null;
    }
  }

  // If none of the three sections has any content, there's nothing for
  // Claude to summarise — return 503 so the client hides the AI banner.
  // Pre-refactor, an empty currentLines couldn't happen because we'd
  // already 500'd; now we have to check.
  const hasCurrent = Boolean(currentLines);
  const hasPeriod = Boolean(secondPeriodLabel);
  const hasRadar = Boolean(radarText);
  if (!hasCurrent && !hasPeriod && !hasRadar) {
    return res.status(503).json("No weather data available").end();
  }

  // Build the per-paragraph instructions in the order they appear in the
  // payload below. Numbering is dynamic so dropping "current" doesn't
  // produce dangling references like "the second paragraph covers …" when
  // the first one is missing.
  const language = LANG_NAMES[lang] || "English";
  const paragraphSlots = [];
  if (hasCurrent) paragraphSlots.push("current");
  if (hasPeriod)  paragraphSlots.push("period");
  if (hasRadar)   paragraphSlots.push("radar");
  const paragraphWord = paragraphSlots.length === 1
    ? "one short paragraph"
    : paragraphSlots.length === 2 ? "two short paragraphs" : "three short paragraphs";
  const ordinal = (i) => ["first", "second", "third"][i] || `paragraph ${i + 1}`;

  const instructions = paragraphSlots.map((slot, i) => {
    const which = ordinal(i);
    if (slot === "current") return `The ${which} paragraph covers current conditions (2-3 sentences).`;
    if (slot === "period")  return `The ${which} paragraph covers ${secondPeriodLabel} (1-2 sentences).`;
    if (slot === "radar") {
      return `The ${which} paragraph MUST start with the literal label "Analyse radar : " (in ${language === "French" ? "French — keep this exact wording" : `${language}, translated as appropriate`}) and describe where precipitation is right now relative to the user, whether it is approaching, and an estimated arrival time if a band is moving toward them. Use the radar snapshots below to reason about movement. 1-3 sentences.`;
    }
    return "";
  }).join(" ");

  // When current conditions are missing (typically Tomorrow.io throttling),
  // give Claude an explicit note so it doesn't invent values or apologise
  // mid-summary.
  const missingNote = !hasCurrent
    ? " Note: live current-conditions data is temporarily unavailable; do not invent values for it. Lead with whatever sections are present."
    : "";

  const radarSection = hasRadar
    ? `\n\nRadar samples (8 directions × 4 distances around the user, intensity 0-6):\n${radarText}`
    : "";
  const currentSection = hasCurrent ? `Current conditions:\n${currentLines}` : "";
  const dataPayload = [currentSection, secondSection, radarSection].filter(Boolean).join("");

  const distanceUnitInstruction = distanceUnit === "mi" ? "miles" : "km";
  const prompt =
    `Write a weather summary in ${language} with ${paragraphWord}. ${instructions}${missingNote} ` +
    `Throughout your response, ${unitInstruction(tempUnit, speedUnit)}, and ${distanceUnitInstruction} for distances. Match the unit symbols exactly as shown in the data below — do not convert. ` +
    `Be concise and conversational. Reply with plain text only — no title, no markdown, no labels before each paragraph (except the radar label described above).\n\n` +
    `${dataPayload}`;

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
