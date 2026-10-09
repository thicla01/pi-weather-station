// Keeps the kiosk browser-name lists in deploy/ in lockstep. These shell
// lists name the supported kiosk browsers by executable basename:
//
//  - install.sh `KNOWN_BROWSERS` — what the installer detects and OFFERS;
//  - install.sh `classify_browser_family` — the family written to
//    browser.conf as BROWSER_FAMILY;
//  - start-server's family case (used when BROWSER_FAMILY is empty) and its
//    per-browser Chromium profile-lock cleanup;
//  - relaunch-kiosk.sh `kiosk_profile_dir` — the same per-browser profile
//    map, used to clear the killed kiosk's lock before relaunching it (it
//    hard-coded ~/.config/chromium until 2026-10, whatever the browser).
//
// Snap-packaged Brave (`brave`) is deliberately absent from all of them:
// supporting it needs a start-server lock-cleanup arm for its in-snap profile
// (see the note in install.sh's browser detection). Offering it without one
// fails the lock-cleanup test below — no exception is carved out for it.
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
const RELAUNCH_KIOSK = fs.readFileSync(path.join(DEPLOY_DIR, "relaunch-kiosk.sh"), "utf8");

// A family `case` arm: `name1|name2)` alone on its line, the family on the
// next one (`echo "chromium" ;;` in install.sh, `BROWSER_FAMILY="chromium" ;;`
// in start-server).
const INSTALL_FAMILY_ARM = /^\s*([a-z0-9|._-]+)\)\s*\n\s*echo "(\w+)"/gm;
const START_FAMILY_ARM = /^\s*([a-z0-9|._-]+)\)\s*\n\s*BROWSER_FAMILY="(\w+)"/gm;
// A one-line lock-cleanup arm in start-server:
// `google-chrome|google-chrome-stable)   clean_orphan_chromium_lock "…" ;;`
const START_LOCK_ARM = /^\s*([a-z0-9|._-]+)\)\s+clean_orphan_chromium_lock\b/gm;
// The same arm with its profile directory captured (the literal shell text,
// e.g. `$HOME/.config/google-chrome`).
const START_LOCK_DIR_ARM = /^\s*([a-z0-9|._-]+)\)\s+clean_orphan_chromium_lock\s+"([^"]+)"/gm;
// A relaunch-kiosk.sh `kiosk_profile_dir` arm:
// `google-chrome|google-chrome-stable)   echo "$HOME/.config/google-chrome" ;;`
const RELAUNCH_DIR_ARM = /^\s*([a-z0-9|._-]+)\)\s+echo\s+"([^"]+)"/gm;

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
const START_LOCK_DIRS = parseArms(START_SERVER, START_LOCK_DIR_ARM);
const RELAUNCH_DIRS = parseArms(functionBody(RELAUNCH_KIOSK, "kiosk_profile_dir"), RELAUNCH_DIR_ARM);

/**
 * Parse the space-separated `KIOSK_SWEEP_NAMES="…"` list out of
 * relaunch-kiosk.sh.
 *
 * @param {string} src relaunch-kiosk.sh source
 * @returns {string[]} the executable names swept when the configured browser
 *   can't be mapped to one profile
 */
const parseSweepNames = (src) => {
  const m = src.match(/^KIOSK_SWEEP_NAMES="([^"]*)"/m);
  assert.ok(m, "KIOSK_SWEEP_NAMES not found in deploy/relaunch-kiosk.sh");
  return m[1].split(/\s+/).filter(Boolean);
};

test("the parsers find the lists (guards against a silent no-match)", () => {
  assert.ok(KNOWN.length >= 2, `KNOWN_BROWSERS = ${KNOWN.join(" ")}`);
  assert.ok(INSTALL_FAMILIES.size >= 2, "classify_browser_family arms not found");
  assert.ok(START_FAMILIES.size >= 2, "start-server family arms not found");
  assert.ok(START_LOCK_CLEANUP.size >= 1, "start-server lock-cleanup arms not found");
  assert.equal(START_LOCK_DIRS.size, START_LOCK_CLEANUP.size, "a start-server lock arm's directory didn't parse");
  assert.ok(RELAUNCH_DIRS.size >= 1, "relaunch-kiosk.sh kiosk_profile_dir arms not found");
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

test("relaunch-kiosk.sh clears the same profile as start-server for every offered Chromium-family browser", () => {
  const chromiumFamily = KNOWN.filter((b) => INSTALL_FAMILIES.get(b) === "chromium");
  const relaunch = Object.fromEntries(chromiumFamily.map((b) => [b, RELAUNCH_DIRS.get(b)]));
  const start = Object.fromEntries(chromiumFamily.map((b) => [b, START_LOCK_DIRS.get(b)]));
  assert.deepEqual(relaunch, start, "the display-scale relaunch would leave this browser's stale lock in place");
});

test("relaunch-kiosk.sh's fallback sweep reaches every profile it knows", () => {
  const swept = new Set(parseSweepNames(RELAUNCH_KIOSK).map((b) => RELAUNCH_DIRS.get(b)));
  const unreached = [...new Set(RELAUNCH_DIRS.values())].filter((dir) => !swept.has(dir));
  assert.deepEqual(unreached, [], "with no usable browser.conf this profile's lock would never be cleared");
});
