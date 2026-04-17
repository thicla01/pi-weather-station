import { useRef, useEffect } from "react";

/**
 * Adds drag-to-scroll to a container element.
 *
 * Two completely independent paths run in parallel, each with their own
 * state, so a touchcancel on the touch path does not kill the pointer path.
 *
 * On some revised Pi touchscreens the driver emits touchstart immediately
 * followed by touchcancel (cancelling the touch gesture), then continues
 * with pointerdown / pointermove / pointerup as mouse-type events.
 * Keeping the paths independent ensures the pointer path handles the drag
 * even when the touch path was cancelled.
 *
 * The pointer path is paused while the touch path is active to avoid
 * double-updates on screens where both event streams fire correctly.
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
    let touchStartY    = 0;
    let touchScrollTop = 0;

    const onTouchStart = (e) => {
      touchActive    = true;
      touchStartY    = e.touches[0].clientY;
      touchScrollTop = el.scrollTop;
    };

    const onTouchMove = (e) => {
      if (!touchActive) return;
      e.preventDefault();
      el.scrollTop = touchScrollTop + (touchStartY - e.touches[0].clientY);
    };

    const onTouchEnd    = () => { touchActive = false; };
    const onTouchCancel = () => { touchActive = false; };

    // ── Pointer path (runs in parallel, covers mouse-type touchscreens) ────
    let ptrActive    = false;
    let ptrStartY    = 0;
    let ptrScrollTop = 0;

    const onPointerDown = (e) => {
      ptrActive    = true;
      ptrStartY    = e.clientY;
      ptrScrollTop = el.scrollTop;
      try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    };

    const onPointerMove = (e) => {
      if (!ptrActive) return;
      if (touchActive) return; // touch path is handling it, don't double-scroll
      e.preventDefault();
      el.scrollTop = ptrScrollTop + (ptrStartY - e.clientY);
    };

    const onPointerUp     = () => { ptrActive = false; };
    const onPointerCancel = () => { ptrActive = false; };

    el.addEventListener("touchstart",    onTouchStart,    { passive: true  });
    el.addEventListener("touchmove",     onTouchMove,     { passive: false });
    el.addEventListener("touchend",      onTouchEnd,      { passive: true  });
    el.addEventListener("touchcancel",   onTouchCancel,   { passive: true  });
    el.addEventListener("pointerdown",   onPointerDown);
    el.addEventListener("pointermove",   onPointerMove,   { passive: false });
    el.addEventListener("pointerup",     onPointerUp);
    el.addEventListener("pointercancel", onPointerCancel);

    return () => {
      el.removeEventListener("touchstart",    onTouchStart);
      el.removeEventListener("touchmove",     onTouchMove);
      el.removeEventListener("touchend",      onTouchEnd);
      el.removeEventListener("touchcancel",   onTouchCancel);
      el.removeEventListener("pointerdown",   onPointerDown);
      el.removeEventListener("pointermove",   onPointerMove);
      el.removeEventListener("pointerup",     onPointerUp);
      el.removeEventListener("pointercancel", onPointerCancel);
    };
  }, []);

  return ref;
};

export default useDragScroll;
