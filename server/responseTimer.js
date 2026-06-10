/**
 * Response time tracking middleware.
 * Records count, avg, min, max per endpoint path.
 */

const stats = {};

/**
 * Normalize a request path to a stable endpoint key
 * (strips tile coordinates and query params)
 *
 * @param {String} path
 * @returns {String}
 */
function normalizePath(path) {
  return path
    .replace(/\/[0-9]+\/[0-9]+\/[0-9]+$/, "/:z/:x/:y") // map tile coords
    .split("?")[0];
}

/**
 * Express middleware — measures and records response time
 */
function responseTimerMiddleware(req, res, next) {
  const start = Date.now();
  res.on("finish", () => {
    // Skip unmatched paths: this middleware is mounted globally, so a
    // remote client scanning unique URLs (`/scan-000001`, …) would mint
    // one permanent stats entry per probe — an unbounded, remotely
    // drivable keyspace on an ALLOW_REMOTE install. Real endpoints all
    // answer non-404, and 404s carry no KPI value for the debug panel.
    if (res.statusCode === 404) return;
    const ms = Date.now() - start;
    const key = normalizePath(req.path);
    if (!stats[key]) {
      stats[key] = { count: 0, totalMs: 0, minMs: Infinity, maxMs: 0 };
    }
    const s = stats[key];
    s.count++;
    s.totalMs += ms;
    if (ms < s.minMs) s.minMs = ms;
    if (ms > s.maxMs) s.maxMs = ms;
  });
  next();
}

/**
 * Returns response time stats for all tracked endpoints
 *
 * @returns {Array}
 */
function getResponseTimeStats() {
  return Object.entries(stats)
    .filter(([, s]) => s.count > 0)
    .map(([endpoint, s]) => ({
      endpoint,
      count: s.count,
      avgMs: Math.round(s.totalMs / s.count),
      minMs: s.minMs === Infinity ? 0 : Math.round(s.minMs),
      maxMs: Math.round(s.maxMs),
    }))
    .sort((a, b) => b.count - a.count);
}

module.exports = { responseTimerMiddleware, getResponseTimeStats };
