# UI Direction C — Implementation Plan

**Status:** Draft, awaiting maintainer review
**Target version:** v3.0.0
**Last updated:** 2026-05-12 (Claude Opus 4.7)

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

- [ ] `AmbientSleep` — single component, picks palette by `timeOfDay`.
  - `day`: cream
  - `dusk`: warm-grey
  - `night`: dark warm-grey
  - `nightRed`: long-wavelength red (melatonin-friendly, preserved from v2.13)
- [ ] Stage 2 burn-in protection — single drifting 2×2 pixel on black, colour
  matched to `timeOfDay`.
- [ ] Transition timer: `stage1Delay` minutes idle → `sleep`, then `stage2Delay`
  more minutes → `sleep-stage2`. Wake on any input.
- [ ] Connect to existing `/api/brightness` endpoint (already in v2).
- [ ] Settings continue to live in the legacy v2 panel via `advancedSleep.*`
  — no UI work here.

**Deliverable:** PR #7. Sleep mode renders correctly under Direction C; the
v2 Settings panel still pilots the four `advancedSleep` params.

---

## Phase 6 — Hybrid mode + i18n (≈ 3h)

Goal: wire the auto-trigger for hybrid instrumentation mode, and translate everything.

- [ ] `useHybridMode(data)` hook — returns `'red' | 'amber' | null` based on
  alert tier + radar state + confidence threshold (70%).
- [ ] Apply hybrid injections conditionally:
  - Severity strip on slabs with critical metrics (3-4px left border, tier colour).
  - Mono numerals: switch critical numbers (temp, wind, pressure, confidence)
    from `display` font to `mono` font.
  - Opacity bump: slab surface alpha 0.85-0.92 → 0.94-0.98.
  - Severity-coded chips: confidence pills get tier-coloured backgrounds.
- [ ] **i18n extraction**:
  - Scan all new components for hardcoded strings.
  - Add new keys under `ambient.*` namespace in `en.json` / `fr.json` / `es.json`
    (estimated 40-50 new keys).
  - Replace each hardcoded string with `{t("ambient.xxx")}`.
  - Pay attention to length variance (FR ~30% longer than EN).
- [ ] Test all 3 locales on the same kiosk.

**Deliverable:** PR #8. Hybrid mode visible on severe scenarios, i18n complete in 3 langs.

---

## Phase 7 — Stabilisation (≈ 3h)

Goal: integrate v2 user-facing features and polish before release.

- [ ] **Font size wrapper** — `zoom: { s: 0.85, m: 1, l: 1.15 }[fontSize]` on the
  root of AmbientLayers. Preserves the v2 S/M/L UX without modifying the design.
- [ ] **Responsive polish** — test at 800×480, 1024×600, 1280×720, 1366×768,
  1600×900, 1920×1080. Fix any breakpoint gaps.
- [ ] **Performance benchmarks** — measure FPS during radar animation and
  banner cycling on Pi 4. Decide if `useBlur` ever turns on (the design has it
  off by default; benchmarks confirm or relax).
- [ ] **Visual regression** — capture screenshots of key states (calm/rain/severe,
  day/dusk/night/nightRed, hybrid on/off) for the README update.
- [ ] **Remove the experimentalUiC flag** — *moved to Phase 10 (release)*
  so the flag is still live through the Settings + Debug refresh phases.
- [ ] **Cleanup** — delete unused tokens, prune dead code paths from the
  Direction C codebase as it stabilises.

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

- [ ] **Final flag removal** — strip `experimentalUiC` from `settings.json`
  schema, AppContext, and the conditional in `App.js`. Direction C becomes
  unconditional.
- [ ] **Legacy code purge** — delete the legacy `CurrentLayout`,
  `Settings/index.js`, `AdvancedSettings/index.js`, and `Debug/index.js`
  files that were preserved through the cycle.
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
