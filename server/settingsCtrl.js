const fs = require("fs");
const path = require("path");

const SETTINGS_FILE = "../settings.json";
const FILE_PATH = path.join(`${__dirname}/${SETTINGS_FILE}`);
const ENCODING = "utf8";

const ALLOWED_KEYS = new Set([
  "weatherApiKey", "mapApiKey", "reverseGeoApiKey", "anthropicApiKey",
  "startingLat", "startingLon",
  // Indoor temperature integration via Homebridge — opaque sub-object
  // (homebridgeUrl, username, password, sensorName, enabled). Stripped from
  // remote /settings responses to avoid leaking the password.
  "indoorTemperature",
  // Advanced settings — opaque sub-object grouped by feature area, e.g.
  // advanced.ai.{extendedRadius, showSamplingPoints}. Default behavior when
  // absent matches the v2.6 baseline.
  "advanced",
]);

const API_KEY_FIELDS = new Set([
  "weatherApiKey", "mapApiKey", "reverseGeoApiKey", "anthropicApiKey",
]);

// Top-level keys whose value is a structured sub-object that may contain
// secrets (passwords, etc.) — entirely stripped from /settings responses to
// remote clients. Local clients still see the full content.
const REMOTE_HIDDEN_KEYS = new Set([
  "indoorTemperature",
]);

/**
 * Returns a sanitized copy of obj containing only allowed setting keys.
 *
 * @param {Object} obj
 * @returns {Object}
 */
function sanitizeSettings(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
  return Object.fromEntries(
    Object.entries(obj).filter(([k]) => ALLOWED_KEYS.has(k))
  );
}

/**
 * Read the settings.json file
 *
 * @param {Object} callbacks
 * @param {Function} callbacks.successCb
 * @param {Function} callbacks.errorCb
 */
function readSettingsFile({ successCb, errorCb }) {
  fs.readFile(FILE_PATH, (err, data) => {
    if (err) {
      errorCb(err);
    } else {
      try {
        successCb(JSON.parse(data));
      } catch (e) {
        errorCb(e);
      }
    }
  });
}

/**
 * Creates a `settings.json` file
 *
 * @param {Object} req
 * @param {Object} [req.body]
 * @param {Object} res
 */
function createSettingsFile(req, res) {
  const contents = sanitizeSettings(req.body);

  if (fs.existsSync(FILE_PATH)) {
    return res.status(409).json("settings file already exists").end();
  } else {
    fs.writeFile(FILE_PATH, JSON.stringify(contents), ENCODING, (err) => {
      if (err) {
        return res.status(500).json(err).end();
      } else {
        return res.status(201).json(contents).end();
      }
    });
  }
}

/**
 * Return the settings.json file. For remote clients, API key values are
 * replaced with a boolean so keys are never exposed over the network.
 *
 * @param {Object} req
 * @param {Object} res
 */
function getSettings(req, res) {
  if (!fs.existsSync(FILE_PATH)) {
    return res.status(404).json("settings.json not found!").end();
  }

  readSettingsFile({
    successCb: (data) => {
      if (req.isLocal) {
        return res.status(200).json(data).end();
      }
      // Remote clients: mask top-level API key fields to booleans and strip
      // out any sub-object that may contain secrets (REMOTE_HIDDEN_KEYS).
      const masked = Object.fromEntries(
        Object.entries(data)
          .filter(([k]) => !REMOTE_HIDDEN_KEYS.has(k))
          .map(([k, v]) => [k, API_KEY_FIELDS.has(k) ? Boolean(v) : v])
      );
      return res.status(200).json(masked).end();
    },
    errorCb: () => {
      return res.status(500).end();
    },
  });
}

/**
 * Sets a single setting. Creates a new `settings.json` file if none exists.
 *
 * @param {Object} req
 * @param {Object} res
 */
function setSetting(req, res) {
  const { key, val } = req.body;
  if (!key || !val) {
    return res.status(400).json("You must supply a key and val").end();
  }
  if (!ALLOWED_KEYS.has(key)) {
    return res.status(400).json("Unknown setting key").end();
  }

  /**
   * Writes file contents
   *
   * @param {Object} newSettings
   * @param {Boolean} [newFile] If file is new
   */
  const writeContents = (newSettings, newFile) => {
    fs.writeFile(FILE_PATH, JSON.stringify(newSettings), ENCODING, (err) => {
      if (err) {
        return res.status(500).json(err).end();
      } else {
        return res
          .status(newFile ? 201 : 200)
          .json(newSettings)
          .end();
      }
    });
  };

  /**
   * Read success callback
   *
   * @param {Object} currentSettings
   */
  const readSuccess = (currentSettings) => {
    const newSettings = {
      ...currentSettings,
      [key]: val,
    };
    writeContents(newSettings);
  };

  /**
   * Read error callback
   *
   * @param {Object} [err]
   */
  const readError = (err) => {
    return res.status(500).json(err).end();
  };

  if (!fs.existsSync(FILE_PATH)) {
    writeContents({ [key]: val }, true);
  } else {
    readSettingsFile({
      successCb: readSuccess,
      errorCb: readError,
    });
  }
}

function replaceSettings(req, res) {
  const { body } = req;
  if (!body) {
    return res.status(400).json("You must provide settings contents").end();
  }
  const fileExists = fs.existsSync(FILE_PATH);
  const sanitized = sanitizeSettings(body);

  fs.writeFile(FILE_PATH, JSON.stringify(sanitized), ENCODING, (err) => {
    if (err) {
      return res.status(500).json(err).end();
    } else {
      return res
        .status(fileExists ? 200 : 201)
        .json(sanitized)
        .end();
    }
  });
}

/**
 * Deletes a specific setting
 *
 * @param {Object} req
 * @param {Object} req.query
 * @param {Object} req.query.key The key to be deleted
 * @param {Object} res
 */
function deleteSetting(req, res) {
  const { key } = req.query;
  if (!key) {
    return res.status(400).json("You must supply a key to delete").end();
  }

  /**
   * Read success callback
   *
   * @param {Object} currentSettings
   */
  const readSuccess = (currentSettings) => {
    if (!Object.prototype.hasOwnProperty.call(currentSettings, key)) {
      return res.status(404).end();
    }

    delete currentSettings[key];

    fs.writeFile(
      FILE_PATH,
      JSON.stringify(currentSettings),
      ENCODING,
      (err) => {
        if (err) {
          return res.status(500).json(err).end();
        } else {
          return res.status(200).json(currentSettings).end();
        }
      }
    );
  };

  /**
   * Error callback
   *
   * @param {Object} err
   */
  const readError = (err) => {
    return res.status(500).json(err).end();
  };

  readSettingsFile({
    successCb: readSuccess,
    errorCb: readError,
  });
}

/**
 * Returns parsed settings as a Promise, for internal server use
 *
 * @returns {Promise<Object>} Parsed settings object
 */
function getSettingsData() {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(FILE_PATH)) {
      return reject(new Error("settings.json not found"));
    }
    readSettingsFile({ successCb: resolve, errorCb: reject });
  });
}

module.exports = {
  getSettings,
  setSetting,
  deleteSetting,
  createSettingsFile,
  replaceSettings,
  getSettingsData,
};
