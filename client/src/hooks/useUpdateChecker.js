import { useState, useRef, useEffect, useCallback } from "react";
import axios from "axios";

const SKIPPED_SHA_STORAGE_KEY = "skippedSha";
const UPDATE_CHECK_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours
const POLL_MAX_ATTEMPTS = 30;
const POLL_INITIAL_DELAY_MS = 3000;
const POLL_RETRY_DELAY_MS = 2000;

/**
 * Self-contained state + actions for the in-app update flow.
 *
 * Owns the periodic `/api/update-check` poll (6 h cadence, matches the
 * server-side cache), the update-modal lifecycle, and the post-update
 * "wait for the server to come back" polling. Loaded once in
 * `AppContext` and surfaced through it; the public context API is
 * unchanged after this extraction so consumers (`UpdateModal`,
 * `ControlButtons`, `Debug`, `ambient/DebugPanel`) keep working without
 * any change at the call site.
 *
 * The hook initialises `skippedSha` from `localStorage` on mount so the
 * v3 "skip this update" preference survives reloads — previously this
 * was wired through `loadStoredData()` in AppContext; pulling it inside
 * the hook keeps update state self-contained.
 *
 * @returns {object} update state values, raw setters (for back-compat
 *   with the existing context consumers), and the three actions
 *   `refreshUpdateCheck`, `triggerUpdate`, `saveSkippedSha`.
 */
export function useUpdateChecker() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [latestVersion, setLatestVersion] = useState(null);
  const [latestSha, setLatestSha] = useState(null);
  const [updateCommits, setUpdateCommits] = useState([]);
  const [changedDeployFiles, setChangedDeployFiles] = useState([]);
  const [needsManualUpgrade, setNeedsManualUpgrade] = useState(false);
  const [skippedSha, setSkippedSha] = useState(
    () => window.localStorage.getItem(SKIPPED_SHA_STORAGE_KEY) || null
  );
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [updateState, setUpdateState] = useState("idle"); // idle|updating|restarting|stopped|failed
  const [updateErrorMessage, setUpdateErrorMessage] = useState(null);
  const [serverPlatform, setServerPlatform] = useState(null);
  const [isSystemd, setIsSystemd] = useState(false);
  const updatePollRef = useRef(null);

  /**
   * Save skipped update SHA so the indicator is suppressed for that version
   *
   * @param {string} sha Short commit SHA returned by /api/update-check
   */
  const saveSkippedSha = useCallback((sha) => {
    setSkippedSha(sha);
    window.localStorage.setItem(SKIPPED_SHA_STORAGE_KEY, sha);
  }, []);

  /** Poll /api/is-local until the server responds, then reload the page. */
  const pollUntilReady = useCallback(() => {
    let attempts = 0;
    const poll = () => {
      attempts++;
      if (attempts > POLL_MAX_ATTEMPTS) { setUpdateState("failed"); return; }
      axios.get("/api/is-local")
        .then(() => window.location.reload())
        .catch(() => { updatePollRef.current = setTimeout(poll, POLL_RETRY_DELAY_MS); });
    };
    updatePollRef.current = setTimeout(poll, POLL_INITIAL_DELAY_MS);
  }, []);

  /**
   * Trigger an automatic update via the server API
   */
  const triggerUpdate = useCallback(() => {
    setUpdateState("updating");
    setUpdateErrorMessage(null);
    axios.post("/api/update")
      .then(() => {
        if (isSystemd) {
          setUpdateState("restarting");
          pollUntilReady();
        } else {
          setUpdateState("stopped");
        }
      })
      .catch((err) => {
        // The server returns a structured { error, reason, message } body
        // for known failure modes (detached HEAD, wrong branch, local
        // changes, npm install failure...). Surface the message so the
        // user sees what to fix instead of a generic "Failed".
        const message = err?.response?.data?.message || err?.message || null;
        setUpdateErrorMessage(message);
        setUpdateState("failed");
      });
  }, [isSystemd, pollUntilReady]);

  /**
   * Fetch /api/update-check (or /force) and propagate every relevant field
   * into hook state. Shared by the periodic background poll and the
   * Debug panel's "Check for update" button so both call sites end up with
   * the same set of state updates — including changedDeployFiles and
   * needsManualUpgrade, which UpdateModal reads to gate the Update button.
   *
   * @param {Boolean} [force] When true, hits /api/update-check/force which
   *   clears the server cache before re-evaluating
   * @returns {Promise<Object|null>} Resolves with the response data, or null
   *   on network error
   */
  const refreshUpdateCheck = useCallback((force) => {
    const url = force ? "/api/update-check/force" : "/api/update-check";
    return axios.get(url).then((res) => {
      setUpdateAvailable(res.data.updateAvailable ?? false);
      setLatestVersion(res.data.latestVersion ?? null);
      setLatestSha(res.data.latestSha ?? null);
      setUpdateCommits(res.data.commits ?? []);
      setChangedDeployFiles(Array.isArray(res.data.changedDeployFiles) ? res.data.changedDeployFiles : []);
      setNeedsManualUpgrade(Boolean(res.data.needsManualUpgrade));
      setServerPlatform(res.data.platform ?? null);
      setIsSystemd(res.data.isSystemd ?? false);
      return res.data;
    }).catch(() => {
      // non-critical — silently ignore errors
      return null;
    });
  }, []);

  useEffect(() => {
    refreshUpdateCheck();
    const interval = setInterval(refreshUpdateCheck, UPDATE_CHECK_INTERVAL);
    return () => clearInterval(interval);
  }, [refreshUpdateCheck]);

  return {
    // State (raw — the user-visible "an update is available" is derived in
    // AppContext as `updateAvailable && latestSha !== skippedSha` so the
    // skip preference suppresses the dot without changing the underlying
    // state value).
    updateAvailable,
    setUpdateAvailable,
    latestVersion,
    setLatestVersion,
    latestSha,
    setLatestSha,
    updateCommits,
    setUpdateCommits,
    changedDeployFiles,
    needsManualUpgrade,
    skippedSha,
    updateModalOpen,
    setUpdateModalOpen,
    updateState,
    setUpdateState,
    updateErrorMessage,
    serverPlatform,
    isSystemd,
    // Actions
    refreshUpdateCheck,
    triggerUpdate,
    saveSkippedSha,
  };
}
