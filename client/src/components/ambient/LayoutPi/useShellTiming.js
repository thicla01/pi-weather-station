import { useCallback, useLayoutEffect, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { prefersReducedMotion, subscribeReducedMotion } from "~/ui/systemPrefs";
import { createCommittedValue } from "~/ui/committedValue";
import { toggleTouchCancel } from "~/ui/tapGuard";
import {
  SHELL_END_RECHECK_MS,
  SHELL_ONE_FRAME_SHIELD_MS,
  SHELL_SLIDE_END_FALLBACK_MS,
  dockShieldMode,
  initialShellSwitch,
  motionEnd,
  nextShellSwitch,
  overlayPresentation,
  recentresInstantly,
  settleHoldMs,
  shellMode,
  viewShieldHeld,
} from "~/ui/piShellGeometry";

/* The timing of LayoutPi's overlay shell: ONE React update per switch,
 * every motion in CSS from that update's style change, and nothing on the
 * main thread until the motion reports its own end. The rules (what waits,
 * and for what) are pure functions in ui/piShellGeometry.js, pinned by
 * test/piShellGeometry.test.js; this file only runs them against React
 * state, the DOM's CSS transitions (`Element.getAnimations()`), animation
 * frames and timers. It reads no layout. Form 2, named below, is a
 * fallback form the shipped code never selects (ui/piShellGeometry.js). */

// Root attributes off the overlay shell: none.
const NO_TIMING_ATTRIBUTES = Object.freeze({});

// Root attribute present from a switch's commit until one frame after the
// end of its last moving element (ui/pressTint.js reads it; measurement
// tooling takes it as its motion window).
// Written by hand, never by React, so a render can't drop or restore it.
const MOVING_ATTRIBUTE = "data-pi-moving";

// The boxes this hook reads are never looked up in the DOM (a view switch's
// click walks no tree, its commit neither): LayoutPi's own refs (root, rail,
// sheet, the dock band's shield and guard, and the dock cell, BottomDock's
// wrapper, through its `cellRef`), and the shell registry
// (ui/shellElements.js), where the map overlays that fade on MIN ↔ MID
// (RadarLegend's chip, raised chip and card, RadarTimeline,
// FloatingMiniBanner: `data-pi-overlay-el` under the overlay shell) and
// Leaflet's attribution corner, which slides with the shell, register
// themselves as React attaches them. The live scrubber, the one overlay that
// reaches into the dock's band, is among the overlays (`liveScrubber()`).
// The dock band shield's double-tap guard is placed by this property, set
// by hand on its inline style to the x of the click that started the
// switch (LayoutPi/styles.css `.dockGuard`).
const DOCK_GUARD_X_PROPERTY = "--pi-dock-guard-x";

// The reduced-motion preference, read as an external store so it follows the
// OS setting live, like the CSS it pairs with (styles/main.css and the
// overlay shell's `@media (prefers-reduced-motion: reduce)` rules): a change
// re-renders LayoutPi once, and the next switch is planned in the new mode.
// A switch keeps the mode it started with (`mode` in its record), so a
// change mid-switch never re-plans or re-runs it. The store is
// ui/systemPrefs.js's: one MediaQueryList whose cached `matches` its own
// listener updates before this subscription's runs, so the snapshot read in
// every render (the view switch's click included) costs a variable, not a
// new list. Off the overlay shell it subscribes to nothing and reads false.
const NO_UNSUBSCRIBE = () => undefined;
const subscribeNothing = () => NO_UNSUBSCRIBE;
const readNoReducedMotion = () => false;

/**
 * A value kept from this component's last committed render, read during
 * render with no state update (ui/committedValue.js): React's
 * useSyncExternalStore over a store that only the caller writes, in a
 * passive effect declared AFTER this call, with what its commit showed.
 *
 * @param {function(): unknown} init - The value before any commit (called once, at mount).
 * @returns {Array} [the value the last commit stored, the store (its `write`)].
 */
function useCommittedValue(init) {
  const [store] = useState(() => createCommittedValue(init()));
  return [useSyncExternalStore(store.subscribe, store.read), store];
}

/**
 * Runs `step` on the frame after the current one: the first
 * requestAnimationFrame lands before this frame's paint, the second before
 * the next one's.
 *
 * @param {function(): void} step - What to run.
 * @returns {function(): void} Cancels the pending frames.
 */
export function afterNextFrame(step) {
  let second = 0;
  const first = requestAnimationFrame(() => {
    second = requestAnimationFrame(step);
  });
  return () => {
    cancelAnimationFrame(first);
    cancelAnimationFrame(second);
  };
}

/**
 * The CSS transitions currently on the given elements — their own, not
 * their descendants'. Called on the frame after the one that painted the
 * commit that changed their style (whenStartedTransitionsEnd), so the
 * transitions that commit started are there (a running one it reversed
 * is replaced), and `getAnimations()`, which brings style up to date
 * first, finds it already computed by that frame.
 *
 * @param {Array<?Element>} elements - The boxes to look at (nulls skipped).
 * @param {string} [property] - Only this property's transition.
 * @returns {?Array<Animation>} The transitions, or null without the Web Animations API.
 */
function shellTransitions(elements, property) {
  const found = [];
  for (const el of elements) {
    if (!el) continue;
    if (typeof el.getAnimations !== "function") return null;
    for (const animation of el.getAnimations()) {
      if (typeof CSSTransition !== "undefined" && !(animation instanceof CSSTransition)) continue;
      if (property && animation.transitionProperty !== property) continue;
      found.push(animation);
    }
  }
  return found;
}

/**
 * Calls `onEnd` once every transition in `animations` has finished or been
 * cancelled (its `finished` promise settled; none at all: at once). The
 * guarded fallback covers a transition that never reports: armed when the
 * tracked transitions have really started (their `ready` promises
 * settled: the start time is resolved once the frame that presents the
 * commit is out, which on a Pi 3B is the long one, 150-266 ms for the
 * forecast view), it waits SHELL_SLIDE_END_FALLBACK_MS, then ends
 * the wait only if no tracked transition is still running, looking again
 * every SHELL_END_RECHECK_MS otherwise. So the fallback can't end a
 * motion early. Without the Web Animations API (`animations` null) it is
 * the only signal, armed one animation frame after this call (the
 * nearest stand-in for the start, the call itself coming two frames
 * after the commit: whenStartedTransitionsEnd).
 *
 * @param {?Array<Animation>} animations - From shellTransitions.
 * @param {function(): void} onEnd - Called once.
 * @returns {function(): void} Cancels the wait (onEnd is then never called).
 */
function whenTransitionsEnd(animations, onEnd) {
  let done = false;
  let timer = 0;
  let frame = 0;
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    cancelAnimationFrame(frame);
    onEnd();
  };
  const check = () => {
    if (done) return;
    if (animations !== null && animations.some((a) => a.playState === "running")) {
      timer = setTimeout(check, SHELL_END_RECHECK_MS);
    } else {
      finish();
    }
  };
  const armFallback = () => {
    if (!done) timer = setTimeout(check, SHELL_SLIDE_END_FALLBACK_MS);
  };
  if (animations === null) {
    frame = requestAnimationFrame(armFallback);
  } else {
    Promise.allSettled(animations.map((a) => a.finished)).then(finish);
    Promise.allSettled(animations.map((a) => a.ready)).then(armFallback);
  }
  return () => {
    done = true;
    clearTimeout(timer);
    cancelAnimationFrame(frame);
  };
}

/**
 * whenTransitionsEnd for the transitions a switch's commit has just
 * started, read (`read`, shellTransitions) on the frame after the one
 * that paints that commit (afterNextFrame), not in the commit itself.
 * `getAnimations()` brings style up to date first: inside the tap's task
 * that would be a forced style recalc of the moving set and the rest of
 * the changed tree (11-23 ms per MIN ↔ MID at 6× CPU throttling in a
 * desktop Chromium trace, 8-15 ms per view opening at 4×), which the frame
 * would then partly redo after the commit's passive effects; the grid
 * shell has none.
 * Two frames on, that frame has computed the style itself. The commit's own
 * DOM writes (`data-pi-moving`, the dock band's shield and guard) stay in
 * the commit; only the wait for the end starts two frames later, and the
 * transitions run 150-300 ms, so it still sees every one of them (one
 * already over is simply not waited for). A motion with no transition at all
 * ends two frames after its commit.
 *
 * @param {function(): ?Array<Animation>} read - Reads the transitions (shellTransitions).
 * @param {function(): void} onEnd - Called once they have ended.
 * @returns {function(): void} Cancels the pending frames, or the wait (onEnd is then never called).
 */
function whenStartedTransitionsEnd(read, onEnd) {
  let cancelWait = null;
  const cancelFrames = afterNextFrame(() => {
    cancelWait = whenTransitionsEnd(read(), onEnd);
  });
  return () => {
    cancelFrames();
    if (cancelWait) cancelWait();
  };
}

/**
 * Raises or lowers the dock band's shield (`data-active`, which its CSS
 * turns into `pointer-events` and `touch-action: none`), and with it the
 * cancellation of the touches it takes (ui/tapGuard.js toggleTouchCancel:
 * its non-passive listeners exist only while it blocks, and until the
 * touches begun on it then have ended), so at rest it leaves no
 * touch-handler region over the dock.
 * The element is rendered once by LayoutPi; only this attribute and those
 * listeners change, by hand, so lifting it costs no render.
 *
 * @param {?Element} shield - The `[data-pi-dock-shield]` element.
 * @param {boolean} up - Whether it blocks.
 * @returns {void}
 */
function setDockShield(shield, up) {
  if (!shield) return;
  shield.setAttribute("data-active", up ? "true" : "false");
  toggleTouchCancel(shield, up);
}

/**
 * Opens or closes the dock band shield's cut-out over the scrubber
 * (`data-scrubber`: LayoutPi/styles.css opens it in the frame an arriving
 * scrubber shows, and closes it at once). By hand, like `data-active`.
 *
 * @param {?Element} shield - The `[data-pi-dock-shield]` element.
 * @param {boolean} open - Whether a live scrubber is mounted.
 * @returns {void}
 */
function setScrubberCutout(shield, open) {
  if (shield) shield.toggleAttribute("data-scrubber", open);
}

/**
 * Raises the dock band shield's double-tap guard over a click's place, or
 * lowers it (`data-active`, which its CSS turns into `pointer-events` and
 * `touch-action: none`, and DOCK_GUARD_X_PROPERTY, which centres it), the
 * cancellation of its touches with it (toggleTouchCancel, as the shield's).
 * By hand, like the shield, so it costs no render.
 *
 * @param {?Element} guard - The `[data-pi-dock-guard]` element.
 * @param {?number} x - The click's x in CSS px from the viewport's left edge (the shell's root spans the viewport), or null to lower it.
 * @returns {void}
 */
function setDockGuard(guard, x) {
  if (!guard) return;
  if (x !== null) guard.style.setProperty(DOCK_GUARD_X_PROPERTY, `${x}px`);
  guard.setAttribute("data-active", x === null ? "false" : "true");
  toggleTouchCancel(guard, x !== null);
}

/**
 * The overlay shell's timing for one LayoutPi (rules in
 * ui/piShellGeometry.js, "Timing").
 *
 * A switch of `piLayoutState` is one React update, and one render pass of
 * LayoutPi (the switch record and the scrubber latch are read from the last
 * commit, useCommittedValue, never set during render). In that update's
 * commit, LayoutPi stamps the states below on its root and sets `inert` on
 * what leaves (the rail and the sheet from its render; the dock cell and,
 * through the shell registry, the map chrome by hand, below); the CSS then
 * runs every slide and fade from that one style change. This
 * hook then waits — on the DOM, never with a React render — for the
 * motion's own end:
 *   - the dock band's shield (`dockShieldRef`): up from the commit of a
 *     MIN ↔ MID switch until the DOCK's own transform transition has
 *     ended (form 1 with motion), or SHELL_ONE_FRAME_SHIELD_MS after a
 *     one-frame one (reduced motion, form 2); its cut-out over a live
 *     scrubber follows each commit that changes the chrome
 *     (setScrubberCutout); and its double-tap guard (`dockGuardRef`)
 *     goes up and down with it, only when the click that started the
 *     switch was on the dock, over that click's x (setDockGuard; the
 *     click is recorded by a capture listener on the root, for that
 *     event only; kept beside the event guard the timeline button arms,
 *     ui/tapGuard.js);
 *   - the root's `data-pi-moving`: set in the commit, removed one frame
 *     after the last transition of the rail, the dock, the sheet, the map
 *     overlays and the attribution has ended (form 1 with motion — a
 *     view's close included: it holds until the dock is back), or one
 *     frame after the switch's commit (reduced motion, form 2), and,
 *     opening a view, only after the map has recentred;
 *   - opening a view under form 1 with motion, the SHEET's own transform
 *     transition: then `mapState` follows (one render: the instant
 *     recentre under the sheet, the radar stop, the attribution's two
 *     lines);
 *   - then `settled` (one render; for a view's close, not before
 *     SHELL_ONE_FRAME_SHIELD_MS since its commit): the views' shield
 *     lifts after a close, and `timelineEngaged` turns on if the switch
 *     settled in MIN with the scrubber (unless the scrubber's first
 *     input engaged it earlier, `engageTimeline`: one synchronous commit
 *     inside that input's event — the only render a switch may take
 *     inside its motion, and only on the user's input).
 * Derived per render:
 *   - `chromeState`: what the rail, the dock, the view sheet, the map
 *     overlays and the map's own chrome show (LayoutPi's `data-pi-state`,
 *     WeatherMap's `shellChromeState`) — `state` itself, except for the
 *     generic one-frame wait (afterNextFrame below), which no plan uses
 *     (every reduced-motion switch in one frame);
 *   - `mapState`: what the map's recentring, radar loop and attribution
 *     follow (`data-pi-map`, WeatherMap's `shellMapState`) — held on the
 *     previous state until the sheet has landed (form 1 with motion,
 *     opening a view);
 *   - `shield`: the views' gesture lock (viewShieldHeld);
 *   - `timelineEngaged`: whether the radar scrubber's work (playhead
 *     snap to "now", RainViewer frame window) runs — on once a switch to
 *     MIN has settled, so none of it lands in a slide, or earlier, at the
 *     scrubber's first input (`engageTimeline`); off with the chrome, in
 *     the commit of the switch out of MIN;
 *   - `engageTimeline`: engages the scrubber's work at once, for the
 *     scrubber's first input before the settle (RadarTimeline's
 *     `onShellEngage`): one synchronous commit inside that input's own
 *     event, so the input then acts on an engaged scrubber;
 *   - `instantRecentre`: whether WeatherMap's RailOffsetTracker recentres
 *     without animation for this switch.
 * Each switch runs in the reduced-motion mode current at the render that
 * records it, in its commit (the preference is followed live, ui/systemPrefs.js
 * subscribeReducedMotion).
 * With `variant` null (the grid shell) nothing is tracked and nothing waits:
 * both states equal `state`, no frame, timer, media-query listener or DOM
 * write is requested, and the attributes are empty.
 *
 * The DOM it waits on comes from LayoutPi's refs and the shell registry
 * (read in effects and listeners only, never queried).
 *
 * @param {?string} variant - `piShellVariant()`.
 * @param {string} state - `piLayoutState`, "mid" when unset.
 * @param {boolean} scrubberOpen - `piScrubberOpen`.
 * @param {{current: ?Element}} rootRef - LayoutPi's root.
 * @param {{current: ?Element}} railRef - The rail frame.
 * @param {{current: ?Element}} sheetRef - The view sheet.
 * @param {{current: ?Element}} dockShieldRef - The dock band's shield (`[data-pi-dock-shield]`).
 * @param {{current: ?Element}} dockGuardRef - The shield's double-tap guard (`[data-pi-dock-guard]`).
 * @param {{current: ?Element}} dockCellRef - The dock cell (BottomDock's wrapper, `[data-pi-dock-cell]`).
 * @param {{overlays: function(): Element[], liveScrubber: function(): boolean, attribution: function(): ?Element, present: function(string, boolean): void}} shellElements - The shell registry (ui/shellElements.js): the map overlays and the attribution corner, and the chrome presentation this hook updates.
 * @returns {{chromeState: string, mapState: string, shield: boolean, settled: boolean, timelineEngaged: boolean, engageTimeline: function(): void, instantRecentre: boolean, attributes: object}} The shell's timing for this render.
 */
export default function useShellTiming(variant, state, scrubberOpen, rootRef, railRef, sheetRef, dockShieldRef, dockGuardRef, dockCellRef, shellElements) {
  const active = variant !== null;
  // The preference now (the reduced-motion store above); not read at all off
  // the overlay shell. Only a new switch takes it: everything below runs on
  // the mode recorded with the switch.
  const reducedMotion = useSyncExternalStore(
    active ? subscribeReducedMotion : subscribeNothing,
    active ? prefersReducedMotion : readNoReducedMotion,
  );
  const liveMode = shellMode(variant, reducedMotion);
  // The switch this render runs: the last committed one while `state` is
  // still its target, else the next, from that target to `state`, in the
  // mode current now (ui/piShellGeometry.js nextShellSwitch) — recorded in
  // the same commit as the state that caused it, with the mode it runs in.
  // Derived from the last committed record (useCommittedValue, written back
  // below once committed), not set during render: an update during render
  // would make React call LayoutPi twice at every switch. Off the overlay
  // shell it records nothing: both states stay `state` (id 0).
  const [committedSwitch, switchStore] = useCommittedValue(() => initialShellSwitch(state, liveMode));
  const current = active ? nextShellSwitch(committedSwitch, state, liveMode) : committedSwitch;
  const { id, from, to, mode, plan } = current;

  // A plan's one-frame wait ("frame"): the second step is committed inside
  // the next frame's requestAnimationFrame (flushSync), so it paints on
  // that frame. No plan uses it (ui/piShellGeometry.js shellSwitchPlan):
  // every reduced-motion switch, MIN ↔ MID included, takes one frame.
  const [frameReachedId, setFrameReachedId] = useState(0);
  const frameWaiting = active && (plan.chromeWait === "frame" || plan.mapWait === "frame") && frameReachedId !== id;
  useEffect(() => {
    if (!frameWaiting) return undefined;
    return afterNextFrame(() => flushSync(() => setFrameReachedId(id)));
  }, [frameWaiting, id]);

  // Opening a view: the sheet's own transform transition has ended.
  const [sheetLandedId, setSheetLandedId] = useState(0);
  // The switch has settled (its motion over, plus one frame, and its
  // one-frame hold gone). True at mount (no switch yet).
  const [settledId, setSettledId] = useState(0);
  const settled = settledId === id;

  const chromeState = active && plan.chromeWait === "frame" && frameWaiting ? from : state;
  let mapState = state;
  if (active && plan.mapWait === "frame" && frameWaiting) mapState = from;
  if (active && plan.mapWait === "sheet" && sheetLandedId !== id) mapState = from;

  const shield = active && viewShieldHeld(chromeState, plan.kind, settled);

  // The scrubber's work: it starts once a switch to MIN has settled
  // (latched), or at the scrubber's first input if that comes first
  // (`earlyEngagedId`, below), but stops with the chrome, in the switch's
  // own commit — the scrubber is inert from there, and pinning the radar
  // back to "now" is the tap's work, as before the overlay shell; held, a
  // playing loop would keep stepping (and retargeting RainViewer layers)
  // through the motion out of MIN. A reversal before the settle doesn't
  // re-engage it: the fall is kept from the switch's own commit. The latch
  // is the last committed render's value (useCommittedValue, like the switch
  // record: no update during render).
  const wantEngaged = active && overlayPresentation(chromeState, scrubberOpen).scrubber;
  const [engaged, engagedStore] = useCommittedValue(() => wantEngaged);
  const [earlyEngagedId, setEarlyEngagedId] = useState(0);
  const timelineEngaged = wantEngaged && (engaged || (active && (settled || earlyEngagedId === id)));

  // What this render ran, kept for the next render: the switch record and
  // the latch, written in the passive effects of the commit that showed
  // them, after the two reads above (ui/committedValue.js: React flushes
  // them before any later render, and never renders again for them).
  useEffect(() => {
    switchStore.write(current);
    engagedStore.write(timelineEngaged);
  }, [switchStore, engagedStore, current, timelineEngaged]);

  // The scrubber's first input before the settle: engage now, in one
  // synchronous commit inside that input's own event — the playhead snaps to
  // "now" in that render (WeatherMap), and the RainViewer frame window
  // follows what the input then does — so the same press goes on to act
  // normally on an engaged scrubber (play, step, return to now, a tap on the
  // track, or a drag that continues). The main-thread work that engagement
  // costs is accepted at that moment, even inside the slide (in a desktop
  // trace: that commit, plus the RainViewer frame window's 4 extra layers
  // and their tile requests). Only for the switch in flight (`id`); a later
  // switch needs its own.
  // Engaging at once, rather than queuing the press until the scrubber is
  // ready, keeps a visible control from ever ignoring an input; replaying
  // a drag begun too early has no good answer.
  // One function for the hook's lifetime: the switch it
  // engages is the last committed one, which each switch's commit writes
  // to a ref before any later input can run — the id that a function made
  // per switch would hold, without handing RadarTimeline (through
  // WeatherMap) a new prop at every switch.
  const engageIdRef = useRef(id);
  useLayoutEffect(() => {
    engageIdRef.current = id;
  }, [id]);
  const engageTimeline = useCallback(() => {
    flushSync(() => setEarlyEngagedId(engageIdRef.current));
  }, []);

  // The switch in flight: whether its transitions have ended, whether its
  // map has recentred (opening a view), and how to end it.
  const motionRef = useRef(null);

  // The click that starts a switch, when it lands on the dock (the dock
  // cell, `dockCellRef`): its x, which the switch's effect below consumes
  // to place the double-tap guard. A capture listener on the root runs before
  // React's onClick (dispatched from the React root, an ancestor, in the
  // bubble phase), so the click is recorded before the switch it causes
  // commits; it is cleared once that event's task is over, so a switch
  // made without one (a key press, a state change from elsewhere) never
  // reuses it. `detail` 0 is a keyboard or synthetic click: no place to
  // guard. Off the overlay shell it listens to nothing.
  const dockPressRef = useRef(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!active || !root) return undefined;
    let clear = 0;
    const onClick = (event) => {
      const dock = dockCellRef.current;
      dockPressRef.current = event.detail > 0 && dock && dock.contains(event.target) ? { x: event.clientX } : null;
      clearTimeout(clear);
      clear = setTimeout(() => {
        dockPressRef.current = null;
      }, 0);
    };
    root.addEventListener("click", onClick, true);
    return () => {
      root.removeEventListener("click", onClick, true);
      clearTimeout(clear);
    };
  }, [active, rootRef, dockCellRef]);

  // The chrome kept mounted outside its state follows each chrome change in
  // that commit, by hand, with no render of its own (a prop flip would
  // re-render each of them, the dock with its health chip, at every view
  // switch): the dock cell is inert outside MID, and the shell registry sets
  // the map chrome's `inert` (the legend's three presentations, the
  // radar-focus button; ui/shellElements.js present), then tells the
  // components that subscribe while something of theirs is open. Layout
  // effect, first of the chrome's: the attributes are in place before the
  // frame that paints the switch, as React's own are. They land after
  // React's mutation phase, though, and after the layout effects of
  // LayoutPi's children, which run before this one: a child's layout effect
  // that read style or layout in a switch's commit would see the new
  // `data-pi-state` with the old `inert` (React props would set both in the
  // mutation phase). None does — the map's recentre reads Leaflet's cached
  // size, and the transitions are read two frames later
  // (whenStartedTransitionsEnd) — and a new one must not.
  const inertDockRef = useRef(null);
  useLayoutEffect(() => {
    if (!active) return;
    const dock = dockCellRef.current;
    inertDockRef.current = dock;
    if (dock) dock.toggleAttribute("inert", chromeState !== "mid");
    shellElements.present(chromeState, scrubberOpen);
  }, [active, chromeState, scrubberOpen, dockCellRef, shellElements]);

  // The shell turning off under a mounted LayoutPi (`variant` null at a
  // later render): the dock cell, which BottomDock keeps rendering, goes
  // back without the `inert` set above. No React prop carries it, so nothing
  // else would clear it, and React has detached the cell's ref before this
  // cleanup runs (a child's refs first), hence the element kept by the last
  // present. The map chrome's `inert` goes back as each element leaves the
  // shell registry (ui/shellElements.js), the zoom bar's with ShellZoomInert
  // (WeatherMap). Defensive: the compiled LayoutPi never turns the shell off
  // (the React Compiler memoizes its argument-less `piShellVariant()` call
  // once per mount, a desktop window resized across 540 px included), but
  // its source reads the gate per render and nothing pins that memoization.
  // Also runs on LayoutPi's unmount, on a cell about to go.
  useLayoutEffect(() => {
    if (!active) return undefined;
    return () => {
      const dock = inertDockRef.current;
      inertDockRef.current = null;
      if (dock) dock.removeAttribute("inert");
    };
  }, [active]);

  // The dock band shield's cut-out over a live scrubber, in every commit
  // that changes the chrome: it follows the DOM, so only a mounted, live
  // scrubber (none without RainViewer frames, or on ECCC radar) uncovers
  // its box. Before the switch's own effect below, which raises the
  // shield; neither reads style or layout in the commit.
  useLayoutEffect(() => {
    if (!active || !rootRef.current) return;
    setScrubberCutout(dockShieldRef.current, shellElements.liveScrubber());
  }, [active, id, chromeState, scrubberOpen, rootRef, dockShieldRef, shellElements]);

  // A switch's commit: mark the motion, raise the dock band's shield, and
  // wait for the ends. Layout effect, so the attribute and the shield are
  // in place before the frame that paints the switch; the waits read the
  // transitions only two frames later (whenStartedTransitionsEnd), so the
  // commit forces no style recalc.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!active || id === 0 || !root) return undefined;
    const cancels = [];
    root.setAttribute(MOVING_ATTRIBUTE, "true");

    const shieldEl = dockShieldRef.current;
    const guardEl = dockGuardRef.current;
    const shieldMode = dockShieldMode(from, to, mode);
    setDockShield(shieldEl, shieldMode !== "none");
    // The double-tap guard goes up with the shield, over the click that
    // made this switch if it was on the dock (consumed: one switch only).
    const press = dockPressRef.current;
    dockPressRef.current = null;
    setDockGuard(guardEl, shieldMode !== "none" && press ? press.x : null);
    const lowerDockShield = () => {
      setDockShield(shieldEl, false);
      setDockGuard(guardEl, null);
    };
    if (shieldMode === "hold") {
      const timer = setTimeout(lowerDockShield, SHELL_ONE_FRAME_SHIELD_MS);
      cancels.push(() => clearTimeout(timer));
    } else if (shieldMode === "dockEnd") {
      const dock = dockCellRef.current;
      cancels.push(whenStartedTransitionsEnd(() => shellTransitions([dock], "transform"), lowerDockShield));
    }
    cancels.push(() => setDockGuard(guardEl, null));

    const holdUntil = performance.now() + settleHoldMs(from, to);
    const motion = { id, ended: false, recentred: plan.mapWait !== "sheet", finishing: false, finish: null };
    motion.finish = () => {
      if (!motion.ended || !motion.recentred || motion.finishing) return;
      motion.finishing = true;
      cancels.push(afterNextFrame(() => {
        root.removeAttribute(MOVING_ATTRIBUTE);
        const wait = holdUntil - performance.now();
        if (wait > 0) {
          const timer = setTimeout(() => setSettledId(id), wait);
          cancels.push(() => clearTimeout(timer));
        } else {
          setSettledId(id);
        }
      }));
    };
    motionRef.current = motion;

    if (motionEnd(mode) === "transitions") {
      const moving = [
        railRef.current,
        dockCellRef.current,
        sheetRef.current,
        shellElements.attribution(),
        ...shellElements.overlays(),
      ];
      cancels.push(whenStartedTransitionsEnd(() => shellTransitions(moving), () => {
        motion.ended = true;
        motion.finish();
      }));
      // Opening a view: the sheet's slide starts from this commit's style
      // change, in the tap's own frame, already one frame into its curve
      // (the CSS pre-roll, LayoutPi/styles.css `.sheet`); this hook never
      // touches its pose.
      if (plan.mapWait === "sheet") {
        const sheet = sheetRef.current;
        cancels.push(whenStartedTransitionsEnd(() => shellTransitions([sheet], "transform"), () => setSheetLandedId(id)));
      }
    }
    return () => {
      for (const cancel of cancels) cancel();
    };
  }, [active, id, from, to, mode, plan, rootRef, railRef, sheetRef, dockShieldRef, dockGuardRef, dockCellRef, shellElements]);

  // Reduced motion and form 2: the motion is over with the switch's commit.
  useLayoutEffect(() => {
    const motion = motionRef.current;
    if (!active || frameWaiting || motionEnd(mode) !== "frame" || !motion || motion.id !== id) return;
    motion.ended = true;
    motion.finish();
  }, [active, id, mode, frameWaiting]);

  // Opening a view: the commit in which the map has recentred under the
  // landed sheet (WeatherMap's layout effect ran first, as a child).
  useLayoutEffect(() => {
    const motion = motionRef.current;
    if (!motion || motion.id !== id || sheetLandedId !== id || motion.recentred) return;
    motion.recentred = true;
    motion.finish();
  }, [id, sheetLandedId]);

  return {
    chromeState,
    mapState,
    shield,
    settled,
    timelineEngaged,
    engageTimeline,
    instantRecentre: active && recentresInstantly(mode, plan.kind),
    attributes: active
      ? {
        "data-pi-map": mapState,
        "data-pi-switch": plan.kind,
      }
      : NO_TIMING_ATTRIBUTES,
  };
}
