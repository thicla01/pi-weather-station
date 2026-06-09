// Regression tests for the watch-tier cap (ROADMAP item #184). NWS routinely
// tags Flood / Flash Flood / Tornado *Watches* with CAP severity "Severe",
// which — mapped on severity alone — painted them red and made a Watch shout
// exactly as loud as a Warning on the banner, the nearby-alerts overlay, and
// the SenseHat pulse. capWatchSeverity caps a watch at "moderate" so the tier
// drops to orange AND the SeverityChip word becomes "Watch" (it re-derives
// from severity), keeping every surface consistent.
//
// Run: `npm test` (Node's built-in `node --test` runner, no deps).

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { isWatchEvent, capWatchSeverity, severityToTier } = require("../server/govAlertSources/_shared");

test("isWatchEvent — matches watches across sources, not warnings/advisories", () => {
  assert.equal(isWatchEvent("Flood Watch"), true);
  assert.equal(isWatchEvent("Flash Flood Watch"), true);
  assert.equal(isWatchEvent("Tornado Watch"), true);
  assert.equal(isWatchEvent("Severe Thunderstorm Watch"), true);
  assert.equal(isWatchEvent("veille d'orages violents"), true); // ECCC FR fallback
  assert.equal(isWatchEvent("Flood Warning"), false);
  assert.equal(isWatchEvent("Flash Flood Warning"), false);
  assert.equal(isWatchEvent("Heat Advisory"), false);
  assert.equal(isWatchEvent("Special Weather Statement"), false);
  assert.equal(isWatchEvent(""), false);
  assert.equal(isWatchEvent(null), false);
});

test("capWatchSeverity — lowers a severe/extreme WATCH to moderate, leaves the rest", () => {
  assert.equal(capWatchSeverity("severe", true), "moderate");
  assert.equal(capWatchSeverity("extreme", true), "moderate");
  assert.equal(capWatchSeverity("moderate", true), "moderate"); // already sub-severe
  assert.equal(capWatchSeverity("minor", true), "minor");
  // Non-watch alerts pass through untouched — a Warning stays severe.
  assert.equal(capWatchSeverity("severe", false), "severe");
  assert.equal(capWatchSeverity("extreme", false), "extreme");
});

test("end-to-end — a CAP-Severe Flood Watch lands on orange, a Warning stays red", () => {
  const watchSev = capWatchSeverity("severe", isWatchEvent("Flood Watch"));
  assert.equal(watchSev, "moderate");
  assert.equal(severityToTier(watchSev), "orange"); // the #184 fix

  const warnSev = capWatchSeverity("severe", isWatchEvent("Flash Flood Warning"));
  assert.equal(warnSev, "severe");
  assert.equal(severityToTier(warnSev), "red"); // unchanged
});
