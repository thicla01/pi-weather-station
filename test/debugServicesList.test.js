// Regression tests for the Debug panel's "Recent service calls" list
// (Services bucket, client/src/components/ambient/DebugPanel/index.js).
//
// The list used to render `Object.entries(services).slice(0, 10)`, while
// the server pre-registers ~19 upstream services at startup
// (`registerKnownServices` in server/index.js) precisely so every one of
// them shows in the panel — so Homebridge, the air-quality sources, both
// alert feeds and Open-Meteo pollen never appeared. Two concerns are
// locked down:
//   1. `orderServicesForDisplay` keeps EVERY entry of the real server
//      registry, floats failures to the top (5xx, then 4xx) and keeps the
//      server's order within a rank.
//   2. `BucketServices` renders that helper's output and no longer
//      slices the list.
//
// No verbatim copy (cf. verbatimSync.test.js): the helpers are extracted
// from the client source at test time and evaluated, so the code under
// test IS the shipped code and there is nothing to drift. The DebugPanel
// module itself can't be `require()`d (ESM + JSX + CSS imports).
//
// Run: `npm test` or `node --test test/debugServicesList.test.js`.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.join(__dirname, "..");
const DEBUG_PANEL_SRC = fs.readFileSync(
  path.join(REPO_ROOT, "client", "src", "components", "ambient", "DebugPanel", "index.js"),
  "utf8",
);
const SERVER_INDEX_SRC = fs.readFileSync(path.join(REPO_ROOT, "server", "index.js"), "utf8");

// The cap the list used to apply — the registry must exceed it for the
// "every service shows" assertion to mean anything.
const OLD_LIST_CAP = 10;

const OPENERS = { "(": ")", "[": "]", "{": "}" };
const CLOSERS = new Set(Object.values(OPENERS));

/**
 * Extract one top-level `const NAME = …;` statement from a source file:
 * from the column-0 `const NAME =` to the first `;` at bracket depth 0.
 * Not string-aware — fine for the helpers extracted here, whose bodies
 * carry no bracket or `;` inside a literal; an unbalanced extraction
 * makes `new Function` throw (a loud failure, never a silent pass).
 *
 * @param {string} src - source text
 * @param {string} name - declared identifier
 * @returns {string} the full declaration statement
 */
function extractConst(src, name) {
  const match = new RegExp(`^const ${name} =`, "m").exec(src);
  assert.ok(match, `declaration "const ${name} =" not found in the source`);
  let depth = 0;
  for (let i = match.index; i < src.length; i += 1) {
    const ch = src[i];
    if (OPENERS[ch]) depth += 1;
    else if (CLOSERS.has(ch)) depth -= 1;
    else if (ch === ";" && depth === 0) return src.slice(match.index, i + 1);
  }
  throw new Error(`unterminated declaration "const ${name}"`);
}

const HELPER_NAMES = [
  "httpStatusKind",
  "SERVICE_KIND_RANK",
  "SERVICE_KIND_RANK_OTHER",
  "orderServicesForDisplay",
];
// Evaluates the repo's own client helpers, extracted above, so the test
// exercises the shipped code rather than a drift-prone copy.
const { orderServicesForDisplay } = new Function(
  `${HELPER_NAMES.map((n) => extractConst(DEBUG_PANEL_SRC, n)).join("\n")}\n`
  + "return { orderServicesForDisplay };",
)();

/**
 * The service names `registerKnownServices()` pre-registers, read from
 * server/index.js so the test follows the real inventory.
 *
 * @returns {string[]} names in registration order
 */
function registeredServiceNames() {
  const block = /function registerKnownServices\(\)\s*\{\s*\[([\s\S]*?)\]\.forEach\(registerService\)/
    .exec(SERVER_INDEX_SRC);
  assert.ok(block, "registerKnownServices() array not found in server/index.js");
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/**
 * Build a `/api/debug` `services` map the way serviceStatus.js does:
 * every name pre-registered (`status: null`), then some overridden by a
 * recorded call.
 *
 * @param {string[]} names - registry, in order
 * @param {Record<string, number>} calls - name → last HTTP status
 * @returns {object} the services map
 */
function servicesMap(names, calls = {}) {
  const map = {};
  names.forEach((n) => {
    map[n] = { status: null, lastCall: null, comment: "Not yet called" };
  });
  Object.entries(calls).forEach(([n, status]) => {
    map[n] = { status, lastCall: "2026-10-08T12:00:00.000Z", comment: status < 400 ? "OK" : "boom" };
  });
  return map;
}

test("registry is larger than the old 10-row cap (guards the next assertions)", () => {
  assert.ok(registeredServiceNames().length > OLD_LIST_CAP);
});

test("every pre-registered service is listed, in registration order when nothing fails", () => {
  const names = registeredServiceNames();
  const rows = orderServicesForDisplay(servicesMap(names));
  assert.deepEqual(rows.map(([n]) => n), names);
});

test("failures come first — 5xx, then 4xx — and the rest keep the server's order", () => {
  const names = registeredServiceNames();
  const last = names[names.length - 1];
  const secondLast = names[names.length - 2];
  const third = names[2];
  const rows = orderServicesForDisplay(servicesMap(names, {
    [names[0]]: 200,
    [secondLast]: 429,
    [last]: 503,
    [third]: 500,
  }));
  const order = rows.map(([n]) => n);
  assert.equal(order.length, names.length, "no row dropped");
  // 5xx in registration order, then the 4xx, then everything else.
  assert.deepEqual(order.slice(0, 3), [third, last, secondLast]);
  assert.deepEqual(
    order.slice(3),
    names.filter((n) => ![third, last, secondLast].includes(n)),
  );
});

test("a service recorded but never pre-registered is still listed", () => {
  const names = registeredServiceNames();
  const map = servicesMap(names);
  map["Some new upstream"] = { status: 200, comment: "OK" };
  const order = orderServicesForDisplay(map).map(([n]) => n);
  assert.equal(order.length, names.length + 1);
  assert.equal(order[order.length - 1], "Some new upstream");
});

test("missing or empty services map yields no rows", () => {
  assert.deepEqual(orderServicesForDisplay(undefined), []);
  assert.deepEqual(orderServicesForDisplay(null), []);
  assert.deepEqual(orderServicesForDisplay({}), []);
});

test("malformed entries do not throw and sort with the non-failing rank", () => {
  const order = orderServicesForDisplay({ a: null, b: { status: 502 }, c: {} }).map(([n]) => n);
  assert.deepEqual(order, ["b", "a", "c"]);
});

test("BucketServices renders the ordered list and no longer slices it", () => {
  const body = extractConst(DEBUG_PANEL_SRC, "BucketServices");
  assert.match(body, /orderServicesForDisplay\(data\.services\)/);
  assert.doesNotMatch(body, /\.slice\(/, "the service-call list must show every service");
});
