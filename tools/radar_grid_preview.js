#!/usr/bin/env node
/**
 * radar_grid_preview.js — terminal visualiser for the Sense HAT radar grid.
 *
 * Renders buildRadarGrid()'s 8×8 reprojection as an ANSI-truecolor block so we
 * can eyeball the polar→Cartesian mapping (and the tier colours) without a Pi,
 * a live radar feed, or touching the Python renderer.
 *
 *   node tools/radar_grid_preview.js            # synthetic scenarios
 *   node tools/radar_grid_preview.js --live LAT LON   # real /api/radar-risk
 *
 * The synthetic scenarios build samples on the SAME geometry the analyzer uses
 * (16 inner dirs × 5-50 km, 32 outer dirs × 55-100 km) and paint intensity from
 * a few spatial "blobs", so the preview exercises the real binning code path.
 */
const path = require("path");
const fs = require("fs");
const https = require("https");
const { PNG } = require("pngjs");
const { buildRadarGrid, intensityToRgb } = require(path.join(__dirname, "..", "server", "radarAnalyzerCtrl"));

const SIZE = 8;
const COMPASS_16 = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
                    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const INNER = COMPASS_16.map((name, i) => ({ name, bearing: i * 22.5 }));
const OUTER = Array.from({ length: 32 }, (_, i) => ({
  name: i % 2 === 0 ? COMPASS_16[i / 2] : (i * 11.25).toString(),
  bearing: i * 11.25,
}));
const INNER_DIST = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50];
const OUTER_DIST = [55, 60, 65, 70, 75, 80, 85, 90, 95, 100];

/**
 * Build a full geometry sample set, intensity painted by a list of blobs.
 * Each blob = {bearing, distanceKm, radiusKm, peak}; a grid point takes the
 * max over blobs of peak·(1 − d/radius) clamped to integer tiers 0-6.
 *
 * @param {Array<{bearing:Number, distanceKm:Number, radiusKm:Number, peak:Number}>} blobs
 * @returns {Array<{direction:String, distance:Number, intensity:Number}>}
 */
function samplesFromBlobs(blobs) {
  const out = [{ direction: "C", distance: 0, intensity: intensityAt(0, 0, blobs) }];
  for (const dir of INNER) {
    for (const d of INNER_DIST) out.push({ direction: dir.name, distance: d, intensity: intensityAt(dir.bearing, d, blobs) });
  }
  for (const dir of OUTER) {
    for (const d of OUTER_DIST) out.push({ direction: dir.name, distance: d, intensity: intensityAt(dir.bearing, d, blobs) });
  }
  return out;
}

/**
 * Max blob intensity at a polar point, as an integer tier 0-6.
 * @param {Number} bearing degrees
 * @param {Number} distanceKm km from centre
 * @param {Array} blobs blob list
 * @returns {Number} intensity 0-6
 */
function intensityAt(bearing, distanceKm, blobs) {
  const rad = bearing * Math.PI / 180;
  const px = distanceKm * Math.sin(rad);
  const py = distanceKm * Math.cos(rad);
  let best = 0;
  for (const b of blobs) {
    const brad = b.bearing * Math.PI / 180;
    const bx = b.distanceKm * Math.sin(brad);
    const by = b.distanceKm * Math.cos(brad);
    const dist = Math.hypot(px - bx, py - by);
    if (dist > b.radiusKm) continue;
    const v = b.peak * (1 - dist / b.radiusKm);
    if (v > best) best = v;
  }
  return Math.max(0, Math.min(6, Math.round(best)));
}

/**
 * Print an intensity grid to the terminal with ANSI truecolor + compass frame.
 * In-disk cells with no echo render as a dim slate; out-of-disk corners blank.
 * @param {Object} result buildRadarGrid output
 * @param {String} title scenario name
 * @returns {void}
 */
function render(result, title) {
  const { grid, size, radiusKm, litCells } = result;
  const half = size / 2;
  const reset = "\x1b[0m";
  console.log(`\n  ${title}  —  radius ${radiusKm} km, ${litCells} lit cells`);
  console.log("        N");
  for (let row = 0; row < size; row++) {
    let line = "    ";
    line += row === Math.floor(half) - 1 ? "W " : "  ";
    for (let col = 0; col < size; col++) {
      // normalised cell centre to decide in-disk vs corner
      const nx = (col + 0.5) / half - 1;
      const ny = 1 - (row + 0.5) / half;
      const inDisk = Math.hypot(nx, ny) <= 1.02;
      const level = grid[row * size + col];
      if (level > 0) {
        const [r, g, b] = intensityToRgb(level);
        line += `\x1b[48;2;${r};${g};${b}m  ${reset}`;
      } else if (inDisk) {
        line += "\x1b[48;2;30;33;40m  " + reset; // dim slate = in-disk, no echo
      } else {
        line += "  "; // corner, outside the analysis disk
      }
    }
    line += row === Math.floor(half) - 1 ? " E" : "";
    console.log(line);
  }
  console.log("        S");
}

const SCENARIOS = [
  { title: "Clear (no echoes)", blobs: [] },
  { title: "Cell to the SW, ~60 km, heavy", blobs: [{ bearing: 225, distanceKm: 60, radiusKm: 25, peak: 5 }] },
  { title: "Band approaching from the N", blobs: [
    { bearing: 0, distanceKm: 70, radiusKm: 35, peak: 4 },
    { bearing: 350, distanceKm: 80, radiusKm: 30, peak: 3 },
    { bearing: 12, distanceKm: 75, radiusKm: 30, peak: 3 },
  ] },
  { title: "Storm overhead", blobs: [{ bearing: 0, distanceKm: 0, radiusKm: 30, peak: 6 }] },
  { title: "Scattered showers, E + SE", blobs: [
    { bearing: 90, distanceKm: 40, radiusKm: 18, peak: 3 },
    { bearing: 135, distanceKm: 70, radiusKm: 20, peak: 4 },
    { bearing: 112, distanceKm: 95, radiusKm: 15, peak: 2 },
  ] },
];

/** Fetch /api/radar-risk from the local server and preview the real grid.
 * @param {Number} lat latitude
 * @param {Number} lon longitude
 * @returns {void}
 */
function live(lat, lon) {
  const url = `https://localhost:8443/api/radar-risk?lat=${lat}&lon=${lon}&distanceUnit=km`;
  const agent = new https.Agent({ rejectUnauthorized: false }); // self-signed localhost
  https.get(url, { agent }, (res) => {
    let body = "";
    res.on("data", (c) => (body += c));
    res.on("end", () => {
      try {
        const risk = JSON.parse(body);
        const samples = [...(risk.inner?.samples || []), ...(risk.outer?.samples || [])];
        render(buildRadarGrid(samples, { distanceUnit: "km" }), `LIVE ${lat},${lon}`);
      } catch (e) {
        console.error("Could not parse /api/radar-risk:", body.slice(0, 200));
      }
    });
  }).on("error", (e) => console.error("Request failed:", e.message));
}

/**
 * Render every synthetic scenario into one PNG that mimics the Sense HAT —
 * each grid is an 8×8 panel of circular "LEDs" on black, off cells a faint
 * dot, lit cells the tier colour. Panels are laid out in a row.
 * @param {String} outPath file to write
 * @returns {void}
 */
function renderPng(outPath) {
  const CELL = 34; const R = 14; const PAD = 16; const GAP = 28;
  const panelW = SIZE * CELL;
  const W = PAD * 2 + SCENARIOS.length * panelW + (SCENARIOS.length - 1) * GAP;
  const H = PAD * 2 + panelW;
  const png = new PNG({ width: W, height: H });
  // black background
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 8; png.data[i + 1] = 8; png.data[i + 2] = 10; png.data[i + 3] = 255;
  }
  const put = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const o = (y * W + x) * 4;
    png.data[o] = r; png.data[o + 1] = g; png.data[o + 2] = b; png.data[o + 3] = 255;
  };
  SCENARIOS.forEach((sc, p) => {
    const { grid } = buildRadarGrid(samplesFromBlobs(sc.blobs), { distanceUnit: "km" });
    const ox = PAD + p * (panelW + GAP);
    const oy = PAD;
    for (let row = 0; row < SIZE; row++) {
      for (let col = 0; col < SIZE; col++) {
        const level = grid[row * SIZE + col];
        let [r, g, b] = intensityToRgb(level);
        if (level === 0) { r = 26; g = 28; b = 34; } // unlit LED
        const cx = ox + col * CELL + CELL / 2;
        const cy = oy + row * CELL + CELL / 2;
        for (let dy = -R; dy <= R; dy++) {
          for (let dx = -R; dx <= R; dx++) {
            if (dx * dx + dy * dy <= R * R) put(cx + dx, cy + dy, r, g, b);
          }
        }
      }
    }
  });
  fs.writeFileSync(outPath, PNG.sync.write(png));
  console.log(`Wrote ${outPath}  (${SCENARIOS.map((s) => s.title).join("  |  ")})`);
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--live") {
    live(parseFloat(args[1]), parseFloat(args[2]));
    return;
  }
  if (args[0] === "--png") {
    renderPng(args[1] || "/tmp/radar_grid_preview.png");
    return;
  }
  for (const sc of SCENARIOS) {
    render(buildRadarGrid(samplesFromBlobs(sc.blobs), { distanceUnit: "km" }), sc.title);
  }
}

main();
