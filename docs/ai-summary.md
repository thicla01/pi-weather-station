# AI Summary — how it works

The AI summary is a 1-3 paragraph natural-language description of the user's
current weather, the next forecast period, and what the radar around them is
doing. It's powered by Claude (Anthropic API, Haiku 5.5 since 2026-10). The
desktop and mobile layouts show it in the `AI SUMMARY` slab
(`client/src/components/ambient/AiSummaryInline/`); on the Pi it lives in the
full-rail AI view (`ambient/AiView`), opened from the dock's IA button. Both
refresh it every 15 minutes while mounted; the Pi view is mounted only while
it is open, so a Pi calls the endpoint only then.

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
                  │   RainViewer tiles ──────┤   prompt assembly + caching   │ →→→ │  Claude Haiku 5.5 │ →→→ summary text
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
| **Inner / outer dashed circles on the map** (50 km / 100 km) | Same data as the AlertBanner. The circle colour follows the same risk tier. When no Anthropic key is configured, the calm-tier circle is rendered with reduced opacity and a sparser dash pattern to signal "analysis zone present, AI narrative absent" — coloured tiers stay loud regardless. The subdued style applies from boot on every layout, Pi included, and on remote clients too: the client reads key availability from its startup `GET /settings`, not from a summary request; see [Settings that affect the AI summary](#settings-that-affect-the-ai-summary). | **None.** Client just renders Leaflet circles with the colour coming from `/api/radar-risk`. |
| **Radar tile colours themselves** | RainViewer-encoded intensity, no post-processing. | **None.** Pure CDN tiles. |
| **Government weather alerts** (frost advisory, severe thunderstorm watch, etc.) | Polled every 10 min from the NWS (api.weather.gov GeoJSON) and Environment Canada (api.weather.gc.ca JSON) alert APIs. | **None.** The Pi pulls the official feed, parses, and shows the title verbatim. |
| **Forecast charts** (24 h / 5 day) | Tomorrow.io payload rendered via Chart.js. | **None.** |
| **Indoor temperature, UV, air-quality and pollen readouts** | Indoor from Homebridge; UV from the Tomorrow.io current payload; air quality from MELCC / EPA AirNow / OpenAQ / ECCC; pollen from Open-Meteo. | **None.** |

**The only LLM-involved part of the entire app is the AI summary block
itself** — the 1-3 paragraph natural-language text shown in the
`AI SUMMARY` slab below the charts (desktop / mobile) or in the AI view
opened from the dock's IA button (Pi). Everything else on the screen is
computed locally on the Pi from the same data sources.

The reason the AlertBanner sometimes feels "AI-like" is that it shares
the radar pixel data with the AI summary's third paragraph: when severe
precipitation is approaching, *both* fire — one as a coloured banner
above the current conditions, the other as a textual description in
the AI summary. They draw the same conclusion from the same data, but
the banner does it via deterministic rules in
`server/radarAnalyzerCtrl.js` and `client/src/ui/alertLogic.js`
(`getRadarAlertState`), rendered by `ambient/AlertBanner` on desktop /
mobile and by `ambient/NowcastLine` on the Pi (where the banner's radar
branch is suppressed), while the AI summary phrases it in natural
language via Claude. The banner works perfectly even when the AI
summary is disabled (no Anthropic key) — the user just doesn't get the
natural-language narrative alongside it.

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
many browser clients are connected. Two exceptions: a reply Claude cut at
the token cap is cached for only 5 minutes (`TRUNCATED_SUMMARY_TTL`), and a
refused or empty reply is not cached at all (see
[What runs at Anthropic](#what-runs-at-anthropic)).

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
  - night → tomorrow from daily data (also the fallback for the two
    cases above when the hourly window is unavailable)
  Averages temperature and wind across the window; takes max precipitation
  probability.
- **Radar analysis** (toggleable via `advanced.ai.radarAnalysisEnabled`,
  default on; turning it off skips the third paragraph, which makes the
  Claude call shorter and noticeably faster — see the next section and
  [Settings that affect the AI summary](#settings-that-affect-the-ai-summary)).

All three sections are independent. If one fails (Tomorrow.io throttled,
RainViewer down, etc.), the prompt still gets the others: a missing period
or radar section simply drops its paragraph (the numbering adapts), and a
missing current-conditions section adds an explicit note telling Claude
not to invent values.

### 3. Radar pixel sampling — the most local-CPU-heavy part

`server/radarAnalyzerCtrl.js` does all of this on the Pi:

1. Fetches the **RainViewer frame index** (`weather-maps.json`) to discover
   the latest 3 timestamps it should compare (now / -15 min / -45 min).
2. Computes which **512×512 PNG tiles** at zoom 7 (RainViewer's max
   native zoom — `ZOOM` / `TILE_SIZE`) cover the sampling points: the
   user's location plus the surrounding 50 km radius (100 km with
   `advanced.ai.extendedRadius`).
3. Fetches each unique `(framePath, tileX, tileY)` PNG from RainViewer's
   `tilecache.rainviewer.com` CDN. Tile cache: 60 minutes
   (`TILE_CACHE_TTL`, a pure eviction policy: a tile's content never
   changes for a given frame path). Tiles are reused across successive
   runs (the frame sampled as `now` is sampled again as the -15 and
   -45 min frames on later runs), by the `/api/radar-risk` computation
   that samples the same frames, and across nearby locations, so the
   cache hit rate is high.
4. Decodes each PNG via `pngjs` (no native dependency) and refuses a
   response that isn't readable radar: RainViewer's "Zoom Level Not
   Supported" image (HTTP 200) or a tile in unknown colours. That
   frame then counts as unavailable instead of clear.
5. For each of **161 sampling points** (1 centre + 16 directions × 10
   distances on the inner ring 5–50 km) — or **481 points** when
   `advanced.ai.extendedRadius` is on (adds 32 directions × 10 distances
   on the outer ring 55–100 km) — converts lat/lon to pixel coordinates
   and reads the RGB value.
6. Maps each RGBA → an **intensity tier** (`clear / very light / light /
   moderate / heavy / very heavy / extreme`): the exact colour gives the
   dBZ in RainViewer's Universal Blue palette, and dBZ bands give the
   tier (see [`radar-classification.md`](radar-classification.md)). A
   3×3 max-pool around each probe keeps a probe on a band's edge from
   reading clear.
7. Compresses the resulting grid into a compact textual format
   (`formatSnapshot`) — only non-zero samples within the active annulus
   are listed; "Clear within X km" and "Clear beyond Y km" describe the
   surrounding empty zones in one phrase each. This compression dropped
   the radar block from ~5000 to ~2600 chars (~48 % reduction; ~62 % vs
   the 6770-char uncompressed legacy format — measured on a real
   Montréal frame, 2026-05-05) and is what keeps the Anthropic call cheap.
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
summary entirely in {English/French/Spanish} ..."*.

The radar paragraph's label is **hard-coded per language**
(`RADAR_PARAGRAPH_LABEL_BY_LANG`: `"Radar analysis: "` / `"Analyse
radar : "` / `"Análisis radar: "`), and the prompt tells Claude to open
the radar paragraph with that literal string, untranslated. The label is
part of the output contract, not decoration: the Pi AI view
(`ambient/AiView`) finds the radar paragraph by matching it with its
`RADAR_PREFIX` regex and strips it (the section already has a heading),
and the calm-day templates (`CALM_RADAR_BY_LANG`) open with the same
labels. `test/aiSummaryClaudeReply.test.js` reads `RADAR_PREFIX` from the
client source and fails if a server label or a calm template stops
matching it.

For French and Spanish the prompt also closes with a reminder (*"Write
the entire summary in {language}, regardless of the measurement units
used in the data above."*): Haiku 4.5 drifted to English when the data
was dense with imperial units. It stays on Haiku 5.5 until a 5.5-only A/B
shows it is no longer needed.

### 6. Prompt assembly

The final prompt is assembled deterministically from the three sections,
the unit instruction, and the per-paragraph instructions. Paragraph
numbering is dynamic — if the period section is unavailable, "the third
paragraph" becomes "the second paragraph" automatically, so Claude's
output stays coherent regardless of which inputs are missing.

When **all three sections fail to produce content**, the controller
returns 502 `{ "reason": "no-weather-data" }` immediately without
calling Claude. That is a data gap (typically Tomorrow.io failing while
the shared caches are cold and there is no radar block), not a missing
feature: the client keeps the summary it already shows (the Pi AI view
shows "AI summary unavailable" when it has none yet) and retries at the
next poll. It used to be a 503, which the clients read as "no API key",
so a gap hid the AI summary on a keyed install until a reload.

---

## What runs at Anthropic

**One thing**, only when there's a cache miss and the calm-day fast path
doesn't apply: the assembled prompt is sent via `client.messages.create()`
from the
[`@anthropic-ai/sdk`](https://github.com/anthropics/anthropic-sdk-node)
package. The request is built by `buildClaudeRequest()` from the constants
block near the top of `server/aiSummaryCtrl.js`:

```js
const CLAUDE_MODEL = "claude-haiku-5-5";
const CLAUDE_THINKING = Object.freeze({ type: "adaptive" });
const CLAUDE_EFFORT = "low";
const MAX_TOKENS_RADAR = 3072;    // 3 paragraphs incl. radar analysis
const MAX_TOKENS_NO_RADAR = 1024; // 1-2 paragraphs, no radar block

function buildClaudeRequest(prompt, hasRadar) {
  return {
    model: CLAUDE_MODEL,
    max_tokens: hasRadar ? MAX_TOKENS_RADAR : MAX_TOKENS_NO_RADAR,
    thinking: CLAUDE_THINKING,
    output_config: { effort: CLAUDE_EFFORT },
    messages: [{ role: "user", content: prompt }],
  };
}
```

- **No sampling parameters.** The Haiku 4.5 call sent `temperature: 0`;
  Haiku 5.5 returns a 400 for any `temperature` other than 1, for a
  non-default `top_p` and for any `top_k`, and it also rejects an
  assistant prefill and a `fallbacks` list. The request sends none of
  them; `test/aiSummaryClaudeReply.test.js` locks the shape.
- **Adaptive thinking at low effort.** Adaptive thinking is Haiku 5.5's
  default; it is sent explicitly so a change of default can't silently
  move the bill. The model's default effort is `medium`; `low` lets it
  skip thinking on easy prompts and spend a little on busy radar rings,
  where inferring approach and arrival time from the snapshots is the
  hard part. In the 2026-10-08 smoke test it skipped thinking entirely on
  every no-radar prompt and spent ~650-750 thinking tokens on each radar
  prompt.
- **Token caps are ceilings, not targets.** Haiku 4.5 capped at 400 with
  radar / 150 without, sized for text alone. Haiku 5.5's tokenizer counts
  the same text as ~30% more tokens, and thinking tokens count toward
  `max_tokens`, hence 3072 / 1024. The largest smoke-test reply used
  about half of a 2048 cap, but an end-to-end extended-radius call over
  real precipitation used 1260 output tokens (1012 of them thinking),
  62% of 2048, so the radar cap went to 3072. Billing follows what the
  model generates, not the cap, but the caps also set the dollar bound
  of the billed-call ceiling (see the comment above
  `MAX_CLAUDE_CALLS_PER_MIN`).
- **Client settings.** `maxRetries: 1` (`CLAUDE_MAX_RETRIES`; the SDK
  default is 2) so a transient overload can't fan one request into
  three, and a 30 s timeout (`CLAUDE_TIMEOUT_MS`), a deliberate exception
  to the project's 10 s outbound rule since a generated reply with
  thinking takes longer than a data fetch.

**Reading the reply.** `classifyClaudeReply()` reads the content blocks by
`type`, never by position: a Haiku 5.5 reply can open with `thinking`
blocks (empty text plus a signature), on which the old
`message.content[0].text.trim()` would throw. It joins and trims the
`text` blocks, then branches on `stop_reason` (never on `stop_details`,
which can be null):

| Outcome | When | What the endpoint does |
|---|---|---|
| `ok` | Text present, any other `stop_reason` (normally `end_turn`) | 200; cached for 15 min (`SUMMARY_CACHE_TTL`) |
| `truncated` | Text present, but `stop_reason` is `max_tokens` or `model_context_window_exceeded` | 200, since partial text beats nothing; cached for only 5 min (`TRUNCATED_SUMMARY_TTL`) so the next poll or another client regenerates it |
| `refusal` | `stop_reason: "refusal"`: Haiku 5.5's safety classifier declined. Still HTTP 200 from Anthropic; any partial text is discarded | 502 `"AI summary failed"`, never cached; service status recorded as 422 with the refusal category in the comment |
| `empty` | No usable text: thinking only (e.g. the cap was hit during thinking), whitespace, or no content | 502 `"AI summary failed"`, never cached; service status recorded as 502 with the `stop_reason` in the comment |

Any `stop_reason` other than `end_turn` on a served reply is also logged
as a `Claude stopped early` warning in `server.log`. Refused and empty
replies are never cached because the next poll is the retry: Haiku 5.5
has no server-side refusal fallback. They still push a debug radar
snapshot (`source` `"claude-refusal"` / `"claude-empty"`) so the input
that triggered them can be inspected. They return 502, **never 503**: both
clients read 503 as "no API key" and hide the feature.

An API error (rate limit, invalid key, 400, timeout) is caught and
returned as 500 `"AI summary failed"`, as before; the service status now
records the API's own HTTP status and reason (`describeClaudeError()`,
up to 160 chars) instead of a JSON-wrapped fragment.

**Observability.** Every Claude reply's service comment (ok, truncated,
refusal or empty; an API error has no usage to report) carries its token
usage as `in=… out=… think=…` (`formatUsage()`; thinking tokens are
already part of `out` and are split out so the effort and cap choices can
be checked against real calls), visible on the **Claude (AI summary)**
row of the Debug panel's **Recent service calls**. Debug radar snapshots
also carry `stopReason` and `usage` fields (the Debug panel doesn't
display them yet, but the **Export JSON** button of its **Radar AI
snapshots** section and the `GET /api/debug` payload include them). The
Anthropic quota counter increments right after the billed call returns,
before the reply is classified, so refused and empty replies are counted
too.

**What the API call carries:**

- the assembled prompt (current conditions, period forecast, radar text)
- the user's surroundings **only as distances and bearings relative to
  the user** inside the radar text (an `Active 5km-25km:` header followed
  by lines like `NE     : 10km light`) — the prompt contains no
  coordinates, place name or other absolute location
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
  24/7 makes at most 24 × 4 = 96 calls/day, fewer on calm days (fast
  path) and when other clients hit the cache (multi-browser sessions
  share it). A truncated reply (cached 5 min) or a failed one (not
  cached) can let another client or the next poll make an extra call.
- **Rate card.** Haiku 5.5 bills $0.10 / $0.50 per million input /
  output tokens for prompts up to 100K tokens ($0.50 / $2.50 above,
  far beyond this prompt); Haiku 4.5 billed $1 / $5. Thinking tokens
  are billed as output. The new tokenizer counts the same text as ~30%
  more tokens, so the same text costs roughly 8x less (a tenth of the
  price for ~1.3x the tokens), but thinking adds output tokens that the
  Haiku 4.5 call never generated.
- **Measured** in the 2026-10-08 smoke test (6 real calls through the
  real handler, stubbed rainy weather and a synthetic radar, total
  ≈ $0.0025):

  | Prompt | Input tokens | Output tokens (of which thinking) | ≈ Cost per call |
  |---|---|---|---|
  | Radar, inner ring (en metric / fr imperial) | 1397 / 1496 | 856 (660) / 1016 (718) | $0.0006 / $0.0007 |
  | Radar, extended radius (es imperial) | 3461 | 998 (732) | $0.0008 |
  | No radar (en / fr / es) | 479-513 | 136-169 (0) | $0.00012-0.00014 |
  | Radar, extended radius, real precipitation (fr metric, end to end, Montréal) | 4217 | 1260 (1012) | $0.0011 |

  The last row is a separate end-to-end call through the Mac dev
  server with live weather and radar, made the same day.

  The radar block dominates the input (roughly 1K of the ~1.4-1.5K
  inner-ring prompt), and `extendedRadius` more than doubles the
  prompt. A rough Haiku 4.5 comparison for the radar calls is
  ≈ $0.0018-0.0037 each, so a radar call now costs roughly 0.25-0.3x
  what it did; a no-radar call, which skips thinking, costs about 0.13x
  (a tenth of the price for ~1.3x the tokens). At the smoke-test cost,
  96 radar calls a day come to about $0.06-0.08 for one location. The
  per-call worst case the code assumes (a ~4.2K-token stormy
  extended-radius prompt that fills the whole 3072 cap) is ≈ $0.002, so
  ≈ $0.19/day at 96 calls; the comment above `MAX_CLAUDE_CALLS_PER_MIN`
  multiplies it out to ≈ $28/day for a remote flood held at the
  billed-call ceiling.
- **No prompt caching.** The request sends no `cache_control`, so
  Anthropic-side prompt caching is not used (Haiku 5.5's minimum
  cacheable prompt is 512 tokens, vs 4096 on Haiku 4.5).
- **Where to look.** Call count: the Debug panel's **Quota — ANTHROPIC**
  table (`summary` row). Per-call tokens: the `in=… out=… think=…`
  comment on the **Claude (AI summary)** service row. Dollars: the project's
  Anthropic Console cost dashboard (re-baseline it after a model
  change: price, token counts and thinking all move at once).
- **Failure modes.** API error → 500; refused or empty reply → 502;
  no weather data at all → 502 `reason: "no-weather-data"` (no call
  made); remote caller over the billed-call ceiling → 429 (the local
  kiosk is exempt). 503 is reserved for "no API key"
  (`reason: "no-key"`), and is never returned for a failed call. Both
  clients keep an already-displayed summary on screen (the Pi AI view
  shows "AI summary unavailable" when it has none yet) and try again at
  the next 15-minute poll; the SDK itself retries a transient failure
  once (`CLAUDE_MAX_RETRIES`).

---

## Model upgrades

The Haiku 4.5 → 5.5 move (2026-10) showed that a model upgrade is not a
one-string edit: the new model rejected a parameter the old call sent
(`temperature: 0`), changed what a reply looks like (thinking blocks
before the text, a `refusal` stop reason), and counted the same prompt
as ~30% more tokens. Everything the call depends on sits in the
constants block near the top of `server/aiSummaryCtrl.js`
(`CLAUDE_MODEL`, `CLAUDE_THINKING`, `CLAUDE_EFFORT`, `MAX_TOKENS_RADAR`,
`MAX_TOKENS_NO_RADAR`, `TRUNCATED_SUMMARY_TTL`, `CLAUDE_MAX_RETRIES`,
`CLAUDE_TIMEOUT_MS`) plus `buildClaudeRequest()` and
`classifyClaudeReply()`; `test/aiSummaryClaudeReply.test.js` locks the
request shape, the reply classification and the radar-label contract.
Read Anthropic's migration notes for the new model, then work through
this checklist:

1. **Model id.** Copy the exact id from Anthropic's models
   documentation and put it in `CLAUDE_MODEL`; never construct one.
   Current ids carry no date suffix (`claude-haiku-5-5`, where the
   previous one was `claude-haiku-4-5-20251001`). A bare string id
   needs no SDK bump: `@anthropic-ai/sdk` 0.128.0 sends
   `claude-haiku-5-5` as is. Update the id the test pins.
2. **Sampling parameters and request surface.** Check what the new
   model rejects. Haiku 5.5 returns a 400 for any `temperature` other
   than 1, a non-default `top_p`, any `top_k`, an assistant prefill and
   a `fallbacks` list; the request sends none of them. Extend the
   test's banned-parameter list if the new model adds to it.
3. **Read replies by block type.** Never `message.content[0].text`: a
   reply can open with `thinking` blocks. `classifyClaudeReply()`
   filters on `type === "text"`, and the test fails if `.content[0]`
   appears in the controller.
4. **Every `stop_reason` branch.** `max_tokens` /
   `model_context_window_exceeded` with text → `truncated`; no text →
   `empty`; `refusal` → refusal, partial text discarded; anything else
   with text → `ok` (see the table in
   [What runs at Anthropic](#what-runs-at-anthropic)). Refusals are new
   on Haiku 5.5 (safety classifiers, HTTP 200, no server-side
   fallback). Branch on `stop_reason`, never on `stop_details`, which
   can be null. Check whether the new model adds a stop reason or a
   fallback option.
5. **Thinking and effort.** Check the new model's thinking modes and
   default effort. Haiku 5.5 runs adaptive thinking by default with a
   `medium` default effort; Haiku 4.5 rejects `effort` with a 400 and
   only knows budget-based thinking. Keep both sent explicitly (`CLAUDE_THINKING`,
   `CLAUDE_EFFORT`) so a default change can't move the bill. For less
   thinking, lower the effort: prompt wording doesn't control thinking
   length.
6. **Token recount.** Tokenizers change between generations. Recount
   representative prompts with the `count_tokens` endpoint
   (`client.messages.countTokens` in the SDK) against the new id
   instead of reusing old counts: at least en / fr / es, with radar,
   without radar and with `extendedRadius`.
7. **Re-size `max_tokens`.** `MAX_TOKENS_RADAR` / `MAX_TOKENS_NO_RADAR`
   must hold the thinking plus the longest (French) reply in the new
   tokenizer; a cap hit during thinking leaves no text at all (an
   `empty` 502). Keep them modest: they set the dollar bound of the
   billed-call ceiling (restated in `docs/security-hardening.md`).
8. **Re-baseline cost.** Update the rate card and the worst-case $/day
   in the comment above `MAX_CLAUDE_CALLS_PER_MIN`, the cost figures in
   this doc, the billed-call dollar bound and spend-alert guidance in
   `docs/security-hardening.md`, the input-cost figures in the ROADMAP
   prompt-caching entry, and the Anthropic Console baseline.
9. **Canary on two Pis before the fleet.** Merge, then update only two
   Pis with the in-app updater (it pulls `master` and refuses any other
   branch), at least one with a non-English locale, and watch them for a
   few hours to a day: the status and `in=… out=… think=…` comment of
   the **Claude (AI summary)** service row, `Claude stopped early`
   warnings in `server.log`, the `stopReason` / `usage` of the debug
   radar snapshots, and the summaries themselves (radar label in all
   three languages, no language drift, paragraph count and length).
   Then update the rest of the fleet with the same in-app `Update` flow.
10. **Rollback = revert the whole commit.** Reverting only
    `CLAUDE_MODEL` would make every call a 400, because the older model
    rejects the newer request shape (Haiku 4.5 rejects
    `output_config.effort` and only knows budget-based thinking). Haiku
    4.5 is still served, so reverting the migration commit works today;
    keep a model change in a commit of its own so the revert stays
    clean.

**Tunables to revisit after the canary** (none of them blocks an
upgrade):

- **`CLAUDE_EFFORT`** (`"low"`). Raise it only if the radar paragraph's
  approach / arrival-time reasoning degrades; each step up costs
  thinking tokens and latency.
- **`MAX_TOKENS_RADAR` / `MAX_TOKENS_NO_RADAR`** (3072 / 1024). Confirm
  them from the canary's `stop_reason` and usage distribution: a
  `truncated` reply, or an `empty` one with `stop_reason=max_tokens`,
  means the cap is too low for that prompt.
- **Prompt wording.** Unchanged from Haiku 4.5 on purpose: the closing
  language reminder for French and Spanish, the hard-coded radar label,
  the paragraph-separation emphasis and the "plain text only — no
  title, no markdown" rule stay until a 5.5-only A/B shows they are no
  longer needed. The radar label is not a free tunable: AiView's
  `RADAR_PREFIX` parses it.
- **Per-paragraph max length** ("2-3 sentences", "1-2 sentences",
  "1-3 sentences"). Empirical, kept conservative.
- **No determinism.** With no `temperature` to pin, the same inputs can
  produce different wording on the next cache miss. The summary cache
  still serves one reply per location for its window, but two windows
  with identical data won't necessarily read the same.

**What did not change on the 4.5 → 5.5 move:** the SDK version
(0.128.0), the cache key shape and the 15-minute TTL, the prompt text
(paragraph slots, unit instruction, language clause), the radar
analyzer, and the client (`client/dist` untouched).

---

## Settings that affect the AI summary

All under `advanced.ai.*` in `settings.json`, exposed in **Settings →
Advanced → AI · radar analysis**:

| Setting | Default | What it does |
|---|---|---|
| `radarAnalysisEnabled` | `true` | Scope knob for the LLM-narrated portion of the radar feature. When `false`: (a) the AI summary's third paragraph is skipped entirely — analyzer short-circuited server-side, no radar block in the prompt; (b) the dashed sampling-zone circles disappear from the map. On Haiku 5.5 it is a small cost lever (≈ $0.0006-0.0008 vs ≈ $0.00013 per call in the 2026-10-08 smoke test) but the main latency lever: no-radar prompts skipped thinking entirely and returned in ~1-1.5 s instead of ~4-5 s. **The rain-alert banner is unaffected** — it uses the same risk data computed locally and keeps firing for severe / heavy precipitation regardless of this setting (since v2026-05-09 — see [PR 68](https://github.com/thicla01/pi-weather-station/pull/68) for the decoupling rationale). |
| `extendedRadius` | `false` | When `true`, samples the outer ring (32 directions × 10 distances, 55-100 km / 33-60 mi). Triples the sample count (161 → 481), more than doubles the prompt (2026-10-08 smoke test, synthetic radar: 3461 input tokens for the Spanish extended-radius prompt vs 1397-1496 for the English / French inner-ring ones), and lets Claude reason about cells further out. |
| `showSamplingPoints` | `false` | Purely client-side render flag — no impact on the prompt. |
| `calmDayFastPath` | `true` | When enabled, the server skips the Claude call on calm days (no active precipitation, current and period precipitation probabilities below 20 %, AND the radar snapshot, if one was obtained, is fully clear) and returns a localised templated summary instead. The template renders three paragraphs to mirror the Claude path's structure: current conditions, period forecast (`evening` / `overnight` / `tomorrow` window), and a confident radar "nothing to report within {distance}" (dropped when radar analysis is off). Saves one Claude call per cache window per location whenever conditions are quiet: under a tenth of a cent per skipped call on Haiku 5.5, but also the call's latency and its failure modes. Claude is still invoked the moment any of the four gates trip — including when Tomorrow.io says calm but radar shows precipitation, so the summary never contradicts what's visible on the map. Disable to always invoke Claude regardless of conditions. |

The **API key** (`anthropicApiKey`) lives at the top level of
`settings.json`, not under `advanced`. When it's missing, empty, or still
the `"key"` placeholder from `settings.example.json`, the endpoint returns
503 `{ "reason": "no-key" }` without calling Claude — and the client
normally knows before it ever asks. The startup `GET /settings` read that
every layout already makes carries the key (the raw value for the local
kiosk, a `true`/`false` mask for a remote client — and the mask applies
the same rule, `settingsCtrl.isApiKeyConfigured`, so the placeholder
reads `false` there too), and AppContext clears `aiSummaryAvailable` from
it (`isAnthropicKeyConfigured`, the exact negation of the server's no-key
test). That read lands before the map is first positioned, so before any
summary request could fire; from then on, local or remote, with no
summary request at all:

- **Pi** (`LayoutPi`): the dock's IA button is not shown, so the AI view
  can't be opened onto a "Generating summary…" that ends in "AI summary
  unavailable".
- **Desktop / mobile**: the `AI SUMMARY` slab stays hidden and never
  fetches — no spinner, no error, just no slab — and the debug-only dock
  toggle that hides it is not shown either.
- **Every layout**: the dashed analysis-zone circles take the subdued
  calm-tier style (see the notes under the behaviour matrix below).

The no-key 503 remains the authoritative fallback: whichever surface
fetches (`AiSummaryInline`, or `useAiSummary` behind the Pi AI view)
switches `aiSummaryAvailable` off on it (`isAiSummaryKeyMissing`), and
the settings read never switches it back on. That covers what the
settings read can't see: a `settings.json` edited after boot, or a boot
read that failed. Only that 503 does it — a 503 without a `reason` too,
since that comes from a server older than the field — while every other
failure, the "no weather data" 502 included, is transient: the surface
keeps what it shows and the next poll retries. Saving the key in
**Settings** (a localhost-only write) re-derives availability from the
value just written: adding a key brings the IA button, the slab and the
full-contrast circles back without a reload, and clearing it hides them.

---

## Caching layers, in order

Walking from the user's tap to Anthropic, the caches that can absorb the
load are:

1. **Browser cache** — none. The client re-issues
   `GET /api/weather-summary` every 15 minutes while the summary surface
   is mounted and the screen is awake (on the Pi only while the AI view is
   open), and immediately on a location change, a language / unit change,
   or wake from the screensaver.
2. **`summaryCache` in `aiSummaryCtrl.js`** — 15 min TTL (5 min for a
   truncated reply; refused and empty replies are never cached). First
   line of defense. A hit returns the cached text, never touches the
   network.
3. **`weatherCache` in `proxyCtrl.js`** (shared with the rest of the
   weather endpoints) — 15 min for current, 30 min for hourly, 6 h
   for daily. The AI summary reuses the same entries the rest of the
   app already populated.
4. **`tileCache` in `radarAnalyzerCtrl.js`** — 60 min per decoded tile
   (`TILE_CACHE_TTL`).
   Shared with `getRiskLevels` (the inner/outer ring colouring), so a
   typical poll cycle on a kiosk hits the cache for every tile.
5. **`analysisCache` in `radarAnalyzerCtrl.js`** — 5 min soft TTL for the
   formatted text (`ANALYSIS_CACHE_TTL`); past it, only the RainViewer
   frame index is re-fetched and the cached text is reused as long as the
   frames it would sample (now, -15 min, -45 min) are unchanged, up to a
   30 min hard TTL (`ANALYSIS_HARD_TTL_MS`). The soft TTL is shorter than
   the summary cache so radar context can refresh inside a single summary
   cache window if needed.
6. **Anthropic** — Claude.

A typical "all caches warm" call returns in 1-3 ms (the cache lookup +
JSON serialisation). On a summary-cache miss the Claude call dominates.
With Haiku 5.5's adaptive thinking, a radar prompt took ~4-5 s and a
no-radar prompt ~1-1.5 s in the 2026-10-08 smoke test (measured on the
maintainer's Mac through the real handler, with stubbed weather; to be
re-measured on a Pi). Haiku 4.5, called without thinking, answered in
roughly 0.4-1.2 s. A cold path adds the Tomorrow.io / RainViewer fetches
and PNG decodes on top: an end-to-end cold call with live weather and an
extended-radius radar over real precipitation took ~10 s on the Mac. `CLAUDE_TIMEOUT_MS` (30 s, one retry) leaves
ample headroom; don't tighten it without measuring p99 latency at
`CLAUDE_EFFORT`.

---

## Where to look in the code

| File | Purpose |
|---|---|
| `server/index.js` | Routes `/api/weather-summary` to `getWeatherSummary` |
| `server/aiSummaryCtrl.js` | Prompt assembly, Claude request / reply handling (`buildClaudeRequest`, `classifyClaudeReply`), summary cache |
| `server/radarAnalyzerCtrl.js` | RainViewer fetch, PNG decode, sampling, formatting |
| `server/proxyCtrl.js` | Shared weather cache (Tomorrow.io payloads) |
| `client/src/components/ambient/AiSummaryInline/index.js` | Display — the summary slab used by the desktop and mobile layouts (carries its own fetch + 15-min refresh) |
| `client/src/components/hooks/useAiSummary.js` | Fetch + refresh contract, extracted as a hook (15-min interval, `REFRESH_INTERVAL`). Consumed by `ambient/AiView`, the full-rail AI view opened from the IA dock button on every Pi layout (7" priority views and the 10.1" stacked rail) |
| `client/src/components/ambient/AiView/index.js` | Pi full-rail AI view; splits the summary into sections and finds the radar paragraph by its label (`RADAR_PREFIX`) |
| `client/src/components/ambient/SettingsPanel/index.js` | Settings UI for `advanced.ai.*` |
| `test/aiSummaryClaudeReply.test.js` | Locks the Haiku 5.5 request shape, the reply classification and the radar-label contract with `RADAR_PREFIX` (`npm test`; siblings `aiSummary.cache.test.js`, `aiSummaryCalmPath.test.js`) |
| `docs/api.md` | Endpoint reference (request params, error codes) |

---

## Privacy posture

The AI summary makes outbound calls to up to three third parties:

- **RainViewer** — public radar tile CDN, no API key, no user identifier.
  Standard CDN log retention applies.
- **Anthropic** — uses the user's own `anthropicApiKey`. The call carries
  the assembled prompt only. Anthropic's API
  [data-handling policies](https://docs.anthropic.com/en/docs/legal/data-protection)
  apply to that single inference call. No conversation history, no
  retention beyond what their default policy specifies.
- **Tomorrow.io** — normally not contacted: the AI summary reads the
  shared weather cache populated by the regular weather endpoints. When
  the current-conditions entry is missing or expired (e.g. cold boot), it
  makes its own `timesteps=current` request with the location's lat/lon
  and the user's `weatherApiKey`, through the shared dispatch spacer
  (recorded in the service status as "AI summary backfill").

The AI portion can be **disabled in three different shapes** — pick the
one that matches your concern:

1. **No AI at all** — leave `anthropicApiKey` empty. The client sees the
   empty key in its startup settings read and hides every AI surface (the
   Pi dock's IA button, the desktop / mobile slab) without requesting a
   summary; the endpoint would answer 503 anyway. No Anthropic call ever
   happens. The deterministic surfaces (rain-alert banner,
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
   the call rate at low end (a 30 min TTL drops 96 calls/day to 48; 96
   assumes continuous polling — a desktop / mobile client, or a Pi AI
   view left open, with the screen awake).

### Behaviour matrix across the AI / radar settings

| Configuration | Source | AI summary paragraphs 1+2 | AI summary paragraph 3 (radar narration) | Dashed analysis-zone circles | Rain-alert banner |
|---|---|:---:|:---:|:---:|:---:|
| No `anthropicApiKey` | — | ❌ | ❌ | ✅ subdued | ✅ |
| Key + `radarAnalysisEnabled: true` + active weather | Claude | ✅ | ✅ | ✅ full contrast | ✅ |
| Key + `radarAnalysisEnabled: true` + calm + fast-path on (default) | **Template (no Claude call)** | ✅ | ✅ (templated "nothing to report") | ✅ full contrast | ✅ |
| Key + `radarAnalysisEnabled: false` | Claude (calm + fast-path on: two-paragraph template, no Claude call) | ✅ | ❌ | ❌ | ✅ |

Notes:
- The **calm-day fast path** (third row) is enabled by default via `advanced.ai.calmDayFastPath: true`. It triggers when **all four** of: (1) current weather code is in the benign range (no 4xxx-8000), (2) current precipitation probability < 20 %, (3) period forecast's max precipitation probability < 20 %, (4) the radar snapshot, if one was obtained, shows no `Active` zone — an unavailable or disabled radar block passes this gate. The current temperature must also be present and the period max must be known (a missing period forecast defers to Claude). When all four hold, the server renders a three-paragraph template (current conditions + period forecast + radar "nothing to report within 50 km / 100 km, or 30 mi / 60 mi, depending on `extendedRadius`"; the radar paragraph is dropped when radar analysis is off), no Anthropic tokens spent. The radar gate exists specifically to defend against the case where Tomorrow.io reports calm but RainViewer already shows an approaching band — in that case the fast path bails out and Claude takes over so the summary stays honest. Set `calmDayFastPath: false` to always invoke Claude regardless of conditions.
- The "subdued" treatment in the no-key case lowers the calm-tier ring's opacity (0.85 → 0.35) and switches to a sparser dash pattern (`6 6` → `3 9`); coloured tiers (yellow / orange / red) keep their full contrast — alerts need to stay loud regardless of AI availability.
