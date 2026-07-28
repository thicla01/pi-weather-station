# Favorite Locations — Low-Level Design

**Status:** Design — implementation-ready except for the open questions in §12 (**Q5 resolved
2026-07-27**: rename ships in v1, gated on non-touch — see §5.1.1).
**Date:** 2026-07-27
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

`noData` case: if there is no reverse-geocode payload, fall back to the formatted coordinates as
the label so pinning still works over a lake or a field.

### 5.1.1 Rename — gated on non-touch (Q5 resolved 2026-07-27)

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
│ ⌂  Home — Sainte-Julie, QC          │   ← default entry, ⌂ badge
│ ●  Chalet — Saint-Donat, QC         │   ← ● = currently displayed
│    Écurie — Saint-Esprit, QC        │
│    Québec, QC                       │
│ ─────────────────────────────────── │
│ Current position                    │   ← always present, = resetMapPosition()
│                                     │
│ Edit                                │   ← toggles per-row ⌂ / ✕ actions
└─────────────────────────────────────┘
```

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
| `zoom` | number \| absent | Integer 1..18 (the app's zoom ceiling was raised to 18 in the 2026-06 audit). Optional — see Q1 |

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
pair to up to six. See **Q2** in §12 if you want the stricter variant.

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
- `canRename` is the `isLocal && navigator.maxTouchPoints === 0` gate of §5.1.1, computed once in
  the hook so no consumer re-derives it (and so a future "unattended display" override has one
  place to land).

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

---

## 9. Interactions and edge cases

| Case | Behaviour |
|---|---|
| Selecting a favorite | `setMapPosition()` + optional zoom + close popover. All downstream data (alerts, AQ, pollen, radar risk, AI summary) follows `mapGeo` automatically |
| **Sense HAT follows** | The kiosk pushes the viewed coords to `POST /api/kiosk-location`, which `GET /api/sensehat` consumes — so switching city also changes what the LED matrix displays. Expected, but it belongs in the CHANGELOG line |
| Default entry deleted | Allowed, and it still takes the two taps of §5.2.1. `startingLat`/`startingLon` are *not* cleared — the default coordinates survive as a bare coordinate pair, exactly as if they had been typed in Settings. Only the labelled shortcut disappears, so **Recenter keeps working unchanged** |
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
the field test in §14.

Run `npm test` before pushing.

---

## 12. Open questions for the maintainer

| # | Question | Recommendation |
|---|---|---|
| **Q1** | Store the **map zoom** per favorite? A cottage wants a tight zoom, a region a wide one. | **Yes**, optional field. Cost is ~5 lines; without it every jump lands on whatever zoom you happened to be at |
| **Q2** | Is `favorites` **visible to remote clients** in `GET /settings`? | **Yes** — consistent with `startingLat`/`startingLon` today, and needed for the SSH-tunnel workflow. If the 6-coordinates-instead-of-1 exposure bothers you, add it to `REMOTE_HIDDEN_KEYS`; the cost is that the remote Places list renders empty |
| **Q3** | Dock icon | `carbon/bookmark` (verify it resolves, §8.5) |
| **Q4** | Show the dock button when the list is **empty**? | **Yes**, with the explainer. Hiding it makes the feature undiscoverable |
| **Q5** | Is **rename** needed in v1? | ✅ **RESOLVED 2026-07-27 — yes, gated on non-touch** (`isLocal && navigator.maxTouchPoints === 0`). Full design in §5.1.1. The zero-typing preset-chip variant goes to the ROADMAP instead of v1 |

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
