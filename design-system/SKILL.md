---
name: pi-weather-station-ambient
description: Use this skill to design or prototype screens, cards and components for Pi Weather Station's v3 "Ambient Layers" UI (a React weather kiosk for a Raspberry Pi 7" touchscreen, also desktop and mobile PWA). Contains the four runtime palettes (day / dusk / night / nightRed) as themes, the alert-aware hybrid levels, the Geist type contract, the slab recipe, the radar and map chrome tokens, the three-viewport layout grammar and the kiosk/touch rule-set. Extracted from the codebase; the codebase wins on conflict.
user-invocable: true
---

Read `readme.md` in this skill first, then explore the tokens and the guideline cards.

**What this system is.** The design language of a weather kiosk read at arm's length, at night, by touch. Two layers: role tokens (`tokens/`) and four palettes (`themes/`) switched by `data-theme` — plus `data-hybrid` (`light` / `full`) which escalates every slab during a government alert. Components reference **role tokens only** (`--c-*`, `--sev-*`, `--mx-cat-*`, `--rc-*`), never raw hex.

**When building visual artifacts** (mockups, prototypes, handoff HTML): link `styles.css`, set `data-theme="dusk"` (or `night`, `nightRed`; omit for day) and optionally `data-hybrid` on a wrapper, compose from the role tokens, use the fonts in `assets/fonts/`. Show every screen in day **and** dusk, every alert surface in nightRed, and the calm **and** alert states. Output static HTML the user can open.

**When working on production code:** read `readme.md` to become an expert in the Ambient Layers style, then port as React + CSS Modules following the repository's `CLAUDE.md` (JSDoc + PropTypes, EN/FR/ES strings, no inline static styles, effects cleaned up). Map illustrative values back to the codebase's tokens and literal px.

**Always apply the two rule-sets in `readme.md`:**
- *Kiosk & touch* — no hover-painted state; no infinite animation; hit targets ≥ 44 px; external links as QR codes only; the map is never zoomed; four palettes or it is not done; nightRed never relies on colour alone.
- *Alerts & status* — every banner leads with its source badge (ECCC · NWS · RADAR · AIR; TEST is a qualifier); tier colour = CAP severity, never the alert type; no emoji, SVG on currentColor; tabular numerals; real trilingual data, never lorem ipsum.

If invoked without guidance, ask which surface (Pi 800×480 MIN / MID / MAX, desktop ≥ 1280, mobile portrait), which palette(s), calm or alert scenario, and FR / EN / ES — then act as an expert kiosk designer who outputs HTML artifacts or production code as needed.
