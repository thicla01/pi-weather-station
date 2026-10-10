// Regression tests for `client/src/ui/airQualityDisplay.js` — the index
// label and the printed reading shared by the inline AirCard row and the
// AIR alert card. The module is CommonJS so these tests run the real
// code. Run: `npm test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  AQHI_TOP,
  AQ_NEUTRAL_LABEL_KEY,
  aqScaleLabelKey,
  formatAqValue,
} = require("../client/src/ui/airQualityDisplay");

const LOCALES_DIR = path.join(__dirname, "..", "client", "src", "i18n", "locales");
const locale = (lang) => JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, `${lang}.json`), "utf8"));
const lookup = (obj, key) => key.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);

test("formatAqValue: AQHI above 10 prints 10+, as ECCC reports it", () => {
  assert.equal(AQHI_TOP, 10);
  assert.equal(formatAqValue(11, "aqhi"), "10+");
  assert.equal(formatAqValue(36, "aqhi"), "10+");
  assert.equal(formatAqValue(10, "aqhi"), 10);
  assert.equal(formatAqValue(1, "aqhi"), 1);
});

test("formatAqValue: IQA and EPA AQI print as received; no reading → null", () => {
  assert.equal(formatAqValue(16, "iqa"), 16);
  assert.equal(formatAqValue(142, "iqa"), 142);
  assert.equal(formatAqValue(57, "epa"), 57);
  assert.equal(formatAqValue(null, "aqhi"), null);
  assert.equal(formatAqValue(undefined, undefined), null);
});

test("aqScaleLabelKey: one locale key per index", () => {
  assert.equal(aqScaleLabelKey("aqhi"), "metrics.aqScale.aqhi");
  assert.equal(aqScaleLabelKey("iqa"), "metrics.aqScale.iqa");
  assert.equal(aqScaleLabelKey("epa"), "metrics.aqScale.epa");
});

test("aqScaleLabelKey: no reading yet (or an unknown scale) → the neutral label, never an index name", () => {
  // Before the first /api/air-quality response the payload is null, so the
  // scale is undefined. The row used to show the language's generic acronym
  // ("— IQA" in French, "— AQI" in English), itself an index name, and flip
  // to the source's ("57 AQI", "16 IQA") when the reading landed.
  assert.equal(AQ_NEUTRAL_LABEL_KEY, "metrics.airQuality");
  assert.equal(aqScaleLabelKey(undefined), AQ_NEUTRAL_LABEL_KEY);
  assert.equal(aqScaleLabelKey(null), AQ_NEUTRAL_LABEL_KEY);
  assert.equal(aqScaleLabelKey("unknown"), AQ_NEUTRAL_LABEL_KEY);
});

test("neutral label: names the subject in EN, FR and ES, and is not an index acronym", () => {
  const indexLabels = new Set(["AQHI", "CAS", "IQA", "AQI", "ICA"]);
  for (const lang of ["en", "fr", "es"]) {
    const label = lookup(locale(lang), AQ_NEUTRAL_LABEL_KEY);
    assert.equal(typeof label, "string", `${lang}: ${AQ_NEUTRAL_LABEL_KEY} missing`);
    assert.ok(!indexLabels.has(label.toUpperCase()), `${lang}: "${label}" is an index name`);
  }
});

test("index labels: every scale has a label in EN, FR and ES; the AQHI is CAS in French", () => {
  const en = locale("en");
  const fr = locale("fr");
  const es = locale("es");
  for (const scale of ["aqhi", "iqa", "epa"]) {
    const key = aqScaleLabelKey(scale);
    for (const [lang, strings] of [["en", en], ["fr", fr], ["es", es]]) {
      const label = lookup(strings, key);
      assert.equal(typeof label, "string", `${lang}: ${key} missing`);
      assert.ok(label.length > 0, `${lang}: ${key} empty`);
    }
  }
  // ECCC's own names: "Air Quality Health Index (AQHI)" / « cote air santé
  // (CAS) » (canada.ca). Canada publishes no Spanish name, so ES keeps AQHI.
  assert.equal(lookup(en, "metrics.aqScale.aqhi"), "AQHI");
  assert.equal(lookup(fr, "metrics.aqScale.aqhi"), "CAS");
  assert.equal(lookup(es, "metrics.aqScale.aqhi"), "AQHI");
});
