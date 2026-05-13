/* eslint-disable react/prop-types -- internal helper components, same
 * convention as SettingsPanel. */
import React, { useContext, useEffect, useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { InlineIcon } from "@iconify/react";
import closeSharp from "@iconify/icons-ion/close-sharp";
import refreshIcon from "@iconify/icons-carbon/restart";
import upgradeIcon from "@iconify/icons-carbon/upgrade";
import downloadIcon from "@iconify/icons-ion/download-outline";
import axios from "axios";
import { AppContext } from "~/AppContext";
import { getPalette } from "~/ui/tokens";
import { useTimeOfDay } from "~/ui/hybrid";
import { exportDebugCsv } from "~/components/Debug";
import styles from "./styles.css";

/**
 * Direction C Debug panel — port of the Claude Design canvas at
 * `docs/design-references/settings-debug/project/lib/debug-panel.jsx`
 * variant A (vertical tab rail) recommended.
 *
 * Layout:
 *
 *   ┌──────────────────────────────────────────────────┐
 *   │ DÉBOGAGE                                    [×]  │
 *   ├──────┬───────────────────────────────────────────┤
 *   │ ⌬    │                                           │
 *   │ Srv  │  Section content for the active bucket    │
 *   │      │                                           │
 *   │ ◐    │  Buckets group the 12 sections into 5     │
 *   │ Cli  │  task-oriented categories so the panel    │
 *   │      │  reads as a focused workspace rather      │
 *   │ ◇    │  than a 12-row scrolling wall.            │
 *   │ Svc  │                                           │
 *   │      │                                           │
 *   │ ▢    │                                           │
 *   │ Sto  │                                           │
 *   │      │                                           │
 *   │ ⓘ    │                                           │
 *   │ Abt  │                                           │
 *   └──────┴───────────────────────────────────────────┘
 *
 * Phase 9a renders the shell + nav + one representative section per
 * bucket so the structure is testable end-to-end. The remaining
 * sections (logs / remoteClients / providers full / snapshots / vuln)
 * land in Phase 9b once the shell shape is approved.
 *
 * Data: same \`GET /api/debug\` endpoint v2 Debug already uses. Two
 * additional live polls (\`/api/debug/cpu-temp\` and \`/api/debug/fan\`)
 * stay v2-only for now — the static snapshot reads of cpuTemp + fan
 * in the initial response are enough to validate the design.
 *
 * @returns {JSX.Element|null} debug overlay, or null when closed or
 *   when running on a non-local client (server enforces this too via
 *   \`localhostOnly\` on \`/api/debug\`).
 */
const DebugPanel = () => {
  const { t } = useTranslation();
  const {
    debugMenuOpen,
    setDebugMenuOpen,
    isLocal,
    debugEnabled,
    refreshUpdateCheck,
  } = useContext(AppContext);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  // Multi-select buckets: each rail tab is a push-button. Press to
  // pin its section on screen; press again to unpin. Multiple
  // sections can stack vertically — handy for cross-bucket
  // debugging (e.g. Server KPI side-by-side with the Services
  // quota board when chasing a slow endpoint). Default: just
  // Server, same as a fresh open.
  const [activeBuckets, setActiveBuckets] = useState(() => new Set(["server"]));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // Column count for the masonry distributor — 1 on narrow viewports
  // (Pi 7"), 2 on desktop. Same 880 px breakpoint the .stack CSS
  // used before. Tracked via matchMedia so live resize works.
  const [columnCount, setColumnCount] = useState(
    () => (typeof window !== "undefined" && window.matchMedia("(min-width: 880px)").matches ? 2 : 1),
  );
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 880px)");
    const handler = (e) => setColumnCount(e.matches ? 2 : 1);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const toggleBucket = useCallback((id) => {
    setActiveBuckets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const tod = useTimeOfDay();
  const palette = getPalette(tod);

  // Refresh data when the panel opens. The endpoint is localhost-only
  // (server middleware), so we don't even bother fetching for remote
  // clients — the panel itself won't open per the v2 ControlButtons
  // gate, but defence-in-depth.
  const fetchDebug = useCallback(() => {
    if (!isLocal) return;
    setLoading(true);
    setError(null);
    axios.get("/api/debug")
      .then((res) => {
        setData(res.data);
      })
      .catch((err) => {
        setError(err?.response?.data?.error || err?.message || "Unknown error");
      })
      .finally(() => setLoading(false));
  }, [isLocal]);

  useEffect(() => {
    if (debugMenuOpen) fetchDebug();
  }, [debugMenuOpen, fetchDebug]);

  // The panel renders nothing when closed, when the user isn't on a
  // local client, or when DEBUG=true isn't set on the service. The v2
  // gate behaviour is preserved exactly.
  if (!debugMenuOpen) return null;
  if (!isLocal || !debugEnabled) return null;

  const cssVars = {
    "--c-bg": palette.bg,
    "--c-text": palette.text,
    "--c-text-dim": palette.textDim,
    "--c-accent": palette.accent,
    "--c-accent-soft": palette.accentSoft,
    "--c-surface": palette.surface,
    "--c-surface-hybrid": palette.surfaceHybrid,
    "--c-border": palette.border,
    "--c-border-hybrid": palette.borderHybrid,
    "--c-warn": palette.warn,
    "--c-danger": palette.danger,
    "--c-cool": palette.cool,
  };

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" style={cssVars}>
      <div className={styles.header}>
        <div className={styles.title}>{t("debug.title", { defaultValue: "Debug" })}</div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.actionButton}
            onClick={fetchDebug}
            disabled={loading}
          >
            <InlineIcon icon={refreshIcon} />
            <span>{loading
              ? t("debug.loading", { defaultValue: "Loading…" })
              : t("debug.refresh", { defaultValue: "Refresh" })}</span>
          </button>
          <button
            type="button"
            className={styles.actionButton}
            disabled={!data}
            onClick={() => {
              if (!data) return;
              // exportDebugCsv reads `clientMetrics` and `fps`; both are
              // owned by the v2 ClientKpiSection (not yet ported to
              // BucketClient in v3 — lot 2). Pass null so the CSV
              // header writes "N/A" instead of crashing. The remaining
              // server-side sections (kpis, quotas, services, etc.)
              // export with the same shape as v2.
              exportDebugCsv(data, null, null);
            }}
          >
            <InlineIcon icon={downloadIcon} />
            <span>{t("debug.exportCsv", { defaultValue: "Export CSV" })}</span>
          </button>
          <button
            type="button"
            className={styles.actionButton}
            disabled={checkingUpdate || typeof refreshUpdateCheck !== "function"}
            onClick={() => {
              if (typeof refreshUpdateCheck !== "function") return;
              setCheckingUpdate(true);
              Promise.resolve(refreshUpdateCheck(true))
                .catch((err) => console.warn("[DebugPanel] update check failed", err))
                .finally(() => {
                  setCheckingUpdate(false);
                  // Re-fetch /api/debug so the new updateInfo lands in the About bucket.
                  fetchDebug();
                });
            }}
          >
            <InlineIcon icon={upgradeIcon} />
            <span>{checkingUpdate
              ? t("debug.checking", { defaultValue: "Checking…" })
              : t("debug.checkUpdate", { defaultValue: "Check update" })}</span>
          </button>
          <button
            type="button"
            className={styles.closeButton}
            onClick={() => setDebugMenuOpen(false)}
            aria-label={t("controls.closeDebug")}
          >
            <InlineIcon icon={closeSharp} />
          </button>
        </div>
      </div>

      <div className={styles.body}>
        <nav className={styles.rail} role="group" aria-label="Debug sections">
          {BUCKETS.map((b) => {
            const isActive = activeBuckets.has(b.id);
            return (
              <button
                key={b.id}
                type="button"
                aria-pressed={isActive}
                className={`${styles.railButton} ${isActive ? styles.railButtonActive : ""}`}
                onClick={(e) => {
                  toggleBucket(b.id);
                  // Drop focus after a mouse / touch activation so the
                  // tab doesn't keep `:focus-visible` styling that
                  // could be misread as "pressed". Keyboard users
                  // (Space / Enter) keep focus naturally because
                  // those keypresses re-fire `:focus-visible`.
                  e.currentTarget.blur();
                }}
              >
                <span className={styles.railIcon}>{b.icon}</span>
                <span className={styles.railLabel}>{b.label}</span>
              </button>
            );
          })}
        </nav>

        <main className={styles.pane}>
          {error ? (
            <div className={styles.errorBox}>
              {t("debug.fetchError", { defaultValue: "Could not load debug data" })}
              <div className={styles.errorMessage}>{error}</div>
            </div>
          ) : loading && !data ? (
            <div className={styles.loadingBox}>
              {t("debug.loading", { defaultValue: "Loading…" })}
            </div>
          ) : !data ? null : activeBuckets.size === 0 ? (
            <div className={styles.placeholder}>
              {t("debug.pickBucket", {
                defaultValue: "Press a tab to view a section. Press again to hide it. Multiple sections can stack.",
              })}
            </div>
          ) : (
            // Masonry-style layout: distribute pinned buckets across
            // explicit columns so the dominant bucket (Services) doesn't
            // strand a half-empty column next to it. CSS multi-column
            // can't do this because it fills in document order and
            // can't move a tall item out of the way. Column count is
            // viewport-driven via the CSS class names so the algorithm
            // produces 1 column on Pi 7", 2 on standard desktop.
            <MasonryStack
              activeBuckets={activeBuckets}
              data={data}
              columnCount={columnCount}
            />
          )}
        </main>
      </div>
    </div>
  );
};

const BUCKETS = [
  { id: "server",   icon: "⌬", label: "Server" },
  { id: "client",   icon: "◐", label: "Client" },
  { id: "services", icon: "◇", label: "Services" },
  { id: "storage",  icon: "▢", label: "Storage" },
  { id: "about",    icon: "ⓘ", label: "About" },
];

// Approximate heights for each bucket in pixels — used by the
// masonry distributor below. Exact values aren't critical; we just
// need a stable rank-order so the algorithm can place each bucket
// into the currently-shortest column. Refined from on-screen
// measurements during validation; tweak when section content
// changes substantially. CSS multi-column can't do this with
// `break-inside: avoid` because it greedily fills col 1 in document
// order before considering col 2.
const APPROX_HEIGHT = {
  server: 360,
  // Client bumped from 240 — now includes Current position section
  // (lat/lon/zoom/aqhi grid + copy button) above the remote/security
  // lists, so the bucket grew by ~120 px.
  client: 360,
  services: 580,
  storage: 440,
  about: 260,
};

/**
 * Distribute the active buckets across `columnCount` columns using a
 * Longest-Processing-Time-first greedy scheduler — each bucket goes
 * to the column with the smallest running total. Returns an array
 * of arrays, one per column, with the bucket objects in placement
 * order.
 *
 * @param {Set<string>} activeBuckets
 * @param {number} columnCount
 * @returns {Array<Array<{id:string,icon:string,label:string}>>}
 */
function distributeBuckets(activeBuckets, columnCount) {
  const cols = Array.from({ length: columnCount }, () => []);
  if (activeBuckets.size === 0) return cols;
  const heights = new Array(columnCount).fill(0);
  const pinned = BUCKETS.filter((b) => activeBuckets.has(b.id));
  // Sort by descending approximate height so the dominant bucket
  // gets placed first into a clean column, and subsequent shorter
  // buckets fill the gaps.
  const sorted = [...pinned].sort(
    (a, b) => (APPROX_HEIGHT[b.id] || 300) - (APPROX_HEIGHT[a.id] || 300),
  );
  sorted.forEach((b) => {
    let idx = 0;
    for (let i = 1; i < columnCount; i += 1) {
      if (heights[i] < heights[idx]) idx = i;
    }
    cols[idx].push(b);
    heights[idx] += APPROX_HEIGHT[b.id] || 300;
  });
  return cols;
}

/**
 * Renders the pinned buckets distributed across N columns using the
 * masonry placement helper. Each column is its own flex container so
 * the visual order matches what the user pressed — the canonical
 * BUCKETS order is preserved within each column, but tall buckets
 * are moved out of the way to balance heights.
 *
 * @param {object} props
 * @param {Set<string>} props.activeBuckets
 * @param {object} props.data — /api/debug payload
 * @param {number} props.columnCount — 1 on narrow, 2 on desktop
 * @returns {JSX.Element}
 */
const MasonryStack = ({ activeBuckets, data, columnCount }) => {
  const columns = distributeBuckets(activeBuckets, columnCount);
  return (
    <div
      className={`${styles.stack} ${columnCount === 2 ? styles.stackTwoCol : styles.stackOneCol}`}
    >
      {columns.map((col, i) => (
        <div key={i} className={styles.stackColumn}>
          {col.map((b) => (
            <section key={b.id} className={styles.stackItem}>
              <div className={styles.stackHeader}>
                <span className={styles.stackHeaderIcon}>{b.icon}</span>
                <span className={styles.stackHeaderLabel}>{b.label}</span>
              </div>
              <BucketContent bucket={b.id} data={data} />
            </section>
          ))}
        </div>
      ))}
    </div>
  );
};

/**
 * Per-bucket dispatcher, wrapped in an error boundary so a render
 * crash in one bucket doesn't take down the whole panel (or worse,
 * unmount the App root and leave the user staring at a black screen).
 *
 * @param {object} props
 * @param {string} props.bucket — active bucket id
 * @param {object} props.data — payload from /api/debug
 * @returns {JSX.Element}
 */
const BucketContent = ({ bucket, data }) => (
  <BucketErrorBoundary bucket={bucket}>
    {bucket === "server"   ? <BucketServer data={data} /> :
     bucket === "client"   ? <BucketClient data={data} /> :
     bucket === "services" ? <BucketServices data={data} /> :
     bucket === "storage"  ? <BucketStorage data={data} /> :
     bucket === "about"    ? <BucketAbout data={data} /> :
                             null}
  </BucketErrorBoundary>
);

/**
 * Localised React error boundary — keeps a render crash inside the
 * bucket pane instead of letting it propagate up and unmount the
 * whole DebugPanel (or the App). The user sees a recoverable error
 * message and can switch to a different bucket.
 */
class BucketErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidUpdate(prev) {
    // Reset the error state when the user picks a different bucket so
    // the new pane gets a chance to render.
    if (prev.bucket !== this.props.bucket && this.state.error) {
      this.setState({ error: null });
    }
  }
  componentDidCatch(error, info) {
    // Surface the crash details to the console so the developer can
    // pick them up via the v2 Debug overlay or remote DevTools.
    console.error("[DebugPanel] bucket render crashed", this.props.bucket, error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div className={styles.errorBox}>
          {`Render error in "${this.props.bucket}" bucket — switch to another tab to recover.`}
          <div className={styles.errorMessage}>{String(this.state.error.message || this.state.error)}</div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ───────────────────────────────────────────────────────────────────
// Bucket renderers — each shows the most representative section(s)
// ───────────────────────────────────────────────────────────────────

const BucketServer = ({ data }) => {
  const v = data.appVersion || {};
  const sys = data.system || {};
  const net = data.network || {};
  const cfg = data.serverConfig || {};
  const kpis = data.serverKpis || {};
  const mem = kpis.memory || {};
  const netUrls = Array.isArray(net.urls) ? net.urls : [];
  const conn = data.connectivity || null;
  return (
    <div className={styles.bucket}>
      <SectionTitle title="Server config" />
      <div className={styles.gridTwo}>
        <KV k="version"  v={`${v.name || "?"} v${v.version || "?"} · ${v.commit || "?"}`} />
        <KV k="hostname" v={sys.hostname || "?"} />
        <KV k="hardware" v={sys.hardware || "?"} />
        <KV k="os"       v={sys.os || "?"} />
        <KV k="branch"   v={v.branch || "?"} />
        <KV k="init"     v={(cfg.initManager || "—").toUpperCase()} />
        <KV k="DEBUG"    v={<Tag kind={cfg.debug ? "ok" : "neutral"}>{cfg.debug ? "TRUE" : "FALSE"}</Tag>} />
        <KV k="ALLOW_REMOTE" v={<Tag kind={cfg.allowRemote ? "warn" : "neutral"}>{cfg.allowRemote ? "TRUE" : "FALSE"}</Tag>} />
      </div>

      <SectionTitle title="Network" gap />
      <div className={styles.netList}>
        {netUrls.length > 0 ? (
          netUrls.map((url) => (
            <span key={url} className={styles.netUrl}>{url}</span>
          ))
        ) : (
          <span className={styles.netUrl}>
            {`${net.protocol || "?"}://localhost:${net.port || "?"}`}
          </span>
        )}
        {conn ? (
          <span className={`${styles.netConn} ${conn.online ? styles.netConnOnline : styles.netConnOffline}`}>
            {`Internet: ${conn.online ? "ONLINE" : "OFFLINE"}`}
            {conn.online && conn.latencyMs != null ? ` · ${conn.latencyMs} ms` : ""}
          </span>
        ) : null}
      </div>

      <SectionTitle title="Server KPI" gap />
      <div className={styles.gridTwo}>
        <KV k="uptime"     v={kpis.uptimeSec != null ? formatUptime(kpis.uptimeSec) : "—"} />
        <KV k="heap used"  v={mem.heapUsedMb != null ? `${mem.heapUsedMb} MB` : "—"} />
        <KV k="heap total" v={mem.heapTotalMb != null ? `${mem.heapTotalMb} MB` : "—"} />
        <KV k="rss"        v={mem.rssMb != null ? `${mem.rssMb} MB` : "—"} />
        <KV k="cpu temp"   v={kpis.cpuTempC != null ? `${kpis.cpuTempC.toFixed(1)} °C` : "—"} />
        <KV k="fan rpm"    v={kpis.fanRpm != null ? kpis.fanRpm.toLocaleString() : "—"} />
        <KV k="cache hits" v={kpis.cache?.hits != null ? kpis.cache.hits.toLocaleString() : "—"} />
        <KV k="cache rate" v={kpis.cache?.rate != null ? `${kpis.cache.rate}%` : "—"} />
      </div>

      {kpis.powerStatus?.available ? (
        <>
          <SectionTitle title="Power status" gap />
          <PowerStatusRow powerStatus={kpis.powerStatus} />
        </>
      ) : null}

      {kpis.radarCompression ? (
        <>
          <SectionTitle title="Radar compression" gap />
          <RadarCompressionRow stats={kpis.radarCompression} />
        </>
      ) : null}

      {Array.isArray(kpis.responseTimes) && kpis.responseTimes.length > 0 ? (
        <>
          <SectionTitle title="Response times" gap />
          <div className={styles.list}>
            {kpis.responseTimes.slice(0, 10).map((r, i) => (
              <div key={i} className={styles.row}>
                <span className={styles.rowName}>{r.endpoint}</span>
                <span className={styles.rowDim}>{r.count} req</span>
                <span className={styles.rowMono}>{r.avgMs} ms avg</span>
              </div>
            ))}
          </div>
        </>
      ) : null}

      <SectionTitle title="Recent logs" gap />
      <LogsBlock logs={data.logs} />
    </div>
  );
};

/**
 * Server log tail block (last N lines from the snapshot). Mirrors v2
 * LogsSection: cache and security lines get a distinct colour class so
 * the user can scan for noise vs interesting events.
 *
 * @param {object} props
 * @param {Array<string>} props.logs
 * @returns {JSX.Element}
 */
const LogsBlock = ({ logs }) => {
  if (!Array.isArray(logs) || logs.length === 0) {
    return <div className={styles.emptyNote}>No logs to show.</div>;
  }
  return (
    <div className={styles.logBlock}>
      {logs.map((line, i) => {
        let cls = styles.logLine;
        if (line.includes("[cache]")) cls = `${cls} ${styles.logLineCache}`;
        else if (line.includes("[security]")) cls = `${cls} ${styles.logLineSecurity}`;
        return <div key={i} className={cls}>{line}</div>;
      })}
    </div>
  );
};

/**
 * Client KPIs collected via the Performance API + a requestAnimationFrame
 * loop for live FPS. Mirrors the v2 ClientKpiSection: page load time from
 * the navigation entry, JS heap (Chromium only), resource-timing roll-up
 * grouped by API endpoint, screen resolution + DPR, and a sliding-window
 * 2 s FPS average refreshed once per second.
 *
 * Returns null fields when the API isn't available so the consumer can
 * render "—" without nested optional chains.
 *
 * @returns {{ pageLoad: number|null, heap: object|null, apiCalls: Array, screen: object, fps: number|null }}
 */
const useClientMetrics = () => {
  const [fps, setFps] = useState(null);
  const [metrics, setMetrics] = useState({ pageLoad: null, heap: null, apiCalls: [], screen: null });
  const rafRef = useRef(null);
  useEffect(() => {
    const [navEntry] = performance.getEntriesByType("navigation");
    const pageLoad = navEntry ? Math.round(navEntry.loadEventEnd) : null;
    const heap = performance.memory
      ? {
        used: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024),
        total: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024),
      }
      : null;
    const grouped = {};
    performance.getEntriesByType("resource")
      .filter((r) => r.name.includes("/api/"))
      .forEach((r) => {
        const { pathname } = new URL(r.name);
        const [key] = pathname.replace(/\/[0-9]+\/[0-9]+\/[0-9]+$/, "/:z/:x/:y").split("?");
        const ms = Math.round(r.duration);
        if (!grouped[key]) grouped[key] = { count: 0, totalMs: 0, minMs: Infinity, maxMs: 0 };
        grouped[key].count++;
        grouped[key].totalMs += ms;
        if (ms < grouped[key].minMs) grouped[key].minMs = ms;
        if (ms > grouped[key].maxMs) grouped[key].maxMs = ms;
      });
    const apiCalls = Object.entries(grouped)
      .map(([endpoint, s]) => ({
        endpoint,
        count: s.count,
        avgMs: Math.round(s.totalMs / s.count),
        minMs: s.minMs === Infinity ? 0 : s.minMs,
        maxMs: s.maxMs,
      }))
      .sort((a, b) => b.count - a.count);
    const screen = {
      width: window.screen.width,
      height: window.screen.height,
      dpr: window.devicePixelRatio || 1,
    };
    setMetrics({ pageLoad, heap, apiCalls, screen });

    const timestamps = [];
    const WINDOW_MS = 2000;
    let timeoutId = null;
    const tick = (ts) => {
      timestamps.push(ts);
      const cutoff = ts - WINDOW_MS;
      while (timestamps.length > 0 && timestamps[0] < cutoff) timestamps.shift();
      rafRef.current = requestAnimationFrame(tick);
    };
    const updateFps = () => {
      if (timestamps.length > 1) {
        const elapsed = timestamps[timestamps.length - 1] - timestamps[0];
        setFps(Math.round((timestamps.length - 1) * 1000 / elapsed));
      }
      timeoutId = setTimeout(updateFps, 1000);
    };
    timeoutId = setTimeout(() => {
      rafRef.current = requestAnimationFrame(tick);
      updateFps();
    }, 500);
    return () => {
      clearTimeout(timeoutId);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);
  return { ...metrics, fps };
};

const BucketClient = ({ data }) => {
  const clients = Array.isArray(data.remoteClients) ? data.remoteClients : [];
  const events = Array.isArray(data.securityEvents) ? data.securityEvents : [];
  // Current map position + zoom + AQHI come straight from AppContext
  // (they're live client state, not part of the /api/debug snapshot).
  // The Settings panel shows the *default* coords (`customLat`/`customLon`);
  // this row shows the *currently selected* coords the user navigated
  // to — same distinction v2 Debug surfaces in its Client KPI block.
  const { mapGeo, currentMapZoom, aqhiInfo } = useContext(AppContext);
  const { pageLoad, heap, apiCalls, screen, fps } = useClientMetrics();
  const coordsString = mapGeo
    ? `${mapGeo.latitude.toFixed(6)}, ${mapGeo.longitude.toFixed(6)}`
    : null;
  return (
    <div className={styles.bucket}>
      <SectionTitle title="Client KPI" />
      <div className={styles.gridTwo}>
        <KV k="page load" v={pageLoad != null ? `${pageLoad} ms` : "—"} />
        <KV
          k="fps"
          v={<span className={
            fps == null ? "" :
              fps >= 50 ? styles.fpsGood :
                fps >= 30 ? styles.fpsWarn :
                  styles.fpsErr
          }>{fps != null ? fps : "…"}</span>}
        />
        <KV
          k="js heap"
          v={heap ? `${heap.used} / ${heap.total} MB` : "—"}
        />
        <KV
          k="screen"
          v={screen ? `${screen.width}×${screen.height}${screen.dpr !== 1 ? ` @${screen.dpr}×` : ""}` : "—"}
        />
      </div>

      <SectionTitle title="Current position" gap />
      <div className={styles.gridTwo}>
        <KV
          k="lat"
          v={mapGeo ? mapGeo.latitude.toFixed(6) : "—"}
        />
        <KV
          k="lon"
          v={mapGeo ? mapGeo.longitude.toFixed(6) : "—"}
        />
        <KV k="zoom" v={currentMapZoom != null ? currentMapZoom : "—"} />
        <KV
          k="aqhi"
          v={aqhiInfo?.value != null
            ? `${aqhiInfo.value}${aqhiInfo.category ? ` · ${aqhiInfo.category}` : ""}`
            : "—"}
        />
      </div>
      {coordsString ? (
        <div className={styles.copyCoordRow}>
          <DebugCopyButton value={coordsString} />
        </div>
      ) : null}

      <SectionTitle title="API calls (session)" gap />
      {apiCalls.length === 0 ? (
        <div className={styles.emptyNote}>No client-side API calls recorded yet.</div>
      ) : (
        <div className={styles.list}>
          {apiCalls.slice(0, 10).map((r) => (
            <div key={r.endpoint} className={styles.row}>
              <span className={styles.rowName}>{r.endpoint}</span>
              <span className={styles.rowDim}>{r.count} req</span>
              <span className={styles.rowMono}>{r.avgMs} ms avg · {r.minMs}–{r.maxMs}</span>
            </div>
          ))}
        </div>
      )}

      <SectionTitle title="Remote clients" gap />
      {clients.length === 0 ? (
        <div className={styles.emptyNote}>No remote clients tracked yet.</div>
      ) : (
        <div className={styles.list}>
          {clients.slice(0, 10).map((c, i) => (
            <div key={i} className={styles.row}>
              <span className={styles.rowMono}>{c.ip || c.address || "?"}</span>
              <span className={styles.rowDim}>
                {c.firstSeen ? new Date(c.firstSeen).toLocaleTimeString() : "?"}
                {" → "}
                {c.lastSeen ? new Date(c.lastSeen).toLocaleTimeString() : "?"}
              </span>
              <span>{c.requestCount ?? c.requests ?? 0} req</span>
            </div>
          ))}
        </div>
      )}

      <SectionTitle title="Security events" gap />
      {events.length === 0 ? (
        <div className={styles.emptyNote}>No security events.</div>
      ) : (
        <div className={styles.list}>
          {events.slice(0, 10).map((s, i) => (
            <div key={i} className={styles.row}>
              <Tag kind="err">BLOCKED</Tag>
              <span className={styles.rowMono}>{s.ip || "?"}</span>
              <span>{s.method || ""} {s.path || s.url || ""}</span>
              <span className={styles.rowDim}>{s.reason || s.message || ""}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const BucketServices = ({ data }) => {
  const providers = data.providerStatus?.providers || [];
  const fetchedAt = data.providerStatus?.fetchedAt
    ? new Date(data.providerStatus.fetchedAt).toLocaleTimeString()
    : null;
  const services = data.services || {};
  const counters = data.counters || {};
  const counterEntries = Object.entries(counters);
  return (
    <div className={styles.bucket}>
      <div className={styles.sectionTitleRow}>
        <SectionTitle title="Provider statuspages" />
        {fetchedAt ? (
          <span className={styles.sectionMeta}>last fetch: {fetchedAt}</span>
        ) : null}
      </div>
      {providers.length === 0 ? (
        <div className={styles.emptyNote}>No provider status available.</div>
      ) : (
        <div className={styles.list}>
          {providers.map((p, i) => (
            <div key={i} className={styles.row}>
              <Tag kind={
                p.indicator === "none" ? "ok"
                  : p.indicator === "minor" ? "warn"
                    : "err"
              }>{String(p.indicator || "?").toUpperCase()}</Tag>
              <span className={styles.rowName}>{p.name}</span>
              <span className={styles.rowDim}>{p.description}</span>
            </div>
          ))}
        </div>
      )}

      <SectionTitle title="Recent service calls" gap />
      {Object.keys(services).length === 0 ? (
        <div className={styles.emptyNote}>No service activity yet.</div>
      ) : (
        <div className={styles.list}>
          {Object.entries(services).slice(0, 10).map(([name, info]) => (
            <div key={name} className={styles.row}>
              <Tag kind={info?.status === "ok" ? "ok" : info?.status === "warn" ? "warn" : "err"}>
                {String(info?.status || "?").toUpperCase()}
              </Tag>
              <span className={styles.rowName}>{name}</span>
              <span className={styles.rowDim}>{info?.comment || ""}</span>
            </div>
          ))}
        </div>
      )}

      {counterEntries.length === 0 ? (
        <>
          <SectionTitle title="API quotas" gap />
          <div className={styles.emptyNote}>No quota data tracked yet.</div>
        </>
      ) : (
        counterEntries.map(([service, info]) => {
          if (!info || typeof info !== "object") return null;
          const quotas = (info.quotas && typeof info.quotas === "object") ? info.quotas : {};
          const endpointsObj = (info.endpoints && typeof info.endpoints === "object") ? info.endpoints : {};
          const endpoints = Object.entries(endpointsObj);
          if (endpoints.length === 0) return null;
          return (
            <QuotaTable
              key={service}
              service={service}
              quotas={quotas}
              endpoints={endpoints}
            />
          );
        })
      )}
    </div>
  );
};

const SERVICE_LABELS = {
  "tomorrow.io": "Tomorrow.io",
  "mapbox": "Mapbox",
  "locationiq": "LocationIQ",
  "ipapi.co": "ipapi.co",
  "anthropic": "Anthropic",
  "rainviewer": "RainViewer",
  "sunrise-sunset.org": "sunrise-sunset.org",
};

/**
 * Detailed quota table for one external service. Replaces the v3
 * condensed grid: column for endpoint + one column per quota window
 * (hour / today / month) + TOTAL row. Cells colour by usage tier
 * (≥80% warn, ≥100% danger). Matches v2 QuotaSection so the user
 * gets the same operational picture (e.g. "current is 1/25 this hour,
 * 2/500 today").
 *
 * @param {object} props
 * @param {string} props.service service key
 * @param {object} props.quotas — `{ hour, day, month }` caps (any may be null)
 * @param {Array}  props.endpoints — `[[name, { hour, day, month }], ...]`
 * @returns {JSX.Element}
 */
const QuotaTable = ({ service, quotas, endpoints }) => {
  const label = (SERVICE_LABELS[service] || service).toUpperCase();
  const showHour = quotas.hour != null;
  const showDay = quotas.day != null;
  const showMonth = quotas.month != null;
  const total = { hour: 0, day: 0, month: 0 };
  endpoints.forEach(([, c]) => {
    total.hour += c?.hour || 0;
    total.day += c?.day || 0;
    total.month += c?.month || 0;
  });
  const tierClass = (used, cap) => {
    if (!cap) return "";
    if (used >= cap) return styles.quotaCellErr;
    if (used >= cap * 0.8) return styles.quotaCellWarn;
    return "";
  };
  const fmt = (count, cap) => (cap ? `${count} / ${cap.toLocaleString()}` : String(count));
  return (
    <>
      <SectionTitle title={`Quota — ${label}`} gap />
      <div className={styles.quotaTable}>
        <div className={styles.quotaTableHead}>
          <span>endpoint</span>
          {showHour ? <span>this hour</span> : null}
          {showDay ? <span>today</span> : null}
          {showMonth ? <span>this month</span> : null}
        </div>
        {endpoints.map(([ep, c]) => {
          const counter = (c && typeof c === "object") ? c : {};
          return (
            <div key={ep} className={styles.quotaTableRow}>
              <span className={styles.quotaTableEp}>{ep}</span>
              {showHour ? <span className={tierClass(counter.hour || 0, quotas.hour)}>{fmt(counter.hour || 0, null)}</span> : null}
              {showDay ? <span className={tierClass(counter.day || 0, quotas.day)}>{fmt(counter.day || 0, null)}</span> : null}
              {showMonth ? <span className={tierClass(counter.month || 0, quotas.month)}>{fmt(counter.month || 0, null)}</span> : null}
            </div>
          );
        })}
        <div className={`${styles.quotaTableRow} ${styles.quotaTableTotal}`}>
          <span>TOTAL</span>
          {showHour ? <span className={tierClass(total.hour, quotas.hour)}>{fmt(total.hour, quotas.hour)}</span> : null}
          {showDay ? <span className={tierClass(total.day, quotas.day)}>{fmt(total.day, quotas.day)}</span> : null}
          {showMonth ? <span className={tierClass(total.month, quotas.month)}>{fmt(total.month, quotas.month)}</span> : null}
        </div>
      </div>
    </>
  );
};

const BucketStorage = ({ data }) => {
  const cache = Array.isArray(data.cache) ? data.cache : [];
  const kpis = data.serverKpis || {};
  return (
    <div className={styles.bucket}>
      <SectionTitle title="Cache stats" />
      <div className={styles.gridTwo}>
        <KV k="hits"     v={kpis.cache?.hits != null ? kpis.cache.hits.toLocaleString() : "—"} />
        <KV k="misses"   v={kpis.cache?.misses != null ? kpis.cache.misses.toLocaleString() : "—"} />
        <KV k="hit rate" v={kpis.cache?.rate != null ? `${kpis.cache.rate}%` : "—"} />
        <KV k="entries"  v={cache.length.toLocaleString()} />
      </div>

      <SectionTitle title="Cache entries" gap />
      {cache.length === 0 ? (
        <div className={styles.emptyNote}>Cache is empty.</div>
      ) : (
        <div className={styles.list}>
          {cache.slice(0, 12).map((e, i) => (
            <div key={i} className={styles.row}>
              <span className={styles.rowMono}>{e.key}</span>
              <span className={styles.rowDim}>
                {e.expired ? "EXPIRED" : `TTL ${e.expiresIn ?? "?"}s`}
              </span>
            </div>
          ))}
        </div>
      )}

      <SectionTitle title="Radar AI snapshots" gap />
      <RadarSnapshotsBlock snapshots={data.radarSnapshots} />
    </div>
  );
};

/**
 * Recent radar AI prompt snapshots — collapsible per-entry with the
 * input radar text and the resulting Claude summary. Per-entry copy
 * button, plus a section-level JSON export so the user can ship a
 * full snapshot bundle for offline review.
 *
 * @param {object} props
 * @param {Array} props.snapshots
 * @returns {JSX.Element}
 */
const RadarSnapshotsBlock = ({ snapshots }) => {
  const [copiedIndex, setCopiedIndex] = useState(null);
  const hasAny = Array.isArray(snapshots) && snapshots.length > 0;
  const handleCopy = useCallback(async (s, i) => {
    try {
      const header = `[${new Date(s.ts).toLocaleString()}] ${s.lat?.toFixed(4)}, ${s.lon?.toFixed(4)} · ${s.lang} · ${s.source}`;
      const text = `${header}\n\n--- Radar text passed to Claude ---\n${s.radarText}\n\n--- Resulting summary ---\n${s.summary}\n`;
      await navigator.clipboard.writeText(text);
      setCopiedIndex(i);
      setTimeout(() => setCopiedIndex((cur) => (cur === i ? null : cur)), 1500);
    } catch {
      // Clipboard requires a secure context + user gesture; both hold
      // on localhost. Silent failure is fine.
    }
  }, []);
  const handleExportJson = useCallback(() => {
    if (!hasAny) return;
    const payload = JSON.stringify(snapshots, null, 2);
    const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
    const blob = new Blob([payload], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `radar-snapshots-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [snapshots, hasAny]);
  if (!hasAny) {
    return <div className={styles.emptyNote}>No radar snapshots yet.</div>;
  }
  return (
    <>
      <div className={styles.snapshotsHeader}>
        <button
          type="button"
          className={styles.compExportButton}
          onClick={handleExportJson}
        >
          Export JSON
        </button>
      </div>
      <div className={styles.snapshotsList}>
        {snapshots.map((s, i) => (
          <details key={i} className={styles.snapshot}>
            <summary className={styles.snapshotSummary}>
              <span className={styles.rowMono}>
                {new Date(s.ts).toLocaleString()}
              </span>
              <span className={styles.rowDim}>
                {s.lat?.toFixed(2)}, {s.lon?.toFixed(2)} · {s.lang} · {s.source}
              </span>
            </summary>
            <div className={styles.snapshotBody}>
              <button
                type="button"
                className={styles.compExportButton}
                onClick={() => handleCopy(s, i)}
              >
                {copiedIndex === i ? "Copied!" : "Copy"}
              </button>
              <div className={styles.snapshotLabel}>Radar text (input)</div>
              <pre className={styles.snapshotPre}>{s.radarText}</pre>
              <div className={styles.snapshotLabel}>Summary (output)</div>
              <pre className={styles.snapshotPre}>{s.summary}</pre>
            </div>
          </details>
        ))}
      </div>
    </>
  );
};

const BucketAbout = ({ data }) => {
  const v = data.appVersion || {};
  // Prefer live AppContext state over the /api/debug snapshot for the
  // update-check section. /api/debug serialises whatever was cached at
  // panel-open time, so right after "Check update" the snapshot is
  // stale until the next fetchDebug. AppContext, in contrast, is
  // refreshed synchronously inside refreshUpdateCheck — picking it up
  // here means the YES/UP-TO-DATE tag flips the moment the check
  // returns. We fall back to the snapshot for fields the context
  // doesn't carry (latest version string).
  const u = data.updateInfo || {};
  const {
    updateAvailable,
    latestSha,
    latestVersion,
    updateCommits,
    needsManualUpgrade,
    setUpdateModalOpen,
    setDebugMenuOpen,
  } = useContext(AppContext);
  const commitCount = Array.isArray(updateCommits) ? updateCommits.length : 0;
  return (
    <div className={styles.bucket}>
      <SectionTitle title="About this build" />
      <div className={styles.gridTwo}>
        <KV k="name"    v={v.name || "?"} />
        <KV k="version" v={v.version || "?"} />
        <KV k="commit"  v={v.commit || "?"} />
        <KV k="branch"  v={v.branch || "?"} />
        <KV k="repo"    v="github.com/thicla01/pi-weather-station" />
        <KV k="license" v="MIT" />
      </div>

      <SectionTitle title="Update check" gap />
      <div className={styles.gridTwo}>
        <KV k="local sha"   v={u.localSha || v.commit || "—"} />
        <KV k="latest sha"  v={latestSha || u.latestSha || "—"} />
        <KV k="latest ver"  v={latestVersion || u.latestVersion || "—"} />
        <KV k="available"   v={<Tag kind={updateAvailable ? "warn" : "ok"}>{updateAvailable ? "YES" : "UP-TO-DATE"}</Tag>} />
        {updateAvailable && commitCount > 0 ? (
          <KV k="new commits" v={String(commitCount)} />
        ) : null}
      </div>

      {updateAvailable ? (
        <div className={styles.updateActionRow}>
          {needsManualUpgrade ? (
            <p className={styles.updateNote}>
              This install is too old for the in-app updater. Run
              <code> bash deploy/install.sh </code>
              on the device to upgrade.
            </p>
          ) : (
            <button
              type="button"
              className={styles.updateInstallButton}
              onClick={() => {
                // Close the debug overlay so the UpdateModal (z-index
                // 4999, below DebugPanel at 5000) is visible and gets
                // focus. The user can re-open Debug afterwards if the
                // install fails and they need to inspect logs.
                setDebugMenuOpen(false);
                setUpdateModalOpen(true);
              }}
            >
              <InlineIcon icon={upgradeIcon} />
              <span>Install update…</span>
            </button>
          )}
        </div>
      ) : null}

      <SectionTitle title="Vulnerability scan" gap />
      <div className={styles.vulnNotice}>
        <p className={styles.vulnText}>
          Vulnerability scanning + automatic security PRs now live on
          GitHub via Dependabot — see the alerts dashboard for the
          live source of truth.
        </p>
        {data.vulnerabilityScanUrl ? (
          <a
            href={data.vulnerabilityScanUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.vulnLink}
          >
            {data.vulnerabilityScanUrl}
          </a>
        ) : null}
      </div>
    </div>
  );
};

// ───────────────────────────────────────────────────────────────────
// Tiny atoms — KV, Tag, QuotaBar, SectionTitle
// ───────────────────────────────────────────────────────────────────

const KV = ({ k, v }) => (
  <div className={styles.kv}>
    <span className={styles.kvKey}>{k}</span>
    <span className={styles.kvValue}>{v}</span>
  </div>
);

const Tag = ({ kind, children }) => (
  <span className={`${styles.tag} ${styles[`tag-${kind || "neutral"}`]}`}>{children}</span>
);

const SectionTitle = ({ title, gap }) => (
  <h3 className={`${styles.sectionTitle} ${gap ? styles.sectionTitleGap : ""}`}>{title}</h3>
);

const POWER_FLAGS = ["underVoltage", "freqCapped", "throttled", "tempLimit"];
const POWER_CRITICAL = ["underVoltage", "throttled"];
const POWER_LABELS = {
  underVoltage: "Under-voltage",
  freqCapped:   "Freq capped",
  throttled:    "Throttled",
  tempLimit:    "Temp limit",
};

/**
 * Raspberry Pi power-status flags (vcgencmd get_throttled). Mirrors v2
 * PowerStatusRow: green OK badge when no current issue, warn/err
 * chips per active flag, "since reboot" line for occurred-but-cleared.
 *
 * @param {object} props
 * @param {object} props.powerStatus — `{ available, current, occurred }`
 * @returns {JSX.Element}
 */
const PowerStatusRow = ({ powerStatus }) => {
  const anyCurrent = POWER_FLAGS.some((f) => powerStatus.current?.[f]);
  const anyOccurred = POWER_FLAGS.some((f) => powerStatus.occurred?.[f]);
  return (
    <div className={styles.powerRow}>
      {!anyCurrent ? (
        <Tag kind="ok">POWER OK</Tag>
      ) : (
        POWER_FLAGS.filter((f) => powerStatus.current[f]).map((f) => (
          <Tag key={f} kind={POWER_CRITICAL.includes(f) ? "err" : "warn"}>
            {POWER_LABELS[f]}
          </Tag>
        ))
      )}
      {anyOccurred ? (
        <span className={styles.powerSince}>
          {"Since reboot: "}
          {POWER_FLAGS.filter((f) => powerStatus.occurred[f]).map((f) => POWER_LABELS[f]).join(", ")}
        </span>
      ) : null}
    </div>
  );
};

/**
 * Radar prompt-compression KPI row + inline "Export report" button.
 * Mirrors the v2 RadarCompressionRow (kept logic identical so the
 * Markdown report path matches). Hidden by the parent when
 * `kpis.radarCompression` is absent.
 *
 * @param {object} props
 * @param {object} props.stats — `{ count, avgPct, minPct, maxPct }` from the server.
 * @returns {JSX.Element}
 */
const RadarCompressionRow = ({ stats }) => {
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState(null);
  const onExport = () => {
    if (exporting) return;
    setExporting(true);
    axios.post("/api/debug/radar-compression-report")
      .then((res) => {
        setExportMsg(res.data?.path || "Exported");
        setTimeout(() => setExportMsg(null), 4000);
      })
      .catch((err) => {
        setExportMsg(`✗ ${err?.response?.data?.message || err.message || "error"}`);
        setTimeout(() => setExportMsg(null), 4000);
      })
      .finally(() => setExporting(false));
  };
  return (
    <div className={styles.compRow}>
      <span className={styles.compStat}>
        {`${stats.avgPct.toFixed(0)} % avg · ${stats.count} frames · ${stats.minPct.toFixed(0)}–${stats.maxPct.toFixed(0)} %`}
      </span>
      <button
        type="button"
        className={styles.compExportButton}
        onClick={onExport}
        disabled={exporting}
      >
        {exporting ? "…" : "Export report"}
      </button>
      {exportMsg ? (
        <span className={styles.compExportMsg}>{exportMsg}</span>
      ) : null}
    </div>
  );
};

/**
 * Inline copy-to-clipboard pill used by the Current Position row.
 * Mirrors SettingsPanel's CopyButton but lives here to keep
 * DebugPanel self-contained (no cross-component imports yet — both
 * could move to a shared `ui/clipboard.js` when one more consumer
 * shows up).
 *
 * @param {object} props
 * @param {string} props.value — text to copy
 * @returns {JSX.Element}
 */
const DebugCopyButton = ({ value }) => {
  const [copied, setCopied] = useState(false);
  const onCopy = () => {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(value)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch((err) => console.warn("[DebugPanel] clipboard write failed", err));
  };
  return (
    <button
      type="button"
      className={styles.copyCoordButton}
      onClick={onCopy}
      title={`Copy "${value}"`}
    >
      {copied ? "Copied!" : `Copy ${value}`}
    </button>
  );
};

// ───────────────────────────────────────────────────────────────────
// Format helpers
// ───────────────────────────────────────────────────────────────────

function formatUptime(sec) {
  if (sec == null) return "—";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default DebugPanel;
