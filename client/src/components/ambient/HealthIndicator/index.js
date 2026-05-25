import React, { useEffect, useState, useRef } from "react";
import PropTypes from "prop-types";
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
 * Colour-coded health indicator in the BottomDock that reflects
 * the aggregate health of external services consumed by the
 * server.
 *
 *  - Green: every critical service is responding; no degraded
 *    non-critical services either.
 *  - Yellow: at least one non-critical service (Anthropic, radar,
 *    indoor sensors, etc.) is degraded; core display is intact.
 *  - Red: a critical service (Tomorrow.io weather, Mapbox tiles,
 *    LocationIQ reverse geocoding) is down, OR the client itself
 *    cannot reach the server.
 *
 * Two visual modes:
 *
 *   - **dot** (default): a 36×36 button holding a 10 px coloured
 *     circle. Backward-compatible with the pre-v3.1 BottomDock.
 *   - **chip** (`chip={true}`): a pill containing the coloured
 *     icon + the `Services · OK / Dégradé / Critique / Hors ligne`
 *     short label. Matches the "status chip" anchored to the right
 *     of the v3.1 synthesis toolbar (Phase 1 of the design). The
 *     text label CSS-hides on the 7" Pi kiosk and on phones so the
 *     dot still reads as a glanceable health signal on narrow docks.
 *
 * In both modes, tapping the indicator toggles a popover listing
 * the services in trouble with their last HTTP status and comment.
 * Tap outside (or the indicator again) to dismiss.
 *
 * @param {object} props - Component props
 * @param {boolean} [props.chip] - When true, render as a pill chip
 *   with a short status label. Default false.
 * @returns {JSX.Element} indicator + optional details popover
 */
const HealthIndicator = ({ chip = false }) => {
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
  // Short label paired with the prefix to form the chip text
  // "Services · OK / Dégradé / Critique / Hors ligne". Kept separate
  // from the long popover summary so each tier can read clearly at
  // a glance in ~10 chars max.
  const shortKey = health.status === "green" ? "health.shortOk"
    : health.status === "yellow" ? "health.shortDegraded"
      : health.fetchError ? "health.shortOffline"
        : "health.shortCritical";
  // Glyph paired with the colour. Green carries a checkmark
  // ("everything fine"); yellow / red carry an exclamation
  // ("something to look at"). Rendered as a tiny SVG path
  // inside the coloured disc so the chip reads in 0.3 s without
  // needing the text label (which CSS-hides on narrow docks).
  const isOk = health.status === "green";

  return (
    <div className={`${styles.wrap} ${chip ? styles.wrapChip : ""}`}>
      <button
        ref={dotRef}
        type="button"
        className={chip ? styles.chipButton : styles.dotButton}
        onClick={() => setOpen((o) => !o)}
        title={t(summaryKey)}
        aria-label={t(summaryKey)}
        aria-expanded={open}
      >
        {chip ? (
          <>
            <span className={styles.chipIcon} style={{ backgroundColor: dotColor }}>
              {/* Tiny glyph baked into the chip's coloured disc.
               * Checkmark for green, exclamation for yellow/red.
               * Rendered as inline SVG so it inherits the disc's
               * size and stays crisp at all DPRs. */}
              {/* `stroke`/`fill="currentColor"` lets the glyph follow
               * the `color` property on the surrounding `.chipIcon` span.
               * Default is white (see styles.css) — readable on the
               * green/yellow/red status discs. In night-red mode the
               * span's `color` is overridden to the dark palette bg so
               * the check reads as a subtle dark glyph on the red disc,
               * matching the design's `var(--surface-strong)` choice. */}
              <svg viewBox="0 0 12 12" aria-hidden="true">
                {isOk ? (
                  <path
                    d="M2.5 6.2 L5 8.5 L9.5 3.8"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ) : (
                  <>
                    <line
                      x1="6" y1="3" x2="6" y2="7"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                    <circle cx="6" cy="9.3" r="0.85" fill="currentColor" />
                  </>
                )}
              </svg>
            </span>
            <span className={styles.chipText}>
              {t("health.chipPrefix")} · {t(shortKey)}
            </span>
          </>
        ) : (
          <span className={styles.dot} style={{ backgroundColor: dotColor }} />
        )}
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

HealthIndicator.propTypes = {
  chip: PropTypes.bool,
};

export default HealthIndicator;
