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

**Estimated effort:** ~12-15 evening sessions over 3-4 weeks at normal pace.

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

- [ ] **Design tokens** — `client/src/ui/tokens.js`:
  - Export the 4 palette objects (`day`, `dusk`, `night`, `nightRed`) with all
    roles (`bg`, `text`, `textDim`, `accent`, `accentSoft`, `surface`,
    `surfaceHybrid`, `border`, `borderHybrid`, `warn`, `danger`, `cool`).
  - Match the final design's hex values verbatim (warm-grey).
- [ ] **Hybrid helper** — `client/src/ui/hybrid.js`:
  - Port `hybridLevel(data)` and `confidenceBucket(pct)` from server-side logic.
  - Export hooks: `useHybridMode()`, `useTimeOfDay()`.
- [ ] **Fonts** — integrate Geist + Geist Mono:
  - Add `npm install geist` OR self-host the woff2 files in `client/public/fonts/`.
  - Add `@font-face` declarations in a new `client/src/ui/fonts.css`.
  - Test on a Pi to verify font loading doesn't add visible flash.
- [ ] **Lightweight CSS reset** — `client/src/ui/reset.css`:
  - Box-sizing border-box, baseline removal, button reset, etc.
  - Imported once at the AmbientLayers root.

**Deliverable:** PR #2. Tokens + helpers + fonts available app-wide.
AmbientLayers placeholder uses tokens.day for a colored background as smoke test.

---

## Phase 2 — Shared components (≈ 5h)

Goal: build the reusable atomic components first, before any layout work.
Each gets its own visual storybook entry and unit tests.

Files: `client/src/components/ambient/` (new directory).

- [ ] `SourceBadge` — RADAR/ECCC/NWS pill.
- [ ] `ConfidencePill` — `[NN%]` with bucket colour (green ≥70 / amber 40-69 / red <40).
- [ ] `AlertBanner` — supports cycling (+N), source badge, confidence pill,
  tap-to-open detail.
- [ ] `AlertDetailInline` — collapsible section, scroll-area + pinned QR footer,
  `max-height: calc(100vh - 280px)` cap, `flex: 1; min-height: 0` chain.
- [ ] `QrCode` — wrapper around `qrcode.react` (already in deps), 96×96 default.
- [ ] `IndoorBlock` — temp/humidity/AQ trio when Homebridge configured.
- [ ] `RadarTimeline` — play/pause + scrubber, mirrors current v2 timeline.
- [ ] Unit tests for each component using Node's native `node:test` (existing convention).

**Deliverable:** PR #3-#4 (split if needed for review size). Shared components
available, tested, ready to be composed into layouts.

---

## Phase 3 — Pi 7" layout (≈ 4h)

Goal: implement the small-screen layout (800×480 and similar). This is the most
sensitive target — the official Pi 7" touchscreen most users have.

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

- [ ] `LayoutDesktop` — hero band on top, right rail, full-bleed map behind.
- [ ] `HeroPlaceDesktop`, `HeroTempDesktop`, `HeroClockDesktop` as 3 slabs.
- [ ] Right rail composition: `MetricsGrid` (compact mode off), `ForecastCard`,
  `IndoorBlock`, `AiCard` (with all 3 paragraphs).
- [ ] Radar timeline anchored bottom-left of map area.
- [ ] Two breakpoints: ≥1280px and ≥1600px (rail width 300 vs 340, hero 160 vs 200).
- [ ] Test on dev Mac at multiple window sizes.

**Deliverable:** PR #6. Desktop layout matches the design at 1366, 1920, and intermediate sizes.

---

## Phase 5 — Sleep mode + Settings (≈ 3h)

Goal: integrate the new sleep-mode palette system and the Settings overlay.

- [ ] `AmbientSleep` — single component, picks palette by `timeOfDay`.
  - `day`: cream
  - `dusk`: warm-grey
  - `night`: dark warm-grey
  - `nightRed`: long-wavelength red (melatonin-friendly, preserved from v2.13)
- [ ] Stage 2 burn-in protection — single drifting 2×2 pixel on black, colour
  matched to `timeOfDay`.
- [ ] Transition timer: `stage1Delay` minutes idle → `sleep`, then `stage2Delay`
  more minutes → `sleep-stage2`. Wake on any input.
- [ ] `SettingsOverlay` — restructured into Display / Sleep / Map sections:
  - **Display**: font size S/M/L, theme override (day/dusk/night auto-select),
    brightness slider (POST /api/brightness).
  - **Sleep**: stage1Delay (1-60), stage1Brightness (10-100%), stage2Enabled toggle,
    stage2Delay (5-120).
  - **Map**: showSamplePoints toggle, extendedRadius toggle, calmDayFastPath toggle.
- [ ] Connect to existing `/api/brightness` endpoint (already in v2).
- [ ] Persist all settings to existing `settings.json` schema.

**Deliverable:** PR #7. Sleep mode + Settings work end-to-end.

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
- [ ] **Remove the experimentalUiC flag** — C becomes the only layout.
  - Delete the `<CurrentLayout />` branch.
  - Delete the v2 layout components no longer referenced.
  - Strip the flag from settings.json schema.
- [ ] **Cleanup** — delete deprecated CSS / JS files from the v2 layout.

**Deliverable:** PR #9-#10. Master is now Direction C only.

---

## Phase 8 — Release v3.0.0

Goal: ship the major version bump.

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
