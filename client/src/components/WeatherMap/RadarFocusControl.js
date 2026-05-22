import { useEffect, useRef } from "react";
import PropTypes from "prop-types";
import { useMap } from "react-leaflet";
import L from "leaflet";

/**
 * Radar-focus toggle rendered as a Leaflet control in the topleft
 * stack (sits under the zoom +/- and the direction-arrow toggle).
 * Used on LayoutDesktop only: tapping it hides HeroBand and the
 * right rail so the radar fills the entire viewport. Same imperative
 * Leaflet control pattern as ArrowToggleControl above so the icon
 * stack reads as a coherent set of map controls — no new visual
 * vocabulary, and the click+scroll propagation is killed at the
 * Leaflet layer so we don't re-centre the map underneath.
 *
 * @param {Object} props
 * @param {Boolean} props.active Whether focus mode is currently on
 * @param {Function} props.onToggle Click handler — flips `active`
 * @param {String} props.titleOn Tooltip when active (e.g. "Restore panels")
 * @param {String} props.titleOff Tooltip when inactive (e.g. "Hide panels")
 * @returns {null} Renders nothing — control is added imperatively
 */
const RadarFocusControl = ({ active, onToggle, titleOn, titleOff }) => {
  const map = useMap();
  const linkRef = useRef(null);
  const onToggleRef = useRef(onToggle);
  onToggleRef.current = onToggle;

  useEffect(() => {
    const control = L.control({ position: "topleft" });
    control.onAdd = () => {
      const container = L.DomUtil.create("div", "leaflet-bar leaflet-control");
      const link = L.DomUtil.create("a", "", container);
      link.href = "#";
      link.setAttribute("role", "button");
      // U+26F6 (squared four-corner): renders as four L-brackets
      // pointing outward — the universal "maximize / fill" affordance.
      // When active we switch to a "←→ inward" approximation via a
      // contrasting fill colour so the user gets a clear toggle signal
      // without juggling two unicode glyphs (most fonts don't carry a
      // matching "minimize" symbol).
      link.innerHTML = "⛶";
      link.style.fontWeight = "bold";
      link.style.fontSize = "22px";
      link.style.lineHeight = "30px";
      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);
      L.DomEvent.on(link, "click", (e) => {
        L.DomEvent.preventDefault(e);
        L.DomEvent.stopPropagation(e);
        onToggleRef.current?.();
        // Blur immediately so the anchor doesn't keep keyboard focus
        // after the click. Without this the :focus / :focus-visible
        // pseudo stayed on the link and (combined with sticky :hover
        // while the cursor was still over the button) painted the
        // accent-soft hover fill — user-reported as "the button
        // stays pale after I tap to deactivate". Browsers don't
        // promote mouse-click focus to :focus-visible, but blurring
        // is the cleanest defence against the next user not getting
        // bitten by future Chrome behaviour changes here.
        link.blur();
      });
      linkRef.current = link;
      return container;
    };
    control.addTo(map);
    return () => {
      control.remove();
      linkRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    const link = linkRef.current;
    if (!link) return;
    link.title = active ? titleOn : titleOff;
    link.setAttribute("aria-pressed", String(active));
    // Toggle a class instead of setting inline styles. The Leaflet
    // base rules in ui/reset.css use !important, so inline styles
    // without !important can't win — and even if they did, the
    // :hover rule (also !important) sticks after a tap on touch /
    // devtools and the button never visually resets when the user
    // toggles focus off. The radar-focus-active CSS rule (also in
    // reset.css, with matching !important) wins cleanly both ways.
    link.classList.toggle("radar-focus-active", !!active);
  }, [active, titleOn, titleOff]);

  return null;
};

RadarFocusControl.propTypes = {
  active: PropTypes.bool,
  onToggle: PropTypes.func.isRequired,
  titleOn: PropTypes.string.isRequired,
  titleOff: PropTypes.string.isRequired,
};

export default RadarFocusControl;
