/* eslint-disable react/prop-types -- this panel has ~15 internal helper
 * components (Pill, Toggle, Field, Seg, …) that are only used inside
 * this file. Their shapes are documented via JSDoc on the exported
 * SettingsPanel; declaring PropTypes for every helper adds ~80 lines
 * of boilerplate for components no other file imports. */
import React, { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { InlineIcon } from "@iconify/react";
import closeSharp from "@iconify/icons-ion/close-sharp";
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
 * @param {string} lang — two-letter locale (`en` / `fr` / `es`)
 * @param {string} en  — English string (default fallback)
 * @param {string} fr  — French string
 * @param {string} es  — Spanish string
 * @returns {string}
 */
const lbl = (lang, en, fr, es) => (lang === "fr" ? fr : lang === "es" ? es : en);

/**
 * Direction C Settings panel — port of the Claude Design canvas at
 * `docs/design-references/settings-debug/project/lib/settings-panel.jsx`
 * variant B (tight list) for the API keys block.
 *
 * Structure (4 sections, decreasing local-vs-server gradient):
 *
 *   1. Préférences locales         — language, font size, dark mode,
 *                                    clock, units (×4), hide flags
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
  const { t, i18n } = useTranslation();
  const ctx = useContext(AppContext);
  const {
    settingsMenuOpen,
    setSettingsMenuOpen,
    isLocal,
    fontSize,
  } = ctx;
  const [advOpen, setAdvOpen] = useState(false);
  const [expOpen, setExpOpen] = useState(false);
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
      <div className={styles.header}>
        <div className={styles.title}>{t("settings.title")}</div>
        <button
          type="button"
          className={styles.closeButton}
          onClick={() => setSettingsMenuOpen(false)}
          aria-label={t("controls.closeSettings")}
        >
          <InlineIcon icon={closeSharp} />
        </button>
      </div>

      <div className={styles.body}>
        <SectionLocalPrefs ctx={ctx} lang={lang} />
        <SectionConfig ctx={ctx} lang={lang} remote={remote} />
        <SectionAdvanced
          ctx={ctx}
          t={t}
          lang={lang}
          remote={remote}
          open={advOpen}
          onToggle={() => setAdvOpen((o) => !o)}
        />
        <SectionPreview
          ctx={ctx}
          lang={lang}
          remote={remote}
          open={expOpen}
          onToggle={() => setExpOpen((o) => !o)}
        />
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
    darkModeAuto, saveDarkModeAuto,
    mouseHide, saveMouseHide,
    hideRadarLegend, saveHideRadarLegend,
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
        <Seg
          label={lbl(lang, "Dark mode", "Mode sombre", "Modo oscuro")}
          options={[{ v: true, l: "AUTO" }, { v: false, l: "MANUEL" }]}
          value={Boolean(darkModeAuto)}
          onChange={saveDarkModeAuto}
        />
        <Seg
          label={lbl(lang, "Clock", "Horloge", "Reloj")}
          options={[{ v: "12", l: "12h" }, { v: "24", l: "24h" }]}
          value={clockTime}
          onChange={saveClockTime}
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
      </div>

      <div className={styles.toggleRow}>
        <Toggle
          label={lbl(lang, "Hide mouse cursor", "Masquer le curseur", "Ocultar cursor")}
          value={Boolean(mouseHide)}
          onChange={saveBoolFlag(saveMouseHide)}
        />
        <Toggle
          label={lbl(lang, "Hide radar legend", "Masquer la légende radar", "Ocultar leyenda radar")}
          value={Boolean(hideRadarLegend)}
          onChange={saveBoolFlag(saveHideRadarLegend)}
        />
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
      <div className={styles.grid4}>
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
            value={draft.customLat}
            unit="°"
            mono
            onChange={updateDraft("customLat")}
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
            value={draft.customLon}
            unit="°"
            mono
            onChange={updateDraft("customLon")}
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
 * Advanced settings — collapsible. Display style / AI flags / sleep
 * mode. Fully detailed port is Phase 8b; for now this section
 * surfaces the same fields the v2 Settings overlay exposes, in a
 * Direction-C-styled disclosure.
 *
 * @param {object} props
 * @param {object} props.ctx
 * @param {Function} props.t
 * @param {string} props.lang
 * @param {boolean} props.remote
 * @param {boolean} props.open
 * @param {Function} props.onToggle
 * @returns {JSX.Element}
 */
const SectionAdvanced = ({ ctx, lang, remote, open, onToggle }) => {
  const {
    sleepEnabled,
    sleepStage1Delay,
    sleepStage1Brightness,
    sleepStage2Enabled,
    sleepStage2Delay,
    sleepNightMode,
    debugEnabled,
    saveAdvancedSleepFlag,
    // Display group (Phase 8b — ported in 2.14.22)
    lightModeStyle,
    darkModeStyle,
    radarOpacityLight,
    radarOpacityDark,
    saveAdvancedDisplayFlag,
    setRadarOpacityLightLive,
    setRadarOpacityDarkLive,
    // AI group
    radarAnalysisEnabled,
    extendedRadarRadius,
    showSamplingPoints,
    calmDayFastPath,
    saveAdvancedAiFlag,
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
      <DisclosureHeader
        index="3"
        title={lbl(lang, "Advanced", "Avancé", "Avanzado")}
        subtitle={lbl(lang, "Display · AI · sleep", "Affichage · IA · veille", "Pantalla · IA · suspensión")}
        open={open}
        onToggle={onToggle}
      />
      {open && (
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

          {/* ── AI / radar analysis ────────────────────────────────── */}
          <div className={`${styles.subhead} ${styles.subheadGap}`}>
            {lbl(lang, "AI · radar analysis", "IA · analyse radar", "IA · análisis radar")}
          </div>
          {/* grid2 (not grid4): each toggle carries a multi-line sub-text
           * label that wraps badly at ~200 px (4-col width inside the
           * 880 px body). 2 columns gives ~400 px per cell on all
           * viewports — enough for the sub-text to breathe. */}
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
              label={lbl(lang, "Extended radius (100 km)", "Rayon étendu (100 km)", "Radio extendido (100 km)")}
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
              label={lbl(lang, "Calm-day fast path", "Chemin rapide jour calme", "Ruta rápida día calmo")}
              value={Boolean(calmDayFastPath)}
              onChange={ai("calmDayFastPath")}
              disabled={remote}
              sub={lbl(lang,
                "Skip Claude when weather is stable",
                "Saute Claude quand le temps est stable",
                "Omite Claude cuando el tiempo es estable")}
            />
          </div>

          {/* ── Sleep ──────────────────────────────────────────────── */}
          <div className={`${styles.subhead} ${styles.subheadGap}`}>
            {lbl(lang, "Sleep", "Veille", "Suspensión")}
          </div>
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
            <Field
              label={lbl(lang, "Stage 1 · delay", "Stage 1 · délai", "Etapa 1 · retraso")}
              value={sleepStage1Delay ?? "—"}
              unit="min"
              mono
              disabled={remote}
            />
            <Field
              label={lbl(lang, "Stage 1 · brightness", "Stage 1 · lum.", "Etapa 1 · brillo")}
              value={sleepStage1Brightness ?? "—"}
              unit="%"
              mono
              disabled={remote}
            />
          </div>
          {/* Stage 2 — same pattern: toggle then fields */}
          <div className={styles.toggleRow} style={{ marginTop: 10 }}>
            <Toggle
              label={lbl(lang, "Stage 2 · enabled", "Stage 2 · activé", "Etapa 2 · activada")}
              value={Boolean(sleepStage2Enabled)}
              onChange={sleep("stage2Enabled")}
              disabled={remote}
            />
          </div>
          <div className={styles.grid4}>
            <Field
              label={lbl(lang, "Stage 2 · delay", "Stage 2 · délai", "Etapa 2 · retraso")}
              value={sleepStage2Delay ?? "—"}
              unit="min"
              mono
              disabled={remote}
            />
          </div>

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
      )}
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
 * @param {boolean} props.open
 * @param {Function} props.onToggle
 * @returns {JSX.Element}
 */
const SectionPreview = ({ ctx, lang, remote, open, onToggle }) => {
  const { experimentalUiC, saveAdvancedExperimentalFlag } = ctx;
  const activeCount = experimentalUiC ? 1 : 0;

  return (
    <div className={styles.section} style={{ opacity: remote ? 0.65 : 1 }}>
      <DisclosureHeader
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
        open={open}
        onToggle={onToggle}
      />
      {open && (
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
      )}
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
         * Geist/Rubik stack — the kiosk font set doesn't carry that
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

const DisclosureHeader = ({ index, title, subtitle, right, open, onToggle }) => (
  <button
    type="button"
    className={styles.disclosureHeader}
    onClick={onToggle}
    aria-expanded={open}
  >
    <span className={`${styles.disclosureChevron} ${open ? styles.disclosureChevronOpen : ""}`}>
      ▸
    </span>
    <div className={styles.sectionHeaderLeft}>
      <div className={styles.sectionHeaderTitle}>
        {/* `lockIcon` used to render the U+269F glyph as a "Local only"
         * cue here, but it falls back to a tofu rectangle in the
         * Geist/Rubik stack — the kiosk font set doesn't carry that
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
  </button>
);

const RemoteNotice = ({ lang }) => (
  <div className={styles.remoteNotice}>
    <span className={styles.remoteNoticeIcon}>⚠</span>
    <div>
      {lbl(lang,
        "Remote connection detected. To change these settings, open an SSH tunnel from your local machine.",
        "Connexion distante détectée. Pour modifier ces paramètres, ouvrez un tunnel SSH depuis votre poste local.",
        "Conexión remota detectada. Para modificar estos ajustes, abra un túnel SSH desde su equipo local.")}
    </div>
  </div>
);

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
        <div key={p.id} className={styles.apiRow}>
          <StatusDot status={status} />
          <div className={styles.apiNameBlock}>
            <div className={styles.apiName}>{p.name}</div>
            <div className={styles.apiTier}>{tierLabel}</div>
          </div>
          <div className={styles.apiValueBlock}>
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
          <span className={styles.apiUnlocks} title={p.unlocks}>{p.unlocks}</span>
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
const EditableField = ({ label, value, unit, mono, onChange, trailing }) => (
  <div className={styles.field}>
    <div className={styles.fieldLabel}>{label}</div>
    <div className={styles.fieldBox}>
      <input
        type="text"
        className={`${styles.fieldInput} ${mono ? styles.fieldValueMono : ""}`}
        value={value}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
      />
      {unit ? <span className={styles.fieldUnit}>{unit}</span> : null}
      {trailing ? <span className={styles.fieldTrailing}>{trailing}</span> : null}
    </div>
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
