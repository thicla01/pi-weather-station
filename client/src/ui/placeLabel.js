/**
 * Place-naming helpers shared by every surface that has to turn a LocationIQ
 * reverse-geocode payload into something a human reads.
 *
 * Extracted because three callers now need the same answer and were about to
 * disagree: `LocationDetailsPopover` (its detail rows and the auto-label it
 * gives a newly pinned favorite), `AppContext` (the one-shot capture of the
 * default location's name for the Places header row), and any future surface
 * that wants "what is this place called".
 *
 * LocationIQ's key set varies by locality scale — a hamlet exposes `hamlet`
 * where a city exposes `city`, and an urban point may carry `suburb` — so
 * every lookup is a fallback chain rather than a single field.
 */

/**
 * Most specific settlement name available for a point.
 *
 * @param {object} [address] LocationIQ `address` object
 * @returns {string|null} the locality name, or null when none is mapped
 */
export function pickLocality(address) {
  if (!address || typeof address !== "object") return null;
  return address.city
    || address.town
    || address.village
    || address.hamlet
    || address.municipality
    || null;
}

/**
 * Sub-locality name (neighbourhood scale), when the point has one.
 *
 * @param {object} [address] LocationIQ `address` object
 * @returns {string|null} the district name, or null
 */
export function pickDistrict(address) {
  if (!address || typeof address !== "object") return null;
  return address.suburb || address.neighbourhood || address.quarter || null;
}

/**
 * County / regional-municipality name, when the point has one.
 *
 * @param {object} [address] LocationIQ `address` object
 * @returns {string|null} the county name, or null
 */
export function pickCounty(address) {
  if (!address || typeof address !== "object") return null;
  return address.county || address.state_district || null;
}

/**
 * State / province / region name.
 *
 * @param {object} [address] LocationIQ `address` object
 * @returns {string|null} the region name, or null
 */
export function pickRegion(address) {
  if (!address || typeof address !== "object") return null;
  return address.state || address.region || null;
}

// Matches MAX_LABEL_LEN in useFavoriteLocations and server/settingsCtrl.js —
// a label produced here is a candidate favorite label, so it must already be
// within the bound the sanitizer enforces.
const MAX_LABEL_LEN = 40;

/**
 * Compose a short human label for a place: "Locality, Region".
 *
 * Degrades gracefully — either half alone is a valid label — and returns null
 * when the payload carries neither, so callers can fall back to coordinates
 * rather than pinning an unnamed entry (the server sanitizer drops those).
 *
 * @param {object} [address] LocationIQ `address` object
 * @returns {string|null} the composed label, truncated to 40 chars, or null
 */
export function placeLabelFromAddress(address) {
  const parts = [pickLocality(address), pickRegion(address)].filter(Boolean);
  if (parts.length === 0) return null;
  return parts.join(", ").slice(0, MAX_LABEL_LEN);
}
