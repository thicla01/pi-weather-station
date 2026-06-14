// NWS forecast/fire/county zone geometry fetcher with in-memory cache.
//
// Why this exists: most NWS alerts (Red Flag Warning, Heat Advisory,
// Wind Advisory, Special Weather Statement, etc.) are published
// against forecast / fire / county zone IDs rather than carrying an
// explicit polygon in `feature.geometry`. The alert's
// `properties.affectedZones` is an array of URLs like
// `https://api.weather.gov/zones/fire/AZZ112` — each URL returns a
// GeoJSON Feature whose `geometry` is the actual polygon for that
// zone. To overlay the alert's footprint on the radar (Phase 4d,
// 2026-05-28), we resolve the zones lazily and merge them into a
// single MultiPolygon attached to the alert payload.
//
// Cache strategy: 24h TTL per zone URL, RAM-only (no disk). Forecast
// zones change very rarely (a handful per year, US-wide), so a 24h
// cache is generous. RAM-only because (a) the cache is keyed on a
// stable URL string so the natural-restart re-fetch is fine, (b)
// disk persistence would require a serialisation format and migration
// story we don't need yet. If the cache footprint ever becomes a
// concern (the typical Pi sees ~10-50 unique zones over a season),
// a disk-backed variant can drop in behind the same get/set API.

const axios = require("axios").default;

// 24h TTL — forecast zones change very rarely
const ZONE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// Per-zone fetch timeout. 5 s is more than enough for a single
// GeoJSON document from api.weather.gov on a healthy link; on a
// degraded link, failing fast lets the parent Promise.all complete
// without blocking the whole alert payload on one slow zone.
const ZONE_FETCH_TIMEOUT_MS = 5000;
// NWS requires a User-Agent on all requests; mirror what nws.js
// sends so any rate-limit / contact policy applies uniformly.
const USER_AGENT = "pi-weather-station (https://github.com/thicla01/pi-weather-station)";

// Map<zoneUrl, { geometry, expiresAt }>
const _zoneCache = new Map();

/**
 * Defense-in-depth SSRF guard. The zone URLs we fetch come from the NWS
 * alerts response (`properties.affectedZones`) over TLS, so they're
 * trusted in the normal path — but blindly fetching an upstream-supplied
 * URL is a textbook SSRF foothold. If the response were ever poisoned,
 * or a future code path fed user-influenced data into getZoneGeometry,
 * an attacker-controlled URL could reach internal targets the kiosk can
 * see (cloud metadata at 169.254.169.254, the server's own
 * localhost:8443 control endpoints, other LAN hosts). Pinning the host
 * to the canonical NWS API endpoint over HTTPS costs nothing and removes
 * the foothold entirely.
 *
 * Exact-match on hostname (not endsWith) so a lookalike like
 * `api.weather.gov.evil.com` is rejected.
 *
 * @param {string} url
 * @returns {boolean} true only for https://api.weather.gov/... URLs
 */
function isAllowedZoneUrl(url) {
  if (!url || typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "api.weather.gov";
  } catch {
    return false; // unparseable
  }
}

/**
 * Fetch the geometry for a single NWS zone URL, with caching.
 * Returns the GeoJSON geometry (Polygon or MultiPolygon) on success,
 * or null on any failure (disallowed host, timeout, network error,
 * malformed payload, missing geometry field). Callers should treat
 * null as "this zone couldn't be resolved" and proceed without it —
 * never throw.
 *
 * @param {string} url Full HTTPS URL to a /zones/{kind}/{id} endpoint
 * @returns {Promise<?Object>} GeoJSON geometry, or null
 */
async function getZoneGeometry(url) {
  // SSRF guard — reject anything that isn't https://api.weather.gov/...
  // BEFORE any network call. See isAllowedZoneUrl for the rationale.
  if (!isAllowedZoneUrl(url)) return null;

  // Cache hit (fresh): return immediately. Cache hit (expired):
  // fall through to refetch — same semantics as a miss but we
  // already know the URL is one we've seen before.
  const now = Date.now();
  const cached = _zoneCache.get(url);
  if (cached && now < cached.expiresAt) return cached.geometry;

  let resp;
  try {
    resp = await axios.get(url, {
      timeout: ZONE_FETCH_TIMEOUT_MS,
      headers: { "User-Agent": USER_AGENT, Accept: "application/geo+json" },
      // Don't follow redirects: isAllowedZoneUrl validates the initial URL
      // (https + api.weather.gov), but a 3xx Location is NOT re-checked by
      // axios and could steer the fetch to an arbitrary host. A legitimate
      // api.weather.gov zone endpoint answers 200 directly, so refusing
      // redirects rejects nothing real while closing the SSRF redirect gap.
      maxRedirects: 0,
    });
  } catch {
    // Network error, timeout, 4xx/5xx. Don't cache a failure — the
    // next caller may catch the upstream coming back. The geometry
    // remains null and the alert renders without the "Voir sur la
    // carte" button (graceful degradation).
    return null;
  }

  let geometry = resp.data && resp.data.geometry;
  // NWS occasionally serves a zone as a GeometryCollection mixing Polygon
  // + MultiPolygon members (e.g. forecast zone TXZ213 "Inland Harris" over
  // Houston) rather than a single polygonal geometry. Flatten it to a
  // MultiPolygon so it survives the polygonal-only guard below — otherwise
  // the zone is dropped and the alert's rendered footprint has a hole
  // exactly over it (the 2026-06-14 Houston Flood Watch case).
  if (geometry && geometry.type === "GeometryCollection") {
    geometry = mergeAsMultiPolygon([geometry]);
  }
  // Some zones return without a (usable) geometry (rare administrative
  // zones, marine zones offshore that aren't polygonal). Treat as a soft
  // failure — cache the null result so we don't refetch every alert
  // cycle, but the TTL is the same so a future zone update would
  // pick up if NWS ever populates the geometry.
  if (!geometry || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")) {
    _zoneCache.set(url, { geometry: null, expiresAt: now + ZONE_CACHE_TTL_MS });
    return null;
  }

  _zoneCache.set(url, { geometry, expiresAt: now + ZONE_CACHE_TTL_MS });
  return geometry;
}

/**
 * Combine an array of GeoJSON geometries into a single MultiPolygon.
 * Accepts Polygon and MultiPolygon members, plus GeometryCollection
 * (flattened recursively into its polygonal parts — see the Houston
 * note below). Drops null / undefined / non-polygonal inputs silently.
 * Returns null if no valid input survives, so the caller can fall back
 * to a null geometry on the alert.
 *
 * The resulting MultiPolygon is the canonical shape Leaflet's
 * `<GeoJSON>` layer renders. Coordinates aren't re-projected or
 * simplified — NWS already publishes them in WGS84 lon/lat which
 * is what Leaflet expects.
 *
 * @param {Array<?Object>} geometries
 * @returns {?Object} { type: "MultiPolygon", coordinates: [[[[lon, lat], ...]]] }
 */
function mergeAsMultiPolygon(geometries) {
  if (!Array.isArray(geometries) || geometries.length === 0) return null;
  const coords = [];
  for (const g of geometries) {
    if (!g) continue;
    if (g.type === "Polygon" && Array.isArray(g.coordinates)) {
      coords.push(g.coordinates);
    } else if (g.type === "MultiPolygon" && Array.isArray(g.coordinates)) {
      // Spread MultiPolygon's coordinates (which is an array of
      // Polygon coordinate sets) directly into the merged list.
      for (const poly of g.coordinates) {
        coords.push(poly);
      }
    } else if (g.type === "GeometryCollection" && Array.isArray(g.geometries)) {
      // Some NWS zones are served as a GeometryCollection mixing Polygon
      // + MultiPolygon members (e.g. forecast zone TXZ213 "Inland Harris"
      // over Houston) instead of a single polygonal geometry. Recurse so
      // its members contribute their polygons rather than being silently
      // dropped — a dropped zone punches a hole in the merged alert
      // footprint exactly over that zone (the 2026-06-14 Houston Flood
      // Watch case). Recursion also covers nested collections.
      const inner = mergeAsMultiPolygon(g.geometries);
      if (inner) {
        for (const poly of inner.coordinates) {
          coords.push(poly);
        }
      }
    }
  }
  if (coords.length === 0) return null;
  return { type: "MultiPolygon", coordinates: coords };
}

/**
 * Clear the in-memory zone cache. Intended for tests and the debug
 * "force refresh" path; not called during normal operation.
 */
function clearZoneCache() {
  _zoneCache.clear();
}

module.exports = {
  getZoneGeometry,
  mergeAsMultiPolygon,
  clearZoneCache,
  // exported for diagnostics (Debug panel could surface "N zones cached")
  _zoneCache,
  // Exported for regression testing of the SSRF host allowlist.
  __test: { isAllowedZoneUrl },
};
