const axios = require("axios").default;
const { getSettingsData } = require("./settingsCtrl");

const ALLOWED_STYLES = ["dark-v10", "light-v10"];

/**
 * Proxy: reverse geocode via LocationIQ, keeping the API key server-side
 *
 * @param {Object} req
 * @param {Object} req.query
 * @param {String} req.query.lat
 * @param {String} req.query.lon
 * @param {Object} res
 */
async function reverseGeocode(req, res) {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);

  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return res.status(400).json("Invalid coordinates").end();
  }

  let settings;
  try {
    settings = await getSettingsData();
  } catch {
    return res.status(500).json("Could not read settings").end();
  }

  if (!settings.reverseGeoApiKey) {
    return res.status(503).json("Reverse geocoding API key not configured").end();
  }

  try {
    const result = await axios.get(
      `https://us1.locationiq.com/v1/reverse.php?key=${settings.reverseGeoApiKey}&lat=${lat}&lon=${lon}&format=json`
    );
    return res.status(200).json(result.data).end();
  } catch {
    return res.status(500).json("Reverse geocoding failed").end();
  }
}

/**
 * Proxy: Mapbox map tiles, keeping the API key server-side
 *
 * @param {Object} req
 * @param {Object} req.params
 * @param {String} req.params.style  Mapbox style (dark-v10 or light-v10)
 * @param {String} req.params.z      Zoom level
 * @param {String} req.params.x      Tile x coordinate
 * @param {String} req.params.y      Tile y coordinate
 * @param {Object} res
 */
async function mapTile(req, res) {
  const { style, z, x, y } = req.params;

  if (!ALLOWED_STYLES.includes(style)) {
    return res.status(400).json("Invalid map style").end();
  }

  const zNum = parseInt(z, 10);
  const xNum = parseInt(x, 10);
  const yNum = parseInt(y, 10);

  if ([zNum, xNum, yNum].some(isNaN) || zNum < 0 || zNum > 22) {
    return res.status(400).json("Invalid tile coordinates").end();
  }

  let settings;
  try {
    settings = await getSettingsData();
  } catch {
    return res.status(500).json("Could not read settings").end();
  }

  if (!settings.mapApiKey) {
    return res.status(503).json("Map API key not configured").end();
  }

  try {
    const result = await axios.get(
      `https://api.mapbox.com/styles/v1/mapbox/${style}/tiles/${zNum}/${xNum}/${yNum}?access_token=${settings.mapApiKey}`,
      { responseType: "arraybuffer" }
    );

    const contentType = result.headers["content-type"];
    const cacheControl = result.headers["cache-control"];
    if (contentType) res.setHeader("Content-Type", contentType);
    if (cacheControl) res.setHeader("Cache-Control", cacheControl);

    return res.status(200).send(Buffer.from(result.data));
  } catch {
    return res.status(500).json("Could not fetch map tile").end();
  }
}

module.exports = { reverseGeocode, mapTile };
