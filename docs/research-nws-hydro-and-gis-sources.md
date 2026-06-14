# Research: NWS hydrologic data (NWPS) + US geospatial source landscape

> Captured from a technology-watch session (2026-06-14). **Not committed work** — this is
> reference material + a possible future feature (the NWPS hydrologic volet). The headline
> finding: everything here *validates* the current architecture rather than asking to change it.

---

## Part 1 — NWPS hydrologic data (potential future feature)

[NWPS](https://water.noaa.gov/) (National Water Prediction Service) is NOAA/NWS's river &
flood platform (replaced AHPS in 2024). It maps river-gauge flood status, flood-inundation
zones, and the National Water Model. Built on Esri/ArcGIS (basemaps + rendering); data from
NOAA's Office of Water Prediction + the 13 River Forecast Centers; raw gauge observations
from **USGS**.

### Public API (verified live, 2026-06-14)

- Base: `https://api.water.noaa.gov/nwps/v1/` — **public, no auth** (responses came back with
  no key), OpenAPI 3.0, JSON/XML.
- Endpoints (per the NWPS API flyer): `/gauges`, `/gauges/{id}`, `/gauges/{id}/ratings`,
  `/gauges/{id}/stageflow` (observed + forecast stage/flow).
- Data: official NWS streamflow forecasts, stream observations, National Water Model output,
  crest history, flood impacts, low-water history, **flood category levels**, location metadata.
- ⚠️ **NOAA caveat, important for a kiosk:** *"This API is not supported 24/7 and may be
  modified without advance notice."* — graceful degradation would be mandatory.

### Data model (read off the live map's layer panel)

Gauges carry a flood category for **both observation and forecast**:
**Major / Moderate / Minor / Action / No Flood** (+ "Flood Category Not Defined", "Low Water",
"Data Not Current", "Out of Service"). There is also a separate **Long Range Flood Outlook**
(probabilistic: "≥ X % chance of exceeding flood levels" per basin) — a *forecast*, not an
alert, and not something we ingest anywhere today.

### Coverage / quality caveats (the real limiters)

- **Observation ≫ forecast:** ~7,000 gauges report an *observation*, but only **~1,900** carry
  an official NWS *forecast*. The crest-forecast subset is much smaller than the gauge count.
- **~4,000 gauges are "Flood Category Not Defined"** (no thresholds → not categorizable) + ~800
  stale/out-of-service. Roughly half the network isn't usable for a clean flood-status readout.
- **US-only.** Zero Canadian coverage. The Canadian equivalent is ECCC hydrometric data
  (`wateroffice.ec.gc.ca`) — a separate integration.

### Open question (not resolved)

The **spatial-query syntax** for `/gauges` was not confirmed: `bbox=comma,form` → HTTP 400;
`bbox.xmin/ymin/xmax/ymax` → HTTP 200 but empty even over populated boxes; a guessed gauge id
(`TULO2`) → 404. The Swagger docs at `/nwps/v1/docs/` are JS-rendered (unreadable by fetch).
Resolve via the live Swagger or the API flyer PDF before any "nearest gauge to lat/lon" work.

### Possible feature shapes (if ever pursued)

1. **Nearest-gauge flood-status badge** — observed stage + forecast crest + category, in the
   AQI-badge idiom. Best fit for a flood-prone user (cf. k5map, who motivated the advisory-alerts
   toggle).
2. **Long Range Flood Outlook signal** — the probabilistic layer; richer but coarser.

### Why not now

US-only (no benefit to the Quebec-heavy fleet), no current user demand, the "not 24/7"
reliability flag, and we already surface flood **alerts** (warnings/advisories) via NWS + ECCC.
NWPS would add *measurements & forecasts*, a different tier — nice-to-have, not a gap.

---

## Part 2 — US geospatial source landscape (reference)

### The three NWS data-access channels — and which to depend on

| Channel | What | Stability | Auth | We use it for |
|---|---|---|---|---|
| **`api.weather.gov`** | JSON/GeoJSON REST | **stable, documented** | none (User-Agent) | alerts, zones (`affectedZones`), points |
| **OGC services** (`weather.gov/gis`) | WMS / WFS / WCS (GeoServer `opengeo.ncep.noaa.gov`, `radar.weather.gov`) | **stable, NOAA-hosted** | none noted | (ECCC radar uses the analogous GeoMet WMS) |
| **ArcGIS Hub items** (`*.opendata.arcgis.com`, `arcgis.com/item.html?id=…`) | Esri-hosted datasets / feature services | ⚠️ **unstable** — items get unpublished / permission-gated | varies | nothing — by design |

**Lesson (learned by hitting removed/permissioned Hub links):** reference a **stable documented
endpoint** (`api.weather.gov` or a `.noaa.gov` OGC service), **never an ArcGIS Hub item ID**.
Also prefer the authoritative NOAA-hosted copy over third-party re-hosts (a search for "NWS Public
Forecast Zones" surfaced a copy owned by `CA_Office_of_Emergency_Services_GIS` — a re-host that
can vanish). The authoritative NWS GIS home is the **NWS GeoHub**
(`geospatial-nws-noaa.opendata.arcgis.com`, org `NWS.IDP.GIS_noaa`): public forecast zones, county
warning areas, fire-weather zones, marine (coastal/offshore) zones, RFCs.

### US county / boundary GeoJSON sources (if ever needed)

| Source | Delivery | Vintage | Format | Notes |
|---|---|---|---|---|
| `eric.clst.org/tech/usgeojson` | static file | **2010** (stale) | GeoJSON | hobbyist conversion; FIPS renames already broke it |
| `census.gov` cartographic boundary files | static file | **2025** (current) | SHP / KML / GeoPackage — **no GeoJSON** | the authoritative firehose; you convert yourself |
| Esri "USA County Boundaries" Feature Service | **live REST service** | TIGER 2020 (pub. 2024) | query → GeoJSON | current-ish GeoJSON on demand; Esri-hosted dependency; TIGER = heavy |

### Two distinctions that recurred at every layer

- **Census counties ≠ NWS forecast zones.** Alerts reference **SAME/FIPS** counties (≈ Census
  counties) *and* **UGC forecast zones** (which subdivide counties — mountain/coast). The common
  polygon-less alert case is *zone*-based, so Census county GeoJSON does **not** resolve it. For
  zone geometry, use `api.weather.gov/zones/...` (runtime) or the NWS GeoHub (bulk). And NWS
  **actively redraws zones** ("Public Zone Reform" StoryMaps) → a static snapshot goes stale
  silently → our **dynamic per-alert `affectedZones` resolution** (cached 24 h) is the correct
  approach, not a bundled file.
- **US ≠ Canada.** Every source above is US-only. Canadian equivalents: ECCC
  (`api.weather.gc.ca`, GeoMet WMS) for alerts/radar/hydro; StatCan / NRCan for boundaries.

---

## Verdict

The week's exploration mapped the full geospatial supply chain behind North-American weather
(consumer apps → domain data → administrative geometry → providers) and, at every layer, surfaced
the same two boundaries our architecture already handles: **counties ≠ zones** and **US ≠ Canada**.
We already consume NWS optimally (`api.weather.gov` for alerts/zones; WMS for ECCC radar) and never
bind to a fragile vendor item page. **No action required.** This doc is the captured research for a
possible future **NWPS hydrologic volet** (see ROADMAP, long-term).
