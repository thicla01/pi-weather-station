// Debug panel — 12 sections grouped into 4 task buckets.
// Three nav variants exposed via prop `navVariant`:
//   'rail'    — Vertical task-bucket tab rail (default · best for 7" Pi)
//   'search'  — Sticky search + collapsible accordion (best for power users)
//   'pager'   — Bottom-sheet pager with chip-bar (most tactile · touch first)
//
// All variants display the SAME 12 sections; only navigation differs.

const D_PALETTE = (tod) => (window.cTokens && window.cTokens[tod]) || window.cTokens.day;

// Section-bucket grouping. Buckets are the navigation primitive.
const BUCKETS = [
  { id: 'server',   icon: '⌬', label: 'Server',   sections: ['config', 'kpi', 'logs'] },
  { id: 'client',   icon: '◐', label: 'Client',   sections: ['clientKpi', 'remoteClients', 'security'] },
  { id: 'services', icon: '◇', label: 'Services', sections: ['providers', 'services', 'quota'] },
  { id: 'storage',  icon: '▢', label: 'Storage',  sections: ['cache', 'snapshots'] },
  { id: 'about',    icon: 'ⓘ', label: 'About',    sections: ['vuln'] },
];

const SECTION_META = {
  config:        { title: 'Server config',       bucket: 'server' },
  kpi:           { title: 'Server KPI',          bucket: 'server' },
  logs:          { title: 'Logs',                bucket: 'server' },
  clientKpi:     { title: 'Client KPI',          bucket: 'client' },
  remoteClients: { title: 'Remote clients',      bucket: 'client' },
  security:      { title: 'Security events',     bucket: 'client' },
  providers:     { title: 'Provider statuspages', bucket: 'services' },
  services:      { title: 'Last service calls',  bucket: 'services' },
  quota:         { title: 'Quotas',              bucket: 'services' },
  cache:         { title: 'In-memory cache',     bucket: 'storage' },
  snapshots:     { title: 'Radar snapshots',     bucket: 'storage' },
  vuln:          { title: 'Vulnerability scan',  bucket: 'about' },
};

// ─── KV row helpers ──────────────────────────────────────────────────
function KV({ k, v, t, FONTS, mono = true, dim }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '2px 0', borderBottom: `1px dotted ${t.border}` }}>
      <span style={{ fontFamily: FONTS.mono, fontSize: 9, letterSpacing: 0.8, color: t.textDim, textTransform: 'uppercase', minWidth: 110 }}>{k}</span>
      <span style={{ fontFamily: mono ? FONTS.mono : FONTS.sans, fontSize: 11, color: dim ? t.textDim : t.text, fontVariantNumeric: 'tabular-nums', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{v}</span>
    </div>
  );
}

function Tag({ kind, t, FONTS, children }) {
  const c = kind === 'ok'    ? { bg: '#2e7d52', fg: '#fff' }
          : kind === 'warn'  ? { bg: t.warn, fg: '#fff' }
          : kind === 'err'   ? { bg: t.danger, fg: '#fff' }
          : kind === 'info'  ? { bg: t.surfaceTint, fg: t.accent, border: t.accent }
          :                    { bg: t.surfaceTint, fg: t.textDim };
  return <span style={{
    fontFamily: FONTS.mono, fontSize: 8.5, letterSpacing: 1, fontWeight: 600,
    padding: '1px 5px', borderRadius: 2, background: c.bg, color: c.fg,
    border: c.border ? `1px solid ${c.border}` : 'none', textTransform: 'uppercase',
  }}>{children}</span>;
}

function QuotaBar({ used, cap, t, FONTS }) {
  const pct = Math.min(100, (used / cap) * 100);
  const color = pct >= 95 ? t.danger : pct >= 80 ? t.warn : t.accent;
  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: FONTS.mono, fontSize: 9, color: t.textDim, letterSpacing: 0.6 }}>
        <span style={{ color: t.text, fontVariantNumeric: 'tabular-nums' }}>{used.toLocaleString()}/{cap.toLocaleString()}</span>
        <span style={{ color, fontVariantNumeric: 'tabular-nums' }}>{pct.toFixed(0)}%</span>
      </div>
      <div style={{ height: 4, background: t.surfaceTint, borderRadius: 2, overflow: 'hidden', marginTop: 2 }}>
        <div style={{ width: pct + '%', height: '100%', background: color, transition: 'width 200ms' }}/>
      </div>
    </div>
  );
}

// ─── Section bodies (12 of them) ─────────────────────────────────────
const Sec = {
  config: (D, t, FONTS) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
      <div>
        <KV k="version"  v={`${D.server.version} · ${D.server.commit} · ${D.server.branch}`} t={t} FONTS={FONTS}/>
        <KV k="os"       v={D.server.os}       t={t} FONTS={FONTS}/>
        <KV k="hostname" v={D.server.hostname} t={t} FONTS={FONTS}/>
        <KV k="ip"       v={D.server.ip}       t={t} FONTS={FONTS}/>
        <KV k="ports"    v={`HTTP :${D.server.ports.http} · HTTPS :${D.server.ports.https}`} t={t} FONTS={FONTS}/>
      </div>
      <div>
        <KV k="DEBUG"        v={<Tag kind={D.server.flags.DEBUG ? 'ok' : 'neutral'} t={t} FONTS={FONTS}>{D.server.flags.DEBUG ? 'TRUE' : 'FALSE'}</Tag>} t={t} FONTS={FONTS}/>
        <KV k="ALLOW_REMOTE" v={<Tag kind={D.server.flags.ALLOW_REMOTE ? 'warn' : 'neutral'} t={t} FONTS={FONTS}>{D.server.flags.ALLOW_REMOTE ? 'TRUE' : 'FALSE'}</Tag>} t={t} FONTS={FONTS}/>
        <KV k="settings.json" v={D.server.settingsPath} t={t} FONTS={FONTS} dim/>
        <KV k="deploy diff"  v={D.server.deployArtefactsChanged
          ? <Tag kind="warn" t={t} FONTS={FONTS}>artefacts changed</Tag>
          : <Tag kind="ok" t={t} FONTS={FONTS}>clean</Tag>} t={t} FONTS={FONTS}/>
        <KV k="urls"        v={D.network.urls.join(' · ')} t={t} FONTS={FONTS} dim/>
      </div>
    </div>
  ),
  kpi: (D, t, FONTS) => (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8 }}>
        {[
          ['Uptime', D.serverKpi.uptime, ''],
          ['Heap', `${D.serverKpi.heap.used}/${D.serverKpi.heap.total}`, 'MB'],
          ['RSS', D.serverKpi.heap.rss, 'MB'],
          ['Cache hit', D.serverKpi.cache.hitRate, '%'],
          ['CPU temp', D.serverKpi.cpuTemp, '°C'],
          ['Fan', D.serverKpi.fanRpm, 'rpm'],
        ].map(([k, v, u]) => (
          <div key={k} style={{ background: t.surfaceTint, border: `1px solid ${t.border}`, borderRadius: 4, padding: '6px 8px' }}>
            <div style={{ fontFamily: FONTS.mono, fontSize: 8.5, letterSpacing: 1, color: t.textDim, textTransform: 'uppercase' }}>{k}</div>
            <div style={{ fontFamily: FONTS.mono, fontSize: 13, color: t.text, fontVariantNumeric: 'tabular-nums', display: 'flex', alignItems: 'baseline', gap: 2 }}>
              {v}<span style={{ fontSize: 9, color: t.textDim }}>{u}</span>
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 10, fontFamily: FONTS.mono, fontSize: 9, letterSpacing: 1, color: t.textDim, textTransform: 'uppercase', marginBottom: 4 }}>Response times</div>
      {D.serverKpi.responses.map(r => (
        <KV key={r.endpoint} k={r.endpoint} v={`avg ${r.avgMs} ms · p95 ${r.p95Ms} ms`} t={t} FONTS={FONTS}/>
      ))}
    </div>
  ),
  clientKpi: (D, t, FONTS) => (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8, marginBottom: 10 }}>
        {[
          ['Load', D.clientKpi.loadMs, 'ms'],
          ['FPS', D.clientKpi.fps, ''],
          ['JS heap', D.clientKpi.jsHeapMb, 'MB'],
        ].map(([k, v, u]) => (
          <div key={k} style={{ background: t.surfaceTint, border: `1px solid ${t.border}`, borderRadius: 4, padding: '6px 8px' }}>
            <div style={{ fontFamily: FONTS.mono, fontSize: 8.5, letterSpacing: 1, color: t.textDim, textTransform: 'uppercase' }}>{k}</div>
            <div style={{ fontFamily: FONTS.mono, fontSize: 13, color: t.text, fontVariantNumeric: 'tabular-nums', display: 'flex', alignItems: 'baseline', gap: 2 }}>
              {v}<span style={{ fontSize: 9, color: t.textDim }}>{u}</span>
            </div>
          </div>
        ))}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONTS.mono, fontSize: 10 }}>
        <thead>
          <tr style={{ color: t.textDim, letterSpacing: 0.8 }}>
            <th style={{ textAlign: 'left',  padding: '4px 6px', borderBottom: `1px solid ${t.border}` }}>Endpoint</th>
            <th style={{ textAlign: 'right', padding: '4px 6px', borderBottom: `1px solid ${t.border}` }}>Calls</th>
            <th style={{ textAlign: 'right', padding: '4px 6px', borderBottom: `1px solid ${t.border}` }}>avg ms</th>
            <th style={{ textAlign: 'right', padding: '4px 6px', borderBottom: `1px solid ${t.border}` }}>min</th>
            <th style={{ textAlign: 'right', padding: '4px 6px', borderBottom: `1px solid ${t.border}` }}>max</th>
          </tr>
        </thead>
        <tbody>
          {D.clientKpi.apiCalls.map(r => (
            <tr key={r.endpoint} style={{ color: t.text, fontVariantNumeric: 'tabular-nums' }}>
              <td style={{ padding: '3px 6px', borderBottom: `1px dotted ${t.border}` }}>{r.endpoint}</td>
              <td style={{ padding: '3px 6px', borderBottom: `1px dotted ${t.border}`, textAlign: 'right' }}>{r.count}</td>
              <td style={{ padding: '3px 6px', borderBottom: `1px dotted ${t.border}`, textAlign: 'right' }}>{r.avgMs}</td>
              <td style={{ padding: '3px 6px', borderBottom: `1px dotted ${t.border}`, textAlign: 'right' }}>{r.minMs}</td>
              <td style={{ padding: '3px 6px', borderBottom: `1px dotted ${t.border}`, textAlign: 'right' }}>{r.maxMs}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ),
  providers: (D, t, FONTS) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {D.providers.map(p => (
        <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '120px auto 1fr auto', gap: 8, alignItems: 'center', padding: '4px 6px', borderBottom: `1px dotted ${t.border}` }}>
          <span style={{ fontFamily: FONTS.display, fontSize: 12, color: t.text, fontWeight: 500 }}>{p.id}</span>
          <Tag kind={p.status === 'operational' ? 'ok' : p.status === 'degraded' ? 'warn' : 'neutral'} t={t} FONTS={FONTS}>{p.status}</Tag>
          <span style={{ fontFamily: FONTS.mono, fontSize: 9.5, color: t.textDim, letterSpacing: 0.6 }}>checked {p.lastChecked}</span>
          <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: t.text, fontVariantNumeric: 'tabular-nums' }}>{p.uptime}</span>
        </div>
      ))}
    </div>
  ),
  services: (D, t, FONTS) => (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONTS.mono, fontSize: 10 }}>
      <thead>
        <tr style={{ color: t.textDim, letterSpacing: 0.8 }}>
          <th style={{ textAlign: 'left',  padding: '4px 6px', borderBottom: `1px solid ${t.border}` }}>Service</th>
          <th style={{ textAlign: 'left',  padding: '4px 6px', borderBottom: `1px solid ${t.border}` }}>Last</th>
          <th style={{ textAlign: 'right', padding: '4px 6px', borderBottom: `1px solid ${t.border}` }}>ms</th>
          <th style={{ textAlign: 'right', padding: '4px 6px', borderBottom: `1px solid ${t.border}` }}>at</th>
        </tr>
      </thead>
      <tbody>
        {D.services.map(s => {
          const isErr = !s.last.startsWith('2');
          return (
            <tr key={s.name} style={{ color: t.text, fontVariantNumeric: 'tabular-nums' }}>
              <td style={{ padding: '3px 6px', borderBottom: `1px dotted ${t.border}` }}>{s.name}</td>
              <td style={{ padding: '3px 6px', borderBottom: `1px dotted ${t.border}` }}><Tag kind={isErr ? 'err' : 'ok'} t={t} FONTS={FONTS}>{s.last}</Tag></td>
              <td style={{ padding: '3px 6px', borderBottom: `1px dotted ${t.border}`, textAlign: 'right', color: isErr ? t.danger : t.text }}>{s.ms}</td>
              <td style={{ padding: '3px 6px', borderBottom: `1px dotted ${t.border}`, textAlign: 'right', color: t.textDim }}>{s.ts}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  ),
  quota: (D, t, FONTS) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {D.quota.map(q => (
        <div key={q.service + q.endpoint} style={{ padding: '4px 6px', borderBottom: `1px dotted ${t.border}` }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 3 }}>
            <span style={{ fontFamily: FONTS.display, fontSize: 11.5, color: t.text, fontWeight: 500 }}>{q.service}</span>
            <span style={{ fontFamily: FONTS.mono, fontSize: 9, color: t.textDim, letterSpacing: 0.4 }}>{q.endpoint}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <div style={{ fontFamily: FONTS.mono, fontSize: 8.5, letterSpacing: 1, color: t.textDim, textTransform: 'uppercase' }}>hour</div>
              <QuotaBar used={q.hour.used} cap={q.hour.cap} t={t} FONTS={FONTS}/>
            </div>
            <div>
              <div style={{ fontFamily: FONTS.mono, fontSize: 8.5, letterSpacing: 1, color: t.textDim, textTransform: 'uppercase' }}>day</div>
              <QuotaBar used={q.day.used} cap={q.day.cap} t={t} FONTS={FONTS}/>
            </div>
          </div>
        </div>
      ))}
    </div>
  ),
  cache: (D, t, FONTS) => (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONTS.mono, fontSize: 10 }}>
      <thead>
        <tr style={{ color: t.textDim, letterSpacing: 0.8 }}>
          <th style={{ textAlign: 'left',  padding: '4px 6px', borderBottom: `1px solid ${t.border}` }}>Key</th>
          <th style={{ textAlign: 'right', padding: '4px 6px', borderBottom: `1px solid ${t.border}` }}>TTL</th>
          <th style={{ textAlign: 'right', padding: '4px 6px', borderBottom: `1px solid ${t.border}` }}>KB</th>
        </tr>
      </thead>
      <tbody>
        {D.cache.map(c => (
          <tr key={c.key} style={{ color: t.text, fontVariantNumeric: 'tabular-nums' }}>
            <td style={{ padding: '3px 6px', borderBottom: `1px dotted ${t.border}`, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.key}</td>
            <td style={{ padding: '3px 6px', borderBottom: `1px dotted ${t.border}`, textAlign: 'right', color: t.textDim }}>{c.ttl}</td>
            <td style={{ padding: '3px 6px', borderBottom: `1px dotted ${t.border}`, textAlign: 'right' }}>{c.sizeKb}</td>
          </tr>
        ))}
      </tbody>
    </table>
  ),
  remoteClients: (D, t, FONTS) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {D.remoteClients.length === 0 && <span style={{ fontFamily: FONTS.sans, fontSize: 11, color: t.textDim }}>No remote clients seen.</span>}
      {D.remoteClients.map(r => (
        <div key={r.ip} style={{ padding: '4px 6px', borderBottom: `1px dotted ${t.border}` }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
            <span style={{ fontFamily: FONTS.mono, fontSize: 11, color: t.text, fontWeight: 500 }}>{r.ip}</span>
            <span style={{ fontFamily: FONTS.sans, fontSize: 10, color: t.textDim }}>{r.ua}</span>
            <span style={{ marginLeft: 'auto', fontFamily: FONTS.mono, fontSize: 9.5, color: t.text, fontVariantNumeric: 'tabular-nums' }}>{r.requests} req</span>
          </div>
          <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: t.textDim, letterSpacing: 0.4, marginTop: 2 }}>
            first {r.firstSeen} · last {r.lastSeen}
          </div>
        </div>
      ))}
    </div>
  ),
  security: (D, t, FONTS) => (
    D.security.length === 0
      ? <div style={{ padding: '14px 12px', border: `1px dashed ${t.border}`, borderRadius: 6, textAlign: 'center' }}>
          <Tag kind="ok" t={t} FONTS={FONTS}>all clear</Tag>
          <div style={{ fontFamily: FONTS.sans, fontSize: 11, color: t.textDim, marginTop: 6 }}>No blocked requests in the current window.</div>
        </div>
      : <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {D.security.map((s, i) => (
            <div key={i} style={{ padding: '6px 8px', borderLeft: `3px solid ${t.danger}`, background: 'rgba(168,50,50,0.08)', borderRadius: 3 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <Tag kind="err" t={t} FONTS={FONTS}>{s.method}</Tag>
                <span style={{ fontFamily: FONTS.mono, fontSize: 11, color: t.text }}>{s.path}</span>
                <span style={{ marginLeft: 'auto', fontFamily: FONTS.mono, fontSize: 9, color: t.textDim }}>{s.ts} · ×{s.count}</span>
              </div>
              <div style={{ fontFamily: FONTS.sans, fontSize: 10.5, color: t.textDim, marginTop: 2 }}>{s.reason} · from <span style={{ color: t.text, fontFamily: FONTS.mono }}>{s.ip}</span></div>
            </div>
          ))}
        </div>
  ),
  snapshots: (D, t, FONTS) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {D.snapshots.map(s => (
        <div key={s.id} style={{ padding: '4px 6px', borderBottom: `1px dotted ${t.border}`, display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontFamily: FONTS.mono, fontSize: 9.5, color: t.textDim }}>{s.ts}</span>
          <span style={{ fontFamily: FONTS.sans, fontSize: 11, color: t.text, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.summary}</span>
          <span style={{ fontFamily: FONTS.mono, fontSize: 9.5, color: t.textDim }}>{s.sizeKb} KB</span>
          <button style={{ background: 'transparent', color: t.accent, border: `1px solid ${t.border}`, borderRadius: 3, fontFamily: FONTS.mono, fontSize: 8.5, letterSpacing: 1, padding: '1px 5px', cursor: 'pointer', textTransform: 'uppercase' }}>Copy</button>
        </div>
      ))}
    </div>
  ),
  logs: (D, t, FONTS) => (
    <pre style={{
      background: 'rgba(0,0,0,0.20)', border: `1px solid ${t.border}`, borderRadius: 4,
      padding: 8, fontFamily: FONTS.mono, fontSize: 9.5, lineHeight: 1.45, color: t.text,
      margin: 0, maxHeight: 280, overflowY: 'auto',
    }}>
      {D.logs.map((l, i) => {
        const c = l.level === 'error' ? t.danger : l.level === 'warn' ? t.warn : t.textDim;
        return (
          <div key={i}>
            <span style={{ color: t.textDim }}>{l.ts}</span>
            {' '}<span style={{ color: c, fontWeight: 600 }}>[{l.level.toUpperCase()}]</span>
            {' '}<span>{l.msg}</span>
          </div>
        );
      })}
    </pre>
  ),
  vuln: (D, t, FONTS) => (
    <div style={{ padding: '10px 12px', background: t.surfaceTint, border: `1px solid ${t.border}`, borderRadius: 6 }}>
      <div style={{ fontFamily: FONTS.sans, fontSize: 12, color: t.text, marginBottom: 6 }}>
        Dependabot scans run weekly on GitHub. Critical or high alerts appear as PRs.
      </div>
      <a href="#" style={{ fontFamily: FONTS.mono, fontSize: 10, letterSpacing: 1, color: t.accent, textDecoration: 'underline', textTransform: 'uppercase', textUnderlineOffset: 2 }}>
        Open Dependabot PRs · github.com →
      </a>
    </div>
  ),
};

// Per-section row toolbar (Copy / Export / Refresh affordances)
function SectionTools({ tools = [], t, FONTS }) {
  if (!tools.length) return null;
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {tools.map(tag => (
        <button key={tag} style={{
          background: 'transparent', color: t.textDim, border: `1px solid ${t.border}`,
          borderRadius: 3, padding: '2px 6px', fontFamily: FONTS.mono, fontSize: 8.5,
          letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer',
        }}>{tag}</button>
      ))}
    </div>
  );
}

const TOOLS = {
  config: [], kpi: ['Refresh'], logs: ['Copy', 'Export'],
  clientKpi: ['Refresh'], remoteClients: ['Export CSV'], security: ['Export CSV'],
  providers: ['Refresh'], services: ['Refresh'], quota: ['Refresh'],
  cache: ['Flush'], snapshots: ['Export JSON'], vuln: [],
};

function SectionBlock({ id, D, t, FONTS, defaultOpen = true, compact }) {
  const [open, setOpen] = React.useState(defaultOpen);
  const meta = SECTION_META[id];
  const Body = Sec[id];
  return (
    <div style={{ marginBottom: 12, border: `1px solid ${t.border}`, borderRadius: 6, background: t.surface, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: compact ? '8px 10px' : '10px 14px', background: t.surfaceTint, borderBottom: open ? `1px solid ${t.border}` : 'none' }}>
        <button onClick={() => setOpen(o => !o)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, color: t.accent, fontFamily: FONTS.mono, fontSize: 11 }}>
          <span style={{ display: 'inline-block', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 150ms' }}>▸</span>
        </button>
        <span style={{ fontFamily: FONTS.display, fontSize: 13, fontWeight: 500, color: t.text, flex: 1 }}>{meta.title}</span>
        <SectionTools tools={TOOLS[id]} t={t} FONTS={FONTS}/>
      </div>
      {open && <div style={{ padding: compact ? '8px 10px' : '10px 14px' }}>{Body(D, t, FONTS)}</div>}
    </div>
  );
}

// ─── NAV · Variant A · Vertical task-bucket rail ─────────────────────
function NavRail({ active, onPick, t, FONTS, compact }) {
  return (
    <div style={{
      width: compact ? 64 : 92,
      borderRight: `1px solid ${t.border}`, background: t.surface,
      display: 'flex', flexDirection: 'column', padding: '8px 0',
      flexShrink: 0,
    }}>
      {BUCKETS.map(b => {
        const sel = active === b.id;
        return (
          <button key={b.id} onClick={() => onPick(b.id)} style={{
            background: sel ? t.accentSoft : 'transparent',
            border: 'none', borderLeft: `3px solid ${sel ? t.accent : 'transparent'}`,
            color: sel ? t.accent : t.text, cursor: 'pointer',
            padding: compact ? '8px 4px' : '10px 6px',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
            minHeight: 48, fontFamily: FONTS.mono, fontSize: 9, letterSpacing: 1, textTransform: 'uppercase',
          }}>
            <span style={{ fontSize: 18, lineHeight: 1 }}>{b.icon}</span>
            <span>{b.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ─── NAV · Variant B · Search + accordion ────────────────────────────
function SearchBar({ q, setQ, t, FONTS }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '8px 10px', background: t.surface, borderBottom: `1px solid ${t.border}`,
      position: 'sticky', top: 0, zIndex: 2,
    }}>
      <span style={{ color: t.textDim, fontFamily: FONTS.mono, fontSize: 12 }}>⌕</span>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="filter sections…  e.g. quota, security, provider" style={{
        flex: 1, background: 'transparent', border: 'none', outline: 'none',
        color: t.text, fontFamily: FONTS.mono, fontSize: 11, letterSpacing: 0.4,
      }}/>
      {q && <button onClick={() => setQ('')} style={{ background: 'transparent', color: t.textDim, border: 'none', cursor: 'pointer', fontFamily: FONTS.mono, fontSize: 12 }}>✕</button>}
    </div>
  );
}

// ─── NAV · Variant C · Chip-bar pager ────────────────────────────────
function ChipBar({ active, onPick, t, FONTS }) {
  return (
    <div style={{
      display: 'flex', gap: 6, padding: '8px 10px',
      background: t.surface, borderBottom: `1px solid ${t.border}`,
      overflowX: 'auto', flexShrink: 0,
    }}>
      {BUCKETS.map(b => {
        const sel = active === b.id;
        return (
          <button key={b.id} onClick={() => onPick(b.id)} style={{
            background: sel ? t.accent : t.surfaceTint,
            color: sel ? '#fff' : t.text, border: `1px solid ${sel ? t.accent : t.border}`,
            borderRadius: 16, padding: '6px 12px',
            fontFamily: FONTS.mono, fontSize: 10, letterSpacing: 0.8, fontWeight: 500,
            display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', whiteSpace: 'nowrap',
            minHeight: 32,
          }}>
            <span>{b.icon}</span><span>{b.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ─── DebugPanel ──────────────────────────────────────────────────────
function DebugPanel({
  timeOfDay = 'night',
  size = '800x480',
  navVariant = 'rail',
  scenario = 'healthy',
  onClose = null,
}) {
  const t = D_PALETTE(timeOfDay);
  const FONTS = window.cFONTS;
  const [w, h] = size.split('x').map(Number);
  const compact = w <= 800;
  const D = ADMIN.makeDebug(scenario);

  const [bucket, setBucket] = React.useState('server');
  const [q, setQ] = React.useState('');

  // Bucket → sections visible
  const visibleSections = React.useMemo(() => {
    if (navVariant === 'search') {
      if (!q.trim()) return Object.keys(SECTION_META);
      const ql = q.toLowerCase();
      return Object.keys(SECTION_META).filter(id =>
        id.toLowerCase().includes(ql) || SECTION_META[id].title.toLowerCase().includes(ql) || SECTION_META[id].bucket.includes(ql)
      );
    }
    return BUCKETS.find(b => b.id === bucket).sections;
  }, [navVariant, bucket, q]);

  // Header — version + actions
  const Header = (
    <div style={{
      padding: compact ? '8px 10px' : '12px 16px',
      borderBottom: `1px solid ${t.border}`, background: t.surface,
      display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
    }}>
      <span style={{ color: t.danger, fontFamily: FONTS.mono, fontSize: 14 }}>⌬</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: FONTS.display, fontSize: compact ? 14 : 16, fontWeight: 500, color: t.text }}>
          Debug <span style={{ fontFamily: FONTS.mono, fontSize: 9, letterSpacing: 1, color: t.textDim, textTransform: 'uppercase', marginLeft: 6 }}>localhost · DEBUG=true</span>
        </div>
        <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: t.textDim, letterSpacing: 0.6 }}>
          v{D.server.version} · {D.server.commit} · {D.server.branch} · {D.server.hostname}
          <span style={{ marginLeft: 8, color: D.network.online ? '#2e7d52' : t.danger }}>● {D.network.online ? 'online' : 'offline'}</span>
        </div>
      </div>
      <button style={{ background: 'transparent', color: t.textDim, border: `1px solid ${t.border}`, borderRadius: 3, padding: '4px 8px', fontFamily: FONTS.mono, fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer' }}>Refresh</button>
      <button style={{ background: 'transparent', color: t.textDim, border: `1px solid ${t.border}`, borderRadius: 3, padding: '4px 8px', fontFamily: FONTS.mono, fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer' }}>Export CSV</button>
      {onClose && <button onClick={onClose} style={{ background: 'transparent', color: t.textDim, border: 'none', fontFamily: FONTS.mono, fontSize: 14, cursor: 'pointer', padding: 4 }} aria-label="Close">✕</button>}
    </div>
  );

  // Body
  const Body = (
    <div style={{ flex: 1, overflowY: 'auto', padding: compact ? '10px' : '14px' }}>
      {navVariant === 'search' && (
        <div style={{ fontFamily: FONTS.mono, fontSize: 9, letterSpacing: 1, color: t.textDim, textTransform: 'uppercase', marginBottom: 8 }}>
          {visibleSections.length} {visibleSections.length === 1 ? 'section' : 'sections'} {q && `matching "${q}"`}
        </div>
      )}
      {navVariant !== 'search' && (
        <div style={{ fontFamily: FONTS.mono, fontSize: 9, letterSpacing: 1, color: t.accent, textTransform: 'uppercase', marginBottom: 8, fontWeight: 600 }}>
          {BUCKETS.find(b => b.id === bucket).label} · {visibleSections.length} sections
        </div>
      )}
      {visibleSections.map(id => (
        <SectionBlock key={id} id={id} D={D} t={t} FONTS={FONTS} compact={compact} defaultOpen={navVariant !== 'search' || q !== ''}/>
      ))}
      {visibleSections.length === 0 && (
        <div style={{ padding: 20, textAlign: 'center', fontFamily: FONTS.sans, fontSize: 12, color: t.textDim }}>
          No sections match “{q}”.
        </div>
      )}
    </div>
  );

  // Compose by variant
  return (
    <div style={{
      width: w, height: h, background: t.bg, color: t.text,
      fontFamily: FONTS.sans, position: 'relative', overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
    }}>
      {Header}
      {navVariant === 'rail' && (
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <NavRail active={bucket} onPick={setBucket} t={t} FONTS={FONTS} compact={compact}/>
          {Body}
        </div>
      )}
      {navVariant === 'search' && (
        <React.Fragment>
          <SearchBar q={q} setQ={setQ} t={t} FONTS={FONTS}/>
          {Body}
        </React.Fragment>
      )}
      {navVariant === 'pager' && (
        <React.Fragment>
          <ChipBar active={bucket} onPick={setBucket} t={t} FONTS={FONTS}/>
          {Body}
        </React.Fragment>
      )}
    </div>
  );
}

window.DebugPanel = DebugPanel;
