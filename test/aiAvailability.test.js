// Parity guard for the client's AI-summary availability rules.
//
// Two client decisions switch the AI summary off (the Pi dock's IA button,
// the desktop / mobile slab, the radar rings' full-contrast style):
//
//   1. AppContext's `isAnthropicKeyConfigured`, applied to the boot
//      `GET /settings` read, decides up front — WITHOUT any
//      `/api/weather-summary` request. It is only correct while it agrees
//      with the server's no-key gate, for the raw value the local kiosk reads
//      AND for the masked boolean a remote client reads:
//        - stricter than the server → a working key gets its AI hidden, and
//          since nothing then calls the endpoint, nothing ever corrects it;
//        - looser than the server → the old symptom comes back (IA button
//          shown, tap → "Generating summary…" → "AI summary unavailable").
//   2. useAiSummary's `isAiSummaryKeyMissing`, applied to a failed summary
//      request (by useAiSummary and AiSummaryInline), is the fallback. It
//      must fire on the server's no-key answer and on nothing else: the
//      "no weather data" answer used to share its 503 and hid the feature
//      on a keyed install until a reload.
//
// The server side is exercised for real — getWeatherSummary is driven
// against a temp settings.json, configured so a usable key reaches the
// "no weather data" exit with no network call (no weather key, radar
// analysis off, cold caches). The client rules can't be required (ESM/JSX),
// so they are read from their source files and evaluated: editing either
// side without the other fails here. The last tests pin the wiring.
//
// Run: `npm test` or `node --test test/aiAvailability.test.js`.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { __test: { maskForRemote, setSettingsPathForTest } } = require("../server/settingsCtrl");
const { getWeatherSummary, __test: { SUMMARY_ERROR_REASON } } = require("../server/aiSummaryCtrl");
const { weatherCache } = require("../server/proxyCtrl");

const REPO_ROOT = path.join(__dirname, "..");
const APP_CONTEXT = path.join(REPO_ROOT, "client/src/AppContext.js");
const USE_AI_SUMMARY = path.join(REPO_ROOT, "client/src/components/hooks/useAiSummary.js");
const AI_SUMMARY_INLINE = path.join(REPO_ROOT, "client/src/components/ambient/AiSummaryInline/index.js");

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
  assert.ok(start >= 0, `${name} not found — was it renamed or moved?`);
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}

/**
 * Extract a module-scope `const NAME = …;` line.
 *
 * @param {string} src file source
 * @param {string} name constant name
 * @param {string} file file label for the failure message
 * @returns {string} the declaration line
 */
function extractConst(src, name, file) {
  const m = src.match(new RegExp(`^const ${name} = [^;]+;$`, "m"));
  assert.ok(m, `${name} not found in ${file}`);
  return m[0];
}

/**
 * Build the client's boot-read predicate from AppContext.js (plus the module
 * constant it reads).
 *
 * @returns {(value: *) => boolean} isAnthropicKeyConfigured
 */
function loadClientPredicate() {
  const src = fs.readFileSync(APP_CONTEXT, "utf8");
  const constDecl = extractConst(src, "ANTHROPIC_KEY_PLACEHOLDER", "AppContext.js");
  const fn = extractFunction(src, "isAnthropicKeyConfigured");
  return new Function(`${constDecl}\n${fn}\nreturn isAnthropicKeyConfigured;`)();
}

/**
 * Build the client's failed-request rule from useAiSummary.js (plus the
 * module constants it reads).
 *
 * @returns {(err: *) => boolean} isAiSummaryKeyMissing
 */
function loadKeyMissingRule() {
  const src = fs.readFileSync(USE_AI_SUMMARY, "utf8");
  const consts = ["NO_KEY_STATUS", "NO_KEY_REASON"].map((n) => extractConst(src, n, "useAiSummary.js"));
  const fn = extractFunction(src, "isAiSummaryKeyMissing");
  return new Function(`${consts.join("\n")}\n${fn}\nreturn isAiSummaryKeyMissing;`)();
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

/**
 * Drive GET /api/weather-summary against a temp settings.json. Radar analysis
 * is off, there is no weather key and the shared weather cache is emptied, so
 * a request that gets past the key gate finds nothing to summarise and
 * returns without any network call.
 *
 * @param {Object} settings settings.json content (merged over the no-network
 *   defaults)
 * @returns {Promise<{status: number, body: *}>} what the handler sent
 */
async function runSummary(settings) {
  // proxyCtrl loads server/weather-cache.json when it is required, and a dev
  // machine's own server keeps that file current. A fresh entry for these
  // coordinates would carry the request past the no-data exit and into a
  // real Anthropic call with the tests' fake key, so start from a cold cache
  // (restored afterwards: proxyCtrl's save timer writes this object back to
  // that same file).
  const warmCache = { ...weatherCache };
  for (const key of Object.keys(weatherCache)) delete weatherCache[key];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-availability-"));
  const file = path.join(dir, "settings.json");
  fs.writeFileSync(file, JSON.stringify({ advanced: { ai: { radarAnalysisEnabled: false } }, ...settings }));
  const previous = setSettingsPathForTest(file);
  try {
    const res = new EventEmitter();
    const sent = { status: null, body: undefined };
    res.status = (s) => { sent.status = s; return res; };
    res.json = (b) => { sent.body = b; return res; };
    res.end = () => res;
    const req = {
      query: { lat: "45.5017", lon: "-73.5673", lang: "en" },
      isLocal: true,
      socket: { remoteAddress: "127.0.0.1" },
    };
    await getWeatherSummary(req, res);
    return sent;
  } finally {
    setSettingsPathForTest(previous);
    fs.rmSync(dir, { recursive: true, force: true });
    Object.assign(weatherCache, warmCache);
  }
}

/**
 * Wrap a handler response the way axios rejects with it.
 *
 * @param {{status: number, body: *}} sent what the handler sent
 * @returns {{response: {status: number, data: *}}} axios-shaped error
 */
const asAxiosError = ({ status, body }) => ({ response: { status, data: body } });

const isAnthropicKeyConfigured = loadClientPredicate();
const isAiSummaryKeyMissing = loadKeyMissingRule();

// Every shape `anthropicApiKey` can take in a hand-edited settings.json or a
// Settings-panel save (undefined = key absent from the file).
const RAW_VALUES = [undefined, null, "", "key", "sk-ant-api03-abc", " ", "Key", "key ", true, false, 0];

/**
 * settings.json content holding this `anthropicApiKey` value.
 *
 * @param {*} v the value (undefined = absent)
 * @returns {Object} settings fragment
 */
const withKey = (v) => (v === undefined ? {} : { anthropicApiKey: v });

// ── The server's error contract ───────────────────────────────────────────

test("no usable Anthropic key → 503 with reason no-key", async () => {
  for (const v of [undefined, "", "key"]) {
    const sent = await runSummary(withKey(v));
    assert.equal(sent.status, 503, `anthropicApiKey=${JSON.stringify(v)}`);
    assert.equal(sent.body.reason, SUMMARY_ERROR_REASON.NO_KEY);
    assert.equal(typeof sent.body.error, "string");
  }
});

test("no weather data on a keyed install → 502 with reason no-weather-data, never 503", async () => {
  const sent = await runSummary({ anthropicApiKey: "sk-ant-api03-abc" });
  assert.equal(sent.status, 502);
  assert.equal(sent.body.reason, SUMMARY_ERROR_REASON.NO_WEATHER_DATA);
  assert.notEqual(SUMMARY_ERROR_REASON.NO_WEATHER_DATA, SUMMARY_ERROR_REASON.NO_KEY);
});

// ── 1. Boot settings read ─────────────────────────────────────────────────

test("boot-read predicate agrees with the server's no-key gate (local kiosk, raw value)", async () => {
  for (const v of RAW_VALUES) {
    const sent = await runSummary(withKey(v));
    assert.equal(
      isAnthropicKeyConfigured(v),
      sent.status !== 503,
      `disagreement for anthropicApiKey=${JSON.stringify(v)} (server answered ${sent.status})`,
    );
  }
});

test("a remote client's masked read gives the same answer as the raw value", () => {
  // maskForRemote reports the "key" placeholder as `false`, so a remote client
  // learns there is no key at boot too, instead of from its first summary
  // request's 503.
  for (const v of RAW_VALUES) {
    const masked = maskForRemote(withKey(v)).anthropicApiKey;
    // An absent key stays absent; a present one never leaves as its value.
    assert.equal(typeof masked, v === undefined ? "undefined" : "boolean");
    assert.equal(
      isAnthropicKeyConfigured(masked),
      isAnthropicKeyConfigured(v),
      `masked read disagrees with the raw one for anthropicApiKey=${JSON.stringify(v)}`,
    );
  }
});

test("the documented no-key shapes are all reported unavailable, remote placeholder included", () => {
  // missing, empty, settings.example.json placeholder
  assert.equal(isAnthropicKeyConfigured(undefined), false);
  assert.equal(isAnthropicKeyConfigured(""), false);
  assert.equal(isAnthropicKeyConfigured("key"), false);
  assert.equal(isAnthropicKeyConfigured(maskForRemote({ anthropicApiKey: "key" }).anthropicApiKey), false);
  assert.equal(isAnthropicKeyConfigured("sk-ant-api03-abc"), true);
  assert.equal(isAnthropicKeyConfigured(maskForRemote({ anthropicApiKey: "sk-ant-api03-abc" }).anthropicApiKey), true);
});

// ── 2. Failed summary request ─────────────────────────────────────────────

test("the server's no-key answer switches availability off", async () => {
  const sent = await runSummary({ anthropicApiKey: "key" });
  assert.equal(isAiSummaryKeyMissing(asAxiosError(sent)), true);
});

test("the server's no-weather-data answer does not switch availability off", async () => {
  const sent = await runSummary({ anthropicApiKey: "sk-ant-api03-abc" });
  assert.equal(isAiSummaryKeyMissing(asAxiosError(sent)), false);
});

test("a 503 from a server that predates `reason` keeps its old no-key meaning", () => {
  assert.equal(isAiSummaryKeyMissing({ response: { status: 503, data: "Anthropic API key not configured" } }), true);
  assert.equal(isAiSummaryKeyMissing({ response: { status: 503, data: null } }), true);
  assert.equal(isAiSummaryKeyMissing({ response: { status: 503 } }), true);
});

test("every other failure is transient: unknown 503 reason, 5xx, 429, network error", () => {
  const transient = [
    { response: { status: 503, data: { reason: SUMMARY_ERROR_REASON.NO_WEATHER_DATA } } },
    { response: { status: 503, data: { reason: "some-future-reason" } } },
    { response: { status: 502, data: "AI summary failed" } },
    { response: { status: 500, data: "AI summary failed" } },
    { response: { status: 429, data: "AI summary temporarily rate-limited" } },
    { response: { status: 400, data: "Invalid coordinates" } },
    new Error("Network Error"),
    { code: "ECONNABORTED" },
    null,
    undefined,
  ];
  for (const err of transient) {
    assert.equal(isAiSummaryKeyMissing(err), false, `treated as no-key: ${JSON.stringify(err)}`);
  }
});

// ── Wiring ────────────────────────────────────────────────────────────────

// The predicates alone don't fix anything: pin where they are applied so a
// refactor can't silently bring back "IA button on a keyless Pi" or "AI hidden
// by a weather-data gap".
test("both summary fetchers switch availability off only through isAiSummaryKeyMissing", () => {
  for (const [file, label] of [[USE_AI_SUMMARY, "useAiSummary.js"], [AI_SUMMARY_INLINE, "AiSummaryInline"]]) {
    const src = fs.readFileSync(file, "utf8");
    assert.match(
      src,
      /if \(isAiSummaryKeyMissing\(err\)\)\s*(?:\{\s*(?:\/\/[^\n]*\n\s*)*)?setAvailable\(false\)/,
      `${label} must gate setAvailable(false) on isAiSummaryKeyMissing(err)`,
    );
    assert.doesNotMatch(src, /status\s*===\s*503/, `${label} must not test for a bare 503`);
    const calls = src.match(/setAvailable\([^)]*\)/g) || [];
    assert.deepEqual(calls, ["setAvailable(false)"], `${label} must only ever downgrade availability, once`);
  }
});

test("the boot settings read switches AI availability off for an unconfigured key, never on", () => {
  const body = extractCallbackBody(fs.readFileSync(APP_CONTEXT, "utf8"), "getCustomLatLon");
  assert.match(
    body,
    /if \(!isAnthropicKeyConfigured\(res\.anthropicApiKey\)\) \{\s*setAiSummaryAvailable\(false\);/,
    "getCustomLatLon must clear aiSummaryAvailable when the read shows no usable Anthropic key",
  );
  // Downgrade only: re-enabling from a read would override the no-key 503
  // (the authoritative signal, e.g. after settings.json was edited).
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
