import { useCallback, useEffect, useRef } from "react";
import { createTapGuard } from "~/ui/tapGuard";

/**
 * Double-tap guard for a command that changes what sits under the finger
 * (the alert card's ⤢ opening the Alert view, whose back button lands where
 * the ⤢ was). Returns `guardTap(event)`: call it from the command's click
 * handler with the click event, then run the command. For the next 300 ms a
 * second tap inside the 60 × 58 px box centred on that click is swallowed
 * whole (pointer, touch, compatibility mouse events, click), so it can't
 * reach what just appeared; anywhere else, or later, taps pass. The click
 * that arms the guard is never touched, and a keyboard activation (click
 * `detail` 0) does not arm it.
 *
 * Mechanism, constants and edge rules: `ui/tapGuard.js`. One guard per
 * component instance; its document listeners exist only while it is armed,
 * and it is disposed (listeners and timer gone) on unmount.
 *
 * @returns {(event: (Event|object)) => boolean} guardTap — arms the guard
 *   from a click (React's synthetic event or the native one); true when it
 *   armed
 */
export default function useTapGuard() {
  const guardRef = useRef(null);

  useEffect(() => {
    const guard = createTapGuard(document);
    guardRef.current = guard;
    return () => {
      guard.dispose();
      guardRef.current = null;
    };
  }, []);

  return useCallback((event) => {
    const guard = guardRef.current;
    if (!guard || !event) return false;
    return guard.arm(event.nativeEvent || event);
  }, []);
}
