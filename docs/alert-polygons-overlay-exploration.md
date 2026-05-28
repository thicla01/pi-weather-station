# Exploration — Continental alert polygons overlay (AccuWeather « Avis des autorités publiques »)

**Status:** exploration only, no implementation work scheduled.
**Authored:** 2026-05-28 after the v3.1 Phase 4d shipped.
**Reference upstream pattern:** [AccuWeather Government Alerts layer](https://www.accuweather.com/en/weather-radar) — the toggle that paints every active US/Canada gov-alert polygon on top of the radar map.

This document captures what it would take to add a similar feature to the Pi Weather Station, **without committing to building it**. The Phase 4d implementation already renders the polygon for *the active alert the user picks via the AlertBanner footer*; this exploration scopes the much-larger ambition of painting **every active alert in North America simultaneously**.

## 1. The vision

A toggle (likely a new dock button or a Settings flag) that, when ON, overlays every active ECCC + NWS alert polygon across North America on the map, colour-coded by tier:

- 🔴 Red — Tornado Warning, Severe Thunderstorm Warning, Tsunami Warning, evacuation orders
- 🟠 Orange — Watches and Winter Storm Warnings
- 🟡 Yellow — Advisories (typically hidden by default to reduce visual noise)

Tap a polygon → popup with the alert summary (similar to AlertMiniCards but anchored on the map).

## 2. Key UX decision: mutual exclusivity with RainViewer

**Conclusion from the 2026-05-28 design discussion:** if this feature is built, it is **exclusive** with the radar precipitation layer. The toggle flips between:

- **Mode A** — RainViewer tiles visible (current default), no polygons
- **Mode B** — Continental alert polygons visible, no RainViewer tiles

**Why not both:** the radar tiles already carry intense per-pixel colour information (precipitation tiers, motion arrows, risk rings, location marker, ECCC alert popup polygon if active). Overlaying 100-2000+ semi-transparent polygons on top would render the map illegible. AccuWeather's app does this exclusivity for the same reason.

This decision simplifies a few things:
- The basemap (Mapbox / streets-v12) is enough context behind the polygons — no double-layer compositing
- Performance budget on the Pi GPU is freed up (no radar tile fetching during polygon mode)
- The mental model is cleaner — "what am I looking at?" has one answer at a time

## 3. Data volumes

| Source | Endpoint | Volume estimate |
|---|---|---|
| ECCC | `https://api.weather.gc.ca/collections/weather-alerts/items?f=json` (existing feed national, just skip the `pointInPolygon` filter) | ~50 active features at any time, ~200 KB |
| NWS | `https://api.weather.gov/alerts/active` (sans `?point=`) | 500-2000 active alerts depending on season, **5-20 MB** payload |
| NWS zones | `affectedZones` URLs for zone-based alerts (Red Flag, Heat Adv, etc.) | Worst case: 500 alerts × 3 zones = 1500 zone fetches. Mitigated by the existing 24 h zone cache (commit `ce23f03`) — after first fill, the ~800 stable NWS forecast + fire zones serve 99 % of subsequent lookups for free. |

The dominant cost is **NWS zone resolution on cold cache**. Once warm, the feature is essentially free network-wise.

## 4. Implications

### Performance / RAM on the Pi

| Aspect | Impact |
|---|---|
| RAM server (Node) | Cache zones + alerts: ~10-15 MB stable. Comfortable on Pi 4 (4 GB) |
| Network | First fetch after server restart: ~10 MB NWS. With 5 min server cache, recurring polls fire at most once per 5 min |
| Leaflet rendering | **Critical:** rendering 1000-2000 polygons simultaneously slows pan/zoom on the Pi. Browser GPU compositing degrades fast |
| Cold-start kiosk | +1-3 s waiting for zones during initial cache fill |

### Required performance optimisations

1. **Viewport clipping** — only render polygons that intersect the visible viewport. Typically skips 80-95 % of polygons. Mandatory.
2. **Polygon simplification** via `turf.simplify()` keyed to zoom level. Reduces vertex count by 50-80 % at low zooms. Recommended.
3. **Layer groups per tier** — separate Leaflet `LayerGroup` for red / orange / yellow so toggling visibility is cheap (no re-paint).
4. **Default severity threshold** — show only red + orange by default. Yellow opt-in via settings (advisories are routine, would spam the map).

### Networking / quotas

- NWS: no formal rate limit, but `User-Agent` is required (we already have one)
- ECCC: no rate limit

So we're not adding pressure on the existing Tomorrow.io or Mapbox quotas — only on the free government endpoints.

## 5. UX considerations

| Element | Decision |
|---|---|
| Mode toggle location | New button in the BottomDock "Map" group (icon similar to AccuWeather's). Tap flips Mode A ↔ Mode B. |
| Tier colour coding | Reuse the existing red/orange/yellow palette from `SeverityChip` and the Phase 4d single-polygon overlay |
| Polygon style | 2 px border + 15 % fill (same as Phase 4d) |
| Polygon click | Open the same AlertBanner that exists today, scrolled to that alert. Mini-cards list lets the user explore neighbouring active alerts in the area. |
| Legend | Brief mini-legend in the corner: "🔴 Warning 🟠 Watch 🟡 Advisory" + count of currently visible polygons |
| Severity filter | Multi-toggle red ☑ / orange ☑ / yellow ☐ |
| Mobile / 7" Pi behaviour | Same toggle, but yellow is even more aggressively hidden — screen real estate is precious |
| Default state | Mode A (current radar). User opts in to Mode B explicitly. |

## 6. Suggested phasing (if we ever attack this)

| Phase | Scope | Effort |
|---|---|---|
| MVP | ECCC alerts only (Canada) + NWS alerts with direct `feature.geometry` (Tornado / Severe Thunderstorm / Flash Flood). Skip NWS zone-based resolution. Mode A/B toggle. Tier-coloured layer. Viewport clipping. | ~3 h |
| V2 | Resolve NWS `affectedZones` for the full US coverage. Pre-warm zone cache at server start. Add legend + count. | +2 h |
| V3 | Severity filter UI. Click → AlertBanner integration. i18n EN/FR/ES. Mobile/Pi 7" responsive tweaks. | +2 h |
| V4 (stretch) | MeteoAlarm (Europe) — same pattern, third source. Already noted in ROADMAP under "MeteoAlarm as the third government alerts source". | +3 h |

**Total realistic budget:** ~8-10 h spread across 2-3 sessions if all phases are pursued.

## 7. Open decisions to settle when we attack this

1. **Toggle granularity** — single bouton "Mode B on/off", or three independent toggles (radar / polygons / arrows) with the constraint that polygons + radar can't both be on?
2. **Severity default** — red + orange shown by default, or also yellow? Field test on a "calm day" payload would tell.
3. **Cold-start UX** — when the user first turns Mode B on and the zone cache is empty, show a spinner? Or just paint progressively as polygons resolve?
4. **Persistence** — does Mode B survive across kiosk reboots? Probably yes via localStorage, like the existing `radarTimelineVisible` etc.
5. **Multi-tab kiosks** — if two browsers connect to the same Pi, do they share the toggle state? Currently each has its own.
6. **MeteoAlarm (Europe)** — bundle in the same toggle or separate toggle? Bundle is simpler; separate is more honest about which areas are covered.

## 8. Why this isn't built right now

Phase 4d already covers the **most-common need**: showing the polygon for the single alert the user is reading about. The exhaustive continental view is a power-user feature with a non-trivial implementation cost and a meaningful runtime cost on the Pi. We agreed on 2026-05-28 that:

- Phase 4d is the right level of investment for the maintainer's actual use case
- The exhaustive view is a "would be nice some day" feature
- Documenting the exploration here avoids losing the design analysis if and when we do come back to it

If priorities shift later (e.g. someone is using the kiosk specifically as a severe-weather monitoring station), this document is the starting point to attack the build with the design decisions already pre-resolved.

## 9. Related references

- `docs/eccc-radar.md` — sister exploration on swapping RainViewer for ECCC WMS radar (Phase A shipped, Phase B deferred). Useful precedent for "Mode A / Mode B with one radar source at a time".
- `ROADMAP.md` line 140 — `🚨 Critical-tier severe-alert takeover overlay` — different feature (full-screen takeover for tornado / evacuation), but shares the polygon-data path.
- `ROADMAP.md` § MeteoAlarm — third source candidate, would slot into this overlay as a fourth tier of fetch.
- Commit `ce23f03` — NWS `affectedZones` resolution + 24 h zone cache. The infrastructure this exploration would build on top of.
- Commit `765da0b` — Phase 4d single-polygon overlay. The visual pattern to replicate at scale.
