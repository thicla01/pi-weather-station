// Shared helpers used by every government-alert source. Each source
// module fetches its national feed and returns a normalised list of
// alerts that the orchestrator (`govAlertsCtrl.js`) merges and serves
// to the client. The normalised shape is bilingual EN/FR (ECCC publishes
// both natively; NWS is English-only, so its FR mirrors EN) and carries
// a precomputed display tier so the AlertBanner doesn't have to know
// CAP severity vocabulary.

const TIMEOUT_MS = 10_000;

// Rough national bounding boxes used to skip a source when the point
// is clearly outside its coverage. Border zones are intentionally
// covered by both — running both sources for a point near, say,
// Niagara Falls is fine and the costs are negligible (each source is
// cached). The check is purely an optimisation to avoid a guaranteed
// 400 from NWS for a point in central Quebec, or a wasted PIP scan
// over Canadian polygons for a point in Texas.
const US_BBOX = { latMin: 17, latMax: 72, lonMin: -180, lonMax: -65 };
const CA_BBOX = { latMin: 40, latMax: 84, lonMin: -142, lonMax: -52 };

/**
 * @param {Number} lat
 * @param {Number} lon
 * @returns {Boolean}
 */
function pointInUSBox(lat, lon) {
  return lat >= US_BBOX.latMin && lat <= US_BBOX.latMax
      && lon >= US_BBOX.lonMin && lon <= US_BBOX.lonMax;
}

/**
 * @param {Number} lat
 * @param {Number} lon
 * @returns {Boolean}
 */
function pointInCABox(lat, lon) {
  return lat >= CA_BBOX.latMin && lat <= CA_BBOX.latMax
      && lon >= CA_BBOX.lonMin && lon <= CA_BBOX.lonMax;
}

/**
 * Ray-casting point-in-polygon for a single GeoJSON ring. Coordinates
 * are [lon, lat] pairs in GeoJSON order. Edge cases (point exactly on
 * a vertex or edge) are not specifically handled — the caller doesn't
 * care since alerts are coarse regional polygons and a one-pixel
 * miss at the boundary is irrelevant.
 *
 * @param {Number} lat
 * @param {Number} lon
 * @param {Array<Array<Number>>} ring [[lon, lat], ...]
 * @returns {Boolean}
 */
function pointInRing(lat, lon, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = ((yi > lat) !== (yj > lat))
      && (lon < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Test whether (lat, lon) falls inside a GeoJSON Polygon or
 * MultiPolygon geometry. The first ring of each polygon is the outer
 * boundary; subsequent rings are holes — a point inside an outer ring
 * but inside a hole counts as outside, so we XOR the inside-ness
 * across the rings of each polygon.
 *
 * @param {Number} lat
 * @param {Number} lon
 * @param {Object} geometry GeoJSON geometry
 * @returns {Boolean}
 */
function pointInPolygon(lat, lon, geometry) {
  if (!geometry) return false;
  const polys = geometry.type === "MultiPolygon"
    ? geometry.coordinates
    : geometry.type === "Polygon"
      ? [geometry.coordinates]
      : [];
  for (const poly of polys) {
    let inside = false;
    for (const ring of poly) {
      if (pointInRing(lat, lon, ring)) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}

/**
 * Map a CAP-style severity string (Extreme | Severe | Moderate |
 * Minor | Unknown) or an ECCC `impact_*` label (Extreme | High |
 * Moderate | Low) to one of the four normalized levels the client
 * understands. Anything we can't classify becomes "minor" so the
 * banner stays soft rather than disappearing — an alert with unknown
 * severity is still an alert.
 *
 * @param {String} raw
 * @returns {"minor" | "moderate" | "severe" | "extreme"}
 */
function normalizeSeverity(raw) {
  const s = String(raw || "").toLowerCase();
  if (s === "extreme") return "extreme";
  if (s === "severe" || s === "high") return "severe";
  if (s === "moderate") return "moderate";
  if (s === "minor" || s === "low") return "minor";
  return "minor";
}

/**
 * Map normalized severity to the AlertBanner colour tier. Aligned
 * with the radar-derived tiers so the existing CSS classes apply
 * without change.
 *
 * @param {String} severity
 * @returns {"yellow" | "orange" | "red"}
 */
function severityToTier(severity) {
  if (severity === "extreme" || severity === "severe") return "red";
  if (severity === "moderate") return "orange";
  return "yellow";
}

/**
 * Heuristic: does this alert's event name denote a *Watch* (vs a Warning,
 * Advisory or Statement)? Cross-source — matches the English word "watch"
 * (NWS "Flood Watch", "Tornado Watch", …) and the French "veille" (ECCC)
 * as a defensive fallback.
 *
 * @param {?String} name event name / title (NWS `event`, ECCC `alert_name_en`)
 * @returns {Boolean} true when the name reads as a watch
 */
function isWatchEvent(name) {
  const s = String(name || "").toLowerCase();
  return /\bwatch\b/.test(s) || /\bveille\b/.test(s);
}

/**
 * Cap a watch's normalized severity at `moderate`. A Watch announces that
 * conditions are *favourable* (CAP urgency Future / certainty Possible),
 * not that severe weather is *happening* — yet NWS routinely tags Flood /
 * Flash Flood / Tornado Watches CAP `Severe`, which would otherwise paint
 * them red and make them shout exactly as loud as a Warning on the banner,
 * the map overlay and the SenseHat pulse. Capping the *severity* (not just
 * the tier) keeps every severity-derived consumer consistent: the tier
 * drops to orange, the SeverityChip's *colour* follows (its word is
 * independent — it comes from the alert's product type, not severity), and
 * severity-sorting ranks the watch below real warnings.
 * Non-watch alerts and already-sub-severe watches pass through untouched.
 *
 * @param {String} severity normalized severity
 * @param {Boolean} isWatch whether the alert is a watch
 * @returns {String} the (possibly lowered) severity
 */
function capWatchSeverity(severity, isWatch) {
  if (isWatch && (severity === "severe" || severity === "extreme")) return "moderate";
  return severity;
}

// CAP <status> values: Actual | Exercise | System | Test | Draft. Only
// "Actual" is a real, public-facing alert; the others are test / exercise /
// internal-system / draft messages disseminated on the SAME live feed — e.g.
// the National Tsunami Warning Center's periodic "Test Tsunami Warning" that
// covers the whole US + Canadian coast at CAP severity Extreme. Left unfiltered
// these render as a real red alert (banner, map polygon, SenseHat). The gate
// lives at the orchestrator (see govAlertsCtrl) so every consumer is covered;
// this helper just classifies the status. Source-agnostic so any future CAP
// source can tag the same way — ECCC's feed carries no status field, so its
// alerts are always treated as live.
const CAP_STATUS_ACTUAL = "Actual";

/**
 * Whether a CAP `status` denotes a non-live message (Test / Exercise / System /
 * Draft) rather than a real "Actual" alert. A missing / empty status is treated
 * as live (not a test).
 *
 * @param {?String} status CAP <status> value
 * @returns {Boolean} true when the alert is anything but a live "Actual" alert
 */
function isTestStatus(status) {
  return Boolean(status) && status !== CAP_STATUS_ACTUAL;
}

/**
 * Capitalize the first letter of a string. Some upstreams (notably
 * ECCC's `alert_name_en` / `alert_name_fr`) emit titles in all
 * lowercase ("rainfall warning"), which reads as broken next to
 * the radar-derived banner's properly-cased text. Sentence-case is
 * the right floor for both English and French short titles.
 *
 * @param {String} s
 * @returns {String}
 */
function capitalizeFirst(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Collapse consecutive identical paragraphs in an alert description.
 *
 * Defends against upstream payloads that repeat a line dozens or
 * hundreds of times — observed live on a 2026-05-28 ECCC Saskatoon
 * heat warning where "Émis par Environnement Canada et le
 * gouvernement de la Saskatchewan" appeared 127 times in a row
 * (the real alert content ran 3 KB, the footer repeats pushed the
 * whole payload to 12 KB). The pattern likely comes from ECCC's
 * multi-region alert fusion where the issuing-authority footer is
 * appended per merged region without dedup.
 *
 * Strategy: split on blank-line boundaries (`\n{2,}`) so we operate
 * at the paragraph level (not at the line level, which would over-
 * collapse poetry-style ECCC bullets where adjacent lines are short
 * and similar). Trim each paragraph for comparison so trailing
 * whitespace differences don't defeat the dedup. Preserve the FIRST
 * occurrence of each repeated paragraph — useful info like the
 * issuing-authority footer is kept once.
 *
 * Defensive: returns input unchanged for null / empty / whitespace
 * inputs so callers don't have to guard. Cheap enough to run on
 * every normalised alert (the typical case has 0 consecutive
 * duplicates and the function returns the input via the fast path).
 *
 * @param {?string} text
 * @returns {?string}
 */
function dedupeConsecutiveParagraphs(text) {
  if (!text || typeof text !== "string" || !text.trim()) return text;
  const paragraphs = text.split(/\n{2,}/);
  const deduped = [];
  let prevKey = null;
  for (const p of paragraphs) {
    const key = p.trim();
    if (key && key === prevKey) continue;
    deduped.push(p);
    prevKey = key;
  }
  return deduped.join("\n\n");
}

// ---------------------------------------------------------------------------
// Circle ⇄ polygon intersection — used by the "nearby alerts" radius overlay
// (GET /api/nearby-alerts). The point-based sources answer "is (lat,lon)
// inside this alert?"; the radius overlay instead asks "does this alert's
// polygon come within R km of (lat,lon)?" so it can paint every alert near
// the user, not only the one covering the exact spot.
//
// Hand-rolled on purpose — NO turf.js / geolib dependency (deliberate
// footprint decision; the nearby-alerts feature adds zero npm deps).
// Accuracy: distances use a local equirectangular projection centred on the
// query point. Over the ≤100 km radius the overlay supports the distortion
// is well under a pixel at kiosk zoom, and the bbox pre-test rejects far
// polygons before any of the per-edge maths runs.
// ---------------------------------------------------------------------------

const KM_PER_DEG_LAT = 110.574;

/**
 * Kilometres per degree of longitude at a given latitude.
 * @param {Number} lat
 * @returns {Number}
 */
function kmPerDegLon(lat) {
  return 111.320 * Math.cos((lat * Math.PI) / 180);
}

/**
 * Flatten a GeoJSON Polygon / MultiPolygon to a flat list of its rings
 * (outer boundaries and holes alike — for edge proximity an edge is an
 * edge regardless of which ring it bounds).
 * @param {Object} geometry GeoJSON geometry
 * @returns {Array<Array<Array<Number>>>}
 */
function geometryRings(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return geometry.coordinates || [];
  if (geometry.type === "MultiPolygon") return (geometry.coordinates || []).flat();
  return [];
}

/**
 * Shortest distance (planar km) from point P=(px,py) to segment AB, all
 * expressed in the same local km plane.
 * @param {Number} px @param {Number} py
 * @param {Number} ax @param {Number} ay
 * @param {Number} bx @param {Number} by
 * @returns {Number}
 */
function distPointToSegmentKm(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/**
 * Does a circle of `radiusKm` centred on (lat, lon) intersect (touch or
 * overlap) the given GeoJSON Polygon / MultiPolygon? True when the centre
 * is inside the polygon, when the polygon sits inside the circle, or when
 * any polygon edge passes within `radiusKm` — which crucially catches a
 * large county whose polygon edge clips the circle even though its
 * centroid sits well outside it (the case a centre-only point-in-polygon
 * test would miss).
 *
 * @param {Number} lat
 * @param {Number} lon
 * @param {Number} radiusKm
 * @param {Object} geometry GeoJSON Polygon | MultiPolygon
 * @returns {Boolean}
 */
function circleIntersectsPolygon(lat, lon, radiusKm, geometry) {
  const rings = geometryRings(geometry);
  if (!rings.length || !(radiusKm > 0)) return false;

  // Cheap bbox reject: if the circle's lat/lon box can't even touch the
  // polygon's box there is no intersection — skip the per-edge maths.
  const dLat = radiusKm / KM_PER_DEG_LAT;
  const dLon = radiusKm / (Math.abs(kmPerDegLon(lat)) || 1e-9);
  let pMinLat = Infinity;
  let pMaxLat = -Infinity;
  let pMinLon = Infinity;
  let pMaxLon = -Infinity;
  for (const ring of rings) {
    for (const pt of ring) {
      const [x, y] = pt;
      if (y < pMinLat) pMinLat = y;
      if (y > pMaxLat) pMaxLat = y;
      if (x < pMinLon) pMinLon = x;
      if (x > pMaxLon) pMaxLon = x;
    }
  }
  if (lat + dLat < pMinLat || lat - dLat > pMaxLat
    || lon + dLon < pMinLon || lon - dLon > pMaxLon) return false;

  // Centre inside the polygon — geographic test, handles holes correctly.
  if (pointInPolygon(lat, lon, geometry)) return true;

  // Any edge within radius? Project each ring's vertices into a local km
  // plane centred on the query point and measure point-to-segment distance
  // from the origin.
  const kLon = kmPerDegLon(lat);
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const ax = (ring[j][0] - lon) * kLon;
      const ay = (ring[j][1] - lat) * KM_PER_DEG_LAT;
      const bx = (ring[i][0] - lon) * kLon;
      const by = (ring[i][1] - lat) * KM_PER_DEG_LAT;
      if (distPointToSegmentKm(0, 0, ax, ay, bx, by) <= radiusKm) return true;
    }
  }
  return false;
}

module.exports = {
  TIMEOUT_MS,
  pointInUSBox,
  pointInCABox,
  CA_BBOX,
  pointInPolygon,
  normalizeSeverity,
  severityToTier,
  isWatchEvent,
  capWatchSeverity,
  isTestStatus,
  CAP_STATUS_ACTUAL,
  capitalizeFirst,
  dedupeConsecutiveParagraphs,
  circleIntersectsPolygon,
  KM_PER_DEG_LAT,
  kmPerDegLon,
  // Internal helpers exposed for unit tests (see test/nearbyAlerts.test.js).
  __test: { distPointToSegmentKm, geometryRings },
};
