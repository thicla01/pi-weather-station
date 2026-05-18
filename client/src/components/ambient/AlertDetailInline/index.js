import React, { useContext, useState, useMemo } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { InlineIcon } from "@iconify/react";
import chevronUp from "@iconify/icons-carbon/chevron-up";
import chevronDown from "@iconify/icons-carbon/chevron-down";
import { AppContext } from "~/AppContext";
import QrCode from "~/components/ambient/QrCode";
import useDismissedAlerts from "~/hooks/useDismissedAlerts";
import styles from "./styles.css";

// Source landing pages — see `GovAlertDetail` for the long-form
// rationale on URL choices and the deliberate omission of lat/lon
// query parameters. Coordinates with this comment if either gets
// changed: both components must point at the same destination.
const SOURCE_LINKS = {
  ECCC: {
    fr: "https://meteo.gc.ca/index_f.html#alerttable",
    en: "https://weather.gc.ca/index_e.html#alerttable",
    es: "https://weather.gc.ca/index_e.html#alerttable",
  },
  NWS: {
    fr: "https://www.weather.gov/",
    en: "https://www.weather.gov/",
    es: "https://www.weather.gov/",
  },
};

/**
 * Direction C variant of the collapsible government-alert detail
 * section. Mirrors `GovAlertDetail` behaviour 1:1 (cycle position from
 * AppContext, SHOW gate ≥ 1 orange/red alert, scroll-capped body,
 * QR-only footer) but renders against the slab surface and uses the
 * `QrCode` atomic component instead of an inline `QRCodeSVG`.
 *
 * Layout note (May 2026 — see PR #103 in v2 for the pre-history):
 * the container no longer carries a `max-height` cap. ECCC alerts
 * take precedence and the expanded body is allowed to grow to its
 * natural content height, pushing sibling rail slabs (MetricsGrid,
 * ChartTabs, AiSummaryInline) down inside the already-scrollable
 * rail. Collapsing the alert reverses the push immediately.
 *
 * @param {object} props
 * @param {boolean} [props.defaultExpanded] — start expanded? defaults
 *   to false (collapsed, matching v2)
 * @returns {JSX.Element|null} detail section, or null when no
 *   eligible gov alert is active
 */
const AlertDetailInline = ({ defaultExpanded }) => {
  const { govAlerts, govAlertIdx } = useContext(AppContext);
  const { i18n, t } = useTranslation();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const { isDismissed } = useDismissedAlerts();

  // Hide the detail section for alerts the user has dismissed via
  // the AlertBanner ✕ button. Same filter the banner applies — the
  // two components stay in sync via the shared useDismissedAlerts
  // localStorage hook.
  const allGovAlerts = useMemo(
    () => (Array.isArray(govAlerts) ? govAlerts.filter((a) => !isDismissed(a)) : []),
    [govAlerts, isDismissed],
  );
  const hasEligible = useMemo(
    () => allGovAlerts.some((a) => a?.tier === "red" || a?.tier === "orange"),
    [allGovAlerts],
  );

  if (!hasEligible || allGovAlerts.length === 0) return null;

  const lang = ["fr", "es"].find((l) => i18n.language.startsWith(l)) || "en";
  const safeIdx = govAlertIdx % allGovAlerts.length;
  const currentAlert = allGovAlerts[safeIdx];
  if (!currentAlert) return null;

  const source = currentAlert.source || "ECCC";
  const description = lang === "fr"
    ? (currentAlert.description_fr || currentAlert.alert_text_fr || "").trim()
    : (currentAlert.description_en || currentAlert.alert_text_en || "").trim();

  const title = t("govAlertDetail.title", { source });
  const linkHref = (SOURCE_LINKS[source] && SOURCE_LINKS[source][lang]) || SOURCE_LINKS.ECCC[lang];

  return (
    <div className={styles.container}>
      <button
        type="button"
        className={styles.toggle}
        onClick={() => setExpanded((p) => !p)}
        aria-expanded={expanded}
      >
        <span className={styles.label}>{title}</span>
        <InlineIcon
          icon={expanded ? chevronDown : chevronUp}
          className={styles.chevron}
        />
      </button>
      {expanded ? (
        <div className={styles.body}>
          {description ? (
            <>
              <div className={styles.scrollArea}>
                {description.split(/\n\n+/).map((paragraph, i) => (
                  <p key={i} className={styles.text}>{paragraph}</p>
                ))}
              </div>
              <div className={styles.footer}>
                <QrCode value={linkHref} title={t("govAlertDetail.qrCaption")} />
                <span className={styles.qrCaption}>
                  {t("govAlertDetail.qrCaption")}
                </span>
              </div>
            </>
          ) : (
            <p className={`${styles.text} ${styles.empty}`}>
              {t("govAlertDetail.noDetail")}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
};

AlertDetailInline.propTypes = {
  defaultExpanded: PropTypes.bool,
};

AlertDetailInline.defaultProps = {
  defaultExpanded: false,
};

export default AlertDetailInline;
