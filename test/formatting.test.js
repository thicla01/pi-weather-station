// client/src/services/formatting.js — capitalizeFirst, which upper-cases the
// first letter of the Pi glance's compact date (TimeBlock) instead of CSS
// `text-transform: capitalize`, which also capitalised the month and the
// Spanish "de" ("Ven. 9 Octobre", "Vie, 9 De Octubre"). The module is
// CommonJS so this test loads the real code.
//
// Run: `npm test` or `node --test test/formatting.test.js`.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { capitalizeFirst } = require("../client/src/services/formatting");

test("capitalizeFirst upper-cases only the first character", () => {
  assert.equal(capitalizeFirst("ven. 9 octobre", "fr-FR"), "Ven. 9 octobre");
  assert.equal(capitalizeFirst("vie, 9 de octubre", "es-ES"), "Vie, 9 de octubre");
  assert.equal(capitalizeFirst("Fri, October 9", "en-US"), "Fri, October 9");
  assert.equal(capitalizeFirst("été", "fr-FR"), "Été");
});

test("capitalizeFirst is locale-aware", () => {
  assert.equal(capitalizeFirst("istanbul", "tr-TR"), "İstanbul");
  assert.equal(capitalizeFirst("istanbul", "en-US"), "Istanbul");
});

test("capitalizeFirst passes through empty, non-letter-led and non-string input", () => {
  assert.equal(capitalizeFirst("", "fr-FR"), "");
  assert.equal(capitalizeFirst("9 octobre", "fr-FR"), "9 octobre");
  assert.equal(capitalizeFirst(null), null);
  assert.equal(capitalizeFirst(undefined), undefined);
});

test("capitalizeFirst upper-cases a first letter outside the BMP (no split surrogate pair)", () => {
  // Deseret small long i (U+10428) → capital (U+10400): two UTF-16 units,
  // which a charAt(0)-based helper would leave lower-case.
  assert.equal(capitalizeFirst("\u{10428}bc", "en-US"), "\u{10400}bc");
});

// Real Intl output, so it depends on the runtime's ICU data (checked on
// Node 22 / ICU 76, CI's Node major). If a future CLDR release rewords these
// patterns, the literal cases above still cover the helper.
test("TimeBlock compact date: real Intl output, first letter only", () => {
  const at = new Date("2026-10-10T00:06:00Z"); // Fri 9 Oct 2026, 20:06 EDT
  const compact = (locale) =>
    capitalizeFirst(
      new Intl.DateTimeFormat(locale, {
        weekday: "short",
        month: "long",
        day: "numeric",
        timeZone: "America/Toronto",
      }).format(at),
      locale
    );
  assert.equal(compact("fr-FR"), "Ven. 9 octobre");
  assert.equal(compact("es-ES"), "Vie, 9 de octubre");
  assert.equal(compact("en-US"), "Fri, October 9");
});
