// Direction B — "Editorial Atlas"
// Map-dominant, magazine-grade typography. Big serif numerals, generous whitespace,
// information layered as translucent slabs over the radar. Sleep mode is poetic.

const bTokens = {
  bg: '#15161a',
  ink: '#0d0e10',
  paper: '#1c1d22',
  paper2: '#23252c',
  cream: '#ece6da',
  cream2: '#d6cfc1',
  dim: '#888173',
  faint: '#56523f80',
  accent: '#d97757',  // warm clay
  cool: '#7baed1',
  green: '#8ab66f',
  red: '#d96552',
  amber: '#d9a857',
};

function EditorialAtlas({ size = '1366x768', scenario = 'calm', mode = 'normal', tickNow = 0 }) {
  const data = WX.getScenario(scenario);
  const [w, h] = typeof size === 'string' ? size.split('x').map(Number) : [size.w, size.h];

  const tiny = w < 900;
  const compact = w < 1200;
  const t = bTokens;

  if (mode === 'sleep') return <EditorialSleep w={w} h={h} data={data} tickNow={tickNow}/>;

  const serif = 'Newsreader, "Iowan Old Style", Georgia, serif';
  const sans = 'Geist, "IBM Plex Sans", system-ui, sans-serif';
  const mono = '"Geist Mono", "JetBrains Mono", ui-monospace, monospace';

  return (
    <div style={{
      width: w, height: h, background: t.bg, color: t.cream,
      fontFamily: sans, fontSize: 13, position: 'relative', overflow: 'hidden',
    }}>
      {/* Full-bleed radar */}
      <div style={{ position: 'absolute', inset: 0 }}>
        <MapBg mode={data.radar} variant="dark"/>
        {/* Cream-tinted veil so labels read */}
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at 65% 50%, transparent 30%, rgba(13,14,16,0.55) 100%)' }}/>
      </div>

      {/* Editorial frame */}
      <div style={{
        position: 'absolute', inset: 0,
        padding: tiny ? '14px 16px' : compact ? '20px 24px' : '28px 36px',
        display: 'grid',
        gridTemplateRows: 'auto 1fr auto',
        gridTemplateColumns: tiny ? '1fr' : '1fr auto',
        gap: tiny ? 12 : 18,
      }}>
        {/* ── Masthead row ── */}
        <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <Masthead data={data} t={t} serif={serif} mono={mono} compact={compact} tiny={tiny}/>
          <ClockEdit data={data} t={t} serif={serif} mono={mono} compact={compact} tiny={tiny} tickNow={tickNow}/>
        </div>

        {/* ── Center area: the temperature plate ── */}
        <div style={{
          gridColumn: '1 / -1', alignSelf: 'center', justifySelf: tiny ? 'center' : 'start',
          maxWidth: tiny ? '100%' : 520, marginTop: tiny ? 0 : -h * 0.05,
        }}>
          {data.alert && (
            <AlertBar alert={data.alert} t={t} mono={mono} serif={serif}/>
          )}
          <TempPlate data={data} t={t} serif={serif} sans={sans} mono={mono} tiny={tiny} compact={compact}/>
        </div>

        {/* ── Right rail: forecast + AI summary ── */}
        {!tiny && (
          <div style={{
            position: 'absolute', right: compact ? 24 : 36, top: compact ? 84 : 110, bottom: compact ? 84 : 110,
            width: compact ? 260 : 320, display: 'flex', flexDirection: 'column', gap: 14,
            background: 'rgba(13,14,16,0.55)', backdropFilter: 'blur(10px)',
            border: `1px solid rgba(255,255,255,0.06)`,
            padding: compact ? 16 : 22, overflow: 'auto',
          }}>
            <RightRail data={data} t={t} serif={serif} sans={sans} mono={mono} compact={compact}/>
          </div>
        )}

        {/* ── Footer: timeline ribbon ── */}
        <div style={{ gridColumn: '1 / -1' }}>
          <TimelineEdit data={data} t={t} serif={serif} mono={mono} compact={compact} tiny={tiny}/>
        </div>
      </div>
    </div>
  );
}

function Masthead({ data, t, serif, mono, compact, tiny }) {
  return (
    <div>
      <div style={{
        fontFamily: mono, fontSize: 10, letterSpacing: 3, color: t.cream2,
        textTransform: 'uppercase', marginBottom: 6, opacity: 0.7,
      }}>· The Atlas · vol. 2 ·</div>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 10, color: t.cream,
      }}>
        <WxIcon kind="pin" size={tiny ? 14 : 18} strokeWidth={1.4} style={{ color: t.accent }}/>
        <span style={{ fontFamily: serif, fontSize: tiny ? 18 : compact ? 22 : 26, fontStyle: 'italic', letterSpacing: -0.3, lineHeight: 1 }}>
          {data.location.split(',')[0]}
        </span>
        <span style={{ fontFamily: mono, fontSize: 10, color: t.dim, letterSpacing: 1, textTransform: 'uppercase' }}>
          {data.location.split(',')[1]}
        </span>
      </div>
    </div>
  );
}

function ClockEdit({ data, t, serif, mono, compact, tiny, tickNow }) {
  const now = new Date(Date.now() + (tickNow || 0) * 60000);
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const dayLong = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][now.getDay()];
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{
        fontFamily: serif, fontStyle: 'italic', fontSize: tiny ? 12 : 14,
        color: t.cream2, letterSpacing: 0.3, marginBottom: 2,
      }}>{dayLong}, {now.getDate()} May</div>
      <div style={{
        fontFamily: serif, fontSize: tiny ? 28 : compact ? 38 : 48,
        color: t.cream, letterSpacing: -2, lineHeight: 1, fontWeight: 300,
        fontVariantNumeric: 'tabular-nums',
      }}>{hh}<span style={{ color: t.dim, opacity: 0.5 }}>:</span>{mm}</div>
      <div style={{
        fontFamily: mono, fontSize: 10, color: t.dim, letterSpacing: 1.4,
        marginTop: 6, display: 'flex', gap: 14, justifyContent: 'flex-end',
        textTransform: 'uppercase',
      }}>
        <span>↑ {data.sun.rise}</span>
        <span>↓ {data.sun.set}</span>
      </div>
    </div>
  );
}

function AlertBar({ alert, t, mono, serif }) {
  const color = alert.level === 'warning' ? t.red : t.amber;
  return (
    <div style={{
      padding: '10px 14px', marginBottom: 18,
      borderLeft: `3px solid ${color}`,
      background: `${color}1a`,
      display: 'flex', alignItems: 'baseline', gap: 12,
    }}>
      <span style={{
        fontFamily: mono, fontSize: 9, letterSpacing: 2, color, fontWeight: 600,
        textTransform: 'uppercase',
      }}>{alert.level} · {alert.source}</span>
      <span style={{ fontFamily: serif, fontStyle: 'italic', fontSize: 15, color: t.cream }}>{alert.title}.</span>
    </div>
  );
}

function TempPlate({ data, t, serif, sans, mono, tiny, compact }) {
  const tempSize = tiny ? 96 : compact ? 130 : 180;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: tiny ? 12 : 18 }}>
        <div style={{
          fontFamily: serif, fontSize: tempSize, lineHeight: 0.88, color: t.cream,
          fontWeight: 300, letterSpacing: -tempSize * 0.04, fontVariantNumeric: 'tabular-nums',
        }}>
          {data.now.temp}
        </div>
        <div style={{
          fontFamily: serif, fontSize: tempSize * 0.35, lineHeight: 1,
          color: t.cream2, marginTop: tempSize * 0.04,
        }}>°C</div>
      </div>
      <div style={{
        marginTop: 4, fontFamily: serif, fontStyle: 'italic', fontSize: tiny ? 16 : compact ? 18 : 22,
        color: t.cream, fontWeight: 400, letterSpacing: -0.3,
      }}>
        {data.now.desc.toLowerCase()}, feels like {data.now.feels}°.
      </div>

      <div style={{
        marginTop: 16, display: 'flex', gap: tiny ? 14 : 28, flexWrap: 'wrap',
        fontFamily: mono, fontSize: 11, letterSpacing: 0.8, color: t.cream2,
      }}>
        <InlineStat icon="wind" label="WIND" value={`${data.now.windKph} kph ${WX.windCardinal(data.now.windDir)}`} t={t} mono={mono}/>
        <InlineStat icon="humidity" label="HUMID" value={`${data.now.humidity}%`} t={t} mono={mono}/>
        <InlineStat icon="rain" label="PRECIP" value={`${data.now.precipProb}%`} t={t} mono={mono}/>
        <InlineStat icon="pressure" label="PRESS" value={`${data.now.pressure} hPa`} t={t} mono={mono} arrow={data.now.pressureTrend.includes('rising') ? '↗' : data.now.pressureTrend.includes('falling') ? '↘' : null}/>
      </div>
    </div>
  );
}

function InlineStat({ icon, label, value, t, mono, arrow }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ color: t.dim }}><WxIcon kind={icon} size={14} strokeWidth={1.3}/></span>
      <div>
        <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: 1.6, color: t.dim }}>{label}</div>
        <div style={{ fontFamily: mono, fontSize: 12, color: t.cream }}>{value}{arrow && <span style={{ marginLeft: 4, color: t.accent }}>{arrow}</span>}</div>
      </div>
    </div>
  );
}

function RightRail({ data, t, serif, sans, mono, compact }) {
  return (
    <>
      {/* Indoor mini */}
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        paddingBottom: 14, borderBottom: `1px solid ${t.faint}`,
      }}>
        <div>
          <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: 1.6, color: t.dim, textTransform: 'uppercase' }}>Inside the house</div>
          <div style={{ fontFamily: serif, fontSize: 28, color: t.cream, marginTop: 2, letterSpacing: -0.5 }}>
            {data.indoor.temp}<span style={{ color: t.dim, fontSize: 16, marginLeft: 2 }}>°C</span>
          </div>
        </div>
        <div style={{ textAlign: 'right', fontFamily: mono, fontSize: 10, color: t.dim, letterSpacing: 1, textTransform: 'uppercase' }}>
          <div>{data.indoor.humidity}% RH</div>
          <div style={{ marginTop: 2, color: t.green }}>● {data.indoor.status}</div>
        </div>
      </div>

      {/* 5-day */}
      <div>
        <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: 2, color: t.dim, marginBottom: 10, textTransform: 'uppercase' }}>
          The week ahead
        </div>
        {data.daily.map((d, i) => (
          <DailyRow key={d.d} d={d} t={t} serif={serif} mono={mono}/>
        ))}
      </div>

      {/* AI summary */}
      <div>
        <div style={{
          fontFamily: mono, fontSize: 9, letterSpacing: 2, color: t.accent,
          marginBottom: 10, textTransform: 'uppercase',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: t.accent, display: 'inline-block' }}/>
          The dispatch
        </div>
        <div style={{
          fontFamily: serif, fontStyle: 'italic', fontSize: 14, lineHeight: 1.55,
          color: t.cream, textWrap: 'pretty',
        }}>
          "{data.aiSummary}"
        </div>
      </div>
    </>
  );
}

function DailyRow({ d, t, serif, mono }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '8px 0', borderTop: `1px solid ${t.faint}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontFamily: mono, fontSize: 11, color: t.cream2, letterSpacing: 1, width: 30 }}>{d.d}</span>
        <span style={{ color: t.cream2 }}><WxIcon kind={d.icon} size={16} strokeWidth={1.3}/></span>
        <span style={{ fontFamily: mono, fontSize: 10, color: t.cool, letterSpacing: 0.5 }}>{d.precip}%</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontFamily: serif }}>
        <span style={{ fontSize: 16, color: t.cream, fontWeight: 400 }}>{d.hi}°</span>
        <span style={{ fontSize: 13, color: t.dim, fontStyle: 'italic' }}>{d.lo}°</span>
      </div>
    </div>
  );
}

function TimelineEdit({ data, t, serif, mono, compact, tiny }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14,
      paddingTop: 10, borderTop: `1px solid ${t.faint}`,
    }}>
      <button style={{
        background: t.paper, border: `1px solid ${t.faint}`, color: t.cream,
        width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        borderRadius: '50%',
      }}><WxIcon kind="play" size={12}/></button>

      <div style={{ flex: 1, position: 'relative', padding: '0 0 4px' }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          fontFamily: mono, fontSize: 9, color: t.dim, letterSpacing: 1, marginBottom: 6,
          textTransform: 'uppercase',
        }}>
          <span>Two hours past</span>
          <span style={{ color: t.accent }}>Now · 11:30</span>
          <span>Half-hour out</span>
        </div>
        <div style={{ position: 'relative', height: 4, background: t.paper }}>
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '60%', background: t.dim }}/>
          <div style={{ position: 'absolute', left: '60%', top: -4, width: 2, height: 12, background: t.accent }}/>
        </div>
      </div>

      {!tiny && (
        <div style={{
          fontFamily: mono, fontSize: 10, color: t.dim, letterSpacing: 1,
          textTransform: 'uppercase', display: 'flex', gap: 12,
        }}>
          <span>Light</span>
          <span>Mod</span>
          <span style={{ color: t.amber }}>Strong</span>
          <span style={{ color: t.red }}>Severe</span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 4 }}>
        {['crosshair','pin','contrast','gear'].map((k) => (
          <button key={k} style={{
            background: 'transparent', border: `1px solid ${t.faint}`, color: t.cream2,
            width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          }}>
            <WxIcon kind={k} size={14} strokeWidth={1.3}/>
          </button>
        ))}
      </div>
    </div>
  );
}

function EditorialSleep({ w, h, data, tickNow }) {
  const t = bTokens;
  const serif = 'Newsreader, "Iowan Old Style", Georgia, serif';
  const mono = '"Geist Mono", "JetBrains Mono", ui-monospace, monospace';
  const now = new Date(Date.now() + (tickNow || 0) * 60000);
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const drift = (tickNow || 0) * 0.15;
  // Burn-in protective drift
  const dx = Math.sin(drift) * 14;
  const dy = Math.cos(drift * 0.7) * 10;

  return (
    <div style={{
      width: w, height: h, background: '#0a0907', position: 'relative', overflow: 'hidden',
      fontFamily: serif, color: t.accent,
    }}>
      {/* Subtle warm radial */}
      <div style={{
        position: 'absolute', inset: 0,
        background: `radial-gradient(ellipse at 50% 60%, rgba(217,119,87,0.04) 0%, transparent 60%)`,
      }}/>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        transform: `translate(${dx}px, ${dy}px)`,
      }}>
        <div style={{
          fontFamily: serif, fontStyle: 'italic', fontSize: w < 900 ? 16 : 22,
          color: t.accent, opacity: 0.8, marginBottom: w < 900 ? 18 : 28,
          letterSpacing: 0.3,
        }}>
          {['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][now.getDay()]}, {now.getDate()} May
        </div>
        <div style={{
          fontSize: Math.min(w, h) * 0.32, fontWeight: 200,
          letterSpacing: -Math.min(w, h) * 0.012, lineHeight: 0.85,
          color: t.accent, fontVariantNumeric: 'tabular-nums',
        }}>
          {hh}<span style={{ opacity: 0.4 }}>:</span>{mm}
        </div>
        <div style={{
          marginTop: w < 900 ? 22 : 36, display: 'flex', alignItems: 'center', gap: 12,
          color: t.accent, opacity: 0.7,
        }}>
          <WxIcon kind={data.now.icon} size={w < 900 ? 16 : 20} strokeWidth={1.2}/>
          <span style={{ fontSize: w < 900 ? 14 : 18, fontStyle: 'italic' }}>{data.now.temp}°C · {data.now.desc.toLowerCase()}</span>
        </div>
        {data.alert && (
          <div style={{
            marginTop: w < 900 ? 16 : 24, fontFamily: mono, fontSize: 9,
            letterSpacing: 2, color: data.alert.level === 'warning' ? t.red : t.amber,
            textTransform: 'uppercase', opacity: 0.7,
          }}>
            ◆ {data.alert.title}
          </div>
        )}
      </div>
    </div>
  );
}

window.EditorialAtlas = EditorialAtlas;
window.bTokens = bTokens;
