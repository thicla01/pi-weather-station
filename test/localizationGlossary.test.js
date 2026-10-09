// Regression tests for tools/gen-localization-glossary.js, the generator
// behind docs/localization-glossary.md (CLAUDE.md, "Documentation hygiene").
//
// Most of them guard the `Validé` column: native-speaker review state the
// generator has to carry across regenerations. A ☑ attests to one exact
// EN + FR + ES wording, so it must never reach a row whose wording the
// reviewer didn't see, must drop when that wording changes, and must survive
// a key rename. Until 2026-10, marks were matched on the key, or on an inline
// row's EN string alone, and a sandbox run showed all three failures: 5
// seeded ticks came out as 13, a reworded FR kept its tick ("Services" →
// "Prestations", "ALIMENTATION OK" → "ALIM. OK"), and a renamed key lost it.
// No row had been validated yet, so no mark needed migrating.
//
// The targeted cases render a small in-memory fixture modelled on the real
// rows that exposed each failure, so editing a real string can't break them;
// the round trips render the real locale files and panels (read-only).
// Nothing is written to disk. The scanner helpers that feed the inline table
// (`readString`, `blankComments`, `extractLbl`) are covered at the end.
//
// Run: `npm test` or `node --test test/localizationGlossary.test.js`.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { __test } = require("../tools/gen-localization-glossary");
const { readString, blankComments, extractLbl, parseGlossary, loadSources, renderGlossary, isStale } = __test;

const DATE = "2026-10-08";
const REAL = loadSources(path.join(__dirname, ".."));

/**
 * Build sources shaped like `loadSources()` output, modelled on the real rows
 * behind each failure: inline rows sharing a locale row's EN ("Display",
 * "avg") or its whole wording ("Services", "Close"), identical rows within a
 * panel ("Auto"), and two keys with one wording ("Wind").
 *
 * @returns {object} fresh sources a test may edit
 */
function fixture() {
  const locale = {
    "health.chipPrefix": ["Services", "Services", "Servicios"],
    "controls.groupDisplay": ["Display", "Affichage", "Visualización"],
    "charts.pillAvg": ["avg", "moy.", "prom."],
    "charts.tabPrecip": ["Precip", "Précip", "Precip"],
    "charts.tabWind": ["Wind", "Vent", "Viento"],
    "metrics.wind": ["Wind", "Vent", "Viento"],
    "metrics.uv": ["UV", "UV", "UV"],
  };
  const lang = (i) => new Map(Object.entries(locale).map(([k, v]) => [k, v[i]]));
  const rows = (list) => list.map(([en, fr, es], i) => ({ en, fr, es, line: 10 * (i + 1) }));
  return {
    en: lang(0),
    fr: lang(1),
    es: lang(2),
    panels: [
      {
        label: "SettingsPanel",
        file: "settings.js",
        blurb: "Settings.",
        skipped: 0,
        rows: rows([
          ["Auto", "Auto", "Auto"],
          ["Display", "Affichage", "Pantalla"],
          ["Auto", "Auto", "Auto"],
          ["Close", "Fermer", "Cerrar"],
        ]),
      },
      {
        label: "DebugPanel",
        file: "debug.js",
        blurb: "Debug.",
        skipped: 0,
        rows: rows([
          ["Services", "Services", "Servicios"],
          ["avg", "moy", "prom"],
          ["POWER OK", "ALIMENTATION OK", "ALIMENTACIÓN OK"],
          ["Close", "Fermer", "Cerrar"],
        ]),
      },
    ],
  };
}

/**
 * Render a glossary, carrying marks over from `previous`.
 *
 * @param {object} src sources to render
 * @param {string} previous glossary the marks come from
 * @returns {{text: string, stats: object}} renderGlossary's result
 */
const render = (src, previous = "") => renderGlossary(src, previous, DATE);

/**
 * List the rows of a glossary that carry a `Validé` box.
 *
 * @param {string} text glossary text
 * @returns {Array<{idx: number, box: string, en: string, fr: string, es: string, panel: (string|null), ref: string}>}
 *   one entry per row: `idx` is its line index, `panel` is null on a locale
 *   row, and `ref` is the key or the `:line`
 */
function rowsOf(text) {
  const out = [];
  let heading = "";
  text.split("\n").forEach((line, idx) => {
    if (line.startsWith("## ")) heading = line.slice(3);
    const cells = line.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim());
    if (cells.length !== 5 || !/^[☐☑✓]$/.test(cells[0])) return;
    const [box, en, fr, es, ref] = cells;
    const inline = ref.startsWith("`:");
    out.push({ idx, box, en, fr, es, panel: inline ? heading : null, ref: ref.slice(1, -1) });
  });
  return out;
}

/**
 * Name a row for assertions: its key, or "<panel> <EN> :<line>".
 *
 * @param {object} r row from rowsOf
 * @returns {string} row id
 */
const idOf = (r) => (r.panel ? `${r.panel} ${r.en} ${r.ref}` : r.ref);

/**
 * Identify an inline row's wording within its panel.
 *
 * @param {object} r row from rowsOf
 * @returns {string} panel + EN + FR + ES
 */
const twinKey = (r) => [r.panel, r.en, r.fr, r.es].join("\n");

/**
 * Count each inline wording's rows within its panel.
 *
 * @param {object[]} rows rows from rowsOf
 * @returns {Map<string,number>} twinKey → number of rows
 */
function twinCounts(rows) {
  const counts = new Map();
  for (const r of rows) if (r.panel) counts.set(twinKey(r), (counts.get(twinKey(r)) || 0) + 1);
  return counts;
}

/**
 * List the ticked rows of a glossary, sorted.
 *
 * @param {string} text glossary text
 * @returns {string[]} row ids
 */
const ticked = (text) => rowsOf(text).filter((r) => r.box !== "☐").map(idOf).sort();

/**
 * Tick rows the way a reviewer does, by editing the box in the text.
 *
 * @param {string} text glossary text
 * @param {function(object): boolean} pick selects rows (see rowsOf)
 * @param {{mark?: string, first?: boolean}} [opts] tick to type; `first`
 *   ticks only the first row picked
 * @returns {string} edited text
 */
function tick(text, pick, { mark = "☑", first = false } = {}) {
  const picked = rowsOf(text).filter(pick).slice(0, first ? 1 : undefined);
  assert.ok(picked.length, "tick(): no row picked");
  const lines = text.split("\n");
  for (const r of picked) lines[r.idx] = lines[r.idx].replace(/^\| ☐ \|/, `| ${mark} |`);
  return lines.join("\n");
}

const key = (k) => (r) => r.ref === k;
const inl = (panel, en) => (r) => r.panel === panel && r.en === en;
const LANGS = ["en", "fr", "es"];

/**
 * Rename a locale key in all three locale maps, keeping its strings.
 *
 * @param {object} src sources to edit
 * @param {string} from old key
 * @param {string} to new key
 * @returns {void}
 */
function renameKey(src, from, to) {
  for (const lang of LANGS) {
    src[lang].set(to, src[lang].get(from));
    src[lang].delete(from);
  }
}

// ── Validation marks: the targeted cases ────────────────────────────────

test("parseGlossary tells the row kinds apart by shape and reads escaped pipes as text", () => {
  const prev = parseGlossary([
    "| Source | Rows | Notes |",
    "| `client/src/i18n/locales/{en,fr,es}.json` | 2 translated | Every surface. |",
    "| Clé | Manque |",
    "| `badges.gap` | fr |",
    "## Charts (`charts.*`)",
    "| Validé | EN | FR | ES | Clé |",
    "|--------|----|----|-----|-----|",
    "| ☑ | avg \\| mean | moy. | prom. | `charts.pillAvg` |",
    "| ☐ | Precip | Précip | Precip | `charts.tabPrecip` |",
    "  | ☑️ | Wind | Vent | Viento | `charts.tabWind`",
    "| ✅ | Wind | Vent | Viento | `metrics.wind` |",
    "## DebugPanel",
    "| ✓ | avg | moy | prom | `:856` |",
    "| ☐ | avg | moy | prom | `:1232` |",
    "| ☐ | Close | Fermer | Cerrar | `:354` |\r",
    "| Valeur | Clé |",
    "| UV | `metrics.uv` |",
  ].join("\n"));
  assert.deepEqual([...prev.locale], [
    ["charts.pillAvg", { wording: "avg \\| mean\nmoy.\nprom.", mark: "☑" }],
    ["charts.tabPrecip", { wording: "Precip\nPrécip\nPrecip", mark: "" }],
    // Indented, no trailing pipe, emoji form of ☑: still a ticked row.
    ["charts.tabWind", { wording: "Wind\nVent\nViento", mark: "☑" }],
    // A box that isn't a tick: the row is listed, unticked, and reported.
    ["metrics.wind", { wording: "Wind\nVent\nViento", mark: "" }],
  ]);
  assert.deepEqual(prev.unrecognized, [{ where: "metrics.wind", box: "✅" }]);
  // Identical rows of a panel collapse into one wording, ticked if any is.
  assert.deepEqual([...prev.inline.get("DebugPanel")], [["avg\nmoy\nprom", "✓"], ["Close\nFermer\nCerrar", ""]]);
  assert.deepEqual([...prev.keys].sort(), ["charts.pillAvg", "charts.tabPrecip", "charts.tabWind", "metrics.uv", "metrics.wind"]);
});

test("a locale tick stays on its key, even where an inline row shares its EN or its whole wording", () => {
  const src = fixture();
  const picked = ["health.chipPrefix", "controls.groupDisplay", "charts.pillAvg"];
  const seeded = tick(render(src).text, (r) => picked.includes(r.ref));
  // Before 2026-10, each of these also ticked the inline rows sharing its EN:
  // "Display" (ES "Pantalla", not "Visualización"), "avg" ("moy"/"prom", not
  // "moy."/"prom."), and DebugPanel's "Services", whose wording is identical
  // but which nobody read in that panel.
  assert.deepEqual(ticked(render(src, seeded).text), [...picked].sort());
});

test("an inline tick is shared by the identical rows of its own panel, and nowhere else", () => {
  const src = fixture();
  let seeded = tick(render(src).text, inl("SettingsPanel", "Auto"), { first: true });
  seeded = tick(seeded, inl("SettingsPanel", "Close"));
  seeded = tick(seeded, inl("SettingsPanel", "Display"));
  assert.deepEqual(ticked(render(src, seeded).text), [
    // Same wording in the same panel, and no key to tell the two rows apart.
    "SettingsPanel Auto :10",
    "SettingsPanel Auto :30",
    // DebugPanel's identical "Close" stays ☐, and so does controls.groupDisplay.
    "SettingsPanel Close :40",
    "SettingsPanel Display :20",
  ]);
});

test("a locale tick doesn't spread to another key with the same wording", () => {
  const src = fixture();
  const seeded = tick(render(src).text, key("charts.tabWind"));
  // metrics.wind reads "Wind | Vent | Viento" too, but in another context, so
  // its agreement may differ: it needs its own review.
  assert.deepEqual(ticked(render(src, seeded).text), ["charts.tabWind"]);
});

for (const lang of LANGS) {
  test(`rewording the ${lang.toUpperCase()} string drops the tick, on a locale row and on an inline row`, () => {
    const src = fixture();
    const seeded = tick(render(src).text, (r) => r.ref === "health.chipPrefix" || r.en === "POWER OK");
    src[lang].set("health.chipPrefix", `${src[lang].get("health.chipPrefix")} (reworded)`);
    const power = src.panels[1].rows.find((r) => r.en === "POWER OK");
    power[lang] = `${power[lang]} (reworded)`;

    const { text, stats } = render(src, seeded);
    assert.deepEqual(ticked(text), []);
    assert.deepEqual(stats.dropped.map((d) => d.where), ["health.chipPrefix", "DebugPanel"]);
    assert.deepEqual(stats.followed, []);
  });
}

test("a renamed key keeps its tick while its wording is unchanged, and loses it when reworded too", () => {
  const seeded = tick(render(fixture()).text, key("charts.tabPrecip"));

  const renamed = fixture();
  renameKey(renamed, "charts.tabPrecip", "charts.tabPrecipitation");
  const kept = render(renamed, seeded);
  assert.deepEqual(ticked(kept.text), ["charts.tabPrecipitation"]);
  assert.deepEqual(kept.stats.followed, [
    { wording: "Precip | Précip | Precip", from: ["charts.tabPrecip"], to: ["charts.tabPrecipitation"] },
  ]);
  assert.deepEqual(kept.stats.dropped, []);

  const reworded = fixture();
  renameKey(reworded, "charts.tabPrecip", "charts.tabPrecipitation");
  reworded.es.set("charts.tabPrecipitation", "Precipitación");
  const lost = render(reworded, seeded);
  assert.deepEqual(ticked(lost.text), []);
  assert.deepEqual(lost.stats.dropped, [{ where: "charts.tabPrecip", wording: "Precip | Précip | Precip" }]);
});

test("an orphaned tick reaches only rows new in this run, never one already listed", () => {
  const seeded = tick(render(fixture()).text, key("charts.tabWind"));

  // Deleted outright: metrics.wind has the identical wording but was already
  // listed, unticked, so it doesn't inherit.
  const deleted = fixture();
  for (const lang of LANGS) deleted[lang].delete("charts.tabWind");
  const gone = render(deleted, seeded);
  assert.deepEqual(ticked(gone.text), []);
  assert.deepEqual(gone.stats.dropped.map((d) => d.where), ["charts.tabWind"]);

  // Renamed: the new key inherits, metrics.wind still doesn't.
  const renamed = fixture();
  renameKey(renamed, "charts.tabWind", "charts.tabWindSpeed");
  assert.deepEqual(ticked(render(renamed, seeded).text), ["charts.tabWindSpeed"]);

  // Same for an inline row already listed with the orphan's wording, whether
  // the orphan comes from a deleted key or from the other panel.
  let both = tick(render(fixture()).text, key("health.chipPrefix"));
  both = tick(both, inl("SettingsPanel", "Close"));
  const orphaned = fixture();
  for (const lang of LANGS) orphaned[lang].delete("health.chipPrefix");
  orphaned.panels[0].rows = orphaned.panels[0].rows.filter((r) => r.en !== "Close");
  const kept = render(orphaned, both);
  assert.deepEqual(ticked(kept.text), []); // DebugPanel's "Services" and "Close" stay ☐
  assert.deepEqual(kept.stats.dropped.map((d) => d.where), ["health.chipPrefix", "SettingsPanel"]);
});

test("a key from the universal table counts as already listed", () => {
  const seeded = tick(render(fixture()).text, key("charts.tabWind"));
  const src = fixture();
  for (const lang of LANGS) src[lang].delete("charts.tabWind");
  // metrics.uv ("UV" in all three) was listed in the universal table, so it
  // is not new when it comes back translated with the orphan's wording.
  src.en.set("metrics.uv", "Wind");
  src.fr.set("metrics.uv", "Vent");
  src.es.set("metrics.uv", "Viento");
  assert.deepEqual(ticked(render(src, seeded).text), []);
});

test("a key that moves to the universal table drops its tick rather than passing it on", () => {
  const seeded = tick(render(fixture()).text, key("charts.tabPrecip"));
  const src = fixture();
  src.fr.set("charts.tabPrecip", "Precip"); // now "Precip" in all three: universal
  for (const lang of LANGS) src[lang].set("charts.precipitation", fixture()[lang].get("charts.tabPrecip"));
  const { text, stats } = render(src, seeded);
  // The key still exists, so its mark is dropped, not orphaned: the new key
  // with the old wording gets nothing.
  assert.deepEqual(ticked(text), []);
  assert.deepEqual(stats.dropped.map((d) => d.where), ["charts.tabPrecip"]);
});

test("a box that isn't a tick is reported, and its row still counts as already listed", () => {
  let seeded = tick(render(fixture()).text, key("charts.tabWind"));
  seeded = tick(seeded, key("metrics.wind"), { mark: "[ ]" });
  seeded = tick(seeded, key("charts.pillAvg"), { mark: "✅" });
  const src = fixture();
  for (const lang of LANGS) src[lang].delete("charts.tabWind");
  const { text, stats } = render(src, seeded);
  // metrics.wind was listed, so the orphaned "Wind" tick doesn't reach it.
  assert.deepEqual(ticked(text), []);
  assert.deepEqual(stats.unrecognized, [
    { where: "charts.pillAvg", box: "✅" },
    { where: "metrics.wind", box: "[ ]" },
  ]);
});

test("a ☑ typed with an emoji picker (☑ + U+FE0F) reads as ☑", () => {
  const src = fixture();
  const seeded = tick(render(src).text, (r) => r.ref === "charts.pillAvg" || r.en === "POWER OK", { mark: "☑️" });
  const { text, stats } = render(src, seeded);
  assert.deepEqual(ticked(text), ["DebugPanel POWER OK :30", "charts.pillAvg"]);
  assert.equal(text, tick(render(src).text, (r) => r.ref === "charts.pillAvg" || r.en === "POWER OK"));
  assert.deepEqual(stats.unrecognized, []);
});

test("indentation, CRLF line endings and a missing trailing pipe don't hide a tick", () => {
  const src = fixture();
  const seeded = tick(render(src).text, (r) => r.ref === "charts.pillAvg" || r.en === "POWER OK");
  const mangled = seeded
    .split("\n")
    .map((l) => (l.startsWith("| ☑ |") ? `  ${l.replace(/ \|$/, "")}` : l))
    .join("\r\n");
  assert.equal(render(src, mangled).text, seeded);
});

test("identical rows of a panel ticked ✓ and ☑ both come back ☑, in either order", () => {
  const src = fixture();
  const base = render(src).text;
  const auto = (ln) => (r) => r.panel === "SettingsPanel" && r.ref === `:${ln}`;
  const expected = tick(base, inl("SettingsPanel", "Auto"));
  const checkFirst = tick(tick(base, auto(10), { mark: "✓" }), auto(30));
  const tickFirst = tick(tick(base, auto(10)), auto(30), { mark: "✓" });
  assert.equal(render(src, checkFirst).text, expected);
  assert.equal(render(src, tickFirst).text, expected);
});

test("a key listed twice (say, after a merge conflict) keeps the stronger mark", () => {
  const src = fixture();
  const seeded = tick(render(src).text, key("charts.pillAvg"));
  const lines = seeded.split("\n");
  const at = lines.findIndex((l) => l.endsWith("`charts.pillAvg` |"));
  const unticked = lines[at].replace(/^\| ☑ \|/, "| ☐ |");
  const tickFirst = [...lines.slice(0, at + 1), unticked, ...lines.slice(at + 1)].join("\n");
  const tickLast = [...lines.slice(0, at), unticked, ...lines.slice(at)].join("\n");
  assert.deepEqual(ticked(render(src, tickFirst).text), ["charts.pillAvg"]);
  assert.deepEqual(ticked(render(src, tickLast).text), ["charts.pillAvg"]);
});

test("--check ignores the generation date and nothing else", () => {
  const src = fixture();
  const base = render(src).text;
  const otherDay = renderGlossary(src, "", "2027-01-31").text;
  assert.notEqual(otherDay, base);
  assert.equal(isStale(base, otherDay), false);
  assert.equal(isStale(base, tick(base, key("charts.pillAvg"))), true);
  assert.equal(isStale(base, base.replace("| Précip |", "| Précip. |")), true);
});

test("a string moved to the other panel, or migrated to a locale key, keeps its tick", () => {
  const seeded = tick(render(fixture()).text, inl("DebugPanel", "POWER OK"));
  const takeOut = (src) => {
    const { rows } = src.panels[1];
    return rows.splice(rows.findIndex((r) => r.en === "POWER OK"), 1)[0];
  };

  const moved = fixture();
  moved.panels[0].rows.push({ ...takeOut(moved), line: 50 });
  assert.deepEqual(ticked(render(moved, seeded).text), ["SettingsPanel POWER OK :50"]);

  // What a fourth language would bring: `lbl()` strings moving to locale keys.
  const migrated = fixture();
  const row = takeOut(migrated);
  for (const lang of LANGS) migrated[lang].set("debug.powerOk", row[lang]);
  assert.deepEqual(ticked(render(migrated, seeded).text), ["debug.powerOk"]);
});

test("a ✓ counts as a tick and is written back as typed", () => {
  const src = fixture();
  const seeded = tick(render(src).text, (r) => r.ref === "charts.pillAvg" || r.en === "POWER OK", { mark: "✓" });
  assert.equal(render(src, seeded).text, seeded);
});

test("a pipe inside a string splits neither its cell nor the tick's match", () => {
  const src = fixture();
  src.en.set("charts.pillAvg", "avg | mean");
  src.panels[1].rows[1].fr = "moy | moyenne";
  const base = render(src).text;
  assert.match(base, /^\| ☐ \| avg \\\| mean \| moy\. \| prom\. \| `charts\.pillAvg` \|$/m);
  const seeded = tick(base, (r) => r.ref === "charts.pillAvg" || r.en === "avg");
  assert.equal(render(src, seeded).text, seeded);
});

test("a key missing from fr.json is listed as a coverage gap instead of crashing the run", () => {
  const src = fixture();
  const seeded = tick(render(src).text, key("charts.pillAvg"));
  src.fr.delete("charts.pillAvg");
  // Until 2026-10 this threw a TypeError in cell(), so the gap table below
  // could never be rendered.
  const { text, stats } = render(src, seeded);
  assert.match(text, /^## ⚠️ Coverage gaps$/m);
  assert.match(text, /^\| `charts\.pillAvg` \| fr \|$/m);
  assert.match(text, /^\| ☐ \| avg \| \*\(missing\)\* \| prom\. \| `charts\.pillAvg` \|$/m);
  assert.deepEqual(stats.dropped.map((d) => d.where), ["charts.pillAvg"]);
});

// ── Validation marks: round trips on the real glossary ─────────────────

test("round trip on the real sources: regenerating a hand-ticked glossary reproduces it byte for byte", () => {
  const base = render(REAL).text;
  const rows = rowsOf(base);
  const twins = twinCounts(rows);
  // Every 7th row, a third of them as ✓. Inline rows with an identical twin
  // in their panel are skipped: those share one tick by design (next test).
  const lines = base.split("\n");
  let n = 0;
  rows.forEach((r, i) => {
    if (i % 7 || (r.panel && twins.get(twinKey(r)) > 1)) return;
    lines[r.idx] = lines[r.idx].replace(/^\| ☐ \|/, `| ${n % 3 ? "☑" : "✓"} |`);
    n += 1;
  });
  const seeded = lines.join("\n");
  assert.ok(n > 10, `only ${n} rows ticked`);
  assert.equal(render(REAL, seeded).text, seeded);
});

test("round trip on the real sources: a tick reaches the identical rows of its panel and nothing else, then the file is stable", () => {
  const base = render(REAL).text;
  const rows = rowsOf(base);
  const twins = twinCounts(rows);
  const inlineEn = new Set(rows.filter((r) => r.panel).map((r) => r.en));
  const panelsOf = new Map();
  for (const r of rows.filter((x) => x.panel)) {
    const w = [r.en, r.fr, r.es].join("\n");
    if (!panelsOf.has(w)) panelsOf.set(w, []);
    if (!panelsOf.get(w).includes(r.panel)) panelsOf.get(w).push(r.panel);
  }
  // Every 7th row; the first row of each group of identical rows in a panel,
  // so sharing runs on real data; and the rows a leak would start from: each
  // locale row whose EN also labels an inline row, and, for a wording found in
  // both panels, its rows in the first one.
  const firsts = new Set();
  const lines = base.split("\n");
  rows.forEach((r, i) => {
    const firstTwin = r.panel && twins.get(twinKey(r)) > 1 && !firsts.has(twinKey(r));
    if (firstTwin) firsts.add(twinKey(r));
    const sharedEn = !r.panel && inlineEn.has(r.en);
    const inPanels = r.panel ? panelsOf.get([r.en, r.fr, r.es].join("\n")) : [];
    const crossPanel = inPanels.length > 1 && inPanels[0] === r.panel;
    if (i % 7 === 0 || firstTwin || sharedEn || crossPanel) lines[r.idx] = lines[r.idx].replace(/^\| ☐ \|/, "| ☑ |");
  });
  const seeded = lines.join("\n");

  const once = render(REAL, seeded).text;
  assert.equal(render(REAL, once).text, once, "a regenerated glossary must be a fixed point");
  const before = rowsOf(seeded).filter((r) => r.box !== "☐");
  const after = rowsOf(once).filter((r) => r.box !== "☐");
  const ids = new Set(after.map(idOf));
  for (const r of before) assert.ok(ids.has(idOf(r)), `tick lost: ${idOf(r)}`);
  const tickedTwins = new Set(before.filter((r) => r.panel).map(twinKey));
  for (const r of rows.filter((x) => x.panel && tickedTwins.has(twinKey(x)))) {
    assert.ok(ids.has(idOf(r)), `identical row left unticked: ${idOf(r)}`);
  }
  const was = new Set(before.map(idOf));
  for (const r of after) {
    if (!was.has(idOf(r))) assert.ok(r.panel && tickedTwins.has(twinKey(r)), `tick spread to ${idOf(r)}`);
  }
});

// ── Scanner helpers behind the inline table ────────────────────────────

test("readString decodes both quote styles and their escapes", () => {
  assert.deepEqual(readString('"a\\"b\\n" + x', 0), { value: 'a"b\n', end: 8 });
  assert.deepEqual(readString("x = 'it\\'s';", 4), { value: "it's", end: 11 });
  assert.equal(readString('"never closed', 0), null);
  assert.equal(readString("`template`", 0), null);
  assert.equal(readString("label", 0), null);
});

test("blankComments turns comments into same-length spaces and keeps every newline", () => {
  const src = 'a(); // see lbl()\n/** inline\n * `lbl()` */ b();';
  const expected = `a(); ${" ".repeat(12)}\n${" ".repeat(10)}\n${" ".repeat(13)} b();`;
  assert.equal(blankComments(src), expected);
});

test("blankComments keeps // inside string and template literals", () => {
  const src = 'f("http://a.b", \'c//d\', `e//f ${g}`, "h \\" // i"); // tail';
  assert.equal(blankComments(src), `f("http://a.b", 'c//d', \`e//f \${g}\`, "h \\" // i");${" ".repeat(8)}`);
});

test("blankComments leaves a regex literal with escaped slashes alone", () => {
  assert.equal(blankComments("const re = /\\/\\//g; // c"), `const re = /\\/\\//g;${" ".repeat(5)}`);
});

test("extractLbl reads literal calls with their line, and counts the others without listing them", () => {
  const src = [
    "// a comment mentioning lbl() is neither a row nor a skipped call",
    'const a = lbl(lang, "Auto", "Auto", "Auto");',
    "const b = lbl(pick(lang, 'x'), 'it\\'s', \"l'été\",",
    '  "el verano");',
    'const c = lbl(lang, `Hi ${name}`, "Salut", "Hola");',
    'const d = lbl(lang, label, "FR", "ES");',
    "/**",
    ' * lbl(lang, "in", "a", "JSDoc")',
    " */",
    'const e = lbl(lang, "Close", "Fermer", "Cerrar");',
  ].join("\n");
  assert.deepEqual(extractLbl(src), {
    rows: [
      { en: "Auto", fr: "Auto", es: "Auto", line: 2 },
      { en: "it's", fr: "l'été", es: "el verano", line: 3 },
      { en: "Close", fr: "Fermer", es: "Cerrar", line: 10 },
    ],
    skipped: 2,
  });
});
