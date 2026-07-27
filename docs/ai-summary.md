# AI Summary — how it works

The `AI SUMMARY` slab (`client/src/components/ambient/AiSummaryInline/`) is a
1-3 paragraph natural-language description of the user's current weather, the
next forecast period, and what the radar around them is doing. It's powered by
Claude (Anthropic API, Haiku 4.5 today) and refreshed every 15 minutes.

This document explains exactly which pieces of work happen on the Pi and
which happen on Anthropic's servers, how data flows between them, and how
to handle a model upgrade.

---

## 30-second mental model

```
                  ┌──────────────────────── on the Pi ───────────────────────┐    ┌──── Anthropic ────┐
                  │                                                          │    │                   │
                  │   Tomorrow.io (cached) ──┐                                │    │                   │
                  │                          │                                │    │                   │
                  │   RainViewer tiles ──────┤   prompt assembly + caching   │ →→→ │  Claude Haiku 4.5 │ →→→ summary text
                  │   (cached)               │   (server/aiSummaryCtrl.js)    │    │                   │
                  │                          │                                │    │                   │
                  │   user settings ─────────┘                                │    │                   │
                  │                                                          │    │                   │
                  └──────────────────────────────────────────────────────────┘    └───────────────────┘
```

**Everything except the LLM call itself runs on the Pi.** Tomorrow.io and
RainViewer fetches, the radar pixel sampling, the unit conversions, the
prompt assembly, the cache, the per-language formatting — all local. Only
the assembled prompt goes off-device, and only the resulting text comes
back. The Pi never relays raw user data, location history, or accumulated
state to Anthropic — each request stands alone.

---

## What is NOT part of the AI summary

A few features on the same screen look related but **do not** involve any
LLM call. None of them go through Anthropic. None of them require an
Anthropic API key to function.

| Feature | What it does | LLM involvement |
|---|---|---|
| **AlertBanner** (red/orange banner above the current weather) | Picks one of `alert.redNear` / `redApproaching` / `redIntensifying` / `redLeaving` / `orangeNear` / etc. based on the radar-derived risk tier and trend, OR surfaces a government alert from NWS / ECCC. Every banner carries a leading source badge (`RADAR` / `NWS` / `ECCC`) so the user can distinguish locally-derived alerts from authoritative government feeds. Pure local computation + i18n key lookup. | **None.** Server-side `getRiskLevels` reads the same RainViewer tiles the AI analyzer reads (shared `tileCache`), classifies them into a tier, computes the trend, and returns it as JSON. The client picks the wording. |
| **Inner / outer dashed circles on the map** (50 km / 100 km) | Same data as the AlertBanner. The circle colour follows the same risk tier. When no Anthropic key is configured, the calm-tier circle is rendered with reduced opacity and a sparser dash pattern to signal "analysis zone present, AI narrative absent" — coloured tiers stay loud regardless. | **None.** Client just renders Leaflet circles with the colour coming from `/api/radar-risk`. |
| **Radar tile colours themselves** | RainViewer-encoded intensity, no post-processing. | **None.** Pure CDN tiles. |
| **Government weather alerts** (frost advisory, severe thunderstorm watch, etc.) | Polled every 10 min from NWS or Environment Canada XML feeds. | **None.** The Pi pulls the official feed, parses, and shows the title verbatim. |
| **Forecast charts** (24 h / 5 day) | Tomorrow.io payload rendered via Chart.js. | **None.** |
| **Indoor temperature, UV, AQHI badges** | Polled from Homebridge / EPA AirNow / OpenAQ / MELCC / ECCC. | **None.** |

**The only LLM-involved part of the entire app is the AI summary block
itself** — the 1-3 paragraph natural-language text that appears below
the charts when the user expands the AI summary section. Everything
else on the screen is computed locally on the Pi from the same data
sources.

The reason the AlertBanner sometimes feels "AI-like" is that it shares
the radar pixel data with the AI summary's third paragraph: when severe
precipitation is approaching, *both* fire — one as a coloured banner
above the current conditions, the other as a textual description in
the AI summary. They draw the same conclusion from the same data, but
the banner does it via deterministic rules in
`server/radarAnalyzerCtrl.js` and `client/src/components/ambient/AlertBanner/`,
while the AI summary phrases it in natural language via Claude. The
banner works perfectly even when the AI summary is disabled (no
Anthropic key) — the user just doesn't get the natural-language
narrative alongside it.

---

## What runs locally on the Pi

### 1. The HTTP endpoint and the cache

`GET /api/weather-summary` is the single entry point, routed in
`server/index.js` and handled by `server/aiSummaryCtrl.js`.

The first thing the controller does is look up an in-process cache keyed
by `lat:lon:lang:period:tempUnit:speedUnit:distanceUnit`. The TTL is
**15 minutes** (`SUMMARY_CACHE_TTL`). A cache hit is returned immediately
with no upstream call — so a kiosk that polls every 15 minutes only ever
makes one Claude request per cache window per location, regardless of how
many browser clients are connected.

The cache key includes the user's unit preferences because the prompt — and
therefore the response — is unit-specific. Toggling between °F and °C
invalidates the matching cache entry the first time the new key is hit.

### 2. Source-data assembly (no LLM involved)

The controller pulls three independent inputs from the **shared
server-side weather cache** (`server/proxyCtrl.js`) and the **radar
analyzer** (`server/radarAnalyzerCtrl.js`):

- **Current conditions** — Tomorrow.io `current` payload. Falls back to
  a direct Tomorrow.io fetch if the shared cache is empty (cold boot).
  Fields used: temperature, humidity, windSpeed,
  precipitationProbability, weatherCode, cloudCover.
- **Period forecast** — picked dynamically from `localHour`:
  - morning / afternoon → tonight's evening (18 h–21 h) from hourly data
  - evening → overnight (21 h–05 h) from hourly data
  - night → tomorrow from daily data
  Averages temperature and wind across the window; takes max precipitation
  probability.
- **Radar analysis** (toggleable via `advanced.ai.radarAnalysisEnabled`,
  default on; turn off to skip the third paragraph and save Anthropic
  tokens — see the next section).

All three sections are independent. If one fails (Tomorrow.io throttled,
RainViewer down, etc.), the prompt still gets the others and Claude is
told explicitly which piece is missing so it doesn't hallucinate values.

### 3. Radar pixel sampling — the most local-CPU-heavy part

`server/radarAnalyzerCtrl.js` does all of this on the Pi:

1. Fetches the **RainViewer frame index** (`weather-maps.json`) to discover
   the latest 3 timestamps it should compare (now / -15 min / -45 min).
2. Computes which **256×256 PNG tiles** at zoom 6 cover the user's
   location plus the surrounding 100 km radius.
3. Fetches each unique `(framePath, tileX, tileY)` PNG from RainViewer's
   `tilecache.rainviewer.com` CDN. Tile cache: 12 minutes
   (`TILE_CACHE_TTL`). Many tiles are shared across the 3 timestamps and
   across users at nearby locations, so the cache hit rate is high.
4. Decodes each PNG via `pngjs` (no native dependency).
5. For each of **161 sampling points** (1 centre + 16 directions × 10
   distances on the inner ring 5–50 km) — or **481 points** when
   `advanced.ai.extendedRadius` is on (adds 32 directions × 10 distances
   on the outer ring 55–100 km) — converts lat/lon to pixel coordinates
   and reads the RGB value.
6. Maps each RGB → an **intensity tier** (`clear / very light / light /
   moderate / heavy / very heavy / extreme`) using the RainViewer palette
   convention. A 3×3 max-pool around each probe absorbs anti-aliasing
   edges so a single border pixel doesn't misclassify a tile boundary.
7. Compresses the resulting grid into a compact textual format
   (`formatSnapshot`) — only non-zero samples within the active annulus
   are listed; "Clear within X km" and "Clear beyond Y km" describe the
   surrounding empty zones in one phrase each. This compression dropped
   the radar block from ~5000 to ~2600 chars (62% reduction) and is what
   keeps the Anthropic call cheap.
8. Caches the formatted snapshot keyed by
   `lat:lon:radiusTag:unit:FORMAT_VERSION`. Freshness is two-tier
   (2026-07): inside the 5-minute soft TTL (`ANALYSIS_CACHE_TTL`) the
   text is served with zero network; past it the analyzer fetches only
   the small RainViewer frame index and, if the frames this run would
   sample are unchanged (same frame signature), extends freshness
   instead of recomputing — so a full re-analysis (tile downloads +
   PNG decodes) happens only when RainViewer actually published a new
   frame, bounded by a 30-minute hard TTL if the upstream feed stalls.

### 4. Unit conversions

Tomorrow.io's source values are always metric (°C, m/s). The client passes
the user's preferred display units (`tempUnit`, `speedUnit`, `distanceUnit`)
and `aiSummaryCtrl` converts them locally before they enter the prompt.
Conversion helpers:

- `fmtTemp(c, unit)` → `"53°F"` / `"12°C"` / `"285 K"`
- `fmtSpeed(ms, unit)` → `"11 mph"` / `"5 m/s"` / `"18 km/h"`
- distances in the radar block: km when `distanceUnit = "km"`, miles
  otherwise

The prompt also carries an explicit instruction to Claude: *"use {unit
name} for temperatures and {unit name} for wind speeds"* and *"Match the
unit symbols exactly as shown in the data below — do not convert."* This
defends against the model regressing to its locale-default units.

### 5. Localization

`lang` (one of `en` / `fr` / `es`) is passed in the query string, mapped
through `LANG_NAMES`, and emitted in the prompt as *"Write a weather
summary in {English/French/Spanish} ..."*. The radar paragraph carries
extra wording so its label (`"Analyse radar : "` in French, translated
appropriately for the other two) lands consistently.

### 6. Prompt assembly

The final prompt is assembled deterministically from the three sections,
the unit instruction, and the per-paragraph instructions. Paragraph
numbering is dynamic — if the period section is unavailable, "the third
paragraph" becomes "the second paragraph" automatically, so Claude's
output stays coherent regardless of which inputs are missing.

When **all three sections fail to produce content**, the controller
returns 503 immediately without calling Claude. The client uses that
to hide the AI banner gracefully rather than show a perpetual spinner.

---

## What runs at Anthropic

**One thing**, only when there's a cache miss: the assembled prompt is
sent via `client.messages.create()` from the
[`@anthropic-ai/sdk`](https://github.com/anthropics/anthropic-sdk-node)
package, with these parameters:

```js
const message = await client.messages.create({
  model: "claude-haiku-4-5-20251001",
  max_tokens: radarText ? 280 : 150,
  temperature: 0,
  messages: [{ role: "user", content: prompt }],
});
```

The model returns text, the controller trims it, stores it in the cache
keyed by the user's preferences, and returns it to the client.

**What the API call carries:**

- the assembled prompt (current conditions, period forecast, radar text)
- approximate latitude / longitude **only as embedded in the radar
  text** ("Active 5–25 km NE: ...") — never as raw coordinates with a
  user identifier
- the language preference

**What the API call does not carry:**

- no user identifier of any kind
- no IP address (handled by Anthropic's infrastructure, not by the
  prompt)
- no historical context — each call is fully stateless
- no other user's data
- no API keys other than the one the user configured in
  `settings.anthropicApiKey`

**Cost characteristics**:

- One call per location per 15-minute cache window. A kiosk left on
  24/7 makes at most 24 × 4 = 96 calls/day, less when the cache is
  hit by other clients (multi-browser sessions share the cache).
- Prompt size depends heavily on whether `extendedRadius` is on:
  the radar block accounts for ~70 % of input tokens. With the
  default settings (radar on, inner ring only) the order of
  magnitude is ~1000-1500 input tokens + ~200 output tokens per
  call. The actual call count per kiosk is visible in the Debug
  panel's **Quotas → Anthropic** stripe; for token-level cost
  visibility, see the project's Anthropic Console dashboard.
- Failure mode: any non-200 response (rate limit, key invalid,
  network timeout) returns 500 to the client, which displays a
  discreet fallback in the UI without retrying.

---

## What happens when a newer model replaces Haiku 4.5?

The model identifier `"claude-haiku-4-5-20251001"` lives in **exactly one
place**: line 362 of `server/aiSummaryCtrl.js`. To upgrade to a future
model the only mandatory change is that string.

```js
// Today:
model: "claude-haiku-4-5-20251001",

// Hypothetical Haiku 5 release:
model: "claude-haiku-5-20260301",
```

That's it for the *minimum* upgrade. The SDK contract for
`messages.create({ model, max_tokens, temperature, messages })` is
stable across model versions, so no other code has to change.

Things that **might** be worth re-tuning per model upgrade, but are not
required for the upgrade to work:

- **`max_tokens`** (currently 280 with radar / 150 without). A model with
  a different verbosity tendency might want a different budget. If the
  output starts getting truncated mid-sentence, bump it.
- **`temperature: 0`**. Set deterministic by design so the same inputs
  produce the same summary (better for caching). If a future model
  benefits from a touch of variation, this can be raised.
- **Prompt wording**. The instructions ("Be concise and conversational",
  "Reply with plain text only — no title, no markdown") have been
  tuned against Haiku 4.5's tendencies. A successor might respect them
  out of the gate, or might need a nudge.
- **Per-paragraph max length** ("2-3 sentences", "1-2 sentences",
  "1-3 sentences"). Same logic — empirical, kept conservative.

All of those tunables are obvious from reading `aiSummaryCtrl.js` end to
end. There's no hidden state, no version-conditional branches, no model
fingerprinting.

**What does NOT need to change on a model upgrade:**

- The Anthropic SDK version (we pin a recent major in `package.json`,
  but the API surface for `messages.create` is stable)
- The cache key shape, the cache TTL, the request counter integration
- The prompt template structure (paragraph slots, unit instruction,
  language clause)
- The radar analyzer (it doesn't know or care about the model)
- The client UI (it consumes plain text)

**What COULD need to change with a much-future model release:**

- If Anthropic releases new SDK methods that supersede `messages.create`
  (e.g., something stateful, something with retrieval), we might
  rewrite to use them. But until then, the current call works on every
  Claude model from 3.5 onward without modification.
- If a new model *requires* a parameter we don't currently send (e.g.
  `system` instead of in-prompt instructions), one line changes.

The recommended upgrade procedure is:

1. Bump the model string locally, deploy to one Pi.
2. Watch for a few hours: does the summary stay coherent? Does the
   `Analyse radar :` label still land in French / Spanish? Are
   paragraphs the right length?
3. If yes, ship the change to the rest of the fleet via the normal
   commit + in-app `Update` flow.
4. If output drifts (verbosity, label translation, formatting), tune
   `max_tokens` / wording / temperature in that order.

---

## Settings that affect the AI summary

All under `advanced.ai.*` in `settings.json`, exposed in **Settings →
Advanced settings → AI weather summary**:

| Setting | Default | What it does |
|---|---|---|
| `radarAnalysisEnabled` | `true` | Cost-management knob for the LLM-narrated portion of the radar feature. When `false`: (a) the AI summary's third paragraph is skipped entirely — analyzer short-circuited server-side, no Anthropic tokens spent on the radar block; (b) the dashed sampling-zone circles disappear from the map. **The rain-alert banner is unaffected** — it uses the same risk data computed locally and keeps firing for severe / heavy precipitation regardless of this setting (since v2026-05-09 — see PR #68 for the decoupling rationale). |
| `extendedRadius` | `false` | When `true`, samples the outer ring (32 directions × 10 distances, 55-100 km / 33-60 mi). Triples the sample count (161 → 481), bumps prompt size ~30%, and lets Claude reason about cells further out. |
| `showSamplingPoints` | `false` | Purely client-side render flag — no impact on the prompt. |
| `calmDayFastPath` | `true` | When enabled, the server skips the Claude call on calm days (no active precipitation, current and period precipitation probabilities below 20 %, AND the radar snapshot is fully clear) and returns a localised templated summary instead. The template renders three paragraphs to mirror the Claude path's structure: current conditions, period forecast (`evening` / `overnight` / `tomorrow` window), and a confident radar "nothing to report within {distance}". Saves one full Anthropic call per cache window per location whenever conditions are quiet. Claude is still invoked the moment any of the four gates trip — including when Tomorrow.io says calm but radar shows precipitation, so the summary never contradicts what's visible on the map. Disable to always invoke Claude regardless of conditions. |

The **API key** (`anthropicApiKey`) lives at the top level of
`settings.json`, not under `advanced`. When it's missing or blank, the
endpoint returns 503 and the client hides the AI block entirely — no
spinner, no error, just no banner.

---

## Caching layers, in order

Walking from the user's tap to Anthropic, the caches that can absorb the
load are:

1. **Browser cache** — none. The client always re-issues
   `GET /api/weather-summary` on a 15-minute interval and on certain
   user actions (location pan, settings change).
2. **`summaryCache` in `aiSummaryCtrl.js`** — 15 min TTL. First line of
   defense. A hit returns the cached text, never touches the network.
3. **`weatherCache` in `proxyCtrl.js`** (shared with the rest of the
   weather endpoints) — 15 min for current, 30 min for hourly, 30 min
   for daily. The AI summary reuses the same entries the rest of the
   app already populated.
4. **`tileCache` in `radarAnalyzerCtrl.js`** — 12 min per tile PNG.
   Shared with `getRiskLevels` (the inner/outer ring colouring), so a
   typical poll cycle on a kiosk hits the cache for every tile.
5. **`analysisCache` in `radarAnalyzerCtrl.js`** — 5 min for the formatted
   text. Shorter than the summary cache so radar context can refresh
   inside a single summary cache window if needed.
6. **Anthropic** — Claude.

A typical "all caches warm" call returns in 1-3 ms (the cache lookup +
JSON serialisation). A "cold path with Claude" returns in 600-2000 ms
(Tomorrow.io fetch + RainViewer fetches + PNG decode + Claude). A "warm
data, cold summary" returns in 400-1200 ms (Claude only).

---

## Where to look in the code

| File | Purpose |
|---|---|
| `server/index.js` | Routes `/api/weather-summary` to `getWeatherSummary` |
| `server/aiSummaryCtrl.js` | Prompt assembly, Claude call, summary cache |
| `server/radarAnalyzerCtrl.js` | RainViewer fetch, PNG decode, sampling, formatting |
| `server/proxyCtrl.js` | Shared weather cache (Tomorrow.io payloads) |
| `client/src/components/ambient/AiSummaryInline/index.js` | Display — the summary slab used by the desktop and mobile layouts (carries its own fetch + 15-min refresh) |
| `client/src/components/hooks/useAiSummary.js` | Fetch + refresh contract, extracted as a hook (15-min interval, `REFRESH_INTERVAL`). Consumed by `ambient/AiView`, the full-rail AI view on the 7" Pi layout |
| `client/src/components/ambient/SettingsPanel/index.js` | Settings UI for `advanced.ai.*` |
| `docs/api.md` | Endpoint reference (request params, error codes) |

---

## Privacy posture

The AI summary makes outbound calls to two third parties:

- **RainViewer** — public radar tile CDN, no API key, no user identifier.
  Standard CDN log retention applies.
- **Anthropic** — uses the user's own `anthropicApiKey`. The call carries
  the assembled prompt only. Anthropic's API
  [data-handling policies](https://docs.anthropic.com/en/docs/legal/data-protection)
  apply to that single inference call. No conversation history, no
  retention beyond what their default policy specifies.

Tomorrow.io fetches do not happen as part of the AI summary path
specifically — they happen as part of the regular weather endpoints, and
the AI summary just reads from the cache they populate.

The AI portion can be **disabled in three different shapes** — pick the
one that matches your concern:

1. **No AI at all** — leave `anthropicApiKey` empty. The endpoint returns
   503, the client hides the AI summary banner entirely, no Anthropic
   call ever happens. The deterministic surfaces (rain-alert banner,
   dashed analysis-zone circles in their subdued styling, government
   alerts) keep working from local computation.
2. **AI for current conditions / forecast period only — no radar
   narration** — set `advanced.ai.radarAnalysisEnabled: false`. The
   third paragraph is skipped, no RainViewer pixel sampling for the
   summary path, no Anthropic tokens spent on the radar block. The
   first two paragraphs (current conditions + period forecast) keep
   generating. The rain-alert banner is unaffected — it uses the same
   risk data computed by `/api/radar-risk`, which runs independently
   of this setting.
3. **Reduce frequency** — there's no per-user knob for this, but the
   server-side `SUMMARY_CACHE_TTL` (15 min) and the client polling
   interval (also 15 min) can be lengthened in code if a deployment
   wants fewer calls per hour. Doubling the cache TTL roughly halves
   the call rate at low end (a 30 min TTL drops 96 calls/day to 48).

### Behaviour matrix across the AI / radar settings

| Configuration | Source | AI summary paragraphs 1+2 | AI summary paragraph 3 (radar narration) | Dashed analysis-zone circles | Rain-alert banner |
|---|---|:---:|:---:|:---:|:---:|
| No `anthropicApiKey` | — | ❌ | ❌ | ✅ subdued | ✅ |
| Key + `radarAnalysisEnabled: true` + active weather | Claude | ✅ | ✅ | ✅ full contrast | ✅ |
| Key + `radarAnalysisEnabled: true` + calm + fast-path on (default) | **Template (no Claude call)** | ✅ | ❌ (skipped) | ✅ full contrast | ✅ |
| Key + `radarAnalysisEnabled: false` | Claude | ✅ | ❌ | ❌ | ✅ |

Notes:
- The **calm-day fast path** (third row) is enabled by default via `advanced.ai.calmDayFastPath: true`. It triggers when **all four** of: (1) current weather code is in the benign range (no 4xxx-8000), (2) current precipitation probability < 20 %, (3) period forecast's max precipitation probability < 20 %, (4) radar snapshot is fully clear. When all four hold, the server renders a three-paragraph template (current conditions + period forecast + radar "nothing to report within 50 km / 100 km depending on extendedRadius"), no Anthropic tokens spent. The radar gate exists specifically to defend against the case where Tomorrow.io reports calm but RainViewer already shows an approaching band — in that case the fast path bails out and Claude takes over so the summary stays honest. Set `calmDayFastPath: false` to always invoke Claude regardless of conditions.
- The "subdued" treatment in the no-key case lowers the calm-tier ring's opacity (0.85 → 0.35) and switches to a sparser dash pattern (`6 6` → `3 9`); coloured tiers (yellow / orange / red) keep their full contrast — alerts need to stay loud regardless of AI availability.
