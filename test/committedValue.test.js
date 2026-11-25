// Tests for client/src/ui/committedValue.js,
// the store through which LayoutPi's shell timing keeps its last committed
// switch record without a state update during render. CommonJS module, so
// these run the real code. Run: `npm test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { createCommittedValue } = require("../client/src/ui/committedValue");

test("committedValue: read returns the initial value, then what write stored", () => {
  const record = { id: 0 };
  const store = createCommittedValue(record);
  assert.equal(store.read(), record);
  const next = { id: 1 };
  store.write(next);
  assert.equal(store.read(), next);
  store.write(false);
  assert.equal(store.read(), false);
});

test("committedValue: read is identity-stable between writes, and writing the same value keeps the reference", () => {
  const record = { id: 3 };
  const store = createCommittedValue(record);
  assert.equal(store.read(), store.read());
  store.write(record);
  assert.equal(store.read(), record);
  // NaN is the same value (Object.is), so it keeps the stored one too.
  const nan = createCommittedValue(Number.NaN);
  nan.write(Number.NaN);
  assert.ok(Number.isNaN(nan.read()));
});

test("committedValue: subscribe never calls its listener and returns a no-op unsubscribe (its one writer is the component's own commit)", () => {
  const store = createCommittedValue(1);
  let calls = 0;
  const unsubscribe = store.subscribe(() => {
    calls += 1;
  });
  store.write(2);
  store.write(3);
  assert.equal(calls, 0);
  assert.equal(typeof unsubscribe, "function");
  assert.equal(unsubscribe(), undefined);
  assert.equal(store.read(), 3);
});

test("committedValue: the methods are stable functions (useSyncExternalStore re-subscribes when subscribe changes)", () => {
  const store = createCommittedValue(0);
  const { read, write, subscribe } = store;
  write(5);
  assert.equal(read(), 5);
  assert.equal(store.subscribe, subscribe);
  assert.equal(store.read, read);
});
