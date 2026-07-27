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
 * VALIDATION MARKS ARE PRESERVED. The `Validé` column is human review state
 * (a native speaker confirming a translation reads right), which no generator
 * can reconstruct. Before writing, the existing glossary is parsed and every
 * ☑/✓ is carried forward, matched on the row's key for locale rows and on the
 * EN string for inline rows. A regeneration therefore never silently discards
 * review work — the whole reason it is safe to re-run.
 *
 * Usage:  node tools/gen-localization-glossary.js
 *         node tools/gen-localization-glossary.js --check   (exit 1 if stale)
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const LOCALE_DIR = path.join(ROOT, "client/src/i18n/locales");
const OUT = path.join(ROOT, "docs/localization-glossary.md");

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

/** Extract every `lbl(lang, "en", "fr", "es")` call from a source file.
 *
 * Deliberately literal-only: a call whose three label arguments aren't plain
 * string literals (a template, a variable, a nested call) is skipped and
 * counted, because there is no single string to put in the table. The count is
 * reported in the output so a reader knows the table isn't claiming to be
 * exhaustive when it isn't.
 *
 * @param {string} src file text
 * @returns {{rows: Array<{en: string, fr: string, es: string, line: number}>, skipped: number}} parsed rows
 */
function extractLbl(src) {
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
 * @param {string} s raw string
 * @returns {string} table-safe string
 */
function cell(s) {
  return s
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "*(empty)*";
}

/** Parse the previous glossary for human validation marks.
 *
 * @param {string} file path to the existing glossary (may not exist)
 * @returns {{byKey: Map<string,string>, byEn: Map<string,string>, rows: number}} preserved
 *   marks indexed both ways, plus the count of marked rows found
 */
function readExistingMarks(file) {
  const byKey = new Map();
  const byEn = new Map();
  let rows = 0;
  if (!fs.existsSync(file)) return { byKey, byEn, rows };
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.startsWith("|")) continue;
    const cols = line.split("|").map((c) => c.trim());
    // cols[0] is the empty string before the leading pipe.
    const mark = cols[1];
    if (mark !== "☑" && mark !== "✓") continue;
    rows += 1;
    const en = cols[2];
    const last = cols[cols.length - 2] || "";
    const keyMatch = last.match(/`([^`]+)`/);
    // A locale row is matched on its key; an inline row has no key, so it is
    // matched on its EN wording. Both indexes are populated for locale rows so
    // a key that later moves namespace still keeps its mark.
    if (keyMatch) byKey.set(keyMatch[1], mark);
    if (en) byEn.set(en, mark);
  }
  return { byKey, byEn, rows };
}

function main() {
  const check = process.argv.includes("--check");

  const en = flatten(JSON.parse(fs.readFileSync(path.join(LOCALE_DIR, "en.json"), "utf8")));
  const fr = flatten(JSON.parse(fs.readFileSync(path.join(LOCALE_DIR, "fr.json"), "utf8")));
  const es = flatten(JSON.parse(fs.readFileSync(path.join(LOCALE_DIR, "es.json"), "utf8")));

  const marks = readExistingMarks(OUT);
  const markFor = (key, enText) =>
    marks.byKey.get(key) || (key ? "☐" : marks.byEn.get(cell(enText)) || "☐");

  // Locale keys whose three translations are byte-identical get their own
  // section at the bottom: listing "mph | mph | mph" 40 times buries the rows
  // a translator actually has to look at.
  const universal = [];
  const byNamespace = new Map();
  for (const key of [...en.keys()].sort()) {
    const e = en.get(key);
    const f = fr.get(key);
    const s = es.get(key);
    const row = { key, en: e, fr: f, es: s };
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

  const inline = INLINE_SOURCES.map((src) => {
    const text = fs.readFileSync(path.join(ROOT, src.file), "utf8");
    return { ...src, ...extractLbl(text) };
  });

  // Local date, not toISOString(): the maintainer is UTC-4/-5, so a run after
  // ~20:00 would otherwise be stamped with tomorrow's date.
  const now = new Date();
  const today = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  const L = [];
  L.push("# Localization glossary");
  L.push("");
  L.push("<!-- GENERATED FILE — do not edit by hand.");
  L.push("     Regenerate with: node tools/gen-localization-glossary.js");
  L.push("     Validation marks (☑) in the first column ARE preserved across runs. -->");
  L.push("");
  L.push(`**Generated** by \`tools/gen-localization-glossary.js\` on ${today}. Re-run it after`);
  L.push("touching a locale file or an inline `lbl()` string — every row below is derived, so a");
  L.push("hand edit will be overwritten. The one exception is the **Validé** column: it is human");
  L.push("review state and the generator carries existing `☑` marks forward, matching on the key");
  L.push("(locale rows) or on the EN string (inline rows).");
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
      L.push(`| ${markFor(r.key)} | ${cell(r.en)} | ${cell(r.fr)} | ${cell(r.es)} | \`${r.key}\` |`);
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
      L.push("");
      L.push(`> ${src.skipped} further \`lbl()\` call${src.skipped === 1 ? "" : "s"} in this file build`);
      L.push("> at least one label from a template or a variable rather than a plain string literal,");
      L.push("> so there is no fixed wording to tabulate. They are counted here rather than dropped");
      L.push("> silently — a translation pass has to read those call sites directly.");
    }
    L.push("");
    L.push("| Validé | EN | FR | ES | Ligne |");
    L.push("|--------|----|----|-----|-------|");
    for (const r of src.rows) {
      L.push(`| ${markFor(null, r.en)} | ${cell(r.en)} | ${cell(r.fr)} | ${cell(r.es)} | \`:${r.line}\` |`);
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

  const out = L.join("\n");

  if (check) {
    const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
    const strip = (t) => t.replace(/^\*\*Generated\*\* by .* on \d{4}-\d{2}-\d{2}\./m, "");
    if (strip(current) !== strip(out)) {
      console.error("localization glossary is stale — run: node tools/gen-localization-glossary.js");
      process.exit(1);
    }
    console.log("localization glossary is up to date");
    return;
  }

  fs.writeFileSync(OUT, out);
  const preserved = marks.rows;
  console.log(
    `wrote ${path.relative(ROOT, OUT)} — ${localeRowCount} translated locale rows, ` +
    `${universal.length} universal, ${inline.reduce((n, s) => n + s.rows.length, 0)} inline` +
    (preserved ? `, ${preserved} validation mark(s) preserved` : "")
  );
}

main();
