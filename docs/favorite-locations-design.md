# Favorite Locations — Low-Level Design

**Status:** SHIPPED. Lots 1-3 in [PR 315](https://github.com/thicla01/pi-weather-station/pull/315)
(2026-08-10) and the `⌂` home row in
[PR 316](https://github.com/thicla01/pi-weather-station/pull/316) (2026-08-11), released in v3.2.0.
First field cycle — [issue 319](https://github.com/thicla01/pi-weather-station/issues/319) plus the
2026-08-16 field session — in [PR 320](https://github.com/thicla01/pi-weather-station/pull/320)
(county auto-labels, zoom capture, popover-state reset, input-environment probe),
[PR 324](https://github.com/thicla01/pi-weather-station/pull/324) (pinnable home row, home-first
ordering, viewport-fit popover height) and
[PR 328](https://github.com/thicla01/pi-weather-station/pull/328) (the height regression 324
introduced on bottom-anchored triggers),
[PR 330](https://github.com/thicla01/pi-weather-station/pull/330) (Q1 reversed — selecting a
favorite no longer touches the zoom) and
[PR 331](https://github.com/thicla01/pi-weather-station/pull/331) (return to automatic
geolocation: live apply + the home row's `↺`). The non-touch rename gate was removed
2026-08-17 — see the §5.1.1 amendment. Dated amendments in §4, §5.1.1, §5.2 and §9;
as-shipped deviations in §10; the field-test outcome in §14.
**Nothing is open.** The Debug panel's input-environment probe (PR 320) stays as a
diagnostic; it is no longer gating a decision.
**Date:** 2026-07-27 · **re-validated against HEAD `011afc8` on 2026-08-10** after the React 19 /
react-leaflet 5 migration (PR 314) and the Dependabot batch. All 21 file:line citations still
resolved; no design decision was invalidated. New binding constraints in **§8.6**.
**Scope:** v3 ambient tree (all layouts: Pi 7", desktop, mobile) + `settings.json` schema + one new
value-level sanitizer on the server. No new external service, no new API key.

---

## 1. Overview

The request: let the user keep a short list of favorite places and jump back to any of them, and
promote one of them to the app's default location.

Three facts about the current codebase frame the whole design:

1. **Runtime location switching is already fully wired.** `setMapPosition(coords)`
   ([`AppContext.js:1522`](../client/src/AppContext.js)) updates the weather triplet and pans the
   map; everything else keys off `mapGeo` by effect — reverse geocode, gov alerts, nearby alerts,
   air quality, pollen, radar risk, and the Sense HAT location push
   (`POST /api/kiosk-location`). A favorite only has to call that one function.
2. **A "default location" already exists.** `startingLat` / `startingLon` live in `settings.json`
   and are already whitelisted ([`settingsCtrl.js:37`](../server/settingsCtrl.js)). They are edited
   today in Settings → Location & hardware. The dock's **Recenter** button already returns to them,
   because `browserGeo` is seeded from them at boot
   ([`AppContext.js:1209-1242`](../client/src/AppContext.js)). We are not inventing a concept — we
   are giving an existing one a better entry point.
3. **There is no forward geocoding.** Only `GET /api/reverse-geocode` exists
   ([`proxyCtrl.js:510`](../server/proxyCtrl.js)); LocationIQ's `search.php` is not proxied. So v1
   pins **the place you are already looking at**. That is also the right gesture on a 7"
   touchscreen with no keyboard. A search box is explicitly deferred (§13).

---

## 2. The affordance decision — why *not* the city-name tap

The obvious-looking entry point is the city name in the hero, which today opens
`LocationDetailsPopover`. This design **rejects** overloading it, for four reasons:

1. **It contradicts the vocabulary already codified** in
   [`rail-affordance-redesign-design.md`](rail-affordance-redesign-design.md): *dotted underline =
   popover on that term*, *maximize ⤢ = drill into the same topic*, ***dock = change topic***.
   Choosing a different city changes the subject of the entire app — every panel, the radar, the
   alerts, and the Sense HAT. That is a dock action by the project's own rule.
2. **The existing popover has no replacement.** It surfaces locality / district / county / region /
   country / postcode / coordinates — the administrative detail the truncated `LocationName` label
   cannot fit. Replacing it is a straight regression.
3. **That exact region of the DOM is a known hit-testing minefield.** The `.location` row in
   `HeroCompact` is what swallowed the taps meant for the maximize square (paint-order bug, fixed
   in `94f677b` with `z-index: 2`). Stacking a second tap target there re-opens the same class of
   bug on the only surface that has no mouse.
4. **On the 7" the city name is truncated**, which makes it a poor target for an app-global action.

**But the popover is still the right place to *create* a favorite.** "Pin *this* place" is a
statement about the location currently displayed — same topic, so it obeys the rule. Selecting a
*different* place is the topic change, and that goes to the dock.

### 2.1 The model — three gestures, three places

| Gesture | Where | Effect |
|---|---|---|
| **Create** | `★ Pin this place` action appended to the existing `LocationDetailsPopover` body | Appends `mapGeo` (rounded, §6.1) to `favorites`, label pre-filled from the reverse geocode |
| **Pick** | **New dock button "Places"**, Map group, immediately after Recenter | Opens a `DetailsPopover` listing the favorites; tap an entry → `setMapPosition()` |
| **Promote to default** | Secondary action on a list entry (`⌂ Set as default`) | Writes `startingLat`/`startingLon`; the entry gets a `⌂` badge. Localhost-only (§7.4) |

Delete lives on the list entry too, behind an explicit **Edit** toggle (§5.3).

---

## 3. Why the dock, given dock density

The dock already carries ~14 icons on a localhost Pi (Map 6-7, Views 2, Display 3, System 3-4), and
the rail redesign LLD flagged density as a thing to watch. The alternatives are all worse:

| Placement | Verdict |
|---|---|
| City-name tap | Rejected — §2 |
| A rail card ("Places") | Rejected — costs vertical rail height, the scarcest resource on the 7". v3.3 exists *because* of a 134 px overflow at font size L |
| Settings panel only | Rejected — it is a frequent navigation action, not configuration; burying it two panels deep defeats the request |
| **Dock button** | **Chosen** — zero vertical rail cost, matches the "change topic" rule, and sits next to Recenter, which is semantically its sibling ("where are we looking?") |

**Group:** *Map*, not *Views*. The Views group is defined as "open a full-rail content view" and is
Pi-only; Places is a map-scope action available on every layout.

**Do NOT set `data-dock-priority="secondary"`.** That attribute collapses a button on narrow
portrait phones ([`BottomDock/styles.css:126`](../client/src/components/ambient/BottomDock/styles.css)).
Places must stay reachable — Recenter, its sibling, is not flagged either.

---

## 4. Capacity — `MAX_FAVORITES = 6`

Three independent constraints converge on the same number:

**Display.** The Pi rail is ~300 px wide × ~480 px tall, and the binding case is font size **L**
(the maintainer's setting; "design for the tightest budget, not the middle one" is the rule that
produced v3.3). A popover with a header, a "Current position" row, 44 px touch targets and a
footer fits **6 entries without scrolling**. At 8 the list scrolls inside a popover on a short
screen — the worst affordance on a touchscreen kiosk.

> **Amendment 2026-08-16 — the display constraint, re-measured.** Two premises above turned out
> wrong once measured against the shipped code: (1) the popover **portals to `document.body`**,
> outside the rail subtrees that carry the font-size `zoom`, and nothing consumes the copied
> `--c-font-scale` — so font L never binds this surface; (2) the binding ceiling was the
> `DetailsPopover` portal cap (`min(420, …)`), under which the home row added by PR 316 made the
> real worst case (⌂ + 6 = 7 rows, ~433 px) **clip its footer by 13 px** — reproduced and
> confirmed on the 7" kiosk on 2026-08-16. Resolution: the Places popover now opts out of the
> fixed cap (`fitViewport`, viewport-derived: 440 px of content on a 480 px-tall panel), which
> fits every state up to 7 rows. **`MAX_FAVORITES` stays 6** and the display model is "7 rows
> max": 8 rows of 44 px touch targets need ~503 px of outer box against 464 px available on the
> fleet's 480 px screens — no cap value can fit that, so the cap is what guarantees the
> no-scroll property. (Maintainer decision 2026-08-16: home row + 6 favorites, never an 8th row.)

> **Amendment 2026-08-17 — the cap is a ROW budget, so the home entry does not count.** The
> flat cap of 6 charged a slot for pinning the home location — spending one of six on a place
> the popover had been showing for free as the `⌂` pseudo-row, which is what a user hit in the
> field after pinning their IP-derived home. The rule is now stated the way the constraint
> actually works:
>
> ```
> rows = favorites.length + (home pinned ? 0 : 1)   ≤ 7
> ```
>
> so the list holds **7 favorites when one of them is home, 6 otherwise** — both render 7
> rows, and pinning home is *row-neutral*: the stored row replaces the pseudo-row it
> suppresses. Measured on a 480 px panel: 7 favorites with home pinned is **424 px** of
> content against the 440 px viewport-fit budget (verified in-browser: `maxHeight 440`, outer
> 448, 17 px of bottom margin, no scrolling) — actually **9 px shorter** than the ⌂ + 6 case
> that already shipped.
>
> **Quota agrees, and this is why the general 6→7 stayed rejected.** A flat seventh slot would
> cost ~21 Tomorrow.io calls on a fully-cold tour against ~17/h of burst headroom. The
> conditional seventh can only ever be the home location — where the kiosk boots and where
> Recenter returns — so its weather is effectively always cached and the marginal upstream
> cost is nil.
>
> **The one cost, stated plainly.** An 8-row state becomes reachable again if, while holding 7
> favorites, the user moves the default to a place that is none of them (hand-typed
> coordinates, or `↺` when the pinned home was a manual override). The `⌂` pseudo-row then
> reappears above 7 rows and the popover scrolls ~39 px — gracefully, since PR 328; nothing
> clips. Moving the default to another *favorite*, or `↺` when the pinned home already is the
> IP-derived one, stays safe.
>
> **Where each bound lives.** `MAX_ROWS = 7` in the client hook expresses the display rule and
> yields two affordance flags — `canPin` (ordinary places, 6 unless home is pinned) and
> `canPinHome` (always allowed up to 7, since it adds no row). `MAX_FAVORITES = 7` on the
> server is the resource ceiling only: it cannot evaluate "is home pinned" (that depends on
> `browserGeo`, which blends `settings.json` with the IP-geolocation cache) and has no
> business trying. A hand-crafted `PATCH` can therefore store 7 arbitrary places; the only
> consequence is a popover that scrolls.
>
> **Implementation trap, found in the browser rather than in review.** `pin()` must budget the
> **resulting** list, not the current one. Checking before the insert reads the old, stricter
> cap and silently refuses the very action that would relax it — the ★ button appeared
> enabled and did nothing.

**Quota.** Tomorrow.io is 25 req/h per key, with 2 Pis sharing a key since the C2 decision
(2026-06-15) — call it ~10 req/h of real headroom per Pi. Each *cold* location costs 3 Tomorrow.io
calls plus reverse-geocode, sunrise/sunset, two alert queries, air quality and pollen. Visiting all
6 favorites inside one cache window ≈ 18 Tomorrow.io calls: uncomfortable but survivable. At 10
favorites it is not.

**Cognition.** Past ~7 entries a flat list with no search becomes a scroll-and-hunt.

**Behaviour at the cap:** the `★ Pin this place` action becomes **disabled** with an explanatory
line ("List full — remove one first"). Do **not** silently evict FIFO: silent eviction on a kiosk
that someone checks once a week is indistinguishable from data loss, and it could evict the entry
currently marked as default.

Declare it as a named constant next to the hook (project rule: named constants for all thresholds):

```js
// client/src/hooks/useFavoriteLocations.js
const MAX_FAVORITES = 6;
```

---

## 5. UX detail

### 5.1 Pin action — inside `LocationDetailsPopover`

Appended after the `location.source` line
([`LocationDetailsPopover/index.js:133`](../client/src/components/ambient/LocationDetailsPopover/index.js)),
separated by a hairline. Three states:

| Condition | Render |
|---|---|
| Not pinned, list not full | `★ Pin this place` button (44 px hit area) |
| Already pinned (coords match an entry, §6.1) | `★ Pinned` — static, dimmed, not a button |
| List full | `★ Pin this place` disabled + helper `favorites.full` |

The label is pre-filled from the reverse geocode already in context: `locality` (city / town /
village / hamlet / municipality, the same fallback chain the popover uses) plus `region` when it
fits — e.g. `Saint-Donat, QC`. Truncate to `MAX_LABEL_LEN = 40`.

> **Amendment 2026-08-16:** the first half of the auto-label now falls back to the **county**
> (`county` / `state_district`) when no locality is mapped. A rural point otherwise degraded to
> the bare region — which is how a Texas ranch got auto-labelled "Texas" (GitHub issue 319,
> the feature's first field report). The county only substitutes for a missing locality; it
> never joins one. Implemented in `client/src/ui/placeLabel.js`.

`noData` case: if there is no reverse-geocode payload, fall back to the formatted coordinates as
the label so pinning still works over a lake or a field.

### 5.1.1 Rename — ~~gated on non-touch~~ ungated (Q5 resolved 2026-07-27, **gate removed 2026-08-17**)

> **Amendment 2026-08-17 — the device gate is gone; rename is offered on every local client.**
>
> The gate below (`navigator.maxTouchPoints === 0`) answers *"is a toucher present"*, not
> *"can the user type"*, and **the web platform cannot answer the second question at all** —
> `navigator.keyboard` reports layout, not presence. So every candidate replacement was
> another proxy that would eventually be wrong on hardware nobody has bought yet. Two
> intermediate proposals were considered and dropped: `(any-hover: hover) and (any-pointer:
> fine)` — which fixes a touch laptop with a trackpad but **not** a touchscreen with a
> keyboard and no mouse, since a keyboard adds no pointer; and a `keyboardSeen` flag flipped
> by the first real `keydown` — sound, but it makes the affordance appear only after an
> invisible precondition.
>
> **What the field actually showed.** The gate's real-world failure was `.6.55`: an HDMI
> monitor that is also a touch panel (`ILITEK ILITEK-TP` on USB) with a wired keyboard
> attached — `maxTouchPoints > 0`, rename hidden, keyboard right there. And the case that
> *motivated* the whole review (issue 319) turned out never to have been about the gate at
> all: the home pseudo-row had no rename affordance on **any** device until PR 324. The gate
> was protecting against a cost that measurement did not support.
>
> **Why removing it is safe.** The failure mode on a keyboard-less kiosk is benign, and was
> verified rather than assumed: the input is seeded with the current label, so a blur with no
> typing gives `next === f.label` and `commitRename` returns without writing. Nothing is
> saved, nothing is lost, the row returns to normal. Reaching the field takes a deliberate tap
> into Edit mode, so it is never hit by accident — which retires the original objection, aimed
> at a stray-tap risk that Edit mode had already eliminated.
>
> **What replaces it.** `favorites.renameHint` ("Enter to save, Esc to cancel") moves from a
> `title` tooltip to a **visible line under the field**. Tooltips never fire on a touchscreen,
> so the client that most needed the keyboard contract was the only one that could not see it.
> Naming the keys *is* the "a keyboard is involved" message, without asserting anything about
> the hardware that the browser cannot actually determine.
>
> Discoverability was the deciding argument: a gate that hides a feature from the people
> looking for it costs more than the unusable text field it avoids.

*Original design, kept for the record:*

The auto-label is not always enough: two favorites in the same city produce two identical rows
(`Montréal, Québec` twice — §6.1 only blocks a duplicate at the *same rounded point*), a point with
no address falls back to a raw coordinate pair, and a personal name ("Chalet") beats an
administrative one.

But a free-text field in front of a keyboard-less 7" touchscreen is the wrong interaction. This
project has **no on-screen keyboard**, and the settings-panel design notes already rejected a
search field partly on that ground.

**Resolution: renaming exists, gated on a non-touch device.** In the Places popover's Edit mode,
each row gains a rename affordance **only when**:

```js
const canRename = isLocal && typeof navigator !== "undefined" && navigator.maxTouchPoints === 0;
```

- `maxTouchPoints === 0` is the project's established touch discriminator — the same one
  `useAutoTabSelector` uses to decide whether a reader is present
  ([`useAutoTabSelector.js:172`](../client/src/hooks/useAutoTabSelector.js), rationale in
  [`auto-forecast-tab-selection-design.md` §6.1](auto-forecast-tab-selection-design.md)). It
  cleanly separates the 7" DSI touchscreen (> 0) from an HDMI monitor or a desktop browser on the
  SSH tunnel (0).
- `isLocal` is required anyway — the write is `localhostOnly`.
- On the kiosk itself the affordance is simply absent; the auto-label stands. Nothing looks broken,
  nothing leads to a keyboard that isn't there.

Interaction: tap rename → the row's label becomes an `<input>` seeded with the current value,
`maxLength={MAX_LABEL_LEN}`; Enter or blur commits, Esc cancels. An empty or whitespace-only commit
**reverts to the previous label** rather than saving an unnamed entry (the server sanitizer drops
label-less entries outright, so an empty save would silently delete the favorite — §7.2).

The example labels used throughout this document (`Chalet — Saint-Donat, QC`,
`Écurie — Saint-Esprit, QC`) are therefore reachable: auto-labelled at pin time on the Pi, renamed
later from a desktop or over the SSH tunnel.

A zero-typing alternative — a row of preset prefix chips (`Maison` · `Chalet` · `Bureau` ·
`Écurie`) tappable at pin time — was considered and **deferred to the ROADMAP**; it would work on
the kiosk itself, but it adds a fixed vocabulary to maintain in three locales for a marginal gain
over rename-from-desktop. It composes on top of this design rather than replacing it.

### 5.2 Places popover — layout

Same `DetailsPopover` shell everywhere, `portal` mode (required: the LayoutPi rail clips
non-portal popovers horizontally). Anchor `triggerRef` to the dock button.

```
┌─ Places ───────────────────────── ✕ ┐
│ ⌂  Montréal, Québec                 │   ← HOME ROW — not a stored favorite
│ ─────────────────────────────────── │
│ ●  Chalet — Saint-Donat, QC         │   ← ● = currently displayed
│    Écurie — Saint-Esprit, QC        │
│    Québec, QC                       │
│                                     │
│                              Edit   │   ← toggles per-row ⌂ / ✎ / ✕ actions
└─────────────────────────────────────┘
```

**The home row** (added 2026-08-10, after the first field question: *"my initial
position was Montréal — should it be in the list?"*). The default location gets
the first row, badged `⌂`, but it is **not** a stored favorite: it is never
written to `favorites` and does not count against the 6-entry cap.

Why a pseudo-row rather than auto-seeding the stored list:

- Auto-seeding would spend 1 of 6 slots on a place already reachable from the
  dock, write to `settings.json` without the user asking, permanently remove
  the empty state (and with it the only text explaining how to pin anything),
  and create a row that silently moves itself whenever the default changes.
- It would also be labelled badly: at boot the reverse geocode has not resolved
  yet, so the stored entry would carry raw coordinates forever.

Without *some* representation, though, the `⌂` badge would only ever render if
the user happened to pin their own default — half the design would be dead
code. The pseudo-row resolves both.

**Label, for free.** On a cold boot `mapGeo` *is* `browserGeo`, so the first
reverse-geocode result already describes home. `AppContext` captures it once
(`homeLabel`) inside the existing `.then` — no extra LocationIQ call, no new
mount effect. It is re-set from the favorite's own label when one is promoted
via `setDefault`, and cleared when coordinates are typed by hand in Settings
(the captured name would then describe the *previous* default — better a
generic `favorites.homeFallback` than confidently naming the wrong city).

**One definition of "home".** `browserGeo` is the single source of truth, for
both the row and the `⌂` badge on stored rows — not `customLat`/`customLon`.
The two agree whenever a default is saved, but `browserGeo` also covers the
never-configured case where the app fell back to IP geolocation. Keying the
badge on the saved pair instead gave the badge and the row two different
meanings in the same popover: a favorite sitting exactly on an IP-derived home
rendered unbadged, directly under the home row it duplicated.

**Duplicate suppression.** When a stored favorite sits on the home coordinates
(same 4-decimal comparison as §6.1), the pseudo-row is not rendered at all —
that favorite already carries the `⌂` badge, and two rows for one place is the
redundant-affordance problem the rail redesign spent a session removing.

> **Amendment 2026-08-16 — the home row is pinnable, and home is always first.** The first
> field report (issue 319) exposed that the pseudo-row had **no edit affordances at all**: its
> auto-label ("Texas") could not be renamed, and the workaround (pin the same coordinates from
> the location popover) was undiscoverable. In Edit mode the home row now carries a **★ pin
> action** (localhost-gated like every write; disabled with the `favorites.full` hint at the
> cap): pinning converts home into a stored favorite, the suppression above hides the
> pseudo-row, the `⌂` badge migrates, and the stored row is renamable/removable through the
> existing flow — one tap, no parallel persistence for a home label. Two supporting changes:
> the stored favorite on home coordinates is **displayed first** (display-only ordering;
> storage keeps insertion order) so pinning home doesn't teleport it to the bottom of the
> list, and the **Edit toggle now renders when the home row is the only content** — keyed on
> `favorites.length` alone, a zero-favorite user (issue 319's exact state) could never reach
> the pin affordance.

> **Amendment 2026-08-17 — the home row also carries a `↺` reset to automatic.** Shown in Edit
> mode only when a manual override is actually stored (both `startingLat` and `startingLon`
> present — otherwise the default is already IP-derived and there is nothing to undo). It
> writes the same empty pair the Settings panel's "Auto" buttons write, so there is one
> storage contract rather than two, and re-derives `browserGeo` from `GET /geolocation`
> immediately — no reload, no reboot.
>
> **Why here, and why not a prompt.** Deleting a favorite deliberately does not clear the
> default (§9) — silently discarding a chosen setting is worse than leaving it — so the
> default can end up an orphan with no labelled favorite behind it. The obvious fix was a
> follow-up prompt after deleting the `⌂`-badged favorite, and the maintainer rejected it for
> the right reason: it pushes **one** outcome when **two** are equally legitimate — reset to
> automatic, or promote a different favorite (the `⌂` action already on every row). Putting
> the reset where "home" is displayed leaves the user choosing between affordances instead of
> answering a leading question, and costs no new state machine.

**Terminology fix shipped alongside.** `resetMapPosition` pans to `browserGeo`
— the *default* position — but its dock tooltip read "Recenter the map on the
**current** position", which is precisely what it does not do (the current
position is wherever the user panned to). Corrected to "home position" in all
three locales; `docs/ui-layout_*.md` had it right all along. The popover's
former "Current position" footer button inherited the same wrong wording and is
now replaced by the home row.

- **Tap a row** → `setMapPosition({ latitude, longitude })`, apply `zoom` if stored, close the
  popover. One tap, no confirmation — it is fully reversible.
- **`●` marker** on the row matching the current `mapGeo` (same coordinate-match rule as §6.1).
- **`⌂` badge** on the row whose coords equal `customLat`/`customLon`.
- **Empty state** (zero favorites): keep the button visible and render a one-line explainer —
  "Open a place on the map, tap its name, then *Pin this place*." A hidden button is an
  undiscoverable feature.
- **Edit mode** reveals `⌂ Set as default` and `✕ Remove` per row — plus `✎ Rename` when the
  non-touch gate of §5.1.1 passes. Explicit buttons, **no swipe
  gesture** — swipe-to-delete collides with map/rail dragging and with the drag-scroll behaviour
  that already produced one investigation (`docs/investigation-drag-scroll-2026-04.md`).
  Deletion mechanics in §5.2.1.
- **Row taps are inert while Edit mode is on.** Navigating away mid-edit would close the popover
  under the user's finger. Edit mode is a modal state of the list: rows stop being navigation
  targets and become edit targets. The `Edit` toggle flips its label to `Done` while armed.
- On a **remote** client, Edit mode is hidden entirely (§7.4) and rows remain tappable — remote
  users can navigate the list, just not mutate it.

### 5.2.1 Deletion — two-tap arm, no undo

Removal is `PATCH /setting` with the whole `favorites` array **minus** the entry. Never
`DELETE /setting`, which drops the entire key.

A single tap must not delete. The house pattern for a destructive-ish touch action already exists —
`RelaunchButton` in `SettingsPanel`
([`SettingsPanel/index.js:1458-1483`](../client/src/components/ambient/SettingsPanel/index.js)):
first tap **arms** and re-labels the control, second tap fires, and the armed state auto-reverts
after `RELAUNCH_CONFIRM_MS = 4000`. Reuse it verbatim, with its own constant:

```js
const REMOVE_CONFIRM_MS = 4000;   // mirrors RELAUNCH_CONFIRM_MS
```

- **Tap 1** — the `✕` becomes a labelled confirm (`favorites.removeConfirm` = "Remove?"), tinted
  with `--c-danger`. Only one row can be armed at a time; arming a second disarms the first.
- **Tap 2 on the same row** — deletes.
- **4 s of inaction, or any other tap** — disarms silently.
- Leaving Edit mode disarms. The `useEffect` that owns the timer must clear it on unmount
  (standing project rule on side-effect cleanup) — the `RelaunchButton` cleanup line is the model.

**No undo toast.** It is the obvious alternative and it is the wrong one here: the toast would have
to render from inside a `portal`-mode popover, and this project has a documented incident where any
ancestor `filter` / `backdrop-filter` / `transform` confines a `position: fixed` toast to its
stacking context (`incident_dock_toast_stacking_context`) — `DetailsPopover` uses
`backdrop-filter`. The two-tap arm gives the same protection with zero new surface, and re-pinning a
deleted favorite costs two taps anyway since it is almost always the place currently displayed.

**Touch-target budget.** The usable popover width on the Pi rail is ~280 px. In Edit mode the row is
`flex`: label with `min-width: 0` + `text-overflow: ellipsis` (the classic flex-truncation trap —
without `min-width: 0` the label refuses to shrink and pushes the buttons off), then right-aligned
`flex: none` action buttons at 44 × 44 each.

- **On the 7"** only two buttons render (`⌂` `✕`) — rename is gated off — so 88 px of actions leave
  ~190 px of label. Comfortable.
- **On desktop / SSH tunnel**, where `✎` appears, the popover is up to 320 px: 132 px of actions,
  ~180 px of label. Also fine.

The three-button crunch therefore never happens on the smallest screen. Worth stating because it is
the reason the rename gate and the layout budget agree by construction rather than by luck.

### 5.3 Styling notes

- Reuse `RailSquareButton` if any square affordance is added to the rail (project guard-rail). The
  popover rows are plain rows, so nothing new is needed there.
- `DetailsPopover` in `portal` mode copies an **explicit whitelist** of palette CSS variables into
  the portal node ([`DetailsPopover/index.js:85-96`](../client/src/components/ambient/DetailsPopover/index.js)).
  If a Places row needs a token outside that list, it must be **added to the whitelist** —
  otherwise it renders unstyled in the portal. This exact trap cost a debugging session on
  `MoonDetailsPopover` (see `incident_moon_glyph_emoji_platform`).
- No `animation: … infinite` anywhere in this feature — standing kiosk rule
  (`incident_infinite_composited_animation_pi_gpu`).
- No `<a href>` to anything external — nothing in this feature points outside the app, so the
  QR-only rule is not engaged.

---

## 6. Data model

```json
"favorites": [
  {
    "id": "fav_1753651200000",
    "label": "Chalet — Saint-Donat, QC",
    "lat": 46.3172,
    "lon": -74.2205,
    "zoom": 9
  }
]
```

| Field | Type | Rule |
|---|---|---|
| `id` | string | Opaque, client-generated, ≤ 64 chars. Used as the React key and the delete handle. **Stable across a rename** — the rename edits `label` only |
| `label` | string | 1..40 chars after trim. Auto-filled at pin time, user-editable from a non-touch client (§5.1.1) |
| `lat` | number | −90..90, **rounded to 4 decimals** |
| `lon` | number | −180..180, **rounded to 4 decimals** |
| ~~`zoom`~~ | — | **Removed 2026-08-17** (Q1 reversed). Selecting a favorite leaves the map zoom alone; the sanitizer rebuilds entries, so a stored zoom is dropped on the next write |

### 6.1 Freezing the coordinates is load-bearing, not cosmetic

The weather proxy caches on the key `type:fieldsHash:lat(4dp):lon(4dp)`
([`proxyCtrl.js:357`](../server/proxyCtrl.js)) with TTLs of 15 min (current) / 30 min (hourly) /
6 h (daily) ([`proxyCtrl.js:148`](../server/proxyCtrl.js)), capped at 512 entries.

Consequence: **if a favorite stores fixed, 4-decimal-rounded coordinates, revisiting it inside the
TTL costs zero upstream calls.** If instead we stored the live map centre — which drifts by metres
on every pan — every single visit would mint a new cache key and cost 3 fresh Tomorrow.io calls.
That is the difference between a free feature and one that eats the C2 headroom.

So: round **at pin time**, and match "is this favorite the current location?" by comparing the
rounded values, not by float equality:

```js
const round4 = (n) => Math.round(n * 1e4) / 1e4;
const sameSpot = (a, b) => round4(a.lat) === round4(b.lat) && round4(a.lon) === round4(b.lon);
```

Cache-footprint check: 6 favorites × 3 timesteps = 18 entries against a 512-entry cap. Negligible.

**Bonus finding, no action needed:** switching location currently fires the weather triplet twice —
once from `setMapPosition` ([`AppContext.js:1522`](../client/src/AppContext.js)) and once from the
polling effect restarting on the new `mapGeo`
([`AppContext.js:1994`](../client/src/AppContext.js), staggered 0/2/4 s). The second set lands
inside the TTL of the first and resolves as cache hits, so the real upstream cost is 3 calls, not
6. Worth knowing before anyone "optimizes" the duplicate away and breaks the stagger.

---

## 7. Server changes

### 7.1 Storage: `settings.json`, not `localStorage`

| Option | Verdict |
|---|---|
| `localStorage` only | Rejected — lost when the kiosk browser profile is reset (which happens on this fleet), invisible to the server, and not covered by any backup |
| **`settings.json` key `favorites`** | **Chosen** — sits next to `startingLat`/`startingLon`, which the feature must write anyway; survives a profile wipe; `PUT /settings` already preserves untouched whitelisted keys ([`settingsCtrl.js:290-299`](../server/settingsCtrl.js)) so a Settings-panel save will not clobber it; writes go through the existing atomic `serializeWrite` + `writeSettingsFile` path |
| Hybrid (both, mirrored) | Rejected — synchronisation complexity for no gain |

No new endpoint. `PATCH /setting` with `{ key: "favorites", val: [...] }` is sufficient, and it is
already `localhostOnly`. Note `setSetting` rejects `val === null`/`undefined` but accepts `[]`, so
"delete the last favorite" works.

### 7.2 Whitelist + value sanitizer

Add `"favorites"` to `ALLOWED_KEYS` ([`settingsCtrl.js:37`](../server/settingsCtrl.js)).

`sanitizeSettings` today filters **keys** but never inspects **values**, so whitelisting alone
would let a malformed (or hostile) local client write `"favorites": "garbage"` — which the client
would then have to defend against on every read. Add a generic, one-entry value-sanitizer table so
the guarantee lives in one place and covers PATCH, PUT and POST at once:

```js
// server/settingsCtrl.js
const MAX_FAVORITES = 6;          // server-side ceiling, mirrors the client constant
const MAX_LABEL_LEN = 40;

// Same rounding the client applies at pin time — see §6.1. Enforced here too
// so a hand-edited settings.json can't defeat the cache-key contract.
const round4 = (n) => Math.round(n * 1e4) / 1e4;

function sanitizeFavorites(val) {
  if (!Array.isArray(val)) return [];
  const out = [];
  for (const f of val) {
    if (!f || typeof f !== "object") continue;
    const lat = Number(f.lat);
    const lon = Number(f.lon);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) continue;
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) continue;
    const label = typeof f.label === "string" ? f.label.trim().slice(0, MAX_LABEL_LEN) : "";
    if (!label) continue;
    const id = typeof f.id === "string" && f.id ? f.id.slice(0, 64) : `fav_${out.length}`;
    const entry = { id, label, lat: round4(lat), lon: round4(lon) };
    const zoom = Number(f.zoom);
    if (Number.isInteger(zoom) && zoom >= 1 && zoom <= 18) entry.zoom = zoom;
    out.push(entry);
    if (out.length >= MAX_FAVORITES) break;
  }
  return out;
}

const VALUE_SANITIZERS = { favorites: sanitizeFavorites };
```

…applied inside `sanitizeSettings` ([`settingsCtrl.js:67`](../server/settingsCtrl.js)):

```js
.map(([k, v]) => [k, VALUE_SANITIZERS[k] ? VALUE_SANITIZERS[k](v) : v])
```

Because `maskForRemote` projects through `sanitizeSettings` first, this also hardens the **read**
path: a hand-edited or corrupted `favorites` array can never reach a client verbatim. Truncating at
`MAX_FAVORITES` server-side means the cap is enforced even if a future client forgets it.

### 7.3 Remote masking

`favorites` is **not** added to `API_KEY_FIELDS` or `REMOTE_HIDDEN_KEYS`, so it passes through to
remote clients — the same exposure `startingLat`/`startingLon` already have. This is a deliberate
call, not an oversight: it keeps the Places list readable over the SSH tunnel and over a LAN
client, which is the documented remote workflow. It does widen the exposure from one coordinate
pair to up to seven. See **Q2** in §12 if you want the stricter variant.

Whatever is decided, [`docs/security-hardening.md`](security-hardening.md) gets one line stating it,
alongside the existing note on what `maskForRemote` does and does not hide.

### 7.4 Write gating

Writes go through `PATCH /setting`, already `localhostOnly` — the same gate that protects
`startingLat`/`startingLon` today. A LAN client reads the list and can navigate it; it cannot pin,
delete, or promote to default. The client hides the Edit affordances on `!isLocal`
([`AppContext.js:718`](../client/src/AppContext.js)) so a remote user never sees a button that
would 403. Server-side enforcement remains the real boundary; the client gate is only cosmetic.

### 7.5 `docs/api.md`

`PATCH /setting` gains `favorites` in its allowed-keys list, with the entry shape and the
`MAX_FAVORITES` truncation rule documented, plus a note that malformed entries are dropped rather
than rejected wholesale.

---

## 8. Client changes

### 8.1 New hook — `client/src/hooks/useFavoriteLocations.js`

Modelled on `useDismissedAlerts` (bounded list + defensive parse + cross-component sync), but
backed by `settings.json` instead of `localStorage`.

```js
/**
 * @returns {{
 *   favorites: Array<{id: string, label: string, lat: number, lon: number, zoom?: number}>,
 *   canPin: boolean,
 *   isPinned: (coords: {latitude: number, longitude: number}) => boolean,
 *   pin: (entry: {label: string, lat: number, lon: number, zoom?: number}) => Promise<void>,
 *   remove: (id: string) => Promise<void>,
 *   rename: (id: string, label: string) => Promise<void>,
 *   setDefault: (id: string) => Promise<void>,
 *   canRename: boolean,
 *   maxFavorites: number
 * }}
 */
```

- Seeded from the `GET /settings` read that already happens at boot — **no extra request**. The
  existing `getCustomLatLon` ([`AppContext.js:1079`](../client/src/AppContext.js)) reads the same
  response; extend that read rather than adding a second one.
- Every mutation: optimistic state update → `PATCH /setting` → on failure, roll back and surface a
  dock toast (`toasts.favoriteSaveFailed`). A silent failure on a kiosk is worse than a visible
  one.
- `setDefault(id)` does **three** things (see §8.2 — the third is the non-obvious one):
  1. `PATCH startingLat` / `startingLon`
  2. `setCustomLat` / `setCustomLon` in context, so Settings reflects it immediately
  3. `setBrowserGeo({ latitude, longitude })`
- `rename(id, label)` trims, truncates to `MAX_LABEL_LEN`, and **no-ops on an empty result** rather
  than writing a label-less entry the server sanitizer would then drop (§5.1.1).
- ~~`canRename`~~ **removed 2026-08-17** along with the hook's `isLocal` option, which existed
  only to feed it. Rename is offered on every local client; the consumer gates Edit mode on
  `isLocal` where it renders, and the server enforces the real boundary. See §5.1.1.

### 8.2 The `browserGeo` trap — read this before implementing

`browserGeo` is written **only at boot**, at
[`AppContext.js:1219`](../client/src/AppContext.js) and
[`:1229`](../client/src/AppContext.js). Nothing else ever updates it.

`resetMapPosition` ([`AppContext.js:1533`](../client/src/AppContext.js)) — the dock's **Recenter**
button — pans to `browserGeo`.

So today, if you change the default coordinates in Settings and then press Recenter, you go back to
the **old** default until the page reloads. Nobody has noticed because changing lat/lon by hand in
Settings is rare and usually followed by a reload. A one-tap "Set as default" makes that stale
pointer trivially reproducible, and it will read as a bug.

**Therefore `setDefault()` must also call `setBrowserGeo(coords)`.** `setBrowserGeo` is currently
local to the provider and not exported on any slice — expose it through the actions slice, or
(cleaner) implement `setDefault` inside `AppContext` where both setters are in scope and export
only the finished action.

The same fix should be applied to `saveSettingsToJson`
([`AppContext.js:1593`](../client/src/AppContext.js)) so the hand-edited path stops being stale
too. That is a two-line rider, in scope for lot 2.

### 8.3 Context wiring

`favorites` and its actions are needed by `LocationDetailsPopover` (used from both `HeroBand` and
`HeroCompact`) **and** by `ControlButtons` — three unrelated consumers, which clears the
CLAUDE.md bar for promoting state out of local component state.

Follow the `useUiPreferences` precedent: the hook is called once in `AppContext`, and its return
value is spread into the **`locationSlice`** ([`AppContext.js:2406`](../client/src/AppContext.js)),
which already carries `mapGeo`, `browserGeo`, `customLat`, `customLon` and `reverseGeoResult` —
exactly the neighbours this data belongs with. Add the new fields to both the object literal and
the dependency array.

`AppContext.js` does not grow by more than the hook call plus the slice fields — consistent with
the post-audit direction of not letting that file expand.

### 8.4 Component changes

| File | Change |
|---|---|
| `hooks/useFavoriteLocations.js` | **New.** §8.1 |
| `ambient/LocationDetailsPopover/index.js` | Append the pin action + its three states (§5.1). New props: none — it reads the hook via context |
| `ambient/LocationDetailsPopover/styles.css` | Hairline separator + action row (44 px hit area) |
| `ambient/PlacesPopover/` | **New** component + CSS: the list, the "Current position" row, empty state, Edit mode, inline rename input (non-touch only) |
| `ambient/ControlButtons/index.js` | New `btnPlaces` after `btnRecenter` ([`:289`](../client/src/components/ambient/ControlButtons/index.js)); render it in the Map group ([`:737`](../client/src/components/ambient/ControlButtons/index.js)); mount `PlacesPopover` with `triggerRef` + `portal`; `notify()` toast on select |
| `AppContext.js` | Call the hook; extend `locationSlice`; implement `setDefault` (incl. `setBrowserGeo`); rider fix in `saveSettingsToJson` |
| `i18n/locales/{en,fr,es}.json` | New `favorites.*` + `controls.openPlaces` + toasts (§10) |
| `server/settingsCtrl.js` | `ALLOWED_KEYS` + `sanitizeFavorites` + `VALUE_SANITIZERS` (§7.2) |
| `test/favorites.test.js` | **New.** §11 |
| `docs/api.md`, `docs/security-hardening.md`, `docs/ui-layout_{en,fr}.md`, `CHANGELOG.md` | Documentation hygiene |

Every new component needs a complete JSDoc block (`@param` / `@returns`) and declared PropTypes.

### 8.5 Icon

`btnPlaces` needs a Carbon icon (the dock was unified on `@iconify/icons-carbon` in v2.14.71; the
single documented exception is the AI sparkle). All four candidates were verified present in the
installed `@iconify/icons-carbon`: `bookmark`, `star`, `location-star`, `favorite`.

Recommendation: **`carbon/bookmark`**. `location-star` is semantically the closest ("a location
that is a favorite") but it draws a map pin, and `location` / `location-filled` are already the
marker-visibility toggle two buttons away in the same group — two pin glyphs side by side would
read as one control with two states.

### 8.6 React 19 constraints (added 2026-08-10)

The client moved to React 19 + react-leaflet 5 after this design was written (PR 314, `7dd40c2`).
Nothing here was invalidated — `DetailsPopover`'s API is unchanged (`open` / `onClose` / `title` /
`anchor` / `triggerRef` / `portal` / `children`, same defaults, merely relocated into the
signature), `PanHandler` still drives the pan
([`WeatherMap/index.js:262`](../client/src/components/WeatherMap/index.js)), and the migration notes
record that `@react-leaflet/core` v3 diffs by reference exactly like v2. But four rules now bind
this feature's implementation.

**1. No `defaultProps` — and the empty list needs a frozen constant.** `X.defaultProps = {…}` is
silently ignored by the automatic JSX runtime; `test/react19Guards.test.js` fails the suite on any
reappearance. Use destructuring defaults. The non-obvious half applies directly here: **`favorites`
is an array**, and a bare `= []` allocates a fresh reference on every render. That is the exact
`NO_ALERTS` lesson from `WeatherMap`, and here it would be worse than a busted child memo —
`favorites` is a dependency of `locationSlice`'s `useMemo` (§8.3), so a fresh array per render
would mint a new context value on **every** `AppContext` render and re-render every location
consumer in the tree, on a 1 GB Pi 3, forever.

```js
// client/src/hooks/useFavoriteLocations.js
const NO_FAVORITES = Object.freeze([]);   // mirrors NO_ALERTS in WeatherMap/index.js
```

The hook must return `NO_FAVORITES` — not `[]` — for the empty case, including the pre-settings-load
window and every defensive parse failure.

**2. PropTypes no longer validate at runtime.** They stay mandatory (`react/prop-types` is a build
error, and they document the API), but React 19 runs no `propTypes` check on function components,
so no console warning will ever fire for a malformed favorite. **The server-side
`sanitizeFavorites` of §7.2 is therefore the only real validation in the system.** Anyone tempted
to thin it out on the grounds that "the client already shapes the data" should read this paragraph
first.

**3. If `PlacesPopover` ever animates, it must not reach for `react-transition-group` casually.**
Under React 19 a consumer without `nodeRef` falls back to the removed `findDOMNode`; the throw
unmounts the whole root — blank kiosk, no error boundary above `App`. `UpdateModal` is currently
the *only* consumer in the tree and it was fixed during the migration. Prefer a plain CSS
transition here and keep it that way; if react-transition-group is genuinely needed, `nodeRef` is
mandatory and the guard test enforces it.

**4. Write the hook React-Compiler-ready.** Compiler adoption is now an active ROADMAP item, and
its stated precondition is that components be rule-compliant — the existing `set-state-in-effect`
cluster is the debt being paid down. Do not add to it: seed `favorites` from the settings response
on the **existing** load path (the same `.then` that already calls `setCustomLat` /
`setCustomLon`), rather than adding a fresh `useEffect(() => setFavorites(…), [])`. Same result,
one fewer site for the compiler-readiness pass to revisit.

> Deliberately **not** using React 19's `useOptimistic` for the optimistic-write pattern of §8.1.
> It is built around form Actions and transitions, neither of which this codebase uses; plain state
> plus an explicit rollback is smaller, and it keeps the failure path (§8.1's toast) obvious.

---

## 9. Interactions and edge cases

| Case | Behaviour |
|---|---|
| Selecting a favorite | `setMapPosition()` + optional zoom + close popover. All downstream data (alerts, AQ, pollen, radar risk, AI summary) follows `mapGeo` automatically |
| **Sense HAT follows** | The kiosk pushes the viewed coords to `POST /api/kiosk-location`, which `GET /api/sensehat` consumes — so switching city also changes what the LED matrix displays. Expected, but it belongs in the CHANGELOG line |
| Default entry deleted | Allowed, and it still takes the two taps of §5.2.1. `startingLat`/`startingLon` are *not* cleared — the default coordinates survive as a bare coordinate pair, exactly as if they had been typed in Settings. Only the labelled shortcut disappears, so **Recenter keeps working unchanged**. The `⌂` pseudo-row reappears in its place (nothing is pinned on those coordinates any more), so the default stays visible. **Amendment 2026-08-17 — the way out is now on that row:** see §5.2's reset action. Field report: with every favorite deleted, the kiosk kept booting at a place nothing explained, and recovering meant knowing to go to Settings → Latitude/Longitude → Auto → save → reload |
| Last favorite deleted | The array becomes `[]`. `PATCH /setting` accepts an empty array (it rejects `null`/`undefined`, not `[]`), and the popover falls back to the empty-state explainer of §5.2 |
| Delete armed, then the list changes underneath | Arming is keyed on the entry `id`; if that id is gone on the second tap (concurrent edit from another client), the delete is a no-op rather than an off-by-one deletion of the row that shifted into place |
| Two favorites at the same rounded spot | Prevented at pin time: if `sameSpot()` matches an existing entry, the popover shows "Pinned" instead of the pin button |
| Remote client | Reads the list, taps to navigate. Edit mode hidden; server rejects writes regardless |
| Zero favorites | Button visible, popover shows the explainer (§5.2) |
| Screen saver / sleep mode | No interaction — location changes do not touch idle detection |
| v3.3 priority views (7") | No new rail state. The popover portals over whatever view is active; `piLayoutState` is untouched |
| Corrupt `favorites` in `settings.json` | `sanitizeFavorites` drops bad entries on both read and write; worst case the user sees a shorter list, never a crash |
| Rapid switching | Each cold location costs ~3 Tomorrow.io calls; warm ones are free (§6.1). No auto-cycling, no carousel — deliberate |

---

## 10. i18n

All strings are **kiosk-visible**, so they go in the locale files. The `lbl()` inline-trilingual
helper is **not** permitted here — its codified exception covers `SettingsPanel` and `DebugPanel`
only.

> **As-shipped deviations (recorded 2026-08-17).** The table below is the original spec; four
> rows shipped differently, deliberately:
>
> - `toasts.favoriteAdded` — **never created.** Pin feedback is the button flipping to
>   "Pinned" in place, which is in-context; a toast fired from inside the `DetailsPopover`
>   shell would sit in the documented `backdrop-filter` stacking-context trap — the same
>   reasoning §5.2.1 applies to the remove-undo toast.
> - `toasts.favoriteSaveFailed` — **replaced by the inline `favorites.saveFailed` error**
>   rendered inside the popovers (same trap; and the error belongs beside the action that
>   failed).
> - `favorites.currentPosition` — **removed in PR 316**: the "Current position" footer button
>   became the `⌂` home row, whose fallback label is `favorites.homeFallback`.
> - `favorites.isDefault` — **removed in PR 324** (dead key: the `⌂` badge is `aria-hidden`
>   inside a button that already carries the label). `favorites.renameHint` is wired as the
>   rename input's Enter/Esc tooltip since the same PR.

New namespace `favorites.*` plus two `controls.*` and two `toasts.*` keys:

| Key | EN | FR | ES |
|---|---|---|---|
| `favorites.title` | Places | Lieux | Lugares |
| `favorites.pin` | Pin this place | Épingler ce lieu | Anclar este lugar |
| `favorites.pinned` | Pinned | Épinglé | Anclado |
| `favorites.full` | List full — remove one first | Liste pleine — retirez-en un | Lista llena — quite uno |
| `favorites.currentPosition` | Current position | Position actuelle | Posición actual |
| `favorites.setDefault` | Set as default | Définir par défaut | Definir por defecto |
| `favorites.isDefault` | Default | Par défaut | Por defecto |
| `favorites.remove` | Remove | Retirer | Quitar |
| `favorites.removeConfirm` | Remove? | Retirer ? | ¿Quitar? |
| `favorites.rename` | Rename | Renommer | Renombrar |
| `favorites.renameHint` | Enter to save, Esc to cancel | Entrée pour enregistrer, Échap pour annuler | Intro para guardar, Esc para cancelar |
| `favorites.edit` | Edit | Modifier | Modificar |
| `favorites.done` | Done | Terminé | Hecho |
| `favorites.empty` | Open a place on the map, tap its name, then "Pin this place". | Ouvrez un lieu sur la carte, touchez son nom, puis « Épingler ce lieu ». | Abra un lugar en el mapa, toque su nombre y luego «Anclar este lugar». |
| `favorites.remoteReadOnly` | Editing requires local access. | La modification exige un accès local. | La edición requiere acceso local. |
| `controls.openPlaces` | Open places | Ouvrir les lieux | Abrir lugares |
| `controls.closePlaces` | Close places | Fermer les lieux | Cerrar lugares |
| `toasts.favoriteAdded` | Place pinned | Lieu épinglé | Lugar anclado |
| `toasts.favoriteDefaultSet` | Default location updated | Emplacement par défaut mis à jour | Ubicación por defecto actualizada |
| `toasts.favoriteSaveFailed` | Could not save — check the connection | Enregistrement impossible — vérifiez la connexion | No se pudo guardar — revise la conexión |

After touching the locale files, regenerate the glossary — **never hand-edit it**:

```bash
node tools/gen-localization-glossary.js
```

---

## 11. Tests

`test/favorites.test.js`, using the built-in `node --test` runner and the `__test` export pattern:

1. `sanitizeFavorites` drops non-arrays → `[]`
2. drops entries with non-finite / out-of-range lat or lon
3. drops entries with an empty or non-string label; trims and truncates at 40 chars
4. rounds lat/lon to 4 decimals (the cache-key contract of §6.1 — this is the regression that
   matters most)
5. truncates at `MAX_FAVORITES`, preserving order
6. omits `zoom` when absent or out of 1..18; keeps valid integers
7. `sanitizeSettings` runs the sanitizer on both write and read paths
8. `maskForRemote` still returns `favorites` (or does not, per **Q2**) — pin whichever decision is
   taken so a future refactor cannot silently flip it
9. `replaceSettings`-style merge preserves `favorites` when the body omits it (guards the
   Settings-panel-save-wipes-favorites class of bug that already bit `advanced` and
   `indoorTemperature`)

Client-side there is still no test harness (tech-debt D2), so the client behaviour is covered by
the field test in §14 — **with two exceptions that are already mechanically enforced**:
`test/react19Guards.test.js` walks all of `client/src` and will fail the suite if the new
components introduce a `defaultProps` assignment or a `react-transition-group` consumer without
`nodeRef` (§8.6). Both are silent at build time, so the test is the only signal.

Baseline to beat: **567/567 green at HEAD `011afc8`** (verified 2026-08-10). Run `npm test` before
pushing.

---

## 12. Open questions for the maintainer — all resolved

| # | Question | Resolution |
|---|---|---|
| **Q1** | Store the **map zoom** per favorite? A cottage wants a tight zoom, a region a wide one. | ❌ **No — reversed 2026-08-17 after one evening of real use.** Shipped half in PR 315, completed in PR 320, removed the same week. Two independent reasons, either sufficient: the zoom at pin time is an artefact of the *pinning* gesture (you zoom **in** to place the pin precisely), not a viewing preference — restoring it fought the user, who works at one scale and jumps between places at that scale. And applying a zoom right after a pan visibly **drifted the marker**: `panWithRailOffset` puts the map's true centre north-east of the marker by a fixed *pixel* amount so the marker lands at the visual centre of the rail-uncovered area, but `map.setZoom` holds that true centre while pixels-per-degree changes underneath it — so the marker slid by an amount depending on the zoom you started from (`ZoomAnchorOffset` patches `zoomIn`/`zoomOut`, not `setZoom`). Selecting a favorite now pans and leaves zoom alone. The field is gone from the schema; entries stored with one shed it on the next write |
| **Q2** | Is `favorites` **visible to remote clients** in `GET /settings`? | ✅ **Yes, unmasked** — consistent with `startingLat`/`startingLon`, and needed for the SSH-tunnel workflow. Pinned by a dedicated test so a refactor cannot silently flip it; the exposure is recorded in [`docs/security-hardening.md`](security-hardening.md) |
| **Q3** | Dock icon | ✅ `carbon/bookmark`, as recommended — it resolves, and it avoids the two-map-pin confusion with the marker toggle two buttons away (§8.5) |
| **Q4** | Show the dock button when the list is **empty**? | ✅ **Yes, with the explainer.** Since PR 316 the popover is never truly empty either — the `⌂` home row renders whenever coordinates exist |
| **Q5** | Is **rename** needed in v1? | ✅ **Yes** (resolved 2026-07-27; shipped in PR 315) — but the non-touch gate it came with was **removed 2026-08-17**. `maxTouchPoints === 0` answers "is a toucher present", not "can the user type", and the browser cannot answer the latter; every replacement was another proxy. Rename is now offered on any local client, with its Enter/Esc contract stated inline. Full reasoning, including the two rejected replacements and why the failure mode is benign, in the §5.1.1 amendment |

---

## 13. Out of scope (candidate phase 2)

- **Forward geocoding / search box.** LocationIQ's `search.php` works with the
  `reverseGeoApiKey` already configured, so it is cheap to add server-side — but typing on a 7"
  touchscreen with no keyboard is the wrong interaction, and it adds a proxy endpoint, a rate-limit
  bucket and a quota line. It would mainly serve desktop / SSH-tunnel users. Not a prerequisite.
- **Preset prefix chips at pin time** (`Maison` · `Chalet` · `Bureau` · `Écurie` · `—`) — the
  zero-typing labelling variant, the only one that works **on the kiosk itself**. Deferred in favour
  of the non-touch rename of §5.1.1 because it adds a fixed vocabulary to maintain in three locales.
  Tracked in `ROADMAP.md`; it composes on top of v1 rather than replacing anything.
- **Reordering** the list. With a 6-entry cap, insertion order is fine.
- **Per-favorite unit or palette overrides.** No signal that anyone wants this.
- **Fleet-wide shared favorites.** Each Pi is a different site; per-Pi lists are correct.

---

## 14. Rollout

| Lot | Contents | Effort |
|---|---|---|
| **1** | `favorites` in `ALLOWED_KEYS` + `sanitizeFavorites` + tests · `useFavoriteLocations` · pin action in `LocationDetailsPopover` · `btnPlaces` + `PlacesPopover` · select → `setMapPosition` | ~½ day |
| **2** | `⌂ Set as default` + `⌂` badge + localhost gate · **the `setBrowserGeo` fix** (§8.2) incl. the `saveSettingsToJson` rider · inline rename behind the non-touch gate (§5.1.1) | ~3 h |
| **3** | i18n EN/FR/ES + glossary regeneration · `docs/api.md` · `docs/security-hardening.md` line · `docs/ui-layout_{en,fr}.md` · `CHANGELOG.md` | ~2 h |

**Build gate:** `cd client && npm run prod` with zero errors, plus `npm test` green.

> **Field-test record — run 2026-08-16, after the fleet rather than before it.** v3.2.0 shipped
> with browser-only verification (both PR messages say so), and the gate below sat unexecuted
> until a maintainer field session ran it organically on the real kiosk plus the SSH tunnel.
>
> **Pass: 1, 3, 4, 5, 5b, 5c, 6, 7.** Criterion 5b was checked on *both* halves — no `✎` on the
> touchscreen, `✎` present on a Mac over the tunnel — which matters because an always-off gate
> is indistinguishable from a working one. Criterion 7 was verified from `server.log`: identical
> 4-decimal cache keys across visits, a `daily` HIT on return, TTLs 900 / 1798 / 21597 s — the
> §6.1 contract end to end.
>
> **Fail: criterion 2**, instructively. Its premise was wrong (the popover portals outside the
> rail's font-size zoom, so font L never bound this surface) and the real ceiling was the shell's
> 420 px portal cap, under which the home row added by PR 316 clipped the footer by 13 px at
> ⌂ + 6 rows. Fixed by the viewport-fit height in PR 324 — which then introduced its own
> collapse on bottom-anchored triggers, fixed in PR 328 and verified in-browser at 1280×800 and
> 800×480. See the §4 amendment.
>
> **Two lessons worth carrying to the next feature.** A field-test gate that ships without being
> run decays into documentation: schedule it as a work item, not a hope. And an acceptance
> criterion can encode a wrong premise — "6 entries at font size L" was unfalsifiable on a
> surface font size never touched, so passing or failing it would have taught us nothing about
> the real constraint.

**Field test on the real 7" before the fleet** — acceptance criteria:

1. Pin from the hero popover at font size **L**; the popover does not overflow the rail.
2. Places popover shows 6 entries with no scrolling at font size L.
3. Tapping a row switches the location; hero, metrics, alerts, AQ and radar all follow.
4. Set-as-default, then **Recenter** returns to the new default **without a reload** (this is the
   §8.2 regression test — it will fail if the `setBrowserGeo` call is missed).
5. Pin is disabled at 6 entries with the "list full" copy.
5b. Edit mode on the 7" shows `⌂` and `✕` but **no** `✎ Rename` — and the same build over the SSH
   tunnel from the desktop *does* show it. (This is the §5.1.1 gate; both halves must be checked,
   since a gate that is always-off looks identical to a gate that works.)
5c. One tap on `✕` does **not** delete: it arms and re-labels. Wait 4 s → disarms. Tap twice → the
   favorite is gone and stays gone after a reload (i.e. the PATCH landed, not just local state).
   Also confirm a row tap does nothing while Edit mode is on.
6. Every touch target is comfortable at arm's length — no mis-taps on the pin action landing on the
   popover close button.
7. Switch back and forth between two favorites within 15 min and confirm cache hits in
   `~/.local/state/pi-weather-station/server.log` (`[cache] HIT current:…`) — this validates §6.1
   end to end.

**PR, not a direct push to master.** This adds a `settings.json` field and touches shared
components across every layout — it is squarely in "coordination multi-Pi" territory by the
project's own blast-radius rule.
