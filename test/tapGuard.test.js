// Tests for the double-tap guard in `client/src/ui/tapGuard.js` (Document 9,
// point 6): after a command that changes what sits under the finger (the
// alert card opening the Alert view), a second tap inside a 60 × 58 px
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
  TAP_GUARD_MAX_GESTURES,
  TAP_GUARD_IN_ORDER_TYPES,
  TAP_GUARD_EVENT_TYPES,
  guardBox,
  inGuardBox,
  inGuardWindow,
  pastGuardWindow,
  eventTime,
  armTapGuard,
  rearmTapGuard,
  stepTapGuard,
  tapGuardAsksBack,
  tapGuardRetireAt,
  SHELL_BACK_SELECTOR,
  isShellBackPress,
  createTapGuard,
  TOUCH_CANCEL_EVENT_TYPES,
  cancelTouches,
  changedTouchIds,
  toggleTouchCancel,
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
// The gesture last pressed (the guard keeps a list of them).
const lastGesture = (state) => state.gestures[state.gestures.length - 1] || null;
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
  // Only presses and releases tell the guard where the input queue stands (a touch tap's click comes late).
  assert.deepEqual([...TAP_GUARD_IN_ORDER_TYPES], ["pointerdown", "pointerup"]);
  assert.ok(Object.isFrozen(TAP_GUARD_IN_ORDER_TYPES));
  assert.equal(TAP_GUARD_MAX_GESTURES, 8);
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
  assert.equal(lastGesture(secondUp.state).down, true);
  assert.equal(secondUp.state.gestures.length, 1, "one gesture: the second finger joined it");
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

test("past the window: at or after its end (+300 ms is after), never before the arming click — the complement of the window from the click on", () => {
  assert.ok(!pastGuardWindow(T0, T0 + 299.99));
  assert.ok(pastGuardWindow(T0, T0 + 300), "the window's end is excluded from it, so it is after");
  assert.ok(pastGuardWindow(T0, T0 + 320));
  assert.ok(!pastGuardWindow(T0, T0 - 50), "the first tap's own events are not after the window");
  assert.ok(!pastGuardWindow(T0, Number.NaN));
  assert.ok(!pastGuardWindow(undefined, T0 + 400));
  for (const dt of [0, 100, 299.9, 300, 301, 5000]) {
    assert.notEqual(inGuardWindow(T0, T0 + dt), pastGuardWindow(T0, T0 + dt), `+${dt} ms`);
  }
});

test("retire time: the safety bound until a press or release dated after the window has been handled; then at once, or a gesture still followed holds it — still down, or awaiting a click that may still be queued: the bound; clicked, or with no click to come: its release or click + tail", () => {
  const s = armed();
  assert.equal(s.overAt, null);
  assert.equal(tapGuardRetireAt(s), T0 + TAP_GUARD_MAX_LIFETIME_MS, "no event yet: a press of the window may still be queued");
  assert.equal(tapGuardRetireAt(null), -Infinity);
  // A passing tap inside the window: still nothing dated after it.
  const passed = run(s, tapEvents(T0 + 100, X0 + 200, Y0)).state;
  assert.equal(passed.overAt, null);
  assert.equal(tapGuardRetireAt(passed), T0 + TAP_GUARD_MAX_LIFETIME_MS);
  // The first press dated after the window (+320), handled at +900: the guard retires then.
  const over = stepTapGuard(passed, { type: "pointerdown", t: T0 + 320, seenAt: T0 + 900, x: X0, y: Y0, isPrimary: true });
  assert.equal(over.swallow, false, "judged as usual: a press after the window passes");
  assert.equal(over.state.overAt, T0 + 900);
  assert.equal(tapGuardRetireAt(over.state), T0 + 900);
  // ... and keeps that time: a later event doesn't move it.
  assert.equal(stepTapGuard(over.state, { type: "pointerdown", t: T0 + 2000, x: X0, y: Y0, isPrimary: true }).state.overAt, T0 + 900);
  // A swallowed tap still down: the bound.
  const down = stepTapGuard(s, { type: "pointerdown", t: T0 + 240, x: X0, y: Y0, isPrimary: true }).state;
  assert.equal(tapGuardRetireAt(down), T0 + TAP_GUARD_MAX_LIFETIME_MS);
  // Released at +330 (the first press or release dated after the window), its click not come yet: it may still be
  // queued (a touch tap's comes after its touchend's ack), so only an event ends the wait — the bound on the clock.
  const up = stepTapGuard(down, { type: "pointerup", t: T0 + 330, x: X0, y: Y0, isPrimary: true }).state;
  assert.equal(up.overAt, T0 + 330);
  assert.equal(tapGuardRetireAt(up), T0 + TAP_GUARD_MAX_LIFETIME_MS);
  // Its click, handled at +700: swallowed, then a tail after it (its dblclick comes in the same task).
  const clicked = stepTapGuard(up, { type: "click", t: T0 + 330, seenAt: T0 + 700, x: X0, y: Y0 });
  assert.equal(clicked.swallow, true);
  assert.equal(tapGuardRetireAt(clicked.state), T0 + 700 + TAP_GUARD_RELEASE_TAIL_MS);
  // A touch whose cancelable touchstart the guard swallowed (so cancelled) has no click to come: release + tail.
  const touched = stepTapGuard(down, { type: "touchstart", t: T0 + 240, x: X0, y: Y0, cancelable: true }).state;
  assert.equal(lastGesture(touched).noClick, true);
  const touchUp = stepTapGuard(touched, { type: "pointerup", t: T0 + 330, x: X0, y: Y0, isPrimary: true }).state;
  assert.equal(tapGuardRetireAt(touchUp), T0 + 330 + TAP_GUARD_RELEASE_TAIL_MS);
  // The release handled late (seenAt): the tail starts when it was handled.
  const late = stepTapGuard(touched, { type: "pointerup", t: T0 + 330, seenAt: T0 + 500, x: X0, y: Y0, isPrimary: true }).state;
  assert.equal(tapGuardRetireAt(late), T0 + 500 + TAP_GUARD_RELEASE_TAIL_MS);
  // Released inside the window (+290): nothing dated after it yet, so the bound — not release + tail.
  const upInside = stepTapGuard(touched, { type: "pointerup", t: T0 + 290, x: X0, y: Y0, isPrimary: true }).state;
  assert.equal(upInside.overAt, null);
  assert.equal(tapGuardRetireAt(upInside), T0 + TAP_GUARD_MAX_LIFETIME_MS);
  // The bound caps a tail that would run past it.
  const upLate = stepTapGuard(touched, { type: "pointerup", t: T0 + TAP_GUARD_MAX_LIFETIME_MS - 100, x: X0, y: Y0, isPrimary: true }).state;
  assert.equal(tapGuardRetireAt(upLate), T0 + TAP_GUARD_MAX_LIFETIME_MS);
  // A click handled late: the bound counts from the arm call, the window stays on the click's time.
  const lateArm = armTapGuard({ clientX: X0, clientY: Y0, t: T0, now: T0 + 350, detail: 1 });
  assert.equal(tapGuardRetireAt(lateArm), T0 + 350 + TAP_GUARD_MAX_LIFETIME_MS);
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

test("DOM: with no event the guard keeps listening past the window — a press dated inside it may still be queued — and its safety timer retires it TAP_GUARD_MAX_LIFETIME_MS after it armed, listeners and timer gone", () => {
  const { target, live } = makeTarget();
  const clock = makeClock();
  const guard = createTapGuard(target, clock);
  guard.arm(domEvent("click", { t: T0, x: X0, y: Y0 }));
  assert.equal(clock.pending(), 1, "one timer: the safety bound");
  clock.advance(300);
  assert.equal(guard.isArmed(), true, "the window is over on the clock, not by any event");
  assert.equal(live.size, TAP_GUARD_EVENT_TYPES.length);
  clock.advance(TAP_GUARD_MAX_LIFETIME_MS - 301);
  assert.equal(guard.isArmed(), true);
  clock.advance(1);
  assert.equal(guard.isArmed(), false);
  assert.equal(live.size, 0, "no listener left");
  assert.equal(clock.pending(), 0, "no timer left");
  // A click handled late (the arm call at +350 for a click dated T0): the bound counts from the arm call.
  const late = makeTarget();
  const lateClock = makeClock();
  const lateGuard = createTapGuard(late.target, lateClock);
  lateClock.advance(350);
  lateGuard.arm(domEvent("click", { t: T0, x: X0, y: Y0 }));
  lateClock.advance(TAP_GUARD_MAX_LIFETIME_MS - 1);
  assert.equal(lateGuard.isArmed(), true);
  lateClock.advance(1);
  assert.equal(lateGuard.isArmed(), false);
  assert.equal(late.live.size, 0);
  assert.equal(lateClock.pending(), 0);
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

test("pose: the compact alert card (one button) arms the guard before opening the Alert view, and nothing else in the banner does", () => {
  const banner = read("components/ambient/AlertBanner/index.js");
  assert.match(banner, /import useTapGuard from "~\/hooks\/useTapGuard";/);
  assert.match(banner, /const openAlertView = \(e\) => \{\s*guardTap\(e\);\s*headAction\(\);\s*\};/);
  // The whole card is the button; the ⤢ is a decorative square with no handler.
  assert.match(banner, /<button\s+type="button"\s+className=\{styles\.compactCard\}\s+onClick=\{openAlertView\}\s+aria-label=\{cardName\}\s+data-pi-press=""\s*>/);
  assert.match(banner, /<RailSquareButton icon=\{ExpandIcon\} decorative className=\{styles\.compactMax\} \/>/);
  // Exactly one call site: the v3.2 head row toggles in place and its counter cycles in place.
  assert.equal((banner.match(/guardTap\(/g) || []).length, 1);
  assert.equal((banner.match(/onClick=\{openAlertView\}/g) || []).length, 1);
  // The hook disposes its guard on unmount.
  const hook = read("hooks/useTapGuard.js");
  assert.match(hook, /return \(\) => \{\s*guard\.dispose\(\);/);
});

// ------------------------------------------------------------- the back button exception

test("back-button exception: inside the window a press on an overlay-shell view's back button is swallowed wherever it is; after the window, or off the button outside the box, it passes", () => {
  const onBackTap = (t, x, y) => tapEvents(t, x, y).map((ev, i) => (i === 0 ? { ...ev, onBack: true } : ev));
  for (const [dx, dy] of [[200, 0], [0, 250], [-300, 120]]) {
    assert.ok(allSwallowed(run(armed(), onBackTap(T0 + 120, X0 + dx, Y0 + dy)).verdicts), `on the back button at (${dx}, ${dy}), +120 ms`);
    assert.ok(allSwallowed(run(armed(), onBackTap(T0 + 280, X0 + dx, Y0 + dy)).verdicts), `on the back button at (${dx}, ${dy}), +280 ms`);
    assert.ok(allPassed(run(armed(), onBackTap(T0 + 320, X0 + dx, Y0 + dy)).verdicts), `on the back button at (${dx}, ${dy}), +320 ms`);
    assert.ok(allPassed(run(armed(), tapEvents(T0 + 150, X0 + dx, Y0 + dy)).verdicts), `elsewhere at (${dx}, ${dy})`);
  }
  // Only the overlay shell's back buttons: the selector needs [data-pi-shell].
  assert.equal(SHELL_BACK_SELECTOR, "[data-pi-shell] [data-pi-back]");
  const target = (match) => ({ closest: (sel) => (sel === SHELL_BACK_SELECTOR && match ? {} : null) });
  assert.equal(isShellBackPress({ target: target(true) }), true);
  assert.equal(isShellBackPress({ target: target(false) }), false);
  assert.equal(isShellBackPress({ target: null }), false);
  assert.equal(isShellBackPress(null), false);
});

test("back-button exception: the DOM guard asks onBack on pointerdown only and swallows such a press outside the box", () => {
  const listeners = new Map();
  const doc = {
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
  };
  let clock = T0;
  const asked = [];
  const guard = createTapGuard(doc, {
    now: () => clock,
    setTimer: () => 1,
    clearTimer: () => undefined,
    onBack: (event) => { asked.push(event.type); return event.type === "pointerdown"; },
  });
  assert.equal(guard.arm({ clientX: X0, clientY: Y0, detail: 1, timeStamp: T0 }), true);
  clock = T0 + 150;
  let stopped = 0;
  const fire = (type) => listeners.get(type)({ type, timeStamp: clock, clientX: X0 + 300, clientY: Y0 + 200, isPrimary: true, cancelable: true, preventDefault() {}, stopImmediatePropagation() { stopped += 1; } });
  for (const type of ["pointerdown", "pointerup", "click"]) fire(type);
  assert.deepEqual(asked, ["pointerdown"]);
  assert.equal(stopped, 3, "the whole press swallowed");
  guard.dispose();
});

test("pose: the guard is posed by the dock's view buttons, the hero's ⤢ and the FloatingMiniBanner (on the priority views only, test below; never the focus button); the views' back buttons carry data-pi-back", () => {
  const dock = read("components/ambient/ControlButtons/index.js");
  // Through guardViewTap, which arms it on the priority views only (test below).
  assert.match(dock, /onClick=\{\(e\) => \{ guardViewTap\(e\); setPiLayoutState\("ai"\); \}\}/);
  assert.match(dock, /onClick=\{\(e\) => \{ guardViewTap\(e\); setPiLayoutState\("max"\); \}\}/);
  assert.equal((dock.match(/guardViewTap\(/g) || []).length, 2);
  assert.equal((dock.match(/guardTap\(/g) || []).length, 2, "guardViewTap's own call and the timeline's (test below)");
  const hero = read("components/ambient/HeroCompact/index.js");
  assert.match(hero, /onClick=\{\(e\) => \{ guardTap\(e\); onMaximize\(\); \}\}/);
  const fmb = read("components/ambient/FloatingMiniBanner/index.js");
  assert.match(fmb, /onClick=\{\(e\) => \{ if \(guardTaps\) guardTap\(e\); onExpand\(\); \}\}/);
  const focus = read("components/WeatherMap/RadarFocusControl.js");
  assert.doesNotMatch(focus, /useTapGuard|guardTap/);
  for (const view of ["ConditionsView", "AiView", "AlertView"]) {
    assert.match(read(`components/ambient/${view}/index.js`), /icon=\{RestoreIcon\}\s+back\s/, view);
  }
  const square = read("components/ambient/RailSquareButton/index.js");
  assert.match(square, /data-pi-back=\{back \? "" : undefined\}/);
  assert.match(read("components/ambient/ChartTabs/index.js"), /data-pi-back=\{maximized \? "" : undefined\}/);
  // useTapGuard builds the default guard, whose onBack is isShellBackPress.
  assert.match(read("hooks/useTapGuard.js"), /createTapGuard\(document\)/);
  assert.match(read("ui/tapGuard.js"), /onBack = isShellBackPress,/);
});


// ------------------------------------------------------------- the shields and guards cancel their touches

// A blocking element that only takes the pointerdown lets Chromium
// synthesize, after the release, the compatibility mousedown and the click
// from the tap gesture, hit-tested again then; with the element lowered in
// between they reached the scrubber. A cancelled touchstart (or touchend)
// drops that gesture.

// An EventTarget that records every listener with its options.
function makeRecordingTarget() {
  const target = new EventTarget();
  const live = new Map();
  const add = target.addEventListener.bind(target);
  const remove = target.removeEventListener.bind(target);
  target.addEventListener = (type, fn, opts) => {
    live.set(type, { fn, opts });
    add(type, fn, opts);
  };
  target.removeEventListener = (type, fn, opts) => {
    if (live.get(type)?.fn === fn) live.delete(type);
    remove(type, fn, opts);
  };
  return { target, live };
}

test("touch cancel: cancelTouches cancels every cancelable touchstart and touchend that reaches its element, non-passive, and nothing else; its cleanup removes the listeners", () => {
  assert.deepEqual([...TOUCH_CANCEL_EVENT_TYPES], ["touchstart", "touchend"]);
  assert.ok(Object.isFrozen(TOUCH_CANCEL_EVENT_TYPES));
  const { target, live } = makeRecordingTarget();
  const off = cancelTouches(target);
  assert.deepEqual([...live.keys()].sort(), ["touchend", "touchstart"]);
  for (const { opts } of live.values()) assert.equal(opts.passive, false, "only a non-passive listener may cancel");
  const fire = (type, cancelable = true) => {
    const ev = new Event(type, { cancelable });
    target.dispatchEvent(ev);
    return ev.defaultPrevented;
  };
  assert.equal(fire("touchstart"), true, "the tap gesture is dropped: no compatibility mouse event, no click");
  assert.equal(fire("touchend"), true, "second chance, should the touchstart not have been cancelable");
  assert.equal(fire("touchstart", false), false, "a non-cancelable touch is left alone, without throwing");
  // Pointer, mouse and click events are not its business (pinch: touch-action: none).
  for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "touchmove", "touchcancel"]) {
    assert.equal(fire(type), false, type);
  }
  off();
  assert.equal(live.size, 0, "no listener left");
  assert.equal(fire("touchstart"), false);
  off(); // idempotent
  // No element: a no-op cleanup.
  assert.equal(typeof cancelTouches(null), "function");
  assert.doesNotThrow(() => cancelTouches(null)());
  assert.doesNotThrow(() => cancelTouches({})());
});

test("touch cancel: a press the guard swallows has its touchstart cancelled too, so neither it nor the shields' leaves a compatibility click to the scrubber", () => {
  // The event guard (posed by the timeline button) prevents the
  // default of every event of a swallowed tap, the touchstart included.
  const { target } = makeTarget();
  const clock = makeClock();
  const guard = createTapGuard(target, clock);
  guard.arm(domEvent("click", { t: T0, x: X0, y: Y0 }));
  const { results } = dispatchTap(target, clock, T0 + 240, X0 + 29, Y0);
  assert.deepEqual(results.find((r) => r.type === "touchstart"), { type: "touchstart", prevented: true });
  assert.deepEqual(results.find((r) => r.type === "touchend"), { type: "touchend", prevented: true });
  guard.dispose();
});

test("touch cancel: the views' shield cancels its touches while mounted (useTouchCancel, a layout effect); the dock band's shield and its guard only while raised (useShellTiming); pinch stays blocked by touch-action: none while they block", () => {
  const layout = read("components/ambient/LayoutPi/index.js");
  assert.match(layout, /import useTouchCancel from "\.\/useTouchCancel";/);
  // The views' shield while it is mounted (useShellTiming's `shield`).
  assert.match(layout, /const shieldRef = useRef\(null\);\s*useTouchCancel\(shieldRef, shell\.shield\);/);
  assert.equal((layout.match(/useTouchCancel\(/g) || []).length, 1, "useTouchCancel on the views' shield only: the dock band's shield and guard cancel only while raised");
  assert.doesNotMatch(layout, /useTouchCancel\(dock(Shield|Guard)Ref/);
  assert.match(layout, /\{shell\.shield && <div ref=\{shieldRef\} className=\{styles\.shield\} aria-hidden="true" \/>\}/);
  // No React touch handler: React's touch listeners are passive, they could not cancel.
  assert.doesNotMatch(layout, /onTouchStart|onTouchEnd/);
  // The hook: a layout effect (in place in the commit that mounts or arms the element), the listeners removed on cleanup.
  const hook = read("components/ambient/LayoutPi/useTouchCancel.js");
  assert.match(hook, /import \{ cancelTouches \} from "~\/ui\/tapGuard";/);
  assert.match(hook, /useLayoutEffect\(\(\) => \{\s*const el = ref\.current;\s*if \(!enabled \|\| !el\) return undefined;\s*return cancelTouches\(el\);\s*\}, \[ref, enabled\]\);/);
  // The dock band's two: their cancellation follows their `data-active`, in the
  // same helpers that flip it by hand (in the switch's commit, a layout effect), raised or lowered.
  const timing = read("components/ambient/LayoutPi/useShellTiming.js");
  assert.match(timing, /import \{ toggleTouchCancel \} from "~\/ui\/tapGuard";/);
  assert.match(timing, /function setDockShield\(shield, up\) \{\s*if \(!shield\) return;\s*shield\.setAttribute\("data-active", up \? "true" : "false"\);\s*toggleTouchCancel\(shield, up\);\s*\}/);
  assert.match(timing, /guard\.setAttribute\("data-active", x === null \? "false" : "true"\);\s*toggleTouchCancel\(guard, x !== null\);\s*\}/);
  assert.equal((timing.match(/toggleTouchCancel\(/g) || []).length, 2, "only those two helpers touch it");
  // Pinch: the views' shield keeps touch-action: none in its own rule; the dock band's two carry it in their raised
  // rule only.
  const css = read("components/ambient/LayoutPi/styles.css");
  const ownRule = (selector) => {
    const start = css.indexOf(`\n${selector} {`); // its own rule, at the top level
    assert.ok(start >= 0, selector);
    return css.slice(start, css.indexOf("}", start));
  };
  assert.match(ownRule(".layout[data-pi-shell] .shield"), /touch-action:\s*none;/);
  for (const cls of ["dockShield", "dockGuard"]) {
    assert.doesNotMatch(ownRule(`.layout[data-pi-shell] .${cls}`), /touch-action/, cls);
    assert.match(ownRule(`.layout[data-pi-shell] .${cls}[data-active="true"]`), /touch-action:\s*none;/, cls);
  }
});

// An element that blocks only at times cancels the touches that begin on it while it blocks, and keeps no listener
// at rest — except for a touch begun while it blocked, which keeps the touchend's second chance until it ends.
const touchEvent = (type, ids, cancelable = true) => {
  const ev = new Event(type, { cancelable });
  if (ids) Object.defineProperty(ev, "changedTouches", { value: ids.map((identifier) => ({ identifier })) });
  return ev;
};

test("touch cancel: toggleTouchCancel — on, it cancels every cancelable touchstart and touchend that reaches the element (non-passive); off, no listener is left; idempotent both ways", () => {
  const { target, live } = makeRecordingTarget();
  const fire = (type, ids, cancelable = true) => {
    const ev = touchEvent(type, ids, cancelable);
    target.dispatchEvent(ev);
    return ev.defaultPrevented;
  };
  // At rest: nothing on the element, nothing cancelled.
  assert.equal(live.size, 0);
  toggleTouchCancel(target, false); // lowering what was never raised: no-op
  assert.equal(live.size, 0);
  assert.equal(fire("touchstart", [1]), false);
  // Raised.
  toggleTouchCancel(target, true);
  assert.deepEqual([...live.keys()].sort(), ["touchcancel", "touchend", "touchstart"]);
  assert.equal(live.get("touchstart").opts.passive, false, "only a non-passive listener may cancel");
  assert.equal(live.get("touchend").opts.passive, false);
  assert.equal(live.get("touchcancel").opts.passive, true, "a touchcancel is never cancelable: counted only");
  const first = live.get("touchstart").fn;
  toggleTouchCancel(target, true); // raised again: the same listeners, none added
  assert.equal(live.get("touchstart").fn, first);
  assert.equal(fire("touchstart", [7]), true, "the tap gesture is dropped: no compatibility mouse event, no click");
  assert.equal(fire("touchend", [7]), true, "second chance, should the touchstart not have been cancelable");
  assert.equal(fire("touchstart", [8], false), false, "a non-cancelable touchstart is left alone, without throwing");
  assert.equal(fire("touchend", [8]), true);
  for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "touchmove"]) {
    assert.equal(fire(type), false, type);
  }
  // Lowered with no touch down: the listeners go at once.
  toggleTouchCancel(target, false);
  assert.equal(live.size, 0, "no listener left: no touch region at rest");
  assert.equal(fire("touchstart", [9]), false);
  toggleTouchCancel(target, false); // idempotent
  assert.equal(live.size, 0);
  // No element: a no-op.
  assert.doesNotThrow(() => toggleTouchCancel(null, true));
  assert.doesNotThrow(() => toggleTouchCancel({}, true));
  assert.doesNotThrow(() => toggleTouchCancel(undefined, false));
});

test("touch cancel: toggleTouchCancel — lowered while a touch begun on it is down, the element keeps its listeners until that touch ends (its touchend cancelled), then drops them; a touchcancel ends a touch too; raised again meanwhile, it stays on", () => {
  const { target, live } = makeRecordingTarget();
  const fire = (type, ids, cancelable = true) => {
    const ev = touchEvent(type, ids, cancelable);
    target.dispatchEvent(ev);
    return ev.defaultPrevented;
  };
  // A touch pressed on the raised element whose touchstart was not cancelable (a region the compositor had not
  // received yet), released after the lowering: its touchend is still cancelled — the only net left.
  toggleTouchCancel(target, true);
  assert.equal(fire("touchstart", [1], false), false);
  toggleTouchCancel(target, false);
  assert.equal(live.size, 3, "kept while the touch begun on it is down");
  assert.equal(fire("touchend", [1]), true, "its touchend still cancelled after the lowering");
  assert.equal(live.size, 0, "dropped once it has ended");
  // Two touches down: dropped after the last one; a touchcancel ends one.
  toggleTouchCancel(target, true);
  fire("touchstart", [2]);
  fire("touchstart", [3]);
  toggleTouchCancel(target, false);
  fire("touchcancel", [2], false);
  assert.equal(live.size, 3, "one touch still down");
  assert.equal(fire("touchend", [3]), true);
  assert.equal(live.size, 0);
  // Raised again while waiting to go: it stays on after that touch ends.
  toggleTouchCancel(target, true);
  fire("touchstart", [4]);
  toggleTouchCancel(target, false);
  toggleTouchCancel(target, true);
  fire("touchend", [4]);
  assert.equal(live.size, 3, "raised again: still on");
  assert.equal(fire("touchstart", [5]), true);
  fire("touchend", [5]);
  toggleTouchCancel(target, false);
  assert.equal(live.size, 0);
  // A touch event without changedTouches (none counted) never holds the listeners.
  toggleTouchCancel(target, true);
  fire("touchstart");
  toggleTouchCancel(target, false);
  assert.equal(live.size, 0);
  // Two elements are independent.
  const a = makeRecordingTarget();
  const b = makeRecordingTarget();
  toggleTouchCancel(a.target, true);
  toggleTouchCancel(b.target, true);
  toggleTouchCancel(a.target, false);
  assert.equal(a.live.size, 0);
  assert.equal(b.live.size, 3);
  toggleTouchCancel(b.target, false);
  assert.equal(b.live.size, 0);
});

test("touch cancel: changedTouchIds reads the identifiers of a touch event's changed touches, or none", () => {
  assert.deepEqual(changedTouchIds(touchEvent("touchstart", [3, 5])), [3, 5]);
  assert.deepEqual(changedTouchIds(touchEvent("touchend", [0])), [0]);
  assert.deepEqual(changedTouchIds(new Event("touchstart")), []);
  assert.deepEqual(changedTouchIds(null), []);
  assert.deepEqual(changedTouchIds({ changedTouches: { length: 2, 0: { identifier: 9 }, 1: null } }), [9], "a TouchList is array-like");
});

// ------------------------------------------------------------- the event guard on the timeline button

// A double tap on the timeline button: the dock's timeline button switches
// MID → MIN, the dock slides away and the scrubber arrives over the band,
// its track right under the finger. A second tap 29 px from the click
// (inside the box) is swallowed from +120 to +240 ms, radar live, with no
// compatibility click to the scrubber; 31 px away (outside) it passes —
// judged from +240 ms, once the dock band shield's cut-out over the bar has
// opened (150 ms after the switch, 200-230 ms measured on a Pi 4 kiosk;
// before that the shield, which cancels its touches, takes it).

// The timeline button's click: the dock band (58 px at the bottom of the
// 480 px screen), a dock button's centre.
const TL_X = 300;
const TL_Y = 451;
const armedTimeline = () => armTapGuard({ clientX: TL_X, clientY: TL_Y, t: T0, detail: 1 });

test("timeline guard: a second tap 29 px from the click is swallowed whole at +120, +170, +200 and +240 ms, compatibility mousedown and click included", () => {
  for (const dx of [-29, 29]) {
    for (const dt of [120, 170, 200, 240]) {
      const { verdicts } = run(armedTimeline(), tapEvents(T0 + dt, TL_X + dx, TL_Y));
      assert.ok(allSwallowed(verdicts), `${dx} px, +${dt} ms: ${JSON.stringify(verdicts)}`);
    }
  }
  // A measured leak: pressed at +239 / +247 ms and released at +310 / +312 ms (held ~70 ms, past the
  // window): still the same gesture, so its mousedown and click are swallowed too.
  for (const [down, up] of [[239, 310], [247, 312]]) {
    const { verdicts } = run(armedTimeline(), tapEvents(T0 + down, TL_X + 29, TL_Y, up - down));
    assert.ok(allSwallowed(verdicts), `pressed +${down}, released +${up}: ${JSON.stringify(verdicts)}`);
  }
});

test("timeline guard: a second tap 31 px from the click passes the event guard whole (it reaches the bar once the cut-out has opened, judged from +240 ms)", () => {
  for (const dx of [-31, 31]) {
    for (const dt of [240, 250, 280]) {
      const { verdicts } = run(armedTimeline(), tapEvents(T0 + dt, TL_X + dx, TL_Y));
      assert.ok(allPassed(verdicts), `${dx} px, +${dt} ms: ${JSON.stringify(verdicts)}`);
    }
    // Earlier, the event guard still lets it through: what takes it there is the dock band's shield (its
    // touches cancelled, test above), not the guard.
    for (const dt of [120, 170, 200]) assert.ok(allPassed(run(armedTimeline(), tapEvents(T0 + dt, TL_X + dx, TL_Y)).verdicts), `${dx} px, +${dt} ms`);
  }
});

test("timeline guard: DOM — the swallowed second tap never reaches the page (no mousedown, no click for the scrubber), its touchstart cancelled; the 31 px one reaches it untouched", () => {
  for (const dt of [120, 170, 200, 240]) {
    const { target } = makeTarget();
    const clock = makeClock();
    const guard = createTapGuard(target, clock);
    guard.arm(domEvent("click", { t: T0, x: TL_X, y: TL_Y }));
    const { seen, results } = dispatchTap(target, clock, T0 + dt, TL_X + 29, TL_Y);
    assert.deepEqual(seen, [], `+${dt} ms`);
    assert.ok(results.every((r) => r.prevented), `+${dt} ms: ${JSON.stringify(results)}`);
    guard.dispose();
  }
  const { target } = makeTarget();
  const clock = makeClock();
  const guard = createTapGuard(target, clock);
  guard.arm(domEvent("click", { t: T0, x: TL_X, y: TL_Y }));
  const { seen, results } = dispatchTap(target, clock, T0 + 240, TL_X + 31, TL_Y);
  assert.deepEqual(seen, tapEvents(0, 0, 0).map((e) => e.type));
  assert.ok(results.every((r) => !r.prevented));
  guard.dispose();
});

test("timeline guard: the dock's timeline button arms the guard on the overlay shell's dock only, where its switch to MIN brings the scrubber under the finger — never without that shell, nor where it toggles the timeline in place", () => {
  const dock = read("components/ambient/ControlButtons/index.js");
  const start = dock.indexOf("const btnTimeline = ");
  const end = dock.indexOf("const btn", start + 1);
  const timeline = dock.slice(start, end);
  // First thing in the priority branch, before the switch itself, and only under the overlay shell (`dockOverflow`,
  // the pair LayoutPi uses for `data-pi-shell`): without the shell, the dock arms nothing, as before (the timeline
  // guard belongs to the overlay shell alone).
  assert.match(timeline, /if \(inPriorityDock\) \{[\s\S]*?if \(dockOverflow\) guardTap\(e\);\s*setPiScrubberOpen\(true\);\s*setPiLayoutState\("min"\);/);
  assert.equal((timeline.match(/guardTap\(/g) || []).length, 1);
  assert.doesNotMatch(timeline, /^\s*guardTap\(e\);/m, "no unconditional guard");
  assert.match(dock, /const dockOverflow = inPiDock && piShellVariant\(\) !== null;/);
  // The in-place toggle (the 10.1" rail, desktop, mobile) arms nothing.
  const inPlace = timeline.slice(timeline.indexOf("} else {"));
  assert.match(inPlace, /toggleRadarTimelineVisible\(\);/);
  assert.doesNotMatch(inPlace, /guardTap/);
  // On top of the dock band's local guard, which stays (the shields and the guards cancel the touch): mounted once,
  // its touches cancelled (test above; its geometry and timing, test/piShellGeometry.test.js).
  assert.match(read("components/ambient/LayoutPi/index.js").replace(/\/\*[\s\S]*?\*\//g, ""), /data-pi-dock-guard=""/);
});

// ------------------------------------------------------------- the back-button exception over the whole gesture

// A measured case: the second tap aimed at the back button at +280 ms.
// Its pointerdown (+277.5 ms) landed on the sheet, still moving, outside the
// box: judged on its press alone, the gesture passed whole, and its click,
// handled at +336 ms, reached the back button that had slid under the finger
// and closed the view. So a gesture begun inside the window is swallowed from
// its first event that lands on the back button, whenever that is.
const OFF_BOX = { x: X0 + 100, y: Y0 + 80 }; // on the moving sheet, outside the box
const backTapAcrossSheet = (clickT = T0 + 336) => [
  { type: "pointerdown", t: T0 + 277.5, ...OFF_BOX, isPrimary: true },
  { type: "touchstart", t: T0 + 277.5, ...OFF_BOX },
  // Touch: implicit pointer capture, and every touch event goes to the touchstart's target — still the sheet.
  { type: "pointerup", t: T0 + 302.5, ...OFF_BOX, isPrimary: true },
  { type: "touchend", t: T0 + 302.5, ...OFF_BOX },
  // The tap gesture's compatibility events and click, hit-tested again: the back button has arrived there.
  { type: "mousedown", t: clickT, ...OFF_BOX, onBack: true },
  { type: "mouseup", t: clickT, ...OFF_BOX, onBack: true },
  { type: "click", t: clickT, ...OFF_BOX, onBack: true },
];

test("back-button exception: a second tap pressed on the sliding sheet outside the box at +277.5 ms, released at +302.5, its click at +336 ms on the back button: swallowed from its first event on the button", () => {
  for (const clickT of [T0 + 336, T0 + 302.5]) {
    const { state, verdicts } = run(armed(), backTapAcrossSheet(clickT));
    assert.deepEqual(verdicts.map((v) => [v.type, v.swallow]), [
      ["pointerdown", false], // on the sheet, outside the box: already dispatched when the button arrives
      ["touchstart", false],
      ["pointerup", false],
      ["touchend", false],
      ["mousedown", true], // lands on the back button: the rest of the gesture goes
      ["mouseup", true],
      ["click", true], // never reaches the button, though it comes after the window
    ], `click at +${clickT - T0} ms`);
    assert.equal(lastGesture(state).swallow, true);
  }
});

test("back-button exception: it needs a gesture begun inside the window — begun at +300 ms or later, a click on the back button passes", () => {
  for (const start of [300, 320, 450]) {
    const events = backTapAcrossSheet(T0 + start + 60).map((ev, i) => (i < 4 ? { ...ev, t: T0 + start + (i < 2 ? 0 : 25) } : ev));
    assert.ok(allPassed(run(armed(), events).verdicts), `begun at +${start} ms`);
  }
});

test("back-button exception: a gesture begun inside the window outside the box whose events never land on the back button passes whole; once its click has passed the guard waits for nothing of it — it retires at the first press dated after the window; released with no click yet, it waits for that click on events", () => {
  const { state, verdicts } = run(armed(), tapEvents(T0 + 200, OFF_BOX.x, OFF_BOX.y));
  assert.ok(allPassed(verdicts));
  assert.equal(lastGesture(state).clicked, true);
  assert.equal(tapGuardRetireAt(state), T0 + TAP_GUARD_MAX_LIFETIME_MS, "nothing dated after the window yet: the safety bound");
  const next = stepTapGuard(state, { type: "pointerdown", t: T0 + 400, x: X0, y: Y0, isPrimary: true });
  assert.equal(next.swallow, false);
  assert.equal(tapGuardRetireAt(next.state), T0 + 400, "its click passed: nothing left to wait for");
  // Released past the window with no click yet: the guard waits for it — on events, not on a tail on the clock (a
  // long task after its touchend can hold its click back past any tail: the out-of-order tests below) — so the
  // bound until it comes.
  const pending = run(armed(), backTapAcrossSheet().slice(0, 4)).state;
  assert.equal(pending.overAt, T0 + 302.5, "the release is the first event dated after the window");
  assert.equal(tapGuardRetireAt(pending), T0 + TAP_GUARD_MAX_LIFETIME_MS);
  // Its click comes and passes (not on the button): nothing left, the guard retires.
  const clicked = stepTapGuard(pending, { type: "click", t: T0 + 336, ...OFF_BOX });
  assert.equal(clicked.swallow, false);
  assert.equal(tapGuardRetireAt(clicked.state), T0 + 302.5);
  // Still down at the window's end: the bound, until the release.
  const down = run(armed(), backTapAcrossSheet().slice(0, 2)).state;
  assert.equal(tapGuardRetireAt(down), T0 + TAP_GUARD_MAX_LIFETIME_MS);
});

test("back-button exception: tapGuardAsksBack — on every pointerdown, and on the later events of a gesture begun inside the window that still passes; never otherwise", () => {
  assert.equal(tapGuardAsksBack(null, "pointerdown"), false);
  const s = armed();
  assert.equal(tapGuardAsksBack(s, "pointerdown"), true);
  assert.equal(tapGuardAsksBack(s, "click"), false, "no gesture yet: the first tap's leftovers pass");
  const passing = stepTapGuard(s, { type: "pointerdown", t: T0 + 200, ...OFF_BOX, isPrimary: true }).state;
  for (const type of ["touchstart", "pointerup", "mousedown", "mouseup", "click"]) assert.equal(tapGuardAsksBack(passing, type), true, type);
  const swallowed = stepTapGuard(s, { type: "pointerdown", t: T0 + 200, x: X0, y: Y0, isPrimary: true }).state;
  assert.equal(tapGuardAsksBack(swallowed, "click"), false, "already swallowed whole");
  const late = stepTapGuard(s, { type: "pointerdown", t: T0 + 320, ...OFF_BOX, isPrimary: true }).state;
  assert.equal(tapGuardAsksBack(late, "click"), false, "begun after the window: it passes whatever it lands on");
});

test("back-button exception: DOM — the back tap across the sheet end to end: the guard is still listening at +336 ms, the click on the back button never reaches the page, then the guard retires", () => {
  const { target, live } = makeTarget();
  const clock = makeClock();
  const asked = [];
  const guard = createTapGuard(target, {
    ...clock,
    onBack: (event) => {
      asked.push(event.type);
      return event.landsOnBack === true;
    },
  });
  guard.arm(domEvent("click", { t: T0, x: X0, y: Y0 }));
  const seen = [];
  const app = (ev) => seen.push(ev.type);
  for (const type of TAP_GUARD_EVENT_TYPES) target.addEventListener(type, app);
  const prevented = [];
  for (const e of backTapAcrossSheet()) {
    if (e.t > clock.now()) clock.advance(e.t - clock.now());
    const ev = domEvent(e.type, { t: e.t, x: e.x, y: e.y });
    Object.defineProperty(ev, "landsOnBack", { value: e.onBack === true });
    target.dispatchEvent(ev);
    if (ev.defaultPrevented) prevented.push(e.type);
  }
  for (const type of TAP_GUARD_EVENT_TYPES) target.removeEventListener(type, app);
  assert.deepEqual(seen, ["pointerdown", "touchstart", "pointerup", "touchend"], "nothing from the back button on");
  assert.deepEqual(prevented, ["mousedown", "mouseup", "click"]);
  // Asked on each event while the gesture passed, no more once it was swallowed.
  assert.deepEqual(asked, ["pointerdown", "touchstart", "pointerup", "touchend", "mousedown"]);
  assert.equal(guard.isArmed(), true);
  clock.advance(TAP_GUARD_RELEASE_TAIL_MS);
  assert.equal(guard.isArmed(), false);
  assert.equal(live.size, 0, "no listener left");
  assert.equal(clock.pending(), 0, "no timer left");
});

test("back-button exception: DOM — a gesture begun inside the window that passes, its click included, before the window's end: the guard keeps listening past the window until the first event dated after it, which passes and retires it", () => {
  const { target, live } = makeTarget();
  const clock = makeClock();
  const guard = createTapGuard(target, { ...clock, onBack: () => false });
  guard.arm(domEvent("click", { t: T0, x: X0, y: Y0 }));
  const { seen } = dispatchTap(target, clock, T0 + 150, OFF_BOX.x, OFF_BOX.y);
  assert.deepEqual(seen, tapEvents(0, 0, 0).map((e) => e.type));
  clock.advance(T0 + 2000 - clock.now());
  assert.equal(guard.isArmed(), true, "no event dated after the window yet");
  // The next tap, in the box but at +2000 ms: delivered whole; the guard retires at its pointerdown.
  const after = dispatchTap(target, clock, T0 + 2000, X0, Y0);
  assert.deepEqual(after.seen, tapEvents(0, 0, 0).map((e) => e.type));
  assert.ok(after.results.every((r) => !r.prevented));
  assert.equal(guard.isArmed(), false);
  assert.equal(live.size, 0);
  assert.equal(clock.pending(), 0);
});

// ------------------------------------------------------------- the dock's AI / forecast guard on the priority views only

test("pose: the dock's AI and forecast buttons arm the guard only on the priority views, never on the 10.1\" stacked rail, where the buttons stay", () => {
  const dock = read("components/ambient/ControlButtons/index.js");
  // The gate: priority views on (≤ 540 px CSS height, or forced) inside LayoutPi.
  assert.match(dock, /const inPriorityDock = priorityViewsEnabled\(\) && piLayoutState != null;/);
  assert.match(dock, /const guardViewTap = \(e\) => \{\s*if \(inPriorityDock\) guardTap\(e\);\s*\};/);
  // Both buttons still render on any LayoutPi dock (the 10.1" keeps its AI and forecast access), and arm
  // through guardViewTap only.
  assert.match(dock, /const btnBot = inPiDock\s*\?/);
  assert.match(dock, /const btnForecast = inPiDock \? \(/);
  for (const state of ["ai", "max"]) {
    assert.match(dock, new RegExp(`onClick=\\{\\(e\\) => \\{ guardViewTap\\(e\\); setPiLayoutState\\("${state}"\\); \\}\\}`), state);
    assert.doesNotMatch(dock, new RegExp(`guardTap\\(e\\); setPiLayoutState\\("${state}"\\)`), `${state}: no unconditional guard`);
  }
  // The only other guard call in the dock is the timeline's, inside its own priority branch (pinned above).
  assert.equal((dock.match(/guardTap\(e\)/g) || []).length, 2);
});

// ------------------------------------------------------------- the FloatingMiniBanner's guard on the priority views only

test("pose: the FloatingMiniBanner arms the guard on the priority views only: LayoutPi hands it the model it renders on both its mounts; LayoutDesktop (forcePriorityViews in a 1280 px window included) and LayoutMobile hand it nothing", () => {
  // Code only: the comments may name the prop.
  const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const fmb = code("components/ambient/FloatingMiniBanner/index.js");
  assert.match(fmb, /onClick=\{\(e\) => \{ if \(guardTaps\) guardTap\(e\); onExpand\(\); \}\}/);
  assert.equal((fmb.match(/guardTap\(/g) || []).length, 1, "one guarded call site");
  // A boolean prop, false unless passed (a destructuring default, never defaultProps).
  assert.match(fmb, /\bguardTaps = false\b/);
  assert.match(fmb, /guardTaps: PropTypes\.bool,/);
  // No gate of its own: it follows the model LayoutPi renders (the dock's scope, ControlButtons inPriorityDock).
  assert.doesNotMatch(fmb, /priorityViewsEnabled|piShellVariant|PiLayout(?:Mounted)?Context/);
  const layoutPi = code("components/ambient/LayoutPi/index.js");
  assert.match(layoutPi, /const priority = priorityViewsEnabled\(\);/);
  const mounts = (src) => src.match(/<FloatingMiniBanner\b[\s\S]*?\/>/g) || [];
  const pi = mounts(layoutPi);
  assert.equal(pi.length, 2, "the overlay shell's mount and the stacked rail's MIN");
  for (const m of pi) assert.match(m, /^<FloatingMiniBanner guardTaps=\{priority\} onExpand=/, m);
  for (const rel of ["components/ambient/LayoutDesktop/index.js", "components/ambient/LayoutMobile/index.js"]) {
    const found = mounts(code(rel));
    assert.equal(found.length, 1, rel);
    assert.doesNotMatch(found[0], /guardTaps/, rel);
  }
});

// ------------------------------------------------------------- listening while a press of the window may be queued

// PR 412 retired the guard on a timer at the window's end on the clock. On a loaded desktop machine, every double
// tap that got through was a second tap dated inside the window but handled 116 to 1087 ms after it: the timer had
// run first and the tap found no listener. The guard now retires at the first event dated after the window (judged
// as usual), or on its safety timer, and a released gesture ends on the events' own time.

test("late dispatch: a released gesture ends on the events' own time — its click dated inside its tail is still its own, even handled long after; an event dated past the tail follows no gesture and passes; only a press or a release so dated takes the gesture off the list", () => {
  // A swallowed second tap pressed at +150, released at +200.
  const released = run(armed(), tapEvents(T0 + 150, X0, Y0).slice(0, 4)).state;
  assert.equal(lastGesture(released).releasedAt, T0 + 200);
  // Its click and dblclick dated +201, handled at +900 (a stall): swallowed.
  const click = stepTapGuard(released, { type: "click", t: T0 + 201, seenAt: T0 + 900, x: X0, y: Y0 });
  assert.equal(click.swallow, true);
  assert.equal(stepTapGuard(click.state, { type: "dblclick", t: T0 + 201, seenAt: T0 + 901, x: X0, y: Y0 }).swallow, true);
  // At +499.9 still in its tail; at +500 (release + 300 ms) no longer.
  assert.equal(stepTapGuard(released, { type: "click", t: T0 + 499.9, x: X0, y: Y0 }).swallow, true);
  const stray = stepTapGuard(released, { type: "click", t: T0 + 500, x: X0, y: Y0 });
  assert.equal(stray.swallow, false, "a keyboard activation or a script's click() long after the tap is not that tap's");
  assert.equal(stray.state.overAt, null, "a click tells nothing of the queue: a press of the window may still be behind it");
  assert.equal(stray.state.gestures.length, 1, "nor does it take the gesture off the list");
  assert.equal(tapGuardRetireAt(stray.state), T0 + TAP_GUARD_MAX_LIFETIME_MS);
  // A press dated +500 does both: it is after the window, and past the gesture's tail.
  const press = stepTapGuard(released, { type: "pointerdown", t: T0 + 500, x: X0 + 200, y: Y0, isPrimary: true });
  assert.equal(press.swallow, false);
  assert.equal(press.state.overAt, T0 + 500);
  assert.deepEqual(press.state.gestures.map((g) => g.downAt), [T0 + 500], "the released gesture is off the list");
  assert.equal(tapGuardRetireAt(press.state), T0 + 500, "nothing left to follow: the guard retires");
  // Dated +499.9, the press keeps it: its click may still come.
  const early = stepTapGuard(released, { type: "pointerdown", t: T0 + 499.9, x: X0 + 200, y: Y0, isPrimary: true });
  assert.equal(early.state.gestures.length, 2);
  // A gesture still down has no tail: every later event is its own.
  const down = stepTapGuard(armed(), { type: "pointerdown", t: T0 + 150, x: X0, y: Y0, isPrimary: true }).state;
  assert.equal(stepTapGuard(down, { type: "touchend", t: T0 + 5000, x: X0, y: Y0 }).swallow, true);
  // tapGuardAsksBack follows the same rule: a passing in-window gesture past its tail asks nothing.
  const passing = run(armed(), backTapAcrossSheet().slice(0, 4)).state; // released at +302.5, no click yet
  assert.equal(tapGuardAsksBack(passing, "click", T0 + 336), true);
  assert.equal(tapGuardAsksBack(passing, "click", T0 + 602.5), false);
  assert.equal(tapGuardAsksBack(passing, "click"), true, "without a time: the gesture as recorded");
});

// One tap whose events are all handled at `at` on the clock (a stalled main thread) but dated from `t` on (its
// release `holdMs` later), as a loaded desktop machine dispatched the late second taps of a double tap.
const dispatchLate = (target, clock, at, t, x, y, holdMs = 50) => {
  if (at > clock.now()) clock.advance(at - clock.now());
  return dispatchTap(target, clock, t, x, y, holdMs);
};
const ALL_TYPES = tapEvents(0, 0, 0).map((e) => e.type);

test("late dispatch: a second tap dated +250 ms but dispatched at +600 ms (a stalled main thread) is swallowed whole — PR 412's timer had retired the guard at +300 ms; its release, dated +300, shows the window over: the guard retires at that release + tail", () => {
  const { target, live } = makeTarget();
  const clock = makeClock();
  const guard = createTapGuard(target, clock);
  guard.arm(domEvent("click", { t: T0, x: X0, y: Y0 }));
  clock.advance(600);
  assert.equal(guard.isArmed(), true, "still listening at +600 ms: no event dated after the window yet");
  const { seen, results } = dispatchLate(target, clock, T0 + 600, T0 + 250, X0 + 5, Y0 - 5);
  assert.deepEqual(seen, [], "nothing of it reaches the page");
  assert.ok(results.every((r) => r.prevented), JSON.stringify(results));
  // Its release (dated +300, handled at +600) is after the window: the tail runs from when it was handled.
  assert.equal(guard.isArmed(), true);
  clock.advance(TAP_GUARD_RELEASE_TAIL_MS - 1);
  assert.equal(guard.isArmed(), true);
  clock.advance(1);
  assert.equal(guard.isArmed(), false);
  assert.equal(live.size, 0, "no listener left");
  assert.equal(clock.pending(), 0, "no timer left");
});

test("late dispatch: a tap dated +320 ms passes whole and retires the guard at its own pointerdown — handled on time or 1.2 s late — with no listener or timer left", () => {
  for (const at of [T0 + 320, T0 + 1500]) {
    const { target, live } = makeTarget();
    const clock = makeClock();
    const guard = createTapGuard(target, clock);
    guard.arm(domEvent("click", { t: T0, x: X0, y: Y0 }));
    const atDown = [];
    target.addEventListener("pointerdown", () => atDown.push(live.size));
    const { seen, results } = dispatchLate(target, clock, at, T0 + 320, X0, Y0);
    assert.deepEqual(atDown, [0], `handled at +${at - T0} ms: already retired when the page sees its pointerdown`);
    assert.deepEqual(seen, ALL_TYPES);
    assert.ok(results.every((r) => !r.prevented));
    assert.equal(guard.isArmed(), false);
    assert.equal(clock.pending(), 0);
  }
});

test("late dispatch: after a second tap swallowed and released inside the window, the guard keeps listening — a third tap dated +280 ms handled at +900 is swallowed too; a later stray click (a keyboard activation) is not taken as theirs: it passes, and leaves the guard listening; the next tap after the window passes and retires it", () => {
  const { target, live } = makeTarget();
  const clock = makeClock();
  const guard = createTapGuard(target, clock);
  guard.arm(domEvent("click", { t: T0, x: X0, y: Y0 }));
  assert.deepEqual(dispatchTap(target, clock, T0 + 150, X0, Y0, 30).seen, []);
  const third = dispatchLate(target, clock, T0 + 900, T0 + 280, X0 + 10, Y0, 10);
  assert.deepEqual(third.seen, [], "dated inside the window: swallowed whatever its dispatch delay");
  assert.equal(guard.isArmed(), true, "both released inside the window: nothing dated after it yet");
  clock.advance(1100);
  let reached = 0;
  const app = () => { reached += 1; };
  target.addEventListener("click", app);
  const key = domEvent("click", { t: T0 + 2000, x: 0, y: 0, detail: 0 });
  target.dispatchEvent(key);
  target.removeEventListener("click", app);
  assert.equal(reached, 1);
  assert.equal(key.defaultPrevented, false);
  assert.equal(guard.isArmed(), true, "a click is no input in order: it does not end the wait");
  const next = dispatchLate(target, clock, T0 + 2100, T0 + 2100, X0, Y0);
  assert.deepEqual(next.seen, ALL_TYPES, "in the box, but dated after the window: delivered whole");
  assert.equal(guard.isArmed(), false, "retired at its pointerdown");
  assert.equal(live.size, 0);
  assert.equal(clock.pending(), 0);
});

test("late dispatch: a gesture held across the window — swallowed at +240 ms, released at +2000: every event of it swallowed, its click and dblclick included; its release, the first event dated after the window, retires the guard at release + tail", () => {
  const { target, live } = makeTarget();
  const clock = makeClock();
  const guard = createTapGuard(target, clock);
  guard.arm(domEvent("click", { t: T0, x: X0, y: Y0 }));
  const seen = [];
  const app = (ev) => seen.push(ev.type);
  for (const type of TAP_GUARD_EVENT_TYPES) target.addEventListener(type, app);
  const fire = (type, t) => {
    if (t > clock.now()) clock.advance(t - clock.now());
    const ev = domEvent(type, { t, x: X0, y: Y0 });
    target.dispatchEvent(ev);
    return ev.defaultPrevented;
  };
  assert.ok(fire("pointerdown", T0 + 240) && fire("touchstart", T0 + 240));
  clock.advance(T0 + 1999 - clock.now());
  assert.equal(guard.isArmed(), true, "the finger still down: the safety bound");
  for (const type of ["pointerup", "touchend", "mousedown", "mouseup", "click", "dblclick"]) assert.ok(fire(type, T0 + 2000), type);
  for (const type of TAP_GUARD_EVENT_TYPES) target.removeEventListener(type, app);
  assert.deepEqual(seen, []);
  assert.equal(guard.isArmed(), true);
  clock.advance(TAP_GUARD_RELEASE_TAIL_MS - 1);
  assert.equal(guard.isArmed(), true);
  clock.advance(1);
  assert.equal(guard.isArmed(), false);
  assert.equal(live.size, 0);
  assert.equal(clock.pending(), 0);
  // Pure: a gesture begun inside the window outside the box, held across it — its click on the back button at
  // +2000 ms is swallowed (the exception over the whole gesture); not on it, it passes and the guard has nothing left.
  const held = [
    { type: "pointerdown", t: T0 + 200, ...OFF_BOX, isPrimary: true },
    { type: "pointerup", t: T0 + 2000, ...OFF_BOX, isPrimary: true },
  ];
  const onBack = run(armed(), [...held, { type: "click", t: T0 + 2000, ...OFF_BOX, onBack: true }]);
  assert.deepEqual(onBack.verdicts.map((v) => v.swallow), [false, false, true]);
  const offBack = run(armed(), [...held, { type: "click", t: T0 + 2000, ...OFF_BOX }]);
  assert.ok(allPassed(offBack.verdicts));
  assert.equal(tapGuardRetireAt(offBack.state), T0 + 2000);
});

test("late dispatch: dispose() mid-way — a swallowed press held across the window, or a guard waiting past the window with no event: listeners and timer gone at once, nothing more swallowed", () => {
  const { target, live } = makeTarget();
  const clock = makeClock();
  const guard = createTapGuard(target, clock);
  guard.arm(domEvent("click", { t: T0, x: X0, y: Y0 }));
  clock.advance(240);
  const down = domEvent("pointerdown", { t: T0 + 240, x: X0, y: Y0 });
  target.dispatchEvent(down);
  assert.equal(down.defaultPrevented, true);
  clock.advance(200);
  guard.dispose(); // unmount at +440, the finger still down
  assert.equal(guard.isArmed(), false);
  assert.equal(live.size, 0);
  assert.equal(clock.pending(), 0);
  const seen = [];
  const app = (ev) => seen.push(ev.type);
  target.addEventListener("pointerup", app);
  target.addEventListener("click", app);
  target.dispatchEvent(domEvent("pointerup", { t: T0 + 440, x: X0, y: Y0 }));
  target.dispatchEvent(domEvent("click", { t: T0 + 440, x: X0, y: Y0 }));
  assert.deepEqual(seen, ["pointerup", "click"], "the guard is gone: the rest of that tap reaches the page");
  guard.dispose(); // idempotent
  // Waiting past the window with no event (the safety bound pending): dispose halfway to it.
  const w = makeTarget();
  const wClock = makeClock();
  const waiting = createTapGuard(w.target, wClock);
  waiting.arm(domEvent("click", { t: T0, x: X0, y: Y0 }));
  wClock.advance(TAP_GUARD_MAX_LIFETIME_MS / 2);
  assert.equal(waiting.isArmed(), true);
  waiting.dispose();
  assert.equal(w.live.size, 0);
  assert.equal(wClock.pending(), 0, "the safety timer cleared");
  wClock.advance(TAP_GUARD_MAX_LIFETIME_MS);
  assert.equal(waiting.isArmed(), false);
});

test("late dispatch: eventTime's fallback — a press handled late with no usable timeStamp (0, or an epoch base) is dated by the clock, so it reads as after the window: it passes (fail open, as before); dated by the clock, not by itself, it does not end the wait — the next press dated by its own timeStamp does", () => {
  for (const stamp of [0, 1_760_000_000_000]) {
    const { target, live } = makeTarget();
    const clock = makeClock();
    const guard = createTapGuard(target, clock);
    guard.arm(domEvent("click", { t: T0, x: X0, y: Y0 }));
    clock.advance(600);
    const ev = domEvent("pointerdown", { t: stamp, x: X0, y: Y0 });
    target.dispatchEvent(ev);
    assert.equal(ev.defaultPrevented, false, `timeStamp ${stamp}`);
    assert.equal(guard.isArmed(), true, `timeStamp ${stamp}: a press of the window may still be queued behind it`);
    // A tap dated +250 in the box, dispatched right after it: still swallowed.
    clock.advance(1);
    const queued = domEvent("pointerdown", { t: T0 + 250, x: X0, y: Y0 });
    target.dispatchEvent(queued);
    assert.equal(queued.defaultPrevented, true);
    target.dispatchEvent(domEvent("pointerup", { t: T0 + 280, x: X0, y: Y0 }));
    // A press dated by its own timeStamp after the window: it passes, and the swallowed tap's click still has to come.
    clock.advance(9);
    const next = domEvent("pointerdown", { t: T0 + 610, x: X0 + 200, y: Y0 });
    target.dispatchEvent(next);
    assert.equal(next.defaultPrevented, false);
    assert.equal(guard.isArmed(), true, "the swallowed tap's click may still be queued");
    const click = domEvent("click", { t: T0 + 280, x: X0, y: Y0 });
    target.dispatchEvent(click);
    assert.equal(click.defaultPrevented, true, "still that tap's, though handled after the next press");
    clock.advance(TAP_GUARD_RELEASE_TAIL_MS);
    assert.equal(guard.isArmed(), false);
    assert.equal(live.size, 0);
    assert.equal(clock.pending(), 0);
  }
});

// A double tap's expected outcome: a press dated < +290 ms in the box or on the back button swallowed whole and one
// dated ≥ +310 ms (or outside the box, off the button) delivered whole — judged on the press's stamp, whatever its
// dispatch delay. The lags: 0 to 1306 ms, the worst measured on a loaded desktop machine.
const DISPATCH_LAGS = [0, 65, 116, 300, 700, 1087, 1306];

/**
 * One second tap through a fresh guard armed at (ax, ay) at T0, handled `lag` ms after its stamp.
 *
 * @param {object} p - The case.
 * @returns {{seen: string[], prevented: boolean[], armed: boolean}} what the page saw, and the guard after it
 */
function lateSecondTap({ ax = X0, ay = Y0, stamp, lag, x, y, back = false }) {
  const { target } = makeTarget();
  const clock = makeClock();
  const guard = createTapGuard(target, { ...clock, onBack: (ev) => ev.landsOnBack === true });
  guard.arm(domEvent("click", { t: T0, x: ax, y: ay }));
  clock.advance(stamp + lag);
  const seen = [];
  const app = (ev) => seen.push(ev.type);
  for (const type of TAP_GUARD_EVENT_TYPES) target.addEventListener(type, app);
  const prevented = tapEvents(T0 + stamp, x, y).map((e) => {
    const ev = domEvent(e.type, { t: e.t, x: e.x, y: e.y });
    Object.defineProperty(ev, "landsOnBack", { value: back });
    target.dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  for (const type of TAP_GUARD_EVENT_TYPES) target.removeEventListener(type, app);
  const result = { seen, prevented, armed: guard.isArmed() };
  guard.dispose();
  return result;
}

test("late dispatch: a double tap's expected outcome holds whatever the dispatch delay (0 to 1306 ms) — in the box or on the back button, dated < +290 ms swallowed whole; dated ≥ +310 ms, or outside the box off the button, delivered whole", () => {
  for (const lag of DISPATCH_LAGS) {
    for (const stamp of [120, 170, 200, 240, 280]) {
      const box = lateSecondTap({ stamp, lag, x: X0 + 4, y: Y0 - 3 });
      assert.deepEqual(box.seen, [], `in the box, +${stamp} ms, ${lag} ms late`);
      assert.ok(box.prevented.every(Boolean), `in the box, +${stamp} ms, ${lag} ms late`);
      const back = lateSecondTap({ stamp, lag, x: X0 + 200, y: Y0 + 150, back: true });
      assert.deepEqual(back.seen, [], `on the back button, +${stamp} ms, ${lag} ms late`);
      const outside = lateSecondTap({ stamp, lag, x: X0 + 40, y: Y0 });
      assert.deepEqual(outside.seen, ALL_TYPES, `outside the box, +${stamp} ms, ${lag} ms late`);
    }
    for (const stamp of [310, 320, 450]) {
      for (const back of [false, true]) {
        const late = lateSecondTap({ stamp, lag, x: X0, y: Y0, back });
        assert.deepEqual(late.seen, ALL_TYPES, `+${stamp} ms${back ? " on the back button" : ""}, ${lag} ms late`);
        assert.ok(late.prevented.every((p) => !p));
        assert.equal(late.armed, false, "retired at its pointerdown");
      }
    }
  }
});

test("late dispatch: the timeline's guard, late — a second tap 29 px from the click at +170 / +240 ms handled up to 1306 ms late is swallowed whole (no mousedown, no click for the scrubber); 31 px away it is delivered", () => {
  for (const lag of DISPATCH_LAGS) {
    for (const stamp of [170, 240]) {
      const in29 = lateSecondTap({ ax: TL_X, ay: TL_Y, stamp, lag, x: TL_X + 29, y: TL_Y });
      assert.deepEqual(in29.seen, [], `29 px, +${stamp} ms, ${lag} ms late`);
      assert.ok(in29.prevented.every(Boolean));
      const out31 = lateSecondTap({ ax: TL_X, ay: TL_Y, stamp, lag, x: TL_X + 31, y: TL_Y });
      assert.deepEqual(out31.seen, ALL_TYPES, `31 px, +${stamp} ms, ${lag} ms late`);
    }
  }
});

test("late dispatch: the back tap across the sheet handled late — every event 500 ms behind its stamp: still swallowed from its click on the back button, then the guard retires", () => {
  const { target, live } = makeTarget();
  const clock = makeClock();
  const guard = createTapGuard(target, { ...clock, onBack: (event) => event.landsOnBack === true });
  guard.arm(domEvent("click", { t: T0, x: X0, y: Y0 }));
  const seen = [];
  const app = (ev) => seen.push(ev.type);
  for (const type of TAP_GUARD_EVENT_TYPES) target.addEventListener(type, app);
  for (const e of backTapAcrossSheet()) {
    const at = e.t + 500;
    if (at > clock.now()) clock.advance(at - clock.now());
    const ev = domEvent(e.type, { t: e.t, x: e.x, y: e.y });
    Object.defineProperty(ev, "landsOnBack", { value: e.onBack === true });
    target.dispatchEvent(ev);
  }
  for (const type of TAP_GUARD_EVENT_TYPES) target.removeEventListener(type, app);
  assert.deepEqual(seen, ["pointerdown", "touchstart", "pointerup", "touchend"], "nothing from the back button on");
  assert.equal(guard.isArmed(), true);
  clock.advance(TAP_GUARD_RELEASE_TAIL_MS);
  assert.equal(guard.isArmed(), false, "its release (handled at +802.5) + tail");
  assert.equal(live.size, 0);
  assert.equal(clock.pending(), 0);
});

// The dock band's raised shield cancels the touches begun on it (toggleTouchCancel), beside the guard the timeline
// button arms on the document. Node's EventTarget has no tree, so an event goes to the document's (capture)
// listeners first and reaches the shield only if they did not stop it.
const touchOn = (type, { t, x, y, id }) => {
  const ev = domEvent(type, { t, x, y });
  Object.defineProperty(ev, "changedTouches", { value: [{ identifier: id }] });
  return ev;
};
function dispatchThrough(doc, el, ev) {
  let stopped = false;
  const stop = ev.stopImmediatePropagation.bind(ev);
  Object.defineProperty(ev, "stopImmediatePropagation", { value: () => { stopped = true; stop(); } });
  doc.dispatchEvent(ev);
  if (!stopped) el.dispatchEvent(ev);
  return { stopped, prevented: ev.defaultPrevented };
}

test("late dispatch: the guard beside the dock band's raised shield (toggleTouchCancel) — a late 29 px tap the guard swallows never reaches the shield, so lowering it keeps no listener for that touch, and the guard still cancels its touchend; a late 31 px tap passes the guard and the shield cancels it", () => {
  const doc = makeTarget();
  const shield = makeRecordingTarget();
  const clock = makeClock();
  const guard = createTapGuard(doc.target, clock);
  guard.arm(domEvent("click", { t: T0, x: TL_X, y: TL_Y }));
  toggleTouchCancel(shield.target, true); // raised by the switch to MIN
  clock.advance(700); // a stall: both taps below handled late
  // Chromium dispatches a touch's pointer event first, then the touch event (same target).
  const through = (type, t, x, id) => {
    const pointer = type === "touchstart" ? "pointerdown" : "pointerup";
    dispatchThrough(doc.target, shield.target, domEvent(pointer, { t, x, y: TL_Y }));
    return dispatchThrough(doc.target, shield.target, touchOn(type, { t, x, y: TL_Y, id }));
  };
  assert.deepEqual(through("touchstart", T0 + 240, TL_X + 29, 1), { stopped: true, prevented: true }, "swallowed by the guard, at the document");
  toggleTouchCancel(shield.target, false); // lowered while that finger is down
  assert.equal(shield.live.size, 0, "the shield never saw that touch: nothing kept for it");
  assert.deepEqual(through("touchend", T0 + 290, TL_X + 29, 1), { stopped: true, prevented: true }, "its touchend still cancelled — by the guard");
  // Raised again: a 31 px tap, dated inside the window too, passes the guard; the shield takes and cancels it.
  toggleTouchCancel(shield.target, true);
  assert.deepEqual(through("touchstart", T0 + 250, TL_X + 31, 2), { stopped: false, prevented: true });
  toggleTouchCancel(shield.target, false);
  assert.equal(shield.live.size, 3, "kept while the touch begun on it is down");
  assert.deepEqual(through("touchend", T0 + 295, TL_X + 31, 2), { stopped: false, prevented: true });
  assert.equal(shield.live.size, 0);
  assert.equal(guard.isArmed(), true, "nothing dated after the window yet");
  guard.dispose();
});

test("late dispatch: the safety bound outlasts the window plus twice the worst measured dispatch delay — a press in the box dated +280 ms and handled 2 × 1306 ms late is still swallowed whole", () => {
  const worstLag = DISPATCH_LAGS[DISPATCH_LAGS.length - 1];
  assert.ok(TAP_GUARD_MAX_LIFETIME_MS >= TAP_GUARD_WINDOW_MS + 2 * worstLag, "the bound must not shrink below twice the worst delay seen");
  const late = lateSecondTap({ stamp: 280, lag: 2 * worstLag, x: X0 + 4, y: Y0 - 3 });
  assert.deepEqual(late.seen, []);
  assert.ok(late.prevented.every(Boolean));
});

// ------------------------------------------------------------- out of order: a touch tap's click comes after later presses

// Presses and releases are dispatched in input order, a touch tap's click is not. Its compatibility mousedown /
// mouseup and its click come from a GestureTap the browser sends once the renderer has acked the tap's touchend
// (ui/pressTint.js), so on a stalled main thread the touch events of a later tap, already queued, come first. Each
// tap below is split in two: its touch part (pointer and touch events) and its gesture part (compatibility mouse
// events and click).

const touchPart = (tag, t, up, p, extra = {}) => [
  ["pointerdown", { t, ...p, tag, ...extra }],
  ["touchstart", { t, ...p, tag, ...extra }],
  ["pointerup", { t: up, ...p, tag, ...extra }],
  ["touchend", { t: up, ...p, tag, ...extra }],
];
const gesturePart = (tag, up, p, extra = {}) => [
  ["mousedown", { t: up, ...p, tag, ...extra }],
  ["mouseup", { t: up, ...p, tag, ...extra }],
  ["click", { t: up, ...p, tag, ...extra }],
];
const TOUCH_TYPES = touchPart("", 0, 0, {}).map(([type]) => type);

/**
 * A guard on a page armed by the first tap's click at (X0, Y0) at T0, a page listener (added after the guard's)
 * recording what passes, and `play(from, order)`, which handles the events one per ms from `from` on the clock.
 *
 * @param {(event: Event) => void} [onClick] - Also run on every click that reaches the page.
 * @returns {object} the target, its live listeners, the clock, the guard, play() and of(tag) — the types of `tag`'s
 *   events the page saw
 */
function stalledPage(onClick) {
  const { target, live } = makeTarget();
  const clock = makeClock();
  const guard = createTapGuard(target, { ...clock, onBack: (ev) => ev.landsOnBack === true });
  guard.arm(domEvent("click", { t: T0, x: X0, y: Y0 }));
  const seen = [];
  for (const type of TAP_GUARD_EVENT_TYPES) {
    target.addEventListener(type, (ev) => {
      seen.push([ev.tag, ev.type]);
      if (type === "click" && onClick) onClick(ev);
    });
  }
  const play = (from, order) => {
    let at = Math.max(from, clock.now());
    for (const [type, { tag, back = false, cancelable = true, ...p }] of order) {
      at += 1;
      clock.advance(at - clock.now());
      const ev = domEvent(type, { ...p, cancelable });
      Object.defineProperty(ev, "tag", { value: tag });
      Object.defineProperty(ev, "landsOnBack", { value: back });
      target.dispatchEvent(ev);
    }
  };
  const of = (tag) => seen.filter(([t]) => t === tag).map(([, type]) => type);
  return { target, live, clock, guard, play, of };
}

test("out-of-order click: the back tap across the sheet with a third tap during the stall — C's click, handled after D's press, is still C's: on the back button, swallowed; D, pressed after the window, is delivered whole (the same in input order)", () => {
  const C = touchPart("C", T0 + 277.5, T0 + 302.5, OFF_BOX);
  const D = touchPart("D", T0 + 340, T0 + 380, { x: X0 + 300, y: Y0 + 300 });
  const gC = gesturePart("C", T0 + 302.5, OFF_BOX, { back: true });
  const gD = gesturePart("D", T0 + 380, { x: X0 + 300, y: Y0 + 300 });
  for (const order of [[...C, ...D, ...gC, ...gD], [...C, ...gC, ...D, ...gD]]) {
    const { play, of, guard, clock, live } = stalledPage();
    play(T0 + 900, order);
    assert.deepEqual(of("C"), TOUCH_TYPES, "nothing of C from the back button on");
    assert.deepEqual(of("D"), ALL_TYPES);
    assert.equal(guard.isArmed(), true, "C's click came: a tail after it");
    clock.advance(TAP_GUARD_RELEASE_TAIL_MS);
    assert.equal(guard.isArmed(), false);
    assert.equal(live.size, 0);
    assert.equal(clock.pending(), 0);
  }
});

test("out-of-order click: a passing tap's click handled after a swallowed tap's press goes to its own tap — it passes (a visible control never ignores a tap); the swallowed one stays swallowed whole", () => {
  const { play, of } = stalledPage();
  const C = { x: X0 + 40, y: Y0 }; // outside the box
  const B = { x: X0 + 3, y: Y0 + 2 }; // in the box
  play(T0 + 700, [
    ...touchPart("C", T0 + 150, T0 + 180, C),
    ...touchPart("B", T0 + 250, T0 + 280, B),
    ...gesturePart("C", T0 + 180, C),
  ]);
  assert.deepEqual(of("C"), ALL_TYPES);
  assert.deepEqual(of("B"), []);
});

test("out-of-order click: a swallowed tap whose touch could not be cancelled (touchstart and touchend dispatched non-blocking) — its click, handled after a later press and after a 1 s task, stays swallowed: the guard waits for it on events", () => {
  const { play, of, clock, guard } = stalledPage();
  const nb = { cancelable: false };
  play(T0 + 800, [...touchPart("B", T0 + 250, T0 + 290, { x: X0, y: Y0 }, nb), ...touchPart("D", T0 + 340, T0 + 370, { x: X0 + 300, y: Y0 })]);
  clock.advance(1000);
  assert.equal(guard.isArmed(), true, "B's click may still be queued");
  play(clock.now(), gesturePart("B", T0 + 290, { x: X0, y: Y0 }));
  assert.deepEqual(of("B"), []);
  assert.deepEqual(of("D"), TOUCH_TYPES);
});

test("out-of-order click: an event that is no input in order — a script's click() at +600 ms, or one the guard had to date by the clock — does not end the guard: a press dated inside the window, handled after it, is still swallowed", () => {
  for (const stamp of [T0 + 600, 0]) {
    const { play, of, guard } = stalledPage();
    play(T0 + 599, [["click", { t: stamp, x: 10, y: 10, detail: 0, tag: "S" }]]);
    assert.deepEqual(of("S"), ["click"], "it follows no gesture: it passes");
    assert.equal(guard.isArmed(), true);
    play(T0 + 600, [...touchPart("B", T0 + 250, T0 + 290, { x: X0, y: Y0 }), ...gesturePart("B", T0 + 290, { x: X0, y: Y0 })]);
    assert.deepEqual(of("B"), [], `stamp ${stamp}`);
    guard.dispose();
  }
});

test("out-of-order click: two commands of one component (the dock's buttons share one guard) — C's click arms it again, and B, swallowed under the first arming, keeps its verdict: its late click stays swallowed", () => {
  let page = null;
  page = stalledPage((ev) => { if (ev.tag === "C") page.guard.arm(ev); });
  const nb = { cancelable: false };
  page.play(T0 + 800, [
    ...touchPart("C", T0 + 200, T0 + 230, { x: X0 + 90, y: Y0 }), // another button, outside the box: passes
    ...touchPart("B", T0 + 250, T0 + 290, { x: X0, y: Y0 }, nb), // in the box: swallowed (its touch not cancellable)
    ...gesturePart("C", T0 + 230, { x: X0 + 90, y: Y0 }),
    ...gesturePart("B", T0 + 290, { x: X0, y: Y0 }),
  ]);
  assert.deepEqual(page.of("C"), ALL_TYPES, "C's click reaches its button (and arms the guard again)");
  assert.deepEqual(page.of("B"), []);
  page.guard.dispose();
  // Pure: the new click's window, box and bound, the gestures seen with their verdicts, no overAt yet.
  const prev = run(armed(), [
    { type: "pointerdown", t: T0 + 250, x: X0, y: Y0, isPrimary: true },
    { type: "pointerup", t: T0 + 320, x: X0, y: Y0, isPrimary: true },
  ]).state;
  const next = armTapGuard({ clientX: X0 + 90, clientY: Y0, t: T0 + 400, detail: 1 });
  const again = rearmTapGuard(prev, next);
  assert.equal(again.armedAt, T0 + 400);
  assert.equal(again.box.left, X0 + 90 - TAP_GUARD_BOX_WIDTH / 2);
  assert.equal(again.overAt, null);
  assert.equal(again.gestures, prev.gestures);
  assert.equal(stepTapGuard(again, { type: "click", t: T0 + 320, x: X0, y: Y0 }).swallow, true);
  assert.equal(rearmTapGuard(null, next), next);
  assert.equal(rearmTapGuard(prev, null), null);
  assert.equal(rearmTapGuard(armed(), next), next, "no gesture seen: the new state as is");
});

test("out-of-order click: the back tap across the sheet under touch with a long task after C's touchend — C's touch is never cancelled (it passes), so its click comes; the guard waits for it on events, not on a tail on the clock, and still swallows it on the back button 350 ms later", () => {
  const { play, of, clock, guard, live } = stalledPage();
  play(T0 + 900, touchPart("C", T0 + 277.5, T0 + 302.5, OFF_BOX));
  clock.advance(350);
  assert.equal(guard.isArmed(), true);
  play(clock.now(), gesturePart("C", T0 + 302.5, OFF_BOX, { back: true }));
  assert.deepEqual(of("C"), TOUCH_TYPES);
  clock.advance(TAP_GUARD_RELEASE_TAIL_MS);
  assert.equal(guard.isArmed(), false);
  assert.equal(live.size, 0);
});

test("out-of-order click: no click will come — the guard cancelled the swallowed tap (a cancelable touchstart or touchend) or the browser took the touch over (pointercancel): a tail on the clock after the release is enough; with a click that may come, only an event ends the wait — the click, or a press or release dated past the gesture's tail", () => {
  const cap = T0 + TAP_GUARD_MAX_LIFETIME_MS;
  const tail = TAP_GUARD_RELEASE_TAIL_MS;
  const swallowedTap = (startCancelable, endCancelable) => run(armed(), [
    { type: "pointerdown", t: T0 + 240, x: X0, y: Y0, isPrimary: true },
    { type: "touchstart", t: T0 + 240, x: X0, y: Y0, cancelable: startCancelable },
    { type: "pointerup", t: T0 + 330, x: X0, y: Y0, isPrimary: true },
    { type: "touchend", t: T0 + 330, x: X0, y: Y0, cancelable: endCancelable },
  ]).state;
  assert.equal(tapGuardRetireAt(swallowedTap(true, true)), T0 + 330 + tail, "touchstart cancelled");
  assert.equal(tapGuardRetireAt(swallowedTap(false, true)), T0 + 330 + tail, "touchend cancelled: the second chance");
  const uncancelled = swallowedTap(false, false);
  assert.equal(tapGuardRetireAt(uncancelled), cap, "its click will come: wait for it");
  // A press dated +629.9 (inside the gesture's tail) keeps it; one dated +630 takes it off the list.
  const near = stepTapGuard(uncancelled, { type: "pointerdown", t: T0 + 629.9, x: X0 + 200, y: Y0, isPrimary: true }).state;
  assert.equal(tapGuardRetireAt(near), cap);
  const far = stepTapGuard(uncancelled, { type: "pointerdown", t: T0 + 630, x: X0 + 200, y: Y0, isPrimary: true }).state;
  assert.equal(far.gestures.length, 1);
  assert.equal(tapGuardRetireAt(far), T0 + 330, "nothing left to follow: at once");
  // A passing gesture begun inside the window, the touch taken over by a scroll: no click, no wait for one. (A
  // pointercancel tells nothing of the queue — it follows the scroll's start, not the input — so a later press does.)
  const scrolled = run(armed(), [
    { type: "pointerdown", t: T0 + 200, ...OFF_BOX, isPrimary: true },
    { type: "pointercancel", t: T0 + 320, ...OFF_BOX, isPrimary: true },
  ]).state;
  assert.equal(lastGesture(scrolled).noClick, true);
  assert.equal(scrolled.overAt, null);
  const thenPress = stepTapGuard(scrolled, { type: "pointerdown", t: T0 + 330, x: X0 + 200, y: Y0, isPrimary: true }).state;
  assert.equal(tapGuardRetireAt(thenPress), T0 + 320 + tail);
  // A touchstart that passes is not cancelled: no `noClick`.
  const passing = run(armed(), [
    { type: "pointerdown", t: T0 + 200, ...OFF_BOX, isPrimary: true },
    { type: "touchstart", t: T0 + 200, ...OFF_BOX, cancelable: true },
  ]).state;
  assert.equal(lastGesture(passing).noClick, false);
});

test("out-of-order click: the guard keeps the last TAP_GUARD_MAX_GESTURES gestures, the oldest going first", () => {
  const presses = Array.from({ length: TAP_GUARD_MAX_GESTURES + 4 }, (_, i) => ({ type: "pointerdown", t: T0 + 10 * (i + 1), x: X0 + 200, y: Y0, isPrimary: true }));
  const { state } = run(armed(), presses);
  assert.equal(state.gestures.length, TAP_GUARD_MAX_GESTURES);
  assert.equal(state.gestures[0].downAt, T0 + 50);
  assert.ok(Object.isFrozen(state.gestures));
});
