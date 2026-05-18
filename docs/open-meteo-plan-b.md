# Open-Meteo — Plan B for the weather data source

This doc captures a proof-of-concept evaluation of [Open-Meteo](https://open-meteo.com/) as a possible replacement for Tomorrow.io. It's a vetted reference, **not** an active integration plan. If Tomorrow.io ever becomes problematic (quota, price, availability), this is the prepared fallback.

## TL;DR

- **Free, no API key required** (10 000 calls/day on the non-commercial tier — well above our 96/day at the current 15 min polling cadence).
- **One call returns current + hourly + daily** (vs Tomorrow.io's three separate endpoints).
- **No commercial use on the free tier.** Open-source / personal kiosk usage is explicitly allowed; selling the integration would require a commercial plan.
- **Weather codes are WMO 0-99** (~30 codes) vs Tomorrow.io's ~80-code proprietary set. Mapping is best-effort; some granularity is lost (e.g. "light snow mixed with rain" collapses).
- **Sunrise/sunset returned per day** in the daily block — we could retire sunrise-sunset.org entirely, removing one external dependency.
- **`is_day` flag in current** — useful for the dusk/night palette decision.

## Live PoC endpoint

A side-by-side comparison adapter ships in [`server/openMeteoCtrl.js`](../server/openMeteoCtrl.js) and is mounted at `GET /api/weather/openmeteo?lat=...&lon=...&tz=...`. The response is shaped identically to the three Tomorrow.io proxy endpoints (`data.timelines[0].intervals[]`) so a client can compare values directly without re-normalising:

```bash
# Tomorrow.io (existing)
curl -sk "https://localhost:8443/api/weather/current?lat=45.5&lon=-73.6"

# Open-Meteo (PoC adapter)
curl -sk "https://localhost:8443/api/weather/openmeteo?lat=45.5&lon=-73.6"
```

Quick comparison snippet (Montreal, current conditions):

```bash
python3 <<'EOF'
import json, subprocess
def get(u): return json.loads(subprocess.check_output(["curl","-sk", u]))
t  = get("https://localhost:8443/api/weather/current?lat=45.5&lon=-73.6")["data"]["timelines"][0]["intervals"][0]["values"]
om = get("https://localhost:8443/api/weather/openmeteo?lat=45.5&lon=-73.6")["current"]["data"]["timelines"][0]["intervals"][0]["values"]
print(f"{'Field':<24}{'Tomorrow.io':>14}{'Open-Meteo':>14}")
for k in ["temperature","humidity","windSpeed","cloudCover","uvIndex","weatherCode"]:
    print(f"{k:<24}{str(t.get(k)):>14}{str(om.get(k)):>14}")
EOF
```

## Field mapping (current / hourly / daily)

| Tomorrow.io field            | Open-Meteo source                          | Notes |
|------------------------------|--------------------------------------------|-------|
| `temperature`                | `current.temperature_2m`                   | °C ✓ |
| `temperatureApparent`        | `current.apparent_temperature`             | °C ✓ |
| `humidity`                   | `current.relative_humidity_2m`             | % ✓ |
| `windSpeed`                  | `current.wind_speed_10m`                   | km/h ✓ |
| `cloudCover`                 | `current.cloud_cover`                      | % ✓ |
| `uvIndex`                    | `current.uv_index` / `hourly.uv_index`     | ✓ |
| `precipitationIntensity`     | `current.precipitation`                    | mm ✓ |
| `precipitationProbability`   | `hourly.precipitation_probability`         | **Not in `current` block** — null fallback in adapter |
| `weatherCode`                | `current.weather_code` (WMO)               | Mapped via `WMO_TO_TOMORROW_CODE` |
| `temperatureMax/Min`         | `daily.temperature_2m_max/min`             | ✓ |
| `temperatureApparentMax/Min` | `daily.apparent_temperature_max/min`       | ✓ |
| `precipitationProbabilityMax`| `daily.precipitation_probability_max`      | ✓ |
| `rainAccumulation`           | `daily.rain_sum`                           | mm ✓ |
| `snowAccumulation`           | `daily.snowfall_sum` × 10                  | **Open-Meteo returns cm; adapter ×10 → mm parity** |
| `weatherCodeMax`             | `daily.weather_code` (mapped)              | ✓ |
| `weatherCodeDay`             | derived from `hourly.weather_code[noon]`   | Open-Meteo doesn't split day/night codes; adapter samples 13:00 local |
| `weatherCodeNight`           | derived from `hourly.weather_code[01:00]`  | Adapter samples 01:00 local |

## Bonus fields from Open-Meteo we don't currently use

- `current.is_day` — boolean, would let us drop the `useTimeOfDay` solar-position dance for dusk/night palette.
- `current.wind_direction_10m` — wind compass, currently absent.
- `daily.sunrise` / `daily.sunset` — bundled per day, would retire sunrise-sunset.org.
- `daily.uv_index_max` — max UV per day for the 5-day forecast cards.

## Gaps / caveats

1. **Weather-code granularity loss.** Tomorrow.io distinguishes "light snow + cloud cover" or "rain + cloud cover" via compound 4-digit codes (4210, 4205, etc.); WMO collapses these to a single code per phenomenon. The icon-renderer (`client/src/ui/weatherCodes.js`) keeps working because the adapter maps WMO → existing Tomorrow.io-style codes, but the user loses some specificity in the description text.
2. **No `precipitationProbability` in current.** Open-Meteo's current block doesn't expose it — adapter returns `null`. The hourly block does have it, so we could backfill from the nearest hourly entry if needed.
3. **No `precipitationType`.** Adapter hardcodes `0` (none) — we'd lose the rain-vs-snow-vs-freezing distinction from `precipitationType` if we ever start using it.
4. **Day/night code derivation is a heuristic.** Sampling 13:00 / 01:00 local from the hourly array works for temperate latitudes; in polar regions (where there's no real noon or midnight half the year) it would mis-label.
5. **Commercial-use clause.** The Pi-Weather kiosk is open-source / personal use, so we're inside the free tier. If anyone ever ships a paid product on top, they'd need the paid plan.

## Empirical observations (Montreal, May 2026)

Single spot-check at 2026-05-17 23:45 EDT (kiosk on macOS launchd):

| Field            | Tomorrow.io | Open-Meteo | Δ |
|------------------|-------------|------------|---|
| temperature      | 14.78 °C    | 13.0 °C    | -1.78 |
| humidity         | 52 %        | 50 %       | -2 |
| windSpeed        | 3.7 km/h    | 5.7 km/h   | +2.0 |
| cloudCover       | 40.6 %      | 86 %       | +45.4 |
| weatherCode      | 1101        | 1001       | partly cloudy → cloudy |

The cloud-cover gap is the most notable — could be a real disagreement between the models (Tomorrow.io blends multiple sources; Open-Meteo's `current` is derived from the closest hourly grid point). Worth tracking over 24-48 h to see if it averages out.

## Migration effort estimate (if we ever pull the trigger)

| Task | Effort |
|------|--------|
| Adapter shape parity (done) | shipped in `openMeteoCtrl.js` |
| Refactor server to merge 3 endpoints into 1 internal call | ~1 h |
| Rewrite `client/src/ui/weatherCodes.js` to use WMO directly (drop the mapping layer) | ~3 h |
| Update `aiSummaryCtrl.js` references (a few `temperatureApparent` / `precipitationProbability` lookups) | ~30 min |
| Decommission sunrise-sunset.org call (move to `daily.sunrise/sunset`) | ~1 h |
| Update `serviceStatus` critical-services list (Open-Meteo replaces 3 Tomorrow.io entries) | ~15 min |
| Settings UI cleanup (remove `weatherApiKey`, add "data source" picker if we keep both as fallbacks) | ~1-2 h |
| Test on the 7-Pi fleet | ~30 min |
| Docs (CLAUDE.md, api.md, ui-layout) | ~30 min |
| **Total** | **~7-9 h** |

## Recommendation

Keep Tomorrow.io as the default until a real reason to migrate emerges (quota pressure, pricing change, outage history). The PoC adapter stays in the repo as the prepared Plan B. If we want to be more confident, run the side-by-side comparison snippet daily for a week and log the deltas — most informative way to see whether Open-Meteo's numbers are within "good enough" tolerance of Tomorrow.io for our use cases.
