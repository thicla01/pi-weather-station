const axios = require("axios").default;

/**
 * Gets coordinates from an external API
 *
 */
function getCoords(req, res) {
  axios
    .get("https://ipapi.co/json/")
    .then((result) => {
      const { latitude, longitude } = result.data;
      return res.status(200).json({ latitude, longitude }).end();
    })
    .catch((err) => {
      return res.status(500).json(err).end();
    });
}

module.exports = {
  getCoords,
};
