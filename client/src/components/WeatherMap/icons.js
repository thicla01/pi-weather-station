import React from "react";
import PropTypes from "prop-types";

/**
 * Inline SVG icon set for the radar map controls (v3.1 Phase 3).
 *
 * Paths come straight from the Claude Design Phase 3 v2.1 reference so
 * the kiosk renders the exact glyphs the design specifies. Inline SVG
 * replaces the previous Unicode glyphs (⛶ ▶ ⏸ ◀ ⟲) which rendered
 * inconsistently across platforms — same class of problem as the moon
 * glyph incident (see incident_moon_glyph_emoji_platform).
 *
 * Every icon inherits `currentColor` so the buttons' palette-driven
 * ink colours apply without per-icon props. Note for Firefox kiosks:
 * `currentColor` must be set via CSS `color` on an ancestor, never
 * relied on through `fill` attribute inheritance alone (v3.1 Phase 1
 * lesson) — these components set fill/stroke explicitly.
 */

const ICON_PROP_TYPES = { className: PropTypes.string };

/**
 * Play triangle.
 *
 * @param {object} props
 * @param {string} [props.className] Optional class for sizing
 * @returns {JSX.Element} SVG icon
 */
export const PlayIcon = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M8 5 L 8 19 L 19 12 Z" />
  </svg>
);
PlayIcon.propTypes = ICON_PROP_TYPES;

/**
 * Pause bars.
 *
 * @param {object} props
 * @param {string} [props.className] Optional class for sizing
 * @returns {JSX.Element} SVG icon
 */
export const PauseIcon = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <rect x="7" y="5" width="3.2" height="14" rx="0.8" />
    <rect x="13.8" y="5" width="3.2" height="14" rx="0.8" />
  </svg>
);
PauseIcon.propTypes = ICON_PROP_TYPES;

/**
 * Step to previous frame (bar + left-pointing triangle).
 *
 * @param {object} props
 * @param {string} [props.className] Optional class for sizing
 * @returns {JSX.Element} SVG icon
 */
export const StepBackIcon = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M7 5 L 7 19 L 8.6 19 L 8.6 5 Z" />
    <path d="M18 6 L 10 12 L 18 18 Z" />
  </svg>
);
StepBackIcon.propTypes = ICON_PROP_TYPES;

/**
 * Step to next frame (bar + right-pointing triangle).
 *
 * @param {object} props
 * @param {string} [props.className] Optional class for sizing
 * @returns {JSX.Element} SVG icon
 */
export const StepForwardIcon = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M17 5 L 17 19 L 15.4 19 L 15.4 5 Z" />
    <path d="M6 6 L 14 12 L 6 18 Z" />
  </svg>
);
StepForwardIcon.propTypes = ICON_PROP_TYPES;

/**
 * Return-to-now (triangle against a stop bar, pointing at "now").
 *
 * @param {object} props
 * @param {string} [props.className] Optional class for sizing
 * @returns {JSX.Element} SVG icon
 */
export const ReturnNowIcon = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
    <path d="M5 12 L 13 5 V 19 Z" fill="currentColor" stroke="none" transform="rotate(180 11 12)" />
    <path d="M19 5 V 19" />
  </svg>
);
ReturnNowIcon.propTypes = ICON_PROP_TYPES;

/**
 * Four corner brackets pointing outward — the universal "expand"
 * affordance (replaces the platform-dependent U+26F6 glyph).
 *
 * @param {object} props
 * @param {string} [props.className] Optional class for sizing
 * @returns {JSX.Element} SVG icon
 */
export const ExpandIcon = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <path d="M4 9 V 4 H 9 M 15 4 H 20 V 9 M 20 15 V 20 H 15 M 9 20 H 4 V 15" />
  </svg>
);
ExpandIcon.propTypes = ICON_PROP_TYPES;

/**
 * Four corner brackets pointing inward — the "restore" counterpart of
 * {@link ExpandIcon}; same stroke so the pair reads as one toggle.
 *
 * @param {object} props
 * @param {string} [props.className] Optional class for sizing
 * @returns {JSX.Element} SVG icon
 */
export const RestoreIcon = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <path d="M9 4 V 9 H 4 M 20 9 H 15 V 4 M 15 20 V 15 H 20 M 4 15 H 9 V 20" />
  </svg>
);
RestoreIcon.propTypes = ICON_PROP_TYPES;

/**
 * Close cross for the legend overlay sheet.
 *
 * @param {object} props
 * @param {string} [props.className] Optional class for sizing
 * @returns {JSX.Element} SVG icon
 */
export const CloseIcon = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
    <path d="M5 5 L 19 19 M 19 5 L 5 19" />
  </svg>
);
CloseIcon.propTypes = ICON_PROP_TYPES;
