# Pi Weather Station — Architecture Overview

```text
                        ┌─────────────────┐                   ┌─────────────┐
                        │    Browser      │                   │   Browser   │
                        │   PC / Mac      │                   │   Tablet    │
                        └────────┬────────┘                   └──────┬──────┘
                                 │              Local network        │
                 ─ ─ ─ ─ ─ ─ ─ ─┼─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┼─ ─ ─ ─ ─
                                 └──────────────┬────────────────────┘
                                         HTTPS :8443
┌─────────────────┐                             │
│    Chromium     │    loopback          ┌──────▼──────────────────────────────┐
│  (localhost)    ├─────────────────────►│              Raspberry Pi           │
└─────────────────┘    127.0.0.1         │                                     │
                                         │          Express Server             │
                                         │          HTTPS :8443                │
                                         │                                     │
                                         │  /api/weather/*      → shared cache │
                                         │  /api/tiles/*        → shared cache │
                                         │  /api/reverse-geocode               │
                                         │  /api/sunrise-sunset                │
                                         │  /api/weather-summary → AI summary  │
                                         │  /api/debug          (localhost only)│
                                         │  /settings  write    (localhost only │
                                         │                       if REMOTE_     │
                                         │                       SECURITY=true) │
                                         └──────────────────────┬───────────────┘
                                                                │
                                                           Internet
                        ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┼─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
                                                                │
       ┌──────────────┬──────────────┬─────────────────┬────────┴───────────┬──────────────────────┐
       │              │              │                 │                    │                      │
┌──────┴──────┐  ┌────┴──────┐  ┌───┴─────────┐  ┌───┴───────┐  ┌─────────┴──────┐  ┌────────────┴───────┐
│ Tomorrow.io │  │  Mapbox   │  │  LocationIQ │  │ ipapi.co  │  │ sunrise-sunset │  │ Anthropic (Claude) │
│  (weather)  │  │  (tiles)  │  │  (geocoding)│  │  (IP geo) │  │     .org       │  │  (AI summary)      │
└─────────────┘  └───────────┘  └─────────────┘  └───────────┘  └────────────────┘  └────────────────────┘
```

## How to read this diagram

- **North** — remote browsers on the local network connect to the Pi over HTTPS when `ALLOW_REMOTE=true`
- **West** — Chromium runs on the Pi itself and communicates with the Express server via loopback (`127.0.0.1`), never over the network; this also grants it exclusive access to `/api/debug` and settings writes (unless `REMOTE_SECURITY=true` is disabled)
- **Center** — the Pi is the single gateway; no client ever reaches an external API directly. API keys stay on the Pi, invisible to browser network logs. The shared server-side cache means all clients benefit from the same cached responses, reducing quota consumption
- **South** — external APIs are only reachable by the Pi. Settings writes are restricted to localhost only when `REMOTE_SECURITY=true` — without it, remote clients have full access to settings. The Anthropic (Claude) API is called only when an Anthropic API key is configured; the feature is entirely optional
