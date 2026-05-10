# MapTiler Cloud — Plan B reference

This document captures what MapTiler Cloud offers and how it would map onto
the project's current external dependencies. **It is not an integration
plan** — the project has no current need to switch off Mapbox / LocationIQ
/ ipapi.co. This is a reference so that, if any of those upstreams ever
becomes problematic (price hike, regional outage, terms change, key
revoked), there's a documented Plan B already vetted.

The maintainer holds a free-tier MapTiler API key (signed up May 2026) so
ad-hoc testing is possible without further setup.

---

## What MapTiler Cloud offers

| Service | URL pattern | Returns | Comparable to |
|---|---|---|---|
| **Raster map tiles** | `https://api.maptiler.com/maps/{style}/{z}/{x}/{y}.png?key=...` | PNG tile images | Mapbox Static Tiles |
| **Vector map tiles** | `https://api.maptiler.com/maps/{style}/style.json?key=...` | Mapbox-style JSON | Mapbox vector |
| **Static maps** | (separate endpoint, paid tier+) | Single composite PNG | Mapbox Static Images |
| **Forward geocoding** | `https://api.maptiler.com/geocoding/{query}.json?key=...` | GeoJSON FeatureCollection | LocationIQ search |
| **Reverse geocoding** | `https://api.maptiler.com/geocoding/{lon},{lat}.json?key=...` | GeoJSON FeatureCollection | LocationIQ reverse |
| **IP geolocation** | `https://api.maptiler.com/geolocation/ip.json?key=...` | `{latitude, longitude, city, region, region_code, country, country_code, country_languages, timezone, country_bounds, continent, continent_code, eu, postal}` | ipapi.co |

All endpoints share the same `?key=API_KEY` authentication pattern — no
JWT, no signed-URL dance, no per-request expiry. Drop-in friendly.

## Free tier — fits our fleet?

| Resource | Free tier limit | Our typical fleet usage | Headroom |
|---|---|---|---|
| Tile requests / month | **100,000** | ~30k (7 Pis, mostly cached) | 3× |
| Geocoding requests | counted in same quota | ~50/month (only on map pan) | huge |
| Storage | 100 MB / 1 file | not used | N/A |
| Map sessions | 5,000 / month | hard to estimate; ours is "always on" | should be fine for 7 Pis |
| Commercial use | **❌ Not permitted on free tier** | Hobbyist family / friend use | OK as long as we stay non-commercial |
| Attribution | "MapTiler logo on the map" required | Easy to add | OK |

**Verdict on the free tier**: comfortable for our 7-Pi family fleet.
The "no commercial use" clause is the only real watch-out — if the
project ever gets used in a paid kiosk product or commercial deployment,
the free tier becomes off-limits and the Flex tier ($25/month, 500k tile
requests) would be the next step. For our actual situation, free is fine.

## Service-by-service comparison

### Map tiles — vs Mapbox

**Available styles** (slugs as of May 2026):
- `streets-v4` — comprehensive street map with 3D buildings (similar to Mapbox `streets-v12`)
- `base-v4` — clean general-purpose map with admin borders + building footprints (similar to Mapbox `light-v11`)
- `outdoor-v4` — topographic with contour lines, trails, outdoor POIs (Mapbox doesn't have a direct equivalent — closest is `outdoors-v12` paid)
- `hybrid-v4` — satellite + labels (similar to Mapbox `satellite-streets-v12`)

**What we'd lose** if we swapped Mapbox for MapTiler:
- The exact `streets-v12` palette/typography we tuned the InfoPanel cream
  background against (`rgb(238, 236, 232)`). MapTiler's `streets-v4` is
  similar in family but a different colour cast.
- The `light-v10` / `light-v11` / `dark-v10` / `dark-v11` granularity —
  MapTiler's catalogue is flatter (no separate light/dark variants of
  the same style). Dark mode would need either a custom MapTiler style
  or to live with `base-v4` rendered with the existing client-side CSS
  filters.

**What we'd gain**:
- `outdoor-v4` would be a genuine new option for users who want a topo
  basemap (some kiosk owners might prefer it for hiking / cottage use).
- More generous free tier (100k vs Mapbox's ~50k for a hobbyist tier).

**Integration effort**: ~2-3 hours. Server-side `proxyCtrl.js` already
gates style requests through an `ALLOWED_STYLES` whitelist; adding a
`maptiler:` prefix or a separate route (`/api/tiles-maptiler/...`) plus
the `mapTilerApiKey` setting key is mostly mechanical. The new style IDs
plug into the existing light-mode / dark-mode style picker in Advanced
settings.

### Geocoding — vs LocationIQ

**Functional parity**: yes for our use case. We only use reverse
geocoding (lat/lon → human-readable place name), and MapTiler's response
shape is GeoJSON which is straightforward to parse.

**Differences worth noting**:
- MapTiler returns up to **20 languages** simultaneously via
  `language=fr,en,es` — handy for the i18n surface, no longer need to
  re-query when the user switches language (LocationIQ does one
  language at a time).
- MapTiler's `proximity=ip` parameter automatically biases results to
  the requester's IP — useful for forward geocoding (search), not
  needed for the reverse path we use.
- LocationIQ's free tier is 5,000 req/day (~150,000/month). MapTiler's
  100k/month is across all services combined, so geocoding shares the
  budget with tiles. For our usage (tens of geocoding calls per month),
  this is academic.

**Integration effort**: ~1 hour. The `proxyReverseGeocode` controller
in `server/proxyCtrl.js` would grow a back-end selector (`locationiq`
default, `maptiler` opt-in) keyed off which API key is configured.
Same response-shape adapter pattern we already use elsewhere.

### IP geolocation — vs ipapi.co

**Functional parity**: yes, with bonuses. MapTiler returns lat/lon +
city + region + country + timezone — same as ipapi.co. Plus EU
membership status, official languages, country bounds, optional
elevation (with `elevation=true`). Most of the bonus fields aren't
useful for us, but the **timezone** is — currently we infer timezone
from lat/lon via `tz-lookup` client-side; MapTiler's geolocation
endpoint returns it directly, removing one client-side dependency.

**Differences**:
- ipapi.co is free with no key required. MapTiler needs the key — same
  one as for tiles + geocoding.
- ipapi.co rate-limit: 1k requests/day on free tier. MapTiler:
  100k/month combined. Both are fine for "one call per cold boot per
  Pi" usage.
- ipapi.co has a 30-day retry-with-backoff disk cache server-side
  already; MapTiler would slot in unchanged.

**Integration effort**: ~30 minutes. `geolocationCtrl.js` is a single
file and the response-shape adapter is trivial.

### Static maps, vector tiles, elevation — not currently used

The project doesn't use static map images (we render Leaflet client-side
from raster tiles), vector tiles (we use raster), or elevation. If a
future feature needs any of these, MapTiler offers them — Mapbox does
too. Not a deciding factor either way.

## PoC findings (May 2026 — empirical validation with a real key)

The maintainer's 20-character free-tier key was tested live against the
three services we'd potentially want. Results:

**IP geolocation** (`/geolocation/ip.json`)
- Coordinates returned for the test caller: 45.50884 / -73.58781
  (Montréal — same accuracy as ipapi.co, no degradation)
- `timezone` field returned directly (`America/Toronto`) — confirms we
  could remove the client-side `tz-lookup` dependency if we switched
- Documentation listed a `languages` field; the actual response field
  is **`country_languages`** (e.g. `["en", "fr"]`). Doc nit, harmless.
- Bonus fields not useful for us but free: `country_bounds`,
  `continent_code`, `region_code`, `eu`, `postal`.

**Reverse geocoding** (`/geocoding/{lon},{lat}.json`)
- Default response (no `language=` parameter) returns the locally-
  appropriate language — for Montréal, French place names with proper
  accents (`"Montréal, Québec"`). This is smarter than LocationIQ
  which always defaults to English without a language param.
- **Real architectural advantage uncovered:** `language=fr,en,es`
  returns all three languages simultaneously in a single call,
  exposed as parallel fields:
  ```
  text_fr / text_en / text_es
  place_name_fr / place_name_en / place_name_es
  ```
  With LocationIQ, supporting three languages requires three
  separate API calls (or accepting stale data on language switch).
  With MapTiler, the client can fetch once and switch languages
  instantly. **This alone is a meaningful UX win** if we ever
  migrate.
- Up to 10 results per call (`limit` parameter), 5 by default. We
  only use the first feature, so the limit is irrelevant.

**Raster tiles** (`/maps/{style}/256/{z}/{x}/{y}.png`)
- All four documented styles (`streets-v4`, `base-v4`, `outdoor-v4`,
  `hybrid-v4`) returned valid PNG 256×256 at zoom 7 over Montréal.
- File sizes: 15–22 KB per tile, all 8-bit colormap (slightly more
  compact than Mapbox's typical RGB encoding).
- Visual comparison vs Mapbox `streets-v12` at the same coordinates:
  - **`streets-v4`** is the closest equivalent in label density and
    road network rendering, but the palette is **more pastel /
    desaturated** than `streets-v12`'s warmer green-beige. Switching
    would require re-tuning the cream `rgb(238, 236, 232)` panel
    background — the current value would clash with the cooler
    palette.
  - **`base-v4`** is too sparse for a weather kiosk — minimal road
    labelling, no spatial reference for the user. Not a candidate.
  - **`outdoor-v4`** is the genuinely interesting one — surfaces
    lake names, terrain features, and outdoor POIs that Mapbox
    doesn't expose on its free tier. **Real differentiator** for
    users in rural / cottage / mountain settings, and Mapbox has no
    free-tier equivalent. Worth shipping as a 5ᵗʰ option in the
    Advanced settings style picker rather than a replacement for
    `streets-v12`.
  - **`hybrid-v4`** (satellite + labels) is technically functional
    but the radar overlay would compete with the satellite imagery,
    and many users find satellite basemaps fatiguing for daily use.
    Niche.

**Verdict shifts from the documentation pass:**
- The "we'd probably never need this" stance from the initial doc is
  wrong on one specific point: **`outdoor-v4` is a real new
  capability**, not just a parallel to existing tiles. Adding it as
  an *option* (not a replacement) is now a candidate medium-term
  enhancement — captured as a separate ROADMAP entry.
- For everything else (IP geo, geocoding, `streets-v4`, `base-v4`,
  `hybrid-v4`), the verdict stands: don't migrate today, the path
  is documented if needed.

## Additional exploration notes (May 2026)

A second pass via the public MapTiler maps gallery
([`maptiler.com/maps/`](https://www.maptiler.com/maps/)) surfaced a few
more details worth recording:

- **Active style catalogue.** All the explored styles
  (`streets-v4`, `base-v4`, `outdoor-v4`, `hybrid-v4`) carry a "new"
  tag in the gallery — MapTiler refreshed its style line-up recently,
  which is a positive signal for a Plan B (the catalogue is being
  maintained, not abandoned).
- **At continental zoom, `streets-v4` reads cleanly.** Quebec /
  Montréal / Trois-Rivières / Ottawa / Toronto / Albany / Boston
  labels are all legible at zoom ~5-6 with the typical kiosk-distance
  legibility we'd want. Province / state borders are present but
  discreet (good — not visually noisy).
- **Style gallery filter** ("Popular" dropdown in the gallery sidebar)
  hints at additional style categories beyond the four PoC'd. If
  someone ever needs a style not covered above, the gallery is the
  place to look first — every style there inherits the same
  `https://api.maptiler.com/maps/{slug}/...` pattern as our four.
- **Custom-styled maps under your account.** The "USE THIS MAP"
  button in the gallery exposes a customisation workflow: tweak
  colours / fonts / labels and host the result under your account
  with its own slug. Useful if we ever wanted to tune `outdoor-v4`'s
  palette specifically against the kiosk's cream panel
  (`rgb(238, 236, 232)`) instead of relying on its default colours.
  Not a priority; flagged as an option if visual tuning becomes a
  requirement.
- **URL conveniences.** The gallery's URL carries
  `lang=auto&mode=2d&position={zoom}/{lat}/{lon}`, which gives a
  shareable preview link for any style at a specific viewport — handy
  when comparing across people or sessions, e.g. *"check the kiosk
  area in `outdoor-v4`: [link]"*.

## MapTiler Weather (evaluated separately, ruled out)

MapTiler also publishes a weather product
([`maptiler.com/weather/`](https://www.maptiler.com/weather/)) covering
six layers — temperature, wind, radar, precipitation, cloud cover,
pressure — included in the same Cloud free tier. **It is not a fit for
our use case** for two reasons:

1. **Update cadence is 6 hours** ("Data in hourly intervals, updated
   every 6 hours"). Our radar pipeline polls RainViewer every 5
   minutes for tile updates and runs `/api/radar-risk` analyses every
   5 minutes on top of that. Substituting a 6-hour-stale source
   would silently turn the radar from "what's happening right now"
   into "what was happening six hours ago" — the wrong direction.
   Spatial resolution is also worse (28 km vs RainViewer's
   sub-kilometre tiles), which would smear typical Quebec storm
   cells (5-15 km wide) into invisible noise.
2. **SDK-only access.** The weather layers are exposed exclusively
   through the MapTiler SDK / MapLibre. There are no public tile-URL
   templates we could plug into Leaflet's `L.tileLayer()` the way we
   do with RainViewer's `tilecache.rainviewer.com/...`. Integrating
   would mean either swapping the entire map-rendering layer
   (multi-week refactor) or running both SDKs side-by-side
   (complexity / conflicts) or reverse-engineering tile URLs
   (probable ToS violation, fragile).

Where MapTiler Weather *could* be a good fit: a separate "5-day
forecast visualisation" companion app, where 6-hour cadence is fine
and the SDK lock-in is a feature rather than a constraint. Not in
scope for the current weather kiosk.

**Recorded so future-us doesn't repeat the evaluation.** Tomorrow.io
+ RainViewer remain the right combination for our real-time radar
use case.

## When would switching make sense?

**Stay on current providers if**:
- Mapbox / LocationIQ / ipapi.co continue to work fine within their
  current free tiers
- The maintainer has already-tuned styling (cream `rgb(238, 236, 232)`
  panel, dark-mode dashed-circle weights) calibrated against the
  current Mapbox basemaps

**Switch to MapTiler if**:
- One of the current providers raises prices or revokes the free tier
- A user wants the **outdoor / topo** basemap that Mapbox doesn't offer
  on the free tier — adding MapTiler as a parallel option (not a
  replacement) covers that without losing the current setup
- Geographic coverage gap: a user reports that Mapbox tiles for their
  region are stale or low-resolution and MapTiler is better there
- Diversification for resilience: if multiple kiosks experience a
  Mapbox outage simultaneously, having MapTiler ready as a runtime
  fallback would mean adding a tiny circuit-breaker in `proxyCtrl.js`

**Don't switch if**:
- The project ever transitions to any commercial / paid offering. The
  free tier explicitly forbids this; the cheapest tier that does is
  $25/month (Flex), which is more than the project has ever cost.

## Caveats

- **Commercial-use restriction on free tier** — the line worth
  double-checking before any wider deployment. For a personal /
  family / friend hobbyist fleet (the actual current use), it's fine.
- **Attribution required on free tier** — "MapTiler logo on the map".
  Leaflet attribution control already supports adding a string; the
  same pattern we use today for `© Mapbox / © RainViewer` would just
  add `© MapTiler` next to them.
- **Sessions vs requests** — MapTiler counts "map sessions" (a user
  loading the page) separately from "tile requests". Our kiosk-style
  always-on session arguably counts as one long session per day per
  Pi, so 7 sessions/day × 30 days = 210/month, well below the 5,000
  free-tier session cap.
- **No SLA on free tier** — fine for non-critical hobby use; if it
  goes down briefly, the kiosk shows the last cached tile and recovers
  on its own.

## TL;DR

For our current situation: we don't need MapTiler. Our existing
providers are working, their free tiers are nowhere near saturated, and
the styling is tuned to Mapbox.

For future-proofing: MapTiler's free tier would comfortably cover the
fleet, the API surface is similar enough that integration is a few
hours per service, and adding it as an *alternative* (not a replacement)
in the existing settings/style selectors is the lowest-risk pattern. If
diversification ever becomes a real concern, the API key is in hand
and the integration paths are documented above — no further research
needed before starting work.

---

*Document last verified against MapTiler docs and pricing on the date of
the last commit modifying this file. URL patterns and free-tier limits
are subject to MapTiler updates — re-verify before relying on the
specific numbers.*
