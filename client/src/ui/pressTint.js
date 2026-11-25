// The press tint under LayoutPi's overlay shell (always on under the
// shell, no switch; React side: components/ambient/LayoutPi/usePressTint.js).
//
// A view trigger carries `data-pi-press` (the hero's ⤢, the compact alert
// card, the dock's view buttons, the views' back buttons). At its primary
// pointerdown it gets `data-pi-pressed`, which LayoutPi/styles.css turns
// into a background tint with no geometry, in a frame where nothing else
// happens. The release never removes it: the opener stays pressed under the
// sheet (the dock's buttons under the hidden dock, a back button inside the
// hidden sheet) until the switch has settled, and the hook clears the marks
// in an idle callback then, out of sight.
//
// A press that starts no switch loses its mark, and the decision hangs on
// the CLICK, not on the release. With a mouse the click comes in the
// release's own task. With touch it does not: Chromium dispatches pointerup
// with touchend, and the click comes from a later GestureTap, sent by the
// browser process only once the renderer has acked that touchend (React's
// root touchend listener is not passive, so the ack waits for the main
// thread). A frame can fall in between, so "clear on the release's next
// frame unless a switch is moving" would remove the tint before the view
// opened on some touch taps. So:
//   - the release arms a fallback timer, for a press that never clicks (the
//     finger slid past the touch slop, a long press): PRESS_TINT_NO_CLICK_MS,
//     the tap guard's own allowance for a click that trails its release
//     (ui/tapGuard.js TAP_GUARD_RELEASE_TAIL_MS);
//   - a click, seen in the capture phase on LayoutPi's root (before React's
//     onClick, which React dispatches from its own root container, an
//     ancestor, in the bubble phase), cancels that timer and checks one
//     frame later: React commits the click's switch in that same task, and
//     its layout effect puts `data-pi-moving` on the root (useShellTiming),
//     so a mark still there on the next frame with no motion belongs to a
//     click that started nothing;
//   - a click the tap guard swallows never reaches the root (it stops the
//     event at the document): the timer clears the mark;
//   - pointercancel clears at once.
// Whatever check is pending, it only clears when no switch is moving.
//
// A new press on a trigger first clears every other mark (and cancels a
// pending check, which would otherwise clear the new mark under the
// finger). A mark can outlive its switch: the settle's idle callback is
// cancelled when the next switch starts before it runs (close a view and
// reopen it from the dock while the dock comes back; close it again right
// after it lands), and the old mark would then ride the next slide and go
// once it lands, a repaint in the landed sheet. At the next touch-down the
// old mark's element is out of sight (inside the hidden sheet, under the
// sheet or under the hidden dock), so it goes there, unseen.
//
// All by hand on the DOM: no React render. And no tree walk: the tint
// keeps the elements it marked, so finding, keeping or clearing a mark
// never queries the root's subtree, the map's tiles included — as a
// release, a click and a new press would each have to otherwise
// (`querySelector(All)`). The settle's idle clear asks the tint for its
// marks (`marked()` / `unmark()`) instead of querying for them.
//
// MODULE FORMAT: CommonJS on purpose, like ui/tapGuard.js, so
// test/pressTint.test.js runs the real module under `node --test`, against a
// stand-in root (no DOM in Node): it uses addEventListener /
// removeEventListener, hasAttribute and contains on the root, and closest /
// setAttribute / removeAttribute on its elements.

const { TAP_GUARD_RELEASE_TAIL_MS } = require("./tapGuard");

/** The view triggers' attribute (set in their JSX). */
const PRESS_SELECTOR = "[data-pi-press]";

/** The press mark, set and cleared here only. */
const PRESSED_ATTRIBUTE = "data-pi-pressed";
const PRESSED_SELECTOR = `[${PRESSED_ATTRIBUTE}]`;

/** On LayoutPi's root while a switch moves (useShellTiming). */
const MOVING_ATTRIBUTE = "data-pi-moving";

/** How long after a release with no click its mark is kept (ms). */
const PRESS_TINT_NO_CLICK_MS = TAP_GUARD_RELEASE_TAIL_MS;

/**
 * The press tint's listeners on LayoutPi's root (capture phase), added at
 * once (see the header).
 *
 * @param {Element} root - LayoutPi's root.
 * @param {object} [options] - Frame and timer functions (injected by the tests).
 * @param {(fn: () => void) => number} [options.requestFrame] - Default requestAnimationFrame.
 * @param {(id: number) => void} [options.cancelFrame] - Default cancelAnimationFrame.
 * @param {(fn: () => void, ms: number) => number} [options.setTimer] - Default setTimeout.
 * @param {(id: number) => void} [options.clearTimer] - Default clearTimeout.
 * @param {number} [options.noClickMs] - The no-click fallback (default PRESS_TINT_NO_CLICK_MS).
 * @returns {{dispose: () => void, marked: () => Element[], unmark: (elements: Element[]) => void}}
 *   dispose() removes the listeners, cancels any pending check and clears
 *   every mark; marked() the elements marked now (under the root);
 *   unmark(elements) clears those elements' marks
 */
function createPressTint(root, {
  requestFrame = (fn) => requestAnimationFrame(fn),
  cancelFrame = (id) => cancelAnimationFrame(id),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  noClickMs = PRESS_TINT_NO_CLICK_MS,
} = {}) {
  let frame = null;
  let timer = null;
  // The elements this tint marked and hasn't cleared: the only writer of
  // PRESSED_ATTRIBUTE, it never has to look for one.
  const pressed = new Set();

  // Clears every mark, but `keep`'s (an element React has since removed
  // from the root is dropped too, out of sight).
  const clearPressed = (keep = null) => {
    for (const el of pressed) {
      if (el === keep) continue;
      el.removeAttribute(PRESSED_ATTRIBUTE);
      pressed.delete(el);
    }
  };
  // Marks under the root now (`contains` climbs from the element, it walks
  // no subtree).
  const markedNow = () => [...pressed].filter((el) => root.contains(el));

  const cancelPending = () => {
    if (frame !== null) {
      cancelFrame(frame);
      frame = null;
    }
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  };

  const clearUnlessMoving = () => {
    if (!root.hasAttribute(MOVING_ATTRIBUTE)) clearPressed();
  };

  const onDown = (event) => {
    if (event.isPrimary === false) return;
    const { target } = event;
    const el = target && typeof target.closest === "function" ? target.closest(PRESS_SELECTOR) : null;
    if (!el || !root.contains(el)) return;
    cancelPending();
    clearPressed(el);
    el.setAttribute(PRESSED_ATTRIBUTE, "");
    pressed.add(el);
  };

  const onUp = (event) => {
    if (event.isPrimary === false || markedNow().length === 0) return;
    cancelPending();
    timer = setTimer(() => {
      timer = null;
      clearUnlessMoving();
    }, noClickMs);
  };

  const onClick = () => {
    if (markedNow().length === 0) return;
    cancelPending();
    // React commits this click's switch, if any, later in this task: by the
    // next frame `data-pi-moving` is on the root.
    frame = requestFrame(() => {
      frame = null;
      clearUnlessMoving();
    });
  };

  const onCancel = () => {
    cancelPending();
    clearPressed();
  };

  root.addEventListener("pointerdown", onDown, true);
  root.addEventListener("pointerup", onUp, true);
  root.addEventListener("click", onClick, true);
  root.addEventListener("pointercancel", onCancel, true);

  return {
    dispose() {
      cancelPending();
      root.removeEventListener("pointerdown", onDown, true);
      root.removeEventListener("pointerup", onUp, true);
      root.removeEventListener("click", onClick, true);
      root.removeEventListener("pointercancel", onCancel, true);
      clearPressed();
    },
    marked: markedNow,
    unmark(elements) {
      for (const el of elements) {
        el.removeAttribute(PRESSED_ATTRIBUTE);
        pressed.delete(el);
      }
    },
  };
}

module.exports = {
  PRESS_SELECTOR,
  PRESSED_ATTRIBUTE,
  PRESSED_SELECTOR,
  MOVING_ATTRIBUTE,
  PRESS_TINT_NO_CLICK_MS,
  createPressTint,
};
