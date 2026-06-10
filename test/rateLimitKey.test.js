// Regression tests for the rate-limit key generator (server/rateLimitKey.js).
//
// The security property under test: rate-limit buckets are keyed on the raw
// TCP socket peer, NEVER on req.ip. Under `trust proxy` (ALLOW_REMOTE=true)
// req.ip honours the client-supplied X-Forwarded-For header, so keying on it
// would let one remote client rotate the header to mint unlimited buckets
// and bypass the limiter — including the only brake on paid Anthropic spend.
// These tests prove a changing X-Forwarded-For / req.ip with a fixed socket
// peer always lands in one bucket, and that distinct peers get distinct
// buckets. This is the rate-limit-layer companion to the e4a9e72 fix.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { socketPeerKeyGenerator } = require("../server/rateLimitKey");

// Minimal Express-request stand-in: only the fields the key generator reads.
const fakeReq = ({ peer, ip }) => ({ socket: { remoteAddress: peer }, ip });

test("key derives from the socket peer, not req.ip", () => {
  const key = socketPeerKeyGenerator(fakeReq({ peer: "203.0.113.7", ip: "127.0.0.1" }));
  // ipKeyGenerator passes IPv4 through unchanged.
  assert.equal(key, "203.0.113.7");
});

test("a changing X-Forwarded-For / req.ip with a FIXED socket peer shares one bucket", () => {
  const a = socketPeerKeyGenerator(fakeReq({ peer: "203.0.113.7", ip: "127.0.0.1" }));
  const b = socketPeerKeyGenerator(fakeReq({ peer: "203.0.113.7", ip: "10.0.0.1" }));
  const c = socketPeerKeyGenerator(fakeReq({ peer: "203.0.113.7", ip: "8.8.8.8" }));
  assert.equal(a, b);
  assert.equal(b, c);
});

test("distinct socket peers get distinct buckets", () => {
  const a = socketPeerKeyGenerator(fakeReq({ peer: "203.0.113.7", ip: "127.0.0.1" }));
  const b = socketPeerKeyGenerator(fakeReq({ peer: "203.0.113.8", ip: "127.0.0.1" }));
  assert.notEqual(a, b);
});

test("IPv6 peers are normalised to a /56 subnet (can't be walked to dodge the limit)", () => {
  // Two addresses inside the same /56 must collapse to one bucket.
  const a = socketPeerKeyGenerator(fakeReq({ peer: "2001:db8:abcd:1::1" }));
  const b = socketPeerKeyGenerator(fakeReq({ peer: "2001:db8:abcd:1::ffff" }));
  assert.equal(a, b);
  // The key is the subnet form, not the raw address.
  assert.ok(a.includes("/56"));
});

test("a missing socket peer collapses to a single shared bucket (never undefined)", () => {
  const a = socketPeerKeyGenerator(fakeReq({ peer: undefined, ip: "1.2.3.4" }));
  const b = socketPeerKeyGenerator({}); // no socket at all
  assert.equal(a, "unknown-peer");
  assert.equal(b, "unknown-peer");
});
