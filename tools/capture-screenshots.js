#!/usr/bin/env node
/**
 * Capture the README / docs screenshot set from a running Pi Weather Station.
 *
 * Why a script: the gallery has to be re-shot every time the layout moves, and
 * hand-cropped screen grabs drift — wrong viewport, wrong units, a panel caught
 * mid-load. This drives a headless Chrome over the DevTools protocol, so every
 * frame is the real app at an exact viewport, positioned by an actual map tap,
 * with the language and unit preferences pinned.
 *
 * It also encodes three things that are easy to get wrong by hand:
 *
 *   1. **A readiness gate.** The app paints its shell long before the weather,
 *      reverse geocode, air quality and radar analysis land. Captured too early
 *      you get raw coordinates in the hero, `—` in the AQI card and
 *      "Cannot get 24 hour weather forecast". Every frame waits for real data
 *      and shouts REVIEW THIS FRAME if it gave up waiting.
 *   2. **Deterministic preferences.** Scenario toggles (nightRed, timeline,
 *      legend…) are written to localStorage, so a base set is re-applied on
 *      every boot — otherwise the palette a previous scenario turned on leaks
 *      into the next capture.
 *   3. **A privacy rule.** The debug panel's SERVER bucket prints the host name
 *      and the machine's LAN addresses. The `debug-services` scenario closes it
 *      and opens SERVICES instead. Never publish a frame showing SERVER.
 *
 * Prerequisites: Google Chrome installed, and the station running (the launchd
 * agent on macOS, `pi-weather-server` on Linux). Node 22+ for built-in fetch
 * and WebSocket — no dependencies.
 *
 * Usage:
 *   node tools/capture-screenshots.js                 all scenarios
 *   node tools/capture-screenshots.js pi7-day hero    just these
 *   node tools/capture-screenshots.js --list          names + viewports
 *   node tools/capture-screenshots.js --webp          also emit optimised WebP
 *   node tools/capture-screenshots.js --lat 29.85 --lon -94.89
 *   node tools/capture-screenshots.js --out /tmp/shots --url https://localhost:8443/
 *
 * Picking a location: the gallery is worth far more over live severe weather
 * than over a calm afternoon. Find a point that has both an active government
 * alert and echoes inside the analysis ring, then pass it with --lat/--lon:
 *
 *   curl -sk "https://localhost:8443/api/weather-alerts?lat=LAT&lon=LON"
 *   curl -sk "https://localhost:8443/api/radar-risk?lat=LAT&lon=LON&distanceUnit=mi"
 *
 * Shoot every frame at one location in one session — a gallery where each
 * layout shows different weather cannot be compared.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn, spawnSync } = require("child_process");

const CDP_PORT = 9333;
const DEFAULT_URL = "https://localhost:8443/";
// Mont Belvieu, TX — the August 2026 gallery: NWS Tropical Storm Warning plus
// intensity-5 echoes inside the 30 mi ring. Override with --lat / --lon.
const DEFAULT_LAT = 29.85;
const DEFAULT_LON = -94.89;
const DEFAULT_ZOOM = 9;
const DEFAULT_OUT = path.resolve(__dirname, "..", "docs", "screenshots");

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

/**
 * Preferences forced on every boot. Everything a scenario can toggle appears
 * here explicitly so a previous scenario's state cannot leak into the next one.
 */
const BASE_PREFS = {
  i18nextLng: "en",
  tempUnit: "f", speedUnit: "mph", lengthUnit: "in", distanceUnit: "mi",
  pressureUnit: "hpa", clockTime: "12", fontSize: "m",
  systemPrefsSeeded_v1: "true",
  darkMode: "true", sleepNightMode: "false",
  radarTimelineVisible: "false", hideRadarLegend: "false",
  showDirectionArrows: "false", showWeatherAlerts: "false",
  aiSummaryUserVisible: "true", markerIsVisible: "true", showAlertRing: "true",
};

const DAY = { darkMode: "false" };

/**
 * One entry per published frame. `file` is the basename written to --out.
 *
 * dsf: device scale factor. 2 on the small viewports (the kiosk panels are
 * physically small, so the published image needs the extra pixels), but 1 at
 * 1920×1080 — a 3840×2160 capture reliably kills the headless renderer, and
 * 1920 native is already twice GitHub's README column.
 *
 * The kiosk and phone scenarios hide the radar legend: on those short
 * viewports it sits directly on top of the storm cells, and it has its own
 * place in the layout the wide frames already show.
 *
 * steps: elements to click before capturing, matched against
 * `aria-label|title|innerText`. Anchor on `||Label$` to hit an element whose
 * only identity is its text (the chart tabs, the debug buckets).
 */
const SCENARIOS = [
  { name: "hero",         file: "v3-desktop-day",     w: 1920, h: 1080, dsf: 1, prefs: DAY,
    // Hold until the Claude summary has produced its radar-movement paragraph:
    // it arrives well after the prose and is a documented feature of its own.
    waitText: "Radar analysis" },
  { name: "desktop-dusk", file: "v3-desktop-dusk",    w: 1920, h: 1080, dsf: 1, prefs: {} },
  { name: "pi7-day",      file: "v3-pi7-day",         w: 800,  h: 480,  dsf: 2,
    prefs: { ...DAY, hideRadarLegend: "true" } },
  { name: "pi7-nightred", file: "v3-pi7-nightred",    w: 800,  h: 480,  dsf: 2,
    prefs: { sleepNightMode: "true", hideRadarLegend: "true" } },
  { name: "pi10-day",     file: "v3-pi10-day",        w: 1024, h: 600,  dsf: 2,
    prefs: { ...DAY, hideRadarLegend: "true" } },
  { name: "phone",        file: "v3-phone-radar",     w: 390,  h: 844,  dsf: 3,
    prefs: { ...DAY, hideRadarLegend: "true" },
    // Frame the mini radar card rather than the top of the column, which on a
    // day with several alerts is nothing but alert cards.
    js: `(() => { const m = document.querySelector('.leaflet-container');
          if (!m) return false; m.scrollIntoView({ block: 'center' }); return true; })()` },

  { name: "alert-detail", file: "v3-alert-detail",    w: 1920, h: 1080, dsf: 1, prefs: DAY,
    steps: ["/Tap to read detail|read detail/i"] },
  { name: "alert-qr",     file: "v3-alert-qr",        w: 1920, h: 1080, dsf: 1, prefs: DAY,
    steps: ["/Tap to read detail|read detail/i"],
    js: `(() => { const w = Array.from(document.querySelectorAll('div'))
            .find(d => /qr/i.test(typeof d.className === 'string' ? d.className : ''));
          if (!w) return false; w.scrollIntoView({ block: 'center' }); return true; })()` },
  { name: "alerts-overlay", file: "v3-alerts-overlay", w: 1920, h: 1080, dsf: 1, prefs: DAY,
    steps: ["/Show nearby alerts/i"] },
  { name: "timeline",     file: "v3-radar-timeline",  w: 1920, h: 1080, dsf: 1,
    prefs: { radarTimelineVisible: "true" } },
  { name: "forecast-max", file: "v3-forecast-max",    w: 1024, h: 600,  dsf: 2,
    prefs: { ...DAY, hideRadarLegend: "true" },
    steps: ["/Open forecast/i", "/\\|\\|Precip$/"] },
  { name: "places",       file: "v3-places",          w: 1024, h: 600,  dsf: 2,
    prefs: { ...DAY, hideRadarLegend: "true" }, steps: ["/Open places/i"] },
  { name: "places-edit",  file: "v3-places-edit",     w: 1920, h: 1080, dsf: 1, prefs: DAY,
    steps: ["/Open places/i", "/\\|\\|Edit$/"] },
  { name: "settings",     file: "v3-settings",        w: 1024, h: 600,  dsf: 2,
    prefs: { ...DAY, hideRadarLegend: "true" }, steps: ["/Open settings/i"] },
  // SERVER is opened first only to close it: it is the default bucket, and it
  // prints the host name and both LAN addresses of the machine. Publish the
  // services bucket alone.
  { name: "debug-services", file: "v3-debug-services", w: 1920, h: 1080, dsf: 1, prefs: {},
    steps: ["/Open debug panel/i", "/\\|\\|SERVER$/", "/\\|\\|SERVICES$/"] },
];

/**
 * Walk the React fiber behind the Leaflet container to reach the live map
 * instance. react-leaflet keeps it in a hook, not on the DOM node, and the app
 * exposes no handle — this is the only way in from the outside. Cached on
 * `window.__pwsMap`.
 */
const FIND_MAP = `
(() => {
  if (window.__pwsMap && typeof window.__pwsMap.setView === 'function') return true;
  const el = document.querySelector('.leaflet-container');
  if (!el) return false;
  const fk = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
  if (!fk) return false;
  const isMap = (o) => o && typeof o === 'object'
    && typeof o.setView === 'function' && typeof o.getCenter === 'function';
  let f = el[fk], hops = 0;
  while (f && hops++ < 40) {
    let hook = f.memoizedState, i = 0;
    while (hook && i++ < 30) {
      const ms = hook.memoizedState;
      if (isMap(ms)) { window.__pwsMap = ms; return true; }
      if (ms && typeof ms === 'object') {
        for (const k of Object.keys(ms).slice(0, 12)) {
          if (isMap(ms[k])) { window.__pwsMap = ms[k]; return true; }
        }
      }
      hook = hook.next;
    }
    f = f.return;
  }
  return false;
})()`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ CDP --- */

/**
 * Open a DevTools session against the browser's first page target.
 *
 * @returns {Promise<{send: Function}>} `send(method, params)` → result
 */
async function connect() {
  const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json();
  const page = list.find((t) => t.type === "page");
  if (!page) throw new Error("no page target — is Chrome up?");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0;
  const pending = new Map();
  ws.onclose = () => {
    for (const { rej } of pending.values()) rej(new Error("CDP socket closed"));
    pending.clear();
  };
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (!msg.id || !pending.has(msg.id)) return;
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) rej(new Error(JSON.stringify(msg.error)));
    else res(msg.result);
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  return { send, ws };
}

/**
 * Evaluate an expression in the page and return its value.
 *
 * @param {Function} send CDP sender
 * @param {String} expr JavaScript expression
 * @returns {Promise<*>} the value, serialised by value
 */
async function evaluate(send, expr) {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
  if (r.exceptionDetails) {
    throw new Error("eval: " + (r.exceptionDetails.exception?.description || "failed"));
  }
  return r.result?.value;
}

/**
 * Poll an expression until it returns truthy.
 *
 * @param {Function} send CDP sender
 * @param {String} expr expression to poll
 * @param {object} opts tries / delay / label
 * @returns {Promise<Boolean>} true once satisfied
 */
async function waitFor(send, expr, { tries = 60, delay = 500, label = "condition" } = {}) {
  for (let i = 0; i < tries; i++) {
    try { if (await evaluate(send, expr)) return true; } catch { /* page navigating */ }
    await sleep(delay);
  }
  throw new Error("timeout waiting for: " + label);
}

/**
 * Click the first element matching `re` against `aria-label|title|innerText`.
 * The dock's controls are plain `<div onClick>` with an aria-label, so the
 * selector cannot be limited to `<button>`.
 *
 * @param {Function} send CDP sender
 * @param {String} re regex literal, as source text
 * @returns {Promise<Boolean>} true if something was clicked
 */
function click(send, re) {
  return evaluate(send, `(() => {
    const re = ${re};
    const els = Array.from(document.querySelectorAll('button,a,[role=button],[aria-label],[title]'));
    const hit = els.find((b) => re.test(
      (b.getAttribute('aria-label') || '') + '|' +
      (b.getAttribute('title') || '') + '|' + (b.innerText || '')));
    if (!hit) return false;
    hit.scrollIntoView({ block: 'center' });
    hit.click();
    return true;
  })()`);
}

/* -------------------------------------------------------------- capture --- */

/**
 * Boot the app in a known state and park it over the target coordinates.
 *
 * @param {object} cfg run configuration (url, lat, lon, zoom)
 * @param {object} sc the scenario being captured
 * @returns {Promise<{send: Function, degraded: Boolean}>} session + data flag
 */
async function boot(cfg, sc) {
  const { send } = await connect();
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Security.enable");
  await send("Security.setIgnoreCertificateErrors", { ignore: true });
  await send("Emulation.setDeviceMetricsOverride", {
    width: sc.w, height: sc.h, deviceScaleFactor: sc.dsf,
    mobile: sc.w < 800, screenWidth: sc.w, screenHeight: sc.h,
  });
  await send("Emulation.setTouchEmulationEnabled", {
    enabled: sc.w < 800, maxTouchPoints: sc.w < 800 ? 5 : 1,
  });

  await send("Page.navigate", { url: cfg.url });
  await sleep(3000);
  const prefs = { ...BASE_PREFS, ...(sc.prefs || {}) };
  const writes = Object.entries(prefs)
    .map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`)
    .join("");
  await evaluate(send, `(()=>{${writes}return true})()`);
  await send("Page.reload");
  await sleep(4000);

  await waitFor(send, `!!document.querySelector('.leaflet-container')`, { label: "map container" });
  await waitFor(send, FIND_MAP, { label: "leaflet map instance" });

  // Hand the point to the app the way a user does — a map tap. Retried: the
  // first tap can land before React has wired the handler, and the app then
  // silently stays on its boot location.
  // Two signals that the tap took, because either one alone is unreliable:
  // the hero shows raw coordinates only until the reverse geocode lands (and
  // not at all if it was already cached), and the place name is unknown ahead
  // of time — so also watch the hero's location line for *any* change. A
  // marker on the map is NOT a signal: there is one at the boot location too.
  const HERO_LOC = `(() => { const e = Array.from(document.querySelectorAll('[aria-label]'))
    .find((n) => n.getAttribute('aria-label') === 'Location');
    return e ? e.innerText.trim() : document.body.innerText.slice(0, 200); })()`;
  const shown = `document.body.innerText.indexOf("${cfg.lat}, ${cfg.lon}") !== -1`;
  const before = await evaluate(send, HERO_LOC);
  let placed = false;
  for (let attempt = 1; attempt <= 4 && !placed; attempt++) {
    await evaluate(send, FIND_MAP);
    await evaluate(send, `(()=>{window.__pwsMap.setView([${cfg.lat},${cfg.lon}],${cfg.zoom});return true})()`);
    await sleep(1200);
    await evaluate(send, `(()=>{window.__pwsMap.fire('click',{latlng:{lat:${cfg.lat},lng:${cfg.lon}}});return true})()`);
    for (let i = 0; i < 10 && !placed; i++) {
      await sleep(700);
      placed = await evaluate(send, shown)
        || (await evaluate(send, HERO_LOC)) !== before;
    }
    if (!placed) console.log(`  · tap ${attempt} did not take, retrying`);
  }
  if (!placed) throw new Error("the map never accepted the target position");
  await sleep(4000);

  // Hard gate: a resolved place name and a temperature. Soft gate: the slower
  // cards. A frame that fails the hard gate still gets written, loudly flagged
  // — an obviously broken frame is more useful than a silent gap in the set.
  let degraded = false;
  try {
    await waitFor(send, `(() => { const t = document.body.innerText;
      return /°F/.test(t) && t.indexOf("${cfg.lat}, ${cfg.lon}") === -1; })()`,
    { tries: 40, delay: 1000, label: "hero data" });
  } catch { degraded = true; }
  for (let i = 0; i < 20; i++) {
    const ok = await evaluate(send, `(() => { const t = document.body.innerText;
      return !/—\\s*AQI/.test(t) && !/Cannot get/.test(t); })()`);
    if (ok) break;
    await sleep(1000);
  }
  return { send, degraded };
}

/**
 * Run one scenario end to end and write its PNG.
 *
 * @param {object} cfg run configuration
 * @param {object} sc the scenario
 * @returns {Promise<Boolean>} true if the frame looks trustworthy
 */
async function capture(cfg, sc) {
  process.stdout.write(`\n[${sc.name}] ${sc.w}x${sc.h} @${sc.dsf}x\n`);
  const { send, degraded } = await boot(cfg, sc);
  if (degraded) console.log("  !! data never loaded — REVIEW THIS FRAME");

  for (const re of sc.steps || []) {
    const ok = await click(send, re);
    console.log(ok ? `  · clicked ${re}` : `  !! nothing matched ${re}`);
    await sleep(2500);
  }
  if (sc.waitText) {
    try {
      await waitFor(send, `document.body.innerText.indexOf(${JSON.stringify(sc.waitText)}) !== -1`,
        { tries: 60, delay: 2000, label: sc.waitText });
      console.log(`  · saw "${sc.waitText}"`);
    } catch { console.log(`  !! never saw "${sc.waitText}" — REVIEW THIS FRAME`); }
  }
  if (sc.js) { await evaluate(send, sc.js); await sleep(1200); }
  await sleep(1500);

  const out = path.join(cfg.out, sc.file + ".png");
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.writeFileSync(out, Buffer.from(shot.data, "base64"));
  console.log(`  → ${out} (${Math.round(fs.statSync(out).size / 1024)} KB)`);
  return !degraded;
}

/* ------------------------------------------------------------- plumbing --- */

/**
 * Start a throwaway headless Chrome with remote debugging open.
 *
 * @returns {Promise<object>} the child process
 */
async function launchChrome() {
  const bin = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (!bin) throw new Error("no Chrome found — install it or run with --attach");
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "pws-shots-"));
  const child = spawn(bin, [
    "--headless=new", `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    "--ignore-certificate-errors", "--allow-insecure-localhost",
    "--lang=en-US", "--no-first-run", "--no-default-browser-check",
    "--hide-scrollbars", "--window-size=1920,1080", "about:blank",
  ], { stdio: "ignore", detached: false });
  for (let i = 0; i < 20; i++) {
    try {
      await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      return child;
    } catch { await sleep(500); }
  }
  child.kill();
  throw new Error("Chrome did not open its debugging port");
}

/**
 * Shrink to README width and re-encode as WebP. The whole set lands around
 * 2.4 MB this way, against ~15 MB of PNG.
 *
 * @param {String} dir directory holding the captured PNGs
 * @param {Array} scenarios the scenarios that were captured
 * @returns {void}
 */
function toWebp(dir, scenarios) {
  if (!spawnSync("cwebp", ["-version"]).stdout) {
    console.log("\ncwebp not found — skipping WebP (brew install webp)");
    return;
  }
  console.log("");
  for (const sc of scenarios) {
    const png = path.join(dir, sc.file + ".png");
    if (!fs.existsSync(png)) continue;
    const webp = path.join(dir, sc.file + ".webp");
    const width = sc.w < 800 ? 780 : 1600;
    spawnSync("cwebp", ["-resize", String(width), "0", "-q", "85", "-quiet", png, "-o", webp]);
    fs.unlinkSync(png);
    console.log(`  → ${webp} (${Math.round(fs.statSync(webp).size / 1024)} KB)`);
  }
}

/**
 * Parse argv into a run configuration plus the scenario selection.
 *
 * @returns {object} cfg and the scenarios to run
 */
function parseArgs() {
  const argv = process.argv.slice(2);
  const cfg = {
    url: DEFAULT_URL, lat: DEFAULT_LAT, lon: DEFAULT_LON,
    zoom: DEFAULT_ZOOM, out: DEFAULT_OUT, webp: false, attach: false,
  };
  const names = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--webp") cfg.webp = true;
    else if (a === "--attach") cfg.attach = true;
    else if (a === "--list") cfg.list = true;
    else if (a === "--url") cfg.url = argv[++i];
    else if (a === "--out") cfg.out = path.resolve(argv[++i]);
    else if (a === "--lat") cfg.lat = parseFloat(argv[++i]);
    else if (a === "--lon") cfg.lon = parseFloat(argv[++i]);
    else if (a === "--zoom") cfg.zoom = parseInt(argv[++i], 10);
    else if (a.startsWith("--")) throw new Error("unknown flag " + a);
    else names.push(a);
  }
  const chosen = names.length
    ? names.map((n) => {
      const sc = SCENARIOS.find((s) => s.name === n);
      if (!sc) throw new Error(`unknown scenario "${n}" — try --list`);
      return sc;
    })
    : SCENARIOS;
  return { cfg, chosen };
}

(async () => {
  const { cfg, chosen } = parseArgs();
  if (cfg.list) {
    for (const s of SCENARIOS) {
      console.log(`  ${s.name.padEnd(16)} ${String(s.w).padStart(4)}x${String(s.h).padEnd(4)}  → ${s.file}`);
    }
    return;
  }
  fs.mkdirSync(cfg.out, { recursive: true });
  console.log(`station ${cfg.url} · point ${cfg.lat}, ${cfg.lon} · out ${cfg.out}`);

  const chrome = cfg.attach ? null : await launchChrome();
  const suspect = [];
  try {
    for (const sc of chosen) {
      try {
        if (!await capture(cfg, sc)) suspect.push(sc.name);
      } catch (e) {
        console.log(`  !! ${sc.name} failed: ${e.message}`);
        suspect.push(sc.name);
      }
    }
  } finally {
    if (chrome) chrome.kill();
  }

  if (cfg.webp) toWebp(cfg.out, chosen);
  console.log(suspect.length
    ? `\nReview before publishing: ${suspect.join(", ")}`
    : `\n${chosen.length} frame(s) captured.`);
  console.log("Look at every frame. A frame can be technically valid and still "
    + "show a placeholder, a stale reading, or a panel caught mid-animation.");
})().catch((e) => { console.error("\nFAILED: " + e.message); process.exit(1); });
