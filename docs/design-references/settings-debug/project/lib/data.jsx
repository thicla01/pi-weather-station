// Mock weather data + helpers shared across all three directions.
// Pick a scenario via getScenario(name): 'calm', 'rain', 'severe'.
//
// Each scenario now carries:
//  - alerts[]: array of alerts (multi-alert support). May be empty.
//  - now.confidence: 0–100, drives the [RADAR] confidence chip
//  - radarMotion: { dirDeg, speedKph, descriptor } for direction arrows
//  - indoor: { temp, humidity, aqi, status } from Homebridge
//  - brightness: percent (for the brightness slider in settings)

const BUCKET = (pct) => pct >= 70 ? 'high' : pct >= 40 ? 'med' : 'low';

const SCENARIOS = {
  calm: {
    location: 'Saint-Adolphe-d\'Howard, QC',
    coord: '45.97°N · 74.32°W',
    indoor: { temp: 21, humidity: 41, aqi: 12, status: 'comfortable' },
    brightness: 78,
    now: {
      temp: 12, feels: 11, desc: 'Mostly clear', icon: 'sun',
      humidity: 56, windKph: 8, windDir: 220,
      precipMm: 0, precipProb: 5, uv: 0, aqi: 28,
      pressure: 1019, pressureTrend: 'rising', cloud: 12, visibility: 24,
      confidence: 92,
    },
    radarMotion: { dirDeg: 220, speedKph: 12, descriptor: 'SW → drift' },
    sun: { rise: '05:12', set: '20:24', dayProgress: 0.74 },
    alerts: [],
    aiSummary: {
      headline: 'Calm spring evening. No precipitation expected next 48 h.',
      paragraphs: [
        'A weak Bermuda high keeps southern Québec under settled westerly flow. Skies stay mostly clear through overnight, with a shallow inversion forming near sunrise.',
        'Overnight low near 6 °C. UV drops to 0 after 19:00. Wind backs slowly to the south by morning, staying under 12 km/h.',
        'Confidence high (92 %) — ECCC GEM and NWS GFS agree on dry conditions through Tuesday. Next rain window opens Wed evening as a warm front approaches from the SW.',
      ],
      confidence: 92,
      lastUpdated: '14:02',
    },
    radar: 'clear',
    hourly: [12, 11, 11, 10, 9, 8, 8, 7, 7, 6, 6, 6, 7, 9, 12, 15, 17, 18, 18, 17, 16, 14, 13, 12],
    hourlyPrecip: new Array(24).fill(0),
    daily: [
      { d: 'Fri', hi: 18, lo: 6, icon: 'sun', precip: 5 },
      { d: 'Sat', hi: 21, lo: 9, icon: 'sun', precip: 10 },
      { d: 'Sun', hi: 22, lo: 11, icon: 'pcloudy', precip: 20 },
      { d: 'Mon', hi: 19, lo: 12, icon: 'cloudy', precip: 40 },
      { d: 'Tue', hi: 16, lo: 9, icon: 'rain', precip: 70 },
    ],
  },
  rain: {
    location: 'Rivière-Nouvelle, QC',
    coord: '48.06°N · 66.30°W',
    indoor: { temp: 19, humidity: 52, aqi: 18, status: 'good' },
    brightness: 65,
    now: {
      temp: 7, feels: 4, desc: 'Heavy rain', icon: 'rain',
      humidity: 98, windKph: 22, windDir: 65,
      precipMm: 8.4, precipProb: 99, uv: 0, aqi: 14,
      pressure: 998, pressureTrend: 'falling', cloud: 100, visibility: 3,
      confidence: 78,
    },
    radarMotion: { dirDeg: 65, speedKph: 35, descriptor: 'ENE @ 35 kph' },
    sun: { rise: '04:49', set: '19:53', dayProgress: 0.42 },
    alerts: [
      { tier: 'amber', level: 'watch', source: 'ECCC', confidence: 78,
        title: 'Heavy rainfall warning',
        detail: '20–40 mm expected over 6 hours. Localised flooding possible in low-lying areas. Watershed runoff elevated; small streams may swell rapidly.',
        expires: '22:00',
        qrUrl: 'https://meteo.gc.ca/index_f.html#alerttable' },
      { tier: 'amber', level: 'advisory', source: 'RADAR', confidence: 82,
        title: 'Active rain band approaching',
        detail: 'Centre passes overhead approximately 18:10. Wind picks up to 30 km/h gusts during passage.',
        expires: '19:00',
        qrUrl: 'https://meteo.gc.ca/index_f.html#alerttable' },
    ],
    aiSummary: {
      headline: 'Heavy rain band passing through next 90 min.',
      paragraphs: [
        'Active band moving ENE at 35 km/h. Centre passes overhead approximately 18:10, then weakens as it crosses the river. Pressure has dropped 6 hPa in the last 3 hours.',
        'Expect 25–35 mm total accumulation by 22:00. Gusts spike to 30 km/h during the passage; localised street flooding possible in low-lying areas.',
        'Confidence medium-high (78 %) — ECCC and NWS HRDPS agree on track but disagree on precipitation maximum. Watershed runoff already elevated from yesterday\u2019s system.',
      ],
      confidence: 78,
      lastUpdated: '17:48',
    },
    radar: 'rain',
    hourly: [7, 7, 8, 9, 10, 10, 9, 9, 8, 8, 8, 9, 10, 11, 11, 11, 10, 9, 9, 8, 8, 8, 7, 7],
    hourlyPrecip: [60,70,80,90,99,99,95,85,70,55,40,30,25,20,15,10,8,5,3,2,1,0,0,0],
    daily: [
      { d: 'Sun', hi: 11, lo: 7, icon: 'rain', precip: 95 },
      { d: 'Mon', hi: 13, lo: 6, icon: 'pcloudy', precip: 30 },
      { d: 'Tue', hi: 16, lo: 8, icon: 'pcloudy', precip: 20 },
      { d: 'Wed', hi: 18, lo: 10, icon: 'sun', precip: 10 },
      { d: 'Thu', hi: 20, lo: 12, icon: 'sun', precip: 5 },
    ],
  },
  severe: {
    location: 'Rivière-Nouvelle, QC',
    coord: '48.06°N · 66.30°W',
    indoor: { temp: 19, humidity: 54, aqi: 22, status: 'good' },
    brightness: 65,
    now: {
      temp: 7, feels: 3, desc: 'Severe thunderstorm', icon: 'storm',
      humidity: 96, windKph: 48, windDir: 220,
      precipMm: 22.1, precipProb: 100, uv: 0, aqi: 22,
      pressure: 988, pressureTrend: 'falling-fast', cloud: 100, visibility: 1.2,
      confidence: 92,
    },
    radarMotion: { dirDeg: 65, speedKph: 65, descriptor: 'ENE @ 65 kph' },
    sun: { rise: '04:49', set: '19:53', dayProgress: 0.51 },
    alerts: [
      { tier: 'red', level: 'warning', source: 'ECCC', confidence: 92,
        title: 'Severe storm — funnel cloud risk',
        detail: 'Take shelter immediately. Hail Ø 2 cm reported nearby. Frequent cloud-to-ground lightning. Damaging winds 60+ km/h with higher gusts. Stay away from windows.',
        expires: '14:30',
        qrUrl: 'https://meteo.gc.ca/index_f.html#alerttable' },
      { tier: 'red', level: 'warning', source: 'RADAR', confidence: 88,
        title: 'Local cell at red intensity',
        detail: 'Cell tracking ENE at 65 km/h, currently 12 km SW. Closest approach 13:48.',
        expires: '14:00',
        qrUrl: 'https://meteo.gc.ca/index_f.html#alerttable' },
      { tier: 'amber', level: 'advisory', source: 'ECCC', confidence: 71,
        title: 'Wind gust advisory',
        detail: 'Sustained gusts 60–80 km/h expected through 16:00. Secure loose outdoor objects.',
        expires: '16:00',
        qrUrl: 'https://meteo.gc.ca/index_f.html#alerttable' },
    ],
    aiSummary: {
      headline: 'Severe cell 12 km SW, closest approach 13:48. Take shelter.',
      paragraphs: [
        'Severe cell tracking ENE at 65 km/h, currently 12 km SW. Closest approach 13:48 with hail Ø 2 cm reported nearby. Frequent cloud-to-ground lightning along the leading edge.',
        'Damaging winds 60+ km/h with higher gusts. Indoor shelter strongly advised through 14:30 — stay away from windows and unplug sensitive electronics.',
        'Confidence high (92 %) — ECCC and RADAR signatures agree. Cell expected to weaken after 14:30 as it crosses the river and loses surface heating support.',
      ],
      confidence: 92,
      lastUpdated: '13:36',
    },
    radar: 'severe',
    hourly: [7, 8, 9, 10, 10, 11, 12, 12, 11, 10, 9, 9, 8, 8, 8, 8, 7, 7, 7, 7, 7, 7, 7, 7],
    hourlyPrecip: [40,60,85,95,99,98,90,75,55,40,25,15,8,5,3,2,1,1,0,0,0,0,0,0],
    daily: [
      { d: 'Sun', hi: 13, lo: 7, icon: 'storm', precip: 99 },
      { d: 'Mon', hi: 14, lo: 6, icon: 'rain', precip: 60 },
      { d: 'Tue', hi: 17, lo: 8, icon: 'pcloudy', precip: 25 },
      { d: 'Wed', hi: 20, lo: 11, icon: 'sun', precip: 5 },
      { d: 'Thu', hi: 22, lo: 12, icon: 'sun', precip: 5 },
    ],
  },
};

function getScenario(name) {
  const s = SCENARIOS[name] || SCENARIOS.calm;
  // Back-compat: synthesise `alert` (singular) from alerts[0] if present.
  return { ...s, alert: s.alerts && s.alerts[0] ? s.alerts[0] : null };
}

function windCardinal(deg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}

const cToF = (c) => Math.round(c * 9 / 5 + 32);

// Highest tier across active alerts. Drives hybrid-mode trigger.
function maxAlertTier(alerts) {
  if (!alerts || !alerts.length) return null;
  const order = { red: 3, amber: 2, yellow: 1 };
  return alerts.reduce((acc, a) => (order[a.tier] || 0) > (order[acc] || 0) ? a.tier : acc, null);
}

// Hybrid-mode trigger. Returns 'red' | 'amber' | null.
function hybridLevel(data) {
  const tier = maxAlertTier(data.alerts);
  if (tier === 'red') return 'red';
  if (tier === 'amber') return 'amber';
  if (data.radar === 'severe') return 'red';
  if (data.radar === 'rain' && data.now.confidence >= 70) return 'amber';
  return null;
}

function confidenceBucket(pct) { return BUCKET(pct); }

window.WX = { SCENARIOS, getScenario, windCardinal, cToF, maxAlertTier, hybridLevel, confidenceBucket };
