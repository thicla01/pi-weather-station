const Anthropic = require("@anthropic-ai/sdk");
const axios = require("axios").default;
const { getSettingsData, isApiKeyConfigured } = require("./settingsCtrl");
// Cache helpers + field-hash constants are imported from proxyCtrl rather
// than re-derived here. Before this import was added the controller hand-
// crafted 3-part keys (`hourly:<lat>:<lon>`) that always missed against
// proxyCtrl's 4-part schema (`type:fieldsHash:lat:lon`, introduced 2026-
// 05-13 in commit 300d1f2). Result: AI-summary paragraph 2 (forecast)
// silently disappeared on every Pi. Sharing the key builder guarantees
// the two modules cannot drift again.
const {
  weatherCache,
  getCacheKey,
  CURRENT_FIELDS_HASH,
  HOURLY_FIELDS_HASH,
  DAILY_FIELDS_HASH,
  spaceTomorrowCall,
} = require("./proxyCtrl");
const { recordServiceCall, getServiceStatus } = require("./serviceStatus");
const { increment } = require("./requestCounter");
const { analyzeRadar } = require("./radarAnalyzerCtrl");
const { pruneObjectCache, BoundedMap } = require("./boundedCache");

const SUMMARY_CACHE_TTL = 15 * 60 * 1000; // 15 minutes
const summaryCache = {};

// cacheKey → Promise<{status, body}> for summary builds currently in
// flight. See the coalescing block in getWeatherSummary — entries live
// only for the duration of one build, so the map stays tiny by design.
const inflightSummaries = new Map();

// Hard cap on cached summaries. The legitimate working set is tiny (a Pi
// caches one entry per location × language × period × unit-set, refreshed
// every TTL window), so this is purely a runaway guard: a remote client on
// an ALLOW_REMOTE Pi can't grow the cache without bound by jittering the
// request. Enforced on every insert via setSummaryCache + swept on an
// interval so expired-but-under-cap entries don't linger.
const SUMMARY_CACHE_MAX = 200;

// ── Claude request shape (Haiku 5.5, 2026-10) ────────────────────────────
// Fixed model id, no date suffix. Rolling back to Haiku 4.5 means reverting
// the whole commit, not editing one string: Haiku 4.5 rejects
// `output_config.effort` with a 400 (it only knows budget-based thinking),
// and Haiku 5.5 rejects a non-default `temperature` / `top_p`, any
// `top_k`, an assistant prefill and a `fallbacks` model list with a 400.
// See docs/ai-summary.md § "Model upgrades".
const CLAUDE_MODEL = "claude-haiku-5-5";
// Adaptive thinking is Haiku 5.5's default; it is sent explicitly so a
// future default change can't silently move the bill. Low effort lets the
// model skip thinking on easy prompts and spend a little on busy radar
// rings, where inferring approach + ETA from the snapshots is the hard
// part. Effort, not prompt wording, is what controls thinking length.
const CLAUDE_THINKING = Object.freeze({ type: "adaptive" });
const CLAUDE_EFFORT = "low";
// Token caps. Haiku 5.5's tokenizer counts the same text as ~30% more
// tokens than Haiku 4.5, AND thinking tokens count toward max_tokens. The
// 4.5-era caps (400 radar / 150 no-radar) were sized for text alone, and
// 400 was itself a bump from 280 after the French radar paragraph
// truncated mid-sentence ("...attendue dans les 1<EOF>", May 2026). On 5.5,
// 400 would hold only ~308 tokens of 4.5-equivalent text, back at the cap
// that failed, before any thinking. These caps leave room for low-effort
// thinking plus the longest (French) reply. The radar cap went from 2048
// to 3072 after a live extended-radius call over real precipitation
// (Montréal, 2026-10-08) used 1260 output tokens, 1012 of them thinking,
// i.e. 62% of 2048. They are ceilings, not targets: billing follows what
// the model actually generates. They also set the dollar bound of the
// billed-call ceiling below, so keep them modest.
const MAX_TOKENS_RADAR = 3072;    // 3 paragraphs incl. radar analysis
const MAX_TOKENS_NO_RADAR = 1024; // 1-2 paragraphs, no radar block
// A reply cut at max_tokens is still served (partial text beats nothing)
// but cached for minutes, not the full window, so the next poll, AiView
// open or other client regenerates it instead of pinning a mid-sentence
// summary on every kiosk for 15 min.
const TRUNCATED_SUMMARY_TTL = 5 * 60 * 1000;
// maxRetries capped at 1 (SDK default is 2) so a transient Anthropic
// overload can't fan one request into three. The 30 s timeout is a
// deliberate exception to the 10 s outbound rule in CLAUDE.md: a generated
// reply (plus adaptive thinking on 5.5) takes longer than a data fetch.
// Don't tighten it without measuring p99 latency at CLAUDE_EFFORT.
const CLAUDE_MAX_RETRIES = 1;
const CLAUDE_TIMEOUT_MS = 30_000;

// Machine-readable `reason` on the two error bodies the clients base the AI
// feature's availability on ({ error, reason }; every other error body is a
// bare JSON string). The status carries the meaning on its own, so a client
// that predates `reason` still does the right thing:
//   - NO_KEY → 503, the ONLY response the clients read as "this server has
//     no AI summary": they hide the IA button / slab and subdue the rings.
//   - NO_WEATHER_DATA → 502: nothing to summarise right now (no current
//     conditions, no period forecast, no radar). Transient, so deliberately
//     not 503: the clients keep what they show and retry at the next poll.
// The client mirror is useAiSummary.js (`isAiSummaryKeyMissing`).
const SUMMARY_ERROR_REASON = Object.freeze({
  NO_KEY: "no-key",
  NO_WEATHER_DATA: "no-weather-data",
});

// Valid unit / language values. Anything else is snapped to a default
// BEFORE the value reaches the cache key, so junk query params can't
// expand the cache's key cardinality (a denial-of-wallet lever on the paid
// Anthropic path) and can't reach the prompt builders, which silently fall
// back per-unit anyway.
const VALID_LANGS = new Set(["en", "fr", "es"]);
const VALID_TEMP_UNITS = new Set(["f", "c", "k"]);
const VALID_SPEED_UNITS = new Set(["mph", "ms", "kmh"]);

/**
 * Snap user-supplied language / unit params to a known-good value. Invalid
 * or missing inputs collapse to the metric/English defaults rather than
 * flowing through verbatim.
 *
 * @param {Object} q
 * @param {String} [q.lang]
 * @param {String} [q.tempUnit]
 * @param {String} [q.speedUnit]
 * @returns {{lang: string, tempUnit: string, speedUnit: string}}
 */
function normalizeUnitParams({ lang, tempUnit, speedUnit } = {}) {
  return {
    lang: VALID_LANGS.has(lang) ? lang : "en",
    tempUnit: VALID_TEMP_UNITS.has(tempUnit) ? tempUnit : "c",
    speedUnit: VALID_SPEED_UNITS.has(speedUnit) ? speedUnit : "kmh",
  };
}

/**
 * Store a summary, enforcing SUMMARY_CACHE_MAX. pruneObjectCache also drops
 * any already-expired entries on the way, so the cache stays bounded
 * without a separate hot-path sweep.
 *
 * @param {String} key cache key
 * @param {Object} value { summary, periodKind, expiresAt }
 */
function setSummaryCache(key, value) {
  summaryCache[key] = value;
  pruneObjectCache(summaryCache, { maxEntries: SUMMARY_CACHE_MAX });
}

// Belt-and-suspenders periodic sweep so expired entries are reclaimed even
// when no new inserts arrive to trigger setSummaryCache's prune. .unref()
// so this never holds the process (or a test runner) open.
setInterval(() => pruneObjectCache(summaryCache, { maxEntries: SUMMARY_CACHE_MAX }), SUMMARY_CACHE_TTL).unref();

// Global throttle on ACTUAL billed Anthropic calls — the hard ceiling on
// denial-of-wallet that the cache (bypassable by jittering the key) can't
// provide. Applied to REMOTE requests only (the local kiosk is exempt at
// the call site, see getWeatherSummary), so a remote flood can't starve the
// on-device refresh. A single Pi makes ~one summary call per TTL window per
// location, so this bound is far above legitimate traffic and only bites a
// flood. Sliding 60 s window of call timestamps. A per-peer sub-ceiling is
// layered UNDER the global one so a single remote peer can't consume the
// whole global budget (and starve other remote clients) — the per-peer
// 120/min apiLimiter caps a peer's overall request rate, but only this
// bounds its share of *billed* Claude calls specifically.
// The ceiling bounds call COUNT; the dollar bound is
// calls/min × 1440 × (prompt_tokens × input_price + max_tokens × output_price).
// Theoretical worst case (every call a ~4.2K-token stormy extended-radius
// prompt, as measured live on 2026-10-08, that uses the whole
// MAX_TOKENS_RADAR cap) is ≈ $28/day on Haiku 5.5 at $0.10 / $0.50 per
// MTok, vs ≈ $75/day on Haiku 4.5 at the old 400 cap.
// Raising the caps raises this bound.
const MAX_CLAUDE_CALLS_PER_MIN = 10;          // global ceiling, all remote peers combined
const MAX_CLAUDE_CALLS_PER_MIN_PER_PEER = 4;  // sub-ceiling per remote peer
const claudeCallTimestamps = [];              // global sliding window
// peerKey → sliding window of that peer's billed-call timestamps. BoundedMap
// caps the number of tracked peers (OOM guard, same posture as #204's caches);
// 500 is far above any real fleet's distinct remote-client count.
const claudePeerWindows = new BoundedMap(500);

/**
 * Returns true if another billed Anthropic call is allowed right now,
 * recording the call's timestamp in both the global and the per-peer window
 * when it is. Side-effecting by design so the check and the reservation are
 * atomic within the single-threaded event loop. A request only passes when
 * BOTH ceilings have room; nothing is recorded on rejection.
 *
 * @param {String} [peerKey] remote socket peer; omit/null to skip the
 *   per-peer ceiling (internal callers — the local kiosk is exempt upstream)
 * @param {Number} [now] epoch ms (default Date.now())
 * @returns {Boolean}
 */
function reserveClaudeCall(peerKey, now = Date.now()) {
  const cutoff = now - 60 * 1000;
  // Global window.
  while (claudeCallTimestamps.length && claudeCallTimestamps[0] <= cutoff) {
    claudeCallTimestamps.shift();
  }
  if (claudeCallTimestamps.length >= MAX_CLAUDE_CALLS_PER_MIN) return false;
  // Per-peer window.
  let peerWindow = null;
  if (peerKey) {
    peerWindow = (claudePeerWindows.get(peerKey) || []).filter((t) => t > cutoff);
    if (peerWindow.length >= MAX_CLAUDE_CALLS_PER_MIN_PER_PEER) {
      claudePeerWindows.set(peerKey, peerWindow); // persist the prune even on reject
      return false;
    }
  }
  // Both ceilings have room — commit to both windows.
  claudeCallTimestamps.push(now);
  if (peerKey) {
    peerWindow.push(now);
    claudePeerWindows.set(peerKey, peerWindow);
  }
  return true;
}

/**
 * Build the cache key for a weather summary request. Lat/lon are quantised
 * to 2 decimal places (~1.1 km grid) so two clients in the same town share
 * one bucket — coarse enough that sub-kilometre jitter can't be used to
 * bust the cache on the paid Anthropic path, and harmless for a narrative
 * regional summary (the radar paragraph already surveys a 50–100 km disk).
 * Unit preferences are included verbatim so toggling Settings (°C → °F,
 * etc.) invalidates the cached entry — a stale summary built with the
 * previous unit set would render with the wrong numbers. Callers pass
 * already-validated units (see normalizeUnitParams) so junk values can't
 * inflate the key space.
 *
 * @param {Number} lat latitude in degrees
 * @param {Number} lon longitude in degrees
 * @param {String} lang locale string (en / fr / es)
 * @param {String} period summary period identifier
 * @param {String} tempUnit f / c / k
 * @param {String} speedUnit mph / ms / kmh
 * @param {String} distanceUnit mi / km
 * @returns {String} stable cache key
 */
const buildSummaryCacheKey = (lat, lon, lang, period, tempUnit, speedUnit, distanceUnit) =>
  `${lat.toFixed(2)}:${lon.toFixed(2)}:${lang}:${period}:${tempUnit}:${speedUnit}:${distanceUnit}`;

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

/**
 * Build the Messages API request for one summary. Kept pure so tests can
 * lock the request shape (test/aiSummaryClaudeReply.test.js): no sampling
 * params, no prefill, no `fallbacks` (a 400 on Haiku 5.5, or a no-op for
 * `fallbacks: "default"`, since the model has no server-side fallback).
 *
 * @param {String} prompt fully assembled user prompt
 * @param {Boolean} hasRadar whether the prompt carries the radar block
 * @returns {Object} params for client.messages.create
 */
function buildClaudeRequest(prompt, hasRadar) {
  return {
    model: CLAUDE_MODEL,
    max_tokens: hasRadar ? MAX_TOKENS_RADAR : MAX_TOKENS_NO_RADAR,
    thinking: CLAUDE_THINKING,
    output_config: { effort: CLAUDE_EFFORT },
    messages: [{ role: "user", content: prompt }],
  };
}

/**
 * Classify a Messages API reply and extract the summary text. Content
 * blocks are read by `type`, never by position: a Haiku 5.5 reply can open
 * with `thinking` blocks (empty text + signature), and a refusal or a cap
 * hit during thinking can carry no text block at all. Branches on
 * `stop_reason`, never on `stop_details` (which can be null). Never throws.
 *
 * Outcomes:
 *   - "refusal"   stop_reason "refusal" (safety classifier, still HTTP 200).
 *                 Any partial text is discarded, never served.
 *   - "empty"     no usable text (thinking only, whitespace, no content).
 *   - "truncated" text present but cut at max_tokens / the context window.
 *   - "ok"        any other reply with text.
 *
 * @param {Object} message Anthropic Messages API response
 * @returns {{outcome: String, text: String, stopReason: ?String, category: ?String}}
 *   `text` is "" unless the outcome is "ok" or "truncated"; `category` is the
 *   refusal category, as any string or null (the SDK union is wider than
 *   the four categories the docs list)
 */
function classifyClaudeReply(message) {
  const stopReason = message?.stop_reason ?? null;
  if (stopReason === "refusal") {
    return { outcome: "refusal", text: "", stopReason, category: message?.stop_details?.category ?? null };
  }
  const blocks = Array.isArray(message?.content) ? message.content : [];
  const text = blocks
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("")
    .trim();
  if (!text) return { outcome: "empty", text: "", stopReason, category: null };
  const truncated = stopReason === "max_tokens" || stopReason === "model_context_window_exceeded";
  return { outcome: truncated ? "truncated" : "ok", text, stopReason, category: null };
}

/**
 * One-line token-usage note for the service log and the debug snapshot.
 * Thinking tokens are already part of output_tokens (and billed as
 * output); they're split out so the effort / max_tokens choice can be
 * checked against real calls.
 *
 * @param {Object} [usage] message.usage
 * @returns {String} e.g. "in=1650 out=310 think=120" ("?" for a missing field)
 */
function formatUsage(usage) {
  const n = (v) => (Number.isFinite(v) ? v : "?");
  return `in=${n(usage?.input_tokens)} out=${n(usage?.output_tokens)} think=${n(usage?.output_tokens_details?.thinking_tokens)}`;
}

/**
 * Readable reason for a failed Anthropic call. The SDK builds err.message
 * as `${status} ${JSON.stringify(body)}`, so the old 100-char slice kept
 * only ~30 chars of the API's actual reason. Prefer the nested message.
 *
 * @param {Error & {status?: Number, error?: Object}} err
 * @returns {String} at most 160 chars
 */
function describeClaudeError(err) {
  const apiMessage = err?.error?.error?.message;
  const text = apiMessage ? `${err.status} ${apiMessage}` : (err?.message || "AI summary failed");
  return text.slice(0, 160);
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

// Localised prefix Claude is instructed to use as the first word(s) of
// the third paragraph (radar analysis). Pre-2.14.64 the prompt seeded
// the French "Analyse radar : " in every language and asked Claude to
// translate when not French — in practice Claude sometimes kept the
// French verbatim, producing English summaries that opened with the
// French label. Providing the exact target string per language keeps
// Claude on-rails. The label is part of the output contract:
// AiView's RADAR_PREFIX regex (client ambient/AiView) detects and strips
// it to build the radar section, and CALM_RADAR_BY_LANG must match it
// too. Pinned by test/aiSummaryClaudeReply.test.js.
const RADAR_PARAGRAPH_LABEL_BY_LANG = {
  en: "Radar analysis: ",
  fr: "Analyse radar : ",
  es: "Análisis radar: ",
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
  const key = getCacheKey("current", CURRENT_FIELDS_HASH, lat, lon);
  const entry = weatherCache[key];
  if (!entry || Date.now() > entry.expiresAt) return null;
  return entry.data;
}

function getDailyFromSharedCache(lat, lon) {
  const key = getCacheKey("daily", DAILY_FIELDS_HASH, lat, lon);
  const entry = weatherCache[key];
  if (!entry || Date.now() > entry.expiresAt) return null;
  return entry.data;
}

function getHourlyFromSharedCache(lat, lon) {
  const key = getCacheKey("hourly", HOURLY_FIELDS_HASH, lat, lon);
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
 * Returns 503 `{ reason: "no-key" }` if the Anthropic API key is not
 * configured (feature is optional — the clients hide it), and 502
 * `{ reason: "no-weather-data" }` when there is no weather data to
 * summarise right now (transient — the clients retry). The handler also
 * reads tempUnit / speedUnit / distanceUnit / localHour / ts18 / ts21 /
 * ts05tomorrow and can answer 400 / 429 / 500 / 502 — see docs/api.md
 * § GET /api/weather-summary for the full parameter and status list.
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
  const localHour  = parseInt(req.query.localHour, 10) || 0;
  const ts18       = parseInt(req.query.ts18, 10) || null;
  const ts21       = parseInt(req.query.ts21, 10) || null;
  const ts05tomorrow = parseInt(req.query.ts05tomorrow, 10) || null;
  const period     = getPeriod(localHour);
  // User language + unit preferences, snapped to known-good values. Invalid
  // or missing inputs default to metric/English — both so older clients
  // that don't pass these still get sensible output, and so junk values
  // can't expand the cache-key space on the paid Anthropic path.
  const { lang, tempUnit, speedUnit } = normalizeUnitParams(req.query);
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

  // Same rule as the boolean GET /settings masks for a remote client
  // (settingsCtrl.isApiKeyConfigured: missing, empty or the "key"
  // placeholder), so every client can learn this from its boot settings read.
  if (!isApiKeyConfigured("anthropicApiKey", settings.anthropicApiKey)) {
    return res.status(503).json({
      error: "Anthropic API key not configured",
      reason: SUMMARY_ERROR_REASON.NO_KEY,
    }).end();
  }

  const cacheKey = buildSummaryCacheKey(lat, lon, lang, period, tempUnit, speedUnit, distanceUnit);
  const cached = summaryCache[cacheKey];
  if (cached && Date.now() < cached.expiresAt) {
    return res.status(200).json({ summary: cached.summary, period: cached.periodKind ?? null }).end();
  }

  // ── In-flight coalescing on the billed path ───────────────────────────
  // Concurrent requests that miss the summary cache for the same key share
  // ONE build (one radar pipeline, one Claude call) instead of paying for
  // each. Late arrivals await the first request's settlement promise and
  // mirror its status/body. The map only ever holds keys actively being
  // built — entries are removed the moment the owning request settles
  // (every return path below goes through settleInflight, and a client
  // disconnect is caught by the `close` listener), so it needs no cap.
  const pending = inflightSummaries.get(cacheKey);
  if (pending) {
    const result = await pending;
    // The local kiosk is exempt from the billed-call ceiling (see
    // reserveClaudeCall below) — inheriting a remote owner's 429 through
    // the shared build would break that guarantee. In that one case,
    // fall through and run an own (exempt) build instead of mirroring.
    if (!(result.status === 429 && req.isLocal)) {
      return res.status(result.status).json(result.body).end();
    }
  }
  let resolveInflight;
  const inflightPromise = new Promise((resolve) => { resolveInflight = resolve; });
  inflightSummaries.set(cacheKey, inflightPromise);
  /**
   * Settle this request AND every coalesced waiter with the same outcome.
   *
   * @param {Number} status HTTP status to send
   * @param {*} body JSON body to send
   * @returns {import("express").Response}
   */
  const settleInflight = (status, body) => {
    // Identity-guarded like the close listener below: if THIS owner's
    // entry was already replaced (close fired mid-build, a successor
    // registered), deleting blindly would evict the successor's entry
    // and force a third full build for the next arrival.
    if (inflightSummaries.get(cacheKey) === inflightPromise) {
      inflightSummaries.delete(cacheKey);
    }
    resolveInflight({ status, body });
    return res.status(status).json(body).end();
  };
  res.once("close", () => {
    // Owner disconnected before settling (process didn't crash, the
    // response just closed early) — release the waiters with a retryable
    // failure instead of leaving them awaiting forever. The identity check
    // keeps a late `close` from touching a successor entry.
    if (inflightSummaries.get(cacheKey) === inflightPromise) {
      inflightSummaries.delete(cacheKey);
      resolveInflight({ status: 500, body: "AI summary failed" });
    }
  });

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
      // Go through the shared dispatch spacer so this re-fetch can't burst
      // alongside the proxy's current/hourly/daily calls and trip a 429.
      await spaceTomorrowCall();
      const result = await axios.get(
        `https://api.tomorrow.io/v4/timelines?location=${lat}%2C${lon}&fields=${fields}&timesteps=current&apikey=${settings.weatherApiKey}`,
        { timeout: 10_000 }
      );
      weatherData = result.data;
      // Same observability as the proxy path: without these, backfill
      // calls were invisible to the quota counter and service status
      // (only failures were recorded), understating real Tomorrow.io
      // usage on the debug panel.
      increment("tomorrow.io", "current");
      recordServiceCall("Tomorrow.io (current)", 200, "OK (AI summary backfill)");
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
  // Captured reason when the radar block ends up missing from the AI
  // prompt — surfaced through the debug-panel snapshot so post-mortem
  // diagnosis is one place instead of three (snapshot + service status
  // + log file). Set when the catch fires (analyzeRadar threw) OR when
  // analyzeRadar returns null (which happens silently inside the
  // function on RainViewer hiccups; the underlying status was already
  // logged via recordServiceCall, so we read it back here).
  let radarUnavailableReason = null;
  const aiSettings = settings?.advanced?.ai || {};
  const radarEnabled = aiSettings.radarAnalysisEnabled !== false; // default true
  if (!radarEnabled) {
    radarUnavailableReason = "radar analysis disabled in settings";
  } else {
    try {
      radarText = await analyzeRadar(lat, lon, {
        extendedRadius: Boolean(aiSettings.extendedRadius),
        distanceUnit,
      });
    } catch (err) {
      radarText = null;
      radarUnavailableReason = `analyzer threw: ${err?.message || "unknown error"}`;
      console.warn(`[ai-summary] analyzeRadar threw at ${lat},${lon}: ${err?.message || err}`);
    }
    if (!radarText && !radarUnavailableReason) {
      // analyzeRadar returned null without throwing. Internal failures
      // (RainViewer 502, no frames, etc.) are recorded by the analyzer
      // via recordServiceCall before the early-return — read that
      // entry back to surface the actual cause in the snapshot.
      const status = getServiceStatus()?.["RainViewer (analyzer)"];
      if (status && status.status && status.status !== 200) {
        radarUnavailableReason = `RainViewer ${status.status}: ${status.comment || "no detail"}`;
      } else if (status?.comment) {
        radarUnavailableReason = status.comment;
      } else {
        radarUnavailableReason = "analyzer returned null (no recorded status)";
      }
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
    setSummaryCache(cacheKey, { summary, periodKind, expiresAt: Date.now() + SUMMARY_CACHE_TTL });
    pushRadarSnapshot({
      lat, lon, lang, source: "fast-path",
      radarText: radarText || `(radar unavailable: ${radarUnavailableReason || "unknown"})`,
      summary,
    });
    recordServiceCall("Claude (AI summary)", 200, "calm-day fast path (no LLM call)");
    // Deliberately NOT incrementing the Anthropic counter — no API call was made.
    return settleInflight(200, { summary, period: periodKind });
  }

  // If none of the three sections has any content, there's nothing for
  // Claude to summarise. Pre-refactor, an empty currentLines couldn't happen
  // because we'd already 500'd; now we have to check. It is a data gap
  // (Tomorrow.io failing with cold caches and no radar), not a missing
  // feature, so 502 rather than 503: the clients read 503 as "no API key"
  // and used to hide the AI summary on a keyed install until a reload.
  const hasCurrent = Boolean(currentLines);
  const hasPeriod = Boolean(secondPeriodLabel);
  const hasRadar = Boolean(radarText);
  if (!hasCurrent && !hasPeriod && !hasRadar) {
    return settleInflight(502, {
      error: "No weather data available",
      reason: SUMMARY_ERROR_REASON.NO_WEATHER_DATA,
    });
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
      // Hard-code the localised radar-paragraph label per language —
      // see RADAR_PARAGRAPH_LABEL_BY_LANG comment for the rationale
      // (Claude was sometimes leaving the French seed in English
      // summaries).
      const radarLabel = RADAR_PARAGRAPH_LABEL_BY_LANG[lang] || RADAR_PARAGRAPH_LABEL_BY_LANG.en;
      return `The ${which} paragraph MUST start with the literal label "${radarLabel}" (in ${language}, exactly as written above — do not translate or rephrase the label) and describe ONLY what the radar shows right now relative to the user: where precipitation currently is, whether it is approaching based on movement between the three radar snapshots, and an estimated arrival time if a band is genuinely moving toward them. Do NOT reference the period forecast (paragraph ${paragraphSlots.indexOf("period") + 1 || "above"} already covers that) — the radar paragraph is strictly about radar observations. If the radar shows no precipitation in the surveyed annulus, say so plainly without speculating about future conditions. 1-3 sentences.`;
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
  // Haiku 4.5 sometimes drifted to English when the prompt was dense with imperial/US
  // unit tokens (°F, mph, miles) despite the opening "in {language}" — the same
  // English-anchoring that forced the hard-coded radar label (see
  // RADAR_PARAGRAPH_LABEL_BY_LANG). A closing reminder at highest recency
  // (immediately before generation) holds non-English summaries in their
  // language regardless of the unit system. Confirmed bug: fr/es + imperial
  // returned English; metric did not. English needs no reminder (it's the drift
  // target), so the reminder is scoped to non-English to keep that prompt lean.
  // Kept unchanged on Haiku 5.5 until a 5.5-only A/B shows it is no longer
  // needed (ROADMAP technical debt).
  const langReminder = lang !== "en"
    ? `\n\nWrite the entire summary in ${language}, regardless of the measurement units used in the data above.`
    : "";
  const prompt =
    `Write a weather summary entirely in ${language} with ${paragraphWord}, separated by a single blank line (\\n\\n). Each paragraph MUST stand on its own — never merge content that belongs to a different paragraph as a trailing sentence. ${instructions}${missingNote} ` +
    `Throughout your response, ${unitInstruction(tempUnit, speedUnit)}, and ${distanceUnitInstruction} for distances. Match the unit symbols exactly as shown in the data below — do not convert (the unit system does not change the language you write in). ` +
    `Be concise and conversational. Reply with plain text only — no title, no markdown, no labels before each paragraph (except the radar label described above).\n\n` +
    `${dataPayload}${langReminder}`;

  // Global denial-of-wallet ceiling: reject before spending if the process
  // has already made MAX_CLAUDE_CALLS_PER_MIN billed calls in the last
  // minute. The cache can't guarantee this (its key is jitterable); this
  // can. The local kiosk is exempt — it is trusted, makes ~one call per TTL
  // window, and must never have its own refresh starved by a remote client
  // saturating the budget (req.isLocal is set from the socket peer by the
  // app-level middleware in index.js). So the ceiling bounds REMOTE-induced
  // spend, which is the actual denial-of-wallet threat. Legitimate remote
  // traffic never approaches the bound.
  // Fall a missing socket peer into a shared "unknown-peer" bucket (matches
  // createPerPeerConcurrencyGuard) so a remote request is still sub-ceiling'd
  // rather than escaping the per-peer cap. The explicit null/omit skip stays
  // available for internal/test callers (see reserveClaudeCall's JSDoc).
  if (!req.isLocal && !reserveClaudeCall(req.socket?.remoteAddress || "unknown-peer")) {
    recordServiceCall("Claude (AI summary)", 429, "throttled (per-process call ceiling)");
    return settleInflight(429, "AI summary temporarily rate-limited");
  }

  try {
    // Retry / timeout rationale: see CLAUDE_MAX_RETRIES / CLAUDE_TIMEOUT_MS.
    const client = new Anthropic({
      apiKey: settings.anthropicApiKey,
      maxRetries: CLAUDE_MAX_RETRIES,
      timeout: CLAUDE_TIMEOUT_MS,
    });
    const message = await client.messages.create(buildClaudeRequest(prompt, hasRadar));
    // The call is billed whatever the reply holds, so count it before any
    // early return. Refusals and empty replies used to go uncounted.
    increment("anthropic", "summary");
    const reply = classifyClaudeReply(message);
    const usageNote = formatUsage(message.usage);
    const snapshotRadarText = hasRadar
      ? radarText
      : `(no radar block in prompt — ${radarUnavailableReason || "reason unknown"})`;

    if (reply.outcome === "refusal" || reply.outcome === "empty") {
      // Unusable reply. It is never cached: the next poll is the retry,
      // since Haiku 5.5 has no server-side fallback (a `fallbacks` model
      // list is a 400). It is kept in the debug ring so the input that triggered it
      // can be inspected, and recorded with a non-2xx sentinel so it can't
      // pass for a good call: 422 = declined by the safety classifier
      // (precedent: the synthetic 429 above), 502 = upstream answered with
      // no text (e.g. max_tokens hit during thinking). Never 503: the
      // clients read 503 as "no API key" and hide the feature.
      const comment = reply.outcome === "refusal"
        ? `refusal (category=${reply.category ?? "none"}, lang=${lang}; ${usageNote})`
        : `no text in reply (stop_reason=${reply.stopReason ?? "none"}, lang=${lang}; ${usageNote})`;
      pushRadarSnapshot({
        lat, lon, lang, source: `claude-${reply.outcome}`,
        radarText: snapshotRadarText,
        summary: "",
        stopReason: reply.stopReason,
        usage: usageNote,
      });
      recordServiceCall("Claude (AI summary)", reply.outcome === "refusal" ? 422 : 502, comment);
      return settleInflight(502, "AI summary failed");
    }

    const summary = reply.text;
    // Any stop other than end_turn is logged, so truncations stay visible
    // in server.log (max_tokens / context window → outcome "truncated").
    if (reply.stopReason !== "end_turn") {
      console.warn(`[ai-summary] Claude stopped early: stop_reason=${reply.stopReason}, lang=${lang}, ${usageNote}, summary tail="${summary.slice(-80)}"`);
    }
    const ttl = reply.outcome === "truncated" ? TRUNCATED_SUMMARY_TTL : SUMMARY_CACHE_TTL;
    setSummaryCache(cacheKey, { summary, periodKind, expiresAt: Date.now() + ttl });
    pushRadarSnapshot({
      lat, lon, lang, source: "claude",
      radarText: snapshotRadarText,
      summary,
      stopReason: reply.stopReason,
      usage: usageNote,
    });
    recordServiceCall(
      "Claude (AI summary)",
      200,
      reply.outcome === "truncated" ? `OK, truncated (${reply.stopReason}; ${usageNote})` : `OK (${usageNote})`
    );
    return settleInflight(200, { summary, period: periodKind });
  } catch (err) {
    const status = err?.status || 500;
    recordServiceCall("Claude (AI summary)", status, describeClaudeError(err));
    return settleInflight(500, "AI summary failed");
  }
}

module.exports = {
  getWeatherSummary,
  summaryCache,
  getRecentRadarSnapshots,
  // Exported for regression testing only — internal helpers, not part of
  // the public surface. See test/aiSummary.cache.test.js,
  // test/aiSummaryCalmPath.test.js and test/aiSummaryClaudeReply.test.js.
  __test: {
    buildSummaryCacheKey,
    SUMMARY_CACHE_TTL,
    SUMMARY_CACHE_MAX,
    normalizeUnitParams,
    setSummaryCache,
    reserveClaudeCall,
    MAX_CLAUDE_CALLS_PER_MIN,
    MAX_CLAUDE_CALLS_PER_MIN_PER_PEER,
    // Calm-day fast path (skips the billed Anthropic call)
    isRadarClear,
    isCalmStableState,
    buildCalmDayTemplate,
    getHourlyForecast,
    getPeriod,
    // Claude request / reply handling (Haiku 5.5)
    buildClaudeRequest,
    classifyClaudeReply,
    formatUsage,
    describeClaudeError,
    CLAUDE_MODEL,
    CLAUDE_EFFORT,
    MAX_TOKENS_RADAR,
    MAX_TOKENS_NO_RADAR,
    TRUNCATED_SUMMARY_TTL,
    // Output contract parsed by the client (AiView RADAR_PREFIX)
    RADAR_PARAGRAPH_LABEL_BY_LANG,
    CALM_RADAR_BY_LANG,
    // Error contract the clients base AI availability on (useAiSummary)
    SUMMARY_ERROR_REASON,
  },
};
