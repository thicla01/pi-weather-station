// Environment and Climate Change Canada severe-weather alerts source.
// Uses `api.weather.gc.ca/collections/weather-alerts/items` (the same
// pygeoapi instance that serves AQHI). The collection's bbox spatial
// filter is non-functional on this instance — `bbox=...` returns 0
// features even when alerts intersect the box — so the strategy is to
// fetch all active Canadian alerts once (typically a few dozen
// features, ~30-100 KB), cache the list server-side for 5 min, and
// run point-in-polygon locally per request. The dataset is small
// enough that this is the simplest correct approach.
//
// Bilingual EN/FR is built in: every property exposes `_en` and
// `_fr` suffixes (alert_name_en / alert_name_fr, alert_text_en /
// alert_text_fr, etc.). The normalised payload preserves both so
// the client can pick by locale.

const axios = require("axios").default;
const { recordServiceCall } = require("../serviceStatus");
const { increment } = require("../requestCounter");
const {
  TIMEOUT_MS,
  pointInCABox,
  pointInPolygon,
  normalizeSeverity,
  severityToTier,
  capitalizeFirst,
} = require("./_shared");

const SERVICE_NAME = "Environment Canada (severe weather alerts)";
const ALERTS_URL = "https://api.weather.gc.ca/collections/weather-alerts/items?f=json&limit=1000";
const FEED_TTL_MS = 5 * 60 * 1000; // 5 min — ECCC publishes alerts as they're issued

let feedCache = null; // { features, expiresAt }

/**
 * Fetch the full active-alerts feed (cached 5 min).
 *
 * @returns {Promise<Array<Object>>} GeoJSON features
 */
async function getFeed() {
  if (feedCache && Date.now() < feedCache.expiresAt) {
    return feedCache.features;
  }
  const resp = await axios.get(ALERTS_URL, { timeout: TIMEOUT_MS });
  const features = resp.data?.features || [];
  feedCache = { features, expiresAt: Date.now() + FEED_TTL_MS };
  return features;
}

/**
 * Translate one ECCC feature into the orchestrator's normalised
 * shape. ECCC's `impact_en` field carries the severity label
 * (Extreme | High | Moderate | Low) which `_shared.normalizeSeverity`
 * already understands.
 *
 * @param {Object} feature GeoJSON feature from the weather-alerts collection
 * @returns {Object|null}
 */
function normalize(feature) {
  const p = feature?.properties;
  if (!p || !p.alert_code) return null;
  const severity = normalizeSeverity(p.impact_en);
  return {
    source: "ECCC",
    id: p.id || feature.id || null,
    severity,
    tier: severityToTier(severity),
    eventType: p.alert_code,
    title_en: capitalizeFirst(p.alert_name_en || p.alert_short_name_en || p.alert_code),
    title_fr: capitalizeFirst(p.alert_name_fr || p.alert_short_name_fr || p.alert_code),
    description_en: p.alert_text_en || "",
    description_fr: p.alert_text_fr || "",
    // sentAt + senderName mirror the NWS payload so the client's
    // meta-chips row works for both sources without branching.
    //
    // ECCC's pygeoapi collection exposes the alert's issue
    // timestamp as `publication_datetime` (NOT `sent` — that's the
    // CAP-spec field name but the pygeoapi instance renames it).
    // Verified against the raw `/items` response: every alert
    // carries `publication_datetime` alongside `expiration_datetime`,
    // `validity_datetime`, and `event_end_datetime`. Falling back
    // through both shapes makes this resilient if the upstream
    // ever renames the field again.
    //
    // No issuing-office name field exists on ECCC — fall back to
    // a province-qualified "ECCC ON" / "ECCC QC" string when the
    // province code is present, plain "ECCC" otherwise.
    sentAt: p.publication_datetime || p.sent || p.effective_datetime || null,
    senderName: p.province ? `ECCC ${p.province}` : "ECCC",
    expiresAt: p.expiration_datetime || p.event_end_datetime || null,
    areaDesc: p.feature_name_en || p.feature_name_fr || p.province || null,
  };
}

/**
 * Return active ECCC alerts whose polygon contains (lat, lon).
 * Empty array when the point is outside Canada or no alert covers
 * it; null only on upstream failure so the orchestrator can keep
 * the previous list rather than blanking the banner on a transient
 * error.
 *
 * @param {Number} lat
 * @param {Number} lon
 * @returns {Promise<Array<Object>|null>}
 */
async function tryAlerts(lat, lon) {
  if (!pointInCABox(lat, lon)) return [];

  let features;
  try {
    features = await getFeed();
  } catch (err) {
    recordServiceCall(SERVICE_NAME, err?.response?.status || 500, "feed fetch failed");
    return null;
  }

  const matching = [];
  for (const feature of features) {
    if (pointInPolygon(lat, lon, feature.geometry)) {
      const n = normalize(feature);
      if (n) matching.push(n);
    }
  }

  recordServiceCall(SERVICE_NAME, 200, `${matching.length} alert(s) of ${features.length} active in CA`);
  increment("eccc", "alerts");
  return matching;
}

module.exports = { tryAlerts, SERVICE_NAME };
