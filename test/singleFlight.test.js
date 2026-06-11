// Regression tests for the single-flight guard (server/singleFlight.js),
// which protects /api/update from overlapping `git pull` + `npm ci` runs.
// The contract: first request passes through; a request arriving while one is
// in flight gets a 409; the lock releases when the response settles (finish
// or client close) so a failed run can be retried.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { createSingleFlightGuard, createPerPeerConcurrencyGuard } = require("../server/singleFlight");

// Minimal Express req stand-in for the per-peer guard (reads socket peer + isLocal).
const fakeReq = ({ peer, isLocal = false } = {}) => ({ socket: { remoteAddress: peer }, isLocal });

// Minimal Express res stand-in: an EventEmitter (so finish/close listeners
// work) that records status + json, the way the guard's 409 path needs.
function fakeRes() {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.body = undefined;
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

test("first request passes through and marks the guard busy", () => {
  const guard = createSingleFlightGuard();
  const res = fakeRes();
  let nexted = false;
  guard({}, res, () => { nexted = true; });
  assert.ok(nexted, "first request must call next()");
  assert.equal(guard.isBusy(), true);
});

test("a concurrent request gets a 409 and does not call next()", () => {
  const guard = createSingleFlightGuard({ reason: "update-in-progress", message: "busy" });
  const res1 = fakeRes();
  guard({}, res1, () => {});           // first holds the lock
  const res2 = fakeRes();
  let nexted2 = false;
  guard({}, res2, () => { nexted2 = true; });
  assert.equal(nexted2, false, "second request must be rejected, not passed through");
  assert.equal(res2.statusCode, 409);
  assert.deepEqual(res2.body, { error: true, reason: "update-in-progress", message: "busy" });
});

test("the lock releases when the first response finishes, allowing a retry", () => {
  const guard = createSingleFlightGuard();
  const res1 = fakeRes();
  guard({}, res1, () => {});
  assert.equal(guard.isBusy(), true);

  res1.emit("finish");                 // first response settles
  assert.equal(guard.isBusy(), false);

  // A subsequent request now passes through.
  const res2 = fakeRes();
  let nexted2 = false;
  guard({}, res2, () => { nexted2 = true; });
  assert.ok(nexted2);
  assert.equal(res2.statusCode, 200);
});

test("the lock also releases when the client disconnects (close event)", () => {
  const guard = createSingleFlightGuard();
  const res1 = fakeRes();
  guard({}, res1, () => {});
  res1.emit("close");
  assert.equal(guard.isBusy(), false);
});

test("a late 'close' from a finished response cannot release a later request's lock", () => {
  const guard = createSingleFlightGuard();
  const res1 = fakeRes();
  guard({}, res1, () => {});
  res1.emit("finish");                 // first response settles → lock released, both listeners detached
  assert.equal(guard.isBusy(), false);

  const res2 = fakeRes();              // a second update acquires the lock
  guard({}, res2, () => {});
  assert.equal(guard.isBusy(), true);

  res1.emit("close");                  // stray late close from the OLD response
  assert.equal(guard.isBusy(), true, "the second request's lock must survive res1's late close");
});

test("two guard instances are independent", () => {
  const a = createSingleFlightGuard();
  const b = createSingleFlightGuard();
  a({}, fakeRes(), () => {});
  assert.equal(a.isBusy(), true);
  assert.equal(b.isBusy(), false, "guard b must not be affected by guard a");
});

// === per-peer concurrency guard (bounds in-flight fan-out per remote peer) ===

test("per-peer guard: caps concurrent in-flight requests from one peer at `max`", () => {
  const guard = createPerPeerConcurrencyGuard({ max: 2, reason: "busy", message: "busy" });
  const peer = "203.0.113.5";
  // Two concurrent requests pass (held open — never settled).
  let nexted = 0;
  guard(fakeReq({ peer }), fakeRes(), () => { nexted++; });
  guard(fakeReq({ peer }), fakeRes(), () => { nexted++; });
  assert.equal(nexted, 2);
  assert.equal(guard.inFlightFor(peer), 2);
  // Third concurrent request from the same peer is rejected.
  const res3 = fakeRes();
  let nexted3 = false;
  guard(fakeReq({ peer }), res3, () => { nexted3 = true; });
  assert.equal(nexted3, false);
  assert.equal(res3.statusCode, 429);
  assert.deepEqual(res3.body, { error: true, reason: "busy", message: "busy" });
});

test("per-peer guard: a different peer has its own independent budget", () => {
  const guard = createPerPeerConcurrencyGuard({ max: 1 });
  guard(fakeReq({ peer: "10.0.0.1" }), fakeRes(), () => {});
  assert.equal(guard.inFlightFor("10.0.0.1"), 1);
  // Peer A is at its cap; peer B still passes.
  let nextedB = false;
  guard(fakeReq({ peer: "10.0.0.2" }), fakeRes(), () => { nextedB = true; });
  assert.ok(nextedB);
  assert.equal(guard.inFlightFor("10.0.0.2"), 1);
});

test("per-peer guard: the count releases (and the entry is deleted at zero) when a response settles", () => {
  const guard = createPerPeerConcurrencyGuard({ max: 1 });
  const peer = "198.51.100.9";
  const res1 = fakeRes();
  guard(fakeReq({ peer }), res1, () => {});
  assert.equal(guard.inFlightFor(peer), 1);
  res1.emit("finish");                 // response settles
  assert.equal(guard.inFlightFor(peer), 0, "in-flight count returns to zero");
  // A subsequent request from the same peer now passes again.
  let nexted = false;
  guard(fakeReq({ peer }), fakeRes(), () => { nexted = true; });
  assert.ok(nexted);
});

test("per-peer guard: the local kiosk is exempt (never counted, never rejected)", () => {
  const guard = createPerPeerConcurrencyGuard({ max: 1 });
  let nexted = 0;
  for (let i = 0; i < 5; i++) {
    guard(fakeReq({ peer: "127.0.0.1", isLocal: true }), fakeRes(), () => { nexted++; });
  }
  assert.equal(nexted, 5, "local requests always pass through");
  assert.equal(guard.inFlightFor("127.0.0.1"), 0, "local requests are not counted");
});
