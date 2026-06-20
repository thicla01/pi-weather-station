/* eslint-disable react/prop-types -- this panel has ~15 internal helper
 * components (Pill, Toggle, Field, Seg, …) that are only used inside
 * this file. Their shapes are documented via JSDoc on the exported
 * SettingsPanel; declaring PropTypes for every helper adds ~80 lines
 * of boilerplate for components no other file imports. */
import React, { useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { InlineIcon } from "@iconify/react";
import closeSharp from "@iconify/icons-ion/close-sharp";
import settingsAdjustIcon from "@iconify/icons-carbon/settings-adjust";
import passwordIcon from "@iconify/icons-carbon/password";
import constructIcon from "@iconify/icons-ion/construct-outline";
import eyeIcon from "@iconify/icons-ion/eye-outline";
import i18n from "~/i18n";
import { AppContext } from "~/AppContext";
import { getPalette } from "~/ui/tokens";
import { useTimeOfDay } from "~/ui/hybrid";
import { resolvePanelFontSizeZoom } from "~/ui/fontSize";
import styles from "./styles.css";

/**
 * Three-locale text helper. Returns the FR / ES / EN form based on
 * `lang`. Tiny inline shim that keeps JSX rows readable when we'd
 * otherwise chain `lang === "fr" ? X : lang === "es" ? Y : Z` —
 * same convention DebugPanel uses (`lbl` there too).
 *
 * CODIFIED EXCEPTION to the locale-files rule (CLAUDE.md → "Before
 * committing", maintainer decision 2026-06): allowed in SettingsPanel
 * and DebugPanel ONLY. Do not spread to kiosk-visible surfaces or to
 * alert content — those go through the i18n locale files.
 *
 * @param {string} lang — two-letter locale (`en` / `fr` / `es`)
 * @param {string} en  — English string (default fallback)
 * @param {string} fr  — French string
 * @param {string} es  — Spanish string
 * @returns {string}
 */
const lbl = (lang, en, fr, es) => (lang === "fr" ? fr : lang === "es" ? es : en);

// Rail sections — single-selection navigation, reusing the DebugPanel
// rail grammar (icon-above-short-label chips, compact ≤520px). Order
// is the local→server gradient: device-local prefs first, server
// config next, advanced + preview last. The panel always opens on the
// first entry (`local`) — a settings panel reads better when it's
// predictable, so unlike DebugPanel we do NOT persist the last tab.
const SECTIONS = [
  { id: "local", icon: settingsAdjustIcon, label: (lang) => lbl(lang, "Local", "Préf.", "Local") },
  { id: "api", icon: passwordIcon, label: () => "API" },
  { id: "avance", icon: constructIcon, label: (lang) => lbl(lang, "Advanced", "Avancé", "Avanzado") },
  { id: "apercu", icon: eyeIcon, label: (lang) => lbl(lang, "Preview", "Aperçu", "Vista") },
];

/**
 * Map the five individual unit selections back to a single
 * "Metric" / "Imperial" preset, or "custom" when the user has
 * mixed them (e.g. °C + mph, or metric units with the kPa
 * barometer reading). Used by the unit-system Seg to highlight
 * the active preset; "custom" results in neither button reading
 * as active, which is the right signal for "your individual
 * selectors below are the source of truth".
 *
 * @param {string} t tempUnit ("c" / "f" / "k")
 * @param {string} s speedUnit ("kmh" / "ms" / "mph")
 * @param {string} l lengthUnit ("mm" / "in")
 * @param {string} d distanceUnit ("km" / "mi")
 * @param {string} p pressureUnit ("hpa" / "inhg" / "kpa")
 * @returns {"metric"|"imperial"|"custom"}
 */
function unitSystemPreset(t, s, l, d, p) {
  if (t === "c" && s === "kmh" && l === "mm" && d === "km" && p === "hpa") return "metric";
  if (t === "f" && s === "mph" && l === "in" && d === "mi" && p === "inhg") return "imperial";
  return "custom";
}

/**
 * Direction C Settings panel — port of the Claude Design canvas at
 * `docs/design-references/settings-debug/project/lib/settings-panel.jsx`
 * variant B (tight list) for the API keys block.
 *
 * Structure (4 sections, decreasing local-vs-server gradient):
 *
 *   1. Préférences locales         — language, font size, dark mode,
 *                                    clock, units (×5), hide flags
 *   2. Configuration & clés API    — settings.json side, write-locked
 *                                    from remote clients; API keys
 *                                    (variant B), coords, radar source,
 *                                    brightness, Homebridge
 *   3. Avancé                       — collapsible; display / AI / sleep
 *   4. Expérimental                 — collapsible; feature flags
 *
 * Renders inside a fixed-position overlay (z-index 5000), same
 * positioning convention as v2 Settings, but with Direction C
 * tokens for the surface and typography. The host kiosk's
 * `experimentalUiC` flag drives whether v2 Settings or this panel
 * appears when the user taps the gear icon.
 *
 * @returns {JSX.Element|null} settings overlay, or null when closed
 */
const SettingsPanel = () => {
  const { i18n } = useTranslation();
  const ctx = useContext(AppContext);
  const {
    settingsMenuOpen,
    setSettingsMenuOpen,
    isLocal,
    fontSize,
  } = ctx;
  // Single-selection rail navigation. Always opens on the first
  // section (`local`) — a settings panel reads better when predictable,
  // so we deliberately do NOT persist the last tab the way DebugPanel
  // does for its multi-select buckets.
  const [activeSection, setActiveSection] = useState("local");
  // SettingsPanel renders as a sibling of AmbientLayers in the App
  // tree, so it can't inherit the `--c-*` palette tokens that
  // AmbientLayers sets on its own root. Compute the palette here
  // and mirror it on the overlay's own root inline style — the
  // descendant CSS Module rules pick the tokens up exactly the same
  // way the rest of Direction C does. Hooks fire before the early
  // return so React's hook ordering invariant stays satisfied.
  const tod = useTimeOfDay();
  const palette = getPalette(tod);

  if (!settingsMenuOpen) return null;

  const lang = (i18n.language || "en").slice(0, 2);
  const remote = !isLocal;
  const cssVars = {
    "--c-bg": palette.bg,
    "--c-text": palette.text,
    "--c-text-dim": palette.textDim,
    "--c-accent": palette.accent,
    "--c-accent-soft": palette.accentSoft,
    "--c-surface": palette.surface,
    "--c-surface-hybrid": palette.surfaceHybrid,
    "--c-border": palette.border,
    "--c-border-hybrid": palette.borderHybrid,
    "--c-warn": palette.warn,
    "--c-danger": palette.danger,
    "--c-cool": palette.cool,
    // Apply the user's text-size preference here too — SettingsPanel
    // renders outside `.ambientRoot` so it doesn't pick up
    // `--c-font-scale` via the cascade. Setting `zoom` on the overlay
    // root scales every descendant font-size proportionally. Uses the
    // panel-boosted resolver so the baseline lands one notch above
    // the main UI's scale (`current L` becomes `new S` per user
    // request).
    zoom: resolvePanelFontSizeZoom(fontSize),
  };

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" style={cssVars}>
      {/* No title header (Phase 6): the per-section header below already
        * names where you are ("1 · Préférences locales"), so a separate
        * "Paramètres" bar was redundant and cost ~60px of height that the
        * 7" kiosk and phones can't spare. The exit lives on the rail as a
        * terminal "Fermer" action instead — a floating top-right × would
        * collide with the section headers' right-aligned pills
        * (MODIFIABLE / active-count). */}
      <div className={styles.body}>
        <nav
          className={styles.rail}
          role="group"
          aria-label={lbl(lang, "Settings sections", "Sections des paramètres", "Secciones de ajustes")}
        >
          {SECTIONS.map((s) => {
            const isActive = activeSection === s.id;
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={isActive}
                className={`${styles.railButton} ${isActive ? styles.railButtonActive : ""}`}
                onClick={(e) => {
                  setActiveSection(s.id);
                  // Drop focus after a mouse / touch activation so the
                  // tab doesn't keep `:focus-visible` styling that could
                  // be misread as "pressed" — same tactile fix as the
                  // DebugPanel rail (Pi Chromium kiosk lingering fill).
                  e.currentTarget.blur();
                }}
              >
                <span className={styles.railIcon}><InlineIcon icon={s.icon} /></span>
                <span className={styles.railLabel}>{s.label(lang)}</span>
              </button>
            );
          })}
          {/* Exit — pinned to the far end of the rail (bottom when
            * vertical, right when horizontal), visually separated and
            * never carrying the active accent so it doesn't read as a
            * 5th section. */}
          <button
            type="button"
            className={`${styles.railButton} ${styles.railClose}`}
            onClick={() => setSettingsMenuOpen(false)}
            aria-label={lbl(lang,
              "Close settings and return to the map",
              "Fermer les paramètres et revenir à la carte",
              "Cerrar los ajustes y volver al mapa")}
          >
            <span className={styles.railIcon}><InlineIcon icon={closeSharp} /></span>
            <span className={styles.railLabel}>{lbl(lang, "Close", "Fermer", "Cerrar")}</span>
          </button>
        </nav>

        <main className={styles.pane}>
          <div className={styles.paneInner}>
            {activeSection === "local" && <SectionLocalPrefs ctx={ctx} lang={lang} />}
            {activeSection === "api" && <SectionConfig ctx={ctx} lang={lang} remote={remote} />}
            {activeSection === "avance" && <SectionAdvanced ctx={ctx} lang={lang} remote={remote} />}
            {activeSection === "apercu" && <SectionPreview ctx={ctx} lang={lang} remote={remote} />}
          </div>
          <PaneFooter lang={lang} section={activeSection} />
        </main>
      </div>
    </div>
  );
};

// ───────────────────────────────────────────────────────────────────
// Section 1 · Préférences locales
// ───────────────────────────────────────────────────────────────────

/**
 * Local preferences section — these write to localStorage on the
 * client, no remote-write security gate applies. Renders even when
 * `remote === true`.
 *
 * @param {object} props
 * @param {object} props.ctx — AppContext value
 * @param {Function} props.t — react-i18next translator
 * @param {string} props.lang — short locale ("fr" | "en" | "es")
 * @returns {JSX.Element}
 */
const SectionLocalPrefs = ({ ctx, lang }) => {
  // Phase 8b wires the writes — every preference is now persisted via
  // the existing AppContext `saveXxx` helpers (each one mirrors the
  // value to localStorage). The v2 Settings overlay uses the same
  // helpers under the hood, so v2 + v3 share the same persistence
  // path and a change made in one is immediately reflected by the
  // other on reload.
  const {
    fontSize, saveFontSize,
    clockTime, saveClockTime,
    tempUnit, saveTempUnit,
    speedUnit, saveSpeedUnit,
    lengthUnit, saveLengthUnit,
    distanceUnit, saveDistanceUnit,
    pressureUnit, savePressureUnit,
    mouseHide, saveMouseHide,
    showAdvisoryAlerts, saveShowAdvisoryAlerts,
    autoSelectTab, saveAutoSelectTab,
    showAlertRing, saveShowAlertRing,
  } = ctx;

  // The MouseHide / HideRadarLegend save helpers take a JSON-encoded
  // string ("true" / "false") so they're symmetrical with the v2
  // Select component that calls them. Wrap the Toggle's boolean
  // onChange into that shape.
  const saveBoolFlag = (saver) => (v) => saver(JSON.stringify(Boolean(v)));

  return (
    <div className={styles.section}>
      <SectionHeader
        index="1"
        title={lbl(lang, "Local preferences", "Préférences locales", "Preferencias locales")}
        subtitle={lbl(lang,
          "Stored in the browser. No restart required.",
          "Stockées dans le navigateur. Pas de redémarrage requis.",
          "Almacenadas en el navegador. Sin reinicio.")}
      />

      <div className={styles.grid8}>
        <Seg
          label={lbl(lang, "Language", "Langue", "Idioma")}
          options={[{ v: "en", l: "EN" }, { v: "fr", l: "FR" }, { v: "es", l: "ES" }]}
          value={lang}
          onChange={(v) => i18nChangeLanguage(v)}
        />
        <Seg
          label={lang === "fr" ? "Taille texte" : lang === "es" ? "Tamaño texto" : "Font size"}
          /* Letters per language: clothing-style sizing initials.
           * EN: S/M/L (Small/Medium/Large) — universal.
           * FR: P/M/G (Petit/Moyen/Grand).
           * ES: P/M/G (Pequeño/Mediano/Grande). */
          options={lang === "fr" || lang === "es"
            ? [{ v: "s", l: "P" }, { v: "m", l: "M" }, { v: "l", l: "G" }]
            : [{ v: "s", l: "S" }, { v: "m", l: "M" }, { v: "l", l: "L" }]}
          value={fontSize || "m"}
          onChange={saveFontSize}
        />
        {/* Dark mode "AUTO / MANUEL" segmented control removed in
         * v2.14.72 — the dock now carries a dedicated auto-toggle
         * button next to the contrast toggle, so the panel duplicate
         * was redundant. The underlying state (`darkModeAuto`) and
         * its setter (`saveDarkModeAuto`) still live in AppContext
         * for the dock button + any future re-introduction. */}
        <Seg
          label={lbl(lang, "Clock", "Horloge", "Reloj")}
          options={[{ v: "12", l: "12h" }, { v: "24", l: "24h" }]}
          value={clockTime}
          onChange={saveClockTime}
        />
        <Seg
          label={lbl(lang, "Units", "Unités", "Unidades")}
          /* One-tap preset that flips all four unit selectors below
           * to a coherent system. Useful for users (or their friends)
           * who don't want to know the difference between mph / m/s /
           * km/h and just want everything in one or the other system.
           * When the four selectors are in a mixed state (e.g. °C +
           * mph), neither preset reads as active — the individual
           * selectors remain authoritative. */
          options={[
            { v: "metric", l: lbl(lang, "Metric", "Métrique", "Métrico") },
            { v: "imperial", l: lbl(lang, "Imperial", "Impérial", "Imperial") },
          ]}
          value={unitSystemPreset(tempUnit, speedUnit, lengthUnit, distanceUnit, pressureUnit)}
          onChange={(preset) => {
            if (preset === "metric") {
              saveTempUnit("c");
              saveSpeedUnit("kmh");
              saveLengthUnit("mm");
              saveDistanceUnit("km");
              savePressureUnit("hpa");
            } else if (preset === "imperial") {
              saveTempUnit("f");
              saveSpeedUnit("mph");
              saveLengthUnit("in");
              saveDistanceUnit("mi");
              savePressureUnit("inhg");
            }
          }}
        />
        <Seg
          label="Temp"
          options={[{ v: "f", l: "°F" }, { v: "c", l: "°C" }, { v: "k", l: "K" }]}
          value={tempUnit}
          onChange={saveTempUnit}
        />
        <Seg
          label={lbl(lang, "Speed", "Vent", "Viento")}
          options={[{ v: "mph", l: "mph" }, { v: "ms", l: "m/s" }, { v: "kmh", l: "kph" }]}
          value={speedUnit}
          onChange={saveSpeedUnit}
        />
        <Seg
          label={lbl(lang, "Length", "Précip.", "Precip.")}
          options={[{ v: "in", l: "in" }, { v: "mm", l: "mm" }]}
          value={lengthUnit}
          onChange={saveLengthUnit}
        />
        <Seg
          label="Dist."
          options={[{ v: "mi", l: "mi" }, { v: "km", l: "km" }]}
          value={distanceUnit}
          onChange={saveDistanceUnit}
        />
        {/* Pressure (v3.1 Phase 2 — the 4th metric tile). kPa is the
          * Environment Canada / MétéoMédia reading convention, offered
          * for Canadian kiosks even though no preset selects it (manual
          * choice → the preset Seg correctly reads "custom"). */}
        <Seg
          label={lbl(lang, "Pressure", "Pression", "Presión")}
          options={[{ v: "hpa", l: "hPa" }, { v: "inhg", l: "inHg" }, { v: "kpa", l: "kPa" }]}
          value={pressureUnit}
          onChange={savePressureUnit}
        />
      </div>

      <div className={styles.toggleRow}>
        <Toggle
          label={lbl(lang, "Hide mouse pointer", "Masquer le pointeur de la souris", "Ocultar puntero del ratón")}
          value={Boolean(mouseHide)}
          onChange={saveBoolFlag(saveMouseHide)}
        />
        {/* "Hide radar legend" toggle removed in v2.14.73 — the
         * radar legend has its own dedicated toggle in the dock now
         * (carbon:legend, gated on the active RainViewer source).
         * State + setter still in AppContext for the dock button. */}
      </div>

      {/* Advisory-alert opt-in (per-device, localStorage). Off by
        * default so the quieter red/orange-only banner stack stays the
        * norm; a flood-prone user (k5map) enables it to also see
        * yellow-tier advisories that often escalate to warnings. The
        * label deliberately says "advisory", never "yellow" — the
        * requester noted the colour name means nothing to them. */}
      <div className={styles.toggleRow}>
        <Toggle
          label={lbl(lang, "Show advisory alerts", "Afficher les avis", "Mostrar avisos")}
          sub={lbl(lang,
            "Also surface advisory-level alerts (Flood / Heat / Wind Advisory). Off by default.",
            "Affiche aussi les alertes de niveau « avis » (avis de crue, de chaleur, de vent). Désactivé par défaut.",
            "Muestra también las alertas de nivel « aviso » (aviso de inundación, calor, viento). Desactivado por defecto.")}
          value={Boolean(showAdvisoryAlerts)}
          onChange={saveBoolFlag(saveShowAdvisoryAlerts)}
        />
      </div>

      {/* Alert-radius-ring toggle (per-device, localStorage). On by
        * default so the existing "polygons + ring" look is preserved.
        * Turning it off keeps the alert polygons (the real geometry)
        * while hiding the dashed proxy circle — requested by mlcampbe,
        * who wanted the polygon boxes without the ring. Only affects the
        * map when the nearby-alerts layer is on (dock toggle). */}
      <div className={styles.toggleRow}>
        <Toggle
          label={lbl(lang, "Show alert radius ring", "Afficher l'anneau du rayon d'alerte", "Mostrar el anillo del radio de alerta")}
          sub={lbl(lang,
            "Draws the dashed circle at the alert radius. Turn off to keep only the alert polygons. On by default.",
            "Trace le cercle pointillé au rayon d'alerte. Désactiver pour ne garder que les polygones d'alerte. Activé par défaut.",
            "Dibuja el círculo punteado en el radio de alerta. Desactívalo para conservar solo los polígonos de alerta. Activado por defecto.")}
          value={Boolean(showAlertRing)}
          onChange={saveBoolFlag(saveShowAlertRing)}
        />
      </div>

      {/* Auto-select forecast tab (per-device, localStorage). Off by
        * default (opt-in): when on, the forecast chart's metric tab
        * (Temp/Wind/Precip) follows active hazards — gov alerts +
        * forecast thresholds. See docs/auto-forecast-tab-selection-design.md.
        * On a non-touch display (stable monitor) it switches even at idle
        * stage 0 since there's no reader to protect. */}
      <div className={styles.toggleRow}>
        <Toggle
          label={lbl(lang, "Auto-select forecast tab", "Sélection auto de l'onglet", "Selección automática de pestaña")}
          sub={lbl(lang,
            "Switches Temp/Wind/Precip when the weather turns. Off by default.",
            "Bascule Temp/Vent/Précip selon la météo. Désactivé par défaut.",
            "Cambia Temp/Viento/Precip. según el tiempo. Desactivado por defecto.")}
          value={Boolean(autoSelectTab)}
          onChange={saveBoolFlag(saveAutoSelectTab)}
        />
      </div>

      {/* Trust-this-Pi helper. Downloads the self-signed CA cert
       * with `Content-Type: application/x-x509-ca-cert` so iOS /
       * Android offer to install it as a trusted profile. Solves
       * the "P on black" home-screen icon issue (iOS rejects the
       * apple-touch-icon background fetch over an untrusted cert)
       * AND removes the "Not secure" warning when navigating to
       * the Pi from a remote browser. See `docs/pwa-trust-cert.md`
       * for the per-platform install steps. */}
      <div className={styles.trustCert}>
        <div className={styles.trustCertLabel}>
          {lbl(lang,
            "Trust this Pi on this device",
            "Faire confiance à ce Pi sur cet appareil",
            "Confiar en este Pi en este dispositivo")}
        </div>
        <div className={styles.trustCertDesc}>
          {lbl(lang,
            "Installs the Pi's certificate as a trusted profile. Fixes the home-screen icon on iOS and dismisses the security warning. See the guide for per-platform steps.",
            "Installe le certificat du Pi comme profil de confiance. Corrige l'icône d'écran d'accueil sur iOS et fait disparaître l'avertissement de sécurité. Voir le guide pour les étapes par plateforme.",
            "Instala el certificado del Pi como perfil de confianza. Corrige el icono de la pantalla de inicio en iOS y elimina la advertencia de seguridad. Vea la guía para los pasos por plataforma.")}
        </div>
        <div className={styles.trustCertActions}>
          <a className={styles.trustCertLink} href="/api/cert.pem" download="pi-weather-cert.pem">
            {lbl(lang, "Download cert", "Télécharger le cert", "Descargar cert")}
          </a>
          <a
            className={styles.trustCertLinkSecondary}
            /* Resolve the guide URL to the matching language file —
             * we only ship _en / _fr / _es. Any other locale (and
             * the unlikely null/empty case) falls back to the
             * English guide. */
            href={`https://github.com/thicla01/pi-weather-station/blob/master/docs/pwa-trust-cert_${["fr", "es"].includes(lang) ? lang : "en"}.md`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {lbl(lang, "Read the guide", "Lire le guide", "Leer la guía")} ↗
          </a>
        </div>
      </div>
    </div>
  );
};

// Language switch helper — calls the i18next instance imported at
// the top of this file so the change persists via the existing
// localStorage detector (the same path the v2 Settings overlay uses).
function i18nChangeLanguage(lang) {
  i18n.changeLanguage(lang);
}

// ───────────────────────────────────────────────────────────────────
// Section 2 · Configuration & clés API
// ───────────────────────────────────────────────────────────────────

/**
 * Server-side configuration. Write-locked from remote clients via the
 * `localhostOnly` middleware on `/api/settings`; the remote notice
 * appears when `remote === true` and the field inputs render as
 * read-only status pills instead of editable inputs.
 *
 * API keys block uses variant B (tight list with inline status pills)
 * per the Claude Design canvas RECOMMENDED label.
 *
 * @param {object} props
 * @param {object} props.ctx — AppContext value
 * @param {Function} props.t — translator
 * @param {string} props.lang — short locale
 * @param {boolean} props.remote — true when accessed from non-localhost
 * @returns {JSX.Element}
 */
const SectionConfig = ({ ctx, lang, remote }) => {
  const {
    mapApiKey, weatherApiKey, reverseGeoApiKey,
    anthropicApiKey, airNowApiKey, openAqApiKey,
    customLat, customLon,
    radarSource, saveRadarSource,
    brightnessPercent, brightnessAvailable, brightnessMinPercent, setBrightnessLive,
    saveSettingsToJson,
  } = ctx;

  // Draft state for every server-side field that the user can edit.
  // Initial values come from AppContext (the current persisted
  // settings.json); changes accumulate locally until the user hits
  // Save. This matches the v2 pattern where keys + coords were
  // committed as a single batch via /settings PUT — partial commits
  // would risk leaving the server in a half-configured state where
  // e.g. the new Tomorrow.io key was saved but the old AirNow key
  // never got the chance to be flushed.
  const [draft, setDraft] = useState({
    mapApiKey: mapApiKey || "",
    weatherApiKey: weatherApiKey || "",
    reverseGeoApiKey: reverseGeoApiKey || "",
    anthropicApiKey: anthropicApiKey || "",
    airNowApiKey: airNowApiKey || "",
    openAqApiKey: openAqApiKey || "",
    customLat: customLat != null ? String(customLat) : "",
    customLon: customLon != null ? String(customLon) : "",
  });
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved | error
  const [saveError, setSaveError] = useState(null);

  // Re-sync the draft whenever AppContext sends us fresh persisted
  // values (e.g. after a save round-trips successfully). Only sync
  // when the draft is clean for that field — never clobber the user's
  // in-flight edits.
  useEffect(() => {
    setDraft((prev) => ({
      mapApiKey: prev.mapApiKey === "" ? (mapApiKey || "") : prev.mapApiKey,
      weatherApiKey: prev.weatherApiKey === "" ? (weatherApiKey || "") : prev.weatherApiKey,
      reverseGeoApiKey: prev.reverseGeoApiKey === "" ? (reverseGeoApiKey || "") : prev.reverseGeoApiKey,
      anthropicApiKey: prev.anthropicApiKey === "" ? (anthropicApiKey || "") : prev.anthropicApiKey,
      airNowApiKey: prev.airNowApiKey === "" ? (airNowApiKey || "") : prev.airNowApiKey,
      openAqApiKey: prev.openAqApiKey === "" ? (openAqApiKey || "") : prev.openAqApiKey,
      customLat: prev.customLat === "" ? (customLat != null ? String(customLat) : "") : prev.customLat,
      customLon: prev.customLon === "" ? (customLon != null ? String(customLon) : "") : prev.customLon,
    }));
  }, [mapApiKey, weatherApiKey, reverseGeoApiKey, anthropicApiKey, airNowApiKey, openAqApiKey, customLat, customLon]);

  // `isDirty` used to gate the Save button's disabled attribute, but
  // it caused the "Save click does nothing" UX bug — the button looked
  // identical to enabled state in nightRed mode at boosted zoom, but
  // didn't react because nothing had been edited yet. Save is now
  // unconditionally available in local mode (idempotent on the server),
  // so the dirty check is no longer required. Kept as a comment marker
  // in case a future "only save when changed" UI brings it back.

  const updateDraft = (key) => (value) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    if (saveState === "saved") setSaveState("idle");
    if (saveState === "error") {
      setSaveState("idle");
      setSaveError(null);
    }
  };

  const onSave = () => {
    // Always run when called — the button's `disabled` attribute used
    // to gate on `isDirty`, but the user reported "no visual feedback"
    // on Save click (2.14.18). Most likely the button looked clickable
    // but was actually disabled because nothing had changed yet. Now
    // the button stays enabled whenever a save is possible (local mode
    // + saveSettingsToJson available + not already saving), and a
    // no-op save still flashes "✓ Saved" so the user knows the click
    // was acknowledged. Server-side this is idempotent — same values
    // produce the same persisted state.
    if (typeof saveSettingsToJson !== "function" || remote || saveState === "saving") return;
    setSaveState("saving");
    setSaveError(null);
    saveSettingsToJson({
      mapsKey: draft.mapApiKey,
      weatherKey: draft.weatherApiKey,
      geoKey: draft.reverseGeoApiKey,
      anthropicKey: draft.anthropicApiKey,
      airNowKey: draft.airNowApiKey,
      openAqKey: draft.openAqApiKey,
      lat: draft.customLat,
      lon: draft.customLon,
    })
      .then(() => {
        setSaveState("saved");
        setTimeout(() => setSaveState("idle"), 2500);
      })
      .catch((err) => {
        setSaveError(err?.response?.data?.error || err?.message || "Save failed");
        setSaveState("error");
      });
  };

  const providers = [
    { id: "mapApiKey", name: "Mapbox", tier: "required",
      unlocks: lbl(lang, "Map tiles + styles", "Tuiles de carte + styles", "Teselas y estilos de mapa") },
    { id: "weatherApiKey", name: "Tomorrow.io", tier: "required",
      unlocks: lbl(lang, "Hourly + daily forecast", "Prévisions horaires + 5 jours", "Pronóstico horario + 5 días") },
    { id: "reverseGeoApiKey", name: "LocationIQ", tier: "optional",
      unlocks: lbl(lang, "Reverse geocoding · place name", "Géocodage inverse · nom de lieu", "Geocodificación inversa · nombre del lugar") },
    { id: "anthropicApiKey", name: "Anthropic", tier: "optional",
      unlocks: lbl(lang, "AI weather summary (Claude Haiku)", "Résumé météo IA (Claude Haiku)", "Resumen meteorológico IA (Claude Haiku)") },
    { id: "airNowApiKey", name: "EPA AirNow", tier: "optional",
      unlocks: lbl(lang, "US air-quality index (AQI)", "Indice qualité d'air US (AQI)", "Índice de calidad del aire EE.UU. (AQI)") },
    { id: "openAqApiKey", name: "OpenAQ", tier: "optional",
      unlocks: lbl(lang, "Global air-quality fallback", "Repli qualité d'air mondial", "Calidad del aire global (respaldo)") },
  ];

  return (
    <div className={styles.section}>
      <SectionHeader
        index="2"
        title={lbl(lang, "Configuration & API keys", "Configuration & clés API", "Configuración y claves API")}
        subtitle={lbl(lang,
          "Server-side settings.json. Local writes only.",
          "settings.json côté serveur. Écriture locale uniquement.",
          "settings.json del servidor. Escritura local únicamente.")}
        right={(
          <Pill kind={remote ? "optional" : "ok"}>
            {remote
              ? lbl(lang, "READ-ONLY", "LECTURE SEULE", "SOLO LECTURA")
              : lbl(lang, "EDITABLE", "MODIFIABLE", "EDITABLE")}
          </Pill>
        )}
      />

      {remote && <RemoteNotice lang={lang} />}

      <div className={styles.subhead}>
        {lbl(lang, "API keys", "Clés API", "Claves API")}
      </div>
      <ApiKeysList
        providers={providers}
        remote={remote}
        draft={draft}
        onChange={updateDraft}
        lang={lang}
      />

      <div className={`${styles.subhead} ${styles.subheadGap}`}>
        {lbl(lang, "Location & hardware", "Localisation & matériel", "Ubicación y hardware")}
      </div>
      <div className={`${styles.grid4} ${styles.gridLocationHardware}`}>
        {/* Pre-2.14.21 the Latitude field carried a "Copier" CopyButton
         * trailing the input. That belonged on the Debug panel's
         * Current-Position row (where it's still useful — diagnostic
         * copy-coords action) and crept into Settings by accident.
         * Removed here — the value is already user-editable in this
         * view, so copy is redundant. */}
        {remote ? (
          <Field
            label={lbl(lang, "Latitude", "Latitude", "Latitud")}
            value={customLat != null ? customLat : "—"}
            unit="°"
            mono
            selectable
          />
        ) : (
          <EditableField
            label={lbl(lang, "Latitude", "Latitude", "Latitud")}
            pill={lbl(lang, "Override", "Manuel", "Manual")}
            value={draft.customLat}
            unit="°"
            mono
            placeholder="45.5017°"
            onChange={updateDraft("customLat")}
            onClear={() => updateDraft("customLat")("")}
            clearLabel={lbl(lang, "Auto", "Auto", "Auto")}
            helper={lbl(lang,
              "Empty = automatic geolocation. « Auto » clears the field to fall back to detection. Never sent to an external service.",
              "Vide = géolocalisation automatique. « Auto » efface le champ pour revenir à la détection. Jamais transmis à un service externe.",
              "Vacío = geolocalización automática. « Auto » borra el campo para volver a la detección. Nunca se envía a un servicio externo.")}
          />
        )}
        {remote ? (
          <Field
            label="Longitude"
            value={customLon != null ? customLon : "—"}
            unit="°"
            mono
            selectable
          />
        ) : (
          <EditableField
            label="Longitude"
            pill={lbl(lang, "Override", "Manuel", "Manual")}
            value={draft.customLon}
            unit="°"
            mono
            placeholder="−73.5673°"
            onChange={updateDraft("customLon")}
            onClear={() => updateDraft("customLon")("")}
            clearLabel={lbl(lang, "Auto", "Auto", "Auto")}
            helper={lbl(lang,
              "Empty = automatic geolocation.",
              "Vide = géolocalisation automatique.",
              "Vacío = geolocalización automática.")}
          />
        )}
        <Seg
          label={lbl(lang, "Radar source", "Source radar", "Fuente radar")}
          options={[{ v: "rainviewer", l: "RainViewer" }, { v: "eccc", l: "ECCC" }]}
          value={radarSource || "rainviewer"}
          onChange={saveRadarSource}
          disabled={remote}
        />
        {brightnessAvailable ? (
          <BrightnessSlider
            label={lbl(lang, "Brightness", "Luminosité", "Brillo")}
            value={brightnessPercent}
            min={brightnessMinPercent ?? 10}
            onChange={setBrightnessLive}
            disabled={remote}
          />
        ) : (
          <div />
        )}
      </div>

      {!remote ? (
        <div className={styles.saveBar}>
          <button
            type="button"
            className={styles.saveButton}
            onClick={onSave}
            disabled={saveState === "saving" || remote}
          >
            {saveState === "saving"
              ? lbl(lang, "Saving…", "Enregistrement…", "Guardando…")
              : saveState === "saved"
                ? lbl(lang, "✓ Saved", "✓ Enregistré", "✓ Guardado")
                : lbl(lang, "Save changes", "Enregistrer", "Guardar cambios")}
          </button>
          {saveState === "error" && saveError ? (
            <span className={styles.saveError}>{saveError}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

// ───────────────────────────────────────────────────────────────────
// Section 3 · Avancé
// ───────────────────────────────────────────────────────────────────

/**
 * Advanced settings — Display style / AI flags / sleep mode. Rendered
 * as one entry of the single-selection rail (Phase 6); the v2.14
 * collapsible disclosure was dropped when the rail took over section
 * navigation.
 *
 * @param {object} props
 * @param {object} props.ctx
 * @param {string} props.lang
 * @param {boolean} props.remote
 * @returns {JSX.Element}
 */
const SectionAdvanced = ({ ctx, lang, remote }) => {
  const {
    sleepEnabled,
    sleepStage1Delay,
    sleepStage1Brightness,
    sleepStage2Enabled,
    sleepStage2Delay,
    sleepNightMode,
    brightnessAvailable,
    brightnessMinPercent,
    debugEnabled,
    saveAdvancedSleepFlag,
    senseHatAvailable,
    senseHatMode,
    saveSenseHatMode,
    senseHatClockBrightness,
    setSenseHatClockBrightnessLive,
    senseHatRadarBrightness,
    setSenseHatRadarBrightnessLive,
    // Display group (Phase 8b — ported in 2.14.22)
    lightModeStyle,
    darkModeStyle,
    radarOpacityLight,
    radarOpacityDark,
    saveAdvancedDisplayFlag,
    setRadarOpacityLightLive,
    setRadarOpacityDarkLive,
    // Nearby-alerts radius (Phase 3)
    alertRadiusKm,
    setAlertRadiusKmLive,
    distanceUnit,
    // AI group
    radarAnalysisEnabled,
    extendedRadarRadius,
    showSamplingPoints,
    calmDayFastPath,
    saveAdvancedAiFlag,
    pollenEnabled,
    savePollenEnabled,
  } = ctx;
  // Each save helper returns a promise (POST /api/settings). Errors
  // are non-critical for the UI — log + swallow so a transient
  // network hiccup doesn't crash the panel. Wrap each save fn in a
  // tiny helper so the JSX stays clean.
  const sleep = (key) => (value) => {
    if (typeof saveAdvancedSleepFlag !== "function") return;
    Promise.resolve(saveAdvancedSleepFlag(key, value))
      .catch((err) => console.warn("[settings] sleep flag save failed", key, err));
  };
  const display = (key) => (value) => {
    if (typeof saveAdvancedDisplayFlag !== "function") return;
    Promise.resolve(saveAdvancedDisplayFlag(key, value))
      .catch((err) => console.warn("[settings] display flag save failed", key, err));
  };
  const ai = (key) => (value) => {
    if (typeof saveAdvancedAiFlag !== "function") return;
    Promise.resolve(saveAdvancedAiFlag(key, value))
      .catch((err) => console.warn("[settings] AI flag save failed", key, err));
  };
  const percentFormat = (v) => `${Math.round(v * 100)}%`;

  return (
    <div className={styles.section} style={{ opacity: remote ? 0.65 : 1 }}>
      <SectionHeader
        index="3"
        title={lbl(lang, "Advanced", "Avancé", "Avanzado")}
        subtitle={lbl(lang, "Display · AI · sleep", "Affichage · IA · veille", "Pantalla · IA · suspensión")}
      />
      <div className={styles.advBody}>
          {/* ── Display ───────────────────────────────────────────── */}
          <div className={styles.subhead}>
            {lbl(lang, "Display", "Affichage", "Pantalla")}
          </div>
          <div className={styles.grid4}>
            <Seg
              label={lbl(lang, "Map · light", "Carte · clair", "Mapa · claro")}
              options={[
                { v: "light-v10", l: "v10" },
                { v: "light-v11", l: "v11" },
                { v: "streets-v12", l: "Streets" },
              ]}
              value={lightModeStyle || "streets-v12"}
              onChange={display("lightModeStyle")}
              disabled={remote}
            />
            <Seg
              label={lbl(lang, "Map · dark", "Carte · sombre", "Mapa · oscuro")}
              options={[
                { v: "dark-v10", l: "v10" },
                { v: "dark-v11", l: "v11" },
              ]}
              value={darkModeStyle || "dark-v10"}
              onChange={display("darkModeStyle")}
              disabled={remote}
            />
            <RangeSlider
              label={lbl(lang, "Radar opacity · light", "Opacité radar · clair", "Opacidad radar · claro")}
              value={radarOpacityLight}
              min={0.05}
              max={1}
              step={0.05}
              format={percentFormat}
              onChange={setRadarOpacityLightLive}
              disabled={remote}
            />
            <RangeSlider
              label={lbl(lang, "Radar opacity · dark", "Opacité radar · sombre", "Opacidad radar · oscuro")}
              value={radarOpacityDark}
              min={0.05}
              max={1}
              step={0.05}
              format={percentFormat}
              onChange={setRadarOpacityDarkLive}
              disabled={remote}
            />
          </div>

          {/* ── Nearby alerts ──────────────────────────────────────── */}
          <div className={`${styles.subhead} ${styles.subheadGap}`}>
            {lbl(lang, "Nearby alerts", "Alertes à proximité", "Alertas cercanas")}
          </div>
          {/* Survey radius for the display-only nearby-alerts overlay.
              Stored canonically in km; the readout derives mi when the
              distance unit is imperial (50/60/…/100 km ≈ 31/37/…/62 mi). */}
          <RangeSlider
            label={lbl(lang, "Alert radius", "Rayon d'alerte", "Radio de alerta")}
            value={alertRadiusKm}
            min={50}
            max={100}
            step={10}
            format={(v) => (distanceUnit === "mi" ? `${Math.round(v / 1.609344)} mi` : `${v} km`)}
            onChange={setAlertRadiusKmLive}
            disabled={remote}
          />

          {/* ── AI / radar analysis ────────────────────────────────── */}
          <div className={`${styles.subhead} ${styles.subheadGap}`}>
            {lbl(lang, "AI · radar analysis", "IA · analyse radar", "IA · análisis radar")}
          </div>
          {/* grid2 (not grid4): each toggle carries a multi-line sub-text
           * label that wraps badly in a narrow cell. grid2 is SINGLE-column
           * across the whole kiosk family (< 1280 px) — at the 7" kiosk 2
           * columns left the sub-text only ~150 px and it wrapped word-per-word
           * — and only goes 2-col on the wide desktop panel (≥ 1280 px). See
           * the breakpoint rationale in styles.css (.grid2). */}
          <div className={styles.grid2}>
            <Toggle
              label={lbl(lang, "Radar analysis enabled", "Analyse radar activée", "Análisis radar activado")}
              value={Boolean(radarAnalysisEnabled)}
              onChange={ai("radarAnalysisEnabled")}
              disabled={remote}
              sub={lbl(lang,
                "Analysis rings + AI radar summary",
                "Cercles d'analyse + résumé IA radar",
                "Anillos de análisis + resumen IA radar")}
            />
            <Toggle
              /* The outer radar ring distance follows the unit (mirrors
                 RADAR_GEOMETRY's outer max: 100 km / 60 mi) — was hardcoded
                 "100 km", which read wrong in imperial. */
              label={(() => {
                const d = distanceUnit === "mi" ? "60 mi" : "100 km";
                return lbl(lang, `Extended radius (${d})`, `Rayon étendu (${d})`, `Radio extendido (${d})`);
              })()}
              value={Boolean(extendedRadarRadius)}
              onChange={ai("extendedRadius")}
              disabled={remote}
              sub={lbl(lang, "Adds the outer ring", "Ajoute l'anneau extérieur", "Añade el anillo exterior")}
            />
            <Toggle
              label={lbl(lang, "Sampling points", "Points d'échantillonnage", "Puntos de muestreo")}
              value={Boolean(showSamplingPoints)}
              onChange={ai("showSamplingPoints")}
              disabled={remote}
              sub={lbl(lang,
                "Show points read by the sampler",
                "Affiche les points lus par le détecteur",
                "Muestra los puntos leídos por el muestreador")}
            />
            <Toggle
              /* Detechnified label (Phase 6): the vendor name "Claude"
               * leaves the UI — the user only needs the BENEFIT (lower
               * API cost), not which LLM runs behind it. The mechanism
               * (still honestly "AI") stays in the sub-text. */
              label={lbl(lang,
                "AI call savings when skies are calm",
                "Économie d'appels IA quand le ciel est calme",
                "Ahorro de llamadas IA cuando el cielo está despejado")}
              value={Boolean(calmDayFastPath)}
              onChange={ai("calmDayFastPath")}
              disabled={remote}
              sub={lbl(lang,
                "Pauses the AI radar analysis when no precipitation is nearby.",
                "Suspend l'analyse radar par IA en l'absence de précipitations.",
                "Pausa el análisis de radar por IA cuando no hay precipitación cerca.")}
            />
            <Toggle
              label={lbl(lang, "Pollen badge", "Badge pollen", "Insignia de polen")}
              value={Boolean(pollenEnabled)}
              onChange={(v) => {
                if (typeof savePollenEnabled !== "function") return;
                Promise.resolve(savePollenEnabled(v))
                  .catch((err) => console.warn("[settings] pollen save failed", err));
              }}
              disabled={remote}
              sub={lbl(lang,
                "Show pollen in the metrics grid (Europe + most metros)",
                "Affiche le pollen dans la grille (Europe + grandes villes)",
                "Mostrar polen en la cuadrícula (Europa + grandes ciudades)")}
            />
          </div>

          {/* ── Sleep ──────────────────────────────────────────────── */}
          <div className={`${styles.subhead} ${styles.subheadGap}`}>
            {lbl(lang, "Sleep", "Veille", "Suspensión")}
          </div>
          {/* Sequence overview first, then the controls below — lets the
            * user see what each delay/brightness actually drives before
            * they tweak it. Bound to the live stage values. */}
          <VeilleTimeline
            stage1Delay={sleepStage1Delay}
            stage2Delay={sleepStage2Delay}
            stage2Enabled={sleepStage2Enabled}
            stage1Brightness={sleepStage1Brightness}
            lang={lang}
          />
          {/* Stage 1 — toggles separated from fields so each control
           * type renders in a visually consistent row (Toggle = horizontal
           * track+label; Field = vertical label-above-box). Mixing them
           * in the same grid row produced height mismatches. */}
          <div className={styles.toggleRow}>
            <Toggle
              label={lbl(lang, "Enable sleep", "Activer la veille", "Activar suspensión")}
              value={Boolean(sleepEnabled)}
              onChange={sleep("enabled")}
              disabled={remote}
            />
            <Toggle
              label={lbl(lang, "Red text at night", "Texte rouge nuit", "Texto rojo de noche")}
              value={Boolean(sleepNightMode)}
              onChange={sleep("nightMode")}
              disabled={remote}
            />
          </div>
          <div className={styles.grid4}>
            <DelaySelect
              label={lbl(lang, "Soft sleep · delay", "Veille douce · délai", "Suspensión suave · retraso")}
              value={sleepStage1Delay}
              options={SLEEP_STAGE1_DELAY_OPTIONS}
              onChange={(v) => sleep("stage1Delay")(v)}
              disabled={remote}
              lang={lang}
            />
            {brightnessAvailable ? (
              <RangeSlider
                label={lbl(lang, "Soft sleep · brightness", "Veille douce · lum.", "Suspensión suave · brillo")}
                value={sleepStage1Brightness}
                min={brightnessMinPercent ?? 10}
                max={100}
                step={5}
                onChange={(v) => sleep("stage1Brightness")(Math.round(v))}
                disabled={remote}
              />
            ) : (
              <Field
                label={lbl(lang, "Soft sleep · brightness", "Veille douce · lum.", "Suspensión suave · brillo")}
                value={sleepStage1Brightness ?? "—"}
                unit="%"
                mono
                disabled
              />
            )}
          </div>
          {/* Stage 2 — same pattern: toggle then fields */}
          <div className={styles.toggleRow} style={{ marginTop: 10 }}>
            <Toggle
              label={lbl(lang, "Deep sleep · enabled", "Veille profonde · activée", "Suspensión profunda · activada")}
              value={Boolean(sleepStage2Enabled)}
              onChange={sleep("stage2Enabled")}
              disabled={remote}
            />
          </div>
          {sleepStage2Enabled ? (
            <div className={styles.grid4}>
              <DelaySelect
                /* stage2Delay is INCREMENTAL (minutes AFTER soft sleep),
                 * hence the "+" — the absolute deep-sleep threshold is
                 * soft + this value, as shown on the VeilleTimeline. */
                label={lbl(lang, "Deep sleep · +delay", "Veille profonde · +délai", "Suspensión profunda · +retraso")}
                value={sleepStage2Delay}
                options={SLEEP_STAGE2_DELAY_OPTIONS}
                onChange={(v) => sleep("stage2Delay")(v)}
                disabled={remote}
                lang={lang}
              />
            </div>
          ) : null}

          {/* Sense HAT display-mode toggle — only rendered on the one
            * Pi in the fleet that has the HAT physically attached.
            * `senseHatAvailable` is set by useSenseHatMode after a
            * one-shot `python3 -c "import sense_hat"` probe on the
            * server side. */}
          {senseHatAvailable ? (
            <>
              <div className={`${styles.subhead} ${styles.subheadGap}`}>
                {lbl(lang, "Sense HAT", "Sense HAT", "Sense HAT")}
              </div>
              <div className={`${styles.grid4} ${styles.gridSenseHat}`}>
                <Seg
                  label={lbl(lang, "Display", "Affichage", "Pantalla")}
                  options={[
                    { v: "weather", l: lbl(lang, "Weather", "Météo", "Tiempo") },
                    { v: "clock",   l: lbl(lang, "Clock",   "Horloge", "Reloj") },
                    { v: "radar",   l: lbl(lang, "Radar",   "Radar",   "Radar") },
                    { v: "auto",    l: lbl(lang, "Auto",    "Auto",    "Auto") },
                  ]}
                  value={senseHatMode || "weather"}
                  onChange={saveSenseHatMode}
                  disabled={remote}
                />
                {/* Clock brightness slider — only shown when clock mode is
                  * active. Restarts pi-sensehat-clock.service server-side when
                  * the value lands. Min pinned to 20 % to match the radar
                  * slider (same scale → thumb aligns) and stay above the LED
                  * visibility floor — below ~15 % the matrix reads black. */}
                {senseHatMode === "clock" ? (
                  <RangeSlider
                    label={lbl(lang, "Clock brightness", "Luminosité horloge", "Brillo del reloj")}
                    value={senseHatClockBrightness}
                    min={20}
                    max={100}
                    step={5}
                    onChange={setSenseHatClockBrightnessLive}
                    disabled={remote}
                  />
                ) : null}
                {/* Radar brightness slider — shown in radar/auto modes. Scales
                  * the radar grid in BOTH day and night (like the clock slider;
                  * it used to dim only at night, which made it look broken in
                  * daytime). Applied live by the daemon (no restart) so it's
                  * smooth at any drag speed. Min pinned to 20 %: the heavier
                  * tiers stay visible there, below ~15 % the matrix goes black
                  * on both v1 and v2. Same min/scale as the clock slider so the
                  * thumb sits at the same place for the same %. */}
                {(senseHatMode === "radar" || senseHatMode === "auto") ? (
                  <RangeSlider
                    label={lbl(lang, "Radar brightness", "Luminosité radar", "Brillo radar")}
                    value={senseHatRadarBrightness}
                    min={20}
                    max={100}
                    step={5}
                    onChange={setSenseHatRadarBrightnessLive}
                    disabled={remote}
                  />
                ) : null}
              </div>
            </>
          ) : null}

          <div className={`${styles.subhead} ${styles.subheadGap}`}>
            {lbl(lang, "Diagnostic", "Diagnostic", "Diagnóstico")}
          </div>
          <div className={styles.toggleRow}>
            <Toggle
              label={lbl(lang, "Debug panel", "Panneau Débogage", "Panel depuración")}
              value={Boolean(debugEnabled)}
              disabled
              sub={lbl(lang, "(set via DEBUG=true on the service)", "(défini par DEBUG=true au service)", "(definido por DEBUG=true en el servicio)")}
            />
          </div>

          {/* Phase 8b note removed in 2.14.22 — Display + AI subsections
           * above complete the port. Anything still on the v2 Advanced
           * panel that isn't covered here is intentionally out of scope
           * for v3 (e.g. the calmDayFastPath toggle is now a checkbox
           * under "AI"; the v2-only "default zoom" field was a one-off
           * dev affordance that didn't survive Direction C). */}
      </div>
    </div>
  );
};

// ───────────────────────────────────────────────────────────────────
// Section 4 · Preview
// ───────────────────────────────────────────────────────────────────

/**
 * v3 preview toggle. Internally still uses the `experimentalUiC` key
 * for settings.json compatibility — only the label changed in v2.14
 * when the v3 UI was promoted from a debug-gated experiment to a
 * publicly-opt-in preview.
 *
 * @param {object} props
 * @param {object} props.ctx
 * @param {string} props.lang
 * @param {boolean} props.remote
 * @returns {JSX.Element}
 */
const SectionPreview = ({ ctx, lang, remote }) => {
  const { experimentalUiC, saveAdvancedExperimentalFlag } = ctx;
  const activeCount = experimentalUiC ? 1 : 0;

  return (
    <div className={styles.section} style={{ opacity: remote ? 0.65 : 1 }}>
      <SectionHeader
        index="4"
        title={lbl(lang, "Preview", "Aperçu", "Vista previa")}
        subtitle={lbl(lang,
          "Switch between the production v2 interface and the v3 preview.",
          "Bascule entre l'interface en production (v2) et l'aperçu v3.",
          "Cambia entre la interfaz v2 (producción) y la vista previa v3.")}
        right={(
          <Pill kind="optional">
            {activeCount} {lbl(lang, "active", "actif", "activa")}
          </Pill>
        )}
      />
      <div className={styles.advBody}>
        <div className={styles.flagRow}>
          <Toggle
            label={lbl(lang,
              "Ambient interface (v3 preview)",
              "Interface ambient (aperçu v3)",
              "Interfaz ambient (vista previa v3)")}
            value={Boolean(experimentalUiC)}
            onChange={(v) => saveAdvancedExperimentalFlag("uiC", v)}
            disabled={remote}
            sub={lbl(lang,
              "Disable to switch back to the classic v2 interface. Report bugs at GitHub Issues.",
              "Désactivez pour revenir à l'interface classique v2. Signalez les bugs sur GitHub Issues.",
              "Desactiva para volver a la interfaz clásica v2. Informa errores en GitHub Issues.")}
          />
        </div>
      </div>
    </div>
  );
};

// ───────────────────────────────────────────────────────────────────
// Helpers — Pill / StatusDot / Toggle / Field / Seg / SectionHeader
// ───────────────────────────────────────────────────────────────────

const Pill = ({ kind, children }) => (
  <span className={`${styles.pill} ${styles[`pill-${kind || "neutral"}`]}`}>
    {children}
  </span>
);

const StatusDot = ({ status }) => (
  <span className={`${styles.statusDot} ${styles[`statusDot-${status}`]}`} />
);

const Toggle = ({ label, value, onChange, disabled, sub }) => (
  <label className={`${styles.toggle} ${disabled ? styles.toggleDisabled : ""}`}>
    <span className={`${styles.toggleTrack} ${value ? styles.toggleTrackOn : ""}`}>
      <span className={styles.toggleThumb} />
    </span>
    <input
      type="checkbox"
      checked={Boolean(value)}
      onChange={(e) => !disabled && onChange && onChange(e.target.checked)}
      disabled={disabled}
      className={styles.toggleInput}
    />
    {label ? <span className={styles.toggleLabel}>{label}</span> : null}
    {sub ? <span className={styles.toggleSub}>{sub}</span> : null}
  </label>
);

// Sleep-stage delay options. Pre-2026-05 these lived inline in the v2
// AdvancedSettings panel as `<select>` choices. Brought into v3 here with
// extended coverage: the original presets (1/2/5/10/15/30 min for stage 1,
// 5/10/20/30 min for stage 2) plus 1 h / 2 h / 3 h — useful for the
// "leave the kiosk on for the evening, fade out after a while" use case
// that came up in field feedback.
const SLEEP_STAGE1_DELAY_OPTIONS = [1, 2, 5, 10, 15, 30, 60, 120, 180];
const SLEEP_STAGE2_DELAY_OPTIONS = [5, 10, 20, 30, 60, 120, 180];

/**
 * Format a delay in whole minutes as a human label. Values < 60 use the
 * existing `sleepMinutes` i18n key for the localised "n min" rendering;
 * values that are exact multiples of an hour collapse to "n h" so the
 * dropdown doesn't read as "120 min" / "180 min".
 *
 * @param {number} minutes
 * @param {string} lang `en` / `fr` / `es`
 * @returns {string}
 */
const formatDelayLabel = (minutes, lang) => {
  if (minutes >= 60 && minutes % 60 === 0) {
    const h = minutes / 60;
    return `${h} h`;
  }
  return lbl(
    lang,
    `${minutes} min`,
    `${minutes} min`,
    `${minutes} min`,
  );
};

// Schematic 3-segment sleep timeline. NOT drawn to scale (the deep
// stage is open-ended, so true scaling is impossible) — the segments
// are a fixed-proportion sequence diagram and the real thresholds live
// in the labels. Semantics are taken verbatim from useIdleDetection:
//   stage 1 = idle past `stage1Delay` MIN → screensaver, brightness
//             dimmed to `stage1Brightness` (minimal clock)
//   stage 2 = idle past `stage1Delay + stage2Delay` MIN → black screen
//             + anti-burn-in dot at the brightness floor (panel stays
//             ON — it never powers off). stage2Delay is INCREMENTAL
//             (minutes AFTER stage 1), so the deep threshold is the sum.
const VeilleTimeline = ({ stage1Delay, stage2Delay, stage2Enabled, stage1Brightness, lang }) => {
  const s1 = Number(stage1Delay) || 0;
  const deepThreshold = s1 + (Number(stage2Delay) || 0);
  const dim = stage1Brightness != null ? `${stage1Brightness}%` : null;
  const softSub = lbl(
    lang,
    `from ${formatDelayLabel(s1, lang)}${dim ? ` · ${dim}` : ""} + minimal clock`,
    `dès ${formatDelayLabel(s1, lang)}${dim ? ` · ${dim}` : ""} + horloge minimale`,
    `desde ${formatDelayLabel(s1, lang)}${dim ? ` · ${dim}` : ""} + reloj mínimo`,
  );
  const deepSub = stage2Enabled
    ? lbl(
      lang,
      `from ${formatDelayLabel(deepThreshold, lang)} · black screen, anti-burn-in dot`,
      `dès ${formatDelayLabel(deepThreshold, lang)} · écran noir, point anti-marquage`,
      `desde ${formatDelayLabel(deepThreshold, lang)} · pantalla negra, punto anti-marca`,
    )
    : lbl(lang, "disabled", "désactivée", "desactivada");
  return (
    <div className={styles.veilleTimeline}>
      <div className={styles.vtTrack} aria-hidden="true">
        <span className={`${styles.vtSeg} ${styles.vtSegActive}`} />
        <span className={`${styles.vtSeg} ${styles.vtSegSoft}`} />
        {stage2Enabled ? <span className={`${styles.vtSeg} ${styles.vtSegDeep}`} /> : null}
      </div>
      <div className={styles.vtLabels}>
        <div className={styles.vtLabel}>
          <strong>{lbl(lang, "On", "Allumé", "Encendido")}</strong>
          <span>0 → {formatDelayLabel(s1, lang)}</span>
        </div>
        <div className={styles.vtLabel}>
          <strong>{lbl(lang, "Soft sleep", "Veille douce", "Suspensión suave")}</strong>
          <span>{softSub}</span>
        </div>
        <div className={styles.vtLabel}>
          <strong>{lbl(lang, "Deep sleep", "Veille profonde", "Suspensión profunda")}</strong>
          <span>{deepSub}</span>
        </div>
      </div>
    </div>
  );
};

/**
 * Dropdown for sleep-stage delay selection. Custom popup (not a native
 * `<select>`) so the option list renders in the active palette (night /
 * nightRed) instead of the browser/OS theme.
 *
 * Why custom: native `<select>` popups are owned by the browser process —
 * Chromium and Firefox each apply their own forced text colour and OS
 * vibrancy regardless of CSS (`option { color: ... }`, `color-scheme`,
 * `select { background-color: ... }` all ignored to varying degrees).
 * v2.18 polish iterated on every CSS hack and confirmed both browsers
 * refuse to honour the palette in the popup. Replacing with a button +
 * `<ul role="listbox">` rendered in the React DOM gives us full
 * palette fidelity on all four kiosk targets (Chromium / Firefox on
 * Pi, Chrome / Firefox on macOS dev).
 *
 * Open-state dismissal mirrors `DetailsPopover`: pointerdown outside +
 * Escape key. Pointerdown is deferred via `setTimeout(_, 0)` so the
 * click that opened the menu doesn't immediately close it.
 *
 * @param {object} props
 * @param {string} props.label
 * @param {number|null} props.value current selection in minutes
 * @param {Array<number>} props.options minute values, ascending
 * @param {Function} props.onChange called with the new minute value
 * @param {boolean} [props.disabled]
 * @param {string} props.lang
 * @returns {JSX.Element}
 */
const DelaySelect = ({ label, value, options, onChange, disabled, lang }) => {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    // Defer the pointerdown listener so the click that opened the
    // menu (which is still propagating) doesn't immediately close it.
    const id = setTimeout(() => {
      document.addEventListener("pointerdown", onPointerDown);
    }, 0);
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(id);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={`${styles.field} ${disabled ? styles.fieldDisabled : ""}`}>
      <div className={styles.fieldLabel}>{label}</div>
      <div className={styles.dropdownWrap} ref={wrapperRef}>
        <button
          type="button"
          className={`${styles.fieldBox} ${styles.dropdownTrigger}`}
          onClick={() => { if (!disabled) setOpen((o) => !o); }}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span className={styles.dropdownValue}>{formatDelayLabel(value, lang)}</span>
          <span className={styles.dropdownChevron} aria-hidden="true">▾</span>
        </button>
        {open ? (
          <ul role="listbox" className={styles.dropdownMenu}>
            {options.map((m) => {
              const selected = value === m;
              return (
                <li
                  key={m}
                  role="option"
                  aria-selected={selected}
                  className={`${styles.dropdownOption} ${selected ? styles.dropdownOptionSelected : ""}`}
                  onClick={() => { onChange(m); setOpen(false); }}
                >
                  {formatDelayLabel(m, lang)}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
};

const Field = ({ label, value, unit, mono, disabled, selectable, trailing }) => (
  <div className={`${styles.field} ${disabled ? styles.fieldDisabled : ""}`}>
    <div className={styles.fieldLabel}>{label}</div>
    <div className={styles.fieldBox}>
      <span
        className={`${styles.fieldValue} ${mono ? styles.fieldValueMono : ""} ${selectable ? styles.fieldValueSelectable : ""}`}
      >
        {value}
      </span>
      {unit ? <span className={styles.fieldUnit}>{unit}</span> : null}
      {trailing ? <span className={styles.fieldTrailing}>{trailing}</span> : null}
    </div>
  </div>
);

/* CopyButton was used trailing the Latitude EditableField until
 * 2.14.21. Removed there because the value is already editable in
 * Settings — copy was redundant. The Debug panel keeps its own
 * inline copy affordance (DebugCopyButton on the Current Position
 * row) which is genuinely useful for diagnostics. */

const Seg = ({ label, options, value, onChange, disabled }) => (
  <div className={`${styles.seg} ${disabled ? styles.segDisabled : ""}`}>
    {label ? <div className={styles.segLabel}>{label}</div> : null}
    <div className={styles.segTrack}>
      {options.map((opt) => (
        <button
          key={String(opt.v)}
          type="button"
          className={`${styles.segButton} ${value === opt.v ? styles.segButtonActive : ""}`}
          onClick={() => !disabled && onChange && onChange(opt.v)}
          disabled={disabled}
        >
          {opt.l}
        </button>
      ))}
    </div>
  </div>
);

const SectionHeader = ({ index, title, subtitle, right }) => (
  <div className={styles.sectionHeader}>
    <div className={styles.sectionHeaderLeft}>
      <div className={styles.sectionHeaderTitle}>
        {/* `lockIcon` used to render the U+269F glyph as a "Local only"
         * cue here, but it falls back to a tofu rectangle in the
         * Geist font stack — the kiosk font set doesn't carry that
         * codepoint. The same information is now communicated by the
         * green "MODIFIABLE" pill on section 2; sections 3/4 are
         * implicitly local-only via the same write-path. The prop is
         * still accepted (no consumer change needed) but renders
         * nothing. */}
        <span>{index} · {title}</span>
      </div>
      {subtitle ? <div className={styles.sectionHeaderSubtitle}>{subtitle}</div> : null}
    </div>
    {right ? <div className={styles.sectionHeaderRight}>{right}</div> : null}
  </div>
);

// Per-section footer note. Honest about WHERE each section's changes
// land and HOW they're committed — the save model differs by section:
//   local  → localStorage, applied live, no save button anywhere
//   api    → settings.json, BATCHED behind the Save button inside
//            SectionConfig (keys + coords commit together)
//   avance → settings.json, each flag POSTs immediately on change
//   apercu → settings.json immediate, but only visible after reload
// The note is informational only — it never carries a save button, so
// it can't imply a commit model the section doesn't actually use
// (correction #3 from the Phase 6 design review: the only batched
// Save lives in the API section's keys+coords block).
const PaneFooter = ({ lang, section }) => {
  const note = {
    local: lbl(lang,
      "Applied live · stored on this device",
      "Appliqué en direct · stocké sur cet appareil",
      "Aplicado en vivo · guardado en este dispositivo"),
    api: lbl(lang,
      "Keys & coordinates saved together via Save",
      "Clés et coordonnées enregistrées ensemble via Enregistrer",
      "Claves y coordenadas guardadas juntas con Guardar"),
    avance: lbl(lang,
      "Each setting saved to settings.json on change",
      "Chaque réglage enregistré dans settings.json au changement",
      "Cada ajuste se guarda en settings.json al cambiar"),
    apercu: lbl(lang,
      "Switch takes effect on page reload",
      "La bascule prend effet au rechargement",
      "El cambio surte efecto al recargar"),
  }[section];
  if (!note) return null;
  return <div className={styles.paneFooter}>{note}</div>;
};

// Generic SSH tunnel command. The hostname placeholder `<host>`
// stays literal so the user replaces it with their Pi's IP /
// hostname before pasting. We can't pre-fill that here because
// the kiosk's own LAN identity isn't reliably knowable from a
// remote browser (could be reached via Tailscale, mDNS, raw IP,
// reverse proxy, etc.).
const SSH_TUNNEL_CMD = "ssh -L 8443:localhost:8443 user@<host>";

const RemoteNotice = ({ lang }) => {
  const [copied, setCopied] = useState(false);
  const onCopy = () => {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(SSH_TUNNEL_CMD).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }).catch(() => {
      // clipboard.writeText fails silently on insecure contexts.
      // The command remains visible — user can select + copy.
    });
  };
  return (
    <div className={styles.remoteNotice}>
      <span className={styles.remoteNoticeIcon}>⚠</span>
      <div className={styles.remoteNoticeBody}>
        <div>
          {lbl(lang,
            "Remote connection detected. To change these settings, open an SSH tunnel from your local machine and reload the app from https://localhost:8443.",
            "Connexion distante détectée. Pour modifier ces paramètres, ouvrez un tunnel SSH depuis votre poste local et rechargez l'application depuis https://localhost:8443.",
            "Conexión remota detectada. Para modificar estos ajustes, abra un túnel SSH desde su equipo local y recargue la app desde https://localhost:8443.")}
        </div>
        <div className={styles.remoteNoticeCmdRow}>
          <code className={styles.remoteNoticeCmd}>{SSH_TUNNEL_CMD}</code>
          <button
            type="button"
            className={styles.remoteNoticeCopyBtn}
            onClick={onCopy}
            aria-label={lbl(lang, "Copy command", "Copier la commande", "Copiar comando")}
            title={lbl(lang, "Copy command", "Copier la commande", "Copiar comando")}
          >
            {copied
              ? lbl(lang, "Copied!", "Copié !", "¡Copiado!")
              : lbl(lang, "Copy", "Copier", "Copiar")}
          </button>
        </div>
      </div>
    </div>
  );
};

const ApiKeysList = ({ providers, remote, draft, onChange, lang }) => (
  <div className={styles.apiList}>
    {providers.map((p) => {
      const value = draft ? draft[p.id] || "" : "";
      const status = value ? "configured" : "empty";
      /* Localise the tier badge. `required` / `optional` are the two
       * values used by the providers array; fall back to the raw
       * tier string for any future custom values so we don't blank
       * out unknown tiers silently. */
      const tierLabel = p.tier === "required"
        ? (lang === "fr" ? "REQUIS" : lang === "es" ? "REQUERIDO" : "REQUIRED")
        : p.tier === "optional"
          ? (lang === "fr" ? "OPTIONNEL" : lang === "es" ? "OPCIONAL" : "OPTIONAL")
          : p.tier;
      return (
        /* Stacked layout (Phase 6): name+tier on top, the full purpose
         * text on its own line, then the input/pill full-width below.
         * Replaces the old single-row grid whose trailing "purpose"
         * column truncated ("Tuiles de carte + …") the moment the panel
         * narrowed — the purpose now always has the full width to read,
         * and the input is wide enough to see a real key. */
        <div key={p.id} className={styles.apiKey}>
          <div className={styles.apiKeyHead}>
            <StatusDot status={status} />
            <span className={styles.apiName}>{p.name}</span>
            <span className={styles.apiTier}>{tierLabel}</span>
          </div>
          <div className={styles.apiPurpose}>{p.unlocks}</div>
          {remote ? (
            <Pill kind={status === "configured" ? "ok" : "neutral"}>
              {status === "configured" ? "✓ Configured" : "○ Not configured"}
            </Pill>
          ) : (
            <input
              type="text"
              className={styles.apiKeyInput}
              value={value}
              placeholder="—"
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => onChange && onChange(p.id)(e.target.value)}
            />
          )}
        </div>
      );
    })}
  </div>
);

/**
 * Editable variant of Field for the lat/lon inputs. Visually matches
 * Field's box but lets the user type. Falls back to read-only Field
 * when not editable.
 *
 * @param {object} props
 * @param {string} props.label
 * @param {string} props.value
 * @param {string} [props.unit]
 * @param {boolean} [props.mono]
 * @param {Function} props.onChange — called with raw string value
 * @param {JSX.Element} [props.trailing]
 * @returns {JSX.Element}
 */
const EditableField = ({ label, pill, value, unit, mono, placeholder, onChange, onClear, clearLabel, helper }) => (
  <div className={styles.field}>
    <div className={styles.fieldLabel}>
      {label}
      {pill ? <span className={styles.overridePill}>{pill}</span> : null}
    </div>
    <div className={styles.fieldBox}>
      <input
        type="text"
        className={`${styles.fieldInput} ${mono ? styles.fieldValueMono : ""}`}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
      />
      {unit ? <span className={styles.fieldUnit}>{unit}</span> : null}
      {onClear ? (
        <button type="button" className={styles.autoButton} onClick={onClear}>
          {clearLabel || "Auto"}
        </button>
      ) : null}
    </div>
    {helper ? <div className={styles.fieldHelper}>{helper}</div> : null}
  </div>
);

/**
 * Generic range slider with a live percent / formatted readout. Used
 * by the brightness setting (integer 0-100, step 1) and by the radar
 * opacity sliders (fractional 0.05-1, step 0.05) in the Advanced
 * Display subsection. `format` defaults to integer-percent so callers
 * with simple needs (brightness) don't have to pass anything.
 *
 * @param {object} props
 * @param {string} props.label
 * @param {number|null} props.value
 * @param {number} props.min
 * @param {number} [props.max=100]
 * @param {number} [props.step=1]
 * @param {Function} [props.format] — value → display string
 * @param {Function} props.onChange — called with the raw new value
 * @param {boolean} [props.disabled]
 * @returns {JSX.Element}
 */
const RangeSlider = ({ label, value, min, max = 100, step = 1, format, onChange, disabled }) => {
  const fmt = format || ((v) => `${Math.round(v)}%`);
  const display = value != null ? fmt(value) : "—";
  return (
    <div className={`${styles.field} ${disabled ? styles.fieldDisabled : ""}`}>
      <div className={styles.fieldLabel}>{label}</div>
      <div className={styles.brightnessRow}>
        <input
          type="range"
          className={styles.brightnessSlider}
          min={min}
          max={max}
          step={step}
          value={value != null ? value : min}
          disabled={disabled}
          onChange={(e) => onChange && onChange(Number(e.target.value))}
        />
        <span className={styles.brightnessValue}>{display}</span>
      </div>
    </div>
  );
};

/* Backwards-compat alias for the brightness consumer — keeps the
 * call site readable while the implementation is now shared. */
const BrightnessSlider = (props) => <RangeSlider {...props} />;

export default SettingsPanel;
