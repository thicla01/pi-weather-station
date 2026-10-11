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
        │  ② getTile / fetchTile / decodeTile — fetch, refuse
        │     non-radar tiles, decode, classify every pixel (cached)
        ▼
  classified tile (one intensity 0–6 per pixel)
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

Steps ① – ④ live in `server/radarAnalyzerCtrl.js`, with the colour
table in `server/rainViewerPalette.js`. Step ⑤'s
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
Zoom 7 is RainViewer's maximum for radar tiles. Above it RainViewer
doesn't upscale: it answers HTTP 200 with a "Zoom Level Not
Supported" image (step ②). `test/rainViewerTiles.test.js` pins
`ZOOM` and `TILE_SIZE`, and the client layer's equivalent (Leaflet
zoom 8 with `zoomOffset -1` = z7 in the URL).

## ② Tile fetch + decode

Tiles are pulled from `https://tilecache.rainviewer.com…/512/{z}/{x}/{y}/2/1_1.png`,
the same URL shape as the client's radar layer:

- `/2/` selects **Universal Blue**, colour scheme 2. Since (at the
  latest) 2026-10-10 it is the only radar colour scheme RainViewer
  documents ([API colour schemes](https://www.rainviewer.com/api/color-schemes.html)),
  and a tile requested with scheme 2, 4, 6 or 8 comes back
  byte-identical. Until 2026-10 the app asked for scheme 6 (NEXRAD
  Level III) and matched pixels against NEXRAD colours, which
  misread the Universal Blue tiles it was getting (see "History"
  below).
- `1_1` is `{smooth}_{snow}`: smoothed, and snow drawn in Universal
  Blue's snow colours. With `_0` the same echoes come back in the
  rain colours at the same dBZ (checked on a snowy tile).

`decodeTile` refuses two kinds of response before they can read as
clear sky. The frame then counts as unavailable: the AI summary
loses it (and its radar paragraph when no frame is left, with the
reason in the snapshot), `/api/radar-risk` answers 503 when no frame
is left (the client keeps the rings' last colour), and a
`[radar] tile … refused` line is logged:

- **The "Zoom Level Not Supported" placeholder.** Past z7 RainViewer
  answers HTTP 200 with a translucent grey box and white text, a
  4-bit palette PNG (3,269 bytes) where radar tiles are 8-bit RGBA.
  Any palette-mode PNG is refused from its header, before decoding.
  Nothing requests z8 today; this is the safety net against a
  "correction" of the zoom.
- **A palette change.** A tile with `OFF_PALETTE_REJECT_PIXELS` (64)
  or more painted pixels whose colour is not in the table. Real tiles
  have none (below), so this means RainViewer changed how it draws.

An accepted tile is classified in one pass (`classifyTile`): every
pixel becomes its intensity level, and the cache keeps that byte
array (256 KB a tile) rather than the decoded RGBA (1 MB). Tiles are
cached for 60 minutes per `(framePath, tileX, tileY)`. A tile's
content never changes for a given frame path, so the TTL is only an
eviction policy; most polls hit the cache.

## ③ Pixel → intensity

RainViewer paints each pixel with the exact Universal Blue colour of
its reflectivity. The table (`server/rainViewerPalette.js`) is
RainViewer's published one (CSV linked from the colour-schemes page,
downloaded 2026-10-10): one RGBA value per dBZ from −10 to 95, for
rain and for snow, no colour shared between the two. On 20 zoom-7
tiles from five continents (2026-10-10, 2.48 M painted pixels) every
painted pixel was exactly one of those values: no anti-aliasing, no
blending. So the match is an exact lookup, colour → dBZ, then dBZ →
level through `DBZ_LEVEL_FLOORS`:

| Level | Label      | dBZ    | Tile colours                           | Ring tier |
|------:|------------|--------|----------------------------------------|-----------|
|     0 | clear      | < 10   | none, or the faintest beige            | calm      |
|     1 | very light | 10–19  | beige (59–75 % opaque), pale blue      | yellow    |
|     2 | light      | 20–34  | blue, darkening to navy                | yellow    |
|     3 | moderate   | 35–39  | yellow                                 | yellow    |
|     4 | heavy      | 40–44  | orange                                 | orange    |
|     5 | very heavy | 45–54  | red, darkening to maroon               | red       |
|     6 | extreme    | ≥ 55   | pink; white from 65, green from 75     | red       |

Snow uses the same dBZ and the same floors. Why these floors:

- **35, 45 and 55 dBZ are the palette's own colour jumps** (navy →
  yellow, orange → red, maroon → pink). **20 and 40** cut its
  continuous ramps where the blue turns full and the yellow turns
  orange. So the rings follow the tiles: an orange ring sits over
  orange tiles, a red ring over red or pink ones.
- **10 dBZ** (≈ 0.15 mm/h of rain) leaves out the faintest beige:
  weak echoes, drizzle at most and often not precipitation at all.
  Not every radar network reports them: real tiles hold about three
  times more pixels at exactly 10 dBZ than at 9, as if several
  networks clip there.
- In rain-rate terms (Marshall-Palmer), heavy (40 dBZ) starts near
  12 mm/h, close to the WMO's heavy-rain threshold (10 mm/h); very
  heavy (45 dBZ) near 24 mm/h; extreme (55 dBZ) near 100 mm/h.

Transparent and off-palette pixels read 0. The legend's six colours
(`--rc-tile-1…6`, see `WeatherMap/styles.css`) are one real tile
colour per level, at the middle of the level's dBZ range (level 1:
of its opaque 15–19 part; level 6: of its pink 55–64 band).

### History: the NEXRAD-era scale

Until 2026-10 the matcher compared each pixel to six NEXRAD colours
(cyan, green, yellow, orange, red, purple) by nearest RGB distance
(cut-off 14 000, alpha ≥ 32). On scheme-6 tiles that meant, in dBZ:

| Level | NEXRAD-era range | Universal Blue range |
|------:|------------------|----------------------|
|     1 | 0–11             | 10–19                |
|     2 | 18–32            | 20–34                |
|     3 | 33–42            | 35–39                |
|     4 | 43–47            | 40–44                |
|     5 | 48–62            | 45–54                |
|     6 | 63, 67–70        | ≥ 55                 |

with 12–17 and 64–66 dBZ falling through as clear. Against that
scale, the current floors start level 1 at 10 dBZ instead of 0 (the
faint beige stays clear), keep levels 2 and 3 within 2 dBZ, start
levels 4 and 5 3 dBZ lower (orange and red rings come a little
sooner), and call ≥ 55 dBZ extreme rather than ≥ 63.

Once RainViewer served only Universal Blue, the NEXRAD matcher
misread most of it. Measured on 18 real zoom-7 tiles (2026-10-10):
52 % of the pixels the current table calls light (20–34 dBZ, the
darker blues) read as clear, the rest as very light, so level 2
never occurred; every pixel at ≥ 55 dBZ (pink, white) read as clear;
and a quarter of the 45–54 dBZ reds read one level low (orange).
Rings, verdicts, `RADAR` alerts, the AI summary's radar paragraph and
the Sense HAT grid all under-reported. Nothing in the code noticed:
off-palette pixels silently read as clear, hence the palette-change
guard in step ②.

`readPixelIntensity(tile, x, y)` reads the **3×3 pixel window**
around the target pixel and returns the worst-case (max) level. That
is what makes a probe on the edge of a band, or in a one-pixel gap
inside it, register the band's intensity — the fix for the "black
dot in a clearly rainy zone" bug we hit before v2.11.x. Cost is 9
reads per probe instead of 1; spatial dilution is ±1 pixel ≈
±0.4–0.6 km at zoom 7 / 512-px tiles (≈ 611 m/px at the equator ×
cos(lat)), still below the geometry's 5-km step.

`test/radarPalette.test.js` holds the regression cases: real pixels
from a storm crop holding every rain colour from −10 to 60 dBZ and
from a snow crop, the colours the NEXRAD matcher dropped, the level
floors and the palette-change guard.

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
  outline (see `buildRingLayers`) so the bright yellow stroke doesn't
  drown against the cream basemap.
- **`DOT_COLOR_BY_TIER`** — colours for the per-point overlay dots.
  Light mode also gets a dark outline around the dot fill so an
  orange dot on an orange radar tile still reads.

Both palettes share `#f0e600` / `#f08200` / `#e60000` for yellow /
orange / red: the app's risk colours, not the tile palette. They
were taken from the NEXRAD tile colours the radar showed until
2026-10 and kept when the tiles turned Universal Blue; the level
floors (step ③) still make orange and red rings sit over orange and
red tiles, while yellow covers everything lighter, blues included.
The Sense HAT's LED tier colours (`RADAR_TIER_RGB` in
`tools/sensehat_weather.py`) are another per-device scale, tuned on
the matrix for legibility. The dark-mode calm
**ring** neutral (`#a8a097`) was tuned away from near-white so it
doesn't read as "alarm" against the dark basemap; calm dots stay
`#3a3938` (light) / `#f6f6f4` (dark).

`RING_RISK_STYLE` also has a third `nightRed` entry that stays in the
red family (`#a82828` / `#8c1818` / `#6b0808`, weights 4 / 5 / 7,
dashed `6 6` → `4 4` → solid). Calm rings are `#3a3938` (light) /
`#a8a097` (dark) / `#c04848` (nightRed), drawn at opacity 0.35 with
dash `"3 9"` when the AI summary is off.

## Known limitations

- **One colour scheme, verified by hand.** The table is RainViewer's
  published Universal Blue, copied on 2026-10-10. If RainViewer
  changes its colours again, the palette-change guard refuses the
  tiles (radar unavailable, a `[radar] tile … refused` log line) and
  the table in `server/rainViewerPalette.js` has to be redone from
  the new CSV. A change that only touched colours outside today's
  tiles would go unseen until those colours appear.
- **Precipitation type is decoded but unused.** With the snow option
  on, rain and snow have distinct colours, so the tiles do say which
  is which; the analyzer maps both to dBZ and ignores the type. The
  levels stay rain-centric: snow falls heavily at reflectivities that
  read light for rain (moderate snow is typically 20–30 dBZ), so snow
  tends to read a level below its impact. The AI summary's
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
  colouring — shipped May 2026" and `test/radarTrend.test.js`. They
  were tuned on NEXRAD-era intensities; level 2 now starts at 20 dBZ
  (18 before), so the "≥ 2" gates moved very little.
- **No spatial smoothing.** The 3×3 max handles band edges and
  one-pixel gaps but not larger ones. A 5×5 window would smooth more
  aggressively at the cost of further spatial dilution (±2 px ≈
  ±0.8–1.2 km).
- **Worst-case can still over-report.** The 3×3 max lets one bright
  pixel near a probe set that sample's intensity; with
  `TIER_HYSTERESIS_N = 2`, two such samples on a ring are enough to
  promote its tier.

## Possible improvements (revisit before changing)

- **Larger kernel (5×5 or 7×7)** — denser noise rejection. Would
  also widen the "effective" sample point on the map. Worth measuring
  the false-positive rate first.
- **Median instead of max** — less alarmist, would dampen single-
  pixel spikes. Risk: dampens real thin-band detections.
- **Multi-frame confidence** — use the existing 3-frame sequence to
  require an intensity to appear in ≥2 frames before counting. Would
  reduce flicker but add lag to genuine fast-moving cells.
- **Snow-aware levels** — the decoded type (above) could feed
  snow-specific floors, or tell the AI summary rain from snow. Needs
  its own thresholds and live cases to tune them.
- **Work in dBZ** — the classifier already knows each pixel's dBZ;
  carrying it instead of the 0–6 level would let the trend logic and
  the AI prompt use the finer scale. A larger change: the trend
  thresholds and `test/radarTrend.test.js` are written in levels.

These are noted because the current tuning landed by iteration on
real data; before swapping any of it, capture a few "weird-looking"
sample sequences to A/B against. A change that improves one scenario
often regresses another.
