import { useRef, useEffect } from "react";

/**
 * Adds drag-to-scroll to a container element.
 *
 * Two independent paths run in parallel (touch and pointer) so that a
 * cancellation on one path does not affect the other.
 *
 * Key design decisions vs previous iterations:
 * - No setPointerCapture: calling it on a parent while a child <input>
 *   already holds capture triggers pointercancel, killing the handler.
 * - pointercancel is intentionally ignored: the browser fires it when it
 *   takes over input handling (focus, text selection), but pointermove
 *   continues to bubble up from the active element, so we keep ptrActive
 *   true and handle the movement.
 * - Direction check: only scrolls when the gesture is predominantly
 *   vertical (dy > dx), leaving horizontal input-field panning intact.
 *
 * @returns {React.RefObject} Ref to attach to the scrollable element
 */
const useDragScroll = () => {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
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
      // No setPointerCapture — conflicts with <input> internal capture
    };

    const onPointerMove = (e) => {
      if (!ptrActive || touchActive) return;
      const dx = Math.abs(e.clientX - ptrStartX);
      const dy = Math.abs(e.clientY - ptrStartY);
      if (dy <= dx) return; // horizontal gesture — leave input panning intact
      e.preventDefault();
      el.scrollTop = ptrScrollTop + (ptrStartY - e.clientY);
    };

    const onPointerUp = () => { ptrActive = false; };

    el.addEventListener("touchstart",  onTouchStart,  { passive: true  });
    el.addEventListener("touchmove",   onTouchMove,   { passive: false });
    el.addEventListener("touchend",    onTouchEnd,    { passive: true  });
    el.addEventListener("touchcancel", onTouchEnd,    { passive: true  });
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove, { passive: false });
    el.addEventListener("pointerup",   onPointerUp);
    // pointercancel: intentionally omitted

    return () => {
      el.removeEventListener("touchstart",  onTouchStart);
      el.removeEventListener("touchmove",   onTouchMove);
      el.removeEventListener("touchend",    onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup",   onPointerUp);
    };
  }, []);

  return ref;
};

export default useDragScroll;
