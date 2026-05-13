/* eslint-disable react/prop-types -- this panel has ~15 internal helper
 * components (Pill, Toggle, Field, Seg, …) that are only used inside
 * this file. Their shapes are documented via JSDoc on the exported
 * SettingsPanel; declaring PropTypes for every helper adds ~80 lines
 * of boilerplate for components no other file imports. */
import React, { useContext, useState } from "react";
import { useTranslation } from "react-i18next";
import { InlineIcon } from "@iconify/react";
import closeSharp from "@iconify/icons-ion/close-sharp";
import i18n from "~/i18n";
import { AppContext } from "~/AppContext";
import styles from "./styles.css";

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
  } = ctx;
  const [advOpen, setAdvOpen] = useState(false);
  const [expOpen, setExpOpen] = useState(false);

  if (!settingsMenuOpen) return null;

  const lang = (i18n.language || "en").slice(0, 2);
  const remote = !isLocal;

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
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
        <SectionExperimental
          ctx={ctx}
          t={t}
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
  // Note: most preference setters aren't exposed directly on
  // AppContext today — the v2 Settings overlay piloted them via
  // dedicated Select components with their own commit logic. Phase
  // 8a renders the read-only view (values reflect the current state,
  // taps no-op cleanly via the `!disabled && onChange && onChange()`
  // gate inside Seg/Toggle). Phase 8b wires the write path through
  // AppContext for real once we add the corresponding setters.
  const {
    fontSize,
    clockTime,
    tempUnit,
    speedUnit,
    lengthUnit,
    distanceUnit,
    darkModeAuto,
    mouseHide,
    hideRadarLegend,
  } = ctx;

  return (
    <div className={styles.section}>
      <SectionHeader
        index="1"
        title={lang === "fr" ? "Préférences locales" : "Local preferences"}
        subtitle={lang === "fr"
          ? "Stockées dans le navigateur. Pas de redémarrage requis."
          : "Stored in the browser. No restart required."}
      />

      <div className={styles.grid8}>
        <Seg
          label={lang === "fr" ? "Langue" : "Language"}
          options={[{ v: "en", l: "EN" }, { v: "fr", l: "FR" }, { v: "es", l: "ES" }]}
          value={lang}
          onChange={(v) => i18nChangeLanguage(v)}
        />
        <Seg
          label={lang === "fr" ? "Taille texte" : "Font size"}
          options={[{ v: "s", l: "S" }, { v: "m", l: "M" }, { v: "l", l: "L" }]}
          value={fontSize || "m"}
          onChange={() => undefined /* TODO Phase 8b */}
        />
        <Seg
          label={lang === "fr" ? "Mode sombre" : "Dark mode"}
          options={[{ v: true, l: "AUTO" }, { v: false, l: "MANUEL" }]}
          value={Boolean(darkModeAuto)}
          onChange={() => undefined /* TODO Phase 8b */}
        />
        <Seg
          label={lang === "fr" ? "Horloge" : "Clock"}
          options={[{ v: "12", l: "12h" }, { v: "24", l: "24h" }]}
          value={clockTime}
          onChange={() => undefined /* TODO Phase 8b */}
        />
        <Seg
          label="Temp"
          options={[{ v: "f", l: "°F" }, { v: "c", l: "°C" }, { v: "k", l: "K" }]}
          value={tempUnit}
          onChange={() => undefined /* TODO Phase 8b */}
        />
        <Seg
          label={lang === "fr" ? "Vent" : "Speed"}
          options={[{ v: "mph", l: "mph" }, { v: "ms", l: "m/s" }, { v: "kmh", l: "kph" }]}
          value={speedUnit}
          onChange={() => undefined /* TODO Phase 8b */}
        />
        <Seg
          label={lang === "fr" ? "Précip." : "Length"}
          options={[{ v: "in", l: "in" }, { v: "mm", l: "mm" }]}
          value={lengthUnit}
          onChange={() => undefined /* TODO Phase 8b */}
        />
        <Seg
          label="Dist."
          options={[{ v: "mi", l: "mi" }, { v: "km", l: "km" }]}
          value={distanceUnit}
          onChange={() => undefined /* TODO Phase 8b */}
        />
      </div>

      <div className={styles.toggleRow}>
        <Toggle
          label={lang === "fr" ? "Masquer le curseur" : "Hide mouse cursor"}
          value={Boolean(mouseHide)}
          onChange={() => undefined /* TODO Phase 8b */}
        />
        <Toggle
          label={lang === "fr" ? "Masquer la légende radar" : "Hide radar legend"}
          value={Boolean(hideRadarLegend)}
          onChange={() => undefined /* TODO Phase 8b */}
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
    radarSource,
    brightnessPercent, brightnessAvailable,
  } = ctx;

  // The 6 providers in display order. Matches the design package's
  // ADMIN.PROVIDERS array but with the actual settings-key mapping
  // wired up so the row reflects real configuration state.
  const providers = [
    { id: "mapApiKey", name: "Mapbox", tier: "required", value: mapApiKey,
      unlocks: lang === "fr" ? "Tuiles de carte + styles" : "Map tiles + styles" },
    { id: "weatherApiKey", name: "Tomorrow.io", tier: "required", value: weatherApiKey,
      unlocks: lang === "fr" ? "Prévisions horaires + 5 jours" : "Hourly + daily forecast" },
    { id: "reverseGeoApiKey", name: "LocationIQ", tier: "optional", value: reverseGeoApiKey,
      unlocks: lang === "fr" ? "Géocodage inverse · nom de lieu" : "Reverse geocoding · place name" },
    { id: "anthropicApiKey", name: "Anthropic", tier: "optional", value: anthropicApiKey,
      unlocks: lang === "fr" ? "Résumé météo IA (Claude Haiku)" : "AI weather summary (Claude Haiku)" },
    { id: "airNowApiKey", name: "EPA AirNow", tier: "optional", value: airNowApiKey,
      unlocks: lang === "fr" ? "Indice qualité d'air US (AQI)" : "US air-quality index (AQI)" },
    { id: "openAqApiKey", name: "OpenAQ", tier: "optional", value: openAqApiKey,
      unlocks: lang === "fr" ? "Repli qualité d'air mondial" : "Global air-quality fallback" },
  ];

  return (
    <div className={styles.section}>
      <SectionHeader
        index="2"
        lockIcon
        title={lang === "fr" ? "Configuration & clés API" : "Configuration & API keys"}
        subtitle={lang === "fr"
          ? "settings.json côté serveur. Écriture locale uniquement."
          : "Server-side settings.json. Local writes only."}
        right={(
          <Pill kind={remote ? "optional" : "ok"}>
            {remote
              ? (lang === "fr" ? "LECTURE SEULE" : "READ-ONLY")
              : (lang === "fr" ? "MODIFIABLE" : "EDITABLE")}
          </Pill>
        )}
      />

      {remote && <RemoteNotice lang={lang} />}

      <div className={styles.subhead}>
        {lang === "fr" ? "Clés API" : "API keys"}
      </div>
      <ApiKeysList providers={providers} remote={remote} />

      <div className={`${styles.subhead} ${styles.subheadGap}`}>
        {lang === "fr" ? "Localisation & matériel" : "Location & hardware"}
      </div>
      <div className={styles.grid4}>
        <Field
          label={lang === "fr" ? "Latitude" : "Latitude"}
          value={customLat != null ? customLat : "—"}
          unit="°"
          mono
          disabled={remote}
        />
        <Field
          label="Longitude"
          value={customLon != null ? customLon : "—"}
          unit="°"
          mono
          disabled={remote}
        />
        <Seg
          label={lang === "fr" ? "Source radar" : "Radar source"}
          options={[{ v: "rainviewer", l: "RainViewer" }, { v: "eccc", l: "ECCC" }]}
          value={radarSource || "rainviewer"}
          onChange={() => undefined}
          disabled={remote}
        />
        {brightnessAvailable ? (
          <Field
            label={lang === "fr" ? "Luminosité" : "Brightness"}
            value={brightnessPercent != null ? Math.round(brightnessPercent) : "—"}
            unit="%"
            mono
            disabled={remote}
          />
        ) : (
          <div />
        )}
      </div>
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
    experimentalUiC,
    debugEnabled,
  } = ctx;

  return (
    <div className={styles.section} style={{ opacity: remote ? 0.65 : 1 }}>
      <DisclosureHeader
        index="3"
        lockIcon
        title={lang === "fr" ? "Avancé" : "Advanced"}
        subtitle={lang === "fr" ? "Affichage · IA · veille" : "Display · AI · sleep"}
        open={open}
        onToggle={onToggle}
      />
      {open && (
        <div className={styles.advBody}>
          <div className={styles.subhead}>
            {lang === "fr" ? "Veille" : "Sleep"}
            {" "}
            <span className={styles.subheadAccent}>NEW · Direction C</span>
          </div>
          <div className={styles.grid4}>
            <Toggle
              label={lang === "fr" ? "Activer la veille" : "Enable sleep"}
              value={Boolean(sleepEnabled)}
              disabled={remote}
            />
            <Field
              label={lang === "fr" ? "Stage 1 · délai" : "Stage 1 · delay"}
              value={sleepStage1Delay ?? "—"}
              unit="min"
              mono
              disabled={remote}
            />
            <Field
              label={lang === "fr" ? "Stage 1 · lum." : "Stage 1 · brightness"}
              value={sleepStage1Brightness ?? "—"}
              unit="%"
              mono
              disabled={remote}
            />
            <Toggle
              label={lang === "fr" ? "Texte rouge nuit" : "Red text at night"}
              value={Boolean(sleepNightMode)}
              disabled={remote}
            />
            <Toggle
              label={lang === "fr" ? "Stage 2 · activé" : "Stage 2 · enabled"}
              value={Boolean(sleepStage2Enabled)}
              disabled={remote}
            />
            <Field
              label={lang === "fr" ? "Stage 2 · délai" : "Stage 2 · delay"}
              value={sleepStage2Delay ?? "—"}
              unit="min"
              mono
              disabled={remote}
            />
          </div>

          <div className={`${styles.subhead} ${styles.subheadGap}`}>
            {lang === "fr" ? "Diagnostic" : "Diagnostic"}
          </div>
          <div className={styles.toggleRow}>
            <Toggle
              label={lang === "fr" ? "Panneau Débogage" : "Debug panel"}
              value={Boolean(debugEnabled)}
              disabled
              sub={lang === "fr" ? "(défini par DEBUG=true au service)" : "(set via DEBUG=true on the service)"}
            />
          </div>

          <div className={styles.advNote}>
            {lang === "fr"
              ? "Le port complet des autres réglages avancés (style de carte, options IA, zoom par défaut) suit dans la Phase 8b."
              : "Full port of the remaining advanced settings (map style, AI options, default zoom) lands in Phase 8b."}
            {experimentalUiC ? (
              <>{" "}<span className={styles.advNoteFlag}>experimentalUiC = ON</span></>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};

// ───────────────────────────────────────────────────────────────────
// Section 4 · Expérimental
// ───────────────────────────────────────────────────────────────────

/**
 * Experimental feature flags. Currently the only active flag is
 * `experimentalUiC` (this Direction C UI itself).
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
const SectionExperimental = ({ ctx, lang, remote, open, onToggle }) => {
  const { experimentalUiC, saveAdvancedExperimentalFlag } = ctx;
  const activeCount = experimentalUiC ? 1 : 0;

  return (
    <div className={styles.section} style={{ opacity: remote ? 0.65 : 1 }}>
      <DisclosureHeader
        index="4"
        lockIcon
        title={lang === "fr" ? "Expérimental" : "Experimental"}
        subtitle={lang === "fr"
          ? "Fonctionnalités en validation, désactivées par défaut."
          : "Features under validation, disabled by default."}
        right={(
          <Pill kind="optional">
            {activeCount} {lang === "fr" ? "actif" : "active"}
          </Pill>
        )}
        open={open}
        onToggle={onToggle}
      />
      {open && (
        <div className={styles.advBody}>
          <div className={styles.flagRow}>
            <Toggle
              label={lang === "fr" ? "Direction C UI preview" : "Direction C UI preview"}
              value={Boolean(experimentalUiC)}
              onChange={(v) => saveAdvancedExperimentalFlag("uiC", v)}
              disabled={remote}
              sub={lang === "fr"
                ? "Aperçu de l'interface Ambient Layers (v3.0.0)"
                : "Ambient Layers interface preview (v3.0.0)"}
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

const Field = ({ label, value, unit, mono, disabled }) => (
  <div className={`${styles.field} ${disabled ? styles.fieldDisabled : ""}`}>
    <div className={styles.fieldLabel}>{label}</div>
    <div className={styles.fieldBox}>
      <span className={`${styles.fieldValue} ${mono ? styles.fieldValueMono : ""}`}>{value}</span>
      {unit ? <span className={styles.fieldUnit}>{unit}</span> : null}
    </div>
  </div>
);

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

const SectionHeader = ({ index, title, subtitle, right, lockIcon }) => (
  <div className={styles.sectionHeader}>
    <div className={styles.sectionHeaderLeft}>
      <div className={styles.sectionHeaderTitle}>
        {lockIcon ? <span className={styles.sectionLock} title="Local only">⚿</span> : null}
        <span>{index} · {title}</span>
      </div>
      {subtitle ? <div className={styles.sectionHeaderSubtitle}>{subtitle}</div> : null}
    </div>
    {right ? <div className={styles.sectionHeaderRight}>{right}</div> : null}
  </div>
);

const DisclosureHeader = ({ index, title, subtitle, right, lockIcon, open, onToggle }) => (
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
        {lockIcon ? <span className={styles.sectionLock} title="Local only">⚿</span> : null}
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
      {lang === "fr"
        ? "Connexion distante détectée. Pour modifier ces paramètres, ouvrez un tunnel SSH depuis votre poste local."
        : "Remote connection detected. To change these settings, open an SSH tunnel from your local machine."}
    </div>
  </div>
);

const ApiKeysList = ({ providers, remote }) => (
  <div className={styles.apiList}>
    {providers.map((p) => {
      const status = p.value ? "configured" : "empty";
      return (
        <div key={p.id} className={styles.apiRow}>
          <StatusDot status={status} />
          <div className={styles.apiNameBlock}>
            <div className={styles.apiName}>{p.name}</div>
            <div className={styles.apiTier}>{p.tier}</div>
          </div>
          <div className={styles.apiValueBlock}>
            {remote ? (
              <Pill kind={status === "configured" ? "ok" : "neutral"}>
                {status === "configured" ? "✓ Configured" : "○ Not configured"}
              </Pill>
            ) : (
              <span className={styles.apiKeyMasked}>
                {p.value ? maskKey(p.value) : "—"}
              </span>
            )}
          </div>
          <span className={styles.apiUnlocks} title={p.unlocks}>{p.unlocks}</span>
        </div>
      );
    })}
  </div>
);

function maskKey(value) {
  if (!value || value.length < 10) return "•".repeat(8);
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export default SettingsPanel;
