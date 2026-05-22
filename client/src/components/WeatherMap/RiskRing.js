import React from "react";
import PropTypes from "prop-types";
import { Circle } from "react-leaflet";

import { buildRingLayers } from "./geometry";

/**
 * Wrapper that renders one or two stacked dashed circles based on the
 * risk tier — see buildRingLayers for the layering logic.
 *
 * @param {object} props
 * @param {Array<Number>} props.center [lat, lng] pair for the circle centre
 * @param {Number} props.radius Circle radius in metres
 * @param {String|null} props.risk Risk level, or null when not yet loaded
 * @param {Boolean} props.dark Dark-mode flag
 * @param {Boolean} [props.aiOff] AI summary unavailable — see buildRingLayers
 * @param {Boolean} [props.nightRed] sleep-stage-1 palette override
 * @returns {JSX.Element} One or two stacked Circles
 */
const RiskRing = ({ center, radius, risk, dark, aiOff, nightRed }) => {
  const layers = buildRingLayers(risk, dark, aiOff, nightRed);
  return (
    <>
      {layers.map((opts, i) => (
        <Circle key={i} center={center} radius={radius} pathOptions={opts} />
      ))}
    </>
  );
};

RiskRing.propTypes = {
  center: PropTypes.array.isRequired,
  radius: PropTypes.number.isRequired,
  risk: PropTypes.string,
  dark: PropTypes.bool,
  aiOff: PropTypes.bool,
  nightRed: PropTypes.bool,
};

export default RiskRing;
