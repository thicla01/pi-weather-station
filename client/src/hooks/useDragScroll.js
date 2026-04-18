import { useRef, useCallback } from "react";

/**
 * Adds drag-to-scroll to a container element.
 *
 * Two independent paths run in parallel (touch and pointer) so that a
 * cancellation on one path does not affect the other.
 *
 * Key design decisions vs previous iterations:
 * - Callback ref instead of useRef+useEffect: the scroll container inside
 *   CSSTransition (unmountOnExit) is not in the DOM when the component first
 *   mounts, so a useEffect with [] fires with ref.current===null and never
 *   re-runs. A callback ref fires exactly when the element enters/leaves the
 *   DOM, regardless of transition timing.
 * - No setPointerCapture: calling it on a parent while a child <input>
 *   already holds capture triggers pointercancel, killing the handler.
 * - pointercancel is intentionally ignored: the browser fires it when it
 *   takes over input handling (focus, text selection), but pointermove
 *   continues to bubble up from the active element, so we keep ptrActive
 *   true and handle the movement.
 * - Direction check: only scrolls when the gesture is predominantly
 *   vertical (dy > dx), leaving horizontal input-field panning intact.
 *
 * @returns {Function} Callback ref to attach to the scrollable element
 */
const useDragScroll = () => {
  const cleanupRef = useRef(null);

  const ref = useCallback((el) => {
    // Called with null when element unmounts — clean up previous listeners.
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    if (!el) return;

    // ── Touch path ─────────────────────────────────────────────────────────
    let touchActive    = false;
    let touchStartX    = 0;
    let touchStartY    = 0;
    let touchScrollTop = 0;

    const onTouchStart = (e) => {
      touchActive    = true;
      touchStartX    = e.touches[0].clientX;
      touchStartY    = e.touches[0].clientY;
      touchScrollTop = el.scrollTop;
    };

    const onTouchMove = (e) => {
      if (!touchActive) return;
      const dx = Math.abs(e.touches[0].clientX - touchStartX);
      const dy = Math.abs(e.touches[0].clientY - touchStartY);
      if (dy <= dx) return; // horizontal gesture — leave input panning intact
      e.preventDefault();
      el.scrollTop = touchScrollTop + (touchStartY - e.touches[0].clientY);
    };

    const onTouchEnd = () => { touchActive = false; };

    // ── Pointer path (mouse-type touchscreens) ─────────────────────────────
    // pointercancel is intentionally not handled so that ptrActive stays
    // true even when the browser fires cancel for internal input handling.
    let ptrActive    = false;
    let ptrStartX    = 0;
    let ptrStartY    = 0;
    let ptrScrollTop = 0;

    const onPointerDown = (e) => {
      ptrActive    = true;
      ptrStartX    = e.clientX;
      ptrStartY    = e.clientY;
      ptrScrollTop = el.scrollTop;
    };

    const onPointerMove = (e) => {
      // e.buttons === 0 means the finger was lifted but the browser still
      // fired a stray pointermove (e.g. during repositioning or after a
      // missed pointerup). Treat it as a button-up to reset state.
      if (e.buttons === 0) { ptrActive = false; return; }
      if (!ptrActive || touchActive) return;
      const dx = Math.abs(e.clientX - ptrStartX);
      const dy = Math.abs(e.clientY - ptrStartY);
      if (dy <= dx) return; // horizontal gesture — leave input panning intact
      e.preventDefault();
      el.scrollTop = ptrScrollTop + (ptrStartY - e.clientY);
    };

    const onPointerUp    = () => { ptrActive = false; };
    const onPointerLeave = () => { ptrActive = false; };

    el.addEventListener("touchstart",   onTouchStart,   { passive: true  });
    el.addEventListener("touchmove",    onTouchMove,    { passive: false });
    el.addEventListener("touchend",     onTouchEnd,     { passive: true  });
    el.addEventListener("touchcancel",  onTouchEnd,     { passive: true  });
    el.addEventListener("pointerdown",  onPointerDown);
    el.addEventListener("pointermove",  onPointerMove,  { passive: false });
    el.addEventListener("pointerup",    onPointerUp);
    el.addEventListener("pointerleave", onPointerLeave);

    cleanupRef.current = () => {
      el.removeEventListener("touchstart",   onTouchStart);
      el.removeEventListener("touchmove",    onTouchMove);
      el.removeEventListener("touchend",     onTouchEnd);
      el.removeEventListener("touchcancel",  onTouchEnd);
      el.removeEventListener("pointerdown",  onPointerDown);
      el.removeEventListener("pointermove",  onPointerMove);
      el.removeEventListener("pointerup",    onPointerUp);
      el.removeEventListener("pointerleave", onPointerLeave);
    };
  }, []);

  return ref;
};

export default useDragScroll;
