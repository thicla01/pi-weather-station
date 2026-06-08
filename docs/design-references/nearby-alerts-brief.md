# Design Brief — "Nearby alerts" radius overlay

**Purpose:** paste this into [Claude Design](https://claude.ai/design) to produce the visual mock for the *Nearby alerts* feature **before** any React work, per the project's design-first convention. Save the resulting mock as `docs/design-references/nearby-alerts.html`.

**Feature reference:** ROADMAP.md → "🧭 Nearby alerts — configurable-radius overlay (display-only)" and `docs/nearby-alerts-overlay-proposal.md`.

---

## What to design
A set of UI mockups for a **new optional map layer** in an existing weather-station **kiosk** app: it paints active government weather-alert polygons within a **user-set radius** on top of a Leaflet radar map. **Display-only** — it never triggers a notification; it is a "look around me" survey tool.

## Product context / design language ("Ambient" v3)
- **Glance-first kiosk** — finger targets ≥ 44 px, no hover-only affordances, no text links (kiosk has no browser chrome).
- **Four runtime palettes**, switchable at runtime: `day`, `dusk`, `night`, and **`nightRed`** (a red-only night-vision mode — *critical rule: in nightRed, everything stays in the red family; never introduce blue/cyan/green*).
- Warm, editorial, minimal. Translucent surfaces over a map. The map (radar tiles + precipitation) is always the hero; new chrome must stay quiet.

## Design tokens (match these exactly)

**Palettes** (mock at least `day` and `nightRed`, the two extremes):

| token | day | nightRed |
|---|---|---|
| bg | `#f4f0e8` | `#100404` |
| text | `#2a2620` | `#d05050` |
| textDim | `#6d655a` | muted red |
| accent | `#b85a18` | `#c44040` |
| surface (panels / popups) | `rgba(255,250,240,0.85)` | `rgba(40,12,12,0.85)` |
| cool (blue accent) | `#3a5a78` | `#783838` (red-family) |

*(dusk: bg `#1c1a17` / text `#d8d4cc` / accent `#e8a050`; night: bg `#0e0c0a` / accent `#c47030` — show if easy.)*

**Alert tier colours** (polygon fills + chips) — the user already knows these:
- 🔴 Warning / severe `#e60000` · 🟠 Watch / moderate `#ee7710` (fill) / `#f08200` (ring) · 🟡 Advisory / minor `#f0c000`
- Severity chip (day): warn ink `#b03030` on `rgba(220,80,80,0.18)`; watch ink `#b85a2d` on `rgba(232,150,87,0.20)`; advisory ink `#8a6a18` on `rgba(232,200,122,0.18)`.

**Existing radar rings to coexist with** (dashed): risk rings at 50 km / 100 km use `#f0e600` / `#f08200` / `#e60000`; the calm base ring is grey `#a8a097` (dark) / `#3a3938` (light) / `#c04848` (nightRed), weight 2, dashed.

## Screens / states to mock

1. **Map with overlay ON (the hero shot).** A radar-ish basemap with precip blobs, on which: a few **alert polygons** (solid 2 px tier-colour border, ~15 % tier fill — radar must read through); the **three concentric dashed circles** centred on the user marker — the two radar rings (50 / 100 km) **plus a new persistent "alert radius" ring** at e.g. 70 km. The radius ring must be **visually distinct** from the radar rings: use the **`cool` blue accent, dashed** in day/dusk/night — but **in nightRed keep it red-family**, differentiated by a *distinct dash pattern* instead of hue. Show the BottomDock at the bottom edge with the new toggle active.

2. **Dock toggle button — 3 states.** (a) off (idle dock icon, warning-triangle glyph); (b) on (pressed / active style); (c) on **with a count badge** — a small numbered bubble (like an app-icon notification badge) coloured to the **worst tier present** (red > orange > yellow), e.g. red "3". No badge at zero.

3. **Single-alert tap popup** (native map popup anchored to a polygon): one compact line — a **source badge** (small pill "NWS" / "ECCC") + a **severity chip** (the tier-coloured WORD: "WARNING" / "WATCH" / "ADVISORY") + the alert title (e.g. "Severe Thunderstorm Warning"), and one bottom button **"Re-center here"**. No description body.

4. **Multi-alert tap popup** (overlapping alerts at the tapped spot): same popup shell, body becomes a **compact scroll list** — one row per alert (tier-coloured left border + source badge + severity chip + title), header "3 alerts here", capped at ~40 % of screen height with internal scroll, a small "Re-center" affordance per row.

5. **Settings → Advanced → new "Nearby alerts" subsection**: a labelled **range slider** with 6 stops (label reads "50 / 60 / 70 / 80 / 90 / 100 km", or "30–60 mi" in imperial), current value shown, matching the existing Advanced sliders (opacity / brightness) visual style.

6. **Legend additions** (small overlay, corner of map, when layer ON): a tier key (3 swatches → Warning / Watch / Advisory) + a line "N alerts within 70 km" + an honest "+1 not mapped" note when applicable.

## Responsive — the four screen classes the app already handles
The app dispatches layout by viewport width (these are the real breakpoints):

- **Mobile — `< 800 px` wide → LayoutMobile** (portrait-phone PWA; single scrollable column, the map is a maximizable card). Mock at **~390 × 844**.
- **7″ Pi kiosk — `800–1279 px` → LayoutPi.** The official 7″ DSI screen is **800 × 480** — the tightest target, and because height ≤ 520 px it also triggers the app's short-screen adaptations (chart tabs instead of stacked charts; a floating toggle on the map's right edge that collapses the info panel). Mock at **800 × 480**.
- **10″ panel — LayoutPi or LayoutDesktop depending on the panel.** Common 10.1″ resolutions: **1024 × 600** (→ LayoutPi) and **1280 × 800** (→ LayoutDesktop at the 1280 boundary). Mock at **1024 × 600**.
- **Large / desktop — `≥ 1280 px` → LayoutDesktop** (HDMI monitors, the SSH-tunnel desktop view; full-bleed map + floating rail, focus-mode ⛶). Mock at **1280 × 800**, confirm it scales to **1920 × 1080**.

Layout-specific notes for THIS feature:
- **Mobile**: the map is a card inside a scrolling column — the dock toggle, the radius ring and the tap popup must work within the card; the radius slider lives in the Settings section of the scroll column; the legend / count must fit a narrow column.
- **7″ (800 × 480)**: the binding case. Finger targets ≥ 44 px; the multi-alert popup capped at ~40 vh ≈ 190 px must still scroll comfortably; the count badge must be legible small; the three concentric rings + polygons + precip must not turn to mush at this density. **If anything has to give, design it here first.**
- **10″ / desktop**: more breathing room; on desktop the Settings panel does not cover the map, so the **radius-ring live preview while dragging the slider** is visible (a desktop-only nicety) — show that interaction.

## Constraints & pitfalls (learned the hard way)
- **Touch only**: no `:hover` that paints a background (it sticks on touch); no sticky tap-highlight; rely on `:active` / pressed states.
- **Co-display legibility**: the overlay sits over a *busy* radar; the hero shot must prove polygons + 3 rings + precipitation are all still readable. If it looks cluttered, that is the signal to simplify — show your cleanest version.
- **nightRed = night vision**: red family only, no cool hues. Differentiate the radius ring by dash pattern there.
- **Quiet by default**: this is an opt-in survey tool; nothing should scream until the user turns it on.

## Deliverable
One self-contained HTML file with the states above, a **palette switcher** (at least `day` + `nightRed`) and a way to preview the **four screen classes** (resizable frames or a size switcher). Finger-target-sized. English labels are fine (the final app is EN / FR / ES). Save the result to `docs/design-references/nearby-alerts.html`.
