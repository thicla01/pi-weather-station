import { useRef, useEffect } from "react";

/**
 * Adds pointer-based drag scroll to a container element.
 *
 * CSS native scroll only triggers when Chromium classifies input as
 * pointerType 'touch'. On some Pi touchscreen revisions the driver
 * reports a different type, so we handle all pointer types explicitly.
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

    const onPointerDown = (e) => {
      isDragging = true;
      startY = e.clientY;
      startScrollTop = el.scrollTop;
      el.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e) => {
      if (!isDragging) return;
      e.preventDefault();
      el.scrollTop = startScrollTop + (startY - e.clientY);
    };

    const onPointerUp = () => { isDragging = false; };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove, { passive: false });
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);

    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
    };
  }, []);

  return ref;
};

export default useDragScroll;
