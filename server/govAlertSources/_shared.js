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

module.exports = {
  TIMEOUT_MS,
  pointInUSBox,
  pointInCABox,
  pointInPolygon,
  normalizeSeverity,
  severityToTier,
  capitalizeFirst,
  dedupeConsecutiveParagraphs,
};
