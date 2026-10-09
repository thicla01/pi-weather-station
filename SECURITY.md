# Security Policy

## Overview

Pi Weather Station is designed to run on a local network (Raspberry Pi + 7" touchscreen). This document describes the security model, the protections in place, and the boundaries of the threat model.

---

## API key protection

All outbound API calls that carry a key (Tomorrow.io, Mapbox, LocationIQ, Anthropic, EPA AirNow, OpenAQ) are **proxied through the Express server**, as are keyless ones such as sunrise-sunset.org — the only direct browser fetches are the keyless radar layers (see [Transport security](#transport-security)). API keys are stored in `settings.json` on the Pi and are never included in client-side request URLs — they are invisible in the browser's network inspector and in third-party server logs.

Remote clients receive a masked `GET /settings`: the response is first projected through the settings whitelist (default-deny, so an unknown key never passes), the API-key fields become booleans (`true` = configured, i.e. the server would use the key — an `anthropicApiKey` still set to the `"key"` placeholder therefore reads `false`), and the `indoorTemperature` block (Homebridge URL and credentials) is removed entirely. Non-secret settings — the starting coordinates, `advanced` and `favorites` — are returned as-is. Full values are only returned when the request's TCP socket peer is the Pi itself (`localhost`, which includes an SSH tunnel).

---

## Access control

| Endpoint | Localhost | Remote (`ALLOW_REMOTE=true`) |
|---|:---:|:---:|
| `GET /` — app UI | ✅ | ✅ |
| `GET /api/*` — weather, maps, geocoding, alerts, AI summary… (except the debug routes and `/api/update-check/force`) | ✅ | ✅ |
| `GET /settings` — API keys masked to booleans, `indoorTemperature` removed | ✅ | ✅ (masked) |
| `POST / PUT /settings`, `PATCH / DELETE /setting` — write API keys, coordinates, `advanced`, `favorites` | ✅ | ❌ always blocked |
| State-changing `/api/*` routes — in-app update (`POST /api/update`, `/api/update-check/force`), brightness, display scale, kiosk relaunch, Sense HAT mode and LED brightness, kiosk location | ✅ | ❌ always blocked |
| `GET /api/debug`, `/api/debug/cpu-temp`, `/api/debug/fan-speed` — debug panel data | ✅ | ❌ always blocked |

Settings writes, the state-changing `/api/*` routes and the debug endpoints are **always restricted to localhost**, regardless of the `ALLOW_REMOTE` flag ([`docs/api.md`](docs/api.md) gives the access level of every route). There is no configuration option to enable remote settings writes — use an SSH tunnel instead (see below).

---

## Remote access

Remote access is **disabled by default**. The server only accepts connections from `localhost` (127.0.0.1) unless `ALLOW_REMOTE=true` is set in the systemd service environment.

When remote access is enabled:
- All API proxy calls remain server-side — no key exposure
- Settings writes and the other state-changing endpoints (updater, brightness, display scale, kiosk relaunch, Sense HAT, kiosk location) remain localhost-only
- The debug endpoints remain localhost-only
- Rate limiting is applied per client (TCP socket peer): 120 req/min on data endpoints, 600 req/min on map tile endpoints

**To change settings from a remote machine**, use an SSH tunnel so the browser sees the request as localhost:

```bash
ssh -L 8443:localhost:8443 pi@<pi-ip>
# then open https://localhost:8443 in your browser
```

---

## Transport security

The server runs over **HTTPS** with a certificate chain it generates itself and re-checks at every start: a self-signed root CA (`server/ca-cert.pem` / `server/ca-key.pem`, 10 years; downloadable from `GET /api/cert.pem` so devices can trust it) and a leaf signed by it (`server/cert.pem` / `server/key.pem`, 825 days). All communication between browser and Pi is encrypted. Mixed content cannot arise: every keyed API call goes through the server, and the only direct browser fetches are the keyless radar layers (RainViewer frame index and tiles, ECCC GeoMet WMS), which are served over HTTPS.

The leaf's Subject Alternative Names are built automatically: `localhost`, `127.0.0.1`, every active LAN IPv4 address, and `<hostname>` / `<hostname>.local`, whether or not `ALLOW_REMOTE` is set. No installer step is involved. At each start the server re-signs the leaf when it no longer covers the current addresses or hostname, or expires within 30 days, and keeps the root CA, so devices that already trust it stay trusted. A hostname change also regenerates the root CA (its name includes the hostname), so devices must install it again — see [`docs/pwa-trust-cert_en.md`](docs/pwa-trust-cert_en.md). To use your own certificate, set `SKIP_CERT_AUTOGEN=true` (see [`docs/ssl-custom-cert_en.md`](docs/ssl-custom-cert_en.md)); without it, a replaced `cert.pem` / `key.pem` is overwritten on the next start.

If no certificate is available (generation failed, or `SKIP_CERT_AUTOGEN=true` with no certificate on disk), the server falls back to cleartext HTTP bound to `127.0.0.1:8080` only, even with `ALLOW_REMOTE=true`. Remote access stays down until a certificate exists.

---

## Rate limiting

The remote-reachable data endpoints under `/api/*` are rate-limited per client using `express-rate-limit`, keyed on the TCP socket peer (`req.socket.remoteAddress`) — never `X-Forwarded-For`, which a client could rotate to mint fresh buckets:

| Endpoint group | Limit |
|---|---|
| Data endpoints (weather, geocoding, AI summary, alerts, air quality, pollen, Sense HAT, health…) | 120 requests / minute |
| Map tiles | 600 requests / minute |

`/api/is-local`, `/api/cert.pem` and the localhost-only routes have no limiter. `/api/nearby-alerts` is also capped at 3 concurrent in-flight requests per remote client (the local kiosk is exempt), since one request fans out to several upstream calls.

This protects external API quotas from exhaustion by rogue or misbehaving clients.

---

## Settings key whitelist

`POST` / `PUT /settings` and `PATCH /setting` enforce a server-side key whitelist. Only known keys are accepted:

- `weatherApiKey`, `mapApiKey`, `reverseGeoApiKey`, `anthropicApiKey`, `airNowApiKey`, `openAqApiKey`
- `startingLat`, `startingLon`
- `indoorTemperature` (Homebridge URL and credentials; removed entirely from remote `GET /settings`), `advanced` (opaque, grouped by feature area), `favorites` (bounded list, shape-validated)

Unknown keys are stripped silently (PUT/POST) or rejected with HTTP 400 (PATCH). The same whitelist filters remote `GET /settings` responses (see [API key protection](#api-key-protection)).

---

## Further protections

- **Locality from the socket peer.** Every localhost-only gate, and the remote masking of `GET /settings`, decides "local" from the TCP socket peer (`req.socket.remoteAddress`), never from `req.ip` or `X-Forwarded-For`, which a remote client could forge to impersonate `127.0.0.1` (fixed 2026-05-28, commit `e4a9e72`). The SSH tunnel and RPi Connect both terminate at loopback, so they count as local; a direct LAN or VPN client counts as remote. Rate limiting keys on the same peer (see [Rate limiting](#rate-limiting)).
- **Baseline security headers** on every response: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` and `Content-Security-Policy: frame-ancestors 'none'`; `X-Powered-By` is disabled. There is deliberately no HSTS (self-signed chain plus the loopback HTTP fallback) and no script/style CSP (the UI relies on runtime inline styles and Leaflet).
- **Kiosk DevTools port off by default.** The kiosk browser's remote-debugging port (`:9222`) is only opened when `KIOSK_REMOTE_DEBUG=true`. While it is open, any local process can drive the kiosk session and reach the localhost-only endpoints, so enable it only for diagnostics.
- **NWS test alerts withheld from remote clients.** Test and exercise alerts (CAP status other than `Actual`) are hidden by default everywhere; the `showTest=1` opt-in on `/api/weather-alerts` and `/api/nearby-alerts` is honored only for local requests, so a forged query parameter reveals nothing to a remote client.
- **Single-flight updater.** A second `POST /api/update` while one is still running is rejected with HTTP 409, so overlapping `git pull` + `npm ci` runs can't corrupt the checkout.

---

## Security events

Blocked requests (write attempts from remote clients) are logged server-side and visible in the **Debug panel** under the "Security events" section (localhost only, `DEBUG=true` required).

---

## Threat model and boundaries

This application is designed for a **trusted local network** (home LAN). It is not hardened for exposure to the public internet. In particular:

- The self-signed certificate will trigger browser warnings on first visit
- No authentication is implemented for remote read access
- `settings.json` stores API keys in plain text on the Pi's filesystem (the file is owner-only, `0600`, and re-tightened at every server start)

If you choose to expose the server beyond your local network (e.g. via port forwarding), do so at your own risk and consider adding a reverse proxy with authentication (e.g. nginx + HTTP Basic Auth).

**Do not run that reverse proxy on the Pi itself.** Every localhost-only protection (settings writes, the unmasked `GET /settings`, the in-app updater and other device controls, the debug endpoints) checks the TCP socket peer. A same-host proxy (nginx or Caddy forwarding to `localhost:8443`) makes every proxied request arrive from `127.0.0.1`, so anyone who gets past the proxy's authentication is treated as local: they receive all API keys and the Homebridge credentials and can call every write endpoint. Prefer a proxy on another machine, so requests arrive from its IP and are treated as remote (all clients then share that machine's rate-limit bucket), or a VPN plus the SSH tunnel described above. If the proxy must run on the Pi, it must not forward `GET /settings` or any route that [`docs/api.md`](docs/api.md) lists as localhost-only.

---

## Reporting a vulnerability

This is a personal/hobbyist project. If you discover a security issue, please open a [GitHub issue](https://github.com/thicla01/pi-weather-station/issues) with the label `security`. For sensitive disclosures, contact the maintainer directly via GitHub.
