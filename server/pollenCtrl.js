// Pollen badge — fetches the Open-Meteo Air Quality API (free, no key)
// for the six standard pollen allergens (alder / birch / grass / mugwort
// / olive / ragweed) and returns a normalised worst-case payload that
// the client's MetricsGrid uses as a 5th cell (opt-in per install).
//
// Source: https://open-meteo.com/en/docs/air-quality-api
// Coverage: effectively EUROPE-ONLY — the pollen variables come from
// the CAMS European model; outside its domain the API returns null for
// every allergen (verified live 2026-06-10: Montréal and NYC both null
// in mid grass season). The controller answers {available:false} and
// the client hides the cell, so non-European installs simply never see
// the pollen tile even with the opt-in enabled.
//
// Category bucketing: pollen has no universal scale. Allergen-specific
// clinical thresholds vary widely (grass low ≤30 grains/m³, tree low
// ≤15, weed low ≤10). We use a single approximation tuned to read
// the same as the existing UV / AQ 4-tier vocabulary the client uses
// already, so the badge colour is consistent across UV/AQ/Pollen.

const axios = require("axios");
const { recordServiceCall } = require("./serviceStatus");

const SERVICE_NAME = "Open-Meteo (pollen)";
const API_TIMEOUT_MS = 10_000;

const ALLERGENS = [
  "alder_pollen",
  "birch_pollen",
  "grass_pollen",
  "mugwort_pollen",
  "olive_pollen",
  "ragweed_pollen",
];

/**
 * Approximate generic pollen-tier mapping. Aligned with the UV / AQ
 * 4-tier vocabulary already wired through CATEGORY_COLORS on the
 * client. Pollen-specific clinical scales would refine these but
 * the cross-allergen averaging done downstream means a single
 * threshold set is the right level of precision for a glance badge.
 *
 * @param {number|null|undefined} value grains/m³
 * @returns {"low"|"moderate"|"high"|"veryHigh"|null}
 */
function bucketize(value) {
  if (value == null) return null;
  if (value >= 50)  return "veryHigh";
  if (value >= 20)  return "high";
  if (value >= 5)   return "moderate";
  return "low";
}

const TIER_RANK = { low: 1, moderate: 2, high: 3, veryHigh: 4 };

/**
 * GET /api/pollen?lat&lon
 *
 * Returns the current per-allergen pollen values for the given
 * coords, plus an aggregated "worst-case" category and value used
 * to colour the MetricsGrid Pollen cell. The detail popover shows
 * the full per-allergen breakdown.
 *
 * Response shape:
 *   {
 *     available: true,
 *     worstAllergen: "ragweed_pollen",
 *     worstValue: 42.5,
 *     category: "high",
 *     allergens: [
 *       { name, value, category }
 *     ]
 *   }
 *
 * When the upstream returns no data (out-of-coverage region) we
 * still return 200 with `available: false` so the client can hide
 * the cell silently without a devtools error.
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function getPollen(req, res) {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return res.status(400).json({ available: false, error: "Invalid coordinates" }).end();
  }

  const url = "https://air-quality-api.open-meteo.com/v1/air-quality"
    + `?latitude=${lat}&longitude=${lon}`
    + `&current=${ALLERGENS.join(",")}`
    + "&timezone=auto";

  let resp;
  try {
    resp = await axios.get(url, { timeout: API_TIMEOUT_MS });
  } catch (err) {
    const status = err?.response?.status || 500;
    const message = err?.response?.data?.reason || err?.message || "Open-Meteo pollen fetch failed";
    recordServiceCall(SERVICE_NAME, status, String(message).slice(0, 100));
    return res.status(200).json({ available: false }).end();
  }

  const current = resp.data?.current || {};
  const allergens = ALLERGENS.map((name) => {
    const value = typeof current[name] === "number" ? current[name] : null;
    return { name, value, category: bucketize(value) };
  });

  // Worst-case across the six. Skip nulls (allergen absent from
  // payload — common in regions where the CAMS model lacks data for
  // a specific pollen).
  let worst = null;
  for (const a of allergens) {
    if (!a.category) continue;
    if (!worst || TIER_RANK[a.category] > TIER_RANK[worst.category]) worst = a;
  }

  const hasAnyData = allergens.some((a) => a.value != null);
  if (!hasAnyData) {
    recordServiceCall(SERVICE_NAME, 200, "no allergen data at coord");
    return res.status(200).json({ available: false }).end();
  }

  recordServiceCall(SERVICE_NAME, 200, worst ? `worst=${worst.name} (${worst.category})` : "all-zero");
  return res.status(200).json({
    available: true,
    worstAllergen: worst?.name || null,
    worstValue: worst?.value ?? null,
    category: worst?.category || "low",
    allergens,
  }).end();
}

module.exports = { getPollen };
