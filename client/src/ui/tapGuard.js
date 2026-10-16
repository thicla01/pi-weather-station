// Tap guard — keeps the second tap of a double tap away from what the first
// tap brought under the finger.
//
// Some controls change what sits under the finger: the alert card's ⤢ on the
// short Pi rail opens the full Alert view, whose back button lands where the
// ⤢ was. A double tap on the ⤢ then opened the view and closed it at once:
// the second tap reached the back button. The decision (designer's
// "Document 9", point 6, among the maintainer's decisions, 2026-10-14) is an
// event-level guard that any such command can pose, not a per-control fix:
//
//   - the command arms the guard from the click that ran it (its own tap);
//   - for TAP_GUARD_WINDOW_MS after that click, a press inside a
//     TAP_GUARD_BOX_WIDTH × TAP_GUARD_BOX_HEIGHT box centred on the click is
//     swallowed, together with every later event of the same tap: pointer,
//     touch, the compatibility mouse events, click and dblclick;
//   - outside the box, or once the window is over, every tap passes. The
//     first tap is never touched: the guard only exists from its click on.
//
// One gesture, one decision. The decision is taken at the gesture's primary
// pointerdown (the first event of any tap, before touchstart and the
// compatibility mouse events) and applied to the rest of the gesture, so a
// tap pressed at +240 ms whose release and click come at +330 ms is still
// swallowed whole, and a tap pressed outside the box whose release drifts
// into it still passes whole. A later event that follows no pointerdown (the
// first tap's own leftovers, if any) passes.
//
// Time is the events' own `timeStamp` (input time, the clock of
// performance.now()), not the time the handler runs, so a long frame while
// the view opens (a loaded Pi 3B) cannot push a second tap pressed at +250 ms
// past the window.
//
// The listeners exist only while the guard does: they are added when the
// guard arms and removed when it retires (window over and no swallowed tap
// still in progress, or after TAP_GUARD_MAX_LIFETIME_MS at the latest), by a
// timer the guard clears itself. `dispose()` retires it at once (unmount).
// That lifetime runs on the clock from the moment the guard armed, not from
// the click's timeStamp: when the click itself was handled late (a long
// frame), a second tap pressed inside the window may still be queued behind
// it, and the guard must still be listening when it is dispatched. Keeping
// the listeners longer never changes a verdict: a press after the window
// passes, whenever it is dispatched.
//
// They are capture-phase listeners on the document, so they run before
// React's root listeners and before any element's handler, and they are
// non-passive (`passive: false`): Chrome treats a document-level touchstart
// listener as passive unless told otherwise, and only a cancelable
// touchstart can stop the browser from turning the tap into a click. The
// guard still stops the click itself, in case the touchstart was not
// cancelable.
//
// MODULE FORMAT: CommonJS on purpose, like ui/radarTileCooldown.js, so
// test/tapGuard.test.js runs the real module under `node --test`. The pure
// part (box, window, one step per event, retire time) touches no DOM;
// createTapGuard() is the DOM side, written against the EventTarget API
// only (Node has one, so the tests run it too). React components use it
// through hooks/useTapGuard.js.

/** How long after the arming click a second tap is swallowed (ms). */
const TAP_GUARD_WINDOW_MS = 300;

/** Width of the guarded box, centred on the arming click (CSS px). */
const TAP_GUARD_BOX_WIDTH = 60;

/** Height of the guarded box, centred on the arming click (CSS px). */
const TAP_GUARD_BOX_HEIGHT = 58;

/**
 * How long the listeners stay after a swallowed tap's release, past the
 * window: the click (and dblclick) a release produces arrive after it, a
 * frame later for a touch tap on a busy main thread.
 */
const TAP_GUARD_RELEASE_TAIL_MS = 300;

/** Hard bound on the guard's life, a finger held down included (ms). */
const TAP_GUARD_MAX_LIFETIME_MS = 10_000;

/**
 * A timestamp further than this from the clock is taken to be in another
 * time base (an epoch timestamp from an old engine), and the clock is used.
 */
const TAP_GUARD_CLOCK_SKEW_MS = 60_000;

/** Every event type of a tap the guard can swallow. */
const TAP_GUARD_EVENT_TYPES = Object.freeze([
  "pointerdown",
  "pointerup",
  "pointercancel",
  "touchstart",
  "touchend",
  "touchcancel",
  "mousedown",
  "mouseup",
  "click",
  "dblclick",
]);

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * The guarded box, centred on (x, y).
 *
 * @param {number} x - Centre, CSS px from the viewport's left edge.
 * @param {number} y - Centre, CSS px from the viewport's top edge.
 * @param {object} [size] - Box size.
 * @param {number} [size.width] - Box width (CSS px).
 * @param {number} [size.height] - Box height (CSS px).
 * @returns {{left: number, top: number, right: number, bottom: number}} the box edges
 */
function guardBox(x, y, { width = TAP_GUARD_BOX_WIDTH, height = TAP_GUARD_BOX_HEIGHT } = {}) {
  return Object.freeze({
    left: x - width / 2,
    top: y - height / 2,
    right: x + width / 2,
    bottom: y + height / 2,
  });
}

/**
 * True when (x, y) lies in the box. EDGES INCLUDED: with the default box a
 * press exactly 30 px left or right of the arming click, or exactly 29 px
 * above or below it, is in the box (swallowed inside the window); 30.01 px
 * or 29.01 px away is out. A point with a missing coordinate is out.
 *
 * @param {{left: number, top: number, right: number, bottom: number}} box - From guardBox().
 * @param {number} x - CSS px.
 * @param {number} y - CSS px.
 * @returns {boolean} true when the point is inside the box or on its edge
 */
function inGuardBox(box, x, y) {
  if (!box || !isNum(x) || !isNum(y)) return false;
  return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
}

/**
 * True when time t falls in the guard's window. START INCLUDED, END
 * EXCLUDED: [armedAt, armedAt + windowMs). A press at +299.9 ms is in, at
 * exactly +300 ms it is out. A press dated before the arming click (the
 * first tap's own) is out: the first tap is never touched.
 *
 * @param {number} armedAt - The arming click's time (ms).
 * @param {number} t - The press's time (ms, same clock).
 * @param {number} [windowMs] - Window length.
 * @returns {boolean} true when the press is inside the window
 */
function inGuardWindow(armedAt, t, windowMs = TAP_GUARD_WINDOW_MS) {
  if (!isNum(armedAt) || !isNum(t)) return false;
  return t >= armedAt && t - armedAt < windowMs;
}

/**
 * An event's time on the clock's base: its `timeStamp` when that reads as
 * a time on the same base as `now`, else `now` itself.
 *
 * @param {number} timeStamp - The event's timeStamp.
 * @param {number} now - The clock (performance.now()).
 * @returns {number} the time to use for the event (ms)
 */
function eventTime(timeStamp, now) {
  if (isNum(timeStamp) && timeStamp > 0 && Math.abs(timeStamp - now) <= TAP_GUARD_CLOCK_SKEW_MS) {
    return timeStamp;
  }
  return now;
}

/**
 * The guard's state right after the click that arms it, or null when that
 * click must not arm it: a keyboard or programmatic activation (`detail` 0:
 * no finger, no double tap) or a click without coordinates.
 *
 * @param {object} click - The arming click (a DOM click event or the same fields).
 * @param {number} click.clientX - CSS px.
 * @param {number} click.clientY - CSS px.
 * @param {number} click.t - The click's time (ms, see eventTime): the window starts there.
 * @param {number} [click.now] - The clock when the guard arms (ms, default
 *   `t`): the listeners' lifetime starts there (never before `t`).
 * @param {number} [click.detail] - The click count (0 for a keyboard activation).
 * @param {object} [options] - Guard geometry and timing (defaults: the constants above).
 * @param {number} [options.windowMs] - Window length.
 * @param {number} [options.width] - Box width.
 * @param {number} [options.height] - Box height.
 * @param {number} [options.tailMs] - Listener tail after a swallowed release.
 * @param {number} [options.maxLifetimeMs] - Hard bound on the guard's life.
 * @returns {?object} the armed state, or null
 */
function armTapGuard(click, {
  windowMs = TAP_GUARD_WINDOW_MS,
  width = TAP_GUARD_BOX_WIDTH,
  height = TAP_GUARD_BOX_HEIGHT,
  tailMs = TAP_GUARD_RELEASE_TAIL_MS,
  maxLifetimeMs = TAP_GUARD_MAX_LIFETIME_MS,
} = {}) {
  if (!click || click.detail === 0) return null;
  const { clientX: x, clientY: y, t, now } = click;
  if (!isNum(x) || !isNum(y) || !isNum(t)) return null;
  return Object.freeze({
    box: guardBox(x, y, { width, height }),
    armedAt: t,
    listenFrom: isNum(now) ? Math.max(t, now) : t,
    windowMs,
    tailMs,
    maxLifetimeMs,
    gesture: null,
  });
}

/**
 * One event through the guard: whether to swallow it, and the next state.
 *
 * A primary pointerdown starts a gesture and decides it (inside the window
 * AND inside the box → swallowed). Every other event follows the gesture in
 * progress (a non-primary pointerdown — a second finger — included); with no
 * gesture since the guard armed, it passes. The primary pointerup /
 * pointercancel marks the gesture released (its time feeds the retire time).
 *
 * @param {?object} state - From armTapGuard() or a previous step (null: disarmed).
 * @param {object} ev - The event.
 * @param {string} ev.type - One of TAP_GUARD_EVENT_TYPES.
 * @param {number} ev.t - Its time (ms, see eventTime): the verdict uses it.
 * @param {number} [ev.seenAt] - The clock when it was handled (ms, default
 *   `t`): a release's tail starts at the later of the two.
 * @param {number} [ev.x] - clientX (CSS px).
 * @param {number} [ev.y] - clientY (CSS px).
 * @param {boolean} [ev.isPrimary] - false for a pointer event of a second finger.
 * @returns {{state: ?object, swallow: boolean}} the next state and the verdict
 */
function stepTapGuard(state, ev) {
  if (!state || !ev) return { state, swallow: false };
  const { gesture } = state;
  const primary = ev.isPrimary !== false;
  if (ev.type === "pointerdown" && (primary || !gesture)) {
    const swallow = inGuardWindow(state.armedAt, ev.t, state.windowMs) && inGuardBox(state.box, ev.x, ev.y);
    return {
      state: Object.freeze({ ...state, gesture: Object.freeze({ swallow, down: true, releasedAt: null }) }),
      swallow,
    };
  }
  const swallow = Boolean(gesture && gesture.swallow);
  if ((ev.type === "pointerup" || ev.type === "pointercancel") && primary && gesture && gesture.down) {
    return {
      state: Object.freeze({
        ...state,
        gesture: Object.freeze({ ...gesture, down: false, releasedAt: isNum(ev.seenAt) ? Math.max(ev.t, ev.seenAt) : ev.t }),
      }),
      swallow,
    };
  }
  return { state, swallow };
}

/**
 * When the guard may retire (remove its listeners), on the clock: the
 * window's length after the guard armed (`listenFrom`), or — while a
 * swallowed tap is in progress — its release plus TAP_GUARD_RELEASE_TAIL_MS
 * (the finger still down: the hard bound), never later than listenFrom +
 * maxLifetimeMs.
 *
 * @param {?object} state - The guard's state.
 * @returns {number} the retire time (ms; -Infinity when disarmed)
 */
function tapGuardRetireAt(state) {
  if (!state) return -Infinity;
  const from = isNum(state.listenFrom) ? state.listenFrom : state.armedAt;
  const cap = from + state.maxLifetimeMs;
  const { gesture } = state;
  let end = from + state.windowMs;
  if (gesture && gesture.swallow) {
    if (gesture.down) return cap;
    end = Math.max(end, gesture.releasedAt + state.tailMs);
  }
  return Math.min(end, cap);
}

/**
 * The DOM side: a guard on `target` (the document) that a command arms from
 * its click handler. No listener exists until `arm()`; they go when the guard
 * retires, on its own timer, or on `dispose()`.
 *
 * @param {EventTarget} target - Where the capture listeners go (document).
 * @param {object} [options] - Clock, timers, geometry.
 * @param {() => number} [options.now] - Clock (default performance.now).
 * @param {(fn: () => void, ms: number) => number} [options.setTimer] - Default setTimeout.
 * @param {(id: number) => void} [options.clearTimer] - Default clearTimeout.
 * @param {number} [options.windowMs] - Window length.
 * @param {number} [options.width] - Box width.
 * @param {number} [options.height] - Box height.
 * @param {number} [options.tailMs] - Listener tail after a swallowed release.
 * @param {number} [options.maxLifetimeMs] - Hard bound on the guard's life.
 * @returns {{arm: (click: object) => boolean, dispose: () => void, isArmed: () => boolean}}
 *   arm(click) arms (or re-arms) the guard from the click that ran the command
 *   and returns whether it did; dispose() retires it now; isArmed() says
 *   whether its listeners are in place.
 */
function createTapGuard(target, {
  now = () => performance.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  ...geometry
} = {}) {
  let state = null;
  let timer = null;
  const listenerOptions = { capture: true, passive: false };

  const clear = () => {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  };

  const onEvent = (event) => {
    if (!state) return;
    const seenAt = now();
    const step = stepTapGuard(state, {
      type: event.type,
      t: eventTime(event.timeStamp, seenAt),
      seenAt,
      x: event.clientX,
      y: event.clientY,
      isPrimary: event.isPrimary,
    });
    ({ state } = step);
    if (step.swallow) {
      if (event.cancelable) event.preventDefault();
      event.stopImmediatePropagation();
    }
    // A press or a release moves the retire time. (`schedule` is defined
    // below; the listener only runs once arm() has added it, after.)
    if (event.type === "pointerdown" || event.type === "pointerup" || event.type === "pointercancel") {
      schedule();
    }
  };

  const retire = () => {
    clear();
    if (!state) return;
    state = null;
    for (const type of TAP_GUARD_EVENT_TYPES) target.removeEventListener(type, onEvent, listenerOptions);
  };

  const schedule = () => {
    clear();
    if (!state) return;
    const delay = tapGuardRetireAt(state) - now();
    if (delay <= 0) {
      retire();
      return;
    }
    timer = setTimer(() => {
      timer = null;
      schedule();
    }, delay);
  };

  return {
    arm(click) {
      if (!click) return false;
      const armedNow = now();
      const next = armTapGuard({
        clientX: click.clientX,
        clientY: click.clientY,
        detail: click.detail,
        t: eventTime(click.timeStamp, armedNow),
        now: armedNow,
      }, geometry);
      if (!next) return false;
      if (!state) {
        for (const type of TAP_GUARD_EVENT_TYPES) target.addEventListener(type, onEvent, listenerOptions);
      }
      state = next;
      schedule();
      return state !== null;
    },
    dispose: retire,
    isArmed: () => state !== null,
  };
}

module.exports = {
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
};
