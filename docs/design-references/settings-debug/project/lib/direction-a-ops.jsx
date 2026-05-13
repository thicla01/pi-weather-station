// Direction A — "Ops Console"
// Instrument-grade weather dashboard. Mono-heavy data ribbon, prominent map,
// timeline scrub, color-coded severity. Inspired by NEXRAD ops + aircraft displays.
//
// Props:
//   size: '800x480' | '1366x768' | '1920x1080' | fluid object {w, h}
//   scenario: 'calm' | 'rain' | 'severe'
//   mode: 'normal' | 'sleep' | 'debug'

const aTokens = {
  bg: '#0a0d11',
  surface: '#11161c',
  surface2: '#161c24',
  border: '#1f2832',
  border2: '#2a3744',
  text: '#e2e8ef',
  textDim: '#8a96a6',
  textFaint: '#56627190',
  cyan: '#5fd6e3',
  amber: '#f0b454',
  green: '#5fd68a',
  red: '#e55454',
  magenta: '#c66ad8',
  blue: '#7aa9ef',
};

function OpsConsole({ size = '1366x768', scenario = 'calm', mode = 'normal', tickNow = 0 }) {
  const data = WX.getScenario(scenario);
  const [w, h] = typeof size === 'string'
    ? size.split('x').map(Number)
    : [size.w, size.h];

  const tiny = w < 900;
  const compact = w < 1100;
  const t = aTokens;

  // Sleep mode = ultra-minimal clock + outdoor temp
  if (mode === 'sleep') return <OpsSleep w={w} h={h} data={data} tickNow={tickNow}/>;

  const fontStack = '"IBM Plex Sans", system-ui, sans-serif';
  const monoStack = '"JetBrains Mono", ui-monospace, monospace';
  const alertLevel = data.alert?.level;
  const alertColor = alertLevel === 'warning' ? t.red : alertLevel === 'watch' ? t.amber : t.cyan;

  // 8-pt grid; ribbon heights scale with viewport
  const ribbonH = tiny ? 64 : compact ? 76 : 88;
  const bottomH = tiny ? 56 : 68;
  const pad = tiny ? 10 : 14;

  return (
    <div style={{
      width: w, height: h, background: t.bg, color: t.text,
      fontFamily: fontStack, fontSize: tiny ? 11 : 12, position: 'relative', overflow: 'hidden',
      display: 'grid', gridTemplateRows: `${ribbonH}px 1fr ${bottomH}px`,
    }}>
      {/* ─── TOP RIBBON ─── */}
      <div style={{
        display: 'grid', gridTemplateColumns: tiny ? '1fr 1.2fr 1fr' : '1.3fr 1.6fr 1.4fr',
        borderBottom: `1px solid ${t.border}`, background: t.surface,
      }}>
        <RibbonCell t={t} compact={compact} label="Location" mono={monoStack}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, lineHeight: 1.1 }}>
            <span style={{ fontSize: tiny ? 12 : 14, fontWeight: 600, letterSpacing: -0.2 }}>{data.location.split(',')[0]}</span>
            <span style={{ fontSize: 10, color: t.textDim, letterSpacing: 0.6, textTransform: 'uppercase' }}>{data.location.split(',')[1]}</span>
          </div>
          <div style={{ fontFamily: monoStack, fontSize: 10, color: t.textDim, marginTop: 2, letterSpacing: 0.5 }}>{data.coord}</div>
        </RibbonCell>

        <RibbonCell t={t} compact={compact} label="Now" mono={monoStack} bordered>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: monoStack, fontSize: tiny ? 26 : 34, fontWeight: 300, letterSpacing: -1, lineHeight: 1 }}>
              {data.now.temp}<span style={{ color: t.textDim, fontSize: '0.55em' }}>°C</span>
            </span>
            <span style={{ width: 1, height: tiny ? 28 : 36, background: t.border2 }}/>
            <div style={{ lineHeight: 1.2 }}>
              <div style={{ fontSize: 11 }}>{data.now.desc}</div>
              <div style={{ fontFamily: monoStack, fontSize: 10, color: t.textDim, letterSpacing: 0.4 }}>
                FEELS {data.now.feels}° · {WX.cToF(data.now.temp)}°F
              </div>
            </div>
          </div>
        </RibbonCell>

        <RibbonCell t={t} compact={compact} label={null} mono={monoStack} bordered align="right">
          <Clock data={data} t={t} compact={compact} mono={monoStack} tickNow={tickNow}/>
        </RibbonCell>
      </div>

      {/* ─── BODY: map + side panel ─── */}
      <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: tiny ? '1fr' : compact ? '1fr 280px' : '1fr 320px', overflow: 'hidden' }}>
        {/* Map */}
        <div style={{ position: 'relative', borderRight: tiny ? 'none' : `1px solid ${t.border}` }}>
          <MapBg mode={data.radar} variant="dark" label={`RADAR · ${data.radar.toUpperCase()} · ${data.location}`}/>

          {/* Floating compass / wind */}
          <div style={{
            position: 'absolute', top: pad, left: pad, padding: '8px 10px',
            background: 'rgba(11,14,17,0.78)', backdropFilter: 'blur(6px)',
            border: `1px solid ${t.border2}`, fontFamily: monoStack, fontSize: 10,
            letterSpacing: 0.5, color: t.text, display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <Compass deg={data.now.windDir} t={t} size={tiny ? 28 : 34}/>
            <div>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{data.now.windKph}<span style={{ color: t.textDim, fontSize: 10, marginLeft: 2 }}>KPH</span></div>
              <div style={{ color: t.textDim }}>{WX.windCardinal(data.now.windDir)} · {data.now.windDir}°</div>
            </div>
          </div>

          {/* Layer toggle dock */}
          {!tiny && (
            <div style={{
              position: 'absolute', top: pad, right: pad, display: 'flex', flexDirection: 'column', gap: 4,
            }}>
              {['RADAR','SAT','TEMP','WIND'].map((k, i) => (
                <button key={k} style={{
                  background: i === 0 ? t.surface2 : 'rgba(11,14,17,0.7)',
                  border: `1px solid ${i === 0 ? t.cyan : t.border2}`,
                  color: i === 0 ? t.cyan : t.textDim,
                  fontFamily: monoStack, fontSize: 10, letterSpacing: 1, padding: '6px 10px', cursor: 'pointer',
                }}>{k}</button>
              ))}
            </div>
          )}

          {/* Alert banner */}
          {data.alert && (
            <div style={{
              position: 'absolute', top: pad, left: '50%', transform: 'translateX(-50%)',
              padding: '8px 14px 8px 12px', background: `${alertColor}1f`,
              borderLeft: `3px solid ${alertColor}`, color: t.text,
              display: 'flex', alignItems: 'center', gap: 10, maxWidth: 'calc(100% - 24px)',
            }}>
              <span style={{
                width: 8, height: 8, borderRadius: '50%', background: alertColor,
                animation: 'opsPulse 1.5s infinite',
              }}/>
              <span style={{ fontFamily: monoStack, fontSize: 10, letterSpacing: 1.2, color: alertColor, fontWeight: 600 }}>
                {data.alert.level.toUpperCase()} · {data.alert.source}
              </span>
              <span style={{ fontSize: tiny ? 11 : 12, fontWeight: 500 }}>{data.alert.title}</span>
              {!tiny && <span style={{ fontSize: 11, color: t.textDim }}>{data.alert.detail}</span>}
            </div>
          )}

          {/* Bottom-left scale + crosshair coord */}
          <div style={{
            position: 'absolute', bottom: pad, left: pad,
            fontFamily: monoStack, fontSize: 10, color: t.textDim, letterSpacing: 0.6,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ display: 'inline-block', width: 40, height: 2, background: t.text }}/>
              <span>10 KM</span>
            </div>
            <div>Z · 7  ·  © MAPBOX · RAINVIEWER</div>
          </div>

          {/* Mini hourly strip overlay on map (only when there's room) */}
          {!tiny && !compact && (
            <HourlyStrip data={data} t={t} mono={monoStack}
              style={{ position: 'absolute', bottom: pad, right: pad, width: 360 }}/>
          )}
        </div>

        {/* Side panel */}
        {!tiny && (
          <SidePanel data={data} t={t} compact={compact} mono={monoStack}/>
        )}
      </div>

      {/* ─── BOTTOM CONTROL RIBBON: timeline + actions ─── */}
      <div style={{
        borderTop: `1px solid ${t.border}`, background: t.surface,
        display: 'grid', gridTemplateColumns: tiny ? '1fr auto' : '1fr 280px',
      }}>
        <Timeline data={data} t={t} compact={compact} mono={monoStack}/>
        <ActionBar t={t} compact={compact} mono={monoStack} tiny={tiny}/>
      </div>

      <style>{`@keyframes opsPulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.35 } }`}</style>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────

function RibbonCell({ t, compact, label, mono, bordered, align, children }) {
  return (
    <div style={{
      padding: compact ? '8px 12px' : '10px 16px',
      borderLeft: bordered ? `1px solid ${t.border}` : 'none',
      display: 'flex', flexDirection: 'column', justifyContent: 'center',
      alignItems: align === 'right' ? 'flex-end' : 'stretch',
      minWidth: 0,
    }}>
      {label && (
        <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: 1.4, color: t.textDim, marginBottom: 4, textTransform: 'uppercase' }}>
          {label}
        </div>
      )}
      {children}
    </div>
  );
}

function Clock({ data, t, compact, mono, tickNow }) {
  const now = new Date(Date.now() + (tickNow || 0) * 60000);
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const dayName = ['SUN','MON','TUE','WED','THU','FRI','SAT'][now.getDay()];
  const dateStr = `${dayName} · ${String(now.getDate()).padStart(2,'0')} ${['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][now.getMonth()]}`;

  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: 1.4, color: t.textDim }}>
        {dateStr}
      </div>
      <div style={{ fontFamily: mono, fontSize: compact ? 22 : 28, fontWeight: 300, letterSpacing: -0.5, lineHeight: 1, marginTop: 2 }}>
        {hh}:{mm}<span style={{ color: t.textDim, fontSize: '0.5em' }}>:{ss}</span>
      </div>
      <div style={{ fontFamily: mono, fontSize: 10, color: t.textDim, letterSpacing: 0.6, marginTop: 4, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <span>☀ {data.sun.rise}</span><span>☾ {data.sun.set}</span>
      </div>
    </div>
  );
}

function Compass({ deg, t, size = 34 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" style={{ flexShrink: 0 }}>
      <circle cx="20" cy="20" r="17" fill="none" stroke={t.border2} strokeWidth="1"/>
      <circle cx="20" cy="20" r="13" fill="none" stroke={t.border2} strokeWidth="0.5" strokeDasharray="1 2"/>
      <text x="20" y="7" textAnchor="middle" fontSize="6" fill={t.textDim} fontFamily='"JetBrains Mono"'>N</text>
      <g transform={`rotate(${deg} 20 20)`}>
        <path d="M20 6 L24 22 L20 19 L16 22 Z" fill={t.cyan}/>
      </g>
    </svg>
  );
}

function SidePanel({ data, t, compact, mono }) {
  return (
    <div style={{ overflowY: 'auto', background: t.surface }}>
      {/* Indoor strip */}
      <div style={{
        padding: '10px 14px', borderBottom: `1px solid ${t.border}`,
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10,
        background: t.surface2,
      }}>
        <Stat t={t} mono={mono} label="INDOOR" big={`${data.indoor.temp}°`} sub={`${data.indoor.humidity}% RH`} statusColor={t.green}/>
        <Stat t={t} mono={mono} label="PRESSURE" big={`${data.now.pressure}`} sub={`hPa · ${data.now.pressureTrend}`}
          arrow={data.now.pressureTrend.includes('rising') ? 'up' : data.now.pressureTrend.includes('falling') ? 'down' : null}
          arrowColor={data.now.pressureTrend.includes('fast') ? t.red : t.textDim}/>
      </div>

      {/* Metric grid */}
      <div style={{
        padding: '12px 14px',
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10,
      }}>
        <Metric t={t} mono={mono} icon="humidity" label="HUMID" value={data.now.humidity} unit="%"/>
        <Metric t={t} mono={mono} icon="wind" label="WIND" value={data.now.windKph} unit="kph"/>
        <Metric t={t} mono={mono} icon="rain" label="PRECIP" value={data.now.precipProb} unit="%"/>
        <Metric t={t} mono={mono} icon="uv" label="UV" value={data.now.uv} unit="" color={data.now.uv > 5 ? t.amber : t.textDim}/>
        <Metric t={t} mono={mono} icon="alert" label="AQI" value={data.now.aqi} unit="" color={data.now.aqi > 100 ? t.amber : t.green}/>
        <Metric t={t} mono={mono} icon="layers" label="VIS" value={data.now.visibility} unit="km"/>
      </div>

      {/* 5-day forecast */}
      <div style={{ padding: '0 14px 12px' }}>
        <SectionLabel t={t} mono={mono}>5-DAY · °C</SectionLabel>
        <ForecastBars data={data} t={t} mono={mono}/>
      </div>

      {/* AI summary collapsed */}
      <div style={{ padding: '0 14px 14px' }}>
        <SectionLabel t={t} mono={mono}>AI ANALYSIS</SectionLabel>
        <div style={{
          padding: 10, background: t.surface2, borderLeft: `2px solid ${t.cyan}`,
          fontSize: 11, lineHeight: 1.5, color: t.text,
        }}>
          {data.aiSummary}
        </div>
      </div>
    </div>
  );
}

function Stat({ t, mono, label, big, sub, statusColor, arrow, arrowColor }) {
  return (
    <div>
      <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: 1.4, color: t.textDim, marginBottom: 4 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ fontFamily: mono, fontSize: 20, fontWeight: 400, letterSpacing: -0.5, color: t.text }}>{big}</span>
        {statusColor && <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor }}/>}
        {arrow && (
          <span style={{ color: arrowColor, marginLeft: 2 }}>{arrow === 'up' ? '↑' : '↓'}</span>
        )}
      </div>
      <div style={{ fontFamily: mono, fontSize: 9, color: t.textDim, letterSpacing: 0.5, marginTop: 1 }}>{sub}</div>
    </div>
  );
}

function Metric({ t, mono, icon, label, value, unit, color }) {
  return (
    <div style={{
      padding: '8px 10px', border: `1px solid ${t.border}`,
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <span style={{ color: color || t.textDim }}><WxIcon kind={icon} size={16} strokeWidth={1.4}/></span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: 1.2, color: t.textDim }}>{label}</div>
        <div style={{ fontFamily: mono, fontSize: 14, fontWeight: 400, color: color || t.text, lineHeight: 1.1 }}>
          {value}<span style={{ color: t.textDim, fontSize: 9, marginLeft: 2 }}>{unit}</span>
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ t, mono, children }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      fontFamily: mono, fontSize: 9, letterSpacing: 1.4, color: t.textDim,
      marginBottom: 8, marginTop: 4,
    }}>
      <span>{children}</span>
      <span style={{ flex: 1, height: 1, background: t.border }}/>
    </div>
  );
}

function ForecastBars({ data, t, mono }) {
  const allTemps = data.daily.flatMap(d => [d.hi, d.lo]);
  const min = Math.min(...allTemps), max = Math.max(...allTemps);
  const range = Math.max(max - min, 1);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
      {data.daily.map((d) => {
        const hiPct = ((d.hi - min) / range);
        const loPct = ((d.lo - min) / range);
        return (
          <div key={d.d} style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: 1, color: t.textDim }}>{d.d.toUpperCase()}</div>
            <div style={{ color: t.textDim, margin: '4px 0' }}><WxIcon kind={d.icon} size={16} strokeWidth={1.3}/></div>
            <div style={{ position: 'relative', height: 24, background: t.surface2, marginBottom: 4 }}>
              <div style={{
                position: 'absolute', left: `${loPct * 100}%`, right: `${(1 - hiPct) * 100}%`,
                top: 4, bottom: 4, background: `linear-gradient(90deg, ${t.cyan}, ${t.amber})`,
              }}/>
            </div>
            <div style={{ fontFamily: mono, fontSize: 10, color: t.text }}>{d.hi}°</div>
            <div style={{ fontFamily: mono, fontSize: 9, color: t.textDim }}>{d.lo}°</div>
          </div>
        );
      })}
    </div>
  );
}

function HourlyStrip({ data, t, mono, style }) {
  const hrs = data.hourly.slice(0, 12);
  const min = Math.min(...hrs), max = Math.max(...hrs);
  const range = Math.max(max - min, 1);
  const W = 360, H = 60;
  const stepX = W / (hrs.length - 1);
  const pts = hrs.map((v, i) => `${i * stepX},${H - 8 - ((v - min) / range) * (H - 20)}`).join(' ');
  return (
    <div style={{
      ...style,
      background: 'rgba(11,14,17,0.85)', backdropFilter: 'blur(6px)',
      border: `1px solid ${t.border2}`, padding: '8px 10px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: 1.4, color: t.textDim }}>NEXT 12H · TEMP / PRECIP</span>
        <span style={{ fontFamily: mono, fontSize: 9, color: t.textDim }}>°C / mm</span>
      </div>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {data.hourlyPrecip.slice(0, 12).map((p, i) => (
          <rect key={i} x={i * stepX - 8} y={H - (p / 100) * (H - 8) - 0} width="16" height={(p / 100) * (H - 8)} fill={t.cyan} opacity="0.25"/>
        ))}
        <polyline points={pts} fill="none" stroke={t.amber} strokeWidth="1.5"/>
        {hrs.map((v, i) => (
          <circle key={i} cx={i * stepX} cy={H - 8 - ((v - min) / range) * (H - 20)} r="1.5" fill={t.amber}/>
        ))}
      </svg>
    </div>
  );
}

function Timeline({ data, t, compact, mono }) {
  return (
    <div style={{
      padding: compact ? '8px 14px' : '10px 18px', display: 'flex', alignItems: 'center', gap: 14,
      borderRight: `1px solid ${t.border}`,
    }}>
      <button style={{
        background: 'transparent', border: `1px solid ${t.border2}`, color: t.text,
        width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
      }}><WxIcon kind="play" size={12}/></button>

      <div style={{ flex: 1, position: 'relative' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontFamily: mono, fontSize: 9, color: t.textDim, letterSpacing: 0.8 }}>-2H</span>
          <span style={{ fontFamily: mono, fontSize: 9, color: t.text, letterSpacing: 0.8, fontWeight: 600 }}>NOW · 11:30</span>
          <span style={{ fontFamily: mono, fontSize: 9, color: t.textDim, letterSpacing: 0.8 }}>+30M</span>
        </div>
        <div style={{ position: 'relative', height: 8, background: t.surface2 }}>
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '60%', background: `${t.cyan}40` }}/>
          <div style={{ position: 'absolute', left: '60%', top: 0, bottom: 0, width: '40%', background: `${t.amber}20`, borderLeft: `1px solid ${t.amber}80` }}/>
          <div style={{ position: 'absolute', left: '60%', top: -3, width: 2, height: 14, background: t.cyan }}/>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
          {['10:00','10:30','11:00','11:30','12:00'].map((tm, i) => (
            <span key={tm} style={{ fontFamily: mono, fontSize: 8, color: i === 3 ? t.text : t.textDim, letterSpacing: 0.5 }}>{tm}</span>
          ))}
        </div>
      </div>

      {!compact && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: mono, fontSize: 10, color: t.textDim, letterSpacing: 0.5 }}>
          <span>1×</span>
          <span style={{ width: 1, height: 14, background: t.border2 }}/>
          <span>FRAMES 24</span>
        </div>
      )}
    </div>
  );
}

function ActionBar({ t, compact, mono, tiny }) {
  const icons = [
    { k: 'crosshair', label: 'LOC' },
    { k: 'pin', label: 'PIN' },
    { k: 'chart', label: 'CHRT' },
    { k: 'contrast', label: 'DIM' },
    { k: 'gear', label: 'CFG' },
  ];
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', borderLeft: `1px solid ${t.border}` }}>
      {icons.map((it, i) => (
        <button key={it.k} style={{
          flex: 1, background: 'transparent', border: 'none', borderRight: i < icons.length - 1 ? `1px solid ${t.border}` : 'none',
          color: t.textDim, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
          padding: '6px 4px',
        }}>
          <WxIcon kind={it.k} size={tiny ? 14 : 16} strokeWidth={1.4}/>
          {!compact && <span style={{ fontFamily: mono, fontSize: 8, letterSpacing: 1, color: t.textFaint }}>{it.label}</span>}
        </button>
      ))}
    </div>
  );
}

function OpsSleep({ w, h, data, tickNow }) {
  const t = aTokens;
  const mono = '"JetBrains Mono", ui-monospace, monospace';
  const now = new Date(Date.now() + (tickNow || 0) * 60000);
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  // Cycle position slowly so OLED pixels move; tickNow drives drift
  const drift = (tickNow || 0) * 0.2;
  return (
    <div style={{
      width: w, height: h, background: '#000', color: '#3a4452', fontFamily: mono,
      position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        transform: `translate(${Math.sin(drift) * 12}px, ${Math.cos(drift * 0.7) * 8}px)`,
        textAlign: 'center', color: '#46505e',
      }}>
        <div style={{ fontSize: 10, letterSpacing: 4, marginBottom: 12 }}>· STANDBY ·</div>
        <div style={{ fontSize: Math.min(w, h) * 0.28, fontWeight: 200, letterSpacing: -4, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
          {hh}<span style={{ opacity: 0.4 }}>:</span>{mm}
        </div>
        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'center', gap: 18, fontSize: 13, letterSpacing: 1.2 }}>
          <span>{data.now.temp}°C</span>
          <span>·</span>
          <span style={{ textTransform: 'uppercase' }}>{data.now.desc}</span>
        </div>
        {data.alert && (
          <div style={{
            marginTop: 24, fontSize: 10, letterSpacing: 2,
            color: data.alert.level === 'warning' ? '#7a3030' : '#7a6230',
          }}>
            ◆ {data.alert.title.toUpperCase()}
          </div>
        )}
      </div>
    </div>
  );
}

window.OpsConsole = OpsConsole;
window.aTokens = aTokens;
