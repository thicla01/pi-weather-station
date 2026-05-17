import axios from "axios";

let prevCoords = {};
let prevResult = null;

/**
 * Reverse geocode lookup (proxied via local server to keep API key server-side)
 *
 * @param {object} params
 * @param {Number} params.lat latitude
 * @param {Number} params.lon longitude
 * @returns {Promise} API result
 */
function reverseGeocode({ lat, lon }) {
  return new Promise((resolve, reject) => {
    if (prevCoords.lat === lat && prevCoords.lon === lon) {
      return resolve(prevResult);
    }

    axios
      .get(`/api/reverse-geocode?lat=${lat}&lon=${lon}`)
      .then((res) => {
        // 204 No Content = the proxy succeeded but LocationIQ
        // returned "no address for this coord" (ocean, etc.).
        // Resolve to null so the caller can fall back to lat/lon.
        const data = res.status === 204 ? null : res.data;
        prevCoords = { lat, lon };
        prevResult = data;
        resolve(data);
      })
      .catch((err) => {
        reject(err);
      });
  });
}

export default reverseGeocode;
