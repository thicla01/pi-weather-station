import React, { useMemo } from "react";
import PropTypes from "prop-types";
import { Marker } from "react-leaflet";
import L from "leaflet";

import { RADAR_GEOMETRY, KM_PER_UNIT, offsetLatLon } from "./geometry";

// South-east — the design anchors the radius chips at the circles'
// lower-right intersection, away from the top-left control stack and
// the bottom-left legend.
const LABEL_BEARING_DEG = 135;

/**
 * Build the Leaflet divIcon for one radius chip. divIcons render
 * outside the CSS-Modules scope, so the class is the global
 * `.ring-label` styled in styles.css (palette-aware via the
 * `--map-circle-label` token; hidden on the mobile layout there).
 *
 * @param {string} label Chip text (e.g. "50 km")
 * @returns {L.DivIcon} Leaflet icon
 */
function buildLabelIcon(label) {
  return L.divIcon({
    className: "ring-label",
    html: label,
    // Anchor the chip's top-left ON the circle so it reads as sitting
    // at the intersection; Leaflet requires explicit sizing hints but
    // the CSS overrides to content size (width: max-content).
    iconSize: null,
  });
}

/**
 * On-map radius labels for the analysis circles (v3.1 Phase 3 — audit
 * F7/F20: the dashed circles had no unit anywhere on screen). Small
 * "50 km" / "100 km" chips at the south-east intersection of each
 * ring, unit-aware, the outer one only when the extended ring is
 * enabled. The caller gates rendering on the same conditions as the
 * rings themselves (analysis enabled + zoom < RING_HIDE_ZOOM);
 * the mobile layout hides them in CSS per the design.
 *
 * @param {object} props
 * @param {Array} props.center Ring centre as a [lat, lng] pair
 * @param {string} props.distanceUnit "km" or "mi" — selects the per-unit radii set
 * @param {boolean} props.extendedRadarRadius Whether the 2× outer ring (and its label) is on
 * @returns {JSX.Element|null} Non-interactive divIcon markers
 */
const RingLabels = ({ center, distanceUnit, extendedRadarRadius }) => {
  const geometry = RADAR_GEOMETRY[distanceUnit] || RADAR_GEOMETRY.km;
  const innerValue = geometry.inner[geometry.inner.length - 1];
  const outerValue = geometry.outer[geometry.outer.length - 1];
  const kmPerUnit = KM_PER_UNIT[distanceUnit] || 1;

  const [lat, lng] = Array.isArray(center) ? center : [null, null];

  const innerPos = useMemo(() => {
    if (lat == null) return null;
    const p = offsetLatLon(lat, lng, innerValue * kmPerUnit, LABEL_BEARING_DEG);
    return [p.lat, p.lon];
  }, [lat, lng, innerValue, kmPerUnit]);

  const outerPos = useMemo(() => {
    if (lat == null || !extendedRadarRadius) return null;
    const p = offsetLatLon(lat, lng, outerValue * kmPerUnit, LABEL_BEARING_DEG);
    return [p.lat, p.lon];
  }, [lat, lng, outerValue, kmPerUnit, extendedRadarRadius]);

  const innerIcon = useMemo(
    () => buildLabelIcon(`${innerValue} ${distanceUnit}`),
    [innerValue, distanceUnit]
  );
  const outerIcon = useMemo(
    () => buildLabelIcon(`${outerValue} ${distanceUnit}`),
    [outerValue, distanceUnit]
  );

  if (!innerPos) return null;

  return (
    <>
      <Marker position={innerPos} icon={innerIcon} interactive={false} keyboard={false} />
      {outerPos ? (
        <Marker position={outerPos} icon={outerIcon} interactive={false} keyboard={false} />
      ) : null}
    </>
  );
};

RingLabels.propTypes = {
  center: PropTypes.array,
  distanceUnit: PropTypes.string,
  extendedRadarRadius: PropTypes.bool,
};

export default RingLabels;
