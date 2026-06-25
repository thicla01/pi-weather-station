# Pi Rail Affordance Redesign — Low-Level Design

**Status:** Design — §5 open questions **resolved by maintainer 2026-06-24**; doc is implementation-ready.
**Date:** 2026-06-23 (resolutions applied 2026-06-24)
**Scope:** v3 ambient tree (Pi 7" rail), affects both v3.2 (`feat/v32-radar-3-states`) and v3.3 (`forcePriorityViews=on`).

---

## 1. Overview & the unifying affordance principle

Today the Pi rail mixes three different affordance metaphors in a way that confuses what each tap does. The redesign establishes one consistent vocabulary across every rail card and dock control:

| Affordance | Meaning | Examples |
|---|---|---|
| **Maximize square (⤢)** | Drill into the **same topic** at full-rail size | Hero → Conditions, alert card → alert detail |
| **Dock button** | **Change topic** (a different subject altogether) | radar "now" → forecast "future", → AI summary |
| **Dotted underline** | Open a **popover** on that term (stay in place) | city name → LocationDetailsPopover, moon → MoonDetailsPopover, AQI value → AQ popover |

Three concrete consequences drive this LLD:

1. **Nowcast** is radar's "now" status. Jumping from it to the **forecast** ("future") is a topic change, so it must NOT be a maximize on the Nowcast card — it moves to a dedicated **dock button** in a new **"views" group** (which also gathers the existing IA/sparkle view-open; see Change 2 §3.1). The Nowcast card becomes single-role (radar status) and loses its maximize square.
2. **AQI value** opens a popover (it already does, via a chevron). The chevron is replaced by the house **dotted-underline** popover signal on the "42 AQI" text; the chevron is removed.
3. The Nowcast calm copy is re-anchored to **radar** ("No rain within 100 km") instead of restating the sky ("Clear and sunny"), with a leading **RADAR** source badge so its origin is honest — matching the project's banner-source convention.

Each change is detailed below with exact files, line references, i18n keys, and layout.

---

## 2. Change 1 — Nowcast "Option C"

### 2.1 Rationale

The Nowcast card has two problems:

- **Confusing entry point.** Tapping it maximizes to the forecast (`setPiLayoutState("max")`), but nothing on the card says "forecast". The maximize square reads as "expand this radar status", not "go to the forecast" — a topic jump disguised as a drill-in. Per the unifying principle, forecast access moves to the dock (Change 2) and the maximize is removed here.
- **Calm copy restates the sky, not the radar.** When the radar verdict is `null` (calm), the card prints a sky description (`nowcast.calm.clearDay` = "Clear and sunny"). But this is the **radar** surface — the user reads it to know whether rain is coming. "Clear and sunny" duplicates the Hero and says nothing about radar. Option C re-anchors the calm copy to the radar's actual coverage: **"No rain within 100 km"** (outer-ring radius, active distance unit).

We keep the sky-adaptive icon (sun/moon/cloud) because it still carries the useful clear-vs-overcast-dry cue, but we fix its intentional-but-too-faint contrast and add a RADAR badge so the line is unambiguously radar-sourced.

### 2.2 Files to touch

| File | Change |
|---|---|
| `client/src/components/ambient/NowcastLine/index.js` | Remove maximize (`enterMax` `:128-130`, `maximizeIcon` `:140-144`, wirings `:154`/`:177`); change calm render to radar-anchored copy + RADAR badge; read `distanceUnit`; add radar-freshness fallback; the whole line stops being a button |
| `client/src/components/ambient/NowcastLine/styles.css` | Bump calm-icon contrast (`:66-70`); add badge/layout rules; remove `.maximize`/`.maximizeIcon` (`:147-161`) if no longer used |
| `client/src/i18n/locales/en.json` / `fr.json` / `es.json` | Add `nowcast.calm.noRainWithin` + `nowcast.calm.radarUnavailable`; update `nowcast.aria` (no longer "tap to open forecast"); `nowcast.openForecast` can be removed (already unreferenced) |
| `client/src/AppContext.js` + radar state slice | **New radar-freshness signal** (see §2.6.1) — expose the **newest RainViewer frame timestamp** on `RadarStateContext` so NowcastLine can compare it against a 15-min staleness threshold |
| `client/src/components/WeatherMap/index.js` | Surface the latest RainViewer **frame** timestamp (the newest frame in the radar-timeline data) into the radar state slice so freshness is measured on the data, not our fetch (`:927-957`; `.then` `:929-952`, silent `.catch` `:953-957`) |

### 2.3 Calm-text i18n keys (radar-anchored)

The calm line currently chooses one of eight sky strings via `calmNowcast(code, isDay)` (`index.js:48-78`). Option C **replaces the default calm message** with a radar-coverage statement built from the outer-ring radius and the active distance unit.

**Radius source:** `RADAR_GEOMETRY[distanceUnit].outer.at(-1)` from `client/src/components/WeatherMap/geometry.js:36-45` → **100 (km)** or **60 (mi)**. Unit label = `distanceUnit` (`"km"`/`"mi"`). `NowcastLine` does not currently read `distanceUnit` — it must be added (available on the same context slices the layout passes; `AppContext.js:438`, slices `:2525`/`:2558`).

**New keys (interpolated):**

| Key | EN | FR | ES |
|---|---|---|---|
| `nowcast.calm.noRainWithin` | `No rain within {{distance}} {{unit}}` | `Aucune pluie sur {{distance}} {{unit}}` | `Sin lluvia en {{distance}} {{unit}}` |
| `nowcast.calm.radarUnavailable` | `Radar unavailable` | `Radar indisponible` | `Radar no disponible` |

Rendered example (km): "No rain within 100 km" / "Aucune pluie sur 100 km" / "Sin lluvia en 100 km".
Rendered example (mi): "No rain within 60 mi" / "Aucune pluie sur 60 mi" / "Sin lluvia en 60 mi".

**Design decision — what happens to the eight existing `nowcast.calm.*` sky strings.** The sky cue moves entirely to the **icon** (kept, see §2.5). The default calm **text** becomes `noRainWithin`. However, the *precipitating-but-below-alert* calm sub-states (light snow / light precip) are a case where "no rain within X" would be a lie. Recommended handling:

- **Dry calm** (sky codes clear/partly/cloudy/fog/none, i.e. the helper would have returned `clearDay`…`none`): show `noRainWithin`.
- **Light-precip calm** (`base ∈ [4000,9000)` incl. snow range — the helper's `lightSnow`/`lightPrecip` branches at `index.js:52-53`): keep the existing `nowcast.calm.lightSnow` / `nowcast.calm.lightPrecip` text (radar shows weak echoes; "no rain within X" is wrong). The RADAR badge + icon still apply.

This keeps `lightSnow`/`lightPrecip` keys in use; `clearDay`/`clearNight`/`partly`/`cloudy`/`fog`/`none` become **icon-only selectors** in the `calmNowcast` switch — they continue to drive sky-icon selection but their text is superseded by `noRainWithin`. **Resolved (Q1, §5): do NOT delete these six keys.** They are retained as icon-only selectors; only their text role is dropped.

**Aria update.** `nowcast.aria` currently reads `{{verdict}}. Tap to open the forecast.` — no longer true (the line is not tappable). Change to a plain status label:

| Key | EN | FR | ES |
|---|---|---|---|
| `nowcast.aria` | `Radar status: {{verdict}}` | `État du radar : {{verdict}}` | `Estado del radar: {{verdict}}` |

`nowcast.openForecast` (already unreferenced in all three locales) should be **removed** in this PR.

### 2.4 Radar role-marker (reuse the source-badge convention)

Add a leading **RADAR** badge using the v3 ambient component, NOT the legacy v2 `styles.sourceBadge` span:

- Reuse `client/src/components/ambient/SourceBadge/index.js` → `<SourceBadge source="RADAR" />`.
- This is the same component `ambient/AlertBanner/index.js:371` uses for radar-derived alerts (which is gated off on Pi at `:353` via `if (isPi) return null;`, so NowcastLine is the Pi-side radar surface — the badge belongs here). *(Line refs updated post-#273, which inserted the `isTest`/`testBadge` logic above this branch and shifted it down ~18 lines; the RADAR branch itself was not touched — test alerts are NWS-gov-only.)*
- The `.badge` class (`SourceBadge/styles.css`) is token-driven (`--c-accent-soft` fill, `--c-text` label, Geist Mono 11px, uppercase) and reads on all four palettes including night-red.

This satisfies CLAUDE.md's "every alert/status line carries a leading source badge" rule (the `RADAR` tag is already documented). Apply the badge in **both** the calm and alarm render paths so the line's origin is always shown.

### 2.5 On-screen layout: badge + sky icon + text on a 7" line

The card is a single horizontal line on a 800×480 panel. Proposed left-to-right order:

```
[RADAR]  ☀  No rain within 100 km           ● (alarm path only: confidence dot)
 badge  icon   verdict/calm text
```

- **`[RADAR]` badge** — leftmost, `SourceBadge`, `flex: none`.
- **Sky icon** — the existing `.icon` span (`styles.css:82-90`, 18px InlineIcon), kept for the clear-vs-overcast cue. Reconciliation with the badge: the badge says "this is radar"; the icon says "and the sky is clear/cloudy/foggy" — distinct information, not redundant. On a tight line they sit adjacent with the badge's existing right gap (`.line` gap).
- **Text** — verdict (alarm) or `noRainWithin`/light-precip/`radarUnavailable` (calm), `flex: 1`, full-contrast (`.verdict` already hard-sets `color: var(--c-text)` at `styles.css:107`).
- **Confidence dot** — alarm path only, trailing (unchanged, `index.js:160`). Calm path has no dot (unchanged).
- **No maximize square** (removed, §2.7) — frees the right edge.

If the badge + icon + longest string ("Aucune pluie sur 100 km" + FR alarm verdicts) overflow at font-size L, the verdict text is the flex child and ellipsizes; the badge and icon stay fixed. Verify at the three font sizes (s/m/l) on the 800×480 viewport (see §6).

### 2.6 Calm-icon contrast fix

Root cause (grounding §4): the `.tier-calm.tier-calm` rule (`styles.css:66-70`) sets `color: var(--c-accent-soft);` (the `color` declaration itself is at `:69`), which is inherited by `.icon` via `InlineIcon`'s `currentColor` (`styles.css:82-90`). The calm tier is intentionally "quiet" (soft accent edge + surface fill so it doesn't compete with the Hero), but that makes the **icon** too faint. The verdict text is already exempt (`.verdict` hard-sets `--c-text` at `:107`).

**Fix:** give `.icon` its own colour instead of inheriting the soft-accent `currentColor`, so the calm border stays soft but the glyph is legible. Recommended:

```
.icon { color: var(--c-text); }   /* or var(--c-text-dim) if --c-text is too loud next to the quiet border */
```

This keeps the calm tier's quiet *edge* (border-left stays `--c-accent-soft`) while lifting the icon to body/dim contrast. Decide `--c-text` vs `--c-text-dim` against the four palettes during implementation (night-red is the constraint — verify the glyph reads on the red surface). Do **not** raise the border or background to "fix" contrast — that would undo the deliberate quiet-tier design; the fix is the icon colour only.

### 2.6.1 Radar-unavailable fallback (freshness gate)

"No rain within X" is only truthful when the radar data is current; on a stall the last-good values persist and the calm copy would assert clear skies on stale data. **Resolved (Q2, §5):**

- **Freshness is measured on the newest RainViewer FRAME timestamp**, NOT on our own fetch-success. If the latest radar frame is **> 15 minutes old**, NowcastLine renders `nowcast.calm.radarUnavailable` ("Radar unavailable") instead of `noRainWithin`. Within the 15-min window the calm copy renders normally.
- **Why frame-timestamp and not fetch-success:** a successful poll that returns a stale newest-frame is still stale; conversely a momentary fetch hiccup that is followed by fresh frames is not. Gating on the data's own timestamp is the honest signal.
- **Why 15 minutes:** RainViewer publishes new frames roughly **every 10 min**; our client polls are current-weather **10 min** and nearby/radar alerts **5 min** (per `AppContext.js`). 15 min ≈ 1.5 RainViewer cycles — long enough that a single missed cycle does not false-trigger the fallback, short enough to catch a real stall.
- **Implementation:** expose the newest-frame timestamp on the radar state slice (see §2.2). NowcastLine computes `Date.now() - newestFrameTs > 15 * 60 * 1000` → show `radarUnavailable`. Define the threshold as a named constant (e.g. `const RADAR_STALE_MS = 15 * 60 * 1000`) at the top of the file per the constants convention. The RADAR badge + sky icon still render in the unavailable state (origin remains honest).

This touches `AppContext.js` + `WeatherMap/index.js` in addition to NowcastLine — a slightly broader blast radius than the rest of Change 1, but it ships **in this PR** (the calm copy is not honest without it).

### 2.7 Remove the maximize affordance

Delete from `NowcastLine/index.js`:

- `enterMax` callback (`:128-130`) and `MAX_STATE` const (`:26`) — no longer used here.
- `maximizeIcon` JSX (`:140-144`) and the `ExpandIcon` import (`:12`) if unused elsewhere in the file.
- `onClick={enterMax}` on both the alarm button (`:154`) and the calm button (`:177`).
- The wrapping `<button>` becomes a non-interactive container (`<div>` / `<span>`). Remove `role`/tab/aria-button semantics; the line is now status-only. Remove `setPiLayoutState` from `AppActionsContext` consumption (`:104`) if not otherwise needed.

Delete from `styles.css`: `.maximize` / `.maximizeIcon` (`:147-161`) and the `button` reset workarounds that only existed for the tap target, IF the element is no longer a button.

**Forecast access does not disappear** — it moves to the dock (Change 2). After this change there is exactly one way to reach the forecast MAX view on the Pi: the new dock button.

### 2.8 v3.2 & v3.3 impact

`NowcastLine` is a **shared component** mounted in `LayoutPi/index.js:171` unconditionally (not behind the `priority &&` guard). Therefore:

- **v3.2** (classic 3-states): NowcastLine loses its maximize; forecast reachable only via the new dock button.
- **v3.3** (`forcePriorityViews=on`): same component, same change. The rail already has view buttons; the dock forecast button (Change 2, priority branch) is the path. NowcastLine's former MAX target is fully replaced by the dock button.

Both branches must be smoke-tested. Since NowcastLine is the MID column's content in both, removing its tap target must not strand the user — confirm the dock forecast button is present in both v3.2 and v3.3 docks before merge.

---

## 3. Change 2 — Forecast dock button

### 3.1 File & placement

`client/src/components/ambient/ControlButtons/index.js`. **Resolved (Q4, §5):** rather than adding `btnForecast` to the already-heavy Map group, create a **new dedicated "views" group** in the grouped dock and put the view-opening buttons there:

- **Map group** = map *manipulation* only (recenter / location / timeline / focus). It keeps its current membership and size — the dock-density concern (§3.3) is resolved by NOT growing this group.
- **New "views" group** = open a maximized content view. It holds **two** buttons: the existing IA/sparkle button (`btnBot`), **relocated here out of the Map group**, plus the new `btnForecast` (forecast → MAX).

This matches the unifying principle: "views" buttons all *change topic to a full-rail content view*, distinct from "Map" buttons that *manipulate the map in place*. Add `btnForecast` as a `const` and move `btnBot` into the new views-group array (grouped dock, near `:717-727`); update the flat array (`:750-768`) so both `btnBot` and `btnForecast` sit together. This is a slightly larger dock-grouping change than originally scoped — it relocates the existing IA button, not just adds a forecast button.

### 3.2 Button spec (modeled on the IA/sparkle button)

Mirror the `btnBot` priority branch (`index.js:611-622`) — a silent view-open with a down-state:

- **Wrapper:** bare `<div key="forecast">` (dock convention — div, not button).
- **Icon:** **Resolved (Q5, §5):** a vertical-columns / column-chart glyph from IBM Carbon, NOT a weather glyph and NOT a generic expand/⤢ glyph (that would re-introduce the maximize ambiguity). Use `import chartColumnIcon from "@iconify/icons-carbon/chart-column";` — consistent with the existing `@iconify/icons-carbon/*` imports in `ControlButtons`. **Verified:** `client/node_modules/@iconify/icons-carbon/chart-column.js` exists, so `chart-column` is spec'd (no fallback needed). It is visually distinct from `timePlotIcon` (carbon/time-plot, the timeline button), so no collision in the dock set.
- **`onClick`:** `() => setPiLayoutState("max")` — silent, no `notify`, no event arg (view-opens are a visible result, not a toast confirmation; matches `btnBot` `:615` and the comment block `:600-610`).
- **Down-state:** `className={\`${piLayoutState === "max" ? styles.buttonDown : ""}\`}` — lit when the MAX/forecast view is active (mirrors `:616`).
- **`title` + `aria-label`:** both from a new `controls.openForecast` key (duplicated per dock convention).
- **Gate:** priority branch shows unconditionally (no debug gate — it is a real feature, same call as `btnBot` `:600-610`). Optionally gate on forecast data presence; recommended **no gate** (ChartTabs is always-mounted and handles empty data). Non-priority (v2) branch: `: null` — there is no legacy v2 forecast-toggle analogue, so use the **whole-button-swap** pattern with a `null` fallback (cleanest, per grounding §2):

```
btnForecast = inPriorityDock
  ? <div key="forecast" onClick={() => setPiLayoutState("max")}
         className={piLayoutState === "max" ? styles.buttonDown : ""}
         title/aria-label = t("controls.openForecast")> <chart icon> </div>
  : null;
```

`setPiLayoutState` and `piLayoutState` are already in scope (`AppActionsContext` `:108`, `SystemContext` `:121`) — no new context wiring.

**i18n key** (nested `controls` block, parallel to `openAiView` at line 479 in all three files):

| Key | EN | FR | ES |
|---|---|---|---|
| `controls.openForecast` | `Open forecast` | `Ouvrir les prévisions` | `Abrir el pronóstico` |

(FR/ES reuse the wording already present in the now-removed `nowcast.openForecast`, so the strings are not new translations — they migrate from the Nowcast namespace to `controls`.)

### 3.3 Dock-density note

**Resolved (Q4, §5):** the dock-density concern is addressed by the new **"views" group** (§3.1) rather than by growing the Map group. The Map group **stays at its current size** (the IA button moves out, the forecast button never lands there), so the earlier 8→9 crowding worry no longer applies.

- The views group holds two buttons (`btnBot` + `btnForecast`), both "change topic" view-opens — a coherent pair, not a crowded list.
- Keep both **primary** (no `data-dock-priority="secondary"`) — forecast and AI are primary navigation paths on the Pi. Several Map buttons remain conditionally `null` (timeline/legend gate on `radarSource==="rainviewer"`; rings/bot have local+debug gates), so the steady-state visible dock count is comfortable.
- Order within the views group: IA/sparkle then forecast (or forecast then IA — final order is a cosmetic on-device choice; both are view-opens, so adjacency is what matters).
- Verify the regrouped dock (Map group + new views group + Display group) fits the 800px-wide Pi dock at all three font sizes.

### 3.4 v3.2 / v3.3 consistency

The button is `inPriorityDock`-only (priority branch, `: null` otherwise). This aligns v3.2 with v3.3's dock-driven navigation model: in both, forecast is reached the same way (dock chart-column button → MAX). Combined with Change 1 removing the Nowcast maximize, there is exactly one forecast entry point and it is identical across both layouts.

**Both docks must be updated.** Because this resolution also **relocates the existing IA button** into the new views group (§3.1, Q4), the dock structure changes in *both* the **v3.2** (`feat/v32-radar-3-states`) and **v3.3** (`forcePriorityViews=on`) docks. Verify both: the views group (IA + forecast) renders correctly, and no v2/non-priority branch regresses (the views group is priority-only; the non-priority branch keeps its `: null` fallbacks for both buttons).

---

## 4. Change 3 — AQI underline → popover

### 4.1 Exact change

In `client/src/components/ambient/AirCard/index.js`, the AQI row (`Row` body `:238-272`) currently ends in a chevron that signals "tappable". Replace the chevron signal with the house **dotted-underline** on the "42 AQI" value text:

1. **Remove the chevron** — delete the `InlineIcon` chevron (`:266-268`) and the `.chevron` CSS rule (`styles.css:134-138`). Remove the now-unused imports `InlineIcon` and `chevronRight` (`:5`) **only if** they have no other use in the file (grounding confirms both are chevron-only → both imports go).
2. **Underline the value term.** The visible "22 AQI" is two adjacent spans: `.value` (the number, `:258`) + `.label` (the scale label "AQI"/"IQA"/"AQHI", `:259`). Wrap the value+label pair in an inline element carrying a new `.valueUnderline` class, modeled on SunMoonBlock's `.headLabel` (`SunMoonBlock/styles.css:45-51`):
   ```
   .valueUnderline { border-bottom: 1px dotted var(--c-text-dim); padding-bottom: 2px; }
   ```
   Because the underline lives on a **span** (not the row button), no doubled-selector specificity trick is needed (the `.ambientRoot button` reset doesn't touch spans — SunMoonBlock precedent, `SunMoonBlock/styles.css:20-24`).
3. **Press feedback:** `.row-interactive:active .valueUnderline { border-bottom-color: transparent; }` — mirrors `.head:active .headLabel` (`SunMoonBlock/styles.css:53-55`).

**Underline scope:** underline the whole "42 AQI" (value + label), not just the number — it reads as one tappable term (grounding §5 recommendation A). The pastille ("RISQUE FAIBLE" + tier colour) stays a **pure level indicator** and is NOT underlined (it is not the tap affordance).

### 4.2 The popover trigger is reused unchanged

No change to the interaction wiring — it already opens a popover, not a maximized view (confirmed):

- Row `onClick={() => toggle("aq")}` (`index.js:108`) → `setOpenKey("aq")` (`:97`).
- `DetailsPopover` rendered as the row's child (`:116-168`), `open={openKey === "aq"}`, `portal` mode (load-bearing — the card has `overflow: hidden`, `styles.css:13`).
- The whole `.row` remains the tap surface (keeps the ≥44px hit area, `styles.css:37`). The underline is purely the **visual** affordance replacing the chevron. The `onClick`/`toggle`/`DetailsPopover` chain is untouched.

The popover content (VALEUR/STATION/SOURCE/TYPE/ÂGE/POLLUANT, `:123-167`) is unchanged. The pastille stays as-is.

### 4.3 Pollen row symmetry

The pollen row (`:171-211`) uses the same shared `Row` and the same chevron. **Resolved (Q3, §5): YES — apply the same dotted-underline treatment to the pollen row, for parity with the AQI value.** The chevron removal + value underline apply to the pollen row exactly as to the AQI row: its `valueText` span (the worst-allergen value) gets the same `.valueUnderline`, and the `.row-interactive:active .valueUnderline` press feedback applies. Both rows are covered by this change — no half-applied convention.

### 4.4 Files/lines

| File | Change |
|---|---|
| `client/src/components/ambient/AirCard/index.js` | Remove chevron `:266-268`; remove `InlineIcon`/`chevronRight` imports `:5`; wrap value+label in `.valueUnderline` (AQ row + pollen row) |
| `client/src/components/ambient/AirCard/styles.css` | Remove `.chevron` `:134-138`; add `.valueUnderline` + `.row-interactive:active .valueUnderline` |

No i18n changes (the chevron had no string; the underline reuses existing value/label text).

---

## 5. Edge cases — maintainer resolutions

All six questions below have been **resolved by the maintainer** (2026-06-24). Each resolution is reflected in the body sections cited; this list is now a record, not an open queue. The doc is implementation-ready.

- **Q1 — Sky-text strings. RESOLVED: keep all six keys.** The six `nowcast.calm.*` sky strings (`clearDay`/`clearNight`/`partly`/`cloudy`/`fog`/`none`) are **NOT deleted**. They remain as **icon-only selectors** in the `calmNowcast` switch (they drive sky-icon selection); their text is superseded by `noRainWithin`. `lightSnow`/`lightPrecip` also stay (still rendered as text, Q6). `nowcast.openForecast` is still removed (already dead). See §2.3.

- **Q2 — Radar-freshness signal. RESOLVED: 15-min threshold on the newest RainViewer FRAME timestamp.** The radar-unavailable fallback measures freshness on the **newest RainViewer frame timestamp** (NOT our own fetch-success): if the latest radar frame is **> 15 min old**, NowcastLine shows `nowcast.calm.radarUnavailable` instead of `noRainWithin`. Rationale: RainViewer publishes frames ~every 10 min; client polls are current-weather 10 min and nearby/radar alerts 5 min (per `AppContext.js`); 15 min ≈ 1.5 RainViewer cycles → no false-trigger on one missed cycle, but catches a real stall. **Ships in this PR** despite the broader AppContext + WeatherMap blast radius (the calm copy is not honest without it). See §2.2 and §2.6.1.

- **Q3 — Pollen row parity. RESOLVED: YES.** Apply the same dotted-underline treatment to the pollen row, for parity with the AQI value (chevron removal + `.valueUnderline` + active press feedback on both rows). See §4.3.

- **Q4 — Dock density. RESOLVED: new "views" group.** Do not grow the Map group. Create a dedicated **"views" group** holding the **forecast button AND the existing IA/sparkle button** (relocated out of the Map group), separate from the **Map group** (recenter/location/timeline/focus = map manipulation). The Map group keeps its current size, resolving the density concern. This is a slightly larger dock-grouping change than originally scoped (it also moves the existing IA button), and **both v3.2 and v3.3 docks must be updated**. See §3.1, §3.3, §3.4.

- **Q5 — Forecast icon choice. RESOLVED: `@iconify/icons-carbon/chart-column`.** A vertical-columns / column-chart Carbon icon (`import chartColumnIcon from "@iconify/icons-carbon/chart-column";`), consistent with the existing `@iconify/icons-carbon/*` imports in `ControlButtons` — NOT a weather glyph. **Verified present:** `client/node_modules/@iconify/icons-carbon/chart-column.js` exists, so no fallback was needed. See §3.2.

- **Q6 — Light-precip calm wording. RESOLVED: keep existing wording.** Keep the `lightSnow`/`lightPrecip` calm sub-cases with their existing text rather than forcing `noRainWithin` (which would be a lie when radar shows weak echoes). No new keys. See §2.3.

---

## 6. Build / test checklist

Per CLAUDE.md maintainability gates, before any commit:

- [ ] `cd client && npm run prod` — **zero errors** (bundle-size warnings OK). Rebuild the committed `dist/`.
- [ ] `npm test` — Node built-in runner; the radar-trend suite (`test/radarTrend.test.js`) must stay green (Change 1 touches NowcastLine, not `getRadarAlertState`, but verify no regression).
- [ ] **JSDoc + PropTypes** complete on every changed component (NowcastLine, AirCard, ControlButtons). NowcastLine takes no props today; if `distanceUnit` is read from context (not props) PropTypes are unchanged, but the JSDoc must note the new context dependency.
- [ ] **All new strings in en/fr/es** (CLAUDE.md rule; these are kiosk-visible → locale files, NOT the `lbl()` helper which is restricted to SettingsPanel/DebugPanel):
  - `nowcast.calm.noRainWithin`, `nowcast.calm.radarUnavailable`, updated `nowcast.aria`
  - `controls.openForecast`
  - removals: `nowcast.openForecast` (all three)
- [ ] **Source badge** on the Nowcast line uses `ambient/SourceBadge` (`source="RADAR"`), documented `RADAR` tag (CLAUDE.md alert-source convention — no new tag introduced).
- [ ] **Update `docs/ui-layout_en.md` + `docs/ui-layout_fr.md`** — the rail layout changes (Nowcast loses maximize, gains RADAR badge; dock gains forecast button; AQI chevron → underline). Keep both in sync.
- [ ] **CHANGELOG.md** entry under the appropriate version (v3.2/v3.3 line).
- [ ] Visual verification on the **800×480** viewport at font sizes **s/m/l**, all four palettes (day/dusk/night/**night-red** is the contrast constraint for the calm-icon fix), in **Firefox** (the fleet kiosk browser) — Nowcast line does not overflow with badge+icon+longest FR/ES string; calm icon legible; the regrouped dock (Map group unchanged + new views group [IA + forecast] + Display group) fits.
- [ ] Smoke-test **both v3.2 (classic) and v3.3 (`forcePriorityViews=on`)** — forecast reachable via the new dock button (views group) in both; the relocated IA button still works in both; Nowcast no longer tappable in either.
- [ ] **#264 kiosk-thermal rule** — none of these changes may introduce `animation: …infinite` (or a perpetually-compositing transition) on a kiosk surface. The calm-icon contrast fix (§2.6) is a static `color` change, the new forecast dock button (§3) and the AQI dotted-underline (§4) are static styling and an existing-popover trigger — all compliant. NowcastLine's `styles.css` has no animation/transition rules today (only a static `:focus-visible` outline); keep it that way. The down-state on the new dock button must be a plain class toggle (mirror `btnBot`), not an animated highlight.

---

## 7. Terminology collision note (no action)

The AQI popover's **TYPE DE LECTURE** field can show **"NowCast"** (`badges.aqiKindNowcast`, `en.json:246`) — this is **EPA AirNow's reading-type label** (a smoothed-average air-quality computation), entirely unrelated to our radar **NowcastLine** component. It is a naming coincidence surfaced from the AirNow source data. **No action** — do not rename either; just be aware the same word denotes two unrelated concepts (radar status line vs AQ reading type) when reading the code or popover.
