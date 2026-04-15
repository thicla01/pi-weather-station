/**
 * Tracks unique remote IP addresses that have connected to the server.
 * Only records non-localhost IPs (remote clients).
 */

const remoteClients = new Map();

/**
 * Records a request from a remote IP address.
 *
 * @param {String} ip Remote IP address
 */
function recordClient(ip) {
  const now = Date.now();
  if (remoteClients.has(ip)) {
    const entry = remoteClients.get(ip);
    entry.lastSeen = now;
    entry.requestCount++;
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

module.exports = { recordClient, getRemoteClients };
