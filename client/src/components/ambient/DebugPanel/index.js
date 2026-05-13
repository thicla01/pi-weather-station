/* eslint-disable react/prop-types -- internal helper components, same
 * convention as SettingsPanel. */
import React, { useContext, useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { InlineIcon } from "@iconify/react";
import closeSharp from "@iconify/icons-ion/close-sharp";
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
  } = useContext(AppContext);
  const [bucket, setBucket] = useState("server");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

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
        <button
          type="button"
          className={styles.closeButton}
          onClick={() => setDebugMenuOpen(false)}
          aria-label={t("controls.closeDebug")}
        >
          <InlineIcon icon={closeSharp} />
        </button>
      </div>

      <div className={styles.body}>
        <nav className={styles.rail} role="tablist" aria-label="Debug sections">
          {BUCKETS.map((b) => (
            <button
              key={b.id}
              type="button"
              role="tab"
              aria-selected={bucket === b.id}
              className={`${styles.railButton} ${bucket === b.id ? styles.railButtonActive : ""}`}
              onClick={() => setBucket(b.id)}
            >
              <span className={styles.railIcon}>{b.icon}</span>
              <span className={styles.railLabel}>{b.label}</span>
            </button>
          ))}
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
          ) : data ? (
            <BucketContent bucket={bucket} data={data} />
          ) : null}
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

/**
 * Per-bucket dispatcher. Each bucket renders its representative
 * section(s) directly. Full multi-section coverage lands in Phase 9b.
 *
 * @param {object} props
 * @param {string} props.bucket — active bucket id
 * @param {object} props.data — payload from /api/debug
 * @returns {JSX.Element}
 */
const BucketContent = ({ bucket, data }) => {
  if (bucket === "server")   return <BucketServer data={data} />;
  if (bucket === "client")   return <BucketClient data={data} />;
  if (bucket === "services") return <BucketServices data={data} />;
  if (bucket === "storage")  return <BucketStorage data={data} />;
  if (bucket === "about")    return <BucketAbout data={data} />;
  return null;
};

// ───────────────────────────────────────────────────────────────────
// Bucket renderers — each shows the most representative section(s)
// ───────────────────────────────────────────────────────────────────

const BucketServer = ({ data }) => (
  <div className={styles.bucket}>
    <SectionTitle title="Server config" />
    <div className={styles.gridTwo}>
      <KV k="version"  v={`${data.version || "?"} · ${data.commit || "?"}`} />
      <KV k="hostname" v={data.hostname || "?"} />
      <KV k="os"       v={data.osVersion || "?"} />
      <KV k="node"     v={data.nodeVersion || "?"} />
      <KV k="port"     v={`HTTPS :${data.port || "?"}`} />
      <KV k="env"      v={data.nodeEnv || "?"} />
      <KV k="DEBUG"    v={<Tag kind={data.debug ? "ok" : "neutral"}>{data.debug ? "TRUE" : "FALSE"}</Tag>} />
      <KV k="ALLOW_REMOTE" v={<Tag kind={data.allowRemote ? "warn" : "neutral"}>{data.allowRemote ? "TRUE" : "FALSE"}</Tag>} />
    </div>

    <SectionTitle title="Server KPI" gap />
    <div className={styles.gridTwo}>
      <KV k="uptime"     v={formatUptime(data.uptime)} />
      <KV k="heap used"  v={`${formatMb(data.memory?.heapUsed)} MB`} />
      <KV k="heap total" v={`${formatMb(data.memory?.heapTotal)} MB`} />
      <KV k="rss"        v={`${formatMb(data.memory?.rss)} MB`} />
      <KV k="cpu temp"   v={data.cpuTempC != null ? `${data.cpuTempC.toFixed(1)} °C` : "—"} />
      <KV k="fan rpm"    v={data.fanRpm != null ? data.fanRpm.toLocaleString() : "—"} />
    </div>

    <div className={styles.deferNote}>
      Logs section lands in Phase 9b — the v2 Debug overlay still
      surfaces them in the meantime (toggle Direction C off to access).
    </div>
  </div>
);

const BucketClient = ({ data }) => {
  const remoteCount = Array.isArray(data.remoteClients) ? data.remoteClients.length : 0;
  const securityCount = Array.isArray(data.securityEvents) ? data.securityEvents.length : 0;
  return (
    <div className={styles.bucket}>
      <SectionTitle title="Remote clients" />
      {remoteCount === 0 ? (
        <div className={styles.emptyNote}>No remote clients tracked yet.</div>
      ) : (
        <div className={styles.list}>
          {data.remoteClients.slice(0, 10).map((c, i) => (
            <div key={i} className={styles.row}>
              <span className={styles.rowMono}>{c.ip}</span>
              <span className={styles.rowDim}>{c.firstSeen} → {c.lastSeen}</span>
              <span>{c.requests} req</span>
            </div>
          ))}
        </div>
      )}

      <SectionTitle title="Security events" gap />
      {securityCount === 0 ? (
        <div className={styles.emptyNote}>No security events.</div>
      ) : (
        <div className={styles.list}>
          {data.securityEvents.slice(0, 10).map((s, i) => (
            <div key={i} className={styles.row}>
              <Tag kind="err">BLOCKED</Tag>
              <span className={styles.rowMono}>{s.ip}</span>
              <span>{s.method} {s.path}</span>
              <span className={styles.rowDim}>{s.reason}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const BucketServices = ({ data }) => {
  const quotas = data.requestCounts || data.quotas || {};
  const entries = Object.entries(quotas);
  return (
    <div className={styles.bucket}>
      <SectionTitle title="API quotas" />
      {entries.length === 0 ? (
        <div className={styles.emptyNote}>No quota data available.</div>
      ) : (
        <div className={styles.gridQuota}>
          {entries.slice(0, 12).map(([service, info]) => {
            // v2 shape: requestCounts[service] = { count, dailyMax? }
            const used = typeof info === "number" ? info : info?.count || 0;
            const cap = typeof info === "object" ? (info?.dailyMax || info?.cap || 0) : 0;
            return (
              <div key={service} className={styles.quotaItem}>
                <div className={styles.quotaName}>{service}</div>
                {cap > 0 ? (
                  <QuotaBar used={used} cap={cap} />
                ) : (
                  <div className={styles.rowMono}>{used.toLocaleString()}</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <SectionTitle title="Service health" gap />
      {data.servicesStatus ? (
        <div className={styles.list}>
          {Object.entries(data.servicesStatus).slice(0, 10).map(([name, info]) => (
            <div key={name} className={styles.row}>
              <Tag kind={info?.lastSuccess ? "ok" : "warn"}>{info?.lastSuccess ? "OK" : "STALE"}</Tag>
              <span className={styles.rowName}>{name}</span>
              <span className={styles.rowDim}>{info?.lastChecked || "—"}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.emptyNote}>No service status snapshot.</div>
      )}
    </div>
  );
};

const BucketStorage = ({ data }) => (
  <div className={styles.bucket}>
    <SectionTitle title="In-memory caches" />
    {data.cacheStats ? (
      <div className={styles.gridTwo}>
        {Object.entries(data.cacheStats).map(([cache, stats]) => (
          <KV
            key={cache}
            k={cache}
            v={typeof stats === "object"
              ? `${stats.size ?? "?"} entries · ${stats.hitRate != null ? `${stats.hitRate}%` : ""}`
              : String(stats)}
          />
        ))}
      </div>
    ) : (
      <div className={styles.emptyNote}>No cache data exposed.</div>
    )}

    <div className={styles.deferNote}>
      Radar snapshots section lands in Phase 9b.
    </div>
  </div>
);

const BucketAbout = ({ data }) => (
  <div className={styles.bucket}>
    <SectionTitle title="About this build" />
    <div className={styles.gridTwo}>
      <KV k="version" v={data.version || "?"} />
      <KV k="commit"  v={data.commit || "?"} />
      <KV k="branch"  v={data.branch || "?"} />
      <KV k="updated" v={data.lastUpdateCheck || "—"} />
      <KV k="repo"    v="github.com/thicla01/pi-weather-station" />
      <KV k="license" v="MIT" />
    </div>

    <div className={styles.deferNote}>
      Vulnerability scan section lands in Phase 9b — until then, run
      <code> npm audit </code>
      on the device.
    </div>
  </div>
);

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

// ───────────────────────────────────────────────────────────────────
// Format helpers
// ───────────────────────────────────────────────────────────────────

function formatMb(bytes) {
  if (bytes == null) return "—";
  return (bytes / 1024 / 1024).toFixed(0);
}

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
