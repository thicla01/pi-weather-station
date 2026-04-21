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
 * Persist counters to file
 */
function save() {
  try {
    fs.writeFileSync(COUNTS_FILE, JSON.stringify(counters, null, 2));
  } catch {
    // non-critical
  }
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

  save();
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

module.exports = { increment, getCounters };
