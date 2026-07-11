// Environment and Climate Change Canada severe-weather alerts source.
// Uses `api.weather.gc.ca/collections/weather-alerts/items` (the same
// pygeoapi instance that serves AQHI), filtered with the OGC `bbox=`
// spatial parameter around the query point.
//
// History: this module used to fetch the ENTIRE national feed and scan
// it locally, on the belief that the instance's bbox filter was
// non-functional ("returns 0 features even when alerts intersect the
// box"). Re-validated live 2026-07-09: bbox works — 10/10 witness
// alerts across SK/MB/ON were returned by a small box at their zone's
// centre. The old symptom is exactly reproduced by passing the box in
// lat,lon order; OGC bbox is `lonMin,latMin,lonMax,latMax` (x before
// y, like GeoJSON coordinates), so the original conclusion was almost
// certainly an axis-order trap. Meanwhile the national feed had grown
// to ~840 features / ~10 MB of JSON per refresh — ~21 MB pinned in the
// node heap plus a full-GC allocation spike every cache window — which
// is what forced this revisit (perf audit, 2026-07-09).
//
// The bbox is snapped to a 1° grid cell and sized to cover the largest
// nearby-alerts radius (100 km) from anywhere in the cell, so the
// banner point-query and the nearby-alerts radius-query share one
// cached upstream fetch per cell, preserving the one-fetch-per-window
// contract pinned by test/ecccAlertsCounter.test.js. Correctness does
// not depend on the box size: any polygon that contains the point (or
// clips the radius circle) necessarily intersects any box that covers
// that point/circle, and the local pointInPolygon / radius culls still
// run on what comes back.
//
// Bilingual EN/FR is built in: every property exposes `_en` and
// `_fr` suffixes (alert_name_en / alert_name_fr, alert_text_en /
// alert_text_fr, etc.). The normalised payload preserves both so
// the client can pick by locale.

const axios = require("axios").default;
const { recordServiceCall } = require("../serviceStatus");
const { increment } = require("../requestCounter");
const { BoundedMap } = require("../boundedCache");
const {
  TIMEOUT_MS,
  pointInCABox,
  CA_BBOX,
  pointInPolygon,
  normalizeSeverity,
  severityToTier,
  isWatchEvent,
  capWatchSeverity,
  capitalizeFirst,
  dedupeConsecutiveParagraphs,
} = require("./_shared");

const SERVICE_NAME = "Environment Canada (severe weather alerts)";
const ALERTS_BASE_URL = "https://api.weather.gc.ca/collections/weather-alerts/items?f=json&limit=1000";
const FEED_TTL_MS = 5 * 60 * 1000; // 5 min — ECCC publishes alerts as they're issued
// Bbox sizing: cover a NEARBY_MAX_RADIUS_KM (100 km) circle from anywhere
// inside the 1° grid cell the query point snaps to. 100/111 ≈ 0.9° of
// latitude for the radius, +0.5° for the worst-case snap distance, +0.1°
// float slack. Longitude half-width gets the same treatment scaled by
// cos() at the poleward cell edge (see cellFor for the geometry notes).
const COVER_RADIUS_KM = 100;
const KM_PER_DEG_LAT = 111;
const CELL_SNAP_DEG = 1;
const HALF_MARGIN_DEG = CELL_SNAP_DEG / 2 + 0.1;
const FEED_CACHE_MAX_CELLS = 8; // a kiosk lives in 1 cell; 8 absorbs map panning

const feedCache = new BoundedMap(FEED_CACHE_MAX_CELLS); // cellKey → { features, expiresAt }
const feedInflight = new Map(); // cellKey → shared promise — concurrent pollers reuse one upstream fetch

/**
 * Snap a query point to its 1° grid cell and build the bbox query
 * covering COVER_RADIUS_KM from anywhere in that cell.
 *
 * Two geometry subtleties, both review-caught (2026-07-09):
 *   - The worst-case query point sits at the POLEWARD cell edge
 *     (|cLat| + 0.5°), where the 100 km circle spans the most
 *     longitude — so cos() is taken there, not at the cell centre.
 *     Clamped at 85° to keep the half-width finite; CA_BBOX tops out
 *     at 84, and the 0.1° slack absorbs the parallel-arc vs geodesic
 *     delta through that whole range.
 *   - The emitted box is clamped to valid WGS84 ranges: ECCC's
 *     pygeoapi answers HTTP 500 {NoApplicableCode} for a bbox edge
 *     past ±180 / ±90 (verified live near the antimeridian and the
 *     pole). No longitude wrap is needed — Canada is nowhere near
 *     ±180, and callers skip the fetch entirely when the clamped box
 *     cannot intersect Canada (see cellTouchesCA).
 *
 * @param {Number} lat
 * @param {Number} lon
 * @returns {{key: String, bbox: String, latMin: Number, latMax: Number, lonMin: Number, lonMax: Number}}
 */
function cellFor(lat, lon) {
  const cLat = Math.round(lat / CELL_SNAP_DEG) * CELL_SNAP_DEG;
  const cLon = Math.round(lon / CELL_SNAP_DEG) * CELL_SNAP_DEG;
  const halfLat = COVER_RADIUS_KM / KM_PER_DEG_LAT + HALF_MARGIN_DEG;
  const edgeLat = Math.min(Math.abs(cLat) + CELL_SNAP_DEG / 2, 85);
  const cosLat = Math.cos((edgeLat * Math.PI) / 180);
  const halfLon = COVER_RADIUS_KM / (KM_PER_DEG_LAT * cosLat) + HALF_MARGIN_DEG;
  const latMin = Math.max(cLat - halfLat, -90);
  const latMax = Math.min(cLat + halfLat, 90);
  const lonMin = Math.max(cLon - halfLon, -180);
  const lonMax = Math.min(cLon + halfLon, 180);
  const bbox = [
    lonMin.toFixed(2),
    latMin.toFixed(2),
    lonMax.toFixed(2),
    latMax.toFixed(2),
  ].join(",");
  return { key: `${cLat},${cLon}`, bbox, latMin, latMax, lonMin, lonMax };
}

/**
 * True when the cell's bbox can intersect Canada at all (compared
 * against the same CA_BBOX rectangle the banner gate uses). Lets the
 * ungated nearby-alerts path skip the upstream fetch — and the
 * guaranteed-empty response — for a Fiji/Europe/Texas-interior query
 * while still fetching for a US point near the border, whose box
 * overlaps the rectangle.
 *
 * @param {{latMin: Number, latMax: Number, lonMin: Number, lonMax: Number}} cell
 * @returns {Boolean}
 */
function cellTouchesCA(cell) {
  return cell.latMax >= CA_BBOX.latMin && cell.latMin <= CA_BBOX.latMax
      && cell.lonMax >= CA_BBOX.lonMin && cell.lonMin <= CA_BBOX.lonMax;
}

/**
 * Fetch the active alerts intersecting the query point's grid cell
 * (cached 5 min per cell). This is the only place that talks to ECCC
 * upstream, so the requestCounter increment and serviceStatus record
 * live HERE — on actual feed refresh only. The counter must mean
 * "HTTP requests sent to ECCC", like every other requestCounter call
 * site: it used to sit in tryAlerts after the point-in-polygon scan,
 * where the Sense HAT daemon's 60 s poll inflated it to ~66/h
 * (729/day observed on the SenseHat Pi, 2026-06-11) while real
 * upstream traffic was 5-min-cached at ~12/h — the misplaced counter
 * made the feed look hammered when it wasn't.
 * See test/ecccAlertsCounter.test.js.
 *
 * Concurrent callers landing on a cold/expired cache (the kiosk's
 * 5-min poll and the HAT's 60 s poll can hit the same expiry window)
 * share one in-flight request per cell instead of racing duplicates.
 *
 * @param {Number} lat Query latitude — selects the cached grid cell
 * @param {Number} lon Query longitude — selects the cached grid cell
 * @returns {Promise<Array<Object>>} GeoJSON features
 */
async function getFeed(lat, lon) {
  const { key, bbox } = cellFor(lat, lon);
  const cached = feedCache.get(key);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.features;
  }
  if (feedInflight.has(key)) return feedInflight.get(key);
  const inflight = (async () => {
    let resp;
    try {
      resp = await axios.get(`${ALERTS_BASE_URL}&bbox=${bbox}`, { timeout: TIMEOUT_MS });
    } catch (err) {
      recordServiceCall(SERVICE_NAME, err?.response?.status || 500, "feed fetch failed");
      throw err;
    }
    const features = resp.data?.features || [];
    feedCache.set(key, { features, expiresAt: Date.now() + FEED_TTL_MS });
    recordServiceCall(SERVICE_NAME, 200, `feed refresh — ${features.length} active alert(s) near ${key}`);
    increment("eccc", "alerts");
    return features;
  })().finally(() => { feedInflight.delete(key); });
  feedInflight.set(key, inflight);
  return inflight;
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
  // Cap watches at moderate (see capWatchSeverity / ROADMAP #184) — keyed
  // off the English alert name ("...watch"), with "veille" as a fallback.
  const severity = capWatchSeverity(
    normalizeSeverity(p.impact_en),
    isWatchEvent(p.alert_name_en || p.alert_name_fr),
  );
  return {
    source: "ECCC",
    id: p.id || feature.id || null,
    severity,
    tier: severityToTier(severity),
    eventType: p.alert_code,
    title_en: capitalizeFirst(p.alert_name_en || p.alert_short_name_en || p.alert_code),
    title_fr: capitalizeFirst(p.alert_name_fr || p.alert_short_name_fr || p.alert_code),
    // Dedupe consecutive identical paragraphs — defends against the
    // ECCC payload bug observed live 2026-05-28 on a Saskatoon heat
    // warning where "Émis par Environnement Canada et le
    // gouvernement de la Saskatchewan" repeated 127 times in a row
    // (bloating a 3 KB alert to 12 KB of noise). Likely caused
    // upstream by ECCC's multi-region alert fusion appending the
    // issuing-authority footer per merged region without dedup.
    // No-op on healthy payloads.
    description_en: dedupeConsecutiveParagraphs(p.alert_text_en || ""),
    description_fr: dedupeConsecutiveParagraphs(p.alert_text_fr || ""),
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
    // GeoJSON Polygon / MultiPolygon — always present for ECCC
    // since we use `pointInPolygon(lat, lon, feature.geometry)`
    // server-side to filter alerts, so every alert that reaches the
    // client has gone through that check and therefore carries a
    // valid geometry. Propagating it lets the client overlay the
    // affected zone on the radar via Leaflet's GeoJSON layer
    // (Phase 4d, 2026-05-28).
    geometry: feature.geometry || null,
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
    features = await getFeed(lat, lon);
  } catch {
    // getFeed already recorded the failure in serviceStatus.
    return null;
  }

  const matching = [];
  for (const feature of features) {
    if (pointInPolygon(lat, lon, feature.geometry)) {
      const n = normalize(feature);
      if (n) matching.push(n);
    }
  }

  return matching;
}

/**
 * Return every active alert around (lat, lon), normalised, with no
 * point filter — the broad set the nearby-alerts overlay culls to a
 * radius itself. The cell bbox covers the maximum nearby radius
 * (100 km), and the underlying feed is the same per-cell cached one
 * `tryAlerts` uses, so a banner poll and a nearby poll at the same
 * spot share one upstream fetch. Deliberately NOT gated on
 * pointInCABox — a US point near the border must still see Canadian
 * alerts within its radius — but skipped entirely when the cell's box
 * cannot intersect Canada at all (cellTouchesCA): a Fiji or Europe
 * query returns [] with zero upstream traffic instead of a
 * guaranteed-empty (or, near the antimeridian, guaranteed-500)
 * request every poll. Best-effort: returns an empty array on
 * upstream failure so the nearby orchestrator can still merge the US
 * side.
 *
 * @param {Number} lat Circle centre latitude
 * @param {Number} lon Circle centre longitude
 * @returns {Promise<Array<Object>>}
 */
async function fetchAllNormalized(lat, lon) {
  if (!cellTouchesCA(cellFor(lat, lon))) return [];
  let features;
  try {
    features = await getFeed(lat, lon);
  } catch {
    // getFeed already recorded the failure in serviceStatus.
    return [];
  }
  const out = [];
  for (const feature of features) {
    const n = normalize(feature);
    if (n) out.push(n);
  }
  return out;
}

module.exports = {
  tryAlerts,
  SERVICE_NAME,
  fetchAllNormalized,
  // Feed-cache controls exposed for regression testing only — they let
  // test/ecccAlertsCounter.test.js drive the cold/expired-cache paths
  // without reaching into module state. Never call these from app code.
  __test: {
    _resetFeedCache: () => { feedCache.clear(); },
    _expireFeedCache: () => { for (const entry of feedCache.values()) entry.expiresAt = 0; },
    cellFor,
    cellTouchesCA,
  },
};
