import React, { useContext, useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import styles from "./styles.css";
import { AppContext } from "~/AppContext";
import { CSSTransition } from "react-transition-group";
import { InlineIcon } from "@iconify/react";
import closeSharp from "@iconify/icons-ion/close-sharp";
import refreshIcon from "@iconify/icons-carbon/renew";
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
          {t("debug.title")}
          {data?.system && (
            <div className={styles.systemInfo}>
              <span>{data.system.hardware}</span>
              <span>{data.system.os}</span>
            </div>
          )}
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
        <div
          className={styles.closeButton}
          onClick={() => setDebugMenuOpen(false)}
        >
          <InlineIcon icon={closeSharp} />
        </div>

        <div
          className={styles.refreshButton}
          onClick={fetchDebugInfo}
        >
          <span className={styles.refreshIcon}>
            <InlineIcon icon={refreshIcon} />
          </span>
          {loading ? t("debug.loading") : t("debug.refresh")}
        </div>

        <div className={styles.content}>
          <ProviderStatusSection providerStatus={data?.providerStatus} />
          <ServicesSection services={data?.services} />
          <QuotaSection counters={data?.counters} />
          <CacheSection cache={data?.cache} />
          <LogsSection logs={data?.logs} />
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
 * @param {Object} props
 * @param {Object} props.providerStatus
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
 * @param {Object} props
 * @param {Object} props.counters Counters from server
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
 * @param {Object} props
 * @param {Object} props.services Map of service name to status info
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
 * @param {Object} props
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
 * @param {Object} props
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

/**
 * Security events section
 *
 * @param {Object} props
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
 * @param {Object} props
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
