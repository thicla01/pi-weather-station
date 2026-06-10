// Baseline HTTP security headers applied to every response.
//
// Set by hand rather than pulling in `helmet`: the set we need is small and
// static, and the fleet deliberately keeps a minimal dependency footprint
// (auto-pulling installs, `npm audit` clean). What each header buys:
//
//   X-Content-Type-Options: nosniff   — browsers must honour the declared
//       Content-Type instead of MIME-sniffing (Express serves correct types
//       for the bundle, JSON, and PNG tiles, so this is free hardening).
//   X-Frame-Options: DENY             — the kiosk UI must never be framed
//       (clickjacking). It renders directly; RPi Connect screen-shares the
//       on-device display, it does not iframe the app.
//   Referrer-Policy: no-referrer      — the SPA only ever calls its own
//       origin (all third-party APIs are server-proxied), so there is no
//       referrer worth sending anywhere; no-referrer matches the fleet's
//       privacy posture.
//   Content-Security-Policy: frame-ancestors 'none' — the modern anti-frame
//       control, paired with X-Frame-Options for older browsers.
//
// Deliberately NOT set:
//   - A full CSP (script-src / style-src / …). The SPA relies on runtime
//     inline styles (computed zoom / grid-template / CSS custom properties)
//     and Leaflet, so a restrictive policy would risk breaking the kiosk for
//     no real gain on a single-origin app. CSP is scoped to frame-ancestors.
//   - HSTS. The kiosk serves a self-signed cert on a loopback/LAN target and
//     keeps an :8080 HTTP fallback; pinning HTTPS would do more harm than
//     good here.

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "frame-ancestors 'none'",
};

/**
 * Express middleware that stamps the baseline security headers on every
 * response. Mounted first (before routes) so it covers static files, the
 * API, and error responses alike.
 *
 * @param {Object} req Express request (unused).
 * @param {Object} res Express response.
 * @param {Function} next
 */
function securityHeaders(req, res, next) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    res.setHeader(name, value);
  }
  next();
}

module.exports = { securityHeaders, SECURITY_HEADERS };
