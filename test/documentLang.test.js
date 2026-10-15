// Tests for `client/src/i18n/documentLang.js`, which keeps `<html lang>`
// equal to the language the UI renders in (index.html can only declare a
// fixed default). The module is CommonJS so these tests exercise the real
// code; the wiring in i18n/index.js is checked as text. Run: `npm test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { documentLangFor, syncDocumentLang } = require("../client/src/i18n/documentLang");

const SUPPORTED = ["en", "fr", "es"];
const FALLBACK = "en";

test("documentLangFor: a shipped language is declared as is", () => {
  for (const lng of SUPPORTED) assert.equal(documentLangFor(lng, SUPPORTED, FALLBACK), lng);
});

test("documentLangFor: a regional tag declares its primary subtag", () => {
  assert.equal(documentLangFor("fr-CA", SUPPORTED, FALLBACK), "fr");
  assert.equal(documentLangFor("es_MX", SUPPORTED, FALLBACK), "es");
  assert.equal(documentLangFor("EN-us", SUPPORTED, FALLBACK), "en");
});

test("documentLangFor: an unshipped or missing language falls back", () => {
  assert.equal(documentLangFor("de", SUPPORTED, FALLBACK), "en");
  assert.equal(documentLangFor("cimode", SUPPORTED, FALLBACK), "en");
  assert.equal(documentLangFor("", SUPPORTED, FALLBACK), "en");
  assert.equal(documentLangFor(undefined, SUPPORTED, FALLBACK), "en");
  assert.equal(documentLangFor(null, SUPPORTED, FALLBACK), "en");
});

/**
 * Builds a stand-in document whose root element counts `lang` writes.
 *
 * @param {string} lang - Initial `lang` of the root element.
 * @returns {{doc: object, writes: () => number}} The document and a write counter.
 */
function fakeDocument(lang) {
  let value = lang;
  let writes = 0;
  const documentElement = {
    get lang() { return value; },
    set lang(v) { value = v; writes += 1; },
  };
  return { doc: { documentElement }, writes: () => writes };
}

test("syncDocumentLang: sets the root's lang to the rendered language", () => {
  const { doc } = fakeDocument("en");
  assert.equal(syncDocumentLang(doc, "fr", SUPPORTED, FALLBACK), "fr");
  assert.equal(doc.documentElement.lang, "fr");
  syncDocumentLang(doc, "es-ES", SUPPORTED, FALLBACK);
  assert.equal(doc.documentElement.lang, "es");
  syncDocumentLang(doc, "de", SUPPORTED, FALLBACK);
  assert.equal(doc.documentElement.lang, "en");
});

test("syncDocumentLang: leaves an already-right lang untouched", () => {
  const { doc, writes } = fakeDocument("fr");
  syncDocumentLang(doc, "fr", SUPPORTED, FALLBACK);
  assert.equal(writes(), 0);
});

test("syncDocumentLang: no document, no root element — no throw", () => {
  assert.equal(syncDocumentLang(null, "fr", SUPPORTED, FALLBACK), null);
  assert.equal(syncDocumentLang(undefined, "fr", SUPPORTED, FALLBACK), null);
  assert.equal(syncDocumentLang({}, "fr", SUPPORTED, FALLBACK), null);
});

test("i18n/index.js syncs the lang on languageChanged, registered before init", () => {
  const src = fs.readFileSync(path.join(__dirname, "../client/src/i18n/index.js"), "utf8");
  const listener = src.search(/i18n\.on\(\s*["']languageChanged["']/);
  const init = src.search(/\.init\(/);
  assert.ok(listener !== -1, "no languageChanged listener");
  assert.ok(init !== -1, "no i18n init");
  assert.ok(listener < init, "the listener must be registered before init to catch the startup language");
  assert.match(src.slice(listener, init), /syncDocumentLang\(/);
});
