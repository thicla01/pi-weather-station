// Locks in the CLAUDE.md kiosk rule "External links from the kiosk are
// kiosk-hostile — use QR codes only, never raw `<a>` elements" (section
// "Gov-alert detail section — reading-first UX"). Chromium in kiosk mode has
// no browser chrome: one tap on an external link strands the touchscreen on a
// page it has no way back from. Nothing in the build or lint notices such a
// link, so — same spirit as react19Guards.test.js — a mechanical, text-level
// tripwire over client/src is the only cheap guard.
//
// What counts as a raw external link (anywhere in client/src except the Debug
// panel, which is the codified localhost-only exception):
//   - `target="_blank"` on any element;
//   - an `<a>` / `<area>` whose `href` is an absolute or protocol-relative URL
//     (`https:`, `http:`, `mailto:`, `//host`, …) — including HTML handed to a
//     library as a string (Leaflet attribution), which still renders a real,
//     tappable `<a>` in the kiosk;
//   - an `<a>` / `<area>` whose `href` is an expression that doesn't start
//     with a same-origin literal (`/path`, `#frag`) — the guard can't prove it
//     stays on the Pi, so it has to be justified like an external one;
//   - `window.open(`;
//   - a script navigation (`window.location = …`, `location.href = …`,
//     `location.assign(…)`, `window.location.replace(…)`) to anything but a
//     same-origin literal — the same one-way trip, minus even a new tab.
//
// The one codified carve-out (maintainer decision 2026-10-08) is a
// remote-only companion link next to a QR: it is accepted ONLY when its JSX is
// the direct operand of an `isLocal === false &&` guard, in a file that also
// renders a `<QrCode>`, and that file is listed in REMOTE_ONLY_LINKS with its
// exact link count. So an ungated link is never whitelisted (not even in an
// allowlisted file), and a new gated one is a deliberate one-line edit here.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC_DIR = path.join(__dirname, "..", "client", "src");

// Codified exception: localhost-only, reached from a desktop browser or SSH
// tunnel, never the chrome-less kiosk (CLAUDE.md, maintainer decision 2026-06).
const EXEMPT_PREFIXES = ["components/ambient/DebugPanel/"];

// Remote-only companion links: file (relative to client/src) → exact number of
// `isLocal === false &&`-gated external links it renders. Count must match.
const REMOTE_ONLY_LINKS = {
  // Settings → "Trust this Pi on this device" → "Read the guide ↗"
  // (docs/pwa-trust-cert_{en,fr,es}.md), next to the guide's QR code.
  "components/ambient/SettingsPanel/index.js": 1,
};

// Pre-existing violations awaiting a fix (see ROADMAP › Technical debt).
// Pinned to the exact link sites (their reasons, not their line numbers): the
// entry can't absorb a new link — not even one swapped in for a fixed one —
// and fixing one fails the test until it's struck from the list.
const KNOWN_VIOLATIONS = {
  // The three Leaflet tile-layer attribution strings (Mapbox, Environment
  // Canada radar, RainViewer) are `<a href="https://…">` HTML that Leaflet
  // renders as live links in the always-visible attribution strip.
  "components/WeatherMap/index.js": [
    "href to https://www.mapbox.com/feedback/",
    "href to https://www.canada.ca/en/environment-climate-change.html",
    "href to https://www.rainviewer.com/",
  ],
};

const RULE_POINTER =
  'CLAUDE.md › "Gov-alert detail section — reading-first UX" › "External links from the kiosk are kiosk-hostile — use QR codes only"';

// Upper bound on one opening tag, so a stray `<a` in a trailing comment or a
// string (followed by an unmatched quote) can't make the tag scanner swallow
// the rest of the file.
const MAX_TAG_LENGTH = 2000;
// How far back to look for the `isLocal === false &&` guard before a link.
const GATE_LOOKBEHIND = 200;

// Case-insensitive: HTML handed to a library as a string (Leaflet
// attribution) may spell it `<A HREF=… TARGET=_BLANK>`.
const ANCHOR_RE = /<(?:a|area)(?=[\s>/])/gi;
const BLANK_TARGET_SOURCE = String.raw`\btarget\s*[=:]\s*\{?\s*\\?["'\x60]?_blank\b`;
const BLANK_TARGET_RE = new RegExp(BLANK_TARGET_SOURCE, "gi");
const BLANK_TARGET_IN_TAG_RE = new RegExp(BLANK_TARGET_SOURCE, "i");
const WINDOW_OPEN_RE = /\bwindow\.open\s*\(/g;
// Script navigations. Bare `location =` is left out on purpose: a weather app
// has plenty of variables called `location`; `window.`/`document.` (or the
// `.href` / `.assign` member) is what makes it the page's own location.
const NAVIGATION_RE =
  /\b(?:window|document)\.location(?:\.href)?\s*=(?!=)|(?<![\w$.])location\.href\s*=(?!=)|\blocation\.assign\s*\(|\b(?:window|document)\.location\.replace\s*\(/g;
const HREF_ATTR_RE = /(?<![\w-])href\s*=\s*/i;
// A URL scheme (`https:`, `mailto:`, …) or a protocol-relative `//host`.
const EXTERNAL_URL_RE = /^\s*(?:[a-z][a-z\d+.-]*:|\/\/)/i;
const QUOTES = new Set(['"', "'", "`"]);
// The link's JSX must be the direct right-hand operand of this guard. The
// strict `=== false` is the codified form: `isLocal` starts `true` and only a
// boolean from GET /api/is-local can flip it, so the kiosk never matches.
const GATE_RE = /\bisLocal\s*===\s*false\s*&&\s*\(?\s*$/;
const QRCODE_USAGE_RE = /<QrCode(?=\s)/g;
const QRCODE_WRAPPER = "components/ambient/QrCode/index.js";
const NON_EMPTY_TITLE_RE = /\btitle\s*=\s*(?!""|''|\{\s*(?:""|''|undefined|null)\s*\})/;

/**
 * Recursively collect every .js file under a directory.
 *
 * @param {string} dir directory to walk
 * @returns {string[]} absolute paths of the .js files found
 */
const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(p);
    return p.endsWith(".js") ? [p] : [];
  });

/**
 * Path of a source file relative to client/src, with forward slashes so the
 * allowlist keys read the same on every OS.
 *
 * @param {string} file absolute path
 * @returns {string} e.g. "components/ambient/SettingsPanel/index.js"
 */
const rel = (file) => path.relative(SRC_DIR, file).split(path.sep).join("/");

/**
 * 1-based line number of a character offset.
 *
 * @param {string} src file contents
 * @param {number} index character offset
 * @returns {number} line number
 */
const lineOf = (src, index) => src.slice(0, index).split("\n").length;

/**
 * Blank out comment lines (`//…`, `/*…`, ` * …`, `{/*…`), keeping every
 * offset and line number, so prose that quotes the rule (`never a raw
 * <a href="https://…">`) is neither flagged nor able to derail the tag
 * scanner with an apostrophe.
 *
 * @param {string} src file contents
 * @returns {string} same-length text with comment lines replaced by spaces
 */
const maskComments = (src) =>
  src.replace(/^[ \t]*(?:\/\/|\/\*|\*|\{\/\*).*$/gm, (line) => " ".repeat(line.length));

/**
 * Index of the `>` closing the opening tag that starts at `start` (the `<`),
 * skipping `>` inside quoted strings (including `\"…\"`, HTML inside a JS
 * string) and `{…}` expressions (arrow functions). A bare `<` can't occur in
 * a real opening tag, so meeting one means the match was prose (a comment
 * mentioning `<a`): the "tag" stops there instead of swallowing the next
 * real one.
 *
 * @param {string} src file contents
 * @param {number} start offset of the tag's `<`
 * @returns {number} offset of the closing `>` (or of the last character
 *   scanned when there is none)
 */
const tagEnd = (src, start) => {
  const limit = Math.min(src.length, start + MAX_TAG_LENGTH);
  let depth = 0;
  let quote = null;
  let escapedQuote = false;
  for (let i = start + 1; i < limit; i += 1) {
    const c = src[i];
    if (quote) {
      if (c === "\\") {
        if (escapedQuote && src[i + 1] === quote) quote = null;
        i += 1;
      } else if (c === quote && !escapedQuote) {
        quote = null;
      }
    } else if (QUOTES.has(c)) {
      quote = c;
      escapedQuote = false;
    } else if (c === "\\" && QUOTES.has(src[i + 1])) {
      quote = src[i + 1];
      escapedQuote = true;
      i += 1;
    } else if (c === "{") {
      depth += 1;
    } else if (c === "}") {
      depth -= 1;
    } else if (depth === 0 && c === ">") {
      return i;
    } else if (depth === 0 && c === "<") {
      return i - 1;
    }
  }
  return limit - 1;
};

/**
 * The leading string literal of an expression (`"…"`, `'…'`, `` `…` `` up to
 * its first `${`, or a `\"…\"` inside a JS string).
 *
 * @param {string} text source text starting at the expression
 * @returns {string|null} the literal's known text, or null when the
 *   expression doesn't start with one (a computed value)
 */
const leadingLiteral = (text) => {
  const rest = text.replace(/^\\(?=["'`])/, "");
  if (!QUOTES.has(rest[0])) return null;
  const body = rest.slice(1);
  const close = body.indexOf(rest[0]);
  const literal = close === -1 ? body : body.slice(0, close);
  if (rest[0] !== "`") return literal.replace(/\\$/, "");
  const [known] = literal.split("${");
  return known === "" && literal.startsWith("${") ? null : known;
};

/**
 * Classify a link destination: null when provably same-origin.
 *
 * @param {string} text source text starting at the destination expression
 * @param {string} what label for the message ("href", "navigation")
 * @returns {string|null} why it counts as an external link, or null
 */
const destinationProblem = (text, what) => {
  const literal = leadingLiteral(text);
  if (literal === null) return `${what} is a computed URL`;
  return EXTERNAL_URL_RE.test(literal) ? `${what} to ${literal.trim()}` : null;
};

/**
 * Classify an anchor's `href`: null when absent or provably same-origin.
 *
 * @param {string} tag the opening tag's source text
 * @returns {string|null} why the href counts as an external link, or null
 */
const hrefProblem = (tag) => {
  const m = HREF_ATTR_RE.exec(tag);
  if (!m) return null;
  const rest = tag.slice(m.index + m[0].length);
  if (rest.startsWith("{")) return destinationProblem(rest.slice(1).trimStart(), "href");
  if (/^\\?["'`]/.test(rest)) return destinationProblem(rest, "href");
  // Unquoted attribute — only valid in an HTML string, never in JSX.
  const [bare] = rest.match(/^[^\s>]*/);
  return EXTERNAL_URL_RE.test(bare) ? `href to ${bare}` : null;
};

/**
 * Every raw external-link site in a source text.
 *
 * @param {string} raw file contents
 * @returns {{line: number, reasons: string[], gated: boolean}[]} one entry per
 *   link (an anchor with both an external href and target="_blank" counts once),
 *   `gated` when its JSX is the direct operand of `isLocal === false &&`
 */
const findLinkSites = (raw) => {
  const src = maskComments(raw);
  const sites = [];
  const anchorSpans = [];
  for (const m of src.matchAll(ANCHOR_RE)) {
    const end = tagEnd(src, m.index);
    const tag = src.slice(m.index, end + 1);
    anchorSpans.push([m.index, end]);
    const reasons = [];
    const href = hrefProblem(tag);
    if (href) reasons.push(href);
    if (BLANK_TARGET_IN_TAG_RE.test(tag)) reasons.push('target="_blank"');
    if (reasons.length > 0) sites.push({ index: m.index, reasons });
  }
  for (const m of src.matchAll(BLANK_TARGET_RE)) {
    if (!anchorSpans.some(([s, e]) => m.index > s && m.index < e)) {
      sites.push({ index: m.index, reasons: ['target="_blank"'] });
    }
  }
  for (const m of src.matchAll(WINDOW_OPEN_RE)) {
    sites.push({ index: m.index, reasons: ["window.open()"] });
  }
  for (const m of src.matchAll(NAVIGATION_RE)) {
    const problem = destinationProblem(src.slice(m.index + m[0].length).trimStart(), "navigation");
    if (problem) sites.push({ index: m.index, reasons: [problem] });
  }
  return sites
    .sort((a, b) => a.index - b.index)
    .map(({ index, reasons }) => ({
      line: lineOf(src, index),
      reasons,
      gated: GATE_RE.test(src.slice(Math.max(0, index - GATE_LOOKBEHIND), index)),
    }));
};

const SCANNED = walk(SRC_DIR)
  .map((file) => ({ file: rel(file), src: fs.readFileSync(file, "utf8") }))
  .filter(({ file }) => !EXEMPT_PREFIXES.some((p) => file.startsWith(p)))
  .map(({ file, src }) => ({ file, code: maskComments(src), sites: findLinkSites(src) }));

test("detector: flags ungated external links, accepts same-origin and gated ones", () => {
  const one = (src) => findLinkSites(src);
  assert.deepEqual(one('<a href="/api/cert.pem" download="x.pem">Download</a>'), []);
  assert.deepEqual(one('<a href="#top">Top</a> and a comment about a raw `<a>` element'), []);
  assert.deepEqual(one('<a href={"/api/" + id}>x</a>'), []);
  assert.equal(one('<a href="https://example.com">x</a>')[0].gated, false);
  assert.equal(one("<a href='//example.com'>x</a>").length, 1);
  assert.equal(one("<a href={`https://${host}/x`}>x</a>").length, 1);
  assert.equal(one("<a href={`${base}/x`}>x</a>").length, 1);
  assert.equal(one("<a className={s.x} href={guideUrl(lang)}>x</a>").length, 1);
  assert.equal(one('<a onClick={() => go()} href="https://example.com">x</a>').length, 1);
  assert.equal(one('<form target="_blank" action="/x" />').length, 1);
  assert.equal(one('window.open("https://example.com")').length, 1);
  assert.equal(one("const html = '© <a href=\"https://www.mapbox.com/\">Mapbox</a>';").length, 1);
  // HTML strings: escaped quotes, unquoted attributes, upper case.
  assert.deepEqual(one('const h = "<a href=\\"https://x.org/\\">X</a>";')[0].reasons, ["href to https://x.org/"]);
  assert.deepEqual(one("const h = '<a href=https://x.org/>X</a>';")[0].reasons, ["href to https://x.org/"]);
  assert.equal(one('const h = "<A HREF=\'https://x.org/\'>X</A>";').length, 1);
  assert.equal(one("const h = '<a href=\"#\" target=_blank>X</a>';").length, 1);
  // Comments quoting the rule aren't links, and a stray `<a` in prose doesn't
  // swallow (and double-count) the next real link.
  assert.deepEqual(one('  // never a raw <a href="https://x.org" target="_blank">\n  /* or <a href="https://x.org"> */'), []);
  assert.deepEqual(one(' * e.g. `<a href="https://x.org">` — don\'t'), []);
  const afterProse = one('const n = 1; // a raw <a here\nconst y = 1;\n<a href="https://x.org">x</a>');
  assert.deepEqual(afterProse.map((s) => s.line), [3]);
  // Script navigations: external or computed are links, same-origin literals and reads aren't.
  assert.equal(one('window.location.href = "https://x.org";').length, 1);
  assert.equal(one("onClick={() => { location.href = url; }}").length, 1);
  assert.equal(one("window.location.assign(guideUrl);").length, 1);
  assert.equal(one('window.location = "//x.org";').length, 1);
  assert.deepEqual(one('window.location.href = "/";'), []);
  assert.deepEqual(one("const here = window.location.href;"), []);
  assert.deepEqual(one("if (window.location.href === u) reload();"), []);
  assert.deepEqual(one("const location = { lat, lon };"), []);
  // One link with both signals is one site, not two.
  const both = one('<a\n  href="https://example.com"\n  target="_blank"\n  rel="noopener noreferrer"\n>x</a>');
  assert.equal(both.length, 1);
  assert.deepEqual(both[0].reasons, ["href to https://example.com", 'target="_blank"']);
  // Only the strict `isLocal === false &&` guard, directly before the link, counts.
  assert.equal(one('{isLocal === false && (\n  <a href={u} target="_blank">x</a>\n)}')[0].gated, true);
  assert.equal(one('{isLocal === false && <a href={u} target="_blank">x</a>}')[0].gated, true);
  assert.equal(one('{!isLocal && (<a href={u} target="_blank">x</a>)}')[0].gated, false);
  assert.equal(one('{isLocal === false && (<div><a href={u} target="_blank">x</a></div>)}')[0].gated, false);
  assert.equal(one('{isLocal === false && (<p>a</p>)}\n<a href={u} target="_blank">x</a>')[0].gated, false);
});

test("no kiosk-visible component renders an ungated raw external link", () => {
  const offenders = SCANNED.filter(({ file }) => !(file in KNOWN_VIOLATIONS)).flatMap(
    ({ file, sites }) =>
      sites.filter((s) => !s.gated).map((s) => `${file}:${s.line} — ${s.reasons.join(" + ")}`)
  );
  assert.deepEqual(
    offenders,
    [],
    `the kiosk browser has no chrome: one tap on an external link strands it. Show the URL as a <QrCode> instead (${RULE_POINTER}). ` +
      "A link for remote browsers only must be the direct operand of `isLocal === false &&` next to a QR, and its file listed in REMOTE_ONLY_LINKS in this test"
  );
});

test("remote-only companion links match REMOTE_ONLY_LINKS exactly and sit next to a QR", () => {
  const gatedCounts = Object.fromEntries(
    SCANNED.map(({ file, sites }) => [file, sites.filter((s) => s.gated).length]).filter(([, n]) => n > 0)
  );
  assert.deepEqual(
    gatedCounts,
    REMOTE_ONLY_LINKS,
    "an `isLocal === false &&` link is the codified remote-only exception (" +
      RULE_POINTER +
      "): adding or removing one is a deliberate change — update REMOTE_ONLY_LINKS in this test to the exact count"
  );
  const withoutQr = Object.keys(REMOTE_ONLY_LINKS).filter((file) => {
    const entry = SCANNED.find((s) => s.file === file);
    return !entry || [...entry.code.matchAll(QRCODE_USAGE_RE)].length === 0;
  });
  assert.deepEqual(
    withoutQr,
    [],
    "a remote-only link may only ACCOMPANY a QR code — the kiosk (and every local viewer) must still get the URL as a <QrCode>"
  );
});

test("known violations neither grow nor linger after a fix", () => {
  const actual = Object.fromEntries(
    Object.keys(KNOWN_VIOLATIONS).map((file) => {
      const entry = SCANNED.find((s) => s.file === file);
      return [file, entry ? entry.sites.map((s) => s.reasons.join(" + ")) : []];
    })
  );
  assert.deepEqual(
    actual,
    KNOWN_VIOLATIONS,
    `KNOWN_VIOLATIONS is a shrink-only debt list: never add a link to it, not even in place of a fixed one (${RULE_POINTER}); when one is fixed, strike it from the list (and drop the entry once empty)`
  );
});

test("every QrCode carries an accessible name (title)", () => {
  const wrapper = SCANNED.find((s) => s.file === QRCODE_WRAPPER);
  assert.ok(wrapper, `${QRCODE_WRAPPER} not found`);
  const svgAt = wrapper.code.indexOf("<QRCodeSVG");
  assert.ok(svgAt !== -1, `${QRCODE_WRAPPER} no longer renders <QRCodeSVG>`);
  assert.match(
    wrapper.code.slice(svgAt, tagEnd(wrapper.code, svgAt) + 1),
    /\btitle\s*=\s*\{\s*title\s*\}/,
    "QrCode must forward `title` to QRCodeSVG — qrcode.react renders it as the SVG <title>, the image's accessible name (a `title` on the wrapper div is not a reliable one)"
  );
  const missing = SCANNED.flatMap(({ file, code }) =>
    [...code.matchAll(QRCODE_USAGE_RE)]
      .filter((m) => !NON_EMPTY_TITLE_RE.test(code.slice(m.index, tagEnd(code, m.index) + 1)))
      .map((m) => `${file}:${lineOf(code, m.index)}`)
  );
  assert.deepEqual(
    missing,
    [],
    "QrCode renders <svg role=\"img\"> named by its `title` prop (an SVG <title>) — without one the QR is a nameless image; PropTypes `isRequired` no longer runs under React 19, so this is the only check"
  );
});
