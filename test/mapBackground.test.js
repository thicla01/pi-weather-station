// Pins the radar map's background to the palette (designer decision,
// 2026-10-13): where no basemap tile is drawn — tiles loading or failed, the
// edge a pan uncovers, the area around a zoom's scaled tiles — the map shows
// the page background `--c-bg`, never leaflet.css's grey `#ddd`.
//
// Nothing else notices a regression: leaflet.css's `.leaflet-container
// { background: #ddd }` is a plain (0,1,0) rule, so dropping the override,
// moving it out of `.ambientRoot` (the only element that sets `--c-bg`) or
// adding a later rule with another colour all render a working map; the grey
// only shows while tiles load. `--c-bg` itself is pinned opaque in every
// palette by opaqueBgToken.test.js.
//
// Text-level, like fontWeightGuards.test.js: the suite stays deps-free, and
// CI's test job installs no client packages (leaflet.css is not on disk).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC_DIR = path.join(__dirname, "..", "client", "src");
const RESET_CSS = path.join("ui", "reset.css");
const OVERRIDE_SELECTOR = ".ambientRoot .leaflet-container";
const MAP_FILE = path.join("components", "WeatherMap", "index.js");
const AMBIENT_ROOT_FILE = path.join("components", "AmbientLayers", "index.js");

/**
 * Recursively collect every file with the given extension under a directory.
 *
 * @param {string} dir directory to walk
 * @param {string} ext extension to keep, including the dot
 * @returns {string[]} absolute paths of the matching files
 */
const walk = (dir, ext) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(p, ext);
    return p.endsWith(ext) ? [p] : [];
  });

/**
 * The innermost style rules of a stylesheet (an `@media` block's rules
 * included), comments removed.
 *
 * @param {string} css stylesheet source
 * @returns {{selectors: string[], decls: Map<string, string>}[]} each rule's
 *   comma-split selectors and its declarations (property → value)
 */
const rulesOf = (css) => {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...src.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({
    selectors: sel.split(",").map((s) => s.trim().replace(/\s+/g, " ")),
    decls: new Map(
      body
        .split(";")
        .map((d) => d.split(":"))
        .filter((parts) => parts.length >= 2)
        .map(([prop, ...value]) => [prop.trim().toLowerCase(), value.join(":").trim()]),
    ),
  }));
};

/**
 * Whether a selector's subject (its last compound) is the Leaflet container
 * itself, in plain CSS or through a CSS Modules `:global()`.
 *
 * @param {string} selector one selector of a rule
 * @returns {boolean} true when the rule styles `.leaflet-container`
 */
const targetsContainer = (selector) => {
  const subject = selector.split(/\s+|>|\+|~/).filter(Boolean).pop() || "";
  return /\.leaflet-container(?![\w-])/.test(subject);
};

test("reset.css paints the Leaflet container with --c-bg", () => {
  const rules = rulesOf(fs.readFileSync(path.join(SRC_DIR, RESET_CSS), "utf8"));
  const override = rules.find((r) => r.selectors.includes(OVERRIDE_SELECTOR));
  assert.ok(override, `${RESET_CSS} has no \`${OVERRIDE_SELECTOR}\` rule`);
  assert.equal(
    override.decls.get("background-color"),
    "var(--c-bg)",
    `${OVERRIDE_SELECTOR} must set background-color: var(--c-bg)`,
  );
});

test("reset.css is a global stylesheet of the .ambientRoot tree", () => {
  // The override is only global (unhashed `.leaflet-container`) because
  // AmbientLayers imports reset.css through the raw style-loader request.
  const src = fs.readFileSync(path.join(SRC_DIR, AMBIENT_ROOT_FILE), "utf8");
  assert.match(src, /import\s+"!style-loader!css-loader!~\/ui\/reset\.css";/);
  assert.match(src, /className=\{`ambientRoot /, "AmbientLayers no longer renders the .ambientRoot element");
});

test("no stylesheet gives the Leaflet container another background", () => {
  for (const file of walk(SRC_DIR, ".css")) {
    const rel = path.relative(SRC_DIR, file);
    for (const { selectors, decls } of rulesOf(fs.readFileSync(file, "utf8"))) {
      if (!selectors.some(targetsContainer)) continue;
      for (const prop of ["background", "background-color"]) {
        if (!decls.has(prop)) continue;
        assert.equal(
          decls.get(prop),
          "var(--c-bg)",
          `${rel}: \`${selectors.join(", ")}\` sets ${prop}: ${decls.get(prop)} (the map's empty zones must stay --c-bg)`,
        );
      }
    }
  }
});

test("every Leaflet map is WeatherMap's, mounted by an ambient layout", () => {
  // The override is scoped to .ambientRoot; a map mounted anywhere else
  // (a portal, a new top-level view) would get no --c-bg and fall back to
  // leaflet.css's grey. Widen the rule or the scope before adding one.
  const mapFiles = [];
  const weatherMapImporters = [];
  for (const file of walk(SRC_DIR, ".js")) {
    const rel = path.relative(SRC_DIR, file);
    const src = fs.readFileSync(file, "utf8");
    if (/<MapContainer\b/.test(src) || /\bL\.map\(/.test(src)) mapFiles.push(rel);
    if (/import\s+WeatherMap\s+from\s+["']~\/components\/WeatherMap["']/.test(src)) weatherMapImporters.push(rel);
  }
  assert.deepEqual(mapFiles, [MAP_FILE]);
  assert.ok(weatherMapImporters.length > 0, "nothing imports WeatherMap any more — update this test");
  for (const rel of weatherMapImporters) {
    assert.match(
      rel,
      /^components\/ambient\/Layout(?:Pi|Desktop|Mobile)\/index\.js$/,
      `${rel} mounts WeatherMap outside the three ambient layouts`,
    );
  }
});
