// Guards for the TEST qualifier on every gov-alert surface.
//
// An NWS alert whose CAP status is not "Actual" (Test / Exercise / System /
// Draft) reaches the client only through the localhost-only "Show test
// alerts" toggle (server/govAlertsCtrl.js filterTestAlerts + the showTest
// handling of the two alert endpoints). CLAUDE.md ("Alert banners — always
// identify the source", the TEST bullet) requires such an alert to be marked
// wherever it shows: the neutral outlined TEST badge (SourceBadge
// variant="test") beside its source badge, and a « TEST · » title prefix.
// AlertBanner did both; the radar-focus FloatingMiniBanner, AlertView's
// header and "Also active" chips, the mini-cards and the nearby-alerts map
// popup did neither (2026-10). These source-level checks keep every surface
// that prints a gov-alert title in line:
//
//   - every localized gov-alert title (`title_fr`) a component reads goes
//     through `alertDisplayTitle` (ui/alertTitle.js), and every call passes
//     the alert's `isTest`, so the prefix is applied after the French
//     shortening and never built by hand;
//   - a component that also prints a SourceBadge renders the TEST badge,
//     and only behind the alert's `isTest`;
//   - the auto-tab reason chip (ChartTabs), whose source badge can name a
//     test alert, adds the TEST badge behind the hook's `autoSwitchIsTest`;
//   - the badge stays neutral: no warn / danger / advisory / accent token,
//     and no colour literal other than white.
//
// `test/alertTitle.test.js` covers the helper itself. Run: `npm test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CLIENT_SRC = path.join(__dirname, "..", "client", "src");
const COMPONENTS = path.join(CLIENT_SRC, "components");

// The surfaces known to print a gov-alert title (2026-10). Listed so the
// guard can't pass vacuously if the title detection below stops matching.
const KNOWN_TITLE_SURFACES = [
  "ambient/AlertBanner/index.js",
  "ambient/AlertMiniCards/index.js",
  "ambient/AlertView/index.js",
  "ambient/FloatingMiniBanner/index.js",
  "WeatherMap/index.js",
];

// Colour tokens the TEST qualifier must never take (CLAUDE.md: "never
// coloured — `--c-warn` collapses to red in the nightRed palette").
const COLOURED_TOKEN_RE = /--c-(?:warn|danger|advisory|accent|cool)\b/;

// Chromatic CSS colour names a hand-written rule could slip in.
const CHROMATIC_NAME_RE = /(?<![\w-])(?:red|orange|yellow|gold|goldenrod|amber|orangered|tomato|coral|crimson|darkorange|firebrick|maroon|green|lime|blue|navy|teal|cyan|aqua|purple|magenta|fuchsia|pink)(?![\w-])/i;

/**
 * Colour literals in a CSS declaration block that aren't neutral. White
 * (`#fff`, `#ffffff`, `white`, `rgb(255 255 255 / a)` / `rgba(255, 255, 255,
 * a)`), `transparent` and `currentColor` pass; any other hex, rgb() or
 * hsl() value, or a chromatic colour name, is reported. Custom properties
 * are checked by COLOURED_TOKEN_RE.
 *
 * @param {string} decls the declarations between a rule's braces
 * @returns {string[]} the offending literals
 */
function nonNeutralColours(decls) {
  const out = [];
  for (const [hex] of decls.matchAll(/#[0-9a-f]{3,8}\b/gi)) {
    if (!/^#(?:fff|ffffff)$/i.test(hex)) out.push(hex);
  }
  for (const [fn, args] of decls.matchAll(/\brgba?\(([^)]*)\)/gi)) {
    const [r, g, b] = args.split(/[\s,/]+/).filter(Boolean);
    if (!(r === "255" && g === "255" && b === "255")) out.push(fn);
  }
  for (const [fn] of decls.matchAll(/\bhsla?\([^)]*\)/gi)) out.push(fn);
  const named = decls.match(CHROMATIC_NAME_RE);
  if (named) out.push(named[0]);
  return out;
}

/**
 * Source text without block and line comments, so prose that mentions a
 * field or a component never counts as code. A `//` right after a colon
 * (a URL in a string) is kept.
 *
 * @param {string} src JavaScript source
 * @returns {string} the source with comments blanked
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:\\])\/\/[^\n]*/g, (m, lead) => lead + " ".repeat(m.length - lead.length));
}

/**
 * The [start, end) spans of every `alertDisplayTitle( … )` call, the
 * parentheses balanced, with the argument text.
 *
 * @param {string} code comment-free source
 * @returns {Array<{start: number, end: number, args: string}>} call spans
 */
function displayTitleCalls(code) {
  const calls = [];
  const re = /\balertDisplayTitle\(/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let i = open;
    for (; i < code.length; i++) {
      if (code[i] === "(") depth++;
      else if (code[i] === ")") { depth--; if (depth === 0) break; }
    }
    calls.push({ start: m.index, end: i + 1, args: code.slice(open + 1, i) });
  }
  return calls;
}

/**
 * Every component file under client/src/components, path relative to it.
 *
 * @returns {Array<{rel: string, code: string}>} component sources, comments stripped
 */
function componentSources() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith(".js")) continue;
      const rel = path.relative(COMPONENTS, full).split(path.sep).join("/");
      out.push({ rel, code: stripComments(fs.readFileSync(full, "utf8")) });
    }
  };
  walk(COMPONENTS);
  return out;
}

// A component prints a gov-alert title when it reads the localized
// `title_fr` (the French UI's title; the other languages read title_en
// beside it). `title_en` alone also feeds SeverityChip's eventName, so it
// can't tell a title surface apart.
const titleSurfaces = () => componentSources().filter(({ code }) => /\btitle_fr\b/.test(code));

test("the title-surface detection finds every known gov-alert surface", () => {
  const found = titleSurfaces().map(({ rel }) => rel);
  for (const rel of KNOWN_TITLE_SURFACES) {
    assert.ok(found.includes(rel), `${rel} no longer detected as a gov-alert title surface (found: ${found.join(", ")})`);
  }
});

test("every gov-alert title goes through alertDisplayTitle with the alert's isTest", () => {
  const offenders = [];
  for (const { rel, code } of titleSurfaces()) {
    const calls = displayTitleCalls(code);
    if (calls.length === 0) {
      offenders.push(`${rel}: reads title_fr but never calls alertDisplayTitle`);
      continue;
    }
    for (const call of calls) {
      // `isTest: <alert>.isTest` — the alert's own flag, not a constant.
      if (!/\bisTest\s*:\s*[\w.]+\.isTest\b/.test(call.args)) {
        offenders.push(`${rel}: alertDisplayTitle(${call.args.trim().slice(0, 60)}…) without the alert's isTest`);
      }
    }
    // Each title_fr read sits inside a call, or in a `const x = …;` whose
    // x is the first argument of one (AlertView's `fullTitle`).
    const re = /\btitle_fr\b/g;
    let m;
    while ((m = re.exec(code)) !== null) {
      const at = m.index;
      if (calls.some((c) => at > c.start && at < c.end)) continue;
      const before = code.lastIndexOf("const ", at);
      const stmt = before >= 0 ? code.slice(before, code.indexOf(";", at) + 1) : "";
      const decl = /^const\s+(\w+)\s*=/.exec(stmt);
      const passed = decl && calls.some((c) => new RegExp(`^\\s*${decl[1]}\\b`).test(c.args));
      if (!passed) {
        const line = code.slice(0, at).split("\n").length;
        offenders.push(`${rel}:${line}: title_fr shown without alertDisplayTitle`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test("no component builds the « TEST · » prefix by hand", () => {
  const offenders = componentSources()
    .filter(({ code }) => /\$\{\s*testLabel\s*\}\s*·|["'`]TEST\s*·/.test(code))
    .map(({ rel }) => rel);
  assert.deepEqual(offenders, [], "use alertDisplayTitle (ui/alertTitle.js) so the prefix follows the shortening");
});

test("a gov-alert surface that prints a SourceBadge also prints the TEST badge, behind isTest", () => {
  const offenders = [];
  for (const { rel, code } of titleSurfaces()) {
    if (!/<SourceBadge\b/.test(code)) continue;
    // Every TEST badge must be the direct operand of an `<alert>.isTest ?`
    // or `&&` guard (optionally wrapped in one <span>), so a badge printed
    // unconditionally on every real alert fails as surely as a missing one.
    const badges = (code.match(/<SourceBadge\b[^>]*\bvariant="test"/g) || []).length;
    const gated = (code.match(/\.isTest\s*(?:\?|&&)\s*\(?\s*(?:<span\b[^>]*>\s*)?<SourceBadge\b[^>]*\bvariant="test"/g) || []).length;
    if (badges === 0 || gated !== badges) offenders.push(`${rel} (${gated}/${badges} TEST badges gated on isTest)`);
  }
  assert.deepEqual(offenders, []);
  // The radar-focus mini banner is one of them (it had neither, 2026-10).
  const mini = titleSurfaces().find(({ rel }) => rel === "ambient/FloatingMiniBanner/index.js");
  assert.ok(mini && /<SourceBadge\b[^>]*\bvariant="test"/.test(mini.code));
});

test("the auto-tab reason chip adds the TEST badge when a test alert drove the switch", () => {
  // ChartTabs prints no alert title, so the title-surface scan above misses
  // it; its reason chip shows the source badge of whatever drove the
  // auto-switch, an NWS test alert included (useAutoTabSelector →
  // autoTabSelector `isTest`).
  const chart = componentSources().find(({ rel }) => rel === "ambient/ChartTabs/index.js");
  assert.ok(chart, "ambient/ChartTabs/index.js not found");
  const badges = (chart.code.match(/<SourceBadge\b[^>]*\bvariant="test"/g) || []).length;
  const gated = (chart.code.match(/\bautoSwitchIsTest\s*(?:\?|&&)\s*<SourceBadge\b[^>]*\bvariant="test"/g) || []).length;
  assert.equal(badges, 1, "ChartTabs: the reason chip must print one TEST badge");
  assert.equal(gated, 1, "ChartTabs: the TEST badge must sit behind autoSwitchIsTest");
});

test("the TEST qualifier stays neutral: no warn, danger, advisory or accent colour", () => {
  const sourceBadgeCss = fs.readFileSync(path.join(COMPONENTS, "ambient", "SourceBadge", "styles.css"), "utf8");
  const testRule = sourceBadgeCss.match(/(^|\n)\.test\s*\{([^}]*)\}/);
  assert.ok(testRule, "SourceBadge/styles.css: .test rule not found");
  assert.ok(!COLOURED_TOKEN_RE.test(testRule[2]), `.test must stay neutral: ${testRule[2].trim()}`);
  assert.deepEqual(nonNeutralColours(testRule[2]), [], ".test must stay neutral");
  // Surfaces that re-skin it (AlertView's extreme band) keep it neutral too.
  for (const { rel } of titleSurfaces()) {
    const cssPath = path.join(COMPONENTS, path.dirname(rel), "styles.css");
    if (!fs.existsSync(cssPath)) continue;
    const css = fs.readFileSync(cssPath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const rule of css.matchAll(/([^{}]*\b[tT]est[A-Za-z-]*[^{}]*)\{([^}]*)\}/g)) {
      assert.ok(!COLOURED_TOKEN_RE.test(rule[2]), `${cssPath}: ${rule[1].trim()} colours the TEST qualifier`);
      assert.deepEqual(nonNeutralColours(rule[2]), [], `${cssPath}: ${rule[1].trim()} colours the TEST qualifier`);
    }
  }
});
