import React, { useContext, useEffect } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { InlineIcon } from "@iconify/react";
import warningAltIcon from "@iconify/icons-carbon/warning-alt";
import errorOutlineIcon from "@iconify/icons-carbon/error-outline";
import locationIcon from "@iconify/icons-carbon/location";
import timeIcon from "@iconify/icons-carbon/time";
import flashIcon from "@iconify/icons-carbon/flash";
import mapIcon from "@iconify/icons-carbon/map";
import chevronUpIcon from "@iconify/icons-carbon/chevron-up";
import documentIcon from "@iconify/icons-carbon/document";
import radarWeatherIcon from "@iconify/icons-carbon/radar-weather";
import binocularsIcon from "@iconify/icons-carbon/binoculars";
import closeIcon from "@iconify/icons-carbon/close";
import { AlertsContext, AppActionsContext, SystemContext } from "~/AppContext";
import QrCode from "~/components/ambient/QrCode";
import useEligibleGovAlerts from "~/hooks/useEligibleGovAlerts";
import useDismissedAlerts from "~/hooks/useDismissedAlerts";
import { parseAlertText, splitBody } from "~/ui/alertParser";
import styles from "./styles.css";

// Source landing pages — see `GovAlertDetail` for the long-form
// rationale on URL choices and the deliberate omission of lat/lon
// query parameters. Coordinates with this comment if either gets
// changed: both components must point at the same destination.
export const SOURCE_LINKS = {
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

// Map canonical section type → carbon icon. Adding a new section
// type (see `alertParser.classifyHeading`) means adding an entry
// here AND adding an `alert.section{Type}` i18n key.
//
// Icon choices match the v3.1 synthesis design's intent. The
// `observation` and `source` types are kept distinct because they
// answer different reader questions even though both refer to
// "how the alert came to be":
//
//   - hazard      = warning triangle (the danger itself: WHAT,
//                   HAZARD, Dangers, Risques…)
//   - impact      = circled ! (what the hazard DOES — the NWS
//                   `IMPACTS...` block. Split out of hazard
//                   (bug C4): WHAT + IMPACTS both wearing the
//                   "What's happening" heading read as a duplicate)
//   - observation = binoculars (timestamped sighting — the NWS
//                   `At <time>, severe thunderstorms were located
//                   along a line…` lead. The user reads: "what
//                   was just seen / detected")
//   - source      = radar (the upstream `SOURCE...Radar
//                   indicated.` meta line — names the instrument
//                   that produced the observation. The radar
//                   icon makes the "Radar indicated" content
//                   immediately readable)
//   - where       = location pin (the "where it's happening" area)
//   - when        = clock (the "when it's happening" timing)
//   - action      = lightning bolt (the "take action / move now" cue)
//   - section     = document (neutral fallback for headings we
//                   recognised in the text but can't classify into
//                   one of the canonical types)
//   - intro       = no icon; rendered as a leading paragraph block
const SECTION_ICONS = {
  hazard: warningAltIcon,
  impact: errorOutlineIcon,
  observation: binocularsIcon,
  source: radarWeatherIcon,
  where: locationIcon,
  when: timeIcon,
  action: flashIcon,
  section: documentIcon,
};

// NWS test/exercise products carry literal banner lines like "THIS IS A TEST"
// or "...THIS MESSAGE IS FOR TEST PURPOSES ONLY..." as a heading-less lead with
// no body. The lead→body promotion in SectionBlock would otherwise echo such a
// line twice (once as the localized heading row, once as the body). Don't
// promote a recognised test marker. Only reachable when test alerts are
// revealed via the localhost-only "Show test alerts" toggle.
const TEST_MARKER_RE = /\bTEST\b|EXERCISE|SYSTEM MESSAGE/i;

/**
 * Direction C variant of the collapsible government-alert detail
 * section.
 *
 * **v3.1 Phase 4 changes:**
 *
 *   Phase 4a (shipped):
 *   - Removed the in-component toggle button. `AlertBanner` is
 *     now the user-facing toggle (its head row is clickable). This
 *     component reads `govAlertExpanded` from `AppContext` and
 *     renders nothing when collapsed, the body+QR when expanded.
 *
 *   Phase 4b (this commit):
 *   - The description text now flows through `alertParser` which
 *     splits NWS `* WHAT...` asterisked blocks and ECCC `Hazards:`
 *     / `Dangers :` heading blocks into a unified list of
 *     `{ type, lead, detail }` sections.
 *   - Each section renders with a canonical icon (warning /
 *     location / clock / flash / document) + a localized lead
 *     row (from `alert.section{Type}` i18n keys) + the upstream
 *     detail text. The intro section (no heading) keeps the bare
 *     paragraph rendering — no icon, no lead row.
 *   - Falls back to the pre-4b paragraph-split rendering when the
 *     parser returns only an intro section (i.e. the alert text
 *     wasn't structured at all).
 *
 * Behaviour preserved across both phases:
 *   - Mirrors `AlertBanner`'s SHOW gate exactly.
 *   - Picks the same active alert via `govAlertIdx`.
 *   - QR code footer for opening the upstream source on a phone.
 *
 * @returns {JSX.Element|null} detail section, or null when
 *   collapsed / no eligible alert
 */
const AlertDetailInline = () => {
  const { govAlertExpanded, highlightedAlertId } = useContext(AlertsContext);
  const { setGovAlertExpanded, setHighlightedAlertId } = useContext(AppActionsContext);
  const { piLayoutState } = useContext(SystemContext);
  const { dismiss } = useDismissedAlerts();
  const { i18n, t } = useTranslation();
  // On the 7" Pi compact card the dismiss ✕ is dropped from the banner row
  // (it crowded the cycle counter), so the dismiss affordance lives here in
  // the expanded detail footer instead — Pi only; desktop / mobile keep the
  // banner ✕.
  const isPi = piLayoutState != null;

  // Current eligible (red/orange, non-dismissed) gov alert, derived
  // by the same shared hook AlertBanner uses so the detail body and
  // the banner head always show the same alert. The hook applies the
  // dismissal filter + the red/orange tier gate in one place.
  const { currentAlert } = useEligibleGovAlerts();

  // Clean up the map overlay (`highlightedAlertId`) when the detail
  // panel collapses or the component unmounts. Without this, the
  // ID set via the "Voir sur la carte" button (line ~206) would
  // persist past the collapse — painting an orphan GeoJSON polygon
  // on the radar with no visible toggle to dismiss it until the
  // user re-expanded the detail AND re-tapped the same button.
  //
  // The first effect covers the "user collapses the detail panel
  // via AlertBanner or the Réduire button" case. The second covers
  // the unmount cases: switching layouts (Pi → Mobile via resize),
  // removing the last eligible alert, etc. AppContext already
  // handles cycling-to-next-alert (`govAlertIdx` change), so we
  // don't duplicate that path here. See the Phase 4d wire-up in
  // commit 765da0b for the original "set" side of this state.
  useEffect(() => {
    if (!govAlertExpanded && highlightedAlertId) {
      setHighlightedAlertId(null);
    }
  }, [govAlertExpanded, highlightedAlertId, setHighlightedAlertId]);

  useEffect(() => () => setHighlightedAlertId(null), [setHighlightedAlertId]);

  if (!currentAlert) return null;
  if (!govAlertExpanded) return null;

  const lang = ["fr", "es"].find((l) => i18n.language.startsWith(l)) || "en";

  const source = currentAlert.source || "ECCC";
  const description = lang === "fr"
    ? (currentAlert.description_fr || currentAlert.alert_text_fr || "").trim()
    : (currentAlert.description_en || currentAlert.alert_text_en || "").trim();

  const linkHref = (SOURCE_LINKS[source] && SOURCE_LINKS[source][lang]) || SOURCE_LINKS.ECCC[lang];

  // Run the description through the parser. If structured output
  // is non-empty AND has at least one non-intro section, render
  // structured sections. Otherwise fall back to the legacy
  // paragraph-split rendering so unstructured alerts (or sources
  // that don't follow either NWS or ECCC conventions) still
  // display readably.
  const sections = parseAlertText(description, lang);
  const hasStructure = sections.some((s) => s.type !== "intro");

  return (
    <div className={styles.container}>
      <div className={styles.body}>
        {description ? (
          <>
            <div className={styles.scrollArea}>
              {hasStructure
                ? sections.map((section, i) => (
                  <SectionBlock key={i} section={section} t={t} />
                ))
                : (
                  <RichText
                    text={description}
                    paraClass={styles.text}
                    listClass={styles.textList}
                  />
                )}
            </div>
            {/* Phase 4d (2026-05-28): action footer with two buttons
              * sitting above the QR footer.
              *
              *   - "Réduire" — always present. Sets `govAlertExpanded`
              *     to false so the detail slab collapses and the
              *     radar map underneath reclaims the visual focus.
              *     Universal affordance that always works regardless
              *     of upstream payload shape.
              *   - "Voir sur la carte" — conditional on
              *     `currentAlert.geometry`. ECCC always carries
              *     geometry (server-side pointInPolygon depends on
              *     it), NWS carries it for geo-targeted alerts
              *     (Tornado Warning, etc.) but not for broad
              *     zone-based ones (Special Weather Statement). When
              *     the geometry IS present, tapping toggles the
              *     overlay: first tap sets `highlightedAlertId` →
              *     WeatherMap renders a tier-coloured GeoJSON layer
              *     and fitBounds-zooms to the polygon; second tap
              *     clears it. Label flips to "Cacher de la carte"
              *     while active. */}
            <div className={styles.actionFooter}>
              <button
                type="button"
                className={styles.actionButton}
                onClick={() => setGovAlertExpanded(false)}
                aria-label={t("alert.collapseAria")}
                title={t("alert.collapse")}
              >
                <InlineIcon icon={chevronUpIcon} />
                <span>{t("alert.collapse")}</span>
              </button>
              {currentAlert.geometry ? (
                <button
                  type="button"
                  className={`${styles.actionButton} ${highlightedAlertId === currentAlert.id ? styles.actionButtonActive : ""}`}
                  onClick={() => setHighlightedAlertId(
                    highlightedAlertId === currentAlert.id ? null : currentAlert.id,
                  )}
                  aria-pressed={highlightedAlertId === currentAlert.id}
                  aria-label={t(highlightedAlertId === currentAlert.id ? "alert.hideOnMapAria" : "alert.showOnMapAria")}
                  title={t(highlightedAlertId === currentAlert.id ? "alert.hideOnMap" : "alert.showOnMap")}
                >
                  <InlineIcon icon={mapIcon} />
                  <span>
                    {t(highlightedAlertId === currentAlert.id ? "alert.hideOnMap" : "alert.showOnMap")}
                  </span>
                </button>
              ) : null}
              {/* Dismiss — Pi only. The 7" compact banner card drops its ✕
                * (it crowded the cycle counter), so dismissing the alert for
                * 4 h lives here in the detail footer. Desktop / mobile keep
                * the banner ✕ and don't render this. */}
              {isPi ? (
                <button
                  type="button"
                  className={styles.actionButton}
                  onClick={() => dismiss(currentAlert)}
                  aria-label={t("alert.dismiss", { defaultValue: "Dismiss" })}
                  title={t("alert.dismissTooltip", { defaultValue: "Hide for 4 h (re-surfaces if it escalates)" })}
                >
                  <InlineIcon icon={closeIcon} />
                  <span>{t("alert.dismiss", { defaultValue: "Dismiss" })}</span>
                </button>
              ) : null}
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

/**
 * Render a section's body text as paragraphs + bulleted lists.
 * `splitBody` turns the raw detail text into ordered blocks so NWS
 * `- ` sub-items (storm coordinates, per-impact bullets) render as a
 * real `<ul>` instead of folding into a run-on paragraph.
 *
 * @param {object} props
 * @param {string} props.text - the body / detail text to render
 * @param {string} props.paraClass - CSS module class for paragraphs
 * @param {string} props.listClass - CSS module class for `<ul>` lists
 * @returns {JSX.Element} the rendered blocks
 */
export const RichText = ({ text, paraClass, listClass }) => (
  <>
    {splitBody(text).map((block, j) => (block.type === "list" ? (
      <ul key={j} className={listClass}>
        {block.items.map((item, k) => <li key={k}>{item}</li>)}
      </ul>
    ) : (
      <p key={j} className={paraClass}>{block.text}</p>
    )))}
  </>
);

RichText.propTypes = {
  text: PropTypes.string.isRequired,
  paraClass: PropTypes.string.isRequired,
  listClass: PropTypes.string.isRequired,
};

/**
 * Render one parsed section. Three shapes:
 *   - **intro** — a bare paragraph (the leading prose before the
 *     first structured heading): no icon, no lead row.
 *   - **group** (`section.group`) — an NWS Level-1 (dash-underlined)
 *     section that groups the bullets below it: a full-width eyebrow
 *     divider (no icon column), optionally with its own body.
 *   - **structured** (hazard / where / when / action / section) —
 *     a 2-column layout (icon column + content column) with a
 *     localized lead row above the upstream detail text; reads as
 *     subordinate to the group header above it.
 *
 * @param {object} props
 * @param {{ type: string, lead: string, detail: string, group: boolean }} props.section
 * @param {Function} props.t — i18next translator
 * @returns {JSX.Element|null} the section block, or null if empty
 */
export const SectionBlock = ({ section, t }) => {
  if (!section) return null;
  if (section.type === "intro") {
    // No icon, no lead — the intro is just the leading paragraph.
    // Split on \n\n so multi-paragraph intros still read as
    // distinct blocks instead of one wall of text.
    if (!section.detail) return null;
    return (
      <div className={styles.intro}>
        <RichText text={section.detail} paraClass={styles.text} listClass={styles.textList} />
      </div>
    );
  }
  // Localized lead — falls back to the upstream lead text
  // (`section.lead`) if there's no i18n key for the type. For
  // the generic `section` type (heading we recognised but
  // couldn't classify), the upstream wording IS the lead.
  const i18nKey = `alert.section${section.type.charAt(0).toUpperCase()}${section.type.slice(1)}`;
  const localizedLead = t(i18nKey, { defaultValue: section.lead || "" });

  // Body text under the lead row. Three cases:
  //   - `detail` present → that's the body.
  //   - `detail` empty + a sentence-like lead (contains a lowercase
  //     letter, e.g. NWS Special Marine Warning's `* Until 845 PM
  //     CDT.` where the whole content IS the lead) → promote the
  //     lead to the body so the genuine timing/location cue isn't
  //     lost.
  //   - `detail` empty + an ALL-CAPS category lead (the `POTENTIAL
  //     IMPACTS` / `PRECAUTIONARY/PREPAREDNESS ACTIONS` umbrella
  //     headers that only group the bullets below them) → no body;
  //     render the localized heading alone as a group label.
  //     Echoing the lead under its own translated heading
  //     ("Possible impacts" / "POTENTIAL IMPACTS") would read as a
  //     duplicate.
  let body = section.detail || "";
  if (!body && section.lead && /[a-z]/.test(section.lead) && !TEST_MARKER_RE.test(section.lead)) {
    body = section.lead;
  }
  // Nothing renderable (no heading, no body) → drop the section.
  if (!localizedLead && !body) return null;

  // Group header — an NWS Level-1 (dash-underlined) section such as
  // NEW INFORMATION / POTENTIAL IMPACTS / PRECAUTIONARY-PREPAREDNESS
  // ACTIONS. It groups the icon-led `* ` bullet sections that follow,
  // so it renders as a full-width eyebrow divider (no icon column);
  // the indented icon-led sections beneath it then read as
  // subordinate. A group header may also carry its own body (e.g.
  // SITUATION OVERVIEW's prose, which has no bullet children).
  if (section.group) {
    return (
      <div className={styles.groupHeader}>
        {localizedLead ? (
          <div className={styles.groupLabel}>{localizedLead}</div>
        ) : null}
        {body ? (
          <div className={styles.groupBody}>
            <RichText text={body} paraClass={styles.sectionPara} listClass={styles.sectionList} />
          </div>
        ) : null}
      </div>
    );
  }

  const icon = SECTION_ICONS[section.type] || SECTION_ICONS.section;
  return (
    <div className={styles.section}>
      <span className={styles.sectionIcon}>
        <InlineIcon icon={icon} />
      </span>
      <div className={styles.sectionContent}>
        {localizedLead ? (
          <div className={styles.sectionLead}>{localizedLead}</div>
        ) : null}
        {body ? (
          <div className={styles.sectionDetail}>
            <RichText text={body} paraClass={styles.sectionPara} listClass={styles.sectionList} />
          </div>
        ) : null}
      </div>
    </div>
  );
};

SectionBlock.propTypes = {
  section: PropTypes.shape({
    type: PropTypes.string.isRequired,
    lead: PropTypes.string,
    detail: PropTypes.string,
    group: PropTypes.bool,
  }).isRequired,
  t: PropTypes.func.isRequired,
};

export default AlertDetailInline;
