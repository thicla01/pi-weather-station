// Direction C — "Ambient Layers" (v2 refinement)
//
// Refined per maintainer feedback:
// 1) 800×480 layout is now horizontal split (~70/30) with map left,
//    info column right, BottomDock full-width below. Info column has a
//    chevron toggle that collapses it to give the radar full width.
// 2) Auto "hybrid instrumentation" mode is triggered by severity
//    (red/amber alert, severe radar, or rain+high confidence). It adds
//    left-edge severity strips, mono numerals on critical metrics, and
//    bumps slab opacity. No display-font swap.
// 3) Slabs are OPAQUE rgba surfaces (no backdrop-filter blur) so we stay
//    cheap on Pi 4. `useBlur` flag toggles blur on ≥1280px or capable HW.
// 4) Adds: source badges, confidence pills, multi-alert cycling+banner,
//    alert detail overlay with QR code, indoor block, brightness slider
//    (settings only), direction-arrows toggle, 50/100 km rings (yellow/
//    red-extended), sample-points debug, radar timeline scrubber.
// 5) Night-red palette and stage-2 burn-in protection added to sleep mode.
//
// Palette: day | dusk | night | nightRed   (chosen via timeOfDay)
//
// Note: dusk + night use desaturated warm-grey values. An earlier
// warm-dim variant (more amber bias) was considered and discarded —
// the desaturated palette gives radar tiles better chromatic fidelity
// (yellow / orange / red intensity encoders read accurately against a
// neutral surface), and severity strips contrast more clearly against
// a neutral bg. Text retains a warm tint (#d8d4cc / #c8c4b8), not cold
// steel grey. nightRed stays a true long-wavelength red for sleep.

const cTokens = {
  day: {
    bg: '#f2eee5',
    surface: 'rgba(255,255,255,0.92)',
    surfaceHybrid: 'rgba(255,255,255,0.98)',
    surfaceTint: 'rgba(232,225,207,0.7)',
    text: '#1f1c17',
    textDim: '#5d564b',
    border: 'rgba(35,28,20,0.10)',
    borderHybrid: 'rgba(35,28,20,0.18)',
    accent: '#1f6b5e',
    accentSoft: '#e6efe9',
    warn: '#c4683a',
    danger: '#a83232',
    cool: '#3b6c8c',
  },
  dusk: {
    bg: '#1c1a17',
    surface: 'rgba(38,34,30,0.85)',
    surfaceHybrid: 'rgba(38,34,30,0.95)',
    surfaceTint: 'rgba(38,34,30,0.5)',
    text: '#d8d4cc',
    textDim: '#8a8680',
    border: 'rgba(216,212,204,0.14)',
    borderHybrid: 'rgba(216,212,204,0.24)',
    accent: '#e8a050',
    accentSoft: 'rgba(232,160,80,0.15)',
    warn: '#e08858',
    danger: '#d96552',
    cool: '#7baed1',
  },
  night: {
    bg: '#0d0d0c',
    surface: 'rgba(20,20,18,0.88)',
    surfaceHybrid: 'rgba(28,28,25,0.96)',
    surfaceTint: 'rgba(20,20,18,0.55)',
    text: '#c8c4b8',
    textDim: '#6c6960',
    border: 'rgba(200,196,184,0.12)',
    borderHybrid: 'rgba(200,196,184,0.22)',
    accent: '#c4925f',
    accentSoft: 'rgba(196,146,95,0.12)',
    warn: '#c98555',
    danger: '#b35040',
    cool: '#6a8eb0',
  },
  // Long-wavelength red — melatonin-friendly. Visible in a dark bedroom
  // without disrupting circadian rhythm. Used for bedside / corridor.
  nightRed: {
    bg: '#0a0202',
    surface: 'rgba(40,5,5,0.85)',
    surfaceHybrid: 'rgba(60,8,8,0.94)',
    surfaceTint: 'rgba(40,5,5,0.5)',
    text: '#cc3838',
    textDim: '#7a2020',
    border: 'rgba(180,40,40,0.18)',
    borderHybrid: 'rgba(180,40,40,0.30)',
    accent: '#e85050',
    accentSoft: 'rgba(232,80,80,0.10)',
    warn: '#e07070',
    danger: '#ff5050',
    cool: '#b04040',
  },
};

const FONTS = {
  sans: 'Geist, "IBM Plex Sans", system-ui, sans-serif',
  display: 'Geist, "IBM Plex Sans Condensed", system-ui, sans-serif',
  mono: '"Geist Mono", "JetBrains Mono", ui-monospace, monospace',
};

// Decide tier strip colour for a given severity
function tierColor(level) {
  if (level === 'red') return '#a83232';
  if (level === 'amber') return '#c4683a';
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// AmbientLayers — main entry. Renders the right layout for the screen
// size and routes sleep modes to the dedicated sleep component.
// ─────────────────────────────────────────────────────────────────────
function AmbientLayers({
  size = '1366x768',
  scenario = 'calm',
  mode = 'normal',
  timeOfDay = 'day',
  tickNow = 0,
  // Refinement props (with sensible defaults)
  collapsed = false,
  onToggleCollapsed = null,
  hybridForce = 'auto',         // 'auto' | 'on' | 'off'
  useBlur = false,
  showDirectionArrows = false,
  showSamplePoints = false,
  extendedRadius = false,
  radarTimelineFrame = 0.8,
  radarPlaying = false,
  showSettings = false,
  onToggleSettings = null,
  alertDetailOpen = null,       // index | null
  onOpenAlertDetail = null,
  onCloseAlertDetail = null,
  alertIdx = 0,
  onCycleAlert = null,
}) {
  const data = WX.getScenario(scenario);
  const [w, h] = typeof size === 'string' ? size.split('x').map(Number) : [size.w, size.h];
  const t = cTokens[timeOfDay] || cTokens.day;

  // Sleep modes route off to dedicated component (handles burn-in stage 2)
  if (mode === 'sleep' || mode === 'sleep-stage2') {
    return <AmbientSleep w={w} h={h} data={data} t={t} timeOfDay={timeOfDay} tickNow={tickNow} stage2={mode === 'sleep-stage2'}/>;
  }

  // Hybrid mode auto-trigger
  const hybridAuto = WX.hybridLevel(data); // 'red' | 'amber' | null
  const hybridOn = hybridForce === 'on' ? (hybridAuto || 'amber')
                 : hybridForce === 'off' ? null
                 : hybridAuto;

  const ctx = { t, FONTS, hybridOn, useBlur, data };

  // Pick layout by screen size
  if (w <= 800) {
    return <LayoutPi ctx={ctx} {...{ w, h, data, scenario, collapsed, onToggleCollapsed,
      showDirectionArrows, showSamplePoints, extendedRadius,
      radarTimelineFrame, radarPlaying, showSettings, onToggleSettings,
      alertDetailOpen, onOpenAlertDetail, onCloseAlertDetail,
      alertIdx, onCycleAlert, tickNow }}/>;
  }
  return <LayoutDesktop ctx={ctx} {...{ w, h, data, scenario, collapsed,
    showDirectionArrows, showSamplePoints, extendedRadius,
    radarTimelineFrame, radarPlaying, showSettings, onToggleSettings,
    alertDetailOpen, onOpenAlertDetail, onCloseAlertDetail,
    alertIdx, onCycleAlert, tickNow }}/>;
}

// ─────────────────────────────────────────────────────────────────────
// LAYOUT — 7" Pi (≤800×480): horizontal split 70/30
// ─────────────────────────────────────────────────────────────────────
function LayoutPi({ ctx, w, h, data, collapsed, onToggleCollapsed,
  showDirectionArrows, showSamplePoints, extendedRadius,
  radarTimelineFrame, radarPlaying,
  showSettings, onToggleSettings,
  alertDetailOpen, onOpenAlertDetail, onCloseAlertDetail,
  alertIdx, onCycleAlert, tickNow }) {
  const { t, FONTS, hybridOn } = ctx;
  const isLight = t === cTokens.day;
  const dockH = 52;
  const bodyH = h - dockH;
  const colW = collapsed ? 0 : 248;
  const mapW = w - colW;

  return (
    <div style={{
      width: w, height: h, background: t.bg, color: t.text,
      fontFamily: FONTS.sans, fontSize: 13, position: 'relative', overflow: 'hidden',
    }}>
      {/* Map area */}
      <div style={{ position: 'absolute', left: 0, top: 0, width: mapW, height: bodyH, overflow: 'hidden' }}>
        <MapBg mode={data.radar} variant={isLight ? 'light' : 'dark'}
          showRings={true} extendedRadius={extendedRadius}
          showDirectionArrows={showDirectionArrows}
          showSamplePoints={showSamplePoints}
          motion={data.radarMotion}
          timelineFrame={radarTimelineFrame}/>

        {/* Top-left map controls — zoom + direction arrows toggle */}
        <MapControls ctx={ctx}
          showDirectionArrows={showDirectionArrows}
          onToggleArrows={() => {}}
          extendedRadius={extendedRadius}/>

        {/* Floating alert mini-banner when collapsed AND alerts exist */}
        {collapsed && data.alerts && data.alerts.length > 0 && (
          <div style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', width: 'min(420px, 80%)' }}>
            <AlertBanner alerts={data.alerts} idx={alertIdx}
              onCycle={onCycleAlert} onOpen={() => onOpenAlertDetail(alertIdx)}
              t={t} mono={FONTS.mono} display={FONTS.display} compact={true}/>
          </div>
        )}

        {/* Collapse chevron — anchored to right edge of map */}
        <button onClick={onToggleCollapsed} style={{
          position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)',
          width: 22, height: 56, borderRadius: '8px 0 0 8px',
          background: t.surface, color: t.text,
          border: `1px solid ${t.border}`, borderRight: 'none',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: FONTS.mono, fontSize: 14, padding: 0,
        }} aria-label={collapsed ? 'Show info panel' : 'Hide info panel'}>
          {collapsed ? '‹' : '›'}
        </button>

        {/* Radar timeline along bottom of map */}
        <div style={{ position: 'absolute', left: 10, right: collapsed ? 32 : 14, bottom: 8 }}>
          <RadarTimeline frame={radarTimelineFrame} playing={radarPlaying}
            t={t} mono={FONTS.mono} compact={true}/>
        </div>
      </div>

      {/* Info column (right side) */}
      {!collapsed && (
        <div style={{
          position: 'absolute', right: 0, top: 0, width: colW, height: bodyH,
          background: t.bg, borderLeft: `1px solid ${t.border}`,
          padding: 8, display: 'flex', flexDirection: 'column', gap: 6,
          overflow: 'hidden',
        }}>
          <HeroCompact data={data} ctx={ctx} tickNow={tickNow}/>
          {data.alerts && data.alerts.length > 0 && (
            <div>
              <AlertBanner alerts={data.alerts} idx={alertIdx}
                onCycle={onCycleAlert} onOpen={() => onOpenAlertDetail(alertIdx)}
                expanded={alertDetailOpen != null && alertDetailOpen !== 'ai'}
                t={t} mono={FONTS.mono} display={FONTS.display} compact={true}/>
              {alertDetailOpen != null && alertDetailOpen !== 'ai' && (
                <AlertDetailInline
                  alert={data.alerts[alertDetailOpen % data.alerts.length]}
                  t={t} mono={FONTS.mono} display={FONTS.display} sans={FONTS.sans}
                  onClose={onCloseAlertDetail} maxHeight={200} compact={true}/>
              )}
            </div>
          )}
          <MetricsGrid data={data} ctx={ctx} compact={true}/>
          <IndoorBlock indoor={data.indoor} t={t} mono={FONTS.mono} display={FONTS.display} compact={true}/>
          <AiSummaryInline data={data} ctx={ctx} compact={true}/>
        </div>
      )}

      {/* Full-width dock */}
      <BottomDock ctx={ctx} w={w} dockH={dockH} compact={true}
        onSettings={onToggleSettings} settingsActive={showSettings}/>

      {/* Settings overlay */}
      {showSettings && <SettingsOverlay ctx={ctx} data={data} onClose={onToggleSettings}/>}

      {/* Alert detail is rendered INLINE under the banner (above). */}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// LAYOUT — desktop (HD+): map full-bleed with right rail
// ─────────────────────────────────────────────────────────────────────
function LayoutDesktop({ ctx, w, h, data, collapsed,
  showDirectionArrows, showSamplePoints, extendedRadius,
  radarTimelineFrame, radarPlaying,
  showSettings, onToggleSettings,
  alertDetailOpen, onOpenAlertDetail, onCloseAlertDetail,
  alertIdx, onCycleAlert, tickNow }) {
  const { t, FONTS, hybridOn } = ctx;
  const isLight = t === cTokens.day;
  const pad = w >= 1600 ? 28 : 22;
  const rail = collapsed ? 0 : (w >= 1600 ? 340 : 300);
  const heroH = w >= 1600 ? 200 : 160;
  const dockH = 64;

  return (
    <div style={{
      width: w, height: h, background: t.bg, color: t.text,
      fontFamily: FONTS.sans, fontSize: 13, position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', inset: 0 }}>
        <MapBg mode={data.radar} variant={isLight ? 'light' : 'dark'}
          showRings={true} extendedRadius={extendedRadius}
          showDirectionArrows={showDirectionArrows}
          showSamplePoints={showSamplePoints}
          motion={data.radarMotion}
          timelineFrame={radarTimelineFrame}/>
        <div style={{
          position: 'absolute', inset: 0,
          background: isLight
            ? 'linear-gradient(180deg, rgba(242,238,229,0.55) 0%, rgba(242,238,229,0.15) 25%, rgba(242,238,229,0.15) 75%, rgba(242,238,229,0.55) 100%)'
            : 'linear-gradient(180deg, rgba(12,11,9,0.55) 0%, rgba(12,11,9,0.15) 25%, rgba(12,11,9,0.15) 75%, rgba(12,11,9,0.6) 100%)',
        }}/>
      </div>

      {/* Top hero band */}
      <div style={{
        position: 'absolute', top: pad, left: pad, right: rail ? rail + pad : pad,
        display: 'grid', gridTemplateColumns: '1.3fr 1fr 1fr', gap: 14, alignItems: 'stretch',
      }}>
        <HeroPlaceDesktop data={data} ctx={ctx}/>
        <HeroTempDesktop data={data} ctx={ctx}/>
        <HeroClockDesktop data={data} ctx={ctx} tickNow={tickNow}/>
      </div>

      <MapControls ctx={ctx} extendedRadius={extendedRadius} desktop={true}/>

      {/* Right rail */}
      {!collapsed && (
        <div style={{
          position: 'absolute', right: pad, top: heroH + pad + 10,
          width: rail - pad - 4, bottom: dockH + pad + 10,
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          {data.alerts && data.alerts.length > 0 && (
            <div>
              <AlertBanner alerts={data.alerts} idx={alertIdx}
                onCycle={onCycleAlert} onOpen={() => onOpenAlertDetail(alertIdx)}
                expanded={alertDetailOpen != null && alertDetailOpen !== 'ai'}
                t={t} mono={FONTS.mono} display={FONTS.display}/>
              {alertDetailOpen != null && alertDetailOpen !== 'ai' && (
                <AlertDetailInline
                  alert={data.alerts[alertDetailOpen % data.alerts.length]}
                  t={t} mono={FONTS.mono} display={FONTS.display} sans={FONTS.sans}
                  onClose={onCloseAlertDetail} maxHeight={300}/>
              )}
            </div>
          )}
          <MetricsGrid data={data} ctx={ctx}/>
          <ForecastCard data={data} ctx={ctx}/>
          <IndoorBlock indoor={data.indoor} t={t} mono={FONTS.mono} display={FONTS.display}/>
          <AiCard data={data} ctx={ctx}/>
        </div>
      )}

      {/* Radar timeline along bottom-left */}
      <div style={{
        position: 'absolute', left: pad, bottom: dockH + pad + 10,
        width: collapsed ? `calc(100% - ${pad * 2}px)` : `calc(100% - ${rail + pad * 2}px)`,
      }}>
        <RadarTimeline frame={radarTimelineFrame} playing={radarPlaying}
          t={t} mono={FONTS.mono}/>
      </div>

      {/* Bottom dock */}
      <BottomDock ctx={ctx} w={w} dockH={dockH} compact={false}
        onSettings={onToggleSettings} settingsActive={showSettings}/>

      {showSettings && <SettingsOverlay ctx={ctx} data={data} onClose={onToggleSettings}/>}

      {/* Alert detail inline above. */}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// HERO — compact (7") and desktop variants
// ─────────────────────────────────────────────────────────────────────
function HeroCompact({ data, ctx, tickNow }) {
  const { t, FONTS, hybridOn } = ctx;
  const numFont = hybridOn ? FONTS.mono : FONTS.display;
  const now = new Date(Date.now() + (tickNow || 0) * 1000);
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');

  return (
    <div style={{
      background: hybridOn ? t.surfaceHybrid : t.surface,
      border: `1px solid ${hybridOn ? t.borderHybrid : t.border}`,
      borderRadius: 8, padding: '8px 10px',
      display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center',
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontFamily: FONTS.mono, fontSize: 8, letterSpacing: 1.4,
          color: t.textDim, textTransform: 'uppercase', marginBottom: 2,
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          <WxIcon kind="pin" size={9} strokeWidth={1.6}/>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{data.location.split(',')[0]}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{
            fontFamily: numFont, fontSize: 32, fontWeight: hybridOn ? 500 : 300, color: t.text,
            lineHeight: 1, letterSpacing: hybridOn ? 0 : -1, fontVariantNumeric: 'tabular-nums',
          }}>{data.now.temp}<span style={{ fontSize: 14, color: t.textDim }}>°</span></span>
          <span style={{ color: t.accent, marginLeft: 2 }}><WxIcon kind={data.now.icon} size={18} strokeWidth={1.4}/></span>
        </div>
        <div style={{
          fontFamily: FONTS.sans, fontSize: 11, color: t.textDim, marginTop: 1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{data.now.desc} · feels {data.now.feels}°</div>
        <div style={{
          fontFamily: FONTS.mono, fontSize: 9, letterSpacing: 0.6, color: t.textDim, marginTop: 3,
        }}>
          <WxIcon kind="wind" size={9} strokeWidth={1.6}/> {data.now.windKph} kph {WX.windCardinal(data.now.windDir)}
          {' · '}↑{data.sun.rise} ↓{data.sun.set}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{
          fontFamily: numFont, fontSize: 22, color: t.text, fontWeight: 300,
          letterSpacing: -1, lineHeight: 1, fontVariantNumeric: 'tabular-nums',
        }}>{hh}<span style={{ opacity: 0.4 }}>:</span>{mm}</div>
      </div>
    </div>
  );
}

function HeroPlaceDesktop({ data, ctx }) {
  const { t, FONTS, hybridOn } = ctx;
  return (
    <div style={{
      background: hybridOn ? t.surfaceHybrid : t.surface,
      border: `1px solid ${hybridOn ? t.borderHybrid : t.border}`,
      borderRadius: 14, padding: '16px 20px',
    }}>
      <div style={{
        fontFamily: FONTS.mono, fontSize: 10, letterSpacing: 1.6,
        color: t.textDim, textTransform: 'uppercase', marginBottom: 6,
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <WxIcon kind="pin" size={11} strokeWidth={1.6}/> Current location
      </div>
      <div style={{
        fontFamily: FONTS.display, fontSize: 26, fontWeight: 500, color: t.text,
        letterSpacing: -0.5, lineHeight: 1.1,
      }}>{data.location.split(',')[0]}</div>
      <div style={{ fontFamily: FONTS.mono, fontSize: 11, color: t.textDim, marginTop: 4 }}>
        {data.coord} · {data.location.split(',')[1].trim()}
      </div>
    </div>
  );
}

function HeroTempDesktop({ data, ctx }) {
  const { t, FONTS, hybridOn } = ctx;
  const numFont = hybridOn ? FONTS.mono : FONTS.display;
  return (
    <div style={{
      background: hybridOn ? t.surfaceHybrid : t.surface,
      border: `1px solid ${hybridOn ? t.borderHybrid : t.border}`,
      borderRadius: 14, padding: '16px 20px',
      borderLeft: hybridOn ? `4px solid ${tierColor(hybridOn) || t.accent}` : `1px solid ${t.border}`,
    }}>
      <div style={{
        fontFamily: FONTS.mono, fontSize: 10, letterSpacing: 1.6,
        color: t.textDim, textTransform: 'uppercase', marginBottom: 6,
      }}>Outside · feels {data.now.feels}°</div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span style={{
          fontFamily: numFont, fontSize: 72, fontWeight: hybridOn ? 500 : 200,
          color: t.text, lineHeight: 0.9, letterSpacing: hybridOn ? -1 : -2.5,
          fontVariantNumeric: 'tabular-nums',
        }}>{data.now.temp}</span>
        <span style={{ fontFamily: FONTS.display, fontSize: 22, color: t.textDim, marginTop: 4 }}>°C</span>
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div style={{ color: t.accent, marginBottom: 4 }}><WxIcon kind={data.now.icon} size={28} strokeWidth={1.3}/></div>
          <div style={{ fontFamily: FONTS.sans, fontSize: 12, color: t.text }}>{data.now.desc}</div>
        </div>
      </div>
    </div>
  );
}

function HeroClockDesktop({ data, ctx, tickNow }) {
  const { t, FONTS, hybridOn } = ctx;
  const numFont = hybridOn ? FONTS.mono : FONTS.display;
  const now = new Date(Date.now() + (tickNow || 0) * 1000);
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const day = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][now.getDay()];
  return (
    <div style={{
      background: hybridOn ? t.surfaceHybrid : t.surface,
      border: `1px solid ${hybridOn ? t.borderHybrid : t.border}`,
      borderRadius: 14, padding: '16px 20px',
      display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
    }}>
      <div style={{
        fontFamily: FONTS.mono, fontSize: 10, letterSpacing: 1.6,
        color: t.textDim, textTransform: 'uppercase',
      }}>{day} · {now.getDate()} May</div>
      <div style={{
        fontFamily: numFont, fontSize: 56, fontWeight: hybridOn ? 500 : 200,
        color: t.text, letterSpacing: hybridOn ? -1 : -2, lineHeight: 1,
        fontVariantNumeric: 'tabular-nums', marginTop: 4,
      }}>{hh}<span style={{ color: t.textDim, opacity: 0.4 }}>:</span>{mm}</div>
      <div style={{
        fontFamily: FONTS.mono, fontSize: 9, letterSpacing: 1, color: t.textDim, marginTop: 6,
      }}>↑{data.sun.rise} · ↓{data.sun.set}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// METRICS GRID — 2×2 with severity strips in hybrid mode
// ─────────────────────────────────────────────────────────────────────
function MetricsGrid({ data, ctx, compact = false }) {
  const { t, FONTS, hybridOn } = ctx;
  const numFont = hybridOn ? FONTS.mono : FONTS.display;
  const sevColor = tierColor(hybridOn);
  const metrics = [
    { icon: 'wind', label: 'Wind', value: `${data.now.windKph}`, unit: 'kph',
      extra: WX.windCardinal(data.now.windDir),
      critical: data.now.windKph >= 40 },
    { icon: 'humidity', label: 'Humid', value: `${data.now.humidity}`, unit: '%' },
    { icon: 'uv', label: 'UV', value: `${data.now.uv}`, unit: '' },
    { icon: 'pressure', label: 'Press', value: `${data.now.pressure}`, unit: '',
      extra: data.now.pressureTrend.includes('rising') ? '↑' : data.now.pressureTrend.includes('falling') ? '↓' : '→',
      critical: data.now.pressureTrend === 'falling-fast' },
  ];
  return (
    <div style={{
      background: hybridOn ? t.surfaceHybrid : t.surface,
      border: `1px solid ${hybridOn ? t.borderHybrid : t.border}`,
      borderRadius: 8, padding: compact ? 8 : 12,
      display: 'grid', gridTemplateColumns: '1fr 1fr', gap: compact ? 6 : 10,
    }}>
      {metrics.map((m) => (
        <div key={m.label} style={{
          paddingLeft: hybridOn && m.critical ? 6 : 0,
          borderLeft: hybridOn && m.critical && sevColor ? `3px solid ${sevColor}` : 'none',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            color: t.textDim, fontFamily: FONTS.mono, fontSize: 8, letterSpacing: 1.2,
            textTransform: 'uppercase', marginBottom: 2,
          }}>
            <WxIcon kind={m.icon} size={9} strokeWidth={1.6}/>{m.label}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
            <span style={{
              fontFamily: numFont, fontSize: compact ? 16 : 22, color: t.text,
              fontWeight: hybridOn ? 500 : 400, lineHeight: 1, fontVariantNumeric: 'tabular-nums',
            }}>{m.value}</span>
            <span style={{ fontFamily: FONTS.mono, fontSize: 9, color: t.textDim }}>{m.unit}</span>
            {m.extra && (
              <span style={{ fontFamily: FONTS.mono, fontSize: 9, color: t.accent, marginLeft: 'auto' }}>{m.extra}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// CHART TABS — Hourly / Daily mini-chart
// ─────────────────────────────────────────────────────────────────────
function ChartTabs({ data, ctx }) {
  const { t, FONTS, hybridOn } = ctx;
  const [tab, setTab] = React.useState('hourly');
  return (
    <div style={{
      background: hybridOn ? t.surfaceHybrid : t.surface,
      border: `1px solid ${hybridOn ? t.borderHybrid : t.border}`,
      borderRadius: 8, padding: 8, minHeight: 130,
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
        {['hourly', 'daily'].map((k) => (
          <button key={k} onClick={() => setTab(k)} style={{
            flex: 1, fontFamily: FONTS.mono, fontSize: 9, letterSpacing: 1,
            padding: '4px 6px', border: 'none', borderRadius: 4, cursor: 'pointer',
            textTransform: 'uppercase',
            background: tab === k ? t.accent : 'transparent',
            color: tab === k ? '#fff' : t.textDim,
          }}>{k}</button>
        ))}
      </div>
      {tab === 'hourly' ? (
        <HourlyChart data={data} ctx={ctx}/>
      ) : (
        <DailyMiniChart data={data} ctx={ctx}/>
      )}
    </div>
  );
}

function HourlyChart({ data, ctx }) {
  const { t, FONTS } = ctx;
  const W = 224, H = 80;
  const hours = data.hourly.slice(0, 12);
  const precip = data.hourlyPrecip.slice(0, 12);
  const min = Math.min(...hours), max = Math.max(...hours);
  const range = Math.max(1, max - min);
  const stepX = W / (hours.length - 1);
  const path = hours.map((v, i) => `${i === 0 ? 'M' : 'L'} ${i * stepX} ${H - ((v - min) / range) * (H - 14) - 4}`).join(' ');
  return (
    <div style={{ flex: 1 }}>
      <svg width={W} height={H} style={{ display: 'block' }}>
        {/* precip bars */}
        {precip.map((p, i) => p > 0 && (
          <rect key={i} x={i * stepX - 6} y={H - (p / 100) * H * 0.5} width="12" height={(p / 100) * H * 0.5}
            fill={t.cool} opacity="0.35"/>
        ))}
        <path d={path} fill="none" stroke={t.accent} strokeWidth="2"/>
        {hours.map((v, i) => (
          <circle key={i} cx={i * stepX} cy={H - ((v - min) / range) * (H - 14) - 4} r="2" fill={t.accent}/>
        ))}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: FONTS.mono, fontSize: 8, color: t.textDim, letterSpacing: 0.6, marginTop: 2 }}>
        <span>NOW</span><span>+6H</span><span>+12H</span>
      </div>
    </div>
  );
}

function DailyMiniChart({ data, ctx }) {
  const { t, FONTS } = ctx;
  return (
    <div style={{ flex: 1, display: 'flex', justifyContent: 'space-between', gap: 4, alignItems: 'flex-end' }}>
      {data.daily.map((d, i) => (
        <div key={d.d} style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ fontFamily: FONTS.mono, fontSize: 8, color: t.textDim, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.6 }}>{d.d}</div>
          <div style={{ color: i === 0 ? t.accent : t.text }}><WxIcon kind={d.icon} size={14} strokeWidth={1.4}/></div>
          <div style={{ fontFamily: FONTS.display, fontSize: 12, color: t.text, fontWeight: 500, marginTop: 3, lineHeight: 1 }}>{d.hi}°</div>
          <div style={{ fontFamily: FONTS.display, fontSize: 10, color: t.textDim }}>{d.lo}°</div>
          {d.precip > 30 && (
            <div style={{ fontFamily: FONTS.mono, fontSize: 8, color: t.cool, marginTop: 1 }}>{d.precip}%</div>
          )}
        </div>
      ))}
    </div>
  );
}

function ForecastCard({ data, ctx }) {
  const { t, FONTS, hybridOn } = ctx;
  return (
    <div style={{
      background: hybridOn ? t.surfaceHybrid : t.surface,
      border: `1px solid ${hybridOn ? t.borderHybrid : t.border}`,
      borderRadius: 10, padding: 12,
    }}>
      <div style={{
        fontFamily: FONTS.mono, fontSize: 9, letterSpacing: 1.6, color: t.textDim,
        textTransform: 'uppercase', marginBottom: 8,
      }}>Next 5 days · °C</div>
      <DailyMiniChart data={data} ctx={ctx}/>
    </div>
  );
}

// AI summary — visible inline by DEFAULT on Pi (3 paragraphs).
// Chevron collapses it (not the inverse) so the daily-driver feature
// stays in the eyeline. Header doubles as the collapse handle.
function AiSummaryInline({ data, ctx, compact = false }) {
  const { t, FONTS, hybridOn } = ctx;
  const [collapsed, setCollapsed] = React.useState(false);
  const ai = typeof data.aiSummary === 'string'
    ? { paragraphs: [data.aiSummary], confidence: data.now.confidence, lastUpdated: '' }
    : data.aiSummary;
  const bucket = WX.confidenceBucket(ai.confidence || 0);
  const confColor = bucket === 'high' ? t.accent : bucket === 'med' ? t.warn : t.danger;
  return (
    <div style={{
      background: hybridOn ? t.surfaceHybrid : t.surface,
      border: `1px solid ${hybridOn ? t.borderHybrid : t.border}`,
      borderRadius: 8, padding: compact ? '8px 10px' : '10px 12px',
      flex: collapsed ? '0 0 auto' : '1 1 auto', minHeight: 0,
      display: 'flex', flexDirection: 'column', gap: 6,
      overflow: 'hidden',
    }}>
      <button onClick={() => setCollapsed(c => !c)} style={{
        background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 6, color: t.accent,
      }}>
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: t.accent, flexShrink: 0 }}/>
        <span style={{
          fontFamily: FONTS.mono, fontSize: 9, letterSpacing: 1.4,
          color: t.accent, textTransform: 'uppercase',
        }}>AI summary</span>
        <span style={{
          fontFamily: FONTS.mono, fontSize: 8, letterSpacing: 1, color: confColor,
          padding: '1px 4px', borderRadius: 3, border: `1px solid ${confColor}`,
          textTransform: 'uppercase',
        }}>{ai.confidence}%</span>
        {ai.lastUpdated && (
          <span style={{ fontFamily: FONTS.mono, fontSize: 8, letterSpacing: 0.8, color: t.textDim, textTransform: 'uppercase' }}>upd {ai.lastUpdated}</span>
        )}
        <span style={{
          marginLeft: 'auto', fontFamily: FONTS.mono, fontSize: 11, color: t.textDim,
          transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)', transition: 'transform 150ms',
        }}>▸</span>
      </button>
      {!collapsed && (
        <div style={{
          fontFamily: FONTS.sans, fontSize: compact ? 11 : 12.5, lineHeight: 1.5,
          color: t.text, textWrap: 'pretty',
          display: 'flex', flexDirection: 'column', gap: compact ? 5 : 7,
          overflowY: 'auto', minHeight: 0,
        }}>
          {ai.paragraphs.map((p, i) => <div key={i}>{p}</div>)}
        </div>
      )}
    </div>
  );
}

function AiCard({ data, ctx }) {
  const { t, FONTS, hybridOn } = ctx;
  const ai = typeof data.aiSummary === 'string'
    ? { paragraphs: [data.aiSummary], confidence: data.now.confidence, lastUpdated: '' }
    : data.aiSummary;
  const bucket = WX.confidenceBucket(ai.confidence || 0);
  const confColor = bucket === 'high' ? t.accent : bucket === 'med' ? t.warn : t.danger;
  return (
    <div style={{
      background: hybridOn ? t.surfaceHybrid : t.surface,
      border: `1px solid ${hybridOn ? t.borderHybrid : t.border}`,
      borderRadius: 10, padding: 14, flex: 1, minHeight: 0, overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        fontFamily: FONTS.mono, fontSize: 9, letterSpacing: 1.6,
        textTransform: 'uppercase', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: t.accent }}/>
        <span style={{ color: t.accent }}>AI summary</span>
        <span style={{
          fontFamily: FONTS.mono, fontSize: 8, letterSpacing: 1, color: confColor,
          padding: '1px 5px', borderRadius: 3, border: `1px solid ${confColor}`,
        }}>{ai.confidence}%</span>
        {ai.lastUpdated && (
          <span style={{ color: t.textDim, fontSize: 8, letterSpacing: 0.8 }}>UPD {ai.lastUpdated}</span>
        )}
      </div>
      <div style={{
        fontFamily: FONTS.sans, fontSize: 12.5, lineHeight: 1.55, color: t.text,
        textWrap: 'pretty', overflow: 'auto',
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        {ai.paragraphs.map((p, i) => <div key={i}>{p}</div>)}
      </div>
    </div>
  );
}

function AiOverlay({ data, ctx, onClose }) {
  const { t, FONTS } = ctx;
  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 50, padding: 18,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: t.surface, color: t.text, border: `1px solid ${t.border}`,
        borderRadius: 12, maxWidth: 460, width: '100%', maxHeight: '85%',
        padding: 18, overflowY: 'auto',
      }}>
        <div style={{
          fontFamily: FONTS.mono, fontSize: 10, letterSpacing: 1.4, color: t.accent,
          textTransform: 'uppercase', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: t.accent }}/> AI summary
          <button onClick={onClose} style={{
            marginLeft: 'auto', background: 'transparent', color: t.textDim,
            border: 'none', fontFamily: FONTS.mono, fontSize: 10, cursor: 'pointer',
          }}>✕</button>
        </div>
        <div style={{ fontFamily: FONTS.sans, fontSize: 14, lineHeight: 1.55, color: t.text, textWrap: 'pretty' }}>
          {data.aiSummary}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// MAP CONTROLS — top-left: zoom + direction arrows toggle
// ─────────────────────────────────────────────────────────────────────
function MapControls({ ctx, showDirectionArrows, onToggleArrows, extendedRadius, desktop = false }) {
  const { t, FONTS } = ctx;
  const btnSize = desktop ? 36 : 30;
  return (
    <div style={{
      position: 'absolute', left: 10, top: 10,
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      {['+', '−'].map((sym, i) => (
        <button key={sym} style={{
          width: btnSize, height: btnSize, borderRadius: 6,
          background: t.surface, color: t.text, border: `1px solid ${t.border}`,
          cursor: 'pointer', fontFamily: FONTS.mono, fontSize: 16, fontWeight: 500,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
        }} aria-label={i === 0 ? 'Zoom in' : 'Zoom out'}>{sym}</button>
      ))}
      <button title="Toggle direction arrows" style={{
        width: btnSize, height: btnSize, borderRadius: 6,
        background: showDirectionArrows ? t.accent : t.surface,
        color: showDirectionArrows ? '#fff' : t.text,
        border: `1px solid ${showDirectionArrows ? t.accent : t.border}`,
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginTop: 4, padding: 0,
      }} aria-label="Toggle motion arrows" aria-pressed={showDirectionArrows}>
        <svg width={btnSize * 0.5} height={btnSize * 0.5} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14M13 6l6 6-6 6"/>
        </svg>
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// BOTTOM DOCK — labeled, ≥44px tactile targets, active state
// ─────────────────────────────────────────────────────────────────────
function BottomDock({ ctx, w, dockH, compact, onSettings, settingsActive }) {
  const { t, FONTS } = ctx;
  const items = [
    { k: 'crosshair', label: 'Centre' },
    { k: 'layers', label: 'Layers' },
    { k: 'chart', label: 'Charts' },
    { k: 'contrast', label: 'Sleep' },
    { k: 'gear', label: 'Settings', active: settingsActive, onClick: onSettings },
  ];
  const itemMinW = compact ? 64 : 88;
  return (
    <div style={{
      position: 'absolute', left: 0, right: 0, bottom: 0, height: dockH,
      background: t.surfaceHybrid, borderTop: `1px solid ${t.border}`,
      display: 'flex', alignItems: 'center', justifyContent: 'space-around',
      padding: compact ? '4px 8px' : '6px 14px',
    }}>
      {items.map((it) => (
        <button key={it.k} onClick={it.onClick} aria-pressed={!!it.active} style={{
          background: it.active ? t.accentSoft : 'transparent', border: 'none',
          color: it.active ? t.accent : t.text, cursor: 'pointer',
          minWidth: itemMinW, minHeight: 44,
          padding: compact ? '4px 6px' : '6px 12px', borderRadius: 8,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
          position: 'relative',
        }}>
          <WxIcon kind={it.k} size={compact ? 18 : 20} strokeWidth={1.5}/>
          <span style={{
            fontFamily: FONTS.mono, fontSize: 9, letterSpacing: 0.6, color: it.active ? t.accent : t.textDim,
            textTransform: 'uppercase',
          }}>{it.label}</span>
          {it.active && (
            <span style={{ position: 'absolute', bottom: 2, width: 14, height: 2, background: t.accent, borderRadius: 1 }}/>
          )}
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// SETTINGS OVERLAY — brightness slider, sample-points toggle, etc.
// ─────────────────────────────────────────────────────────────────────
function SettingsOverlay({ ctx, data, onClose }) {
  const { t, FONTS } = ctx;
  // Brightness slider → POST /api/brightness {value: 0..100}.
  // The Pi server endpoint auto-detects /sys/class/backlight/<device>/brightness
  // and converts percentage to native hardware value.
  const [brightness, setBrightness] = React.useState(data.brightness || 75);
  const [stage1Delay, setStage1Delay] = React.useState(10);       // minutes idle → sleep
  const [stage1Brightness, setStage1Brightness] = React.useState(30); // % during sleep
  const [stage2Enabled, setStage2Enabled] = React.useState(true);
  const [stage2Delay, setStage2Delay] = React.useState(20);       // minutes after sleep → burn-in

  const label = (txt, val) => (
    <div style={{
      display: 'flex', alignItems: 'baseline', marginBottom: 4,
      fontFamily: FONTS.mono, fontSize: 9, letterSpacing: 1.2, color: t.textDim, textTransform: 'uppercase',
    }}>
      <span>{txt}</span>
      <span style={{ marginLeft: 'auto', color: t.text, fontVariantNumeric: 'tabular-nums' }}>{val}</span>
    </div>
  );
  const slider = (val, set, min, max, step = 1) => (
    <input type="range" min={min} max={max} step={step} value={val}
      onChange={(e) => set(+e.target.value)}
      style={{ width: '100%', accentColor: t.accent }}/>
  );
  const sectionHeader = (txt) => (
    <div style={{
      fontFamily: FONTS.mono, fontSize: 9, letterSpacing: 1.4, color: t.accent,
      textTransform: 'uppercase', marginTop: 14, marginBottom: 8,
      paddingBottom: 4, borderBottom: `1px solid ${t.border}`,
    }}>{txt}</div>
  );

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 60, padding: 18,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: t.surface, color: t.text, border: `1px solid ${t.border}`,
        borderRadius: 12, maxWidth: 440, width: '100%', maxHeight: '92%',
        padding: 18, overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
          <span style={{
            fontFamily: FONTS.mono, fontSize: 11, letterSpacing: 1.6, color: t.text,
            textTransform: 'uppercase', fontWeight: 600,
          }}>Settings</span>
          <button onClick={onClose} style={{
            marginLeft: 'auto', background: 'transparent', color: t.textDim,
            border: 'none', fontFamily: FONTS.mono, fontSize: 12, cursor: 'pointer',
          }}>✕</button>
        </div>

        {sectionHeader('Display')}
        <div style={{ marginBottom: 10 }}>
          {label('Brightness', `${brightness}%`)}
          {slider(brightness, setBrightness, 5, 100)}
          <div style={{ fontFamily: FONTS.sans, fontSize: 10, color: t.textDim, marginTop: 3 }}>
            POST /api/brightness · Pi DSI hardware-controlled
          </div>
        </div>

        {sectionHeader('Sleep')}
        <div style={{ marginBottom: 10 }}>
          {label('Stage 1 · idle delay', `${stage1Delay} min`)}
          {slider(stage1Delay, setStage1Delay, 1, 60)}
        </div>
        <div style={{ marginBottom: 10 }}>
          {label('Stage 1 · dim brightness', `${stage1Brightness}%`)}
          {slider(stage1Brightness, setStage1Brightness, 5, 100)}
        </div>
        <div style={{ marginBottom: 8, fontFamily: FONTS.sans, fontSize: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={stage2Enabled} onChange={(e) => setStage2Enabled(e.target.checked)} style={{ accentColor: t.accent }}/>
            <span style={{ color: t.text }}>Stage 2 · burn-in protection (drifting pixel)</span>
          </label>
        </div>
        {stage2Enabled && (
          <div style={{ marginBottom: 10, paddingLeft: 22 }}>
            {label('Stage 2 · delay after sleep', `${stage2Delay} min`)}
            {slider(stage2Delay, setStage2Delay, 5, 120)}
          </div>
        )}

        {sectionHeader('Map')}
        <div style={{ marginBottom: 6, fontFamily: FONTS.sans, fontSize: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" style={{ accentColor: t.accent }}/>
            <span style={{ color: t.text }}>Show sample points (debug)</span>
          </label>
        </div>
        <div style={{ marginBottom: 10, fontFamily: FONTS.sans, fontSize: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" style={{ accentColor: t.accent }}/>
            <span style={{ color: t.text }}>Extended radius (100 km red)</span>
          </label>
        </div>

        <div style={{
          marginTop: 14, paddingTop: 10, borderTop: `1px solid ${t.border}`,
          fontFamily: FONTS.mono, fontSize: 9, letterSpacing: 1, color: t.textDim, textTransform: 'uppercase',
        }}>
          Stored in settings.json · backdrop blur disabled on Pi 4
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// SLEEP — three palettes (day/dusk/night/nightRed) + stage 2 burn-in
// ─────────────────────────────────────────────────────────────────────
function AmbientSleep({ w, h, data, t, timeOfDay, tickNow, stage2 = false }) {
  const now = new Date(Date.now() + (tickNow || 0) * 1000);
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const drift = (tickNow || 0) * 0.002;
  const dx = Math.sin(drift) * 14;
  const dy = Math.cos(drift * 0.7) * 10;

  // STAGE 2 — pure black with a single moving pixel (burn-in protection)
  if (stage2) {
    const px = Math.sin(drift * 0.8) * (w / 2 - 30) + w / 2;
    const py = Math.cos(drift * 0.9) * (h / 2 - 30) + h / 2;
    const red = timeOfDay === 'nightRed';
    return (
      <div style={{ width: w, height: h, background: '#000', position: 'relative', overflow: 'hidden' }}>
        <div style={{
          position: 'absolute', left: px - 1, top: py - 1, width: 2, height: 2,
          background: red ? '#660000' : '#1a1610', borderRadius: 1,
        }}/>
        <div style={{
          position: 'absolute', bottom: 18, left: 0, right: 0, textAlign: 'center',
          fontFamily: '"Geist Mono", monospace', fontSize: 8, letterSpacing: 2,
          color: red ? '#400' : '#1f1812', textTransform: 'uppercase', opacity: 0.6,
        }}>stage 2 · tap to wake</div>
      </div>
    );
  }

  const bg = timeOfDay === 'day' ? '#f2eee5' : timeOfDay === 'nightRed' ? '#0a0202' : '#08070a';
  const fg = timeOfDay === 'day' ? '#3a352c'
            : timeOfDay === 'nightRed' ? '#cc3838'
            : t.accent;
  const dim = timeOfDay === 'day' ? '#7d7568'
            : timeOfDay === 'nightRed' ? '#601818'
            : '#5a4d36';

  return (
    <div style={{
      width: w, height: h, background: bg, color: fg,
      fontFamily: FONTS.display, position: 'relative', overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex',
        flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        transform: `translate(${dx}px, ${dy}px)`,
      }}>
        <div style={{
          fontFamily: FONTS.mono, fontSize: w < 900 ? 10 : 12, letterSpacing: 3,
          color: dim, textTransform: 'uppercase', marginBottom: w < 900 ? 16 : 28,
        }}>
          {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][now.getDay()]} · {now.getDate()} May · {data.location.split(',')[0]}
        </div>

        <div style={{
          fontSize: Math.min(w, h) * 0.34, fontWeight: 100,
          letterSpacing: -Math.min(w, h) * 0.018, lineHeight: 0.85, color: fg,
          fontVariantNumeric: 'tabular-nums',
        }}>{hh}<span style={{ opacity: 0.4 }}>:</span>{mm}</div>

        <div style={{
          marginTop: w < 900 ? 18 : 30,
          display: 'flex', alignItems: 'center', gap: 14, color: fg,
        }}>
          <WxIcon kind={data.now.icon} size={w < 900 ? 22 : 30} strokeWidth={1.2}/>
          <span style={{ fontSize: w < 900 ? 18 : 26, fontWeight: 300 }}>
            {data.now.temp}°<span style={{ color: dim, fontSize: '0.75em', marginLeft: 6 }}>{data.now.desc.toLowerCase()}</span>
          </span>
        </div>

        {data.alerts && data.alerts.length > 0 && (
          <div style={{
            marginTop: w < 900 ? 18 : 28,
            padding: '6px 14px', borderRadius: 20,
            background: data.alerts[0].tier === 'red' ? '#a8323240' : '#c4683a40',
            color: data.alerts[0].tier === 'red' ? (timeOfDay === 'nightRed' ? '#ff4040' : '#e85050') : '#e09060',
            fontFamily: FONTS.mono, fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase',
            display: 'flex', alignItems: 'center', gap: 8, maxWidth: '85%',
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }}/>
            <SourceBadge source={data.alerts[0].source} t={t} mono={FONTS.mono}/>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{data.alerts[0].title}</span>
          </div>
        )}
      </div>

      <div style={{
        position: 'absolute', bottom: 16, left: 0, right: 0, textAlign: 'center',
        fontFamily: FONTS.mono, fontSize: 9, letterSpacing: 2, color: dim,
        textTransform: 'uppercase', opacity: 0.5,
      }}>tap to wake</div>
    </div>
  );
}

window.AmbientLayers = AmbientLayers;
window.cTokens = cTokens;
window.cFONTS = FONTS;
window.AiSummaryInline = AiSummaryInline;
