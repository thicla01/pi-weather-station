// Regression tests for the debounced request counter (server/requestCounter.js).
//
// increment() runs on every external API call. It used to fs.writeFileSync
// the counts file on each call — a synchronous SD-card write that blocked the
// event loop and amplified any request flood. It now just marks the counters
// dirty; a flush interval (and the graceful-shutdown hook in index.js) does
// the actual write. These tests lock that contract down with an fs mock so no
// real file is touched.
//
// node --test runs each file in its own process, so the module's dirty flag
// starts false here regardless of the rest of the suite.

const { test, mock } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const rc = require("../server/requestCounter");

test("increment() does not write to disk; flush() persists exactly once", () => {
  const writeMock = mock.method(fs, "writeFileSync", () => {});
  try {
    assert.equal(rc.__test.isDirty(), false, "fresh module starts clean");

    rc.increment("tomorrow.io", "current");
    assert.equal(writeMock.mock.calls.length, 0, "increment must not write synchronously");
    assert.equal(rc.__test.isDirty(), true, "increment marks the counters dirty");

    assert.equal(rc.flush(), true, "flush persists when dirty");
    assert.equal(writeMock.mock.calls.length, 1, "flush writes exactly once");
    assert.equal(rc.__test.isDirty(), false, "flush clears the dirty flag");
  } finally {
    writeMock.mock.restore();
  }
});

test("flush() is a no-op when nothing changed since the last write", () => {
  const writeMock = mock.method(fs, "writeFileSync", () => {});
  try {
    // Previous test left it clean; a flush with no new increments must not write.
    assert.equal(rc.flush(), false);
    assert.equal(writeMock.mock.calls.length, 0);

    // Many increments still coalesce into a single pending write.
    rc.increment("mapbox", "tiles");
    rc.increment("mapbox", "tiles");
    rc.increment("anthropic", "summary");
    assert.equal(writeMock.mock.calls.length, 0);
    assert.equal(rc.flush(), true);
    assert.equal(writeMock.mock.calls.length, 1, "N increments → one coalesced write");
  } finally {
    writeMock.mock.restore();
  }
});

test("getCounters() reflects increments immediately (in-memory, not file-dependent)", () => {
  const before = rc.getCounters()["locationiq"]?.endpoints?.reverse?.day || 0;
  rc.increment("locationiq", "reverse");
  const after = rc.getCounters()["locationiq"].endpoints.reverse.day;
  assert.equal(after, before + 1);
});

test("FLUSH_INTERVAL_MS is one minute", () => {
  assert.equal(rc.__test.FLUSH_INTERVAL_MS, 60 * 1000);
});
