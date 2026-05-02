# Radar pixel classification

How a RainViewer tile pixel becomes a coloured ring, dot, or AI-summary
intensity label. This is the reference for revisiting the algorithm
later — every threshold and palette entry that shapes the output is
called out here so a future change can be evaluated against the
current behaviour.

## Pipeline at a glance

```
RainViewer tile (PNG)
        │
        │  ① latLonToTilePixel — Web-Mercator projection
        ▼
  (tileX, tileY) + (pixelX, pixelY)
        │
        │  ② getTile / fetchTile — cached PNG decode
        ▼
   pngjs PNG buffer
        │
        │  ③ readPixelIntensity — 3×3 neighbourhood, max
        ▼
  intensity 0–6
        │
        │  ④ RISK_LEVELS — server tier mapping
        ▼
  "calm" | "yellow" | "orange" | "red"
        │
        │  ⑤ RING_RISK_STYLE / DOT_COLOR_BY_TIER — client palette
        ▼
   stroke / fill colour on the map
```

All five steps live in two files: `server/radarAnalyzerCtrl.js`
(steps ① – ④) and `client/src/components/WeatherMap/index.js`
(step ⑤). The `RISK_LEVELS` array on the server and the matching
`tierForIntensity` helper on the client must stay in lockstep.

## ① Tile coordinates

`latLonToTilePixel(lat, lon)` projects the sample's lat/lon to a
Web-Mercator (`ZOOM = 7`, `TILE_SIZE = 512`) tile + pixel offset.
Zoom 7 is RainViewer's max native zoom for radar tiles — going
higher would just upscale the same pixel data.

## ② Tile fetch + decode

Tiles are pulled from `https://tilecache.rainviewer.com…/512/{z}/{x}/{y}/6/1_1.png`.
The `/6/` segment selects **NEXRAD Level III colour scheme 6** —
that's the palette we match pixels against in step ③, so changing it
would invalidate the matching table.

Tiles are cached for 12 minutes per `(framePath, tileX, tileY)` —
RainViewer refreshes radar every ~10 minutes, so most polls hit the
cache.

## ③ Pixel → intensity (the noisy step)

`readPixelIntensity(png, x, y)` reads the **3×3 pixel window** around
the target pixel and returns the worst-case (max) intensity. Each of
the 9 pixels goes through `pixelToIntensity(r, g, b, a)`:

1. **Transparency check** — if `a < ALPHA_THRESHOLD` (32), return 0.
   RainViewer tiles are mostly transparent except where there's
   precipitation, so this is the common path.

2. **Nearest-neighbour palette match** — squared Euclidean distance
   in RGB space against each `INTENSITY_PALETTE` entry. The entries
   mirror the NEXRAD Level III scheme exactly:

   | Level | Label       | R   | G   | B   |
   |------:|-------------|----:|----:|----:|
   |     1 | very light  |   0 | 208 | 208 | (cyan)
   |     2 | light       |   0 | 200 |   0 | (green)
   |     3 | moderate    | 240 | 230 |   0 | (yellow)
   |     4 | heavy       | 240 | 130 |   0 | (orange)
   |     5 | very heavy  | 230 |   0 |   0 | (red)
   |     6 | extreme     | 120 |   0 | 180 | (purple)

3. **Distance threshold** — if the best palette match has squared
   distance > `MAX_COLOR_DIST_SQ` (14 000), return 0. This rejects
   anti-aliasing pixels at band boundaries that would otherwise be
   pulled into the wrong level.

The 3×3 max is what makes a probe inside a precipitation band
register the band's intensity even when the exact target pixel landed
in an anti-aliased edge or a 1-pixel transparent gap — this is the
fix for the "black dot in a clearly rainy zone" bug we hit before
v2.11.x. Cost is 9 reads per probe instead of 1; spatial dilution is
±1 pixel ≈ ±100 m at zoom 7, well below the geometry's 5-km step.

## ④ Intensity → risk tier (server-side)

`RISK_LEVELS = ["calm", "yellow", "yellow", "yellow", "orange", "red", "red"]`

So:

| Intensity | Tier   | RainViewer label                     |
|----------:|--------|--------------------------------------|
| 0         | calm   | clear                                |
| 1         | yellow | very light                           |
| 2         | yellow | light                                |
| 3         | yellow | moderate                             |
| 4         | orange | heavy                                |
| 5         | red    | very heavy                           |
| 6         | red    | extreme                              |

The dashed circles' tier is the **max** over all sample points on the
ring (worst-case approach — emergency-management practice). Per-point
dots use each point's own intensity instead, so the dot palette and
the ring tier can disagree (a single severe sample is enough to flip
the whole ring red).

## ⑤ Tier → display colour (client-side)

Two palettes:

- **`RING_RISK_STYLE`** — colours and stroke weights for the dashed
  circles. Light mode wraps the bright stroke in a dark continuous
  outline (see `buildRingLayers`) so the radar-tile yellow doesn't
  drown against the cream basemap.
- **`DOT_COLOR_BY_TIER`** — colours for the per-point overlay dots.
  Light mode also gets a dark outline around the dot fill so an
  orange dot on an orange radar tile still reads.

Both palettes share `#f0e600` / `#f08200` / `#e60000` for yellow /
orange / red — same as the radar tile colours, so the overlays speak
the same visual language as the underlying radar. The dark-mode calm
neutral (`#a8a097`) was tuned away from near-white so it doesn't read
as "alarm" against the dark basemap.

## Known limitations

- **Single colour scheme.** The matcher is hard-wired to RainViewer
  colour scheme 6. Switching schemes (e.g. scheme 4, blue/green
  gradient) would require a new palette table.
- **No precipitation type.** RainViewer tiles encode intensity, not
  type — we can't tell rain from snow from hail. The AI summary's
  weather-code reasoning compensates indirectly.
- **No movement / trend.** Risk colour reflects "right now" only.
  Approaching cells get the same tier as cells already past their
  peak. The `getRiskLevels` controller fetches just the latest frame,
  while `analyzeRadar` (used by the AI summary) already pulls 3
  frames — v2 of the risk colouring would extend that to bump the
  tier on positive radial gradient ("orange that's heading inward
  becomes red"). See `ROADMAP.md` → "Trend-aware radar-risk
  colouring (v2)".
- **No spatial smoothing.** The 3×3 max handles anti-aliasing edges
  but not larger gaps. A 5×5 window would smooth more aggressively
  at the cost of further spatial dilution (±2 px ≈ ±200 m).
- **Worst-case can over-report.** A single bright pixel anywhere on
  the ring promotes the whole ring tier — by design, but worth
  recording as the trade-off.

## Possible improvements (revisit before changing)

- **Larger kernel (5×5 or 7×7)** — denser noise rejection. Would
  also widen the "effective" sample point on the map. Worth measuring
  the false-positive rate first.
- **Median instead of max** — less alarmist, would dampen single-
  pixel spikes from anti-aliasing artefacts. Risk: dampens real
  thin-band detections.
- **Multi-frame confidence** — use the existing 3-frame sequence to
  require an intensity to appear in ≥2 frames before counting. Would
  reduce flicker but add lag to genuine fast-moving cells.
- **Alternate palette** — RainViewer's scheme 8 (universal blue) has
  smoother gradients that might be more anti-alias-friendly. Trade-
  off: the on-screen radar overlay would need to switch too, which
  affects user familiarity.

These are noted because the current tuning landed by iteration on
real data; before swapping any of it, capture a few "weird-looking"
sample sequences to A/B against. A change that improves one scenario
often regresses another.
