const axios = require("axios");
const fs = require("fs");
const crypto = require("crypto");
const { execSync } = require("child_process");
const path = require("path");

const CACHE_TTL = 60 * 60 * 1000; // 1 hour

// Deploy artefacts that install.sh copies into the user's home tree on top
// of the in-repo files. The in-app updater pulls new code into the working
// copy with `git pull`, but it can't (and shouldn't, on its own) overwrite
// the installed copies — those decisions sit with the user. We hash both
// sides and surface a list of divergent files in the update modal so the
// user can re-run `bash deploy/install.sh` to refresh them.
//
// Each entry is { name, deployRel, installedPath, platform }:
//   - name: short label shown in the modal
//   - deployRel: path relative to repo root (used to fetch from GitHub)
//   - installedPath: absolute path of the installed copy on this machine
//   - platform: "linux" | "darwin" | null (null = applies on every platform)
const HOME = process.env.HOME || "";
const DEPLOY_ARTEFACTS = [
  {
    name: "pi-weather-server.service",
    deployRel: "deploy/pi-weather-server.service",
    installedPath: path.join(HOME, ".config/systemd/user/pi-weather-server.service"),
    platform: "linux",
  },
  {
    name: "start-server",
    deployRel: "deploy/start-server",
    installedPath: path.join(HOME, ".local/bin/start-server"),
    platform: "linux",
  },
  {
    name: "com.pi-weather-station.plist",
    deployRel: "deploy/com.pi-weather-station.plist",
    installedPath: path.join(HOME, "Library/LaunchAgents/com.pi-weather-station.plist"),
    platform: "darwin",
  },
];

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

/**
 * Hash one deploy artefact against its upstream copy on master.
 *
 * @param {string} repo "owner/repo" form
 * @param {{name: string, deployRel: string, installedPath: string}} artefact
 * @returns {Promise<{name: string, changed: boolean}|null>} null when comparison can't be made
 *   (installed file missing, network error, etc.) — caller treats null as "skip silently".
 */
async function checkOneArtefact(repo, artefact) {
  let installed;
  try {
    installed = fs.readFileSync(artefact.installedPath);
  } catch {
    return null; // Not installed on this machine — treat as not applicable
  }

  let upstream;
  try {
    const r = await axios.get(
      `https://raw.githubusercontent.com/${repo}/master/${artefact.deployRel}`,
      { timeout: 10_000, responseType: "text", transformResponse: [(d) => d] }
    );
    upstream = r.data;
  } catch {
    return null; // Network error — don't pretend to know
  }

  const installedHash = crypto.createHash("sha256").update(installed).digest("hex");
  const upstreamHash = crypto.createHash("sha256").update(upstream).digest("hex");
  return { name: artefact.name, changed: upstreamHash !== installedHash };
}

/**
 * Compare every installed deploy/ artefact relevant to the current platform
 * against its upstream copy. Returns an array of names that have diverged
 * (so the user knows to re-run `bash deploy/install.sh` after `git pull`),
 * an empty array when everything matches, or null when no comparison was
 * possible (no deploy/ artefacts installed, or all comparisons failed).
 *
 * @param {string} repo "owner/repo" form
 * @returns {Promise<string[]|null>}
 */
async function checkDeployArtefactsChanged(repo) {
  const applicable = DEPLOY_ARTEFACTS.filter(
    (a) => !a.platform || a.platform === process.platform
  );
  if (applicable.length === 0) return null;

  const results = await Promise.all(applicable.map((a) => checkOneArtefact(repo, a)));
  const checked = results.filter((r) => r !== null);
  if (checked.length === 0) return null; // Nothing was installed locally — no signal to surface

  return checked.filter((r) => r.changed).map((r) => r.name);
}

// User-visible commit types that warrant a "What's new" entry in the update
// modal. Internal-only types (docs, test, refactor, plain chore, ci) are
// excluded so documentation-only pushes don't ping users. This vocabulary is
// load-bearing for the whole 8-Pi fleet: `updateAvailable = shasDiffer &&
// commits.length > 0`, so a type missing from this regex makes the kiosk
// report "up to date" even though the SHAs differ. Five silent failures
// shaped the current list:
//   - `perf:` was added after a token-compression commit on the radar prompt
//     didn't trigger an update notification on remote Pis: cost reduction is
//     exactly the kind of change the kiosk owner wants to know about.
//   - `chore(deps):` was added after the 2026-05-07 Dependabot batch (express
//     4 → 5, body-parser 1 → 2, plus minor groups) silently failed to surface
//     an update on a fleet of 7 Pis: dependency upgrades carry security
//     patches and warrant a notification of their own.
//   - `release:` was added 2026-05-13 after the v2.14.0 promotion commit
//     (the literal "release: v2.14.0 — promote v3 Ambient UI…") was invisible
//     to the updater: it was the only newer commit on the Pi besides a plain
//     `chore:` cleanup, both filtered out, so the kiosk reported "up to date"
//     even though a tagged release was sitting on master. A release commit
//     is by definition exactly what we want to notify users about.
//   - `style:` was added 2026-05-17 after the v2.15.7 → v2.15.9 layout pass
//     (right-align TimeBlock, left-pack tempRow, merged hero row on Pi) was
//     entirely under the `style:` prefix — versions bumped, SHAs differed,
//     but the kiosk reported "up to date". Style commits CAN be visible UI
//     changes (CSS layout, alignment, typography) and warrant a notification
//     when the maintainer cuts a release for them.
//   - `polish` and `ux` were added in v2.16.x after a string of
//     `polish(toast)` / `ux(debug)` commits landed and the in-app update
//     check incorrectly reported UP-TO-DATE even though the SHAs differed —
//     the regex filtered them out, commits.length stayed 0, and the update
//     was silently swallowed.
// The vocabulary is locked under test in test/updateChecker.test.js — when
// adding a type, extend the regex AND the test together.
const USER_FACING_COMMIT_RE =
  /^(feat|fix|perf|style|polish|ux|release|chore\(deps\))(?:\(.+?\))?:\s*(.+)/;

/**
 * Classifies the first line of a commit message for the "What's new" list.
 * Pure helper — extracted so the commit-type vocabulary can be locked under
 * test (see USER_FACING_COMMIT_RE above for the history of silent failures).
 *
 * @param {string} firstLine first line of a commit message
 * @returns {{type: string, message: string}|null} normalised type + message
 *   for user-facing commits, or null for internal / non-conventional ones
 */
function parseCommitLine(firstLine) {
  const match = firstLine.match(USER_FACING_COMMIT_RE);
  if (!match) return null;
  // Normalise the literal `chore(deps)` capture to a short `deps` token so
  // the client-side badge keys stay simple.
  const type = match[1] === "chore(deps)" ? "deps" : match[1];
  return { type, message: match[2] };
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

    // Fetch the commits between current and latest, then keep only the
    // user-visible ones — see parseCommitLine / USER_FACING_COMMIT_RE above
    // for the accepted vocabulary and the fleet history behind each type.
    let commits = [];
    if (shasDiffer && localSha) {
      try {
        const compareRes = await axios.get(
          `https://api.github.com/repos/${REPO}/compare/${localSha}...${latestSha}`,
          { timeout: 10_000, headers: { "User-Agent": "pi-weather-station" } }
        );
        commits = compareRes.data.commits
          .map((c) => parseCommitLine(c.commit.message.split("\n")[0]))
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

    // Detect deploy/ artefacts the in-app updater can't refresh on its own:
    // pi-weather-server.service in systemd-user, start-server in ~/.local/bin,
    // and the macOS launchd plist. The updater pulls new code into the
    // working copy with `git pull`, but the installed copies under $HOME
    // are owned by the user and aren't auto-overwritten. When any divergence
    // is detected, the modal lists the affected files and points the user
    // at `bash deploy/install.sh` for the targeted refresh.
    const changedDeployFiles = updateAvailable
      ? await checkDeployArtefactsChanged(REPO)
      : [];

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
      changedDeployFiles,
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

module.exports = {
  checkForUpdate,
  clearCache,
  getRepo,
  __test: { parseCommitLine },
};
