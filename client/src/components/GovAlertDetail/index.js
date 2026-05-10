import React, { useContext, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { InlineIcon } from "@iconify/react";
import chevronUp from "@iconify/icons-carbon/chevron-up";
import chevronDown from "@iconify/icons-carbon/chevron-down";
import { AppContext } from "~/AppContext";
import styles from "./styles.css";

// Public landing pages where the user can read the full alert in context
// and check official advisories beyond the one being displayed. Built per
// language for the two upstreams we currently support; the keyed lookup
// stays trivial to extend if a third source ever lands. URLs are
// deliberately landing pages (not deep-linked to the specific alert ID)
// because (a) ECCC's public site doesn't expose stable per-alert
// permalinks that match the JSON API IDs, and (b) keeping the link
// generic means we never accidentally send the user's lat/lon to the
// destination as a query parameter.
const SOURCE_LINKS = {
  ECCC: {
    fr: "https://meteo.gc.ca/warnings/index_f.html",
    en: "https://weather.gc.ca/warnings/index_e.html",
    es: "https://weather.gc.ca/warnings/index_e.html",
  },
  NWS: {
    fr: "https://www.weather.gov/",
    en: "https://www.weather.gov/",
    es: "https://www.weather.gov/",
  },
};

/**
 * Collapsible section sitting right under the AlertBanner that surfaces
 * the official text body of the currently-displayed government alert.
 * Mirrors the banner's cycle position via shared AppContext state, so
 * tapping the banner to advance to the next alert also swaps the
 * description shown here. The SHOW gate matches the banner exactly
 * (≥ 1 orange/red alert at the point) so the two stay paired.
 *
 * The title carries the source ("Alerte ECCC" / "ECCC Alert" / etc.) so
 * the user immediately sees which authority issued the text, and an
 * external link at the bottom goes to the source's public landing page
 * for full context (or to see other advisories not surfaced here).
 *
 * When the currently-displayed alert has no body text (occasionally
 * happens for "Special weather statement" entries that ECCC emits with
 * an empty `alert_text` field), the section keeps the title and shows
 * a discreet "no detail available" note instead of disappearing — so
 * the cycling feels consistent across alerts.
 *
 * @returns {JSX.Element|null} Detail section, or null when no eligible
 *   gov alert is active (matching AlertBanner's SHOW gate)
 */
const GovAlertDetail = () => {
  const { darkMode, govAlerts, govAlertIdx } = useContext(AppContext);
  const { i18n, t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const allGovAlerts = useMemo(
    () => (Array.isArray(govAlerts) ? govAlerts : []),
    [govAlerts]
  );
  const hasEligible = useMemo(
    () => allGovAlerts.some((a) => a?.tier === "red" || a?.tier === "orange"),
    [allGovAlerts]
  );

  if (!hasEligible || allGovAlerts.length === 0) return null;

  const lang = ["fr", "es"].find((l) => i18n.language.startsWith(l)) || "en";
  const safeIdx = govAlertIdx % allGovAlerts.length;
  const currentAlert = allGovAlerts[safeIdx];
  if (!currentAlert) return null;

  const source = currentAlert.source || "ECCC";
  // alert_text_fr / alert_text_en come straight from the upstream feed.
  // Some alerts (notably "special weather statement" entries that have
  // just transitioned to status=ended) ship with an empty body — we
  // detect both null and whitespace-only to fall back to the "no
  // detail" note.
  const description = lang === "fr"
    ? (currentAlert.description_fr || currentAlert.alert_text_fr || "").trim()
    : lang === "es"
      ? (currentAlert.description_en || currentAlert.alert_text_en || "").trim()
      : (currentAlert.description_en || currentAlert.alert_text_en || "").trim();

  const title = t("govAlertDetail.title", { source });
  const linkHref = (SOURCE_LINKS[source] && SOURCE_LINKS[source][lang]) || SOURCE_LINKS.ECCC[lang];
  const linkLabel = t("govAlertDetail.linkLabel", { source });

  const toggleExpanded = () => setExpanded((prev) => !prev);

  return (
    <div className={`${styles.container} ${darkMode ? styles.dark : styles.light}`}>
      <button
        type="button"
        className={`${styles.toggleButton} ${darkMode ? styles.toggleButtonDark : styles.toggleButtonLight}`}
        onClick={toggleExpanded}
        aria-expanded={expanded}
      >
        <InlineIcon
          icon={expanded ? chevronDown : chevronUp}
          className={styles.chevronLeft}
        />
        <span className={styles.label}>{title}</span>
        <InlineIcon
          icon={expanded ? chevronDown : chevronUp}
          className={styles.chevronRight}
        />
      </button>
      {expanded ? (
        <div className={styles.body}>
          {description ? (
            <>
              {description.split(/\n\n+/).map((paragraph, i) => (
                <p key={i} className={styles.text}>{paragraph}</p>
              ))}
              <a
                href={linkHref}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.link}
              >
                {linkLabel} ›
              </a>
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

export default GovAlertDetail;
