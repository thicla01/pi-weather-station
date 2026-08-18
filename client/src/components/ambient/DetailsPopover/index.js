import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import PropTypes from "prop-types";
import { InlineIcon } from "@iconify/react";
import closeIcon from "@iconify/icons-carbon/close";
import styles from "./styles.css";

// Vertical chrome of `.popover` in portal mode: 10 + 12 px padding plus
// 1 + 1 px border, all OUTSIDE max-height because the portal escapes
// .ambientRoot's border-box reset (content-box applies). Budgeted
// explicitly by the fitViewport height formula.
const POPOVER_CHROME_PX = 24;

// Minimum gap kept between the popover and every viewport edge. Shared by
// the horizontal re-anchor, the vertical clamp and the fitViewport height
// budget — they have to agree, or the clamp fights the height.
const MARGIN = 8;

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
 * @param {() => void} props.onClose Invoked on every dismissal path —
 *   pointerdown outside both the popover and the trigger, the Esc key,
 *   and the close button. The first two call it with no arguments; the
 *   close button is bound straight to `onClick`, so React hands it a
 *   SyntheticMouseEvent. Callers ignore the argument, hence the
 *   zero-arity type. The component never
 *   hides itself: the parent owns `open` and is expected to set it
 *   false from this callback.
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
 * @param {boolean} [props.portal] When true, render via a React
 *   portal into `document.body` with `position: fixed` rather than
 *   `position: absolute` inside the parent. Required for triggers
 *   that live inside a container with `overflow: hidden` (e.g. the
 *   LayoutPi rail clips the moon-chip popover horizontally without
 *   this). Position is computed from `triggerRef.getBoundingClientRect()`
 *   and recomputed on `resize` + `scroll` while open.
 * @param {boolean} [props.fitViewport] Portal mode only. Drop the
 *   fixed 420 px content cap and let the popover grow to whatever
 *   the viewport allows (outer box, chrome included, stays above
 *   the 8 px bottom margin). For popovers whose content is BOUNDED
 *   but taller than 420 px — the Places list peaks at 7 rows
 *   (~433 px), which the default cap clipped by 13 px on the 7"
 *   kiosk (field-confirmed 2026-08-16). Do not pass this for
 *   unbounded content: on a tall desktop viewport such a popover
 *   would stretch full-height.
 * @param {React.ReactNode} props.children Body content slot
 * @returns {JSX.Element|null} `null` while `open` is false, and also in
 *   portal mode until the trigger's rect has been measured (the first
 *   frame, so the box never paints at 0,0). Otherwise the
 *   `role="dialog"` popover element: rendered in place when `portal`
 *   is false, or through `createPortal` into `document.body` when it
 *   is true.
 */
const DetailsPopover = ({ open, onClose, title, anchor = "right", triggerRef = null, portal = false, fitViewport = false, children = null }) => {
  const popoverRef = useRef(null);
  const [portalPos, setPortalPos] = useState(null);

  // Compute fixed-position coords from the trigger's viewport rect.
  // Only used when `portal` is true. Recomputed on every resize +
  // scroll so the popover follows the chip if the rail scrolls or
  // the user rotates the device.
  //
  // The portal renders into `document.body`, which sits OUTSIDE the
  // `AmbientLayers` subtree where the palette CSS variables
  // (`--c-bg`, `--c-text`, etc.) are injected. We copy the relevant
  // variables from the trigger's computed style and re-apply them
  // inline on the portaled popover so it picks up the current
  // palette instead of falling back to browser defaults (which
  // renders as a fully transparent box on dark mode).
  const [portalVars, setPortalVars] = useState(null);
  useEffect(() => {
    if (!open || !portal || !triggerRef || !triggerRef.current) return undefined;
    const update = () => {
      const node = triggerRef.current;
      const rect = node.getBoundingClientRect();
      setPortalPos({
        top: rect.bottom + 6,
        // anchor="right" → align popover's right edge with trigger's
        // right edge (popover grows leftward); anchor="left" → align
        // popover's left edge with trigger's left edge (grows right).
        right: anchor === "left" ? null : Math.max(8, window.innerWidth - rect.right),
        left: anchor === "left" ? Math.max(8, rect.left) : null,
      });
      // Copy palette tokens from the trigger's inherited scope so the
      // portaled popover inherits the active palette instead of
      // falling outside `AmbientLayers`' var injection.
      const cs = window.getComputedStyle(node);
      const vars = {};
      for (const name of [
        "--c-bg", "--c-text", "--c-text-dim", "--c-accent",
        "--c-accent-soft", "--c-surface", "--c-border",
        "--c-warn", "--c-danger", "--c-cool", "--c-font-scale",
        // Moon-glyph tokens — without these the `MoonGlyph` inside
        // `MoonDetailsPopover` falls back to `var(...)`'s implicit
        // default (transparent for fill, which then resolves to
        // black on rendering) because portaled content sits outside
        // the `.ambientRoot` element where `AmbientLayers` injects
        // the palette. Symptom: completely-black moon disc in every
        // palette inside the popover, even though HeroBand /
        // TimeBlock render correctly.
        "--c-moon-lit", "--c-moon-dark",
        // Category-qualifier tokens (v3.1 Phase 2) — the AirCard's
        // pollen popover colours its per-allergen tier words with
        // these; same portal-scope rationale as the moon tokens.
        "--mx-cat-good", "--mx-cat-mod", "--mx-cat-bad", "--mx-cat-vhigh",
        // Severity-tier ink (v3.2) — the AirAlertCard popover colours its
        // detail value with `--sev-{med,high}-ink` (via its tier-tint var);
        // without these the portaled value falls back to plain text ink.
        "--sev-low-ink", "--sev-med-ink", "--sev-high-ink",
      ]) {
        const v = cs.getPropertyValue(name);
        if (v) vars[name] = v.trim();
      }
      setPortalVars(vars);
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, portal, triggerRef, anchor]);

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

  // After the portaled popover has painted, measure its actual rect.
  // If anchor="right" pushed it past the viewport's left edge (chip
  // sits near the left side of the screen), or anchor="left" pushed
  // it past the right edge, snap to the opposite side so it stays
  // fully on-screen. Pre-paint we don't know the popover's width
  // (depends on content), so this needs to run after layout — hence
  // useLayoutEffect, not useEffect.
  useLayoutEffect(() => {
    if (!open || !portal || !portalPos) return;
    const el = popoverRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let next = portalPos;
    if (rect.left < MARGIN) {
      // Off-screen left — re-anchor to the viewport's left edge.
      next = { ...next, right: null, left: MARGIN };
    } else if (rect.right > window.innerWidth - MARGIN) {
      // Off-screen right — re-anchor to the viewport's right edge.
      next = { ...next, left: null, right: MARGIN };
    }
    // Vertical clamp: if the popover overflows the viewport bottom
    // (happens in landscape on phones where the trigger sits near
    // the top of a short viewport), detach from the trigger and pin
    // the popover to whatever vertical slot fits — bottom edge of
    // viewport minus margin if it fits, otherwise top edge. The
    // popover effectively "floats" away from the chip so the user
    // sees the full content without needing to scroll the rail.
    if (rect.bottom > window.innerHeight - MARGIN) {
      const fittedTop = Math.max(MARGIN, window.innerHeight - rect.height - MARGIN);
      next = { ...next, top: fittedTop };
    }
    // Bail if nothing changed — avoids an infinite re-render loop.
    if (next.top !== portalPos.top
      || next.left !== portalPos.left
      || next.right !== portalPos.right) {
      setPortalPos(next);
    }
  }, [open, portal, portalPos]);

  if (!open) return null;

  // In portal mode, defer rendering until the first position has
  // been computed so the popover doesn't paint at (0,0) for one
  // frame before snapping into place.
  if (portal && !portalPos) return null;

  const inlineStyle = portal && portalPos
    ? {
      position: "fixed",
      top: portalPos.top,
      right: portalPos.right ?? "auto",
      left: portalPos.left ?? "auto",
      // Override the stylesheet's static `max-height: min(420px,
      // calc(100vh - 120px))` (which was calibrated for an absolute-
      // positioned popover anchored just below a chip near the top
      // of the rail). In portal mode we know the exact viewport-
      // relative top, so cap height to whatever's actually available
      // below that — minus an 8 px bottom margin. Capped at 420 px so
      // long popovers don't stretch full-viewport on a desktop —
      // unless `fitViewport` opts out (bounded-but-tall content).
      //
      // Box-model note: the portal escapes .ambientRoot's border-box
      // reset, so .popover is content-box — its 22 px of vertical
      // padding + 2 px of border sit ON TOP of maxHeight. The
      // fitViewport branch budgets that chrome explicitly so the
      // OUTER box respects the margins; the default 420 branch keeps
      // its historical formula (the discrepancy is unreachable under
      // the cap for every current consumer).
      //
      // fitViewport deliberately does NOT subtract portalPos.top: the
      // popover is free to float away from its trigger (the vertical
      // clamp below relocates it), so the real budget is the whole
      // viewport minus both margins. Deriving it from `top` deadlocks
      // a bottom-anchored trigger — the dock sits at the bottom edge,
      // so `innerHeight - top` is negative, the height collapses to
      // its floor, the clamp lifts the popover by exactly that
      // (small) height, and the recomputed budget lands on the same
      // floor again: a stable fixed point at the minimum size, with
      // the list clipped. (The pre-fitViewport formula escaped this
      // only by accident — it produced a negative max-height, which
      // is invalid CSS and therefore ignored, letting the content
      // measure at its natural height.)
      maxHeight: fitViewport
        ? Math.max(120, (typeof window !== "undefined" ? window.innerHeight : 600) - 2 * MARGIN - POPOVER_CHROME_PX)
        : Math.min(420, (typeof window !== "undefined" ? window.innerHeight : 600) - portalPos.top - MARGIN),
      // Merge in palette CSS variables so the popover inherits the
      // active palette even though it's portaled outside the
      // AmbientLayers var-injection scope. Spread last so position
      // wins on any accidental key collision (there is none).
      ...(portalVars || {}),
    }
    : undefined;

  const popover = (
    <div
      ref={popoverRef}
      className={`${styles.popover} ${portal ? styles.popoverPortal : ""} ${anchor === "left" ? styles.popoverLeft : styles.popoverRight}`}
      role="dialog"
      aria-modal="false"
      aria-label={title}
      onClick={(e) => e.stopPropagation()}
      style={inlineStyle}
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

  return portal ? createPortal(popover, document.body) : popover;
};

DetailsPopover.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  title: PropTypes.string.isRequired,
  anchor: PropTypes.oneOf(["left", "right"]),
  triggerRef: PropTypes.object,
  portal: PropTypes.bool,
  fitViewport: PropTypes.bool,
  children: PropTypes.node,
};

export default DetailsPopover;
