// Parity guard for the client's up-front AI-summary availability check.
//
// AppContext's `isAnthropicKeyConfigured` decides, from the boot
// `GET /settings` read, whether the AI summary exists at all on this
// install — it hides the Pi dock's IA button, the desktop / mobile slab and
// switches the radar rings to their subdued "AI off" style WITHOUT a
// `/api/weather-summary` request. It is only correct while it is the exact
// negation of aiSummaryCtrl's 503 gate:
//   - stricter than the server → a working key gets its AI hidden, and since
//     nothing then calls the endpoint, no 503/200 ever corrects it;
//   - looser than the server → the old symptom comes back (IA button shown,
//     tap → "Generating summary…" → "AI summary unavailable").
//
// Rather than a hand-kept copy (Node's CJS runner can't import the ESM/JSX
// AppContext), both sides are read from their real source files and
// evaluated, so editing EITHER rule without the other fails here. The last
// two tests pin the wiring: the boot settings read applies the predicate
// (downgrade only) and a Settings save re-derives availability from it.
//
// Run: `npm test` or `node --test test/aiAvailability.test.js`.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { __test: { maskForRemote } } = require("../server/settingsCtrl");

const REPO_ROOT = path.join(__dirname, "..");
const APP_CONTEXT = path.join(REPO_ROOT, "client/src/AppContext.js");
const AI_SUMMARY_CTRL = path.join(REPO_ROOT, "server/aiSummaryCtrl.js");

/**
 * Extract a top-level `function name(...) { ... }` declaration by brace
 * matching (the body contains no brace inside a string literal).
 *
 * @param {string} src file source
 * @param {string} name function name
 * @returns {string} the declaration text
 */
function extractFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} not found — was it renamed or moved out of AppContext.js?`);
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}

/**
 * Build the client predicate from AppContext.js (plus the module constant it
 * reads).
 *
 * @returns {(value: *) => boolean} isAnthropicKeyConfigured
 */
function loadClientPredicate() {
  const src = fs.readFileSync(APP_CONTEXT, "utf8");
  const constMatch = src.match(/^const ANTHROPIC_KEY_PLACEHOLDER = [^;]+;$/m);
  assert.ok(constMatch, "ANTHROPIC_KEY_PLACEHOLDER not found in AppContext.js");
  const fn = extractFunction(src, "isAnthropicKeyConfigured");
  return new Function(`${constMatch[0]}\n${fn}\nreturn isAnthropicKeyConfigured;`)();
}

/**
 * Build the server's "would call Claude" predicate from the 503 gate in
 * aiSummaryCtrl.js.
 *
 * @returns {(value: *) => boolean} true when the server would NOT 503 for
 *   that `anthropicApiKey`
 */
function loadServerPredicate() {
  const src = fs.readFileSync(AI_SUMMARY_CTRL, "utf8");
  const m = src.match(/if \((.+?)\) \{\s*return res\.status\(503\)\.json\("Anthropic API key not configured"\)/);
  assert.ok(m, "the anthropicApiKey 503 gate was not found in aiSummaryCtrl.js — update this test with it");
  const gate = new Function("settings", `return (${m[1]});`);
  return (value) => !gate(value === undefined ? {} : { anthropicApiKey: value });
}

/**
 * Extract the arrow body of a `const name = useCallback((...) => { ... }` in
 * AppContext.js by brace matching from its `=> {` (neither body below holds a
 * brace inside a string literal or comment).
 *
 * @param {string} src file source
 * @param {string} name callback name
 * @returns {string} the arrow body, braces included
 */
function extractCallbackBody(src, name) {
  const start = src.indexOf(`const ${name} = useCallback(`);
  assert.ok(start >= 0, `${name} not found — was it renamed or moved out of AppContext.js?`);
  const open = src.indexOf("=> {", start) + 3;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}

const isAnthropicKeyConfigured = loadClientPredicate();
const serverWouldCall = loadServerPredicate();

// Every shape `anthropicApiKey` can take in a hand-edited settings.json or a
// Settings-panel save (undefined = key absent from the file).
const RAW_VALUES = [undefined, null, "", "key", "sk-ant-api03-abc", " ", "Key", "key ", true, false, 0];

test("client predicate is the exact negation of the server's 503 gate (local kiosk, raw value)", () => {
  for (const v of RAW_VALUES) {
    assert.equal(
      isAnthropicKeyConfigured(v),
      serverWouldCall(v),
      `disagreement for anthropicApiKey=${JSON.stringify(v)}`,
    );
  }
});

test("the documented no-key shapes are all reported unavailable", () => {
  // missing, empty, settings.example.json placeholder
  assert.equal(isAnthropicKeyConfigured(undefined), false);
  assert.equal(isAnthropicKeyConfigured(""), false);
  assert.equal(isAnthropicKeyConfigured("key"), false);
  assert.equal(isAnthropicKeyConfigured("sk-ant-api03-abc"), true);
});

test("remote masked read never hides a key the server would use", () => {
  for (const v of RAW_VALUES) {
    const settings = v === undefined ? {} : { anthropicApiKey: v };
    const masked = maskForRemote(settings).anthropicApiKey;
    if (serverWouldCall(v)) {
      assert.equal(isAnthropicKeyConfigured(masked), true, `masked ${JSON.stringify(v)} hid a usable key`);
    }
  }
});

test("remote masked placeholder reads as configured — the 503 fallback covers it", () => {
  // maskForRemote turns "key" into `true`, so a remote client can't tell the
  // placeholder from a real key up front; its first summary request gets the
  // 503 and the hooks switch the feature off. If the mask ever learns to
  // report the placeholder as unconfigured, update this test and the
  // "Settings that affect the AI summary" passage of docs/ai-summary.md.
  assert.equal(serverWouldCall("key"), false);
  assert.equal(isAnthropicKeyConfigured(maskForRemote({ anthropicApiKey: "key" }).anthropicApiKey), true);
  // Missing / empty are visible through the mask.
  assert.equal(isAnthropicKeyConfigured(maskForRemote({}).anthropicApiKey), false);
  assert.equal(isAnthropicKeyConfigured(maskForRemote({ anthropicApiKey: "" }).anthropicApiKey), false);
});

// The predicate alone doesn't fix anything: the Pi only learns availability up
// front because the boot settings read applies it. Pin that wiring (and its
// one-way / two-way split) so a refactor of either callback can't silently
// bring back the "IA button on a keyless Pi" symptom.
test("the boot settings read switches AI availability off for an unconfigured key, never on", () => {
  const body = extractCallbackBody(fs.readFileSync(APP_CONTEXT, "utf8"), "getCustomLatLon");
  assert.match(
    body,
    /if \(!isAnthropicKeyConfigured\(res\.anthropicApiKey\)\) \{\s*setAiSummaryAvailable\(false\);/,
    "getCustomLatLon must clear aiSummaryAvailable when the read shows no usable Anthropic key",
  );
  // Downgrade only: re-enabling from a read would override a 503 (the
  // authoritative signal, e.g. a remote client's masked placeholder).
  const calls = body.match(/setAiSummaryAvailable\([^)]*\)/g) || [];
  assert.deepEqual(calls, ["setAiSummaryAvailable(false)"], "the boot read must never set availability to anything but false");
});

test("a Settings save re-derives AI availability from the key it just wrote", () => {
  const body = extractCallbackBody(fs.readFileSync(APP_CONTEXT, "utf8"), "saveSettingsToJson");
  assert.match(
    body,
    /if \(anthropicKey !== undefined\) \{\s*setAiSummaryAvailable\(isAnthropicKeyConfigured\(anthropicKey\)\);/,
    "saveSettingsToJson must re-derive aiSummaryAvailable from the saved key (skipped when the key is omitted)",
  );
});
