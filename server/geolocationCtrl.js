// Geolocation controller — proxies ipapi.co to obtain a default lat/lon
// based on the device's public IP. Robust against three failure modes that
// matter on a kiosk Pi:
//
//   1. Transient unavailability — DNS not yet ready, default route not yet
//      installed, etc. Common in the first 1-3 seconds after pi-weather-server
//      starts on cold boot. Mitigated with retry-with-backoff, for the errors
//      a retry can fix: network errors, timeouts and 5xx — and, when there is
//      no cache to serve, ipapi.co's 429 rate limit, which sometimes clears
//      within seconds (seen on P9, 2026-11-16: a 200 on the 3rd attempt after
//      two 429s), though not always. Other 4xx are never retried.
//
//   2. Persistent unavailability — ipapi.co down, network unreachable, IPv6
//      misconfigured by the LAN, etc. Mitigated with a disk cache that
//      survives reboots: once we've succeeded once, future boots return the
//      cached value immediately even if the live fetch fails again.
//
//   3. An expired cache while ipapi.co refuses (stale-while-revalidate,
//      2026-11). Before, a cache older than CACHE_MAX_AGE_MS made every
//      GET /geolocation wait for the full retry sequence (~15 s of back-off
//      when ipapi.co answered 429) before falling back to that same cache —
//      and the client waits for /geolocation at boot, so every page load of a
//      kiosk without a manual location took ~15 s longer (seen on P9,
//      2026-11-16: page boots of ~25.5 s instead of ~11 s until a retry got
//      through). Now an expired cache is served at once and refreshed in the
//      background: one refresh at a time, and after a failed one, none before
//      a cooldown (longer after a 429), so the reloads of a busy kiosk don't
//      keep the rate limit alive either.
//
// The cached location for a given Pi rarely changes (it's tied to the public
// IP, which is usually stable for residential connections), so a disk cache
// with a generous TTL — and serving it past that TTL, at any age, while a
// refresh is attempted — is essentially free correctness. The one case it
// costs: a kiosk that moved (new public IP) gets its old location once, on
// the first request after the move (e.g. the Places reset to automatic after
// months on a manual location, when nothing read the cache); the background
// refresh then fixes it for the next request.

const fs = require("fs");
const path = require("path");
const axios = require("axios").default;
const { recordServiceCall } = require("./serviceStatus");
const { increment } = require("./requestCounter");

const DEFAULT_CACHE_FILE = path.join(__dirname, "geolocation-cache.json");
const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const FETCH_TIMEOUT_MS = 10 * 1000;

// Retry policy. Back-off between 5 attempts: 1, 2, 4, 8 seconds
// (15 s total), plus up to FETCH_TIMEOUT_MS (10 s) per attempt, so
// ~65 s worst case. MAX_DELAY_MS (16 s) is never reached at
// MAX_ATTEMPTS = 5. A non-retryable error (see isRetryable) ends the
// sequence at once.
const MAX_ATTEMPTS    = 5;
const INITIAL_DELAY_MS = 1000;
const MAX_DELAY_MS    = 16 * 1000;

// After a failed background refresh of an expired cache, the next one waits:
// REFRESH_COOLDOWN_MS in general, RATE_LIMIT_COOLDOWN_MS after a 429.
const REFRESH_COOLDOWN_MS    = 15 * 60 * 1000;
const RATE_LIMIT_COOLDOWN_MS = 60 * 60 * 1000;

let memCache = null;        // { latitude, longitude, fetchedAtMs }
let loaded = false;         // the disk cache is read once, on the first request
let firstFetch = null;      // the shared blocking fetch when there is no cache at all
let refresh = null;         // the background refresh of an expired cache
let nextRefreshAtMs = 0;    // no background refresh before this time (cooldown)

// Injectable for the tests (__test.configure); the defaults are the real ones.
let deps = {
  cacheFile: DEFAULT_CACHE_FILE,
  fetchOnce: defaultFetchOnce,
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

function loadCacheFromDisk() {
  try {
    const raw = fs.readFileSync(deps.cacheFile, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed.latitude === "number" && typeof parsed.longitude === "number" && typeof parsed.fetchedAtMs === "number") {
      memCache = parsed;
      console.log(
        "[geolocation] Loaded cached coords from disk (age %dh)",
        Math.round((deps.now() - parsed.fetchedAtMs) / 1000 / 60 / 60)
      );
    }
  } catch {
    // No cache yet — fine
  }
}

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  loadCacheFromDisk();
}

function saveCacheToDisk(data) {
  try {
    fs.writeFileSync(deps.cacheFile, JSON.stringify(data), "utf8");
  } catch (err) {
    console.error("[geolocation] Failed to save cache to disk:", err.message);
  }
}

function setCache(coords) {
  memCache = { latitude: coords.latitude, longitude: coords.longitude, fetchedAtMs: deps.now() };
  saveCacheToDisk(memCache);
}

async function defaultFetchOnce() {
  const result = await axios.get("https://ipapi.co/json/", { timeout: FETCH_TIMEOUT_MS });
  const { latitude, longitude } = result.data;
  if (typeof latitude !== "number" || typeof longitude !== "number") {
    throw new Error("Invalid response shape from ipapi.co");
  }
  return { latitude, longitude };
}

/**
 * Whether a failed fetch is worth retrying a second later: a network error,
 * a timeout (incl. 408), a 5xx or an answer without coordinates (no HTTP
 * status) may pass. A 429 may pass a second or two
 * later but often does not, and each try costs a call against a rate-limited
 * IP: it is retried only when asked (no cache to serve). Other 4xx never are.
 *
 * @param {*} err - The error thrown by fetchOnce.
 * @param {boolean} [retry429=false] - Whether a 429 counts as retryable.
 * @returns {boolean} True when another attempt makes sense.
 */
function isRetryable(err, retry429 = false) {
  const status = err?.response?.status;
  if (typeof status !== "number") return true;
  if (retry429 && status === 429) return true;
  return status >= 500 || status === 408;
}

/**
 * Fetch the coordinates, with retry-with-backoff on the retryable errors.
 *
 * @param {{retry429?: boolean}} [options] - retry429: retry a 429 too (the no-cache path).
 * @returns {Promise<{latitude: number, longitude: number}>} The coordinates; rejects with the last error.
 */
async function fetchWithRetry({ retry429 = false } = {}) {
  let delay = INITIAL_DELAY_MS;
  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const coords = await deps.fetchOnce();
      if (attempt > 1) {
        console.log("[geolocation] Fetched on attempt %d/%d", attempt, MAX_ATTEMPTS);
      }
      return coords;
    } catch (err) {
      lastErr = err;
      const reason = err?.response?.status || err?.code || err?.message || "unknown error";
      if (!isRetryable(err, retry429)) {
        console.log("[geolocation] Attempt %d/%d failed (%s); not retried", attempt, MAX_ATTEMPTS, reason);
        break;
      }
      if (attempt < MAX_ATTEMPTS) {
        console.log(
          "[geolocation] Attempt %d/%d failed (%s); retrying in %dms",
          attempt, MAX_ATTEMPTS, reason, delay
        );
        await deps.sleep(delay);
        delay = Math.min(delay * 2, MAX_DELAY_MS);
      }
    }
  }
  throw lastErr;
}

/**
 * Record a failed fetch for the Debug panel and /api/health.
 *
 * @param {*} err - The error thrown by fetchWithRetry.
 * @returns {number} The HTTP status recorded (500 when none), which picks the cooldown.
 */
function recordFailure(err) {
  const status = err?.response?.status || 500;
  const reason = err?.response?.data?.reason;
  const message = typeof reason === "string" ? reason : (err?.code || "Geolocation failed");
  recordServiceCall("ipapi.co", status, String(message).slice(0, 100));
  return status;
}

/**
 * Start the background refresh of an expired cache, unless one is running
 * or the cooldown after a failed one has not elapsed.
 *
 * @returns {Promise<void>|null} The running refresh, or null when none was started.
 */
function startBackgroundRefresh() {
  // A cooldown further away than the longest one means the clock stepped
  // back since it was set: cap it rather than wait out the step.
  nextRefreshAtMs = Math.min(nextRefreshAtMs, deps.now() + RATE_LIMIT_COOLDOWN_MS);
  if (refresh || deps.now() < nextRefreshAtMs) return null;
  const ageDays = Math.floor((deps.now() - memCache.fetchedAtMs) / 86_400_000);
  console.log("[geolocation] Cache is %d days old: served as is, refreshing it in the background", ageDays);
  refresh = fetchWithRetry()
    .then((coords) => {
      setCache(coords);
      nextRefreshAtMs = 0;
      recordServiceCall("ipapi.co", 200, "OK (refreshed in the background)");
    })
    .catch((err) => {
      const status = recordFailure(err);
      const waitMs = status === 429 ? RATE_LIMIT_COOLDOWN_MS : REFRESH_COOLDOWN_MS;
      nextRefreshAtMs = deps.now() + waitMs;
      console.log(
        "[geolocation] Background refresh failed (%s); the expired cache is still served; next try in %d min",
        status, Math.round(waitMs / 60_000)
      );
    })
    // Nobody awaits this chain: an exception in the bookkeeping above must
    // not become an unhandled rejection, which would end the process.
    .catch((err) => {
      console.error("[geolocation] Background refresh bookkeeping failed:", err?.message);
    })
    .finally(() => {
      refresh = null;
    });
  return refresh;
}

function sendCoords(res, c) {
  return res.status(200).json({ latitude: c.latitude, longitude: c.longitude }).end();
}

/**
 * GET /geolocation handler.
 *
 * Strategy: serve the cache when fresh; when it has expired, serve it at once
 * and refresh it in the background (one refresh at a time, cooled down after
 * a failure). Only with no cache at all does a request wait for ipapi.co —
 * one shared fetch with retry for every concurrent request, a 429 included
 * since there is nothing else to serve — and fail (500) when it fails. The
 * user's location rarely changes, and an old location is much less bad than
 * a page that waits or shows nothing.
 *
 * @param {Object} req - The Express request (unused).
 * @param {Object} res - The Express response.
 * @returns {Promise<void>} Resolves once the response is sent.
 */
async function getCoords(req, res) {
  ensureLoaded();
  increment("ipapi.co", "geolocation");

  if (memCache) {
    if ((deps.now() - memCache.fetchedAtMs) < CACHE_MAX_AGE_MS) {
      recordServiceCall("ipapi.co", 200, "OK (cached)");
    } else {
      // Expired: never make the page wait for it. The refresh records the
      // real outcome of its call to ipapi.co.
      startBackgroundRefresh();
    }
    return sendCoords(res, memCache);
  }

  // No cache at all: one shared fetch for every waiting request.
  if (!firstFetch) {
    firstFetch = fetchWithRetry({ retry429: true })
      .then((coords) => {
        setCache(coords);
        recordServiceCall("ipapi.co", 200, "OK");
        return coords;
      })
      .catch((err) => {
        recordFailure(err);
        throw err;
      })
      .finally(() => {
        firstFetch = null;
      });
  }
  try {
    const coords = await firstFetch;
    return sendCoords(res, coords);
  } catch {
    return res.status(500).json("Geolocation failed").end();
  }
}

module.exports = {
  getCoords,
  // Internal helpers for the tests (test/geolocationCtrl.test.js).
  __test: {
    /**
     * Reset the module's state and inject test doubles.
     *
     * @param {{cacheFile?: string, fetchOnce?: Function, now?: Function, sleep?: Function}} overrides - The doubles.
     * @returns {void}
     */
    configure(overrides = {}) {
      deps = {
        cacheFile: DEFAULT_CACHE_FILE,
        fetchOnce: defaultFetchOnce,
        now: () => Date.now(),
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        ...overrides,
      };
      memCache = null;
      loaded = false;
      firstFetch = null;
      refresh = null;
      nextRefreshAtMs = 0;
    },
    /** @returns {Promise<void>|null} The running background refresh, if any. */
    pendingRefresh: () => refresh,
    /** @returns {Object|null} The in-memory cache. */
    cache: () => memCache,
    isRetryable,
    CACHE_MAX_AGE_MS,
    REFRESH_COOLDOWN_MS,
    RATE_LIMIT_COOLDOWN_MS,
  },
};
