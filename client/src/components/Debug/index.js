import React, { useContext, useState, useEffect, useCallback } from "react";
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
        <div className={styles.header}>DEBUG</div>
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
          {loading ? "LOADING..." : "REFRESH"}
        </div>

        <div className={styles.content}>
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

/**
 * Cache section
 *
 * @param {Object} props
 * @param {Array} props.cache List of cache entries
 * @returns {JSX.Element} Cache section
 */
const CacheSection = ({ cache }) => (
  <div className={styles.section}>
    <div className={styles.sectionTitle}>CACHE</div>
    {!cache || cache.length === 0 ? (
      <div className={styles.empty}>No entries in cache</div>
    ) : (
      <div className={styles.cacheTable}>
        <div className={styles.cacheHeader}>
          <span>TYPE</span>
          <span>LAT</span>
          <span>LON</span>
          <span>TTL</span>
        </div>
        {cache.map((entry) => {
          const [type, lat, lon] = entry.key.split(":");
          return (
            <div className={styles.cacheEntry} key={entry.key}>
              <span className={styles.cacheType}>{type}</span>
              <span className={styles.cacheCoord}>{lat}</span>
              <span className={styles.cacheCoord}>{lon}</span>
              <span className={`${styles.cacheTtl} ${entry.expired ? styles.expired : ""}`}>
                {entry.expired ? "EXPIRED" : `${entry.expiresIn}s`}
              </span>
            </div>
          );
        })}
      </div>
    )}
  </div>
);

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
const LogsSection = ({ logs }) => (
  <div className={styles.section}>
    <div className={styles.sectionTitle}>LOGS (last 100 lines)</div>
    <div className={styles.logBlock}>
      {!logs || logs.length === 0 ? (
        <span className={styles.empty}>No logs available</span>
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
const SecuritySection = ({ events }) => (
  <div className={styles.section}>
    <div className={styles.sectionTitle}>SECURITY EVENTS</div>
    {!events || events.length === 0 ? (
      <div className={styles.empty}>No blocked requests</div>
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
const AuditSection = ({ audit }) => (
  <div className={styles.section}>
    <div className={styles.sectionTitle}>NPM AUDIT</div>
    <div className={styles.auditBlock}>
      {audit || <span className={styles.empty}>Not available</span>}
    </div>
  </div>
);

AuditSection.propTypes = {
  audit: PropTypes.string,
};
