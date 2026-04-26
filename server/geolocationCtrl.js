// Geolocation controller — proxies ipapi.co to obtain a default lat/lon
// based on the device's public IP. Robust against two failure modes that
// matter most at boot time on a kiosk Pi:
//
//   1. Transient unavailability — DNS not yet ready, default route not yet
//      installed, etc. Common in the first 1-3 seconds after pi-weather-server
//      starts on cold boot. Mitigated with retry-with-backoff.
//
//   2. Persistent unavailability — ipapi.co down, network unreachable, IPv6
//      misconfigured by the LAN, etc. Mitigated with a disk cache that
//      survives reboots: once we've succeeded once, future boots return the
//      cached value immediately even if the live fetch fails again.
//
// The cached location for a given Pi rarely changes (it's tied to the public
// IP, which is usually stable for residential connections), so a disk cache
// with a generous TTL is essentially free correctness.

const fs = require("fs");
const path = require("path");
const axios = require("axios").default;
const { recordServiceCall } = require("./serviceStatus");
const { increment } = require("./requestCounter");

const CACHE_FILE = path.join(__dirname, "geolocation-cache.json");
const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const FETCH_TIMEOUT_MS = 10 * 1000;

// Retry policy. Total worst-case wait: ~31 seconds across 5 attempts
// (1, 2, 4, 8, 16 seconds between tries — capped at MAX_DELAY_MS).
const MAX_ATTEMPTS    = 5;
const INITIAL_DELAY_MS = 1000;
const MAX_DELAY_MS    = 16 * 1000;

let memCache = null; // { latitude, longitude, fetchedAtMs }

function loadCacheFromDisk() {
  try {
    const raw = fs.readFileSync(CACHE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed.latitude === "number" && typeof parsed.longitude === "number") {
      memCache = parsed;
      console.log(
        "[geolocation] Loaded cached coords from disk: %s, %s (age %dh)",
        parsed.latitude.toFixed(4),
        parsed.longitude.toFixed(4),
        Math.round((Date.now() - parsed.fetchedAtMs) / 1000 / 60 / 60)
      );
    }
  } catch {
    // No cache yet — fine
  }
}

function saveCacheToDisk(data) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data), "utf8");
  } catch (err) {
    console.error("[geolocation] Failed to save cache to disk:", err.message);
  }
}

loadCacheFromDisk();

async function fetchOnce() {
  const result = await axios.get("https://ipapi.co/json/", { timeout: FETCH_TIMEOUT_MS });
  const { latitude, longitude } = result.data;
  if (typeof latitude !== "number" || typeof longitude !== "number") {
    throw new Error("Invalid response shape from ipapi.co");
  }
  return { latitude, longitude };
}

async function fetchWithRetry() {
  let delay = INITIAL_DELAY_MS;
  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const coords = await fetchOnce();
      if (attempt > 1) {
        console.log("[geolocation] Fetched on attempt %d/%d", attempt, MAX_ATTEMPTS);
      }
      return coords;
    } catch (err) {
      lastErr = err;
      const reason = err?.code || err?.message || "unknown error";
      if (attempt < MAX_ATTEMPTS) {
        console.log(
          "[geolocation] Attempt %d/%d failed (%s); retrying in %dms",
          attempt, MAX_ATTEMPTS, reason, delay
        );
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 2, MAX_DELAY_MS);
      }
    }
  }
  throw lastErr;
}

/**
 * GET /geolocation handler.
 *
 * Strategy: serve from cache when fresh; otherwise fetch with retry. If the
 * fetch ultimately fails but we have any prior cached value, return it
 * rather than failing the request (the user's location rarely changes, and
 * showing the kiosk in the wrong city is much less bad than not showing it
 * at all).
 *
 * @param {Object} req
 * @param {Object} res
 */
async function getCoords(req, res) {
  // Hot path: a fresh enough cache, no network call needed.
  if (memCache && (Date.now() - memCache.fetchedAtMs) < CACHE_MAX_AGE_MS) {
    increment("ipapi.co", "geolocation");
    recordServiceCall("ipapi.co", 200, "OK (cached)");
    return res.status(200).json({
      latitude: memCache.latitude,
      longitude: memCache.longitude,
    }).end();
  }

  // No cache or cache too old: fetch fresh with retry.
  try {
    const coords = await fetchWithRetry();
    memCache = { ...coords, fetchedAtMs: Date.now() };
    saveCacheToDisk(memCache);
    increment("ipapi.co", "geolocation");
    recordServiceCall("ipapi.co", 200, "OK");
    return res.status(200).json(coords).end();
  } catch (err) {
    const status = err?.response?.status || 500;
    const message = err?.response?.data?.reason || err?.code || "Geolocation failed";
    increment("ipapi.co", "geolocation");
    recordServiceCall("ipapi.co", status, String(message).slice(0, 100));

    // Stale cache fallback — better than no data at all.
    if (memCache) {
      console.log("[geolocation] Falling back to stale cache after retries failed");
      return res.status(200).json({
        latitude: memCache.latitude,
        longitude: memCache.longitude,
      }).end();
    }
    return res.status(500).json("Geolocation failed").end();
  }
}

module.exports = {
  getCoords,
};
