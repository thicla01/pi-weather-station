import React, { useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import axios from "axios";
import styles from "./styles.css";

// Poll cadence — 30 s. Fast enough that a service going down or
// recovering is reflected within half a minute, slow enough that
// the endpoint cost is negligible (it's a pure in-memory lookup
// on the server).
const POLL_INTERVAL_MS = 30 * 1000;

// Colour map for the dot. Matches the existing severity vocabulary
// from `~/ui/severity` but kept inline because health uses a
// 3-tier vocabulary (green/yellow/red) while severity is 5-tier
// (low/moderate/high/veryHigh/extreme).
const DOT_COLORS = {
  green:  "#5cb85c",
  yellow: "#f0c000",
  red:    "#e60000",
};

/**
 * Small colour-coded dot in the BottomDock that reflects the
 * aggregate health of external services consumed by the server.
 *
 *  - Green: every critical service is responding; no degraded
 *    non-critical services either.
 *  - Yellow: at least one non-critical service (Anthropic, radar,
 *    indoor sensors, etc.) is degraded; core display is intact.
 *  - Red: a critical service (Tomorrow.io weather, Mapbox tiles,
 *    LocationIQ reverse geocoding) is down, OR the client itself
 *    cannot reach the server.
 *
 * Tapping the dot toggles a popover listing the services in
 * trouble with their last HTTP status and comment. Tap outside
 * (or the dot again) to dismiss.
 *
 * @returns {JSX.Element} dot + optional details popover
 */
const HealthIndicator = () => {
  const { t } = useTranslation();
  const [health, setHealth] = useState({
    status: "green",
    issues: [],
    lastChecked: null,
    fetchError: false,
  });
  const [open, setOpen] = useState(false);
  const popoverRef = useRef(null);
  const dotRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const fetchHealth = () => {
      axios
        .get("/api/health", { validateStatus: () => true, timeout: 8000 })
        .then((r) => {
          if (cancelled) return;
          if (r.status === 200 && r.data && r.data.status) {
            setHealth({
              status: r.data.status,
              issues: Array.isArray(r.data.issues) ? r.data.issues : [],
              lastChecked: r.data.lastChecked || new Date().toISOString(),
              fetchError: false,
            });
          } else {
            // Server reachable but returned an unexpected payload —
            // treat as yellow so the dot communicates "something off"
            // without crying wolf about a full outage.
            setHealth({
              status: "yellow",
              issues: [{ service: "/api/health", status: r.status, comment: "unexpected payload", critical: false }],
              lastChecked: new Date().toISOString(),
              fetchError: false,
            });
          }
        })
        .catch(() => {
          if (cancelled) return;
          // Network failure — couldn't reach the server at all.
          // Treat as red since none of the server-backed data can
          // refresh either.
          setHealth({
            status: "red",
            issues: [{ service: "Server", status: null, comment: t("health.serverUnreachable"), critical: true }],
            lastChecked: new Date().toISOString(),
            fetchError: true,
          });
        });
    };

    fetchHealth();
    const id = setInterval(fetchHealth, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `t` is stable across renders for our use, and re-creating the interval on locale change isn't worth the churn
  }, []);

  // Dismiss popover on click outside.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e) => {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target)
        && dotRef.current && !dotRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const dotColor = DOT_COLORS[health.status] || DOT_COLORS.green;
  const summaryKey = health.status === "green" ? "health.allOk"
    : health.status === "yellow" ? "health.degraded"
      : health.fetchError ? "health.serverUnreachable"
        : "health.criticalDown";

  return (
    <div className={styles.wrap}>
      <button
        ref={dotRef}
        type="button"
        className={styles.dotButton}
        onClick={() => setOpen((o) => !o)}
        title={t(summaryKey)}
        aria-label={t(summaryKey)}
        aria-expanded={open}
      >
        <span className={styles.dot} style={{ backgroundColor: dotColor }} />
      </button>
      {open ? (
        <div
          ref={popoverRef}
          className={styles.popover}
          role="dialog"
          aria-label={t("health.title")}
        >
          <div className={styles.popoverHeader}>
            <span className={styles.popoverDot} style={{ backgroundColor: dotColor }} />
            <span className={styles.popoverSummary}>{t(summaryKey)}</span>
          </div>
          {health.issues.length === 0 ? (
            <div className={styles.popoverEmpty}>{t("health.noIssues")}</div>
          ) : (
            <ul className={styles.issueList}>
              {health.issues.map((issue) => (
                <li
                  key={issue.service}
                  className={`${styles.issueItem} ${issue.critical ? styles.issueCritical : ""}`}
                >
                  <span className={styles.issueService}>{issue.service}</span>
                  <span className={styles.issueDetail}>
                    {issue.status != null ? `HTTP ${issue.status}` : "—"}
                    {issue.comment ? ` · ${issue.comment}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
};

export default HealthIndicator;
