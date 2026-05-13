/* eslint-disable react/prop-types -- internal helper components, same
 * convention as SettingsPanel. */
import React, { useContext, useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { InlineIcon } from "@iconify/react";
import closeSharp from "@iconify/icons-ion/close-sharp";
import refreshIcon from "@iconify/icons-carbon/restart";
import upgradeIcon from "@iconify/icons-carbon/upgrade";
import axios from "axios";
import { AppContext } from "~/AppContext";
import { getPalette } from "~/ui/tokens";
import { useTimeOfDay } from "~/ui/hybrid";
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
  return (
    <div className={styles.bucket}>
      <SectionTitle title="Server config" />
      <div className={styles.gridTwo}>
        <KV k="version"  v={`${v.name || "?"} v${v.version || "?"} · ${v.commit || "?"}`} />
        <KV k="hostname" v={sys.hostname || "?"} />
        <KV k="hardware" v={sys.hardware || "?"} />
        <KV k="os"       v={sys.os || "?"} />
        <KV k="branch"   v={v.branch || "?"} />
        <KV k="network"  v={`${net.protocol || "?"}://localhost:${net.port || "?"}`} />
        <KV k="DEBUG"    v={<Tag kind={cfg.debug ? "ok" : "neutral"}>{cfg.debug ? "TRUE" : "FALSE"}</Tag>} />
        <KV k="ALLOW_REMOTE" v={<Tag kind={cfg.allowRemote ? "warn" : "neutral"}>{cfg.allowRemote ? "TRUE" : "FALSE"}</Tag>} />
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

      <div className={styles.deferNote}>
        Logs section lands in Phase 9b — toggle Direction C off to see
        them in the v2 Debug overlay in the meantime.
      </div>
    </div>
  );
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
  const coordsString = mapGeo
    ? `${mapGeo.latitude.toFixed(6)}, ${mapGeo.longitude.toFixed(6)}`
    : null;
  return (
    <div className={styles.bucket}>
      <SectionTitle title="Current position" />
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
  const services = data.services || {};
  const counters = data.counters || {};
  const counterEntries = Object.entries(counters);
  return (
    <div className={styles.bucket}>
      <SectionTitle title="Provider statuspages" />
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

      <SectionTitle title="API quotas" gap />
      {counterEntries.length === 0 ? (
        <div className={styles.emptyNote}>No quota data tracked yet.</div>
      ) : (
        <div className={styles.gridQuota}>
          {counterEntries.flatMap(([service, info]) => {
            // Defensive: `info` may be null, missing `quotas`, missing
            // `endpoints`, or have `endpoints` as a non-object (e.g.
            // counters that never tracked per-endpoint usage). Earlier
            // version assumed full shape and crashed the whole panel
            // when SERVICES was clicked on a fresh server with empty
            // endpoint maps.
            if (!info || typeof info !== "object") return [];
            const quotas = (info.quotas && typeof info.quotas === "object") ? info.quotas : {};
            const endpointsObj = (info.endpoints && typeof info.endpoints === "object") ? info.endpoints : {};
            const endpoints = Object.entries(endpointsObj);
            // If the service has no per-endpoint breakdown but has
            // quotas (rare but possible), still emit one row at the
            // service level.
            if (endpoints.length === 0 && (quotas.day || quotas.hour || quotas.month)) {
              return [(
                <div key={service} className={styles.quotaItem}>
                  <div className={styles.quotaName}>{service}</div>
                  <div className={styles.rowDim}>{`cap ${quotas.day ?? quotas.hour ?? quotas.month}`}</div>
                </div>
              )];
            }
            return endpoints.slice(0, 4).map(([ep, c]) => {
              const counter = (c && typeof c === "object") ? c : {};
              // Pick the most relevant window — day if exposed, else hour.
              const used = counter.day ?? counter.hour ?? counter.month ?? 0;
              const cap = quotas.day ?? quotas.hour ?? quotas.month ?? 0;
              return (
                <div key={`${service}-${ep}`} className={styles.quotaItem}>
                  <div className={styles.quotaName}>{service} · {ep}</div>
                  {cap > 0 ? (
                    <QuotaBar used={used} cap={cap} />
                  ) : (
                    <div className={styles.rowMono}>{Number(used).toLocaleString()} reqs</div>
                  )}
                </div>
              );
            });
          })}
        </div>
      )}
    </div>
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

      <div className={styles.deferNote}>
        Radar snapshots section lands in Phase 9b.
      </div>
    </div>
  );
};

const BucketAbout = ({ data }) => {
  const v = data.appVersion || {};
  const u = data.updateInfo || {};
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
        <KV k="local sha"   v={u.localSha || "—"} />
        <KV k="latest sha"  v={u.latestSha || "—"} />
        <KV k="latest ver"  v={u.latestVersion || "—"} />
        <KV k="available"   v={<Tag kind={u.updateAvailable ? "warn" : "ok"}>{u.updateAvailable ? "YES" : "UP-TO-DATE"}</Tag>} />
      </div>

      <div className={styles.deferNote}>
        Vulnerability scan section lands in Phase 9b — until then, run
        <code> npm audit </code>
        on the device.
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

const QuotaBar = ({ used, cap }) => {
  const pct = Math.min(100, (used / cap) * 100);
  const tier = pct >= 95 ? "danger" : pct >= 80 ? "warn" : "accent";
  return (
    <div className={styles.quotaBar}>
      <div className={styles.quotaRow}>
        <span className={styles.rowMono}>{used.toLocaleString()}/{cap.toLocaleString()}</span>
        <span className={`${styles.quotaPct} ${styles[`quotaPct-${tier}`]}`}>{pct.toFixed(0)}%</span>
      </div>
      <div className={styles.quotaTrack}>
        <div className={`${styles.quotaFill} ${styles[`quotaFill-${tier}`]}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};

const SectionTitle = ({ title, gap }) => (
  <h3 className={`${styles.sectionTitle} ${gap ? styles.sectionTitleGap : ""}`}>{title}</h3>
);

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
