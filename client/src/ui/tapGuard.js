// Tap guard — keeps the second tap of a double tap away from what the first
// tap brought under the finger.
//
// Some controls change what sits under the finger: the alert card on
// the short Pi rail (one button) opens the full Alert view, whose back
// button lands near the card's top-right corner, where its ⤢ cue sits.
// A double tap on the ⤢ then opened the view and closed it at once:
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
// The one exception, a view's back button under the overlay shell
// (SHELL_BACK_SELECTOR, over the whole gesture): a gesture begun inside
// the window is swallowed if it lands on that button, wherever the first
// tap was, box or not — at its pointerdown, or at any later event of the
// gesture, the click included, even when that click comes after the
// window. The button travels with the sliding sheet: in one measured case
// a tap pressed the moving sheet outside the box at +277.5 ms, released at
// +302.5 ms, and its click, handled at +336 ms, reached the back button
// that had arrived under the finger and closed the view. The events
// dispatched before the one that lands on the
// button (that pointerdown and touchstart, on the sheet) have already
// passed; from that event on, everything of the gesture is swallowed, so
// the click never reaches the button. The guard keeps listening to such a
// gesture until it ends: its click, or — if none comes — the press or
// release that takes it off the guard's list (see below).
//
// Time is the events' own `timeStamp` (input time, the clock of
// performance.now()), not the time the handler runs, so a long frame while
// the view opens (a loaded Pi 3B) cannot push a second tap pressed at +250 ms
// past the window.
//
// The listeners exist only while the guard does: they are added when the
// guard arms and removed when it retires. It retires on EVENTS, not on the
// clock's window: its listeners stay as long as a press dated inside the
// window may still be waiting in the queue. Before, PR 412 removed them on
// a timer at the window's end on the clock, and a second tap pressed
// inside the window but dispatched after it — the main thread or the input
// pipeline stalled: 116 to 1087 ms late on a loaded Mac, its timer having
// run first — found no listener and passed.
//
// Presses and releases are dispatched in input order; a touch tap's click
// is not. Its compatibility mousedown / mouseup and its click come from a
// GestureTap the browser sends only once the renderer has acked the tap's
// touchend (ui/pressTint.js), so on a stalled main thread the touch events
// of a later tap, already queued, are dispatched BEFORE that click. Hence:
//
//   - only a pointerdown or a pointerup dated by its own timeStamp at or
//     after the window's end (`overAt`) tells the guard that no press dated
//     inside the window can still be queued — not a click (a touch tap's
//     comes late; a keyboard activation or a script's click() is no input
//     at all), not a pointercancel (it follows a scroll's start, on the
//     gesture path too), nor an event the guard had to date by the clock
//     (eventTime's fallback);
//   - the guard keeps the gestures it has seen (the last
//     TAP_GUARD_MAX_GESTURES), and an event other than a primary
//     pointerdown goes to the last gesture pressed at or before the event's
//     time: a late click to its own tap, not to the tap pressed after it;
//   - a gesture leaves that list when a press or a release dated by its own
//     timeStamp comes at or after the gesture's release (when it was
//     handled) plus TAP_GUARD_RELEASE_TAIL_MS: that input was made once the
//     gesture's GestureTap had been queued, so nothing of the gesture can
//     still come after it;
//   - a released gesture the guard still follows (a swallowed tap, or one
//     begun inside the window that passes so far: the back-button
//     exception) waits for its click on EVENTS — the click, or the press or
//     release that takes the gesture off the list — never on the clock: a
//     long task after its touchend can hold its GestureTap back past any
//     tail. Unless no click will come: the guard cancelled the tap (it
//     swallowed a cancelable touchstart or touchend) or the browser took
//     the touch over (pointercancel). Then, as once its click has come (its
//     dblclick follows in the same task), a tail on the clock is enough:
//     TAP_GUARD_RELEASE_TAIL_MS after its release or its click;
//   - arming the guard again (another command of the same component: the
//     dock's buttons share one guard) keeps those gestures and their
//     verdicts.
//
// Not covered: a second tap whose press is dispatched before the first
// tap's own click (a stall that began before that click) has passed before
// the guard exists; its click then follows no gesture the guard has seen,
// and passes.
//
// So once `overAt` is set, the guard retires as soon as it follows no
// gesture: at once, or at the end of the last one it follows (above).
// Before that, nothing tells it the queue holds no press of the window, so
// it keeps listening, up to TAP_GUARD_MAX_LIFETIME_MS after it armed (the
// safety timer, which also bounds a finger held down and a click that never
// comes). The timer is the guard's own, cleared and set again as its state
// changes; `dispose()` retires it at once (unmount). The bound runs on the
// clock from the moment the guard armed (`listenFrom`), not from the
// click's timeStamp. Keeping the listeners longer never changes a verdict:
// a press after the window passes, whenever it is dispatched. Their cost:
// while they stay, a touch anywhere starts as blocking (a non-passive
// document touchstart listener), the first one after the window included —
// which then retires the guard. That changes something only where a touch
// would not block anyway: not on the map (Leaflet's own listeners) nor on
// the views' shield (the strip of map beside an open view's sheet), but on
// the overlay shell's rail frame and live dock after a MIN ↔ MID command,
// and on a view's sheet after the command that opened it: each carries a
// `touch-action: manipulation` region (LayoutPi/styles.css), so a touch
// there blocks only while these listeners stay. Only the commands of the
// priority views, which run in the overlay shell, arm the guard (except
// after a viewport crossing 540 px under a mounted LayoutPi, when the
// dock's view buttons can arm it on the stacked rail: ROADMAP.md). A tap is
// not delayed (its click waits for the touchend, already blocking: React's
// root listener); a scroll's start waits for the main thread. Hence a short
// safety bound.
//
// A released gesture also ends on the events' own time: an event dated at
// or after its release plus TAP_GUARD_RELEASE_TAIL_MS is not part of it (a
// click dated in that tail and dispatched late still is), so a guard still
// listening long after a swallowed tap never swallows a later stray event
// (a keyboard activation, a script's click()) as that tap's.
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
 * A released gesture's tail (ms): the click (and dblclick) a release
 * produces arrive after it, a frame later for a touch tap on a busy main
 * thread. An event dated within it still belongs to the gesture; a press
 * or a release dated past it takes the gesture off the guard's list; and
 * once a press or release dated after the window has come, the listeners
 * stay that long after the release (or the click) of a swallowed gesture
 * that has no click left to wait for.
 */
const TAP_GUARD_RELEASE_TAIL_MS = 300;

/**
 * The safety bound on the guard's life (ms), counted from the moment it
 * armed: it retires then if no press or release dated after the window has
 * come (so nothing has told it no press of the window is left in the
 * queue), if a finger is still held down, or if a gesture it follows still
 * awaits a click. Sized on the worst dispatch delay measured so far, about
 * twice over: a press handled 1.3 s after its stamp (on a loaded Mac); a
 * press dated at the window's
 * end and handled up to 2.7 s later still finds the guard. Short on
 * purpose: in ordinary use nothing retires the guard before this bound
 * (the user reads the view the command opened), and while it stays a touch
 * anywhere starts as blocking (see the header). A touch held past it
 * yields no click anyway (a long press), so it bounds a held finger too.
 */
const TAP_GUARD_MAX_LIFETIME_MS = 3_000;

/**
 * A timestamp further than this from the clock is taken to be in another
 * time base (an epoch timestamp from an old engine), and the clock is used.
 */
const TAP_GUARD_CLOCK_SKEW_MS = 60_000;

/**
 * How many gestures the guard keeps for routing a late event to its own
 * gesture (the oldest go first). More taps than this inside one stall is
 * beyond any double tap.
 */
const TAP_GUARD_MAX_GESTURES = 8;

/**
 * The events dispatched in input order, the only ones whose time tells the
 * guard where the queue stands (see the header): not a touch tap's
 * compatibility mouse events nor its click, which come from a GestureTap
 * sent after its touchend's ack, not a pointercancel (a scroll's start),
 * and not a keyboard or script click.
 */
const TAP_GUARD_IN_ORDER_TYPES = Object.freeze(["pointerdown", "pointerup"]);

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
 * True when time t falls after the guard's window: at or after armedAt +
 * windowMs (the window's end is excluded from it, so +300 ms is after). A
 * press or a release so dated by its own timeStamp tells the guard that no
 * press dated inside the window can still be queued behind it (presses and
 * releases are dispatched in input order; clicks are not: see the header).
 * A time before the arming click is not after the window.
 *
 * @param {number} armedAt - The arming click's time (ms).
 * @param {number} t - The event's time (ms, same clock).
 * @param {number} [windowMs] - Window length.
 * @returns {boolean} true when the event is dated after the window
 */
function pastGuardWindow(armedAt, t, windowMs = TAP_GUARD_WINDOW_MS) {
  if (!isNum(armedAt) || !isNum(t)) return false;
  return t - armedAt >= windowMs;
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

/** No gesture seen yet (shared, frozen). */
const NO_GESTURES = Object.freeze([]);

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
 *   `t`): the safety bound on the listeners' life counts from there (never
 *   before `t`).
 * @param {number} [click.detail] - The click count (0 for a keyboard activation).
 * @param {object} [options] - Guard geometry and timing (defaults: the constants above).
 * @param {number} [options.windowMs] - Window length.
 * @param {number} [options.width] - Box width.
 * @param {number} [options.height] - Box height.
 * @param {number} [options.tailMs] - A released gesture's tail.
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
    gestures: NO_GESTURES,
    overAt: null,
  });
}

/**
 * A guard armed again while it still listens (another command of the same
 * component: the dock's buttons share one guard): the new click's window,
 * box and bound, with the gestures the guard has seen and their verdicts —
 * a swallowed tap's click may still be queued behind the new arming click.
 *
 * @param {?object} previous - The guard's state before (null: not armed).
 * @param {?object} next - From armTapGuard() for the new click.
 * @returns {?object} the armed state (null when `next` is null)
 */
function rearmTapGuard(previous, next) {
  if (!next || !previous || previous.gestures.length === 0) return next;
  return Object.freeze({ ...next, gestures: previous.gestures });
}

/**
 * Where an event at time t goes among the guard's gestures (see the
 * header): the index of the last gesture pressed at or before t — a touch
 * tap's click can be dispatched after a later tap's press — or -1 when
 * there is none, or when that gesture was released and t is at or after its
 * release plus the tail (the event follows no gesture). Last by press time,
 * not by list order (a press the guard had to date by the clock is out of
 * order); on a tie, the later one in the list. Without a time: the last
 * gesture in the list.
 *
 * @param {object} state - The guard's state.
 * @param {number} [t] - The event's time (ms, see eventTime).
 * @returns {number} the index in state.gestures, or -1
 */
function gestureIndexAt(state, t) {
  const { gestures, tailMs } = state;
  if (!isNum(t)) return gestures.length - 1;
  let found = -1;
  gestures.forEach((g, i) => {
    if (g.downAt <= t && (found < 0 || g.downAt >= gestures[found].downAt)) found = i;
  });
  if (found < 0) return -1;
  const g = gestures[found];
  return g.down || t - g.releasedAt < tailMs ? found : -1;
}

/**
 * The gesture an event at time t belongs to (gestureIndexAt), or null.
 *
 * @param {object} state - The guard's state.
 * @param {number} [t] - The event's time (ms, see eventTime).
 * @returns {?object} the gesture, or null
 */
function gestureAt(state, t) {
  const i = gestureIndexAt(state, t);
  return i < 0 ? null : state.gestures[i];
}

/**
 * One event through the guard: whether to swallow it, and the next state.
 *
 * A primary pointerdown starts a gesture and decides it (inside the window
 * AND inside the box → swallowed). Every other event goes to its gesture
 * (gestureIndexAt: the last one pressed at or before its time — a
 * non-primary pointerdown, a second finger, included) and takes that
 * gesture's verdict; with none, it passes. The primary pointerup /
 * pointercancel marks the gesture released (when it was handled: its tail
 * and the retire time count from there). The back-button exception: a
 * gesture begun inside the window that still passes is swallowed from its
 * first later event that lands on a view's back button under the overlay
 * shell (`onBack`) to its end. A gesture records its click (`clicked`),
 * and that no click will come (`noClick`: a pointercancel, or a cancelable
 * touchstart or touchend swallowed here, which the guard cancels). A press
 * or a release dated by its own timeStamp (`dated`) is in input order: the
 * first one dated after the window records when it was handled (`overAt`,
 * from then on the guard may retire: tapGuardRetireAt), and any one takes
 * off the list the released gestures it is dated past the tail of.
 *
 * @param {?object} state - From armTapGuard() or a previous step (null: disarmed).
 * @param {object} ev - The event.
 * @param {string} ev.type - One of TAP_GUARD_EVENT_TYPES.
 * @param {number} ev.t - Its time (ms, see eventTime): the verdict uses it.
 * @param {boolean} [ev.dated] - false when `t` is not the event's own
 *   timeStamp (eventTime's fallback to the clock); default true.
 * @param {number} [ev.seenAt] - The clock when it was handled (ms, default
 *   `t`): a release's tail, a click's, and `overAt` start at the later of
 *   the two.
 * @param {number} [ev.x] - clientX (CSS px).
 * @param {number} [ev.y] - clientY (CSS px).
 * @param {boolean} [ev.isPrimary] - false for a pointer event of a second finger.
 * @param {boolean} [ev.cancelable] - The event is cancelable (a touchstart
 *   or touchend the guard swallows is then cancelled: no click will come).
 * @param {boolean} [ev.onBack] - The event lands on a view's back button
 *   (overlay shell only): a press there inside the window is swallowed
 *   wherever it is, box or not, and so is the rest of a gesture begun
 *   inside the window from its first later event there — the one exception
 *   to "a visible control never ignores a tap".
 * @returns {{state: ?object, swallow: boolean}} the next state and the verdict
 */
function stepTapGuard(state, ev) {
  if (!state || !ev) return { state, swallow: false };
  const seenAt = isNum(ev.seenAt) ? Math.max(ev.t, ev.seenAt) : ev.t;
  // A press or a release dated by its own timeStamp: dispatched in input order (see the header).
  const inOrder = ev.dated !== false && isNum(ev.t) && TAP_GUARD_IN_ORDER_TYPES.includes(ev.type);
  // The first one dated after the window: none of the window's presses is left behind it.
  let { overAt } = state;
  if (!isNum(overAt) && inOrder && pastGuardWindow(state.armedAt, ev.t, state.windowMs)) overAt = seenAt;
  const before = state.gestures;
  let gestures = before;
  const index = gestureIndexAt(state, ev.t);
  const current = index < 0 ? null : before[index];
  const primary = ev.isPrimary !== false;
  let swallow = false;
  if (ev.type === "pointerdown" && (primary || !current)) {
    const inWindow = inGuardWindow(state.armedAt, ev.t, state.windowMs);
    swallow = inWindow && (inGuardBox(state.box, ev.x, ev.y) || ev.onBack === true);
    gestures = [...before, Object.freeze({
      downAt: ev.t,
      swallow,
      inWindow,
      down: true,
      releasedAt: null,
      clicked: false,
      clickedAt: null,
      noClick: false,
    })];
  } else if (current) {
    const changes = {};
    // The back-button exception over the whole gesture: from here on.
    swallow = current.swallow || (current.inWindow && ev.onBack === true);
    if (swallow !== current.swallow) changes.swallow = swallow;
    if ((ev.type === "pointerup" || ev.type === "pointercancel") && primary && current.down) {
      changes.down = false;
      changes.releasedAt = seenAt;
    }
    // No click will come: the browser took the touch over, or the guard cancels the tap here.
    const cancelsTap = swallow && ev.cancelable === true && (ev.type === "touchstart" || ev.type === "touchend");
    if (!current.noClick && ((ev.type === "pointercancel" && primary) || cancelsTap)) changes.noClick = true;
    // Its click: a passing gesture has nothing left to land on the button; a swallowed one keeps a tail for its dblclick.
    if (ev.type === "click" && !current.clicked) {
      changes.clicked = true;
      changes.clickedAt = seenAt;
    }
    if (Object.keys(changes).length > 0) {
      gestures = before.slice();
      gestures[index] = Object.freeze({ ...current, ...changes });
    }
  }
  // Input made past a released gesture's tail comes after anything that gesture can still produce.
  if (inOrder) {
    const kept = gestures.filter((g) => g.down || ev.t - g.releasedAt < state.tailMs);
    if (kept.length !== gestures.length) gestures = kept;
  }
  if (gestures.length > TAP_GUARD_MAX_GESTURES) gestures = gestures.slice(-TAP_GUARD_MAX_GESTURES);
  if (gestures === before && overAt === state.overAt) return { state, swallow };
  const list = gestures === before ? before : Object.freeze(gestures);
  return { state: Object.freeze({ ...state, gestures: list, overAt }), swallow };
}

/**
 * Whether the guard must ask, for the next event, if it lands on a view's
 * back button under the overlay shell: on any pointerdown (it decides a
 * gesture), and on the later events of a gesture begun inside the window
 * that still passes (the exception over the whole gesture). Otherwise the
 * answer could change nothing, and the DOM side skips the lookup.
 *
 * @param {?object} state - The guard's state.
 * @param {string} type - The event's type.
 * @param {number} [t] - The event's time (ms, see eventTime): with it, the
 *   event's own gesture (gestureIndexAt), and none past a released
 *   gesture's tail; without it, the last gesture.
 * @returns {boolean} true when stepTapGuard would use `onBack`
 */
function tapGuardAsksBack(state, type, t) {
  if (!state) return false;
  if (type === "pointerdown") return true;
  const gesture = gestureAt(state, t);
  return Boolean(gesture && gesture.inWindow && !gesture.swallow);
}

/**
 * When the guard may retire (remove its listeners), on the clock. Until a
 * press or a release dated after the window has been handled (`overAt`), a
 * press dated inside it may still be queued: the safety bound, listenFrom
 * + maxLifetimeMs. From then on, at once (`overAt`) unless it still follows
 * a gesture: a swallowed one, or one begun inside the window that passes
 * so far and has had no click (it may still land on a back button).
 * Such a gesture still down, or released and awaiting a click that may
 * still be queued, holds the guard to the bound: only an event ends it
 * (its click, or the press or release that takes it off the list), and the
 * DOM side reschedules on every change. One that has had its click, or
 * will have none (`noClick`), holds it to its release or its click,
 * whichever was handled last, plus TAP_GUARD_RELEASE_TAIL_MS. Never later
 * than the bound.
 *
 * @param {?object} state - The guard's state.
 * @returns {number} the retire time (ms; -Infinity when disarmed)
 */
function tapGuardRetireAt(state) {
  if (!state) return -Infinity;
  const from = isNum(state.listenFrom) ? state.listenFrom : state.armedAt;
  const cap = from + state.maxLifetimeMs;
  if (!isNum(state.overAt)) return cap;
  let end = state.overAt;
  for (const g of state.gestures) {
    if (g.swallow || (g.inWindow && !g.clicked)) {
      if (g.down || !(g.clicked || g.noClick)) return cap;
      const last = g.clicked ? Math.max(g.releasedAt, g.clickedAt) : g.releasedAt;
      end = Math.max(end, last + state.tailMs);
    }
  }
  return Math.min(end, cap);
}

// A view's back button under LayoutPi's overlay shell: the views' back
// squares carry `data-pi-back` (RailSquareButton `back`, ChartTabs'
// restore button), and the selector needs the overlay shell's root
// (`[data-pi-shell]`), so the grid shell never matches.
const SHELL_BACK_SELECTOR = "[data-pi-shell] [data-pi-back]";

/**
 * Whether an event lands on a view's back button under the overlay shell:
 * the guard then swallows a press there inside its window wherever the
 * first tap was, and the rest of a gesture begun inside the window from
 * the event that lands there (its click on the button that slid under the
 * finger). Perceiving the view, deciding and pressing takes more than the
 * ~210 ms left after the view's first frame.
 *
 * @param {Event} event - A pointerdown, or a later event of the gesture.
 * @returns {boolean} True on a view's back button under the overlay shell.
 */
function isShellBackPress(event) {
  const t = event && event.target;
  return Boolean(t && typeof t.closest === "function" && t.closest(SHELL_BACK_SELECTOR));
}

/**
 * The DOM side: a guard on `target` (the document) that a command arms from
 * its click handler. No listener exists until `arm()`; they go when the guard
 * retires (tapGuardRetireAt: in the handler of the event that leaves it
 * nothing to wait for — the first press or release dated after the window,
 * a followed gesture's click or its leaving the list — or on its own timer:
 * a gesture's tail, the safety bound), or on `dispose()`.
 *
 * @param {EventTarget} target - Where the capture listeners go (document).
 * @param {object} [options] - Clock, timers, geometry.
 * @param {() => number} [options.now] - Clock (default performance.now).
 * @param {(fn: () => void, ms: number) => number} [options.setTimer] - Default setTimeout.
 * @param {(id: number) => void} [options.clearTimer] - Default clearTimeout.
 * @param {number} [options.windowMs] - Window length.
 * @param {number} [options.width] - Box width.
 * @param {number} [options.height] - Box height.
 * @param {number} [options.tailMs] - A released gesture's tail.
 * @param {number} [options.maxLifetimeMs] - Safety bound on the guard's life.
 * @param {(event: Event) => boolean} [options.onBack] - Whether an event
 *   lands on a view's back button (default isShellBackPress); asked only
 *   when the verdict could depend on it (tapGuardAsksBack).
 * @returns {{arm: (click: object) => boolean, dispose: () => void, isArmed: () => boolean}}
 *   arm(click) arms (or re-arms, keeping the gestures seen: rearmTapGuard)
 *   the guard from the click that ran the command and returns whether it
 *   did; dispose() retires it now; isArmed() says whether its listeners are
 *   in place.
 */
function createTapGuard(target, {
  now = () => performance.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  onBack = isShellBackPress,
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
    const t = eventTime(event.timeStamp, seenAt);
    const before = state;
    const step = stepTapGuard(state, {
      type: event.type,
      t,
      // Dated by its own timeStamp, not by the clock (eventTime's fallback).
      dated: t === event.timeStamp,
      seenAt,
      x: event.clientX,
      y: event.clientY,
      isPrimary: event.isPrimary,
      cancelable: event.cancelable === true,
      onBack: tapGuardAsksBack(state, event.type, t) && onBack(event),
    });
    ({ state } = step);
    if (step.swallow) {
      if (event.cancelable) event.preventDefault();
      event.stopImmediatePropagation();
    }
    // Any change — a press, a release, a click, the first press or release
    // dated after the window, a gesture off the list — moves the retire
    // time; the event that leaves the guard nothing to wait for retires it
    // here, its own verdict already given.
    // (`schedule` is defined below; the listener only runs once arm() has
    // added it, after.)
    if (state !== before) schedule();
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
      // Armed again (the dock's buttons share one guard): the gestures seen keep their verdicts.
      state = rearmTapGuard(state, next);
      schedule();
      return state !== null;
    },
    dispose: retire,
    isArmed: () => state !== null,
  };
}

// ------------------------------------------------------------ touch cancel
//
// The overlay shell's shields (the views' one, the dock band's one) and
// the dock band's guard block a press by taking its pointerdown
// (`pointer-events`), but that alone does not keep the tap: after the
// release, Chromium synthesizes the
// compatibility mouse events and the click from the tap gesture and
// hit-tests again at that moment. If the element has stopped blocking in
// between — the dock band shield's cut-out opened over the scrubber, the
// guard lowered at the dock's end, the views' shield unmounted once a
// close settled — they go to what now lies beneath. In one measured case a
// second tap 29 px from the timeline click, pressed at +240 ms, had its
// pointerdown on the guard but its mousedown and click on
// input.rt-scrubber, which seeks on mousedown. Cancelling the touch
// (preventDefault on a cancelable touchstart) drops the tap gesture: no
// compatibility mouse event, no click. touchend is cancelled too, a second
// chance should the touchstart not have been cancelable. Every event of a
// touch goes to its touchstart's target, so a listener on the element only
// ever sees the touches that began on it, i.e. while it was blocking.
// Non-passive, like the guard's own listeners (only a non-passive listener
// may cancel). A pinch stays blocked by the elements' `touch-action: none`
// (the dock band's two carry it only while raised, like their listeners:
// toggleTouchCancel below).

/** The touch events the shields and the dock band's guard cancel. */
const TOUCH_CANCEL_EVENT_TYPES = Object.freeze(["touchstart", "touchend"]);

/**
 * Cancels every touch that begins on `target` (preventDefault on its
 * cancelable touchstart and touchend), so the browser never turns it into
 * compatibility mouse events or a click, wherever they would land.
 *
 * @param {?EventTarget} target - The blocking element (a shield or a guard).
 * @returns {function(): void} Removes the listeners (a no-op without a target).
 */
function cancelTouches(target) {
  if (!target || typeof target.addEventListener !== "function") return () => undefined;
  const options = { passive: false };
  const onTouch = (event) => {
    if (event.cancelable) event.preventDefault();
  };
  for (const type of TOUCH_CANCEL_EVENT_TYPES) target.addEventListener(type, onTouch, options);
  return () => {
    for (const type of TOUCH_CANCEL_EVENT_TYPES) target.removeEventListener(type, onTouch, options);
  };
}

// ------------------------------------------- touch cancel, while blocking
//
// The dock band's shield and its double-tap guard are mounted once and
// block only while useShellTiming holds them up (`data-active="true"`).
// With cancelTouches' listeners on them at all times and `touch-action:
// none` in their CSS, they would keep a touch-handler region over the
// dock's band at rest, `pointer-events: none` notwithstanding, and the
// compositor would send every touchstart on the dock as blocking
// (Chromium's rule: the frontmost composited layer that carries a region
// at the touch point decides, and a region due to a non-passive touch
// listener or to `touch-action: none` blocks). So their cancellation
// follows their blocking: on when raised, off when
// lowered — with one exception. The touchend cancel is the second chance
// should a touchstart not have been cancelable (on a real touchscreen the
// compositor may still hold the regions of the frame before the raise for
// a touch pressed right after it); a touch that began on the element
// while it blocked therefore keeps the listeners until it ends (its
// touchend, or a touchcancel), even if the element is lowered first. A
// touch's events all go to its touchstart's target, so only touches that
// began on the element while it blocked are counted.

/**
 * Per element, its live cancellation: the listeners' remover, the touches
 * begun on it still down, and whether it was lowered with touches down.
 *
 * @type {WeakMap<EventTarget, {remove: function(): void, down: Set<number>, lowering: boolean}>}
 */
const touchCancelsByTarget = new WeakMap();

/**
 * The identifiers of the touch points an event changed (`changedTouches`),
 * or none.
 *
 * @param {Event} event - A touch event.
 * @returns {number[]} The touch identifiers.
 */
function changedTouchIds(event) {
  const list = event && event.changedTouches;
  if (!list || typeof list.length !== "number") return [];
  const ids = [];
  for (let i = 0; i < list.length; i += 1) {
    if (list[i] && list[i].identifier !== undefined) ids.push(list[i].identifier);
  }
  return ids;
}

/**
 * Turns on or off the touch cancellation of an element that blocks only at
 * times (the dock band's shield and its guard): on, every touch that
 * begins on it is cancelled as by cancelTouches (preventDefault on its
 * cancelable touchstart and touchend, non-passive); off, the listeners go,
 * so the element leaves no touch-handler region behind — once the touches
 * begun on it while it blocked have ended (see the header above). Calling
 * it again in the same sense is a no-op; turning it on while it waits to
 * go off keeps it on.
 *
 * @param {?EventTarget} target - The element (a no-op without one).
 * @param {boolean} on - Whether the element blocks.
 * @returns {void}
 */
function toggleTouchCancel(target, on) {
  if (!target || typeof target.addEventListener !== "function") return;
  const live = touchCancelsByTarget.get(target);
  if (!on) {
    if (!live) return;
    if (live.down.size === 0) {
      live.remove();
      return;
    }
    live.lowering = true;
    return;
  }
  if (live) {
    live.lowering = false;
    return;
  }
  const cancelOptions = { passive: false };
  const countOptions = { passive: true };
  const entry = { remove: null, down: new Set(), lowering: false };
  const onStart = (event) => {
    if (event.cancelable) event.preventDefault();
    for (const id of changedTouchIds(event)) entry.down.add(id);
  };
  // A touchend is cancelled like the touchstart; a touchcancel (never
  // cancelable) only ends the touch.
  const onEnd = (event) => {
    if (event.type === "touchend" && event.cancelable) event.preventDefault();
    for (const id of changedTouchIds(event)) entry.down.delete(id);
    if (entry.lowering && entry.down.size === 0) entry.remove();
  };
  entry.remove = () => {
    target.removeEventListener("touchstart", onStart, cancelOptions);
    target.removeEventListener("touchend", onEnd, cancelOptions);
    target.removeEventListener("touchcancel", onEnd, countOptions);
    touchCancelsByTarget.delete(target);
  };
  target.addEventListener("touchstart", onStart, cancelOptions);
  target.addEventListener("touchend", onEnd, cancelOptions);
  target.addEventListener("touchcancel", onEnd, countOptions);
  touchCancelsByTarget.set(target, entry);
}

module.exports = {
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
};
