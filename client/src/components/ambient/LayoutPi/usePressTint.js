import { useEffect, useRef } from "react";
import { createPressTint } from "~/ui/pressTint";

/* The press tint under LayoutPi's overlay shell (always on under the shell,
 * with no setting). A view trigger (`data-pi-press`) gets `data-pi-pressed`
 * at its primary pointerdown, which LayoutPi/styles.css turns into a
 * background tint with no geometry. The release never removes it: the opener
 * stays pressed under the sheet until the switch has settled, and the marks
 * go in an idle callback then, out of sight. A press that starts no switch
 * loses its mark one frame after its click (or, with no click at all, after
 * the tap guard's release tail), and a new press clears any older mark
 * first. The listeners and those rules: ui/pressTint.js (CommonJS, so
 * test/pressTint.test.js runs them). All by hand on the DOM: no React
 * render, and no DOM query — the tint keeps the elements it marked, and the
 * settle asks it for them. */

const IDLE_TIMEOUT_MS = 500;

/**
 * The overlay shell's press tint marks (see the header).
 *
 * @param {boolean} enabled - The overlay shell on (the tint has no switch of its own).
 * @param {{current: ?Element}} rootRef - LayoutPi's root.
 * @param {boolean} settled - useShellTiming's `settled` (the last switch's motion is over).
 * @returns {void}
 */
export default function usePressTint(enabled, rootRef, settled) {
  // The live tint, for the settle's effect below (declared after this one,
  // so at mount, and whenever both re-run, it reads the tint just made).
  const tintRef = useRef(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!enabled || !root) return undefined;
    const tint = createPressTint(root);
    tintRef.current = tint;
    return () => {
      tintRef.current = null;
      tint.dispose();
    };
  }, [enabled, rootRef]);

  // Settled: the marks present now go out of sight, in an idle callback —
  // only those: a press made after the settle but before the callback runs
  // (the landed view's back button, while the AI reply renders) keeps its
  // mark under the finger. The next switch cancels the callback if it
  // starts first; the next press on a trigger then clears the old mark
  // (ui/pressTint.js).
  useEffect(() => {
    const tint = tintRef.current;
    if (!enabled || !settled || !tint) return undefined;
    const marked = tint.marked();
    if (marked.length === 0) return undefined;
    const clearSettled = () => tint.unmark(marked);
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(clearSettled, { timeout: IDLE_TIMEOUT_MS });
      return () => cancelIdleCallback(id);
    }
    const timer = setTimeout(clearSettled, 0);
    return () => clearTimeout(timer);
  }, [enabled, settled]);
}
