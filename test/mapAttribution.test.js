// Locks in the radar map's legal attribution credits. The Leaflet attribution
// strip is the only place the app credits its map data, and nothing in the
// build, the lint or the rest of the suite notices a credit going missing:
// the strings are free-form HTML handed to Leaflet, so a map without
// "© OpenStreetMap" (or without a whole layer's credit) renders perfectly
// normally. That is exactly how the OSM credit was missing until 2026-10.
//
// The credits this guard enforces (checked 2026-10-09):
//   - Mapbox basemap: "© Mapbox" and "© OpenStreetMap"
//     (https://docs.mapbox.com/help/dive-deeper/attribution/). Every style the
//     Settings panel offers (streets-v12, light-v10/11, dark-v10/11), like the
//     proxy's other allowed styles (ALLOWED_STYLES / CUSTOM_STYLES in
//     server/proxyCtrl.js: navigation-day-v1, the custom-light Studio style),
//     draws on the Mapbox Streets tileset, i.e. OpenStreetMap data.
//   - RainViewer radar frames: "RainViewer".
//   - ECCC GeoMet radar: "Environment Canada" (ECCC terms of use).
// Mapbox also asks for linked credits, "Improve this map" and its logo
// (wordmark): not enforced here, see ROADMAP "Leaflet attribution strip
// renders live external links".
// The OSM credit is plain text on purpose: a new external <a> would break the
// kiosk QR-only rule (test/kioskExternalLinks.test.js). So this guard checks
// the VISIBLE text of each attribution string (tags stripped, entities
// decoded), never the link markup.
//
// Same spirit as react19Guards.test.js: mechanical, source-level, loud.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC_DIR = path.join(__dirname, "..", "client", "src");
const MAP_FILE = "components/WeatherMap/index.js";
const TILE_LAYER_TAGS = ["TileLayer", "WMSTileLayer", "RadarTileLayer"];
const MAPBOX_TILE_PROXY = "/api/tiles/";

// Each requirement: which layers it applies to (by their url prop) and the
// credits their attribution must show.
const REQUIREMENTS = [
  {
    source: "Mapbox basemap",
    matchesUrl: (url) => url.includes(MAPBOX_TILE_PROXY) || /mapbox\.com/i.test(url),
    credits: ["© Mapbox", "© OpenStreetMap"],
  },
  {
    source: "RainViewer radar",
    matchesUrl: (url) => /rainviewer/i.test(url),
    credits: ["RainViewer"],
  },
  {
    source: "ECCC GeoMet radar",
    matchesUrl: (url) => /geo\.weather\.gc\.ca/i.test(url),
    credits: ["Environment Canada"],
  },
];

/**
 * Recursively collect every file with one of the given extensions.
 *
 * @param {string} dir directory to walk
 * @param {string[]} exts extensions to keep (e.g. [".js"])
 * @returns {string[]} absolute paths of the files found
 */
const walk = (dir, exts) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(p, exts);
    return exts.some((e) => p.endsWith(e)) ? [p] : [];
  });

/**
 * Path relative to client/src, forward slashes on every OS.
 *
 * @param {string} file absolute path
 * @returns {string} e.g. "components/WeatherMap/index.js"
 */
const rel = (file) => path.relative(SRC_DIR, file).split(path.sep).join("/");

/**
 * Blank out comment lines (`//…`, `/*…`, ` * …`, `{/*…`), keeping offsets,
 * so prose that mentions a layer or a credit is never mistaken for code.
 * Same masking as test/kioskExternalLinks.test.js.
 *
 * @param {string} src file contents
 * @returns {string} same-length text with comment lines replaced by spaces
 */
const maskComments = (src) =>
  src.replace(/^[ \t]*(?:\/\/|\/\*|\*|\{\/\*).*$/gm, (line) => " ".repeat(line.length));

/**
 * The text a viewer actually sees for an attribution HTML string.
 *
 * @param {string} html attribution string as handed to Leaflet
 * @returns {string} tags stripped, the entities Leaflet would render decoded,
 *   whitespace collapsed
 */
const visibleText = (html) =>
  html
    .replace(/<[^>]*>/g, "")
    .replace(/&copy;|&#169;|&#xa9;/gi, "©")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Source text of every self-closing JSX element with the given name.
 *
 * @param {string} code comment-masked source
 * @param {string} name element name (e.g. "TileLayer")
 * @returns {{tag: string, index: number}[]} each element's text up to its `/>`
 */
const elements = (code, name) =>
  [...code.matchAll(new RegExp(`<${name}(?=[\\s/>])`, "g"))].map((m) => {
    const end = code.indexOf("/>", m.index);
    return { tag: code.slice(m.index, end === -1 ? undefined : end + 2), index: m.index };
  });

/**
 * Value of a string prop: a quoted literal (`p="…"`, `p='…'`, `p={"…"}`,
 * ``p={`…`}``) or a `{CONST}` resolved from a `const CONST = "…";` in the
 * same file.
 *
 * @param {string} tag element source text
 * @param {string} prop prop name
 * @param {string} code whole (masked) file, to resolve a constant
 * @returns {string|null} the string, or null when absent or not resolvable
 */
const propValue = (tag, prop, code) => {
  const lit = new RegExp(`\\b${prop}=\\{?\\s*(["'\`])([\\s\\S]*?)\\1`).exec(tag);
  if (lit) return lit[2];
  const ref = new RegExp(`\\b${prop}=\\{\\s*([A-Za-z_$][\\w$]*)\\s*\\}`).exec(tag);
  if (!ref) return null;
  const def = new RegExp(`\\bconst ${ref[1]}\\s*=\\s*(["'\`])([\\s\\S]*?)\\1\\s*;`).exec(code);
  return def ? def[2] : null;
};

/**
 * Every tile layer element in a file, with its url and attribution.
 *
 * @param {string} code comment-masked source
 * @returns {{name: string, line: number, url: string, attribution: string|null}[]}
 */
const tileLayers = (code) =>
  TILE_LAYER_TAGS.flatMap((name) =>
    elements(code, name).map(({ tag, index }) => {
      // url may be an expression (`rainViewerTileUrl(path)`): keep its raw
      // text so the source can still be recognised.
      const url = propValue(tag, "url", code) ?? (/\burl=\{([^}]*)\}/.exec(tag)?.[1] || "");
      return {
        name,
        line: code.slice(0, index).split("\n").length,
        url,
        attribution: propValue(tag, "attribution", code),
      };
    })
  );

/**
 * The credits a layer is missing for its source.
 *
 * @param {{url: string, attribution: string|null}} layer one tile layer
 * @returns {string[]} "source: credit" for each missing credit
 */
const missingCredits = (layer) => {
  const shown = layer.attribution === null ? "" : visibleText(layer.attribution);
  return REQUIREMENTS.filter((r) => r.matchesUrl(layer.url)).flatMap((r) =>
    r.credits.filter((c) => !shown.includes(c)).map((c) => `${r.source}: "${c}"`)
  );
};

const JS = walk(SRC_DIR, [".js"]).map((file) => ({
  file: rel(file),
  code: maskComments(fs.readFileSync(file, "utf8")),
}));
const MAP = JS.find((s) => s.file === MAP_FILE);
const LAYERS = JS.flatMap(({ file, code }) => tileLayers(code).map((l) => ({ file, ...l })));

test("detector: reads literal and constant attributions, strips tags, flags a missing credit", () => {
  const code = [
    "const A = '© <a href=\"https://www.mapbox.com/feedback/\">Mapbox</a>';",
    "<TileLayer attribution={A} url={`/api/tiles/${s}/{z}/{x}/{y}`} />",
    "<RadarTileLayer attribution='<a href=\"https://www.rainviewer.com/\">RainViewer</a>' url={rainViewerTileUrl(path)} />",
    '<WMSTileLayer attribution="Radar" url="https://geo.weather.gc.ca/geomet" />',
  ].join("\n");
  const [mapbox, wms, radar] = tileLayers(code);
  assert.equal(visibleText(mapbox.attribution), "© Mapbox");
  assert.deepEqual(missingCredits(mapbox), ['Mapbox basemap: "© OpenStreetMap"']);
  assert.deepEqual(missingCredits(radar), []);
  assert.deepEqual(missingCredits(wms), ['ECCC GeoMet radar: "Environment Canada"']);
  assert.equal(visibleText("&copy; Mapbox,&nbsp;&copy; OpenStreetMap"), "© Mapbox, © OpenStreetMap");
  assert.deepEqual(missingCredits({ url: "/api/tiles/x", attribution: null }).length, 2);
  // A commented-out layer is not a layer.
  assert.deepEqual(tileLayers(maskComments("  {/* <TileLayer url=\"/api/tiles/x\" /> */}")), []);
});

test("the radar map still mounts its attribution layers and control", () => {
  assert.ok(MAP, `${MAP_FILE} not found`);
  assert.match(MAP.code, /<AttributionControl(?=[\s/>])/, "WeatherMap no longer mounts <AttributionControl>: the map would ship with no credits at all");
  for (const r of REQUIREMENTS) {
    assert.ok(
      LAYERS.some((l) => r.matchesUrl(l.url)),
      `no ${r.source} tile layer found in client/src: if the layer moved or was renamed, update this guard (its url detection), don't drop the requirement`
    );
  }
});

test("every tile layer carries a non-empty attribution", () => {
  const bare = LAYERS.filter((l) => l.attribution === null || visibleText(l.attribution) === "").map(
    (l) => `${l.file}:${l.line} <${l.name}>`
  );
  assert.deepEqual(bare, [], "a tile layer without an attribution string shows its data uncredited");
});

test("each map source shows the credits its terms require (© Mapbox, © OpenStreetMap, RainViewer, Environment Canada)", () => {
  const missing = LAYERS.flatMap((l) => missingCredits(l).map((m) => `${l.file}:${l.line} <${l.name}> — ${m}`));
  assert.deepEqual(
    missing,
    [],
    "add the credit to the layer's attribution string as PLAIN TEXT (a new link fails test/kioskExternalLinks.test.js); see the header of this test for each source's terms"
  );
});

test("Mapbox tiles are only requested through a credited tile layer", () => {
  // A second map, or an imperative L.tileLayer, pointing at the proxy would
  // bypass the per-layer check above.
  const uses = JS.flatMap(({ file, code }) =>
    [...code.matchAll(/\/api\/tiles\/|api\.mapbox\.com\/styles/g)].map((m) => ({
      file,
      index: m.index,
      line: code.slice(0, m.index).split("\n").length,
    }))
  );
  const covered = JS.flatMap(({ file, code }) =>
    TILE_LAYER_TAGS.flatMap((name) =>
      elements(code, name)
        .filter(({ tag }) => tag.includes(MAPBOX_TILE_PROXY))
        .map(({ index, tag }) => ({ file, start: index, end: index + tag.length }))
    )
  );
  const stray = uses
    .filter((u) => !covered.some((c) => c.file === u.file && u.index > c.start && u.index < c.end))
    .map((u) => `${u.file}:${u.line}`);
  assert.deepEqual(stray, [], "Mapbox tiles requested outside a <TileLayer> element: credit © Mapbox + © OpenStreetMap there too, then teach this guard about it");
});

test("no stylesheet hides the attribution strip", () => {
  const hidden = walk(SRC_DIR, [".css"]).flatMap((file) => {
    const css = fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
    return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, selector, body]) =>
        /leaflet-control-attribution|leaflet-bottom/.test(selector) &&
        /\bdisplay\s*:\s*none|\bvisibility\s*:\s*hidden|\bopacity\s*:\s*0(?![.\d])/.test(body)
      )
      .map((m) => `${rel(file)}:${css.slice(0, m.index + m[0].indexOf(m[1].trim())).split("\n").length}`);
  });
  assert.deepEqual(
    hidden,
    [],
    "the attribution strip is a legal requirement and must stay visible in every state (Mapbox: 'attribution must be legible'); hide a decoration inside it (like .leaflet-attribution-flag), never the strip"
  );
});
