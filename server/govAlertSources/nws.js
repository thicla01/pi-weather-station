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
const { TIMEOUT_MS, pointInUSBox, normalizeSeverity, severityToTier } = require("./_shared");

const SERVICE_NAME = "NWS (severe weather alerts)";
const USER_AGENT = "pi-weather-station (github.com/thicla01/pi-weather-station)";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min — alerts don't change minute-to-minute

const cache = new Map(); // cacheKey → { alerts, expiresAt }

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
  const severity = normalizeSeverity(p.severity);
  return {
    source: "NWS",
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
    description_en: [p.headline, p.description].filter(Boolean).join("\n\n"),
    description_fr: [p.headline, p.description].filter(Boolean).join("\n\n"),
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
 * @returns {Promise<Array<Object>|null>}
 */
async function tryAlerts(lat, lon) {
  if (!pointInUSBox(lat, lon)) return [];

  const key = cacheKey(lat, lon);
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
  const alerts = features.map(normalize).filter(Boolean);
  cache.set(key, { alerts, expiresAt: Date.now() + CACHE_TTL_MS });
  recordServiceCall(SERVICE_NAME, 200, `${alerts.length} alert(s) at ${key}`);
  increment("nws", "alerts");
  return alerts;
}

module.exports = { tryAlerts, SERVICE_NAME };
