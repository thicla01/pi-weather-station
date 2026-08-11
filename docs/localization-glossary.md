# Localization glossary

<!-- GENERATED FILE — do not edit by hand.
     Regenerate with: node tools/gen-localization-glossary.js
     Validation marks (☑) in the first column ARE preserved across runs. -->

**Generated** by `tools/gen-localization-glossary.js` on 2026-08-10. Re-run it after
touching a locale file or an inline `lbl()` string — every row below is derived, so a
hand edit will be overwritten. The one exception is the **Validé** column: it is human
review state and the generator carries existing `☑` marks forward, matching on the key
(locale rows) or on the EN string (inline rows).

Replace `☐` with `☑` when a native speaker has confirmed the FR and ES wording of a row.

## Where the strings live

| Source | Rows | Notes |
|---|---|---|
| `client/src/i18n/locales/{en,fr,es}.json` | 406 translated + 19 identical | Every kiosk-visible surface. 425 leaf keys total. |
| `client/src/components/ambient/SettingsPanel/index.js` | 108 (+5 non-literal, not listed) | Settings overlay — the user-facing configuration surface. |
| `client/src/components/ambient/DebugPanel/index.js` | 80 | Debug overlay — localhost-only, reached from a desktop browser or an SSH tunnel. |

Inline `lbl(lang, en, fr, es)` is a **codified exception** (see CLAUDE.md), permitted in
`SettingsPanel` and `DebugPanel` only — dense, maintainer-facing configuration surfaces
where keeping the three strings next to their usage beats locale-file indirection. It must
not spread to kiosk-visible surfaces, and never to alert content. **If a fourth language is
ever added, these are the rows that need a migration pass** — they are listed here in full
precisely so that job is scopeable.

## Coverage

✅ Every key in `en.json` has an `fr.json` and `es.json` counterpart, and neither file
carries a key `en.json` doesn't. (Checked at generation time — a mismatch would be
reported here as a gap table, so an empty check means the three files are aligned.)

---

# Locale files

## AI summary view (`aiView.*`)

| Validé | EN | FR | ES | Clé |
|--------|----|----|-----|-----|
| ☐ | Overview | Aperçu | Resumen | `aiView.back` |
| ☐ | Generating summary… | Génération du résumé… | Generando el resumen… | `aiView.loading` |
| ☐ | Next period | Prochaine période | Próximo período | `aiView.nextPeriod` |
| ☐ | Now | Maintenant | Ahora | `aiView.now` |
| ☐ | This evening | Ce soir | Esta noche | `aiView.period.evening` |
| ☐ | Overnight | Cette nuit | Durante la noche | `aiView.period.overnight` |
| ☐ | Tomorrow | Demain | Mañana | `aiView.period.tomorrow` |
| ☐ | Radar analysis | Analyse radar | Análisis de radar | `aiView.radar` |
| ☐ | AI summary | Résumé IA | Resumen IA | `aiView.title` |
| ☐ | AI summary unavailable. | Résumé IA indisponible. | Resumen IA no disponible. | `aiView.unavailable` |

## Alert banner + severity (`alert.*`)

| Validé | EN | FR | ES | Clé |
|--------|----|----|-----|-----|
| ☐ | {{current}} / {{count}} active alert | {{current}} / {{count}} alerte active | {{current}} / {{count}} alerta activa | `alert.activeAlertsCount_one` |
| ☐ | {{current}} / {{count}} active alerts | {{current}} / {{count}} alertes actives | {{current}} / {{count}} alertas activas | `alert.activeAlertsCount_other` |
| ☐ | Air quality alert — {{value}} {{scale}}, {{level}}. Tap for details. | Alerte qualité de l'air — {{value}} {{scale}}, {{level}}. Toucher pour les détails. | Alerta de calidad del aire — {{value}} {{scale}}, {{level}}. Tocar para detalles. | `alert.airQualityAria` |
| ☐ | Collapse | Réduire | Contraer | `alert.collapse` |
| ☐ | Collapse the alert detail to see the map again | Réduire le détail de l'alerte pour revoir la carte | Contraer el detalle de la alerta para volver a ver el mapa | `alert.collapseAria` |
| ☐ | Tap to collapse | Toucher pour replier | Toque para replegar | `alert.collapseRow` |
| ☐ | Show the next alert | Afficher l'alerte suivante | Mostrar la siguiente alerta | `alert.cycleNextAria` |
| ☐ | Dismiss | Masquer | Ocultar | `alert.dismiss` |
| ☐ | Hide for 4 h (resurfaces if it escalates) | Masquer 4 h (réapparaît si ça s'aggrave) | Ocultar 4 h (reaparece si se agrava) | `alert.dismissTooltip` |
| ☐ | Tap to read detail | Toucher pour lire le détail | Toque para leer el detalle | `alert.expandRow` |
| ☐ | Expires {{when}} | Expire {{when}} | Expira {{when}} | `alert.expiresAt` |
| ☐ | Hide zone | Masquer la zone | Ocultar zona | `alert.hideOnMap` |
| ☐ | Hide the alert zone from the radar map | Masquer la zone d'alerte de la carte radar | Ocultar la zona de alerta del mapa de radar | `alert.hideOnMapAria` |
| ☐ | Issued {{days}}d ago | Émis il y a {{days}} j | Emitido hace {{days}} d | `alert.issuedDaysAgo` |
| ☐ | Issued {{hours}}h ago | Émis il y a {{hours}} h | Emitido hace {{hours}} h | `alert.issuedHoursAgo` |
| ☐ | Just issued | Émis à l'instant | Emitido ahora | `alert.issuedJustNow` |
| ☐ | Issued {{minutes}} min ago | Émis il y a {{minutes}} min | Emitido hace {{minutes}} min | `alert.issuedMinutesAgo` |
| ☐ | Heavy precipitation nearby | Précipitations fortes à proximité | Precipitación fuerte en las cercanías | `alert.orangeApproaching` |
| ☐ | Heavy precipitation appears to be approaching | Précipitations fortes qui semblent s'approcher | Precipitación fuerte parece estar acercándose | `alert.orangeApproachingHedged` |
| ☐ | Heavy precipitation drifting around you | Précipitations fortes en mouvement autour de vous | Precipitación fuerte desplazándose en su zona | `alert.orangeDrifting` |
| ☐ | Heavy precipitation intensifying | Précipitations fortes qui s'intensifient | Precipitación fuerte intensificándose | `alert.orangeIntensifying` |
| ☐ | Heavy precipitation moving away | Précipitations fortes mais s'éloignent | Precipitación fuerte alejándose | `alert.orangeLeaving` |
| ☐ | Heavy precipitation appears to be moving away | Précipitations fortes qui semblent s'éloigner | Precipitación fuerte parece estar alejándose | `alert.orangeLeavingHedged` |
| ☐ | Heavy precipitation in your area | Précipitations fortes sur votre zone | Precipitación fuerte en su zona | `alert.orangeNear` |
| ☐ | Alert — Severe precipitation approaching | Alerte — précipitations sévères approchent | Alerta — Precipitación severa acercándose | `alert.redApproaching` |
| ☐ | Severe precipitation appears to be approaching | Précipitations sévères qui semblent s'approcher | Precipitación severa parece estar acercándose | `alert.redApproachingHedged` |
| ☐ | Severe precipitation drifting around you | Précipitations sévères en mouvement autour de vous | Precipitación severa desplazándose en su zona | `alert.redDrifting` |
| ☐ | Alert — Severe precipitation intensifying | Alerte — précipitations sévères qui s'intensifient | Alerta — Precipitación severa intensificándose | `alert.redIntensifying` |
| ☐ | Severe precipitation moving away | Précipitations sévères mais s'éloignent | Precipitación severa alejándose | `alert.redLeaving` |
| ☐ | Severe precipitation appears to be moving away | Précipitations sévères qui semblent s'éloigner | Precipitación severa parece estar alejándose | `alert.redLeavingHedged` |
| ☐ | Alert — Severe precipitation in your area | Alerte — précipitations sévères sur votre zone | Alerta — Precipitación severa en su zona | `alert.redNear` |
| ☐ | Tap to show alerts you dismissed earlier | Toucher pour réafficher les alertes que vous avez masquées | Toque para volver a mostrar las alertas que ocultó | `alert.restoreDismissedAria` |
| ☐ | Restore {{count}} hidden alert | Restaurer {{count}} alerte masquée | Restaurar {{count}} alerta oculta | `alert.restoreDismissed_one` |
| ☐ | Restore {{count}} hidden alerts | Restaurer {{count}} alertes masquées | Restaurar {{count}} alertas ocultas | `alert.restoreDismissed_other` |
| ☐ | What to do | Mesures à prendre | Qué hacer | `alert.sectionAction` |
| ☐ | What's happening | Ce qui se passe | Lo que ocurre | `alert.sectionHazard` |
| ☐ | Possible impacts | Impacts possibles | Posibles impactos | `alert.sectionImpact` |
| ☐ | What was observed | Ce qui a été observé | Lo que se ha observado | `alert.sectionObservation` |
| ☐ | Data source | Source des données | Fuente de datos | `alert.sectionSource` |
| ☐ | When | Période | Periodo | `alert.sectionWhen` |
| ☐ | Affected areas | Zones affectées | Zonas afectadas | `alert.sectionWhere` |
| ☐ | Switch to this alert | Passer à cette alerte | Cambiar a esta alerta | `alert.selectAlertAria` |
| ☐ | Advisory | Avis | Aviso | `alert.severityAdvisory` |
| ☐ | Advisory | Avis | Aviso | `alert.severityAdvisoryShort` |
| ☐ | Emergency | Urgence | Emergencia | `alert.severityEmergency` |
| ☐ | Statement | Bulletin | Boletín | `alert.severityStatement` |
| ☐ | Statement | Bulletin | Boletín | `alert.severityStatementShort` |
| ☐ | Warning | Avertissement | Advertencia | `alert.severityWarning` |
| ☐ | Warning | Avert. | Advert. | `alert.severityWarningShort` |
| ☐ | Watch | Veille | Vigilancia | `alert.severityWatch` |
| ☐ | Watch | Veille | Vigil. | `alert.severityWatchShort` |
| ☐ | Show zone | Afficher la zone | Mostrar zona | `alert.showOnMap` |
| ☐ | Show the alert zone on the radar map | Afficher la zone d'alerte sur la carte radar | Mostrar la zona de alerta en el mapa de radar | `alert.showOnMapAria` |
| ☐ | tomorrow | demain | mañana | `alert.tomorrowShort` |
| ☐ | Also active | Aussi actives | También activas | `alert.view.alsoActive` |
| ☐ | Back to overview | Retour à l'aperçu | Volver al resumen | `alert.view.back` |
| ☐ | Open alert detail | Ouvrir le détail de l'alerte | Abrir el detalle de la alerta | `alert.view.openRow` |
| ☐ | Until {{time}} | Jusqu'à {{time}} | Hasta {{time}} | `alert.view.until` |

## Astronomy — moon phases + solar events (`astronomy.*`)

| Validé | EN | FR | ES | Clé |
|--------|----|----|-----|-----|
| ☐ | Day length | Durée du jour | Duración del día | `astronomy.dayLength` |
| ☐ | First light | Aube civile | Aurora civil | `astronomy.firstLight` |
| ☐ | Last light | Crépuscule civil | Crepúsculo civil | `astronomy.lastLight` |
| ☐ | Moon | Lune | Luna | `astronomy.moonDetails` |
| ☐ | First quarter | Premier quartier | Cuarto creciente | `astronomy.moonPhase.firstQuarter` |
| ☐ | Full moon | Pleine lune | Luna llena | `astronomy.moonPhase.fullMoon` |
| ☐ | Last quarter | Dernier quartier | Cuarto menguante | `astronomy.moonPhase.lastQuarter` |
| ☐ | New moon | Nouvelle lune | Luna nueva | `astronomy.moonPhase.newMoon` |
| ☐ | Waning crescent | Dernier croissant | Menguante | `astronomy.moonPhase.waningCrescent` |
| ☐ | Waning gibbous | Gibbeuse décroissante | Gibosa menguante | `astronomy.moonPhase.waningGibbous` |
| ☐ | Waxing crescent | Premier croissant | Creciente | `astronomy.moonPhase.waxingCrescent` |
| ☐ | Waxing gibbous | Gibbeuse croissante | Gibosa creciente | `astronomy.moonPhase.waxingGibbous` |
| ☐ | Quarter | Quartier | Cuarto | `astronomy.moonPhaseShort.firstQuarter` |
| ☐ | Full moon | Pleine lune | Luna llena | `astronomy.moonPhaseShort.fullMoon` |
| ☐ | Quarter | Quartier | Cuarto | `astronomy.moonPhaseShort.lastQuarter` |
| ☐ | New moon | Nouvelle lune | Luna nueva | `astronomy.moonPhaseShort.newMoon` |
| ☐ | Crescent | Croissant | Menguante | `astronomy.moonPhaseShort.waningCrescent` |
| ☐ | Gibbous | Gibbeuse | Gibosa | `astronomy.moonPhaseShort.waningGibbous` |
| ☐ | Crescent | Croissant | Creciente | `astronomy.moonPhaseShort.waxingCrescent` |
| ☐ | Gibbous | Gibbeuse | Gibosa | `astronomy.moonPhaseShort.waxingGibbous` |
| ☐ | Moonrise | Lever de la lune | Salida de la luna | `astronomy.moonrise` |
| ☐ | Moonset | Coucher de la lune | Puesta de la luna | `astronomy.moonset` |
| ☐ | Next full moon | Prochaine pleine lune | Próxima luna llena | `astronomy.nextFullMoon` |
| ☐ | Next new moon | Prochaine nouvelle lune | Próxima luna nueva | `astronomy.nextNewMoon` |
| ☐ | Phase | Phase | Fase | `astronomy.phase` |
| ☐ | Seasons | Saisons | Estaciones | `astronomy.seasonsTitle` |
| ☐ | December solstice | Solstice de décembre | Solsticio de diciembre | `astronomy.solarEvent.decemberSolstice` |
| ☐ | June solstice | Solstice de juin | Solsticio de junio | `astronomy.solarEvent.juneSolstice` |
| ☐ | March equinox | Équinoxe de mars | Equinoccio de marzo | `astronomy.solarEvent.marchEquinox` |
| ☐ | September equinox | Équinoxe de septembre | Equinoccio de septiembre | `astronomy.solarEvent.septemberEquinox` |
| ☐ | in {{count}} days | dans {{count}} j | en {{count}} d | `astronomy.solarEventDays` |
| ☐ | in {{count}} day | dans {{count}} j | en {{count}} d | `astronomy.solarEventDays_one` |
| ☐ | in {{count}} days | dans {{count}} j | en {{count}} d | `astronomy.solarEventDays_other` |
| ☐ | {{event}} in {{count}} days | {{event}} dans {{count}} j | {{event}} en {{count}} d | `astronomy.solarEventIn` |
| ☐ | {{event}} in {{count}} day | {{event}} dans {{count}} j | {{event}} en {{count}} d | `astronomy.solarEventIn_one` |
| ☐ | {{event}} in {{count}} days | {{event}} dans {{count}} j | {{event}} en {{count}} d | `astronomy.solarEventIn_other` |
| ☐ | Equinox | Équinoxe | Equinoccio | `astronomy.solarEventShort.equinox` |
| ☐ | Solstice | Solstice | Solsticio | `astronomy.solarEventShort.solstice` |
| ☐ | Sun | Soleil | Sol | `astronomy.sunDetails` |
| ☐ | Sunrise | Lever | Amanecer | `astronomy.sunrise` |
| ☐ | Sunset | Coucher | Atardecer | `astronomy.sunset` |
| ☐ | Today | Aujourd'hui | Hoy | `astronomy.today` |
| ☐ | Tomorrow | Demain | Mañana | `astronomy.tomorrow` |

## Badges — UV / air quality / pollen (`badges.*`)

| Validé | EN | FR | ES | Clé |
|--------|----|----|-----|-----|
| ☐ | forecast | prévision | pronóstico | `badges.aqiKindForecast` |
| ☐ | observed | observé | observado | `badges.aqiKindObservation` |
| ☐ | High | Élevé | Alto | `badges.aqiLevel.high` |
| ☐ | Low risk | Risque faible | Riesgo bajo | `badges.aqiLevel.low` |
| ☐ | Moderate | Modéré | Moderado | `badges.aqiLevel.moderate` |
| ☐ | Very high | Très élevé | Muy alto | `badges.aqiLevel.veryHigh` |
| ☐ | Environment Canada AQHI | Cote air santé (Environnement Canada) | AQHI (Environment Canada) | `badges.aqiSourceEccc` |
| ☐ | Montreal RSQA IQA (city air-quality network) | IQA — RSQA Montréal (Ville) | IQA — RSQA Montreal | `badges.aqiSourceMelccMtl` |
| ☐ | Quebec MELCC IQA (RSQAQ provincial network) | IQA — MELCC Québec (RSQAQ) | IQA — MELCC Quebec (RSQAQ) | `badges.aqiSourceMelccRsqaq` |
| ☐ | Alder | Aulne | Aliso | `badges.pollenAllergens.alder_pollen` |
| ☐ | Birch | Bouleau | Abedul | `badges.pollenAllergens.birch_pollen` |
| ☐ | Grass | Graminées | Gramíneas | `badges.pollenAllergens.grass_pollen` |
| ☐ | Mugwort | Armoise | Artemisa | `badges.pollenAllergens.mugwort_pollen` |
| ☐ | Olive | Olivier | Olivo | `badges.pollenAllergens.olive_pollen` |
| ☐ | Ragweed | Herbe à poux | Ambrosía | `badges.pollenAllergens.ragweed_pollen` |
| ☐ | All exposure should be avoided. Unprotected skin can burn in minutes. | Toute exposition est à éviter. La peau non protégée peut brûler en quelques minutes. | Evite toda exposición. La piel desprotegida puede quemarse en minutos. | `badges.uvGuidance.extreme` |
| ☐ | Reduce time in the sun between 11 a.m. and 4 p.m. Sunscreen, hat, and sunglasses recommended. | Réduisez le temps au soleil entre 11 h et 16 h. Écran solaire, chapeau et lunettes recommandés. | Reduzca el tiempo al sol entre las 11 y las 16. Protector solar, sombrero y gafas recomendados. | `badges.uvGuidance.high` |
| ☐ | Minimal risk. No protection needed for most people. | Risque minimal. Aucune protection nécessaire pour la plupart des gens. | Riesgo mínimo. No se necesita protección para la mayoría. | `badges.uvGuidance.low` |
| ☐ | Wear sunglasses, use SPF 30+ sunscreen, seek shade near midday. | Portez des lunettes de soleil, appliquez un écran solaire FPS 30+, recherchez l'ombre près de midi. | Use gafas de sol, protector solar FPS 30+, busque sombra cerca del mediodía. | `badges.uvGuidance.moderate` |
| ☐ | Take extra precautions. Avoid the sun between 11 a.m. and 4 p.m., cover up, and apply SPF 30+ generously. | Précautions supplémentaires nécessaires. Évitez le soleil entre 11 h et 16 h, couvrez-vous, appliquez un FPS 30+ généreusement. | Precauciones adicionales necesarias. Evite el sol entre las 11 y las 16, cúbrase, aplique FPS 30+ generosamente. | `badges.uvGuidance.veryHigh` |
| ☐ | Extreme | Extrême | Extremo | `badges.uvLevel.extreme` |
| ☐ | High | Élevé | Alto | `badges.uvLevel.high` |
| ☐ | Low | Faible | Bajo | `badges.uvLevel.low` |
| ☐ | Moderate | Modéré | Moderado | `badges.uvLevel.moderate` |
| ☐ | Very high | Très élevé | Muy alto | `badges.uvLevel.veryHigh` |

## Charts / forecast tabs (`charts.*`)

| Validé | EN | FR | ES | Clé |
|--------|----|----|-----|-----|
| ☐ | 24 Hour Temp / Precipitation | Temp. 24 heures / Précipitations | Temp. 24 horas / Precipitaciones | `charts.24hourTemp` |
| ☐ | 24 Hour Wind Speed / Precipitation ({{unit}}) | Vent 24 heures / Précipitations ({{unit}}) | Viento 24 horas / Precipitaciones ({{unit}}) | `charts.24hourWind` |
| ☐ | 5 Day Temp / Precipitation | Temp. 5 jours / Précipitations | Temp. 5 días / Precipitaciones | `charts.5dayTemp` |
| ☐ | 5 Day Wind Speed / Precipitation ({{unit}}) | Vent 5 jours / Précipitations ({{unit}}) | Viento 5 días / Precipitaciones ({{unit}}) | `charts.5dayWind` |
| ☐ | Auto-selected | Sélection auto | Selección automática | `charts.autoSelected` |
| ☐ | probability | probabilité | probabilidad | `charts.legendProb` |
| ☐ | speed | vitesse | velocidad | `charts.legendSpeed` |
| ☐ | Maximize | Agrandir | Ampliar | `charts.maximize` |
| ☐ | Overlay precipitation on this chart | Superposer les précipitations sur ce graphique | Superponer la precipitación en este gráfico | `charts.overlayPrecip` |
| ☐ | 5 days | 5 jours | 5 días | `charts.period5d` |
| ☐ | avg | moy. | prom. | `charts.pillAvg` |
| ☐ | dominant | dominant | dominante | `charts.pillDominant` |
| ☐ | gusts | rafales | rachas | `charts.pillGusts` |
| ☐ | max | max | máx | `charts.pillMax` |
| ☐ | min | min | mín | `charts.pillMin` |
| ☐ | peak | pic | pico | `charts.pillPeak` |
| ☐ | low | creux | valle | `charts.pillTrough` |
| ☐ | Precipitation | Précipitations | Precipitaciones | `charts.precipitation` |
| ☐ | Restore | Restaurer | Restaurar | `charts.restore` |
| ☐ | Days | Jours | Días | `charts.tabDays` |
| ☐ | Hours | Heures | Horas | `charts.tabHours` |
| ☐ | Precip | Précip | Precip | `charts.tabPrecip` |
| ☐ | Wind | Vent | Viento | `charts.tabWind` |
| ☐ | Temp | Temp. | Temp. | `charts.temp` |
| ☐ | Forecast | Prévisions | Pronóstico | `charts.title` |
| ☐ | Wind | Vent | Viento | `charts.windSpeed` |

## Compass directions (`compass.*`)

| Validé | EN | FR | ES | Clé |
|--------|----|----|-----|-----|
| ☐ | NW | NO | NO | `compass.nw` |
| ☐ | SW | SO | SO | `compass.sw` |
| ☐ | W | O | O | `compass.w` |

## conditions (`conditions.*`)

| Validé | EN | FR | ES | Clé |
|--------|----|----|-----|-----|
| ☐ | Overview | Aperçu | Resumen | `conditions.back` |
| ☐ | Open the conditions detail | Ouvrir le détail des conditions | Abrir el detalle de condiciones | `conditions.openAria` |
| ☐ | Conditions | Conditions | Condiciones | `conditions.title` |

## Controls / dock buttons (`controls.*`)

| Validé | EN | FR | ES | Clé |
|--------|----|----|-----|-----|
| ☐ | Close debug panel | Fermer le panneau de débogage | Cerrar el panel de depuración | `controls.closeDebug` |
| ☐ | Close places | Fermer les lieux | Cerrar lugares | `controls.closePlaces` |
| ☐ | Close settings | Fermer les paramètres | Cerrar los ajustes | `controls.closeSettings` |
| ☐ | Close update modal | Fermer la fenêtre de mise à jour | Cerrar la ventana de actualización | `controls.closeUpdate` |
| ☐ | Switch to dark mode | Passer en mode sombre | Cambiar a modo oscuro | `controls.darkMode` |
| ☐ | Disable auto dark/light mode | Désactiver la bascule sombre/clair automatique | Desactivar alternancia oscuro/claro automática | `controls.disableAutoMode` |
| ☐ | Disable night-vision red palette | Désactiver la palette rouge | Desactivar paleta roja | `controls.disableNightRed` |
| ☐ | Hide radar analysis rings | Masquer les cercles d'analyse radar | Ocultar los círculos de análisis radar | `controls.disableRadarRings` |
| ☐ | Enable auto dark/light mode | Activer la bascule sombre/clair automatique | Activar alternancia oscuro/claro automática | `controls.enableAutoMode` |
| ☐ | Enable night-vision red palette | Activer la palette rouge (vision nocturne) | Activar paleta roja (visión nocturna) | `controls.enableNightRed` |
| ☐ | Show radar analysis rings | Afficher les cercles d'analyse radar | Mostrar los círculos de análisis radar | `controls.enableRadarRings` |
| ☐ | Focus radar (hide panels) | Focus radar (masquer les panneaux) | Enfocar radar (ocultar paneles) | `controls.focusRadar` |
| ☐ | Display | Affichage | Visualización | `controls.groupDisplay` |
| ☐ | Map | Carte | Mapa | `controls.groupMap` |
| ☐ | System | Système | Sistema | `controls.groupSystem` |
| ☐ | Views | Vues | Vistas | `controls.groupViews` |
| ☐ | Hide AI summary section | Masquer la section IA | Ocultar la sección de IA | `controls.hideAiSummary` |
| ☐ | Hide location marker | Masquer le marqueur de position | Ocultar el marcador de ubicación | `controls.hideMarker` |
| ☐ | Hide nearby alerts | Masquer les alertes à proximité | Ocultar alertas cercanas | `controls.hideNearbyAlerts` |
| ☐ | Hide radar legend | Masquer la légende radar | Ocultar leyenda del radar | `controls.hideRadarLegend` |
| ☐ | Hide radar timeline | Masquer la chronologie radar | Ocultar la línea de tiempo del radar | `controls.hideTimeline` |
| ☐ | Switch to light mode | Passer en mode clair | Cambiar a modo claro | `controls.lightMode` |
| ☐ | Expand radar | Agrandir le radar | Ampliar el radar | `controls.maximizeRadar` |
| ☐ | Restore radar size | Restaurer la taille du radar | Restaurar el tamaño del radar | `controls.minimizeRadar` |
| ☐ | Open AI summary | Ouvrir le résumé IA | Abrir el resumen IA | `controls.openAiView` |
| ☐ | Open debug panel | Ouvrir le panneau de débogage | Abrir el panel de depuración | `controls.openDebug` |
| ☐ | Open forecast | Ouvrir les prévisions | Abrir el pronóstico | `controls.openForecast` |
| ☐ | Open places | Ouvrir les lieux | Abrir lugares | `controls.openPlaces` |
| ☐ | Open settings | Ouvrir les paramètres | Abrir los ajustes | `controls.openSettings` |
| ☐ | Show update modal | Afficher la fenêtre de mise à jour | Mostrar la ventana de actualización | `controls.openUpdate` |
| ☐ | Expand the radar first to use this control | Agrandissez d'abord le radar pour utiliser ce contrôle | Amplíe primero el radar para usar este control | `controls.radarOverlaysNeedMaximize` |
| ☐ | Re-center here | Recentrer ici | Recentrar aquí | `controls.recenterHere` |
| ☐ | Refresh app | Rafraîchir l'application | Actualizar la aplicación | `controls.refreshApp` |
| ☐ | Recenter map on current location | Recentrer la carte sur la position actuelle | Centrar el mapa en la ubicación actual | `controls.resetMapPosition` |
| ☐ | Restore panels | Restaurer les panneaux | Restaurar paneles | `controls.restorePanels` |
| ☐ | Show AI summary section | Afficher la section IA | Mostrar la sección de IA | `controls.showAiSummary` |
| ☐ | Show location marker | Afficher le marqueur de position | Mostrar el marcador de ubicación | `controls.showMarker` |
| ☐ | Show nearby alerts | Afficher les alertes à proximité | Mostrar alertas cercanas | `controls.showNearbyAlerts` |
| ☐ | Show radar legend | Afficher la légende radar | Mostrar leyenda del radar | `controls.showRadarLegend` |
| ☐ | Show radar timeline | Afficher la chronologie radar | Mostrar la línea de tiempo del radar | `controls.showTimeline` |
| ☐ | Update available — connect locally to install | Mise à jour disponible — connectez-vous en local pour installer | Actualización disponible — conéctese en local para instalar | `controls.updateAvailableRemote` |

## dateFormat (`dateFormat.*`)

| Validé | EN | FR | ES | Clé |
|--------|----|----|-----|-----|
| ☐ | cccc LLLL d | cccc d LLLL | cccc d 'de' LLLL | `dateFormat` |

## Debug panel — chrome (`debug.*`)

| Validé | EN | FR | ES | Clé |
|--------|----|----|-----|-----|
| ☐ | LOADING... | CHARGEMENT... | CARGANDO... | `debug.loading` |
| ☐ | REFRESH | ACTUALISER | ACTUALIZAR | `debug.refresh` |
| ☐ | DEBUG | DÉBOGAGE | DEPURACIÓN | `debug.title` |

## Errors / loading states (`errors.*`)

| Validé | EN | FR | ES | Clé |
|--------|----|----|-----|-----|
| ☐ | Cannot get 5 day weather forecast | Impossible d'obtenir les prévisions sur 5 jours | No se pueden obtener los pronósticos de 5 días | `errors.dailyForecastFailed` |
| ☐ | Cannot get 24 hour weather forecast | Impossible d'obtenir les prévisions sur 24 heures | No se pueden obtener los pronósticos de 24 horas | `errors.hourlyForecastFailed` |

## favorites (`favorites.*`)

| Validé | EN | FR | ES | Clé |
|--------|----|----|-----|-----|
| ☐ | Current position | Position actuelle | Posición actual | `favorites.currentPosition` |
| ☐ | Done | Terminé | Hecho | `favorites.done` |
| ☐ | Edit | Modifier | Modificar | `favorites.edit` |
| ☐ | Open a place on the map, tap its name, then “Pin this place”. | Ouvrez un lieu sur la carte, touchez son nom, puis « Épingler ce lieu ». | Abra un lugar en el mapa, toque su nombre y luego «Anclar este lugar». | `favorites.empty` |
| ☐ | List full — remove one first | Liste pleine — retirez-en un | Lista llena — quite uno | `favorites.full` |
| ☐ | Default | Par défaut | Por defecto | `favorites.isDefault` |
| ☐ | Pin this place | Épingler ce lieu | Anclar este lugar | `favorites.pin` |
| ☐ | Pinned | Épinglé | Anclado | `favorites.pinned` |
| ☐ | Editing requires local access. | La modification exige un accès local. | La edición requiere acceso local. | `favorites.remoteReadOnly` |
| ☐ | Remove | Retirer | Quitar | `favorites.remove` |
| ☐ | Remove? | Retirer ? | ¿Quitar? | `favorites.removeConfirm` |
| ☐ | Rename | Renommer | Renombrar | `favorites.rename` |
| ☐ | Enter to save, Esc to cancel | Entrée pour enregistrer, Échap pour annuler | Intro para guardar, Esc para cancelar | `favorites.renameHint` |
| ☐ | Could not save — check the connection | Enregistrement impossible — vérifiez la connexion | No se pudo guardar — revise la conexión | `favorites.saveFailed` |
| ☐ | Set as default | Définir par défaut | Definir por defecto | `favorites.setDefault` |
| ☐ | Places | Lieux | Lugares | `favorites.title` |

## Gov't alert detail (`govAlertDetail.*`)

| Validé | EN | FR | ES | Clé |
|--------|----|----|-----|-----|
| ☐ | No additional detail provided for this alert. | Aucun détail additionnel fourni pour cette alerte. | No se proporcionó detalle adicional para esta alerta. | `govAlertDetail.noDetail` |
| ☐ | Scan to open on your phone | Scannez pour ouvrir sur votre téléphone | Escanee para abrir en su teléfono | `govAlertDetail.qrCaption` |

## Service health indicator (`health.*`)

| Validé | EN | FR | ES | Clé |
|--------|----|----|-----|-----|
| ☐ | All services OK | Tous les services fonctionnent | Todos los servicios funcionan | `health.allOk` |
| ☐ | Services | Services | Servicios | `health.chipPrefix` |
| ☐ | A critical service is down | Un service critique est en panne | Un servicio crítico está caído | `health.criticalDown` |
| ☐ | Some non-critical services degraded | Certains services non critiques sont dégradés | Algunos servicios no críticos están degradados | `health.degraded` |
| ☐ | Nothing to report. | Rien à signaler. | Nada que reportar. | `health.noIssues` |
| ☐ | GitHub (updates) | GitHub (mises à jour) | GitHub (actualizaciones) | `health.provider.github` |
| ☐ | Major outage | Panne majeure | Interrupción mayor | `health.providerIndicator.critical` |
| ☐ | Under maintenance | En maintenance | En mantenimiento | `health.providerIndicator.maintenance` |
| ☐ | Partial outage | Panne partielle | Interrupción parcial | `health.providerIndicator.major` |
| ☐ | Degraded performance | Performance dégradée | Rendimiento degradado | `health.providerIndicator.minor` |
| ☐ | Operational | Opérationnel | Operacional | `health.providerIndicator.none` |
| ☐ | Unknown | État inconnu | Desconocido | `health.providerIndicator.unknown` |
| ☐ | Upstream services | Services en amont | Servicios externos | `health.providerStatusHeader` |
| ☐ | Server unreachable | Serveur injoignable | Servidor inaccesible | `health.serverUnreachable` |
| ☐ | Critical | Critique | Crítico | `health.shortCritical` |
| ☐ | Degraded | Dégradé | Degradado | `health.shortDegraded` |
| ☐ | Offline | Hors ligne | Sin conexión | `health.shortOffline` |
| ☐ | Service health | État des services | Estado de los servicios | `health.title` |

## Indoor temperature (`indoor.*`)

| Validé | EN | FR | ES | Clé |
|--------|----|----|-----|-----|
| ☐ | Excellent | Excellente | Excelente | `indoor.airQuality.1` |
| ☐ | Good | Bonne | Buena | `indoor.airQuality.2` |
| ☐ | Fair | Moyenne | Aceptable | `indoor.airQuality.3` |
| ☐ | Inferior | Mauvaise | Mala | `indoor.airQuality.4` |
| ☐ | Poor | Très mauvaise | Muy mala | `indoor.airQuality.5` |
| ☐ | INDOOR | INTÉRIEUR | INTERIOR | `indoor.label` |

## location (`location.*`)

| Validé | EN | FR | ES | Clé |
|--------|----|----|-----|-----|
| ☐ | Coordinates | Coordonnées | Coordenadas | `location.coordinates` |
| ☐ | Country | Pays | País | `location.country` |
| ☐ | County | Comté / MRC | Condado | `location.county` |
| ☐ | Location | Lieu | Ubicación | `location.details` |
| ☐ | Neighbourhood | Quartier | Barrio | `location.district` |
| ☐ | City | Ville | Ciudad | `location.locality` |
| ☐ | No address found at this point. | Aucune adresse trouvée à ce point. | No se encontró una dirección en este punto. | `location.noAddress` |
| ☐ | Postal code | Code postal | Código postal | `location.postcode` |
| ☐ | State / Region | Province / Région | Estado / Región | `location.region` |
| ☐ | Source: LocationIQ | Source : LocationIQ | Fuente: LocationIQ | `location.source` |

## Metrics grid (`metrics.*`)

| Validé | EN | FR | ES | Clé |
|--------|----|----|-----|-----|
| ☐ | AQI | IQA | ICA | `metrics.aqi` |
| ☐ | Reading age | Âge de la lecture | Antigüedad de la lectura | `metrics.detailAge` |
| ☐ | All allergens | Tous les allergènes | Todos los alérgenos | `metrics.detailAllergens` |
| ☐ | Reading type | Type de lecture | Tipo de lectura | `metrics.detailKind` |
| ☐ | Pollutant | Polluant | Contaminante | `metrics.detailPollutant` |
| ☐ | Source | Source | Fuente | `metrics.detailSource` |
| ☐ | Station | Station | Estación | `metrics.detailStation` |
| ☐ | Value | Valeur | Valor | `metrics.detailValue` |
| ☐ | Highest | Plus élevé | Máximo | `metrics.detailWorst` |
| ☐ | Gust | Rafales | Ráfagas | `metrics.gust` |
| ☐ | Humidity | Humidité | Humedad | `metrics.humidity` |
| ☐ | Pollen | Pollen | Polen | `metrics.pollen` |
| ☐ | Pressure | Pression | Presión | `metrics.pressure` |
| ☐ | Visibility | Visibilité | Visibilidad | `metrics.visibility` |
| ☐ | Wind | Vent | Viento | `metrics.wind` |

## mobile (`mobile.*`)

| Validé | EN | FR | ES | Clé |
|--------|----|----|-----|-----|
| ☐ | Open the app on the Pi locally for advanced settings. | Pour les réglages avancés, ouvre l'app depuis le Pi en local. | Para los ajustes avanzados, abre la app desde el Pi en local. | `mobile.settingsHint` |

## Nowcast line (`nowcast.*`)

| Validé | EN | FR | ES | Clé |
|--------|----|----|-----|-----|
| ☐ | Radar status: {{verdict}} | État du radar : {{verdict}} | Estado del radar: {{verdict}} | `nowcast.aria` |
| ☐ | Clear and sunny | Soleil radieux | Cielo despejado | `nowcast.calm.clearDay` |
| ☐ | Clear night | Nuit claire | Noche despejada | `nowcast.calm.clearNight` |
| ☐ | Overcast | Ciel couvert | Cielo cubierto | `nowcast.calm.cloudy` |
| ☐ | Fog | Brouillard | Niebla | `nowcast.calm.fog` |
| ☐ | Light precipitation | Précipitations légères | Precipitación ligera | `nowcast.calm.lightPrecip` |
| ☐ | Light snow | Neige légère | Nieve ligera | `nowcast.calm.lightSnow` |
| ☐ | No rain within {{distance}} {{unit}} | Aucune pluie sur {{distance}} {{unit}} | Sin lluvia en {{distance}} {{unit}} | `nowcast.calm.noRainWithin` |
| ☐ | Nothing on radar | Rien sur le radar | Nada en el radar | `nowcast.calm.none` |
| ☐ | A few clouds | Quelques nuages | Algunas nubes | `nowcast.calm.partly` |
| ☐ | Radar unavailable | Radar indisponible | Radar no disponible | `nowcast.calm.radarUnavailable` |

## Radar — legend + timeline (`radar.*`)

| Validé | EN | FR | ES | Clé |
|--------|----|----|-----|-----|
| ☐ | Enable radar rings first to use direction arrows | Activez d'abord les cercles radar pour utiliser les flèches | Active primero los círculos radar para usar las flechas | `radar.directionArrowsNeedRings` |
| ☐ | Extreme | Extrême | Extremo | `radar.extreme` |
| ☐ | Hide direction arrows | Masquer les flèches de direction | Ocultar flechas de dirección | `radar.hideDirectionArrows` |
| ☐ | Close | Fermer | Cerrar | `radar.legendClose` |
| ☐ | Open the legend | Ouvrir la légende | Abrir la leyenda | `radar.legendOpen` |
| ☐ | Precipitation | Précipitations | Precipitación | `radar.legendPrecip` |
| ☐ | Analysis radii | Rayons d'analyse | Radios de análisis | `radar.legendRadii` |
| ☐ | Legend | Légende | Leyenda | `radar.legendTitle` |
| ☐ | Light | Léger | Ligero | `radar.light` |
| ☐ | {{count}} alerts here | {{count}} alertes ici | {{count}} alertas aquí | `radar.nearbyHere` |
| ☐ | +{{count}} not mapped | +{{count}} non cartographiée(s) | +{{count}} no mapeada(s) | `radar.nearbyNotMapped` |
| ☐ | Nearby alerts | Alertes à proximité | Alertas cercanas | `radar.nearbyTitle` |
| ☐ | {{count}} within {{radius}} {{unit}} | {{count}} dans {{radius}} {{unit}} | {{count}} en {{radius}} {{unit}} | `radar.nearbyWithin` |
| ☐ | Show direction arrows | Afficher les flèches de direction | Mostrar flechas de dirección | `radar.showDirectionArrows` |
| ☐ | {{hours}} h ago | Il y a {{hours}} h | Hace {{hours}} h | `radar.timeline.agoHours` |
| ☐ | {{min}} min ago | Il y a {{min}} min | Hace {{min}} min | `radar.timeline.agoMin` |
| ☐ | Forecast · {{off}} | Prévision · {{off}} | Pronóstico · {{off}} | `radar.timeline.forecastChip` |
| ☐ | Fcst {{off}} | Prév. {{off}} | Pron. {{off}} | `radar.timeline.forecastChipShort` |
| ☐ | {{past}} past frames · {{future}} forecast | {{past}} trames passées · {{future}} prévisions | {{past}} imágenes pasadas · {{future}} de pronóstico | `radar.timeline.frameCounts` |
| ☐ | {{past}} + {{future}} frames | {{past}} + {{future}} trames | {{past}} + {{future}} imágenes | `radar.timeline.frameCountsShort` |
| ☐ | {{past}} past frames | {{past}} trames passées | {{past}} imágenes pasadas | `radar.timeline.framesPastOnly` |
| ☐ | now | maintenant | ahora | `radar.timeline.now` |
| ☐ | Now | Maintenant | Ahora | `radar.timeline.nowMarker` |
| ☐ | Pause radar animation | Mettre en pause l'animation radar | Pausar la animación del radar | `radar.timeline.pauseAria` |
| ☐ | Play radar animation | Lancer l'animation radar | Iniciar la animación del radar | `radar.timeline.playAria` |
| ☐ | Return to current radar frame | Revenir à l'image radar actuelle | Volver al fotograma actual del radar | `radar.timeline.returnToNowAria` |
| ☐ | Scrub through radar frames | Parcourir les images radar | Recorrer los fotogramas del radar | `radar.timeline.scrubberAria` |
| ☐ | Radar frame list is stale — the last refresh failed | Liste des trames périmée — le dernier rafraîchissement a échoué | Lista de imágenes obsoleta — la última actualización falló | `radar.timeline.sourceStale` |
| ☐ | Cycle radar animation speed | Changer la vitesse de l'animation radar | Cambiar la velocidad de la animación del radar | `radar.timeline.speedAria` |
| ☐ | Previous frame | Image précédente | Fotograma anterior | `radar.timeline.stepBackAria` |
| ☐ | Next frame | Image suivante | Fotograma siguiente | `radar.timeline.stepForwardAria` |
| ☐ | Zoom in | Zoom avant | Acercar | `radar.zoomIn` |
| ☐ | Zoom out | Zoom arrière | Alejar | `radar.zoomOut` |

## toasts (`toasts.*`)

| Validé | EN | FR | ES | Clé |
|--------|----|----|-----|-----|
| ☐ | AI summary hidden | Section IA masquée | Sección IA ocultada | `toasts.aiSummaryHidden` |
| ☐ | AI summary shown | Section IA affichée | Sección IA mostrada | `toasts.aiSummaryShown` |
| ☐ | Auto mode off | Mode automatique désactivé | Modo automático desactivado | `toasts.autoModeOff` |
| ☐ | Auto mode on | Mode automatique activé | Modo automático activado | `toasts.autoModeOn` |
| ☐ | Dark mode on | Mode sombre activé | Modo oscuro activado | `toasts.darkModeOn` |
| ☐ | Debug panel closed | Panneau de débogage fermé | Panel de depuración cerrado | `toasts.debugClosed` |
| ☐ | Debug panel opened | Panneau de débogage ouvert | Panel de depuración abierto | `toasts.debugOpened` |
| ☐ | Enable radar rings first | Activez d'abord les cercles radar | Active primero los círculos radar | `toasts.directionArrowsNeedRings` |
| ☐ | Direction arrows off | Flèches de direction désactivées | Flechas de dirección desactivadas | `toasts.directionArrowsOff` |
| ☐ | Direction arrows on | Flèches de direction activées | Flechas de dirección activadas | `toasts.directionArrowsOn` |
| ☐ | Default location updated | Emplacement par défaut mis à jour | Ubicación por defecto actualizada | `toasts.favoriteDefaultSet` |
| ☐ | Radar legend hidden | Légende radar masquée | Leyenda radar ocultada | `toasts.legendHidden` |
| ☐ | Radar legend shown | Légende radar affichée | Leyenda radar mostrada | `toasts.legendShown` |
| ☐ | Light mode on | Mode clair activé | Modo claro activado | `toasts.lightModeOn` |
| ☐ | Map recentered | Carte recentrée | Mapa recentrado | `toasts.mapRecentered` |
| ☐ | Marker hidden | Marqueur masqué | Marcador ocultado | `toasts.markerHidden` |
| ☐ | Marker shown | Marqueur affiché | Marcador mostrado | `toasts.markerShown` |
| ☐ | Nearby alerts off | Alertes à proximité désactivées | Alertas cercanas desactivadas | `toasts.nearbyAlertsOff` |
| ☐ | Nearby alerts on | Alertes à proximité activées | Alertas cercanas activadas | `toasts.nearbyAlertsOn` |
| ☐ | Night-red palette off | Palette rouge désactivée | Paleta roja desactivada | `toasts.nightRedOff` |
| ☐ | Night-red palette on | Palette rouge activée | Paleta roja activada | `toasts.nightRedOn` |
| ☐ | Expand the radar first | Agrandissez d'abord le radar | Amplíe primero el radar | `toasts.radarOverlaysNeedMaximize` |
| ☐ | Radar rings off | Cercles radar masqués | Círculos radar ocultados | `toasts.radarRingsOff` |
| ☐ | Radar rings on | Cercles radar affichés | Círculos radar mostrados | `toasts.radarRingsOn` |
| ☐ | Refreshing… | Rafraîchissement… | Actualizando… | `toasts.refreshing` |
| ☐ | Settings closed | Paramètres fermés | Ajustes cerrados | `toasts.settingsClosed` |
| ☐ | Settings opened | Paramètres ouverts | Ajustes abiertos | `toasts.settingsOpened` |
| ☐ | Radar timeline hidden | Chronologie radar masquée | Cronología radar ocultada | `toasts.timelineHidden` |
| ☐ | Radar timeline shown | Chronologie radar affichée | Cronología radar mostrada | `toasts.timelineShown` |
| ☐ | Update available — ask the kiosk admin | Mise à jour disponible — avisez l'admin du kiosque | Actualización disponible — avisa al admin del kiosco | `toasts.updateRemoteNotice` |

## Update modal (`update.*`)

| Validé | EN | FR | ES | Clé |
|--------|----|----|-----|-----|
| ☐ | Update available: v{{version}} | Mise à jour disponible : v{{version}} | Actualización disponible: v{{version}} | `update.available` |
| ☐ | Update available | Mise à jour disponible | Actualización disponible | `update.availableNoVersion` |
| ☐ | Copied! | Copié ! | ¡Copiado! | `update.copied` |
| ☐ | Copy | Copier | Copiar | `update.copy` |
| ☐ | This update changes installed scripts or service files that the one-click button can't refresh on its own. Run the full command above on the device — `bash deploy/install.sh` is idempotent and will refresh only what has diverged: | Cette mise à jour modifie des scripts ou fichiers de service installés que le bouton ne peut pas rafraîchir automatiquement. Exécute la commande complète ci-dessus sur l'appareil — `bash deploy/install.sh` est idempotent et ne rafraîchira que ce qui a divergé : | Esta actualización modifica scripts o archivos de servicio instalados que el botón no puede actualizar por sí solo. Ejecuta el comando completo de arriba en el dispositivo — `bash deploy/install.sh` es idempotente y solo actualizará lo que ha divergido: | `update.deployArtefactsChanged` |
| ☐ | Done! | Fait ! | ¡Hecho! | `update.done` |
| ☐ | Failed | Échec | Error | `update.failed` |
| ☐ | New | Nouveau | Nuevo | `update.feat` |
| ☐ | Fix | Correctif | Corrección | `update.fix` |
| ☐ | latest | dernier | último | `update.latest` |
| ☐ | Your installed version is too old for the one-click update (pre-v2.4.1, before /api/update started running npm install). The auto-update would land new dependencies as missing-module crashes. Run the full command above to upgrade safely via deploy/install.sh. | Ta version installée est trop ancienne pour la mise à jour en un clic (pré-v2.4.1, avant que /api/update lance npm install). L'auto-update planterait sur des modules manquants. Exécute la commande complète ci-dessus pour mettre à jour proprement via deploy/install.sh. | Tu versión instalada es demasiado antigua para la actualización con un clic (pre-v2.4.1, antes de que /api/update ejecutase npm install). La actualización automática fallaría con módulos faltantes. Ejecuta el comando completo de arriba para actualizar de forma segura vía deploy/install.sh. | `update.needsManualUpgrade` |
| ☐ | No changelog available for this update. | Aucun journal des modifications disponible. | No hay registro de cambios disponible. | `update.noChangelog` |
| ☐ | Then restart the server manually: | Redémarrez le serveur manuellement : | Reinicie el servidor manualmente: | `update.noSystemd` |
| ☐ | Faster | Optim. | Más rápido | `update.perf` |
| ☐ | Polish | Polish | Pulido | `update.polish` |
| ☐ | Release | Version | Versión | `update.release` |
| ☐ | Restarting... | Redémarrage... | Reiniciando... | `update.restarting` |
| ☐ | SKIP THIS VERSION | IGNORER CETTE VERSION | IGNORAR ESTA VERSIÓN | `update.skip` |
| ☐ | Polish | Polish | Pulido | `update.style` |
| ☐ | Update | Mettre à jour | Actualizar | `update.update` |
| ☐ | Updating... | Mise à jour... | Actualizando... | `update.updating` |
| ☐ | WHAT'S NEW | NOUVEAUTÉS | NOVEDADES | `update.whatsNew` |

## Weather codes + current conditions (`weather.*`)

| Validé | EN | FR | ES | Clé |
|--------|----|----|-----|-----|
| ☐ | Clear | Dégagé | Despejado | `weather.clear` |
| ☐ | Cloudy | Nuageux | Nublado | `weather.cloudy` |
| ☐ | Drizzle | Bruine | Llovizna | `weather.drizzle` |
| ☐ | Feels like | Ressenti | Sensación | `weather.feelsLike` |
| ☐ | Flurries | Rafales de neige | Ráfagas de nieve | `weather.flurries` |
| ☐ | Fog | Brouillard | Niebla | `weather.fog` |
| ☐ | Freezing drizzle | Bruine verglaçante | Llovizna helada | `weather.freezingDrizzle` |
| ☐ | Freezing rain | Pluie verglaçante | Lluvia helada | `weather.freezingRain` |
| ☐ | Heavy freezing rain | Pluie verglaçante forte | Lluvia helada intensa | `weather.heavyFreezingRain` |
| ☐ | Heavy ice pellets | Grésil intense | Granizo intenso | `weather.heavyIcePellets` |
| ☐ | Heavy rain | Pluie forte | Lluvia intensa | `weather.heavyRain` |
| ☐ | Heavy snow | Neige forte | Nevada intensa | `weather.heavySnow` |
| ☐ | Ice pellets | Grésil | Granizo | `weather.icePellets` |
| ☐ | Light fog | Brume légère | Neblina ligera | `weather.lightFog` |
| ☐ | Light freezing rain | Pluie verglaçante légère | Lluvia helada ligera | `weather.lightFreezingRain` |
| ☐ | Light ice pellets | Grésil léger | Granizo ligero | `weather.lightIcePellets` |
| ☐ | Light rain | Pluie légère | Lluvia ligera | `weather.lightRain` |
| ☐ | Light snow | Neige légère | Nieve ligera | `weather.lightSnow` |
| ☐ | Light wind | Vent léger | Viento suave | `weather.lightWind` |
| ☐ | Mostly clear | Majoritairement dégagé | Mayormente despejado | `weather.mostlyClear` |
| ☐ | Mostly cloudy | Majoritairement nuageux | Mayormente nublado | `weather.mostlyCloudy` |
| ☐ | Partly cloudy | Partiellement nuageux | Parcialmente nublado | `weather.partlyCloudy` |
| ☐ | Rain | Pluie | Lluvia | `weather.rain` |
| ☐ | Snow | Neige | Nieve | `weather.snow` |
| ☐ | Strong wind | Vent fort | Viento fuerte | `weather.strongWind` |
| ☐ | Thunder storm | Orage | Tormenta | `weather.thunderStorm` |
| ☐ | Wind | Vent | Viento | `weather.wind` |

---

# Inline trilingual strings (`lbl()`)

## SettingsPanel

Settings overlay — the user-facing configuration surface. Source: `client/src/components/ambient/SettingsPanel/index.js`.

> 5 further `lbl()` calls in this file build
> at least one label from a template or a variable rather than a plain string literal,
> so there is no fixed wording to tabulate. They are counted here rather than dropped
> silently — a translation pass has to read those call sites directly.

| Validé | EN | FR | ES | Ligne |
|--------|----|----|-----|-------|
| ☐ | Local | Préf. | Local | `:46` |
| ☐ | Advanced | Avancé | Avanzado | `:48` |
| ☐ | Settings sections | Sections des paramètres | Secciones de ajustes | `:158` |
| ☐ | Close settings and return to the map | Fermer les paramètres et revenir à la carte | Cerrar los ajustes y volver al mapa | `:190` |
| ☐ | Close | Fermer | Cerrar | `:196` |
| ☐ | Local preferences | Préférences locales | Preferencias locales | `:264` |
| ☐ | Stored in the browser. No restart required. | Stockées dans le navigateur. Pas de redémarrage requis. | Almacenadas en el navegador. Sin reinicio. | `:265` |
| ☐ | Language | Langue | Idioma | `:273` |
| ☐ | Clock | Horloge | Reloj | `:297` |
| ☐ | Units | Unités | Unidades | `:303` |
| ☐ | Metric | Métrique | Métrico | `:312` |
| ☐ | Imperial | Impérial | Imperial | `:313` |
| ☐ | Speed | Vent | Viento | `:339` |
| ☐ | Length | Précip. | Precip. | `:345` |
| ☐ | Pressure | Pression | Presión | `:361` |
| ☐ | Hide mouse pointer | Masquer le pointeur de la souris | Ocultar puntero del ratón | `:370` |
| ☐ | Show advisory alerts | Afficher les avis | Mostrar avisos | `:388` |
| ☐ | Also surface advisory-level alerts (Flood / Heat / Wind Advisory). Off by default. | Affiche aussi les alertes de niveau « avis » (avis de crue, de chaleur, de vent). Désactivé par défaut. | Muestra también las alertas de nivel « aviso » (aviso de inundación, calor, viento). Desactivado por defecto. | `:389` |
| ☐ | Show test alerts | Afficher les alertes de test | Mostrar alertas de prueba | `:410` |
| ☐ | Reveal NWS test/exercise alerts (non-Actual status) on this device. Maintainer / R&D — hidden by default, never sent to remote viewers. | Affiche les alertes de test/exercice NWS (statut non « Actual ») sur cet appareil. Mainteneur / R&D — masquées par défaut, jamais envoyées aux clients distants. | Muestra las alertas de prueba/ejercicio de NWS (estado no « Actual ») en este dispositivo. Mantenedor / I+D — ocultas por defecto, nunca enviadas a clientes remotos. | `:411` |
| ☐ | Show alert radius ring | Afficher l'anneau du rayon d'alerte | Mostrar el anillo del radio de alerta | `:429` |
| ☐ | Draws the dashed circle at the alert radius. Turn off to keep only the alert polygons. On by default. | Trace le cercle pointillé au rayon d'alerte. Désactiver pour ne garder que les polygones d'alerte. Activé par défaut. | Dibuja el círculo punteado en el radio de alerta. Desactívalo para conservar solo los polígonos de alerta. Activado por defecto. | `:430` |
| ☐ | Auto-select forecast tab | Sélection auto de l'onglet | Selección automática de pestaña | `:447` |
| ☐ | Switches Temp/Wind/Precip when the weather turns. Off by default. | Bascule Temp/Vent/Précip selon la météo. Désactivé par défaut. | Cambia Temp/Viento/Precip. según el tiempo. Desactivado por defecto. | `:448` |
| ☐ | Trust this Pi on this device | Faire confiance à ce Pi sur cet appareil | Confiar en este Pi en este dispositivo | `:467` |
| ☐ | Installs the Pi's certificate as a trusted profile. Fixes the home-screen icon on iOS and dismisses the security warning. See the guide for per-platform steps. | Installe le certificat du Pi comme profil de confiance. Corrige l'icône d'écran d'accueil sur iOS et fait disparaître l'avertissement de sécurité. Voir le guide pour les étapes par plateforme. | Instala el certificado del Pi como perfil de confianza. Corrige el icono de la pantalla de inicio en iOS y elimina la advertencia de seguridad. Vea la guía para los pasos por plataforma. | `:473` |
| ☐ | Download cert | Télécharger le cert | Descargar cert | `:480` |
| ☐ | Read the guide | Lire le guide | Leer la guía | `:492` |
| ☐ | Map tiles + styles | Tuiles de carte + styles | Teselas y estilos de mapa | `:647` |
| ☐ | Hourly + daily forecast | Prévisions horaires + 5 jours | Pronóstico horario + 5 días | `:649` |
| ☐ | Reverse geocoding · place name | Géocodage inverse · nom de lieu | Geocodificación inversa · nombre del lugar | `:651` |
| ☐ | AI weather summary (Claude Haiku) | Résumé météo IA (Claude Haiku) | Resumen meteorológico IA (Claude Haiku) | `:653` |
| ☐ | US air-quality index (AQI) | Indice qualité d'air US (AQI) | Índice de calidad del aire EE.UU. (AQI) | `:655` |
| ☐ | Global air-quality fallback | Repli qualité d'air mondial | Calidad del aire global (respaldo) | `:657` |
| ☐ | Configuration & API keys | Configuration & clés API | Configuración y claves API | `:664` |
| ☐ | Server-side settings.json. Local writes only. | settings.json côté serveur. Écriture locale uniquement. | settings.json del servidor. Escritura local únicamente. | `:665` |
| ☐ | READ-ONLY | LECTURE SEULE | SOLO LECTURA | `:672` |
| ☐ | EDITABLE | MODIFIABLE | EDITABLE | `:673` |
| ☐ | API keys | Clés API | Claves API | `:681` |
| ☐ | Location & hardware | Localisation & matériel | Ubicación y hardware | `:692` |
| ☐ | Latitude | Latitude | Latitud | `:703` |
| ☐ | Latitude | Latitude | Latitud | `:711` |
| ☐ | Override | Manuel | Manual | `:712` |
| ☐ | Auto | Auto | Auto | `:719` |
| ☐ | Empty = automatic geolocation. « Auto » clears the field to fall back to detection. Never sent to an external service. | Vide = géolocalisation automatique. « Auto » efface le champ pour revenir à la détection. Jamais transmis à un service externe. | Vacío = geolocalización automática. « Auto » borra el campo para volver a la detección. Nunca se envía a un servicio externo. | `:720` |
| ☐ | Override | Manuel | Manual | `:737` |
| ☐ | Auto | Auto | Auto | `:744` |
| ☐ | Empty = automatic geolocation. | Vide = géolocalisation automatique. | Vacío = geolocalización automática. | `:745` |
| ☐ | Radar source | Source radar | Fuente radar | `:752` |
| ☐ | Brightness | Luminosité | Brillo | `:760` |
| ☐ | Display scale | Échelle d'affichage | Escala de pantalla | `:772` |
| ☐ | Auto | Auto | Auto | `:776` |
| ☐ | Settable only from the kiosk. | Réglable seulement depuis le kiosque. | Solo ajustable desde el quiosco. | `:787` |
| ☐ | Saving… | Enregistrement… | Guardando… | `:812` |
| ☐ | ✓ Saved | ✓ Enregistré | ✓ Guardado | `:814` |
| ☐ | Save changes | Enregistrer | Guardar cambios | `:815` |
| ☐ | Advanced | Avancé | Avanzado | `:907` |
| ☐ | Display · AI · sleep | Affichage · IA · veille | Pantalla · IA · suspensión | `:908` |
| ☐ | Display | Affichage | Pantalla | `:913` |
| ☐ | Map · light | Carte · clair | Mapa · claro | `:917` |
| ☐ | Map · dark | Carte · sombre | Mapa · oscuro | `:928` |
| ☐ | Radar opacity · light | Opacité radar · clair | Opacidad radar · claro | `:938` |
| ☐ | Radar opacity · dark | Opacité radar · sombre | Opacidad radar · oscuro | `:948` |
| ☐ | Nearby alerts | Alertes à proximité | Alertas cercanas | `:961` |
| ☐ | Alert radius | Rayon d'alerte | Radio de alerta | `:967` |
| ☐ | AI · radar analysis | IA · analyse radar | IA · análisis radar | `:979` |
| ☐ | Radar analysis enabled | Analyse radar activée | Análisis radar activado | `:989` |
| ☐ | Analysis rings + AI radar summary | Cercles d'analyse + résumé IA radar | Anillos de análisis + resumen IA radar | `:993` |
| ☐ | Adds the outer ring | Ajoute l'anneau extérieur | Añade el anillo exterior | `:1009` |
| ☐ | Sampling points | Points d'échantillonnage | Puntos de muestreo | `:1012` |
| ☐ | Show points read by the sampler | Affiche les points lus par le détecteur | Muestra los puntos leídos por el muestreador | `:1016` |
| ☐ | AI call savings when skies are calm | Économie d'appels IA quand le ciel est calme | Ahorro de llamadas IA cuando el cielo está despejado | `:1026` |
| ☐ | Pauses the AI radar analysis when no precipitation is nearby. | Suspend l'analyse radar par IA en l'absence de précipitations. | Pausa el análisis de radar por IA cuando no hay precipitación cerca. | `:1033` |
| ☐ | Pollen badge | Badge pollen | Insignia de polen | `:1039` |
| ☐ | Show pollen in the metrics grid (Europe + most metros) | Affiche le pollen dans la grille (Europe + grandes villes) | Mostrar polen en la cuadrícula (Europa + grandes ciudades) | `:1047` |
| ☐ | Sleep | Veille | Suspensión | `:1056` |
| ☐ | Enable sleep | Activer la veille | Activar suspensión | `:1074` |
| ☐ | Red text at night | Texte rouge nuit | Texto rojo de noche | `:1080` |
| ☐ | Soft sleep · delay | Veille douce · délai | Suspensión suave · retraso | `:1088` |
| ☐ | Soft sleep · brightness | Veille douce · lum. | Suspensión suave · brillo | `:1097` |
| ☐ | Soft sleep · brightness | Veille douce · lum. | Suspensión suave · brillo | `:1107` |
| ☐ | Deep sleep · enabled | Veille profonde · activée | Suspensión profunda · activada | `:1118` |
| ☐ | Deep sleep · +delay | Veille profonde · +délai | Suspensión profunda · +retraso | `:1130` |
| ☐ | Sense HAT | Sense HAT | Sense HAT | `:1148` |
| ☐ | Display | Affichage | Pantalla | `:1152` |
| ☐ | Weather | Météo | Tiempo | `:1154` |
| ☐ | Clock | Horloge | Reloj | `:1155` |
| ☐ | Radar | Radar | Radar | `:1156` |
| ☐ | Auto | Auto | Auto | `:1157` |
| ☐ | Clock brightness | Luminosité horloge | Brillo del reloj | `:1170` |
| ☐ | Radar brightness | Luminosité radar | Brillo radar | `:1189` |
| ☐ | Diagnostic | Diagnostic | Diagnóstico | `:1203` |
| ☐ | Debug panel | Panneau Débogage | Panel depuración | `:1207` |
| ☐ | (set via DEBUG=true on the service) | (défini par DEBUG=true au service) | (definido por DEBUG=true en el servicio) | `:1210` |
| ☐ | disabled | désactivée | desactivada | `:1315` |
| ☐ | On | Allumé | Encendido | `:1325` |
| ☐ | Soft sleep | Veille douce | Suspensión suave | `:1329` |
| ☐ | Deep sleep | Veille profonde | Suspensión profunda | `:1333` |
| ☐ | Tap again — screen blacks ~15 s | Encore — écran noir ~15 s | Otra vez — pantalla negra ~15 s | `:1480` |
| ☐ | Relaunch kiosk to apply | Relancer le kiosque pour appliquer | Reiniciar el quiosco para aplicar | `:1481` |
| ☐ | Applied live · stored on this device | Appliqué en direct · stocké sur cet appareil | Aplicado en vivo · guardado en este dispositivo | `:1537` |
| ☐ | Keys & coordinates saved together via Save | Clés et coordonnées enregistrées ensemble via Enregistrer | Claves y coordenadas guardadas juntas con Guardar | `:1541` |
| ☐ | Each setting saved to settings.json on change | Chaque réglage enregistré dans settings.json au changement | Cada ajuste se guarda en settings.json al cambiar | `:1545` |
| ☐ | Remote connection detected. To change these settings, open an SSH tunnel from your local machine and reload the app from https://localhost:8443. | Connexion distante détectée. Pour modifier ces paramètres, ouvrez un tunnel SSH depuis votre poste local et rechargez l'application depuis https://localhost:8443. | Conexión remota detectada. Para modificar estos ajustes, abra un túnel SSH desde su equipo local y recargue la app desde https://localhost:8443. | `:1579` |
| ☐ | Copy command | Copier la commande | Copiar comando | `:1590` |
| ☐ | Copy command | Copier la commande | Copiar comando | `:1591` |
| ☐ | Copied! | Copié ! | ¡Copiado! | `:1594` |
| ☐ | Copy | Copier | Copiar | `:1595` |

## DebugPanel

Debug overlay — localhost-only, reached from a desktop browser or an SSH tunnel. Source: `client/src/components/ambient/DebugPanel/index.js`.

| Validé | EN | FR | ES | Ligne |
|--------|----|----|-----|-------|
| ☐ | Shown | Affiché | Visible | `:276` |
| ☐ | Update available | Mise à jour disponible | Actualización disponible | `:305` |
| ☐ | UPD | MAJ | ACT | `:307` |
| ☐ | Close | Fermer | Cerrar | `:337` |
| ☐ | Updated | Actualisé | Actualizado | `:350` |
| ☐ | ON | ACTIF | ACTIVO | `:426` |
| ☐ | OFF | INACTIF | INACTIVO | `:427` |
| ☐ | NONE | AUCUN | NINGUNO | `:434` |
| ☐ | MINOR | MINEUR | MENOR | `:435` |
| ☐ | MAJOR | MAJEUR | MAYOR | `:436` |
| ☐ | CRITICAL | CRITIQUE | CRÍTICO | `:437` |
| ☐ | MAINTENANCE | MAINTENANCE | MANTENIMIENTO | `:438` |
| ☐ | Server | Serveur | Servidor | `:524` |
| ☐ | Client | Client | Cliente | `:525` |
| ☐ | Services | Services | Servicios | `:526` |
| ☐ | Storage | Stockage | Almacén | `:527` |
| ☐ | About | À propos | Acerca de | `:528` |
| ☐ | Server config | Configuration serveur | Configuración servidor | `:736` |
| ☐ | version | version | versión | `:738` |
| ☐ | none | aucun | ninguno | `:742` |
| ☐ | branch | branche | rama | `:743` |
| ☐ | Network | Réseau | Red | `:756` |
| ☐ | Server KPI | KPI serveur | KPI servidor | `:769` |
| ☐ | Power status | État alimentation | Estado de alimentación | `:788` |
| ☐ | Response times | Temps de réponse | Tiempos de respuesta | `:795` |
| ☐ | avg | moy | prom | `:801` |
| ☐ | Recent logs | Journaux récents | Registros recientes | `:808` |
| ☐ | Offline — check the connection | Hors ligne — vérifiez la connexion | Sin conexión — compruebe la conexión | `:852` |
| ☐ | Online · degraded network | En ligne · réseau dégradé | En línea · red degradada | `:854` |
| ☐ | Online · slow network | En ligne · réseau lent | En línea · red lenta | `:856` |
| ☐ | Online · fast network | En ligne · réseau rapide | En línea · red rápida | `:857` |
| ☐ | No logs to show. | Aucun journal à afficher. | Sin registros para mostrar. | `:944` |
| ☐ | Client KPI | KPI client | KPI cliente | `:1055` |
| ☐ | Current position | Position actuelle | Posición actual | `:1077` |
| ☐ | API calls (session) | Appels API (session) | Llamadas API (sesión) | `:1101` |
| ☐ | avg | moy | prom | `:1110` |
| ☐ | Remote clients | Clients distants | Clientes remotos | `:1116` |
| ☐ | No remote clients tracked yet. | Aucun client distant suivi. | Ningún cliente remoto rastreado. | `:1118` |
| ☐ | Security events | Événements de sécurité | Eventos de seguridad | `:1135` |
| ☐ | No security events. | Aucun événement de sécurité. | Ningún evento de seguridad. | `:1137` |
| ☐ | BLOCKED | BLOQUÉ | BLOQUEADO | `:1142` |
| ☐ | Provider statuspages | Statut fournisseurs | Estado de proveedores | `:1165` |
| ☐ | last fetch | dernière requête | última consulta | `:1167` |
| ☐ | No provider status available. | Aucun statut fournisseur disponible. | Estado del proveedor no disponible. | `:1171` |
| ☐ | Recent service calls | Appels de service récents | Llamadas de servicio recientes | `:1188` |
| ☐ | No service activity yet. | Aucune activité de service. | Sin actividad de servicio. | `:1190` |
| ☐ | API quotas | Quotas API | Cuotas API | `:1207` |
| ☐ | No quota data tracked yet. | Aucune donnée de quota suivie. | Sin datos de cuota rastreados. | `:1208` |
| ☐ | Cache stats | Statistiques de cache | Estadísticas de caché | `:1315` |
| ☐ | hits | succès | aciertos | `:1317` |
| ☐ | misses | manqués | fallos | `:1318` |
| ☐ | hit rate | taux de succès | tasa de aciertos | `:1319` |
| ☐ | entries | entrées | entradas | `:1320` |
| ☐ | Cache entries | Entrées de cache | Entradas de caché | `:1323` |
| ☐ | Cache is empty. | Cache vide. | Caché vacío. | `:1325` |
| ☐ | Radar AI snapshots | Captures radar IA | Capturas radar IA | `:1339` |
| ☐ | No radar snapshots yet. | Aucune capture radar pour l'instant. | Sin capturas radar todavía. | `:1385` |
| ☐ | Checking… | Vérification… | Comprobando… | `:1482` |
| ☐ | Check for updates | Vérifier les mises à jour | Buscar actualizaciones | `:1483` |
| ☐ | Checking… | Vérification… | Comprobando… | `:1487` |
| ☐ | Check for updates | Vérifier les mises à jour | Buscar actualizaciones | `:1488` |
| ☐ | Export CSV | Exporter CSV | Exportar CSV | `:1494` |
| ☐ | Export CSV | Exporter CSV | Exportar CSV | `:1497` |
| ☐ | About this build | À propos de cette version | Acerca de esta versión | `:1501` |
| ☐ | name | nom | nombre | `:1503` |
| ☐ | version | version | versión | `:1504` |
| ☐ | branch | branche | rama | `:1506` |
| ☐ | license | licence | licencia | `:1508` |
| ☐ | Update check | Vérification MAJ | Comprobación actualización | `:1515` |
| ☐ | This install is too old for the in-app updater. Run | Cette installation est trop ancienne pour la mise à jour in-app. Lancez | Esta instalación es demasiado antigua para el actualizador in-app. Ejecuta | `:1527` |
| ☐ | on the device to upgrade. | sur l'appareil pour mettre à jour. | en el dispositivo para actualizar. | `:1533` |
| ☐ | Install update… | Installer la mise à jour… | Instalar actualización… | `:1553` |
| ☐ | latest ver | dernière ver | última ver | `:1562` |
| ☐ | available | disponible | disponible | `:1563` |
| ☐ | YES | OUI | SÍ | `:1564` |
| ☐ | UP-TO-DATE | À JOUR | AL DÍA | `:1565` |
| ☐ | Vulnerability scan | Analyse vulnérabilités | Análisis vulnerabilidades | `:1572` |
| ☐ | Vulnerability scanning + automatic security PRs now live on GitHub via Dependabot — see the alerts dashboard for the live source of truth. | L'analyse des vulnérabilités et les PR de sécurité automatiques vivent maintenant sur GitHub via Dependabot — voir le tableau d'alertes pour la source en temps réel. | El análisis de vulnerabilidades y los PR de seguridad automáticos viven ahora en GitHub vía Dependabot — consulta el panel de alertas para la fuente en tiempo real. | `:1575` |
| ☐ | Check security alerts on GitHub | Vérifier les alertes de sécurité sur GitHub | Ver las alertas de seguridad en GitHub | `:1596` |
| ☐ | POWER OK | ALIMENTATION OK | ALIMENTACIÓN OK | `:1663` |

---

# Universal strings (identical across EN / FR / ES)

Pure abbreviations, units, proper nouns and technical markers. Listed for completeness so
a translator can confirm they are deliberately untranslated rather than overlooked.

| Valeur | Clé |
|---|---|
| {{current}} / {{count}} | `alert.activeAlertsCountShort` |
| TEST | `alert.testTag` |
| NowCast | `badges.aqiKindNowcast` |
| EPA AirNow | `badges.aqiSourceAirNow` |
| OpenAQ | `badges.aqiSourceOpenAq` |
| 24 h | `charts.period24h` |
| prob. | `charts.pillProb` |
| Temp | `charts.tabTemp` |
| E | `compass.e` |
| N | `compass.n` |
| NE | `compass.ne` |
| S | `compass.s` |
| SE | `compass.se` |
| OK | `health.shortOk` |
| gr/m³ | `metrics.pollenUnit` |
| UV | `metrics.uv` |
| Deps | `update.deps` |
| local | `update.local` |
| UX | `update.ux` |
