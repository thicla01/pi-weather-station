// Tests for the overlay shell's view-sheet warm-up in
// `client/src/ui/sheetWarmup.js` (a warm-up of the sheet's paint with no
// off-screen layer): each hidden view host laid out and painted once, out
// of sight, in one idle frame at rest, after the first load and a quiet
// second, never with a pointer down, cancelled at once by any input, again
// when content mounts at a host's top. The module is CommonJS so
// these tests run the real scheduler against a stand-in root and hosts, an
// EventTarget for the inputs, and idle callbacks, frames, timers and a clock
// stepped by hand. The CSS and JSX wiring is pinned in
// test/piShellGeometry.test.js. Run: `npm test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  WARM_ATTRIBUTE,
  WARMED_ATTRIBUTE,
  WARM_IDLE_TIMEOUT_MS,
  WARM_FALLBACK_DELAY_MS,
  WARM_QUIET_MS,
  WARM_INPUT_EVENTS,
  WARM_ACTIVITY_EVENTS,
  SHEET_WARM_OPACITY,
  PAINT_MIN_OPACITY,
  INVISIBLE_MAX_OPACITY,
  warmGate,
  nextWarmHost,
  warmedValue,
  whenIdle,
  createSheetWarmup,
} = require("../client/src/ui/sheetWarmup");
const { createStyleWarmup, STYLE_WARM_START_MARK, STYLE_WARM_END_MARK } = require("../client/src/ui/styleWarmup");
const { initialShellSwitch, nextShellSwitch, SHELL_MODES } = require("../client/src/ui/piShellGeometry");
const { MOVING_ATTRIBUTE } = require("../client/src/ui/pressTint");

const LAYOUT_PI_CSS = fs.readFileSync(
  path.join(__dirname, "..", "client", "src", "components", "ambient", "LayoutPi", "styles.css"),
  "utf8",
);
const LAYOUT_PI_JS = fs.readFileSync(
  path.join(__dirname, "..", "client", "src", "components", "ambient", "LayoutPi", "index.js"),
  "utf8",
);
const SHELL_TIMING_JS = fs.readFileSync(
  path.join(__dirname, "..", "client", "src", "components", "ambient", "LayoutPi", "useShellTiming.js"),
  "utf8",
);

/**
 * The scheduler with a stand-in root and hosts, an EventTarget for the
 * inputs, and a hand-stepped clock: idle callbacks, the afterNextFrame step
 * and timers each wait in their own queue until the test runs them.
 *
 * @param {object} [opts] - Options.
 * @param {string[]} [opts.empty] - Hosts mounted with nothing at their top.
 * @returns {object} the harness
 */
const harness = ({ empty = [], styleWarmup = null } = {}) => {
  const attrs = new Map();
  const log = [];
  // The root also reads its attributes and takes children, for the real style warm-up step (ui/styleWarmup.js),
  // which reads `data-pi-state` there and inserts its stand-in shield.
  const root = {
    name: "root",
    children: [],
    getAttribute: (name) => (attrs.has(name) ? attrs.get(name) : null),
    hasAttribute: (name) => attrs.has(name),
    setAttribute: (name, value) => {
      attrs.set(name, String(value));
      log.push(`+${name}=${value}`);
    },
    removeAttribute: (name) => {
      if (attrs.delete(name)) log.push(`-${name}`);
    },
    insertBefore: (child, ref) => {
      const i = root.children.indexOf(ref);
      root.children.splice(i < 0 ? root.children.length : i, 0, child);
      child.parent = root;
      log.push(`+child ${child.name}`);
    },
  };
  const elements = {};
  const hosts = ["conditions", "alert", "ai", "max"].map((state) => {
    elements[state] = { firstElementChild: empty.includes(state) ? null : {} };
    return { state, element: () => elements[state] };
  });
  const inputTarget = new EventTarget();
  const listening = [];
  const add = inputTarget.addEventListener.bind(inputTarget);
  const remove = inputTarget.removeEventListener.bind(inputTarget);
  inputTarget.addEventListener = (type, fn, options) => {
    listening.push({ type, options });
    add(type, fn, options);
  };
  inputTarget.removeEventListener = (type, fn, options) => {
    const i = listening.findIndex((l) => l.type === type);
    if (i >= 0) listening.splice(i, 1);
    remove(type, fn, options);
  };
  let now = 0;
  let nextId = 1;
  let idle = new Map();
  let frames = new Map();
  const timers = new Map();
  let flushes = 0;
  const warmup = createSheetWarmup({
    root,
    inputTarget,
    hosts,
    whenIdle: (fn) => {
      const id = nextId++;
      idle.set(id, fn);
      return () => idle.delete(id);
    },
    afterFrames: (fn) => {
      const id = nextId++;
      frames.set(id, fn);
      return () => frames.delete(id);
    },
    flushStyle: () => {
      flushes += 1;
    },
    styleWarmup,
    now: () => now,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
  });
  const input = (type, init = {}) => inputTarget.dispatchEvent(Object.assign(new Event(type), init));
  return {
    warmup,
    root,
    elements,
    listening,
    log,
    warm: () => attrs.get(WARM_ATTRIBUTE) || null,
    warmed: () => attrs.get(WARMED_ATTRIBUTE) || null,
    flushes: () => flushes,
    pendingIdle: () => idle.size,
    pendingFrames: () => frames.size,
    pendingTimers: () => timers.size,
    // The main thread goes idle: the asked idle callbacks run.
    idle: () => {
      const due = idle;
      idle = new Map();
      for (const fn of due.values()) fn();
    },
    // The start of the frame after the warm frame: afterNextFrame's step.
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
    down: (pointerId = 1, pointerType = "mouse") => input("pointerdown", { pointerId, pointerType }),
    up: (pointerId = 1, pointerType = "mouse") => input("pointerup", { pointerId, pointerType }),
    pointerCancel: (pointerId = 1, pointerType = "mouse") => input("pointercancel", { pointerId, pointerType }),
    // A touch's own events: `touches` lists the fingers still on the screen.
    touchEnd: (fingersLeft = 0) => input("touchend", { touches: Array.from({ length: fingersLeft }, () => ({})) }),
    touchCancel: (fingersLeft = 0) => input("touchcancel", { touches: Array.from({ length: fingersLeft }, () => ({})) }),
    touchMove: () => input("touchmove"),
    scroll: () => input("scroll"),
    key: () => input("keydown"),
    wheel: () => input("wheel"),
    // The window's own blur (its target the input target itself).
    blur: () => input("blur"),
    // An element's blur crossing the window in the capture phase (focus moving inside the page).
    elementBlur: () => {
      const event = new Event("blur");
      Object.defineProperty(event, "target", { value: { tagName: "BUTTON" } });
      inputTarget.dispatchEvent(event);
    },
  };
};

/**
 * Brings a fresh harness to the point where the first warm-up step is asked
 * for: at rest, loaded, the quiet second over.
 *
 * @param {object} h - the harness
 * @returns {void}
 */
const ready = (h) => {
  h.warmup.setAtRest(true);
  h.warmup.setLoaded(true);
  h.advance(WARM_QUIET_MS);
};

/**
 * Runs one full warm-up step (its idle callback, then its frame) and
 * returns the host it warmed.
 *
 * @param {object} h - the harness
 * @returns {?string} the state `data-pi-warm` named in the warm frame
 */
const warmOne = (h) => {
  h.idle();
  const state = h.warm();
  h.frame();
  return state;
};

test("sheetWarmup: the warm pose's opacity paints (over Blink's 0.0004) and changes no 8-bit pixel (under half a level); styles.css declares it", () => {
  assert.equal(SHEET_WARM_OPACITY, 0.001);
  assert.equal(PAINT_MIN_OPACITY, 0.0004);
  assert.ok(SHEET_WARM_OPACITY > PAINT_MIN_OPACITY, "Blink would skip the paint");
  assert.ok(SHEET_WARM_OPACITY > 0, "the compositor neither draws nor rasterizes a layer at opacity 0");
  assert.ok(SHEET_WARM_OPACITY * 255 < 0.5 && INVISIBLE_MAX_OPACITY === 0.5 / 255 && SHEET_WARM_OPACITY < INVISIBLE_MAX_OPACITY);
  const css = LAYOUT_PI_CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = css.match(/\.layout\[data-pi-shell\]\[data-pi-state="mid"\]\[data-pi-warm\] \.sheet,\s*\.layout\[data-pi-shell\]\[data-pi-state="min"\]\[data-pi-warm\] \.sheet\s*\{([^}]*)\}/);
  assert.ok(rule, "no warm-pose rule in LayoutPi/styles.css");
  assert.match(rule[1], new RegExp(`(?:^|;)\\s*opacity:\\s*${SHEET_WARM_OPACITY};`));
});

test("sheetWarmup: constants — idle callback within 2 s (200 ms task without it), a quiet second, the inputs that cancel, the attributes", () => {
  assert.equal(WARM_ATTRIBUTE, "data-pi-warm");
  assert.equal(WARMED_ATTRIBUTE, "data-pi-warmed");
  assert.equal(WARM_IDLE_TIMEOUT_MS, 2000);
  assert.equal(WARM_FALLBACK_DELAY_MS, 200);
  assert.equal(WARM_QUIET_MS, 1000);
  assert.deepEqual([...WARM_INPUT_EVENTS], ["pointerdown", "pointerup", "pointercancel", "touchend", "touchcancel", "keydown", "wheel"]);
  assert.ok(Object.isFrozen(WARM_INPUT_EVENTS));
  assert.deepEqual([...WARM_ACTIVITY_EVENTS], ["touchmove", "scroll"]);
  assert.ok(Object.isFrozen(WARM_ACTIVITY_EVENTS));
});

test("sheetWarmup: warmGate — at rest, loaded, no pointer down, then a quiet second; otherwise how long to wait, or nothing to wait on", () => {
  const base = { atRest: true, loaded: true, pointersDown: 0, now: 5000, quietSince: 3000 };
  assert.deepEqual(warmGate(base), { go: true, waitMs: 0 });
  assert.deepEqual(warmGate({ ...base, quietSince: -Infinity }), { go: true, waitMs: 0 }, "no input yet");
  assert.deepEqual(warmGate({ ...base, quietSince: 5000 - WARM_QUIET_MS }), { go: true, waitMs: 0 }, "exactly the quiet second");
  assert.deepEqual(warmGate({ ...base, quietSince: 4700 }), { go: false, waitMs: 700 });
  assert.deepEqual(warmGate({ ...base, atRest: false }), { go: false, waitMs: null }, "a switch, a view, or no data");
  assert.deepEqual(warmGate({ ...base, loaded: false }), { go: false, waitMs: null }, "before the load and the fonts");
  assert.deepEqual(warmGate({ ...base, pointersDown: 1 }), { go: false, waitMs: null }, "a finger down: wait for its release");
  assert.deepEqual(warmGate({ ...base, pointersDown: 2, quietSince: 4900 }), { go: false, waitMs: null });
});

test("sheetWarmup: nextWarmHost — the first in order with content that isn't warm; warmedValue keeps the hosts' order", () => {
  const hosts = [
    { state: "conditions", hasContent: true },
    { state: "alert", hasContent: false },
    { state: "ai", hasContent: true },
    { state: "max", hasContent: true },
  ];
  assert.equal(nextWarmHost(hosts, new Set()), "conditions");
  assert.equal(nextWarmHost(hosts, new Set(["conditions"])), "ai", "an empty host (no alert) is skipped");
  assert.equal(nextWarmHost(hosts, new Set(["conditions", "ai"])), "max");
  assert.equal(nextWarmHost(hosts, new Set(["conditions", "ai", "max"])), null);
  assert.equal(nextWarmHost([], new Set()), null);
  const order = hosts.map((h) => h.state);
  assert.equal(warmedValue(order, new Set(["max", "conditions", "ai"])), "conditions ai max");
  assert.equal(warmedValue(order, new Set()), "");
});

test("sheetWarmup: whenIdle — an idle callback with the 2 s timeout, cancelled by cancelIdleCallback; a 200 ms task without it", () => {
  const calls = [];
  const step = () => {};
  const withIdle = {
    requestIdleCallback: (fn, opts) => {
      calls.push(["ric", fn, opts]);
      return 7;
    },
    cancelIdleCallback: (id) => calls.push(["cic", id]),
  };
  whenIdle(step, withIdle)();
  assert.deepEqual(calls, [["ric", step, { timeout: WARM_IDLE_TIMEOUT_MS }], ["cic", 7]]);
  calls.length = 0;
  const withoutIdle = {
    setTimeout: (fn, ms) => {
      calls.push(["st", fn, ms]);
      return 9;
    },
    clearTimeout: (id) => calls.push(["ct", id]),
  };
  whenIdle(step, withoutIdle)();
  assert.deepEqual(calls, [["st", step, WARM_FALLBACK_DELAY_MS], ["ct", 9]]);
});

test("sheetWarmup: nothing before the load (and the fonts) and the rest, nor before a quiet second after the later of the two", () => {
  const h = harness();
  assert.equal(h.pendingIdle() + h.pendingTimers(), 0, "nothing at creation");
  h.warmup.setLoaded(true);
  assert.equal(h.pendingIdle() + h.pendingTimers(), 0, "loaded, but not at rest (no data yet)");
  h.advance(5000);
  h.warmup.setAtRest(true);
  assert.equal(h.pendingIdle(), 0, "at rest: the quiet second starts now, not at the load");
  assert.equal(h.pendingTimers(), 1);
  h.advance(WARM_QUIET_MS - 1);
  assert.equal(h.pendingIdle(), 0);
  h.advance(1);
  assert.equal(h.pendingIdle(), 1, "then an idle callback is asked for");
  assert.equal(h.warm(), null, "nothing is set before it runs");
  const h2 = harness();
  h2.warmup.setAtRest(true);
  assert.equal(h2.pendingIdle() + h2.pendingTimers(), 0, "at rest, but not loaded");
  h2.warmup.setLoaded(true);
  h2.advance(WARM_QUIET_MS);
  assert.equal(h2.pendingIdle(), 1);
});

test("sheetWarmup: each host once, in order, one warm frame each, its own idle callback each; an empty host is skipped; data-pi-warmed lists the warm ones", () => {
  const h = harness({ empty: ["alert"] });
  ready(h);
  h.idle();
  assert.equal(h.warm(), "conditions", "the warm frame names the host");
  assert.equal(h.pendingIdle(), 0, "one host at a time");
  assert.equal(h.pendingFrames(), 1);
  h.frame();
  assert.equal(h.warm(), null, "taken off at the start of the next frame");
  assert.equal(h.warmed(), "conditions");
  assert.equal(h.pendingIdle(), 1, "the next host waits for its own idle callback");
  assert.equal(warmOne(h), "ai", "no alert: its host is skipped");
  assert.equal(warmOne(h), "max");
  assert.equal(h.warmed(), "conditions ai max");
  assert.equal(h.pendingIdle() + h.pendingFrames() + h.pendingTimers(), 0, "done: nothing pending");
  assert.deepEqual(h.log, [
    "+data-pi-warm=conditions", "-data-pi-warm", "+data-pi-warmed=conditions",
    "+data-pi-warm=ai", "-data-pi-warm", "+data-pi-warmed=conditions ai",
    "+data-pi-warm=max", "-data-pi-warm", "+data-pi-warmed=conditions ai max",
  ]);
  // Once: inputs, the rest's end and return, and the load ask for nothing more.
  h.down();
  h.up();
  h.key();
  h.warmup.setAtRest(false);
  h.warmup.setAtRest(true);
  h.advance(10 * WARM_QUIET_MS);
  assert.equal(h.pendingIdle() + h.pendingFrames() + h.pendingTimers(), 0);
  assert.equal(h.flushes(), 0, "no warm pose to take off");
});

test("sheetWarmup: a pointerdown cancels a pending idle callback; nothing while the finger is down; it resumes a quiet second after the release, with the same host", () => {
  const h = harness();
  ready(h);
  assert.equal(h.pendingIdle(), 1);
  h.advance(400);
  h.down();
  assert.equal(h.pendingIdle(), 0, "cancelled at once");
  h.advance(5000);
  assert.equal(h.pendingIdle() + h.pendingTimers(), 0, "a long press or a drag: nothing while the pointer is down");
  h.up();
  assert.equal(h.pendingIdle(), 0);
  h.advance(WARM_QUIET_MS - 1);
  assert.equal(h.pendingIdle(), 0, "Leaflet's inertia, a double tap's pause");
  h.advance(1);
  assert.equal(warmOne(h), "conditions", "nothing was marked warm");
  assert.equal(h.flushes(), 0, "no pose was set");
});

test("sheetWarmup: a pointerdown in the warm frame takes the pose off at once, flushes style (a view this tap opens slides from the closed pose) and leaves the host unwarmed", () => {
  const h = harness();
  ready(h);
  h.idle();
  assert.equal(h.warm(), "conditions");
  h.down();
  assert.equal(h.warm(), null, "off in the pointerdown's own handler");
  assert.equal(h.flushes(), 1);
  assert.equal(h.pendingFrames(), 0, "its frame step cancelled");
  assert.equal(h.warmed(), null, "not warm");
  h.up();
  h.advance(WARM_QUIET_MS);
  assert.equal(warmOne(h), "conditions", "warmed again later");
  assert.equal(h.warmed(), "conditions");
});

test("sheetWarmup: a keydown or a wheel cancels the same way and restarts the quiet second (no pointer to wait for)", () => {
  for (const kind of ["key", "wheel"]) {
    const h = harness();
    ready(h);
    h.idle();
    h[kind]();
    assert.equal(h.warm(), null, kind);
    assert.equal(h.flushes(), 1, kind);
    assert.equal(h.pendingIdle(), 0, kind);
    h.advance(WARM_QUIET_MS - 1);
    assert.equal(h.pendingIdle(), 0, kind);
    h.advance(1);
    assert.equal(warmOne(h), "conditions", kind);
  }
});

test("sheetWarmup: two fingers — nothing until both are up; a mouse or pen pointercancel releases like a pointerup; the window's blur drops a release the page never heard", () => {
  const h = harness();
  ready(h);
  h.down(1);
  h.down(2);
  h.up(1);
  h.advance(5000);
  assert.equal(h.pendingIdle() + h.pendingTimers(), 0, "pointer 2 still down");
  h.pointerCancel(2);
  h.advance(WARM_QUIET_MS);
  assert.equal(h.pendingIdle(), 1);
  const h2 = harness();
  ready(h2);
  h2.down(3);
  h2.advance(5000);
  assert.equal(h2.pendingIdle() + h2.pendingTimers(), 0);
  h2.blur();
  assert.equal(h2.pendingIdle(), 1, "the press was long ago: the quiet second is over");
});

test("sheetWarmup: a touch whose pointer a native scroll cancelled stays down until its touch ends; touchmove and scroll (inertia included) restart the quiet second", () => {
  // A simulated case: pressed at 1500, the rail starts scrolling at 1580 (Chromium's
  // pointercancel, the finger still down); no warm frame may start while it scrolls.
  const h = harness();
  ready(h);
  h.advance(500);
  h.down(7, "touch");
  assert.equal(h.pendingIdle(), 0, "cancelled at once");
  h.advance(80);
  h.pointerCancel(7, "touch");
  for (let i = 0; i < 40; i += 1) {
    h.advance(100);
    h.touchMove();
    h.scroll();
  }
  h.advance(5000);
  assert.equal(h.pendingIdle() + h.pendingTimers(), 0, "the finger is still down: nothing asked, no timer");
  assert.equal(h.warm(), null);
  // One finger lifted, another still on the screen: still down.
  h.touchEnd(1);
  h.advance(5000);
  assert.equal(h.pendingIdle() + h.pendingTimers(), 0, "a finger left");
  // The last finger lifts; the scroll's inertia runs on: each scroll restarts the quiet second.
  h.touchEnd(0);
  for (let i = 0; i < 10; i += 1) {
    h.advance(WARM_QUIET_MS / 2);
    h.scroll();
    h.idle();
    assert.equal(h.warm(), null, `inertia, scroll ${i}`);
  }
  h.advance(WARM_QUIET_MS - 1);
  h.idle();
  assert.equal(h.warm(), null, "a quiet second not yet over");
  h.advance(1);
  assert.equal(warmOne(h), "conditions", "a quiet second after the last scroll");
  // A touchcancel with no finger left releases too.
  const h2 = harness();
  ready(h2);
  h2.down(8, "touch");
  h2.pointerCancel(8, "touch");
  h2.advance(5000);
  assert.equal(h2.pendingIdle() + h2.pendingTimers(), 0);
  h2.touchCancel(0);
  h2.advance(WARM_QUIET_MS);
  assert.equal(h2.pendingIdle(), 1);
  // A touch released normally (pointerup) needs no touchend.
  const h3 = harness();
  ready(h3);
  h3.down(9, "touch");
  h3.up(9, "touch");
  h3.advance(WARM_QUIET_MS);
  assert.equal(h3.pendingIdle(), 1);
});

test("sheetWarmup: a scroll or touchmove in the warm frame takes the pose off without a flush, leaves the host unwarmed and resumes a quiet second later", () => {
  for (const kind of ["scroll", "touchMove"]) {
    const h = harness();
    ready(h);
    h.idle();
    assert.equal(h.warm(), "conditions", kind);
    h[kind]();
    assert.equal(h.warm(), null, kind);
    assert.equal(h.flushes(), 0, `${kind}: no view opens from it`);
    assert.equal(h.pendingFrames(), 0, kind);
    assert.equal(h.warmed(), null, kind);
    h.advance(WARM_QUIET_MS - 1);
    assert.equal(h.pendingIdle(), 0, kind);
    h.advance(1);
    assert.equal(warmOne(h), "conditions", kind);
  }
});

test("sheetWarmup: an element's blur during a press (focus moving inside the page) leaves the pointer down; the window's own blur releases it", () => {
  const h = harness();
  ready(h);
  h.down(4);
  h.elementBlur();
  h.advance(5000);
  assert.equal(h.pendingIdle() + h.pendingTimers(), 0, "a mouse drag past a second: still blocked");
  h.up(4);
  h.advance(WARM_QUIET_MS);
  assert.equal(h.pendingIdle(), 1);
  // The same for a touch held through a scroll.
  const h2 = harness();
  ready(h2);
  h2.down(5, "touch");
  h2.pointerCancel(5, "touch");
  h2.elementBlur();
  h2.advance(5000);
  assert.equal(h2.pendingIdle() + h2.pendingTimers(), 0);
  h2.blur();
  assert.equal(h2.pendingIdle(), 1, "the window lost the focus: the pointers drop");
});

test("sheetWarmup: leaving the rest (a switch's own commit) takes a warm pose off without a flush, cancels everything, and resumes a quiet second after the next rest", () => {
  const h = harness();
  ready(h);
  h.idle();
  assert.equal(h.warm(), "conditions");
  h.warmup.setAtRest(false);
  assert.equal(h.warm(), null);
  assert.equal(h.flushes(), 0, "the commit's own style recalc follows");
  assert.equal(h.pendingIdle() + h.pendingFrames() + h.pendingTimers(), 0);
  h.advance(10 * WARM_QUIET_MS);
  assert.equal(h.pendingIdle(), 0, "a view open: nothing");
  h.warmup.setAtRest(true);
  assert.equal(h.pendingIdle(), 0, "back at rest: a quiet second first");
  h.advance(WARM_QUIET_MS);
  assert.equal(warmOne(h), "conditions");
  // A pending idle callback goes too.
  assert.equal(h.pendingIdle(), 1);
  h.warmup.setAtRest(false);
  assert.equal(h.pendingIdle(), 0);
});

test("sheetWarmup: content mounted at a host's top later (an alert arriving) warms that host again; data-pi-warmed drops it until then", () => {
  const h = harness({ empty: ["alert"] });
  ready(h);
  while (h.pendingIdle()) warmOne(h);
  assert.equal(h.warmed(), "conditions ai max");
  h.elements.alert.firstElementChild = {};
  h.warmup.contentChanged("alert");
  assert.equal(h.pendingIdle(), 1, "the quiet second has long passed");
  assert.equal(warmOne(h), "alert");
  assert.equal(h.warmed(), "conditions alert ai max", "in the hosts' order");
  h.warmup.contentChanged("alert");
  assert.equal(h.warmed(), "conditions ai max", "a new mount: no longer warm");
  assert.equal(warmOne(h), "alert");
  assert.equal(h.warmed(), "conditions alert ai max");
  // An empty host stays unwarmed: its content went away.
  h.elements.alert.firstElementChild = null;
  h.warmup.contentChanged("alert");
  assert.equal(h.pendingIdle(), 0);
  assert.equal(h.warmed(), "conditions ai max");
});

test("sheetWarmup: content mounted at the top of the host in its warm frame — not marked warm, warmed again", () => {
  const h = harness();
  ready(h);
  h.idle();
  assert.equal(h.warm(), "conditions");
  h.warmup.contentChanged("conditions");
  h.frame();
  assert.equal(h.warmed(), null);
  assert.equal(warmOne(h), "conditions");
  assert.equal(h.warmed(), "conditions");
});

test("sheetWarmup: listens in the capture phase, passively, from creation to dispose(), which cancels everything and takes a warm pose and data-pi-warmed off", () => {
  const h = harness();
  const types = h.listening.map((l) => l.type).sort();
  assert.deepEqual(types, [...WARM_INPUT_EVENTS, ...WARM_ACTIVITY_EVENTS, "blur"].sort());
  for (const { options } of h.listening) assert.deepEqual(options, { capture: true, passive: true });
  ready(h);
  assert.equal(warmOne(h), "conditions");
  h.idle();
  assert.equal(h.warm(), "alert");
  assert.equal(h.warmed(), "conditions");
  h.warmup.dispose();
  assert.equal(h.warm(), null);
  // The measurement marker (`data-pi-warmed`) goes too: a scheduler recreated for another host set starts cold,
  // and the root must not claim warm hosts it hasn't warmed.
  assert.equal(h.warmed(), null, "data-pi-warmed removed");
  assert.equal(h.pendingIdle() + h.pendingFrames() + h.pendingTimers(), 0);
  assert.equal(h.listening.length, 0, "every listener removed");
  h.warmup.contentChanged("ai");
  h.warmup.setAtRest(false);
  h.warmup.setAtRest(true);
  h.advance(WARM_QUIET_MS);
  assert.equal(h.pendingIdle() + h.pendingTimers(), 0, "disposed: nothing more");
});

/**
 * A stand-in style warm-up step (ui/styleWarmup.js createStyleWarmup's shape): it
 * counts its runs, runs or refuses as told, and calls `done` when it runs.
 *
 * @param {object} [o] - Options.
 * @param {boolean} [o.blocked] - Whether it refuses (a blocker in the way).
 * @returns {object} the step, with its counters
 */
const styleStep = ({ blocked = false } = {}) => {
  const step = {
    state: "alert",
    token: "style",
    blocked,
    runs: 0,
    ran: 0,
    run(done) {
      step.runs += 1;
      if (step.blocked) return { ran: false, why: "not in MID" };
      step.ran += 1;
      done();
      return { ran: true };
    },
  };
  return step;
};

test("sheetWarmup: style warm-up — once the alert host is warm, the style step in its own idle callback under the same gates, once; data-pi-warmed then ends with « style »", () => {
  const warmStep = styleStep();
  const h = harness({ styleWarmup: warmStep });
  ready(h);
  assert.equal(warmOne(h), "conditions");
  assert.equal(warmOne(h), "alert");
  assert.equal(warmStep.runs, 0, "not before the hosts' warm frames are done");
  assert.equal(warmOne(h), "ai");
  assert.equal(warmOne(h), "max");
  assert.equal(h.warmed(), "conditions alert ai max");
  assert.equal(h.pendingIdle(), 1, "the style step asks for its own idle callback");
  assert.equal(warmStep.runs, 0);
  h.idle();
  assert.equal(warmStep.ran, 1);
  assert.equal(h.warm(), null, "no warm frame: one synchronous task");
  assert.equal(h.pendingFrames(), 0);
  assert.equal(h.warmed(), "conditions alert ai max style", "the token added, the hosts' states kept");
  assert.equal(h.pendingIdle() + h.pendingFrames() + h.pendingTimers(), 0, "done: nothing pending");
  // Once per scheduler: inputs, the rest's end and return ask for nothing more.
  h.down();
  h.up();
  h.warmup.setAtRest(false);
  h.warmup.setAtRest(true);
  h.advance(10 * WARM_QUIET_MS);
  assert.equal(h.pendingIdle(), 0);
  assert.equal(warmStep.runs, 1);
});

test("sheetWarmup: style warm-up — a pointer down, the quiet second and the rest gate it like a host; an input cancels its pending idle callback", () => {
  const warmStep = styleStep();
  const h = harness({ styleWarmup: warmStep });
  ready(h);
  while (h.warmed() !== "conditions alert ai max") warmOne(h);
  assert.equal(h.pendingIdle(), 1);
  h.down();
  assert.equal(h.pendingIdle(), 0, "the pointerdown cancels it");
  h.advance(10 * WARM_QUIET_MS);
  assert.equal(h.pendingIdle(), 0, "nothing while the finger is down");
  h.up();
  h.advance(WARM_QUIET_MS - 1);
  assert.equal(h.pendingIdle(), 0, "not before a quiet second");
  h.advance(1);
  assert.equal(h.pendingIdle(), 1);
  h.warmup.setAtRest(false);
  assert.equal(h.pendingIdle(), 0, "leaving the rest cancels it");
  h.warmup.setAtRest(true);
  h.advance(WARM_QUIET_MS);
  h.idle();
  assert.equal(warmStep.ran, 1);
});

test("sheetWarmup: style warm-up — a step that finds something in the way runs nothing, adds no token, and runs at the scheduler's next turn", () => {
  const warmStep = styleStep({ blocked: true });
  const h = harness({ styleWarmup: warmStep });
  ready(h);
  while (h.warmed() !== "conditions alert ai max") warmOne(h);
  h.idle();
  assert.equal(warmStep.runs, 1);
  assert.equal(warmStep.ran, 0);
  assert.equal(h.warmed(), "conditions alert ai max", "no token");
  assert.equal(h.pendingIdle() + h.pendingTimers(), 0, "no retry loop: it waits for the next turn");
  // The next turn: back to the rest (MIN → MID), then the quiet second.
  warmStep.blocked = false;
  h.warmup.setAtRest(false);
  h.warmup.setAtRest(true);
  h.advance(WARM_QUIET_MS);
  h.idle();
  assert.equal(warmStep.ran, 1);
  assert.equal(h.warmed(), "conditions alert ai max style");
});

/**
 * A stand-in element for the real style warm-up step: attributes in a Map,
 * every write logged on a shared journal, children for `contains` and for
 * the stand-in shield's removal (the same as test/styleWarmup.test.js's).
 *
 * @param {string} name - Its name in the journal.
 * @param {object} journal - The shared journal ({ log: string[] }).
 * @param {object} [attrs] - Its attributes at the start.
 * @returns {object} the element
 */
const element = (name, journal, attrs = {}) => {
  const map = new Map(Object.entries(attrs));
  const el = {
    name,
    children: [],
    parent: null,
    className: "",
    firstElementChild: null,
    getAttribute: (k) => (map.has(k) ? map.get(k) : null),
    hasAttribute: (k) => map.has(k),
    setAttribute: (k, v) => {
      map.set(k, String(v));
      journal.log.push(`${name} @${k}=${v}`);
    },
    removeAttribute: (k) => {
      map.delete(k);
      journal.log.push(`${name} -${k}`);
    },
    attrs: () => Object.fromEntries(map),
    contains: (other) => other === el || el.children.includes(other),
    insertBefore: (child, ref) => {
      const i = el.children.indexOf(ref);
      el.children.splice(i < 0 ? el.children.length : i, 0, child);
      child.parent = el;
      journal.log.push(`${name} +child ${child.name}${ref ? ` before ${ref.name}` : ""}`);
    },
    remove: () => {
      const p = el.parent;
      if (!p) return;
      p.children.splice(p.children.indexOf(el), 1);
      el.parent = null;
      journal.log.push(`${p.name} -child ${name}`);
    },
  };
  return el;
};

/**
 * The scheduler driving the real style warm-up step (ui/styleWarmup.js
 * createStyleWarmup), its elements read when it runs, as useHostWarmup
 * reads them: the scheduler's own root and alert host, and stand-ins for
 * the rail frame (a button inside), the sheet, the dock cell, the dock
 * band's shield (a child of the root) and its guard, the map's view chrome
 * and the zoom bar. The document's fonts are loaded and its focus is the
 * test's to move; each run of the step records what it found in the way
 * ("ran" when nothing was), each user-timing mark is recorded.
 *
 * @param {string} state - The root's `data-pi-state` at mount.
 * @returns {object} the harness (h), the step's runs, its marks, the document, the rail's button and the dock band's shield
 */
const realStyleWarmup = (state) => {
  const journal = { log: [] };
  const railButton = element("railButton", journal);
  const rail = element("rail", journal);
  rail.children.push(railButton);
  railButton.parent = rail;
  const sheet = element("sheet", journal, { inert: "" });
  const dockCell = element("dockCell", journal);
  const dockShield = element("dockShield", journal, { "data-active": "false" });
  const dockGuard = element("dockGuard", journal, { "data-active": "false" });
  const viewChrome = [element("focusBtn", journal)];
  const zoomBar = element("zoomBar", journal);
  const doc = {
    fonts: { status: "loaded" },
    activeElement: null,
    createElement: (tag) => element(`stand-in ${tag}`, journal),
  };
  const runs = [];
  const marks = [];
  let h = null;
  const step = createStyleWarmup({
    elements: () => ({
      root: h.root,
      rail,
      sheet,
      dockCell,
      dockShield,
      dockGuard,
      alertHost: h.elements.alert,
      viewChrome,
      zoomBar,
      shieldClassName: "shield",
    }),
    doc,
    view: { getComputedStyle: () => ({ getPropertyValue: () => "visible" }) },
    mark: (name) => marks.push(name),
  });
  const { run } = step;
  step.run = (done) => {
    const result = run(done);
    runs.push(result.ran ? "ran" : result.why);
    return result;
  };
  h = harness({ styleWarmup: step });
  h.root.children.push(dockShield);
  dockShield.parent = h.root;
  h.root.setAttribute("data-pi-state", state);
  return { h, runs, marks, doc, railButton, dockShield };
};

/**
 * LayoutPi's rest under the overlay shell, as its source writes it (pinned
 * in the next test), for useHostWarmup's `atRest`: the chrome in MID or MIN
 * (`atMid || focused`, of `shownState`, the chrome state — the switch's
 * target, no plan waiting a frame for the chrome) and the last switch
 * settled (useShellTiming's `settled`, `settledId === id`); the overlay
 * shell on and the weather data in.
 *
 * @param {object} sw - The switch record (initialShellSwitch / nextShellSwitch).
 * @param {number} settledId - The id of the last switch whose motion has ended (useShellTiming's `settledId`).
 * @returns {boolean} what LayoutPi hands useHostWarmup as `atRest`
 */
const layoutPiAtRest = (sw, settledId) => {
  assert.equal(sw.plan.chromeWait, null, "the chrome shows the switch's target at once");
  const shownState = sw.to;
  const focused = shownState === "min";
  const atMid = shownState === "mid";
  return (atMid || focused) && settledId === sw.id;
};

test("sheetWarmup: style warm-up's wiring — LayoutPi's rest as these tests compute it, pinned in its source and useShellTiming's", () => {
  // The useHostWarmup call (`(atMid || focused) && shell.settled`) and `shownState` (the chrome state) are pinned in
  // test/piShellGeometry.test.js; here the terms they read.
  assert.match(LAYOUT_PI_JS, /const focused = shownState === "min";/);
  assert.match(LAYOUT_PI_JS, /const atMid = shownState === "mid";/);
  assert.match(SHELL_TIMING_JS, /const settled = settledId === id;/);
  assert.match(SHELL_TIMING_JS, /const chromeState = active && plan\.chromeWait === "frame" && frameWaiting \? from : state;/);
  assert.match(SHELL_TIMING_JS, /return \{\s*chromeState,\s*mapState,\s*shield,\s*settled,/);
  // A switch numbers after the last one; at mount none has run (id 0, settled).
  const mount = initialShellSwitch("min", SHELL_MODES.animated);
  assert.equal(layoutPiAtRest(mount, 0), true, "MIN at mount: at rest");
  const back = nextShellSwitch(mount, "mid", SHELL_MODES.animated);
  assert.equal(layoutPiAtRest(back, 0), false, "MIN → MID, its motion under way: not at rest");
  assert.equal(layoutPiAtRest(back, back.id), true, "MIN → MID settled: at rest in MID");
  assert.equal(layoutPiAtRest(nextShellSwitch(back, "alert", SHELL_MODES.animated), back.id + 1), false, "a view open, settled: not at rest");
});

test("sheetWarmup: style warm-up's wiring — the real step refused in MIN leaves nothing pending; the mini-banner's tap back to MID leaves the rest for the switch; the return to rest in MID is the next turn, where it runs", () => {
  let sw = initialShellSwitch("min", SHELL_MODES.animated);
  let settledId = 0;
  const { h, runs, marks, dockShield } = realStyleWarmup("min");
  // useHostWarmup's layout effect tells the scheduler LayoutPi's rest at each commit.
  const commit = () => h.warmup.setAtRest(layoutPiAtRest(sw, settledId));
  commit();
  h.warmup.setLoaded(true);
  h.advance(WARM_QUIET_MS);
  for (const state of ["conditions", "alert", "ai", "max"]) assert.equal(warmOne(h), state, "the hosts warm in MIN too");
  assert.equal(h.pendingIdle(), 1, "the style step asks for its idle callback");
  h.idle();
  assert.deepEqual(runs, ["not in MID"]);
  assert.deepEqual(marks, [], "refused: no task, no mark");
  assert.equal(h.warmed(), "conditions alert ai max", "no token");
  assert.equal(h.pendingIdle() + h.pendingFrames() + h.pendingTimers(), 0, "nothing left pending: it waits for the next turn");
  // The floating mini-banner's tap: its pointerdown and pointerup are inputs (a turn, the quiet second restarted) ...
  h.down(1, "touch");
  assert.equal(h.pendingIdle() + h.pendingTimers(), 0, "nothing while the finger is down");
  h.up(1, "touch");
  assert.equal(h.pendingTimers(), 1, "the quiet second after the release");
  // ... and its click switches to MID: the switch's commit writes the chrome state and the motion, and leaves the rest.
  sw = nextShellSwitch(sw, "mid", SHELL_MODES.animated);
  h.root.setAttribute("data-pi-state", sw.to);
  h.root.setAttribute(MOVING_ATTRIBUTE, "true");
  commit();
  assert.equal(h.pendingIdle() + h.pendingFrames() + h.pendingTimers(), 0, "the switch's commit cancels the quiet second");
  h.advance(10 * WARM_QUIET_MS);
  assert.equal(h.pendingIdle(), 0, "nothing during the motion");
  assert.deepEqual(runs, ["not in MID"]);
  // The motion over: data-pi-moving off, then the settled render, at rest in MID — the scheduler's next turn.
  h.root.removeAttribute(MOVING_ATTRIBUTE);
  settledId = sw.id;
  commit();
  h.advance(WARM_QUIET_MS - 1);
  assert.equal(h.pendingIdle(), 0, "not before a quiet second after the rest's start");
  h.advance(1);
  assert.equal(h.pendingIdle(), 1);
  h.idle();
  assert.deepEqual(runs, ["not in MID", "ran"]);
  assert.deepEqual(marks, [STYLE_WARM_START_MARK, STYLE_WARM_END_MARK]);
  assert.equal(h.warmed(), "conditions alert ai max style");
  assert.equal(h.pendingIdle() + h.pendingFrames() + h.pendingTimers(), 0, "done: nothing pending");
  // Everything put back: the root in MID, no motion, the stand-in shield gone.
  assert.equal(h.root.getAttribute("data-pi-state"), "mid");
  assert.equal(h.root.hasAttribute(MOVING_ATTRIBUTE), false);
  assert.equal(h.root.hasAttribute("data-pi-switch"), false);
  assert.deepEqual(h.root.children, [dockShield]);
});

test("sheetWarmup: style warm-up's wiring — the real step refused while the focus is in the rail, again after an input that leaves it there, nothing pending each time; it runs at the first turn after the focus has left", () => {
  const sw = initialShellSwitch("mid", SHELL_MODES.animated);
  const { h, runs, marks, doc, railButton } = realStyleWarmup("mid");
  const focusInRail = "the focus is in what the opening makes inert";
  doc.activeElement = railButton;
  h.warmup.setAtRest(layoutPiAtRest(sw, 0));
  h.warmup.setLoaded(true);
  h.advance(WARM_QUIET_MS);
  for (const state of ["conditions", "alert", "ai", "max"]) assert.equal(warmOne(h), state);
  assert.equal(h.pendingIdle(), 1);
  h.idle();
  assert.deepEqual(runs, [focusInRail]);
  assert.deepEqual(marks, []);
  assert.equal(h.warmed(), "conditions alert ai max");
  assert.equal(h.pendingIdle() + h.pendingFrames() + h.pendingTimers(), 0, "nothing left pending");
  // An input that leaves the focus in the rail (a key): a turn, the step again a quiet second later, refused again.
  h.key();
  assert.equal(h.pendingTimers(), 1);
  h.advance(WARM_QUIET_MS);
  assert.equal(h.pendingIdle(), 1);
  h.idle();
  assert.deepEqual(runs, [focusInRail, focusInRail]);
  assert.deepEqual(marks, []);
  assert.equal(h.pendingIdle() + h.pendingFrames() + h.pendingTimers(), 0, "nothing left pending");
  // The focus leaving on its own (an element's blur) is no turn ...
  doc.activeElement = null;
  h.elementBlur();
  h.advance(10 * WARM_QUIET_MS);
  assert.equal(h.pendingIdle() + h.pendingFrames() + h.pendingTimers(), 0, "an element's blur asks for nothing");
  assert.equal(runs.length, 2);
  // ... the next input is: a tap elsewhere, the quiet second, then the step runs.
  h.down(1, "touch");
  h.up(1, "touch");
  h.advance(WARM_QUIET_MS);
  assert.equal(h.pendingIdle(), 1);
  h.idle();
  assert.deepEqual(runs, [focusInRail, focusInRail, "ran"]);
  assert.deepEqual(marks, [STYLE_WARM_START_MARK, STYLE_WARM_END_MARK]);
  assert.equal(h.warmed(), "conditions alert ai max style");
  assert.equal(h.pendingIdle() + h.pendingFrames() + h.pendingTimers(), 0, "done: nothing pending");
});

test("sheetWarmup: style warm-up — content mounting at the alert host's top drops the token; the host is warmed again first, then the style step runs again", () => {
  const warmStep = styleStep();
  const h = harness({ styleWarmup: warmStep });
  ready(h);
  while (h.pendingIdle()) {
    h.idle();
    if (h.pendingFrames()) h.frame();
  }
  assert.equal(h.warmed(), "conditions alert ai max style");
  assert.equal(warmStep.ran, 1);
  h.warmup.contentChanged("alert");
  assert.equal(h.warmed(), "conditions ai max", "the alert host and the token both dropped");
  assert.equal(warmOne(h), "alert", "the host first");
  assert.equal(warmStep.ran, 1);
  h.idle();
  assert.equal(warmStep.ran, 2, "then the style step");
  assert.equal(h.warmed(), "conditions alert ai max style");
  // Another host's content leaves the style step alone.
  h.warmup.contentChanged("ai");
  assert.equal(h.warmed(), "conditions alert max style");
  assert.equal(warmOne(h), "ai");
  assert.equal(h.pendingIdle(), 0);
  assert.equal(warmStep.ran, 2);
  // No alert mounted: neither its host nor the style step.
  h.elements.alert.firstElementChild = null;
  h.warmup.contentChanged("alert");
  assert.equal(h.pendingIdle(), 0);
  assert.equal(h.warmed(), "conditions ai max");
});

test("sheetWarmup: style warm-up — dispose() takes the token off with data-pi-warmed; without a style step the scheduler is as before", () => {
  const warmStep = styleStep();
  const h = harness({ styleWarmup: warmStep });
  ready(h);
  while (h.pendingIdle()) {
    h.idle();
    if (h.pendingFrames()) h.frame();
  }
  assert.equal(h.warmed(), "conditions alert ai max style");
  h.warmup.dispose();
  assert.equal(h.warmed(), null);
  const plain = harness();
  ready(plain);
  while (plain.pendingIdle()) {
    plain.idle();
    if (plain.pendingFrames()) plain.frame();
  }
  assert.equal(plain.warmed(), "conditions alert ai max", "no token without the step");
});

/**
 * Warms the four hosts, in order, one full step each — bounded: a scheduler that stops warming them fails here
 * instead of looping forever.
 *
 * @param {object} h - the harness
 * @returns {void}
 */
const warmAll = (h) => {
  assert.deepEqual(["conditions", "alert", "ai", "max"].map(() => warmOne(h)), ["conditions", "alert", "ai", "max"], "the four hosts, in order");
  assert.equal(h.warmed(), "conditions alert ai max");
};

/**
 * A stand-in gated style step: styleStep's, with a gate the test opens and shuts. `whenOpen` keeps its callback (one wait at a
 * time is the scheduler's to keep) and counts the waits and the cancels; openGate() opens the gate and calls back.
 *
 * @param {object} [o] - Options.
 * @param {boolean} [o.open] - Whether the gate starts open.
 * @returns {object} the step, with its gate's counters (g) and openGate()
 */
const gatedStep = ({ open = false } = {}) => {
  const step = styleStep();
  const g = { isOpen: open, asks: 0, waits: 0, cancels: 0, cb: null };
  step.gate = {
    open: () => {
      g.asks += 1;
      return g.isOpen;
    },
    whenOpen: (cb) => {
      g.waits += 1;
      g.cb = cb;
      return () => {
        g.cancels += 1;
        g.cb = null;
      };
    },
  };
  step.g = g;
  step.openGate = () => {
    g.isOpen = true;
    const { cb } = g;
    g.cb = null;
    if (cb) cb();
  };
  return step;
};

test("sheetWarmup: style warm-up's gate — its gate shut, the hosts warm as before and nothing is asked for the style step, no token; one wait on the gate; once open, an idle callback at once (no new quiet second), then the style step and « style »", () => {
  const warmStep = gatedStep();
  const h = harness({ styleWarmup: warmStep });
  ready(h);
  warmAll(h);
  assert.equal(h.pendingIdle() + h.pendingTimers() + h.pendingFrames(), 0, "nothing asked while the gate is shut");
  assert.equal(warmStep.g.waits, 1, "one wait on the gate");
  assert.equal(warmStep.runs, 0);
  assert.equal(h.warmed(), "conditions alert ai max", "no token");
  h.advance(10 * WARM_QUIET_MS);
  assert.equal(warmStep.g.waits, 1, "time passing asks for no other wait");
  assert.equal(warmStep.runs, 0);
  warmStep.openGate();
  assert.equal(h.pendingTimers(), 0, "no new quiet second");
  assert.equal(h.pendingIdle(), 1, "an idle callback at once");
  h.idle();
  assert.equal(warmStep.ran, 1);
  assert.equal(h.warmed(), "conditions alert ai max style");
  assert.equal(h.pendingIdle() + h.pendingTimers() + h.pendingFrames(), 0, "done: nothing pending");
  assert.equal(warmStep.g.cancels, 0);
});

test("sheetWarmup: style warm-up's gate — the gate read again at the idle callback: shut by then, nothing runs and the wait resumes; open again, the style step runs", () => {
  const warmStep = gatedStep({ open: true });
  const h = harness({ styleWarmup: warmStep });
  ready(h);
  warmAll(h);
  assert.equal(h.pendingIdle(), 1, "the gate open at the turn: the style step's idle callback asked");
  assert.equal(warmStep.g.waits, 0);
  warmStep.g.isOpen = false;
  h.idle();
  assert.equal(warmStep.runs, 0, "shut at the idle callback: nothing runs");
  assert.equal(warmStep.g.waits, 1, "the wait resumes");
  assert.equal(h.pendingIdle() + h.pendingTimers(), 0);
  warmStep.openGate();
  assert.equal(h.pendingIdle(), 1);
  h.idle();
  assert.equal(warmStep.ran, 1);
  assert.equal(h.warmed(), "conditions alert ai max style");
});

test("sheetWarmup: style warm-up's gate — an input while it waits keeps one wait; the gate opening then waits for the quiet second after that input, its other gates unchanged", () => {
  const warmStep = gatedStep();
  const h = harness({ styleWarmup: warmStep });
  ready(h);
  warmAll(h);
  assert.equal(warmStep.g.waits, 1);
  h.down();
  assert.equal(warmStep.g.waits, 1, "still one wait");
  warmStep.openGate();
  assert.equal(h.pendingIdle() + h.pendingTimers(), 0, "a finger down: nothing yet");
  h.up();
  assert.equal(h.pendingIdle(), 0, "not before a quiet second");
  assert.equal(h.pendingTimers(), 1);
  h.advance(WARM_QUIET_MS - 1);
  assert.equal(h.pendingIdle(), 0);
  h.advance(1);
  assert.equal(h.pendingIdle(), 1);
  h.idle();
  assert.equal(warmStep.ran, 1);
  assert.equal(warmStep.g.waits, 1);
});

test("sheetWarmup: style warm-up's gate — content mounting at the alert host's top while it waits: the host is warmed again first, the same wait kept, then the style step once the gate opens", () => {
  const warmStep = gatedStep();
  const h = harness({ styleWarmup: warmStep });
  ready(h);
  warmAll(h);
  assert.equal(warmStep.g.waits, 1);
  h.warmup.contentChanged("alert");
  assert.equal(warmOne(h), "alert", "the host first");
  assert.equal(warmStep.g.waits, 1, "the pending wait kept, none added");
  assert.equal(h.pendingIdle(), 0);
  warmStep.openGate();
  h.idle();
  assert.equal(warmStep.ran, 1);
  assert.equal(h.warmed(), "conditions alert ai max style");
});

test("sheetWarmup: style warm-up's gate — dispose() cancels the wait; its callback, should it still come, asks for nothing", () => {
  const warmStep = gatedStep();
  const h = harness({ styleWarmup: warmStep });
  ready(h);
  warmAll(h);
  const { cb } = warmStep.g;
  assert.equal(typeof cb, "function");
  h.warmup.dispose();
  assert.equal(warmStep.g.cancels, 1, "the wait cancelled");
  warmStep.g.isOpen = true;
  cb();
  assert.equal(h.pendingIdle() + h.pendingTimers() + h.pendingFrames(), 0, "disposed: nothing asked");
  assert.equal(warmStep.runs, 0);
});

test("sheetWarmup: style warm-up's gate — the gate is read only when the style step is wanted: never while a host is due, never once the style step has run", () => {
  const warmStep = gatedStep({ open: true });
  const h = harness({ styleWarmup: warmStep });
  ready(h);
  warmOne(h);
  warmOne(h);
  assert.equal(warmStep.g.asks, 0, "a host still due: the turn warms it and never reads the style step's gate (the alert's host already warm)");
  warmOne(h);
  warmOne(h);
  assert.ok(warmStep.g.asks > 0, "the style step wanted: its gate read");
  h.idle();
  assert.equal(warmStep.ran, 1);
  const asked = warmStep.g.asks;
  h.down();
  h.up();
  h.advance(10 * WARM_QUIET_MS);
  assert.equal(warmStep.g.asks, asked, "run: the gate not read again");
  assert.equal(warmStep.g.waits, 0, "nor waited for");
});

test("sheetWarmup: style warm-up's gate — the style step not wanted (no alert mounted, or run already): no wait on the gate, nothing asked", () => {
  const warmStep = gatedStep();
  const h = harness({ styleWarmup: warmStep, empty: ["alert"] });
  ready(h);
  assert.equal(warmOne(h), "conditions");
  assert.equal(warmOne(h), "ai", "the empty alert host skipped");
  assert.equal(warmOne(h), "max");
  assert.equal(h.pendingIdle() + h.pendingTimers(), 0);
  assert.equal(warmStep.g.waits, 0, "no alert host warm: the style step not wanted, no wait");
  assert.equal(warmStep.g.asks, 0);
  h.down();
  h.up();
  h.advance(10 * WARM_QUIET_MS);
  assert.equal(warmStep.g.waits, 0);
});

test("sheetWarmup: style warm-up's gate — a wait that fired, the gate shut again at the idle callback: a second wait is posted (none left stale), then the style step runs", () => {
  const warmStep = gatedStep();
  const h = harness({ styleWarmup: warmStep });
  ready(h);
  warmAll(h);
  assert.equal(warmStep.g.waits, 1);
  warmStep.openGate();
  assert.equal(h.pendingIdle(), 1);
  warmStep.g.isOpen = false;
  h.idle();
  assert.equal(warmStep.runs, 0, "shut again at the idle callback: nothing runs");
  assert.equal(warmStep.g.waits, 2, "a second wait posted: the first one's canceller was dropped when it fired");
  warmStep.openGate();
  assert.equal(h.pendingIdle(), 1);
  h.idle();
  assert.equal(warmStep.ran, 1);
  assert.equal(h.warmed(), "conditions alert ai max style");
});

