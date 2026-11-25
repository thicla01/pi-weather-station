import React from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import SourceBadge from "~/components/ambient/SourceBadge";
import SeverityChip from "~/components/ambient/SeverityChip";
import useEligibleGovAlerts from "~/hooks/useEligibleGovAlerts";
import useTapGuard from "~/hooks/useTapGuard";
import { chipProductType } from "~/ui/alertLogic";
import { alertDisplayTitle } from "~/ui/alertTitle";
import styles from "./styles.css";

/**
 * Compact alert banner anchored over the map whenever a full-screen
 * map state hides the regular AlertBanner slab: the collapsed rail /
 * radar-focus mode on LayoutDesktop + LayoutPi, and the maximized
 * radar card on LayoutMobile. Without this overlay a severe alert
 * could be active with no on-screen indication — exactly the wrong
 * outcome on a weather kiosk.
 *
 * SHOW gate matches AlertBanner / AlertDetailInline (≥ 1 orange/red
 * gov alert at the point). Renders the currently-displayed alert
 * (mirrors `govAlertIdx`) so cycling through the alerts in the full
 * layout, then collapsing the rail, still shows the same alert here.
 *
 * Visual treatment: floating banner pinned to the top-right of the map
 * area, with the active palette's surface + left severity strip,
 * the source badge, the abbreviated SeverityChip (« AVERT. », the Pi
 * compact alert card's chip), the title, a "1 / N" counter when several
 * alerts are active, and a trailing chevron (P4 audit follow-up,
 * 2026-06-11). The chip prints its word, so the title drops it, as on the
 * other alert surfaces: « Pluie verglaçante », not « Avertissement de pluie
 * verglaçante », and "Heavy Freezing Spray", not "Heavy Freezing Spray
 * Warning" (`alertDisplayTitle` → `shortAlertTitle`, ui/alertTitle.js).
 * A title too long for one line wraps to a second one rather than being
 * cut (styles.css `.title`).
 *
 * A test/exercise alert (`currentAlert.isTest`: an NWS alert with CAP
 * status ≠ `Actual`, shown only through the localhost-only "Show test
 * alerts" toggle) is marked as on AlertBanner: the neutral outlined `TEST`
 * qualifier (`SourceBadge variant="test"`) right after the source badge,
 * and a « TEST · » prefix in front of the shortened title
 * (`alertDisplayTitle`), so the word still leads when the title wraps or
 * is clamped. The severity strip keeps the alert's real tier. The
 * `belowControls` placement drops the banner under a 44 px control row
 * instead — LayoutMobile's maximized card already has its restore
 * button in the top-right corner and the Leaflet zoom stack at the
 * top-left. Tapping the banner exits the full-screen map state
 * (signalled via `onExpand`); the cycle controls aren't exposed here
 * on purpose — restoring the layout gives the user the full UI.
 *
 * @param {object} props
 * @param {() => void} props.onExpand — called when the banner is tapped;
 *   the parent exits the full-screen map state (un-collapses the rail /
 *   restores the mobile radar card). Called with no argument, after the
 *   optional double-tap guard (`guardTaps`); the type is zero-arity.
 * @param {string} [props.placement] — `"topRight"` (default, rail
 *   layouts) or `"belowControls"` (mobile maximized card: right-aligned
 *   under the restore button, clear of the zoom stack)
 * @param {boolean} [props.guardTaps] — true when LayoutPi renders the
 *   priority-views model (its `priority`, ui/piLayout.js
 *   `priorityViewsEnabled()`): the tap then arms the double-tap guard
 *   (hooks/useTapGuard.js) before restoring MID, which brings the rail
 *   under the finger — the scope of the dock's AI and forecast buttons
 *   (ControlButtons `inPriorityDock`). LayoutPi decides, from the model it
 *   renders, so a 1280 px window under `forcePriorityViews` (LayoutDesktop)
 *   never arms it. False or absent (LayoutDesktop's focus mode,
 *   LayoutMobile's maximized card, the 10.1" stacked rail): no guard.
 * @param {boolean} [props.shellLive] — Overlay shell only: LayoutPi's
 *   overlay shell keeps the banner mounted in every state; true in MIN,
 *   false elsewhere, which makes it inert (and hidden by its overlay-shell
 *   rules in styles.css, so it fades from the switch's own commit). Either
 *   way it carries `data-pi-overlay-el="banner"`. Undefined everywhere else
 *   (mounted only when shown).
 * @param {function(?Element): (function(): void|undefined)} [props.overlayRef]
 *   — Overlay shell only: the shell's overlay registry's ref callback
 *   (ui/shellElements.js), attached to the banner, so LayoutPi's shell
 *   timing finds it without walking the DOM. Undefined everywhere else.
 * @returns {JSX.Element|null} mini-banner, or null when no alert is eligible
 */
const FloatingMiniBanner = ({ onExpand, placement = "topRight", guardTaps = false, shellLive, overlayRef }) => {
  // Restoring MID puts the rail under the finger: on the priority views
  // (`guardTaps`), the tap arms the double-tap guard first (ui/tapGuard.js).
  // Never armed, it holds no listener.
  const guardTap = useTapGuard();
  const { t, i18n } = useTranslation();
  // Same eligible-alert derivation as AlertBanner — shared hook so the
  // collapsed-rail overlay shows the exact alert the full banner would,
  // dismissal filter included (this overlay previously skipped it).
  const { eligibleGovAlerts, safeIdx, currentAlert } = useEligibleGovAlerts();

  if (!currentAlert) return null;

  const lang = (i18n.language || "en").slice(0, 2);
  const testLabel = t("alert.testTag", { defaultValue: "TEST" });
  // The abbreviated chip below prints the product type (« AVERT. »), so a
  // French ECCC title drops the prefix that repeats it and leads with the
  // hazard. Kept whole beside the chip, « Avertissement de pluie
  // verglaçante » would read « Avertissement de plu… » in the 360 px
  // banner with two alerts. An English title (the Spanish UI's too) drops
  // its trailing word the same way. A test alert's « TEST · » goes on
  // after that shortening, as on AlertBanner.
  const title = alertDisplayTitle(
    lang === "fr" ? currentAlert.title_fr : currentAlert.title_en,
    {
      lang,
      productType: chipProductType(currentAlert.title_en, currentAlert.severity),
      isTest: currentAlert.isTest,
      testLabel,
    },
  );

  return (
    <button
      ref={overlayRef}
      type="button"
      className={`${styles.banner} ${placement === "belowControls" ? styles.belowControls : ""} ${styles[`tier-${currentAlert.tier}`]}`}
      onClick={(e) => { if (guardTaps) guardTap(e); onExpand(); }}
      data-pi-overlay-el={shellLive === undefined ? undefined : "banner"}
      inert={shellLive === false}
    >
      <SourceBadge source={currentAlert.source} />
      {currentAlert.isTest ? <SourceBadge source={testLabel} variant="test" /> : null}
      <SeverityChip severity={currentAlert.severity} eventName={currentAlert.title_en} abbreviated />
      <span className={styles.title}>{title}</span>
      {eligibleGovAlerts.length > 1 ? (
        <span className={styles.counter}>{safeIdx + 1} / {eligibleGovAlerts.length}</span>
      ) : null}
      {/* Inline SVG chevron (house rule: no Unicode glyphs) — signals
        * "tap to open" exactly like the mini-cards' trailing chevron. */}
      <svg className={styles.chevron} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M9 6 L 15 12 L 9 18" />
      </svg>
    </button>
  );
};

FloatingMiniBanner.propTypes = {
  onExpand: PropTypes.func.isRequired,
  placement: PropTypes.oneOf(["topRight", "belowControls"]),
  guardTaps: PropTypes.bool,
  shellLive: PropTypes.bool,
  overlayRef: PropTypes.func,
};

export default FloatingMiniBanner;
