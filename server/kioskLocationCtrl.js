"use strict";

/**
 * kioskLocationCtrl.js — POST /api/kiosk-location
 *
 * Tracks the kiosk's currently-viewed map coordinates in an in-memory
 * cache so server-side, kiosk-independent consumers (currently just
 * the Sense HAT script via `/api/sensehat`) can follow what the user
 * is looking at without prop-drilling through systemd.
 *
 * Design choices worth flagging for future maintainers:
 *
 *   - **In-memory only**, no disk persistence. Server restart clears
 *     the cache and downstream consumers fall back to whatever default
 *     they use today (`settings.json` → ipapi for the Sense HAT path).
 *     This keeps the semantics of `startingLat` / `startingLon` clean
 *     — that pair remains "user-chosen persistent default", and the
 *     kiosk cache is "current session view".
 *
 *   - **localhostOnly**. The kiosk runs on the same Pi as the server,
 *     so localhost is the right blast-radius bound. Remote viewers
 *     (e.g. a phone connected via VPN) can still pan the kiosk for
 *     themselves, but their pan doesn't influence the local Sense HAT
 *     — which matches user expectation (the LED matrix is for the
 *     person physically in front of the Pi).
 *
 *   - **No TTL**. Last write wins, lifetime of the process. Adding a
 *     TTL would create surprise: pan, walk away for 15 min, come back
 *     to find the Sense HAT silently reverted to defaults. Cleaner to
 *     keep the cache stable across the session and let server restart
 *     be the natural "reset" event.
 *
 *   - **Idempotent and noisy-write tolerant**. The client debounces
 *     POSTs (1 s after the last pan settles), but if a remote tool
 *     spams the endpoint, the worst that happens is the cache
 *     bounces — no upstream cost since the read side is in-memory.
 */

let _kioskLocation = null; // { lat: number, lon: number, updatedAt: number } or null

/**
 * Return the current cached kiosk location or null if none has been
 * posted since server start. Consumers should treat null as "fall
 * back to whatever default location source you used before this
 * cache existed" — typically `settings.json` → ipapi.
 *
 * @returns {{lat: number, lon: number} | null}
 */
function getKioskLocation() {
  if (!_kioskLocation) return null;
  return { lat: _kioskLocation.lat, lon: _kioskLocation.lon };
}

/**
 * Express handler for POST /api/kiosk-location.
 *
 * Accepts `{ lat: number, lon: number }` and stores the pair in the
 * in-memory cache. Validates that both numbers are finite and within
 * the WGS-84 range so a malformed client (or a typo in a manual curl)
 * can't push the Sense HAT script into chasing meaningless coordinates.
 *
 * Returns 204 No Content on success — the caller is the client and
 * doesn't need a response body to inform its own state.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
function postKioskLocation(req, res) {
  const body = req.body || {};
  const lat = Number(body.lat);
  const lon = Number(body.lon);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return res.status(400).json({ error: "Invalid lat — must be a number in [-90, 90]" });
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    return res.status(400).json({ error: "Invalid lon — must be a number in [-180, 180]" });
  }
  _kioskLocation = { lat, lon, updatedAt: Date.now() };
  return res.status(204).end();
}

/**
 * Test-only setter to seed the cache before exercising the read path.
 * Not exported to the route table — only the `__test` namespace
 * surfaces it so production code paths can't accidentally bypass the
 * validation in `postKioskLocation`.
 *
 * @param {object|null} value
 * @private
 */
function _setForTest(value) {
  _kioskLocation = value;
}

module.exports = {
  getKioskLocation,
  postKioskLocation,
  __test: { _setForTest },
};
