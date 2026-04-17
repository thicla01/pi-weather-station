import React, { useContext, useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import styles from "./styles.css";
import { AppContext } from "~/AppContext";
import { CSSTransition } from "react-transition-group";
import { InlineIcon } from "@iconify/react";
import closeSharp from "@iconify/icons-ion/close-sharp";
import refreshIcon from "@iconify/icons-carbon/renew";
import downloadIcon from "@iconify/icons-carbon/download";
import PropTypes from "prop-types";
import axios from "axios";
import "!style-loader!css-loader!./animations.css";

/**
 * Debug panel — localhost only, visible when DEBUG=true server-side
 *
 * @returns {JSX.Element} Debug panel
 */
const Debug = () => {
  const { debugMenuOpen, setDebugMenuOpen } = useContext(AppContext);
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fps, setFps] = useState(null);
  const [clientMetrics, setClientMetrics] = useState(null);

  const fetchDebugInfo = useCallback(() => {
    setLoading(true);
    axios
      .get("/api/debug")
      .then((res) => setData(res.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (debugMenuOpen) fetchDebugInfo();
  }, [debugMenuOpen, fetchDebugInfo]);

  return (
    <CSSTransition
      in={debugMenuOpen}
      unmountOnExit
      timeout={300}
      classNames="animate-debug"
    >
      <div className={styles.container}>
        <div className={styles.header}>
          <div className={styles.headerColumns}>
            <div className={styles.headerLeft}>
              <div className={styles.headerTitle}>{t("debug.title")}</div>
              {data?.appVersion && (
                <div className={styles.appVersion}>
                  {data.appVersion.name} v{data.appVersion.version} · {data.appVersion.commit}
                  {data.appVersion.branch && (
                    <span className={styles.appBranch}> [{data.appVersion.branch}]</span>
                  )}
                </div>
              )}
              {data?.system && (
                <div className={styles.systemInfo}>
                  <span>{data.system.hardware}</span>
                  <span>{data.system.os}</span>
                </div>
              )}
              {data?.updateInfo && (
                <div className={data.updateInfo.updateAvailable ? styles.updateAvailable : styles.updateCurrent}>
                  {data.updateInfo.updateAvailable
                    ? t("update.available", { version: data.updateInfo.latestVersion ?? "?" })
                    : t("update.upToDate")}
                  {" · "}
                  {t("update.local")}: {data.updateInfo.localSha ?? "—"}
                  {data.updateInfo.updateAvailable && (
                    <> · {t("update.latest")}: {data.updateInfo.latestSha ?? "—"}</>
                  )}
                </div>
              )}
            </div>
            <div className={styles.headerRight}>
              {data?.network && (
                <div className={styles.networkInfo}>
                  {data.network.urls.length > 0 ? (
                    data.network.urls.map((url) => (
                      <span key={url} className={styles.networkUrl}>{url}</span>
                    ))
                  ) : (
                    <span className={styles.networkUrl}>
                      {data.network.protocol}://localhost:{data.network.port}
                    </span>
                  )}
                  {data?.connectivity && (
                    <span className={data.connectivity.online ? styles.connectivityOnline : styles.connectivityOffline}>
                      {t("debug.internet")}: {data.connectivity.online ? t("debug.online") : t("debug.offline")}
                      {data.connectivity.online && data.connectivity.latencyMs !== null && (
                        <span className={styles.connectivityLatency}> {data.connectivity.latencyMs}ms</span>
                      )}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
        <div
          className={styles.closeButton}
          onClick={() => setDebugMenuOpen(false)}
        >
          <InlineIcon icon={closeSharp} />
        </div>

        <div className={styles.buttonRow}>
          <div
            className={styles.refreshButton}
            onClick={fetchDebugInfo}
          >
            <span className={styles.refreshIcon}>
              <InlineIcon icon={refreshIcon} />
            </span>
            {loading ? t("debug.loading") : t("debug.refresh")}
          </div>
          <div
            className={styles.exportButton}
            onClick={() => exportDebugCsv(data, clientMetrics, fps)}
          >
            <span className={styles.refreshIcon}>
              <InlineIcon icon={downloadIcon} />
            </span>
            {t("debug.exportCsv")}
          </div>
        </div>

        <div className={styles.content}>
          <ServerConfigSection serverConfig={data?.serverConfig} network={data?.network} />
          <ServerKpiSection serverKpis={data?.serverKpis} />
          <ClientKpiSection
            fps={fps}
            setFps={setFps}
            clientMetrics={clientMetrics}
            setClientMetrics={setClientMetrics}
          />
          <ProviderStatusSection providerStatus={data?.providerStatus} />
          <ServicesSection services={data?.services} />
          <QuotaSection counters={data?.counters} />
          <CacheSection cache={data?.cache} />
          <LogsSection logs={data?.logs} />
          <RemoteClientsSection clients={data?.remoteClients} />
          <SecuritySection events={data?.securityEvents} />
          <AuditSection audit={data?.audit} />
        </div>
      </div>
    </CSSTransition>
  );
};

export default Debug;

const INDICATOR_CLASS = (indicator, styles) => {
  switch (indicator) {
    case "none":        return styles.indicatorNone;
    case "minor":       return styles.indicatorMinor;
    case "major":
    case "critical":    return styles.indicatorMajor;
    case "maintenance": return styles.indicatorMaintenance;
    default:            return styles.indicatorUnknown;
  }
};

/**
 * Provider status section — Atlassian Statuspage results for external providers
 *
 * @param {object} props
 * @param {object} props.providerStatus
 * @returns {JSX.Element} Provider status section
 */
const ProviderStatusSection = ({ providerStatus }) => {
  const { t } = useTranslation();
  const fetchedAt = providerStatus?.fetchedAt
    ? new Date(providerStatus.fetchedAt).toLocaleTimeString()
    : null;

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>
        {t("debug.providerStatus")}
        {fetchedAt && <span className={styles.providerFetchedAt}> — {t("debug.lastFetch")}: {fetchedAt}</span>}
      </div>
      {!providerStatus || providerStatus.providers.length === 0 ? (
        <div className={styles.empty}>{t("debug.noProviderStatus")}</div>
      ) : (
        <div className={styles.providerTable}>
          <div className={styles.providerHeader}>
            <span>{t("debug.provider")}</span>
            <span>{t("debug.indicator")}</span>
            <span>{t("debug.description")}</span>
          </div>
          {providerStatus.providers.map(({ name, indicator, description }) => (
            <div className={styles.providerEntry} key={name}>
              <span className={styles.providerName}>{name}</span>
              <span className={INDICATOR_CLASS(indicator, styles)}>
                {indicator.toUpperCase()}
              </span>
              <span className={styles.providerDescription}>{description}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

ProviderStatusSection.propTypes = {
  providerStatus: PropTypes.shape({
    fetchedAt: PropTypes.string,
    providers: PropTypes.arrayOf(PropTypes.shape({
      name: PropTypes.string,
      indicator: PropTypes.string,
      description: PropTypes.string,
    })),
  }),
};

const SERVICE_LABELS = {
  "tomorrow.io":        "Tomorrow.io",
  "mapbox":             "Mapbox",
  "locationiq":         "LocationIQ",
  "ipapi.co":           "ipapi.co",
  "sunrise-sunset.org": "sunrise-sunset.org",
};

const quotaClass = (count, limit, styles) => {
  if (!limit) return styles.quotaVal;
  if (count >= limit)           return styles.quotaErr;
  if (count >= limit * 0.8)     return styles.quotaWarn;
  return styles.quotaVal;
};

const fmtVal = (count, limit) =>
  limit ? `${count} / ${limit.toLocaleString()}` : String(count);

/**
 * Quota section — one table per service
 *
 * @param {object} props
 * @param {object} props.counters Counters from server
 * @returns {JSX.Element} Quota section
 */
const QuotaSection = ({ counters }) => {
  const { t } = useTranslation();
  if (!counters || Object.keys(counters).length === 0) {
    return (
      <div className={styles.section}>
        <div className={styles.sectionTitle}>{t("debug.quotas")}</div>
        <div className={styles.empty}>{t("debug.noRequestsYet")}</div>
      </div>
    );
  }

  return (
    <>
      {Object.entries(counters).map(([service, { quotas, endpoints }]) => {
        const label = SERVICE_LABELS[service] || service;
        const endpointList = Object.entries(endpoints);

        // Totals per period
        const total = { hour: 0, day: 0, month: 0 };
        endpointList.forEach(([, c]) => {
          total.hour  += c.hour;
          total.day   += c.day;
          total.month += c.month;
        });

        const showHour  = quotas.hour  != null;
        const showDay   = quotas.day   != null;
        const showMonth = quotas.month != null;

        return (
          <div className={styles.section} key={service}>
            <div className={styles.sectionTitle}>{t("debug.quota")} — {label.toUpperCase()}</div>
            <div className={styles.quotaTable}>
              <div className={styles.quotaHeader}>
                <span>{t("debug.endpoint")}</span>
                {showHour  && <span>{t("debug.thisHour")}</span>}
                {showDay   && <span>{t("debug.today")}</span>}
                {showMonth && <span>{t("debug.thisMonth")}</span>}
              </div>
              {endpointList.map(([ep, c]) => (
                <div className={styles.quotaEntry} key={ep}>
                  <span className={styles.quotaEndpoint}>{ep}</span>
                  {showHour  && <span className={quotaClass(c.hour,  quotas.hour,  styles)}>{fmtVal(c.hour,  null)}</span>}
                  {showDay   && <span className={quotaClass(c.day,   quotas.day,   styles)}>{fmtVal(c.day,   null)}</span>}
                  {showMonth && <span className={quotaClass(c.month, quotas.month, styles)}>{fmtVal(c.month, null)}</span>}
                </div>
              ))}
              {endpointList.length > 1 && (
                <div className={`${styles.quotaEntry} ${styles.quotaTotal}`}>
                  <span>{t("debug.total")}</span>
                  {showHour  && <span className={quotaClass(total.hour,  quotas.hour,  styles)}>{fmtVal(total.hour,  quotas.hour)}</span>}
                  {showDay   && <span className={quotaClass(total.day,   quotas.day,   styles)}>{fmtVal(total.day,   quotas.day)}</span>}
                  {showMonth && <span className={quotaClass(total.month, quotas.month, styles)}>{fmtVal(total.month, quotas.month)}</span>}
                </div>
              )}
              {endpointList.length === 1 && (
                <div className={`${styles.quotaEntry} ${styles.quotaTotal}`}>
                  <span>{t("debug.total")}</span>
                  {showHour  && <span className={quotaClass(total.hour,  quotas.hour,  styles)}>{fmtVal(total.hour,  quotas.hour)}</span>}
                  {showDay   && <span className={quotaClass(total.day,   quotas.day,   styles)}>{fmtVal(total.day,   quotas.day)}</span>}
                  {showMonth && <span className={quotaClass(total.month, quotas.month, styles)}>{fmtVal(total.month, quotas.month)}</span>}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
};

QuotaSection.propTypes = {
  counters: PropTypes.objectOf(PropTypes.shape({
    quotas: PropTypes.object,
    endpoints: PropTypes.object,
  })),
};

/**
 * Services section
 *
 * @param {object} props
 * @param {object} props.services Map of service name to status info
 * @returns {JSX.Element} Services section
 */
const SERVICE_ORDER = [
  "Tomorrow.io (current)",
  "Tomorrow.io (hourly)",
  "Tomorrow.io (daily)",
  "Mapbox",
  "LocationIQ",
  "ipapi.co",
  "sunrise-sunset.org",
];

const ServicesSection = ({ services }) => {
  const { t } = useTranslation();
  const entries = services
    ? SERVICE_ORDER
        .filter((k) => services[k])
        .map((k) => [k, services[k]])
        .concat(Object.entries(services).filter(([k]) => !SERVICE_ORDER.includes(k)))
    : [];
  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>{t("debug.services")}</div>
      {entries.length === 0 ? (
        <div className={styles.empty}>{t("debug.noServicesYet")}</div>
      ) : (
        <div className={styles.serviceTable}>
          <div className={styles.serviceHeader}>
            <span>{t("debug.service")}</span>
            <span>{t("debug.status")}</span>
            <span>{t("debug.lastCall")}</span>
            <span>{t("debug.comment")}</span>
          </div>
          {entries.map(([name, info]) => {
            const ok = info.status >= 200 && info.status < 300;
            const time = new Date(info.lastCall).toLocaleTimeString();
            return (
              <div className={styles.serviceEntry} key={name}>
                <span className={styles.serviceName}>{name}</span>
                <span className={ok ? styles.serviceStatusOk : styles.serviceStatusErr}>
                  {info.status}
                </span>
                <span className={styles.serviceTime}>{time}</span>
                <span className={styles.serviceComment}>{info.comment}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

ServicesSection.propTypes = {
  services: PropTypes.objectOf(PropTypes.shape({
    status: PropTypes.number,
    lastCall: PropTypes.string,
    comment: PropTypes.string,
  })),
};

/**
 * Cache section
 *
 * @param {object} props
 * @param {Array} props.cache List of cache entries
 * @returns {JSX.Element} Cache section
 */
const CacheSection = ({ cache }) => {
  const { t } = useTranslation();
  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>{t("debug.cache")}</div>
      {!cache || cache.length === 0 ? (
        <div className={styles.empty}>{t("debug.noCache")}</div>
      ) : (
        <div className={styles.cacheTable}>
          <div className={styles.cacheHeader}>
            <span>{t("debug.type")}</span>
            <span>{t("debug.lat")}</span>
            <span>{t("debug.lon")}</span>
            <span>{t("debug.ttl")}</span>
          </div>
          {cache.map((entry) => {
            const [type, lat, lon] = entry.key.split(":");
            return (
              <div className={styles.cacheEntry} key={entry.key}>
                <span className={styles.cacheType}>{type}</span>
                <span className={styles.cacheCoord}>{lat}</span>
                <span className={styles.cacheCoord}>{lon}</span>
                <span className={`${styles.cacheTtl} ${entry.expired ? styles.expired : ""}`}>
                  {entry.expired ? t("debug.expired") : `${entry.expiresIn}s`}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

CacheSection.propTypes = {
  cache: PropTypes.arrayOf(PropTypes.shape({
    key: PropTypes.string,
    expiresIn: PropTypes.number,
    expired: PropTypes.bool,
  })),
};

/**
 * Logs section
 *
 * @param {object} props
 * @param {Array} props.logs List of log lines
 * @returns {JSX.Element} Logs section
 */
const LogsSection = ({ logs }) => {
  const { t } = useTranslation();
  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>{t("debug.logs")}</div>
      <div className={styles.logBlock}>
        {!logs || logs.length === 0 ? (
          <span className={styles.empty}>{t("debug.noLogs")}</span>
        ) : (
          logs.map((line, i) => {
            let lineClass = styles.logLineDefault;
            if (line.includes("[cache]")) lineClass = styles.logLineCache;
            else if (line.includes("[security]")) lineClass = styles.logLineSecurity;
            return (
              <div key={i} className={lineClass}>{line}</div>
            );
          })
        )}
      </div>
    </div>
  );
};

LogsSection.propTypes = {
  logs: PropTypes.arrayOf(PropTypes.string),
};

function formatClientTime(ts) {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.getFullYear() === today.getFullYear()
    && d.getMonth() === today.getMonth()
    && d.getDate() === today.getDate();
  if (sameDay) return d.toLocaleTimeString();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${d.toLocaleTimeString()}`;
}

/**
 * Remote clients section — IP addresses that have connected since last restart
 *
 * @param {object} props
 * @param {Array} props.clients List of remote client entries
 * @returns {JSX.Element} Remote clients section
 */
const RemoteClientsSection = ({ clients }) => {
  const { t } = useTranslation();
  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>
        {t("debug.remoteClients")}
        {clients && clients.length > 0 && (
          <span className={styles.providerFetchedAt}> — {clients.length}</span>
        )}
      </div>
      {!clients || clients.length === 0 ? (
        <div className={styles.empty}>{t("debug.noRemoteClients")}</div>
      ) : (
        <div className={styles.serviceTable}>
          <div className={styles.serviceHeader}>
            <span>{t("debug.clientIp")}</span>
            <span>{t("debug.clientFirstSeen")}</span>
            <span>{t("debug.clientLastSeen")}</span>
            <span>{t("debug.clientRequests")}</span>
          </div>
          {clients.map((c) => (
            <div className={styles.serviceEntry} key={c.ip}>
              <span className={styles.serviceName}>{c.ip}</span>
              <span className={styles.serviceTime}>{formatClientTime(c.firstSeen)}</span>
              <span className={styles.serviceTime}>{formatClientTime(c.lastSeen)}</span>
              <span className={styles.serviceComment}>{c.requestCount}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

RemoteClientsSection.propTypes = {
  clients: PropTypes.arrayOf(PropTypes.shape({
    ip: PropTypes.string,
    firstSeen: PropTypes.number,
    lastSeen: PropTypes.number,
    requestCount: PropTypes.number,
  })),
};

/**
 * Security events section
 *
 * @param {object} props
 * @param {Array} props.events List of blocked request events
 * @returns {JSX.Element} Security events section
 */
const SecuritySection = ({ events }) => {
  const { t } = useTranslation();
  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>{t("debug.securityEvents")}</div>
      {!events || events.length === 0 ? (
        <div className={styles.empty}>{t("debug.noBlockedRequests")}</div>
      ) : (
        events.map((e, i) => (
          <div className={styles.securityEvent} key={i}>
            <span className={styles.securityEventHeader}>
              {e.method} {e.url}
            </span>
            <span className={styles.securityEventDetail}>
              {e.ip} — {e.time}
            </span>
          </div>
        ))
      )}
    </div>
  );
};

SecuritySection.propTypes = {
  events: PropTypes.arrayOf(PropTypes.shape({
    method: PropTypes.string,
    url: PropTypes.string,
    ip: PropTypes.string,
    time: PropTypes.string,
  })),
};

/**
 * Audit section
 *
 * @param {object} props
 * @param {String} props.audit npm audit log content
 * @returns {JSX.Element} Audit section
 */
const AuditSection = ({ audit }) => {
  const { t } = useTranslation();
  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>{t("debug.npmAudit")}</div>
      <div className={styles.auditBlock}>
        {audit || <span className={styles.empty}>{t("debug.notAvailable")}</span>}
      </div>
    </div>
  );
};

AuditSection.propTypes = {
  audit: PropTypes.string,
};

function exportDebugCsv(data, clientMetrics, fps) {
  const q = (val) => `"${String(val ?? "").replace(/"/g, '""')}"`;
  const rows = [];

  const section = (title) => {
    rows.push([]);
    rows.push([q(`=== ${title} ===`)]);
  };

  // Header
  rows.push([q("Generated at"), q(new Date().toLocaleString())]);
  if (data?.appVersion) {
    rows.push([q("App version"), q(`${data.appVersion.name} v${data.appVersion.version} · ${data.appVersion.commit}`)]);
    if (data.appVersion.branch) {
      rows.push([q("Branch"), q(data.appVersion.branch)]);
    }
  }
  if (data?.system) {
    rows.push([q("Hardware"), q(data.system.hardware)]);
    rows.push([q("OS"),       q(data.system.os)]);
  }
  if (data?.network) {
    const urls = data.network.urls?.length > 0
      ? data.network.urls.join(" | ")
      : `${data.network.protocol}://localhost:${data.network.port}`;
    rows.push([q("Server URLs"), q(urls)]);
  }
  if (data?.connectivity) {
    const status = data.connectivity.online
      ? `Online${data.connectivity.latencyMs != null ? ` (${data.connectivity.latencyMs}ms)` : ""}`
      : "Offline";
    rows.push([q("Internet"), q(status)]);
  }

  // Server KPIs
  section("SERVER KPIs");
  rows.push([q("METRIC"), q("VALUE")]);
  if (data?.serverKpis) {
    const kpis = data.serverKpis;
    const { rate } = kpis.cache;
    rows.push([q("Uptime"),             q(formatUptime(kpis.uptimeSec))]);
    rows.push([q("Heap Used (MB)"),     q(kpis.memory.heapUsedMb)]);
    rows.push([q("Heap Total (MB)"),    q(kpis.memory.heapTotalMb)]);
    rows.push([q("RSS (MB)"),           q(kpis.memory.rssMb)]);
    rows.push([q("Cache Hit Rate (%)"), q(rate !== null ? rate : "N/A")]);
    rows.push([q("Cache Hits"),         q(kpis.cache.hits)]);
    rows.push([q("Cache Misses"),       q(kpis.cache.misses)]);
  } else {
    rows.push([q("(no data)")]);
  }

  // Server Response Times
  if (data?.serverKpis?.responseTimes?.length > 0) {
    section("SERVER RESPONSE TIMES");
    rows.push([q("ENDPOINT"), q("COUNT"), q("AVG (ms)"), q("MIN (ms)"), q("MAX (ms)")]);
    data.serverKpis.responseTimes.forEach((r) => {
      rows.push([q(r.endpoint), q(r.count), q(r.avgMs), q(r.minMs), q(r.maxMs)]);
    });
  }

  // Client KPIs
  section("CLIENT KPIs");
  rows.push([q("METRIC"), q("VALUE")]);
  rows.push([q("Page Load (ms)"), q(clientMetrics?.pageLoad ?? "N/A")]);
  rows.push([q("FPS"),            q(fps ?? "N/A")]);
  if (clientMetrics?.heap) {
    rows.push([q("JS Heap Used (MB)"),  q(clientMetrics.heap.used)]);
    rows.push([q("JS Heap Total (MB)"), q(clientMetrics.heap.total)]);
  }

  // Client API Calls
  if (clientMetrics?.apiCalls?.length > 0) {
    section("CLIENT API CALLS (SESSION)");
    rows.push([q("ENDPOINT"), q("COUNT"), q("AVG (ms)"), q("MIN (ms)"), q("MAX (ms)")]);
    clientMetrics.apiCalls.forEach((r) => {
      rows.push([q(r.endpoint), q(r.count), q(r.avgMs), q(r.minMs), q(r.maxMs)]);
    });
  }

  // Provider Status
  if (data?.providerStatus?.providers?.length > 0) {
    section("PROVIDER STATUS");
    rows.push([q("PROVIDER"), q("INDICATOR"), q("DESCRIPTION")]);
    data.providerStatus.providers.forEach(({ name, indicator, description }) => {
      rows.push([q(name), q(indicator.toUpperCase()), q(description)]);
    });
  }

  // Services
  if (data?.services && Object.keys(data.services).length > 0) {
    section("SERVICES");
    rows.push([q("SERVICE"), q("STATUS"), q("LAST CALL"), q("COMMENT")]);
    Object.entries(data.services).forEach(([name, info]) => {
      rows.push([q(name), q(info.status), q(new Date(info.lastCall).toLocaleString()), q(info.comment)]);
    });
  }

  // Quotas
  if (data?.counters && Object.keys(data.counters).length > 0) {
    Object.entries(data.counters).forEach(([service, { quotas, endpoints }]) => {
      section(`QUOTAS — ${(SERVICE_LABELS[service] || service).toUpperCase()}`);
      const showHour  = quotas.hour  != null;
      const showDay   = quotas.day   != null;
      const showMonth = quotas.month != null;
      const headers = [q("ENDPOINT")];
      if (showHour)  headers.push(q("THIS HOUR"));
      if (showDay)   headers.push(q("TODAY"));
      if (showMonth) headers.push(q("THIS MONTH"));
      rows.push(headers);
      Object.entries(endpoints).forEach(([ep, c]) => {
        const row = [q(ep)];
        if (showHour)  row.push(q(c.hour));
        if (showDay)   row.push(q(c.day));
        if (showMonth) row.push(q(c.month));
        rows.push(row);
      });
    });
  }

  // Cache
  if (data?.cache?.length > 0) {
    section("CACHE");
    rows.push([q("TYPE"), q("LAT"), q("LON"), q("TTL (s)")]);
    data.cache.forEach((entry) => {
      const [type, lat, lon] = entry.key.split(":");
      rows.push([q(type), q(lat), q(lon), q(entry.expired ? "EXPIRED" : entry.expiresIn)]);
    });
  }

  // Remote Clients
  if (data?.remoteClients?.length > 0) {
    section("REMOTE CLIENTS");
    rows.push([q("IP ADDRESS"), q("FIRST SEEN"), q("LAST SEEN"), q("REQUESTS")]);
    data.remoteClients.forEach((c) => {
      rows.push([q(c.ip), q(new Date(c.firstSeen).toLocaleString()), q(new Date(c.lastSeen).toLocaleString()), q(c.requestCount)]);
    });
  }

  // Security Events
  if (data?.securityEvents?.length > 0) {
    section("SECURITY EVENTS");
    rows.push([q("METHOD"), q("URL"), q("IP"), q("TIME")]);
    data.securityEvents.forEach((e) => {
      rows.push([q(e.method), q(e.url), q(e.ip), q(e.time)]);
    });
  }

  // Logs
  if (data?.logs?.length > 0) {
    section("LOGS");
    rows.push([q("LINE")]);
    data.logs.forEach((line) => rows.push([q(line)]));
  }

  // UTF-8 BOM + sep hint for Excel compatibility (auto-detects comma delimiter)
  const csv = "\uFEFF" + "sep=,\r\n" + rows.map((r) => r.join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `weather-station-debug-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0 || d > 0) parts.push(`${h}h`);
  parts.push(`${m}m ${s}s`);
  return parts.join(" ");
}

/**
 * Server config section — environment variables and runtime configuration
 *
 * @param {object} props
 * @param {object} props.serverConfig Server environment config
 * @param {object} props.network Network info (for port)
 * @returns {JSX.Element} Server config section
 */
const ServerConfigSection = ({ serverConfig, network }) => {
  const { t } = useTranslation();
  if (!serverConfig) return null;

  const items = [
    { label: t("debug.allowRemote"), value: serverConfig.allowRemote, type: "bool" },
    { label: t("debug.debugMode"),   value: serverConfig.debug,        type: "bool" },
    { label: t("debug.nodeEnv"),     value: serverConfig.nodeEnv,      type: "str"  },
    { label: t("debug.nodeVersion"), value: serverConfig.nodeVersion,  type: "str"  },
    ...(network ? [{ label: "PORT", value: `${network.protocol?.toUpperCase()}:${network.port}`, type: "str" }] : []),
  ];

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>{t("debug.serverConfig")}</div>
      <div className={styles.configGrid}>
        {items.map(({ label, value, type }) => (
          <div className={styles.configItem} key={label}>
            <span className={styles.kpiLabel}>{label}</span>
            {type === "bool" ? (
              <span className={value ? styles.configEnabled : styles.configDisabled}>
                {value ? t("debug.enabled") : t("debug.disabled")}
              </span>
            ) : (
              <span className={styles.configValue}>{value ?? "—"}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

ServerConfigSection.propTypes = {
  serverConfig: PropTypes.shape({
    allowRemote: PropTypes.bool,
    debug: PropTypes.bool,
    nodeEnv: PropTypes.string,
    nodeVersion: PropTypes.string,
  }),
  network: PropTypes.shape({
    protocol: PropTypes.string,
    port: PropTypes.number,
  }),
};

/**
 * Server KPI section — uptime, memory, cache hit rate, response times
 *
 * @param {object} props
 * @param {object} props.serverKpis
 * @returns {JSX.Element} Server KPI section
 */
const ServerKpiSection = ({ serverKpis }) => {
  const { t } = useTranslation();
  const kpis = serverKpis;

  const hitRate = kpis?.cache?.rate;
  const hitRateClass = hitRate === null ? styles.kpiValue
    : hitRate >= 70 ? styles.kpiValueGood
    : hitRate >= 40 ? styles.kpiValueWarn
    : styles.kpiValueErr;

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>{t("debug.serverKpi")}</div>
      {!kpis ? (
        <div className={styles.empty}>{t("debug.loading")}</div>
      ) : (
        <>
          <div className={styles.kpiGrid}>
            <div className={styles.kpiItem}>
              <span className={styles.kpiLabel}>{t("debug.uptime")}</span>
              <span className={styles.kpiValue}>{formatUptime(kpis.uptimeSec)}</span>
            </div>
            <div className={styles.kpiItem}>
              <span className={styles.kpiLabel}>{t("debug.heapUsed")}</span>
              <span className={styles.kpiValue}>{kpis.memory.heapUsedMb} MB</span>
            </div>
            <div className={styles.kpiItem}>
              <span className={styles.kpiLabel}>{t("debug.heapTotal")}</span>
              <span className={styles.kpiValue}>{kpis.memory.heapTotalMb} MB</span>
            </div>
            <div className={styles.kpiItem}>
              <span className={styles.kpiLabel}>{t("debug.rss")}</span>
              <span className={styles.kpiValue}>{kpis.memory.rssMb} MB</span>
            </div>
            <div className={styles.kpiItem}>
              <span className={styles.kpiLabel}>{t("debug.cacheHitRate")}</span>
              <span className={hitRateClass}>
                {hitRate !== null ? `${hitRate}%` : "—"}
                {kpis.cache.hits + kpis.cache.misses > 0 && (
                  <span className={styles.kpiLabel} style={{ marginLeft: 6 }}>
                    ({kpis.cache.hits} {t("debug.hits")} / {kpis.cache.misses} {t("debug.misses")})
                  </span>
                )}
              </span>
            </div>
          </div>

          {kpis.responseTimes.length > 0 && (
            <>
              <div className={styles.kpiLabel} style={{ marginBottom: 4 }}>{t("debug.responseTimes")}</div>
              <div className={styles.rtTable}>
                <div className={styles.rtHeader}>
                  <span>ENDPOINT</span>
                  <span>{t("debug.count")}</span>
                  <span>{t("debug.avgMs")}</span>
                  <span>{t("debug.minMs")}</span>
                  <span>{t("debug.maxMs")}</span>
                </div>
                {kpis.responseTimes.map((r) => (
                  <div className={styles.rtEntry} key={r.endpoint}>
                    <span className={styles.rtEndpoint}>{r.endpoint}</span>
                    <span className={styles.rtCount}>{r.count}</span>
                    <span className={styles.rtAvg}>{r.avgMs}ms</span>
                    <span className={styles.rtMinmax}>{r.minMs}ms</span>
                    <span className={styles.rtMinmax}>{r.maxMs}ms</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
};

ServerKpiSection.propTypes = {
  serverKpis: PropTypes.shape({
    uptimeSec: PropTypes.number,
    memory: PropTypes.shape({
      heapUsedMb: PropTypes.number,
      heapTotalMb: PropTypes.number,
      rssMb: PropTypes.number,
    }),
    cache: PropTypes.shape({
      hits: PropTypes.number,
      misses: PropTypes.number,
      rate: PropTypes.number,
    }),
    responseTimes: PropTypes.array,
  }),
};

/**
 * Client KPI section — page load, FPS, API call durations, JS heap
 *
 * @param {object} props
 * @param {number|null} props.fps Measured FPS (null while measuring)
 * @param {Function} props.setFps FPS state setter
 * @param {object|null} props.clientMetrics Collected client metrics
 * @param {Function} props.setClientMetrics Client metrics state setter
 * @returns {JSX.Element} Client KPI section
 */
const ClientKpiSection = ({ fps, setFps, clientMetrics, setClientMetrics }) => {
  const { t } = useTranslation();
  const rafRef = useRef(null);

  useEffect(() => {
    // Page load time
    const [navEntry] = performance.getEntriesByType("navigation");
    const pageLoad = navEntry ? Math.round(navEntry.loadEventEnd) : null;

    // JS heap (Chrome / Electron only)
    const heap = performance.memory
      ? {
          used: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024),
          total: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024),
        }
      : null;

    // API calls from Resource Timing
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

    setClientMetrics({ pageLoad, heap, apiCalls });

    // FPS measurement over ~1 second
    let frames = 0;
    const startTime = performance.now();
    const tick = (ts) => {
      frames++;
      if (ts - startTime >= 1000) {
        setFps(Math.round((frames * 1000) / (ts - startTime)));
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fpsClass = fps === null ? styles.kpiValue
    : fps >= 50 ? styles.kpiValueGood
    : fps >= 30 ? styles.kpiValueWarn
    : styles.kpiValueErr;

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>{t("debug.clientKpi")}</div>
      <div className={styles.kpiGrid}>
        <div className={styles.kpiItem}>
          <span className={styles.kpiLabel}>{t("debug.pageLoad")}</span>
          <span className={styles.kpiValue}>
            {clientMetrics?.pageLoad != null ? `${clientMetrics.pageLoad}ms` : "—"}
          </span>
        </div>
        <div className={styles.kpiItem}>
          <span className={styles.kpiLabel}>{t("debug.fps")}</span>
          <span className={fpsClass}>{fps !== null ? fps : "…"}</span>
        </div>
        {clientMetrics?.heap && (
          <div className={styles.kpiItem}>
            <span className={styles.kpiLabel}>{t("debug.jsHeap")}</span>
            <span className={styles.kpiValue}>{clientMetrics.heap.used} / {clientMetrics.heap.total} MB</span>
          </div>
        )}
      </div>

      <div className={styles.kpiLabel} style={{ marginBottom: 4 }}>{t("debug.apiCallsSession")}</div>
      {!clientMetrics || clientMetrics.apiCalls.length === 0 ? (
        <div className={styles.empty}>{t("debug.noApiCalls")}</div>
      ) : (
        <div className={styles.rtTable}>
          <div className={styles.rtHeader}>
            <span>ENDPOINT</span>
            <span>{t("debug.count")}</span>
            <span>{t("debug.avgMs")}</span>
            <span>{t("debug.minMs")}</span>
            <span>{t("debug.maxMs")}</span>
          </div>
          {clientMetrics.apiCalls.map((r) => (
            <div className={styles.rtEntry} key={r.endpoint}>
              <span className={styles.rtEndpoint}>{r.endpoint}</span>
              <span className={styles.rtCount}>{r.count}</span>
              <span className={styles.rtAvg}>{r.avgMs}ms</span>
              <span className={styles.rtMinmax}>{r.minMs}ms</span>
              <span className={styles.rtMinmax}>{r.maxMs}ms</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

ClientKpiSection.propTypes = {
  fps: PropTypes.number,
  setFps: PropTypes.func.isRequired,
  clientMetrics: PropTypes.shape({
    pageLoad: PropTypes.number,
    heap: PropTypes.shape({
      used: PropTypes.number,
      total: PropTypes.number,
    }),
    apiCalls: PropTypes.array,
  }),
  setClientMetrics: PropTypes.func.isRequired,
};
