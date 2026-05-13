// Mock data for Settings + Debug panels.
// All values plausible; edge cases (quota near limit, security event,
// stale provider, all-empty-keys) are exposed as named scenarios so the
// canvas can render each side-by-side.

const ADMIN = (() => {
  // ─── PROVIDERS ────────────────────────────────────────────────────
  // The 6 API key providers, in display order, with a one-line "what it
  // unlocks" copy. Used by every API-key variant.
  const PROVIDERS = [
    { id: 'mapbox',     name: 'Mapbox',      tier: 'required', group: 'map',     unlocks: 'Map tiles + dark/light styles' },
    { id: 'tomorrow',   name: 'Tomorrow.io', tier: 'required', group: 'weather', unlocks: 'Hourly + daily forecast data' },
    { id: 'locationiq', name: 'LocationIQ',  tier: 'optional', group: 'map',     unlocks: 'Reverse geocoding · place name lookup' },
    { id: 'anthropic',  name: 'Anthropic',   tier: 'optional', group: 'ai',      unlocks: 'AI weather summary (Claude Haiku)' },
    { id: 'airnow',     name: 'EPA AirNow',  tier: 'optional', group: 'air',     unlocks: 'US air-quality index (AQI)' },
    { id: 'openaq',     name: 'OpenAQ',      tier: 'optional', group: 'air',     unlocks: 'Global air-quality fallback' },
  ];

  // ─── SETTINGS SCENARIOS ───────────────────────────────────────────
  // Each scenario describes a deployment moment we want to render:
  // 'configured' all 6 keys set, 'partial' just required ones, 'empty'
  // first-boot install, 'remote' SSH-tunnelled read-only access.
  function makeKeys(scenario) {
    if (scenario === 'empty') {
      return Object.fromEntries(PROVIDERS.map(p => [p.id, { value: '', status: 'empty' }]));
    }
    if (scenario === 'partial') {
      return {
        mapbox:     { value: 'pk.eyJ1Ijoid3hzdGF0aW9uIiwiYSI6ImNsM3lqOTIzNDU2N3'.slice(0, 38), status: 'configured' },
        tomorrow:   { value: 'tmr_8a93cf2e5be7c411d62a9a8b3f7e1c2d',                          status: 'configured' },
        locationiq: { value: '', status: 'empty' },
        anthropic:  { value: '', status: 'empty' },
        airnow:     { value: '', status: 'empty' },
        openaq:     { value: '', status: 'empty' },
      };
    }
    // 'configured' (default): all 6 set, but anthropic flagged invalid
    return {
      mapbox:     { value: 'pk.eyJ1Ijoid3hzdGF0aW9uIiwiYSI6ImNsM3lqOTIzNDU2N3'.slice(0, 38), status: 'configured' },
      tomorrow:   { value: 'tmr_8a93cf2e5be7c411d62a9a8b3f7e1c2d',                          status: 'configured' },
      locationiq: { value: 'pk.78ab3c12d9e4f5a6b7c8d9e0f1a2b3c4',                           status: 'configured' },
      anthropic:  { value: 'sk-ant-api03-OLD-rotate-pending-quota',                          status: 'invalid' },
      airnow:     { value: 'A1B2C3D4-E5F6-7890-ABCD-EF1234567890',                          status: 'configured' },
      openaq:     { value: 'oaq_7f8e9d0c1b2a3948576a4b3c2d1e0f00',                          status: 'configured' },
    };
  }

  const SETTINGS = {
    coords: { lat: 45.97, lon: -74.32, source: 'manual' },
    radarSource: 'rainviewer',
    homebridge: { host: '192.168.1.42', port: 51826, username: 'pi-weather', sensorName: 'Living Room', connected: true },
    brightness: 78,
    advanced: {
      mapStyle: { light: 'mapbox/light-v11', dark: 'mapbox/dark-v11' },
      defaultZoom: 9,
      ai: { calmDayFastPath: true, extendedRadius: true, radarAnalysisEnabled: true, showSamplingPoints: false },
      sleep: { stage1Delay: 10, stage1Brightness: 30, stage2Enabled: true, stage2Delay: 20 },
    },
    experimental: {
      // Empty for now — but design the empty state.
      // 'experimentalUiC' will be the next flag added.
      flags: [],
    },
    prefs: {
      lang: 'fr', fontSize: 'M', darkMode: 'auto', clock: '24',
      units: { temp: 'C', speed: 'kph', length: 'mm', distance: 'km' },
      hideMouse: true, hideRadarLegend: false,
    },
  };

  // ─── DEBUG SCENARIOS ──────────────────────────────────────────────
  // 'healthy' all green, 'quota-near' AirNow approaching daily cap,
  // 'security' a blocked remote-write attempt, 'stale' a provider's
  // statuspage hasn't been checked in 2h.
  function makeDebug(scenario) {
    const baseQuota = [
      { service: 'mapbox',     endpoint: '/styles/v1/*',     hour: { used: 142, cap: 500 },    day: { used: 1840,   cap: 50000 } },
      { service: 'tomorrow',   endpoint: '/v4/timelines',     hour: { used: 38,  cap: 100 },    day: { used: 612,    cap: 2500 } },
      { service: 'locationiq', endpoint: '/v1/reverse',       hour: { used: 4,   cap: 60 },     day: { used: 78,     cap: 5000 } },
      { service: 'anthropic',  endpoint: 'messages',          hour: { used: 12,  cap: 50 },     day: { used: 218,    cap: 1000 } },
      { service: 'airnow',     endpoint: '/aq/observation',   hour: { used: 18,  cap: 25 },     day: { used: 89,     cap: 500 } },
      { service: 'openaq',     endpoint: '/v2/latest',        hour: { used: 0,   cap: 100 },    day: { used: 12,     cap: 10000 } },
      { service: 'rainviewer', endpoint: '/public/maps',      hour: { used: 86,  cap: 9999 },   day: { used: 1240,   cap: 99999 } },
    ];
    const quota = scenario === 'quota-near'
      ? baseQuota.map(q => q.service === 'airnow' ? { ...q, hour: { used: 24, cap: 25 }, day: { used: 472, cap: 500 } } : q)
      : baseQuota;

    const providers = [
      { id: 'mapbox',     status: 'operational', lastChecked: '2 min ago', uptime: '99.98%' },
      { id: 'tomorrow',   status: 'operational', lastChecked: '2 min ago', uptime: '99.91%' },
      { id: 'locationiq', status: 'operational', lastChecked: '2 min ago', uptime: '99.85%' },
      { id: 'anthropic',  status: scenario === 'stale' ? 'unknown' : 'operational', lastChecked: scenario === 'stale' ? '2 h 14 min ago' : '2 min ago', uptime: '99.96%' },
      { id: 'airnow',     status: 'operational', lastChecked: '2 min ago', uptime: '99.42%' },
      { id: 'rainviewer', status: 'degraded',    lastChecked: '2 min ago', uptime: '97.20%' },
    ];

    const security = scenario === 'security' ? [
      { ts: '14:02:17', ip: '10.0.4.82', method: 'POST', path: '/api/settings', reason: 'Remote write attempt blocked', count: 3 },
      { ts: '11:47:03', ip: '10.0.4.82', method: 'POST', path: '/api/brightness', reason: 'Remote write attempt blocked', count: 1 },
    ] : [];

    const services = [
      { name: 'Mapbox tiles',     last: '200 OK',  ms: 142, ts: '14:03:21' },
      { name: 'Tomorrow.io forecast', last: '200 OK', ms: 218, ts: '14:03:18' },
      { name: 'LocationIQ reverse',   last: '200 OK', ms: 96,  ts: '14:00:45' },
      { name: 'Anthropic messages',   last: scenario === 'quota-near' ? '429 Too Many' : '200 OK', ms: 1842, ts: '14:02:52' },
      { name: 'AirNow obs',           last: scenario === 'quota-near' ? '429 Too Many' : '200 OK', ms: 312, ts: '14:03:09' },
      { name: 'OpenAQ latest',        last: '200 OK', ms: 488, ts: '14:01:33' },
      { name: 'RainViewer maps',      last: '503 Unavailable', ms: 4980, ts: '14:02:01' },
    ];

    const cache = [
      { key: 'mapbox-style-light',       ttl: '8h 12m', sizeKb: 412 },
      { key: 'tomorrow-forecast-45.97,-74.32', ttl: '12m', sizeKb: 28 },
      { key: 'locationiq-reverse-45.97,-74.32', ttl: '23h 04m', sizeKb: 1 },
      { key: 'rainviewer-snapshot-current', ttl: '4m 22s', sizeKb: 144 },
      { key: 'ai-summary-2026-05-12-14', ttl: '46m', sizeKb: 3 },
    ];

    const remoteClients = [
      { ip: '10.0.4.82', firstSeen: '2026-05-11 08:14', lastSeen: '14:03', requests: 247, ua: 'Mac · Chrome 124' },
      { ip: '10.0.4.193', firstSeen: '2026-05-12 13:20', lastSeen: '13:52', requests: 18, ua: 'iOS · Safari 17' },
    ];

    const snapshots = [
      { id: 's-1747058512', ts: '14:01:52', scenario: 'rain band W → E', sizeKb: 84, summary: 'Active band 35 km/h ENE …' },
      { id: 's-1747058212', ts: '13:56:52', scenario: 'rain band W → E', sizeKb: 81, summary: 'Pre-band clearing …' },
      { id: 's-1747057912', ts: '13:51:52', scenario: 'rain band W → E', sizeKb: 77, summary: 'Approaching from W …' },
      { id: 's-1747057612', ts: '13:46:52', scenario: 'calm',            sizeKb: 62, summary: 'Calm interval …' },
    ];

    const logs = [
      { ts: '14:03:21.482', level: 'info',  msg: '[mapbox] tile fetched 256,128 z=9 (cache miss)' },
      { ts: '14:03:18.221', level: 'info',  msg: '[tomorrow] forecast OK · 142 hours · 6 fields' },
      { ts: '14:03:09.045', level: 'warn',  msg: '[airnow] daily quota at 94% (472/500)' },
      { ts: '14:02:52.118', level: 'info',  msg: '[anthropic] summary generated · 218 tokens out · 1842ms' },
      { ts: '14:02:17.003', level: 'error', msg: '[security] POST /api/settings from 10.0.4.82 BLOCKED (remote write)' },
      { ts: '14:02:01.992', level: 'warn',  msg: '[rainviewer] 503 from /public/maps — retry in 30s' },
      { ts: '14:01:52.310', level: 'info',  msg: '[radar] snapshot s-1747058512 stored (84 KB)' },
      { ts: '14:00:45.207', level: 'info',  msg: '[locationiq] reverse 45.97,-74.32 → Saint-Adolphe-d\'Howard' },
      { ts: '13:58:14.881', level: 'info',  msg: '[cache] evicted 3 entries, 412 KB freed' },
      { ts: '13:56:52.062', level: 'info',  msg: '[radar] snapshot s-1747058212 stored (81 KB)' },
    ];

    return {
      server: {
        version: '2.13.1', commit: '4a2f8e9', branch: 'main',
        os: 'Raspbian 12 (bookworm) · aarch64',
        hostname: 'pi-weather-01',
        ip: '192.168.1.108',
        ports: { http: 8080, https: 8443 },
        flags: { DEBUG: true, ALLOW_REMOTE: true },
        settingsPath: '/home/pi/pi-weather-station/settings.json',
        deployArtefactsChanged: false,
      },
      serverKpi: {
        uptime: '4 d 12 h 38 m',
        heap: { used: 142, total: 256, rss: 198 },
        cache: { hits: 8412, misses: 412, hitRate: 95.3 },
        cpuTemp: 52.4,
        fanRpm: 2240,
        responses: [
          { endpoint: '/api/forecast', avgMs: 38, p95Ms: 89 },
          { endpoint: '/api/radar', avgMs: 124, p95Ms: 312 },
          { endpoint: '/api/summary', avgMs: 1840, p95Ms: 4200 },
        ],
      },
      clientKpi: {
        loadMs: 1284, fps: 58, jsHeapMb: 38,
        apiCalls: [
          { endpoint: '/api/forecast', count: 142, avgMs: 41, minMs: 28, maxMs: 124 },
          { endpoint: '/api/radar',    count: 86,  avgMs: 132, minMs: 88, maxMs: 412 },
          { endpoint: '/api/summary',  count: 12,  avgMs: 1842, minMs: 920, maxMs: 4080 },
        ],
      },
      providers, services, quota, cache, remoteClients, security, snapshots, logs,
      network: {
        urls: ['http://192.168.1.108:8080', 'https://192.168.1.108:8443'],
        online: true,
      },
    };
  }

  return { PROVIDERS, makeKeys, makeDebug, SETTINGS };
})();

window.ADMIN = ADMIN;
