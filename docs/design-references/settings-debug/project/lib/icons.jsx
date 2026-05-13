// Minimal line-style weather icons (consistent across directions).
// All SVGs use currentColor so they tint with text.

function WxIcon({ kind, size = 24, strokeWidth = 1.5, style = {} }) {
  const s = { width: size, height: size, display: 'inline-block', verticalAlign: 'middle', flexShrink: 0, ...style };
  const props = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round', style: s };
  switch (kind) {
    case 'sun':
      return (<svg {...props}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>);
    case 'moon':
      return (<svg {...props}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>);
    case 'cloudy':
      return (<svg {...props}><path d="M17.5 19a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.6 1.6A4 4 0 0 0 6.5 19h11z"/></svg>);
    case 'pcloudy':
      return (<svg {...props}><circle cx="8" cy="9" r="3"/><path d="M8 2v1M8 15v1M2 9h1M13 9h1M3.5 4.5l.7.7M11.8 13.3l.7.7M3.5 13.5l.7-.7M11.8 4.7l.7-.7"/><path d="M19 20a3 3 0 0 0 0-6 5 5 0 0 0-9.6 1.4A3.4 3.4 0 0 0 9.4 20H19z"/></svg>);
    case 'rain':
      return (<svg {...props}><path d="M17 14a4 4 0 0 0 0-8 6 6 0 0 0-11.5 1.5A4 4 0 0 0 6 14h11z"/><path d="M8 17v3M12 17v3.5M16 17v3"/></svg>);
    case 'storm':
      return (<svg {...props}><path d="M17 12a4 4 0 0 0 0-8 6 6 0 0 0-11.5 1.5A4 4 0 0 0 6 12h11z"/><path d="M11 14l-2 4h3l-2 4"/></svg>);
    case 'snow':
      return (<svg {...props}><path d="M17 14a4 4 0 0 0 0-8 6 6 0 0 0-11.5 1.5A4 4 0 0 0 6 14h11z"/><circle cx="8" cy="18" r=".5" fill="currentColor"/><circle cx="12" cy="20" r=".5" fill="currentColor"/><circle cx="16" cy="18" r=".5" fill="currentColor"/></svg>);
    case 'wind':
      return (<svg {...props}><path d="M3 8h12a3 3 0 1 0-3-3M3 16h17a3 3 0 1 1-3 3M3 12h9"/></svg>);
    case 'humidity':
      return (<svg {...props}><path d="M12 3s6 6 6 11a6 6 0 0 1-12 0c0-5 6-11 6-11z"/></svg>);
    case 'pressure':
      return (<svg {...props}><circle cx="12" cy="12" r="9"/><path d="M12 12l5-3"/></svg>);
    case 'uv':
      return (<svg {...props}><circle cx="12" cy="12" r="3.5"/><path d="M12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4"/></svg>);
    case 'compass':
      return (<svg {...props}><circle cx="12" cy="12" r="9"/><path d="M16 8l-2 6-6 2 2-6 6-2z" fill="currentColor" stroke="none"/></svg>);
    case 'alert':
      return (<svg {...props}><path d="M12 2L2 21h20L12 2z"/><path d="M12 9v5M12 17v.5"/></svg>);
    case 'play':
      return (<svg {...props} fill="currentColor" stroke="none"><path d="M6 4l14 8-14 8z"/></svg>);
    case 'pause':
      return (<svg {...props} fill="currentColor" stroke="none"><rect x="5" y="4" width="5" height="16" rx="1"/><rect x="14" y="4" width="5" height="16" rx="1"/></svg>);
    case 'crosshair':
      return (<svg {...props}><circle cx="12" cy="12" r="9"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>);
    case 'layers':
      return (<svg {...props}><path d="M12 2l10 6-10 6L2 8l10-6z"/><path d="M2 14l10 6 10-6"/></svg>);
    case 'gear':
      return (<svg {...props}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>);
    case 'chart':
      return (<svg {...props}><path d="M3 3v18h18"/><path d="M7 14l4-4 4 3 5-6"/></svg>);
    case 'bug':
      return (<svg {...props}><rect x="8" y="6" width="8" height="14" rx="4"/><path d="M12 6V3M9 4l3 2 3-2M5 9l3 1M19 9l-3 1M5 19l3-2M19 19l-3-2M5 14h3M16 14h3"/></svg>);
    case 'contrast':
      return (<svg {...props}><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none"/></svg>);
    case 'pin':
      return (<svg {...props}><path d="M12 2C8 2 5 5 5 9c0 5 7 13 7 13s7-8 7-13c0-4-3-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>);
    case 'pin-off':
      return (<svg {...props}><path d="M12 2C8 2 5 5 5 9c0 2 1 4.5 2.5 7M19 9c0-4-3-7-7-7M16.5 16c1-2 2.5-4.5 2.5-7"/><path d="M3 3l18 18"/></svg>);
    case 'arrow-up':
      return (<svg {...props}><path d="M12 19V5M5 12l7-7 7 7"/></svg>);
    case 'arrow-down':
      return (<svg {...props}><path d="M12 5v14M5 12l7 7 7-7"/></svg>);
    default:
      return (<svg {...props}><circle cx="12" cy="12" r="9"/></svg>);
  }
}

window.WxIcon = WxIcon;
