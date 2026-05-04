const axios = require("axios");
const fs = require("fs");
const crypto = require("crypto");
const { execSync } = require("child_process");
const path = require("path");

const CACHE_TTL = 60 * 60 * 1000; // 1 hour
const SERVICE_FILE_REL = "deploy/pi-weather-server.service";
const INSTALLED_SERVICE_FILE = path.join(
  process.env.HOME || "",
  ".config/systemd/user/pi-weather-server.service"
);

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
 * Derives the GitHub "owner/repo" from the local git remote origin URL.
 * Supports both HTTPS (https://github.com/owner/repo.git) and
 * SSH (git@github.com:owner/repo.git) formats.
 * Falls back to the original repository if the remote cannot be read.
 *
 * @returns {string} e.g. "thicla01/pi-weather-station"
 */
function getRepo() {
  try {
    const remoteUrl = execSync("git remote get-url origin", {
      cwd: path.join(__dirname, ".."),
      encoding: "utf8",
      timeout: 3000,
    }).trim();
    const match = remoteUrl.match(/github\.com[:/]([^/]+\/[^/.]+)(\.git)?$/);
    if (match) return match[1];
  } catch { /* git not available or no remote */ }
  return "thicla01/pi-weather-station"; // fallback
}

/**
 * Compare the installed systemd service file with the upstream version that
 * would land after a `git pull`. Returns true when an update would change
 * the service file (so the user needs the manual `cp` + `daemon-reload`
 * step beyond what the in-app updater does), false when they match, and
 * null when the comparison can't be made (e.g. installed file missing,
 * remote fetch failed, or running on a non-systemd platform).
 *
 * @param {string} repo "owner/repo" form
 * @returns {Promise<boolean|null>}
 */
// Commit that added `npm install` to /api/update (v2.4.1). Anything older
// has the bug where one-click upgrades don't install new dependencies, so
// the post-restart server crash-loops on `Cannot find module 'X'`. We
// detect "older than this commit" with `git merge-base --is-ancestor` and
// surface a warning in the modal so the user takes the manual install.sh
// path instead of one-click.
const NPM_INSTALL_FIX_SHA = "a1b8b78";

/**
 * Returns true when the local commit is older than the version of /api/update
 * that runs `npm install`. False when local is at or newer than that commit,
 * or null when the comparison can't be made (no git, no local SHA, etc.).
 *
 * @param {string|null} localSha
 * @returns {boolean|null}
 */
function checkNeedsManualUpgrade(localSha) {
  if (!localSha) return null;
  try {
    // `git merge-base --is-ancestor A B` exits 0 when A is an ancestor of B.
    // We want true when localSha is an ancestor of the parent of the fix
    // commit, i.e. older than the fix.
    execSync(
      `git merge-base --is-ancestor ${localSha} ${NPM_INSTALL_FIX_SHA}^`,
      { cwd: path.join(__dirname, ".."), stdio: "pipe", timeout: 3000 }
    );
    return true;
  } catch {
    // exit code 1 → not an ancestor (i.e. local is newer or unrelated)
    // exit code 128 → bad commit reference (e.g. shallow clone missing the SHA)
    return false;
  }
}

async function checkServiceFileChanged(repo) {
  // Only meaningful when actually running under systemd user services.
  if (!process.env.INVOCATION_ID || process.platform !== "linux") return null;

  let installedHash;
  try {
    const installed = fs.readFileSync(INSTALLED_SERVICE_FILE);
    installedHash = crypto.createHash("sha256").update(installed).digest("hex");
  } catch {
    return null; // No installed file — likely a dev install without systemd
  }

  let upstream;
  try {
    const r = await axios.get(
      `https://raw.githubusercontent.com/${repo}/master/${SERVICE_FILE_REL}`,
      { timeout: 10_000, responseType: "text", transformResponse: [(d) => d] }
    );
    upstream = r.data;
  } catch {
    return null; // Network error — don't pretend to know
  }

  const upstreamHash = crypto.createHash("sha256").update(upstream).digest("hex");
  return upstreamHash !== installedHash;
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
  const REPO = getRepo();

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
    const shasDiffer = Boolean(localSha && latestSha !== localSha);

    // Fetch the commits between current and latest, then keep only those that
    // are user-visible changes (conventional `feat:` / `fix:` / `perf:`
    // prefixes). Other commit types — `docs:`, `chore:`, `refactor:`, etc.
    // — are infrastructure and don't warrant a notification on their own.
    // `perf:` was added after a token-compression commit on the radar prompt
    // didn't trigger an update notification on remote Pis: cost reduction is
    // exactly the kind of change the kiosk owner wants to know about.
    let commits = [];
    if (shasDiffer && localSha) {
      try {
        const compareRes = await axios.get(
          `https://api.github.com/repos/${REPO}/compare/${localSha}...${latestSha}`,
          { timeout: 10_000, headers: { "User-Agent": "pi-weather-station" } }
        );
        commits = compareRes.data.commits
          .map((c) => {
            const firstLine = c.commit.message.split("\n")[0];
            const match = firstLine.match(/^(feat|fix|perf)(?:\(.+?\))?:\s*(.+)/);
            if (!match) return null;
            return { type: match[1], message: match[2] };
          })
          .filter(Boolean)
          .reverse(); // most recent first
      } catch {
        // non-critical — commits stays empty
      }
    }

    // Only flag an update as available when there's at least one feat/fix to
    // show. This keeps the modal silent for docs-only pushes (where the
    // "What's new" section would otherwise render empty), and prevents the
    // "skip" button from suppressing future genuine updates.
    const updateAvailable = shasDiffer && commits.length > 0;

    // Detect changes to deploy/pi-weather-server.service that the in-app
    // updater can't safely apply on its own (the installed file may have
    // user customizations like ALLOW_REMOTE=true). Surfaces a notice in
    // the modal with the manual cp + daemon-reload commands.
    const serviceFileChanged = updateAvailable
      ? await checkServiceFileChanged(REPO)
      : false;

    // Detect installations whose /api/update doesn't run npm install yet
    // (pre-v2.4.1). The one-click upgrade would land new dependencies as
    // missing-module crashes. The modal surfaces a warning and points the
    // user at `bash deploy/install.sh` instead.
    const needsManualUpgrade = updateAvailable
      ? checkNeedsManualUpgrade(localSha)
      : false;

    _cache = {
      updateAvailable,
      latestVersion,
      latestSha: latestSha.slice(0, 7),
      localSha: localSha ? localSha.slice(0, 7) : null,
      checkedAt: new Date().toISOString(),
      commits,
      serviceFileChanged,
      needsManualUpgrade,
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

/**
 * Clears the update cache, forcing the next checkForUpdate() call to hit GitHub.
 */
function clearCache() {
  _cache = null;
  _cacheTime = 0;
}

module.exports = { checkForUpdate, clearCache };
