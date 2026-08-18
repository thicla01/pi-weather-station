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
 *   The parsed map keyed by alert id — `ts` is the dismissal time in epoch ms,
 *   `severity` the CAP tier at dismissal time, `expiresAt` the upstream expiry as
 *   an ISO string (or `null` when the source gave none). Returns `{}` outside a
 *   browser, when the key is absent, when the JSON is malformed, or when the
 *   stored value isn't an object.
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

// Custom-event name used to sync the hook's React state across
// every component that uses it in the same tab. localStorage's
// own `storage` event only fires for OTHER tabs/windows, not for
// the tab that did the write — so without our own event,
// `AlertBanner` would only learn about a dismissal/restore done in
// `AlertMiniCards` when its 60 s purge tick eventually re-read
// localStorage. Field-tested 2026-05-25: dismissing both alerts
// from the banner + clicking restore in the mini-cards saw a
// noticeable 1-2 min lag before the banner stopped showing the
// radar fallback. Custom event closes that gap.
const STORAGE_EVENT = "pi-weather-dismissed-alerts-changed";

function writeStore(store) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    // Broadcast to all hook instances in this tab so they re-read
    // localStorage immediately rather than waiting for their
    // 60 s purge interval.
    window.dispatchEvent(new CustomEvent(STORAGE_EVENT));
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
 * @param {Record<string, {ts: number, severity: string, expiresAt: string|null}>} store
 *   Snapshot of the dismissal map to filter; not mutated.
 * @returns {Record<string, {ts: number, severity: string, expiresAt: string|null}>}
 *   A new map holding only the entries still worth honouring — those with a
 *   numeric `ts` newer than `AUTO_RESURFACE_MS` (4 h) and either no `expiresAt`
 *   or one that parses to a future instant. Entries that are falsy or lack a
 *   numeric `ts` are dropped too, so a corrupted blob purges itself.
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
 *   restoreAll: () => void,
 *   dismissedCount: number
 * }}
 *   `isDismissed(alert)` tells the caller whether to hide that alert right now;
 *   `dismiss(alert)` records the dismissal (localStorage + broadcast to the other
 *   hook instances in this tab); `restoreAll()` clears every dismissal at once;
 *   `dismissedCount` is how many non-stale dismissals are currently held, and
 *   drives the "Restore N hidden alerts" pill (rendered only when ≥ 1).
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

  // Cross-component sync — listen for the `STORAGE_EVENT` that
  // any `writeStore` call dispatches. When AlertMiniCards calls
  // restoreAll() (or AlertBanner calls dismiss()), every other
  // instance of this hook in the tree re-reads localStorage and
  // updates its React state, so the UI converges within one
  // render frame instead of waiting for the 60 s purge tick.
  // Also handles cross-tab updates via the native `storage` event
  // (fires when ANOTHER tab in the same origin writes the key).
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const sync = () => setStore(purgeStale(readStore()));
    const onStorage = (e) => {
      // Cross-tab — `storage` event payload includes the key
      if (!e || e.key === STORAGE_KEY || e.key === null) sync();
    };
    window.addEventListener(STORAGE_EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(STORAGE_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
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

  // Live count of non-stale dismissals — drives the v3.1 Phase 4c
  // "Restore N hidden alerts" pill (only renders when ≥ 1). Read
  // from the in-memory store rather than localStorage so it stays
  // reactive across dismiss/restore calls without an extra
  // useEffect to mirror state.
  const dismissedCount = Object.keys(store).length;

  return { isDismissed, dismiss, restoreAll, dismissedCount };
}
