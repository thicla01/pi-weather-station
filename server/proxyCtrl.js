const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const axios = require("axios").default;
const { getSettingsData } = require("./settingsCtrl");
const { recordServiceCall } = require("./serviceStatus");
const { increment } = require("./requestCounter");
const { pruneObjectCache, BoundedMap } = require("./boundedCache");

/**
 * Field-set signature for a Tomorrow.io request. Used inside the cache
 * key so that when the list of requested fields changes between
 * releases (as it did in 2.14.2 when temperatureMax / temperatureMin /
 * weatherCodeMax / precipitationProbabilityMax were added for the v3
 * 5-day column strip), cached entries built against the old field set
 * become unreachable — the next lookup misses, refetches, and stores
 * a fresh entry with the new shape. Without this, the disk cache file
 * (loaded on startup) silently served old-shape responses for hours
 * after an upgrade. The HMIRaspi kiosk hit this on 2.14.4 → 2.14.5
 * upgrade and only recovered after a manual `rm weather-cache.json`
 * plus a coord change that rebuilt the cache entry.
 *
 * @param {string[]} fields — array of field names (the same array we
 *   feed to the Tomorrow.io `fields=` URL parameter)
 * @returns {string} short 8-hex-char SHA1 of the joined field list
 */
function hashFields(fields) {
  return crypto.createHash("sha1").update(fields.join(",")).digest("hex").slice(0, 8);
}

const ALLOWED_STYLES = ["dark-v10", "dark-v11", "light-v10", "light-v11", "navigation-day-v1", "streets-v12"];

/**
 * Custom Mapbox Studio styles (Protected visibility).
 * Maps a short style name to its full "username/style-id" path.
 * Tiles are served with the end-user's own Mapbox API key.
 */
const CUSTOM_STYLES = {
  "custom-light": "thicla01/cmoc9fbfs00c801s833rub3b7",
};

const API_TIMEOUT_MS = 10 * 1000;

// Single-retry policy for transient upstream weather errors. Tomorrow.io
// intermittently returns HTTP 5xx ("Temporary issue due to an unknown
// internal error" — recovers in <21 s) and 429 rate-limits (commonly from
// the synchronized current+hourly+daily+AI-summary burst hitting the API in
// the same second). One retry after a short backoff absorbs nearly all of
// these before the caller — and the health chip — ever sees a failure.
//
// Only fast-returning, genuinely transient statuses are retried: 429 and
// 5xx. Deterministic 4xx errors (invalid key, bad coordinates) are NOT
// retried — a retry just wastes a quota call and delays the inevitable
// error. Network errors / timeouts are also left un-retried: a timeout
// retry would add another full API_TIMEOUT_MS before the stale-on-error
// fallback kicks in, so we route those straight to the stale path instead.
const RETRY_BACKOFF_MS = 1500;

/**
 * Whether an axios error is a transient upstream blip worth one retry.
 * True only for HTTP 429 and 5xx (fast responses that typically clear on
 * a second attempt). Network errors / timeouts and all other 4xx return
 * false — see RETRY_BACKOFF_MS comment for the rationale.
 *
 * @param {*} err axios error
 * @returns {boolean}
 */
function isTransientError(err) {
  const status = err?.response?.status;
  if (typeof status !== "number") return false;
  return status === 429 || (status >= 500 && status <= 599);
}

/**
 * Runs an async thunk, retrying it exactly once after `backoffMs` if it
 * throws a transient error (see isTransientError). Non-transient errors
 * propagate immediately.
 *
 * @param {() => Promise<*>} fn the call to make (and possibly retry)
 * @param {number} [backoffMs] delay before the single retry
 * @returns {Promise<*>} the resolved value of `fn`
 */
async function retryTransient(fn, backoffMs = RETRY_BACKOFF_MS) {
  try {
    return await fn();
  } catch (err) {
    if (!isTransientError(err)) throw err;
    await new Promise((r) => setTimeout(r, backoffMs));
    return fn();
  }
}

// Minimum spacing between consecutive Tomorrow.io dispatches. The free
// tier caps bursts at ~3 requests/second; the client fires current +
// hourly + daily (and the AI-summary path re-fetches current), which used
// to land in the same instant and trip a 429. We serialize *dispatch
// times* — not completions — so calls still run concurrently on the wire,
// just kicked off >= this far apart. 350 ms keeps us comfortably under the
// per-second cap even if all four queue at once (~1.4 s to drain). This is
// the hard guarantee at the API-key boundary; the client also staggers its
// pollers (AppContext) as cheap defence-in-depth so they rarely queue here
// in the first place.
const TOMORROW_MIN_SPACING_MS = 350;

/**
 * Builds a dispatch spacer: returns an async function that resolves only
 * once at least `minSpacingMs` have elapsed since the previous resolution.
 * Calls chain, so N concurrent callers drain one per `minSpacingMs`. The
 * internal chain only ever awaits a timer (never rejects), so a failing
 * caller can't wedge the queue.
 *
 * @param {number} minSpacingMs minimum gap between successive dispatches
 * @returns {() => Promise<number>} await before each rate-limited call;
 *   resolves to the dispatch timestamp (ms)
 */
function createSpacer(minSpacingMs) {
  let tail = Promise.resolve(0);
  return function space() {
    const turn = tail.then(async (prevAt) => {
      const wait = Math.max(0, prevAt + minSpacingMs - Date.now());
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      return Date.now();
    });
    tail = turn;
    return turn;
  };
}

// Shared across every Tomorrow.io call site — the three proxy endpoints
// below and the AI-summary re-fetch in aiSummaryCtrl — so spacing is
// enforced at the key boundary regardless of how many clients drive the
// server (kiosk + remote viewers all share one API key).
const spaceTomorrowCall = createSpacer(TOMORROW_MIN_SPACING_MS);

/**
 * axios.get for the Tomorrow.io weather endpoints, wrapped with the
 * dispatch spacer + the single-retry transient policy. Carries the
 * standard API_TIMEOUT_MS so every outbound call still has a timeout.
 *
 * @param {string} url fully-formed request URL
 * @returns {Promise<import("axios").AxiosResponse>}
 */
async function weatherGet(url) {
  await spaceTomorrowCall();
  return retryTransient(() => axios.get(url, { timeout: API_TIMEOUT_MS }));
}

const WEATHER_CACHE_TTL = {
  current: 15 * 60 * 1000,
  hourly:  30 * 60 * 1000,
  daily:    6 * 60 * 60 * 1000,
};

/**
 * Tomorrow.io field lists per timestep granularity. Pulled out to
 * module scope so we can hash them once at startup (see hashFields).
 * The hash becomes part of every cache key, so adding/removing a
 * field in any of these arrays automatically invalidates the
 * corresponding cached entries — no need to manually rm the disk
 * cache after an upgrade that changes the request shape.
 *
 *   - Current adds uvIndex + epaIndex on top of the common subset
 *     because they're real-time read-outs in the InfoPanel, not
 *     values we chart over time.
 *   - Daily includes the Max/Min variants used by the v3 5-day
 *     column strip (DailyForecastColumns) on top of the avg fields
 *     the v2 Chart.js DailyChart still consumes.
 */
const CURRENT_FIELDS = [
  "temperature", "temperatureApparent", "humidity", "windSpeed", "precipitationIntensity",
  "precipitationType", "precipitationProbability", "cloudCover",
  "weatherCode", "uvIndex", "epaIndex",
  // v3.1 Phase 2 — surface pressure feeds the 4th metric tile of the
  // strict 2×2 grid (AQI moved out to the dedicated air card). Adding
  // the field bumps CURRENT_FIELDS_HASH, which orphans every cached
  // current entry on the fleet — one fresh fetch per Pi, no extra
  // request volume (the field travels in the same call).
  "pressureSurfaceLevel",
  // v3.2+ — the current-conditions Gust tile (MetricsGrid 2×2) reads
  // windGust from THIS timestep. It was never requested here, so the
  // tile rendered a permanent "—" while the Vent chart (HOURLY_FIELDS,
  // which does request windGust) showed gusts — a confusing mismatch.
  // Bumps CURRENT_FIELDS_HASH, orphaning cached current entries on the
  // fleet (one fresh fetch per Pi, no extra request volume — the field
  // travels in the same call).
  "windGust",
  // v3.3+ — the current-conditions Visibility tile (MetricsGrid 2×2 /
  // Conditions view) reads visibility from THIS timestep. It was never
  // requested here, so the tile rendered a permanent "—" for every
  // location. Same root cause and fix as windGust above. Bumps
  // CURRENT_FIELDS_HASH, orphaning cached current entries on the fleet
  // (one fresh fetch per Pi, no extra request volume — the field travels
  // in the same call).
  "visibility",
];
const HOURLY_FIELDS = [
  "temperature", "precipitationProbability", "precipitationIntensity", "windSpeed",
  // weatherCode added in 2.14.41 to render the icon column in
  // HourlyForecastColumns (the third view in the 24h tab cycle).
  // Adding to the list bumps HOURLY_FIELDS_HASH, which orphans every
  // cached hourly entry and forces a fresh fetch on next request — see
  // the cache-versioning rationale at the top of this file.
  "weatherCode",
  // v3.1 Phase 5 — the Vent tab charts gusts (dashed series) and a
  // wind-direction arrow row under the axis. Same hash-bump rationale
  // as above; no extra request volume (fields travel in the same call).
  "windGust", "windDirection",
];
const DAILY_FIELDS = [
  "temperature", "temperatureMax", "temperatureMin",
  "precipitationProbability", "precipitationProbabilityMax",
  "precipitationIntensity", "windSpeed", "weatherCodeMax",
  // v2.14.57 — enrich the maximized 5-day columns view with:
  //   - weatherCodeDay / weatherCodeNight  → icons split by day/night
  //     half (rather than the single agglomerated weatherCodeMax)
  //   - rainAccumulation / snowAccumulation → "how much will fall"
  //     surfaced under the precipitation probability percentage
  // Adding fields here bumps DAILY_FIELDS_HASH, which orphans every
  // cached daily entry on the fleet — fresh fetches on next request
  // pick up the new shape. No manual cache wipe needed.
  "weatherCodeDay", "weatherCodeNight",
  "rainAccumulation", "snowAccumulation",
  // v3.1 Phase 5 — daily Vent tab (gust ceiling + dominant direction
  // per day). Bumps DAILY_FIELDS_HASH like the entries above.
  "windGustMax", "windDirection",
  // v2.16.x — moonriseTime / moonsetTime feed the moon-phase chip's
  // tap-for-details popover (alongside locally-computed next full /
  // new moon dates). Adding to the list bumps DAILY_FIELDS_HASH and
  // orphans every cached daily entry on the fleet; fresh fetches on
  // next request pick up the new shape.
  "moonriseTime", "moonsetTime",
];

// Computed once at module load. Used in every cache key — see
// getCacheKey() for the rationale.
const CURRENT_FIELDS_HASH = hashFields(CURRENT_FIELDS);
const HOURLY_FIELDS_HASH = hashFields(HOURLY_FIELDS);
const DAILY_FIELDS_HASH = hashFields(DAILY_FIELDS);

const CACHE_FILE = path.join(__dirname, "weather-cache.json");

// How long past `expiresAt` we keep an entry around for stale-on-error
// fallback. When the upstream API returns 4xx/5xx/timeout we serve the
// last known good payload instead of error-ing the client, but only if
// that payload isn't ancient — 24 h is a deliberately generous bound:
// long enough to survive overnight outages and quota refresh windows
// (Tomorrow.io's free tier resets every 24 h) but short enough that
// "yesterday's weather" never gets shown as today's. After this window
// the entry is treated as if it didn't exist at all.
const MAX_STALE_MS = 24 * 60 * 60 * 1000;

// Hard cap on in-memory weather entries. The legitimate working set is ~3
// per location (current / hourly / daily), so this is a runaway guard: a
// remote client on an ALLOW_REMOTE Pi could otherwise walk lat/lon to grow
// the cache without bound. Enforced alongside the stale-window prune on the
// existing 5-min interval (see pruneWeatherCache below).
const WEATHER_CACHE_MAX = 512;

// ── Current-temperature smoothing ────────────────────────────────────────
// Tomorrow.io's `timesteps=current` product re-assimilates on every call and,
// at a fixed location, can jump ±2-3 °C between 15-min fetches (confirmed
// 2026-07-12 against a 5-day per-Pi capture: the raw feed showed non-physical
// evening rebounds of +2.4 °C in 15 min). The kiosk Hero renders the
// truncated integer, so that noise reads as the big number flickering
// 29→25→29 — and, because each Pi caches on its own 15-min phase, as
// neighbouring Pis disagreeing by 2-3 °C. We damp it with a short trailing
// moving average of the raw readings: over that 5-day sample it cut the count
// of ≥2 °C displayed jumps from 108 to 1, at the cost of ~15 min of lag.
// Applied server-side so every consumer (all Pis + the Sense HAT) benefits.
const CURRENT_SMOOTH_WINDOW = 3;       // recent fetches averaged (~45 min)
const CURRENT_SMOOTH_MAX_COORDS = 64;  // OOM guard: distinct locations tracked
// coordKey → [{ intervalStart, temperature, temperatureApparent }, …] (≤ window)
const currentTempHistory = new BoundedMap(CURRENT_SMOOTH_MAX_COORDS);

const weatherCache = {};
let cacheHits = 0;
let cacheMisses = 0;
let staleServed = 0;

function loadCacheFromDisk() {
  try {
    const raw = fs.readFileSync(CACHE_FILE, "utf8");
    const saved = JSON.parse(raw);
    const now = Date.now();
    let loaded = 0;
    let skipped = 0;
    for (const [key, entry] of Object.entries(saved)) {
      // Legacy entries (pre-2.14.6) had 3 colon-separated parts:
      // `type:lat:lon`. Current entries have 4: `type:hash:lat:lon`.
      // Skip the legacy shape so we don't serve cached responses that
      // were built against an obsolete field list — the lookup paths
      // below all generate 4-part keys now, so old entries would never
      // be hit anyway, but dropping them explicitly keeps the on-disk
      // file clean and the startup log honest.
      if (key.split(":").length !== 4) {
        skipped++;
        continue;
      }
      // Load entries that are either still fresh OR within the stale
      // recovery window. The stale ones aren't served by `getFromCache`
      // — they're only available via `getStaleFromCache` as a last-
      // resort fallback when an upstream fetch fails (rate limit, net
      // error, timeout). This is what makes the cache survive a Pi
      // restart during a Tomorrow.io 429 storm.
      if (entry.expiresAt > now - MAX_STALE_MS) {
        weatherCache[key] = entry;
        loaded++;
      }
    }
    if (loaded > 0) console.log(`[cache] Loaded ${loaded} entries from disk`);
    if (skipped > 0) console.log(`[cache] Skipped ${skipped} legacy entries (pre-2.14.6 schema)`);
  } catch {
    // File missing or unreadable — start with empty cache
  }
}

function saveCacheToDisk() {
  try {
    const now = Date.now();
    const toSave = {};
    // Same generosity as loadCacheFromDisk — persist entries within the
    // stale window so a daemon restart doesn't throw away the stale
    // fallback. Anything older than MAX_STALE_MS past expiry is
    // genuinely useless and gets pruned at save time, which is how the
    // file stays bounded.
    for (const [key, entry] of Object.entries(weatherCache)) {
      if (entry.expiresAt > now - MAX_STALE_MS) toSave[key] = entry;
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(toSave), "utf8");
  } catch (err) {
    console.error("[cache] Failed to save cache to disk:", err.message);
  }
}

// Prune the in-memory weatherCache the same way saveCacheToDisk prunes the
// on-disk snapshot: drop entries more than MAX_STALE_MS past expiry (the
// stale-fallback window), then cap total entries. Without this the on-disk
// file stayed bounded but the in-memory object grew without limit, since
// getFromCache deliberately keeps expired entries for stale-on-error use.
function pruneWeatherCache() {
  pruneObjectCache(weatherCache, { maxEntries: WEATHER_CACHE_MAX, graceMs: MAX_STALE_MS });
}

loadCacheFromDisk();
setInterval(() => {
  saveCacheToDisk();
  pruneWeatherCache();
}, 5 * 60 * 1000).unref();

/**
 * @param {string} type — `current` / `hourly` / `daily`
 * @param {string} fieldsHash — 8-char field-set signature (see hashFields)
 * @param {number} lat — latitude (4-decimal precision in the key)
 * @param {number} lon — longitude
 * @returns {string} cache key
 */
function getCacheKey(type, fieldsHash, lat, lon) {
  return `${type}:${fieldsHash}:${lat.toFixed(4)}:${lon.toFixed(4)}`;
}

function getFromCache(key) {
  const entry = weatherCache[key];
  if (!entry) {
    cacheMisses++;
    console.log(`[cache] MISS  ${key}`);
    return null;
  }
  if (Date.now() > entry.expiresAt) {
    // No longer delete on expiry — keep the entry around for up to
    // MAX_STALE_MS so `getStaleFromCache` can serve it as a fallback
    // when an upstream fetch fails. The next save-to-disk pass will
    // either re-persist it (if still within the stale window) or
    // drop it (if it's truly ancient). saveCacheToDisk handles the
    // bounded-growth guarantee.
    cacheMisses++;
    console.log(`[cache] EXPIRED ${key}`);
    return null;
  }
  cacheHits++;
  const remainingSec = Math.round((entry.expiresAt - Date.now()) / 1000);
  console.log(`[cache] HIT  ${key} (expires in ${remainingSec}s)`);
  return entry.data;
}

/**
 * Stale-on-error lookup: returns a cached entry even if past its
 * `expiresAt`, as long as it's within the MAX_STALE_MS recovery
 * window. Used by the three Tomorrow.io fetch endpoints as a fallback
 * when the upstream call fails (429 rate-limit, network error,
 * timeout) — instead of returning an error to the client we hand back
 * the last known good payload, so the UI keeps reading rather than
 * blanking to "—". Returns `null` if no entry exists or it's beyond
 * the stale window.
 *
 * Tracked separately from regular hits/misses via `staleServed` so the
 * debug panel can surface how often we're falling back to stale data
 * (a useful signal when investigating fleet-wide quota pressure).
 *
 * @param {string} key cache key (`type:fieldsHash:lat:lon`)
 * @returns {*|null} the cached `data` payload, or null
 */
function getStaleFromCache(key) {
  const entry = weatherCache[key];
  if (!entry) return null;
  const ageMs = Date.now() - entry.expiresAt;
  if (ageMs > MAX_STALE_MS) return null;
  staleServed++;
  const ageMin = Math.round(ageMs / 1000 / 60);
  console.log(`[cache] STALE  ${key} (${ageMin}m past expiry)`);
  return entry.data;
}

function getCacheStats() {
  const total = cacheHits + cacheMisses;
  return {
    hits: cacheHits,
    misses: cacheMisses,
    rate: total > 0 ? Math.round((100 * cacheHits) / total) : null,
    // Number of times a stale entry was served as fallback after an
    // upstream fetch failed (rate-limit, network error, timeout). High
    // values indicate fleet-wide quota pressure or upstream instability.
    staleServed,
  };
}

function setInCache(key, data, ttl) {
  weatherCache[key] = { data, expiresAt: Date.now() + ttl };
  console.log(`[cache] SET  ${key} (ttl ${ttl / 1000}s)`);
}

/**
 * Mean of the finite numbers in `nums`, rounded to 2 decimals. Returns null
 * when no finite value is present (so callers can fall back to the raw field).
 *
 * @param {number[]} nums
 * @returns {number|null}
 */
function roundedMean(nums) {
  const finite = nums.filter((n) => Number.isFinite(n));
  if (finite.length === 0) return null;
  const sum = finite.reduce((acc, n) => acc + n, 0);
  return Math.round((sum / finite.length) * 100) / 100;
}

/**
 * Record a fresh raw `current` reading for a location and return the trailing
 * moving average over the last CURRENT_SMOOTH_WINDOW readings. Deduplicated by
 * `intervalStart` (a payload re-served for the same instant never double-
 * counts), trimmed to the window, with the coord map bounded to guard OOM.
 *
 * @param {string} coordKey            stable per-location key
 * @param {string} intervalStart       the reading's own timestamp (dedup key)
 * @param {number} temperature         raw °C from Tomorrow.io
 * @param {number} temperatureApparent raw feels-like °C
 * @returns {{temperature: (number|null), temperatureApparent: (number|null)}}
 *   trailing-average values (null when no finite input exists)
 */
function pushAndSmoothCurrent(coordKey, intervalStart, temperature, temperatureApparent) {
  const hist = currentTempHistory.get(coordKey) || [];
  const reading = { intervalStart, temperature, temperatureApparent };
  if (hist.length > 0 && hist[hist.length - 1].intervalStart === intervalStart) {
    hist[hist.length - 1] = reading;   // same instant re-served — replace, don't stack
  } else {
    hist.push(reading);
  }
  while (hist.length > CURRENT_SMOOTH_WINDOW) hist.shift();
  currentTempHistory.set(coordKey, hist);
  return {
    temperature: roundedMean(hist.map((r) => r.temperature)),
    temperatureApparent: roundedMean(hist.map((r) => r.temperatureApparent)),
  };
}

/**
 * In-place: replace the raw `current` temperature and apparent temperature in
 * a Tomorrow.io payload with their trailing-average values (recording the raw
 * reading first). No-op if the payload shape is unexpected or `temperature`
 * is absent — the raw body is then served untouched. Other fields
 * (weatherCode, wind, humidity…) are deliberately left raw.
 *
 * @param {object} payload Tomorrow.io response body (axios `result.data`)
 * @param {number} lat
 * @param {number} lon
 */
function smoothCurrentPayload(payload, lat, lon) {
  const interval = payload?.data?.timelines?.[0]?.intervals?.[0];
  const values = interval?.values;
  if (!values || typeof values.temperature !== "number") return;
  const coordKey = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  const smoothed = pushAndSmoothCurrent(
    coordKey, interval.startTime, values.temperature, values.temperatureApparent
  );
  if (smoothed.temperature !== null) {
    values.temperature = smoothed.temperature;
  }
  if (smoothed.temperatureApparent !== null && typeof values.temperatureApparent === "number") {
    values.temperatureApparent = smoothed.temperatureApparent;
  }
}

/**
 * Proxy: reverse geocode via LocationIQ, keeping the API key server-side
 *
 * @param {Object} req
 * @param {Object} req.query
 * @param {String} req.query.lat
 * @param {String} req.query.lon
 * @param {Object} res
 */
async function reverseGeocode(req, res) {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);

  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return res.status(400).json("Invalid coordinates").end();
  }

  let settings;
  try {
    settings = await getSettingsData();
  } catch {
    return res.status(500).json("Could not read settings").end();
  }

  if (!settings.reverseGeoApiKey) {
    return res.status(503).json("Reverse geocoding API key not configured").end();
  }

  try {
    const result = await axios.get(
      `https://us1.locationiq.com/v1/reverse.php?key=${settings.reverseGeoApiKey}&lat=${lat}&lon=${lon}&format=json`,
      { timeout: API_TIMEOUT_MS }
    );
    increment("locationiq", "geocode");
    recordServiceCall("LocationIQ", 200, "OK");
    return res.status(200).json(result.data).end();
  } catch (err) {
    const status = err?.response?.status || 500;
    const message = err?.response?.data?.error || "Reverse geocoding failed";
    increment("locationiq", "geocode");
    // 404 from LocationIQ on a reverse geocode means "no address
    // for this coordinate" (ocean, undeveloped area). The service
    // is responding correctly — there's just no data. Record it
    // as success so the health classifier doesn't paint a panicked
    // red dot, and return 204 No Content to the client so devtools
    // doesn't log it as a network error either. The client's
    // reverseGeocode service resolves 204 to null and the caller
    // falls back to displaying lat/lon.
    if (status === 404) {
      recordServiceCall("LocationIQ", 200, "no address for coord");
      return res.status(204).end();
    }
    recordServiceCall("LocationIQ", status, message);
    return res.status(500).json("Reverse geocoding failed").end();
  }
}

/**
 * Proxy: Mapbox map tiles, keeping the API key server-side
 *
 * @param {Object} req
 * @param {Object} req.params
 * @param {String} req.params.style  Mapbox style (dark-v10 or light-v10)
 * @param {String} req.params.z      Zoom level
 * @param {String} req.params.x      Tile x coordinate
 * @param {String} req.params.y      Tile y coordinate
 * @param {Object} res
 */
async function mapTile(req, res) {
  const { style, z, x, y } = req.params;

  if (!ALLOWED_STYLES.includes(style) && !CUSTOM_STYLES[style]) {
    return res.status(400).json("Invalid map style").end();
  }

  const zNum = parseInt(z, 10);
  const xNum = parseInt(x, 10);
  const yNum = parseInt(y, 10);

  if ([zNum, xNum, yNum].some(isNaN) || zNum < 0 || zNum > 22) {
    return res.status(400).json("Invalid tile coordinates").end();
  }

  let settings;
  try {
    settings = await getSettingsData();
  } catch {
    return res.status(500).json("Could not read settings").end();
  }

  if (!settings.mapApiKey) {
    return res.status(503).json("Map API key not configured").end();
  }

  const stylePath = CUSTOM_STYLES[style] ?? `mapbox/${style}`;
  // Custom styles require an explicit tile size; built-in mapbox styles work without it.
  const tileUrl = CUSTOM_STYLES[style]
    ? `https://api.mapbox.com/styles/v1/${stylePath}/tiles/256/${zNum}/${xNum}/${yNum}?access_token=${settings.mapApiKey}`
    : `https://api.mapbox.com/styles/v1/${stylePath}/tiles/${zNum}/${xNum}/${yNum}?access_token=${settings.mapApiKey}`;

  try {
    const result = await axios.get(
      tileUrl,
      { responseType: "arraybuffer", timeout: API_TIMEOUT_MS }
    );

    const contentType = result.headers["content-type"];
    const cacheControl = result.headers["cache-control"];
    if (contentType) res.setHeader("Content-Type", contentType);
    if (cacheControl) res.setHeader("Cache-Control", cacheControl);

    increment("mapbox", "tiles");
    recordServiceCall("Mapbox", 200, "OK");
    return res.status(200).send(Buffer.from(result.data));
  } catch (err) {
    const status = err?.response?.status || 500;
    const message = err?.response?.data || "Could not fetch map tile";
    increment("mapbox", "tiles");
    recordServiceCall("Mapbox", status, String(message).slice(0, 100));
    return res.status(500).json("Could not fetch map tile").end();
  }
}

/**
 * Proxy: Tomorrow.io current weather, keeping the API key server-side
 *
 * @param {Object} req
 * @param {Object} req.query
 * @param {String} req.query.lat
 * @param {String} req.query.lon
 * @param {Object} res
 */
async function weatherCurrent(req, res) {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);

  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return res.status(400).json("Invalid coordinates").end();
  }

  let settings;
  try {
    settings = await getSettingsData();
  } catch {
    return res.status(500).json("Could not read settings").end();
  }

  if (!settings.weatherApiKey) {
    return res.status(503).json("Weather API key not configured").end();
  }

  const fields = CURRENT_FIELDS.join("%2c");
  const cacheKey = getCacheKey("current", CURRENT_FIELDS_HASH, lat, lon);
  const cached = getFromCache(cacheKey);
  if (cached) return res.status(200).json(cached).end();

  try {
    const result = await weatherGet(
      `https://api.tomorrow.io/v4/timelines?location=${lat}%2C${lon}&fields=${fields}&timesteps=current&apikey=${settings.weatherApiKey}`
    );
    // Damp the noisy raw feed before caching, so the cached + served payload
    // (and every downstream consumer) carries the smoothed temperature.
    smoothCurrentPayload(result.data, lat, lon);
    setInCache(cacheKey, result.data, WEATHER_CACHE_TTL.current);
    increment("tomorrow.io", "current");
    recordServiceCall("Tomorrow.io (current)", 200, "OK");
    return res.status(200).json(result.data).end();
  } catch (err) {
    const status = err?.response?.status || 500;
    const message = err?.response?.data?.message || err?.response?.data || "Weather request failed";
    increment("tomorrow.io", "current");
    recordServiceCall("Tomorrow.io (current)", status, String(message).slice(0, 100));
    // Stale-on-error: if a past payload is within the recovery window
    // (24 h), serve it instead of erroring. The serviceStatus row above
    // still records the upstream failure so the debug panel reflects
    // reality; the user just doesn't see the UI blank to "—". Returns
    // 200 because the response carries real data — clients can treat
    // it as fresh for charting purposes.
    const stale = getStaleFromCache(cacheKey);
    if (stale) return res.status(200).json(stale).end();
    return res.status(status).json(message).end();
  }
}

/**
 * Proxy: Tomorrow.io hourly weather, keeping the API key server-side
 *
 * @param {Object} req
 * @param {Object} req.query
 * @param {String} req.query.lat
 * @param {String} req.query.lon
 * @param {Object} res
 */
async function weatherHourly(req, res) {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);

  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return res.status(400).json("Invalid coordinates").end();
  }

  let settings;
  try {
    settings = await getSettingsData();
  } catch {
    return res.status(500).json("Could not read settings").end();
  }

  if (!settings.weatherApiKey) {
    return res.status(503).json("Weather API key not configured").end();
  }

  const fields = HOURLY_FIELDS.join("%2c");
  const endTime = new Date(Date.now() + 60 * 60 * 23 * 1000).toISOString();

  const cacheKey = getCacheKey("hourly", HOURLY_FIELDS_HASH, lat, lon);
  const cached = getFromCache(cacheKey);
  if (cached) return res.status(200).json(cached).end();

  try {
    const result = await weatherGet(
      `https://api.tomorrow.io/v4/timelines?location=${lat}%2C${lon}&fields=${fields}&timesteps=1h&apikey=${settings.weatherApiKey}&endTime=${endTime}`
    );
    setInCache(cacheKey, result.data, WEATHER_CACHE_TTL.hourly);
    increment("tomorrow.io", "hourly");
    recordServiceCall("Tomorrow.io (hourly)", 200, "OK");
    return res.status(200).json(result.data).end();
  } catch (err) {
    const status = err?.response?.status || 500;
    const message = err?.response?.data?.message || err?.response?.data || "Weather request failed";
    increment("tomorrow.io", "hourly");
    recordServiceCall("Tomorrow.io (hourly)", status, String(message).slice(0, 100));
    // Stale-on-error fallback — see weatherCurrent for the rationale.
    const stale = getStaleFromCache(cacheKey);
    if (stale) return res.status(200).json(stale).end();
    return res.status(status).json(message).end();
  }
}

/**
 * Proxy: Tomorrow.io daily weather, keeping the API key server-side
 *
 * @param {Object} req
 * @param {Object} req.query
 * @param {String} req.query.lat
 * @param {String} req.query.lon
 * @param {Object} res
 */
async function weatherDaily(req, res) {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);

  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return res.status(400).json("Invalid coordinates").end();
  }

  let settings;
  try {
    settings = await getSettingsData();
  } catch {
    return res.status(500).json("Could not read settings").end();
  }

  if (!settings.weatherApiKey) {
    return res.status(503).json("Weather API key not configured").end();
  }

  const fields = DAILY_FIELDS.join("%2c");
  const endTime = new Date(Date.now() + 4 * 60 * 60 * 24 * 1000).toISOString();

  const cacheKey = getCacheKey("daily", DAILY_FIELDS_HASH, lat, lon);
  const cached = getFromCache(cacheKey);
  if (cached) return res.status(200).json(cached).end();

  try {
    const result = await weatherGet(
      `https://api.tomorrow.io/v4/timelines?location=${lat}%2C${lon}&fields=${fields}&timesteps=1d&apikey=${settings.weatherApiKey}&endTime=${endTime}`
    );
    setInCache(cacheKey, result.data, WEATHER_CACHE_TTL.daily);
    increment("tomorrow.io", "daily");
    recordServiceCall("Tomorrow.io (daily)", 200, "OK");
    return res.status(200).json(result.data).end();
  } catch (err) {
    const status = err?.response?.status || 500;
    const message = err?.response?.data?.message || err?.response?.data || "Weather request failed";
    increment("tomorrow.io", "daily");
    recordServiceCall("Tomorrow.io (daily)", status, String(message).slice(0, 100));
    // Stale-on-error fallback — see weatherCurrent for the rationale.
    const stale = getStaleFromCache(cacheKey);
    if (stale) return res.status(200).json(stale).end();
    return res.status(status).json(message).end();
  }
}

/**
 * Proxy: sunrise-sunset.org, avoiding mixed-content issues and enabling service tracking.
 *
 * Response shape:
 *   - Default (no `tomorrow` param): pass-through of the upstream JSON
 *     `{ status, results: {...} }`. Preserved for backward compatibility
 *     with any caller that only needs today.
 *   - With `tomorrow=1`: enriches into
 *     `{ status, results: {...today...}, tomorrowResults: {...tomorrow...} }`
 *     where `tomorrowResults` is the result of a second upstream call
 *     for the day after `date` (or after today UTC if no date supplied).
 *     Both upstream calls run in parallel. The tomorrow call's failure
 *     does NOT fail the whole response — `tomorrowResults` is omitted
 *     and the today payload is still returned (the SunDetailsPopover
 *     degrades to em-dashes for the tomorrow rows).
 *
 * @param {Object} req
 * @param {Object} req.query
 * @param {String} req.query.lat
 * @param {String} req.query.lon
 * @param {String} [req.query.date]      YYYY-MM-DD, local date for "today"
 * @param {String} [req.query.tomorrow]  truthy → also fetch the day after `date`
 * @param {Object} res
 */
async function sunriseSunset(req, res) {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);

  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return res.status(400).json("Invalid coordinates").end();
  }

  // Optional `date` parameter (YYYY-MM-DD) is forwarded to the
  // upstream API. The client passes its LOCAL date so the returned
  // sunrise / sunset belong to the user's day. Without it the API
  // defaults to "today UTC" — and for users west of UTC during
  // evening hours that's already the next UTC day, which means
  // the response skips over today's local sunset and the auto
  // dark-mode toggle flips early. Strict regex match so a junk
  // value can't reach the upstream URL.
  const todayDate = typeof req.query.date === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
    ? req.query.date
    : null;
  const dateParam = todayDate ? `&date=${todayDate}` : "";

  // Compute tomorrow's YYYY-MM-DD from `date` (or from today UTC if
  // none was supplied). Done locally via Date arithmetic so we don't
  // round-trip a third upstream call just to learn the date.
  const wantsTomorrow = Boolean(req.query.tomorrow);
  let tomorrowParam = "";
  if (wantsTomorrow) {
    const base = todayDate ? new Date(`${todayDate}T12:00:00Z`) : new Date();
    base.setUTCDate(base.getUTCDate() + 1);
    const y = base.getUTCFullYear();
    const m = String(base.getUTCMonth() + 1).padStart(2, "0");
    const d = String(base.getUTCDate()).padStart(2, "0");
    tomorrowParam = `&date=${y}-${m}-${d}`;
  }

  try {
    const todayPromise = axios.get(
      `https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lon}&formatted=0${dateParam}`,
      { timeout: API_TIMEOUT_MS }
    );
    const tomorrowPromise = wantsTomorrow
      ? axios.get(
        `https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lon}&formatted=0${tomorrowParam}`,
        { timeout: API_TIMEOUT_MS }
      ).catch((err) => {
        // Tomorrow's failure is non-fatal — log and return null so the
        // main response still ships today's data. `Promise.all` below
        // would otherwise reject the whole thing for one bad call.
        recordServiceCall("sunrise-sunset.org", err?.response?.status || 500,
          `tomorrow: ${String(err?.message || "fail").slice(0, 80)}`);
        return null;
      })
      : Promise.resolve(null);

    const [todayRes, tomorrowRes] = await Promise.all([todayPromise, tomorrowPromise]);
    recordServiceCall("sunrise-sunset.org", 200, wantsTomorrow ? "OK (+tomorrow)" : "OK");
    const payload = { ...todayRes.data };
    if (tomorrowRes && tomorrowRes.data && tomorrowRes.data.results) {
      payload.tomorrowResults = tomorrowRes.data.results;
    }
    return res.status(200).json(payload).end();
  } catch (err) {
    const status = err?.response?.status || 500;
    const message = err?.response?.data?.status || "Sunrise/sunset request failed";
    recordServiceCall("sunrise-sunset.org", status, String(message).slice(0, 100));
    return res.status(500).json("Sunrise/sunset request failed").end();
  }
}

module.exports = {
  reverseGeocode, mapTile, weatherCurrent, weatherHourly, weatherDaily,
  sunriseSunset, weatherCache, saveCacheToDisk, getCacheStats,
  // Exposed so aiSummaryCtrl can read entries from the shared in-memory
  // cache using the SAME versioned key schema proxyCtrl writes with.
  // Before this export the controller had its own 3-part lookup helpers
  // (`hourly:<lat>:<lon>`) which silently missed every entry after the
  // 2026-05-13 schema bump to `type:fieldsHash:lat:lon` — paragraph 2 of
  // the AI summary disappeared as a result (no hourly data → no forecast
  // section → no daily fallback either). Keep these in sync if the
  // proxyCtrl cache key shape ever changes again.
  getCacheKey, CURRENT_FIELDS_HASH, HOURLY_FIELDS_HASH, DAILY_FIELDS_HASH,
  // Shared Tomorrow.io dispatch spacer — awaited by aiSummaryCtrl before
  // its own re-fetch so spacing is enforced at the API-key boundary across
  // every call site, not just the three proxy endpoints here.
  spaceTomorrowCall,
  // Pure helpers exposed for unit tests — keeps the public surface clean
  // while letting test/proxyRetry.test.js exercise the retry + spacing.
  __test: {
    isTransientError, retryTransient, createSpacer,
    roundedMean, pushAndSmoothCurrent, smoothCurrentPayload,
    currentTempHistory, CURRENT_SMOOTH_WINDOW,
  },
};
