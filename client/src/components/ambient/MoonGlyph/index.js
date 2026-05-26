import React from "react";
import PropTypes from "prop-types";
import { moonLitPath } from "~/ui/astronomy";
import styles from "./styles.css";

// Disc geometry — matches the original Unicode-emoji proportions
// (≈ 1 em tall, slightly inset so the disc doesn't clip its
// stroke on high-DPR renderers). A 20-unit viewBox with a radius-9
// disc gives a 1 px gutter on every side.
const DISC_CX = 10;
const DISC_CY = 10;
const DISC_R = 9;

/**
 * Palette-aware moon-phase glyph rendered as an inline SVG. Replaces
 * the Unicode emoji approach (`MOON_GLYPHS = ["🌑", "🌒", ...]`) that
 * looked correct on macOS (Apple Color Emoji) but rendered with the
 * wrong orientation on the Pi kiosk (Linux Noto Color Emoji draws
 * waxing phases with the lit side on the LEFT, the inverse of the
 * Northern-Hemisphere convention the rest of the UI assumes). The
 * SVG locks NH orientation in every browser/OS pair.
 *
 * The path is built by `moonLitPath()` in `~/ui/astronomy`, which
 * is pure (no DOM) and unit-tested in `test/moonLitPath.test.js`.
 * Two layers:
 *   - A full disc filled with `--c-moon-dark` (the shadow side)
 *   - A phase-shaped path filled with `--c-moon-lit` on top
 *
 * @param {object} props
 * @param {number} props.fraction - Synodic phase 0..1 (0 = new moon,
 *   0.25 = first quarter, 0.5 = full, 0.75 = last quarter)
 * @param {string} [props.size] - CSS size (e.g. "1.2em", "20px").
 *   Defaults to "1.2em" matching the prior emoji's `font-size: 1.2em`
 *   so consumers don't need to retune their spacing.
 * @param {string} [props.title] - Accessible label exposed via
 *   `aria-label` (e.g. the localized phase name + percentage).
 *   When omitted the SVG is hidden from screen readers
 *   (`aria-hidden="true"`) — caller should set a `title` on the
 *   surrounding chip in that case.
 * @returns {JSX.Element} the SVG
 */
const MoonGlyph = ({ fraction, size = "1.2em", title }) => {
  const litPath = moonLitPath(fraction, DISC_CX, DISC_CY, DISC_R);
  const sizeStyle = { width: size, height: size };
  return (
    <svg
      className={styles.svg}
      viewBox="0 0 20 20"
      style={sizeStyle}
      role={title ? "img" : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <circle cx={DISC_CX} cy={DISC_CY} r={DISC_R} className={styles.disc} />
      {litPath ? <path d={litPath} className={styles.lit} /> : null}
    </svg>
  );
};

MoonGlyph.propTypes = {
  fraction: PropTypes.number.isRequired,
  size: PropTypes.string,
  title: PropTypes.string,
};

export default MoonGlyph;
