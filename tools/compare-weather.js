#!/usr/bin/env node
/**
 * Side-by-side comparison of Tomorrow.io vs Open-Meteo against
 * the local server's two weather endpoints. Prints a per-field
 * diff table and (optionally) appends a CSV row to a log file so
 * you can build up a longitudinal dataset.
 *
 * USAGE
 *   node tools/compare-weather.js                  # one-shot, Montreal default
 *   node tools/compare-weather.js 45.5 -73.6       # specific coords
 *   node tools/compare-weather.js --watch 15       # loop every 15 minutes
 *   node tools/compare-weather.js --csv log.csv    # append to CSV log
 *   node tools/compare-weather.js --watch 15 --csv weather-deltas.csv
 *
 * UNITS
 *   Both endpoints answer in the same metric units (°C, %, wind m/s,
 *   precipitation mm/h), so the Δ column is like-for-like and no
 *   conversion happens here. Before the 2026-10 fix the Open-Meteo
 *   adapter (server/openMeteoCtrl.js) returned wind in km/h, Open-
 *   Meteo's default, while Tomorrow.io is m/s, and returned
 *   `precipitationIntensity` as the mm that fell in the last 15 min
 *   rather than mm/h. CSV rows recorded against a server that
 *   predates the fix therefore carry `windSpeed_om` in km/h (divide
 *   by 3.6) and `precipitationIntensity_om` in mm per 15 min
 *   (multiply by 4) before comparing.
 *
 * Self-signed TLS cert is accepted (the kiosk uses one). No
 * dependencies beyond Node's built-in https + fs.
 */

const https = require("https");
const fs = require("fs");

// Accept the kiosk's self-signed cert so we don't have to plumb
// the cert path into Node. Limited to this script's process.
const agent = new https.Agent({ rejectUnauthorized: false });

const BASE = "https://localhost:8443";
const UNITS_NOTE = "Units (both sources): °C, %, wind m/s, precipitation mm/h";

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { agent }, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`bad JSON from ${url}: ${e.message}`)); }
      });
    }).on("error", reject);
  });
}

async function compare(lat, lon) {
  const [tomorrow, openMeteo] = await Promise.all([
    get(`${BASE}/api/weather/current?lat=${lat}&lon=${lon}`),
    get(`${BASE}/api/weather/openmeteo?lat=${lat}&lon=${lon}`),
  ]);

  const t  = tomorrow.data?.timelines?.[0]?.intervals?.[0]?.values || {};
  const om = openMeteo.current?.data?.timelines?.[0]?.intervals?.[0]?.values || {};

  const fields = [
    "temperature", "temperatureApparent", "humidity",
    "windSpeed", "cloudCover", "uvIndex",
    "weatherCode", "precipitationIntensity",
  ];

  const rows = fields.map((k) => {
    const tv = t[k];
    const ov = om[k];
    let delta = "";
    if (typeof tv === "number" && typeof ov === "number") {
      delta = k === "weatherCode"
        ? (tv === ov ? "=" : "≠")
        : (ov - tv >= 0 ? "+" : "") + (ov - tv).toFixed(2);
    }
    return { field: k, tomorrow: tv, openMeteo: ov, delta };
  });

  return { rows, timestamp: new Date().toISOString() };
}

function printTable(rows, timestamp) {
  console.log(`\n=== ${timestamp} ===`);
  console.log(UNITS_NOTE);
  console.log("Field".padEnd(24) + "Tomorrow.io".padStart(14) + "Open-Meteo".padStart(14) + "   Δ");
  console.log("-".repeat(60));
  for (const r of rows) {
    console.log(
      String(r.field).padEnd(24)
      + String(r.tomorrow ?? "—").padStart(14)
      + String(r.openMeteo ?? "—").padStart(14)
      + "   " + r.delta
    );
  }
}

function appendCsv(path, rows, timestamp) {
  const exists = fs.existsSync(path);
  if (!exists) {
    const header = ["timestamp", ...rows.map((r) => `${r.field}_t`), ...rows.map((r) => `${r.field}_om`)].join(",");
    fs.writeFileSync(path, header + "\n");
  }
  const line = [
    timestamp,
    ...rows.map((r) => r.tomorrow ?? ""),
    ...rows.map((r) => r.openMeteo ?? ""),
  ].join(",");
  fs.appendFileSync(path, line + "\n");
}

async function main() {
  const args = process.argv.slice(2);
  let lat = 45.5, lon = -73.6;
  let watchMinutes = 0;
  let csvPath = null;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--watch") { watchMinutes = parseFloat(args[++i]); }
    else if (a === "--csv") { csvPath = args[++i]; }
    else if (!isNaN(parseFloat(a))) {
      // First two numeric args = lat, lon.
      if (lat === 45.5 && i === 0) lat = parseFloat(a);
      else if (lon === -73.6) lon = parseFloat(a);
    }
  }

  const run = async () => {
    try {
      const { rows, timestamp } = await compare(lat, lon);
      printTable(rows, timestamp);
      if (csvPath) {
        appendCsv(csvPath, rows, timestamp);
        console.log(`  ↳ appended to ${csvPath}`);
      }
    } catch (e) {
      console.error(`fetch failed: ${e.message}`);
    }
  };

  await run();
  if (watchMinutes > 0) {
    console.log(`\nWatching — next sample in ${watchMinutes} min (Ctrl+C to stop)`);
    setInterval(run, watchMinutes * 60 * 1000);
  }
}

main();
