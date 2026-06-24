// US National Weather Service severe-weather alerts source. Uses
// `api.weather.gov/alerts/active?point=lat,lon` — NWS does the
// spatial matching internally (zone- or polygon-based, depending on
// the alert), so this module just fetches, normalises, and returns.
// Free, no API key, but a descriptive User-Agent is required by
// policy. Out-of-bounds points return HTTP 400 ("out of bounds")
// which we silently treat as "no coverage" rather than an error —
// the orchestrator already filters by bbox before calling, but the
// border zones overlap with Canada and a kiosk near, say, Niagara
// Falls is on the Canadian side often enough that the 400 is
// expected, not exceptional.

const axios = require("axios").default;
const { recordServiceCall } = require("../serviceStatus");
const { increment } = require("../requestCounter");
const { BoundedMap, sweepExpired } = require("../boundedCache");
const { TIMEOUT_MS, pointInUSBox, normalizeSeverity, severityToTier, isWatchEvent, capWatchSeverity, isTestStatus, dedupeConsecutiveParagraphs, KM_PER_DEG_LAT, kmPerDegLon } = require("./_shared");
const { getZoneGeometry, mergeAsMultiPolygon } = require("./nwsZones");

const SERVICE_NAME = "NWS (severe weather alerts)";
const USER_AGENT = "pi-weather-station (github.com/thicla01/pi-weather-station)";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min — alerts don't change minute-to-minute

// Bounded so a remote client can't grow it without limit by walking the
// query point (point-alert cache is coordinate-keyed). Cap is far above the
// handful of grid cells a real fleet polls; a sweep (below) reclaims
// expired entries. NWS_POINT_CACHE_MAX also covers stateCache; areaCache is
// naturally small (≤ ~60 US state/marine codes) but still capped + swept.
const NWS_POINT_CACHE_MAX = 256;
const NWS_AREA_CACHE_MAX = 64;
const cache = new BoundedMap(NWS_POINT_CACHE_MAX); // cacheKey → { alerts, expiresAt }

/**
 * Round (lat, lon) to a 0.1° grid (~11 km cells) so multiple polls
 * for nearby points share a cache entry. NWS doesn't differentiate
 * alerts within a zone, so this is lossless for our use case.
 *
 * @param {Number} lat
 * @param {Number} lon
 * @returns {String}
 */
function cacheKey(lat, lon) {
  return `${lat.toFixed(1)},${lon.toFixed(1)}`;
}

/**
 * Translate one NWS feature into the orchestrator's normalised
 * shape. NWS is English-only — the FR fields mirror EN so the
 * client can pick by locale without branching on source.
 *
 * @param {Object} feature GeoJSON feature from /alerts/active
 * @returns {Object|null} normalised alert, or null if missing required fields
 */
function normalize(feature) {
  const p = feature?.properties;
  if (!p || !p.event) return null;
  // Cap watches at moderate so a CAP-Severe Flood/Tornado Watch doesn't
  // render red like a Warning (see capWatchSeverity / ROADMAP item #184).
  const severity = capWatchSeverity(normalizeSeverity(p.severity), isWatchEvent(p.event));
  return {
    source: "NWS",
    // CAP status !== "Actual" → a Test / Exercise / System / Draft message on
    // the live feed (e.g. the monthly National Tsunami Warning Center test).
    // Default-hidden everywhere by the orchestrator; revealed only via the
    // maintainer's localhost-only "Show test alerts" toggle. Purely additive —
    // ECCC has no CAP status so its alerts never carry this (absent ⇒ falsy).
    isTest: isTestStatus(p.status),
    id: feature.id || p.id || null,
    severity,
    tier: severityToTier(severity),
    eventType: p.event,
    // event is the short, human-readable type ("Tornado Warning",
    // "Wind Advisory") and stays banner-sized. The full `headline`
    // string ("Wind Advisory issued May 4 at 3:37AM PDT until...
    // by NWS San Diego CA") is too long for the banner — we keep
    // it in description alongside the actual narrative.
    title_en: p.event,
    title_fr: p.event,
    // Dedupe consecutive identical paragraphs — defensive, applied
    // here even though NWS payloads haven't shown the ECCC repetition
    // pattern, because the cost is negligible and the function is a
    // no-op on healthy text. See _shared.js for the rationale.
    description_en: dedupeConsecutiveParagraphs([p.headline, p.description].filter(Boolean).join("\n\n")),
    description_fr: dedupeConsecutiveParagraphs([p.headline, p.description].filter(Boolean).join("\n\n")),
    // sentAt + senderName feed the v3.1 Phase 4 "meta chips" row
    // (Émis il y a Nh / NWS Gray ME / Expire <when>). NWS exposes
    // `sent` (UTC ISO timestamp of issue) and `senderName` (the
    // issuing office string, e.g. "NWS Gray ME" — useful context
    // for the user wondering "from whom?"). Both are nullable so
    // the client can hide chips for fields the source didn't
    // provide rather than rendering empty placeholders.
    sentAt: p.sent || p.effective || null,
    senderName: p.senderName || null,
    expiresAt: p.expires || p.ends || null,
    areaDesc: p.areaDesc || null,
    // GeoJSON Polygon / MultiPolygon when the alert is geo-targeted
    // (Tornado Warning, Severe Thunderstorm Warning with a specific
    // storm cell, etc.). Null for broad zone-based alerts like
    // Special Weather Statements that NWS publishes against the
    // whole forecast zone without an explicit polygon. The client
    // uses this to conditionally render the "Voir sur la carte"
    // button (Phase 4d, 2026-05-28) — when null, only "Réduire"
    // appears in the footer.
    geometry: feature.geometry || null,
  };
}

/**
 * Fetch active NWS alerts for the given point. Returns an empty
 * array (not null) when the point is outside US coverage so the
 * orchestrator can merge unconditionally. Returns null only on
 * unexpected upstream failure.
 *
 * @param {Number} lat
 * @param {Number} lon
 * @param {Object} [opts]
 * @param {Boolean} [opts.showTest] when true, test/exercise alerts get their
 *   zone geometry resolved like any other alert (the maintainer is revealing
 *   them). When false (default) a test alert's geometry is NOT fetched — it's
 *   about to be dropped by the orchestrator, so resolving its hundreds of
 *   zones would be a pure-waste fan-out. Cached separately per showTest so the
 *   two variants (with / without test geometry) don't clobber each other.
 * @returns {Promise<Array<Object>|null>}
 */
async function tryAlerts(lat, lon, { showTest = false } = {}) {
  if (!pointInUSBox(lat, lon)) return [];

  const key = `${cacheKey(lat, lon)}${showTest ? "|t" : ""}`;
  const cached = cache.get(key);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.alerts;
  }

  const url = `https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`;
  let resp;
  try {
    resp = await axios.get(url, {
      timeout: TIMEOUT_MS,
      headers: { "User-Agent": USER_AGENT, "Accept": "application/geo+json" },
    });
  } catch (err) {
    const status = err?.response?.status;
    // 400 = "out of bounds" for points outside US coverage. Silent
    // by design — the orchestrator's bbox check covers most cases
    // but the API is the authoritative arbiter (it knows the exact
    // boundary of every NWS region).
    if (status === 400) {
      cache.set(key, { alerts: [], expiresAt: Date.now() + CACHE_TTL_MS });
      return [];
    }
    recordServiceCall(SERVICE_NAME, status || 500, "fetch failed");
    return null;
  }

  const features = resp.data?.features || [];

  // Normalise + pair each surviving alert with its original feature
  // so the geometry-enrichment pass below can read
  // `properties.affectedZones` for alerts without an inline polygon.
  // Phase 4d follow-up (2026-05-28): most NWS alerts (Red Flag
  // Warning, Heat Advisory, Wind Advisory, Special Weather
  // Statement, etc.) publish against forecast / fire / county zone
  // IDs rather than carrying `feature.geometry` directly. Without
  // resolving those zones the "Voir sur la carte" button never
  // appears for them.
  const pairs = [];
  for (const f of features) {
    const n = normalize(f);
    if (n) pairs.push({ alert: n, feature: f });
  }

  // Resolve zone-only alerts (no inline polygon) to polygons via their
  // affectedZones so the "Voir sur la carte" button works for them too.
  // See enrichGeometries for the full rationale + failure handling.
  await enrichGeometries(pairs, showTest);

  const alerts = pairs.map((p) => p.alert);
  cache.set(key, { alerts, expiresAt: Date.now() + CACHE_TTL_MS });
  const withGeom = alerts.filter((a) => a.geometry).length;
  recordServiceCall(SERVICE_NAME, 200, `${alerts.length} alert(s) at ${key} (${withGeom} with geometry)`);
  increment("nws", "alerts");
  return alerts;
}

// Cap concurrent zone-geometry fetches. A many-zone alert (the live NWS
// National Tsunami Warning Center test spans 437 marine/coastal zones) would
// otherwise open one socket per zone to api.weather.gov in a single burst.
// All zones are still fetched and drawn — just this many at a time.
const MAX_ZONE_CONCURRENCY = 10;

/**
 * Resolve `items` through `fn` in sequential batches of at most `limit`
 * concurrent calls. Order-preserving. A tiny dependency-free concurrency pool
 * (no p-limit) — consistent with the deliberate zero-extra-deps stance.
 *
 * @param {Array<*>} items
 * @param {Number} limit max concurrent calls per batch
 * @param {(item: *) => Promise<*>} fn
 * @returns {Promise<Array<*>>} results in input order
 */
async function mapInBatches(items, limit, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    // eslint-disable-next-line no-await-in-loop -- intentional: bounds concurrency to one batch at a time
    out.push(...await Promise.all(batch.map(fn)));
  }
  return out;
}

/**
 * Resolve any null-geometry alerts in `pairs` to polygons by fetching
 * their `properties.affectedZones` and merging the results into a single
 * MultiPolygon. Most NWS alerts (Red Flag Warning, Heat Advisory, Special
 * Weather Statement, etc.) publish against forecast / fire / county zone
 * IDs rather than carrying an inline `feature.geometry`; without this they
 * can't be drawn on the map (or circle-tested for the nearby overlay).
 *
 * getZoneGeometry is cached 24 h, so a zone shared by many clustered
 * alerts is fetched once. Per-zone failures are tolerated (dropped by
 * mergeAsMultiPolygon); an alert whose every zone fails keeps
 * geometry:null — no regression, it simply isn't mapped.
 *
 * @param {Array<{alert: Object, feature: Object}>} pairs
 * @returns {Promise<void>} mutates each pair's `alert.geometry` in place
 */
async function enrichGeometries(pairs, showTest = false) {
  try {
    await Promise.all(pairs.map(async ({ alert, feature }) => {
      if (alert.geometry) return;
      // Lazy: a test/exercise alert that's about to be hidden (showTest off)
      // gets NO geometry fetch — otherwise a single one (the 437-zone NTWC
      // tsunami test) would open hundreds of sockets to api.weather.gov for an
      // alert the orchestrator immediately drops. When revealed, it enriches
      // like any other alert.
      if (alert.isTest && !showTest) return;
      const zoneUrls = feature?.properties?.affectedZones;
      if (!Array.isArray(zoneUrls) || zoneUrls.length === 0) return;
      // Bounded concurrency (not all-at-once): a many-zone alert still resolves
      // ALL its zones, just MAX_ZONE_CONCURRENCY at a time, so we never fire
      // hundreds of simultaneous requests. Each zone is cached 24 h downstream.
      const geometries = await mapInBatches(
        zoneUrls, MAX_ZONE_CONCURRENCY, (url) => getZoneGeometry(url).catch(() => null),
      );
      const merged = mergeAsMultiPolygon(geometries);
      if (merged) alert.geometry = merged;
    }));
  } catch (err) {
    // Defensive — the inner per-zone fetches already catch individually,
    // so this only trips on a truly unexpected runtime error. Continue
    // with whatever geometries resolved before the throw.
    console.warn("[nws] zone-geometry enrichment failed:", err.message);
  }
}

// ---------------------------------------------------------------------------
// Nearby-alerts support (GET /api/nearby-alerts). tryAlerts above answers
// "what's at this exact spot?"; the radius overlay needs "what's active
// across the area around this spot?". The NWS alerts API has no radius
// parameter, so we fetch by US state (?area=XX) and let the controller cull
// to the circle with circleIntersectsPolygon. The state(s) a radius circle
// touches are resolved from its bounding-box corners via NWS /points (1
// state typically, 2 at a border corner).
// ---------------------------------------------------------------------------

const STATE_TTL_MS = 24 * 60 * 60 * 1000; // a point→state mapping is static; cache 24 h
const stateCache = new BoundedMap(NWS_POINT_CACHE_MAX); // "lat,lon" (2-dp) → { state, expiresAt }
const areaCache = new BoundedMap(NWS_AREA_CACHE_MAX);   // "XX" → { alerts, expiresAt }

// Reclaim expired entries periodically (alerts + state mappings) so they
// don't sit pinned until the cap evicts them. .unref() so it never holds
// the process (or a test runner) open.
setInterval(() => {
  const now = Date.now();
  sweepExpired(cache, now);
  sweepExpired(stateCache, now);
  sweepExpired(areaCache, now);
}, CACHE_TTL_MS).unref();

/**
 * Resolve the 2-letter US state for a point via NWS /points. Cached 24 h.
 * Returns null for points outside US land coverage (404) or on transient
 * failure (not cached, so a later call can retry). Errs toward the nearest
 * place's state near a border, which is harmless — over-including a
 * neighbour state just means the circle filter culls a few extra alerts.
 *
 * @param {Number} lat
 * @param {Number} lon
 * @returns {Promise<String|null>}
 */
async function resolveState(lat, lon) {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const cached = stateCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.state;
  try {
    const resp = await axios.get(
      `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`,
      { timeout: TIMEOUT_MS, headers: { "User-Agent": USER_AGENT, "Accept": "application/geo+json" } },
    );
    const state = resp.data?.properties?.relativeLocation?.properties?.state || null;
    stateCache.set(key, { state, expiresAt: Date.now() + STATE_TTL_MS });
    return state;
  } catch (err) {
    if (err?.response?.status === 404) {
      // Genuine "no US land here" — cache the negative so we don't re-ask.
      stateCache.set(key, { state: null, expiresAt: Date.now() + STATE_TTL_MS });
      return null;
    }
    return null; // transient — don't cache, allow a later retry
  }
}

/**
 * The five sample points (centre + four bounding-box corners) of a radius
 * circle, used to discover which state(s) the circle spans. Pure — exported
 * for unit tests.
 *
 * @param {Number} lat
 * @param {Number} lon
 * @param {Number} radiusKm
 * @returns {Array<Array<Number>>} [[lat, lon], ...]
 */
function circleBboxCorners(lat, lon, radiusKm) {
  const dLat = radiusKm / KM_PER_DEG_LAT;
  const dLon = radiusKm / (Math.abs(kmPerDegLon(lat)) || 1e-9);
  return [
    [lat, lon],
    [lat + dLat, lon - dLon],
    [lat + dLat, lon + dLon],
    [lat - dLat, lon - dLon],
    [lat - dLat, lon + dLon],
  ];
}

/**
 * Distinct US state codes a radius circle touches, resolved from its
 * bounding-box corners. Empty array if none resolve (e.g. fully in Canada).
 *
 * @param {Number} lat
 * @param {Number} lon
 * @param {Number} radiusKm
 * @returns {Promise<Array<String>>}
 */
async function resolveStatesForCircle(lat, lon, radiusKm) {
  const corners = circleBboxCorners(lat, lon, radiusKm);
  const states = await Promise.all(
    corners.map(([la, lo]) => resolveState(la, lo).catch(() => null)),
  );
  return [...new Set(states.filter(Boolean))];
}

/**
 * Fetch + normalise + geometry-enrich every active NWS alert for a US
 * state (?area=XX), cached 5 min like the point feed. Best-effort: returns
 * an empty array on failure so the nearby orchestrator can still merge the
 * other states + ECCC rather than blanking everything.
 *
 * @param {String} area 2-letter state / marine code
 * @param {Object} [opts]
 * @param {Boolean} [opts.showTest] resolve test-alert geometry too (see
 *   tryAlerts). Cached separately per showTest.
 * @returns {Promise<Array<Object>>}
 */
async function fetchAlertsForArea(area, { showTest = false } = {}) {
  const cacheK = `${area}${showTest ? "|t" : ""}`;
  const cached = areaCache.get(cacheK);
  if (cached && Date.now() < cached.expiresAt) return cached.alerts;

  let resp;
  try {
    resp = await axios.get(
      `https://api.weather.gov/alerts/active?area=${encodeURIComponent(area)}`,
      { timeout: TIMEOUT_MS, headers: { "User-Agent": USER_AGENT, "Accept": "application/geo+json" } },
    );
  } catch (err) {
    recordServiceCall(SERVICE_NAME, err?.response?.status || 500, `area ${area} fetch failed`);
    return [];
  }

  const features = resp.data?.features || [];
  const pairs = [];
  for (const f of features) {
    const n = normalize(f);
    if (n) pairs.push({ alert: n, feature: f });
  }
  await enrichGeometries(pairs, showTest);
  const alerts = pairs.map((p) => p.alert);
  areaCache.set(cacheK, { alerts, expiresAt: Date.now() + CACHE_TTL_MS });
  const withGeom = alerts.filter((a) => a.geometry).length;
  recordServiceCall(SERVICE_NAME, 200, `${alerts.length} alert(s) in ${area} (${withGeom} with geometry)`);
  increment("nws", "alerts");
  return alerts;
}

module.exports = {
  tryAlerts,
  SERVICE_NAME,
  resolveStatesForCircle,
  fetchAlertsForArea,
  // Internal helpers exposed for unit tests (circleBboxCorners →
  // test/nearbyAlerts.test.js; normalize + mapInBatches → test/nwsTestStatus.test.js).
  __test: { circleBboxCorners, normalize, mapInBatches },
};
