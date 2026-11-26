// The style warm-up of the alert view's switch under LayoutPi's overlay
// shell: one synchronous task, at rest in MID, under the sheet warm-up
// scheduler's gates, that forces style with a read that forces no layout —
// no frame, no layer, no React state, nothing left set, the focus
// unchanged; once per load, and again when content mounts at the alert
// host's top; marked in data-pi-warmed. Scheduled by ui/sheetWarmup.js
// (its `styleWarmup` step), wired by components/ambient/LayoutPi/
// useHostWarmup.js.
//
// What it warms. The first alert opening since load pays a style recalc
// that the next ones don't: in the click's task, after React's commit,
// Blink restyles the shell (measured on a Pi 4 kiosk: 28–36 ms for 187
// elements against 12–20 ms for 150 at the second opening; the first close
// too, +7 ms at an equal count). The extra cost is per element and per
// load (the same renderer pays it again after a reload), and the warm pose
// of the hosts (useHostWarmup) doesn't remove it: it resolves the alert
// host in another combination (MID, the closed sheet in its warm pose). So
// the warm-up resolves the switch's own combinations, at rest:
// it writes what the switch's commits write, forces style, and puts every
// attribute back, in one synchronous task — no frame can render in
// between, React renders nothing (no state, no prop: the attributes React
// owns are written back to what it last rendered before the task ends),
// and the next frame finds every attribute as it was (it still lays out
// and repaints what the recalcs marked, at rest, with no visible change).
//
// What it writes. The list is a recording, not a reading of the code: a
// MutationObserver on the whole document around a real opening and closing
// of the alert view on a production bundle, the writes of each click's
// task in the order the commit made them, ALERT_SWITCH_STEPS below:
//   - the opening's commit: the rail frame inert, the views' shield
//     mounted (React renders it; the warm-up inserts a stand-in with the
//     same class and aria-hidden, at the same place, before the dock band's
//     shield, and removes it), the sheet no longer inert, the root's
//     data-pi-state "alert" and data-pi-switch "view", the dock cell, the
//     radar-focus button and Leaflet's zoom bar inert, data-pi-moving, the
//     dock band shield's and its guard's data-active rewritten "false";
//   - the close's commit: the rail and the dock cell live again, the sheet
//     inert, data-pi-state and data-pi-map "mid", the radar-focus button
//     and the zoom bar live again, data-pi-moving, the dock band shield's
//     and its guard's data-active rewritten "false". The real close starts
//     from the landed opening (data-pi-map "alert", written once the sheet
//     has landed); the warm-up poses the close's writes straight on the
//     opening's commit (what an opening's commit writes, then the same for
//     the close), so its data-pi-map write sets the "mid" it already holds.
//     Measured on a desktop Chromium: this form brought the first opening
//     and the first close to the second's level in 9 launches of 10 and 10
//     of 10. Recorded with motion: under reduced motion the opening's
//     commit also writes data-pi-map (no slide to wait for), which the
//     warm-up does not pose (not measured).
// After each step the style is brought up to date by one read of the
// root's computed `visibility` (STYLE_FORCE_PROPERTY): a property that
// is not layout-dependent, so Blink updates style and the layout tree
// (Document::UpdateStyleAndLayoutTreeForElement) without a layout —
// performance traces show no Layout inside the task. Then the restore: each
// attribute back to its value before the task (where it differs), the
// stand-in shield removed, style forced once more, so the next frame has
// no style left to compute for it. The switch's CSS transitions (the
// sheet's and the dock cell's) are created by the opening's recalc and
// cancelled by the close's, before any frame: getAnimations() is empty
// when the task ends, nothing moves on screen, and their transitionrun /
// transitioncancel events are dispatched at the next frame (nothing in the
// app listens to them; measurement tooling leaves them out by the task's
// marks).
//
// When. Under the warm-up scheduler's gates (ui/sheetWarmup.js: at rest,
// the page and its fonts loaded, no pointer down, a quiet second, in an
// idle callback), once the alert host is warm, and only when
// styleWarmupBlocker() finds nothing in the way: the shell in MID (the
// opening starts from MID's rail), no warm frame and no switch under way,
// an alert mounted at the alert host's top, the focus outside what the
// opening makes inert (so no focus moves). Once per load, and again when
// content mounts at the alert host's top (the scheduler forgets it with
// the host's warmth). A step that finds a blocker runs nothing and waits
// for the scheduler's next turn.
//
// The font gate. Before its task, the warm-up waits for the document's
// font set to be done loading — one gate more, fontGateOpen():
// document.fonts.status "loaded", that is document.fonts.ready resolved and
// no face pending, of any family (a face never requested, or failed, is not
// pending). Why: the Geist 700 face, requested by the alert content, arrives
// after the warm-up on a Pi 4 kiosk, and its load empties the
// MatchedPropertiesCache that the warm-up fills (Chromium 154; reproduced on
// a desktop Chromium with the woff2 held back) — as does any web face
// loaded or failed (StyleEngine::FontsNeedUpdate), so the warm-up runs only
// once no face is in flight. (Waiting for that one face alone,
// check('700 16px Geist') true while another face still loads, would not
// do.) The gate is read again at each of the scheduler's turns; when it is
// all that keeps the warm-up back, the scheduler waits for
// whenFontGateOpens() — document.fonts.ready, or the set's loadingdone /
// loadingerror — then takes an ordinary turn: the warm-up runs at the
// first idle after, its other conditions unchanged (the quiet second is not
// restarted), with the same task, marks and token. The gate brings
// nothing up to date (Chromium 154): status reads FontFaceSet::is_loading_
// only, and the wait reads document.fonts.ready only while the set is
// loading, when it is pending (AddToLoadingFonts resets a settled ready) —
// so FontFaceSetDocument::ready's UpdateStyleAndLayout, done only when ready
// is already resolved, does not run here. One exception: a face starting to
// load inside a loadingdone / loadingerror listener (FireDoneEvent resolves
// ready after dispatching them), when the next wait reads the settled ready
// once; no such listener in this client (the wait is document.fonts' only
// listener).
//
// For measurement tooling only: the task is bracketed by the user-timing
// marks STYLE_WARM_START_MARK and STYLE_WARM_END_MARK; before the end mark
// the scheduler adds the token STYLE_WARM_TOKEN to the root's
// data-pi-warmed (its other tokens kept). Nothing in the app reads either,
// and neither has a visible effect.
//
// MODULE FORMAT: CommonJS on purpose, like ui/sheetWarmup.js, so
// test/styleWarmup.test.js runs the real module against stand-in elements.

const { MOVING_ATTRIBUTE } = require("./pressTint");
const { shellSwitchPlan, SHELL_MODES } = require("./piShellGeometry");

/** The view whose switch the style warm-up warms (its host is the alert host). */
const STYLE_WARM_STATE = "alert";

/** The token the style warm-up adds to the root's data-pi-warmed once it has run (for measurement tooling). */
const STYLE_WARM_TOKEN = "style";

/**
 * The user-timing marks around the style warm-up's task, for measurement
 * tooling only (it waits for them, leaves the task out of its measures and
 * times it; nothing in the app reads them, and they have no visible
 * effect). test/styleWarmup.test.js pins their names, which that tooling
 * matches on.
 */
const STYLE_WARM_START_MARK = "pi-k6-start";
const STYLE_WARM_END_MARK = "pi-k6-end";

/** The FontFaceSet events that end a loading round: dispatched with document.fonts.ready's resolution. */
const FONT_DONE_EVENTS = Object.freeze(["loadingdone", "loadingerror"]);

/** The computed property read to bring style up to date: not layout-dependent in Blink, so no layout is forced. */
const STYLE_FORCE_PROPERTY = "visibility";

/** The switch kind the alert's opening and closing write on the root (`data-pi-switch`, useShellTiming). */
const VIEW_SWITCH_KIND = shellSwitchPlan("mid", STYLE_WARM_STATE, SHELL_MODES.animated).kind;

/** What the style warm-up writes, step by step: [element key, attribute, value] (null removes it; the "shield" key inserts the stand-in). */
const ALERT_SWITCH_STEPS = Object.freeze([
  Object.freeze({
    name: "open",
    writes: Object.freeze([
      ["rail", "inert", ""],
      ["shield", null, null],
      ["sheet", "inert", null],
      ["root", "data-pi-state", STYLE_WARM_STATE],
      ["root", "data-pi-switch", VIEW_SWITCH_KIND],
      ["dockCell", "inert", ""],
      ["viewChrome", "inert", ""],
      ["zoomBar", "inert", ""],
      ["root", MOVING_ATTRIBUTE, "true"],
      ["dockShield", "data-active", "false"],
      ["dockGuard", "data-active", "false"],
    ]),
  }),
  Object.freeze({
    name: "close",
    writes: Object.freeze([
      ["rail", "inert", null],
      ["sheet", "inert", ""],
      ["root", "data-pi-state", "mid"],
      ["root", "data-pi-map", "mid"],
      ["dockGuard", "data-active", "false"],
      ["dockCell", "inert", null],
      ["viewChrome", "inert", null],
      ["zoomBar", "inert", null],
      ["root", MOVING_ATTRIBUTE, "true"],
      ["dockShield", "data-active", "false"],
      ["dockGuard", "data-active", "false"],
    ]),
  }),
]);

/**
 * What keeps the style warm-up from running now, or null when nothing does.
 *
 * @param {object} e - The elements (styleWarmupElements' shape).
 * @param {?object} activeElement - document.activeElement.
 * @returns {?string} The reason, or null.
 */
function styleWarmupBlocker(e, activeElement) {
  if (!e.root || !e.rail || !e.sheet || !e.dockCell || !e.dockShield || !e.dockGuard) return "an element is not mounted";
  if (!e.shieldClassName) return "no shield class";
  if (e.root.getAttribute("data-pi-state") !== "mid") return "not in MID";
  if (e.root.hasAttribute("data-pi-warm") || e.root.hasAttribute(MOVING_ATTRIBUTE)) return "a warm frame or a switch under way";
  if (!e.alertHost || !e.alertHost.firstElementChild) return "no alert mounted";
  const goesInert = [e.rail, e.dockCell, ...e.viewChrome, e.zoomBar].filter(Boolean);
  if (activeElement && goesInert.some((el) => el === activeElement || (typeof el.contains === "function" && el.contains(activeElement)))) return "the focus is in what the opening makes inert";
  return null;
}

/**
 * The font gate (see the header): whether the font set is done loading.
 *
 * @param {?object} fonts - document.fonts (null or absent: no font set, nothing to wait for).
 * @returns {boolean} true when the style warm-up may run: the set's status "loaded" (no face pending).
 */
function fontGateOpen(fonts) {
  return !fonts || fonts.status === "loaded";
}

// The ready promises seen resolved: a gate still shut after one resolved waits for the set's events, never for
// the same promise again (no microtask loop).
const settledReady = new WeakSet();

/**
 * Calls `callback` once the font gate may have opened: document.fonts.ready settled (resolved or rejected alike),
 * or a loadingdone / loadingerror event — whichever comes first.
 * The caller reads the gate again then.
 *
 * @param {?object} fonts - document.fonts.
 * @param {function(): void} callback - Called once, at most.
 * @returns {function(): void} Cancels it (the listeners removed).
 */
function whenFontGateOpens(fonts, callback) {
  let live = true;
  const off = [];
  const cancel = () => {
    live = false;
    for (const f of off.splice(0)) f();
  };
  const fire = () => {
    if (!live) return;
    cancel();
    callback();
  };
  if (!fonts) return cancel; // no font set: nothing to wait for (the gate is open)
  const { ready } = fonts;
  if (ready && typeof ready.then === "function" && !settledReady.has(ready)) {
    const settled = () => {
      settledReady.add(ready);
      fire();
    };
    ready.then(settled, settled);
  }
  if (typeof fonts.addEventListener === "function") {
    for (const type of FONT_DONE_EVENTS) {
      fonts.addEventListener(type, fire);
      off.push(() => fonts.removeEventListener(type, fire));
    }
  }
  return cancel;
}

/**
 * The style warm-up's task (see the header): the switch's writes step by
 * step, style forced after each, then everything put back and style forced
 * again. One synchronous call; nothing is left set.
 *
 * @param {object} o - Options.
 * @param {object} o.elements - root, rail, sheet, dockCell, dockShield, dockGuard, alertHost (elements), viewChrome (an array), zoomBar (or null), shieldClassName.
 * @param {function(string): object} o.createElement - document.createElement.
 * @param {?object} o.activeElement - document.activeElement.
 * @param {function(object): void} o.forceStyle - Brings style up to date by reading a non-layout property of the element.
 * @param {function(string): void} o.mark - performance.mark.
 * @param {?function(): void} [o.done] - Called once the task has put everything back, before its end mark (the scheduler's token; null: nothing).
 * @returns {{ran: boolean, why: ?string, steps: string[], restored: number}} What ran.
 */
function runStyleWarmup({ elements: e, createElement, activeElement, forceStyle, mark, done = null }) {
  const why = styleWarmupBlocker(e, activeElement);
  if (why) return { ran: false, why, steps: [], restored: 0 };
  mark(STYLE_WARM_START_MARK);
  // Each attribute's value before the task, the first time it is written.
  const before = [];
  const keep = (el, name) => {
    if (!before.some((b) => b.el === el && b.name === name)) before.push({ el, name, value: el.getAttribute(name) });
  };
  const write = (el, name, value) => {
    keep(el, name);
    if (value === null) el.removeAttribute(name);
    else el.setAttribute(name, value);
  };
  let shield = null;
  const steps = [];
  for (const step of ALERT_SWITCH_STEPS) {
    for (const [key, name, value] of step.writes) {
      if (key === "shield") {
        shield = createElement("div");
        shield.className = e.shieldClassName;
        shield.setAttribute("aria-hidden", "true");
        e.root.insertBefore(shield, e.dockShield);
      } else {
        const targets = key === "viewChrome" ? e.viewChrome : [e[key]];
        for (const el of targets) if (el) write(el, name, value);
      }
    }
    forceStyle(e.root);
    steps.push(step.name);
  }
  if (shield) shield.remove();
  let restored = 0;
  for (const b of before) {
    if (b.el.getAttribute(b.name) === b.value) continue;
    if (b.value === null) b.el.removeAttribute(b.name);
    else b.el.setAttribute(b.name, b.value);
    restored += 1;
  }
  forceStyle(e.root);
  steps.push("restore");
  if (done) done();
  mark(STYLE_WARM_END_MARK);
  return { ran: true, why: null, steps, restored };
}

/**
 * The scheduler's `styleWarmup` step for a LayoutPi (ui/sheetWarmup.js):
 * the elements read at each run through the given getters; the font gate
 * reads the document's font set each time it is asked.
 *
 * @param {object} o - Options.
 * @param {function(): object} o.elements - Returns the elements (runStyleWarmup's `elements`), read when the step runs.
 * @param {object} [o.doc] - The document (createElement, activeElement).
 * @param {object} [o.view] - The window (getComputedStyle).
 * @param {function(string): void} [o.mark] - performance.mark.
 * @returns {{state: string, token: string, gate: {open: function(): boolean, whenOpen: function(function(): void): function(): void},
 *   run: function(function(): void): {ran: boolean, why: ?string, steps: string[], restored: number}}} The step.
 */
function createStyleWarmup({
  elements,
  doc = globalThis.document,
  view = globalThis,
  mark = (name) => globalThis.performance.mark(name),
}) {
  return {
    state: STYLE_WARM_STATE,
    token: STYLE_WARM_TOKEN,
    gate: {
      open: () => fontGateOpen(doc ? doc.fonts : null),
      whenOpen: (callback) => whenFontGateOpens(doc ? doc.fonts : null, callback),
    },
    run: (done) => runStyleWarmup({
      elements: elements(),
      createElement: (tag) => doc.createElement(tag),
      activeElement: doc.activeElement,
      forceStyle: (el) => view.getComputedStyle(el).getPropertyValue(STYLE_FORCE_PROPERTY),
      mark,
      done,
    }),
  };
}

module.exports = {
  STYLE_WARM_STATE,
  STYLE_WARM_TOKEN,
  STYLE_WARM_START_MARK,
  STYLE_WARM_END_MARK,
  STYLE_FORCE_PROPERTY,
  FONT_DONE_EVENTS,
  VIEW_SWITCH_KIND,
  ALERT_SWITCH_STEPS,
  styleWarmupBlocker,
  fontGateOpen,
  whenFontGateOpens,
  runStyleWarmup,
  createStyleWarmup,
};
