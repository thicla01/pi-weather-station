// Keeps the kiosk browser-name lists in deploy/ in lockstep. Three shell
// lists name the supported kiosk browsers by executable basename:
//
//  - install.sh `KNOWN_BROWSERS` — what the installer detects and OFFERS;
//  - install.sh `classify_browser_family` — the family written to
//    browser.conf as BROWSER_FAMILY;
//  - start-server's family case (used when BROWSER_FAMILY is empty) and its
//    per-browser Chromium profile-lock cleanup.
//
// Drift between them fails silently: Brave was classified in both scripts
// from the first browser-choice release (2026-04) but missing from
// KNOWN_BROWSERS, so the installer never offered it — while CLAUDE.md, the
// readme and architecture.md all said it did. The reverse drift is worse: a
// name offered but unclassified is persisted with an empty BROWSER_FAMILY and
// start-server exits "unknown browser family" (a dark kiosk). Nothing runs
// these scripts in CI, so this text-level parse is the only tripwire — same
// spirit as react19Guards.test.js.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const DEPLOY_DIR = path.join(__dirname, "..", "deploy");
const INSTALL_SH = fs.readFileSync(path.join(DEPLOY_DIR, "install.sh"), "utf8");
const START_SERVER = fs.readFileSync(path.join(DEPLOY_DIR, "start-server"), "utf8");

// A family `case` arm: `name1|name2)` alone on its line, the family on the
// next one (`echo "chromium" ;;` in install.sh, `BROWSER_FAMILY="chromium" ;;`
// in start-server).
const INSTALL_FAMILY_ARM = /^\s*([a-z0-9|._-]+)\)\s*\n\s*echo "(\w+)"/gm;
const START_FAMILY_ARM = /^\s*([a-z0-9|._-]+)\)\s*\n\s*BROWSER_FAMILY="(\w+)"/gm;
// A one-line lock-cleanup arm in start-server:
// `google-chrome|google-chrome-stable)   clean_orphan_chromium_lock "…" ;;`
const START_LOCK_ARM = /^\s*([a-z0-9|._-]+)\)\s+clean_orphan_chromium_lock\b/gm;

/**
 * Parse the `KNOWN_BROWSERS=( … )` array out of install.sh.
 *
 * @param {string} src install.sh source
 * @returns {string[]} the executable names, in the script's order
 */
const parseKnownBrowsers = (src) => {
  const m = src.match(/KNOWN_BROWSERS=\(([\s\S]*?)\)/);
  assert.ok(m, "KNOWN_BROWSERS array not found in deploy/install.sh");
  return m[1].split(/\s+/).filter(Boolean);
};

/**
 * Build a name → value map from the `case` arms a regex matches. Group 1 is
 * the `|`-separated name list; group 2 (optional) the value the arm yields.
 *
 * @param {string} src shell source to scan
 * @param {RegExp} re global, multiline arm pattern
 * @returns {Map<string, string>} executable basename → value (`""` when the
 *   pattern has no value group)
 */
const parseArms = (src, re) => {
  const map = new Map();
  for (const [, names, value = ""] of src.matchAll(re)) {
    for (const name of names.split("|")) map.set(name, value);
  }
  return map;
};

/**
 * Extract a shell function's text (from `name() {` to the first column-0
 * closing brace).
 *
 * @param {string} src shell source
 * @param {string} name function name
 * @returns {string} the function text
 */
const functionBody = (src, name) => {
  const m = src.match(new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}`, "m"));
  assert.ok(m, `${name}() not found`);
  return m[0];
};

const KNOWN = parseKnownBrowsers(INSTALL_SH);
const INSTALL_FAMILIES = parseArms(functionBody(INSTALL_SH, "classify_browser_family"), INSTALL_FAMILY_ARM);
const START_FAMILIES = parseArms(START_SERVER, START_FAMILY_ARM);
const START_LOCK_CLEANUP = parseArms(START_SERVER, START_LOCK_ARM);

test("the parsers find the lists (guards against a silent no-match)", () => {
  assert.ok(KNOWN.length >= 2, `KNOWN_BROWSERS = ${KNOWN.join(" ")}`);
  assert.ok(INSTALL_FAMILIES.size >= 2, "classify_browser_family arms not found");
  assert.ok(START_FAMILIES.size >= 2, "start-server family arms not found");
  assert.ok(START_LOCK_CLEANUP.size >= 1, "start-server lock-cleanup arms not found");
});

test("install.sh offers Brave (regression: classified but never offered)", () => {
  assert.ok(KNOWN.includes("brave-browser"), `KNOWN_BROWSERS = ${KNOWN.join(" ")}`);
});

test("every browser install.sh offers is classified by install.sh", () => {
  const unclassified = KNOWN.filter((b) => !INSTALL_FAMILIES.get(b));
  assert.deepEqual(unclassified, [], "would be written to browser.conf with an empty BROWSER_FAMILY");
});

test("start-server's family fallback agrees with install.sh for every offered browser", () => {
  const mismatched = KNOWN.filter((b) => START_FAMILIES.get(b) !== INSTALL_FAMILIES.get(b));
  assert.deepEqual(mismatched, []);
});

test("start-server clears the profile lock of every offered Chromium-family browser", () => {
  const missing = KNOWN.filter((b) => INSTALL_FAMILIES.get(b) === "chromium" && !START_LOCK_CLEANUP.has(b));
  assert.deepEqual(missing, [], "after a hostname change this browser's stale lock would keep the kiosk dark");
});
