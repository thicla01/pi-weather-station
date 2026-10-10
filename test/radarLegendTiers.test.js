// Guards for the words that name gov-alert tiers on the radar map.
//
// A nearby-alert polygon is coloured by its tier, and the tier comes from
// the alert's normalized CAP severity (severityToTier in
// server/govAlertSources/_shared.js), not from its product type. The radar
// legend used to label the tiers with product words — Warning / Watch /
// Advisory, « Avertissement / Veille / Avis » — so the orange tier read
// « Veille » while it also held advisories (ECCC frost advisories carry
// impact "Moderate") and warnings. The legend now names each tier by
// severity; these tests keep it that way. They also check that every
// SeverityChip gets the alert's event name, so its WORD is the real
// product type (the nearby-alert tap popup didn't pass it, and a moderate
// frost advisory read "Veille"). Run: `npm test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const CLIENT_SRC = path.join(ROOT, "client", "src");
const LEGEND = path.join(CLIENT_SRC, "components", "WeatherMap", "RadarLegend.js");
const locale = (lang) => JSON.parse(
  fs.readFileSync(path.join(CLIENT_SRC, "i18n", "locales", `${lang}.json`), "utf8"),
);

// Tier order in the legend: red, orange, yellow (worst first).
const EXPECTED_TIER_KEYS = ["nearbyTierSevere", "nearbyTierModerate", "nearbyTierMinor"];

function legendTierKeys() {
  const src = fs.readFileSync(LEGEND, "utf8");
  const block = src.match(/const ALERT_TIERS = \[([\s\S]*?)\];/);
  assert.ok(block, "ALERT_TIERS not found in RadarLegend.js");
  return [...block[1].matchAll(/key:\s*"([^"]+)"/g)].map((m) => m[1]);
}

test("radar legend: the alert tiers are keyed by severity, worst first", () => {
  assert.deepEqual(legendTierKeys(), EXPECTED_TIER_KEYS);
  const src = fs.readFileSync(LEGEND, "utf8");
  assert.ok(!/alert\.severity/.test(src), "RadarLegend must not use the product-type alert.severity* keys");
});

test("radar legend: every tier word exists in EN, FR and ES and is not a product-type word", () => {
  const productKeys = ["severityWarning", "severityWatch", "severityAdvisory", "severityStatement", "severityEmergency"];
  for (const lang of ["en", "fr", "es"]) {
    const strings = locale(lang);
    const productWords = new Set(productKeys.map((k) => strings.alert[k].toLowerCase()));
    for (const key of EXPECTED_TIER_KEYS) {
      const word = strings.radar[key];
      assert.equal(typeof word, "string", `${lang}: radar.${key} missing`);
      assert.ok(word.length > 0, `${lang}: radar.${key} empty`);
      assert.ok(!productWords.has(word.toLowerCase()), `${lang}: radar.${key} "${word}" is a product-type word`);
    }
  }
});

test("every SeverityChip passes the alert's event name (its word is the product type)", () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js")) {
        const src = fs.readFileSync(full, "utf8");
        for (const m of src.matchAll(/<SeverityChip\b[^>]*>/g)) {
          if (!/\beventName=/.test(m[0])) offenders.push(`${path.relative(ROOT, full)}: ${m[0]}`);
        }
      }
    }
  };
  walk(CLIENT_SRC);
  assert.deepEqual(offenders, []);
});
