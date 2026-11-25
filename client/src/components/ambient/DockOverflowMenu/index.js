import React, { use, useEffect, useId, useRef, useState } from "react";
import PropTypes from "prop-types";
import { InlineIcon } from "@iconify/react";
/* Carbon, like every other dock glyph (ControlButtons, v2.14.71). */
import overflowMenuIcon from "@iconify/icons-carbon/overflow-menu-horizontal";
import { PiLayoutContext } from "~/AppContext";
import styles from "./styles.css";

// The menu's state (`openIn`): closed, opening (from the tap that opens it
// to its next render, which records the layout state it opens in), or
// open in that layout state (a string: LayoutPi's state, "mid" when unset,
// as LayoutPi reads it).
const CLOSED = 0;
const OPENING = 1;

/**
 * The "···" overflow of the overlay shell's dock (ui/piLayout.js
 * `piShellVariant()`). There the dock is a 58 px band of 44 px targets, and
 * ControlButtons moves its least-used buttons in here (marker, legend when
 * present, and the localhost + DEBUG pair: analysis rings, debug panel) so
 * the main row fits the 800 px band with room to spare. Always mounted
 * under the overlay shell: the marker row alone keeps the menu from ever
 * being empty.
 *
 * Behaviour:
 *   - the trigger is a 44 px dock target (`--ctrl-btn-size`, set on the
 *     overlay shell's dock) carrying `aria-haspopup="menu"` +
 *     `aria-expanded`;
 *   - the menu opens above the dock: opaque `--c-bg`, 1 px `--c-edge-on-bg`
 *     (its `--c-border` over its own `--c-bg`), 44 px rows, `:active`
 *     feedback only, no hover, no blur;
 *   - it closes on a tap outside — a transparent full-screen backdrop takes
 *     that tap, so it never reaches the map (tap-to-relocate) or another
 *     dock button —, once a row is chosen, and on Escape. Any layout change
 *     closes it too, in the switch's own render: while the menu is open it
 *     reads LayoutPi's state (PiLayoutContext, through React 19's `use`,
 *     the one context read allowed in a condition), and a state other than
 *     the one it opened in closes it. Closed, as it nearly always is, it
 *     reads nothing, so a switch doesn't render it (the state passed as a
 *     `closeKey` prop from the parent would render it twice at every
 *     switch). Not a `key` remount: that remounted the trigger's Iconify
 *     glyph on every MIN ↔ MID switch, and `@iconify/react`'s Icon sets
 *     state on mount, so each switch paid two extra React commits right
 *     after its tap;
 *   - closing from the keyboard (Escape, or Enter / Space on a row) hands
 *     focus back to the trigger, since the focused row unmounts and focus
 *     would otherwise fall to `<body>`; a touch or mouse tap leaves focus
 *     alone, so the kiosk never draws a focus ring;
 *   - a chosen row hands the trigger element to its `onSelect`, the
 *     element a caller may anchor a confirmation toast on: the row would
 *     put it mid-screen and vanish with the menu (ControlButtons anchors
 *     none on this dock; its toasts are centred over the map).
 *
 * The root is a `<span>`, never a `<div>`: ControlButtons' stylesheet
 * restyles every `div` child of its `.container` and of its groups as a
 * dock button (`.container > div`, `.container.grouped .group > div`:
 * size, gradient, borders, hover tint), which would turn this wrapper —
 * menu included — into one.
 *
 * @param {object} props
 * @param {string} props.label — accessible name and tooltip of the trigger,
 *   also the menu's accessible name (`controls.moreControls`).
 * @param {Array<object>} props.items — the rows, in display order. Each is
 *   `{ id, icon, label, active, onSelect }`: `id` a stable React key,
 *   `icon` an Iconify icon object, `label` the row text (the same string
 *   as the matching dock button's aria-label), `active` true when the
 *   toggle is ON (drawn like the dock's `.buttonDown` fill), and
 *   `onSelect(anchor)` the action, called with the trigger element.
 * @returns {JSX.Element} the trigger, plus the backdrop and menu while open
 */
const DockOverflowMenu = ({ label, items }) => {
  const [openIn, setOpenIn] = useState(CLOSED);
  // LayoutPi's state, read only while the menu is open (see above). The
  // opening's render records it; a later state closes the menu, adjusted
  // during render (React's documented pattern), so the closed menu lands
  // in the same commit as the switch, with no render of its own and no
  // remount.
  const layoutState = openIn === CLOSED ? null : use(PiLayoutContext)?.piLayoutState || "mid";
  if (openIn === OPENING) {
    setOpenIn(layoutState);
  } else if (openIn !== CLOSED && openIn !== layoutState) {
    setOpenIn(CLOSED);
  }
  const open = openIn !== CLOSED;
  const close = () => setOpenIn(CLOSED);
  const triggerRef = useRef(null);
  const menuId = useId();

  // Escape closes, for a keyboard on a desktop test window, and returns
  // focus to the trigger (the focused row is about to unmount). Listener
  // only while open; removed on close and on unmount.
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (e) => {
      if (e.key !== "Escape") return;
      setOpenIn(CLOSED);
      triggerRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // A keyboard activation (Enter / Space) fires the row's click with
  // `detail` 0, a pointer tap with 1 or more: only the former moves focus
  // back to the trigger, before the action runs, so an action that opens
  // a panel can still take focus itself.
  const choose = (item, event) => {
    close();
    if (event.detail === 0) triggerRef.current?.focus();
    item.onSelect(triggerRef.current);
  };

  return (
    <span className={styles.wrap}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        onClick={() => setOpenIn((prev) => (prev === CLOSED ? OPENING : CLOSED))}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
      >
        <InlineIcon icon={overflowMenuIcon} />
      </button>
      {open ? (
        <>
          {/* Closes on `click`, not `pointerdown`: the whole tap then lands
            * on the backdrop, so neither half of it can reach the map. */}
          <span className={styles.backdrop} onClick={close} aria-hidden="true" />
          <ul id={menuId} className={styles.menu} role="menu" aria-label={label}>
            {items.map((item) => (
              <li key={item.id} role="none">
                <button
                  type="button"
                  role="menuitem"
                  className={styles.item}
                  onClick={(e) => choose(item, e)}
                >
                  <span className={`${styles.icon} ${item.active ? styles.iconOn : ""}`}>
                    <InlineIcon icon={item.icon} />
                  </span>
                  <span className={styles.label}>{item.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </span>
  );
};

DockOverflowMenu.propTypes = {
  label: PropTypes.string.isRequired,
  items: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string.isRequired,
    icon: PropTypes.object.isRequired,
    label: PropTypes.string.isRequired,
    active: PropTypes.bool,
    onSelect: PropTypes.func.isRequired,
  })).isRequired,
};

export default DockOverflowMenu;
