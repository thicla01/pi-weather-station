const axios = require("axios");
const { execSync } = require("child_process");
const path = require("path");

const CACHE_TTL = 60 * 60 * 1000; // 1 hour
const REPO = "thicla01/pi-weather-station";

let _cache = null;
let _cacheTime = 0;

/**
 * Returns the local git commit SHA (full).
 *
 * @returns {string|null}
 */
function getLocalSha() {
  try {
    return execSync("git rev-parse HEAD", {
      cwd: path.join(__dirname, ".."),
      encoding: "utf8",
      timeout: 3000,
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Checks GitHub for the latest commit on master.
 * Result is cached for 1 hour to stay within GitHub's unauthenticated rate limit (60 req/h).
 *
 * @returns {Promise<object>} { updateAvailable, latestVersion, latestSha, localSha, checkedAt, error? }
 */
async function checkForUpdate() {
  const now = Date.now();
  if (_cache && now - _cacheTime < CACHE_TTL) return _cache;

  const localSha = getLocalSha();

  try {
    const [commitRes, pkgRes] = await Promise.all([
      axios.get(`https://api.github.com/repos/${REPO}/commits/master`, {
        timeout: 10_000,
        headers: { "User-Agent": "pi-weather-station" },
      }),
      axios.get(
        `https://raw.githubusercontent.com/${REPO}/master/package.json`,
        { timeout: 10_000 }
      ),
    ]);

    const latestSha = commitRes.data.sha;
    const latestVersion = pkgRes.data.version;
    const updateAvailable = Boolean(localSha && latestSha !== localSha);

    _cache = {
      updateAvailable,
      latestVersion,
      latestSha: latestSha.slice(0, 7),
      localSha: localSha ? localSha.slice(0, 7) : null,
      checkedAt: new Date().toISOString(),
    };
  } catch {
    // On network error: keep last known result if available, otherwise return no-update
    // to avoid false positives.
    if (!_cache) {
      _cache = {
        updateAvailable: false,
        latestVersion: null,
        latestSha: null,
        localSha: localSha ? localSha.slice(0, 7) : null,
        checkedAt: new Date().toISOString(),
        error: true,
      };
    }
  }

  _cacheTime = now;
  return _cache;
}

module.exports = { checkForUpdate };
