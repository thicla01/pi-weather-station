#!/usr/bin/env node
/**
 * Regenerate `docs/localization-glossary.md` from the two places translated
 * strings actually live:
 *
 *   1. `client/src/i18n/locales/{en,fr,es}.json` — the structured i18n tree,
 *      used by every kiosk-visible surface.
 *   2. Inline `lbl(lang, en, fr, es)` calls in the ambient `SettingsPanel` and
 *      `DebugPanel`. Those two maintainer-facing panels are a codified
 *      exception to the locale-file rule (see CLAUDE.md) — the three strings
 *      sit next to their usage instead of behind a key.
 *
 * Why a generator at all: the glossary was hand-maintained and went stale
 * twice (once in the v3.1 rail work, once when the v2 tree was deleted in
 * 2026-07 and 177 keys were pruned). A hand-written file that claims to be
 * "generated" is worse than either — this makes the claim true.
 *
 * VALIDATION MARKS FOLLOW THE WORDING THEY VALIDATED. The `Validé` column is
 * human review state (a native speaker confirming that a row's FR and ES read
 * right), which no generator can reconstruct. Before writing, the existing
 * glossary is parsed and each ☑/✓ is carried forward, but only to a row that
 * shows exactly the EN, FR and ES the reviewer saw (see `carryMarks`):
 *
 *   - a locale row keeps its mark while its key is still there with all three
 *     strings unchanged. An inline row has no key, so it keeps its mark while
 *     its panel still lists the same three strings; identical rows of one
 *     panel therefore share a mark;
 *   - rewording any of the three puts the row back to ☐;
 *   - a mark whose row is gone (a renamed key, a string moved to the other
 *     panel or migrated to a locale key) follows its unchanged wording to the
 *     rows that are new in this run, never to a row that was already listed:
 *     the reviewer left that one unmarked, or never read it in its own
 *     context (two keys sharing an EN word can need a different FR or ES
 *     agreement).
 *
 * Until 2026-10, marks were matched on the key for locale rows and on the EN
 * string alone for inline rows: a mark leaked to every row sharing the EN
 * text whatever its FR/ES, outlived a reworded FR/ES, and was lost on a key
 * rename. A regeneration now prints each mark it drops, and each box it can't
 * read as a tick (☑ or ✓; the emoji form ☑️ counts as ☑), so a row that needs
 * re-validating is never lost track of.
 *
 * Usage:  node tools/gen-localization-glossary.js
 *         node tools/gen-localization-glossary.js --check   (exit 1 if stale)
 *
 * `npm test` makes the same comparison as `--check` (see `staleness`), so a
 * stale glossary fails CI too: it sat stale for seven weeks in 2026 while
 * nothing ran the check.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const LOCALE_DIR = "client/src/i18n/locales";
const OUT = path.join(ROOT, "docs/localization-glossary.md");

// The `Validé` column: the empty box, and the ticks a reviewer may type in it,
// strongest first (☑ is the documented one). When identical rows of a panel
// share a mark, the stronger tick is the one kept.
const UNMARKED = "☐";
const MARKS = ["☑", "✓"];
// An emoji picker appends a presentation selector to ☑ (U+2611 U+FE0F). It is
// the same character, so the selector is stripped before the box is read.
const PRESENTATION_SELECTORS = /[︎️]/g;

// Components carrying inline trilingual strings. Order drives section order.
const INLINE_SOURCES = [
  {
    label: "SettingsPanel",
    file: "client/src/components/ambient/SettingsPanel/index.js",
    blurb: "Settings overlay — the user-facing configuration surface.",
  },
  {
    label: "DebugPanel",
    file: "client/src/components/ambient/DebugPanel/index.js",
    blurb: "Debug overlay — localhost-only, reached from a desktop browser or an SSH tunnel.",
  },
];

// Human-readable headings per i18n namespace. A namespace missing from this
// map still gets a section (titled with the bare namespace) — the map is for
// readability, never a filter, so a new namespace can never be dropped.
const NAMESPACE_TITLES = {
  weather: "Weather codes + current conditions",
  errors: "Errors / loading states",
  charts: "Charts / forecast tabs",
  update: "Update modal",
  indoor: "Indoor temperature",
  metrics: "Metrics grid",
  badges: "Badges — UV / air quality / pollen",
  alert: "Alert banner + severity",
  govAlertDetail: "Gov't alert detail",
  radar: "Radar — legend + timeline",
  controls: "Controls / dock buttons",
  debug: "Debug panel — chrome",
  astronomy: "Astronomy — moon phases + solar events",
  health: "Service health indicator",
  compass: "Compass directions",
  aiView: "AI summary view",
  nowcast: "Nowcast line",
  sleep: "Sleep mode / screensaver",
};

/** Flatten a nested locale object into dotted leaf paths.
 *
 * @param {object} obj parsed locale JSON
 * @param {string} prefix accumulated dotted path
 * @returns {Map<string,string>} leaf path → string value
 */
function flatten(obj, prefix = "") {
  const out = new Map();
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const [ck, cv] of flatten(v, key)) out.set(ck, cv);
    } else {
      out.set(key, String(v));
    }
  }
  return out;
}

/** Read one JS string literal starting at `i` (which must index a quote).
 *
 * Handles escapes and both quote styles. Template literals are rejected by the
 * caller — an interpolated label can't be a static glossary row.
 *
 * @param {string} src file text
 * @param {number} i index of the opening quote
 * @returns {{value: string, end: number}|null} decoded value + index after the closing quote
 */
function readString(src, i) {
  const quote = src[i];
  if (quote !== '"' && quote !== "'") return null;
  let out = "";
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === "\\") {
      const n = src[j + 1];
      const map = { n: "\n", t: "\t", r: "\r", "\\": "\\", '"': '"', "'": "'", "`": "`" };
      out += Object.prototype.hasOwnProperty.call(map, n) ? map[n] : n;
      j += 2;
      continue;
    }
    if (c === quote) return { value: out, end: j + 1 };
    out += c;
    j += 1;
  }
  return null;
}

/** Blank out every comment in a source file without moving anything.
 *
 * The `lbl(` scan below is a plain regex, so on raw source it also hits prose
 * that merely mentions the helper — a DebugPanel JSDoc line reading "inline
 * `lbl()` strings" was counted as a non-literal call. Each comment becomes
 * spaces of the same length (newlines kept), so every offset, and therefore
 * every reported line number, is unchanged. String and template literals are
 * matched first and kept, so the `//` of a URL inside one is not taken for a
 * comment; a backslash pair is kept the same way, so the escaped slashes of a
 * regex literal like `/\/\//` can't open one either.
 *
 * @param {string} src file text
 * @returns {string} the same text with each comment blanked to spaces
 */
function blankComments(src) {
  return src.replace(
    /("(?:\\[\s\S]|[^"\\\n])*"|'(?:\\[\s\S]|[^'\\\n])*'|`(?:\\[\s\S]|[^`\\])*`|\\[\s\S])|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
    (match, kept) => kept || match.replace(/[^\n]/g, " ")
  );
}

/** Extract every `lbl(lang, "en", "fr", "es")` call from a source file.
 *
 * Deliberately literal-only: a call whose three label arguments aren't plain
 * string literals (a template, a variable, a nested call) is skipped and
 * counted, because there is no single string to put in the table. The count is
 * reported in the output so a reader knows the table isn't claiming to be
 * exhaustive when it isn't. Comments are blanked first (see `blankComments`),
 * so a mention of `lbl()` in one is neither a row nor a skipped call.
 *
 * @param {string} raw file text
 * @returns {{rows: Array<{en: string, fr: string, es: string, line: number}>, skipped: number}} parsed rows
 */
function extractLbl(raw) {
  const src = blankComments(raw);
  const rows = [];
  let skipped = 0;
  const re = /\blbl\s*\(/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    let i = m.index + m[0].length;
    const args = [];
    let literal = true;
    // First argument is the language selector — skip to the following comma at depth 0.
    let depth = 0;
    while (i < src.length) {
      const c = src[i];
      if (c === "(" || c === "[" || c === "{") depth += 1;
      else if (c === ")" || c === "]" || c === "}") depth -= 1;
      else if (c === "," && depth === 0) { i += 1; break; }
      i += 1;
    }
    for (let a = 0; a < 3; a += 1) {
      while (i < src.length && /\s/.test(src[i])) i += 1;
      const str = readString(src, i);
      if (!str) { literal = false; break; }
      args.push(str.value);
      i = str.end;
      while (i < src.length && /\s/.test(src[i])) i += 1;
      if (src[i] === ",") i += 1;
    }
    if (!literal || args.length !== 3) { skipped += 1; continue; }
    rows.push({
      en: args[0],
      fr: args[1],
      es: args[2],
      line: src.slice(0, m.index).split("\n").length,
    });
  }
  return { rows, skipped };
}

/** Escape a string for safe rendering inside a markdown table cell.
 *
 * @param {string|undefined} s raw string, or `undefined` for a translation
 *   the locale file lacks (the row is also listed under "Coverage gaps")
 * @returns {string} table-safe string
 */
function cell(s) {
  if (s === undefined) return "*(missing)*";
  return s
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "*(empty)*";
}

/** Identify a row's wording by its three rendered cells.
 *
 * Marks are compared in the rendered form: it is all the previous glossary
 * keeps, and it is what the reviewer read. (A raw-string edit that `cell()`
 * flattens away, such as a doubled space, therefore keeps the mark.)
 *
 * @param {string} en rendered EN cell
 * @param {string} fr rendered FR cell
 * @param {string} es rendered ES cell
 * @returns {string} the three cells joined by a newline, which no cell contains
 */
function wording(en, fr, es) {
  return [en, fr, es].join("\n");
}

/** Show a wording as a table row reads, for the console summary.
 *
 * @param {string} w wording from `wording()`
 * @returns {string} "EN | FR | ES"
 */
function showWording(w) {
  return w.split("\n").join(" | ");
}

/** Rank a mark for the cases where two of them meet on one wording.
 *
 * @param {string} mark a tick from MARKS, or "" for ☐
 * @returns {number} 0 for no tick; higher for a stronger tick (☑ beats ✓)
 */
function rankOf(mark) {
  return mark ? MARKS.length - MARKS.indexOf(mark) : 0;
}

/** Split a markdown table row into trimmed cells.
 *
 * Splits on unescaped pipes only, since `cell()` escapes the ones inside a
 * string, and tolerates what a hand edit can leave behind: indentation, CRLF
 * line endings, a missing trailing pipe.
 *
 * @param {string} line one line of the glossary
 * @returns {string[]|null} the cells, or null when the line is not a table row
 */
function splitRow(line) {
  const row = line.trim();
  if (!row.startsWith("|")) return null;
  const cells = row.split(/(?<!\\)\|/).slice(1).map((c) => c.trim());
  if (cells.length && cells[cells.length - 1] === "") cells.pop();
  return cells;
}

/** Parse a previously generated glossary for its validation marks.
 *
 * Rows are recognised by shape rather than by heading text: a five-cell row
 * is a locale row when its last cell is a `key`, or an inline row when it is a
 * `:line` (its panel is the `##` heading above it); a two-cell row ending in
 * a `key` is a universal string. A row counts as listed whatever its box
 * holds: a box that reads as neither ☐ nor a tick is reported, not skipped,
 * so the row can't pass for new and adopt an orphaned mark.
 *
 * @param {string} text previous glossary ("" when there is none)
 * @returns {{locale: Map<string,{wording: string, mark: string}>, inline: Map<string,Map<string,string>>, keys: Set<string>, unrecognized: Array<{where: string, box: string}>}}
 *   every locale row by key; every inline wording per panel, mapped to its mark
 *   ("" for ☐); every key the file listed, universal ones included, which is
 *   what "new in this run" is measured against; and the boxes that could not
 *   be read. Where one key or one panel wording is listed twice (a resolved
 *   merge conflict, identical rows), the stronger mark wins
 */
function parseGlossary(text) {
  const locale = new Map();
  const inline = new Map();
  const keys = new Set();
  const unrecognized = [];
  let heading = "";
  for (const line of text.split("\n")) {
    if (line.startsWith("## ")) heading = line.slice(3).trim();
    const cells = splitRow(line);
    if (!cells) continue;
    const ref = (cells[cells.length - 1] || "").match(/^`([^`]+)`$/);
    if (!ref) continue;
    const [, id] = ref;
    if (cells.length === 2) { keys.add(id); continue; }
    if (cells.length !== 5) continue;
    const [raw, en, fr, es] = cells;
    const box = raw.replace(PRESENTATION_SELECTORS, "");
    const mark = MARKS.includes(box) ? box : "";
    const isInline = /^:\d+$/.test(id);
    if (!mark && box !== UNMARKED) unrecognized.push({ where: isInline ? `${heading} ${id}` : id, box: raw });
    const w = wording(en, fr, es);
    if (isInline) {
      if (!inline.has(heading)) inline.set(heading, new Map());
      const panel = inline.get(heading);
      if (!panel.has(w) || rankOf(mark) > rankOf(panel.get(w))) panel.set(w, mark);
    } else {
      keys.add(id);
      const seen = locale.get(id);
      if (!seen || rankOf(mark) > rankOf(seen.mark)) locale.set(id, { wording: w, mark });
    }
  }
  return { locale, inline, keys, unrecognized };
}

/** Give each row of this run the mark the previous glossary left it.
 *
 * Implements the rule in the file header. First, a row still listed with the
 * same wording keeps its mark: same key for a locale row, same panel for an
 * inline row. Then a mark whose row is gone (its key no longer exists, or its
 * wording is no longer in its panel) becomes an orphan, and a row that is new
 * in this run (a key the previous file didn't list, or a wording new to its
 * panel) takes the orphaned mark of its identical wording. Every other mark is
 * dropped: reworded rows, and orphans that found no new row.
 *
 * @param {ReturnType<typeof parseGlossary>} prev the previous glossary
 * @param {Array<{key: string, wording: string}>} localeRows this run's translated locale rows
 * @param {Array<{label: string, rows: Array<{wording: string, line: number}>}>} panels this run's inline rows, per panel
 * @param {Set<string>} keys every key in this run's en.json (a key that moved to
 *   the universal table still exists, so its mark is dropped, not orphaned)
 * @returns {{marks: Map<object,string>, followed: Array<{wording: string, from: string[], to: string[]}>, dropped: Array<{where: string, wording: string}>}}
 *   the mark per row object (unmarked rows are absent); the orphaned marks
 *   that followed their wording, from the previous rows (key or panel) to the
 *   new ones (key, or panel and line); and the previous marks that reached no row
 */
function carryMarks(prev, localeRows, panels, keys) {
  const marks = new Map();
  const kept = new Set();
  const keyId = (key) => `key\n${key}`;
  const panelId = (label, w) => `panel\n${label}\n${w}`;

  for (const r of localeRows) {
    const old = prev.locale.get(r.key);
    if (old && old.mark && old.wording === r.wording) {
      marks.set(r, old.mark);
      kept.add(keyId(r.key));
    }
  }
  for (const { label, rows } of panels) {
    const old = prev.inline.get(label);
    for (const r of rows) {
      const mark = old && old.get(r.wording);
      if (!mark) continue;
      marks.set(r, mark);
      kept.add(panelId(label, r.wording));
    }
  }

  const orphans = new Map();
  const orphan = (w, mark, id, where) => {
    if (!orphans.has(w)) orphans.set(w, { mark, ids: [], from: [], to: [] });
    const o = orphans.get(w);
    o.ids.push(id);
    o.from.push(where);
  };
  for (const [key, old] of prev.locale) {
    if (old.mark && !keys.has(key)) orphan(old.wording, old.mark, keyId(key), key);
  }
  for (const [label, words] of prev.inline) {
    const panel = panels.find((p) => p.label === label);
    const listed = new Set(panel ? panel.rows.map((r) => r.wording) : []);
    for (const [w, mark] of words) {
      if (mark && !listed.has(w)) orphan(w, mark, panelId(label, w), label);
    }
  }

  const adopt = (r, where) => {
    const o = orphans.get(r.wording);
    if (!o) return;
    marks.set(r, o.mark);
    o.to.push(where);
  };
  for (const r of localeRows) {
    if (!marks.has(r) && !prev.keys.has(r.key)) adopt(r, r.key);
  }
  for (const { label, rows } of panels) {
    const old = prev.inline.get(label);
    for (const r of rows) {
      if (!marks.has(r) && !(old && old.has(r.wording))) adopt(r, `${label} :${r.line}`);
    }
  }

  const followed = [];
  for (const [w, o] of orphans) {
    if (!o.to.length) continue;
    o.ids.forEach((id) => kept.add(id));
    followed.push({ wording: showWording(w), from: o.from, to: o.to });
  }
  const dropped = [];
  for (const [key, old] of prev.locale) {
    if (old.mark && !kept.has(keyId(key))) dropped.push({ where: key, wording: showWording(old.wording) });
  }
  for (const [label, words] of prev.inline) {
    for (const [w, mark] of words) {
      if (mark && !kept.has(panelId(label, w))) dropped.push({ where: label, wording: showWording(w) });
    }
  }
  return { marks, followed, dropped };
}

/** Read the generator's inputs from a checkout.
 *
 * @param {string} root repository root
 * @returns {{en: Map<string,string>, fr: Map<string,string>, es: Map<string,string>, panels: Array<object>}}
 *   the three flattened locale trees, and each `INLINE_SOURCES` entry with the
 *   rows and skipped count `extractLbl` found in its file
 */
function loadSources(root) {
  const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
  const locale = (lang) => flatten(JSON.parse(read(`${LOCALE_DIR}/${lang}.json`)));
  return {
    en: locale("en"),
    fr: locale("fr"),
    es: locale("es"),
    panels: INLINE_SOURCES.map((src) => ({ ...src, ...extractLbl(read(src.file)) })),
  };
}

/** Render the glossary, carrying validation marks over from the previous one.
 *
 * Pure (no filesystem access), so tests can render edited copies of the
 * sources; `main` does the reading and writing.
 *
 * @param {ReturnType<typeof loadSources>} sources locale trees and inline rows
 * @param {string} previous the glossary being replaced ("" when there is none)
 * @param {string} today generation date, YYYY-MM-DD
 * @returns {{text: string, stats: {localeRows: number, universal: number, inlineRows: number, validated: number, followed: Array<object>, dropped: Array<object>, unrecognized: Array<object>}}}
 *   the file text, plus row counts, the mark moves `carryMarks` reported, and
 *   the boxes `parseGlossary` couldn't read as a tick
 */
function renderGlossary({ en, fr, es, panels }, previous, today) {
  // Locale keys whose three translations are byte-identical get their own
  // section at the bottom: listing "mph | mph | mph" 40 times buries the rows
  // a translator actually has to look at.
  const universal = [];
  const byNamespace = new Map();
  for (const key of [...en.keys()].sort()) {
    const e = en.get(key);
    const f = fr.get(key);
    const s = es.get(key);
    const row = { key, en: e, fr: f, es: s, wording: wording(cell(e), cell(f), cell(s)) };
    if (e === f && f === s) { universal.push(row); continue; }
    const ns = key.split(".")[0];
    if (!byNamespace.has(ns)) byNamespace.set(ns, []);
    byNamespace.get(ns).push(row);
  }

  const missing = [];
  for (const key of en.keys()) {
    const gaps = [];
    if (!fr.has(key)) gaps.push("fr");
    if (!es.has(key)) gaps.push("es");
    if (gaps.length) missing.push({ key, gaps });
  }
  const extra = [...new Set([...fr.keys(), ...es.keys()])].filter((k) => !en.has(k));

  // Fresh row objects: marks are tracked per row object, and the same
  // `sources` may be rendered more than once.
  const inline = panels.map((src) => ({
    ...src,
    rows: src.rows.map((r) => ({ ...r, wording: wording(cell(r.en), cell(r.fr), cell(r.es)) })),
  }));
  const prev = parseGlossary(previous);
  const { marks, followed, dropped } = carryMarks(prev, [...byNamespace.values()].flat(), inline, new Set(en.keys()));
  const box = (r) => marks.get(r) || UNMARKED;

  const L = [];
  L.push("# Localization glossary");
  L.push("");
  L.push("<!-- GENERATED FILE — do not edit by hand.");
  L.push("     Regenerate with: node tools/gen-localization-glossary.js");
  L.push("     Validation marks (☑) in the first column are carried forward while a row's wording is unchanged. -->");
  L.push("");
  L.push(`**Generated** by \`tools/gen-localization-glossary.js\` on ${today}. Re-run it after`);
  L.push("touching a locale file or an inline `lbl()` string — every row below is derived, so a");
  L.push("hand edit will be overwritten. The one exception is the **Validé** column: it is human");
  L.push("review state, and the generator carries each `☑` forward only while the row still shows");
  L.push("the EN, FR and ES the reviewer confirmed — matched on the key for locale rows, and on the");
  L.push("panel for inline rows, which have no key (identical rows of one panel share a mark).");
  L.push("Rewording any of the three puts the row back to `☐`. A mark whose row is gone — a renamed");
  L.push("key, a string moved to another file — follows its unchanged wording to the new row, never");
  L.push("to a row that was already listed.");
  L.push("");
  L.push("Replace `☐` with `☑` when a native speaker has confirmed the FR and ES wording of a row.");
  L.push("");
  L.push("## Where the strings live");
  L.push("");
  L.push("| Source | Rows | Notes |");
  L.push("|---|---|---|");
  const localeRowCount = [...byNamespace.values()].reduce((n, r) => n + r.length, 0);
  L.push(`| \`client/src/i18n/locales/{en,fr,es}.json\` | ${localeRowCount} translated + ${universal.length} identical | Every kiosk-visible surface. ${en.size} leaf keys total. |`);
  for (const src of inline) {
    L.push(`| \`${src.file}\` | ${src.rows.length}${src.skipped ? ` (+${src.skipped} non-literal, not listed)` : ""} | ${src.blurb} |`);
  }
  L.push("");
  L.push("Inline `lbl(lang, en, fr, es)` is a **codified exception** (see CLAUDE.md), permitted in");
  L.push("`SettingsPanel` and `DebugPanel` only — dense, maintainer-facing configuration surfaces");
  L.push("where keeping the three strings next to their usage beats locale-file indirection. It must");
  L.push("not spread to kiosk-visible surfaces, and never to alert content. **If a fourth language is");
  L.push("ever added, these are the rows that need a migration pass** — they are listed here in full");
  L.push("precisely so that job is scopeable.");
  L.push("");

  if (missing.length || extra.length) {
    L.push("## ⚠️ Coverage gaps");
    L.push("");
    if (missing.length) {
      L.push("Keys present in `en.json` but missing a translation:");
      L.push("");
      L.push("| Clé | Manque |");
      L.push("|---|---|");
      for (const m of missing) L.push(`| \`${m.key}\` | ${m.gaps.join(", ")} |`);
      L.push("");
    }
    if (extra.length) {
      L.push("Keys present in `fr.json` / `es.json` but absent from `en.json` (orphans — likely a");
      L.push("rename that missed a file):");
      L.push("");
      for (const k of extra) L.push(`- \`${k}\``);
      L.push("");
    }
  } else {
    L.push("## Coverage");
    L.push("");
    L.push("✅ Every key in `en.json` has an `fr.json` and `es.json` counterpart, and neither file");
    L.push("carries a key `en.json` doesn't. (Checked at generation time — a mismatch would be");
    L.push("reported here as a gap table, so an empty check means the three files are aligned.)");
    L.push("");
  }

  L.push("---");
  L.push("");
  L.push("# Locale files");
  L.push("");
  for (const ns of [...byNamespace.keys()].sort()) {
    const rows = byNamespace.get(ns);
    L.push(`## ${NAMESPACE_TITLES[ns] || ns} (\`${ns}.*\`)`);
    L.push("");
    L.push("| Validé | EN | FR | ES | Clé |");
    L.push("|--------|----|----|-----|-----|");
    for (const r of rows) {
      L.push(`| ${box(r)} | ${cell(r.en)} | ${cell(r.fr)} | ${cell(r.es)} | \`${r.key}\` |`);
    }
    L.push("");
  }

  L.push("---");
  L.push("");
  L.push("# Inline trilingual strings (`lbl()`)");
  L.push("");
  for (const src of inline) {
    L.push(`## ${src.label}`);
    L.push("");
    L.push(`${src.blurb} Source: \`${src.file}\`.`);
    if (src.skipped) {
      const one = src.skipped === 1;
      L.push("");
      L.push(`> ${src.skipped} further \`lbl()\` call${one ? "" : "s"} in this file build${one ? "s" : ""}`);
      L.push("> at least one label from a template or a variable rather than a plain string literal,");
      L.push(`> so there is no fixed wording to tabulate. ${one ? "It is" : "They are"} counted here rather than dropped`);
      L.push(`> silently — a translation pass has to read ${one ? "that call site" : "those call sites"} directly.`);
    }
    L.push("");
    L.push("| Validé | EN | FR | ES | Ligne |");
    L.push("|--------|----|----|-----|-------|");
    for (const r of src.rows) {
      L.push(`| ${box(r)} | ${cell(r.en)} | ${cell(r.fr)} | ${cell(r.es)} | \`:${r.line}\` |`);
    }
    L.push("");
  }

  L.push("---");
  L.push("");
  L.push("# Universal strings (identical across EN / FR / ES)");
  L.push("");
  L.push("Pure abbreviations, units, proper nouns and technical markers. Listed for completeness so");
  L.push("a translator can confirm they are deliberately untranslated rather than overlooked.");
  L.push("");
  L.push("| Valeur | Clé |");
  L.push("|---|---|");
  for (const r of universal) L.push(`| ${cell(r.en)} | \`${r.key}\` |`);
  L.push("");

  return {
    text: L.join("\n"),
    stats: {
      localeRows: localeRowCount,
      universal: universal.length,
      inlineRows: inline.reduce((n, s) => n + s.rows.length, 0),
      validated: marks.size,
      followed,
      dropped,
      unrecognized: prev.unrecognized,
    },
  };
}

/** Compare the glossary on disk with a regeneration, the way `--check` and
 * the drift test in `test/localizationGlossary.test.js` do.
 *
 * Ignored: the generation date, line endings, and the `:<line>` refs of the
 * inline tables. A panel edit that only moves code shifts most of those refs;
 * failing every such change for it would make the check noise, so the refs
 * catch up at the next regeneration instead. Everything else (a string, a
 * tick, the order of rows, the counts) must match.
 *
 * @param {string} previous the glossary on disk
 * @param {string} text the regenerated glossary
 * @returns {string|null} null when the file is up to date; otherwise the first
 *   differing line, as on disk and as regenerated
 */
function staleness(previous, text) {
  const normalize = (t) => t
    .replace(/\r\n/g, "\n")
    .replace(/^\*\*Generated\*\* by .* on \d{4}-\d{2}-\d{2}\./m, "**Generated**")
    .replace(/ `:\d+` \|$/gm, " `:…` |")
    .split("\n");
  const disk = normalize(previous);
  const fresh = normalize(text);
  const at = disk.length > fresh.length
    ? disk.findIndex((line, i) => line !== fresh[i])
    : fresh.findIndex((line, i) => line !== disk[i]);
  if (at === -1) return null;
  const show = (line) => (line === undefined ? "(end of file)" : line);
  return `line ${at + 1}\n  on disk:     ${show(disk[at])}\n  regenerated: ${show(fresh[at])}`;
}

function main() {
  const check = process.argv.includes("--check");
  const previous = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";

  // Local date, not toISOString(): the maintainer is UTC-4/-5, so a run after
  // ~20:00 would otherwise be stamped with tomorrow's date.
  const now = new Date();
  const today = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  const { text, stats } = renderGlossary(loadSources(ROOT), previous, today);

  if (check) {
    const diff = staleness(previous, text);
    if (diff) {
      console.error(`localization glossary is stale — run: node tools/gen-localization-glossary.js\nfirst difference at ${diff}`);
      process.exit(1);
    }
    console.log("localization glossary is up to date");
    return;
  }

  fs.writeFileSync(OUT, text);
  console.log(
    `wrote ${path.relative(ROOT, OUT)} — ${stats.localeRows} translated locale rows, ` +
    `${stats.universal} universal, ${stats.inlineRows} inline` +
    (stats.validated ? `, ${stats.validated} validated` : "")
  );
  for (const f of stats.followed) {
    console.log(`  ☑ kept, wording unchanged: ${f.from.join(" + ")} → ${f.to.join(", ")} (${f.wording})`);
  }
  for (const d of stats.dropped) {
    console.log(`  ☐ dropped, wording changed or row removed — re-validate: ${d.where} (was: ${d.wording})`);
  }
  for (const u of stats.unrecognized) {
    console.log(`  ? box "${u.box}" isn't a tick, row left ☐ — type ☑ to validate it: ${u.where}`);
  }
}

module.exports = {
  __test: { readString, blankComments, extractLbl, parseGlossary, carryMarks, loadSources, renderGlossary, staleness },
};

if (require.main === module) main();
