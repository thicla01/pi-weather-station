import React, { useEffect, useRef } from "react";
import PropTypes from "prop-types";
import { InlineIcon } from "@iconify/react";
import closeIcon from "@iconify/icons-carbon/close";
import styles from "./styles.css";

/**
 * DetailsPopover — generic popover shell used by the UV / AQ /
 * future Pollen badges (and re-usable by the AlertBanner if its
 * existing AlertDetailInline ever moves to an overlay model).
 *
 * Positioning strategy: pinned to the bottom-right of the
 * triggering cell with `position: absolute`. The parent cell
 * needs `position: relative` for the abs to anchor correctly.
 * The popover's own `right: 0; top: 100%` keeps it inside the
 * visible viewport on mobile column layouts where the cell is
 * already at the right side of the screen, and the
 * `max-width: 320px` keeps it readable on the smaller cells.
 *
 * Dismissal: backdrop click + Esc key + tap on the close icon.
 *
 * @param {object} props
 * @param {boolean} props.open Whether the popover is visible
 * @param {Function} props.onClose Called on dismiss
 * @param {string} props.title Header label (e.g. "UV index")
 * @param {"left"|"right"} [props.anchor] Which edge of the parent
 *   the popover aligns to. `"right"` (default) extends the popover
 *   leftward — correct for cells in the right column of the grid.
 *   Pass `"left"` for cells in the left column so the popover
 *   extends rightward and stays inside the rail.
 * @param {object} [props.triggerRef] Optional React ref to the
 *   element that opens the popover. When provided, clicks on the
 *   trigger don't auto-close the popover — they fall through to
 *   the trigger's own onClick (which is expected to toggle). Without
 *   this, the pointerdown listener fires first and closes the
 *   popover, then the click re-toggles it open, giving the user a
 *   "flash" effect (pointerdown close + click reopen).
 * @param {React.ReactNode} props.children Body content slot
 * @returns {JSX.Element|null}
 */
const DetailsPopover = ({ open, onClose, title, anchor, triggerRef, children }) => {
  const popoverRef = useRef(null);

  // Esc to close. Re-bound each time `open` flips so we don't keep
  // a listener attached when the popover isn't visible.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Click outside the popover dismisses. Pointerdown (not click)
  // so the dismissal beats the next focusable element's selection,
  // matching the HealthIndicator behaviour. Clicks on the trigger
  // element (the cell that opened the popover) are explicitly
  // excluded — they're expected to call `toggle()` from their
  // own onClick handler. Without this exclusion, pointerdown
  // closes the popover, then click re-opens it — visible as a
  // sub-second flash.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e) => {
      const inPopover = popoverRef.current && popoverRef.current.contains(e.target);
      const inTrigger = triggerRef && triggerRef.current && triggerRef.current.contains(e.target);
      if (!inPopover && !inTrigger) onClose();
    };
    // Defer so the tap that opened the popover doesn't immediately
    // dismiss it via the same event.
    const id = setTimeout(() => {
      document.addEventListener("pointerdown", onPointerDown);
    }, 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, onClose, triggerRef]);

  if (!open) return null;

  return (
    <div
      ref={popoverRef}
      className={`${styles.popover} ${anchor === "left" ? styles.popoverLeft : styles.popoverRight}`}
      role="dialog"
      aria-modal="false"
      aria-label={title}
      onClick={(e) => e.stopPropagation()}
    >
      <div className={styles.header}>
        <span className={styles.title}>{title}</span>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={onClose}
          aria-label="Close"
        >
          <InlineIcon icon={closeIcon} />
        </button>
      </div>
      <div className={styles.body}>{children}</div>
    </div>
  );
};

DetailsPopover.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  title: PropTypes.string.isRequired,
  anchor: PropTypes.oneOf(["left", "right"]),
  // eslint-disable-next-line react/forbid-prop-types -- React ref shape is opaque
  triggerRef: PropTypes.object,
  children: PropTypes.node,
};

DetailsPopover.defaultProps = {
  anchor: "right",
  triggerRef: null,
  children: null,
};

export default DetailsPopover;
