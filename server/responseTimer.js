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
