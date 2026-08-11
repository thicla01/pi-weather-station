const fs = require("fs");
const path = require("path");

const SETTINGS_FILE = "../settings.json";
const FILE_PATH = path.join(`${__dirname}/${SETTINGS_FILE}`);
const ENCODING = "utf8";

// settings.json holds the six API keys plus the indoorTemperature block
// (Homebridge host + credentials), so it must never be world-readable.
// Every write below passes this mode so a freshly CREATED file is 0600 from
// the start; ensureSecurePermissions() re-tightens a file that already
// exists with looser bits (a fleet install created 0644 before this guard).
// Mirrors the index.js chmod of the TLS key files.
const FILE_MODE = 0o600;

/**
 * Tighten settings.json to owner-only (0600). New files are created 0600 by
 * the `mode` option on each write; this additionally fixes a pre-existing
 * file with looser permissions (e.g. an install created 0644 before this
 * guard shipped — it gets tightened on the next service restart). No-op when
 * the file is absent (a fresh install creates it 0600). Best-effort: a chmod
 * failure is logged, not fatal. The `filePath` parameter exists for tests;
 * production callers pass nothing and tighten the real settings file.
 *
 * @param {String} [filePath] path to tighten (defaults to the settings file)
 */
function ensureSecurePermissions(filePath = FILE_PATH) {
  try {
    if (fs.existsSync(filePath)) {
      fs.chmodSync(filePath, FILE_MODE);
    }
  } catch (err) {
    console.error(`[settings] could not chmod ${filePath} to 0600: ${err.message}`);
  }
}

const ALLOWED_KEYS = new Set([
  "weatherApiKey", "mapApiKey", "reverseGeoApiKey", "anthropicApiKey", "airNowApiKey", "openAqApiKey",
  "startingLat", "startingLon",
  // Indoor temperature integration via Homebridge — opaque sub-object
  // (homebridgeUrl, username, password, sensorName, enabled). Stripped from
  // remote /settings responses to avoid leaking the password.
  "indoorTemperature",
  // Advanced settings — opaque sub-object grouped by feature area, e.g.
  // advanced.ai.{extendedRadius, showSamplingPoints}. Default behavior when
  // absent matches the v2.6 baseline.
  "advanced",
  // Favorite locations — bounded array of {id, label, lat, lon, zoom?}.
  // NOT opaque like the two above: its shape is validated by
  // sanitizeFavorites below (see VALUE_SANITIZERS).
  "favorites",
]);

const API_KEY_FIELDS = new Set([
  "weatherApiKey", "mapApiKey", "reverseGeoApiKey", "anthropicApiKey", "airNowApiKey", "openAqApiKey",
]);

// Top-level keys whose value is a structured sub-object that may contain
// secrets (passwords, etc.) — entirely stripped from /settings responses to
// remote clients. Local clients still see the full content.
const REMOTE_HIDDEN_KEYS = new Set([
  "indoorTemperature",
]);

// Favorite-locations bounds. MAX_FAVORITES is enforced here as well as in the
// client hook: the client cap is the UX affordance ("list full"), this one is
// the guarantee — a buggy or hand-rolled client can never grow the list past
// it. MAX_LABEL_LEN keeps a pathological label from bloating settings.json.
const MAX_FAVORITES = 6;
const MAX_LABEL_LEN = 40;

/**
 * Round a coordinate to 4 decimals.
 *
 * Not cosmetic: the weather proxy caches upstream responses under
 * `type:fieldsHash:lat(4dp):lon(4dp)` (proxyCtrl.getCacheKey). A favorite
 * whose coordinates are frozen at this precision therefore re-uses its cache
 * entry every time the user returns to it, instead of minting a new key and
 * costing three fresh Tomorrow.io calls per visit. Applied client-side at pin
 * time and re-applied here so a hand-edited settings.json cannot defeat it.
 *
 * @param {number} n coordinate value
 * @returns {number} the value rounded to 4 decimal places
 */
function round4(n) {
  return Math.round(n * 1e4) / 1e4;
}

/**
 * Numeric coercion that refuses the values `Number()` silently turns into 0.
 *
 * `Number(null)`, `Number("")`, `Number(false)` and `Number([])` are all 0 —
 * a finite, in-range coordinate. Without this guard a favorite carrying
 * `lon: null` would be accepted and quietly pinned to the Gulf of Guinea
 * instead of being rejected. Numeric STRINGS are still accepted on purpose:
 * settings.json legitimately stores coordinates as strings (sensehatCtrl
 * parseFloat()s `startingLat` for exactly that reason).
 *
 * @param {*} v untrusted value
 * @returns {number|null} the number, or null when the input is not a
 *   number or a non-empty numeric string
 */
function toNumber(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Coerce an untrusted value into a valid `favorites` array.
 *
 * Drops malformed entries rather than rejecting the whole payload: a single
 * bad row from a future client version (or a hand-edited file) should cost
 * that row, not the user's entire list. Entries are validated field by field
 * and rebuilt from scratch, so no unexpected property can ride along into
 * settings.json.
 *
 * Note this runs on the READ path too (sanitizeSettings is what maskForRemote
 * projects through), which means a corrupted file degrades to a shorter list
 * instead of reaching the client verbatim.
 *
 * @param {*} val untrusted value, expected to be an array of favorite entries
 * @returns {Array<{id: string, label: string, lat: number, lon: number, zoom?: number}>}
 */
function sanitizeFavorites(val) {
  if (!Array.isArray(val)) return [];
  const out = [];
  for (const f of val) {
    if (!f || typeof f !== "object" || Array.isArray(f)) continue;
    const lat = toNumber(f.lat);
    const lon = toNumber(f.lon);
    if (lat === null || lat < -90 || lat > 90) continue;
    if (lon === null || lon < -180 || lon > 180) continue;
    const label = typeof f.label === "string" ? f.label.trim().slice(0, MAX_LABEL_LEN) : "";
    if (!label) continue;
    const id = typeof f.id === "string" && f.id ? f.id.slice(0, 64) : `fav_${out.length}`;
    const entry = { id, label, lat: round4(lat), lon: round4(lon) };
    const zoom = toNumber(f.zoom);
    if (zoom !== null && Number.isInteger(zoom) && zoom >= 1 && zoom <= 18) entry.zoom = zoom;
    out.push(entry);
    if (out.length >= MAX_FAVORITES) break;
  }
  return out;
}

// Per-key value coercion, applied by sanitizeSettings after the key whitelist.
// The whitelist alone only answers "may this key exist?"; for keys whose shape
// the server actually depends on, this answers "is the value well-formed?".
// Keys absent from this table keep their value verbatim (the opaque
// sub-objects, `advanced` and `indoorTemperature`, deliberately stay that way).
const VALUE_SANITIZERS = {
  favorites: sanitizeFavorites,
};

/**
 * Apply the per-key value sanitizer, if this key has one.
 *
 * Every write path must funnel through this: `sanitizeSettings` covers the
 * ones that project a whole object (POST / PUT), and `setSetting` calls it
 * directly because a PATCH writes a single value straight through.
 *
 * @param {string} key top-level settings key
 * @param {*} val the incoming value
 * @returns {*} the coerced value, or the input unchanged when no sanitizer
 *   is registered for that key
 */
function sanitizeValue(key, val) {
  return VALUE_SANITIZERS[key] ? VALUE_SANITIZERS[key](val) : val;
}

/**
 * Returns a sanitized copy of obj containing only allowed setting keys, with
 * per-key value coercion applied (see VALUE_SANITIZERS).
 *
 * @param {Object} obj
 * @returns {Object}
 */
function sanitizeSettings(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
  return Object.fromEntries(
    Object.entries(obj)
      .filter(([k]) => ALLOWED_KEYS.has(k))
      .map(([k, v]) => [k, sanitizeValue(k, v)])
  );
}

/**
 * Returns a copy of the parsed settings safe to send to a remote client.
 * Three layers of protection are applied, in order:
 *   0. Default-deny: the data is first projected through `sanitizeSettings`
 *      (the ALLOWED_KEYS whitelist), so any UNRECOGNISED top-level key — one
 *      hand-added to settings.json, or left over from an older build — can
 *      never reach a remote client verbatim. The mask is allow-list driven,
 *      not deny-list. (A key deliberately added to ALLOWED_KEYS is whitelisted
 *      and so still passes; if it carries a secret it must ALSO be added to
 *      API_KEY_FIELDS or REMOTE_HIDDEN_KEYS. Default-deny guards the unknown-
 *      key case, not the new-whitelisted-secret case.)
 *   1. Top-level keys in REMOTE_HIDDEN_KEYS (e.g. `indoorTemperature`) are
 *      stripped entirely — host / credentials are not even masked, the
 *      subtree is simply absent from the response.
 *   2. API key fields are replaced with a boolean (true when set, false
 *      otherwise) so the remote sees whether a key is configured without
 *      ever receiving the value.
 *
 * @param {Object} data parsed settings object as read from disk
 * @returns {Object} masked view safe for remote clients
 */
function maskForRemote(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  return Object.fromEntries(
    Object.entries(sanitizeSettings(data))
      .filter(([k]) => !REMOTE_HIDDEN_KEYS.has(k))
      .map(([k, v]) => [k, API_KEY_FIELDS.has(k) ? Boolean(v) : v])
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
    writeSettingsFileCb(contents, (err) => {
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
      return res.status(200).json(maskForRemote(data)).end();
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
/**
 * When PATCHing the whole `advanced` blob, splice the server-owned
 * `advanced.sensehat` sub-block back in if the incoming payload omits it.
 *
 * `advanced.sensehat` (display mode + clock/radar brightness) is owned
 * exclusively by the Sense HAT endpoints (sensehatModeCtrl.persistSensehat),
 * not the client's advanced-settings form. The client rebuilds the whole
 * `advanced` blob from React state via buildAdvancedSubtree(), which has no
 * `sensehat` section — so a naive `{...current, advanced: val}` replace wipes
 * it. Observed live: toggling "sampling points" while in Radar mode reset the
 * Sense HAT to Weather (resolveMode fell back to its default) and cleared the
 * saved brightness values. Pure so it can be unit-tested.
 *
 * @param {object} currentSettings existing settings.json contents
 * @param {string} key the PATCHed top-level key
 * @param {*} val the incoming value for `key`
 * @returns {*} the value to write — sensehat spliced back in when applicable
 */
function preserveServerOwnedAdvanced(currentSettings, key, val) {
  if (key !== "advanced" || !val || typeof val !== "object" || val.sensehat) {
    return val;
  }
  const existingSensehat = currentSettings
    && currentSettings.advanced
    && currentSettings.advanced.sensehat;
  if (existingSensehat && typeof existingSensehat === "object") {
    return { ...val, sensehat: existingSensehat };
  }
  return val;
}

function setSetting(req, res) {
  // `req.body` is undefined when the JSON body-parser didn't match (wrong
  // content-type / empty body) — destructure defensively so a malformed
  // request gets a clean 400 instead of a TypeError forwarded to the
  // default HTML error handler. `val` is checked against null/undefined
  // (not truthiness): false, 0 and "" are legitimate setting values —
  // a `!val` guard silently rejected boolean-false toggles.
  const { key, val } = req.body || {};
  if (!key || val === undefined || val === null) {
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
    writeSettingsFileCb(newSettings, (err) => {
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
      // Value coercion has to happen HERE, not only inside sanitizeSettings:
      // this handler writes `val` straight through and never calls it (unlike
      // createSettingsFile / replaceSettings, which both project their whole
      // body through sanitizeSettings). Without this line a PATCH is the one
      // path that can plant an arbitrarily-shaped value under a whitelisted
      // key — caught by an end-to-end curl, invisible to a unit test of the
      // pure helper.
      [key]: sanitizeValue(key, preserveServerOwnedAdvanced(currentSettings, key, val)),
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

  // Preserve top-level subtrees that aren't in the body. The v2
  // Settings panel only sends API keys + lat/lon on save, so a
  // naive full replace silently wiped `advanced` (Direction C
  // preview flag, AI flags, sleep mode, etc.) and `indoorTemperature`.
  // Merge: keep the body's keys, plus any whitelisted top-level
  // key from the current file that the body didn't touch.
  const finalize = (existing) => {
    const preserved = {};
    if (existing && typeof existing === "object") {
      for (const [k, v] of Object.entries(existing)) {
        if (!ALLOWED_KEYS.has(k)) continue;
        if (Object.prototype.hasOwnProperty.call(sanitized, k)) continue;
        preserved[k] = v;
      }
    }
    const merged = { ...preserved, ...sanitized };
    writeSettingsFileCb(merged, (err) => {
      if (err) {
        return res.status(500).json(err).end();
      }
      return res
        .status(fileExists ? 200 : 201)
        .json(merged)
        .end();
    });
  };

  if (!fileExists) {
    return finalize({});
  }
  // Read existing settings to merge with. Defensive on parse errors —
  // if the file is corrupt we fall back to body-only rather than
  // crash the save.
  fs.readFile(FILE_PATH, ENCODING, (err, data) => {
    if (err) return finalize({});
    try {
      return finalize(JSON.parse(data));
    } catch {
      return finalize({});
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

    writeSettingsFileCb(
      currentSettings,
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

// Serialised internal write chain. Internal (non-HTTP) settings writes —
// e.g. the Sense HAT mode/brightness patches that used to write settings.json
// directly from sensehatModeCtrl with raw `fs` — go through this so they
// can't interleave their read-modify-write with each other, and so
// settings.json has exactly one owning module (this one), per the CLAUDE.md
// rule. (The HTTP handlers above remain the API's own writers; the data-loss
// case where an advanced-blob PATCH races a sensehat write is handled on the
// read side by preserveServerOwnedAdvanced.)
let writeChain = Promise.resolve();

/**
 * Run an async read-modify-write under the internal write lock so internal
 * mutations serialise instead of racing. A failed task is isolated so it
 * doesn't poison the chain for the next caller.
 *
 * @param {Function} task async function performing the mutation
 * @returns {Promise}
 */
function serializeWrite(task) {
  const run = writeChain.then(task, task);
  writeChain = run.then(() => {}, () => {});
  return run;
}

/**
 * Atomic write of the full settings object, with the secure file mode.
 *
 * Serialises into a sibling `.tmp` file (created 0600 from birth),
 * fsyncs so the bytes are physically on the SD card, then rename()s
 * over the target — an atomic operation on the same filesystem.
 * Readers (including the Python Sense HAT daemons, which re-read
 * settings.json on a ~1 s cadence for the live brightness sliders) and
 * a mid-write power cut therefore see either the old complete file or
 * the new complete file, never a truncated half-write. This matters:
 * settings.json holds every API key plus the Homebridge credentials,
 * and a torn write on a power-loss-prone Pi meant a deconfigured
 * kiosk. (2026-06 quality audit + the ROADMAP tech-debt item from
 * #212 — one fix closes both findings.)
 *
 * Failure hygiene: the tmp file holds a FULL settings copy (API keys +
 * Homebridge credentials), so the error path removes it before
 * rethrowing, and sweepOrphanSettingsTmp() purges at startup whatever a
 * crash mid-write (SIGKILL, power cut) left behind. Both best-effort;
 * the tmp is 0600 from birth and gitignored either way.
 *
 * The tmp name carries a per-process sequence number: the HTTP write
 * handlers do NOT go through serializeWrite (only internal writes do,
 * see #208 — and nesting serializeWrite here would deadlock the
 * patchAdvancedSubKey path that already runs inside it), so two
 * concurrent writes sharing one fixed tmp path could truncate each
 * other mid-write and rename a torn file. Distinct tmp names make
 * each write self-contained; last rename wins, both files complete.
 *
 * @param {Object} obj settings to persist
 * @param {String} [filePath] target path (injectable for unit tests)
 * @returns {Promise<void>}
 */
let tmpWriteSeq = 0;
async function writeSettingsFile(obj, filePath = FILE_PATH) {
  tmpWriteSeq += 1;
  const tmpPath = `${filePath}.${process.pid}.${tmpWriteSeq}.tmp`;
  try {
    const handle = await fs.promises.open(tmpPath, "w", FILE_MODE);
    try {
      await handle.writeFile(JSON.stringify(obj), { encoding: ENCODING });
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.promises.rename(tmpPath, filePath);
  } catch (err) {
    // Don't strand a full secrets copy on a failed write/sync/rename —
    // best-effort removal, the original error is the one to surface.
    await fs.promises.rm(tmpPath, { force: true }).catch(() => {});
    throw err;
  }
}

/**
 * Purge orphaned settings tmp files at startup — leftovers from a crash
 * mid-write that writeSettingsFile's error path couldn't clean (SIGKILL,
 * power cut), or from an aborted install.sh Phase 2
 * (`settings.json.tmp`). Each one holds a full settings copy, so they
 * shouldn't accumulate. Matches `<basename>.<anything>.tmp` and
 * `<basename>.tmp`; never touches the settings file itself or
 * `settings.json.bak`. Best-effort and synchronous — called once from
 * index.js at startup, next to ensureSecurePermissions().
 *
 * @param {String} [filePath] settings path (injectable for unit tests)
 */
function sweepOrphanSettingsTmp(filePath = FILE_PATH) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name.startsWith(`${base}.`) && name.endsWith(".tmp")) {
      try {
        fs.rmSync(path.join(dir, name), { force: true });
        console.log(`[settings] removed orphaned tmp file: ${name}`);
      } catch (err) {
        console.error(`[settings] could not remove orphaned tmp ${name}: ${err.message}`);
      }
    }
  }
}

/**
 * Node-style callback shim over writeSettingsFile for the HTTP
 * handlers, which are written in callback style.
 *
 * @param {Object} obj settings to persist
 * @param {Function} cb callback(err)
 */
function writeSettingsFileCb(obj, cb) {
  writeSettingsFile(obj).then(() => cb(null), cb);
}

/**
 * Pure merge: produce the next settings object with `patch` merged into
 * `advanced.<subKey>`. The current object is run through `sanitizeSettings`
 * (so only whitelisted top-level keys survive) and only keys present in
 * `patch` are changed — sibling advanced subtrees and other sensehat keys are
 * preserved. Exported for unit testing; the I/O lives in patchAdvancedSubKey.
 *
 * @param {Object} current current settings
 * @param {String} subKey advanced sub-object name, e.g. "sensehat"
 * @param {Object} patch partial values to merge
 * @returns {Object} the next settings object
 */
function mergeAdvancedSubKey(current, subKey, patch) {
  const sanitized = sanitizeSettings(current || {});
  const advanced = (sanitized.advanced && typeof sanitized.advanced === "object")
    ? { ...sanitized.advanced }
    : {};
  const sub = (advanced[subKey] && typeof advanced[subKey] === "object")
    ? { ...advanced[subKey] }
    : {};
  Object.assign(sub, patch);
  advanced[subKey] = sub;
  return { ...sanitized, advanced };
}

/**
 * Merge a partial patch into `advanced.<subKey>` of settings.json and persist
 * it, serialised against other internal writes. This is the single owning-
 * module entry point for the Sense HAT mode/brightness patches (previously a
 * raw-`fs` writer in sensehatModeCtrl that bypassed the whitelist + file-mode
 * discipline and was a second, unsynchronised writer).
 *
 * @param {String} subKey advanced sub-object name, e.g. "sensehat"
 * @param {Object} patch partial values to merge, e.g. { mode: "clock" }
 * @returns {Promise<Object>} the persisted settings object
 */
function patchAdvancedSubKey(subKey, patch) {
  return serializeWrite(async () => {
    let current = {};
    try {
      current = await getSettingsData();
    } catch {
      current = {};
    }
    const next = mergeAdvancedSubKey(current, subKey, patch);
    await writeSettingsFile(next);
    return next;
  });
}

module.exports = {
  getSettings,
  setSetting,
  deleteSetting,
  createSettingsFile,
  replaceSettings,
  getSettingsData,
  ensureSecurePermissions,
  sweepOrphanSettingsTmp,
  patchAdvancedSubKey,
  // Exported for regression testing only — internal helpers, not part of
  // the public surface. See test/settingsCtrl.test.js.
  __test: {
    sanitizeSettings,
    sanitizeFavorites,
    sanitizeValue,
    round4,
    MAX_FAVORITES,
    MAX_LABEL_LEN,
    maskForRemote,
    preserveServerOwnedAdvanced,
    ensureSecurePermissions,
    patchAdvancedSubKey,
    mergeAdvancedSubKey,
    serializeWrite,
    writeSettingsFile,
    sweepOrphanSettingsTmp,
    FILE_MODE,
    ALLOWED_KEYS,
    API_KEY_FIELDS,
    REMOTE_HIDDEN_KEYS,
  },
};
