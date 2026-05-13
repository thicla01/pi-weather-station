// Shared helper components for Direction C (Ambient Layers).
// Source badges, confidence chips, multi-alert banner, alert detail overlay,
// QR code, indoor block, brightness slider. Hybrid-mode aware.

// ────────────────────────────────────────────────────────────────
// SourceBadge — RADAR / ECCC / NWS pastille
// ────────────────────────────────────────────────────────────────
function SourceBadge({ source, t, mono, hybrid }) {
  const isRadar = source === 'RADAR';
  return (
    <span style={{
      fontFamily: mono, fontSize: 9, letterSpacing: 1.2, fontWeight: 600,
      padding: '2px 6px', borderRadius: 3,
      background: isRadar ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.10)',
      color: '#fff', whiteSpace: 'nowrap',
      border: isRadar ? '1px solid rgba(255,255,255,0.25)' : '1px solid rgba(255,255,255,0.15)',
    }}>{source}</span>
  );
}

// ────────────────────────────────────────────────────────────────
// ConfidencePill — [85%] with bucket colour
// ────────────────────────────────────────────────────────────────
function ConfidencePill({ pct, mono, onBanner = false, t }) {
  const bucket = WX.confidenceBucket(pct);
  // On banner: white text on translucent. Free-standing: bucket colour
  const bg = onBanner
    ? 'rgba(255,255,255,0.18)'
    : bucket === 'high' ? '#2e7d52' : bucket === 'med' ? '#c4842a' : '#a83232';
  const color = '#fff';
  return (
    <span style={{
      fontFamily: mono, fontSize: 9, letterSpacing: 1, fontWeight: 600,
      padding: '2px 6px', borderRadius: 3, background: bg, color,
      border: onBanner ? '1px solid rgba(255,255,255,0.25)' : 'none',
      whiteSpace: 'nowrap',
    }}>{pct}%</span>
  );
}

// ────────────────────────────────────────────────────────────────
// AlertBanner — cyclable, source-badged, confidence-pilled
// Tappable to open detail overlay (caller handles open).
// ────────────────────────────────────────────────────────────────
function AlertBanner({ alerts, idx, onCycle, onOpen, expanded = false, t, mono, display, compact = false }) {
  if (!alerts || !alerts.length) return null;
  const alert = alerts[idx % alerts.length];
  const tierBg = alert.tier === 'red' ? '#a83232' : alert.tier === 'amber' ? '#c4683a' : '#9c8038';
  const multi = alerts.length > 1;

  return (
    <button onClick={() => alerts.length > 1 ? onCycle() : onOpen()}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 8,
        background: tierBg, color: '#fff',
        border: 'none', borderRadius: expanded ? '8px 8px 0 0' : 8, padding: compact ? '8px 10px' : '10px 12px',
        textAlign: 'left', cursor: 'pointer',
        boxShadow: alert.tier === 'red' && !expanded ? `0 4px 16px ${tierBg}50` : 'none',
        fontFamily: 'inherit',
      }}>
      <span style={{
        width: 8, height: 8, borderRadius: '50%', background: '#fff', flexShrink: 0,
        animation: alert.tier === 'red' ? 'cPulse 1.5s infinite' : 'none',
      }}/>
      <SourceBadge source={alert.source} t={t} mono={mono}/>
      <ConfidencePill pct={alert.confidence} mono={mono} onBanner={true}/>
      {multi && (
        <span style={{
          fontFamily: mono, fontSize: 9, fontWeight: 700,
          padding: '2px 5px', borderRadius: 3,
          background: 'rgba(0,0,0,0.25)', color: '#fff',
          border: '1px solid rgba(255,255,255,0.2)',
        }}>+{alerts.length - 1}</span>
      )}
      <span style={{
        fontFamily: display, fontSize: compact ? 11 : 13, fontWeight: 600,
        flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        marginLeft: 2,
      }}>{alert.title}</span>
      <span title={expanded ? 'Collapse' : 'Open detail'}
        onClick={(e) => { e.stopPropagation(); onOpen(); }}
        style={{
          fontFamily: mono, fontSize: 11, letterSpacing: 1, color: 'rgba(255,255,255,0.85)',
          padding: '2px 4px', cursor: 'pointer', flexShrink: 0,
          transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 150ms',
        }}>▸</span>
      <style>{`@keyframes cPulse { 0%,100% { transform: scale(1); opacity: 1 } 50% { transform: scale(1.6); opacity: 0.3 } }`}</style>
    </button>
  );
}

// ────────────────────────────────────────────────────────────────
// AlertDetailInline — collapsible section UNDER the banner.
// Keeps the map visible. Flex column: scrollable description + pinned
// QR footer. Per maintainer feedback, this replaces the modal overlay.
// ────────────────────────────────────────────────────────────────
function AlertDetailInline({ alert, t, mono, display, sans, onClose, maxHeight = 280, compact = false }) {
  if (!alert) return null;
  const tierBg = alert.tier === 'red' ? '#a83232' : alert.tier === 'amber' ? '#c4683a' : '#9c8038';
  return (
    <div style={{
      background: t.surface, color: t.text,
      border: `1px solid ${t.border}`, borderTop: 'none',
      borderRadius: '0 0 8px 8px',
      display: 'flex', flexDirection: 'column',
      maxHeight, minHeight: 0, overflow: 'hidden',
      boxShadow: `0 4px 12px ${tierBg}30`,
    }}>
      <div style={{
        flex: '1 1 auto', minHeight: 0, overflowY: 'auto',
        padding: compact ? '8px 10px' : '12px 14px',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6,
        }}>
          <span style={{
            fontFamily: mono, fontSize: 8, letterSpacing: 1.5,
            color: tierBg, textTransform: 'uppercase', fontWeight: 600,
          }}>{alert.level} · expires {alert.expires}</span>
          <button onClick={onClose} style={{
            marginLeft: 'auto', background: 'transparent', color: t.textDim,
            border: 'none', fontFamily: mono, fontSize: 10, cursor: 'pointer', padding: 0,
          }} aria-label="Collapse">✕</button>
        </div>
        <div style={{
          fontFamily: display, fontSize: compact ? 13 : 15, fontWeight: 500,
          color: t.text, marginBottom: 4, lineHeight: 1.25, letterSpacing: -0.2,
        }}>{alert.title}</div>
        <div style={{
          fontFamily: sans, fontSize: compact ? 11 : 12, lineHeight: 1.5, color: t.text,
          textWrap: 'pretty',
        }}>{alert.detail}</div>
      </div>
      <div style={{
        flexShrink: 0,
        padding: compact ? '6px 10px' : '8px 14px',
        borderTop: `1px solid ${t.border}`, background: t.surfaceTint,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <QrCode value={alert.qrUrl || ''} size={compact ? 52 : 64} fg={t.text} bg={t.surface}/>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            fontFamily: mono, fontSize: 8, letterSpacing: 1.4, color: t.textDim,
            textTransform: 'uppercase', marginBottom: 2,
          }}>Full bulletin · scan with phone</div>
          <div style={{
            fontFamily: mono, fontSize: 9, color: t.text,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{(alert.qrUrl || '').replace(/^https?:\/\//, '')}</div>
        </div>
      </div>
    </div>
  );
}

// AlertDetailOverlay kept for reference; not used in v2 layout.
function AlertDetailOverlay({ alert, t, mono, display, sans, onClose, panel }) {
  if (!alert) return null;
  const tierBg = alert.tier === 'red' ? '#a83232' : alert.tier === 'amber' ? '#c4683a' : '#9c8038';
  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 50,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18,
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: panel.surface, color: panel.text,
        border: `1px solid ${panel.border}`, borderRadius: 12,
        width: '100%', maxWidth: 480, maxHeight: 'min(560px, 92%)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{
          background: tierBg, color: '#fff', padding: '10px 14px',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <SourceBadge source={alert.source} t={t} mono={mono}/>
          <ConfidencePill pct={alert.confidence} mono={mono} onBanner={true}/>
          <span style={{
            fontFamily: mono, fontSize: 9, letterSpacing: 1.5,
            color: 'rgba(255,255,255,0.85)', textTransform: 'uppercase', marginLeft: 4,
          }}>{alert.level}</span>
          <button onClick={onClose} style={{
            marginLeft: 'auto', background: 'rgba(0,0,0,0.2)', color: '#fff',
            border: 'none', borderRadius: 4, padding: '4px 10px',
            fontFamily: mono, fontSize: 10, letterSpacing: 1, cursor: 'pointer',
          }}>CLOSE ✕</button>
        </div>
        <div style={{ padding: '14px 18px', overflowY: 'auto', flex: 1 }}>
          <div style={{
            fontFamily: display, fontSize: 18, fontWeight: 500,
            color: panel.text, marginBottom: 8, lineHeight: 1.25, letterSpacing: -0.3,
          }}>{alert.title}</div>
          <div style={{
            fontFamily: mono, fontSize: 10, letterSpacing: 1.2, color: panel.textDim,
            textTransform: 'uppercase', marginBottom: 10,
          }}>Expires {alert.expires}</div>
          <div style={{
            fontFamily: sans, fontSize: 13, lineHeight: 1.55, color: panel.text,
            textWrap: 'pretty',
          }}>{alert.detail}</div>
        </div>
        <div style={{
          padding: '12px 18px', borderTop: `1px solid ${panel.border}`,
          display: 'flex', alignItems: 'center', gap: 14,
          background: panel.surfaceTint,
        }}>
          <QrCode value={alert.qrCode || 'alert-detail'} size={64} fg={panel.text} bg={panel.surface}/>
          <div>
            <div style={{
              fontFamily: mono, fontSize: 9, letterSpacing: 1.4, color: panel.textDim,
              textTransform: 'uppercase', marginBottom: 4,
            }}>Scan for full bulletin</div>
            <div style={{ fontFamily: sans, fontSize: 11, color: panel.text }}>
              Government source · phone reads QR
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// QrCode — deterministic mock from a seed string. Renders 21x21 blocks
// (the smallest QR size). Not a real encoder — visual stand-in for kiosks.
// ────────────────────────────────────────────────────────────────
function QrCode({ value = '', size = 80, fg = '#000', bg = '#fff' }) {
  const N = 21;
  const cells = React.useMemo(() => {
    let seed = 0;
    for (const c of value) seed = (seed * 131 + c.charCodeAt(0)) | 0;
    const rng = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    const m = Array.from({ length: N }, () => Array(N).fill(0));
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) m[y][x] = rng() > 0.55 ? 1 : 0;
    // Add the three position markers
    const stamp = (ox, oy) => {
      for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
        const onEdge = x === 0 || x === 6 || y === 0 || y === 6;
        const onInner = x >= 2 && x <= 4 && y >= 2 && y <= 4;
        m[oy + y][ox + x] = (onEdge || onInner) ? 1 : 0;
      }
    };
    stamp(0, 0); stamp(N - 7, 0); stamp(0, N - 7);
    return m;
  }, [value]);
  const cell = size / N;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0, borderRadius: 4 }}>
      <rect width={size} height={size} fill={bg}/>
      {cells.flatMap((row, y) => row.map((v, x) => v ? (
        <rect key={`${x}-${y}`} x={x * cell} y={y * cell} width={cell} height={cell} fill={fg}/>
      ) : null))}
    </svg>
  );
}

// ────────────────────────────────────────────────────────────────
// IndoorBlock — Homebridge readings (temp / humid / aqi)
// ────────────────────────────────────────────────────────────────
function IndoorBlock({ indoor, t, mono, display, compact = false }) {
  return (
    <div style={{
      background: t.surface, border: `1px solid ${t.border}`,
      borderRadius: 8, padding: compact ? '8px 10px' : '10px 12px',
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <div style={{
        fontFamily: mono, fontSize: 9, letterSpacing: 1.4, color: t.textDim,
        textTransform: 'uppercase', writingMode: 'vertical-rl', transform: 'rotate(180deg)',
      }}>Indoor</div>
      <div style={{ display: 'flex', gap: 14, flex: 1, justifyContent: 'space-around' }}>
        {[
          ['Temp', `${indoor.temp}°`],
          ['Humid', `${indoor.humidity}%`],
          ['AQI', indoor.aqi],
        ].map(([lbl, val]) => (
          <div key={lbl} style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: mono, fontSize: 8, letterSpacing: 0.8, color: t.textDim, textTransform: 'uppercase' }}>{lbl}</div>
            <div style={{ fontFamily: display, fontSize: compact ? 14 : 16, color: t.text, fontWeight: 500, lineHeight: 1.1 }}>{val}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// RadarTimeline — play/pause + scrubber along the map's bottom edge
// ────────────────────────────────────────────────────────────────
function RadarTimeline({ frame = 0.5, playing = false, onTogglePlay, onScrub, t, mono, compact = false }) {
  const labelLeft = '-2h';
  const labelRight = '+30m';
  const now = frame; // 0..1
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      background: t.surface, border: `1px solid ${t.border}`,
      borderRadius: 8, padding: '6px 10px',
    }}>
      <button onClick={onTogglePlay} style={{
        width: 26, height: 26, borderRadius: 13,
        background: t.accent, color: '#fff', border: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        flexShrink: 0,
      }} aria-label={playing ? 'Pause' : 'Play'}>
        <WxIcon kind={playing ? 'pause' : 'play'} size={11}/>
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: mono, fontSize: 8, letterSpacing: 1, color: t.textDim,
          display: 'flex', justifyContent: 'space-between', marginBottom: 3, textTransform: 'uppercase',
        }}>
          <span>{labelLeft}</span><span style={{ color: t.accent }}>NOW</span><span>{labelRight}</span>
        </div>
        <div style={{ position: 'relative', height: 3, background: t.surfaceTint, borderRadius: 2 }}>
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${(2/2.5)*100}%`, background: t.textDim, borderRadius: 2 }}/>
          <div style={{ position: 'absolute', left: `${now * 100}%`, top: -3, width: 2, height: 9, background: t.accent, borderRadius: 1, transform: 'translateX(-1px)' }}/>
        </div>
      </div>
    </div>
  );
}

window.SourceBadge = SourceBadge;
window.ConfidencePill = ConfidencePill;
window.AlertBanner = AlertBanner;
window.AlertDetailOverlay = AlertDetailOverlay;
window.AlertDetailInline = AlertDetailInline;
window.QrCode = QrCode;
window.IndoorBlock = IndoorBlock;
window.RadarTimeline = RadarTimeline;
