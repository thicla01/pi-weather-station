# Design request — Settings + Debug panel refresh

**Target:** Claude Design
**Author:** thicla01 + Claude (drafting)
**Date:** 2026-05-12
**Project:** pi-weather-station (kiosk weather display, Raspberry Pi + macOS/Linux)
**Relates to:** Direction C UI refresh (see `docs/ui-direction-c-implementation-plan.md`)

---

## Context

We just retained **Direction C — Ambient Layers** for the main kiosk UI refresh
(separate design package `ZBuzz5lra42fwls8dhaJFg`, already validated). That work
modernised the home screen but the two **overlay panels** — Settings and Debug —
are still using the original v2 layout and have accumulated a lot of content
over months of iterative feature additions.

We need a refresh proposal for **both** panels, aligned with Direction C's
visual language (warm-grey palette, floating slabs, source-coded badges, Geist
typography) but with their own information-architecture challenges.

The two panels are reached from the BottomDock — Settings via the gear icon,
Debug via the bug icon (DEBUG=true only).

---

## Current state — Debug panel

Localhost-only, gated by `DEBUG=true` env var. Today renders **12 sections** stacked
in a flexible 2-column grid below a fixed header. On a 7" screen the user has
to scroll a lot and there's no way to jump directly to a section.

**Sections (in display order):**

| Section | Content |
|---|---|
| Header (sticky) | App version + commit + branch / OS + hostname / network URLs / online status |
| Action row | Refresh button / Export CSV / Check for update |
| **ServerConfig** | Platform, hostname, IP, ports, DEBUG/ALLOW_REMOTE flags, settings file path, deploy artefacts changed flag |
| **ServerKpi** | Uptime, heap used/total/rss, cache hit rate/hits/misses, CPU temp, fan RPM, response times per endpoint |
| **ClientKpi** | Page load, FPS, JS heap, per-endpoint API call summary (count/avg/min/max) |
| **ProviderStatus** | Live status from each provider's statuspage (Tomorrow.io, Mapbox, ipapi.co, LocationIQ, Anthropic, RainViewer) |
| **Services** | Last HTTP status + timestamp for each external call we make |
| **Quota** | Hourly/daily/monthly counters per service/endpoint, color-coded thresholds |
| **Cache** | In-memory cache entries with remaining TTL |
| **RemoteClients** | IPs that hit the server when ALLOW_REMOTE=true, with first/last seen + count |
| **Security** | Blocked requests (write attempts from remote clients) |
| **RadarSnapshots** | Last 10 AI-summary radar payloads + per-snapshot Copy + section Export JSON |
| **Logs** | Last 100 lines of `/tmp/weather-server.log` (or `<repo>/server.log` on macOS) |
| **VulnerabilityScan** | Link to Dependabot PRs on GitHub |

**Pain points the maintainer flagged:**

> *« Pour le panneau de débogage, la possibilité de focuser sur certains éléments
> dépendant de la tâche. Par exemple, voir dans un premier temps les paramètres
> serveurs, ensuite les paramètres clients, ou bien les statuts des services
> sans avoir à faire glisser l'information de haut en bas ou de recherche de
> gauche à droite. Sur un petit écran le besoin est encore plus criant. »*

Translation: the user wants **task-focused navigation** — when troubleshooting,
they typically need only one or two sections at a time (e.g. "is the server
healthy?" → ServerConfig + ServerKpi; "is provider X down?" → ProviderStatus +
Services + Quota). The current vertical scroll forces them to wade through
everything.

---

## Current state — Settings panel

Reachable from the BottomDock by anyone (not gated by DEBUG). Today renders
as a single overlay with:

**Basic settings (flat list, top to bottom):**

- **API keys section** (6 fields):
  - Mapbox API key — *required*
  - Tomorrow.io API key — *required*
  - LocationIQ API key — *optional* (reverse geocoding)
  - Anthropic API key — *optional* (AI weather summary)
  - EPA AirNow API key — *optional* (US air quality)
  - OpenAQ API key — *optional* (global air quality fallback)
- **Custom coordinates:** lat / lon (override IP-based geolocation)
- **Misc toggles:** hideMouse, radarSource (RainViewer / ECCC), hideRadarLegend,
  darkModeAuto, language (EN/FR/ES), fontSize (S/M/L), defaultMapZoom, units
  (temperature, speed, length, distance, clock 12/24)
- Save button at bottom

**Advanced settings (collapsible, hidden by default):**

- **Display group:** lightModeStyle (Mapbox style), darkModeStyle, brightness control
- **AI group:** calmDayFastPath, extendedRadius, radarAnalysisEnabled,
  showSamplingPoints

**Remote read-only mode:** when the user accesses the kiosk via SSH tunnel from
a desktop, the panel switches to read-only — API key fields are masked as
"Configured" / "Not configured" pills (the actual key value is never sent to
remote clients).

**Pain points the maintainer flagged:**

> *« Pour le panneau des réglages, je continuerais avec les réglages de bases
> et les réglages avancés. Peut-être que l'on pourrait revoir la section des
> clés et obtenir des propositions sur comment agencer l'information. »*

Translation: keep the **Basic / Advanced split** (it works), but **revisit the
API keys section specifically** — get proposals on how to organize the
information better. The current flat list of 6 keys doesn't communicate
required-vs-optional, doesn't group by function, and doesn't help a new user
understand what to configure first.

---

## Goals for the refresh

### Debug panel

- **Task-focused navigation** — let the user jump straight to the section they
  need without scrolling through everything else.
- **Small-screen first** — the 7" Pi (800×480) is the hardest target; design
  for it primarily, then let it expand on bigger screens.
- **No information loss** — every section currently present should still be
  reachable.
- **Preserve the existing per-section affordances** — CSV export, JSON export,
  Copy buttons on snapshots, etc.

### Settings panel

- **Keep the Basic / Advanced split** — the maintainer explicitly wants to
  retain this dichotomy.
- **Revisit API keys section** — multiple alternatives welcome:
  - Group by required-vs-optional?
  - Group by function (map / weather / AI / air quality)?
  - Provider cards with branding?
  - Setup wizard for first-time installs?
  - Inline status indicators (configured / not configured / invalid)?
- **Remote read-only mode must still work** — API key strings hidden,
  "Configured" status pills shown instead, amber banner explaining why.
- **Consistent with Direction C** — same warm-grey palette, same Geist
  typography, same slab/border/shadow language.

---

## Information architecture for Settings — proposed 4-section structure

The maintainer's preferred grouping for the Settings panel: **four sections**,
organised by **who can change what from where**. Please use this as the
starting structure (Claude Design is free to propose variants on the visual
treatment of each section, but the categorisation itself is locked in).

### Section 1 · **Préférences** (always actionable, everywhere)

Stored in browser `localStorage`. Each viewer has their own preferences,
isolated — a remote user changing their font size doesn't affect the kiosk's
display. No access restriction.

Contents:

- Language (EN / FR / ES)
- Font size (S / M / L)
- Dark mode (auto / on / off)
- Clock format (12 h / 24 h)
- Units: temperature (°F / °C / K), speed (mph / m/s / km/h), length (in / mm),
  distance (mi / km)
- Hide mouse cursor
- Hide radar legend

### Section 2 · **Configuration & API keys** (local edit only, readable everywhere)

Stored in server-side `settings.json`. **Writes are localhost-only** (the
maintainer must be on the Pi itself, either directly or via SSH tunnel).
Reads are allowed remotely — with **API key values masked** to prevent
leakage over the network.

Contents:

- API keys (all 6 — each with a **Required** or **Optional** badge):
  - Mapbox · *Required* — map tiles
  - Tomorrow.io · *Required* — weather data
  - LocationIQ · *Optional* — reverse geocoding (location name lookup)
  - Anthropic · *Optional* — AI weather summary
  - EPA AirNow · *Optional* — US air-quality data
  - OpenAQ · *Optional* — global air-quality fallback
- Custom coordinates (latitude / longitude) — overrides IP-based geolocation
- Radar source (RainViewer / ECCC)
- Indoor temperature (Homebridge integration: host, port, username, password,
  sensorName)
- Screen brightness (hardware-controlled on supported displays)

**Remote behaviour** for this section:

- API key fields show **status pills** instead of the actual value:
  - Green ✓ **Configured** when the server has a non-empty value
  - Grey ○ **Not configured** when empty
  - Optionally red ✕ **Invalid** if we add value validation
- Coordinates and other text fields render as **read-only text** (visible
  but uneditable)
- Toggles render as their current state but **disabled**
- An amber notice at the top of the section reads:
  *« Connexion distante détectée. Pour modifier ces paramètres, ouvrez un
  tunnel SSH depuis votre poste. »* (FR) / *« Remote connection detected.
  To change these settings, open an SSH tunnel from your local machine. »* (EN)
- The link in the amber notice points to the README's "Access from another
  machine" section.

### Section 3 · **Avancé** (collapsible, default closed, local edit only)

Same access semantics as Section 2 (server-side `settings.json`, localhost-only
writes). Hidden behind a collapsible disclosure so a typical user isn't
overwhelmed. The maintainer expands when tuning.

Contents (existing groups + new ones from Direction C):

- **Display:** Mapbox light style variant, Mapbox dark style variant, default
  map zoom level
- **AI:** calm-day fast path, extended radius (50 + 100 km vs 50 km only),
  radar analysis enabled, show sampling points overlay
- **Sleep mode** *(new in Direction C):* stage 1 delay, stage 1 brightness,
  stage 2 enabled, stage 2 delay (these were exposed in the SettingsOverlay
  prototype already)

### Section 4 · **Expérimental** (collapsible, default closed, future)

Reserved for feature flags that gate opt-in beta functionality. Empty today —
but please design the section's empty state so it doesn't look broken when
nothing is inside.

Suggested empty-state copy:

*« Aucune fonctionnalité expérimentale active. Les nouvelles fonctionnalités
en cours de validation apparaîtront ici, désactivées par défaut. »* (FR)

*« No experimental features active. New features under validation will
appear here, disabled by default. »* (EN)

The next experimental flag we know is coming: `experimentalUiC` — the toggle
that will progressively activate Direction C during its multi-PR implementation
cycle. So the section's affordances (toggle, hint, "what does this do" copy)
will be exercised soon.

---

## Remote access semantics — complete mapping

The kiosk supports two modes of access:

1. **Local** — user is on the Pi itself (DSI touchscreen or a browser on the
   Pi's own desktop). All read + write operations succeed.
2. **Remote** — user reaches the kiosk via `ALLOW_REMOTE=true` from another
   device on the LAN (e.g. SSH tunnel `ssh -L 8443:localhost:8443 pi@…`,
   or a direct connection if `ALLOW_REMOTE=true`).

The redesign must honour this access matrix:

| Surface | Local | Remote |
|---|---|---|
| Preferences (Section 1) | Edit | Edit (own localStorage) |
| API keys (Section 2) | Edit + see values | See **status pills only** (Configured / Not configured) |
| Other server config (Section 2) | Edit | Read-only display |
| Advanced (Section 3) | Edit | Read-only display (whole section dimmed) |
| Experimental (Section 4) | Edit | Read-only display |
| Debug button in BottomDock | Visible *only when* `DEBUG=true` | **Never visible** (security) |
| `/api/debug` endpoint | 200 | 403 |
| `/api/update` endpoint | 200 | 403 |

The amber notice that explains the read-only state on remote should appear
**once** at the top of Section 2 — not duplicated in every section, but the
visual "disabled" state should be consistent across Sections 2-4.

---

## Debug button — placement and visibility

The Debug button lives in the **BottomDock** (the row of controls at the
bottom of the InfoPanel, designed in Direction C). It opens the Debug panel
when tapped.

Rules:

- **Visible only when `DEBUG=true`** (server env var, set via
  `bash deploy/toggle-debug.sh`)
- **AND only on local access** — never visible to remote clients, regardless
  of the env var
- **Styling consistent with Direction C BottomDock** — icon (bug glyph),
  label "Debug" below, 44 × 44 px minimum touch target, active state with
  accent underline when the Debug panel is open

The current BottomDock from the Direction C prototype already has placeholder
slots; the Debug button should be the **rightmost slot** (closest to the
gear / Settings button) so the maintainer reaches it naturally when
troubleshooting.

When the Debug panel is open, the Debug button in the dock should show its
**active state** (accent-coloured icon + label, 2 px underline) — consistent
with how other dock buttons indicate their open state.

---

## Open questions / explore options

For each panel, please propose **2-3 distinct directions** so we can compare:

### Debug panel — navigation patterns to explore

- **Tabbed nav:** horizontal or vertical tabs grouping the 12 sections into
  4-5 task buckets (e.g. Server / Client / Network / Logs).
- **Sidebar:** persistent left rail with section links (works well on bigger
  screens, less so on 7").
- **Search/filter:** type a keyword, sections filter live.
- **Collapsible accordion:** sections expand on demand, others collapse to
  keep the panel short.
- **Bottom-sheet pattern:** the panel is a pager, swipe/tap to advance.
- **Combination** — e.g. tabbed nav on desktop, accordion on Pi.

### Settings panel — API keys arrangement to explore

- **Card grid:** each provider gets its own card with logo placeholder,
  required/optional badge, "Configured" status, and the input field.
- **Two-column required / optional:** structural visual distinction.
- **Provider sections with helper copy:** each key gets an explanation of
  what it unlocks (e.g. "Anthropic — enables the AI weather summary").
- **Sectional disclosure:** required fields visible by default, optional
  fields under a "Show optional providers" expandable.
- **Inline status indicator:** small dot or pill next to each key —
  green ✓ configured / grey ○ empty / red ✕ invalid (if we add validation).
- **Setup wizard variant:** for first-time installs, step through keys one
  at a time with skip-this-one option.

### Shared concerns

- **Direction C consistency:** match the warm-grey palette (`bg: #1c1a17`,
  `surface: rgba(38,34,30,0.85)`, etc.), Geist fonts, slab borders.
- **Touch targets ≥ 44 × 44 px** on 7" (kiosk touchscreen).
- **Animations restrained:** Pi 4 GPU — no heavy blur, no large transforms.
- **Sleep-mode awareness:** these panels are dismissed when sleep mode kicks
  in (no special handling required) but their **palette must follow the active
  `timeOfDay`** (day/dusk/night) like the rest of the UI.

---

## Constraints

- **Performance:** target Pi 4 (ARM, weak GPU). No `backdrop-filter: blur(...)`,
  no large box-shadows, no expensive animations.
- **Touch first:** the kiosk is touchscreen; no hover-only affordances.
- **Accessibility:** all controls keyboard-navigable (Tab + Enter/Space).
  Focus outlines visible.
- **i18n:** all visible strings will be translated EN/FR/ES at implementation
  time. Allow ~40 % length variance for FR.
- **Same data shapes:** the underlying `/api/debug` and `settings.json` schemas
  don't change. The redesign is presentational only.

---

## Deliverables

1. **A canvas file** (`Pi Weather Station - Settings & Debug.html` or similar)
   showing the proposed directions side-by-side at the same screen size, both
   panels, with calm + edge-case scenarios (settings panel with all 6 keys
   configured / with none configured / in remote read-only mode; debug panel
   with quotas near the limit / a security event / a stale provider status).
2. **A clickable prototype** (`Pi Weather Station - Settings & Debug Prototype.html`)
   that lets us flip between directions, screen sizes, and scenarios.
3. **`DESIGN-NOTES.md` addendum** documenting the layout strategy, the
   navigation pattern picked, and the rationale for the API keys arrangement.
4. **Screen sizes:** 800×480 (7" Pi), 1366×768 (HD monitor), and 1920×1080
   (Full HD), with the 7" being the priority focus.

---

## Notes

- The maintainer is a solo developer with limited weekly time. Designs that
  imply heavy ongoing maintenance (e.g. two layouts to maintain in parallel)
  are not preferred. **One layout per panel, responsive to screen size.**
- The Debug panel ships with `DEBUG=true` env var. Most end-users never see
  it — the audience is the maintainer + occasional troubleshooter. So the
  visual treatment can lean **utilitarian / dense** without alienating users.
- The Settings panel is **user-facing** — keep it inviting and approachable,
  but precise.

---

## Reference materials

- The main UI design package (`ZBuzz5lra42fwls8dhaJFg`) for the visual
  language, palette tokens, and component conventions. Re-use any of its
  primitives (`SourceBadge`, `ConfidencePill`, etc.) where useful.
- Current Settings panel: `client/src/components/Settings/index.js` and
  `client/src/components/Settings/AdvancedSettings/index.js`.
- Current Debug panel: `client/src/components/Debug/index.js` (~1650 lines —
  the section components are at the top, the panel composition in the middle).
- Screenshots of the current panels (attached) — both at 7" and HD sizes.

Thanks!
