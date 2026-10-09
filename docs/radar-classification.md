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
        │     (2nd-highest sample, trend bump)
        ▼
  "calm" | "yellow" | "orange" | "red"
        │
        │  ⑤ RING_RISK_STYLE / DOT_COLOR_BY_TIER — client palette
        ▼
   stroke / fill colour on the map
```

Steps ① – ④ live in `server/radarAnalyzerCtrl.js`. Step ⑤'s
palettes and helpers (`RING_RISK_STYLE`, `DOT_COLOR_BY_TIER`,
`tierForIntensity`, `buildRingLayers`) live in
`client/src/components/WeatherMap/geometry.js`; `RiskRing.js` draws
the rings and `index.js` draws the dots. The `RISK_LEVELS` array on
the server and the matching `tierForIntensity` helper on the client
must stay in lockstep — `test/radarGeometry.test.js` checks the
server table against a verbatim copy of the client helper, so a
change to `geometry.js` must also be made in that copy.

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

Tiles are cached for 60 minutes per `(framePath, tileX, tileY)`. A
tile's content never changes for a given frame path, so the TTL is
only an eviction policy; most polls hit the cache.

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
±1 pixel ≈ ±0.4–0.6 km at zoom 7 / 512-px tiles (≈ 611 m/px at the
equator × cos(lat)), still below the geometry's 5-km step.

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

The ring tier is decided in `getRiskLevels` from the **2nd-highest**
sample on the ring (`TIER_HYSTERESIS_N = 2`), not the single max, so
one rogue pixel can't escalate a ring. Samples in directions trending
"leaving" count one intensity lower (`effectiveIntensityFor`). The
tier is then bumped one notch (`TIER_BUMP`, red stays red) when the
ring trend is "approaching" and the tier intensity is
≥ `BUMP_MIN_INTENSITY` (2), using the 3-frame sequence now / −15 /
−45 min. `maxIntensity` is kept for diagnostics, and `bumped` is
returned per ring. Per-point dots use each point's own raw
latest-frame intensity, so the dot palette and the ring tier can
disagree in both directions (a lone severe dot on a yellow ring, or a
bumped red ring with no red dot).

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
**ring** neutral (`#a8a097`) was tuned away from near-white so it
doesn't read as "alarm" against the dark basemap; calm dots stay
`#3a3938` (light) / `#f6f6f4` (dark).

`RING_RISK_STYLE` also has a third `nightRed` entry that stays in the
red family (`#a82828` / `#8c1818` / `#6b0808`, weights 4 / 5 / 7,
dashed `6 6` → `4 4` → solid). Calm rings are `#3a3938` (light) /
`#a8a097` (dark) / `#c04848` (nightRed), drawn at opacity 0.35 with
dash `"3 9"` when the AI summary is off.

## Known limitations

- **Single colour scheme.** The matcher is hard-wired to RainViewer
  colour scheme 6. Switching schemes (e.g. scheme 4, blue/green
  gradient) would require a new palette table.
- **No precipitation type.** RainViewer tiles encode intensity, not
  type — we can't tell rain from snow from hail. The AI summary's
  weather-code reasoning compensates indirectly.
- **Coarse trend awareness.** Before May 2026 the risk colour was
  latest-frame only. Since then `getRiskLevels` samples the same
  3-frame sequence as `analyzeRadar` (now / −15 / −45 min) and bumps
  a ring one tier when the ring trend is "approaching" and its tier
  intensity is ≥ 2. A direction counts as approaching when its
  strongest sample (≥ 2 at both ends of the window) has shifted inward
  ≥ 5 km / 3 mi (inner ring) or ≥ 8 km / 5 mi (outer ring) and
  projected arrival is < 60 min; the ring takes the trend of its most
  intense direction, and samples in "leaving" directions count one
  level lower. These thresholds and `TIER_HYSTERESIS_N = 2` are
  empirical — see `ROADMAP.md` → "✅ Trend-aware radar-risk
  colouring — shipped May 2026" and `test/radarTrend.test.js`.
- **No spatial smoothing.** The 3×3 max handles anti-aliasing edges
  but not larger gaps. A 5×5 window would smooth more aggressively
  at the cost of further spatial dilution (±2 px ≈ ±0.8–1.2 km).
- **Worst-case can still over-report.** The 3×3 max lets one bright
  pixel near a probe set that sample's intensity; with
  `TIER_HYSTERESIS_N = 2`, two such samples on a ring are enough to
  promote its tier.

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
