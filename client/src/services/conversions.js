/**
 * Convert celsius to fahrenheit
 *
 * @param {Number} c degrees celsius
 * @returns {Number} degrees fahrenheit
 * @private
 */
const cToF = (c) => {
  return c * (9/5) + 32;
};

/**
 * Convert temperature to the target unit
 *
 * @param {Number} c temperature in celsius
 * @param {String} units `f` for fahrenheit, `c` for celsius, `k` for kelvin
 * @returns {Number} converted temperature
 */
export const convertTemp = (c, units) => {
  if (!c && c !== 0) {
    console.log("missing input temp!");
    return null;
  }

  if (units && units.toLowerCase() === "c") {
    return parseInt(c);
  } else if (units && units.toLowerCase() === "f") {
    return parseInt(cToF(c));
  } else if (units && units.toLowerCase() === "k") {
    return Math.round(c + 273.15);
  } else {
    console.log("Missing / invalid target unit!", units);
    return null;
  }
};

/**
 * Convert m/s to mph
 *
 * @param {Number} ms
 * @returns {Number} mph
 * @private
 */
const msToMph = (ms) => {
  return ms / 0.44704;
};

/**
 * Convert m/s to km/h
 *
 * @param {Number} ms
 * @returns {Number} km/h
 * @private
 */
const msToKmh = (ms) => {
  return ms * 3.6;
};

/**
 * Converts speed
 *
 * @param {Number} speed
 * @param {String} units `mph`, `ms` for m/s, or `kmh` for km/h
 * @returns {Number} converted speed
 */
export const convertSpeed = (speed, units) => {
  if (!speed && speed !== 0) {
    console.log("missing input speed");
    return null;
  }
  if (units && units.toLowerCase() === "mph") {
    return parseInt(msToMph(speed));
  } else if (units && units.toLowerCase() === "ms") {
    return parseInt(speed);
  } else if (units && units.toLowerCase() === "kmh") {
    return Math.round(msToKmh(speed));
  } else {
    console.log("Missing / invalid target unit!", units);
    return null;
  }
};

/**
 * Returns the display label for a speed unit.
 *
 * @param {String} unit `mph`, `ms`, or `kmh`
 * @returns {String} display label
 */
export const speedUnitLabel = (unit) => {
  if (!unit) return "m/s";
  switch (unit.toLowerCase()) {
    case "mph": return "mph";
    case "kmh": return "kph";
    default:    return "m/s";
  }
};

/**
 * Converts mm to inches
 *
 * @param {Number} mm
 * @returns {Number} inches
 * @private
 */
const mmToIn = (mm) => {
  return mm / 25.4;
};

/**
 * Convert length
 *
 * @param {Number} len mm
 * @param {String} units in or mm
 * @returns {Number} converted length
 */
export const convertLength = (len, units) => {
  if (!len && len !== 0) {
    console.log("missing input length!");
    return null;
  }
  if (units && units.toLowerCase() === "in") {
    return parseInt(mmToIn(len) * 100) / 100;
  } else if (units && units.toLowerCase() === "mm") {
    return len;
  } else {
    console.log("Missing / invalid target unit!", units);
    return null;
  }
};
