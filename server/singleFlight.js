// Single-flight guard middleware.
//
// Wraps an endpoint whose handler kicks off a long, side-effecting, NOT-
// re-entrant operation — the in-app updater's `git pull` + `npm ci` is the
// motivating case: two of those running at once on the same checkout can
// corrupt node_modules / the working tree. The guard lets the first request
// through and 409s any request that arrives while one is still in flight,
// auto-releasing when the response finishes (or the client disconnects) so a
// failed run can simply be retried.

/**
 * Create a single-flight guard middleware. The returned function is an
 * Express middleware; mount it on the route(s) that must not run concurrently.
 * One guard instance guards one logical operation — create a separate guard
 * per operation you want to serialise independently.
 *
 * @param {Object} [opts]
 * @param {String} [opts.reason] machine-readable reason returned in the 409 body
 * @param {String} [opts.message] human-readable message returned in the 409 body
 * @returns {Function} Express middleware with an `isBusy()` helper attached
 */
function createSingleFlightGuard(opts = {}) {
  const { reason = "in-progress", message = "Operation already in progress." } = opts;
  let busy = false;

  function guard(req, res, next) {
    if (busy) {
      return res.status(409).json({ error: true, reason, message });
    }
    busy = true;
    // Release once this response settles, however it settles: a normal
    // finish, an error response, or the client hanging up early. On the first
    // fire, detach BOTH listeners so a later `close` from this same (already
    // finished) response can never release a *subsequent* request's lock —
    // the guard stays correct even when reused on a concurrent endpoint.
    const release = () => {
      busy = false;
      res.removeListener("finish", release);
      res.removeListener("close", release);
    };
    res.once("finish", release);
    res.once("close", release);
    return next();
  }

  guard.isBusy = () => busy;
  return guard;
}

module.exports = { createSingleFlightGuard };
