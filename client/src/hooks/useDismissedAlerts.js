import { useCallback, useEffect, useState } from "react";

// Storage key for dismissed alerts. Persists across reloads + reboots.
const STORAGE_KEY = "dismissedAlerts";

// Auto-resurface floor. A kiosk where someone dismisses a severe alert
// and the kiosk goes quiet for the rest of the storm is dangerous —
// after this window the alert reappears regardless of severity. Tuned
// long enough that a user reading the alert detail then collapsing
// the banner doesn't see it re-appear in their next coffee break.
const AUTO_RESURFACE_MS = 4 * 60 * 60 * 1000;

// Numeric ranking so "severity escalated" comparisons are simple.
// The set mirrors the orchestrator's CAP-normalised tier vocabulary.
const SEVERITY_RANK = { minor: 1, moderate: 2, severe: 3, extreme: 4 };

/**
 * Read the dismissed-alerts blob from localStorage. Defensive — if
 * the value isn't valid JSON or doesn't look like the expected map,
 * treat it as empty rather than crash the hook.
 *
 * @returns {Record<string, {ts: number, severity: string, expiresAt: string|null}>}
 */
function readStore() {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* localStorage full / private mode — silent fail, the user
     * just sees the alert un-dismiss after a reload */
  }
}

/**
 * Strip stale dismissal entries. An entry is stale when:
 *   - the upstream `expiresAt` is in the past (the alert is gone
 *     for everyone, no need to keep tracking it),
 *   - OR the dismissal is older than `AUTO_RESURFACE_MS`.
 *
 * Pure function on a snapshot, returns the cleaned map.
 *
 * @param {Record<string, object>} store
 * @returns {Record<string, object>}
 */
function purgeStale(store) {
  const now = Date.now();
  const next = {};
  for (const [id, entry] of Object.entries(store)) {
    if (!entry || typeof entry.ts !== "number") continue;
    if (now - entry.ts > AUTO_RESURFACE_MS) continue;
    if (entry.expiresAt) {
      const exp = Date.parse(entry.expiresAt);
      if (Number.isFinite(exp) && exp < now) continue;
    }
    next[id] = entry;
  }
  return next;
}

/**
 * Hook exposing dismiss / isDismissed for gov alerts.
 *
 * Semantics:
 *   - `dismiss(alert)`: records `{ ts, severity, expiresAt }` in
 *     localStorage keyed by `alert.id`. UI immediately hides the
 *     alert.
 *   - `isDismissed(alert)`:
 *       1. Returns false if the alert has no `id` (defensive).
 *       2. Returns false if no entry exists for that id.
 *       3. Returns false if the upstream severity escalated since
 *          the dismissal (e.g. moderate dismissed → now severe).
 *          This is the safety override — the dismissal stale-checks
 *          are also handled here via the auto-resurface window.
 *       4. Otherwise returns true.
 *
 * @returns {{
 *   isDismissed: (alert: object) => boolean,
 *   dismiss: (alert: object) => void,
 *   restoreAll: () => void
 * }}
 */
export default function useDismissedAlerts() {
  const [store, setStore] = useState(() => purgeStale(readStore()));

  // Re-purge once every minute so an alert whose dismissal aged
  // past 4 h re-surfaces without needing the user to refresh the
  // page. Cheap (just an in-memory map walk + occasional write).
  useEffect(() => {
    const id = setInterval(() => {
      const next = purgeStale(readStore());
      setStore((prev) => {
        const prevKeys = Object.keys(prev).length;
        const nextKeys = Object.keys(next).length;
        if (prevKeys === nextKeys) return prev;
        writeStore(next);
        return next;
      });
    }, 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const dismiss = useCallback((alert) => {
    if (!alert || !alert.id) return;
    setStore((prev) => {
      const next = {
        ...prev,
        [alert.id]: {
          ts: Date.now(),
          severity: alert.severity || "minor",
          expiresAt: alert.expiresAt || null,
        },
      };
      writeStore(next);
      return next;
    });
  }, []);

  const isDismissed = useCallback((alert) => {
    if (!alert || !alert.id) return false;
    const entry = store[alert.id];
    if (!entry) return false;
    // Re-surface immediately on severity escalation. A dismissed
    // moderate that's now severe / extreme is the safety case the
    // kiosk must not silence.
    const dismissedRank = SEVERITY_RANK[entry.severity] || 0;
    const currentRank = SEVERITY_RANK[alert.severity] || 0;
    if (currentRank > dismissedRank) return false;
    return true;
  }, [store]);

  const restoreAll = useCallback(() => {
    setStore({});
    writeStore({});
  }, []);

  return { isDismissed, dismiss, restoreAll };
}
