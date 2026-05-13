import React, { useContext, useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import styles from "./styles.css";
import { AppContext } from "~/AppContext";
import useDragScroll from "~/hooks/useDragScroll";
import { CSSTransition } from "react-transition-group";
import { InlineIcon } from "@iconify/react";
import closeSharp from "@iconify/icons-ion/close-sharp";
import refreshIcon from "@iconify/icons-carbon/renew";
import downloadIcon from "@iconify/icons-carbon/download";
import upgradeIcon from "@iconify/icons-carbon/upgrade";
import PropTypes from "prop-types";
import axios from "axios";
import "!style-loader!css-loader!./animations.css";

// Font-size zoom for the debug overlay. Reuses the global fontSize setting
// (s/m/l) but with its own scale: the historical compact appearance is "s"
// (1.0×) so existing users see no change, and m/l bump up for readability
// on the 7" touchscreen. Different from the InfoPanel scale (0.85/1.0/1.15)
// because the debug panel's clamp() font sizes are already tuned tight.
const DEBUG_FONT_ZOOM = { s: 1.0, m: 1.15, l: 1.30 };

/**
 * Debug panel — localhost only, visible when DEBUG=true server-side
 *
 * @returns {JSX.Element} Debug panel
 */
const Debug = () => {
  const { debugMenuOpen, setDebugMenuOpen, setUpdateAvailable, setLatestVersion, refreshUpdateCheck, fontSize } = useContext(AppContext);
  const debugZoom = DEBUG_FONT_ZOOM[fontSize] || 1.0;
  const { t } = useTranslation();
  // On small screens, the debug panel takes the full viewport width (covering
  // the InfoPanel) so cramped data tables get every available pixel. The
  // built-in close button (X, top-right) stays accessible — it sits in the
  // panel itself, not on the InfoPanel — so closing the overlay still works.
  // Same breakpoint as the chart-tabs / panel-toggle features.
  const [isSmallScreen, setIsSmallScreen] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-height: 520px)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-height: 520px)");
    const handler = (e) => setIsSmallScreen(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  // Right gutter reserved for the InfoPanel + ControlButtons. Collapsed to 0
  // on small screens for the full-width takeover described above. The base
  // 300 + 20 px padding matches the App grid column at the default fontSize
  // M, and scales with fontSize so the gutter stays in lockstep with the
  // InfoPanel's own width (255 / 300 / 345 for S / M / L). Previously hard-
  // coded to 320, which left Debug overlapping the InfoPanel by 25 px at L
  // and leaving a 65 px gap at S — symmetric to the issue we fixed in CSS
  // for the same panel, except the inline width here was overriding the CSS
  // rule, so the CSS-only fix had no effect.
  const PANEL_BASE_WIDTH = 300;
  const panelWidthZoom = { s: 0.85, m: 1.0, l: 1.15 }[fontSize] || 1.0;
  const panelWidthPx = Math.round(PANEL_BASE_WIDTH * panelWidthZoom);
  const rightGutter = isSmallScreen ? 0 : panelWidthPx + 20;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [fps, setFps] = useState(null);
  const [clientMetrics, setClientMetrics] = useState(null);
  // Live CPU temperature, refreshed every 5 s while the panel is open via
  // a tiny /api/debug/cpu-temp endpoint. Initial value comes from the
  // full /api/debug response so there's no "—" flash on first paint.
  const [cpuTemp, setCpuTemp] = useState(null);
  // Live fan speed, same pattern as cpuTemp. The full /api/debug response
  // includes the value in serverKpis.fanRpm; the lightweight endpoint also
  // tells us whether a fan sensor is exposed at all (`available: false` →
  // hide the row entirely, same UX as the brightness slider).
  const [fanRpm, setFanRpm] = useState(null);
  const [fanAvailable, setFanAvailable] = useState(null); // null = unknown, bool once probed
  const contentScrollRef = useDragScroll();

  const fetchDebugInfo = useCallback(() => {
    setLoading(true);
    axios
      .get("/api/debug")
      .then((res) => {
        setData(res.data);
        const { updateInfo } = res.data;
        if (updateInfo) {
          setUpdateAvailable(updateInfo.updateAvailable ?? false);
          setLatestVersion(updateInfo.latestVersion ?? null);
        }
        if (res.data?.serverKpis?.cpuTempC !== undefined) {
          setCpuTemp(res.data.serverKpis.cpuTempC);
        }
        if (res.data?.serverKpis?.fanRpm !== undefined) {
          // Initial seed from the full debug payload — the per-tick
          // endpoint then keeps it fresh and confirms availability.
          setFanRpm(res.data.serverKpis.fanRpm);
        }
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [setUpdateAvailable, setLatestVersion]);

  const forceUpdateCheck = useCallback(() => {
    setCheckingUpdate(true);
    // refreshUpdateCheck(true) hits /api/update-check/force and propagates
    // every relevant field — including changedDeployFiles and
    // needsManualUpgrade — into AppContext, so an UpdateModal already open
    // re-renders with fresh data instead of staying stuck on the stale
    // pre-refresh state.
    refreshUpdateCheck(true)
      .then(() => axios.get("/api/debug"))
      .then((res) => setData(res.data))
      .catch((_err) => _err)
      .finally(() => setCheckingUpdate(false));
  }, [refreshUpdateCheck]);

  useEffect(() => {
    if (debugMenuOpen) fetchDebugInfo();
  }, [debugMenuOpen, fetchDebugInfo]);

  // Live CPU temperature poll — only runs while the debug panel is open.
  // 5 s interval is plenty: temperature changes slowly and a more aggressive
  // poll would burn cycles for no human-perceptible benefit.
  useEffect(() => {
    if (!debugMenuOpen) return undefined;
    const fetchCpuTemp = () => {
      axios.get("/api/debug/cpu-temp")
        .then((res) => setCpuTemp(res.data.cpuTempC))
        .catch(() => { /* non-critical — keep previous value */ });
    };
    const interval = setInterval(fetchCpuTemp, 5000);
    return () => clearInterval(interval);
  }, [debugMenuOpen]);

  // Live fan-speed poll — same cadence as CPU temp. The endpoint also
  // tells us whether a fan sensor is exposed at all so we can hide the
  // row entirely on Pis without an Active Cooler, x86 without an
  // exposed fan, and macOS dev machines.
  useEffect(() => {
    if (!debugMenuOpen) return undefined;
    const fetchFan = () => {
      axios.get("/api/debug/fan-speed")
        .then((res) => {
          setFanAvailable(Boolean(res.data?.available));
          if (res.data?.available) setFanRpm(res.data.rpm);
        })
        .catch(() => { /* non-critical — keep previous value */ });
    };
    fetchFan();
    const interval = setInterval(fetchFan, 5000);
    return () => clearInterval(interval);
  }, [debugMenuOpen]);

  return (
    <CSSTransition
      in={debugMenuOpen}
      unmountOnExit
      timeout={300}
      classNames="animate-debug"
    >
      <div
        className={styles.container}
        style={{
          zoom: debugZoom,
          height: `calc((100vh - 20px) / ${debugZoom})`,
          width: `calc((100vw - ${rightGutter}px) / ${debugZoom})`,
        }}
      >
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
                  {data.system.hostname && (
                    <span className={styles.systemHostname}>{data.system.hostname}</span>
                  )}
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
          <div
            className={styles.checkUpdateButton}
            onClick={forceUpdateCheck}
          >
            <span className={styles.refreshIcon}>
              <InlineIcon icon={upgradeIcon} />
            </span>
            {checkingUpdate ? t("debug.checking") : t("debug.checkUpdate")}
          </div>
        </div>

        <div className={styles.content} ref={contentScrollRef}>
          <div className={styles.columns}>
            <ServerConfigSection serverConfig={data?.serverConfig} network={data?.network} />
            <ServerKpiSection serverKpis={data?.serverKpis} cpuTemp={cpuTemp} fanRpm={fanRpm} fanAvailable={fanAvailable} />
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
            <RemoteClientsSection clients={data?.remoteClients} />
            <SecuritySection events={data?.securityEvents} />
            <RadarSnapshotsSection snapshots={data?.radarSnapshots} />
          </div>
          <LogsSection logs={data?.logs} />
          <VulnerabilityScanSection url={data?.vulnerabilityScanUrl} />
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
 * @param {object} props.providerStatus Snapshot returned by `/api/debug` containing `fetchedAt` (ISO timestamp of when the bundle was assembled) and `providers` (array of `{name, indicator, description, lastFetch}` per provider).
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
  "RainViewer (analyzer)",
  "RainViewer (risk)",
  "Claude (AI summary)",
  "Homebridge",
  "Environment Canada (AQHI)",
  "MELCC RSQAQ (Quebec)",
  "MELCC RSQA (Montreal)",
  "EPA AirNow",
  "OpenAQ",
  "NWS (severe weather alerts)",
  "Environment Canada (severe weather alerts)",
];

/**
 * Services panel section — renders the per-service "last call" status
 * stripe (one row per upstream: Tomorrow.io, Mapbox, LocationIQ, etc.)
 * with HTTP code, timestamp, and a free-form comment from the server's
 * recordServiceCall() helper. Entries are ordered by SERVICE_ORDER (the
 * canonical display order), with any unknown service names appended
 * after — that way a newly-added upstream shows up at the bottom even
 * if SERVICE_ORDER hasn't been updated to include it yet.
 *
 * @param {object} props Component props
 * @param {object} [props.services] Map of service name to
 *   `{ status, lastCallAt, comment }` payload. Empty / undefined →
 *   render the "no calls yet" placeholder.
 * @returns {JSX.Element} Services section
 */
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
            // Pre-registered (never-called) entries have status === null and
            // lastCall === null. Render them with a neutral "—" instead of
            // the error-red badge that NaN/null would otherwise produce.
            const neverCalled = info.status == null;
            const ok = !neverCalled && info.status >= 200 && info.status < 300;
            const statusClass = neverCalled
              ? styles.serviceName
              : ok ? styles.serviceStatusOk : styles.serviceStatusErr;
            const time = info.lastCall ? new Date(info.lastCall).toLocaleTimeString() : "—";
            return (
              <div className={styles.serviceEntry} key={name}>
                <span className={styles.serviceName}>{name}</span>
                <span className={statusClass}>
                  {neverCalled ? "—" : info.status}
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
              <span className={styles.serviceName}>
                {c.ip}
                {c.hostname && c.hostname !== c.ip && (
                  <span className={styles.clientHostname}>{c.hostname}</span>
                )}
              </span>
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
 * Recent radar-snapshot section — shows the exact `radarText` block the
 * AI-summary controller passed to Claude (or to the calm-day fast-path
 * template) along with the resulting summary, so a maintainer can
 * compare what the analyzer detected against what the narrative said.
 * Useful when a summary's radar paragraph seems to disagree with what
 * the user sees on the radar map. Snapshots are kept in a server-side
 * ring buffer (capped at 10), newest first.
 *
 * @param {Object} props
 * @param {Array} [props.snapshots] Recent snapshot entries from the server
 * @returns {JSX.Element} Section
 */
/**
 * Format a single snapshot as plain text for clipboard copy. Multi-line
 * radarText and summary are preserved (newlines kept). The header line
 * mirrors the rendered <summary>.
 *
 * @param {Object} s Snapshot entry
 * @returns {String} Plain-text rendering
 */
const formatSnapshotForCopy = (s) => {
  const header = `[${new Date(s.ts).toLocaleString()}] ${s.lat?.toFixed(4)}, ${s.lon?.toFixed(4)} · ${s.lang} · ${s.source}`;
  return `${header}\n\n--- Radar text passed to Claude ---\n${s.radarText}\n\n--- Resulting summary ---\n${s.summary}\n`;
};

/**
 * Trigger a download of the given content as a file. Used for the
 * section-level JSON export.
 *
 * @param {String} filename Suggested filename
 * @param {String} content File contents (UTF-8 text)
 * @param {String} mime MIME type (defaults to application/json)
 */
const downloadTextFile = (filename, content, mime = "application/json") => {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const RadarSnapshotsSection = ({ snapshots }) => {
  const { t } = useTranslation();
  // Per-snapshot "copied!" feedback — keyed by index, cleared after 1.5s.
  // Lives in component state because a single shared flag would race when
  // the user clicks multiple Copy buttons in quick succession.
  const [copiedIndex, setCopiedIndex] = useState(null);

  const handleCopy = useCallback(async (s, i) => {
    try {
      await navigator.clipboard.writeText(formatSnapshotForCopy(s));
      setCopiedIndex(i);
      setTimeout(() => setCopiedIndex((current) => (current === i ? null : current)), 1500);
    } catch {
      // Clipboard API requires a secure context and user gesture; both are
      // satisfied here (localhost = secure, click = gesture). The catch is
      // just defensive — leave the button silent on failure.
    }
  }, []);

  const handleExportJson = useCallback(() => {
    const payload = JSON.stringify(snapshots, null, 2);
    const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
    downloadTextFile(`radar-snapshots-${stamp}.json`, payload);
  }, [snapshots]);

  const hasAny = Array.isArray(snapshots) && snapshots.length > 0;

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitleRow}>
        <div className={styles.sectionTitle}>{t("debug.radarSnapshots")}</div>
        {hasAny && (
          <button
            type="button"
            className={styles.radarSnapshotExportButton}
            onClick={handleExportJson}
            title={t("debug.radarSnapshotExportTitle")}
          >
            {t("debug.radarSnapshotExport")}
          </button>
        )}
      </div>
      {!hasAny ? (
        <div className={styles.empty}>{t("debug.noRadarSnapshots")}</div>
      ) : (
        snapshots.map((s, i) => (
          <details className={styles.radarSnapshot} key={i}>
            <summary className={styles.radarSnapshotHeader}>
              <span className={styles.radarSnapshotTime}>{new Date(s.ts).toLocaleString()}</span>
              {" — "}
              <span className={styles.radarSnapshotLoc}>{s.lat?.toFixed(2)}, {s.lon?.toFixed(2)}</span>
              {" · "}
              <span className={styles.radarSnapshotLang}>{s.lang}</span>
              {" · "}
              <span className={styles.radarSnapshotSource}>{s.source}</span>
            </summary>
            <div className={styles.radarSnapshotBody}>
              <button
                type="button"
                className={styles.radarSnapshotCopyButton}
                onClick={() => handleCopy(s, i)}
              >
                {copiedIndex === i ? t("debug.radarSnapshotCopied") : t("debug.radarSnapshotCopy")}
              </button>
              <div className={styles.radarSnapshotLabel}>{t("debug.radarSnapshotInput")}</div>
              <pre className={styles.radarSnapshotPre}>{s.radarText}</pre>
              <div className={styles.radarSnapshotLabel}>{t("debug.radarSnapshotOutput")}</div>
              <pre className={styles.radarSnapshotPre}>{s.summary}</pre>
            </div>
          </details>
        ))
      )}
    </div>
  );
};

RadarSnapshotsSection.propTypes = {
  snapshots: PropTypes.arrayOf(PropTypes.shape({
    ts: PropTypes.number,
    lat: PropTypes.number,
    lon: PropTypes.number,
    lang: PropTypes.string,
    source: PropTypes.string,
    radarText: PropTypes.string,
    summary: PropTypes.string,
  })),
};

/**
 * Vulnerability scan section — replaces the old npm-audit.log dump (which
 * was a snapshot from the last `install.sh` run, going stale immediately).
 * Vulnerability scanning + automatic security PRs now live on GitHub via
 * Dependabot (see PR #22 / `.github/dependabot.yml`); this section just
 * points the user at the live source of truth.
 *
 * @param {object} props
 * @param {String} [props.url] Repo-aware Dependabot alerts URL built server-side
 * @returns {JSX.Element} Vulnerability scan section
 */
const VulnerabilityScanSection = ({ url }) => {
  const { t } = useTranslation();
  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>{t("debug.vulnerabilityScan")}</div>
      <div className={styles.vulnScanNotice}>
        <p className={styles.vulnScanText}>{t("debug.vulnerabilityScanNotice")}</p>
        {url && (
          <a href={url} target="_blank" rel="noopener noreferrer" className={styles.vulnScanLink}>
            {url}
          </a>
        )}
      </div>
    </div>
  );
};

VulnerabilityScanSection.propTypes = {
  url: PropTypes.string,
};

/* eslint-disable-next-line jsdoc/require-jsdoc -- existing helper, signature unchanged; exported so v3 DebugPanel can reuse the same CSV format without duplicating the row layout. */
export function exportDebugCsv(data, clientMetrics, fps) {
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
    rows.push([q("CPU Temp (°C)"),      q(kpis.cpuTempC != null ? kpis.cpuTempC : "N/A")]);
    rows.push([q("Fan Speed (RPM)"),    q(kpis.fanRpm != null ? kpis.fanRpm : "N/A")]);
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

  // Radar Snapshots — flatten radarText/summary onto single lines so each
  // snapshot fits one CSV row. Newlines in the source are joined with " | ".
  if (data?.radarSnapshots?.length > 0) {
    section("RADAR SNAPSHOTS");
    rows.push([q("TIME"), q("LAT"), q("LON"), q("LANG"), q("SOURCE"), q("RADAR INPUT"), q("SUMMARY")]);
    data.radarSnapshots.forEach((s) => {
      const flat = (str) => (str || "").replace(/\r?\n/g, " | ");
      rows.push([
        q(new Date(s.ts).toLocaleString()),
        q(s.lat?.toFixed(4)),
        q(s.lon?.toFixed(4)),
        q(s.lang),
        q(s.source),
        q(flat(s.radarText)),
        q(flat(s.summary)),
      ]);
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
    { label: serverConfig.initManager?.toUpperCase() ?? t("debug.systemd"), value: !!serverConfig.initManager, type: "bool" },
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
    initManager: PropTypes.oneOf(["systemd", "launchd", null]),
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
 * @param {object} props.serverKpis Snapshot from `/api/debug` containing process metrics: uptime (seconds), memory (`heapUsed`/`heapTotal`/`rss` in bytes), cache hits/misses + ratio, per-endpoint response time aggregates, hardware model, network URLs.
 * @param {number|null} props.cpuTemp Live CPU temperature in °C
 * @param {number|null} props.fanRpm Live fan speed in raw RPM (0 valid)
 * @param {boolean|null} props.fanAvailable Whether a fan sensor is exposed
 * @returns {JSX.Element} Server KPI section
 */
const ServerKpiSection = ({ serverKpis, cpuTemp, fanRpm, fanAvailable }) => {
  const { t } = useTranslation();
  const kpis = serverKpis;

  const hitRate = kpis?.cache?.rate;
  const hitRateClass = hitRate === null ? styles.kpiValue
    : hitRate >= 70 ? styles.kpiValueGood
    : hitRate >= 40 ? styles.kpiValueWarn
    : styles.kpiValueErr;

  // CPU temp thresholds: green up to 60°C (comfortable), orange 60–75°C
  // (hot, system still healthy), red above 75°C (close to Pi 4 throttling
  // at ~80–85°C). null/undefined → grey neutral (no sensor available).
  const cpuTempClass = cpuTemp == null ? styles.kpiValue
    : cpuTemp < 60 ? styles.kpiValueGood
    : cpuTemp < 75 ? styles.kpiValueWarn
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
            {cpuTemp != null && (
              <div className={styles.kpiItem}>
                <span className={styles.kpiLabel}>{t("debug.cpuTemp")}</span>
                <span className={cpuTempClass}>
                  {`${cpuTemp.toFixed(1)}°C`}
                </span>
              </div>
            )}
            {fanAvailable && (
              <div className={styles.kpiItem}>
                <span className={styles.kpiLabel}>{t("debug.fanSpeed")}</span>
                <span className={styles.kpiValue}>
                  {fanRpm != null ? `${fanRpm} RPM` : "—"}
                </span>
              </div>
            )}
          </div>

          {kpis.powerStatus?.available && (
            <PowerStatusRow powerStatus={kpis.powerStatus} />
          )}

          {kpis.radarCompression && (
            <RadarCompressionRow stats={kpis.radarCompression} />
          )}

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
  fanRpm: PropTypes.number,
  fanAvailable: PropTypes.bool,
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
    powerStatus: PropTypes.object,
    cpuTempC: PropTypes.number,
    fanRpm: PropTypes.number,
  }),
  cpuTemp: PropTypes.number,
};

const POWER_FLAGS = ["underVoltage", "freqCapped", "throttled", "tempLimit"];
const POWER_CRITICAL = ["underVoltage", "throttled"];

/**
 * Power status row — Pi-only, shows current and since-boot throttle flags.
 *
 * @param {object} props
 * @param {object} props.powerStatus Power status from vcgencmd get_throttled
 * @returns {JSX.Element} Power status row
 */
const PowerStatusRow = ({ powerStatus }) => {
  const { t } = useTranslation();

  const anyCurrentIssue  = POWER_FLAGS.some((f) => powerStatus.current[f]);
  const anyOccurredIssue = POWER_FLAGS.some((f) => powerStatus.occurred[f]);

  const flagLabel = (flag) => {
    const key = flag === "throttled" ? "debug.throttledStatus" : `debug.${flag}`;
    return t(key);
  };

  return (
    <div className={styles.kpiItem} style={{ gridColumn: "1 / -1", marginBottom: "10px" }}>
      <span className={styles.kpiLabel}>{t("debug.powerStatus")}</span>
      <span className={styles.powerRow}>
        {!anyCurrentIssue ? (
          <span className={styles.powerBadgeOk}>{t("debug.powerOk")}</span>
        ) : (
          POWER_FLAGS.filter((f) => powerStatus.current[f]).map((f) => (
            <span key={f} className={POWER_CRITICAL.includes(f) ? styles.powerBadgeErr : styles.powerBadgeWarn}>
              {flagLabel(f)}
            </span>
          ))
        )}
        {anyOccurredIssue && (
          <span className={styles.powerSinceBoot}>
            {t("debug.sinceReboot")}: {POWER_FLAGS.filter((f) => powerStatus.occurred[f]).map(flagLabel).join(", ")}
          </span>
        )}
      </span>
    </div>
  );
};

PowerStatusRow.propTypes = {
  powerStatus: PropTypes.shape({
    raw: PropTypes.string,
    current: PropTypes.object,
    occurred: PropTypes.object,
  }).isRequired,
};

/**
 * Radar prompt-compression KPI — measures the character-count reduction
 * between the legacy "list every direction × distance" baseline and the
 * current hierarchical compression on every radar frame the AI summary
 * processes. Hidden until at least one measurement has been recorded
 * (server returns null in that case).
 *
 * Inline export button writes the detailed Markdown report to
 * `report/radar-compression-{timestamp}.md` on the server. Latched to a
 * 2-second "Exporté !" confirmation, same UX as the kpi-copy button.
 *
 * @param {object} props
 * @param {object} props.stats Compression stats payload — `{ count, avgPct, minPct, maxPct, startedAt }` shape returned by `compressionStats.getStats()` server-side.
 * @returns {JSX.Element} Radar compression row
 */
const RadarCompressionRow = ({ stats }) => {
  const { t } = useTranslation();
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState(null);

  const handleExport = () => {
    if (exporting) return;
    setExporting(true);
    axios.post("/api/debug/radar-compression-report")
      .then((res) => {
        setExportMsg(res.data?.path || t("debug.radarCompressionExported"));
        setTimeout(() => setExportMsg(null), 4000);
      })
      .catch((err) => {
        setExportMsg(`✗ ${err?.response?.data?.message || err.message || "error"}`);
        setTimeout(() => setExportMsg(null), 4000);
      })
      .finally(() => setExporting(false));
  };

  return (
    <div className={styles.kpiItem} style={{ gridColumn: "1 / -1", marginBottom: "10px" }}>
      <span className={styles.kpiLabel}>{t("debug.radarCompression")}</span>
      <span className={styles.kpiValue}>
        {`${stats.avgPct.toFixed(0)} % ${t("debug.radarCompressionAvg")} · ${stats.count} ${t("debug.radarCompressionFrames")} · ${stats.minPct.toFixed(0)}-${stats.maxPct.toFixed(0)} %`}
        <button
          className={styles.kpiCopyBtn}
          onClick={handleExport}
          disabled={exporting}
          title={t("debug.radarCompressionExport")}
        >
          {exporting ? "…" : t("debug.radarCompressionExport")}
        </button>
        {exportMsg && (
          <span style={{ marginLeft: 8, fontSize: "0.85em", opacity: 0.8 }}>
            {exportMsg}
          </span>
        )}
      </span>
    </div>
  );
};

RadarCompressionRow.propTypes = {
  stats: PropTypes.shape({
    count: PropTypes.number.isRequired,
    avgPct: PropTypes.number.isRequired,
    minPct: PropTypes.number.isRequired,
    maxPct: PropTypes.number.isRequired,
    startedAt: PropTypes.number,
  }).isRequired,
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
  const { currentMapZoom, mapGeo, aqhiInfo } = useContext(AppContext);
  const rafRef = useRef(null);
  const [coordsCopied, setCoordsCopied] = useState(false);

  // Format the active map position as "lat, lon" with 6-decimal precision
  // (about 11 cm at the equator — far more than the radar analyzer needs,
  // but matches what the InfoPanel header shows on hover before reverse
  // geocoding kicks in). Returns null when mapGeo isn't ready yet so the
  // row hides cleanly.
  const coordsString = mapGeo
    ? `${mapGeo.latitude.toFixed(6)}, ${mapGeo.longitude.toFixed(6)}`
    : null;

  const copyCoords = useCallback(() => {
    if (!coordsString) return;
    navigator.clipboard.writeText(coordsString).then(() => {
      setCoordsCopied(true);
      setTimeout(() => setCoordsCopied(false), 2000);
    }).catch(() => { /* clipboard API may be blocked — silent fail */ });
  }, [coordsString]);

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

    const screen = {
      width: window.screen.width,
      height: window.screen.height,
      dpr: window.devicePixelRatio || 1,
    };

    setClientMetrics({ pageLoad, heap, apiCalls, screen });

    // Rolling FPS: average over a 2-second sliding window, updated every second.
    // Delayed 500ms so React has finished its initial render burst.
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- initialization, runs once on mount

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
        {clientMetrics?.screen && (
          <div className={styles.kpiItem}>
            <span className={styles.kpiLabel}>{t("debug.screenResolution")}</span>
            <span className={styles.kpiValue}>
              {clientMetrics.screen.width}×{clientMetrics.screen.height}
              {clientMetrics.screen.dpr !== 1 && (
                <span className={styles.kpiLabel} style={{ marginLeft: 6 }}>
                  @{clientMetrics.screen.dpr}×
                </span>
              )}
            </span>
          </div>
        )}
        {clientMetrics?.heap && (
          <div className={styles.kpiItem}>
            <span className={styles.kpiLabel}>{t("debug.jsHeap")}</span>
            <span className={styles.kpiValue}>{clientMetrics.heap.used} / {clientMetrics.heap.total} MB</span>
          </div>
        )}
        <div className={styles.kpiItem}>
          <span className={styles.kpiLabel}>{t("debug.mapZoom")}</span>
          <span className={styles.kpiValue}>{currentMapZoom != null ? currentMapZoom : "—"}</span>
        </div>
        {coordsString && (
          <div className={styles.kpiItem}>
            <span className={styles.kpiLabel}>{t("debug.mapCoords")}</span>
            <span className={styles.kpiValue}>
              {coordsString}
              <button
                type="button"
                onClick={copyCoords}
                className={styles.kpiCopyBtn}
                title={t("update.copy")}
              >
                {coordsCopied ? t("update.copied") : t("update.copy")}
              </button>
            </span>
          </div>
        )}
        {aqhiInfo && (
          <div className={styles.kpiItem}>
            <span className={styles.kpiLabel}>{t("debug.aqiSource")}</span>
            <span className={styles.kpiValue}>
              {aqhiInfo.stationName} — {aqhiInfo.stationDistanceKm} km — {t(aqhiInfo.kind === "forecast" ? "badges.aqiKindForecast" : aqhiInfo.kind === "nowcast" ? "badges.aqiKindNowcast" : "badges.aqiKindObservation")} — {(aqhiInfo.scale || "aqhi").toUpperCase()} {aqhiInfo.scale === "aqhi" ? Number(aqhiInfo.value).toFixed(1) : Math.round(Number(aqhiInfo.value))}
            </span>
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
    screen: PropTypes.shape({
      width: PropTypes.number,
      height: PropTypes.number,
      dpr: PropTypes.number,
    }),
    heap: PropTypes.shape({
      used: PropTypes.number,
      total: PropTypes.number,
    }),
    apiCalls: PropTypes.array,
  }),
  setClientMetrics: PropTypes.func.isRequired,
};
