// Regression tests for the bounded client tracker (server/clientTracker.js).
//
// recordClient is fed the socket peer (server/index.js), so the spoofable
// X-Forwarded-For fan-out that previously let one client mint unlimited Map
// entries is already closed. This test locks down the belt-and-suspenders
// bound: the remoteClients Map can never exceed MAX_REMOTE_CLIENTS, and the
// most-recently-seen clients are the ones retained.
//
// node --test runs each file in its own process, so the module-level Map
// starts empty here regardless of the rest of the suite.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { recordClient, getRemoteClients, __test } = require("../server/clientTracker");
const { MAX_REMOTE_CLIENTS } = __test;

test("recordClient: caps the tracked set at MAX_REMOTE_CLIENTS", () => {
  for (let i = 0; i < MAX_REMOTE_CLIENTS + 250; i++) {
    recordClient(`198.51.100.${i}`);
  }
  assert.equal(getRemoteClients().length, MAX_REMOTE_CLIENTS);
});

test("recordClient: ignores a falsy / missing peer (no phantom entry)", () => {
  const before = getRemoteClients().length;
  recordClient(undefined);
  recordClient("");
  recordClient(null);
  assert.equal(getRemoteClients().length, before);
});

test("recordClient: a re-seen client is retained over idle ones and counts up", () => {
  // The earliest-inserted IPs from the cap test are already evicted; pick a
  // fresh one, then flood past the cap while periodically re-touching it.
  const sticky = "198.51.100.sticky";
  recordClient(sticky);
  for (let i = 0; i < MAX_REMOTE_CLIENTS + 50; i++) {
    recordClient(`203.0.113.${i}`);
    if (i % 100 === 0) recordClient(sticky); // keep it recent
  }
  const entry = getRemoteClients().find((c) => c.ip === sticky);
  assert.ok(entry, "a continuously re-seen client survives the FIFO/LRU cap");
  assert.ok(entry.requestCount > 1);
  assert.ok(entry.lastSeen >= entry.firstSeen);
});
