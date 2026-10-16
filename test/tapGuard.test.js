// Tests for the double-tap guard in `client/src/ui/tapGuard.js` (Document 9,
// point 6): after a command that changes what sits under the finger (the
// alert card's ⤢ opening the Alert view), a second tap inside a 60 × 58 px
// box centred on the first is swallowed for 300 ms — every event of it —
// while the first tap is never touched and everything else passes. The
// module is CommonJS so these tests exercise the real code, the DOM side
// included (Node's EventTarget). Run: `npm test`.
//
// Time origin in every case: the arming click (the first tap's click, i.e.
// its release). "+120 ms" is the second tap's PRESS 120 ms after that click.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  TAP_GUARD_WINDOW_MS,
  TAP_GUARD_BOX_WIDTH,
  TAP_GUARD_BOX_HEIGHT,
  TAP_GUARD_RELEASE_TAIL_MS,
  TAP_GUARD_MAX_LIFETIME_MS,
  TAP_GUARD_EVENT_TYPES,
  guardBox,
  inGuardBox,
  inGuardWindow,
  eventTime,
  armTapGuard,
  stepTapGuard,
  tapGuardRetireAt,
  createTapGuard,
} = require("../client/src/ui/tapGuard");

// The first tap: its click at (400, 100), time 1000 ms.
const X0 = 400;
const Y0 = 100;
const T0 = 1000;
const armed = () => armTapGuard({ clientX: X0, clientY: Y0, t: T0, detail: 1 });

// A whole touch tap as the browser dispatches it (Chrome: pointer events,
// then touch events, then — from the gesture — the compatibility mouse
// events and the click), pressed at `t`, released `holdMs` later.
const tapEvents = (t, x, y, holdMs = 50) => [
  { type: "pointerdown", t, x, y, isPrimary: true },
  { type: "touchstart", t, x, y },
  { type: "pointerup", t: t + holdMs, x, y, isPrimary: true },
  { type: "touchend", t: t + holdMs, x, y },
  { type: "mousedown", t: t + holdMs, x, y },
  { type: "mouseup", t: t + holdMs, x, y },
  { type: "click", t: t + holdMs, x, y },
];

// Runs events through the pure guard; returns each verdict and the end state.
const run = (state, events) => {
  let s = state;
  const verdicts = events.map((ev) => {
    const step = stepTapGuard(s, ev);
    s = step.state;
    return { type: ev.type, swallow: step.swallow };
  });
  return { state: s, verdicts };
};
const allSwallowed = (verdicts) => verdicts.every((v) => v.swallow);
const nonePassed = allSwallowed;
const allPassed = (verdicts) => verdicts.every((v) => !v.swallow);

test("constants: the designer's figures (300 ms, 60 × 58 px) and the guarded event types", () => {
  assert.equal(TAP_GUARD_WINDOW_MS, 300);
  assert.equal(TAP_GUARD_BOX_WIDTH, 60);
  assert.equal(TAP_GUARD_BOX_HEIGHT, 58);
  for (const type of ["pointerdown", "pointerup", "touchstart", "touchend", "mousedown", "mouseup", "click"]) {
    assert.ok(TAP_GUARD_EVENT_TYPES.includes(type), `${type} must be guarded`);
  }
  // Hover and move events are never swallowed (a mouse's hover would be lost).
  for (const type of ["pointermove", "mousemove", "pointerover", "mouseover", "touchmove"]) {
    assert.ok(!TAP_GUARD_EVENT_TYPES.includes(type), `${type} must not be guarded`);
  }
  assert.ok(Object.isFrozen(TAP_GUARD_EVENT_TYPES));
});

test("second tap at +120, +170, +200 and +240 ms inside the box: every event of it is swallowed", () => {
  for (const dt of [120, 170, 200, 240]) {
    const { verdicts } = run(armed(), tapEvents(T0 + dt, X0 + 4, Y0 - 3));
    assert.ok(nonePassed(verdicts), `+${dt} ms: ${JSON.stringify(verdicts)}`);
  }
});

test("a tap pressed inside the window stays swallowed whole when its release and click come after it", () => {
  // Pressed at +240 ms, held 90 ms: release, compatibility events and click at +330 ms.
  const { verdicts } = run(armed(), [...tapEvents(T0 + 240, X0, Y0, 90), { type: "dblclick", t: T0 + 331, x: X0, y: Y0 }]);
  assert.ok(allSwallowed(verdicts), JSON.stringify(verdicts));
});

test("second tap at +320 ms, or at exactly +300 ms, passes; +299.9 ms is still swallowed", () => {
  assert.ok(allPassed(run(armed(), tapEvents(T0 + 320, X0, Y0)).verdicts));
  assert.ok(allPassed(run(armed(), tapEvents(T0 + 300, X0, Y0)).verdicts), "window end is excluded");
  assert.ok(allSwallowed(run(armed(), tapEvents(T0 + 299.9, X0, Y0)).verdicts));
});

test("second tap outside the box passes, inside the window", () => {
  for (const [dx, dy] of [[31, 0], [-31, 0], [0, 30], [0, -30], [100, 0], [0, 200]]) {
    const { verdicts } = run(armed(), tapEvents(T0 + 150, X0 + dx, Y0 + dy));
    assert.ok(allPassed(verdicts), `offset (${dx}, ${dy}): ${JSON.stringify(verdicts)}`);
  }
});

test("box edges are INCLUDED: ±30 px across, ±29 px up and down (corners too); 0.01 px beyond is out", () => {
  const box = guardBox(X0, Y0);
  assert.deepEqual({ ...box }, { left: 370, top: 71, right: 430, bottom: 129 });
  assert.equal(box.right - box.left, 60);
  assert.equal(box.bottom - box.top, 58);
  // On the edges and corners: in.
  for (const [dx, dy] of [[30, 0], [-30, 0], [0, 29], [0, -29], [30, 29], [-30, -29], [30, -29], [-30, 29]]) {
    assert.ok(inGuardBox(box, X0 + dx, Y0 + dy), `edge (${dx}, ${dy}) must be in`);
    assert.ok(allSwallowed(run(armed(), tapEvents(T0 + 150, X0 + dx, Y0 + dy)).verdicts), `edge tap (${dx}, ${dy})`);
  }
  // Just beyond: out.
  for (const [dx, dy] of [[30.01, 0], [-30.01, 0], [0, 29.01], [0, -29.01]]) {
    assert.ok(!inGuardBox(box, X0 + dx, Y0 + dy), `(${dx}, ${dy}) must be out`);
    assert.ok(allPassed(run(armed(), tapEvents(T0 + 150, X0 + dx, Y0 + dy)).verdicts), `beyond tap (${dx}, ${dy})`);
  }
  // A missing coordinate is out (fail open: never swallow what can't be placed).
  assert.ok(!inGuardBox(box, undefined, Y0));
  assert.ok(!inGuardBox(box, X0, Number.NaN));
});

test("window start is INCLUDED, end EXCLUDED; a press dated before the arming click is out", () => {
  assert.ok(inGuardWindow(T0, T0));
  assert.ok(inGuardWindow(T0, T0 + 299.99));
  assert.ok(!inGuardWindow(T0, T0 + 300));
  assert.ok(!inGuardWindow(T0, T0 - 0.01));
});

test("the first tap is never touched: events before the next press, and a press dated before the click, pass", () => {
  // Leftovers of the first tap reaching the guard after its click (none are
  // expected, but if any do): no gesture has started, so they pass.
  const leftovers = ["pointerup", "touchend", "mouseup", "click", "dblclick"].map((type) => ({ type, t: T0, x: X0, y: Y0, isPrimary: true }));
  assert.ok(allPassed(run(armed(), leftovers).verdicts));
  // The first tap itself, replayed through an armed guard (its press is
  // dated before the click that armed it): passes whole.
  assert.ok(allPassed(run(armed(), tapEvents(T0 - 50, X0, Y0)).verdicts));
});

test("one gesture, one decision: a press outside the box whose release drifts into it passes whole", () => {
  const events = [
    { type: "pointerdown", t: T0 + 150, x: X0 + 40, y: Y0, isPrimary: true },
    { type: "touchstart", t: T0 + 150, x: X0 + 40, y: Y0 },
    { type: "pointerup", t: T0 + 200, x: X0 + 10, y: Y0, isPrimary: true },
    { type: "touchend", t: T0 + 200, x: X0 + 10, y: Y0 },
    { type: "click", t: T0 + 200, x: X0 + 10, y: Y0 },
  ];
  assert.ok(allPassed(run(armed(), events).verdicts));
});

test("a third tap after the window passes, even right after a swallowed second tap", () => {
  const events = [...tapEvents(T0 + 150, X0, Y0), ...tapEvents(T0 + 320, X0, Y0)];
  const { verdicts } = run(armed(), events);
  assert.ok(allSwallowed(verdicts.slice(0, 7)));
  assert.ok(allPassed(verdicts.slice(7)));
});

test("a second finger follows the gesture in progress; mouse double click is guarded like a touch double tap", () => {
  let s = armed();
  ({ state: s } = stepTapGuard(s, { type: "pointerdown", t: T0 + 100, x: X0, y: Y0, isPrimary: true }));
  // Second finger far away, inside the window: follows the swallowed gesture.
  const second = stepTapGuard(s, { type: "pointerdown", t: T0 + 110, x: X0 + 300, y: Y0, isPrimary: false });
  assert.equal(second.swallow, true);
  // Its release doesn't end the primary's press.
  const secondUp = stepTapGuard(second.state, { type: "pointerup", t: T0 + 120, x: X0 + 300, y: Y0, isPrimary: false });
  assert.equal(secondUp.state.gesture.down, true);
  // Desktop mouse: pointerdown prevented (no compatibility mousedown/up), then pointerup, click, dblclick.
  const mouse = [
    { type: "pointerdown", t: T0 + 180, x: X0, y: Y0, isPrimary: true },
    { type: "pointerup", t: T0 + 260, x: X0, y: Y0, isPrimary: true },
    { type: "click", t: T0 + 260, x: X0, y: Y0 },
    { type: "dblclick", t: T0 + 260, x: X0, y: Y0 },
  ];
  assert.ok(allSwallowed(run(armed(), mouse).verdicts));
});

test("arming: a keyboard or programmatic activation (detail 0) or a click without coordinates does not arm", () => {
  assert.equal(armTapGuard({ clientX: X0, clientY: Y0, t: T0, detail: 0 }), null);
  assert.equal(armTapGuard({ clientY: Y0, t: T0, detail: 1 }), null);
  assert.equal(armTapGuard({ clientX: X0, clientY: Y0, detail: 1 }), null);
  assert.equal(armTapGuard(null), null);
  assert.ok(armTapGuard({ clientX: X0, clientY: Y0, t: T0, detail: 2 }));
  // No state: everything passes.
  assert.equal(stepTapGuard(null, { type: "pointerdown", t: T0, x: X0, y: Y0 }).swallow, false);
});

test("event time: the event's timeStamp on the clock's base, else the clock", () => {
  assert.equal(eventTime(1234.5, 1300), 1234.5);
  assert.equal(eventTime(1_760_000_000_000, 1300), 1300, "an epoch timestamp is another base");
  assert.equal(eventTime(0, 1300), 1300);
  assert.equal(eventTime(undefined, 1300), 1300);
  assert.equal(eventTime(Number.NaN, 1300), 1300);
});

test("retire time: window end; a swallowed tap holds it to its release + tail; the hard bound caps it", () => {
  const s = armed();
  assert.equal(tapGuardRetireAt(s), T0 + 300);
  assert.equal(tapGuardRetireAt(null), -Infinity);
  // A passing tap changes nothing.
  assert.equal(tapGuardRetireAt(run(s, tapEvents(T0 + 100, X0 + 200, Y0)).state), T0 + 300);
  // A swallowed tap still down: the hard bound.
  const down = stepTapGuard(s, { type: "pointerdown", t: T0 + 240, x: X0, y: Y0, isPrimary: true }).state;
  assert.equal(tapGuardRetireAt(down), T0 + TAP_GUARD_MAX_LIFETIME_MS);
  // Released at +330: + tail.
  const up = stepTapGuard(down, { type: "pointerup", t: T0 + 330, x: X0, y: Y0, isPrimary: true }).state;
  assert.equal(tapGuardRetireAt(up), T0 + 330 + TAP_GUARD_RELEASE_TAIL_MS);
  // The release handled late (seenAt): the tail starts when it was handled.
  const late = stepTapGuard(down, { type: "pointerup", t: T0 + 330, seenAt: T0 + 500, x: X0, y: Y0, isPrimary: true }).state;
  assert.equal(tapGuardRetireAt(late), T0 + 500 + TAP_GUARD_RELEASE_TAIL_MS);
  // A click handled late: the listeners live from the arm call, the window stays on the click's time.
  const lateArm = armTapGuard({ clientX: X0, clientY: Y0, t: T0, now: T0 + 350, detail: 1 });
  assert.equal(tapGuardRetireAt(lateArm), T0 + 350 + 300);
  assert.ok(allSwallowed(run(lateArm, tapEvents(T0 + 200, X0, Y0)).verdicts), "a queued second tap pressed at +200 ms");
  assert.ok(allPassed(run(lateArm, tapEvents(T0 + 320, X0, Y0)).verdicts));
});

// ------------------------------------------------------------------ DOM side

// A recording EventTarget: counts the guard's listeners and their options.
function makeTarget() {
  const target = new EventTarget();
  const live = new Map();
  const add = target.addEventListener.bind(target);
  const remove = target.removeEventListener.bind(target);
  target.addEventListener = (type, fn, opts) => {
    if (typeof opts === "object" && opts.capture) live.set(type, { fn, opts });
    add(type, fn, opts);
  };
  target.removeEventListener = (type, fn, opts) => {
    if (typeof opts === "object" && opts.capture && live.get(type)?.fn === fn) live.delete(type);
    remove(type, fn, opts);
  };
  return { target, live };
}

// Fake clock + timers.
function makeClock(start = T0) {
  let t = start;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => t,
    setTimer: (fn, ms) => { const id = nextId++; timers.set(id, { fn, at: t + ms }); return id; },
    clearTimer: (id) => { timers.delete(id); },
    pending: () => timers.size,
    advance(ms) {
      const end = t + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        t = due[1].at;
        due[1].fn();
      }
      t = end;
    },
  };
}

// A DOM-like event with the fields the guard reads (Node's Event has no clientX / isPrimary).
function domEvent(type, { t, x, y, detail = 1, isPrimary = true, cancelable = true }) {
  const ev = new Event(type, { cancelable });
  Object.defineProperty(ev, "timeStamp", { value: t });
  Object.defineProperty(ev, "clientX", { value: x });
  Object.defineProperty(ev, "clientY", { value: y });
  Object.defineProperty(ev, "detail", { value: detail });
  Object.defineProperty(ev, "isPrimary", { value: isPrimary });
  return ev;
}

// Dispatches one tap; returns, per event, whether the app (a listener added
// after the guard, as React's root is reached after the document's capture
// phase) saw it and whether its default was prevented.
function dispatchTap(target, clock, t, x, y, holdMs = 50) {
  const seen = [];
  const app = (ev) => seen.push(ev.type);
  for (const type of TAP_GUARD_EVENT_TYPES) target.addEventListener(type, app);
  const results = tapEvents(t, x, y, holdMs).map((e) => {
    if (e.t > clock.now()) clock.advance(e.t - clock.now());
    const ev = domEvent(e.type, { t: e.t, x: e.x, y: e.y, isPrimary: e.isPrimary !== false });
    target.dispatchEvent(ev);
    return { type: e.type, prevented: ev.defaultPrevented };
  });
  for (const type of TAP_GUARD_EVENT_TYPES) target.removeEventListener(type, app);
  return { seen, results };
}

test("DOM: no listener until armed; capture + non-passive listeners on every guarded type once armed", () => {
  const { target, live } = makeTarget();
  const clock = makeClock();
  const guard = createTapGuard(target, clock);
  assert.equal(live.size, 0);
  assert.equal(guard.isArmed(), false);
  assert.equal(guard.arm(domEvent("click", { t: T0, x: X0, y: Y0 })), true);
  assert.equal(live.size, TAP_GUARD_EVENT_TYPES.length);
  for (const { opts } of live.values()) {
    assert.equal(opts.capture, true);
    assert.equal(opts.passive, false, "touchstart on the document is passive unless told otherwise");
  }
  guard.dispose();
});

test("DOM: a second tap at +120 / +170 / +200 / +240 ms in the box never reaches the app and is default-prevented", () => {
  for (const dt of [120, 170, 200, 240]) {
    const { target } = makeTarget();
    const clock = makeClock();
    const guard = createTapGuard(target, clock);
    guard.arm(domEvent("click", { t: T0, x: X0, y: Y0 }));
    const { seen, results } = dispatchTap(target, clock, T0 + dt, X0 + 5, Y0 + 5);
    assert.deepEqual(seen, [], `+${dt} ms`);
    assert.ok(results.every((r) => r.prevented), `+${dt} ms: ${JSON.stringify(results)}`);
    guard.dispose();
  }
});

test("DOM: at +320 ms, or outside the box, the second tap reaches the app untouched", () => {
  for (const [dt, dx] of [[320, 0], [150, 31], [150, -60]]) {
    const { target } = makeTarget();
    const clock = makeClock();
    const guard = createTapGuard(target, clock);
    guard.arm(domEvent("click", { t: T0, x: X0, y: Y0 }));
    const { seen, results } = dispatchTap(target, clock, T0 + dt, X0 + dx, Y0);
    assert.deepEqual(seen, tapEvents(0, 0, 0).map((e) => e.type), `+${dt} ms, dx ${dx}`);
    assert.ok(results.every((r) => !r.prevented));
    guard.dispose();
  }
});

test("DOM: the guard retires on its own — listeners and timer gone after the window", () => {
  const { target, live } = makeTarget();
  const clock = makeClock();
  const guard = createTapGuard(target, clock);
  guard.arm(domEvent("click", { t: T0, x: X0, y: Y0 }));
  assert.equal(clock.pending(), 1);
  clock.advance(299);
  assert.equal(guard.isArmed(), true);
  clock.advance(1);
  assert.equal(guard.isArmed(), false);
  assert.equal(live.size, 0, "no listener left");
  assert.equal(clock.pending(), 0, "no timer left");
});

test("DOM: a swallowed tap held past the window keeps the guard until its release + tail, then it retires", () => {
  const { target, live } = makeTarget();
  const clock = makeClock();
  const guard = createTapGuard(target, clock);
  guard.arm(domEvent("click", { t: T0, x: X0, y: Y0 }));
  clock.advance(240);
  target.dispatchEvent(domEvent("pointerdown", { t: T0 + 240, x: X0, y: Y0 }));
  clock.advance(400); // finger still down at +640
  assert.equal(guard.isArmed(), true);
  target.dispatchEvent(domEvent("pointerup", { t: T0 + 640, x: X0, y: Y0 }));
  const click = domEvent("click", { t: T0 + 641, x: X0, y: Y0 });
  let reached = false;
  const app = () => { reached = true; };
  target.addEventListener("click", app);
  clock.advance(1);
  target.dispatchEvent(click);
  target.removeEventListener("click", app);
  assert.equal(reached, false, "the click of the swallowed tap is swallowed too");
  clock.advance(TAP_GUARD_RELEASE_TAIL_MS);
  assert.equal(guard.isArmed(), false);
  assert.equal(live.size, 0);
  assert.equal(clock.pending(), 0);
});

test("DOM: dispose() (unmount) removes the listeners and clears the timer; re-arming keeps one set of listeners", () => {
  const { target, live } = makeTarget();
  const clock = makeClock();
  const guard = createTapGuard(target, clock);
  guard.arm(domEvent("click", { t: T0, x: X0, y: Y0 }));
  clock.advance(100);
  guard.arm(domEvent("click", { t: T0 + 100, x: X0 + 200, y: Y0 }));
  assert.equal(live.size, TAP_GUARD_EVENT_TYPES.length);
  assert.equal(clock.pending(), 1);
  guard.dispose();
  assert.equal(live.size, 0);
  assert.equal(clock.pending(), 0);
  guard.dispose(); // idempotent
  // A keyboard activation doesn't arm, and adds nothing.
  assert.equal(guard.arm(domEvent("click", { t: T0 + 200, x: 0, y: 0, detail: 0 })), false);
  assert.equal(live.size, 0);
  assert.equal(guard.arm(null), false);
});

test("DOM: the arming click itself is never swallowed (the guard only listens from it on)", () => {
  const { target } = makeTarget();
  const clock = makeClock();
  const guard = createTapGuard(target, clock);
  let reached = 0;
  const app = (ev) => { reached += 1; guard.arm(ev); };
  target.addEventListener("click", app);
  const first = domEvent("click", { t: T0, x: X0, y: Y0 });
  target.dispatchEvent(first);
  assert.equal(reached, 1);
  assert.equal(first.defaultPrevented, false);
  target.removeEventListener("click", app);
  guard.dispose();
});

// ------------------------------------------------------------- where it is posed

const SRC = path.join(__dirname, "..", "client", "src");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");

test("pose: the alert card's ⤢ arms the guard before opening the Alert view, and nothing else in the banner does", () => {
  const banner = read("components/ambient/AlertBanner/index.js");
  assert.match(banner, /import useTapGuard from "~\/hooks\/useTapGuard";/);
  assert.match(banner, /const openAlertView = \(e\) => \{\s*guardTap\(e\);\s*headAction\(\);\s*\};/);
  // The ⤢ (RailSquareButton with ExpandIcon) uses it.
  assert.match(banner, /<RailSquareButton\s+icon=\{ExpandIcon\}\s+onClick=\{openAlertView\}/);
  // Exactly one call site: the head row toggles in place and the counter cycles in place.
  assert.equal((banner.match(/guardTap\(/g) || []).length, 1);
  assert.equal((banner.match(/onClick=\{openAlertView\}/g) || []).length, 1);
  // The hook disposes its guard on unmount.
  const hook = read("hooks/useTapGuard.js");
  assert.match(hook, /return \(\) => \{\s*guard\.dispose\(\);/);
});
