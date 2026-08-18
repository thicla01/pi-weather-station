# Favorite Locations — Design of Record

**Status:** SHIPPED and in production on the fleet. This is an as-built description of the
feature, replacing the 2026-07-27 pre-implementation LLD and the eight dated amendments that
accumulated on top of it during the 2026-08-16/17 field cycle. The original document is
recoverable at `git show ee4df8b:docs/favorite-locations-design.md`.
**Audience:** whoever changes this code next. Dev-facing, English only.
**Scope:** the v3 ambient tree (all layouts), the `favorites` key in `settings.json`, one
value-level sanitizer on the server. No external service, no API key.

**Start here.**

| You are… | Read |
|---|---|
| changing this code | §2 Invariants, then §6 Client architecture / §5 Server |
| asking "why is it like this?" | §10 Decision record |
| debugging a field report | §11 Trap index — symptom to cause |

**Where the old sections went.** The outline was renumbered because the old one was
pre-implementation by construction — "Out of scope" and "Rollout" as top-level sections,
capacity buried at §4 under two stacked amendments. Live citations in code and sibling docs were
updated in the same change; this table covers the frozen ones in `CHANGELOG.md`, which is the
project's version-history source of truth and is not edited retroactively.

| Old | New |
|---|---|
| §2, §3 affordance + dock placement | §7.6 |
| §4 Capacity | §3 |
| §5.1 Pin action · §5.1.1 Rename | §7.1 · §7.3 |
| §5.2 Places popover · §5.2.1 Deletion | §7.2 · §7.4 (layout half → §8) |
| §5.3 Styling | §7.7 |
| §6 Data model · §6.1 Coordinate freezing | §4 · §4.2 |
| §7.1 Storage · §7.2 Sanitizer · §7.3 Masking · §7.4 Gating | §4.1 · §5.1 · §5.4 · §5.5 |
| §8.1 Hook · §8.2 browserGeo · §8.3 Context · §8.6 React 19 | §6.1 · §6.3 · §6.2 · §6.4 |
| §9 Edge cases | §2 and §11 |
| §10 i18n · §11 Tests · §12 Q1–Q5 | §9 · §12 · §10 |
| §13 Out of scope · §14 Rollout + field test | §13 · §12 and §14 |

Cite sections by number **and** title from now on ("§5 Server — the sanitizer"), so the next
renumbering degrades to a searchable string rather than a dead pointer.

---

## 1. What shipped

A short list of saved places, stored server-side, reachable in one tap from the dock. Five
gestures:

| Gesture | Where | Effect |
|---|---|---|
| **Create** | `★ Pin this place` in `LocationDetailsPopover` (the city-name popover) | Appends the current `mapGeo`, rounded (§4.2), label auto-filled from the reverse geocode |
| **Pick** | **Places** dock button (Map group) → `PlacesPopover` | Tap a row → `setMapPosition()`; everything downstream follows |
| **Promote** | `⌂` on a row, Edit mode | Writes `startingLat`/`startingLon`; that row gets the `⌂` badge |
| **Pin home** | `★` on the `⌂` home row, Edit mode | Converts the default into a stored favorite — which makes it renamable |
| **Reset to automatic** | `↺` on the `⌂` home row, Edit mode | Clears the override, re-derives home from IP geolocation immediately |

```
┌─ PLACES ────────────────────────── ✕ ┐
│ ⌂  Montréal, Québec          ★   ↺  │  ← home; pseudo-row, or a badged favorite
│ ─────────────────────────────────── │     ★ pin it · ↺ back to automatic
│ ●  Chalet — Saint-Donat      ⌂ ✎ ✕  │  ← ● = currently displayed
│    Écurie — Saint-Esprit     ⌂ ✎ ✕  │     ⌂ set as default · ✎ rename · ✕ remove
│    Québec, QC                ⌂ ✎ ✕  │
│                            Done     │
└─────────────────────────────────────┘
```

**The row budget is the capacity rule** (§3): `rows = favorites.length + (home pinned ? 0 : 1) ≤ 7`.

**Two exclusive modes.** In navigate mode a row is a jump target. In Edit mode rows stop being
jump targets and become edit targets — navigating away mid-edit would close the popover under the
user's finger. The toggle flips Edit ↔ Done. Edit is hidden entirely on a remote client.

**Selecting a place propagates by itself.** Everything keys off `mapGeo` by effect — reverse
geocode, gov alerts, nearby alerts, air quality, pollen, radar risk, the AI summary — and the
kiosk pushes the viewed coordinates to `POST /api/kiosk-location`, which `GET /api/sensehat`
consumes, so switching city also changes what the LED matrix displays. A favorite only has to
call `setMapPosition(coords)`.

**There is no forward geocoding.** Only `GET /api/reverse-geocode` exists; LocationIQ's
`search.php` is not proxied. So this pins *the place you are already looking at* — which is also
the right gesture on a 7" touchscreen with no keyboard (§13).

**Implementation files.**

| File | Role |
|---|---|
| `client/src/hooks/useFavoriteLocations.js` | The list and its CRUD; the row budget; optimistic writes |
| `client/src/components/ambient/PlacesPopover/` | The picker: list, home row, Edit mode |
| `client/src/components/ambient/LocationDetailsPopover/index.js` | The pin action and its three states |
| `client/src/components/ambient/DetailsPopover/index.js` | The shared popover shell: portal, `fitViewport` |
| `client/src/ui/placeLabel.js` | Reverse-geocode → human label, shared by three surfaces |
| `client/src/AppContext.js` | `locationSlice`; the actions that touch geo state |
| `server/settingsCtrl.js` | `ALLOWED_KEYS`, `sanitizeFavorites`, the sanitizer seams |
| `test/favorites.test.js`, `test/placeLabel.test.js` | 21 + 12 assertions (§12) |

---

## 2. Invariants — the contracts a change must not break

Each states where it is enforced and whether a test pins it. "Not pinned" means the only thing
standing between you and a regression is this list.

| # | Invariant | Enforced at | Pinned by |
|---|---|---|---|
| **INV-1** | Coordinates are stored `round4` on **both** sides. A cache-key contract, not cosmetics (§4.2) | `useFavoriteLocations.js` `round4`; `settingsCtrl.js` `round4` | `favorites.test.js` |
| **INV-2** | `sanitizeValue` runs on **both** `sanitizeSettings` *and* `setSetting` — PATCH never calls the former (§5.1) | `settingsCtrl.js` | `favorites.test.js` (the seam is exported for this) |
| **INV-3** | The server sanitizer is **the only real validation in the system**: React 19 runs no `propTypes` on function components, so a malformed favorite produces no warning anywhere | `settingsCtrl.js` `sanitizeFavorites` | — (do not thin it out; §6.4) |
| **INV-4** | `browserGeo` is the single definition of "home", for the pseudo-row *and* the `⌂` badge. Never `customLat`/`customLon` (§7.2) | `PlacesPopover` `homeCoords` | Not pinned — field-verified |
| **INV-5** | Selecting a favorite **pans and never sets zoom** (§10 D-05) | `PlacesPopover` `handleSelect` | Not pinned — field-verified |
| **INV-6** | Home is always the **first row**; display-only ordering, storage keeps insertion order | `PlacesPopover` `orderedFavorites` | Not pinned |
| **INV-7** | `NO_FAVORITES` is a **frozen module-scope constant**. A bare `[]` re-renders every location consumer on every `AppContext` render (§6.4) | `useFavoriteLocations.js` | Not pinned |
| **INV-8** | Hydration rides the boot `GET /settings` read — **no mount effect** (React Compiler readiness, §6.4) | `AppContext.js` `getCustomLatLon` | Not pinned |
| **INV-9** | Every write is `PATCH /setting` under `localhostOnly`. The client's `isLocal` gate is **cosmetic**; the server is the boundary (§5.5) | `server/index.js`; `PlacesPopover` | — |
| **INV-10** | An empty rename commit **reverts**, never writes — an empty save would silently delete the favorite (§7.3) | `useFavoriteLocations.js` `rename`; `PlacesPopover` `commitRename` | Not pinned |
| **INV-11** | `remove` **no-ops on a vanished id**, so a two-tap confirm racing a concurrent edit cannot delete whatever row shifted into place | `useFavoriteLocations.js` `remove` | Not pinned |

---

## 3. Capacity — the 7-row budget

The limit is a **row** budget, not a favorite count. The `⌂` home pseudo-row occupies a row
exactly when no favorite sits on the home coordinates:

```
rows = favorites.length + (home pinned ? 0 : 1)   ≤ 7
```

So the list holds **7 favorites when one of them is home, 6 otherwise** — both render 7 rows.
Pinning home is **row-neutral**: the stored row replaces the pseudo-row it suppresses.

`capFor(list, home)` in `useFavoriteLocations.js` computes the effective cap and yields two
affordance flags:

- **`canPin`** — ordinary places. 6, or 7 when home is already pinned.
- **`canPinHome`** — the `★` on the home row. Allowed right up to 7, because it adds no row. This
  is the case that motivated the rule: at 6 favorites plus the pseudo-row you are already showing
  7 rows, and pinning home still shows 7.

### 3.1 Two bounds, two different kinds of number

`MAX_ROWS = 7` in the client expresses the **display rule**. `MAX_FAVORITES = 7` on the server is
a **resource ceiling** only. They are equal today and mean different things — do not "fix the
inconsistency" by teaching the server the display rule, because it cannot compute it: "is home
pinned" depends on `browserGeo`, which blends `settings.json` with the IP-geolocation cache.
Bounding the resource is the server's job; the display rule is the client's.

Accepted consequence: a hand-crafted `PATCH` can store 7 arbitrary non-home places, and the
popover then scrolls. Harmless, and the same class as any hand-edit of `settings.json`.

### 3.2 The measurements

Measured in-browser at 800 × 480, the fleet's panel size — not estimated.

| Case | Rows | Content | Verdict |
|---|---|---|---|
| 7 favorites, home pinned | 7 | **424 px** | fits the 440 px budget; outer 448, 17 px bottom margin, no scroll |
| `⌂` + 6 favorites | 7 | **433 px** | fits since PR 328; clipped the footer by 13 px before it |
| `⌂` + 7 favorites | 8 | ~503 px outer | **cannot fit** 464 px of available outer box on a 480 px panel |

Eight rows of 44 px touch targets do not fit under *any* cap value. The cap is what guarantees
the no-scroll property — that is what it is for.

**Quota, the second independent constraint.** Tomorrow.io is 25 req/h per key and two Pis share
one since the C2 decision (2026-06-15) — roughly 10 req/h of real headroom per Pi, ~17 calls/h of
burst. A *cold* location costs 3 Tomorrow.io calls plus reverse-geocode, sunrise/sunset, two alert
queries, air quality and pollen. A cold tour of 6 favorites ≈ 18 calls: uncomfortable but
survivable. At 10 it is not.

This is why a **flat** 6→7 stays rejected while the conditional seventh was granted: a flat
seventh costs ~21 calls on a cold tour against ~17/h of headroom, whereas the conditional seventh
can only ever be the home location — where the kiosk boots and where Recenter returns — so its
weather is effectively always cached and the marginal upstream cost is nil.

**Cognition, the third.** Past roughly 7 entries a flat list with no search becomes
scroll-and-hunt. All three constraints land in the same place, which is why the number has held.

### 3.3 The accepted degradation

An 8-row state is reachable through the shipped UI, not only by hand-editing: hold 7 favorites
(home pinned), then move the default to a place that is none of them — hand-typed coordinates, or
`↺` when the pinned home was a manual override. The pseudo-row reappears above 7 rows and the
popover scrolls ~39 px. Gracefully, since PR 328; nothing clips. Moving the default to another
*favorite*, or `↺` when the pinned home already is the IP-derived one, stays safe.

### 3.4 At the cap

The `★` action goes **disabled** with an explanatory line (`favorites.full` — "List full — remove
one first"). Do **not** silently evict FIFO: silent eviction on a kiosk someone checks once a week
is indistinguishable from data loss, and it could evict the entry currently marked as default.

> **Trap.** `pin()` must budget the **resulting** list, not the current one. A pre-insert check
> reads the old, stricter cap and silently refuses the very action that would relax it — the `★`
> rendered enabled and did nothing when tapped. Found in the browser, not in review.

---

## 4. Data model and persistence

```json
"favorites": [
  { "id": "fav_1753651200000", "label": "Chalet — Saint-Donat", "lat": 46.3172, "lon": -74.2205 }
]
```

| Field | Rule |
|---|---|
| `id` | Opaque, client-generated, ≤ 64 chars. The React key and the delete handle. **Stable across a rename** — rename edits `label` only. Synthesised as `fav_<n>` when missing |
| `label` | 1..40 chars after trim. Auto-filled at pin time (§7.1), user-editable. **An entry without one is dropped** |
| `lat` | −90..90, **rounded to 4 decimals** |
| `lon` | −180..180, **rounded to 4 decimals** |
| ~~`zoom`~~ | **Removed** (PR 330, §10 D-05). `sanitizeFavorites` rebuilds entries, so a 3.2.x-era stored zoom sheds on the next write — no migration |

### 4.1 Storage: `settings.json`, not localStorage

| Option | Verdict |
|---|---|
| `localStorage` only | **Rejected** — lost when the kiosk browser profile is reset (which happens on this fleet), invisible to the server, not covered by any backup |
| **`settings.json` key `favorites`** | **Chosen** — sits next to `startingLat`/`startingLon`, which the feature must write anyway; survives a profile wipe; `PUT /settings` already preserves untouched whitelisted keys, so a Settings-panel save will not clobber it; writes ride the existing atomic `serializeWrite` + `writeSettingsFile` path |
| Hybrid, mirrored | **Rejected** — synchronisation complexity for no gain |

**No new endpoint.** `PATCH /setting` with `{ key: "favorites", val: [...] }` is sufficient and is
already `localhostOnly`. `setSetting` rejects `null`/`undefined` but **accepts `[]`**, so "delete
the last favorite" works. Removal writes the whole array minus the entry — never `DELETE /setting`,
which drops the entire key.

Being in `ALLOWED_KEYS` is specifically what stops a Settings-panel save from wiping the list —
the class of bug that already bit `advanced` and `indoorTemperature`. There is a test for it.

### 4.2 Freezing the coordinates is load-bearing

The weather proxy caches on the key `type:fieldsHash:lat(4dp):lon(4dp)` with TTLs of 15 min
(current) / 30 min (hourly) / 6 h (daily), capped at 512 entries.

Consequence: **a favorite storing fixed, 4-decimal-rounded coordinates costs zero upstream calls
when revisited inside the TTL.** Storing the live map centre — which drifts by metres on every pan
— would mint a new cache key and cost 3 fresh Tomorrow.io calls per visit. That is the difference
between a free feature and one that eats the shared-key headroom.

So: round at pin time client-side, re-apply server-side so a hand-edited `settings.json` cannot
defeat the contract, and answer "is this favorite the current location?" by comparing the
**rounded** values, never float equality:

```js
const round4 = (n) => Math.round(n * 1e4) / 1e4;
const sameSpot = (a, b) => round4(a.lat) === round4(b.lat) && round4(a.lon) === round4(b.lon);
```

Cache footprint: 7 favorites × 3 timesteps = 21 entries against a 512-entry cap. Negligible.

> **Bonus finding, no action needed.** Switching location fires the weather triplet *twice* — once
> from `setMapPosition` and once from the polling effect restarting on the new `mapGeo` (staggered
> 0/2/4 s). The second set lands inside the TTL of the first and resolves as cache hits, so the
> real upstream cost is 3 calls, not 6. Worth knowing before anyone "optimizes" the duplicate away
> and breaks the stagger.

---

## 5. Server

### 5.1 The sanitizer and its two seams

`favorites` is in `ALLOWED_KEYS`. `sanitizeFavorites` validates the shape, and `VALUE_SANITIZERS`
routes the key to it.

**The seam that matters.** `sanitizeSettings` covers `POST`/`PUT` and the remote **read** path.
The `PATCH` handler does not call it — it writes its value straight through. So whitelisting plus
a `sanitizeSettings` hook alone left *the most-used write path* able to persist arbitrary shapes.
`sanitizeValue` is therefore applied from `setSetting` as well, and is exported so it can be
tested as its own seam. This was caught by an end-to-end `curl`; a unit test of the pure helper
cannot see it.

**Coercion uses `toNumber`, not `Number()`.** `Number(null)`, `Number("")`, `Number(false)` and
`Number([])` are all `0` — a finite, in-range coordinate — so an entry carrying `lon: null` would
have been accepted and pinned to the Gulf of Guinea. Numeric **strings** must still pass:
`settings.json` legitimately stores coordinates as strings, and `sensehatCtrl` `parseFloat()`s
`startingLat` for exactly that reason.

**Entries are rebuilt, not filtered.** Each surviving entry is reconstructed field by field, so no
unexpected property can ride along into `settings.json`. That property is what made removing the
`zoom` field migration-free.

**Malformed entries are dropped individually**, not rejected wholesale: one bad row from a future
client should cost that row, not the user's whole list. The cap counts *valid* entries, so a run
of junk at the head cannot consume the budget and hide the real favorites.

### 5.2 The read path

Because `maskForRemote` projects through `sanitizeSettings`, the sanitizer runs on the way out too
— a hand-edited or corrupted array can never reach a client verbatim, and a corrupt file degrades
to a shorter list rather than a crash. Truncating server-side means the ceiling holds even if a
future client forgets it.

### 5.3 Durability

Writes go through the existing atomic path: a per-process-unique `.tmp` opened `0600`, `fsync`,
then `rename`. `settings.json` stays owner-only; every `settingsCtrl` write passes `mode: 0o600`
so a freshly created file starts locked down.

### 5.4 Remote masking — deliberately unmasked

`favorites` is **not** in `API_KEY_FIELDS` or `REMOTE_HIDDEN_KEYS`. It reaches remote clients
verbatim, the same exposure `startingLat`/`startingLon` already have.

This is a decision, not an oversight (§10 D-10): the SSH-tunnel and LAN workflows both need to
read the list. It does widen location exposure from one coordinate pair to up to seven labelled
points carrying user-authored text. A test pins the behaviour so a refactor cannot silently flip
it, and `docs/security-hardening.md` records it with the opt-out: add `favorites` to
`REMOTE_HIDDEN_KEYS`; the cost is an empty Places list for remote viewers, editing unaffected.

### 5.5 Write gating

Writes are `localhostOnly` — the same gate protecting `startingLat`/`startingLon`. A LAN client
reads the list and can navigate it, but cannot pin, delete, rename or promote. The client hides
Edit affordances on `!isLocal` so a remote user never sees a button that would 403, but **that
client gate is cosmetic**; server-side enforcement is the real boundary. A 403 is swallowed
without a console warning — expected when someone browses the list over the LAN.

---

## 6. Client architecture

### 6.1 `useFavoriteLocations`

```js
useFavoriteLocations({ home })
  → { favorites, canPin, canPinHome, maxFavorites, isPinned, hydrate, pin, remove, rename }
```

Every mutation returns `Promise<boolean>`. `setDefault` and `resetDefault` are **not** here — they
touch geo state the hook has no business owning (§6.3). `canRename` no longer exists (§7.3).

- **`home`** exists because the cap is a row budget and the pseudo-row only occupies a row when no
  favorite sits on home. It is mirrored in a ref so `pin` can read it without minting a new
  identity on every geolocation update.
- **`hydrate`** trims to `MAX_ROWS` — the hard budget, not the home-aware cap. Hydration must never
  *widen* the list; the finer cap is a UX gate, not a storage guarantee.
- **Two mirror refs** (`favoritesRef`, `homeRef`) keep `pin`/`remove`/`rename` identities stable so
  the context slice does not churn.
- **Optimistic writes.** React state updates first so the touchscreen feels immediate; a failed
  `PATCH` rolls back and resolves `false` so the caller can show the failure. A silent failure on a
  kiosk nobody is watching is worse than a visible one. The failure surfaces as the **inline**
  `favorites.saveFailed` text — not a toast (§7.4), and the error belongs beside the action that
  failed.

### 6.2 Context wiring

The hook is called once in `AppContext` and spread into **`locationSlice`**, alongside `mapGeo`,
`browserGeo`, `customLat`, `customLon` and `reverseGeoResult`. Three unrelated consumers need it —
`LocationDetailsPopover` (via both heroes), `PlacesPopover`, and `ControlButtons` for the dock
button — which clears the CLAUDE.md bar for promoting state out of local component state.
`AppContext` grows by the hook call plus the slice fields, and no more.

### 6.3 The actions that live in AppContext

Three actions touch geo state, so they live beside it rather than in the hook:

- **`setFavoriteAsDefault(id)`** does three things: `PATCH` `startingLat`/`startingLon`;
  `setCustomLat`/`setCustomLon` so Settings reflects it immediately; and `setBrowserGeo` so
  Recenter follows. It also sets `homeLabel` from the promoted favorite's own label — no
  reverse-geocode needed — and marks the boot capture done so a stale name cannot overwrite it.
- **`applyAutomaticLocation()`** re-derives home from `GET /geolocation`, whose 30-day disk cache
  holds the **ipapi-derived** coordinates and never the manual override — the right source, and
  usually no network round-trip. On failure `browserGeo` is left untouched: Recenter keeps working
  and the next reload retries.
- **`resetDefaultLocation()`** clears the override and applies the above. It writes the same empty
  pair the Settings "Auto" buttons write, so there is **one** storage contract, not two.

**Neither action moves the map.** Changing where "home" is should not yank the map out from under
whatever the user is looking at; Recenter takes them there when they want it.

> **The `browserGeo` trap, in two halves.** `browserGeo` is written **only at boot**, and
> `resetMapPosition` — the dock's Recenter — pans to it. So changing the default and pressing
> Recenter went to the *old* default until a page reload. Nobody had noticed because hand-editing
> lat/lon is rare and usually followed by a reload; a one-tap "Set as default" makes the stale
> pointer trivially reproducible. **Second half:** the block that keeps `browserGeo` in step was
> guarded by `Number.isFinite(parseFloat(lat))`, and an *empty* field parses to `NaN` — so clearing
> the override to "Auto" skipped it entirely, which is why returning to automatic geolocation
> appeared to require rebooting the Pi. It never did; a reload sufficed, and now not even that.
> Both branches are symmetric, and the captured home name is dropped in both.

**`homeLabel` lifecycle.** On a cold boot `mapGeo` *is* `browserGeo`, so the first reverse-geocode
result already describes home. `AppContext` captures it once inside the existing `.then` — no extra
LocationIQ call, no new mount effect. It is re-set from the favorite's own label on
`setFavoriteAsDefault`, and **cleared** when coordinates are typed by hand or reset to automatic:
the captured name would then describe the *previous* default, and a generic
`favorites.homeFallback` beats confidently naming the wrong city.

### 6.4 React 19 and Compiler constraints

Four still bind this feature.

1. **Never `X.defaultProps = {…}`** — React 19's automatic JSX runtime ignores it silently. Use
   destructuring defaults. `test/react19Guards.test.js` fails the suite on any reappearance.
2. **A frozen module-scope empty array is mandatory.** `favorites` is a dependency of
   `locationSlice`'s `useMemo`, so a bare `[]` allocating a fresh reference per render would mint a
   new context value on *every* `AppContext` render and re-render every location consumer in the
   tree, on a 1 GB Pi 3, forever. Hence `NO_FAVORITES = Object.freeze([])`, returned for the empty
   case including the pre-settings-load window and every defensive parse failure. Same contract as
   `NO_ALERTS` in `WeatherMap`.
3. **PropTypes no longer validate at runtime** on function components. They stay mandatory
   (`react/prop-types` is a build error, and they document the API), but no console warning will
   ever fire for a malformed favorite — which is why the server sanitizer is the only real
   validation in the system (INV-3).
4. **Do not reach for `react-transition-group` casually.** Under React 19 a consumer without
   `nodeRef` falls back to the removed `findDOMNode`, and the throw unmounts the whole root — blank
   kiosk, no error boundary above `App`. Prefer a plain CSS transition; if it is genuinely needed,
   `nodeRef` is mandatory and the guard test enforces it.

**Compiler readiness:** seed `favorites` from the boot settings response on the **existing** load
path — the same `.then` that already calls `setCustomLat`/`setCustomLon` — rather than adding a
fresh `useEffect(() => setFavorites(…), [])`. Same result, one fewer site for the
compiler-readiness pass to revisit.

> Deliberately **not** using React 19's `useOptimistic`: it is built around form Actions and
> transitions, neither of which this codebase uses. Plain state plus an explicit rollback is
> smaller and keeps the failure path obvious.

---

## 7. UI surfaces and interaction

### 7.1 The pin action

Appended to `LocationDetailsPopover`, below the reverse-geocode detail rows. Three states:

| Condition | Render |
|---|---|
| Not pinned, list not full | `★ Pin this place`, 44 px hit area |
| Already pinned (rounded-coordinate match) | `★ Pinned` — static, dimmed, not a button |
| List full | Button disabled + the `favorites.full` helper |

The whole footer is hidden for remote clients: pinning writes `settings.json`, which is
localhost-gated, and hiding beats offering a button that 403s.

**The auto-label** is `Locality, Region`, composed from the reverse geocode already in context and
truncated to `MAX_LABEL_LEN = 40`. The fallback chains live in `client/src/ui/placeLabel.js` so the
three surfaces needing a place name — the popover's detail rows, the favorite auto-label, and
`AppContext`'s home-label capture — cannot drift apart.

> **County fallback.** The first half falls back to the **county** (`county` / `state_district`)
> when no locality is mapped. A rural point otherwise degraded to the bare region — which is how a
> Texas ranch got auto-labelled "Texas" (issue 319, the feature's first field report). The county
> only ever *substitutes* for a missing locality; it never joins one ("Montréal, Agglomération de
> Montréal, Québec" must not happen). Both directions are pinned by regression tests. Note the
> asymmetry: the **home row self-heals** on the next reload because its label is re-captured every
> boot, while **stored favorites keep their pinned label** by design.

With no reverse-geocode payload at all the label falls back to the formatted coordinates, so
pinning still works over a lake or a field — the server drops label-less entries, so "no address"
must not mean "no label".

### 7.2 The Places popover and its home row

The default location gets the first row, badged `⌂` — but it is **not** a stored favorite: never
written to `favorites`, never counted against the cap.

**Why a pseudo-row rather than auto-seeding the stored list.** Auto-seeding would spend a slot on a
place already reachable from the dock, write to `settings.json` without the user asking,
permanently remove the empty state (and with it the only text explaining how to pin anything),
create a row that silently moves itself whenever the default changes, and be labelled badly — at
boot the reverse geocode has not resolved, so the stored entry would carry raw coordinates forever.
But with no representation at all, the `⌂` badge would only ever render if the user happened to pin
their own default, and half the design would be dead code. The pseudo-row resolves both.

**One definition of home** (INV-4). `browserGeo` is the source of truth for both the row and the
badge — not `customLat`/`customLon`. The two agree whenever a default is saved, but `browserGeo`
also covers the never-configured case where the app fell back to IP geolocation. Keying the badge
on the saved pair gave the badge and the row two different meanings in the same popover: a favorite
sitting exactly on an IP-derived home rendered **unbadged**, directly under the home row it
duplicated. Caught in the browser, not in review.

**Duplicate suppression.** When a stored favorite sits on the home coordinates (§4.2 comparison),
the pseudo-row is not rendered at all — that favorite carries the badge itself, and two rows for
one place is the redundant-affordance problem the rail redesign spent a session removing.

**The home row is pinnable** (`★`, Edit mode, localhost-gated, disabled with the `favorites.full`
hint at the cap). Pinning converts home into a stored favorite: suppression hides the pseudo-row,
the badge migrates, and the stored row becomes renamable and removable through the existing flow —
one tap, and no parallel persistence for a home label. The label falls back to the rounded
coordinates when the boot geocode never resolved, because the server drops label-less entries and
the affordance must not depend on `homeLabel`.

**Home is always first** (INV-6) — as the pseudo-row when unpinned, as the badged favorite when
pinned. Display-only; storage keeps insertion order. Without it, pinning home would visually
teleport "my home" from the top of the list to the bottom just because it changed representation.

> **Trap.** The Edit toggle must render when the home row is the **only** content. Keyed on
> `favorites.length` alone, a zero-favorite user — issue 319's exact state — could never reach Edit
> mode, and therefore never reach the `★` that is the whole path to a renamable default. The
> condition is `isLocal && (favorites.length > 0 || showHomeRow)`.

**Empty state.** Keep the dock button visible and render a one-line explainer — "Open a place on
the map, tap its name, then *Pin this place*." A hidden button is an undiscoverable feature. (Since
the home row shipped, the popover is never truly empty either.)

**Terminology fix shipped alongside.** `resetMapPosition` pans to `browserGeo` — the *default*
position — but its dock tooltip read "Recenter the map on the **current** position", which is
precisely what it does not do. Corrected to "home position" in all three locales;
`docs/ui-layout_*.md` had it right all along.

### 7.3 Rename — ungated, and why no gate can exist

Rename is offered on **every local client**. The device gate it shipped with
(`isLocal && navigator.maxTouchPoints === 0`) was removed on 2026-08-17.

`maxTouchPoints` answers *"is a toucher present"*, not *"can the user type"* — and **the web
platform cannot answer the second question at all**: `navigator.keyboard` reports layout, not
presence. Every candidate replacement was therefore another proxy that would eventually be wrong on
hardware nobody has bought yet. Two were designed and dropped:

- `(any-hover: hover) and (any-pointer: fine)` — fixes a touch laptop with a trackpad, but **not** a
  touchscreen with a keyboard and no mouse, because a keyboard adds no pointer.
- A `keyboardSeen` flag flipped by the first real `keydown` — sound, but it makes the affordance
  appear only after an invisible precondition.

**What the field showed.** The gate's only observed failure was kiosk `.6.55`: an HDMI monitor that
is *also* a touch panel (`ILITEK ILITEK-TP` on USB) with a wired keyboard attached —
`maxTouchPoints > 0`, rename hidden, keyboard right there. Meanwhile the report that *motivated*
the review (issue 319) turned out never to have been about the gate: the home pseudo-row had no
rename affordance on **any** device until the `★` shipped. The gate was protecting against a cost
measurement did not support, while hiding the feature from the person looking for it.

**Why removal is safe — verified, not assumed.** The input is seeded with the current label, so a
blur with no typing gives `next === f.label` and `commitRename` returns without writing. Nothing is
saved, nothing is lost. Reaching the field takes a deliberate tap into Edit mode, which retires the
original objection: it guarded a stray-tap risk that Edit mode had already eliminated.

**What replaces the gate.** `favorites.renameHint` ("Enter to save, Esc to cancel") renders as a
**visible line** under the field, wired via `aria-describedby` and not merely visually. Tooltips
never fire on a touchscreen, so the client that most needed the keyboard contract was the only one
that could not see it. Naming the keys *is* the "a keyboard is involved" message, without asserting
anything about hardware the browser cannot determine.

**Why rename exists at all.** The auto-label is not always enough: two favorites in the same city
produce two identical rows (§4.2 only blocks a duplicate at the same *rounded point*), a point with
no address falls back to a coordinate pair, and a personal name ("Chalet") beats an administrative
one.

An empty or whitespace-only commit **reverts** (INV-10). The `id` is stable across a rename.

### 7.4 Deletion — two-tap arm, no undo

Removal is `PATCH /setting` with the whole array minus the entry. The house pattern for a
destructive touch action is reused verbatim from `RelaunchButton`, with its own constant
`REMOVE_CONFIRM_MS = 4000`:

- **Tap 1** arms: `✕` becomes a labelled confirm (`favorites.removeConfirm`), tinted `--c-danger`.
- **Tap 2 on the same row** deletes.
- **4 s of inaction**, arming another row, or leaving Edit mode disarms. Only one row armed at a
  time. The `useEffect` owning the timer clears it on unmount.
- Arming is keyed on the entry **id**, so a concurrent edit cannot turn the second tap into an
  off-by-one deletion (INV-11).

**No undo toast.** It is the obvious alternative and the wrong one here: the toast would have to
render from inside a `portal`-mode popover, and this project has a documented incident where any
ancestor `filter` / `backdrop-filter` / `transform` confines a `position: fixed` toast to its
stacking context (`incident_dock_toast_stacking_context`) — and `DetailsPopover` uses
`backdrop-filter`. The two-tap arm gives the same protection with zero new surface, and re-pinning
a deleted favorite costs two taps anyway, since it is almost always the place currently displayed.

**No swipe gesture.** Swipe-to-delete collides with map and rail dragging and with the drag-scroll
behaviour that already produced one investigation (`docs/investigation-drag-scroll-2026-04.md`).
Explicit buttons only.

**Deleting the default does not clear it.** `startingLat`/`startingLon` survive as a bare
coordinate pair, exactly as if typed in Settings — silently discarding a chosen setting is worse
than leaving it. Recenter keeps working; only the labelled shortcut disappears, and the pseudo-row
reappears in its place so the default stays visible. The way *out* is §7.5.

### 7.5 Reset to automatic

`↺` on the home row, Edit mode, shown **only when a manual override is actually stored** (both
`startingLat` and `startingLon` present — otherwise the default is already IP-derived and there is
nothing to undo). One tap clears both keys and re-derives `browserGeo` immediately: no Settings
trip, no reload, no reboot.

**The field report behind it:** with every favorite deleted, the kiosk kept booting at a place
nothing on screen explained, and recovering meant knowing to go to Settings → Latitude/Longitude →
Auto → save → reload.

**Why an affordance and not a prompt after deletion.** A follow-up prompt when the badged favorite
is deleted was the obvious fix, and it was rejected for the right reason: it pushes *one* outcome
when *two* are equally legitimate — reset to automatic, or promote a different favorite with the
`⌂` already on every row. Putting the reset where "home" is displayed leaves the user choosing
between affordances instead of answering a leading question, and it costs no new state machine: the
pseudo-row already reappears when the badged favorite is deleted, so the orphaned default was
visible all along. Only the way out was missing.

### 7.6 Why the dock, and why not the city name

The obvious-looking entry point is the city name in the hero. Overloading it was **rejected** for
four independent reasons:

1. **It contradicts the codified affordance vocabulary** (`rail-affordance-redesign-design.md`):
   *dotted underline = popover on that term*, *maximize ⤢ = drill into the same topic*, ***dock =
   change topic***. Choosing a different city changes the subject of the entire app — every panel,
   the radar, the alerts, the Sense HAT. That is a dock action by the project's own rule.
2. **The existing popover has no replacement.** It surfaces locality / district / county / region /
   country / postcode / coordinates — the administrative detail the truncated `LocationName` cannot
   fit. Replacing it is a straight regression.
3. **That DOM region is a known hit-testing minefield.** The `.location` row in `HeroCompact` is
   what swallowed the taps meant for the maximize square (paint-order bug, fixed in `94f677b` with
   `z-index: 2`). Stacking a second tap target there re-opens that bug class on the only surface
   with no mouse.
4. **On the 7" the city name is truncated** — a poor target for an app-global action.

But the popover is still the right place to *create* a favorite: "pin **this** place" is a
statement about the location currently displayed, same topic, so it obeys the rule. Picking a
*different* place is the topic change, and that goes to the dock.

| Placement | Verdict |
|---|---|
| City-name tap | Rejected — above |
| A rail card | Rejected — costs vertical rail height, the scarcest resource on the 7". v3.3 exists *because* of a 134 px overflow at font size L |
| Settings panel only | Rejected — a frequent navigation action, not configuration; burying it two panels deep defeats the request |
| **Dock button** | **Chosen** — zero vertical rail cost, matches the change-topic rule, and sits next to Recenter, its semantic sibling ("where are we looking?") |

**Group: *Map*, not *Views*.** Views is defined as "open a full-rail content view" and is Pi-only;
Places is a map-scope action available on every layout.

> **Do NOT set `data-dock-priority="secondary"`.** That attribute collapses a button on narrow
> portrait phones. Places must stay reachable — Recenter, its sibling, is not flagged either.

**Icon: `carbon/bookmark`.** The dock was unified on `@iconify/icons-carbon`; the AI sparkle is the
single documented exception. `location-star` is semantically closest but draws a map pin, and
`location`/`location-filled` are already the marker-visibility toggle two buttons away in the same
group — two pin glyphs side by side would read as one control with two states.

### 7.7 Styling guard-rails

- **The portal CSS-variable whitelist.** `DetailsPopover` in `portal` mode copies an *explicit
  whitelist* of palette variables into the portal node. A row needing a token outside that list
  must have it **added to the whitelist**, or it renders unstyled. This exact trap cost a debugging
  session on `MoonDetailsPopover` (`incident_moon_glyph_emoji_platform`). A `--c-surface-hybrid`
  fallback was later dropped from `PlacesPopover` for the same reason: it could never resolve.
- **No `animation: … infinite`** anywhere in this feature — a compositing animation keeps the Pi
  GPU awake every vsync (`incident_infinite_composited_animation_pi_gpu`).
- **No external `<a href>`.** Nothing here points outside the app, so the QR-only rule is not
  engaged — but it would be the moment something did.
- Reuse `RailSquareButton` if a square affordance is ever added to the rail. The popover rows are
  plain rows, so nothing new is needed there.

---

## 8. Layout and geometry

**Portal mode is mandatory**, not a preference: the `LayoutPi` rail clips non-portal popovers
horizontally. The cost is that the portal escapes `.ambientRoot`'s `border-box` reset, so
`.popover` is **content-box** — its 22 px of vertical padding and 2 px of border sit *on top of*
`max-height`. That is `POPOVER_CHROME_PX = 24`, budgeted explicitly.

**`fitViewport`** is an opt-in prop on the shell; only `PlacesPopover` uses it. It drops the default
fixed cap for bounded-but-tall content:

```js
maxHeight = fitViewport
  ? Math.max(120, innerHeight - 2 * MARGIN - POPOVER_CHROME_PX)   // 440 on a 480 px panel
  : Math.min(420, innerHeight - top - MARGIN)                     // every other consumer
```

`MARGIN = 8` is one module constant shared by the horizontal re-anchor, the vertical clamp **and**
the height budget, so the three cannot drift apart again.

> **The fixed-point bug.** `fitViewport` must **not** subtract `portalPos.top`. The dock sits at the
> viewport's bottom edge, so `innerHeight − top` is negative there: the height collapsed to its
> 120 px floor, the vertical clamp lifted the popover by exactly that small height, and the budget
> recomputed from the new top landed on the same floor again — a **stable fixed point at minimum
> size**, with the list clipped.
>
> **Why it survived review:** the pre-`fitViewport` formula hit the same negative arithmetic and
> escaped the consequence *by accident* — a negative `max-height` is invalid CSS, so the browser
> ignored it and the content still measured at its natural height for the clamp's benefit. Adding a
> `Math.max` floor turned a silently-discarded value into a hard clamp. The budget is correct
> precisely because the clamp is free to float the popover away from its trigger.

**Measured row geometry**, at 800 × 480, replacing the original estimates:

| | Originally estimated | Measured |
|---|---|---|
| Popover width | ~280 px | **346 px** (320 content + chrome) |
| Actions, 3 × 44 | — | **132 px** |
| Label column | ~180 px, desktop only | **180 px, on the 7" as well** |

Ellipsis confirmed at that width: `Sainte-Brigide-dIberville, Quebec` reports `scrollWidth 204`
against `clientWidth 160` and truncates; `Montreal, Quebec` (109 px) does not. The home row carries
at most two of its own actions (`★`, and `↺` when an override is stored), so it is never the
binding case.

> **The `min-width: 0` trap** is the load-bearing survivor of the original budget paragraph. In Edit
> mode the row is `flex`; the label needs `min-width: 0` plus `text-overflow: ellipsis`. Without
> `min-width: 0` the label refuses to shrink and pushes the action buttons off the row.

**To reproduce the geometry:** 1280 × 800 with the dock trigger → `maxHeight` 760, top 620, outer
172, bottom gap 8, `scrollHeight === clientHeight`. 800 × 480 with the 7-row worst case →
`maxHeight` 440, top 15, outer 457, bottom gap 8, no scrolling, footer fully visible.

---

## 9. i18n

All strings here are **kiosk-visible**, so they live in the locale files. The inline-trilingual
`lbl()` helper is **not** permitted — its codified exception covers `SettingsPanel` and
`DebugPanel` only.

`favorites.{title, pin, pinned, full, homeFallback, setDefault, remove, removeConfirm, rename,
resetHome, renameHint, edit, done, empty, remoteReadOnly, saveFailed}`, plus
`controls.{openPlaces, closePlaces}` and `toasts.favoriteDefaultSet`.

**Specced and never shipped, deliberately:**

| Key | What happened |
|---|---|
| `toasts.favoriteAdded` | Never created. Pin feedback is the button flipping to "Pinned" in place, which is in-context; a toast from inside the shell hits the `backdrop-filter` stacking trap (§7.4) |
| `toasts.favoriteSaveFailed` | Replaced by the inline `favorites.saveFailed` — the error belongs beside the action that failed |
| `favorites.currentPosition` | Removed: the "Current position" footer button became the `⌂` home row, whose fallback label is `favorites.homeFallback` |
| `favorites.isDefault` | Removed as dead — the `⌂` badge is `aria-hidden` inside a button that already carries the label |

After touching a locale file, regenerate the glossary with `node tools/gen-localization-glossary.js`.
Never hand-edit it; `--check` exits 1 when it is stale.

---

## 10. Decision record

| # | Decision | Rejected, and why |
|---|---|---|
| **D-01** | Storage in `settings.json` | localStorage (lost on profile reset, invisible to the server, unbacked); hybrid (sync complexity, no gain) — §4.1 |
| **D-02** | No new endpoint; `PATCH /setting` | A dedicated route would duplicate the existing whitelist, gate and atomic write |
| **D-03** | Pin in the city-name popover, pick from the dock | City-name tap (4 reasons); rail card (vertical height); Settings-only (it is navigation, not configuration) — §7.6 |
| **D-04** | Capacity is a **7-row budget**; the home entry does not count | A flat cap of 6 charged a slot for a place shown for free; a flat 7 breaks the quota margin — §3 |
| **D-05** | Selecting a favorite **never changes zoom**; the field is removed | Storing it fought the user *and* drifted the marker — see below |
| **D-06** | Rename **ungated** on any local client | `maxTouchPoints === 0`; `(any-hover) and (any-pointer: fine)`; `keyboardSeen` — all proxies for a question the platform cannot answer — §7.3 |
| **D-07** | Two-tap arm for delete, no undo | An undo toast cannot escape the popover's stacking context; swipe collides with map/rail dragging — §7.4 |
| **D-08** | The `⌂` home row is a **pseudo-row** | Auto-seeding the stored list: spends a slot, writes unasked, kills the empty state, moves itself, labels with raw coordinates — §7.2 |
| **D-09** | `↺` reset affordance on the home row | A post-deletion prompt pushes one outcome when two are legitimate — §7.5 |
| **D-10** | `favorites` reaches remote clients **unmasked** | Hiding it empties the Places list for the documented SSH-tunnel workflow; opt-out recipe recorded instead — §5.4 |
| **D-11** | Icon `carbon/bookmark` | `location-star` draws a map pin next to the existing marker toggle — two pin glyphs read as one control — §7.6 |
| **D-12** | Dock button visible even when the list is empty | Hiding it makes the feature undiscoverable — §7.2 |
| **D-13** | Label frozen at pin time; `id` stable across rename | A live label would re-write storage on every geocode refresh |
| **D-14** | Coordinates rounded to 4 decimals | Storing the live map centre mints a new cache key per visit — §4.2 |

**The two reversals, and why they are not re-reversible.**

- **D-05, per-favorite zoom** (originally "yes, optional field"). The zoom at pin time is an
  artefact of the *pinning* gesture — you zoom **in** to place the pin precisely — not a statement
  about how you want to view the place later. And applying a zoom right after a pan visibly drifts
  the marker: `panWithRailOffset` deliberately puts the map's true centre off the marker by a fixed
  **pixel** amount so the marker lands at the visual centre of the rail-uncovered area, but
  `map.setZoom` holds that true centre while pixels-per-degree changes underneath it.
  `ZoomAnchorOffset` patches `zoomIn`/`zoomOut` to `setZoomAround` the non-rail centre; it does
  **not** patch `setZoom`, so this path bypassed the correction entirely.
- **D-06, the rename gate** (originally "yes, gated on non-touch"). No proxy can answer "can the
  user type". Discoverability was the deciding argument: a gate that hides a feature from the people
  looking for it costs more than the unusable text field it avoids.

### 10.1 Superseded conclusions — do not re-derive

| Wrong claim | Why it was wrong | What replaced it |
|---|---|---|
| `MAX_FAVORITES = 6`, flat | Treated the constraint as a place count when it is a row budget | §3 |
| "Font size L is the binding display case" | The popover **portals** to `document.body`, outside the rail subtrees carrying the font-size `zoom`, and nothing consumes the copied `--c-font-scale` — font L never bound this surface | §8 |
| "The three-button crunch never happens on the 7"" | Rested on the removed rename gate *and* on a ~280 px width estimate; measured 346 px | §8 |
| "The non-touch gate protects the kiosk" | It answers the wrong question, and the field failure was a touch panel *with* a keyboard | §7.3 |
| "Per-favorite zoom is a viewing preference" | It is an artefact of the pinning gesture | D-05 |

---

## 11. Trap index — symptom to cause

| Symptom | Cause | Where |
|---|---|---|
| `★` looks enabled but does nothing | `pin()` checked the cap **before** the insert, reading the old stricter cap | §3.4 |
| Places popover opens tiny and clipped | `fitViewport` budget derived from `portalPos.top`, negative at a bottom-anchored trigger | §8 |
| Footer clipped by ~13 px | The fixed 420 px portal cap, before `fitViewport` | §8 |
| Rename hidden on a client that has a keyboard | The removed device gate — verify the deployed build | §7.3 |
| Edit mode / armed delete / half-typed rename survive a close | The popover mounted permanently; only the shell returned null, while the in-code comment claimed unmount-on-close | §7.2 |
| A row renders unstyled inside the popover | Palette token missing from the portal whitelist | §7.7 |
| A rural pin auto-labels as a bare region | County fallback missing from the label chain | §7.1 |
| A favorite pinned to the Gulf of Guinea | `Number(null) === 0` — use `toNumber` | §5.1 |
| `PATCH` persists a malformed shape | The sanitizer not wired into `setSetting` — `sanitizeSettings` does not cover PATCH | §5.1 |
| Recenter goes to the old default | `browserGeo` written only at boot | §6.3 |
| "Auto" in Settings appears to need a reboot | The `Number.isFinite(parseFloat(lat))` guard skipping the cleared branch | §6.3 |
| Marker drifts after selecting a place | `setZoom` bypassing `panWithRailOffset`'s pixel offset | D-05 |
| Every jump silently rewrites the starting zoom | `saveDefaultMapZoom` instead of the transient `setZoomToLevel` — still one autocomplete away even though the zoom feature is gone | D-05 |
| A remote client sees no Edit affordances | By design | §5.5 |

---

## 12. Verification — what is pinned, and what is not

**Mechanically pinned.** `test/favorites.test.js` (21 assertions): non-array → `[]`; non-object
entries dropped; entries rebuilt so unknown properties cannot ride along; non-finite and
out-of-range coordinates; exact range boundaries; numeric-string coercion; `round4` and the
4-decimal cache-key contract; empty and non-string labels; trim and truncate at 40; id synthesis
and the 64-char cap; truncation at `MAX_FAVORITES` preserving order; `MAX_FAVORITES` being the
7-row budget rather than the 6-place UX cap; the cap counting *valid* entries; a stored `zoom`
always dropped (the inverted guard against re-introducing it); `sanitizeValue` as the PATCH seam;
`sanitizeSettings` on the POST/PUT path; garbage degrading to `[]`; opaque sub-objects untouched;
`maskForRemote` still returning `favorites` (D-10, pinned so a refactor cannot flip it); and
`ALLOWED_KEYS` containing `favorites`. `test/placeLabel.test.js` adds 12, including **both
directions** of the county fallback. `test/react19Guards.test.js` covers the two failure modes that
are silent at build time.

**Not pinned — and this is the part people misread.** There is no client-side test harness
(tech-debt D2). Every interaction behaviour in §7 and every geometry claim in §8 — the two-tap arm,
mode exclusivity, rename blur semantics, home-row suppression, the row budget on screen — is
verified only by browser sessions and one field test. A green suite says nothing about the popover.

**Build gate:** `cd client && npm run prod` with zero errors, `npm test`, and
`node tools/gen-localization-glossary.js --check`. Current baseline: **600/600 tests**, build
**0 errors / 151 warnings**, glossary green.

### 12.1 The field-test record

Run **2026-08-16 — after the fleet rather than before it.** v3.2.0 shipped with browser-only
verification (both PR messages say so), and the acceptance gate sat unexecuted until a maintainer
field session ran it organically on the real kiosk plus the SSH tunnel.

**Passed:** pin from the hero popover without rail overflow; row tap propagating to hero, metrics,
alerts, AQ and radar; set-as-default followed by Recenter with no reload; the disabled pin at the
cap; the two-tap remove surviving a reload; touch-target comfort at arm's length; and the cache
contract — verified from `~/.local/state/pi-weather-station/server.log` rather than by inspection:
identical 4-decimal cache keys across visits, a `daily` HIT on return, TTLs 900 / 1798 / 21597 s.

**Failed:** the no-scroll criterion — instructively. Its premise was wrong (the popover portals
outside the rail's font-size zoom, so font L never bound this surface) and the real ceiling was the
shell's 420 px portal cap, under which the home row clipped the footer by 13 px.

**Two process lessons, kept deliberately.**

1. **A field-test gate that ships without being run decays into documentation.** Schedule it as a
   work item, not a hope.
2. **An acceptance criterion can encode a wrong premise.** "6 entries at font size L" was
   unfalsifiable on a surface whose font size is never touched — passing *or* failing it would have
   taught us nothing about the real constraint.

A method note worth carrying: the rename-gate criterion was deliberately checked on **both halves**
(absent on the touchscreen, present on a Mac over the tunnel), because an always-off gate is
indistinguishable from a working one.

### 12.2 A runnable list for the next field cycle

The two dead criteria are retired: the font-size premise never bound, and the rename gate no longer
exists.

1. `⌂` + 6 favorites renders 7 rows with the footer **fully visible and clear of the edge**; drag
   the list — it must not move.
2. At 6 favorites with none of them home, the ordinary pin is blocked ("List full") while `★` on
   the home row stays **enabled**; tapping it stores a 7th, the pseudo-row disappears, and the badge
   migrates to the top row.
3. Rename on a keyboard-less kiosk: open `✎`, tap away without typing — the label is **unchanged**
   and nothing was written.
4. `↺` on the home row clears the override and Recenter lands on the IP-derived location, with **no
   reload**.
5. Alternate between two favorites inside 15 minutes and confirm `[cache] HIT current:` in
   `server.log`.
6. Palette pass — day and nightRed — on the Edit-mode row with all three actions.

---

## 13. Open items and deliberate non-goals

**Open.**

- **Preset label chips at pin time** (`Maison` · `Chalet` · `Bureau` · `Écurie` · `—`), tapped to
  prepend to the auto-label. Still the only labelling path that works on a keyboard-less kiosk.
  Tracked in `ROADMAP.md`; it composes on top of this design rather than replacing anything.
- **The Debug panel's "Input environment" probe has no consumer.** It was built to supply the
  readings the rename-gate rework was blocked on; that question was resolved a different way. Keep
  it as a general diagnostic, or retire it — undecided.
- **The 8-row scroll case** (§3.3) is accepted, not fixed. Worth revisiting if the row budget ever
  changes.
- **The server/client cap divergence** (§3.1) is deliberate; nobody has decided whether it should
  stay that way if the budget changes.
- **No client-side test harness** (tech-debt D2) — see §12.

**Deliberate non-goals.**

- **Forward geocoding / a search box.** LocationIQ's `search.php` works with the `reverseGeoApiKey`
  already configured, so it is cheap server-side — but typing on a keyboard-less 7" is the wrong
  interaction, and it adds a proxy endpoint, a rate-limit bucket and a quota line, mainly serving
  desktop and SSH-tunnel users. It remains the standing answer to "how do I add a place I am not
  currently looking at".
- **Reordering the list.** Insertion order is fine at this size, and a forced home-first display
  ordering already sits on top of it.
- **Per-favorite unit or palette overrides.** No signal anyone wants this.
- **Fleet-wide shared favorites.** Each Pi is a different site; per-Pi lists are correct.

### 13.1 Documents that must stay in sync

Nothing in the build checks any of these. A behaviour change that makes one of them wrong
produces no error anywhere, which is why they are listed rather than trusted to memory.

| Document | What it asserts about this feature | Risk if it drifts |
|---|---|---|
| `docs/api.md` | The entry shape, the truncation rule, the numeric-string/`null` coercion note, drop-individually | An integrator writes a client against a schema that no longer holds |
| `docs/security-hardening.md` | `favorites` reaches remote clients unmasked, plus the `REMOTE_HIDDEN_KEYS` opt-out | A security review reads a stale exposure statement |
| `docs/ui-layout_en.md` + `_fr.md` | The dock row: the cap, the home row, every Edit-mode action. **Must match each other**, not just the code | Two languages disagree, and the French half is the one the maintainer reads |
| **`docs/places-guide_{en,fr,es}.md`** | **The user-facing manual — three languages.** Gesture by gesture: pinning, the home row, the cap of 6-or-7, renaming needing a keyboard, the reset to automatic | **The highest silent-drift risk here.** Nobody who changes this code reads the manual, and a wrong manual costs a support round-trip with a user rather than a build failure |
| `CHANGELOG.md` | Version history. **Never edited retroactively** — see the header redirect table | — |
| `ROADMAP.md` | The preset-chips phase-2 item and its premise | The premise silently outlives the constraint it rests on (it already did once: it cited a 6-entry font-size-L budget that measurement disproved) |

**A concrete trigger, not a good intention.** Any change to §7 (interaction) or §3 (the cap) is a
change to something the user manual states in plain language. Re-read
`docs/places-guide_en.md` before merging such a change, and carry any correction into the FR and
ES files in the same commit — a manual that is right in one language and wrong in two is worse
than one that is uniformly stale, because the disagreement is invisible until a user reports it.

---

## 14. History

Not a changelog — `CHANGELOG.md` remains the single source of version history. This is provenance,
so no section body has to carry dates to stay honest.

| PR | Commit | What it changed here | Owner section |
|---|---|---|---|
| 315 | `dfb513c` | The feature: pin / list / edit, storage, sanitizer, the cap | §4, §5, §6 |
| 316 | `ca2587c` | The `⌂` home pseudo-row; `ui/placeLabel.js` extracted | §7.2, §7.1 |
| 320 | `64eb571` | County fallback; zoom capture armed; popover transient-state reset; Debug input probe | §7.1, §7.2 |
| 324 | `79d4e86` | `★` pin on the home row; home-first ordering; `fitViewport` | §7.2, §8 |
| 328 | `2ecc412` | The `fitViewport` fixed-point regression | §8 |
| 330 | `5550ac3` | Zoom reversed out of the model | D-05 |
| 331 | `9d8a38d` | Return-to-automatic live apply; `↺` on the home row | §6.3, §7.5 |
| 332 | `1fb4907` | The rename gate removed; the hint made visible | §7.3 |
| 333 | `8b608c3` | The cap restated as a 7-row budget | §3 |

PRs 320 through 333 are one event: the field cycle opened by issue 319 and the 2026-08-16 session.
That density — three reversals in two days — is why this document was rewritten rather than amended
again.

**Blast-radius note:** this feature ships as PRs, never direct pushes. It adds a `settings.json`
field and touches shared components across every layout, which is squarely multi-Pi coordination
territory by the project's own rule.
