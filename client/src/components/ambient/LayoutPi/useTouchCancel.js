import { useLayoutEffect } from "react";
import { cancelTouches } from "~/ui/tapGuard";

/* Touch cancellation on LayoutPi's overlay-shell shields and the dock band's
 * guard. Such an element takes a press's pointerdown, but Chromium hit-tests
 * the tap again for the compatibility mouse events and the click after the
 * release; once the element has stopped blocking (a cut-out opened, a guard
 * lowered, the views' shield unmounted), they go to what lies beneath (a
 * mousedown and a click on the radar scrubber, for instance). Cancelling
 * the touch at its touchstart drops them: ui/tapGuard.js `cancelTouches`, a
 * non-passive listener on the element itself (React's own touchstart
 * listener is passive, so an `onTouchStart` could not cancel). A layout
 * effect, so the listeners are in place in the commit that mounts or arms
 * the element, before the frame that shows it; removed when it unmounts or
 * the shell goes. Off the overlay shell (`enabled` false) it adds nothing.
 * It serves the views' shield only, mounted while it blocks: the dock
 * band's shield and guard, mounted once, cancel only while raised, turned
 * on and off by useShellTiming with their `data-active` (ui/tapGuard.js
 * toggleTouchCancel), so at rest they leave no touch-handler region over
 * the dock. */

/**
 * Cancels the touches that begin on `ref`'s element while `enabled` (see the
 * header).
 *
 * @param {{current: ?Element}} ref - The views' shield.
 * @param {boolean} enabled - Whether the element is mounted under the overlay shell.
 * @returns {void}
 */
export default function useTouchCancel(ref, enabled) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return undefined;
    return cancelTouches(el);
  }, [ref, enabled]);
}
