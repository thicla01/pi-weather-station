# UI Direction C — Implementation Plan

**Status:** ✅ **Programme closed — 2026-07.** The last outstanding item (Phase 10's
`experimentalUiC` flag removal + the legacy-code purge) landed with the deletion of the
v2 component tree. The v3 "Ambient Layers" tree is now the only interface.
**Target version:** v3.0.0 — *see "How it actually shipped" below; it never shipped under
that number.*
**Last updated:** 2026-07-26 (closure note) — plan body last edited 2026-05-12 (Claude Opus 4.7)

> **Read this before the checkboxes below.** This file is kept in place as the historical
> record of the Direction C programme. **The unchecked boxes are NOT open work** — they are
> the plan as written in May 2026, preserved verbatim. Items that were dropped, reshaped, or
> absorbed into other PRs were never ticked, and the programme closed anyway. Do not mine
> this file for a backlog; the live backlog is `ROADMAP.md`.

### How it actually shipped (two divergences from the plan)

1. **Not v3.0.0.** The version line ran **2.18 → 2.19 → 3.1.0** (June 2026). The major bump
   was renumbered to `3.1.0` to match the completed **v3.1 design programme** rather than the
   `v3.0.0` this plan assumed, so the number on the tag lines up with the design phase that
   actually shipped. Phase 10's `package.json` / tag / release steps therefore read `3.1.0`,
   not `3.0.0`.
2. **Not four PRs.** Phases 7-10 were planned as PRs #9-#12. In practice they landed across
   roughly a dozen PRs spread over June-July 2026, with the settings and debug refreshes,
   the v3.1 phases, the v3.2 radar states and the display-scale work interleaved.

---

## Context

After ~30 PRs that landed in v2.13.0 (radar trends, confidence scoring, drifting trend,
alert banner with cycling, gov-alert detail with QR, direction-arrow overlay), the
UI surface accumulated a lot of new affordances on top of the original v2 layout.

We commissioned Claude Design to propose three exploration directions for a UI
refresh:

- **A — Ops Console:** instrument-grade, dense data ribbons, NEXRAD-style severity coding.
- **B — Editorial Atlas:** magazine-grade typography, generous whitespace, serif numerals.
- **C — Ambient Layers:** day/night-adaptive palette, full-bleed map, floating slabs.

After evaluation, **Direction C** was retained as the base, with **automatic
hybrid injections from A** when the situation gets dense (severe alert, intense
radar). This keeps a single component tree (vs. 2× maintenance cost for two
parallel layouts) while preserving the "instrument" feel when it matters.

Several rounds of refinement landed on the final design package
(`ZBuzz5lra42fwls8dhaJFg`). Key decisions:

- 7" Pi (800×480): horizontal split 70/30 — map left, info column right, full-width dock.
- Desktop (>800px): full-bleed map with right rail.
- Palette: warm-grey (not warm-dim) — better radar tile fidelity, better severity-strip contrast.
- AlertDetail: inline collapsible (not full-screen overlay) — keeps map visible.
- AI summary: visible inline by default (not hidden behind a tap).
- `backdrop-filter: blur(...)` off by default — opaque rgba surfaces for Pi 4 compat.
- 4 palettes: `day` / `dusk` / `night` / `nightRed`. The latter is the existing
  melatonin-friendly sleep mode preserved.
- All 4 `advancedSleep` params (`stage1Delay 10`, `stage1Brightness 30`,
  `stage2Enabled`, `stage2Delay 20`) exposed in `SettingsOverlay`.

---

## High-level approach

**Branch:** dedicated long-running `feat/ui-direction-c`, rebased on master regularly.

**Feature flag:** `experimentalUiC` in settings.json, off by default. Wrapper in
`App.js` switches between the current layout and `<AmbientLayers/>`. This means
master can keep merging UI-C work without breaking production kiosks until the
flag is flipped at v3.0.0.

**PR cadence:** progressive — each phase merges to master via its own PR, gated
by the flag. No big-bang merge. The user toggles the flag on a dev Pi to test
each phase as it lands.

**Estimated effort:** ~14-17 evening sessions over ~4 weeks at normal pace.
(Includes the Settings + Debug panel refresh shipped as a separate Claude Design
package in May 2026, integrated here as Phases 8 and 9.)

---

## Phase 0 — Preparation (≈ 1h)

Goal: scaffold the parallel layout system without changing existing UX.

- [ ] Create branch `feat/ui-direction-c` from master.
- [ ] Add `experimentalUiC: boolean` to `settings.json` schema (server-side whitelist).
- [ ] Wire setting → `AppContext` → root `App.js` toggle:
  ```jsx
  {experimentalUiC ? <AmbientLayers /> : <CurrentLayout />}
  ```
- [ ] Add hidden Settings toggle "Experimental UI" (only visible when DEBUG=true) to flip the flag in-app for dev.
- [ ] Create empty placeholder `<AmbientLayers />` component that just renders
  "Direction C — under construction" so the flag is testable end-to-end.
- [ ] Ship as PR #1 of the cycle.

**Deliverable:** `feat/ui-direction-c` branch alive on GitHub, flag wired,
placeholder visible when toggled.

---

## Phase 1 — Foundations (≈ 3h)

Goal: shared infrastructure all components will depend on.

- [x] **Design tokens** — `client/src/ui/tokens.js`:
  - Export the 4 palette objects (`day`, `dusk`, `night`, `nightRed`) with all
    roles (`bg`, `text`, `textDim`, `accent`, `accentSoft`, `surface`,
    `surfaceHybrid`, `border`, `borderHybrid`, `warn`, `danger`, `cool`).
  - `dusk` matches the Phase 0 anchors; the other three palettes were
    derived for internal coherence and will be re-validated against the
    Claude Design mockup once Phase 3's Hero composition is on screen.
- [x] **Hybrid helper** — `client/src/ui/hybrid.js`:
  - `hybridLevel(data)` returns `none` / `light` / `full` based on
    `govAlerts` severity. `confidenceBucket(pct)` lifted from
    `AlertBanner` (will become the single source of truth in Phase 2+).
  - Hooks: `useHybridMode()`, `useTimeOfDay()` — the latter is currently
    a `darkMode` + `sleepNightMode` shim and will gain real solar-time
    awareness in Phase 5.
- [x] **Fonts** — Geist + Geist Mono:
  - Self-hosted under `client/src/ui/fonts/` (Regular / Medium / Bold
    for sans, Medium for mono). The `geist` npm package was tried first
    but its `exports` field is Next.js-specific and blocks webpack from
    resolving raw woff2 paths. Self-hosting four files is simpler.
  - `@font-face` declarations in `client/src/ui/fonts.css`, loaded via
    `font-display: swap` so there's no FOUC on the Pi's first paint.
- [x] **Lightweight CSS reset** — `client/src/ui/reset.css`:
  - Box-sizing, baseline removal, button reset, tap-highlight removal.
  - **Scoped under `.ambientRoot`** so it can't disturb the v2 layout
    during the rollout; Phase 10 drops the scope.

**Deliverable:** PR #2. Tokens + helpers + fonts available app-wide.
AmbientLayers placeholder uses tokens.day for a colored background as smoke test.

---

## Phase 2 — Shared components (≈ 5h)

Goal: build the reusable atomic components first, before any layout work.
Each gets its own visual storybook entry and unit tests.

Files: `client/src/components/ambient/` (new directory).

- [x] `SourceBadge` — RADAR/ECCC/NWS pill.
- [x] `ConfidencePill` — `[NN%]` with bucket colour (green ≥70 / amber 40-69 / red <40).
- [x] `AlertBanner` — slab-style with left-edge severity strip; supports
  cycling (+N), source badge, confidence pill. Pure logic extracted to
  `ui/alertLogic.js` so both the v2 banner and the Direction C variant
  render off the same state machine.
- [x] `AlertDetailInline` — collapsible section, scroll-area + pinned QR
  footer. `max-height: calc(100vh - 280px)` cap + flex chain preserved
  from the v2 incident notes (PR #103).
- [x] `QrCode` — wrapper around `qrcode.react` (already in deps), 96×96
  default. Palette-aware fg/bg.
- [x] `IndoorBlock` — temp/humidity/AQ trio when Homebridge configured.
  Stale data fades the slab instead of v2's alarming red dot.
- [ ] `RadarTimeline` — **deferred to Phase 3.** It currently lives
  inline inside `WeatherMap` (a 1099-line file). The clean moment to
  extract is when Phase 3's `LayoutPi` decides where to anchor the
  timeline (bottom-left of the map area); doing it earlier would mean
  guessing the anchor twice.
- [x] Unit tests via Node's native `node:test`: 16 tests for
  `ui/hybrid.js` (confidenceBucket boundaries + hybridLevel severity
  precedence), 18 tests for `ui/alertLogic.js` (SHOW gate, bumped vs
  drifting, confidence softening, source-ring selection).

**Deliverable:** PR #3-#4 (split if needed for review size). Shared components
available, tested, ready to be composed into layouts.

---

## Phase 3 — Pi 7" layout (≈ 4h)

Goal: implement the small-screen layout (800×480 and similar). This is the most
sensitive target — the official Pi 7" touchscreen most users have.

- [~] **`RadarTimeline` extraction (carried over from Phase 2)** —
  **deferred to Phase 10 cleanup.** The scrubber currently inlined
  inside `WeatherMap` (line 439) renders correctly inside the v3 map
  cell already; lifting it into its own ambient component requires
  promoting the radar frame state into AppContext, which is a wide
  change for limited end-user benefit at this stage. The functional
  piece works — the architectural separation is what's deferred.
- [ ] `LayoutPi` — split 70/30 grid with `mapW = w - colW`, collapsible right
  column, full-width 52px dock.
- [ ] `HeroCompact` — combined location + temperature + description + wind in
  one slab.
- [ ] `MetricsGrid` — 2×2 grid: Wind / Humidity / UV / AQI.
- [ ] `ChartTabs` — Hourly/Daily tabs with mini-chart, port existing chart logic.
- [ ] `AiSummaryInline` — 3 paragraphs visible by default, chevron collapses on demand.
- [ ] `BottomDock` — discoverable controls with permanent text labels under icons,
  44×44 min touch target, active state with accent underline.
- [ ] Floating mini-banner overlay when `collapsed === true` AND alerts active.
- [ ] Chevron collapse toggle pinned to map's right edge.
- [ ] Test on HMIRaspi via VPN — it's the most accurate small-screen target
  (Pi at a friend's home running v2.13).

**Deliverable:** PR #5. The Pi layout works end-to-end when experimentalUiC is on.

---

## Phase 4 — Desktop layout (≈ 3h)

Goal: implement the >800px layout (HD monitor and bigger).

- [x] `LayoutDesktop` — hero band top-left, right rail overlaid on the
  right edge, **full-bleed map fills the entire main area behind
  everything**. Translucent slabs (warm-grey surface tokens) let the
  radar show through subtly so the kiosk reads as ambient rather than
  partitioned.
- [x] `HeroBand` — the plan asked for three separate slabs
  (`HeroPlaceDesktop` / `HeroTempDesktop` / `HeroClockDesktop`).
  Collapsed into a single `HeroBand` with three internal panels +
  dividers because the visual goal is a wide cohesive top slab, and
  three separate slabs would have introduced gap noise.
- [x] Right rail reuses the Phase 3 composites (`AlertBanner`,
  `AlertDetailInline`, `MetricsGrid`, `IndoorBlock`, `ChartTabs`,
  `AiSummaryInline`). `TimeBlock` + `HeroCompact` are intentionally
  omitted from the desktop rail because the HeroBand at the top
  carries the same information.
- [~] Radar timeline anchored bottom-left — the existing inline
  scrubber inside `WeatherMap` already renders correctly in the
  full-bleed map area. Full extraction stays deferred to Phase 10
  cleanup.
- [x] Two breakpoints: ≥ 1280 px (rail 320 px, hero 140 px) and ≥
  1600 px (rail 360 px, hero 180 px, larger hero font sizes).
- [x] `AmbientLayers` becomes a dispatcher — `window.matchMedia`
  on the 1280 px breakpoint, live updates on resize, switches between
  `LayoutPi` and `LayoutDesktop`. `data-layout="pi|desktop"` exposed
  for diagnostics.
- [ ] Test on dev Mac at multiple window sizes (1280, 1600, 1920).

**Deliverable:** PR #6. Desktop layout matches the design at 1366, 1920, and intermediate sizes.

---

## Phase 5 — Sleep mode (≈ 2h)

Goal: integrate the new sleep-mode palette system. The Settings panel itself
is deferred to **Phase 8** (full Settings refresh — own Claude Design package);
during Phase 5, sleep-mode configuration continues to ride on the existing v2
Settings panel via the `advancedSleep.*` fields already in `settings.json`.

- [x] `AmbientSleep` — handled by refactoring the existing v2
  `ScreenSaver` to read its palette decision from `useTimeOfDay()`
  rather than directly from `darkMode` + `sleepNightMode`. The v2
  ScreenSaver was already palette-aware, battle-tested for the
  ghost-click absorption and the anti-burn-in dot — replacing it
  wholesale would have been risky for limited gain.
  - `day`: cream (default)
  - `dusk`: warm-grey cream-on-anthracite (renamed from `night-cream`)
  - `night`: aliased to `dusk` for now — will differentiate visually
    once Phase 5+ wires real solar position into `useTimeOfDay()`
  - `nightRed`: long-wavelength red (unchanged from v2.13)
- [x] Stage 2 burn-in protection — already correct in the v2
  ScreenSaver (4 px dot on 5×5 grid, repositioned every 5 min, colour
  picks up from the active variant's `--dot` token).
- [x] Transition timer — `useIdleDetection` hook drives stage 1 / 2 /
  wake on any input, already in v2.
- [x] `/api/brightness` connection — already wired in `App/index.js`
  for stage transitions.
- [x] Settings continue to live in the legacy v2 panel via
  `advancedSleep.*` — no UI work in this phase.

**Deliverable:** PR #7. Sleep mode renders correctly under Direction C; the
v2 Settings panel still pilots the four `advancedSleep` params.

---

## Phase 6 — Hybrid mode + i18n (≈ 3h)

Goal: wire the auto-trigger for hybrid instrumentation mode, and translate everything.

- [x] `useHybridMode()` — already built in Phase 1. Returns
  `none` / `light` / `full` based on `govAlerts` severity. (Renamed
  from the plan's `null | amber | red` vocabulary so the strings map
  to existing CSS class names better.)
- [x] Hybrid injections driven via CSS custom properties on the
  AmbientLayers root — every slab picks up the escalation without
  per-component logic:
  - `--c-surface` swaps 0.85α → 0.96α
  - `--c-border` strengthens to match
  - `--c-strip-color` resolves to warn / danger / transparent
  - Opted-in slabs (HeroBand, HeroCompact, MetricsGrid cells,
    IndoorBlock) render the strip via `box-shadow: inset 4px 0 0`.
    AlertBanner keeps its own strip from Phase 2b.
  - Mono numerals: already pervasive since Phase 3 — no toggle needed.
  - Severity-coded chips: ConfidencePill bucket colours from Phase 2a
    cover this requirement.
- [x] i18n extraction: added incrementally during Phases 3a/3b/3c
  (`metrics.*`, `charts.tab24h/tab5d`, `controls.collapsePanel/
  expandPanel/updateAvailableRemote`). 19 distinct i18n key references
  across the ambient namespace — coverage complete.
- [ ] Test all 3 locales on the same kiosk.

**Deliverable:** PR #8. Hybrid mode visible on severe scenarios, i18n complete in 3 langs.

---

## Phase 7 — Stabilisation (≈ 3h)

Goal: integrate v2 user-facing features and polish before release.

- [x] **Font size wrapper** — `zoom: { s: 0.85, m: 1, l: 1.15 }[fontSize]`
  applied to the AmbientLayers root via inline style, plus
  `height: calc(100dvh / fontSizeZoom)` so the internal viewport
  references still cover the screen. Same trick v2 uses on its
  info-container. `data-font-size` attribute exposed for diagnostics.
- [ ] **Responsive polish** — test at 800×480, 1024×600, 1280×720,
  1366×768, 1600×900, 1920×1080. Fix any breakpoint gaps. *(requires
  manual browser testing across resolutions — pending session.)*
- [ ] **Performance benchmarks** — measure FPS during radar animation
  and banner cycling on Pi 4. *(requires Pi 4 access — pending.)*
- [ ] **Visual regression** — capture screenshots of key states
  (calm/rain/severe, day/dusk/night/nightRed, hybrid on/off) for the
  README update. *(captured live during dev sessions; formal README
  integration belongs to Phase 10.)*
- [x] **Remove the experimentalUiC flag** — *moved to Phase 10
  (release)* so the flag is still live through the Settings + Debug
  refresh phases. **Done 2026-07**, together with the v2-tree deletion
  (see the Phase 10 entries below) — the flag outlived the release
  itself, deliberately kept as a per-device rollback through the v3
  field-test window before being purged.
- [ ] **Cleanup** — delete unused tokens, prune dead code paths from
  the Direction C codebase as it stabilises. *(deferred to Phase 10
  cleanup pass — too early to know what's truly unused while panels
  are still being added.)*

**Deliverable:** PR #9. Direction C stable, ready for the panel refreshes.

---

## Phase 8 — Settings panel refresh (≈ 4h)

Goal: replace the legacy v2 Settings overlay with the new 4-section structure
delivered by Claude Design (package `NzSzPtOReHNfiDZzxJMWQA`, see
`docs/settings-debug-design-request.md`). Recommended variant for API keys:
**variant B (tight list)** with one row per provider (status dot + name + tier
tag + key field + what-it-unlocks copy).

- [ ] `SettingsPanel` — main container, replaces existing `Settings/index.js`.
  Imports the 4 section components below.
- [ ] **Section 1 · Préférences** — language, fontSize (S/M/L), darkMode auto/on/off,
  clockTime (12/24), units (temperature/speed/length/distance), hideMouse,
  hideRadarLegend. Always editable, even on remote (all stored in
  `localStorage`).
- [ ] **Section 2 · Configuration & API keys** — variant B layout:
  - One row per provider: status dot (✓ green / ○ neutral / ✕ red) · name +
    `REQUIRED` or `OPTIONAL` uppercase tag · key field · description copy.
  - Below: custom coordinates (lat/lon), radar source toggle, Homebridge fields,
    brightness slider.
  - Lock icon `⚿` next to the section heading.
  - Amber notice + `READ-ONLY` pill at the top when on remote; key fields
    render as status pills only, no editable values.
- [ ] **Section 3 · Avancé** — collapsible, default closed. Houses lightModeStyle,
  darkModeStyle, default map zoom, calmDayFastPath, extendedRadius,
  radarAnalysisEnabled, showSamplingPoints, AND the four `advancedSleep`
  params (see below).
- [ ] **Sleep timer range — extended for non-interactive contexts.**
  Use case raised by the maintainer: a kiosk in a non-interactive context
  (workshop / saddlery / shop window / 24/7 wall display) where the user has
  no touchscreen, no keyboard, no mouse to wake the screen. The previous
  caps (60 / 120 min) were too short for this case. New caps and named
  presets:
  - `stage1Delay`: dropdown with presets `1 min · 5 · 10 · 15 · 30 · 1 h ·
    2 h · 3 h · Jamais`. `Jamais` is implemented as `null` (the timer never
    enters sleep mode — the screen stays at full brightness 24/7).
  - `stage1Brightness`: slider `10-100 %` (unchanged).
  - `stage2Enabled`: toggle on/off (unchanged).
  - `stage2Delay`: dropdown with presets `5 min · 10 · 15 · 30 · 1 h ·
    2 h · 3 h`.

  Defaults remain `10 + 20` min (the v2 defaults) — only the achievable
  range grows.

  Documented use-case combinations the Settings copy can hint at:

  | Context | stage1Delay | stage1Brightness | stage2Enabled |
  |---|---|---|---|
  | Kitchen / living room | 10 min | 30 % | true |
  | Office desk (interactive) | 30 min | 50 % | true |
  | Saddlery / shop window | 3 h or `Jamais` | 80-100 % | false |
  | 24/7 LCD wall display | `Jamais` | 100 % | false |
  | 24/7 OLED wall display | 2 h | 70 % | true |
- [ ] **Section 4 · Expérimental** — collapsible, default closed. Empty-state
  copy: *« Aucune fonctionnalité expérimentale active. »* Hosts the
  `experimentalUiC` toggle during the transition (will be removed in Phase 10).
- [ ] **Remote read-only state** — section 2's amber notice; sections 3-4 dimmed
  to ~65% opacity, controls disabled; Save footer hidden entirely.
- [ ] Onboarding overlay (deferred to a future PR, not blocking) — when zero
  required keys are configured, show variant C (disclose-style) as a one-time
  first-install overlay. Skip for now; ship variant B for everyone.
- [ ] Cut over from the legacy `Settings/index.js` and `AdvancedSettings/index.js`
  files (preserve them in git history; remove from the import tree).
- [ ] All new strings (~30) translated EN/FR/ES.

**Deliverable:** PR #10. New Settings panel live behind `experimentalUiC` flag.
Legacy v2 panel removed.

---

## Phase 9 — Debug panel refresh (≈ 4h)

Goal: replace the legacy v2 Debug overlay with the task-focused navigation
delivered by Claude Design (same package). Recommended variant: **variant A
(vertical tab rail)** with the 12 existing sections grouped into 5 task
buckets (Server / Client / Services / Storage / About).

- [ ] `DebugPanel` — main container, replaces existing `Debug/index.js`.
  Holds the rail nav + the active bucket's content area.
- [ ] **Rail navigation** — vertical column on the left, 5 bucket tabs:
  - **Server** · ServerConfig, ServerKPI, Logs
  - **Client** · ClientKPI, RemoteClients, Security
  - **Services** · Provider statuspages, Last service calls, Quotas
  - **Storage** · In-memory cache, Radar snapshots
  - **About** · Vulnerability scan
  - Active tab lit with accent colour + accent-coloured left border.
  - Rail width: 64 px on 7", 92 px on HD.
- [ ] Per-bucket content area renders the relevant sections **expanded by
  default** (no double accordion — once the user picks a bucket, everything
  inside is visible at a glance).
- [ ] **Per-section affordances** preserved — Copy / Export CSV / Export JSON /
  Refresh / Flush buttons sit inline in each section header, right-aligned
  in mono uppercase style.
- [ ] **Power-user search overlay** — keyboard shortcut `/` opens a search
  input over the rail; typing filters sections across all buckets. Off by
  default; the rail nav is the primary affordance.
- [ ] Sticky panel header — version + commit + branch + hardware + URLs +
  online status. Stays visible across bucket switches.
- [ ] Action row — Refresh / Export CSV / Check for update — kept above the
  bucket content but rendered as compact buttons in the rail header area.
- [ ] Cut over from the legacy `Debug/index.js` (preserve in git history;
  remove from the import tree).
- [ ] All new strings translated EN/FR/ES.
- [ ] Fix the stale code comment in `debug-panel.jsx` line ~3 (says
  "4 task buckets" but should say "5").

**Deliverable:** PR #11. New Debug panel live behind `experimentalUiC` flag.
Legacy v2 panel removed.

---

## Phase 10 — Release v3.0.0

Goal: ship the major version bump.

- [x] **Final flag removal** — *done 2026-07.* `experimentalUiC` is gone from
  `AppContext`, from the `experimental: { uiC }` branch of the Advanced save chain,
  from the v3 `SettingsPanel`'s "Preview" section, and from the conditionals in
  `App/index.js`. Direction C is unconditional.
  **Correction to this line:** there was never a `settings.json` *schema* entry to
  strip. `advanced` is an **opaque whitelisted blob** in `server/settingsCtrl.js` —
  the server whitelists the top-level `advanced` key and never inspects its
  sub-objects, so it never read the flag. A leftover `advanced.experimental.uiC` in
  an existing `settings.json` is simply ignored, and is dropped the first time any
  Advanced setting is saved (the client rebuilds the whole blob from React state).
  No migration, no server change.
- [x] **Legacy code purge** — *done 2026-07, and **wider** than this line assumed.*
  Not just the four files named here: the **entire 14-directory v2 tree** came out of
  `client/src/components/` — `AiSummary/`, `AlertBanner/`, `Clock/`, `CurrentWeather/`,
  `Debug/`, `GovAlertDetail/`, `IndoorTemperature/`, `InfoPanel/`, `RangeSlider/`,
  `Settings/` (including `AdvancedSettings/`), `Spinner/`, `SunRiseSet/`,
  `UvAqiBadges/`, `WeatherInfo/` — plus `hooks/useDragScroll.js` and the two
  `ambient/weatherCharts/` chart components reachable only from it, and the
  second-order dead code they were keeping alive. See the `[Unreleased]` entry in
  `CHANGELOG.md` for the full inventory.
  *(The plan's `CurrentLayout` never existed under that name — the v2 layout was the
  `experimentalUiC ? … : …` branch inside `App/index.js`, removed with the flag.)*
- [ ] Update `package.json`: `version: "2.13.x"` → `"3.0.0"`.
- [ ] Rewrite README's "About the version numbers" section to reflect v3 (no longer mentions v2.13).
- [ ] Replace screenshots in README with v3 captures (multiple themes, scenarios).
- [ ] Add a v3.0.0 entry in CHANGELOG.md grouping all UI-refresh work
  (summary of the cycle's worth of PRs).
- [ ] Tag `v3.0.0`, push tag.
- [ ] Create GitHub release with marketing-style notes:
  - Hero feature: redesigned UI (Direction C)
  - Adaptive day/night/red palette
  - Hybrid instrumentation mode for severe scenarios
  - Map-first layout, info as floating slabs
  - Discoverable controls with permanent labels
  - Backward-compatible — same data sources, same API keys
- [ ] Communicate to k5map and other downstream users:
  - Notable visual change, may want to skim the release notes
  - All settings are preserved across the upgrade
  - The in-app updater handles it normally (Pi 5 / Pi 4 / Pi 3 alike)

---

## Decisions to validate before kickoff

1. **Branch strategy** — dedicated long-running `feat/ui-direction-c` with progressive
   merges via feature flag (recommended), OR incremental phases directly on master?
2. **Version bump** — v3.0.0 (major) aligns with the visual change magnitude and avoids
   confusion with elewin's separate v3.x line (their fork, different codebase).
3. **Timing** — start now, or wait until k5map / other early adopters validate v2.13
   in the wild for another week or two?
4. **Stage 2 sleep timer** — default 10 + 20 min (current v2 defaults) confirmed
   reasonable? Or revisit?

---

## Open questions for the implementation phase

- How aggressively to bench Pi 4 performance? Synthetic FPS counter or visual
  smoothness check?
- Should the `experimentalUiC` flag be exposed in regular Settings (any user)
  or kept behind DEBUG=true for the duration of the cycle?
- Migration: should we add a one-time prompt the first time a user lands on v3
  ("Your kiosk's UI was redesigned — here's what's new") with a Don't-show-again
  toggle?
- Visual regression testing: invest in Playwright snapshots, or rely on manual
  screenshot diffs in PR reviews?

---

## References

- **Final design package:** `ZBuzz5lra42fwls8dhaJFg`
  (download via `curl -L https://api.anthropic.com/v1/design/h/ZBuzz5lra42fwls8dhaJFg`).
- **Design notes:** `DESIGN-NOTES.md` inside the package.
- **Key files in the package:**
  - `project/lib/direction-c-ambient.jsx` — main component
  - `project/lib/c-components.jsx` — shared atomic components
  - `project/lib/data.jsx` — mock data + scenarios + helpers
  - `project/lib/map-bg.jsx` — radar canvas with rings, arrows, samples
  - `project/lib/icons.jsx` — line-style weather icons
- **Prototype:** `project/Pi Weather Station - Prototype.html` — interactive with Tweaks panel.
- **Comparison canvas:** `project/Pi Weather Station - Designs.html` — Direction C focus,
  A/B archived.

### Settings + Debug refresh package (Phases 8-9)

- **Design package:** `NzSzPtOReHNfiDZzxJMWQA`
  (download via `curl -L https://api.anthropic.com/v1/design/h/NzSzPtOReHNfiDZzxJMWQA`).
- **Design brief:** `docs/settings-debug-design-request.md` (in this repo).
- **Design notes:** `DESIGN-NOTES.md` §12-13 inside the package.
- **Key files:**
  - `project/lib/settings-panel.jsx` — Settings 4-section + 3 API-key variants.
    Recommendation: **variant B (tight list)**.
  - `project/lib/debug-panel.jsx` — Debug rail nav + 3 nav variants.
    Recommendation: **variant A (vertical tab rail)**.
  - `project/lib/admin-data.jsx` — mock data for Settings/Debug scenarios.
- **Prototype:** `project/Pi Weather Station - Settings & Debug Prototype.html`.
- **Canvas:** `project/Pi Weather Station - Settings & Debug.html` (3×3 variant
  grid + edge cases).

---

## Notes for the maintainer

This plan is a starting point. As we hit each phase, expect to revise:

- Some components may be simpler or more complex than estimated.
- We may discover the design has minor inconsistencies that need a fresh round
  with Claude Design.
- Pi 4 performance may force us to drop some visual flourishes.
- The phase ordering is suggested for the lowest-risk path (shared atoms before
  layouts, layouts before sleep mode, hybrid+i18n last). It's not fixed.

When you're ready to start, the first action is just: "let's do Phase 0".
