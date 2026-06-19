import React, { useContext, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { InlineIcon } from "@iconify/react";
import closeIcon from "@iconify/icons-carbon/close";
import warningAltIcon from "@iconify/icons-carbon/warning-alt";
import timeIcon from "@iconify/icons-carbon/time";
import { RestoreIcon } from "~/components/WeatherMap/icons";
import { AppActionsContext, SystemContext } from "~/AppContext";
import { parseAlertText } from "~/ui/alertParser";
import useEligibleGovAlerts from "~/hooks/useEligibleGovAlerts";
import useDismissedAlerts from "~/hooks/useDismissedAlerts";
import SeverityChip from "~/components/ambient/SeverityChip";
import SourceBadge from "~/components/ambient/SourceBadge";
import RailSquareButton from "~/components/ambient/RailSquareButton";
import QrCode from "~/components/ambient/QrCode";
import { SectionBlock, SOURCE_LINKS } from "~/components/ambient/AlertDetailInline";
import styles from "./styles.css";

// Tier → severity-dot colour for the "Aussi actives" selector chips.
const DOT_CLASS = { red: "dotRed", orange: "dotOrange", yellow: "dotYellow" };

/**
 * v3.3 Alert priority view — the government-alert detail promoted to a
 * full-rail view on the 7" kiosk (`docs/v3.3-priority-views-design.md`),
 * reached by tapping the glance alert card. Replaces the v3.2 inline
 * `AlertDetailInline` expansion with a dedicated reading surface:
 *
 *   - a header carrying the severity treatment (the gradation: `extreme`
 *     gets a solid red band — "when lives are at stake, drop the
 *     subtleties"; everything else keeps the tinted SeverityChip), the
 *     source badge, the title and a close → back-to-glance;
 *   - an "Aussi actives" selector listing the OTHER eligible gov alerts as
 *     severity-dotted chips (tap → `selectGovAlert` swaps which is primary);
 *   - the structured detail body, reusing `AlertDetailInline`'s exported
 *     `SectionBlock` renderer (Où / Danger / Observation / Source / Impact…)
 *     so the parse + layout stay in one place;
 *   - a QR footer + a "Masquer" dismiss that returns to the glance.
 *
 * No invented safety instructions — the action line only appears when the
 * authority's bulletin carries one (`alertParser` classifies it as `action`).
 *
 * Mounted in LayoutPi's `alertHost`, shown only in the "alert" state.
 *
 * @returns {JSX.Element|null} the alert view, or null when no eligible alert
 */
const AlertView = () => {
  const { setPiLayoutState, selectGovAlert } = useContext(AppActionsContext);
  const { piLayoutState } = useContext(SystemContext);
  const { dismiss } = useDismissedAlerts();
  const { i18n, t } = useTranslation();
  const { eligibleGovAlerts, safeIdx, currentAlert } = useEligibleGovAlerts();

  const lang = ["fr", "es"].find((l) => i18n.language.startsWith(l)) || "en";

  const sections = useMemo(() => {
    if (!currentAlert) return [];
    const description = lang === "fr"
      ? (currentAlert.description_fr || currentAlert.alert_text_fr || "").trim()
      : (currentAlert.description_en || currentAlert.alert_text_en || "").trim();
    return description ? parseAlertText(description, lang) : [];
  }, [currentAlert, lang]);

  // Anti-stranding: this view is the ONLY rail content in the "alert" state
  // (the glance is display:none), and it renders null with no alert. If the
  // backing alert vanishes while the user is reading it (it expires, a ~15 min
  // /api/update payload drops it, or the eligible set changes), bounce back to
  // the glance so the rail can't go blank with no escape on the keyboard-less
  // kiosk. Mirrors AppContext's govAlertIdx-reset-on-shrink effect.
  useEffect(() => {
    if (piLayoutState === "alert" && !currentAlert) setPiLayoutState("mid");
  }, [piLayoutState, currentAlert, setPiLayoutState]);

  // Defensive: the view only renders in the "alert" state, which the glance
  // alert card only reaches when an alert is active — but guard anyway.
  if (!currentAlert) return null;

  const title = lang === "fr" ? currentAlert.title_fr : (currentAlert.title_en || currentAlert.title_fr);
  const source = currentAlert.source || "ECCC";
  const extreme = currentAlert.severity === "extreme";
  const linkHref = (SOURCE_LINKS[source] && SOURCE_LINKS[source][lang]) || SOURCE_LINKS.ECCC[lang];
  const others = eligibleGovAlerts
    .map((alert, eligibleIdx) => ({ alert, eligibleIdx }))
    .filter(({ eligibleIdx }) => eligibleIdx !== safeIdx);

  const back = () => setPiLayoutState("mid");

  return (
    <div className={styles.view}>
      <div className={`${styles.header} ${styles[`tier-${currentAlert.tier}`] || ""} ${extreme ? styles.extreme : ""}`}>
        <div className={styles.headRow}>
          {extreme ? (
            <InlineIcon icon={warningAltIcon} className={styles.bigIcon} aria-hidden="true" />
          ) : (
            <SeverityChip severity={currentAlert.severity} eventName={currentAlert.title_en} />
          )}
          <span className={styles.title}>{title}</span>
          {extreme ? <span className={styles.srcWhite}>{source}</span> : <SourceBadge source={source} />}
          <RailSquareButton
            icon={RestoreIcon}
            onClick={back}
            ariaLabel={t("alert.view.back", { defaultValue: "Back to overview" })}
            className={styles.minimize}
          />
        </div>
        {currentAlert.expiresAt ? (
          <div className={styles.meta}>
            <InlineIcon icon={timeIcon} aria-hidden="true" />
            {t("alert.view.until", {
              defaultValue: "Until {{time}}",
              time: new Date(currentAlert.expiresAt).toLocaleTimeString(i18n.language, { hour: "numeric", minute: "2-digit" }),
            })}
            {currentAlert.senderName ? ` · ${currentAlert.senderName}` : ""}
          </div>
        ) : null}
      </div>

      {others.length > 0 ? (
        <div className={styles.selector}>
          <span className={styles.selLabel}>{t("alert.view.alsoActive", { defaultValue: "Also active" })}</span>
          <div className={styles.chips}>
            {others.map(({ alert, eligibleIdx }) => (
              <button
                key={alert.id || `${eligibleIdx}-${alert.title_en}`}
                type="button"
                className={styles.chip}
                onClick={() => selectGovAlert(eligibleIdx)}
                aria-label={t("alert.selectAlertAria")}
              >
                <span className={`${styles.dot} ${styles[DOT_CLASS[alert.tier]] || ""}`} aria-hidden="true" />
                {lang === "fr" ? alert.title_fr : (alert.title_en || alert.title_fr)}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className={styles.body}>
        {sections.length > 0 ? (
          sections.map((section, i) => <SectionBlock key={i} section={section} t={t} />)
        ) : (
          <p className={styles.noDetail}>{t("govAlertDetail.noDetail")}</p>
        )}
        <div className={styles.footer}>
          <div className={styles.qrRow}>
            <QrCode value={linkHref} title={t("govAlertDetail.qrCaption")} />
            <span className={styles.qrCaption}>{t("govAlertDetail.qrCaption")}</span>
          </div>
          <button
            type="button"
            className={styles.dismiss}
            onClick={() => { dismiss(currentAlert); back(); }}
            aria-label={t("alert.dismiss", { defaultValue: "Dismiss" })}
            title={t("alert.dismissTooltip", { defaultValue: "Hide for 4 h (re-surfaces if it escalates)" })}
          >
            <InlineIcon icon={closeIcon} />
            <span>{t("alert.dismiss", { defaultValue: "Dismiss" })}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default AlertView;
