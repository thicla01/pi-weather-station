# US state air quality agencies — coverage survey

> Internal research doc. Created 2026-05-21 to evaluate whether the air-quality orchestrator should add state-agency sources alongside EPA AirNow and OpenAQ. See [airQualityCtrl.js](../server/airQualityCtrl.js) for the current source chain.

## Methodology

The two key questions for each state are: (1) does the state environmental agency publish a real-time air-quality data interface that is *independent* of EPA AirNow, and (2) does OpenAQ relay that agency's data?

Sources consulted on 2026-05-21:

- **OpenAQ v3 providers list** — `GET https://api.openaq.org/v3/providers?limit=1000` with the project's `openAqApiKey`. The full response (171 providers globally) was parsed and bounding boxes used to identify US-relevant entries.
- **EPA AirNow partner pages** — `airnow.gov/partners/state-and-local-partners/` (qualitative, confirms every state participates).
- **State agency websites** — sampled directly for ~12 representative states (CA, TX, NY, FL, PA, MI, OH, GA, NC, CO, WA, AL); the remaining states are inferred from the dominant pattern (AirNow + a public-facing dashboard, no documented REST API). Spot-checks done via WebSearch + WebFetch.
- **AQS API** — confirmed via `aqs.epa.gov` docs as **not real-time** (≥ 6-month lag), so excluded from the "real-time API" classification regardless of which state's data it contains.

The "OpenAQ coverage" column is built from a single fact: the only US provider in OpenAQ v3 that is currently active and broad-coverage is `id=119 "AirNow"`. Everything else in OpenAQ that touches the US is either a research/community network (CMU Pittsburgh, Love My Air Denver, BEACO2N nodes, HabitatMap mobile sensors) or a stale feed that stopped years ago (e.g. provider `id=280 "Texas"` last updated 2016-03-06). **In v3, OpenAQ's US state-agency coverage is, in practice, AirNow re-served.** A state appearing in OpenAQ therefore says nothing about whether OpenAQ would fill an AirNow gap.

This single fact is what made the Decatur AL case interesting: OpenAQ returned a closer station than AirNow at 7 km, but the underlying provider for that station is itself AirNow. The most plausible explanation is that AirNow's observation endpoint applies stricter freshness/QA filtering than what reaches OpenAQ's mirror — same data lake, different filters.

## State-by-state coverage table

Column legend:
- **Data interface**: classification of the *non-AirNow* public surface, if any. "AirNow-only" means the state contributes to AirNow but does not expose an independent real-time data feed.
- **OpenAQ coverage**: in v3, this is effectively "Yes (via AirNow, id 119)" everywhere. Only states that have a *separate* OpenAQ provider beyond AirNow are flagged.

| State | Agency | Data interface | OpenAQ coverage | Notes |
|---|---|---|---|---|
| Alabama | Alabama Dept. of Environmental Management (ADEM) + Jefferson Co. DoH + Huntsville DNR | Dashboard only (`adem.alabama.gov/air`) | Via AirNow only | Triggered this research. Decatur gap was AirNow-side filtering, not a missing agency feed. |
| Alaska | Alaska Dept. of Environmental Conservation (DEC) | Dashboard only (`dec.alaska.gov/air/`) | Via AirNow only | Sparse network; wildfire-driven peaks. |
| Arizona | Arizona Dept. of Environmental Quality (ADEQ) | Dashboard only (`legacy.azdeq.gov/.../webapp/`) | Via AirNow only | Maricopa Co. AQ Dept. is a separate co-contributor. |
| Arkansas | Arkansas Dept. of Energy & Environment (ADEE) | AirNow-only | Via AirNow only | Small monitoring network. |
| California | California Air Resources Board (CARB) + 35 local air districts | REST-ish (AQMIS2 `arb.ca.gov/aqmis2/`, AQview, SCAQMD ArcGIS open-data portal) | Via AirNow only | Best non-AirNow surface in the country. AQMIS2 exposes parameterized URLs returning HTML/CSV; SCAQMD has a true ArcGIS REST endpoint. Worth pursuing if any state goes first. |
| Colorado | Colorado Dept. of Public Health & Environment (CDPHE) | Dashboard only (`cdphe.colorado.gov/.../air-quality-monitoring`) | **Separate**: "Love My Air Denver" (id 13) — Denver schools PM only | Love My Air does not replace CDPHE; school sensors not regulatory-grade. |
| Connecticut | Connecticut Dept. of Energy & Environmental Protection (CT DEEP) | Dashboard only (`portal.ct.gov/deep/air/monitoring-the-air`) | Via AirNow only | Small network, well-fed to AirNow. |
| Delaware | Delaware Dept. of Natural Resources & Environmental Control (DNREC) | AirNow-only | Via AirNow only | — |
| District of Columbia | DC Dept. of Energy & Environment (DOEE) | Dashboard only (`doee.dc.gov`) | Via AirNow only | — |
| Florida | Florida Dept. of Environmental Protection (FDEP) | **REST-capable** (ArcGIS open-data: `geodata.dep.state.fl.us/datasets/current-florida-air-quality`) | Via AirNow only | ArcGIS feature service is the cleanest non-AirNow REST endpoint of any state. Fresh hourly. Strong integration candidate. |
| Georgia | Georgia EPD (Environmental Protection Division) | Dashboard only (`epd.georgia.gov/.../ambient-monitoring-program`) | Via AirNow only | — |
| Hawaii | Hawaii Dept. of Health, Clean Air Branch | Dashboard only (`air.doh.hawaii.gov/home/`) | Via AirNow only | Vog-driven; agency dashboard sometimes carries SO2 that AirNow strips. |
| Idaho | Idaho Dept. of Environmental Quality (IDEQ) | Dashboard only (`airquality.deq.idaho.gov`) | Via AirNow only | Smoke-season dashboard is widely linked but no API. |
| Illinois | Illinois EPA | AirNow-only | Via AirNow only | Chicago metro covered by Cook/Lake supplementary monitors via AirNow. |
| Indiana | Indiana Dept. of Environmental Management (IDEM) | Dashboard only (`in.gov/idem/airquality/`) | Via AirNow only | — |
| Iowa | Iowa Dept. of Natural Resources (Iowa DNR) | AirNow-only | Via AirNow only | — |
| Kansas | Kansas Dept. of Health & Environment (KDHE) | AirNow-only | Via AirNow only | — |
| Kentucky | Kentucky Energy & Environment Cabinet, Div. for Air Quality | Dashboard only (`eec.ky.gov/.../Air-Quality.aspx`) | Via AirNow only | Louisville Metro APCD is a separate co-contributor. |
| Louisiana | Louisiana Dept. of Environmental Quality (LDEQ) | Dashboard only (`deq.louisiana.gov`) | Via AirNow only | — |
| Maine | Maine Dept. of Environmental Protection (Maine DEP) | Dashboard only (`maine.gov/dep/air/`) | Via AirNow only | Smoke transport from QC visible. |
| Maryland | Maryland Dept. of the Environment (MDE) | Dashboard only (`mde.state.md.us/.../Pages/airmonitoring.aspx`) | Via AirNow only | — |
| Massachusetts | Mass. Dept. of Environmental Protection (MassDEP) | Dashboard only (`mass.gov/.../check-current-air-quality`) | Via AirNow only | — |
| Michigan | Michigan EGLE | Dashboard only (`michigan.gov/egle/about/organization/air-quality/`) | Via AirNow only | — |
| Minnesota | Minnesota Pollution Control Agency (MPCA) | Dashboard only (`mpca.state.mn.us/.../air-quality-index`) | Via AirNow only | Cross-border smoke alerts well-handled at agency level. |
| Mississippi | Mississippi Dept. of Environmental Quality (MDEQ) | AirNow-only | Via AirNow only | — |
| Missouri | Missouri Dept. of Natural Resources (Missouri DNR) | Dashboard only (`dnr.mo.gov/air/`) | Via AirNow only | — |
| Montana | Montana Dept. of Environmental Quality (Montana DEQ) | Dashboard only (`todaysair.mtdeq.us`) | Via AirNow only | TodaysAir is a clean dashboard but no documented REST. |
| Nebraska | Nebraska Dept. of Environment & Energy (NDEE) | AirNow-only | Via AirNow only | — |
| Nevada | Nevada Div. of Environmental Protection (NDEP) | Dashboard only (`ndep.nv.gov/.../monitoring`) | Via AirNow only | Clark Co. DAQ is a separate co-contributor (Las Vegas). |
| New Hampshire | NH Dept. of Environmental Services (NHDES) | Dashboard only (`nh.gov/des/.../monitoring.htm`) | Via AirNow only | — |
| New Jersey | NJ Dept. of Environmental Protection (NJDEP) | Dashboard only (`njaqinow.net`) | Via AirNow only | Same vendor (Sonoma Tech "AQ Now") as NY. |
| New Mexico | New Mexico Environment Dept. (NMED) | Dashboard only (`env.nm.gov/.../air-quality/`) | Via AirNow only | Albuquerque Env. Health is a separate co-contributor. |
| New York | NY State Dept. of Environmental Conservation (NYSDEC) | Dashboard (`nyaqinow.net`) — hourly, but no documented API | Via AirNow only | Sonoma Tech "AQ Now" again. Page likely scrapable but not specced as an API. |
| North Carolina | NC Div. of Air Quality (NC DAQ) | Dashboard only (`airquality.climate.ncsu.edu`, hosted at NCSU) | Via AirNow only | — |
| North Dakota | ND Dept. of Environmental Quality | AirNow-only | Via AirNow only | — |
| Ohio | Ohio EPA, Div. of Air Pollution Control | Dashboard only (`epa.ohio.gov/divisions-and-offices/air-pollution-control`) | Via AirNow only | — |
| Oklahoma | Oklahoma Dept. of Environmental Quality (ODEQ) | Dashboard only (`deq.ok.gov/air-quality-division/`) | Via AirNow only | — |
| Oregon | Oregon Dept. of Environmental Quality (Oregon DEQ) | Dashboard only (`oraqi.deq.state.or.us`) | Via AirNow only | LRAPA (Lane Regional) is a separate co-contributor. |
| Pennsylvania | PA Dept. of Environmental Protection (PA DEP) | Dashboard only (`dep.state.pa.us/.../pollt.html`) | **Separate**: "CMU" (id 167) — Pittsburgh research, **dead since 2022-02** | Allegheny Co. Health Dept. and Phila. AMS are separate co-contributors. CMU's OpenAQ entry is a dead feed. |
| Rhode Island | RI Dept. of Environmental Management (RI DEM) | AirNow-only | Via AirNow only | — |
| South Carolina | SC Dept. of Environmental Services (SCDES, formerly SCDHEC) | Dashboard only (`scdhec.gov/.../air-quality-index`) | Via AirNow only | Agency renamed mid-2024. |
| South Dakota | SD Dept. of Agriculture & Natural Resources (DANR) | AirNow-only | Via AirNow only | — |
| Tennessee | TN Dept. of Environment & Conservation (TDEC), Div. of Air Pollution Control | Dashboard only (`tdec.tn.gov/.../air-pollution-control.html`) | Via AirNow only | Memphis-Shelby Co. Health Dept. is a separate co-contributor. |
| Texas | Texas Commission on Environmental Quality (TCEQ) | Dashboard + parameterized CGI (`tceq.texas.gov/cgi-bin/compliance/monops/daily_summary.pl`, GeoTAM viewer, TAMIS) | **Separate**: "Texas" (id 280) — **dead since 2016-03** | Largest non-AirNow network in the US (200+ stations). The CGI URL pattern is scrapable but not a JSON API. The dead OpenAQ provider is the smoking gun: TCEQ stopped feeding OpenAQ a decade ago; if we want their data we go direct. Strong integration candidate. |
| Utah | Utah Dept. of Environmental Quality (Utah DEQ) | Dashboard only (`air.utah.gov`) | Via AirNow only | Wasatch inversion events; agency dashboard often lights up before AirNow rolls forward. |
| Vermont | Vermont Dept. of Environmental Conservation (VT DEC) | AirNow-only | Via AirNow only | — |
| Virginia | Virginia Dept. of Environmental Quality (Virginia DEQ) | Dashboard only (`deq.virginia.gov/.../air-quality-monitoring`) | Via AirNow only | — |
| Washington | WA Dept. of Ecology + 7 local clean-air agencies (Puget Sound CAA, etc.) | Dashboard only (`enviwa.ecology.wa.gov`, plus `pscleanair.gov`) | Via AirNow only | Puget Sound CAA's dashboard is one of the better local-agency surfaces but no documented REST. |
| West Virginia | WV Dept. of Environmental Protection (WVDEP) | AirNow-only | Via AirNow only | — |
| Wisconsin | Wisconsin Dept. of Natural Resources (Wisconsin DNR) | Dashboard only (`dnr.wisconsin.gov/.../AQIForecast`) | Via AirNow only | — |
| Wyoming | Wyoming Dept. of Environmental Quality, Air Quality Division | AirNow-only | Via AirNow only | Sparse, oil-and-gas-driven. |

### OpenAQ US providers excluded from the table (for completeness)

These appear in OpenAQ v3 but do not represent state-agency feeds and do not change any row above:

- `id=66 AirGradient` — global low-cost sensor network, includes US units, not regulatory.
- `id=119 AirNow` — the actual federal AirNow feed; this is what every "Via AirNow only" cell points to.
- `id=166 Clarity` — global low-cost sensor network.
- `id=200 HabitatMap` — mostly NYC personal/mobile AirCasting sensors.
- `id=13 Love My Air Denver` — Denver school PM monitors, active.
- `id=129 / 130 / 132 houston beaco2n / mobile / mobile municipal` — research network, dead since 2017–2019.
- `id=146 richmond beaco2n` — research network, dead 2019.
- `id=149 west oakland` — research network, dead 2017.
- `id=167 CMU` — Pittsburgh research, dead 2022-02.
- `id=280 Texas` — historical TCEQ feed, dead 2016-03.

## Findings

### States worth considering as new orchestrator sources

Two stand out, and only two:

- **Florida (FDEP)** — `geodata.dep.state.fl.us` exposes ArcGIS feature services for "Current Florida Air Quality." This is the closest thing to a documented REST API any state offers, returns GeoJSON-equivalent attribute tables, refreshes hourly, and is the lowest-effort integration on the list.
- **Texas (TCEQ)** — TAMIS / GeoTAM cover 200+ stations including many ADEM-equivalent areas where AirNow's filter drops them. The OpenAQ "Texas" provider being dead since 2016 confirms there is no overlap; if we want this data we must go direct. The interface is HTML/CGI rather than REST, so integration cost is higher (scrape with cached parser), but the coverage payoff is the largest in the country.

A weak third candidate:

- **California (CARB AQMIS2 + SCAQMD ArcGIS)** — fragmented across CARB and 35 local districts. AirNow already aggregates most of it. SCAQMD's ArcGIS portal is REST-clean for the LA basin specifically; not worth the integration unless we have a concrete LA-basin gap.

### States already well-covered by OpenAQ

None, in the way the question is usually asked. OpenAQ's current US coverage is *entirely* a relay of EPA AirNow (plus a few research datasets that are either narrow or dead). Whenever OpenAQ returns a US station closer than AirNow does, it is the *same data lake* with looser filtering — not a different agency. This means OpenAQ's current value to the orchestrator is best understood as "fallback that sometimes finds an AirNow station the AirNow API itself omitted," not "alternative provider network."

### States with no usable public data interface

About 17 states are pure "AirNow-only" — they do not publish any independent real-time interface at all (AR, DE, IL, IA, KS, MS, NE, NH, ND, RI, SD, VT, WV, WY, and a few others with only static dashboards). These are uninteresting regardless of what the orchestrator does: if AirNow drops a station here, we have nothing to fall back to other than Tomorrow.io's `epaIndex`.

The remaining ~30 states publish a dashboard but no documented API. Scraping is technically possible (most are Sonoma Tech "AQ Now" or DEP-branded leaflet maps), but per-state HTML parsers are exactly the maintenance burden the orchestrator is set up to avoid.

## Recommendation

Hold for now. The Decatur AL case is best fixed at the AirNow query layer (relax the freshness window, widen the radius, or fall back to AirNow forecast data when observations are stale) rather than by integrating a state agency, because **ADEM does not publish anything AirNow doesn't already collect**. The same is true for ~45 of the 50 states.

If a second state-agency-shaped gap surfaces and it lands in **Florida or Texas**, integrate those two specifically — FDEP first (lowest effort, ArcGIS REST), TCEQ second (higher effort, CGI scrape, but largest coverage payoff). Everywhere else, the right move is to keep AirNow + OpenAQ + Tomorrow.io and not grow the source list.

One concrete follow-up worth doing before any integration work: instrument the orchestrator to log *which* source served each successful AQI request, so the next time someone reports an AirNow gap we have actual frequency data on whether it's a one-off or a pattern. That tells us whether to invest in FDEP/TCEQ or whether the existing chain is good enough.
