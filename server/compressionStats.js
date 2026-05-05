// Compression-stats accumulator for the radar prompt block.
// Tracks the character-count reduction between formatSnapshotLegacy
// (the pre-d061126 baseline that listed every direction × distance)
// and formatSnapshot (the current hierarchical compression). Lives in
// memory only — no disk persistence, resets on server restart, same
// lifecycle as the response-time KPIs.
//
// The chosen metric is character-count reduction, not token-count.
// We don't have a Claude tokenizer embedded server-side, but the
// chars↔tokens relationship is roughly linear for similar content
// AND skewed in our favour: BPE compresses the highly repetitive
// legacy format ("5km clear, 10km clear, ...") more efficiently
// than the compressed format, so per-token reduction is typically
// slightly better than per-character reduction. The metric we
// report is therefore a conservative lower bound on real savings.

const HISTOGRAM_BUCKETS = [
  { label: "0-25 %",   min: 0,   max: 25  },
  { label: "25-50 %",  min: 25,  max: 50  },
  { label: "50-75 %",  min: 50,  max: 75  },
  { label: "75-90 %",  min: 75,  max: 90  },
  { label: "90-95 %",  min: 90,  max: 95  },
  { label: "95-100 %", min: 95,  max: 100.0001 }, // include 100
];
const RECENT_WORST_LIMIT = 5;
const RECENT_WORST_WINDOW_MS = 60 * 60 * 1000; // last hour

const state = {
  startedAt: Date.now(),
  count: 0,
  sumPct: 0,
  minPct: Infinity,
  maxPct: -Infinity,
  // pct values stored sorted-insertion for median; a flat array is fine
  // up to a few thousand polls (~1-2 days of 5-min cadence) — we'll
  // accept the linear-insert cost since polling rate is one per ~5 min
  // and the sort gain on report generation is worth it.
  pctValues: [],
  histogram: HISTOGRAM_BUCKETS.map(() => 0),
  // Ring of recent worst cases (least-compressed within the last hour)
  recentWorst: [], // entries: { ts, pct, legacyChars, compressedChars }
};

function bucketIndexFor(pct) {
  for (let i = 0; i < HISTOGRAM_BUCKETS.length; i++) {
    const b = HISTOGRAM_BUCKETS[i];
    if (pct >= b.min && pct < b.max) return i;
  }
  return HISTOGRAM_BUCKETS.length - 1; // fallback to last bucket for 100 %
}

/**
 * Record one compression measurement. Called once per radar frame
 * formatted in `analyzeRadar`. Compressed and legacy strings are
 * computed by their respective formatters; this function only cares
 * about their lengths.
 *
 * @param {Number} legacyChars Length of the legacy-format block in characters.
 * @param {Number} compressedChars Length of the compressed-format block in characters.
 */
function record(legacyChars, compressedChars) {
  if (legacyChars <= 0) return; // defensive: a zero-length baseline would cause divide-by-zero
  const pct = ((legacyChars - compressedChars) / legacyChars) * 100;
  state.count++;
  state.sumPct += pct;
  if (pct < state.minPct) state.minPct = pct;
  if (pct > state.maxPct) state.maxPct = pct;
  state.pctValues.push(pct);
  state.histogram[bucketIndexFor(pct)]++;

  // Update recent-worst ring
  const ts = Date.now();
  state.recentWorst.push({ ts, pct, legacyChars, compressedChars });
  // Drop entries older than the window
  const cutoff = ts - RECENT_WORST_WINDOW_MS;
  state.recentWorst = state.recentWorst.filter((e) => e.ts >= cutoff);
  // Keep only the N least-compressed entries
  if (state.recentWorst.length > RECENT_WORST_LIMIT) {
    state.recentWorst.sort((a, b) => a.pct - b.pct).splice(RECENT_WORST_LIMIT);
  }
}

/**
 * Snapshot of the current stats, suitable for /api/debug responses.
 * Returns null when no measurement has been recorded yet — the Debug
 * panel will hide the row in that case rather than show "0 of 0".
 *
 * @returns {Object|null}
 */
function getStats() {
  if (state.count === 0) return null;
  return {
    count: state.count,
    avgPct: state.sumPct / state.count,
    minPct: state.minPct,
    maxPct: state.maxPct,
    startedAt: state.startedAt,
  };
}

function median(sorted) {
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function fmtUptime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return `${h}h ${m}min`;
}

/**
 * Generate a Markdown report with the full breakdown.
 *
 * @returns {String} Markdown content ready to write to disk.
 */
function generateReport() {
  const now = Date.now();
  const generatedAt = new Date(now).toISOString();
  const uptime = fmtUptime(now - state.startedAt);

  if (state.count === 0) {
    return `# Radar Prompt Compression Report\nGenerated: ${generatedAt}\nServer uptime at generation: ${uptime}\n\nNo radar polls measured yet.\n`;
  }

  const sortedPct = [...state.pctValues].sort((a, b) => a - b);
  const avg = state.sumPct / state.count;
  const med = median(sortedPct);

  const lines = [];
  lines.push("# Radar Prompt Compression Report");
  lines.push(`Generated: ${generatedAt} · Server uptime at generation: ${uptime}`);
  lines.push("");
  lines.push("## Summary");
  lines.push(`- Frames measured: ${state.count.toLocaleString("en-US")}`);
  lines.push(`- Average compression: ${avg.toFixed(1)} %`);
  lines.push(`- Median: ${med.toFixed(1)} %`);
  lines.push(`- Best case: ${state.maxPct.toFixed(1)} %`);
  lines.push(`- Worst case: ${state.minPct.toFixed(1)} %`);
  lines.push(`- Range: ${state.minPct.toFixed(1)} % – ${state.maxPct.toFixed(1)} %`);
  lines.push("");

  // Histogram
  lines.push("## Distribution (per-frame compression)");
  for (let i = 0; i < HISTOGRAM_BUCKETS.length; i++) {
    const b = HISTOGRAM_BUCKETS[i];
    const n = state.histogram[i];
    const pct = state.count ? (100 * n / state.count) : 0;
    lines.push(`- ${b.label.padEnd(8)} ${n.toString().padStart(6)} frames (${pct.toFixed(1)} %)`);
  }
  lines.push("");

  // Recent worst cases
  lines.push("## Recent worst cases (last hour, up to 5)");
  if (!state.recentWorst.length) {
    lines.push("- None recorded in the last hour.");
  } else {
    const sorted = [...state.recentWorst].sort((a, b) => a.pct - b.pct);
    for (const e of sorted) {
      const ts = new Date(e.ts).toISOString();
      lines.push(`- ${ts} — ${e.pct.toFixed(1)} % — legacy ${e.legacyChars} chars / compressed ${e.compressedChars} chars`);
    }
  }
  lines.push("");

  lines.push("## Note on the metric");
  lines.push("Character-count reduction is a conservative lower bound on the actual token savings at the LLM layer. BPE tokenizers compress the highly repetitive legacy format (`5km clear, 10km clear, ...`) more efficiently than the compressed one, so per-token reduction is typically slightly better than per-character reduction. The metric reported here is therefore an honest minimum.");
  lines.push("");

  return lines.join("\n");
}

module.exports = { record, getStats, generateReport };
