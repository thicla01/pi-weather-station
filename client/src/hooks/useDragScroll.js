import { useRef, useEffect } from "react";

/**
 * Adds drag-to-scroll to a container element.
 *
 * Two parallel paths handle different Pi touchscreen behaviours:
 *
 * 1. Touch events  — primary path. touchmove always fires on the element
 *    where touchstart occurred, so no capture or bounds check is needed.
 *    Used when the driver reports real touch input.
 *
 * 2. Pointer events — fallback for touchscreens that report as
 *    pointerType 'mouse' (revised hardware / different driver). CSS native
 *    scroll does not activate for mouse-type input, so we handle it here
 *    with setPointerCapture to keep pointermove routed to the element
 *    even when the finger drifts outside its bounds.
 *
 * Both paths listen on the element itself so events from children bubble
 * up naturally — no document-level listeners or bounds checks required.
 *
 * @returns {React.RefObject} Ref to attach to the scrollable element
 */
const useDragScroll = () => {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let startY = 0;
    let startScrollTop = 0;
    let isDragging = false;

    // ── Touch events (primary path) ────────────────────────────────────────

    const onTouchStart = (e) => {
      isDragging = true;
      startY = e.touches[0].clientY;
      startScrollTop = el.scrollTop;
    };

    const onTouchMove = (e) => {
      if (!isDragging) return;
      e.preventDefault();
      el.scrollTop = startScrollTop + (startY - e.touches[0].clientY);
    };

    const onTouchEnd = () => { isDragging = false; };

    // ── Pointer events (fallback for mouse-type touchscreens) ───────────────

    const onPointerDown = (e) => {
      if (e.pointerType === "touch") return; // handled by touch path above
      isDragging = true;
      startY = e.clientY;
      startScrollTop = el.scrollTop;
      try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    };

    const onPointerMove = (e) => {
      if (e.pointerType === "touch" || !isDragging) return;
      e.preventDefault();
      el.scrollTop = startScrollTop + (startY - e.clientY);
    };

    const onPointerUp = (e) => {
      if (e.pointerType === "touch") return;
      isDragging = false;
    };

    const onPointerCancel = (e) => {
      if (e.pointerType === "touch") return;
      isDragging = false;
    };

    el.addEventListener("touchstart",    onTouchStart,    { passive: true  });
    el.addEventListener("touchmove",     onTouchMove,     { passive: false });
    el.addEventListener("touchend",      onTouchEnd,      { passive: true  });
    el.addEventListener("touchcancel",   onTouchEnd,      { passive: true  });
    el.addEventListener("pointerdown",   onPointerDown);
    el.addEventListener("pointermove",   onPointerMove,   { passive: false });
    el.addEventListener("pointerup",     onPointerUp);
    el.addEventListener("pointercancel", onPointerCancel);

    return () => {
      el.removeEventListener("touchstart",    onTouchStart);
      el.removeEventListener("touchmove",     onTouchMove);
      el.removeEventListener("touchend",      onTouchEnd);
      el.removeEventListener("touchcancel",   onTouchEnd);
      el.removeEventListener("pointerdown",   onPointerDown);
      el.removeEventListener("pointermove",   onPointerMove);
      el.removeEventListener("pointerup",     onPointerUp);
      el.removeEventListener("pointercancel", onPointerCancel);
    };
  }, []);

  return ref;
};

export default useDragScroll;
