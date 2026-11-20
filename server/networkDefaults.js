// Process-wide defaults for the server's OUTBOUND connections. server/index.js
// applies them first, before any module that could open a socket.
//
// 1. IPv4 first. Many home networks answer AAAA records but route no IPv6
//    (every station of the maintainer's fleet has an IPv6 address and no IPv6
//    default route). Asking for the IPv4 address first keeps the first
//    connection attempt on the family that works.
//
// 2. A connection attempt gets CONNECT_ATTEMPT_TIMEOUT_MS, not Node's 250 ms.
//    Since Node 20 a connection to a name with several addresses tries them in
//    turn (`autoSelectFamily`), and gives each one but the last
//    `autoSelectFamilyAttemptTimeout` = 250 ms before moving on. With IPv4
//    first and IPv6 unroutable, that makes 250 ms the whole budget of the
//    request: the IPv4 attempt is dropped (`connect ETIMEDOUT <ipv4>`), the
//    IPv6 one fails at once (`connect ENETUNREACH <ipv6>`), and the caller's
//    10 s timeout never gets its chance. Two ordinary things take more than
//    250 ms:
//      - the server itself being late. Node raises the attempt timeout from a
//        timer, and timers run before socket events: when the event loop was
//        busy for more than 250 ms, the attempt is declared timed out although
//        the kernel finished the handshake long ago. Measured on a Pi 3B
//        (2026-11-19): one fresh radar analysis kept the loop busy ~0.5 s (a
//        trivial endpoint answered in up to 535 ms, 7 ms otherwise), and the
//        kiosk browser starting does worse. The page then came up without
//        current weather or sun times;
//      - one lost SYN (retransmitted after 1 s), or an upstream slow to
//        accept. The likely cause of the same log line on wired Pi 4 / Pi 5
//        stations: a few times a week, once on two stations in two cities
//        one second apart.
//    5 s outlasts a busy loop and the SYN retransmissions at 1 s and 3 s, and
//    leaves half of the default 10 s request timeout for the next address on
//    a host where IPv4 really is dead. Requests with a shorter timeout of
//    their own still end at that timeout.
//
// Both settings apply to axios (Node's http/https agents) and to the global
// `fetch` (undici passes no per-connection override, so it follows them);
// test/networkDefaults.test.js checks both clients.

const dns = require("dns");
const net = require("net");

/** Time one connection attempt gets before the next address is tried. */
const CONNECT_ATTEMPT_TIMEOUT_MS = 5_000;

/**
 * Apply the outbound-connection defaults to this process: IPv4-first name
 * resolution, and CONNECT_ATTEMPT_TIMEOUT_MS per connection attempt.
 * Idempotent.
 *
 * @returns {void}
 */
function applyNetworkDefaults() {
  dns.setDefaultResultOrder("ipv4first");
  // Added in Node 18.18 / 19.8; the guard only spares an older runtime a
  // crash at start-up (it keeps Node's own default there).
  if (typeof net.setDefaultAutoSelectFamilyAttemptTimeout === "function") {
    net.setDefaultAutoSelectFamilyAttemptTimeout(CONNECT_ATTEMPT_TIMEOUT_MS);
  }
}

module.exports = { CONNECT_ATTEMPT_TIMEOUT_MS, applyNetworkDefaults };
