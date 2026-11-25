// The overlay shell's view-sheet warm-up: each hidden view host laid out
// AND painted once after load, out of sight, so a view's first opening since
// load doesn't pay it — a warm-up of the sheet's paint with no off-screen
// layer (React side: components/ambient/LayoutPi/useHostWarmup.js, CSS:
// LayoutPi/styles.css, the `data-pi-warm` rules).
//
// What the cold first opening pays, as measured: in 8 first openings out
// of 8 since load, a frame skipped at the start of
// the sheet's slide, 94–117 ms after the click, with no long task on the
// main thread (the next animation frame starting up to 13 ms late), rare in
// every later opening — although the sheet is rasterized anew at every
// opening (closed, it is `visibility: hidden` and keeps no layer, will-change
// or not). So what the first opening pays and the next ones don't lives in
// caches that outlast the sheet's layer: the GPU process's shader programs
// (Skia compiles one per kind of draw the first time it meets it — the
// views' rounded cards, their glyphs, icon paths, gradients), the glyphs of
// the views' text at their sizes (rasterized by FreeType in the renderer,
// then uploaded to the GPU's glyph atlas), and the views' decoded images.
// Laying the hidden hosts out alone — style and layout, main thread, with
// the sheet still hidden (this warm-up includes it) — reaches neither the
// compositor nor the GPU.
//
// The mechanism. One host at a time, the root gets `data-pi-warm="<state>"`
// (the state that shows that host: "conditions", "alert", "ai", "max") for
// one frame; styles.css then leaves that host out of the hosts'
// `content-visibility: hidden` and puts the closed sheet in its warm pose:
// in place (its open position, x 210 → right edge, no transform), not
// `visibility: hidden`, at opacity SHEET_WARM_OPACITY, inert and taking no
// pointer, with no transition. Blink then lays the host out and paints it,
// the sheet gets its layer, and the compositor rasterizes that layer's
// tiles on the GPU like an opening's — it is on screen and drawn, so its
// tiles are required before that frame can go to the screen — then draws
// it at 0.1 % opacity, which changes no pixel. The attribute goes at the
// start of the next frame (afterNextFrame), whose commit cannot happen
// before the warm frame's tiles are rasterized: the sheet is hidden and
// off screen again, and its layer is dropped.
//
//   - Why not paint the closed sheet off screen? That is the off-screen
//     layer the design rules out; and an off-screen
//     layer's tiles are only "eventually" tiles to the compositor, rasterized
//     if and when it gets round to them, so a layer that lives for a frame
//     or two might not be rasterized at all.
//   - Why opacity 0.001 and not 0? Blink skips painting a box under opacity
//     0.0004 (PAINT_MIN_OPACITY), and the compositor neither draws nor
//     rasterizes a layer whose opacity is exactly 0. At 0.001 the colour it
//     adds is under half a level in 8 bits (INVISIBLE_MAX_OPACITY): no pixel
//     changes.
//   - Why `will-change: transform, opacity` in that pose? With opacity alone
//     Blink folds the opacity into the sheet's own paint (a save-layer at
//     0.001), and Skia skips everything drawn under an 8-bit alpha of 0:
//     nothing would be rasterized. `will-change: opacity` makes it a
//     compositor effect instead: the tiles are rasterized at full alpha and
//     only their drawing is at 0.1 %. Both will-change values are on the
//     sheet, the one element (with the views' shield) allowed one, and the
//     second exists only in the warm pose.
//
// THE TRANSIENT LAYER. No mechanism paints the sheet's content without a
// layer: the sheet carries
// `will-change: transform`, so painting it at all composites it, and, over
// the composited map, it would need a layer anyway. So the warm pose makes
// the sheet's layer exist for one frame per host — the warm frame; the next
// frame's commit removes it — on screen, fully transparent to the eye, never
// off screen, and never kept: at rest the sheet is hidden and layerless.
// That is the closest thing to "no off-screen layer" that actually paints.
//
// What it cannot warm: the sheet's layer and its tiles (made at every
// opening, by design), their GPU textures (the compositor's pool lets unused
// tile textures go after a few seconds), Blink's recorded paint of the
// sheet (dropped once it stops being painted), glyph-atlas space the GPU
// evicts after a long idle (the glyphs, rasterized, stay cached on both
// sides, so they are re-uploaded, not re-rasterized), content that differs
// from what was painted (new characters after a data refresh, another text
// size, a new alert's title — an alert's content mounting at the alert
// host's top is warmed again), and the main thread's cold code at the
// first opening (V8 compiling the switch's path, React's first commit of a
// view: a 53–71 ms long task, measured in 5 first openings out of 8),
// which is no paint.
//
// When. Only with the sheet closed and the shell at rest (MID or MIN, the
// last switch settled, the weather data in: `setAtRest`), once the page has
// loaded and its fonts are ready (`setLoaded`: glyphs warmed in a fallback
// font would be the wrong ones), WARM_QUIET_MS after the latest of: the
// load, the shell coming to rest, the last input, the last touchmove or
// scroll (WARM_ACTIVITY_EVENTS: a native scroll and its inertia included);
// never while a pointer is down — a finger whose pointer was cancelled
// when a native scroll took its touch over (the shell rail's `.railScroll`, a
// popover's list) still counts as down until its touch ends (`touchend` /
// `touchcancel` with no finger left), and only the window's own `blur`, not
// an element's, drops the pointers; then in an idle callback (whenIdle,
// WARM_IDLE_TIMEOUT_MS at the latest). Any pointerdown, keydown or wheel
// cancels at once — a pending
// idle callback, and a warm pose already set, which is taken off right in
// that handler with a style flush (`flushStyle`), so a tap that opens a view
// starts its slide from the closed pose — and the sequence resumes only
// WARM_QUIET_MS after the pointers are up. Leaving the rest (a switch's own
// commit: the hook calls `setAtRest(false)` from a layout effect) cancels
// it too, before that frame paints, so no opening frame shows another
// view's host (a view only opens from a tap or a key, whose pointerdown or
// keydown has taken the pose off already). Each host once, in the given
// order, skipping a host with nothing mounted at its top (the alert view
// renders nothing in calm weather); a host whose top content mounts later
// is warmed again (`contentChanged`). Not skipped under reduced motion:
// nothing moves or shows, and a one-frame opening pays the same cold
// rasterization inside its one frame.
//
// `data-pi-warm` on the root marks the warm frame (one per host; styles.css
// un-skips that host). For measurement tooling only: `data-pi-warmed` lists
// the states whose hosts are warm (in the hosts' order; absent until the
// first is, and again once the scheduler is disposed); nothing in the app
// reads it, and it has no visible effect.
//
// MODULE FORMAT: CommonJS on purpose, like ui/tapGuard.js and
// ui/pressTint.js, so test/sheetWarmup.test.js runs the real module under
// `node --test`: warmGate() and nextWarmHost() are pure; createSheetWarmup()
// is the scheduler, written against a stand-in root, an EventTarget and
// injected idle / frame / timer / clock functions (no DOM in Node).

/** The root attribute that names the host warmed in the current frame (styles.css reads it). */
const WARM_ATTRIBUTE = "data-pi-warm";

/** The root attribute that lists the warm hosts' states, for measurement tooling (nothing in the app reads it). */
const WARMED_ATTRIBUTE = "data-pi-warmed";

/** An idle callback runs at the latest this long after it was asked for (ms). */
const WARM_IDLE_TIMEOUT_MS = 2000;

/** Without requestIdleCallback: a plain task this long after (ms). */
const WARM_FALLBACK_DELAY_MS = 200;

/**
 * How long nothing must have happened — no input, the load and the shell's
 * rest not newer — before a warm-up step is asked for (ms). Covers a
 * double tap's pause, Leaflet's inertia after a drag (about 0.5 s) and its
 * zoom animation.
 */
const WARM_QUIET_MS = 1000;

/**
 * The inputs that cancel a warm-up step and restart the quiet period. The
 * touch ends release a finger whose pointer was cancelled by a native scroll
 * (createSheetWarmup's pointer accounting).
 */
const WARM_INPUT_EVENTS = Object.freeze(["pointerdown", "pointerup", "pointercancel", "touchend", "touchcancel", "keydown", "wheel"]);

/**
 * The activity that only restarts the quiet period (and takes a warm pose
 * off): a finger moving, a scroll and its inertia. No timer is touched, so
 * their rate needs no throttle.
 */
const WARM_ACTIVITY_EVENTS = Object.freeze(["touchmove", "scroll"]);

/** The sheet's opacity in the warm pose (styles.css, its `data-pi-warm` rule). */
const SHEET_WARM_OPACITY = 0.001;

/** Under this opacity Blink doesn't paint a box (kMinimumVisibleOpacity) — the warm pose must stay above it. */
const PAINT_MIN_OPACITY = 0.0004;

/** Over this opacity a layer drawn over the screen could move an 8-bit channel by a level — the warm pose must stay under it. */
const INVISIBLE_MAX_OPACITY = 0.5 / 255;

/**
 * Whether a warm-up step may be asked for now.
 *
 * @param {object} s - The scheduler's inputs.
 * @param {boolean} s.atRest - The overlay shell, the sheet closed (MID or MIN), the last switch settled, the data in.
 * @param {boolean} s.loaded - The page loaded and its fonts ready.
 * @param {number} s.pointersDown - Pointers currently down.
 * @param {number} s.now - The clock (ms).
 * @param {number} s.quietSince - The latest of the load, the rest's start and the last input (ms; -Infinity for none).
 * @returns {{go: boolean, waitMs: ?number}} go: ask now; otherwise waitMs, when only the quiet period is missing, is
 *   how long until it is over (null: wait for atRest, the load or the pointers' release instead).
 */
function warmGate({ atRest, loaded, pointersDown, now, quietSince }) {
  if (!atRest || !loaded || pointersDown > 0) return { go: false, waitMs: null };
  const quietFor = now - quietSince;
  if (quietFor < WARM_QUIET_MS) return { go: false, waitMs: WARM_QUIET_MS - quietFor };
  return { go: true, waitMs: 0 };
}

/**
 * The next host to warm: the first, in order, with content mounted at its top
 * that isn't warm.
 *
 * @param {Array<{state: string, hasContent: boolean}>} hosts - The hosts, in warm-up order.
 * @param {Set<string>} warmed - The states whose hosts are warm.
 * @returns {?string} Its state, or null when none is due.
 */
function nextWarmHost(hosts, warmed) {
  const host = hosts.find((h) => h.hasContent && !warmed.has(h.state));
  return host ? host.state : null;
}

/**
 * `data-pi-warmed`'s value: the warm states, in the hosts' order.
 *
 * @param {string[]} order - The hosts' states, in warm-up order.
 * @param {Set<string>} warmed - The states whose hosts are warm.
 * @returns {string} Space-separated states ("" for none).
 */
function warmedValue(order, warmed) {
  return order.filter((state) => warmed.has(state)).join(" ");
}

/**
 * Runs `step` when the main thread is idle (requestIdleCallback, at most
 * WARM_IDLE_TIMEOUT_MS later), or after WARM_FALLBACK_DELAY_MS without it.
 *
 * @param {function(): void} step - What to run.
 * @param {object} [scope] - Where requestIdleCallback / setTimeout live (the window).
 * @returns {function(): void} Cancels it.
 */
function whenIdle(step, scope = globalThis) {
  if (typeof scope.requestIdleCallback === "function") {
    const handle = scope.requestIdleCallback(step, { timeout: WARM_IDLE_TIMEOUT_MS });
    return () => scope.cancelIdleCallback(handle);
  }
  const timer = scope.setTimeout(step, WARM_FALLBACK_DELAY_MS);
  return () => scope.clearTimeout(timer);
}

/**
 * The warm-up scheduler (see the header). Listens, in the capture phase and
 * passively, for WARM_INPUT_EVENTS, WARM_ACTIVITY_EVENTS and `blur` on
 * `inputTarget` from its creation to `dispose()`; sets and removes the two
 * root attributes by hand, and takes both off at `dispose()`.
 *
 * @param {object} o - Options.
 * @param {{setAttribute: (name: string, value: string) => void, removeAttribute: (name: string) => void}} o.root - LayoutPi's root.
 * @param {EventTarget} o.inputTarget - Where the inputs are heard (the window).
 * @param {Array<{state: string, element: function(): ?object}>} o.hosts - The hosts, in warm-up order; `element()`
 *   returns the host's element (null while unmounted), whose `firstElementChild` tells whether content is mounted.
 * @param {function(function(): void): function(): void} o.whenIdle - Asks for an idle callback; returns a canceller.
 * @param {function(function(): void): function(): void} o.afterFrames - Runs a step at the start of the frame after the
 *   next one (LayoutPi's afterNextFrame); returns a canceller.
 * @param {function(): void} o.flushStyle - Brings style up to date (a warm pose cancelled by an input).
 * @param {function(): number} [o.now] - The clock (ms).
 * @param {(fn: () => void, ms: number) => number} [o.setTimer] - setTimeout.
 * @param {(id: number) => void} [o.clearTimer] - clearTimeout.
 * @returns {{setAtRest: function(boolean): void, setLoaded: function(boolean): void,
 *   contentChanged: function(string): void, dispose: function(): void}} The scheduler.
 */
function createSheetWarmup({
  root,
  inputTarget,
  hosts,
  whenIdle: askIdle,
  afterFrames,
  flushStyle,
  now = () => globalThis.performance.now(),
  setTimer = (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimer = (id) => globalThis.clearTimeout(id),
}) {
  const order = hosts.map((h) => h.state);
  const warmed = new Set();
  // The pointers down: id → pointerType.
  const pointers = new Map();
  let atRest = false;
  let loaded = false;
  let quietSince = -Infinity;
  let cancelIdle = null;
  let cancelFrames = null;
  let quietTimer = null;
  // The host in its warm frame, and whether its top content changed meanwhile.
  let warming = null;
  let warmingChanged = false;
  let disposed = false;

  const snapshot = () => hosts.map((h) => {
    const el = h.element();
    return { state: h.state, hasContent: Boolean(el && el.firstElementChild) };
  });

  const publish = () => {
    const value = warmedValue(order, warmed);
    if (value) root.setAttribute(WARMED_ATTRIBUTE, value);
    else root.removeAttribute(WARMED_ATTRIBUTE);
  };

  const clearQuiet = () => {
    if (quietTimer !== null) {
      clearTimer(quietTimer);
      quietTimer = null;
    }
  };

  // Cancels whatever is pending or under way; a warm pose comes off (and,
  // for an input, style is brought up to date at once).
  const stop = (flush) => {
    clearQuiet();
    if (cancelIdle) {
      cancelIdle();
      cancelIdle = null;
    }
    if (cancelFrames) {
      cancelFrames();
      cancelFrames = null;
    }
    if (warming !== null) {
      warming = null;
      root.removeAttribute(WARM_ATTRIBUTE);
      if (flush) flushStyle();
    }
  };

  let kick = null;

  const finish = () => {
    cancelFrames = null;
    root.removeAttribute(WARM_ATTRIBUTE);
    if (!warmingChanged) warmed.add(warming);
    warming = null;
    publish();
    kick();
  };

  const step = () => {
    cancelIdle = null;
    const state = nextWarmHost(snapshot(), warmed);
    if (state === null) return;
    if (!warmGate({ atRest, loaded, pointersDown: pointers.size, now: now(), quietSince }).go) {
      kick();
      return;
    }
    warming = state;
    warmingChanged = false;
    root.setAttribute(WARM_ATTRIBUTE, state);
    cancelFrames = afterFrames(finish);
  };

  kick = () => {
    if (disposed || cancelIdle || cancelFrames) return;
    clearQuiet();
    if (nextWarmHost(snapshot(), warmed) === null) return;
    const gate = warmGate({ atRest, loaded, pointersDown: pointers.size, now: now(), quietSince });
    if (gate.go) {
      cancelIdle = askIdle(step);
    } else if (gate.waitMs !== null) {
      quietTimer = setTimer(() => {
        quietTimer = null;
        kick();
      }, gate.waitMs);
    }
  };

  // The touch pointers kept down after their pointercancel: released when
  // no finger is left on the screen.
  const releaseTouches = () => {
    for (const [id, type] of pointers) if (type === "touch") pointers.delete(id);
  };

  const onInput = (event) => {
    quietSince = now();
    const { type } = event;
    if (type === "pointerdown") {
      pointers.set(event.pointerId, event.pointerType);
    } else if (type === "pointerup") {
      pointers.delete(event.pointerId);
    } else if (type === "pointercancel") {
      // A touch's pointer cancelled (a native scroll taking the touch over)
      // still counts as down until its touch ends (below). A mouse or pen
      // pointer cancelled is released.
      if (event.pointerType !== "touch") pointers.delete(event.pointerId);
    } else if (type === "touchend" || type === "touchcancel") {
      if (!event.touches || event.touches.length === 0) releaseTouches();
    }
    stop(true);
    kick();
  };

  // A finger moving or a scroll (its inertia included) restarts the quiet
  // period: the pending idle callback or quiet timer re-checks the gate, so
  // nothing else is touched — except a warm pose under way, taken off (no
  // flush: no view opens from a scroll) and rescheduled.
  const onActivity = () => {
    quietSince = now();
    if (warming !== null) {
      stop(false);
      kick();
    }
  };

  // A pointer whose release the page never heard (focus left the window)
  // must not hold the warm-up back for good. The window's own blur only: an
  // element's blur (focus moving inside the page, as a mouse press does)
  // crosses the window too in the capture phase, its pointer still down.
  const onBlur = (event) => {
    if (event.target !== inputTarget) return;
    pointers.clear();
    kick();
  };

  const LISTEN = { capture: true, passive: true };
  for (const type of WARM_INPUT_EVENTS) inputTarget.addEventListener(type, onInput, LISTEN);
  for (const type of WARM_ACTIVITY_EVENTS) inputTarget.addEventListener(type, onActivity, LISTEN);
  inputTarget.addEventListener("blur", onBlur, LISTEN);

  return {
    setAtRest(value) {
      if (value === atRest) return;
      atRest = value;
      if (value) {
        quietSince = Math.max(quietSince, now());
        kick();
      } else {
        stop(false);
      }
    },
    setLoaded(value) {
      if (value === loaded) return;
      loaded = value;
      if (value) {
        quietSince = Math.max(quietSince, now());
        kick();
      } else {
        stop(false);
      }
    },
    contentChanged(state) {
      if (state === warming) warmingChanged = true;
      if (warmed.delete(state)) publish();
      kick();
    },
    dispose() {
      disposed = true;
      stop(false);
      // The `data-pi-warmed` list goes with the scheduler: a new one (another
      // host set) starts with no host warm, and a root without the overlay
      // shell keeps no trace.
      warmed.clear();
      root.removeAttribute(WARMED_ATTRIBUTE);
      for (const type of WARM_INPUT_EVENTS) inputTarget.removeEventListener(type, onInput, LISTEN);
      for (const type of WARM_ACTIVITY_EVENTS) inputTarget.removeEventListener(type, onActivity, LISTEN);
      inputTarget.removeEventListener("blur", onBlur, LISTEN);
    },
  };
}

module.exports = {
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
};
