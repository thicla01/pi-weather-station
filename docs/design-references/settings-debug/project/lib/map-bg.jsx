// MapBg — generative radar/terrain backdrop.
// Optional overlays (all opt-in via props, so we can render lightly on Pi 4):
//   showRings        - 50/100 km dashed circles around user pin (default true)
//   extendedRadius   - red 100 km ring (vs yellow); accent on map
//   showDirectionArrows - flow arrows showing motion of rain bands
//   showSamplePoints - debug dots overlaid on map
//   timelineFrame    - 0..1 progress through the timeline scrubber. Shifts
//                      blobs along their motion vector to fake animation.

function MapBg({
  mode = 'clear', variant = 'dark',
  showRings = true, extendedRadius = false,
  showPin = true, showDirectionArrows = false, showSamplePoints = false,
  motion = { dirDeg: 65, speedKph: 35 },
  timelineFrame = 0, label = '', children,
}) {
  const rand = React.useMemo(() => {
    let seed = 1337;
    for (const c of mode + variant) seed = (seed * 31 + c.charCodeAt(0)) | 0;
    return () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
  }, [mode, variant]);

  const isDark = variant !== 'light';
  const land = isDark ? '#1d2024' : '#e8e4dc';
  const water = isDark ? '#11141a' : '#cad8e0';
  const road = isDark ? '#3a3f47' : '#bfb8ad';
  const labelColor = isDark ? 'rgba(190,200,215,0.4)' : 'rgba(60,50,40,0.5)';
  const labelStroke = isDark ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.7)';
  const ring50 = '#f0c050';
  const ring100 = extendedRadius ? '#e55454' : '#f0c050';
  const pinColor = '#5fd6e3';

  const blobs = React.useMemo(() => {
    const r = () => rand();
    const list = [];
    if (mode === 'rain' || mode === 'severe') {
      const count = mode === 'severe' ? 14 : 10;
      for (let i = 0; i < count; i++) {
        list.push({
          cx: 50 + r() * 600,
          cy: 40 + r() * 380,
          rx: 30 + r() * 90,
          ry: 20 + r() * 60,
          rot: r() * 60 - 30,
          intensity: mode === 'severe' ? r() : r() * 0.7,
        });
      }
    }
    return list;
  }, [mode, rand]);

  const rainColor = (intensity) => {
    if (intensity < 0.2) return '#2da8cc';
    if (intensity < 0.4) return '#3ad28a';
    if (intensity < 0.6) return '#f0d845';
    if (intensity < 0.8) return '#e89232';
    if (intensity < 0.95) return '#e55454';
    return '#c66ad8';
  };

  // Convert compass motion to dx/dy. Frame shifts blobs along that vector.
  const motRad = ((motion.dirDeg - 90) * Math.PI) / 180;
  const motDx = Math.cos(motRad) * motion.speedKph * (timelineFrame - 0.5) * 0.6;
  const motDy = Math.sin(motRad) * motion.speedKph * (timelineFrame - 0.5) * 0.6;

  // Sample points — coarse grid over land
  const samplePoints = React.useMemo(() => {
    const pts = [];
    for (let x = 60; x < 720; x += 60) {
      for (let y = 60; y < 420; y += 60) {
        // colour by mocked intensity at that point
        const i = (Math.sin(x * 0.013) + Math.cos(y * 0.011)) * 0.5 + 0.5;
        pts.push({ x, y, c: rainColor(i * (mode === 'severe' ? 0.9 : mode === 'rain' ? 0.55 : 0.15)) });
      }
    }
    return pts;
  }, [mode]);

  // Direction arrows — a small grid of motion glyphs
  const arrows = React.useMemo(() => {
    const arr = [];
    for (let x = 90; x < 700; x += 110) {
      for (let y = 80; y < 410; y += 95) {
        arr.push({ x, y });
      }
    }
    return arr;
  }, []);

  const waterPath = 'M0 0 L 720 0 L 720 280 Q 660 290 600 285 T 480 275 Q 420 270 360 280 T 240 290 Q 180 295 120 285 T 0 280 Z';

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: isDark ? '#0b0d10' : '#e0d9cd' }}>
      <svg viewBox="0 0 720 460" preserveAspectRatio="xMidYMid slice" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}>
        <defs>
          <pattern id={`mb-noise-${variant}`} width="3" height="3" patternUnits="userSpaceOnUse">
            <rect width="3" height="3" fill={land}/>
            <rect width="1" height="1" x="1" y="1" fill={isDark ? '#252a30' : '#d8d2c5'}/>
          </pattern>
          <marker id={`mb-arrow-${variant}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill={isDark ? 'rgba(140,180,210,0.55)' : 'rgba(60,80,100,0.55)'}/>
          </marker>
        </defs>

        <rect width="720" height="460" fill={`url(#mb-noise-${variant})`}/>
        <path d={waterPath} fill={water}/>

        <path d="M280 460 Q 290 400 270 340 Q 250 290 280 280" fill="none" stroke={water} strokeWidth="6"/>
        <path d="M500 460 Q 490 410 520 360 Q 540 320 510 280" fill="none" stroke={water} strokeWidth="5"/>

        <path d="M0 320 Q 200 300 400 330 T 720 310" fill="none" stroke={road} strokeWidth="2" opacity="0.7"/>
        <path d="M120 460 Q 130 380 180 320 T 280 200 Q 320 140 380 100" fill="none" stroke={road} strokeWidth="1.5" opacity="0.6"/>
        <path d="M0 180 Q 150 200 300 190 T 600 200 T 720 195" fill="none" stroke={road} strokeWidth="1.2" opacity="0.5"/>

        <g fontFamily="'IBM Plex Sans', system-ui, sans-serif" fontSize="11" fill={labelColor} stroke={labelStroke} strokeWidth="3" paintOrder="stroke" style={{ letterSpacing: 0.2 }}>
          <text x="80" y="380">Matane</text>
          <text x="220" y="430">Gaspé</text>
          <text x="400" y="350">Carleton</text>
          <text x="560" y="395">Bonaventure</text>
          <text x="160" y="220">Murdochville</text>
          <text x="380" y="180">Parc national</text>
          <text x="540" y="220">Causapscal</text>
          <text x="80" y="120">Mont-Joli</text>
          <text x="600" y="100">Rimouski</text>
        </g>

        {/* Radar precipitation overlay — blobs shift along motion vector with timeline */}
        {blobs.map((b, i) => (
          <g key={i} transform={`translate(${b.cx + motDx} ${b.cy + motDy}) rotate(${b.rot})`}>
            <ellipse rx={b.rx * 1.2} ry={b.ry * 1.2} fill={rainColor(b.intensity * 0.4)} opacity="0.35"/>
            <ellipse rx={b.rx} ry={b.ry} fill={rainColor(b.intensity * 0.6)} opacity="0.55"/>
            <ellipse rx={b.rx * 0.7} ry={b.ry * 0.7} fill={rainColor(b.intensity * 0.85)} opacity="0.7"/>
            <ellipse rx={b.rx * 0.4} ry={b.ry * 0.4} fill={rainColor(b.intensity)} opacity="0.85"/>
          </g>
        ))}

        {/* Sample points debug overlay */}
        {showSamplePoints && (
          <g opacity="0.7">
            {samplePoints.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r="2.5" fill={p.c}/>
            ))}
          </g>
        )}

        {/* Direction arrows overlay */}
        {showDirectionArrows && (mode === 'rain' || mode === 'severe') && (
          <g>
            {arrows.map((a, i) => {
              const len = 28;
              const x2 = a.x + Math.cos(motRad) * len;
              const y2 = a.y + Math.sin(motRad) * len;
              return (
                <line key={i} x1={a.x} y1={a.y} x2={x2} y2={y2}
                      stroke={isDark ? 'rgba(140,180,210,0.55)' : 'rgba(60,80,100,0.55)'}
                      strokeWidth="1.6" markerEnd={`url(#mb-arrow-${variant})`}/>
              );
            })}
          </g>
        )}

        {/* Analysis circles — 50 km yellow + 100 km (yellow normal, red extended) */}
        {showRings && (
          <g transform="translate(360 230)">
            <circle r="65" fill="none" stroke={ring50} strokeWidth="1.5" strokeDasharray="3 4" opacity="0.8"/>
            <text x="0" y="-58" textAnchor="middle" fontFamily="'JetBrains Mono', monospace" fontSize="8" fill={ring50} letterSpacing="0.8">50 KM</text>
            <circle r="140" fill="none" stroke={ring100} strokeWidth={extendedRadius ? "2" : "1.5"}
                    strokeDasharray={extendedRadius ? "5 4" : "3 4"} opacity={extendedRadius ? 0.85 : 0.55}/>
            <text x="0" y="-133" textAnchor="middle" fontFamily="'JetBrains Mono', monospace" fontSize="8"
                  fill={ring100} letterSpacing="0.8">100 KM{extendedRadius ? ' · EXT' : ''}</text>
          </g>
        )}

        {showPin && (
          <g transform="translate(360 230)">
            <circle r="4" fill={pinColor}/>
            <circle r="9" fill="none" stroke={pinColor} strokeWidth="1.5" opacity="0.6"/>
          </g>
        )}
      </svg>

      {label && (
        <div style={{
          position: 'absolute', bottom: 8, left: 10, fontSize: 10, fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          letterSpacing: 0.6, color: isDark ? 'rgba(190,200,215,0.5)' : 'rgba(60,50,40,0.55)', textTransform: 'uppercase'
        }}>{label}</div>
      )}

      {children}
    </div>
  );
}

window.MapBg = MapBg;
