const axios = require("axios").default;
const { recordServiceCall } = require("./serviceStatus");

/**
 * Gets coordinates from an external API
 *
 */
function getCoords(req, res) {
  axios
    .get("https://ipapi.co/json/")
    .then((result) => {
      const { latitude, longitude } = result.data;
      recordServiceCall("ipapi.co", 200, "OK");
      return res.status(200).json({ latitude, longitude }).end();
    })
    .catch((err) => {
      const status = err?.response?.status || 500;
      const message = err?.response?.data?.reason || "Geolocation failed";
      recordServiceCall("ipapi.co", status, message);
      return res.status(500).json(err).end();
    });
}

module.exports = {
  getCoords,
};
