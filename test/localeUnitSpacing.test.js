// Keeps a value and its unit on one line in every locale. Text in the kiosk's
// narrow rail wraps at the last breakable space, and in French the 7" radar
// verdict broke as "Aucune pluie sur 100" / "km", stranding the unit
// (2026-10). The locale strings therefore join a value placeholder and
// `{{unit}}` with a no-break space (U+00A0, written as the `\u00a0` escape in
// the JSON). The character looks like a plain space in an editor and in a
// diff, so a reformat or a copy from another string can swap it back without
// anyone noticing; this guard catches that.
//
// Run: `npm test` or `node --test test/localeUnitSpacing.test.js`.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const LOCALES_DIR = path.join(__dirname, "..", "client", "src", "i18n", "locales");
const LANGS = ["en", "fr", "es"];
const NBSP = "\u00a0";

// A value placeholder, then whitespace other than U+00A0, then `{{unit}}`.
const BREAKABLE_UNIT_GAP = /\{\{\s*\w+\s*\}\}[^\S\u00a0]+\{\{\s*unit\s*\}\}/;

// The strings that show a distance today, so the scan above can't pass
// vacuously if they are renamed or reworded without their unit.
const DISTANCE_STRINGS = [
  { key: "nowcast.calm.noRainWithin", value: "distance" },
  { key: "radar.nearbyWithin", value: "radius" },
];

/**
 * Every string in a locale tree with its dotted key.
 *
 * @param {object} node locale JSON (or a subtree of it)
 * @param {string} [prefix] dotted key of `node`
 * @returns {{key: string, value: string}[]} one entry per string leaf
 */
const strings = (node, prefix = "") =>
  Object.entries(node).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") return [{ key, value: v }];
    return v && typeof v === "object" ? strings(v, key) : [];
  });

/**
 * Value at a dotted key.
 *
 * @param {object} tree locale JSON
 * @param {string} key dotted key (e.g. "radar.nearbyWithin")
 * @returns {*} the value, or undefined when a segment is missing
 */
const at = (tree, key) => key.split(".").reduce((n, k) => (n == null ? undefined : n[k]), tree);

const LOCALES = Object.fromEntries(
  LANGS.map((lang) => [lang, JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, `${lang}.json`), "utf8"))])
);

test("detector: a plain space before {{unit}} is flagged, a no-break space is not", () => {
  assert.match("No rain within {{distance}} {{unit}}", BREAKABLE_UNIT_GAP);
  assert.match("{{count}} dans {{radius}}\t{{unit}}", BREAKABLE_UNIT_GAP);
  assert.doesNotMatch(`No rain within {{distance}}${NBSP}{{unit}}`, BREAKABLE_UNIT_GAP);
  // A unit in parentheses after prose is not a value + unit pair.
  assert.doesNotMatch("Précipitations ({{unit}})", BREAKABLE_UNIT_GAP);
});

for (const lang of LANGS) {
  test(`${lang}.json: no value placeholder is joined to {{unit}} by a breakable space`, () => {
    const offenders = strings(LOCALES[lang])
      .filter(({ value }) => BREAKABLE_UNIT_GAP.test(value))
      .map(({ key, value }) => `${key}: ${JSON.stringify(value)}`);
    assert.deepEqual(offenders, [], "join the value and {{unit}} placeholders with \\u00a0 (no-break space)");
  });

  test(`${lang}.json: the distance strings keep the no-break space`, () => {
    for (const { key, value } of DISTANCE_STRINGS) {
      const str = at(LOCALES[lang], key);
      assert.equal(typeof str, "string", `${key} is missing from ${lang}.json: update this guard if it was renamed`);
      assert.ok(str.includes(`{{${value}}}${NBSP}{{unit}}`), `${lang}.json ${key} should contain "{{${value}}}\\u00a0{{unit}}", got ${JSON.stringify(str)}`);
    }
  });
}
