// Tests for `client/src/ui/alertCardName.js` — the accessible name of the
// compact gov-alert card on the 7" rail's priority glance (one button):
// level, source, title, and "1 of N" only when more than one alert is
// eligible. The module is CommonJS, so this runs
// the real code, with a stand-in `t` that interpolates the real EN / FR /
// ES locale strings the way i18next does (`{{name}}`). The last test
// checks AlertBanner names its card through the helper.
// Run: `npm test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { COUNTED_FROM, compactAlertCardName } = require("../client/src/ui/alertCardName");

const SRC_DIR = path.join(__dirname, "..", "client", "src");
const LANGS = ["en", "fr", "es"];
const LOCALES = Object.fromEntries(LANGS.map((lang) => [
  lang,
  JSON.parse(fs.readFileSync(path.join(SRC_DIR, "i18n", "locales", `${lang}.json`), "utf8")),
]));
// "1 of 2" in each language, as the counted string writes it.
const COUNT_WORD = { en: "of", fr: "sur", es: "de" };

/**
 * A stand-in for i18next's `t` over one locale: resolves the dotted key,
 * fills `{{name}}` from the options and records each call.
 *
 * @param {string} lang - "en", "fr" or "es".
 * @returns {{t: function(string, object): string, calls: Array<{key: string, options: object}>}} the function and its calls
 */
const localeT = (lang) => {
  const calls = [];
  const t = (key, options = {}) => {
    calls.push({ key, options });
    const template = key.split(".").reduce((node, part) => (node == null ? undefined : node[part]), LOCALES[lang]);
    assert.equal(typeof template, "string", `${lang}: no string at ${key}`);
    return template.replace(/\{\{(\w+)\}\}/g, (m, name) => {
      assert.ok(name in options, `${lang}: ${key} reads {{${name}}}, not passed`);
      return String(options[name]);
    });
  };
  return { t, calls };
};

const PARTS = { level: "Warning", source: "ECCC", title: "Freezing rain" };

test("alertCardName: one alert — level, source and title, no \"1 of 1\", in EN, FR and ES", () => {
  for (const lang of LANGS) {
    const { t, calls } = localeT(lang);
    const name = compactAlertCardName(t, { ...PARTS, current: 1, count: 1 });
    assert.deepEqual(calls.map((c) => c.key), ["alert.compactCardAriaSingle"], lang);
    for (const part of Object.values(PARTS)) assert.ok(name.includes(part), `${lang}: ${part} in "${name}"`);
    assert.doesNotMatch(name, /\b1\b/, `${lang}: "${name}"`);
    assert.doesNotMatch(name, new RegExp(`\\b${COUNT_WORD[lang]} \\d`), `${lang}: "${name}"`);
    // Not even asked for: the single key gets no count (so no plural lookup either).
    assert.equal("count" in calls[0].options || "current" in calls[0].options, false, lang);
  }
  assert.equal(compactAlertCardName(localeT("en").t, { ...PARTS, current: 1, count: 1 }), "Warning, ECCC: Freezing rain");
  assert.equal(compactAlertCardName(localeT("fr").t, { ...PARTS, current: 1, count: 1 }), "Warning, ECCC : Freezing rain");
  assert.equal(compactAlertCardName(localeT("es").t, { ...PARTS, current: 1, count: 1 }), "Warning, ECCC: Freezing rain");
});

test("alertCardName: two alerts or more — the name ends with \"current of count\", in EN, FR and ES", () => {
  assert.equal(COUNTED_FROM, 2);
  for (const lang of LANGS) {
    for (const [current, count] of [[1, 2], [2, 2], [3, 5]]) {
      const { t, calls } = localeT(lang);
      const name = compactAlertCardName(t, { ...PARTS, current, count });
      assert.deepEqual(calls.map((c) => c.key), ["alert.compactCardAria"], lang);
      for (const part of Object.values(PARTS)) assert.ok(name.includes(part), `${lang}: ${part} in "${name}"`);
      assert.ok(name.endsWith(`, ${current} ${COUNT_WORD[lang]} ${count}`), `${lang}: "${name}"`);
    }
  }
  assert.equal(compactAlertCardName(localeT("fr").t, { ...PARTS, current: 1, count: 2 }), "Warning, ECCC : Freezing rain, 1 sur 2");
});

test("alertCardName: the two locale strings differ only by the count, in every language", () => {
  for (const lang of LANGS) {
    const { compactCardAria: counted, compactCardAriaSingle: single } = LOCALES[lang].alert;
    assert.equal(counted, `${single}, {{current}} ${COUNT_WORD[lang]} {{count}}`, lang);
    for (const v of ["level", "source", "title"]) assert.ok(single.includes(`{{${v}}}`), `${lang}: ${v}`);
    assert.doesNotMatch(single, /\{\{(?:current|count)\}\}/, lang);
  }
});

test("alertCardName: AlertBanner names its one-button card through the helper, with the eligible count", () => {
  const banner = fs.readFileSync(path.join(SRC_DIR, "components", "ambient", "AlertBanner", "index.js"), "utf8");
  assert.match(banner, /import \{ COUNTED_FROM, compactAlertCardName \} from "~\/ui\/alertCardName";/);
  assert.match(banner, /const cardName = compactAlertCardName\(t, \{[\s\S]*?current: safeIdx \+ 1,\s*count: eligibleGovAlerts\.length,\s*\}\);/);
  assert.match(banner, /aria-label=\{cardName\}/);
  // No direct use of the keys elsewhere in the banner: the helper picks one.
  assert.doesNotMatch(banner, /t\("alert\.compactCardAria/);
  // The passive "1 / N" indicator follows the same rule (shown from two alerts), from the same constant: no second
  // spelling of the threshold in the banner.
  assert.match(banner, /const hasOthers = eligibleGovAlerts\.length >= COUNTED_FROM;/);
  assert.doesNotMatch(banner, /eligibleGovAlerts\.length\s*(?:>|>=|<|<=|===|!==)\s*\d/);
});
