import React, { useContext, useMemo } from "react";
import { useTranslation } from "react-i18next";
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
 * section.
 *
 * **v3.1 Phase 4 changes:**
 *
 *   - Removed the in-component toggle button. `AlertBanner` is
 *     now the user-facing toggle (its head row is clickable). This
 *     component reads `govAlertExpanded` from `AppContext` and
 *     renders nothing when collapsed, the body+QR when expanded.
 *   - Title bar (with the chevron) lives in `AlertBanner`. The
 *     `<button>` toggle that used to sit at the top of this slab
 *     is gone — duplicating it under the banner would create the
 *     "two chevrons doing the same thing" smell the design's F15
 *     finding called out.
 *   - The slab still carries the description body (paragraph
 *     split on `\n\n`) and the QR code footer for opening the
 *     upstream source on a phone.
 *
 * Behaviour preserved:
 *   - Mirrors `AlertBanner`'s SHOW gate exactly (eligible gov
 *     alert at orange/red tier, not dismissed).
 *   - Picks the same active alert as the banner via
 *     `govAlertIdx` from context.
 *
 * @returns {JSX.Element|null} detail section, or null when
 *   collapsed / no eligible alert
 */
const AlertDetailInline = () => {
  const { govAlerts, govAlertIdx, govAlertExpanded } = useContext(AppContext);
  const { i18n, t } = useTranslation();
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
  // Bail when the banner is collapsed — Phase 4 design renders the
  // body inside the banner's expand region, so this slab is "the
  // body" appearing under the head. No body, no slab.
  if (!govAlertExpanded) return null;

  const lang = ["fr", "es"].find((l) => i18n.language.startsWith(l)) || "en";
  const safeIdx = govAlertIdx % allGovAlerts.length;
  const currentAlert = allGovAlerts[safeIdx];
  if (!currentAlert) return null;

  const source = currentAlert.source || "ECCC";
  const description = lang === "fr"
    ? (currentAlert.description_fr || currentAlert.alert_text_fr || "").trim()
    : (currentAlert.description_en || currentAlert.alert_text_en || "").trim();

  const linkHref = (SOURCE_LINKS[source] && SOURCE_LINKS[source][lang]) || SOURCE_LINKS.ECCC[lang];

  return (
    <div className={styles.container}>
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
    </div>
  );
};

export default AlertDetailInline;
