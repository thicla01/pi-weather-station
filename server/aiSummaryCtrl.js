const Anthropic = require("@anthropic-ai/sdk");
const axios = require("axios").default;
const { getSettingsData } = require("./settingsCtrl");
const { weatherCache } = require("./proxyCtrl");
const { recordServiceCall } = require("./serviceStatus");
const { increment } = require("./requestCounter");
const { analyzeRadar } = require("./radarAnalyzerCtrl");

const SUMMARY_CACHE_TTL = 15 * 60 * 1000; // 15 minutes
const summaryCache = {};

// Ring buffer of the most recent radar snapshots that fed an AI summary,
// surfaced through the debug panel so a maintainer can compare what the
// analyzer reported against what Claude (or the fast-path template) said
// in the resulting summary. Useful when a summary's narrative seems to
// disagree with what the radar map visually shows — the snapshot captures
// the exact text Claude received. Capped at RADAR_SNAPSHOT_BUFFER so it
// never grows unbounded; oldest entries are evicted FIFO. Localhost-only
// (gated by debugCtrl middleware) — radar text is not user-sensitive but
// keeping it inside the debug perimeter avoids surprising remote leaks.
const RADAR_SNAPSHOT_BUFFER = 10;
const recentRadarSnapshots = [];
function pushRadarSnapshot(entry) {
  recentRadarSnapshots.unshift({ ...entry, ts: Date.now() });
  if (recentRadarSnapshots.length > RADAR_SNAPSHOT_BUFFER) {
    recentRadarSnapshots.length = RADAR_SNAPSHOT_BUFFER;
  }
}
function getRecentRadarSnapshots() {
  return recentRadarSnapshots.slice();
}

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

// Per-language condition descriptors used by the calm-day fast path. Only
// includes the codes that count as "calm" — anything raining / snowing /
// thunderstorming routes through Claude as before. Translated phrases are
// written to drop into the template directly without further inflection.
const CALM_COND_BY_LANG = {
  en: {
    1000: "clear sky", 1100: "mostly clear sky", 1101: "partly cloudy sky",
    1102: "mostly cloudy sky", 1001: "overcast sky",
    2000: "fog", 2100: "light fog",
    3000: "light wind", 3001: "wind", 3002: "strong wind",
  },
  fr: {
    1000: "ciel dégagé", 1100: "ciel majoritairement dégagé", 1101: "ciel partiellement nuageux",
    1102: "ciel majoritairement nuageux", 1001: "ciel couvert",
    2000: "brouillard", 2100: "brume légère",
    3000: "vent léger", 3001: "vent soutenu", 3002: "vent fort",
  },
  es: {
    1000: "cielo despejado", 1100: "cielo mayormente despejado", 1101: "cielo parcialmente nublado",
    1102: "cielo mayormente nublado", 1001: "cielo cubierto",
    2000: "niebla", 2100: "niebla ligera",
    3000: "viento ligero", 3001: "viento", 3002: "viento fuerte",
  },
};

// Per-language label for the period covered by the second paragraph,
// keyed by the same kind ("evening" / "overnight" / "tomorrow") the
// controller assigns when building secondSection. Used only by the
// calm-day fast path; the Claude path uses the English secondPeriodLabel
// directly in the prompt and lets the model translate.
const PERIOD_LABEL_BY_LANG = {
  en: { evening: "this evening (18h–21h)", overnight: "overnight (21h–5h)", tomorrow: "tomorrow" },
  fr: { evening: "ce soir (18h–21h)",      overnight: "cette nuit (21h–5h)", tomorrow: "demain" },
  es: { evening: "esta noche (18h–21h)",   overnight: "durante la noche (21h–5h)", tomorrow: "mañana" },
};

// Radar third-paragraph wording for the calm-day fast path. The "Analyse
// radar : " prefix matches the convention Claude uses for the same
// paragraph in the regular path, so the format is consistent for users
// across the two rendering modes. The {distance} placeholder gets
// substituted with "50 km" / "100 km" / "30 mi" / "60 mi" depending on
// the user's distanceUnit and whether extendedRadius is on.
const CALM_RADAR_BY_LANG = {
  en: 'Radar analysis: nothing to report within {distance} of your location.',
  fr: 'Analyse radar : rien à signaler dans les {distance} autour de ta position.',
  es: 'Análisis radar: nada que señalar en {distance} alrededor de tu ubicación.',
};

/**
 * True when the formatted radar snapshot reports no active precipitation
 * within the surveyed annulus — used as an additional gate for the
 * calm-day fast path. formatSnapshot lists non-zero samples only inside
 * "Active X-Y" blocks; if no such block exists, the radar is fully clear.
 *
 * @param {String|null} radarText Output of analyzeRadar (formatSnapshot)
 * @returns {Boolean} True iff radar shows no active precipitation
 */
function isRadarClear(radarText) {
  if (!radarText) return true;
  return !radarText.includes("Active");
}

/**
 * Decide whether the conditions are "calm and stable" enough to skip the
 * Claude call and emit a templated summary instead. Four checks, ALL must
 * be true:
 *   1. Current weather code is benign (no active precipitation in the
 *      4xxx-8000 range).
 *   2. Current precipitation probability is below 20 %.
 *   3. The forthcoming period's max precipitation probability (if known)
 *      is below 20 %.
 *   4. The radar snapshot, if available, shows no active precipitation
 *      anywhere in the surveyed annulus. Defensive — Tomorrow.io can
 *      occasionally lag a developing band that's already visible on
 *      RainViewer; deferring to Claude in that case keeps the summary
 *      honest.
 *
 * When all four hold, the summary's content boils down to "current numbers
 * + nothing notable expected + no radar return" — which a template can
 * render with full fidelity, no LLM call needed.
 *
 * @param {Object} values Tomorrow.io current-conditions values (may be empty)
 * @param {Number|null} periodMaxPrecip Max precipitation probability across
 *   the forecast window, or null when unavailable
 * @param {String|null} radarText Output of analyzeRadar, or null when
 *   the analyzer was unavailable / disabled
 * @returns {Boolean} True if the calm-day fast path applies
 */
function isCalmStableState(values, periodMaxPrecip, radarText) {
  if (!values || values.temperature === undefined) return false;
  const code = values.weatherCode;
  // 4xxx (rain/drizzle) → 8000 (thunderstorm) cover all active precipitation
  // codes Tomorrow.io emits. Anything in this range disqualifies the fast
  // path because the summary needs to describe what's happening — Claude
  // adds real value by interpreting it.
  if (typeof code === "number" && code >= 4000 && code <= 8000) return false;
  if (typeof values.precipitationProbability === "number" && values.precipitationProbability >= 20) return false;
  // Period precip gate — must have an actual numeric value to clear the gate.
  // When periodMaxPrecip is null (Tomorrow.io hourly/daily cache miss for the
  // relevant interval), we don't know whether the forecast is calm, so we
  // refuse the fast path rather than render a 2-paragraph template with a
  // silently-dropped paragraph 2. Defer to Claude — slightly more expensive,
  // always correct.
  if (typeof periodMaxPrecip !== "number") return false;
  if (periodMaxPrecip >= 20) return false;
  if (!isRadarClear(radarText)) return false;
  return true;
}

/**
 * Build a templated summary for the calm-day fast path. Renders three
 * paragraphs to match the structure Claude would have produced in the
 * regular path, using the same input data the prompt would have carried:
 *
 *   1. Current conditions — temperature, sky condition, humidity, wind
 *   2. Period forecast — average temp, max precipitation probability, wind
 *      for the user's relevant window (evening / overnight / tomorrow)
 *   3. Radar analysis — confident "nothing to report" because the fast
 *      path only fires when the radar snapshot is fully clear
 *
 * No LLM call. The first paragraph always renders; paragraphs 2 and 3
 * are conditional on having the underlying data (period forecast may be
 * absent if Tomorrow.io throttled, radar may be absent if disabled).
 *
 * @param {Object} opts
 * @param {String} opts.lang "en" / "fr" / "es"
 * @param {Object} opts.values Tomorrow.io current-conditions values
 * @param {String} opts.tempUnit "f" / "c" / "k"
 * @param {String} opts.speedUnit "mph" / "kmh" / "ms"
 * @param {String} opts.distanceUnit "km" / "mi"
 * @param {Boolean} opts.extendedRadius Whether the outer ring is active
 * @param {String|null} opts.periodKind "evening" / "overnight" / "tomorrow" / null
 * @param {Object|null} opts.periodSummary { avgTemp, maxPrecip, avgWind }
 *   (forecast values for the relevant window, or null when unavailable)
 * @param {Boolean} opts.radarAvailable Whether to include paragraph 3
 * @returns {String} 1-3 paragraph summary, paragraphs separated by blank lines
 */
function buildCalmDayTemplate({
  lang, values, tempUnit, speedUnit,
  distanceUnit, extendedRadius,
  periodKind, periodSummary,
  radarAvailable,
}) {
  const temp     = fmtTemp(values.temperature, tempUnit);
  const cond     = (CALM_COND_BY_LANG[lang] || CALM_COND_BY_LANG.en)[values.weatherCode];
  const humidity = values.humidity !== undefined ? `${Math.round(values.humidity)}%` : null;
  const wind     = fmtSpeed(values.windSpeed, speedUnit);

  // ── Paragraph 1: current conditions ──────────────────────────────────
  let p1;
  if (lang === "fr") {
    const condClause = cond ? ` avec un ${cond}` : "";
    const humidityClause = humidity ? ` et ${humidity} d'humidité` : "";
    const windClause = wind ? ` Vent à ${wind}.` : "";
    p1 = `Actuellement, il fait ${temp}${condClause}${humidityClause}.${windClause}`;
  } else if (lang === "es") {
    const condClause = cond ? ` con ${cond}` : "";
    const humidityClause = humidity ? ` y ${humidity} de humedad` : "";
    const windClause = wind ? ` Viento a ${wind}.` : "";
    p1 = `Actualmente ${temp}${condClause}${humidityClause}.${windClause}`;
  } else {
    const condClause = cond ? ` with ${cond}` : "";
    const humidityClause = humidity ? ` and ${humidity} humidity` : "";
    const windClause = wind ? ` Wind at ${wind}.` : "";
    p1 = `Currently ${temp}${condClause}${humidityClause}.${windClause}`;
  }

  // ── Paragraph 2: period forecast (if available) ──────────────────────
  let p2 = "";
  if (periodKind && periodSummary) {
    const periodLabel = (PERIOD_LABEL_BY_LANG[lang] || PERIOD_LABEL_BY_LANG.en)[periodKind];
    const avgTemp = fmtTemp(periodSummary.avgTemp, tempUnit);
    const avgWind = fmtSpeed(periodSummary.avgWind, speedUnit);
    const maxPrecip = typeof periodSummary.maxPrecip === "number"
      ? `${Math.round(periodSummary.maxPrecip)}%`
      : null;
    if (lang === "fr") {
      const precipClause = maxPrecip
        ? ` Probabilité maximale de précipitations : ${maxPrecip}.`
        : "";
      p2 = `Pour ${periodLabel}, prévoyez ${avgTemp} avec un vent moyen de ${avgWind}.${precipClause}`;
    } else if (lang === "es") {
      const precipClause = maxPrecip
        ? ` Probabilidad máxima de precipitación: ${maxPrecip}.`
        : "";
      p2 = `Para ${periodLabel}, se prevé ${avgTemp} con un viento promedio de ${avgWind}.${precipClause}`;
    } else {
      const precipClause = maxPrecip
        ? ` Max precipitation probability: ${maxPrecip}.`
        : "";
      p2 = `For ${periodLabel}, expect ${avgTemp} with an average wind of ${avgWind}.${precipClause}`;
    }
  }

  // ── Paragraph 3: radar status (only when the analyzer ran) ───────────
  let p3 = "";
  if (radarAvailable) {
    // Inner ring is 50 km / 30 mi; outer ring (when extendedRadius is on)
    // extends the surveyed annulus to 100 km / 60 mi. Pick the matching
    // distance phrase.
    const distance = distanceUnit === "mi"
      ? (extendedRadius ? "60 mi" : "30 mi")
      : (extendedRadius ? "100 km" : "50 km");
    const tpl = CALM_RADAR_BY_LANG[lang] || CALM_RADAR_BY_LANG.en;
    p3 = tpl.replace("{distance}", distance);
  }

  // Join non-empty paragraphs with a blank line separator. Mirrors the
  // shape Claude produces (paragraphs are split client-side on \n\n).
  return [p1, p2, p3].filter(Boolean).join("\n\n");
}

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
  // Tracked alongside secondSection so the calm-day fast path can decide
  // whether the upcoming period is "calm" (max precipitation probability
  // below the threshold) without re-parsing the section text. Stays null
  // when no period forecast is available.
  let periodMaxPrecip = null;
  // Locale-aware kind ("evening" / "overnight" / "tomorrow") used by the
  // calm-day template to pick the right localised period label, paired
  // with the underlying numeric values for the template's paragraph 2.
  let periodKind = null;
  let periodSummary = null;

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
      periodMaxPrecip = forecast.maxPrecip;
      periodKind = "evening";
      periodSummary = { avgTemp: forecast.avgTemp, maxPrecip: forecast.maxPrecip, avgWind: forecast.avgWind };
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
      periodMaxPrecip = forecast.maxPrecip;
      periodKind = "overnight";
      periodSummary = { avgTemp: forecast.avgTemp, maxPrecip: forecast.maxPrecip, avgWind: forecast.avgWind };
    }
  }

  if (!secondSection) {
    // Nuit ou données horaires absentes → demain (daily)
    const dailyData = getDailyFromSharedCache(lat, lon);
    const tomorrowValues = dailyData?.data?.timelines?.[0]?.intervals?.[1]?.values || null;
    if (tomorrowValues) {
      if (typeof tomorrowValues.precipitationProbability === "number") {
        periodMaxPrecip = tomorrowValues.precipitationProbability;
      }
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
      periodKind = "tomorrow";
      periodSummary = {
        avgTemp: tomorrowValues.temperature,
        maxPrecip: tomorrowValues.precipitationProbability,
        avgWind: tomorrowValues.windSpeed,
      };
    }
  }

  // Radar analysis — fetched up front (cheap: tile fetches are cached, PNG
  // decode is ~5-10 ms) so its output can feed BOTH the calm-day fast path
  // (as an additional gate to confirm no precipitation is visible on radar
  // even if Tomorrow.io's current code says calm) AND the regular Claude
  // path's third paragraph. Any failure is non-fatal — fast path proceeds
  // assuming clear, regular path drops the third paragraph.
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

  // Calm-day fast path — when current conditions are clearly benign, the
  // forecast period shows no incoming precipitation, AND the radar snapshot
  // confirms a fully clear annulus, the LLM doesn't add useful narration
  // over a templated rendering. Skip Claude and return a localised three-
  // paragraph template (current conditions + period forecast + radar
  // "nothing to report") directly. Saves one full Anthropic call per cache
  // window on calm days. Default on, opt-out via advanced.ai.calmDayFastPath.
  const calmFastPathEnabled = (settings?.advanced?.ai?.calmDayFastPath) !== false;
  if (calmFastPathEnabled && isCalmStableState(values, periodMaxPrecip, radarText)) {
    const summary = buildCalmDayTemplate({
      lang, values, tempUnit, speedUnit,
      distanceUnit, extendedRadius: Boolean(aiSettings.extendedRadius),
      periodKind, periodSummary,
      radarAvailable: radarEnabled,
    });
    summaryCache[cacheKey] = { summary, expiresAt: Date.now() + SUMMARY_CACHE_TTL };
    pushRadarSnapshot({
      lat, lon, lang, source: "fast-path",
      radarText: radarText || "(radar disabled)",
      summary,
    });
    recordServiceCall("Claude (AI summary)", 200, "calm-day fast path (no LLM call)");
    // Deliberately NOT incrementing the Anthropic counter — no API call was made.
    return res.status(200).json({ summary }).end();
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
    if (slot === "current") return `The ${which} paragraph covers current conditions ONLY (2-3 sentences) — do NOT add a closing sentence about the upcoming forecast; that belongs in its own paragraph.`;
    if (slot === "period")  return `The ${which} paragraph is a STANDALONE paragraph about ${secondPeriodLabel} (1-2 sentences) — it MUST be separated from the current-conditions paragraph by a blank line and must not be merged into another paragraph as a trailing sentence, even if its content is short.`;
    if (slot === "radar") {
      return `The ${which} paragraph MUST start with the literal label "Analyse radar : " (in ${language === "French" ? "French — keep this exact wording" : `${language}, translated as appropriate`}) and describe ONLY what the radar shows right now relative to the user: where precipitation currently is, whether it is approaching based on movement between the three radar snapshots, and an estimated arrival time if a band is genuinely moving toward them. Do NOT reference the period forecast (paragraph ${paragraphSlots.indexOf("period") + 1 || "above"} already covers that) — the radar paragraph is strictly about radar observations. If the radar shows no precipitation in the surveyed annulus, say so plainly without speculating about future conditions. 1-3 sentences.`;
    }
    return "";
  }).join(" ");

  // When current conditions are missing (typically Tomorrow.io throttling),
  // give Claude an explicit note so it doesn't invent values or apologise
  // mid-summary.
  const missingNote = !hasCurrent
    ? " Note: live current-conditions data is temporarily unavailable; do not invent values for it. Lead with whatever sections are present."
    : "";

  // Radar block uses a hierarchical compressed format documented in
  // formatSnapshot (radarAnalyzerCtrl.js). Brief explanation in the
  // wrapper below so Claude reads "Clear within 70km" / "Clear beyond
  // 95km" / "Active 70-95km" as structural rollups rather than literal
  // statements about specific samples, AND so the omission-based tier
  // (only non-zero samples listed within an active annulus) is read
  // correctly: a missing direction means that bearing is clear in the
  // active range, and a missing distance inside a listed direction
  // means that specific sample is clear.
  const radarSection = hasRadar
    ? `\n\nRadar samples (16-point inner ring + 32-point outer ring around the user, intensity tiers: clear/very light/light/moderate/heavy/very heavy/extreme). Format conventions: "Clear within X" and "Clear beyond Y" mean those annulus zones contain no precipitation. Inside the "Active X-Y" zone, ONLY non-zero precipitation samples are listed — any direction not listed is clear at every sampled distance in the active range, and any distance not listed inside a listed direction is clear at that specific sample point:\n${radarText}`
    : "";
  const currentSection = hasCurrent ? `Current conditions:\n${currentLines}` : "";
  const dataPayload = [currentSection, secondSection, radarSection].filter(Boolean).join("");

  const distanceUnitInstruction = distanceUnit === "mi" ? "miles" : "km";
  const prompt =
    `Write a weather summary in ${language} with ${paragraphWord}, separated by a single blank line (\\n\\n). Each paragraph MUST stand on its own — never merge content that belongs to a different paragraph as a trailing sentence. ${instructions}${missingNote} ` +
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
    pushRadarSnapshot({
      lat, lon, lang, source: "claude",
      radarText: hasRadar ? radarText : "(no radar block in prompt)",
      summary,
    });
    recordServiceCall("Claude (AI summary)", 200, "OK");
    increment("anthropic", "summary");
    return res.status(200).json({ summary }).end();
  } catch (err) {
    const status = err?.status || 500;
    recordServiceCall("Claude (AI summary)", status, (err?.message || "AI summary failed").slice(0, 100));
    return res.status(500).json("AI summary failed").end();
  }
}

module.exports = { getWeatherSummary, summaryCache, getRecentRadarSnapshots };
