import { useRef, useEffect } from "react";

/**
 * Adds pointer-based drag scroll to a container element.
 *
 * CSS native scroll only triggers when Chromium classifies input as
 * pointerType 'touch'. On some Pi touchscreen revisions the driver
 * reports a different type, so we handle all pointer types explicitly.
 *
 * Uses getBoundingClientRect instead of el.contains(e.target) to check
 * whether the gesture started inside the scroll container, avoiding
 * failures caused by SVG children, deeply nested elements, or other
 * edge cases where DOM containment checks can return false.
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

    const isInBounds = (clientX, clientY) => {
      const rect = el.getBoundingClientRect();
      return (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      );
    };

    const onPointerDown = (e) => {
      if (!isInBounds(e.clientX, e.clientY)) return;
      isDragging = true;
      startY = e.clientY;
      startScrollTop = el.scrollTop;
    };

    const onPointerMove = (e) => {
      if (!isDragging) return;
      e.preventDefault();
      el.scrollTop = startScrollTop + (startY - e.clientY);
    };

    const onPointerUp = () => { isDragging = false; };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("pointermove", onPointerMove, { passive: false });
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointercancel", onPointerUp);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onPointerUp);
    };
  }, []);

  return ref;
};

export default useDragScroll;
