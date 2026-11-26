import React, { useContext, useEffect, useState, useSyncExternalStore } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";

import { AlertsContext, UiPrefsContext } from "~/AppContext";
import { RADAR_GEOMETRY } from "./geometry";
import { CloseIcon } from "./icons";
import styles from "./styles.css";

// Tile-scale segment classes t1…t6 — backed by the --rc-tile-* tokens:
// one real colour of RainViewer's Universal Blue palette (the tiles' own)
// per analyzer intensity level, fixed across all four palettes — see
// styles.css.
const TILE_SEGMENTS = ["t1", "t2", "t3", "t4", "t5", "t6"];

// Nearby-alert tier rows: swatch class (backed by --rc-alert-*, which
// nightRed overrides to the red family) + `radar.*` i18n key of the tier's
// SEVERITY word. A polygon's colour is its tier, and the tier comes from
// the alert's normalized CAP severity (`severityToTier` in
// server/govAlertSources/_shared.js: severe/extreme → red, moderate →
// orange, minor → yellow), not from its product type. So the key names a
// severity (Severe / Moderate / Minor), never a type: the orange tier holds
// advisories and warnings as well as watches (ECCC frost advisories and
// snowfall warnings both carry impact "Moderate"), and used to be labelled
// "Watch" / « Veille ». The swatch class names are historical.
const ALERT_TIERS = [
  { swatch: "alertTierSwatchWarn", key: "nearbyTierSevere" },
  { swatch: "alertTierSwatchWatch", key: "nearbyTierModerate" },
  { swatch: "alertTierSwatchAdv", key: "nearbyTierMinor" },
];

// No-break space (U+00A0) between a radius and its unit, so a narrow
// legend sheet never strands "km"/"mi" on a line of its own. Written as
// an escape because the character is invisible in source and diffs.
const NBSP = "\u00a0";

// The overlay shell registry's presentation read without a subscription
// (detail sheet closed), and the reading without a shell (the grid shell,
// the desktop, mobile: no overlay-shell presentation at all).
const NO_UNSUBSCRIBE = () => undefined;
const subscribeNothing = () => NO_UNSUBSCRIBE;
const NO_SHELL_PRESENTATION = Object.freeze({ legend: undefined });
const readNoShell = () => NO_SHELL_PRESENTATION;

/**
 * Six-segment precipitation colour bar — real tile colours, one per
 * intensity level.
 *
 * @returns {JSX.Element} Scale bar
 */
const PrecipScale = () => (
  <span className={styles.precipScale} aria-hidden="true">
    {TILE_SEGMENTS.map((seg) => (
      <span key={seg} className={styles[seg]} />
    ))}
  </span>
);

/**
 * Radar map legend (v3.1 Phase 3, Claude Design v2.1). Three sections:
 * analysis radii (only when the analysis rings are enabled — unit- and
 * extended-radius-aware), the precipitation scale (the real 6-colour
 * tile palette), and the nearby-alert tier key (named by severity,
 * like the colours) + honest in-radius count (only when the alert
 * overlay is on).
 *
 * Three presentations, one component:
 *  - card (default) — bottom-left, glanceable, non-interactive;
 *  - chip (`chipMode`, short screens wherever the map can't spare the
 *    room: timeline bar on screen, or the grid shell's MID pane, which
 *    a short screen shows only after a viewport crossing 540 px under a
 *    mounted LayoutPi) — the Q5 mutual-exclusion rule: a compact
 *    "(i) Légende" pill that opens the full legend as an overlay;
 *  - mobile strip — full-width compact bar, CSS-gated to the ambient
 *    mobile layout, whose (i) opens the same overlay as a bottom sheet.
 *
 * The overlay dismisses via scrim tap, the ✕ button, or Escape.
 *
 * Under LayoutPi's overlay shell (`shell` set) the card and the chip are
 * rendered TOGETHER, plus a second, raised chip (MIN with the scrubber,
 * above it), and the shell registry's presentation names the live one
 * (ui/shellElements.js); the others are inert and, by the overlay shell's
 * rules in styles.css, hidden (`visibility: hidden`, never opacity alone:
 * they carry a backdrop blur). So a MIN ↔ MID switch only flips `inert` in
 * its own commit and the CSS fades them, each in its one place
 * (ui/piShellGeometry.js overlayPresentation / overlayPlacement). The
 * registry flips that `inert` by hand, in the commit of each chrome change,
 * so a switch doesn't render this component (a `shellLive` prop would render
 * it twice at every view switch); a render of its own reads the presentation
 * the registry holds, so it renders the same attribute. Each carries
 * `data-pi-overlay-el` ("chip", "chip-raised", "card") for those rules, for
 * the registry and for the shell's motion tracking. `chipMode` is then
 * ignored. In a view (presentation "none") all three are hidden and inert,
 * and the detail sheet closes, as the unmount closes it elsewhere.
 *
 * @param {object} props
 * @param {boolean} props.dark Dark-palette variant
 * @param {boolean} props.chipMode Render the compact chip instead of the card (short screens with the timeline bar on screen, or on the grid shell's MID pane, which a short screen shows only after a viewport crossing 540 px under a mounted LayoutPi — WeatherMap decides; under LayoutPi's overlay shell the shell's state picks the legend's form instead, at any height)
 * @param {{overlayRef: function(?Element): (function(): void|undefined), presentation: function(): {legend: string}, subscribe: function(function(): void): function(): void}} [props.shell] Overlay shell only: LayoutPi's shell registry (ui/shellElements.js): its `overlayRef` goes on the three `data-pi-overlay-el` elements, so LayoutPi's shell timing finds them without walking the DOM and the registry sets their `inert`; its presentation's `legend` names the live one ("chip" | "chipRaised" | "card" | "none"). Undefined everywhere else (one or the other, by `chipMode`)
 * @returns {JSX.Element} Legend overlay
 */
const RadarLegend = ({ dark, chipMode, shell }) => {
  const { t } = useTranslation();
  const {
    showWeatherAlerts,
    nearbyAlerts,
    nearbyResidualCount,
    alertRadiusKm,
  } = useContext(AlertsContext);
  const { distanceUnit, radarAnalysisEnabled, extendedRadarRadius } = useContext(UiPrefsContext);
  const [overlayOpen, setOverlayOpen] = useState(false);

  // The overlay shell's live presentation, the shell registry's
  // (ui/shellElements.js), read in every render; undefined off that shell,
  // which keeps the legend mounted while a view is open, where the grid
  // shell unmounts it, which closes its detail sheet. Left open, the sheet's
  // scrim and blurred card would stay over the view's map strip, out of
  // reach under the views' gesture shield, and still be open after the
  // close. So the sheet closes when the legend goes "none" (a view).
  // Subscribed only while the sheet is open: closed, as it nearly always is,
  // a switch renders nothing here. Open, the registry's change, told in the
  // switch's commit, renders this component once more before the frame that
  // paints the switch, and the sheet closes in that render (adjusted during
  // render: the sheet can only be opened while a presentation is live). MIN
  // ↔ MID keeps it open, as the grid shell does. That render is a second
  // commit, synchronous: React flushes the update the registry's change
  // raised in LayoutPi's layout effect before the switch's commit returns,
  // in the same task, so the frame that paints the switch already shows the
  // sheet closed. Closing it in the switch's own commit would need a prop,
  // which renders this component at every switch; nothing differs on screen,
  // and only while the sheet is open. Reading PiLayoutContext while open, as
  // DockOverflowMenu does, would close it in the switch's commit again, its
  // state then standing for the chrome's (no plan delays the chrome).
  const overlayRef = shell ? shell.overlayRef : undefined;
  const shellLive = useSyncExternalStore(
    shell && overlayOpen ? shell.subscribe : subscribeNothing,
    shell ? shell.presentation : readNoShell,
  ).legend;
  if (shellLive === "none" && overlayOpen) setOverlayOpen(false);

  // Escape closes the overlay — keyboard parity with the scrim/✕
  // (the DetailsPopover pattern elsewhere in the ambient tree).
  useEffect(() => {
    if (!overlayOpen) return undefined;
    const onKeyDown = (e) => {
      if (e.key === "Escape") setOverlayOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [overlayOpen]);

  const nearbyCount = Array.isArray(nearbyAlerts) ? nearbyAlerts.length : 0;
  // The alert-search radius is an independent km-native setting — in
  // miles mode it converts (100 km → "62 mi"), deliberately NOT the
  // round per-unit ring value (60 mi). The ring radii below ARE the
  // round per-unit values from RADAR_GEOMETRY.
  const radiusDisplay = distanceUnit === "mi" ? Math.round(alertRadiusKm / 1.609344) : alertRadiusKm;
  const unitLabel = distanceUnit === "mi" ? "mi" : "km";

  const geometry = RADAR_GEOMETRY[distanceUnit] || RADAR_GEOMETRY.km;
  const innerRadius = geometry.inner[geometry.inner.length - 1];
  const outerRadius = geometry.outer[geometry.outer.length - 1];

  // Variant class on the CARD ONLY. The chip/strip/sheet must NOT carry
  // it: LayoutMobile's mini-card rules match the unhashed
  // `radar-legend-dark/light` substrings to hide the card, and routing
  // the other presentations through the same matcher put them at the
  // mercy of the maximized-state restore rules (review finding — the
  // card resurrected over the strip). They style their own colours
  // from the ambient tokens and have dedicated LayoutMobile rules.
  const variantClass = dark ? styles.radarLegendDark : styles.radarLegendLight;

  const sections = (
    <>
      {radarAnalysisEnabled ? (
        <div className={styles.legendSection}>
          <div className={styles.legendTitle}>{t("radar.legendRadii")}</div>
          <div className={styles.legendCircleRow}>
            <span className={styles.legendCircleSwatch} />
            <span className={styles.legendRadii}>
              {innerRadius}{NBSP}{unitLabel}
              {extendedRadarRadius ? (
                <>
                  <span className={styles.legendRadiiSep}> · </span>
                  {outerRadius}{NBSP}{unitLabel}
                </>
              ) : null}
            </span>
          </div>
        </div>
      ) : null}
      <div className={styles.legendSection}>
        <div className={styles.legendTitle}>{t("radar.legendPrecip")}</div>
        <PrecipScale />
        <div className={styles.scaleLabels}>
          <span>{t("radar.light")}</span>
          <span>{t("radar.extreme")}</span>
        </div>
      </div>
      {showWeatherAlerts ? (
        <div className={styles.legendSection}>
          <div className={styles.legendTitle}>{t("radar.nearbyTitle")}</div>
          <div className={styles.alertTiers}>
            {ALERT_TIERS.map(({ swatch, key }) => (
              <span key={key} className={styles.alertTier}>
                <i className={`${styles.alertTierSwatch} ${styles[swatch]}`} />
                {t(`radar.${key}`)}
              </span>
            ))}
          </div>
          <div className={styles.alertCount}>
            {t("radar.nearbyWithin", { count: nearbyCount, radius: radiusDisplay, unit: unitLabel })}
            {nearbyResidualCount > 0 ? (
              <span className={styles.alertCountMore}>
                {" · "}
                {t("radar.nearbyNotMapped", { count: nearbyResidualCount })}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );

  // The compact "(i) Legend" pill. Under the overlay shell there are two
  // (the MID one and the raised MIN-with-scrubber one), told apart by
  // `overlayEl`; `live` false makes one inert (and hidden, styles.css). Each
  // overlay-shell element registers with the shell (`overlayRef`, undefined
  // elsewhere).
  const renderChip = (overlayEl, live) => (
    <button
      key={overlayEl || "chip"}
      ref={overlayEl ? overlayRef : undefined}
      type="button"
      className={styles.legendChip}
      onClick={() => setOverlayOpen(true)}
      aria-haspopup="dialog"
      aria-expanded={overlayOpen}
      title={t("radar.legendOpen")}
      data-pi-overlay-el={overlayEl}
      inert={!live}
    >
      <span className={styles.legendChipI} aria-hidden="true">i</span>
      <PrecipScale />
      {t("radar.legendTitle")}
    </button>
  );
  const renderCard = (overlayEl, live) => (
    <div key="card" ref={overlayEl ? overlayRef : undefined} className={`${styles.radarLegend} ${variantClass}`} data-pi-overlay-el={overlayEl} inert={!live}>
      {sections}
    </div>
  );

  let presentations;
  if (shell) {
    presentations = [
      renderChip("chip", shellLive === "chip"),
      renderChip("chip-raised", shellLive === "chipRaised"),
      renderCard("card", shellLive === "card"),
    ];
  } else {
    presentations = chipMode ? renderChip(undefined, true) : renderCard(undefined, true);
  }

  return (
    <>
      {presentations}
      <div className={styles.legendMobileStrip}>
        {radarAnalysisEnabled ? (
          <span>
            {innerRadius}
            {extendedRadarRadius ? `/${outerRadius}` : ""}
            {NBSP}
            {unitLabel}
          </span>
        ) : null}
        <PrecipScale />
        {showWeatherAlerts && nearbyCount > 0 ? (
          <span className={styles.legendMobileAlert}>
            <svg viewBox="0 0 18 16" aria-hidden="true">
              <path d="M9 1 L17 15 H1 Z" fill="currentColor" />
            </svg>
            {nearbyCount}
          </span>
        ) : null}
        <button
          type="button"
          className={styles.legendInfoBtn}
          onClick={() => setOverlayOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={overlayOpen}
          aria-label={t("radar.legendOpen")}
          title={t("radar.legendOpen")}
        >
          i
        </button>
      </div>
      {overlayOpen ? (
        <div className={styles.legendOverlay} role="dialog" aria-modal="true" aria-label={t("radar.legendTitle")}>
          <button
            type="button"
            className={styles.legendOverlayScrim}
            onClick={() => setOverlayOpen(false)}
            aria-label={t("radar.legendClose")}
            tabIndex={-1}
          />
          <div className={styles.legendOverlaySheet}>
            <div className={styles.legendOverlayHead}>
              <span className={styles.legendOverlayTitle}>{t("radar.legendTitle")}</span>
              <button
                type="button"
                className={styles.legendOverlayClose}
                onClick={() => setOverlayOpen(false)}
                aria-label={t("radar.legendClose")}
                title={t("radar.legendClose")}
              >
                <CloseIcon />
              </button>
            </div>
            {sections}
          </div>
        </div>
      ) : null}
    </>
  );
};

RadarLegend.propTypes = {
  dark: PropTypes.bool,
  chipMode: PropTypes.bool,
  shell: PropTypes.shape({
    overlayRef: PropTypes.func.isRequired,
    presentation: PropTypes.func.isRequired,
    subscribe: PropTypes.func.isRequired,
  }),
};

export default RadarLegend;
