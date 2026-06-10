// Regression tests for the single-flight guard (server/singleFlight.js),
// which protects /api/update from overlapping `git pull` + `npm ci` runs.
// The contract: first request passes through; a request arriving while one is
// in flight gets a 409; the lock releases when the response settles (finish
// or client close) so a failed run can be retried.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { createSingleFlightGuard } = require("../server/singleFlight");

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
