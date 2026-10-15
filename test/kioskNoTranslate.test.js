// Locks in the page's opt-out from machine translation. Chromium shows its
// Google Translate bubble when a page's language differs from the
// browser's; in kiosk mode there is no browser chrome, so the bubble covers
// the top-right corner (the clock) until someone taps its × (seen on a
// kiosk on 2026-10-15, right after a relaunch). Chromium only skips the
// offer when <head> has `<meta name="google" content="notranslate">` as a
// direct child (Blink's HasNoTranslate); it doesn't read `translate="no"`
// for that decision, but other browsers' translators do. Nothing in the
// build or lint notices either one going missing, hence this tripwire, on
// the template and on the committed bundle the Pis serve. Run: `npm test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PAGES = [
  ["template", path.join(__dirname, "../client/src/index.html")],
  ["committed bundle", path.join(__dirname, "../client/dist/index.html")],
];

/**
 * Parses the attributes of one start tag (`<meta name="google" …>`).
 *
 * @param {string} tag - The start tag's source.
 * @returns {Map<string, string>} Lowercase attribute name → value.
 */
function attributesOf(tag) {
  const attrs = new Map();
  const re = /([^\s=/<>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  const body = tag.replace(/^<\s*[^\s/>]+/, "").replace(/\/?>$/, "");
  let m;
  while ((m = re.exec(body)) !== null) {
    attrs.set(m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

/**
 * Returns the source of the page's <head> element, comments removed.
 *
 * @param {string} html - Page source.
 * @returns {string} Inner HTML of <head>.
 */
function headOf(html) {
  const m = html.replace(/<!--[\s\S]*?-->/g, "").match(/<head\b[^>]*>([\s\S]*?)<\/head>/i);
  assert.ok(m, "the page has a <head>");
  return m[1];
}

for (const [label, file] of PAGES) {
  const html = fs.readFileSync(file, "utf8");

  test(`${label}: <head> carries <meta name="google" content="notranslate">`, () => {
    const metas = headOf(html).match(/<meta\b[^>]*>/gi) || [];
    const optOut = metas.map(attributesOf).find((a) =>
      (a.get("name") || "").toLowerCase() === "google"
      && (a.get("content") ?? a.get("value") ?? "").toLowerCase() === "notranslate");
    assert.ok(optOut, `${path.relative(process.cwd(), file)} lost the notranslate meta`);
  });

  test(`${label}: <html> declares translate="no" and a lang`, () => {
    const tag = html.replace(/<!--[\s\S]*?-->/g, "").match(/<html\b[^>]*>/i);
    assert.ok(tag, "the page has an <html> start tag");
    const attrs = attributesOf(tag[0]);
    assert.equal(attrs.get("translate"), "no");
    assert.match(attrs.get("lang") || "", /^[a-z]{2}$/);
  });
}

test("the notranslate meta is a direct child of <head>, not nested", () => {
  // Blink walks <head>'s children only. A meta inside, say, a <noscript>
  // would not count, so keep it out of any wrapper.
  const head = headOf(fs.readFileSync(PAGES[0][1], "utf8"));
  const before = head.slice(0, head.search(/<meta\b[^>]*name=["']?google/i));
  const opened = (before.match(/<(noscript|template|div|span)\b/gi) || []).length;
  const closed = (before.match(/<\/(noscript|template|div|span)>/gi) || []).length;
  assert.equal(opened, closed);
});
