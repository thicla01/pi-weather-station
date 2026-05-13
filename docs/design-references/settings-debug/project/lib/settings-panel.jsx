// Settings panel — 4 sections, palette-aware, remote-read-only-aware.
// Three API-keys variants exposed via prop `keysVariant`:
//   'cards'    — Provider card grid (logo letter + badge + status + input)
//   'list'     — Tight list with inline status pills (default)
//   'disclose' — Required visible, optional behind "Show optional providers"

const PALETTE_FROM_TIME = (tod) => (window.cTokens && window.cTokens[tod]) || window.cTokens.day;

// ─── Small reusable bits ─────────────────────────────────────────────
function Pill({ kind = 'neutral', children, t, mono }) {
  const c = kind === 'required' ? { bg: t.danger, fg: '#fff' }
          : kind === 'optional' ? { bg: 'transparent', fg: t.textDim, border: t.border }
          : kind === 'ok'       ? { bg: '#2e7d52', fg: '#fff' }
          : kind === 'warn'     ? { bg: t.warn, fg: '#fff' }
          : kind === 'invalid'  ? { bg: t.danger, fg: '#fff' }
          :                       { bg: t.surfaceTint, fg: t.textDim };
  return <span style={{
    fontFamily: mono, fontSize: 9, letterSpacing: 1.1, fontWeight: 600,
    padding: '2px 6px', borderRadius: 3, background: c.bg, color: c.fg,
    border: c.border ? `1px solid ${c.border}` : 'none',
    textTransform: 'uppercase', whiteSpace: 'nowrap',
  }}>{children}</span>;
}

function StatusDot({ status, t }) {
  const c = status === 'configured' ? '#2e7d52'
          : status === 'invalid'    ? t.danger
          : t.textDim;
  return <span style={{ width: 7, height: 7, borderRadius: '50%', background: c, display: 'inline-block', flexShrink: 0 }}/>;
}

function MaskedKey({ value, mono, t, remote }) {
  if (!value) return <span style={{ fontFamily: mono, fontSize: 10, color: t.textDim, fontStyle: 'italic' }}>—</span>;
  if (remote) return <span style={{ fontFamily: mono, fontSize: 10, color: t.textDim, letterSpacing: 1 }}>••••••••••••</span>;
  const head = value.slice(0, 4);
  const tail = value.slice(-4);
  return <span style={{ fontFamily: mono, fontSize: 10, color: t.text, letterSpacing: 0.4 }}>{head}<span style={{ color: t.textDim }}>…{value.length - 8} chars…</span>{tail}</span>;
}

function SectionHeader({ title, subtitle, t, FONTS, right, lockIcon = false }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-end', gap: 10, marginBottom: 10,
      paddingBottom: 8, borderBottom: `1px solid ${t.border}`,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: FONTS.mono, fontSize: 10, letterSpacing: 1.6,
          color: t.accent, textTransform: 'uppercase', fontWeight: 600,
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          {lockIcon && <span aria-label="local-only" title="Local edit only">⚿</span>}
          {title}
        </div>
        {subtitle && <div style={{ fontFamily: FONTS.sans, fontSize: 11, color: t.textDim, marginTop: 2 }}>{subtitle}</div>}
      </div>
      {right}
    </div>
  );
}

function RemoteNotice({ t, FONTS, lang = 'fr' }) {
  const fr = `Connexion distante détectée. Pour modifier ces paramètres, ouvrez un tunnel SSH depuis votre poste.`;
  const en = `Remote connection detected. To change these settings, open an SSH tunnel from your local machine.`;
  return (
    <div style={{
      background: 'rgba(196,104,58,0.14)',
      border: `1px solid ${t.warn}`,
      borderRadius: 6, padding: '8px 10px',
      display: 'flex', gap: 8, alignItems: 'flex-start',
      marginBottom: 10,
    }}>
      <span style={{ color: t.warn, fontFamily: FONTS.mono, fontSize: 11, flexShrink: 0 }}>⚠</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: FONTS.sans, fontSize: 11.5, color: t.text, lineHeight: 1.4, textWrap: 'pretty' }}>
          {lang === 'fr' ? fr : en}
        </div>
        <a href="#access-from-another-machine" style={{ fontFamily: FONTS.mono, fontSize: 9, color: t.warn, letterSpacing: 1, textTransform: 'uppercase', textDecoration: 'underline', textUnderlineOffset: 2 }}>
          {lang === 'fr' ? 'voir le README →' : 'see README →'}
        </a>
      </div>
    </div>
  );
}

// ─── API KEYS — Variant A · Provider card grid ───────────────────────
function ApiKeysCards({ keys, providers, t, FONTS, remote, compact }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: compact ? '1fr 1fr' : 'repeat(auto-fit, minmax(220px, 1fr))',
      gap: 8,
    }}>
      {providers.map((p) => {
        const k = keys[p.id] || { value: '', status: 'empty' };
        return (
          <div key={p.id} style={{
            background: t.surfaceTint, border: `1px solid ${t.border}`,
            borderRadius: 6, padding: compact ? '8px 10px' : '10px 12px',
            display: 'flex', flexDirection: 'column', gap: 4,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                width: 22, height: 22, borderRadius: 4, flexShrink: 0,
                background: t.accentSoft, color: t.accent,
                fontFamily: FONTS.display, fontWeight: 600, fontSize: 12,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{p.name[0]}</span>
              <span style={{ fontFamily: FONTS.display, fontSize: 12.5, fontWeight: 500, color: t.text, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
              <Pill kind={p.tier} t={t} mono={FONTS.mono}>{p.tier === 'required' ? 'REQ' : 'OPT'}</Pill>
            </div>
            <div style={{ fontFamily: FONTS.sans, fontSize: 10.5, color: t.textDim, lineHeight: 1.35, textWrap: 'pretty' }}>{p.unlocks}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <StatusDot status={k.status} t={t}/>
              {remote ? (
                <Pill kind={k.status === 'configured' ? 'ok' : k.status === 'invalid' ? 'invalid' : 'neutral'} t={t} mono={FONTS.mono}>
                  {k.status === 'configured' ? '✓ Configured' : k.status === 'invalid' ? '✕ Invalid' : '○ Not configured'}
                </Pill>
              ) : (
                <KeyInput value={k.value} status={k.status} t={t} mono={FONTS.mono}/>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function KeyInput({ value, status, t, mono, placeholder = 'paste key…' }) {
  return (
    <div style={{
      flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6,
      background: t.surface, border: `1px solid ${status === 'invalid' ? t.danger : t.border}`,
      borderRadius: 4, padding: '4px 8px',
      fontFamily: mono, fontSize: 10, color: t.text,
    }}>
      {value ? <MaskedKey value={value} mono={mono} t={t}/> : <span style={{ color: t.textDim }}>{placeholder}</span>}
      {value && <button style={{ background: 'transparent', color: t.textDim, border: 'none', fontFamily: mono, fontSize: 9, cursor: 'pointer', padding: 0 }} title="Edit">✎</button>}
    </div>
  );
}

// ─── API KEYS — Variant B · Tight list with inline status ────────────
function ApiKeysList({ keys, providers, t, FONTS, remote }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {providers.map((p) => {
        const k = keys[p.id] || { value: '', status: 'empty' };
        return (
          <div key={p.id} style={{
            display: 'grid',
            gridTemplateColumns: 'auto 110px 1fr auto',
            gap: 8, alignItems: 'center',
            padding: '6px 8px',
            borderRadius: 4,
            background: 'transparent',
            borderBottom: `1px solid ${t.border}`,
          }}>
            <StatusDot status={k.status} t={t}/>
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <div style={{ fontFamily: FONTS.display, fontSize: 12, fontWeight: 500, color: t.text, lineHeight: 1.1 }}>{p.name}</div>
              <div style={{ fontFamily: FONTS.mono, fontSize: 8.5, color: t.textDim, letterSpacing: 0.6, textTransform: 'uppercase' }}>{p.tier}</div>
            </div>
            <div style={{ minWidth: 0, overflow: 'hidden' }}>
              {remote ? (
                <Pill kind={k.status === 'configured' ? 'ok' : k.status === 'invalid' ? 'invalid' : 'neutral'} t={t} mono={FONTS.mono}>
                  {k.status === 'configured' ? '✓ Configured' : k.status === 'invalid' ? '✕ Invalid' : '○ Not configured'}
                </Pill>
              ) : (
                <KeyInput value={k.value} status={k.status} t={t} mono={FONTS.mono}/>
              )}
            </div>
            <span style={{ fontFamily: FONTS.sans, fontSize: 10, color: t.textDim, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.unlocks}>{p.unlocks}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── API KEYS — Variant C · Disclosure (req visible, opt collapsed) ──
function ApiKeysDisclose({ keys, providers, t, FONTS, remote }) {
  const [showOpt, setShowOpt] = React.useState(false);
  const req = providers.filter(p => p.tier === 'required');
  const opt = providers.filter(p => p.tier === 'optional');
  const optConfigured = opt.filter(p => (keys[p.id] || {}).status === 'configured').length;
  const row = (p) => {
    const k = keys[p.id] || { value: '', status: 'empty' };
    return (
      <div key={p.id} style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 8px', borderBottom: `1px solid ${t.border}`,
      }}>
        <StatusDot status={k.status} t={t}/>
        <span style={{ fontFamily: FONTS.display, fontSize: 12.5, fontWeight: 500, color: t.text, minWidth: 90 }}>{p.name}</span>
        <span style={{ fontFamily: FONTS.sans, fontSize: 10.5, color: t.textDim, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.unlocks}</span>
        <div style={{ width: 180 }}>
          {remote ? (
            <Pill kind={k.status === 'configured' ? 'ok' : k.status === 'invalid' ? 'invalid' : 'neutral'} t={t} mono={FONTS.mono}>
              {k.status === 'configured' ? '✓ Configured' : k.status === 'invalid' ? '✕ Invalid' : '○ Not configured'}
            </Pill>
          ) : (
            <KeyInput value={k.value} status={k.status} t={t} mono={FONTS.mono}/>
          )}
        </div>
      </div>
    );
  };
  return (
    <div>
      <div style={{
        fontFamily: FONTS.mono, fontSize: 9, letterSpacing: 1.2, color: t.danger,
        textTransform: 'uppercase', marginBottom: 4, fontWeight: 600,
      }}>Required ({req.length})</div>
      <div style={{ marginBottom: 12 }}>{req.map(row)}</div>
      <button onClick={() => setShowOpt(s => !s)} style={{
        background: 'transparent', border: `1px dashed ${t.border}`, borderRadius: 4,
        color: t.text, fontFamily: FONTS.mono, fontSize: 10, letterSpacing: 1,
        padding: '6px 10px', cursor: 'pointer', width: '100%', textAlign: 'left',
        display: 'flex', alignItems: 'center', gap: 6, textTransform: 'uppercase',
      }}>
        <span style={{ transform: showOpt ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 150ms' }}>▸</span>
        <span>{showOpt ? 'Hide' : 'Show'} optional providers ({opt.length})</span>
        <span style={{ marginLeft: 'auto', color: t.textDim }}>{optConfigured}/{opt.length} configured</span>
      </button>
      {showOpt && (
        <div style={{ marginTop: 6 }}>
          <div style={{ fontFamily: FONTS.mono, fontSize: 9, letterSpacing: 1.2, color: t.textDim, textTransform: 'uppercase', marginBottom: 4 }}>Optional</div>
          {opt.map(row)}
        </div>
      )}
    </div>
  );
}

// ─── Toggles / fields ────────────────────────────────────────────────
function Toggle({ label, value, t, FONTS, disabled, sub }) {
  return (
    <label style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0',
      cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
    }}>
      <span style={{
        width: 30, height: 16, borderRadius: 10, position: 'relative', flexShrink: 0,
        background: value ? t.accent : t.surfaceTint,
        border: `1px solid ${value ? t.accent : t.border}`,
        transition: 'background 120ms',
      }}>
        <span style={{
          position: 'absolute', top: 1, left: value ? 15 : 1, width: 12, height: 12,
          borderRadius: '50%', background: value ? '#fff' : t.text, transition: 'left 120ms',
        }}/>
      </span>
      <span style={{ fontFamily: FONTS.sans, fontSize: 12, color: t.text }}>{label}</span>
      {sub && <span style={{ fontFamily: FONTS.sans, fontSize: 10.5, color: t.textDim, marginLeft: 4 }}>{sub}</span>}
    </label>
  );
}

function Field({ label, value, unit, t, FONTS, mono, disabled }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, opacity: disabled ? 0.5 : 1 }}>
      <span style={{ fontFamily: FONTS.mono, fontSize: 8.5, letterSpacing: 1, color: t.textDim, textTransform: 'uppercase' }}>{label}</span>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 4, padding: '4px 8px',
        background: t.surfaceTint, border: `1px solid ${t.border}`, borderRadius: 4,
      }}>
        <span style={{ fontFamily: mono ? FONTS.mono : FONTS.sans, fontSize: 12, color: t.text, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
        {unit && <span style={{ fontFamily: FONTS.mono, fontSize: 9, color: t.textDim }}>{unit}</span>}
      </div>
    </div>
  );
}

function Seg({ label, options, value, t, FONTS, disabled }) {
  return (
    <div style={{ opacity: disabled ? 0.5 : 1 }}>
      <div style={{ fontFamily: FONTS.mono, fontSize: 8.5, letterSpacing: 1, color: t.textDim, textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      <div style={{ display: 'flex', gap: 2, background: t.surfaceTint, padding: 2, borderRadius: 4, border: `1px solid ${t.border}` }}>
        {options.map((o) => (
          <span key={o} style={{
            flex: 1, textAlign: 'center', padding: '4px 6px', borderRadius: 3,
            fontFamily: FONTS.mono, fontSize: 10, letterSpacing: 0.8, fontWeight: 500,
            background: o === value ? t.accent : 'transparent',
            color: o === value ? '#fff' : t.textDim,
            cursor: disabled ? 'default' : 'pointer',
          }}>{o}</span>
        ))}
      </div>
    </div>
  );
}

// ─── PANEL: SETTINGS ─────────────────────────────────────────────────
function SettingsPanel({
  timeOfDay = 'night',
  size = '800x480',
  keysVariant = 'list',
  scenario = 'configured',   // 'configured' | 'partial' | 'empty'
  remote = false,
  lang = 'fr',
  onClose = null,
}) {
  const t = PALETTE_FROM_TIME(timeOfDay);
  const FONTS = window.cFONTS;
  const [w, h] = size.split('x').map(Number);
  const compact = w <= 800;

  const keys = ADMIN.makeKeys(scenario);
  const S = ADMIN.SETTINGS;
  const [advOpen, setAdvOpen] = React.useState(!compact);
  const [expOpen, setExpOpen] = React.useState(false);

  return (
    <div style={{
      width: w, height: h, background: t.bg, color: t.text,
      fontFamily: FONTS.sans, position: 'relative', overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        padding: compact ? '10px 12px' : '14px 18px',
        borderBottom: `1px solid ${t.border}`, background: t.surface,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span aria-label="settings" style={{ color: t.accent, fontSize: 18 }}>⚙</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: FONTS.display, fontSize: compact ? 15 : 17, fontWeight: 500, color: t.text, letterSpacing: -0.2 }}>
            {lang === 'fr' ? 'Réglages' : 'Settings'}
          </div>
          <div style={{ fontFamily: FONTS.mono, fontSize: 9, letterSpacing: 1, color: t.textDim, textTransform: 'uppercase', marginTop: 1 }}>
            pi-weather-01 · {remote ? (lang === 'fr' ? 'connexion distante' : 'remote connection') : (lang === 'fr' ? 'connexion locale' : 'local connection')}
          </div>
        </div>
        {onClose && <button onClick={onClose} style={{ background: 'transparent', color: t.textDim, border: 'none', fontFamily: FONTS.mono, fontSize: 14, cursor: 'pointer', padding: 4 }} aria-label="Close">✕</button>}
      </div>

      {/* Scroll body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: compact ? '10px 12px 60px' : '14px 18px 70px' }}>
        {/* ─── Section 1 · Préférences ─────────────────────────────── */}
        <div style={{ marginBottom: compact ? 16 : 20 }}>
          <SectionHeader t={t} FONTS={FONTS}
            title={lang === 'fr' ? '1 · Préférences' : '1 · Preferences'}
            subtitle={lang === 'fr' ? 'Stocké dans le navigateur (localStorage). Personnel à chaque appareil.' : 'Browser localStorage. Per-device, never synced.'}/>
          <div style={{
            display: 'grid',
            gridTemplateColumns: compact ? '1fr 1fr' : 'repeat(4, 1fr)',
            gap: compact ? 8 : 12,
          }}>
            <Seg label={lang === 'fr' ? 'Langue' : 'Language'} options={['EN', 'FR', 'ES']} value={S.prefs.lang.toUpperCase()} t={t} FONTS={FONTS}/>
            <Seg label={lang === 'fr' ? 'Taille texte' : 'Font size'} options={['S', 'M', 'L']} value={S.prefs.fontSize} t={t} FONTS={FONTS}/>
            <Seg label={lang === 'fr' ? 'Mode sombre' : 'Dark mode'} options={['AUTO', 'ON', 'OFF']} value="AUTO" t={t} FONTS={FONTS}/>
            <Seg label={lang === 'fr' ? 'Horloge' : 'Clock'} options={['12h', '24h']} value={S.prefs.clock + 'h'} t={t} FONTS={FONTS}/>
            <Seg label="Temp" options={['°F', '°C', 'K']} value="°C" t={t} FONTS={FONTS}/>
            <Seg label={lang === 'fr' ? 'Vent' : 'Speed'} options={['mph', 'm/s', 'kph']} value="kph" t={t} FONTS={FONTS}/>
            <Seg label={lang === 'fr' ? 'Précip.' : 'Length'} options={['in', 'mm']} value="mm" t={t} FONTS={FONTS}/>
            <Seg label="Dist." options={['mi', 'km']} value="km" t={t} FONTS={FONTS}/>
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
            <Toggle label={lang === 'fr' ? 'Masquer le curseur' : 'Hide mouse cursor'} value={S.prefs.hideMouse} t={t} FONTS={FONTS}/>
            <Toggle label={lang === 'fr' ? 'Masquer la légende radar' : 'Hide radar legend'} value={S.prefs.hideRadarLegend} t={t} FONTS={FONTS}/>
          </div>
        </div>

        {/* ─── Section 2 · Configuration & API keys ────────────────── */}
        <div style={{ marginBottom: compact ? 16 : 20 }}>
          <SectionHeader t={t} FONTS={FONTS} lockIcon={true}
            title={lang === 'fr' ? '2 · Configuration & clés API' : '2 · Configuration & API keys'}
            subtitle={lang === 'fr' ? 'settings.json côté serveur. Écriture locale uniquement.' : 'Server-side settings.json. Local writes only.'}
            right={<Pill kind="optional" t={t} mono={FONTS.mono}>{remote ? (lang === 'fr' ? 'LECTURE SEULE' : 'READ-ONLY') : (lang === 'fr' ? 'MODIFIABLE' : 'EDITABLE')}</Pill>}/>
          {remote && <RemoteNotice t={t} FONTS={FONTS} lang={lang}/>}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontFamily: FONTS.mono, fontSize: 9, letterSpacing: 1.2, color: t.textDim, textTransform: 'uppercase', marginBottom: 6 }}>
              {lang === 'fr' ? 'Clés API · ' : 'API keys · '}
              <span style={{ color: t.accent }}>variant: {keysVariant}</span>
            </div>
            {keysVariant === 'cards'    && <ApiKeysCards    keys={keys} providers={ADMIN.PROVIDERS} t={t} FONTS={FONTS} remote={remote} compact={compact}/>}
            {keysVariant === 'list'     && <ApiKeysList     keys={keys} providers={ADMIN.PROVIDERS} t={t} FONTS={FONTS} remote={remote}/>}
            {keysVariant === 'disclose' && <ApiKeysDisclose keys={keys} providers={ADMIN.PROVIDERS} t={t} FONTS={FONTS} remote={remote}/>}
          </div>

          {/* Other server config */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: compact ? '1fr 1fr' : 'repeat(4, 1fr)',
            gap: 10, marginTop: 12,
          }}>
            <Field label={lang === 'fr' ? 'Latitude' : 'Latitude'} value={S.coords.lat} unit="°N" t={t} FONTS={FONTS} mono disabled={remote}/>
            <Field label={lang === 'fr' ? 'Longitude' : 'Longitude'} value={S.coords.lon} unit="°W" t={t} FONTS={FONTS} mono disabled={remote}/>
            <Seg label={lang === 'fr' ? 'Source radar' : 'Radar source'} options={['RAINVIEWER', 'ECCC']} value="RAINVIEWER" t={t} FONTS={FONTS} disabled={remote}/>
            <Field label={lang === 'fr' ? 'Luminosité' : 'Brightness'} value={S.brightness} unit="%" t={t} FONTS={FONTS} mono disabled={remote}/>
          </div>

          {/* Homebridge group */}
          <div style={{ marginTop: 10, padding: '8px 10px', background: t.surfaceTint, border: `1px solid ${t.border}`, borderRadius: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: S.homebridge.connected ? '#2e7d52' : t.danger }}/>
              <span style={{ fontFamily: FONTS.mono, fontSize: 9, letterSpacing: 1.2, color: t.textDim, textTransform: 'uppercase' }}>
                Homebridge · {S.homebridge.connected ? (lang === 'fr' ? 'connecté' : 'connected') : (lang === 'fr' ? 'déconnecté' : 'disconnected')}
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 8 }}>
              <Field label="Host" value={S.homebridge.host} t={t} FONTS={FONTS} mono disabled={remote}/>
              <Field label="Port" value={S.homebridge.port} t={t} FONTS={FONTS} mono disabled={remote}/>
              <Field label="User" value={S.homebridge.username} t={t} FONTS={FONTS} disabled={remote}/>
              <Field label="Sensor" value={S.homebridge.sensorName} t={t} FONTS={FONTS} disabled={remote}/>
            </div>
          </div>
        </div>

        {/* ─── Section 3 · Avancé ──────────────────────────────────── */}
        <div style={{ marginBottom: compact ? 12 : 16, opacity: remote ? 0.65 : 1 }}>
          <button onClick={() => setAdvOpen(o => !o)} style={{
            width: '100%', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
            display: 'flex', alignItems: 'flex-end', gap: 8, marginBottom: 8,
            paddingBottom: 6, borderBottom: `1px solid ${t.border}`,
          }}>
            <span style={{ color: t.accent, fontFamily: FONTS.mono, fontSize: 11, transform: advOpen ? 'rotate(90deg)' : 'none', transition: 'transform 150ms' }}>▸</span>
            <div style={{ flex: 1, textAlign: 'left' }}>
              <div style={{ fontFamily: FONTS.mono, fontSize: 10, letterSpacing: 1.6, color: t.accent, textTransform: 'uppercase', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span title="local-only">⚿</span>{lang === 'fr' ? '3 · Avancé' : '3 · Advanced'}
              </div>
              <div style={{ fontFamily: FONTS.sans, fontSize: 11, color: t.textDim, marginTop: 2 }}>
                {lang === 'fr' ? 'Affichage · IA · veille' : 'Display · AI · sleep'}
              </div>
            </div>
          </button>
          {advOpen && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <div style={{ fontFamily: FONTS.mono, fontSize: 9, letterSpacing: 1.2, color: t.textDim, textTransform: 'uppercase', marginBottom: 4 }}>Display</div>
                <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr 1fr' : 'repeat(3, 1fr)', gap: 8 }}>
                  <Field label="Light style" value={S.advanced.mapStyle.light} t={t} FONTS={FONTS} mono disabled={remote}/>
                  <Field label="Dark style"  value={S.advanced.mapStyle.dark}  t={t} FONTS={FONTS} mono disabled={remote}/>
                  <Field label="Default zoom" value={S.advanced.defaultZoom} t={t} FONTS={FONTS} mono disabled={remote}/>
                </div>
              </div>
              <div>
                <div style={{ fontFamily: FONTS.mono, fontSize: 9, letterSpacing: 1.2, color: t.textDim, textTransform: 'uppercase', marginBottom: 4 }}>AI</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
                  <Toggle label={lang === 'fr' ? 'Voie rapide jour calme' : 'Calm-day fast path'} value={S.advanced.ai.calmDayFastPath} t={t} FONTS={FONTS} disabled={remote}/>
                  <Toggle label={lang === 'fr' ? 'Rayon étendu (50 + 100 km)' : 'Extended radius (50 + 100 km)'} value={S.advanced.ai.extendedRadius} t={t} FONTS={FONTS} disabled={remote}/>
                  <Toggle label={lang === 'fr' ? 'Analyse radar activée' : 'Radar analysis enabled'} value={S.advanced.ai.radarAnalysisEnabled} t={t} FONTS={FONTS} disabled={remote}/>
                  <Toggle label={lang === 'fr' ? 'Points d\'échantillonnage' : 'Show sampling points'} value={S.advanced.ai.showSamplingPoints} t={t} FONTS={FONTS} disabled={remote}/>
                </div>
              </div>
              <div>
                <div style={{ fontFamily: FONTS.mono, fontSize: 9, letterSpacing: 1.2, color: t.textDim, textTransform: 'uppercase', marginBottom: 4 }}>
                  {lang === 'fr' ? 'Veille' : 'Sleep'} <span style={{ color: t.accent, fontSize: 8 }}>NEW · Direction C</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 8 }}>
                  <Field label={lang === 'fr' ? 'Stage 1 · délai' : 'Stage 1 · delay'} value={S.advanced.sleep.stage1Delay} unit="min" t={t} FONTS={FONTS} mono disabled={remote}/>
                  <Field label={lang === 'fr' ? 'Stage 1 · lum.' : 'Stage 1 · brightness'} value={S.advanced.sleep.stage1Brightness} unit="%" t={t} FONTS={FONTS} mono disabled={remote}/>
                  <div style={{ opacity: remote ? 0.5 : 1 }}>
                    <div style={{ fontFamily: FONTS.mono, fontSize: 8.5, letterSpacing: 1, color: t.textDim, textTransform: 'uppercase', marginBottom: 4 }}>
                      {lang === 'fr' ? 'Stage 2 · activé' : 'Stage 2 · enabled'}
                    </div>
                    <Toggle label="" value={S.advanced.sleep.stage2Enabled} t={t} FONTS={FONTS} disabled={remote}/>
                  </div>
                  <Field label={lang === 'fr' ? 'Stage 2 · délai' : 'Stage 2 · delay'} value={S.advanced.sleep.stage2Delay} unit="min" t={t} FONTS={FONTS} mono disabled={remote}/>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ─── Section 4 · Expérimental ────────────────────────────── */}
        <div style={{ opacity: remote ? 0.65 : 1 }}>
          <button onClick={() => setExpOpen(o => !o)} style={{
            width: '100%', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
            display: 'flex', alignItems: 'flex-end', gap: 8, marginBottom: 8,
            paddingBottom: 6, borderBottom: `1px solid ${t.border}`,
          }}>
            <span style={{ color: t.accent, fontFamily: FONTS.mono, fontSize: 11, transform: expOpen ? 'rotate(90deg)' : 'none', transition: 'transform 150ms' }}>▸</span>
            <div style={{ flex: 1, textAlign: 'left' }}>
              <div style={{ fontFamily: FONTS.mono, fontSize: 10, letterSpacing: 1.6, color: t.accent, textTransform: 'uppercase', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span title="local-only">⚿</span>{lang === 'fr' ? '4 · Expérimental' : '4 · Experimental'}
                <Pill kind="optional" t={t} mono={FONTS.mono}>{S.experimental.flags.length} {lang === 'fr' ? 'actif' : 'active'}</Pill>
              </div>
              <div style={{ fontFamily: FONTS.sans, fontSize: 11, color: t.textDim, marginTop: 2 }}>
                {lang === 'fr' ? 'Fonctionnalités en validation, désactivées par défaut.' : 'Features under validation, disabled by default.'}
              </div>
            </div>
          </button>
          {expOpen && (
            <div style={{
              padding: '14px 16px', textAlign: 'center',
              border: `1px dashed ${t.border}`, borderRadius: 6,
              background: 'transparent',
            }}>
              <div style={{ fontFamily: FONTS.mono, fontSize: 9, letterSpacing: 1.4, color: t.textDim, textTransform: 'uppercase', marginBottom: 6 }}>
                {lang === 'fr' ? 'Aucune fonctionnalité expérimentale active' : 'No experimental features active'}
              </div>
              <div style={{ fontFamily: FONTS.sans, fontSize: 11, color: t.textDim, lineHeight: 1.45, maxWidth: 380, margin: '0 auto', textWrap: 'pretty' }}>
                {lang === 'fr'
                  ? 'Les nouvelles fonctionnalités en cours de validation apparaîtront ici, désactivées par défaut.'
                  : 'New features under validation will appear here, disabled by default.'}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Save action — sticky footer */}
      {!remote && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          padding: compact ? '8px 12px' : '10px 18px',
          background: t.surface, borderTop: `1px solid ${t.border}`,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontFamily: FONTS.mono, fontSize: 9, letterSpacing: 1.2, color: t.textDim, textTransform: 'uppercase', flex: 1 }}>
            {lang === 'fr' ? 'modifications non enregistrées · ' : 'unsaved changes · '}<span style={{ color: t.warn }}>3</span>
          </span>
          <button style={{
            background: 'transparent', color: t.textDim, border: `1px solid ${t.border}`,
            borderRadius: 4, padding: '6px 12px', fontFamily: FONTS.mono, fontSize: 10,
            letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer',
          }}>{lang === 'fr' ? 'Annuler' : 'Cancel'}</button>
          <button style={{
            background: t.accent, color: '#fff', border: 'none',
            borderRadius: 4, padding: '6px 14px', fontFamily: FONTS.mono, fontSize: 10,
            letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer', fontWeight: 600,
          }}>{lang === 'fr' ? 'Enregistrer' : 'Save'}</button>
        </div>
      )}
    </div>
  );
}

window.SettingsPanel = SettingsPanel;
