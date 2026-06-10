const fs = require("fs");
const path = require("path");

const COUNTS_FILE = path.join(__dirname, "request-counts.json");

// Quota limits per service/period (null = no limit tracked)
const QUOTAS = {
  "tomorrow.io": { hour: 25,   day: 500,  month: null  },
  "mapbox":      { hour: null, day: null, month: 50000 },
  "locationiq":  { hour: null, day: 5000, month: null  },
  "ipapi.co":    { hour: null, day: 1000, month: null  },
  "anthropic":   { hour: null, day: null, month: null  },
};

// In-memory counters: { service: { endpoint: { hourKey, hour, dayKey, day, monthKey, month } } }
let counters = {};

// Persistence is debounced. increment() runs on every external API call;
// writing the file there meant a synchronous fs.writeFileSync (an SD-card
// write that blocks the event loop) per call, which also amplified any
// request flood. Counters are a debug-panel quota metric, so a coalesced
// write at most once a minute — plus a flush on graceful shutdown (wired
// from index.js's shutdown handler) — is plenty. A SIGKILL / power loss can
// drop up to one interval of counts, the same trade-off proxyCtrl's cache
// already makes.
const FLUSH_INTERVAL_MS = 60 * 1000;
let dirty = false;

/**
 * Returns the current period keys
 */
function periodKeys() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const hourKey  = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}`;
  const dayKey   = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
  const monthKey = `${now.getFullYear()}-${pad(now.getMonth()+1)}`;
  return { hourKey, dayKey, monthKey };
}

/**
 * Load counters from file
 */
function load() {
  try {
    counters = JSON.parse(fs.readFileSync(COUNTS_FILE, "utf8"));
  } catch {
    counters = {};
  }
}

/**
 * Persist counters to file (unconditional write).
 */
function save() {
  try {
    fs.writeFileSync(COUNTS_FILE, JSON.stringify(counters, null, 2));
  } catch {
    // non-critical
  }
}

/**
 * Persist counters to disk only if something changed since the last write.
 * Called on the flush interval and on graceful shutdown (from index.js).
 *
 * @returns {Boolean} true if a write happened
 */
function flush() {
  if (!dirty) return false;
  save();
  dirty = false;
  return true;
}

/**
 * Increment the counter for a service/endpoint
 *
 * @param {String} service   e.g. "tomorrow.io"
 * @param {String} endpoint  e.g. "current"
 */
function increment(service, endpoint) {
  const { hourKey, dayKey, monthKey } = periodKeys();

  if (!counters[service]) counters[service] = {};
  if (!counters[service][endpoint]) {
    counters[service][endpoint] = { hourKey: "", hour: 0, dayKey: "", day: 0, monthKey: "", month: 0 };
  }

  const c = counters[service][endpoint];

  if (c.hourKey  !== hourKey)  { c.hourKey  = hourKey;  c.hour  = 0; }
  if (c.dayKey   !== dayKey)   { c.dayKey   = dayKey;   c.day   = 0; }
  if (c.monthKey !== monthKey) { c.monthKey = monthKey; c.month = 0; }

  c.hour++;
  c.day++;
  c.month++;

  // Debounced: mark dirty and let the flush interval / shutdown persist.
  dirty = true;
}

/**
 * Returns counters and quotas for the debug panel
 *
 * @returns {Object}
 */
function getCounters() {
  const { hourKey, dayKey, monthKey } = periodKeys();
  const result = {};

  for (const [service, endpoints] of Object.entries(counters)) {
    result[service] = {
      quotas: QUOTAS[service] || {},
      endpoints: {},
    };
    for (const [endpoint, c] of Object.entries(endpoints)) {
      result[service].endpoints[endpoint] = {
        hour:  c.hourKey  === hourKey  ? c.hour  : 0,
        day:   c.dayKey   === dayKey   ? c.day   : 0,
        month: c.monthKey === monthKey ? c.month : 0,
      };
    }
  }

  return result;
}

load();

// Coalesced background flush. .unref() so it never holds the process (or a
// test runner) open.
setInterval(flush, FLUSH_INTERVAL_MS).unref();

module.exports = {
  increment,
  getCounters,
  flush,
  // Exported for regression testing only. See test/requestCounter.test.js.
  __test: { FLUSH_INTERVAL_MS, isDirty: () => dirty },
};
