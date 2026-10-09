import React, { useContext } from "react";
import PropTypes from "prop-types";
import { QRCodeSVG } from "qrcode.react";
import { AppContext } from "~/AppContext";
import { getPalette } from "~/ui/tokens";
import { useTimeOfDay } from "~/ui/hybrid";
import styles from "./styles.css";

/**
 * QR code wrapper around `qrcode.react`'s SVG renderer, defaulting to
 * the kiosk-friendly size (96×96) and palette-aware colours.
 *
 * Why this exists as a wrapper instead of letting callers use
 * `QRCodeSVG` directly:
 *   1. Every QR on the kiosk should use the same size + error
 *      correction level by default — central place to enforce that.
 *   2. Foreground/background should track the active palette so QR
 *      codes always read against the slab surface.
 *   3. CLAUDE.md kiosk rule: "External links from the kiosk are
 *      kiosk-hostile — use QR codes only, never raw `<a>` elements."
 *      Centralising the wrapper makes it easier to land that
 *      convention as a single import.
 *   4. Accessible name. qrcode.react 4.2.0 always renders
 *      `<svg role="img">` and turns its `title` prop into a `<title>`
 *      child, which is the SVG's accessible name (SVG-AAM) and its
 *      native hover tooltip. Without it the QR is a nameless image.
 *      Deliberately NOT doubled with `aria-label` (it would win the
 *      name and demote `<title>` to the accessible description, so the
 *      same text would be announced twice), and the wrapper div
 *      carries no `title` of its own (a generic div gets no reliable
 *      accessible name from `title`; it only duplicated the tooltip).
 *
 * @param {object} props
 * @param {string} props.value — URL (or any text) to encode
 * @param {number} [props.size] — pixel size; defaults to 96
 * @param {string} props.title — accessible name, rendered as the SVG's
 *   `<title>` (screen-reader name + hover tooltip). Required: React 19
 *   no longer runs PropTypes, so `test/kioskExternalLinks.test.js`
 *   checks statically that every `<QrCode>` passes one
 * @returns {JSX.Element} QR SVG (`role="img"`, named by `title`)
 *   wrapped in a flex container
 */
const QrCode = ({ value, size = 96, title }) => {
  const { darkMode } = useContext(AppContext);
  const tod = useTimeOfDay();
  const palette = getPalette(tod);

  // Light palettes get a white background so the QR has the contrast
  // needed for reliable scanning from screen. Dark palettes use
  // transparent background + accent-coloured modules — the slab
  // surface behind the QR provides the contrast.
  const isDark = darkMode || tod === "night" || tod === "nightRed";
  const bgColor = isDark ? "transparent" : "#ffffff";
  const fgColor = isDark ? palette.accent : palette.text;

  return (
    <div className={styles.wrap}>
      <QRCodeSVG
        value={value}
        size={size}
        bgColor={bgColor}
        fgColor={fgColor}
        marginSize={1}
        level="M"
        title={title}
      />
    </div>
  );
};

QrCode.propTypes = {
  value: PropTypes.string.isRequired,
  size: PropTypes.number,
  title: PropTypes.string.isRequired,
};

export default QrCode;
