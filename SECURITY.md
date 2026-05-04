# Security Policy

## Overview

Pi Weather Station is designed to run on a local network (Raspberry Pi + 7" touchscreen). This document describes the security model, the protections in place, and the boundaries of the threat model.

---

## API key protection

All outbound API calls (Tomorrow.io, Mapbox, LocationIQ, sunrise-sunset.org, Anthropic) are **proxied through the Express server**. API keys are stored in `settings.json` on the Pi and are never included in client-side request URLs — they are invisible in the browser's network inspector and in third-party server logs.

Remote clients receive only boolean values (`true` / `false`) from `GET /settings` — actual key values are never transmitted over the network. Key values are only returned when the request originates from the Pi itself (`localhost`).

---

## Access control

| Endpoint | Localhost | Remote (`ALLOW_REMOTE=true`) |
|---|:---:|:---:|
| `GET /` — app UI | ✅ | ✅ |
| `GET /api/*` — weather, maps, geocoding | ✅ | ✅ |
| `GET /settings` — returns masked booleans for keys | ✅ | ✅ (masked) |
| `POST / PUT / PATCH /settings` — write API keys, coordinates | ✅ | ❌ always blocked |
| `GET /api/debug` — debug panel data | ✅ | ❌ always blocked |

Settings writes and the debug endpoint are **always restricted to localhost**, regardless of the `ALLOW_REMOTE` flag. There is no configuration option to enable remote settings writes — use an SSH tunnel instead (see below).

---

## Remote access

Remote access is **disabled by default**. The server only accepts connections from `localhost` (127.0.0.1) unless `ALLOW_REMOTE=true` is set in the systemd service environment.

When remote access is enabled:
- All API proxy calls remain server-side — no key exposure
- Settings writes remain localhost-only
- The debug endpoint remains localhost-only
- Rate limiting is applied per client IP: 120 req/min on weather/geocoding endpoints, 600 req/min on map tile endpoints

**To change settings from a remote machine**, use an SSH tunnel so the browser sees the request as localhost:

```bash
ssh -L 8443:localhost:8443 pi@<pi-ip>
# then open https://localhost:8443 in your browser
```

---

## Transport security

The server runs over **HTTPS** using a self-signed certificate generated automatically on first launch (`server/cert.pem` / `server/key.pem`). All communication between browser and Pi is encrypted. Mixed-content issues are avoided because all external API calls are routed through the server.

The certificate covers `localhost` and `127.0.0.1` by default. For remote access with a valid certificate, regenerate it with the Pi's IP as a Subject Alternative Name — `deploy/install.sh` does this automatically when remote access is enabled during installation.

---

## Rate limiting

All `/api/*` endpoints are rate-limited per client IP using `express-rate-limit`:

| Endpoint group | Limit |
|---|---|
| Weather & geocoding | 120 requests / minute |
| Map tiles | 600 requests / minute |

This protects external API quotas from exhaustion by rogue or misbehaving clients.

---

## Settings key whitelist

`POST`, `PUT`, and `PATCH` requests to `/settings` enforce a server-side key whitelist. Only known keys are accepted:

- `weatherApiKey`, `mapApiKey`, `reverseGeoApiKey`, `anthropicApiKey`, `airNowApiKey`, `openAqApiKey`
- `startingLat`, `startingLon`

Unknown keys are stripped silently (PUT/POST) or rejected with HTTP 400 (PATCH).

---

## Security events

Blocked requests (write attempts from remote clients) are logged server-side and visible in the **Debug panel** under the "Security events" section (localhost only, `DEBUG=true` required).

---

## Threat model and boundaries

This application is designed for a **trusted local network** (home LAN). It is not hardened for exposure to the public internet. In particular:

- The self-signed certificate will trigger browser warnings on first visit
- No authentication is implemented for remote read access
- `settings.json` stores API keys in plain text on the Pi's filesystem

If you choose to expose the server beyond your local network (e.g. via port forwarding), do so at your own risk and consider adding a reverse proxy with authentication (e.g. nginx + HTTP Basic Auth).

---

## Reporting a vulnerability

This is a personal/hobbyist project. If you discover a security issue, please open a [GitHub issue](https://github.com/thicla01/pi-weather-station/issues) with the label `security`. For sensitive disclosures, contact the maintainer directly via GitHub.
