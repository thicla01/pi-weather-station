# LLD — Auto-select forecast tab (hazard-priority router)

**Status:** design, not built yet. This is the low-level design of record; it captures the decisions taken in the 2026-06-14 design pass so implementation can start from a settled spec.
**Audience:** maintainer / implementer (dev-facing).
**One-liner:** when the weather turns, point the forecast-chart metric tab (Temp / Wind / Precip / Hours) at the metric that explains it — driven by the signals the app *already* has (ECCC + NWS alerts, radar analysis, Tomorrow.io forecast), gated hard so it never yanks the view out from under a reader, and opt-in.

---

## 0. Motivation — where this came from

The idea came from a real deployment, not a feature brainstorm. The maintainer's partner regularly walks into the tack room (*sellerie*) of the stable and checks the kiosk's radar screen to decide whether to **bring the horses in**. The *Precip* chart tab is exactly the right complement to the radar for that call (spatial "where is it" + temporal "how much, when) — but it isn't necessarily the selected tab, and **the monitor in the stable is not a touchscreen**, so she cannot tap to switch to it.

That single scenario is the strongest validation of the feature, and it sharpens two decisions:

- It **voids** the "the user can always tap manually" objection — there is physically no way to interact. The only way the right tab is showing when she walks up is if it switched **autonomously, beforehand**. This is why the design is live-switching, not load-time-only.
- It makes the **non-interactive / non-touch display** a first-class deployment target — see §6.1, which it directly shaped.

**Deployment constraints (why the stable Pi is the way it is, recorded so future changes respect it):** the stable screen is a 15" monitor with **no mouse or keyboard** — there is no way to change what it shows. Stables / tack rooms are **deliberately left unlocked** (in a fire, a neighbour must be able to get in to save the animals), and equipment theft is a real risk — so the hardware is intentionally **minimal, cheap, and easily replaced**. The screen runs **on permanently with sleep disabled**: the maintainer accepts a shorter screen lifespan as the cost of always-on visibility. This is a deliberate trade-off, not an oversight — do not "fix" it by re-enabling sleep.

## 1. Problem — the one piece of UI that stays frozen

The kiosk already auto-curates almost everything: the alert banner promotes the worst alert, `hybridLevel()` escalates the visual strip on severe/extreme alerts, the palette shifts day/dusk/night, brightness dims on idle. The **one** remaining piece of UI state that stays frozen on whatever a human last tapped — possibly days ago — is the forecast-slab **metric tab**. So when a wind warning lights the banner, the chart underneath may still be on *Temp*.

Closing that gap makes the whole screen tell one coherent story: **banner = headline, radar ring = position, chart = magnitude-over-time**, all driven by the same hazard verdict.

## 2. Verdict and scope

**Build it — but as a hazard-priority ROUTER, not a "pick the most interesting tab" ranker.** The router is a deterministic projection of the *existing* hazard verdict onto the tab index. It invents no new severity opinion, so the tab can never disagree with the banner. If the banner is silent, the router is silent.

Hard contracts (each is a test, not a guideline):

- **Null-on-calm.** When nothing notable fires, return `null` → keep the user's persisted tab. Never snap back to *Temp*, never rotate by time-of-day.
- **Metric only, never period.** The 24h/5d period toggle stays 100% manual — period is a reading preference, metric is a hazard signal.
- **Never mutate a visible tab under an active reader.** Covered by the idle-stage gate (§6).
- **Opt-in.** Default OFF; the user consciously enables automation (§7).

The skeptical "smart-default-at-load-only" alternative was rejected: alerts arrive mid-idle, not at boot, so a load-time-only default would almost never fire when it matters. The advocate "free-running live switch" was rejected for the reader-disruption risk. The reconciled design is **live switching, aggressively gated** — see §6.

## 3. What this maps to in the current code

The "4 tabs" are the segmented control `METRICS = ["temp", "wind", "precip", "grid"]` in `client/src/components/ambient/ChartTabs/index.js`. **"Hours" = the `"grid"` metric** (the hour-by-hour / day-by-day icon strip, labelled *Heures* / *Jours* by period). Metric index is pure local state (`hourlyMetric` / `dailyMetric`), seeded from `localStorage` via `readStoredView()`, persisted to `ambient.chartTabs.hourlyMetric` / `ambient.chartTabs.dailyMetric`, and today mutated **only** by a human tap (`setMetricIndex` / `cycleMetric`).

**Already in place (no new plumbing needed):**

| Need | Already exists |
|---|---|
| Idle stage 0/1/2 | `sleepStage` in `SystemContext` — the "lift idle stage into context" prerequisite is **already done**; `ChartTabs` only needs `useContext(SystemContext)` |
| Gov alerts (severity-sorted) | `govAlerts` in `AlertsContext` |
| Radar nowcast | `innerRisk` / `innerTrend` / `innerBumped` / `innerTrendConfidence` (+ `outer*`) in `radarStateSlice` |
| Radar SHOW gate + confidence | `getRadarAlertState()` (`ui/alertLogic.js`, gates at maxSev ≥ 2, returns `{tier, confidence, confidenceBucket}` or `null`) |
| Confidence buckets | `confidenceBucket()` (`ui/hybrid.js`, high ≥ 70 / mid ≥ 40) |
| Precip detection | `isCurrentlyPrecipitating()` (`ui/alertLogic.js`, weatherCode 4000–8000) |
| Eligible gov tiers | `ELIGIBLE_GOV_TIERS = ["red","orange"]` (`ui/alertLogic.js`) |
| Source-badge styling | `styles.sourceBadge` |

**Genuinely new work:** (1) a pure `selectAutoTab()` reducer + its regression test; (2) a thin `useAutoTabSelector` hook subscribing to the three existing contexts; (3) two new `ambient.chartTabs.*` localStorage keys + a settings toggle; (4) a "reason chip" in the `ChartTabs` header; (5) `ChartTabs` accepting an externally-driven metric set. **No new server endpoint, no new fetch, no new field on the wire.**

## 4. Signal priority hierarchy

Highest wins, first match returns. Mirrors the app's own SHOW gates, so it needs no new severity vocabulary.

1. **NEW severe/extreme gov alert** (`severity ∈ {severe, extreme}`, id/composite-key unseen at hold time). The **only** signal that punctures a manual hold, the dwell floor, *and* stage-0 inhibit. Rationale: "never blind the user to a new warning" (already the `FloatingMiniBanner` principle).
2. **Active eligible gov alert** (`govAlerts[0]`, tier red/orange via `ELIGIBLE_GOV_TIERS`, already severity-sorted server-side). If the banner shows a red/orange gov alert, the tab MUST agree. Badge: ECCC or NWS. Outranks radar because an official alert is a human-vetted forecast.
3. **Radar nowcast** (`getRadarAlertState() != null` AND `confidenceBucket >= mid`). Always → **Precip** (radar only ever measures hydrometeors; routing it elsewhere would violate the "honest about origin" badge rule). Outranks bare forecast because an echo on the doorstep with an "approaching" trend is a nowcast the Tomorrow.io numbers lack. Badge: RADAR.
4. **Forecast threshold** (Tomorrow.io current + next-6h hourly + daily). Real but lower-urgency. Evaluated Wind → Precip → Temp (most dangerous metric wins ties). Badge: FCST.
5. **Calm** — nothing fired → `null` → keep the user's last tab.

**Tie rule:** two equally-ranked gov alerts mapping to *different* tabs (e.g. Wind Warning + Flood Warning) → **do nothing**, fall through to the last tab and let the banner cycle carry the urgency. An arbitrary-looking pick erodes trust faster than no pick.

## 5. Thresholds

All comparisons in **native units** (°C, m/s, mm, mm/h, 0–100%) — the reducer never reads `speedUnit` / `tempUnit` / `lengthUnit`; conversion happens only at render. km/h and °F equivalents below are **documentation only**. ENTER/EXIT columns are the hysteresis bands. Define all as named constants at the top of `autoTabSelector.js`.

| Signal / condition | Tab | Threshold (native) | ENTER / EXIT | Pri | Badge |
|---|---|---|---|---|---|
| New severe/extreme gov alert, id unseen | per eventType map | `severity ∈ {severe,extreme}` | n/a (event) | 1 | ECCC/NWS |
| Gov ~ wind/gale/gust/hurricane | Wind | tier red/orange | n/a | 2 | ECCC/NWS |
| Gov ~ snow/squall/blizzard/winter/freezing/ice/rain/thunder/storm/tornado/flood | Precip | tier red/orange | n/a | 2 | ECCC/NWS |
| Gov ~ heat/cold/frost/chill/arctic | Temp | tier red/orange | n/a | 2 | ECCC/NWS |
| Gov red/orange, event unmappable (fog, special statement) | (null — no guess) | tier red/orange | n/a | 2 | — |
| Radar `getRadarAlertState() != null` | Precip | inner/outer maxSev ≥ 2 AND conf ≥ 40 | enter sev≥2 & conf≥40 / exit sev<2 OR conf<40 | 3 | RADAR |
| Forecast gust (`windGust` / `windGustMax`) | Wind | ≥ 25.0 m/s (90 km/h) | 25.0 / 20.8 | 4 | FCST |
| Forecast sustained (`windSpeed`) | Wind | ≥ 19.4 m/s (70 km/h) | 19.4 / 16.7 | 4 | FCST |
| Forecast precip prob, max over next 6h | Precip | ≥ 70% | 70 / 55 | 4 | FCST |
| Forecast precip rate (`precipitationIntensity`) | Precip | ≥ 7.6 mm/h | 7.6 / 4.0 | 4 | FCST |
| Active hazardous code now (`weatherCode`) | Precip | 8000 (thunder) or 6000–6201 (freezing) | true / code clears | 4 | FCST |
| Forecast heat (`temperatureApparent`) | Temp | ≥ 32 °C | 32 / 29 | 4 | FCST |
| Forecast cold (`temperatureApparent`) | Temp | ≤ −25 °C | −25 / −20 | 4 | FCST |
| Nothing fired (calm) | (null) | — | — | 5 | none |

**Anchors:** gust 25 m/s = ECCC severe-thunderstorm / wind-warning gust criterion; sustained 19.4 m/s = ECCC wind warning; precip-prob 70% = high-confidence wet window; rate 7.6 mm/h = NWS heavy-rain rate; apparent-temp `[-25, 32] °C` = ECCC extreme-cold / heat-event territory. Use `temperatureApparent` (feels-like) — the field that drives human comfort, not raw temperature.

> **Calibration note:** the temp bounds are tuned for the Québec / NE-US fleet domain. A Pi in a hot or tropical deployment would sit permanently in the Temp class or never trip it — see Open Question #2.

**Deliberately NO yellow/advisory trigger by default.** Keeping the bar high (orange+ / active precip / severe alert) is what prevents the trust-eroding over-escalation that trains users to disable the feature.

## 6. Idle-stage gate (the reader-protection guarantee)

| Idle stage (`sleepStage` in `SystemContext`) | Behaviour |
|---|---|
| **0** — active, < 10 min idle | **Never mutate the tab in place.** At most, surface an additive, dismissible hint chip ("Pluie → Précip") the user taps — the CLS-safe "expected shift = user-initiated" pattern. *Exception:* a new severe/extreme gov alert (Pri 1) still switches. |
| **1** — 10–30 min, screensaver glance | Auto-switch **allowed** (demonstrably not reading). |
| **2** — 30+ min, black | Allowed but moot; cheap to skip / just set the next-wake default. |

`sleepNightMode` / `nightRed` quiet hours: suppress all auto-switching **except** a red-tier (severe/extreme) gov alert — matching the app's "stay calm, but never blind to a real warning" posture.

### 6.1 Non-interactive / non-touch displays (the motivating case)

The stage gate above uses **interaction-derived idle as a proxy for "someone is actively reading"** — valid only on a touch device, where a recent tap means a hand is on the glass. On a **non-touch monitor** (the stable deployment, §0) the proxy breaks:

- `useIdleDetection` only counts `pointermove` / `pointerdown` / `touchstart` / `keydown` / `wheel`. With no input device, **none ever fire.** The display drifts to **stage 2 (anti-burn-in black screen) after ~30 min with no way to wake it** — so a passer-by sees a black screen, and the feature delivers nothing exactly where it matters most.
- If sleep is disabled to avoid the blackout, the display sits permanently at "stage 0" → the stage-0 inhibit would **suppress** auto-switching. The proxy now means the opposite of reality.

**Fix (no new config needed):**

1. **Gate the stage-0 inhibit behind `navigator.maxTouchPoints > 0`.** The guard exists to avoid yanking the view from *someone touching the screen*; on a non-touch display (`maxTouchPoints === 0`) there is no reader to protect, so skip the inhibit and always allow auto-switch. The discriminator natively separates the 7" DSI touchscreen (> 0) from an HDMI monitor (0). `manualHold` can never arm on a non-touch device anyway (no tap), so there is no zombie-lock path either.
2. **Sleep must not blackout a display that can't be woken.** On the stable Pi sleep is **deliberately disabled entirely** (§0 — always-on by design); fix #1 makes the router work even when the screen never leaves "stage 0". For any non-touch deployment that still wants anti-burn-in, `sleepStage2Enabled = false` (keep stage-1 dimming, never the unwakeable black screen) is the floor.

Recommended stable-Pi config: `autoSelect = ON` + sleep **off**. Result: when someone walks up, the radar **and** the matching chart tab are already showing, at full brightness, with zero interaction.

> Decision for the maintainer: is `navigator.maxTouchPoints` the right sole discriminator, or do we also want an explicit per-device "unattended display" flag for touch-capable hardware that is nonetheless used hands-off? `maxTouchPoints` is the sensible default; the explicit flag is only needed if a touch-capable Pi is deployed as a pure glance display.

## 7. Settings placement & opt-in (decision of record, 2026-06-14)

The `SettingsPanel` has four sections on an explicit **local → server gradient**: `local` (Préférences locales, per-device `localStorage`, *not* `disabled={remote}`), `api` (Configuration & clés API), `avance` (Avancé, canonical `settings.json`, `disabled={remote}`), `apercu` (Aperçu).

**Decision: the toggle lives in Section 1 (`local` — Préférences locales), NOT Avancé.**

1. **Storage model demands it.** Auto-select is a per-device preference (`ambient.chartTabs.*` localStorage) — each screen of the fleet decides for itself. That is exactly what `local` is for. The Advanced section holds shared `settings.json` values gated `disabled={remote}`; putting a localStorage pref there would contradict the panel's organizing principle (it must stay enabled remotely and per-device).
2. **Direct precedent.** The two closest analogs — *Show advisory alerts* (`SettingsPanel/index.js:388`) and *Show alert radius ring* (`:406`) — are per-device alert-behaviour toggles that already live in `local`. Auto-select is the same species; it belongs beside its siblings.
3. **"The user has the right to choose" → it must be findable,** not buried in Advanced (which is for the technical, rarely-touched: extended radius, sampling points).

**Default: OFF (opt-in).** It changes a previously 100%-user-driven behaviour, so the user consciously enables it (the conservative "Pixel Weather" baseline). Key named positively — `ambient.chartTabs.autoSelect` (`"1"` = enabled), **not** `…Disabled` — so the polarity matches an opt-in.

> **Honest trade-off:** opt-in means most owners never discover it and never benefit on a display nobody configures. The playbook: opt-in for the field-test and initial GA → once the trial is proven calm (~4 weeks, no flapping / wrong-tab), the maintainer *may* flip the default to ON (the toggle then reads as an opt-out). The toggle stays in the same place; only the default polarity evolves.

One on/off toggle is enough — no UI granularity (thresholds, classes stay as named constants). Suggested label (via `lbl()`, per the codified `SettingsPanel` exception):

```js
<Toggle
  label={lbl(lang, "Auto-select forecast tab", "Sélection auto de l'onglet", "Selección automática de pestaña")}
  sub={lbl(lang,
    "Switches Temp/Wind/Precip when the weather turns",
    "Bascule Temp/Vent/Précip selon la météo",
    "Cambia Temp/Viento/Precip. según el tiempo")}
  value={Boolean(autoSelectTab)}
  onChange={saveAutoSelectTab}
/>
```

## 8. Manual override semantics

Manual primacy with a single-punctured lock — the only honest answer to the override paradox.

- A human tap on a metric tab sets `ambient.chartTabs.manualHold = Date.now()` (new per-device key, epoch ms). While `now - manualHold < HOLD_MS`, all auto-switching is inhibited. **HOLD_MS = 20 min** — long enough to read a chart and step away, expiring *before* stage-2 deep idle (10 + 20 = 30 min) so the kiosk returns to autonomous behaviour for the next passer-by.
- The lock also clears on a screensaver wake crossing **stage-2 → stage-0** (a genuinely new session). Returning to stage 0 from stage 1 does **not** clear it (same person, still mid-read).
- Persist only the **tab choice** to the existing `ambient.chartTabs.hourlyMetric` / `dailyMetric` keys. Do **not** persist the `manualHold` timestamp — a reload restores the view without resurrecting a zombie lock.
- **The one puncture:** a gov alert with `severity ∈ {severe, extreme}` whose id (or composite key `source+eventType+expiresAt` when id is null) was NOT in the set captured at hold time overrides the lock, the dwell floor, and stage-0; switches per the Pri-2 map; clears the lock. Radar and forecast escalation **never** puncture a manual lock. This is the minimum puncture satisfying "never hide a new extreme alert" while keeping the surprise-switch surface as small as possible.
- When `autoSelect` is OFF, even the severe-alert puncture is suppressed — the user chose a static display; the banner / `FloatingMiniBanner` still carries the warning.

## 9. Anti-flapping (four brakes, all ship in the same PR)

1. **Evaluate only on data-refresh ticks** — never on `setInterval`, render, or focus. Inputs land on their own cadences (gov 10 min, radar 5 min, weather 15 min). Coalesce simultaneous async landings with a **30 s debounce** → one decision. Worst-case switch cadence is bounded by the slowest fetch, never per-second jitter.
2. **Hysteresis** (separate ENTER/EXIT bands) on every numeric trigger (see §5). A value hovering at its line cannot oscillate. For radar, gate on `confidenceBucket >= mid` (40/70), not the raw 0–100 score.
3. **Minimum dwell** — once auto picks a tab, no further auto switch for **10 min** (matches `stage1Delay` so a switch and a screensaver transition can't race). The severe-alert puncture is the only exception.
4. **Fresh full snapshot each tick** — recompute from the latest of all three contexts (never an individually-cached sub-signal); this is how the "gov expired but radar stale" race is absorbed. The reducer must be **partial-data-tolerant**: any missing slice (cold-start, failed fetch leg) → "that class did not fire", never "assume calm and reset to Temp".

**Empirical validation before fleet rollout:** dry-run the reducer against logged signals (reuse the `radarTrend.test.js` harness style) and count would-be switches/day at the Québec location. More than a small handful/day = the thresholds are wrong regardless of per-decision correctness.

## 10. Phased rollout

- **Phase 0 — pure, no UI, no risk.** Write `client/src/ui/autoTabSelector.js` as a pure `selectAutoTab(signals, state, now) -> {tab, reason, sourceBadge} | null` and `test/autoTabSelector.test.js` under `node --test`. Encode the named scenarios as fixtures: severe gov alert preempts manual lock; precipProbability hovering 68–72% does **not** flap; gust at exactly 25.0 m/s enters Wind; calm holds on the persisted tab and returns null; manual-hold-active returns null; missing hourly slice routes away without crashing. Zero React, zero fleet exposure.
- **Phase 1 — gov + forecast + quiet, deterministic, NO radar.** Wire `useAutoTabSelector` to `SystemContext` (`sleepStage`), `AlertsContext` (`govAlerts`), the weather slice. Add the two localStorage keys + the `local` toggle (§7) + the reason chip in `ChartTabs`. Ship **default-OFF** behind a field-test flag mirroring v2.18 `experimentalUiC`. Field-test on the maintainer's Québec Pi first. This is the bulk of the value with none of the async-reconciliation risk.
- **Phase 2 — add Pri-3 radar.** Only after Phase 1 is field-proven calm. Radar (5 min) vs gov (10 min) is the worst cadence mismatch and the expired-gov-while-radar-approaching race is the riskiest reconciliation — its own test pass + field-test window. The 30 s debounce + 10-min dwell are the mitigations; prove them on one Pi before the fleet.
- **Phase 3 — flip default-ON (optional), fleet rollout.** Only if the maintainer decides to, after the field-test trigger fires (no wrong-tab / flapping report for ~4 weeks). Roll out via the SSH-curl batch loop. Keep the toggle permanently.

## 11. File touch list

| File | Change |
|---|---|
| `client/src/ui/autoTabSelector.js` | **new** — pure reducer + named threshold constants |
| `test/autoTabSelector.test.js` | **new** — regression fixtures (Phase 0) |
| `client/src/hooks/useAutoTabSelector.js` | **new** — subscribes to `SystemContext` / `AlertsContext` / `radarStateSlice`, applies decision via the `ChartTabs` metric setter |
| `client/src/components/ambient/ChartTabs/index.js` | accept externally-driven metric; render reason chip; write `manualHold` on tap |
| `client/src/components/ambient/SettingsPanel/index.js` | `local` section toggle (§7) |
| `client/src/AppContext.js` | `autoSelectTab` pref + `saveAutoSelectTab` (mirrors `saveShowAdvisoryAlerts`) |
| `CLAUDE.md` | **at ship time** — document the new `FCST` badge tag per the "always identify the source" rule (do not add before it ships) |
| `CHANGELOG.md`, `ROADMAP.md`, `docs/ui-layout_{en,fr}.md` | per the maintainability guidelines when it ships |

## 12. Open questions (maintainer decisions)

1. **ECCC eventType (`alert_code`) vs NWS (`event`) — RESOLVED 2026-06-14.** No ECCC lookup table needed. Both sources expose an **English** event name in `title_en` (NWS = `p.event`, ECCC = `p.alert_name_en` — e.g. "Heat warning"), and ECCC's `alert_code` is itself a clean machine slug (verified: `alert_code: "heat"`, `alert_name_en: "Heat warning"` — `test/ecccAlertsCounter.test.js:41`). So the classifier matches keyword families against `(title_en + " " + eventType).toLowerCase()` — English for both, and the ECCC slug ("heat"/"wind") matches too. One table, both sources, no special-casing. Order TEMP → WIND → PRECIP so "wind chill" → Temp (not Wind) and "freezing rain" → Precip (not Temp). Unmatched red/orange (fog, special statement) → **null** (no guess), not a forced Precip. Implemented in `client/src/ui/autoTabSelector.js` `classifyAlertTab()`; covered by `test/autoTabSelector.test.js`.
2. **Apparent-temp bounds `[-25, +32] °C` are fleet-domain-calibrated.** Make them `settings.json` config knobs now, or keep hardcoded with a documented assumption until a non-NE deployment exists?
3. **Default-on vs default-off at GA.** Recommend default-OFF behind the field-test flag; the maintainer owns whether to ever flip it fleet-wide.
4. **Stage-0 behaviour in v1.** Ship the additive hint chip (tap-to-switch, CLS-safe, more respectful, more work), or simply do-nothing at stage 0 in v1 and add the chip later (safer to ship first)?
5. **Reason-chip badge vocabulary.** Existing banner badges are ECCC/NWS/RADAR. The forecast class has no authoritative source — proposed `FCST`. Maintainer must bless the tag; document in CLAUDE.md + JSDoc (no `AUTO`/`LOCAL`).
6. **HOLD_MS (20 min) and dwell (10 min)** are first-guess numbers anchored to the idle delays — confirm/tune against the dry-run would-switch-per-day count before fleet rollout.
7. **Non-touch discriminator (§6.1).** Confirm `navigator.maxTouchPoints > 0` as the sole gate for the stage-0 inhibit, or add an explicit per-device "unattended display" flag for the touch-capable-but-hands-off case. Recommend `maxTouchPoints` alone for v1.

## 13. Future extension — hazard-driven card promotion on small screens (out of scope for v1)

The chart-tab router fixes "the chart slab is on the wrong metric." On a wide layout (LayoutDesktop / LayoutPi, ≥ 800 px — what a 15" stable monitor runs) the radar and chart are already on screen, so the tab router alone serves that case. But on a **narrow / scrolling layout** (`LayoutMobile`, a phone PWA or a small portrait panel) the precip-relevant surfaces are *below the fold*: the block order is a fixed JSX column — `TimeBlock → AlertBanner(conditional) → HeroCompact → AirCard → MetricsGrid → IndoorBlock → radar mapCard → ChartTabs → AiSummary` — so the radar + precip chart sit near the bottom. When rain is approaching, a phone user sees temp / AQI / metrics first and must scroll to reach what matters. The maintainer's question: should the same hazard verdict that picks the tab also **reorder the cards so the relevant one surfaces?**

Position: **yes in principle — same verdict, second surface — but it is a distinct, later item with different gating, not part of v1.** Key differences from the tab router:

- **Higher disruption surface.** A tab switch swaps content in a fixed slot. Reordering a scroll column *moves blocks* — under an actively-scrolling user this is the documented context-shift / layout-shift anti-pattern (Google Pixel Weather deliberately refused auto-reorder and made cards manual drag-to-order). So the interactivity gate matters even more here than for tabs.
- **Gate by interactivity, like §6.1:** on a **non-interactive display** (`maxTouchPoints === 0`, the stable case) reorder/promote freely — and it is arguably *more* valuable than the tab router there, because the relevant card is fully off-screen, not just on the wrong tab. On an **interactive** small screen, prefer **additive promotion** — surface a compact "relevant now" card pinned to the top — over silently reshuffling the column under a scrolling finger.
- **Reuse the proven pattern, don't build a reorder engine.** `AlertBanner` already promotes to the top of the column when an alert is active (conditional render above `HeroCompact`). The clean extension is the same mechanism: a conditional, hazard-driven compact surface (mini radar + next-hour precip) pinned to the top when the verdict fires — not a general auto-sorting layout system.

Scope: ship the chart-tab router first and let it prove itself; this rides on the same `selectAutoTab` verdict afterward. Captured here so the verdict's output is designed to be consumable by both surfaces (the reducer already returns `{tab, reason, sourceBadge}` — a card-promotion consumer would read the same object).
