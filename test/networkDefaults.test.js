// Tests for the outbound-connection defaults in server/networkDefaults.js.
//
// The bug they pin: Node gives each connection attempt but the last 250 ms
// (`autoSelectFamilyAttemptTimeout`), and raises that timeout from a timer,
// which runs before socket events. A server whose event loop is busy for
// more than 250 ms right after a connection starts therefore drops an IPv4
// attempt the kernel had already completed; on a host with no IPv6 route the
// next attempt fails at once and the request dies with
// `connect ETIMEDOUT <ipv4>; connect ENETUNREACH <ipv6>` (the line found in
// the stations' server.log, and many times a day on a Pi 3B).
//
// No network: an HTTP server listens on 127.0.0.1 only, a made-up name
// resolves to 127.0.0.1 then ::1 (nothing listens there), and the patched
// lookup keeps the process busy for STALL_MS right after it hands over the
// addresses, as a radar analysis or a starved CPU does. Run: `npm test`.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const dns = require("node:dns");
const net = require("node:net");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const axios = require("axios");

const { CONNECT_ATTEMPT_TIMEOUT_MS, applyNetworkDefaults } = require("../server/networkDefaults");

const NODE_ATTEMPT_TIMEOUT_MS = 250; // Node's own default
const STALL_MS = 400;                // longer than Node's default, far below ours
const REQUEST_TIMEOUT_MS = 4000;
const FAKE_HOST = "dual-stack.test";

const realLookup = dns.lookup;
let server;
let port;

const busyWait = (ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end); // on purpose: the event loop must not turn
};

/**
 * `dns.lookup` stand-in: FAKE_HOST resolves to IPv4 loopback then IPv6
 * loopback, then the process stalls; any other name goes to the real lookup.
 */
function stallingLookup(hostname, options, callback) {
  if (hostname !== FAKE_HOST) return realLookup.call(dns, hostname, options, callback);
  const cb = typeof options === "function" ? options : callback;
  const all = typeof options === "object" && options !== null && options.all;
  setImmediate(() => {
    // The callback starts the first connection attempt and arms its timer…
    if (all) cb(null, [{ address: "127.0.0.1", family: 4 }, { address: "::1", family: 6 }]);
    else cb(null, "127.0.0.1", 4);
    // …and the loop can look at neither until this returns.
    busyWait(STALL_MS);
  });
  return undefined;
}

/** Every message, code and nested cause/errors entry of an error, in one string. */
function everythingAbout(err, depth = 0) {
  if (!err || depth > 4) return "";
  const parts = [err.code, err.message];
  if (err.cause) parts.push(everythingAbout(err.cause, depth + 1));
  if (Array.isArray(err.errors)) parts.push(...err.errors.map((e) => everythingAbout(e, depth + 1)));
  return parts.filter(Boolean).join(" | ");
}

const viaAxios = () => axios
  .get(`http://${FAKE_HOST}:${port}/`, {
    timeout: REQUEST_TIMEOUT_MS,
    proxy: false,
    httpAgent: new http.Agent({ keepAlive: false }), // a fresh connection each time
  })
  .then((res) => res.status);

const viaFetch = () => fetch(`http://${FAKE_HOST}:${port}/`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  .then((res) => res.text().then(() => res.status));

before(async () => {
  server = http.createServer((req, res) => res.end("ok"));
  await new Promise((resolve) => { server.listen(0, "127.0.0.1", resolve); });
  ({ port } = server.address());
  dns.lookup = stallingLookup;
});

after(() => {
  dns.lookup = realLookup;
  server.closeAllConnections();
  server.close();
});

test("the attempt timeout outlasts a busy loop and two SYN retransmissions, inside a 10 s request", () => {
  assert.equal(CONNECT_ATTEMPT_TIMEOUT_MS, 5000);
  assert.ok(CONNECT_ATTEMPT_TIMEOUT_MS > 3000, "Linux retransmits a lost SYN after 1 s, then 3 s");
  assert.ok(CONNECT_ATTEMPT_TIMEOUT_MS < 10_000, "leave room for the next address before the request timeout");
  assert.ok(STALL_MS > NODE_ATTEMPT_TIMEOUT_MS && STALL_MS < CONNECT_ATTEMPT_TIMEOUT_MS);
});

test("control: with Node's 250 ms, a 400 ms stall kills the request (axios and fetch)", async () => {
  net.setDefaultAutoSelectFamilyAttemptTimeout(NODE_ATTEMPT_TIMEOUT_MS);
  const droppedIpv4Attempt = (err) => {
    assert.match(
      everythingAbout(err),
      /ETIMEDOUT 127\.0\.0\.1/,
      "the IPv4 attempt should be reported as timed out although the server was listening",
    );
    return true;
  };
  // If these stop rejecting, Node no longer drops a stalled attempt at 250 ms
  // and the attempt timeout in server/networkDefaults.js may be obsolete.
  await assert.rejects(viaAxios(), droppedIpv4Attempt);
  await assert.rejects(viaFetch(), droppedIpv4Attempt);
});

test("applyNetworkDefaults: IPv4 first, and our attempt timeout", () => {
  applyNetworkDefaults();
  assert.equal(dns.getDefaultResultOrder(), "ipv4first");
  assert.equal(net.getDefaultAutoSelectFamilyAttemptTimeout(), CONNECT_ATTEMPT_TIMEOUT_MS);
  applyNetworkDefaults(); // idempotent
  assert.equal(net.getDefaultAutoSelectFamilyAttemptTimeout(), CONNECT_ATTEMPT_TIMEOUT_MS);
});

test("with the server's defaults the same stall costs nothing: axios", async () => {
  applyNetworkDefaults();
  assert.equal(await viaAxios(), 200);
});

test("with the server's defaults the same stall costs nothing: fetch", async () => {
  applyNetworkDefaults();
  assert.equal(await viaFetch(), 200);
});

test("server/index.js applies the defaults before it requires anything else", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "server", "index.js"), "utf8");
  const firstStatement = src.split("\n").find((line) => line.trim() !== "" && !line.trim().startsWith("//"));
  assert.equal(firstStatement, 'require("./networkDefaults").applyNetworkDefaults();');
  assert.ok(!/setDefaultResultOrder/.test(src), "the DNS order lives in networkDefaults.js, not in index.js");
});
