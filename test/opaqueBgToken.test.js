// Pins the one guarantee the maximized rail slabs rest on: `--c-bg` is fully
// opaque in every palette, hybrid mode included.
//
// AiSummaryInline and ChartTabs paint their maximized state with
// `var(--c-bg)` and no backdrop-filter. On LayoutDesktop they float over the
// moving radar map, so a translucent `--c-bg` would let the radar show
// through the AI text and the chart with no other signal. The `blur(6px)`
// those slabs used to carry as a "safety net" was no net: through a
// translucent fill it only frosted the radar, and through the opaque one it
// cost a backdrop pass per frame for no visible pixel.
//
// Text-level, like fontWeightGuards.test.js: tokens.js is ESM and the suite
// stays deps-free. The palette list is read from the `export const tokens`
// line, so a new palette is checked without touching this file.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC_DIR = path.join(__dirname, "..", "client", "src");
const TOKENS_SRC = fs.readFileSync(path.join(SRC_DIR, "ui", "tokens.js"), "utf8");

// #rgb / #rrggbb only: #rgba / #rrggbbaa, rgba(), hsla(), color-mix(),
// `transparent` and anything else that can carry alpha fail.
const OPAQUE_HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function walk(dir, ext, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, ext, out);
    else if (entry.name.endsWith(ext)) out.push(full);
  }
  return out;
}

test("every palette's bg token is an opaque hex colour", () => {
  const exported = TOKENS_SRC.match(/^export const tokens = \{([^}]*)\};/m);
  assert.ok(exported, "tokens.js no longer has `export const tokens = { … };`");
  const names = exported[1].split(",").map((s) => s.trim()).filter(Boolean);
  assert.ok(names.length >= 4, `expected at least 4 palettes, found ${names.join(", ")}`);

  for (const name of names) {
    assert.match(name, /^\w+$/, `palette entry "${name}" is not a shorthand name`);
    const block = TOKENS_SRC.match(new RegExp(`^const ${name} = \\{([\\s\\S]*?)^\\};`, "m"));
    assert.ok(block, `no top-level \`const ${name} = { … };\` in tokens.js`);
    const bg = block[1].match(/^\s*bg:\s*"([^"]*)",/m);
    assert.ok(bg, `palette ${name} has no \`bg: "…"\` string literal`);
    assert.match(bg[1], OPAQUE_HEX, `palette ${name}: bg "${bg[1]}" is not an opaque hex colour`);
  }
});

test("--c-bg is always the palette's bg, never remapped", () => {
  // JS: every inline-style map that sets `--c-bg` takes it straight from
  // `palette.bg` (AmbientLayers, and the portaled Settings / Debug panels).
  // Hybrid mode swaps `--c-surface` / `--c-border` only.
  const setters = [];
  for (const file of walk(SRC_DIR, ".js")) {
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(/["']--c-bg["']\s*:\s*([^,\n}]+)/g)) {
      setters.push({ file: path.relative(SRC_DIR, file), value: m[1].trim() });
    }
  }
  assert.ok(
    setters.some((s) => s.file === path.join("components", "AmbientLayers", "index.js")),
    "AmbientLayers no longer sets --c-bg — update this test",
  );
  for (const { file, value } of setters) {
    assert.equal(value, "palette.bg", `${file} sets --c-bg to ${value}`);
  }

  // CSS: no stylesheet redeclares the custom property.
  for (const file of walk(SRC_DIR, ".css")) {
    const src = fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(src, /--c-bg\s*:/, `${path.relative(SRC_DIR, file)} redeclares --c-bg`);
  }
});
