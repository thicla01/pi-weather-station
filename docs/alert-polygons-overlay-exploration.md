# Exploration — Continental alert polygons overlay (AccuWeather « Avis des autorités publiques »)

**Status:** exploration only, no implementation work scheduled.
**Authored:** 2026-05-28 after the v3.1 Phase 4d shipped.
**Scope refined:** 2026-05-28 (PM) — repositioned as low-power-first after decomposing the ECCC↔NWS payload disproportion. Original "raw-first then optimize later" path replaced by an optimized-first phasing (see §3.3, §6).
**Reference upstream pattern:** [AccuWeather Government Alerts layer](https://www.accuweather.com/en/weather-radar) — the toggle that paints every active US/Canada gov-alert polygon on top of the radar map.

This document captures what it would take to add a similar feature to the Pi Weather Station, **without committing to building it**. The Phase 4d implementation already renders the polygon for *the active alert the user picks via the AlertBanner footer*; this exploration scopes the much-larger ambition of painting **every active alert in North America simultaneously**.

## 1. The vision

A toggle (likely a new dock button or a Settings flag) that, when ON, overlays every active ECCC + NWS alert polygon across North America on the map, colour-coded by tier:

- 🔴 Red — Tornado Warning, Severe Thunderstorm Warning, Tsunami Warning, evacuation orders
- 🟠 Orange — Watches and Winter Storm Warnings
- 🟡 Yellow — Advisories (typically hidden by default to reduce visual noise)

Tap a polygon → popup with the alert summary (similar to AlertMiniCards but anchored on the map).

## 2. Key UX decision: mutual exclusivity with RainViewer

**Conclusion from the 2026-05-28 design discussion:** if this feature is built, it is **exclusive** with the radar precipitation layer. The toggle flips between:

- **Mode A** — RainViewer tiles visible (current default), no polygons
- **Mode B** — Continental alert polygons visible, no RainViewer tiles

**Why not both:** the radar tiles already carry intense per-pixel colour information (precipitation tiers, motion arrows, risk rings, location marker, ECCC alert popup polygon if active). Overlaying 100-2000+ semi-transparent polygons on top would render the map illegible. AccuWeather's app does this exclusivity for the same reason.

This decision simplifies a few things:
- The basemap (Mapbox / streets-v12) is enough context behind the polygons — no double-layer compositing
- Performance budget on the Pi GPU is freed up (no radar tile fetching during polygon mode)
- The mental model is cleaner — "what am I looking at?" has one answer at a time

## 3. Data volumes — raw and optimized

### 3.1 Raw payload (no filter, no trim)

| Source | Endpoint | Raw volume |
|---|---|---|
| ECCC | `https://api.weather.gc.ca/collections/weather-alerts/items?f=json` (existing feed national, just skip the `pointInPolygon` filter) | ~50 active features, **~200 KB** |
| NWS | `https://api.weather.gov/alerts/active` (sans `?point=`) | 500-2000 active alerts depending on season, **5-20 MB** payload |
| NWS zones | `affectedZones` URLs for zone-based alerts (Red Flag, Heat Adv, etc.) | Worst case: 500 alerts × 3 zones = 1500 zone fetches. Mitigated by the existing 24 h zone cache (commit `ce23f03`) — after first fill, the ~800 stable NWS forecast + fire zones serve 99 % of subsequent lookups for free. |

### 3.2 Why the ~50× disproportion ECCC vs NWS

The raw factor (200 KB vs 5-20 MB) is not "the US is 8× bigger than Canada" — it's a product of several smaller multipliers that compose:

| Facteur | ECCC | NWS |
|---|---|---|
| Population couverte | ~40 M | ~330 M (×8) |
| Alertes simultanées typiques | ~50 | 500-2000 (×10-40) |
| Granularité géographique | ~800 régions météo officielles, polygones simplifiés et stables | Polygones CAP arbitraires déclarés par les ~120 bureaux locaux NWS au moment de l'émission — sommets non plafonnés |
| Verbosity JSON par feature | Concis (~4 KB / feature) | Verbeux : `parameters{}`, `references[]`, `eventCode{}`, `web`, `instruction`, `replacedBy[]` — facilement 10-25 KB / feature |
| Diversité des types | Conservateur (Veille / Avertissement / Bulletin) | Très varié : Special Marine, Beach Hazards, Heat Adv, Air Quality, Red Flag, Frost, Coastal Flood, Rip Current… qui s'accumulent surtout l'été |

Le résultat compose : (×10-40 alertes) × (×2-5 verbosity per feature) explique facilement le facteur 50-100×. **Conclusion clé** : on ne peut pas traiter NWS comme "ECCC en plus gros" — la structure même du payload appelle un traitement différencié.

### 3.3 Reduction strategies for low-power deployment

La cible matérielle (Pi 4, 1-4 GB RAM, GPU modeste) interdit le pattern "fetch tout, render tout". Les stratégies ci-dessous sont listées par ordre de gain et doivent être **empilées côté serveur**, en amont de tout cache RAM ou émission vers le client :

1. **Filtre `?event=` côté requête NWS — gain ~70-90 %**
   NWS supporte la requête `https://api.weather.gov/alerts/active?event=Tornado%20Warning,Severe%20Thunderstorm%20Warning,Flash%20Flood%20Warning,Tornado%20Watch,Severe%20Thunderstorm%20Watch,Hurricane%20Warning,Tsunami%20Warning`. Limiter aux types "à peindre" élimine la majorité des Advisories qui dominent le payload total.

2. **Filtre `?severity=Severe,Extreme` — gain ~50 % additionnel**
   S'empile sur le filtre event. Élimine définitivement le tier jaune (qu'on cachait déjà par défaut dans l'UX proposée §5).

3. **Trim serveur des champs inutiles — gain ~40-60 % additionnel**
   Garder uniquement : `id`, `event` (key i18n), `severity`, `headline`, `expires`, `geometry`, `affectedZones`. Drop : `description`, `instruction`, `parameters`, `references`, `replacedBy`, `eventCode`, `web`, `senderName`. **Le client peut re-fetch `description` complet seulement quand le user tape un polygone** — pattern lazy déjà utilisé pour les détails ECCC dans `AlertBanner`.

4. **`turf.simplify(tolerance: 0.01)` côté serveur — gain ~50-80 % sur la portion geometry**
   Polygones CAP bruts simplifiés une fois à l'arrivée, stockés simplifiés en cache RAM. Le client ne reçoit jamais la version brute.

5. **Cache différentiel par CAP `id` — élimine le re-fetch complet récurrent**
   Polling toutes les 5 min : ne ré-émettre au client que les `id` nouveaux/modifiés (SSE ou simple diff sur l'`updated` timestamp). Pas un gain au premier fetch, mais transforme le coût récurrent en quasi-zéro.

### 3.4 Optimized projections

Avec les stratégies 1+2+3+4 appliquées côté serveur (la 5 étant un additionnel récurrent) :

| Métrique | Sans optims (doc original) | Avec optims §3.3 |
|---|---|---|
| Payload NWS premier fetch | 5-20 MB | **300-800 KB** |
| RAM cache combiné (ECCC+NWS) | ~10-15 MB | **~1-2 MB** |
| Polygones simultanés à peindre | 1000-2000 | **100-300** (orange/rouge filtré) |
| Cold-start kiosk avant premier rendu | +1-3 s | **+0.3-0.8 s** |

**Implication architecturale clé :** viewport clipping et `turf.simplify` côté client passent de **obligatoires-pour-que-le-truc-soit-viable** à **défensifs-souhaitables-mais-non-existentiels**. La nature même du projet change : on ne fait plus du desktop-rendering qu'on essaie d'adapter à un Pi — on conçoit directement pour le Pi.

## 4. Implications matérielles (cible faible puissance)

Le ROADMAP du projet cible une flotte de Pi 4 (1-4 GB RAM) en mode kiosk Chromium. La conception doit être "low-power first", pas "desktop first puis optimisé tant bien que mal".

### Performance / RAM (chiffres post-optims §3.3)

| Aspect | Impact |
|---|---|
| RAM serveur (Node) | ~1-2 MB pour cache alertes + zones. Bruit dans le total ~80-150 MB du process |
| Réseau | Premier fetch ~500 KB-1 MB après filtres ; refresh diff-only via SSE en récurrent |
| Leaflet rendering | 100-300 polygones simultanés — confortable sur Pi 4. Pan/zoom fluide attendu si simplify déjà appliqué côté serveur |
| Cold-start kiosk | +0.3-0.8 s avant premier rendu. Acceptable, pas de spinner requis |
| GPU compositing | Marge confortable — laisse de la place au radar si la décision d'exclusivité §2 est revisitée (cf. question 2 du §7) |

### Optimisations défensives côté client (confort, plus nécessité)

1. **Viewport clipping** — render uniquement les polygones qui intersectent le viewport visible. Skip ~80-95 %.
2. **Layer groups per tier** — `LayerGroup` séparé pour rouge / orange (jaune désactivé par défaut). Toggle de visibilité sans repaint.
3. **Default severity threshold** — rouge + orange uniquement. Jaune opt-in via settings.

### Networking / quotas

- NWS : pas de rate limit formel, mais `User-Agent` requis (déjà en place sur l'instance)
- ECCC : pas de rate limit

Aucune pression additionnelle sur les quotas Tomorrow.io ou Mapbox.

## 5. UX considerations

| Element | Decision |
|---|---|
| Mode toggle location | New button in the BottomDock "Map" group (icon similar to AccuWeather's). Tap flips Mode A ↔ Mode B. |
| Tier colour coding | Reuse the existing red/orange/yellow palette from `SeverityChip` and the Phase 4d single-polygon overlay |
| Polygon style | 2 px border + 15 % fill (same as Phase 4d) |
| Polygon click | Open the same AlertBanner that exists today, scrolled to that alert. Mini-cards list lets the user explore neighbouring active alerts in the area. |
| Legend | Brief mini-legend in the corner: "🔴 Warning 🟠 Watch 🟡 Advisory" + count of currently visible polygons |
| Severity filter | Multi-toggle red ☑ / orange ☑ / yellow ☐ |
| Mobile / 7" Pi behaviour | Same toggle, but yellow is even more aggressively hidden — screen real estate is precious |
| Default state | Mode A (current radar). User opts in to Mode B explicitly. |

## 6. Suggested phasing — optimized-first path

Le phasing original (~8-10 h, "raw d'abord puis optimisations en V2") n'est plus la bonne route. Avec la cible faible-puissance verrouillée, les optimisations §3.3 font **partie du MVP**, pas d'une phase ultérieure.

| Phase | Scope | Effort |
|---|---|---|
| MVP | ECCC alerts (Canada) + NWS alerts via `feature.geometry` direct uniquement (Tornado / Severe Thunderstorm / Flash Flood / Tsunami / Hurricane). **Filtres §3.3 #1 + #2 + #3 + #4 appliqués serveur dès le premier commit.** Mode A/B toggle. `LayerGroup`s par tier. Severity rouge + orange par défaut. | ~4-5 h |
| V2 | Cache différentiel par CAP `id` (stratégie §3.3 #5) — diff over SSE. Légende + count. Re-fetch lazy de `description` au tap polygone. | +2 h |
| V3 | Résolution `affectedZones` NWS pour récupérer les alertes zone-only (Red Flag, Heat Adv, Coastal Flood). Pré-warm du zone cache au démarrage du serveur. Filtre sévérité UI + i18n EN/FR/ES + responsive Pi 7". | +3 h |
| V4 (stretch) | MeteoAlarm (Europe) — bloqué par les obstacles documentés au ROADMAP (EDR API gated, Atom feeds sans polygones). À reconsidérer si user européen apparaît. | +3 h |

**Total réaliste MVP→V3 :** ~9-10 h, équivalent à l'estimation originale, mais avec deux avantages décisifs :

1. **MVP utilisable beaucoup plus tôt** (4-5 h vs 8 h avant V2 dans le plan original) — la valeur arrive en une session
2. **Risque techno-architectural beaucoup plus bas** — pas de pari sur "ça va passer sur le Pi" qui pourrait nécessiter un refactor V2 ; les optims qui rendent le truc viable sont dans le MVP

**Cible matérielle MVP :** Pi 4 (2 GB RAM) en kiosk Chromium. Toute la flotte déployée est sur cette gamme ou mieux.

## 7. Open decisions to settle when we attack this

1. **Toggle granularity** — single bouton "Mode B on/off", or three independent toggles (radar / polygons / arrows) with the constraint that polygons + radar can't both be on?
2. **Mode A/B exclusivity revisitée (§2)** — La décision originale d'exclusivité a été prise sous l'hypothèse de 1000-2000 polygones. À 100-300 polygones après §3.3, est-ce qu'un overlay **non-exclusif** (outline-only, sans fill) par-dessus le radar reste lisible ? À prototyper avant de figer le toggle final. Si oui, le Mode A/B devient un simple toggle "polygones visibles oui/non" plutôt qu'un switch radar↔polygones.
3. **Severity default** — red + orange shown by default, or also yellow? Field test on a "calm day" payload would tell.
4. **Cold-start UX** — when the user first turns Mode B on and the zone cache is empty (V3 seulement), show a spinner? Or just paint progressively as polygons resolve? (Pour MVP/V2, le `+0.3-0.8 s` est sous le seuil perceptif — pas de question.)
5. **Persistence** — does Mode B survive across kiosk reboots? Probably yes via localStorage, like the existing `radarTimelineVisible` etc.
6. **Multi-tab kiosks** — if two browsers connect to the same Pi, do they share the toggle state? Currently each has its own.
7. **MeteoAlarm (Europe)** — bundle in the same toggle or separate toggle? Bundle is simpler; separate is more honest about which areas are covered.

## 8. Why this isn't built right now

Phase 4d already covers the **most-common need**: showing the polygon for the single alert the user is reading about. The exhaustive continental view is a power-user feature with a non-trivial implementation cost and a meaningful runtime cost on the Pi. We agreed on 2026-05-28 that:

- Phase 4d is the right level of investment for the maintainer's actual use case
- The exhaustive view is a "would be nice some day" feature
- Documenting the exploration here avoids losing the design analysis if and when we do come back to it

If priorities shift later (e.g. someone is using the kiosk specifically as a severe-weather monitoring station), this document is the starting point to attack the build with the design decisions already pre-resolved.

**Note 2026-05-28 PM** : la portée a été révisée vers "optimized-first" après décomposition de la disproportion ECCC↔NWS. Le MVP est maintenant plus court (4-5 h) et plus sûr (les optims §3.3 garantissent la viabilité sur Pi avant même le premier rendu), mais la décision "pas maintenant" reste identique — Phase 4d couvre le besoin courant, et aucun user n'a réclamé la vue continentale.

## 9. Related references

- `docs/eccc-radar.md` — sister exploration on swapping RainViewer for ECCC WMS radar (Phase A shipped, Phase B deferred). Useful precedent for "Mode A / Mode B with one radar source at a time".
- `ROADMAP.md` line 140 — `🚨 Critical-tier severe-alert takeover overlay` — different feature (full-screen takeover for tornado / evacuation), but shares the polygon-data path.
- `ROADMAP.md` § MeteoAlarm — third source candidate, would slot into this overlay as a fourth tier of fetch.
- Commit `ce23f03` — NWS `affectedZones` resolution + 24 h zone cache. The infrastructure this exploration would build on top of.
- Commit `765da0b` — Phase 4d single-polygon overlay. The visual pattern to replicate at scale.
