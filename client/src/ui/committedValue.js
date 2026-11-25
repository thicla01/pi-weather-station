// A value a component keeps from its last COMMITTED render, readable
// during the next render without a state update (so the overlay shell
// takes one LayoutPi render pass per switch).
//
// The problem it solves: a hook that must know, during render, what the
// previous committed render showed (the LayoutPi shell's last switch, so
// a new `piLayoutState` is recorded as a switch "from" it). React's
// documented pattern stores that in state and updates it during render
// (adjust-on-change), which makes React call the component a second time
// at once, before its children: a whole second pass of LayoutPi's body at
// every switch. A ref read during
// render would avoid it, but `react-hooks/refs` forbids that and the
// React Compiler then skips the hook.
//
// So the value lives here, outside React, and the component reads it
// through `useSyncExternalStore(store.subscribe, store.read)` — React's
// API for reading a mutable source during render — and writes it back in
// a PASSIVE effect of the commit that showed the new value, declared after
// that `useSyncExternalStore` call. Why passive, and after: React flushes
// a commit's passive effects before it starts any later render, so the
// next render always reads what the last commit showed; and inside that
// flush, `useSyncExternalStore`'s own check (it compares the store with
// the snapshot its render read) runs before the write, so it never sees a
// change and never forces an extra render. A layout-effect write would
// make that check fail after two switches in a row, and render again.
//
// `subscribe` never calls its listener: the store's one writer is the
// component itself, in the commit after the render that already showed
// the written value, so no render is ever owed. `write` keeps the stored
// reference when given the same value, so reads stay identity-stable.
//
// MODULE FORMAT: CommonJS on purpose (like ui/pressTint.js), so
// test/committedValue.test.js runs the real module under `node --test`.

const NO_UNSUBSCRIBE = () => undefined;

/**
 * A store holding one value, read during render through
 * useSyncExternalStore and written in the committing render's passive
 * effect (see the header).
 *
 * @param {unknown} initial - The value before any commit.
 * @returns {{read: function(): unknown, write: function(unknown): void, subscribe: function(function(): void): function(): void}}
 *   read() returns the stored value; write(value) stores it; subscribe()
 *   registers nothing and returns a no-op unsubscribe.
 */
function createCommittedValue(initial) {
  let value = initial;
  return {
    read: () => value,
    write: (next) => {
      if (!Object.is(next, value)) value = next;
    },
    subscribe: () => NO_UNSUBSCRIBE,
  };
}

module.exports = { createCommittedValue };
