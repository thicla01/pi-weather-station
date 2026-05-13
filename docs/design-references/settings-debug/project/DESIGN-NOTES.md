# Pi Weather Station — Design Notes (v2 refinement)

Direction **C — Ambient Layers** retained. These notes document the
decisions made during the v2 refinement so they survive into the
implementation phase.

---

## 1. Layout strategy

Three layouts, all driven by viewport width:

| Width | Layout |
|---|---|
| `≤ 800` | **7″ Pi split.** Horizontal 70/30 — map left (~540×430), info column right (~248×430), full-width BottomDock (52 px) below. A chevron pinned to the map's right edge collapses the info column → radar gains full width (~740×430). When collapsed AND alerts are active, a compact alert mini-banner floats over the radar top-centre. |
| `> 800` | **Desktop right-rail.** Hero band across the top (place / temp / clock as 3 slabs), full-bleed radar behind, right rail with metrics + forecast + indoor + AI, radar timeline anchored bottom-left of map area, BottomDock spans the full width. |

Slabs are corner-radiused `8 px` (compact) or `10–14 px` (desktop). Padding scales from 8/10 px on Pi to 16–20 px on Full HD. Vertical gaps between slabs in the info column: `6 px` Pi, `10 px` desktop.

## 2. Hybrid "instrumentation" mode

A single code path. The same C layout, but when severity escalates, four visual injections turn on:

| Injection | What changes |
|---|---|
| **Severity strip** | Slabs with a critical metric (wind ≥ 40 kph, pressure falling-fast, alert-bearing slabs) gain a 3–4 px left border in the tier colour: red `#a83232` / amber `#c4683a`. |
| **Mono numerals** | Critical numbers (temperature, wind, pressure, alert confidence) shift from `Geist` display to `Geist Mono` / `JetBrains Mono`. Body/heading typography is unchanged. |
| **Opacity bump** | Slab surface alpha shifts from 0.85–0.92 → 0.94–0.98. Borders bump similarly. The layout becomes more "instrument" without changing structure. |
| **Severity-coded chips** | Confidence pills on banners stay on the banner colour (white text on alpha-25 white). Free-standing pills use bucket colour. |

**Auto-trigger logic** (see `WX.hybridLevel(data)`):

```js
if (maxAlertTier === 'red')                    → 'red'
else if (maxAlertTier === 'amber')             → 'amber'
else if (radar === 'severe')                   → 'red'
else if (radar === 'rain' && confidence ≥ 70)  → 'amber'
else                                            → null  (pure C)
```

The prototype's Tweaks panel exposes a manual `hybridForce: 'auto'|'on'|'off'` for comparison.

## 3. Tokens

Four palettes in `cTokens`. All are object-keyed by role rather than swatch.

| Role | day | dusk | night | nightRed |
|---|---|---|---|---|
| `bg` | `#f2eee5` | `#1c1a17` | `#0d0d0c` | `#0a0202` |
| `text` | `#1f1c17` | `#d8d4cc` | `#c8c4b8` | `#cc3838` |
| `textDim` | `#5d564b` | `#8a8680` | `#6c6960` | `#7a2020` |
| `accent` | `#1f6b5e` | `#e8a050` | `#c4925f` | `#e85050` |
| `surface` | `rgba(255,255,255,0.92)` | `rgba(38,34,30,0.85)` | `rgba(20,20,18,0.88)` | `rgba(40,5,5,0.85)` |
| `surfaceHybrid` | `rgba(255,255,255,0.98)` | `rgba(38,34,30,0.95)` | `rgba(28,28,25,0.96)` | `rgba(60,8,8,0.94)` |
| `danger` | `#a83232` | `#d96552` | `#b35040` | `#ff5050` |
| `warn` | `#c4683a` | `#e08858` | `#c98555` | `#e07070` |

**Dusk and night use desaturated warm-grey.** An earlier warm-dim variant (more amber bias — `dusk.bg #2a2018` / `night.bg #0c0b09`, `dusk.text #f1d7a8` / `night.text #d4b88c`) was prototyped and discarded after side-by-side comparison. The desaturated palette gives radar tiles better chromatic fidelity (yellow / orange / red intensity encoders read accurately against a neutral surface), severity strips contrast more clearly against a neutral bg, and the palette suits a wider range of deployment contexts. Text retains a subtle warm tint (`#d8d4cc` / `#c8c4b8`) — not cold steel grey.

`nightRed` is **long-wavelength red** — for bedside/corridor visibility without disturbing sleep. Kept fully warm — that's where the real chroma earns its place. Pair with `mode: 'sleep'` for ambient clock, or `mode: 'sleep-stage2'` for full burn-in protection (single drifting pixel on black).

## 4. Performance — backdrop-filter

`backdrop-filter: blur(20px)` was on every slab in v1. Removed in v2:

- Slab `background` is now an **opaque rgba()** equivalent (e.g. `rgba(255,255,255,0.92)`). Compositor cost: zero blur layers.
- A `useBlur` flag is plumbed through but **off by default**. Implementation should set it to `true` only when `window.matchMedia('(min-width: 1280px)').matches` AND a hardware capability check (e.g. user agent hints, or a `requestIdleCallback` benchmark on startup). Pi 4 → never on. Pi 5 → optionally on for ≥ HD output.

Documented in code with a comment block at the top of `direction-c-ambient.jsx`.

## 5. Features added (filling v2.13 gaps)

| Feature | Where | Component |
|---|---|---|
| Source badges (RADAR/ECCC/NWS) | Banner header + alert detail | `SourceBadge` |
| Confidence pill `[NN%]` | Banner header + sleep alert chip | `ConfidencePill` (bucket: high ≥70 green, med 40–69 amber, low <40 red) |
| Multi-alert `+N` badge | Banner header, cycle on tap | `AlertBanner` |
| Alert-detail overlay with QR | Tap ▸ on banner | `AlertDetailOverlay` + `QrCode` (mock 21×21) |
| Floating alert mini-banner | Pi collapsed mode, map top-centre | `AlertBanner compact` |
| Direction-arrows toggle | Map top-left controls, 3rd button | `MapBg showDirectionArrows` |
| 50 / 100 km rings | Always on; 100 km turns red when `extendedRadius` | `MapBg showRings extendedRadius` |
| Sample-points debug grid | Settings toggle | `MapBg showSamplePoints` |
| Radar timeline scrubber | Bottom of map area | `RadarTimeline` |
| Indoor block | Right column / right rail | `IndoorBlock` |
| Brightness slider | Settings overlay only (hardware-gated) | `SettingsOverlay` |
| AI summary | Collapsible button on Pi, full card on desktop, full-screen overlay on tap | `AiSummaryHeader` / `AiCard` / `AiOverlay` |

## 6. BottomDock — discoverability

- Every button carries a **permanent text label** under the icon (Centre, Layers, Charts, Sleep, Settings). No tooltip-only state.
- Minimum touch target: **44 × 44 px** on all sizes (compact `min-width: 64 px`, desktop `min-width: 88 px`).
- Active state: `aria-pressed`, background tint to `accentSoft`, accent-coloured icon + label, plus a 2 px underline so users can see at a glance which overlay is open.

## 7. Sleep mode

| Stage | What's on screen |
|---|---|
| `sleep` (day/dusk/night/nightRed) | Big clock, place, current condition + temp, current alert title (if any), tap-to-wake hint. Palette inherits `timeOfDay`. Position drifts ±14 px every few seconds for burn-in. |
| `sleep-stage2` | Pure black background with a single 2×2 px drifting dot (colour from `timeOfDay`: dim grey for day/dusk/night, `#660000` for nightRed). All-OLED burn-in protection. |

Stage 2 should activate after `n` minutes of idle after `sleep` (implementation: timer in mount).

## 8. Breakpoints recap

```
≤  800px → 7″ Pi split layout
> 800px → desktop right-rail
≥ 1600px → desktop with larger hero / rail width (340 vs 300)
≥ 1280px → useBlur eligible (hardware-gated)
```

## 9. Files

```
lib/data.jsx              — scenarios + helpers (multi-alert, confidence, motion vector)
lib/icons.jsx             — line-style weather icons
lib/map-bg.jsx            — radar + overlays (rings, arrows, samples, timeline frame)
lib/c-components.jsx      — shared badges, banners, alert detail, QR, indoor, timeline
lib/direction-c-ambient.jsx — main C direction (LayoutPi + LayoutDesktop + Sleep)
Pi Weather Station — Prototype.html  — live tweakable prototype
Pi Weather Station — Designs.html    — design canvas (C focus, A/B archived)
```

## 10. v2.13 maintainer feedback — applied

### 10.1 Alert detail → inline collapsible (not overlay)

The detail view now expands **under** the banner in the same column, preserving the map view. Implemented in `AlertDetailInline`:

```
┌──────────────────────────────────┐
│ AlertBanner (tap to expand)      │ ◀ borderRadius 8 8 0 0 when open
├──────────────────────────────────┤
│ description (scroll-area)         │ flex: 1 1 auto; min-height: 0
│ flex: 1; min-height: 0; overflow │
│                                  │
├──────────────────────────────────┤
│ QR  · phone-readable URL          │ flex-shrink: 0; pinned footer
└──────────────────────────────────┘
```

`AlertDetailOverlay` is retained in `c-components.jsx` but no longer wired into either layout — kept as reference / debug path.

### 10.2 AI summary → visible inline by default

Pi info column now renders `AiSummaryInline` (not `AiSummaryHeader`). Three paragraphs shown by default. Chevron at top-right **collapses** it on demand — the inverse of v1.

Header carries: status dot · "AI summary" · confidence pill (bucketed colour) · last-updated stamp · collapse chevron. Same component is the basis for the desktop `AiCard` (always expanded, scrollable).

### 10.3 Settings overlay — full advanced-sleep exposure

```
Display
  Brightness               [slider 5–100 %]
  → POST /api/brightness   (Pi server detects /sys/class/backlight/<device>/brightness)

Sleep
  Stage 1 · idle delay     [slider 1–60 min, default 10]
  Stage 1 · dim brightness [slider 5–100 %, default 30]
  ☑ Stage 2 · burn-in protection (drifting pixel)   (default true)
    Stage 2 · delay after sleep   [slider 5–120 min, default 20]

Map
  ☐ Show sample points (debug)
  ☐ Extended radius (100 km red)
```

These map 1:1 to the existing `settings.json → advancedSleep` keys.

### 10.4 QR code payload

Stable government URLs only — **no lat/lon query parameters** (ECCC logs referrers).

| Locale | URL |
|---|---|
| FR | `https://meteo.gc.ca/index_f.html#alerttable` |
| EN | `https://weather.gc.ca/index_e.html#alerttable` |
| NWS (US) | `https://www.weather.gov/` |

The `#alerttable` hash scrolls phone users straight to the alerts table. Mock 21×21 QR in this prototype is for visual placement; production uses `qrcode.react`.

## 11. Confirmed answers to open questions

- **Hybrid amber threshold** → 70 % confirmed (matches `CONFIDENCE_HIGH` constant already driving confidence pills).
- **Stage 2 timing** → user-configurable in settings; defaults match v2.13 (`stage1Delay: 10`, `stage1Brightness: 30 %`, `stage2Enabled: true`, `stage2Delay: 20`).
- **Brightness API** → `POST /api/brightness { value: 0..100 }`; server handles path-detection and percentage→native conversion.
- **QR payload** → `https://meteo.gc.ca/index_f.html#alerttable` (FR) / `weather.gc.ca/index_e.html#alerttable` (EN) / `weather.gov/` (NWS), encoded as-is with `qrcode.react`.

---

## 12. Settings panel — 4-section IA + API keys arrangement

The Settings IA is locked in to four sections that mirror the **access
matrix** (who can change what from where), not the visual grouping:

1. **Préférences** — `localStorage`, per-device, no access restriction.
   Language / fontSize / dark mode / clock / units / hideMouse /
   hideRadarLegend. Always editable, even on remote.
2. **Configuration & API keys** — server-side `settings.json`,
   localhost-only writes. Reads allowed remotely with API key values
   masked. Marked with a small `⚿` lock glyph next to the heading and
   a `LECTURE SEULE / READ-ONLY` pill when on remote.
3. **Avancé** — same access semantics as §2, but collapsed by default
   to keep the panel short for non-power users. Houses Display
   variants, AI flags, and the four new Direction C sleep params
   (`stage1Delay`, `stage1Brightness`, `stage2Enabled`, `stage2Delay`).
4. **Expérimental** — collapsible, empty today. Designed empty state
   shipped now so the first opt-in flag (`experimentalUiC`) lands
   without surprise.

### Remote read-only state

A single amber notice at the top of §2 explains why the section is
read-only and links to the README anchor. Below that:

- API key fields → status pills (`✓ Configured` green · `○ Not
  configured` neutral · `✕ Invalid` red).
- Coordinate / homebridge / brightness fields → read-only text, no
  border highlight, no edit affordance.
- Sections 3-4 → entire section dimmed to ~65 % opacity, controls
  rendered in their current state but non-interactive.
- The Save footer is hidden entirely on remote (no possible action).

### API keys — three arrangements explored

| Variant | Strength | Cost |
|---|---|---|
| **A · Provider cards grid** | Highest visual weight per provider — logo letter, name, badge, description, status, input field stacked. Best for first-time installs (the “what is this for?” copy is right next to the input). | Heavy. On 7" Pi the grid is 2 columns × 3 rows; eats ~280 px of the panel. Crowds out the other 3 sections. |
| **B · Tight list with inline status** *(recommended)* | Densest. One row per provider: status dot · name + tier · key field · what-it-unlocks copy. ~28 px per row → all 6 keys fit in ~170 px. Required vs optional encoded in the small tier tag, not in a separate column — survives translation. | Description text truncates with ellipsis at 7" widths. Acceptable: full copy lives in the placeholder when the input is focused. |
| **C · Required + disclosed optional** | Strongest first-install affordance: only the 2 required fields are visible by default; optional 4 sit behind a “Show optional providers (4)” button with a `n/4 configured` counter. Reduces decision fatigue for new users. | Hides legitimate work for experienced users every time they open the panel. The disclose button is a permanent extra click. |

**Recommendation: variant B (tight list).** Reasoning:

- The maintainer is the primary audience; once past first-boot, they
  want to scan all 6 statuses at once. B does that in one viewport.
- Required vs optional is communicated by a small uppercase tag and
  the inline status dot — strong enough without a structural split.
- Description copy lives one column over from the input, not stacked
  underneath — preserves vertical room for sections 2-4.
- If the team decides first-install friction is a real concern, ship
  variant **C as a one-time onboarding overlay** (separate surface,
  triggered when no `required` keys are set) rather than making every
  subsequent open pay the click cost.

Cards (A) is kept in the canvas as a reference but not recommended —
it pushes Homebridge + coords + brightness below the fold on the 7"
Pi, breaking the section's coherence.

---

## 13. Debug panel — task-focused navigation

The current Debug panel renders 12 sections stacked vertically. On a
7" screen this means ~2400 px of scroll. The redesign keeps **all 12
sections** but groups them into **5 task buckets** that reflect what
the maintainer is actually trying to find out:

| Bucket | Sections | When |
|---|---|---|
| **Server** | ServerConfig · ServerKPI · Logs | "Is the kiosk itself healthy?" |
| **Client** | ClientKPI · Remote clients · Security | "What does the browser see / who is hitting us?" |
| **Services** | Provider statuspages · Last service calls · Quota | "Is provider X down? Are we close to a cap?" |
| **Storage** | Cache · Radar snapshots | "What is in memory, can I flush it?" |
| **About** | Vulnerability scan | "Any open Dependabot PRs?" |

Three navigation patterns explored against this grouping:

| Variant | Strength | Cost |
|---|---|---|
| **A · Vertical tab rail** *(recommended)* | The bucket the user picked is always visible (active state lit) — they can sweep between buckets one tap at a time, no scrolling-to-find-nav. Rail collapses to a 64 px column on 7", expanding to 92 px on HD. 5 buckets × 48 px tall = 240 px, fits within the 480 px screen height with the header on top. | Loses the “everything visible at once” property of the current scroll layout. Mitigated by the fact that within a bucket, all sections expand by default — full data is still one tap away. |
| **B · Chip-bar pager** | Most touch-native. Chips sit horizontally above the content, swipeable on touchscreens. Larger hit targets (32 px tall × ~80 px wide). | Steals 48 px of vertical room at the top — meaningful on a 480 px screen. Chip-bar overflow on small screens forces horizontal scroll, which is exactly what the maintainer complained about for the current layout. |
| **C · Search + collapsible accordion** | Best for the “I know what I'm looking for” case — typing `quota` filters down to the Quota section instantly. Sections also stay collapsed by default, so the panel is short. | Requires the maintainer to know section names. On a touchscreen, requires the on-screen keyboard. Discovery is hostile to occasional users. |

**Recommendation: variant A (vertical tab rail).** It directly answers
the maintainer's request — *« voir dans un premier temps les paramètres
serveurs, ensuite les paramètres clients, ou bien les statuts des
services »* — by making each task bucket a single-tap destination.
The rail is also the most legible state indicator for "where am I"
on a small touchscreen.

Search (C) is kept in the prototype as a power-user override; the
implementation can ship A by default and add a keyboard shortcut
(`/`) that toggles a search input over the rail.

### Per-section preservation

Every existing affordance is preserved on every section header:

- Copy / Export CSV / Export JSON / Flush / Refresh buttons sit
  inline with the section title, right-aligned, in a small mono
  uppercase style consistent with the rest of Direction C.
- Sections retain individual collapse chevrons so a section can be
  hidden within a bucket if it's noisy (e.g. collapse Logs while
  reading ServerKPI).
- The fixed header keeps the v / commit / branch / online indicator
  + global Refresh + Export CSV buttons — unchanged.

### Debug button — BottomDock placement

The Debug button is the **rightmost** slot in the BottomDock,
immediately to the right of the gear / Settings button so the
maintainer reaches it naturally when troubleshooting (gear→bug is a
common path). Active state: accent icon + label, 2 px accent
underline, consistent with how the existing dock buttons indicate an
open overlay. Visibility rules — `DEBUG=true` env var **AND** local
access — are enforced by the same gate that hides `/api/debug` on
remote (no client-side opt-out possible).

