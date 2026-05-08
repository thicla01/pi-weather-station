# Environment Canada radar — options reference

Reference document for the Environment Canada radar layer wired in v2.13 (PR #55) as an alternative to RainViewer. Captures the concrete WMS options the kiosk could expose so a future setting expansion or Phase B port doesn't need to re-research from scratch.

**Last verified:** 2026-05-08 against `geo.weather.gc.ca/geomet` WMS GetCapabilities.

## Endpoint

| | |
|---|---|
| **Base URL** | `https://geo.weather.gc.ca/geomet` |
| **Service** | WMS 1.3.0 |
| **Authentication** | None — `<AccessConstraints>None</AccessConstraints>` |
| **Rate limits** | None published |
| **Attribution** | "Radar courtesy Environment Canada" (per ECCC terms of use) |
| **Owner** | Government of Canada, ECCC, Meteorological Service of Canada |
| **Max image dimensions** | 16384 × 16384 px (we request 256 × 256) |

OGC API Coverages parallel endpoint at `api.weather.gc.ca` exists for raw-value access — out of scope for this document, relevant for the eventual Phase B analyzer port.

## Available radar layers

GetCapabilities exposes **5 radar-related layers**. No nowcast/forecast layer exists for radar — the time dimension only covers the last ~3 hours of observed frames. The "Forecast" / "Predict" / "Extrap" string searches in the capabilities return Numerical Weather Prediction layers (HRDPA, RAQDPS, RDPS) which are model output, not radar nowcasting.

| Layer | Title | Units | Time dim | Use case |
|---|---|---|---|---|
| `RADAR_1KM_RRAI` | Radar precipitation rate for rain | mm/h | rolling ~3h, 6-min step | **Default for the kiosk's ECCC mode (v2.13).** Primary visual layer year-round; conceptually equivalent to RainViewer's tile. |
| `RADAR_1KM_RSNO` | Radar precipitation rate for snow | cm/h | rolling ~3h, 6-min step | Winter alternative. Same data conversion to snow rate via reflectivity → cm/h formula. Could be auto-selected by the `SfcPrecipType` layer. |
| `Radar_1km_SfcPrecipType` | Surface precipitation type | categorical (rain / snow / mixed / etc.) | rolling ~3h, 6-min step | Diagnostic layer that classifies *what kind* of precipitation each pixel represents. Useful for the `auto rain-vs-snow source switch` Phase C idea. |
| `RADAR_COVERAGE_RRAI` | Dynamic radar coverage for rain | n/a | rolling ~3h, 6-min step | Polygons showing which radar sites are currently reporting rain data. Useful as a debug overlay (a kiosk in a coverage hole would otherwise show a blank radar without explanation). |
| `RADAR_COVERAGE_RSNO` | Dynamic radar coverage for snow | n/a | rolling ~3h, 6-min step | Same as above for snow. |

The mosaic uses **DPQPE (Dual-Pol Quantitative Precipitation Estimation)** for S-Band Canadian radars; for US Nexrad radars, ECCC ingests the closest equivalent NOAA product. Resolution is 1 km horizontally over a North-American composite of up to 180 contributing radars (32 Canadian + ~150 American).

## Styles per layer

WMS lets the client pick a named style via the `STYLES=` parameter. The current code passes no style → server picks the first one (`Radar-Rain_14colors`). Styles for `RADAR_1KM_RRAI` and `RADAR_1KM_RSNO` follow parallel naming.

### `RADAR_1KM_RRAI` (16 styles)

Three orthogonal axes:

- **Granularity** — `8colors` (coarse, glance-friendly) vs `14colors` (fine, more visual detail).
- **Continuity** — default (smooth gradient) vs `_Dis` suffix (discrete bands like Météo Média / Weather Channel).
- **Scale** — log (default) vs `-LINEAR` suffix.

Plus localised legends — styles ending in `_Fr` ship a French legend graphic.

| Style name | Granularity | Continuity | Scale | Legend |
|---|---|---|---|---|
| `Radar-Rain_14colors` | 14 | continuous | log | EN |
| `Radar-Rain_Dis-14colors` | 14 | discrete | log | EN |
| `Radar-Rain_Dis-14colors_Fr` | 14 | discrete | log | FR |
| `Radar-Rain_8colors` | 8 | continuous | log | EN |
| `Radar-Rain_Dis-8colors` | 8 | discrete | log | EN |
| `Radar-Rain_Dis-8colors_Fr` | 8 | discrete | log | FR |
| `Radar-Rain` | default | continuous | log | EN |
| `Radar-Rain_Dis` | default | discrete | log | EN |
| `RADARURPPRECIPR14` | 14 | continuous | log | EN (alt naming) |
| `RADARURPPRECIPR14-LINEAR` | 14 | continuous | linear | EN |
| `RADARURPPRECIPR14_Fr` | 14 | continuous | log | FR |
| `RADARURPPRECIPR8` | 8 | continuous | log | EN |
| `RADARURPPRECIPR8-LINEAR` | 8 | continuous | linear | EN |
| `RADARURPPRECIPR8_Fr` | 8 | continuous | log | FR |
| `RADARURPPRECIPR` | default | continuous | log | EN |
| `RADARURPPRECIPR-LINEAR` | default | continuous | linear | EN |

The `Radar-Rain*` and `RADARURPPRECIPR*` style families render the same underlying data but with subtly different colour ramps. Side-by-side comparison is the only way to pick a favourite — the data is identical.

### `RADAR_1KM_RSNO` (16 styles)

Same structure, with `Snow` / `RADARURPPRECIPS` substituted:

```
Radar-Snow_14colors             Radar-Snow_Dis-14colors        Radar-Snow_Dis-14colors_Fr
Radar-Snow_8colors              Radar-Snow_Dis-8colors         Radar-Snow_Dis-8colors_Fr
Radar-Snow                      Radar-Snow_Dis
RADARURPPRECIPS14               RADARURPPRECIPS14-LINEAR       RADARURPPRECIPS14_Fr
RADARURPPRECIPS8                RADARURPPRECIPS8-LINEAR        RADARURPPRECIPS8_Fr
RADARURPPRECIPS                 RADARURPPRECIPS-LINEAR
```

### `Radar_1km_SfcPrecipType` (2 styles)

| Style | Notes |
|---|---|
| `SfcPrecipType_Dis` | Categorical bands — rain / snow / mixed / etc., EN legend |
| `SfcPrecipType_Dis_Fr` | Same, FR legend |

### `RADAR_COVERAGE_RRAI` and `RADAR_COVERAGE_RSNO` (6 styles each, identical sets)

Coverage polygons rather than precipitation rates — three colour variants × outline-or-fill:

| Style | Visual |
|---|---|
| `Radar-Coverage_BlackOutline` | Black outline only |
| `Radar-Coverage_BlueOutline` | Blue outline only |
| `Radar-Coverage_BlueFill` | Blue translucent fill |
| `RADAR_COVERAGE_BLACK-OUTLINE` | (alt naming, same as above) |
| `RADAR_COVERAGE_BLUE-OUTLINE` | (alt naming) |
| `RADAR_COVERAGE_BLUE-FILL` | (alt naming) |

## Time dimension

Each radar layer exposes its time dimension in WMS 1.3.0 syntax:

```
<Dimension name="time" units="ISO8601" default="2026-05-08T02:54:00Z" nearestValue="0">
  2026-05-07T23:54:00Z/2026-05-08T02:54:00Z/PT6M
</Dimension>
```

Reading: rolling **3-hour window**, **6-minute step**, default = most recent frame. `nearestValue="0"` means the server snaps the user-supplied `TIME=` to the closest available frame (vs `nearestValue="1"` which would interpolate).

| | |
|---|---|
| **History depth** | ~3 hours (= 30 frames at 6-min steps) |
| **Step** | 6 minutes (`PT6M` ISO 8601 duration) |
| **Default** | most recent frame |
| **Forecast / nowcast** | None — the dimension's upper bound is "now" |

### Querying a specific frame

Pass `TIME=` in the params (Leaflet's `WMSTileLayer` accepts arbitrary keys via `params`):

```js
<WMSTileLayer
  url="https://geo.weather.gc.ca/geomet"
  params={{
    layers: "RADAR_1KM_RRAI",
    format: "image/png",
    transparent: true,
    version: "1.3.0",
    time: "2026-05-08T02:24:00Z",  // ← 30 min ago
  }}
/>
```

Phase B's WMS-time-dimension scrubber would map a frame index `i ∈ [0, 30]` to a timestamp `now - 6·(30-i) min` and re-mount the layer (or call `setUrl()` on the underlying Leaflet layer) on each scrub.

## Geographic coverage

```
<EX_GeographicBoundingBox>
  <westBoundLongitude>-170.320000</westBoundLongitude>
  <eastBoundLongitude>-50.000000</eastBoundLongitude>
  <southBoundLatitude>16.930000</southBoundLatitude>
  <northBoundLatitude>67.190000</northBoundLatitude>
</EX_GeographicBoundingBox>
```

Covers continental US, Canada, Alaska, the Caribbean, and parts of northern Mexico / the Bahamas. Outside this bbox the WMS returns transparent tiles. **Not suitable for a non-North-American kiosk** — the Mexico/Caribbean coverage drops off sharply south of ~25°N and the European, Asian, African user gets blank tiles.

## Coordinate systems supported

The capabilities lists ~120 CRSes (mostly Canadian projection variants). The two relevant for a Leaflet client:

| EPSG | Name | Use |
|---|---|---|
| **EPSG:3857** | Web Mercator | **Leaflet default** — what we currently use |
| EPSG:4326 | WGS84 lat/lon | Standard geographic; works but Leaflet would project to Mercator anyway |
| EPSG:102100 | Web Mercator (legacy ESRI) | Equivalent to 3857; some older clients prefer this |

No action needed — the WMSTileLayer in WeatherMap doesn't pass a `crs` parameter, so it defaults to the map's `crs` (EPSG:3857).

## Image formats

Supported response formats (`<Format>` entries on the GetMap operation):

- `image/png` — what we use; supports transparency
- `image/jpeg` — smaller wire size, no transparency
- `image/webp` — smaller still, supports transparency, less universally supported in older browsers

**Recommendation:** keep `image/png` for the kiosk. WebP would shave bandwidth but Chromium ≤ Bullseye era has had issues with WebP transparency in some contexts and the wire savings are negligible on a LAN-cached deployment.

## How this maps to the current code

Current implementation in [`client/src/components/WeatherMap/index.js`](../client/src/components/WeatherMap/index.js):

```js
{radarSource === "eccc" ? (
  <WMSTileLayer
    attribution='Radar courtesy <a href="...">Environment Canada</a>'
    url="https://geo.weather.gc.ca/geomet"
    params={{
      layers: "RADAR_1KM_RRAI",
      format: "image/png",
      transparent: true,
      version: "1.3.0",
    }}
    opacity={dark ? radarOpacityDark : radarOpacityLight}
  />
) : ...}
```

Three properties are implicit (server defaults): `STYLES` → first listed (`Radar-Rain_14colors`); `TIME` → most recent frame; `CRS` → inherits from the Leaflet `MapContainer` (EPSG:3857).

### To swap the style

Add a `styles` key to `params`. Examples:

```js
// Discrete 14-color bands, French legend
params={{ ..., styles: "Radar-Rain_Dis-14colors_Fr" }}

// Coarse 8-color glance view
params={{ ..., styles: "Radar-Rain_8colors" }}

// Linear scale (less log compression)
params={{ ..., styles: "RADARURPPRECIPR14-LINEAR" }}
```

If the project ever exposes this as a setting, the natural shape is a `radarSourceEcccStyle` localStorage key with a curated list of 3-5 styles in the UI (full 16 is too many for a kiosk toggle).

### To switch rain → snow seasonally

Two paths, neither implemented today:

1. **Manual setting** — `radarSourceEcccProduct` toggle (`rain` / `snow`), persisted alongside `radarSource`.
2. **Auto-select via `Radar_1km_SfcPrecipType`** — query that layer at the kiosk's coordinates each minute, switch to RSNO when the dominant type is snow. More elegant; needs a per-pixel WMS GetFeatureInfo call (which is supported by GeoMet but adds round-trip cost).

## Comparison vs RainViewer

| Axis | RainViewer | ECCC GeoMet |
|---|---|---|
| **Cadence** | ~10 min | **6 min** |
| **History** | 10 past frames + 3 nowcast (~3 h total) | last 3 h, no nowcast |
| **Coverage** | Global | North America only (bbox above) |
| **Authority** | Commercial aggregate | Source-of-truth (Canadian government, US NOAA) |
| **Style options** | None — fixed palette | 16 named styles (rain), 16 (snow), 2 (precip type), 6 (coverage) |
| **Snow/rain separation** | No (intensity only) | **Yes** — distinct layers + `SfcPrecipType` classifier |
| **Format** | Pre-rendered PNG tiles via CDN | Dynamic WMS GetMap (server-side rendered) |
| **Auth / key** | None | None |
| **Rate limits** | Unspecified, 256×256 tile pipeline | Unspecified, dynamic render |
| **Suitable analyzer source** | **Yes (current)** — pixel-decoded intensity | TBD — Phase B work; OGC API Coverages may expose raw values |
| **Time-dimension API for scrubbing** | RainViewer's frame URLs (`{path}/{z}/{x}/{y}`) | WMS `TIME=` parameter |

## Phase B implications and known gaps

Captured in `ROADMAP.md` under "🇨🇦 Environment Canada radar source" — this section makes the gap between today's Phase A and the eventual Phase B concrete:

- **No nowcast frames.** RainViewer ships 3 short-range forecast frames driving the timeline scrubber's amber portion. ECCC has no equivalent for radar — the time dimension's upper bound is "now". Phase B's scrubber will lose the +0..+30 min preview unless we hybrid-pull it from RainViewer.

- **Analyzer port.** The kiosk's tier/trend/AlertBanner pipeline depends on RainViewer's PNG palette being decodable pixel-by-pixel into a 0-7 intensity scale ([`server/radarAnalyzerCtrl.js`](../server/radarAnalyzerCtrl.js), see [`docs/radar-classification.md`](radar-classification.md)). To port to ECCC the cleanest route is **OGC API Coverages** at `api.weather.gc.ca` for raw mm/h precipitation-rate values, sampled at the kiosk's geometry. Whether that endpoint exposes per-point queries efficiently is **not yet verified** — research and a small spike are pre-requisites before Phase B starts.

- **Auto-source switching.** Today's setting is manual per-kiosk. Phase B should auto-default to ECCC for kiosks geolocated inside Canada (per `req.ip` + bbox check or the existing `geolocationCtrl.js` cache), RainViewer outside.

- **Coverage-hole UX.** ECCC's `RADAR_COVERAGE_RRAI` layer is the right input for a "no data here" diagnostic — a kiosk inside a coverage gap currently sees a blank ECCC layer and has no way to know it's a coverage issue rather than a clear-sky reading. Worth surfacing in the small-screen layout as a faint overlay or a banner.

## See also

- [`docs/radar-classification.md`](radar-classification.md) — how RainViewer's pixel classification works today (the system that Phase B would mirror for ECCC).
- [`ROADMAP.md`](../ROADMAP.md) → "🇨🇦 Environment Canada radar source as an alternative to RainViewer" — Phase A done, Phase B deferred.
- ECCC's official documentation: [GeoMet WMS overview](https://eccc-msc.github.io/open-data/msc-geomet/readme_en/) and [the radar registry on GitHub](https://github.com/ECCC-MSC/geomet-data-registry).
