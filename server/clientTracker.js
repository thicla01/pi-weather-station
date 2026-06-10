/**
 * Tracks unique remote IP addresses that have connected to the server.
 * Only records non-localhost IPs (remote clients). The caller keys on the
 * socket peer (req.socket.remoteAddress), never req.ip, so the recorded
 * address can't be forged by an X-Forwarded-For header.
 */

const { BoundedMap } = require("./boundedCache");

// Hard cap on tracked clients. The socket-peer keying (server/index.js)
// already removes the spoofable fan-out that previously let one client
// mint unlimited entries; this cap is the belt-and-suspenders bound so the
// Map can never grow without limit on a long-running process. 1000 most-
// recently-seen remote peers is far above any real fleet's client count.
const MAX_REMOTE_CLIENTS = 1000;

const remoteClients = new BoundedMap(MAX_REMOTE_CLIENTS);

/**
 * Records a request from a remote IP address.
 *
 * @param {String} ip Remote IP address (socket peer)
 */
function recordClient(ip) {
  if (!ip) return;
  const now = Date.now();
  const existing = remoteClients.get(ip);
  // Re-set (not in-place mutate) so BoundedMap moves this client to the
  // most-recent slot — a steadily-active client is then protected from the
  // FIFO cap eviction while genuinely idle ones age out first.
  if (existing) {
    remoteClients.set(ip, {
      firstSeen: existing.firstSeen,
      lastSeen: now,
      requestCount: existing.requestCount + 1,
    });
  } else {
    remoteClients.set(ip, { firstSeen: now, lastSeen: now, requestCount: 1 });
  }
}

/**
 * Returns the list of remote clients sorted by most recently seen.
 *
 * @returns {Array<{ip: string, firstSeen: number, lastSeen: number, requestCount: number}>}
 */
function getRemoteClients() {
  return Array.from(remoteClients.entries())
    .map(([ip, data]) => ({ ip, ...data }))
    .sort((a, b) => b.lastSeen - a.lastSeen);
}

module.exports = {
  recordClient,
  getRemoteClients,
  // Exported for regression testing only — see test/clientTracker.test.js.
  __test: { MAX_REMOTE_CLIENTS },
};
