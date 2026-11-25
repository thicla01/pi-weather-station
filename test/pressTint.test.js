// Tests for the overlay shell's press tint listeners in
// `client/src/ui/pressTint.js`: a view trigger
// is marked at its touch-down, the mark is never removed at the release, a
// press that starts no switch loses it one frame after its CLICK (or, with
// no click, after the tap guard's release tail), and a new press clears any
// older mark first — all without a DOM query (the tint keeps
// the elements it marked; the stand-in root throws on querySelector(All)).
// The module is CommonJS so these tests run the real code
// against a stand-in root (Node has no DOM), with the frames and the timers
// stepped by hand. Run: `npm test`.
//
// The touch order these tests replay (Chromium): pointerdown; pointerup
// with touchend; then — the touchend acked, the GestureTap back from the
// browser process — the click, in a later task, possibly after a frame.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  PRESS_SELECTOR,
  PRESSED_ATTRIBUTE,
  PRESSED_SELECTOR,
  MOVING_ATTRIBUTE,
  PRESS_TINT_NO_CLICK_MS,
  createPressTint,
} = require("../client/src/ui/pressTint");
const { TAP_GUARD_RELEASE_TAIL_MS } = require("../client/src/ui/tapGuard");

/**
 * A stand-in for LayoutPi's root, its elements, and a hand-stepped clock
 * (frames and timers), with the tint's listeners attached.
 *
 * @returns {object} the harness
 */
const harness = () => {
  const listeners = new Map();
  const rootAttrs = new Set();
  const elements = [];
  let now = 0;
  let nextId = 1;
  let frames = new Map();
  const timers = new Map();

  const root = {
    addEventListener(type, fn, capture) {
      assert.equal(capture, true, `${type}: capture phase`);
      listeners.set(type, fn);
    },
    removeEventListener(type, fn, capture) {
      assert.equal(capture, true, `${type}: capture phase`);
      if (listeners.get(type) === fn) listeners.delete(type);
    },
    hasAttribute: (name) => rootAttrs.has(name),
    setAttribute: (name) => rootAttrs.add(name),
    removeAttribute: (name) => rootAttrs.delete(name),
    // A query walks LayoutPi's whole subtree, the map's tiles included:
    // the tint never makes one.
    querySelectorAll(selector) {
      throw new Error(`tree walk: querySelectorAll(${selector})`);
    },
    querySelector(selector) {
      throw new Error(`tree walk: querySelector(${selector})`);
    },
    contains: (el) => elements.includes(el) && !el.detached,
  };

  // A trigger (`data-pi-press`) or a plain element; `child` makes an inner
  // element (an icon) whose closest() finds the trigger.
  const element = (press) => {
    const attrs = new Map();
    const el = {
      setAttribute: (name, value) => attrs.set(name, value),
      removeAttribute: (name) => attrs.delete(name),
      hasAttribute: (name) => attrs.has(name),
      closest: (selector) => {
        assert.equal(selector, PRESS_SELECTOR);
        return press ? el : null;
      },
    };
    el.child = () => ({ closest: (selector) => el.closest(selector) });
    // React removes it from the root (an unmount).
    el.detach = () => {
      el.detached = true;
    };
    elements.push(el);
    return el;
  };

  const tint = createPressTint(root, {
    requestFrame: (fn) => {
      const id = nextId++;
      frames.set(id, fn);
      return id;
    },
    cancelFrame: (id) => frames.delete(id),
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
  });

  const fire = (type, target, init = {}) => {
    const fn = listeners.get(type);
    assert.ok(fn, `no ${type} listener`);
    fn({ type, target, isPrimary: true, ...init });
  };

  return {
    root,
    element,
    tint,
    listeners,
    // What a PRESSED_SELECTOR query under the root would find.
    markedCount: () => elements.filter((el) => !el.detached && el.hasAttribute(PRESSED_ATTRIBUTE)).length,
    pendingFrames: () => frames.size,
    pendingTimers: () => timers.size,
    down: (target, init) => fire("pointerdown", target, init),
    up: (target, init) => fire("pointerup", target, init),
    click: (target) => fire("click", target),
    cancel: (target) => fire("pointercancel", target),
    // React commits the click's switch in the click's task; its layout
    // effect marks the motion (useShellTiming).
    switchStarts: () => rootAttrs.add(MOVING_ATTRIBUTE),
    switchEnds: () => rootAttrs.delete(MOVING_ATTRIBUTE),
    frame: () => {
      const due = frames;
      frames = new Map();
      for (const fn of due.values()) fn();
    },
    advance: (ms) => {
      now += ms;
      for (const [id, t] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at <= now && timers.has(id)) {
          timers.delete(id);
          t.fn();
        }
      }
    },
  };
};

const pressed = (el) => el.hasAttribute(PRESSED_ATTRIBUTE);

test("pressTint: the no-click fallback is the tap guard's release tail (a click that trails its release)", () => {
  assert.equal(PRESS_TINT_NO_CLICK_MS, TAP_GUARD_RELEASE_TAIL_MS);
  assert.equal(PRESS_TINT_NO_CLICK_MS, 300);
});

test("pressTint: a touch tap whose click comes a frame after its release keeps the tint until the view's switch", () => {
  const h = harness();
  const opener = h.element(true);
  h.down(opener.child());
  assert.equal(pressed(opener), true, "marked at touch-down");
  h.up(opener);
  // The frame between the release and the click: nothing clears.
  h.frame();
  h.frame();
  assert.equal(pressed(opener), true, "the release's next frame must not clear the mark");
  assert.equal(h.pendingFrames(), 0, "no frame check from the release");
  // The click (GestureTap) commits the switch in its task.
  h.click(opener);
  h.switchStarts();
  h.frame();
  assert.equal(pressed(opener), true, "a switch is moving: the mark stays under the sheet");
  // The fallback timer went with the click.
  assert.equal(h.pendingTimers(), 0);
  h.advance(10 * PRESS_TINT_NO_CLICK_MS);
  assert.equal(pressed(opener), true, "only the settle clears it now (the hook's idle callback)");
});

test("pressTint: a mouse click (in the release's own task) behaves the same", () => {
  const h = harness();
  const opener = h.element(true);
  h.down(opener);
  h.up(opener);
  h.click(opener);
  h.switchStarts();
  h.frame();
  h.advance(PRESS_TINT_NO_CLICK_MS);
  assert.equal(pressed(opener), true);
});

test("pressTint: a click that starts no switch loses its mark one frame after the click, not before", () => {
  const h = harness();
  const trigger = h.element(true);
  h.down(trigger);
  h.up(trigger);
  h.frame();
  assert.equal(pressed(trigger), true, "not at the release's frame");
  h.click(trigger);
  assert.equal(pressed(trigger), true, "not in the click's task");
  h.frame();
  assert.equal(pressed(trigger), false, "the frame after the click: no motion, cleared");
  assert.equal(h.pendingTimers(), 0);
});

test("pressTint: a release with no click (slid off, or a click the tap guard swallowed at the document) clears after the fallback, unless a switch moves", () => {
  const h = harness();
  const trigger = h.element(true);
  h.down(trigger);
  h.up(trigger);
  h.advance(PRESS_TINT_NO_CLICK_MS - 1);
  assert.equal(pressed(trigger), true);
  h.advance(1);
  assert.equal(pressed(trigger), false);

  const h2 = harness();
  const other = h2.element(true);
  h2.down(other);
  h2.switchStarts();
  h2.up(other);
  h2.advance(PRESS_TINT_NO_CLICK_MS);
  assert.equal(pressed(other), true, "a switch moving: the settle clears it");
});

test("pressTint: pointercancel clears at once and drops any pending check; a second finger is ignored", () => {
  const h = harness();
  const trigger = h.element(true);
  h.down(trigger);
  h.down(h.element(true), { isPrimary: false });
  assert.equal(h.markedCount(), 1, "the second finger marks nothing");
  h.up(trigger, { isPrimary: false });
  assert.equal(h.pendingTimers(), 0, "the second finger's release arms nothing");
  h.up(trigger);
  h.cancel(trigger);
  assert.equal(pressed(trigger), false);
  assert.equal(h.pendingTimers() + h.pendingFrames(), 0);
});

test("pressTint: a new press on a trigger first clears every older mark, and cancels a pending check that would clear its own", () => {
  const h = harness();
  const back = h.element(true);
  const dockButton = h.element(true);
  // A close whose settle never ran (the reopening switch started first):
  // the back square keeps its mark inside the hidden sheet.
  h.down(back);
  h.up(back);
  h.click(back);
  h.switchStarts();
  h.frame();
  assert.equal(pressed(back), true);
  // Reopen from the dock: the old mark goes at the new touch-down.
  h.down(dockButton);
  assert.equal(pressed(back), false, "the old mark is cleared at the next touch-down");
  assert.equal(pressed(dockButton), true);

  // A release with no click, then a new press within the fallback: the
  // pending check is dropped, so the new mark is not cleared under the finger.
  const h2 = harness();
  const a = h2.element(true);
  const b = h2.element(true);
  h2.down(a);
  h2.up(a);
  h2.advance(PRESS_TINT_NO_CLICK_MS / 2);
  h2.down(b);
  h2.advance(PRESS_TINT_NO_CLICK_MS);
  assert.equal(pressed(a), false);
  assert.equal(pressed(b), true, "held: never cleared under the finger");
  // A press off any trigger changes nothing.
  h2.down(h2.element(false));
  assert.equal(pressed(b), true);
});

test("pressTint: a click with no mark schedules nothing; dispose() removes the listeners, the pending check and the marks", () => {
  const h = harness();
  h.click(h.element(false));
  assert.equal(h.pendingFrames() + h.pendingTimers(), 0);
  const trigger = h.element(true);
  h.down(trigger);
  h.up(trigger);
  assert.equal(h.pendingTimers(), 1);
  h.tint.dispose();
  assert.equal(h.listeners.size, 0);
  assert.equal(h.pendingFrames() + h.pendingTimers(), 0);
  assert.equal(pressed(trigger), false);
});

test("pressTint: marked() lists the marks under the root and unmark() clears the ones it is given, the settle's idle clear (usePressTint)", () => {
  const h = harness();
  const opener = h.element(true);
  h.down(opener);
  h.up(opener);
  h.click(opener);
  h.switchStarts();
  h.frame();
  const marked = h.tint.marked();
  assert.deepEqual(marked, [opener]);
  // A press after the settle's snapshot, before its idle callback: its
  // mark is not in the snapshot, so the idle clear leaves it.
  h.switchEnds();
  const back = h.element(true);
  h.down(back);
  assert.equal(pressed(opener), false, "the new press cleared the older mark itself");
  h.tint.unmark(marked);
  assert.equal(pressed(back), true, "a mark made after the snapshot stays under the finger");
  assert.deepEqual(h.tint.marked(), [back]);
  h.tint.unmark([back]);
  assert.equal(h.markedCount(), 0);
  assert.deepEqual(h.tint.marked(), []);
});

test("pressTint: a marked element React removed counts as no mark (what a query under the root would find), and still loses its mark at the next clear", () => {
  const h = harness();
  const trigger = h.element(true);
  h.down(trigger);
  trigger.detach();
  assert.deepEqual(h.tint.marked(), []);
  // A release with no mark under the root arms nothing.
  h.up(trigger);
  assert.equal(h.pendingTimers(), 0);
  h.click(trigger);
  assert.equal(h.pendingFrames(), 0);
  // The next press clears it anyway (out of sight).
  const other = h.element(true);
  h.down(other);
  assert.equal(pressed(trigger), false);
  assert.equal(pressed(other), true);
});

test("pressTint: the hook attaches the listeners whenever the overlay shell is on (no switch of its own), and clears in an idle callback once settled", () => {
  const hook = fs.readFileSync(path.join(__dirname, "..", "client", "src", "components", "ambient", "LayoutPi", "usePressTint.js"), "utf8");
  assert.match(hook, /import \{ createPressTint \} from "~\/ui\/pressTint";/);
  assert.match(hook, /if \(!enabled \|\| !root\) return undefined;\s*const tint = createPressTint\(root\);\s*tintRef\.current = tint;\s*return \(\) => \{\s*tintRef\.current = null;\s*tint\.dispose\(\);\s*\};/);
  // `enabled` is the overlay shell alone (no tint switch).
  const layout = fs.readFileSync(path.join(__dirname, "..", "client", "src", "components", "ambient", "LayoutPi", "index.js"), "utf8");
  assert.match(layout, /usePressTint\(shellVariant !== null, rootRef, shell\.settled\);/);
  assert.doesNotMatch(layout, /piShellTapTint|data-pi-tint/);
  // Idle clear of the marks present at the settle only: a press made after the settle
  // but before the callback keeps its mark under the finger.
  // The tint's own list, not a DOM query.
  assert.match(hook, /const tint = tintRef\.current;\s*if \(!enabled \|\| !settled \|\| !tint\) return undefined;\s*const marked = tint\.marked\(\);/);
  assert.match(hook, /const clearSettled = \(\) => tint\.unmark\(marked\);/);
  assert.match(hook, /requestIdleCallback\(clearSettled, \{ timeout: IDLE_TIMEOUT_MS \}\)/);
  assert.doesNotMatch(hook, /querySelector/);
  // No frame check from the release.
  const mod = fs.readFileSync(path.join(__dirname, "..", "client", "src", "ui", "pressTint.js"), "utf8");
  const onUp = mod.slice(mod.indexOf("const onUp"), mod.indexOf("const onClick"));
  assert.doesNotMatch(onUp, /requestFrame|requestAnimationFrame/);
  assert.match(mod, /root\.addEventListener\("click", onClick, true\);/);
  // No tree walk anywhere in the module's code (comments aside).
  assert.doesNotMatch(mod.replace(/^\s*\/\/.*$/gm, ""), /querySelector/);
});
