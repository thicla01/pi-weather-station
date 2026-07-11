# Localization glossary

Last generated: 2026-05-15. Replace `☐` with `☑` (or `✓`) when a translation row has been validated by a native speaker.

Source coverage:
- `client/src/i18n/locales/{en,fr,es}.json` — the structured i18n tree (~270 keys)
- Inline `lang === "fr" ? ... : lang === "es" ? ... : ...` in v3 SettingsPanel (`client/src/components/ambient/SettingsPanel/index.js`)
- `lbl(lang, en, fr, es)` calls in v3 DebugPanel (`client/src/components/ambient/DebugPanel/index.js`)

Strings whose three locales are 100% identical (pure abbreviations like `mph`, `kmh`, `S`/`M`/`L` selectors used as bare letters, `RSS`, `TTL`, `FPS`, `UV`, `RainViewer`, `Env. Canada`, `OpenAQ`, `EPA AirNow`, `NowCast`, `Internet`, `SYSTEMD`, `HOSTNAME`, `MIN`/`MAX`, `TOTAL`, `OK`, `ON`/`OFF`, `Deps`) are listed in the "Universal strings" section at the bottom.

---

## Settings — Local preferences (header)

| Validé | EN | FR | ES | Clé / Contexte |
|--------|----|----|-----|----------------|
| ☐ | SETTINGS | PARAMÈTRES | CONFIGURACIÓN | `settings.title` |
| ☐ | Local preferences | Préférences locales | Local preferences | `inline (SettingsPanel SectionLocal title)` |
| ☐ | Stored in the browser. No restart required. | Stockées dans le navigateur. Pas de redémarrage requis. | Stored in the browser. No restart required. | `inline (SettingsPanel SectionLocal subtitle)` |

## Settings — Local preferences (controls)

| Validé | EN | FR | ES | Clé / Contexte |
|--------|----|----|-----|----------------|
| ☐ | Clock | Horloge | Clock | `inline (SettingsPanel)` |
| ☐ | Dark mode | Mode sombre | Dark mode | `inline (SettingsPanel)` |
| ☐ | Font size | Taille texte | Tamaño texto | `inline (SettingsPanel)` |
| ☐ | Hide mouse cursor | Masquer le curseur | Hide mouse cursor | `inline (SettingsPanel)` |
| ☐ | Hide radar legend | Masquer la légende radar | Hide radar legend | `inline (SettingsPanel)` |
| ☐ | Language | Langue | Language | `inline (SettingsPanel)` |
| ☐ | Length | Précip. | Length | `inline (SettingsPanel)` |
| ☐ | Speed | Vent | Speed | `inline (SettingsPanel)` |

## Settings — Local preferences (legacy v2 i18n keys, may overlap)

| Validé | EN | FR | ES | Clé / Contexte |
|--------|----|----|-----|----------------|
| ☐ | AUTO DARK MODE | MODE SOMBRE AUTO | MODO OSCURO AUTO | `settings.darkModeAuto` |
| ☐ | ANTHROPIC API KEY (AI SUMMARY) | CLÉ API ANTHROPIC (RÉSUMÉ IA) | CLAVE API ANTHROPIC (RESUMEN IA) | `settings.anthropicApiKey` |
| ☐ | CUSTOM STARTING LATITUDE | LATITUDE DE DÉPART PERSONNALISÉE | LATITUD DE INICIO PERSONALIZADA | `settings.customLat` |
| ☐ | CUSTOM STARTING LONGITUDE | LONGITUDE DE DÉPART PERSONNALISÉE | LONGITUD DE INICIO PERSONALIZADA | `settings.customLon` |
| ☐ | DEFAULT MAP ZOOM | ZOOM PAR DÉFAUT | ZOOM POR DEFECTO | `settings.defaultMapZoom` |
| ☐ | EPA AIRNOW API KEY (US AIR QUALITY) | CLÉ API EPA AIRNOW (QUALITÉ DE L'AIR US) | CLAVE API EPA AIRNOW (CALIDAD DEL AIRE EE.UU.) | `settings.airNowApiKey` |
| ☐ | FONT SIZE | TAILLE POLICE | TAMAÑO FUENTE | `settings.fontSize` |
| ☐ | GEOLOCATION API KEY | CLÉ API GÉOLOCALISATION | CLAVE API GEOLOCALIZACIÓN | `settings.geoApiKey` |
| ☐ | HIDE MOUSE | MASQUER SOURIS | OCULTAR RATÓN | `settings.hideMouse` |
| ☐ | HIDE RADAR LEGEND | MASQUER LÉGENDE RADAR | OCULTAR LEYENDA RADAR | `settings.hideRadarLegend` |
| ☐ | L | G | G | `settings.fontL` |
| ☐ | LANGUAGE | LANGUE | IDIOMA | `settings.language` |
| ☐ | M | M | M | `settings.fontM` |
| ☐ | MAPS API KEY | CLÉ API CARTES | CLAVE API MAPAS | `settings.mapsApiKey` |
| ☐ | OPENAQ API KEY (GLOBAL AIR QUALITY) | CLÉ API OPENAQ (QUALITÉ DE L'AIR MONDIALE) | CLAVE API OPENAQ (CALIDAD DEL AIRE GLOBAL) | `settings.openAqApiKey` |
| ☐ | RADAR SOURCE | SOURCE RADAR | FUENTE RADAR | `settings.radarSource` |
| ☐ | S | P | P | `settings.fontS` |
| ☐ | SAVE | ENREGISTRER | GUARDAR | `settings.save` |
| ☐ | UNITS | UNITÉS | UNIDADES | `settings.units` |
| ☐ | WEATHER API KEY | CLÉ API MÉTÉO | CLAVE API CLIMA | `settings.weatherApiKey` |
| ☐ | Configured | Configurée | Configurada | `settings.configured` |
| ☐ | None | Aucune | Ninguna | `settings.none` |
| ☐ | Not configured | Non configurée | No configurada | `settings.notConfigured` |
| ☐ | API keys and coordinates can only be modified from the device itself. Configured keys are shown as "Configured" without exposing their value. To change them remotely, open an SSH tunnel (ssh -L 8443:localhost:8443 user@<host>) and reload the app from https://localhost:8443. | Les clés API et les coordonnées ne peuvent être modifiées qu'à partir de l'appareil lui-même. Les clés configurées sont affichées comme « Configurée » sans révéler leur valeur. Pour les modifier à distance, ouvre un tunnel SSH (ssh -L 8443:localhost:8443 user@<hôte>) et recharge l'application depuis https://localhost:8443. | Las claves API y las coordenadas solo pueden modificarse desde el dispositivo mismo. Las claves configuradas se muestran como «Configurada» sin revelar su valor. Para cambiarlas remotamente, abre un túnel SSH (ssh -L 8443:localhost:8443 user@<host>) y recarga la aplicación desde https://localhost:8443. | `settings.remoteApiKeysNotice` |

## Settings — API keys (v3 panel)

| Validé | EN | FR | ES | Clé / Contexte |
|--------|----|----|-----|----------------|
| ☐ | API keys | Clés API | API keys | `inline (SettingsPanel subhead)` |
| ☐ | Configuration & API keys | Configuration & clés API | Configuration & API keys | `inline (SettingsPanel SectionConfig title)` |
| ☐ | Server-side settings.json. Local writes only. | settings.json côté serveur. Écriture locale uniquement. | Server-side settings.json. Local writes only. | `inline (SettingsPanel SectionConfig subtitle)` |
| ☐ | READ-ONLY | LECTURE SEULE | READ-ONLY | `inline (SettingsPanel pill)` |
| ☐ | EDITABLE | MODIFIABLE | EDITABLE | `inline (SettingsPanel pill)` |
| ☐ | REQUIRED | REQUIS | REQUERIDO | `inline (SettingsPanel tier badge)` |
| ☐ | OPTIONAL | OPTIONNEL | OPCIONAL | `inline (SettingsPanel tier badge)` |
| ☐ | Location & hardware | Localisation & matériel | Location & hardware | `inline (SettingsPanel subhead)` |
| ☐ | Latitude | Latitude | Latitude | `inline (SettingsPanel field label)` |
| ☐ | Radar source | Source radar | Radar source | `inline (SettingsPanel)` |
| ☐ | Brightness | Luminosité | Brightness | `inline (SettingsPanel)` |
| ☐ | Map tiles + styles | Tuiles de carte + styles | Map tiles + styles | `inline (SettingsPanel Mapbox unlocks)` |
| ☐ | Hourly + daily forecast | Prévisions horaires + 5 jours | Hourly + daily forecast | `inline (SettingsPanel Tomorrow.io unlocks)` |
| ☐ | Reverse geocoding · place name | Géocodage inverse · nom de lieu | Reverse geocoding · place name | `inline (SettingsPanel LocationIQ unlocks)` |
| ☐ | AI weather summary (Claude Haiku) | Résumé météo IA (Claude Haiku) | AI weather summary (Claude Haiku) | `inline (SettingsPanel Anthropic unlocks)` |
| ☐ | US air-quality index (AQI) | Indice qualité d'air US (AQI) | US air-quality index (AQI) | `inline (SettingsPanel AirNow unlocks)` |
| ☐ | Global air-quality fallback | Repli qualité d'air mondial | Global air-quality fallback | `inline (SettingsPanel OpenAQ unlocks)` |
| ☐ | Save changes | Enregistrer | Save changes | `inline (SettingsPanel save button idle)` |
| ☐ | Saving… | Enregistrement… | Saving… | `inline (SettingsPanel save button saving)` |
| ☐ | ✓ Saved | ✓ Enregistré | ✓ Saved | `inline (SettingsPanel save button saved)` |
| ☐ | Remote connection detected. To change these settings, open an SSH tunnel from your local machine. | Connexion distante détectée. Pour modifier ces paramètres, ouvrez un tunnel SSH depuis votre poste local. | Remote connection detected. To change these settings, open an SSH tunnel from your local machine. | `inline (SettingsPanel RemoteNotice)` |

## Settings — Advanced (v3 panel)

| Validé | EN | FR | ES | Clé / Contexte |
|--------|----|----|-----|----------------|
| ☐ | Advanced | Avancé | Advanced | `inline (SettingsPanel SectionAdvanced title)` |
| ☐ | Display · AI · sleep | Affichage · IA · veille | Display · AI · sleep | `inline (SettingsPanel SectionAdvanced subtitle)` |
| ☐ | Display | Affichage | Display | `inline (SettingsPanel subhead)` |
| ☐ | Map · light | Carte · clair | Map · light | `inline (SettingsPanel)` |
| ☐ | Map · dark | Carte · sombre | Map · dark | `inline (SettingsPanel)` |
| ☐ | Radar opacity · light | Opacité radar · clair | Radar opacity · light | `inline (SettingsPanel)` |
| ☐ | Radar opacity · dark | Opacité radar · sombre | Radar opacity · dark | `inline (SettingsPanel)` |
| ☐ | AI · radar analysis | IA · analyse radar | AI · radar analysis | `inline (SettingsPanel subhead)` |
| ☐ | Radar analysis enabled | Analyse radar activée | Radar analysis enabled | `inline (SettingsPanel)` |
| ☐ | Analysis rings + AI radar summary | Cercles d'analyse + résumé IA radar | Analysis rings + AI radar summary | `inline (SettingsPanel toggle sub)` |
| ☐ | Extended radius (100 km) | Rayon étendu (100 km) | Extended radius (100 km) | `inline (SettingsPanel)` |
| ☐ | Adds the outer ring | Ajoute l'anneau extérieur | Adds the outer ring | `inline (SettingsPanel toggle sub)` |
| ☐ | Sampling points | Points d'échantillonnage | Sampling points | `inline (SettingsPanel)` |
| ☐ | Show points read by the sampler | Affiche les points lus par le détecteur | Show points read by the sampler | `inline (SettingsPanel toggle sub)` |
| ☐ | Calm-day fast path | Chemin rapide jour calme | Calm-day fast path | `inline (SettingsPanel)` |
| ☐ | Skip Claude when weather is stable | Saute Claude quand le temps est stable | Skip Claude when weather is stable | `inline (SettingsPanel toggle sub)` |
| ☐ | Sleep | Veille | Sleep | `inline (SettingsPanel subhead)` |
| ☐ | Enable sleep | Activer la veille | Enable sleep | `inline (SettingsPanel)` |
| ☐ | Stage 1 · delay | Stage 1 · délai | Stage 1 · delay | `inline (SettingsPanel)` |
| ☐ | Stage 1 · brightness | Stage 1 · lum. | Stage 1 · brightness | `inline (SettingsPanel)` |
| ☐ | Red text at night | Texte rouge nuit | Red text at night | `inline (SettingsPanel)` |
| ☐ | Stage 2 · enabled | Stage 2 · activé | Stage 2 · enabled | `inline (SettingsPanel)` |
| ☐ | Stage 2 · delay | Stage 2 · délai | Stage 2 · delay | `inline (SettingsPanel)` |
| ☐ | Diagnostic | Diagnostic | Diagnostic | `inline (SettingsPanel subhead)` |
| ☐ | Debug panel | Panneau Débogage | Debug panel | `inline (SettingsPanel)` |
| ☐ | (set via DEBUG=true on the service) | (défini par DEBUG=true au service) | (set via DEBUG=true on the service) | `inline (SettingsPanel toggle sub)` |

## Settings — Preview (v3 panel)

| Validé | EN | FR | ES | Clé / Contexte |
|--------|----|----|-----|----------------|
| ☐ | Preview | Aperçu | Preview | `inline (SettingsPanel SectionPreview title)` |
| ☐ | Switch between the production v2 interface and the v3 preview. | Bascule entre l'interface en production (v2) et l'aperçu v3. | Switch between the production v2 interface and the v3 preview. | `inline (SettingsPanel SectionPreview subtitle)` |
| ☐ | active | actif | active | `inline (SettingsPanel preview pill)` |
| ☐ | Ambient interface (v3 preview) | Interface ambient (aperçu v3) | Ambient interface (v3 preview) | `inline (SettingsPanel preview toggle)` |
| ☐ | Disable to switch back to the classic v2 interface. Report bugs at GitHub Issues. | Désactivez pour revenir à l'interface classique v2. Signalez les bugs sur GitHub Issues. | Disable to switch back to the classic v2 interface. Report bugs at GitHub Issues. | `inline (SettingsPanel preview toggle sub)` |

## Settings — Advanced (v2 i18n keys, may overlap)

| Validé | EN | FR | ES | Clé / Contexte |
|--------|----|----|-----|----------------|
| ☐ | Advanced settings | Paramètres avancés | Ajustes avanzados | `settings.advanced.title` |
| ☐ | These toggles can only be changed from the device itself. To modify them remotely, open an SSH tunnel (ssh -L 8443:localhost:8443 user@<host>) and reload the app from https://localhost:8443. | Ces réglages ne peuvent être modifiés qu'à partir de l'appareil lui-même. Pour les modifier à distance, ouvre un tunnel SSH (ssh -L 8443:localhost:8443 user@<hôte>) et recharge l'application depuis https://localhost:8443. | Estos ajustes solo pueden modificarse desde el dispositivo mismo. Para cambiarlos remotamente, abre un túnel SSH (ssh -L 8443:localhost:8443 user@<host>) y recarga la aplicación desde https://localhost:8443. | `settings.advanced.readOnlyNotice` |
| ☐ | Display | Affichage | Visualización | `settings.advanced.displayGroup` |
| ☐ | Light-mode map style | Style de carte (mode clair) | Estilo de mapa (modo claro) | `settings.advanced.lightModeStyle` |
| ☐ | v10 / v11 are the classic pale Mapbox light styles (panel turns near-white). Streets is the warmer green/beige variant with stronger labels (panel turns cream). | v10 / v11 sont les styles Mapbox light classiques très pâles (panneau presque blanc). Streets est la variante plus chaude vert/beige avec des labels plus marqués (panneau crème). | v10 / v11 son los estilos Mapbox light clásicos muy pálidos (panel casi blanco). Streets es la variante más cálida verde/beige con etiquetas más marcadas (panel crema). | `settings.advanced.lightModeStyleHint` |
| ☐ | Dark-mode map style | Style de carte (mode sombre) | Estilo de mapa (modo oscuro) | `settings.advanced.darkModeStyle` |
| ☐ | v10 is the classic dark Mapbox style. v11 is the modern variant — slightly different palette and label rendering. Both keep the same dark grey panel. | v10 est le style Mapbox dark classique. v11 est la variante moderne — palette et rendu des labels légèrement différents. Le panneau gris foncé reste identique dans les deux cas. | v10 es el estilo Mapbox dark clásico. v11 es la variante moderna — paleta y renderizado de etiquetas ligeramente distintos. El panel gris oscuro permanece igual en ambos casos. | `settings.advanced.darkModeStyleHint` |
| ☐ | Radar opacity (light mode) | Opacité radar (mode clair) | Opacidad radar (modo claro) | `settings.advanced.radarOpacityLight` |
| ☐ | How strongly the radar overlay tints the basemap when light mode is active. 70% is the historical default — lower values let the basemap show through, higher values make rain bands stand out. | Intensité de la couche radar quand le mode clair est actif. 70 % est la valeur historique — plus bas laisse passer la carte, plus haut fait ressortir les bandes de pluie. | Intensidad de la capa radar cuando el modo claro está activo. 70 % es el valor histórico — más bajo deja ver el mapa, más alto hace resaltar las bandas de lluvia. | `settings.advanced.radarOpacityLightHint` |
| ☐ | Radar opacity (dark mode) | Opacité radar (mode sombre) | Opacidad radar (modo oscuro) | `settings.advanced.radarOpacityDark` |
| ☐ | Same control but for dark mode. The default is lower (30%) because the dark basemap makes radar colours pop naturally — too high and they look saturated. | Même contrôle pour le mode sombre. Le défaut est plus bas (30 %) parce que la carte sombre fait naturellement ressortir les couleurs radar — trop haut et c'est saturé. | Mismo control para el modo oscuro. El predeterminado es más bajo (30 %) porque el mapa oscuro hace resaltar naturalmente los colores del radar — demasiado alto y se satura. | `settings.advanced.radarOpacityDarkHint` |
| ☐ | Display brightness | Luminosité de l'écran | Brillo de la pantalla | `settings.advanced.brightness` |
| ☐ | Hardware-level dimming of the connected screen. Floors at 10% to keep the display readable. Hidden on devices that don't expose a backlight (HDMI monitors, no kernel overlay, etc.). | Atténuation matérielle de l'écran connecté. Plancher à 10 % pour garder l'écran lisible. Masqué sur les appareils qui n'exposent pas de backlight (moniteurs HDMI, overlay kernel manquant, etc.). | Atenuación del hardware de la pantalla conectada. Mínimo 10 % para mantener la pantalla legible. Oculto en dispositivos que no exponen backlight (monitores HDMI, overlay kernel ausente, etc.). | `settings.advanced.brightnessHint` |
| ☐ | AI weather summary | Résumé météo IA | Resumen meteo IA | `settings.advanced.aiGroup` |
| ☐ | Radar analysis | Analyse radar | Análisis radar | `settings.advanced.radarAnalysisEnabled` |
| ☐ | Generates the third "Radar analysis" paragraph in the AI summary and shows the sampling-zone circles on the map (50 km / 100 km dashed). Turn off to reduce Anthropic token usage. The rain-alert banner uses the same risk data computed locally and is unaffected. | Génère le 3e paragraphe « Analyse radar » du résumé IA et affiche les cercles de la zone d'échantillonnage sur la carte (50 km / 100 km pointillés). Désactive pour réduire la consommation de tokens Anthropic. La bannière d'alerte de pluie utilise les mêmes données de risque calculées localement et reste active. | Genera el tercer párrafo «Análisis radar» del resumen IA y muestra los círculos de la zona de muestreo en el mapa (50 km / 100 km punteados). Desactiva para reducir el consumo de tokens Anthropic. El banner de alerta de lluvia usa los mismos datos de riesgo calculados localmente y permanece activo. | `settings.advanced.radarAnalysisEnabledHint` |
| ☐ | Extended radius | Rayon étendu | Radio extendido | `settings.advanced.extendedRadius` |
| ☐ | Roughly doubles the sampling radius (50 → 100 km, or 30 → 60 mi depending on the distance unit). Adds the outer ring (32 directions × 10 distances) for longer-range storm tracking. | Double approximativement le rayon d'échantillonnage (50 → 100 km, ou 30 → 60 mi selon l'unité de distance). Ajoute l'anneau extérieur (32 directions × 10 distances) pour suivre les cellules plus loin. | Duplica aproximadamente el radio de muestreo (50 → 100 km, o 30 → 60 mi según la unidad de distancia). Añade el anillo exterior (32 direcciones × 10 distancias) para seguir células de tormenta más lejos. | `settings.advanced.extendedRadiusHint` |
| ☐ | Show sampling points on map | Afficher les points d'échantillonnage | Mostrar puntos de muestreo | `settings.advanced.showSamplingPoints` |
| ☐ | Displays a small dot at every position the AI summary samples on the radar. | Affiche un petit point à chaque position que le résumé IA échantillonne sur le radar. | Muestra un pequeño punto en cada posición que el resumen IA muestrea en el radar. | `settings.advanced.showSamplingPointsHint` |
| ☐ | Calm-day fast path | Voie rapide journée calme | Ruta rápida día tranquilo | `settings.advanced.calmDayFastPath` |
| ☐ | When current conditions are clearly benign (no precipitation now, low chance ahead), skip the Claude call and emit a templated summary instead. Saves Anthropic tokens on quiet days with no quality loss — Claude is still called whenever something interesting is happening. Turn off if you'd rather always get the natural-language version. | Quand les conditions courantes sont clairement bénignes (aucune précipitation, faible probabilité à venir), saute l'appel Claude et émet plutôt un résumé templaté. Économise des tokens Anthropic sur les journées calmes sans perte de qualité — Claude est toujours appelé dès qu'il se passe quelque chose. Désactive si tu préfères toujours la version générée par IA. | Cuando las condiciones actuales son claramente benignas (sin precipitación ahora, poca probabilidad próximamente), salta la llamada a Claude y emite un resumen plantillado. Ahorra tokens de Anthropic en días tranquilos sin pérdida de calidad — Claude se sigue llamando cuando hay algo interesante. Desactiva si prefieres siempre la versión generada por IA. | `settings.advanced.calmDayFastPathHint` |
| ☐ | Sleep mode | Veille | Modo reposo | `settings.advanced.sleepGroup` |
| ☐ | Enable sleep mode | Activer le mode veille | Activar modo reposo | `settings.advanced.sleepEnabled` |
| ☐ | After a period of inactivity, fades to a minimal full-screen clock at reduced brightness. Touch or move the cursor to wake. | Après une période d'inactivité, fond enchaîné vers une horloge plein écran avec luminosité réduite. Touche ou bouge la souris pour réveiller. | Tras un periodo de inactividad, transición a un reloj a pantalla completa con brillo reducido. Toca o mueve el ratón para despertar. | `settings.advanced.sleepEnabledHint` |
| ☐ | Inactivity before sleep | Inactivité avant veille | Inactividad antes del reposo | `settings.advanced.sleepStage1Delay` |
| ☐ | How long with no touch / mouse / keyboard input before the screensaver fades in. | Délai sans interaction (tactile, souris, clavier) avant que l'économiseur n'apparaisse. | Tiempo sin interacción (táctil, ratón, teclado) antes de que aparezca el salvapantallas. | `settings.advanced.sleepStage1DelayHint` |
| ☐ | Sleep brightness | Luminosité en veille | Brillo en reposo | `settings.advanced.sleepStage1Brightness` |
| ☐ | Hardware brightness applied while the screensaver is showing the clock. Hidden on devices without a backlight. | Luminosité matérielle appliquée pendant que l'horloge est affichée. Masqué sur les appareils sans backlight. | Brillo de hardware aplicado mientras se muestra el reloj. Oculto en dispositivos sin backlight. | `settings.advanced.sleepStage1BrightnessHint` |
| ☐ | Black-screen stage | Stade écran noir | Etapa pantalla negra | `settings.advanced.sleepStage2Enabled` |
| ☐ | After a further delay, switch to a black screen with a tiny moving dot to prevent LCD burn-in. Brightness drops to its floor. | Après un délai supplémentaire, passe à un écran noir avec un petit point qui se déplace pour éviter le burn-in LCD. Luminosité au plancher. | Tras un retraso adicional, pasa a una pantalla negra con un pequeño punto en movimiento para evitar el burn-in del LCD. Brillo al mínimo. | `settings.advanced.sleepStage2EnabledHint` |
| ☐ | Black-screen delay | Délai écran noir | Retraso pantalla negra | `settings.advanced.sleepStage2Delay` |
| ☐ | Time after the screensaver appears before switching to the black-screen stage. The backlight is dropped fully off (where the panel allows it). | Délai après l'apparition de l'horloge avant le passage à l'écran noir. Le rétroéclairage descend à zéro (dans la mesure où le panneau l'accepte). | Tiempo después de aparecer el reloj antes de pasar a la etapa de pantalla negra. El backlight baja a cero (en la medida que el panel lo acepte). | `settings.advanced.sleepStage2DelayHint` |
| ☐ | Red text at night | Texte rouge la nuit | Texto rojo de noche | `settings.advanced.sleepNightMode` |
| ☐ | When dark mode is active, use red-tinted text instead of cream. Long-wavelength red light has minimal impact on melatonin — friendlier in a bedroom or hallway visible at night. | Quand le mode sombre est actif, utilise un texte rouge au lieu du beige. La lumière rouge à grande longueur d'onde a un impact minimal sur la mélatonine — plus indulgent dans une chambre ou un couloir visible la nuit. | Cuando el modo oscuro está activo, usa texto rojo en lugar de crema. La luz roja de longitud de onda larga tiene impacto mínimo en la melatonina — más amable en un dormitorio o pasillo visible de noche. | `settings.advanced.sleepNightModeHint` |
| ☐ | {{count}} min | {{count}} min | {{count}} min | `settings.advanced.sleepMinutes` |
| ☐ | Preview | Aperçu | Vista previa | `settings.advanced.previewGroup` |
| ☐ | Ambient interface (v3 preview) | Interface ambient (aperçu v3) | Interfaz ambient (vista previa v3) | `settings.advanced.ambientPreview` |
| ☐ | Try the upcoming v3 "Ambient Layers" interface — a full rebuild of the dashboard, settings, and debug panels with refreshed visuals and phone-friendly layouts coming. Off by default; the v2 interface remains production. Report any issue at github.com/thicla01/pi-weather-station/issues so we can stabilise v3 before it becomes the default. | Essayez la nouvelle interface v3 « Ambient Layers » — refonte complète du tableau de bord, des réglages et du panneau de débogage avec un nouveau visuel et un support téléphone à venir. Désactivé par défaut ; l'interface v2 reste la version en production. Signalez tout problème sur github.com/thicla01/pi-weather-station/issues afin que la v3 se stabilise avant de devenir la version par défaut. | Prueba la próxima interfaz v3 «Ambient Layers» — reconstrucción completa del panel principal, ajustes y depuración con un nuevo aspecto y soporte para teléfono próximamente. Desactivada por defecto; la interfaz v2 sigue siendo la versión en producción. Informa cualquier problema en github.com/thicla01/pi-weather-station/issues para que v3 se estabilice antes de convertirse en la versión predeterminada. | `settings.advanced.ambientPreviewHint` |

## Weather codes

| Validé | EN | FR | ES | Clé / Contexte |
|--------|----|----|-----|----------------|
| ☐ | Clear | Dégagé | Despejado | `weather.clear` |
| ☐ | Cloudy | Nuageux | Nublado | `weather.cloudy` |
| ☐ | Drizzle | Bruine | Llovizna | `weather.drizzle` |
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

## Errors / loading states

| Validé | EN | FR | ES | Clé / Contexte |
|--------|----|----|-----|----------------|
| ☐ | Cannot get 5 day weather forecast | Impossible d'obtenir les prévisions sur 5 jours | No se pueden obtener los pronósticos de 5 días | `errors.dailyForecastFailed` |
| ☐ | Cannot get 24 hour weather forecast | Impossible d'obtenir les prévisions sur 24 heures | No se pueden obtener los pronósticos de 24 horas | `errors.hourlyForecastFailed` |
| ☐ | Could not retrieve weather data. | Impossible de récupérer les données météo. | No se pudieron obtener los datos del clima. | `errors.weatherDataFailed` |
| ☐ | Is your weather API key valid? | Votre clé API météo est-elle valide? | ¿Es válida tu clave API del clima? | `errors.weatherApiKeyInvalid` |

## Charts

| Validé | EN | FR | ES | Clé / Contexte |
|--------|----|----|-----|----------------|
| ☐ | 24 hours | 24 heures | 24 horas | `charts.tab24h` |
| ☐ | 5 days | 5 jours | 5 días | `charts.tab5d` |
| ☐ | 24 Hour Temp / Precipitation | Temp. 24 heures / Précipitations | Temp. 24 horas / Precipitaciones | `charts.24hourTemp` |
| ☐ | 24 Hour Wind Speed / Precipitation ({{unit}}) | Vent 24 heures / Précipitations ({{unit}}) | Viento 24 horas / Precipitaciones ({{unit}}) | `charts.24hourWind` |
| ☐ | 5 Day Temp / Precipitation | Temp. 5 jours / Précipitations | Temp. 5 días / Precipitaciones | `charts.5dayTemp` |
| ☐ | 5 Day Wind Speed / Precipitation ({{unit}}) | Vent 5 jours / Précipitations ({{unit}}) | Viento 5 días / Precipitaciones ({{unit}}) | `charts.5dayWind` |
| ☐ | Precipitation | Précipitations | Precipitaciones | `charts.precipitation` |
| ☐ | Temp | Temp. | Temp. | `charts.temp` |
| ☐ | Wind | Vent | Viento | `charts.windSpeed` |

## Update modal

| Validé | EN | FR | ES | Clé / Contexte |
|--------|----|----|-----|----------------|
| ☐ | Copied! | Copié ! | ¡Copiado! | `update.copied` |
| ☐ | Copy | Copier | Copiar | `update.copy` |
| ☐ | Deps | Deps | Deps | `update.deps` |
| ☐ | Done! | Fait ! | ¡Hecho! | `update.done` |
| ☐ | Failed | Échec | Error | `update.failed` |
| ☐ | Fix | Correctif | Corrección | `update.fix` |
| ☐ | New | Nouveau | Nuevo | `update.feat` |
| ☐ | No changelog available for this update. | Aucun journal des modifications disponible. | No hay registro de cambios disponible. | `update.noChangelog` |
| ☐ | Faster | Optim. | Más rápido | `update.perf` |
| ☐ | Release | Version | Versión | `update.release` |
| ☐ | Restarting... | Redémarrage... | Reiniciando... | `update.restarting` |
| ☐ | SKIP THIS VERSION | IGNORER CETTE VERSION | IGNORAR ESTA VERSIÓN | `update.skip` |
| ☐ | Then restart the server manually: | Redémarrez le serveur manuellement : | Reinicie el servidor manualmente: | `update.noSystemd` |
| ☐ | Up to date | À jour | Al día | `update.upToDate` |
| ☐ | Update | Mettre à jour | Actualizar | `update.update` |
| ☐ | Update available | Mise à jour disponible | Actualización disponible | `update.availableNoVersion` |
| ☐ | Update available: v{{version}} | Mise à jour disponible : v{{version}} | Actualización disponible: v{{version}} | `update.available` |
| ☐ | Updating... | Mise à jour... | Actualizando... | `update.updating` |
| ☐ | WHAT'S NEW | NOUVEAUTÉS | NOVEDADES | `update.whatsNew` |
| ☐ | latest | dernier | último | `update.latest` |
| ☐ | local | local | local | `update.local` |
| ☐ | This update changes installed scripts or service files that the one-click button can't refresh on its own. Run the full command above on the device — `bash deploy/install.sh` is idempotent and will refresh only what has diverged: | Cette mise à jour modifie des scripts ou fichiers de service installés que le bouton ne peut pas rafraîchir automatiquement. Exécute la commande complète ci-dessus sur l'appareil — `bash deploy/install.sh` est idempotent et ne rafraîchira que ce qui a divergé : | Esta actualización modifica scripts o archivos de servicio instalados que el botón no puede actualizar por sí solo. Ejecuta el comando completo de arriba en el dispositivo — `bash deploy/install.sh` es idempotente y solo actualizará lo que ha divergido: | `update.deployArtefactsChanged` |
| ☐ | Your installed version is too old for the one-click update (pre-v2.4.1, before /api/update started running npm install). The auto-update would land new dependencies as missing-module crashes. Run the full command above to upgrade safely via deploy/install.sh. | Ta version installée est trop ancienne pour la mise à jour en un clic (pré-v2.4.1, avant que /api/update lance npm install). L'auto-update planterait sur des modules manquants. Exécute la commande complète ci-dessus pour mettre à jour proprement via deploy/install.sh. | Tu versión instalada es demasiado antigua para la actualización con un clic (pre-v2.4.1, antes de que /api/update ejecutase npm install). La actualización automática fallaría con módulos faltantes. Ejecuta el comando completo de arriba para actualizar de forma segura vía deploy/install.sh. | `update.needsManualUpgrade` |

## Indoor

| Validé | EN | FR | ES | Clé / Contexte |
|--------|----|----|-----|----------------|
| ☐ | INDOOR | INTÉRIEUR | INTERIOR | `indoor.label` |
| ☐ | Excellent | Excellente | Excelente | `indoor.airQuality.1` |
| ☐ | Good | Bonne | Buena | `indoor.airQuality.2` |
| ☐ | Fair | Moyenne | Aceptable | `indoor.airQuality.3` |
| ☐ | Inferior | Mauvaise | Mala | `indoor.airQuality.4` |
| ☐ | Poor | Très mauvaise | Muy mala | `indoor.airQuality.5` |

## Metrics / Badges

| Validé | EN | FR | ES | Clé / Contexte |
|--------|----|----|-----|----------------|
| ☐ | AQI | AQI | ICA | `badges.aqi` |
| ☐ | AQI | IQA | ICA | `metrics.aqi` |
| ☐ | AQHI | CAS | AQHI | `badges.aqhi` |
| ☐ | Environment Canada AQHI | Cote air santé (Environnement Canada) | AQHI (Environment Canada) | `badges.aqiSourceEccc` |
| ☐ | EPA AirNow | EPA AirNow | EPA AirNow | `badges.aqiSourceAirNow` |
| ☐ | Humidity | Humidité | Humedad | `metrics.humidity` |
| ☐ | Montreal RSQA IQA (city air-quality network) | IQA — RSQA Montréal (Ville) | IQA — RSQA Montreal | `badges.aqiSourceMelccMtl` |
| ☐ | OpenAQ | OpenAQ | OpenAQ | `badges.aqiSourceOpenAq` |
| ☐ | Quebec MELCC IQA (RSQAQ provincial network) | IQA — MELCC Québec (RSQAQ) | IQA — MELCC Quebec (RSQAQ) | `badges.aqiSourceMelccRsqaq` |
| ☐ | Tomorrow.io EPA AQI | EPA AQI (Tomorrow.io) | EPA ICA (Tomorrow.io) | `badges.aqiSourceEpa` |
| ☐ | Wind | Vent | Viento | `metrics.wind` |
| ☐ | observed | observé | observado | `badges.aqiKindObservation` |
| ☐ | forecast | prévision | pronóstico | `badges.aqiKindForecast` |

## Badges — UV / AQI levels

| Validé | EN | FR | ES | Clé / Contexte |
|--------|----|----|-----|----------------|
| ☐ | Low | Faible | Bajo | `badges.uvLevel.low` |
| ☐ | Moderate | Modéré | Moderado | `badges.uvLevel.moderate` |
| ☐ | High | Élevé | Alto | `badges.uvLevel.high` |
| ☐ | Very high | Très élevé | Muy alto | `badges.uvLevel.veryHigh` |
| ☐ | Extreme | Extrême | Extremo | `badges.uvLevel.extreme` |
| ☐ | Low risk | Risque faible | Riesgo bajo | `badges.aqiLevel.low` |
| ☐ | Moderate | Modéré | Moderado | `badges.aqiLevel.moderate` |
| ☐ | High | Élevé | Alto | `badges.aqiLevel.high` |
| ☐ | Very high | Très élevé | Muy alto | `badges.aqiLevel.veryHigh` |

## Alert banner

| Validé | EN | FR | ES | Clé / Contexte |
|--------|----|----|-----|----------------|
| ☐ | Heavy precipitation appears to be approaching | Précipitations fortes qui semblent s'approcher | Precipitación fuerte parece estar acercándose | `alert.orangeApproachingHedged` |
| ☐ | Heavy precipitation appears to be moving away | Précipitations fortes qui semblent s'éloigner | Precipitación fuerte parece estar alejándose | `alert.orangeLeavingHedged` |
| ☐ | Heavy precipitation drifting around you | Précipitations fortes en mouvement autour de vous | Precipitación fuerte desplazándose en su zona | `alert.orangeDrifting` |
| ☐ | Heavy precipitation in your area | Précipitations fortes sur votre zone | Precipitación fuerte en su zona | `alert.orangeNear` |
| ☐ | Heavy precipitation intensifying | Précipitations fortes qui s'intensifient | Precipitación fuerte intensificándose | `alert.orangeIntensifying` |
| ☐ | Heavy precipitation moving away | Précipitations fortes mais s'éloignent | Precipitación fuerte alejándose | `alert.orangeLeaving` |
| ☐ | Heavy precipitation nearby | Précipitations fortes à proximité | Precipitación fuerte en las cercanías | `alert.orangeApproaching` |
| ☐ | Alert — Severe precipitation approaching | Alerte — précipitations sévères approchent | Alerta — Precipitación severa acercándose | `alert.redApproaching` |
| ☐ | Alert — Severe precipitation in your area | Alerte — précipitations sévères sur votre zone | Alerta — Precipitación severa en su zona | `alert.redNear` |
| ☐ | Alert — Severe precipitation intensifying | Alerte — précipitations sévères qui s'intensifient | Alerta — Precipitación severa intensificándose | `alert.redIntensifying` |
| ☐ | Severe precipitation appears to be approaching | Précipitations sévères qui semblent s'approcher | Precipitación severa parece estar acercándose | `alert.redApproachingHedged` |
| ☐ | Severe precipitation appears to be moving away | Précipitations sévères qui semblent s'éloigner | Precipitación severa parece estar alejándose | `alert.redLeavingHedged` |
| ☐ | Severe precipitation drifting around you | Précipitations sévères en mouvement autour de vous | Precipitación severa desplazándose en su zona | `alert.redDrifting` |
| ☐ | Severe precipitation moving away | Précipitations sévères mais s'éloignent | Precipitación severa alejándose | `alert.redLeaving` |
| ☐ | Tap to cycle through {{count}} active alerts | Toucher pour faire défiler les {{count}} alertes actives | Toque para recorrer las {{count}} alertas activas | `alert.cycleAria` |

## Gov't alert detail

| Validé | EN | FR | ES | Clé / Contexte |
|--------|----|----|-----|----------------|
| ☐ | {{source}} alert detail | Détails alerte {{source}} | Detalle alerta {{source}} | `govAlertDetail.title` |
| ☐ | No additional detail provided for this alert. | Aucun détail additionnel fourni pour cette alerte. | No se proporcionó detalle adicional para esta alerta. | `govAlertDetail.noDetail` |
| ☐ | Scan to open on your phone | Scannez pour ouvrir sur votre téléphone | Escanee para abrir en su teléfono | `govAlertDetail.qrCaption` |

## Radar — legend + timeline

| Validé | EN | FR | ES | Clé / Contexte |
|--------|----|----|-----|----------------|
| ☐ | RADAR | RADAR | RADAR | `radar.legend` |
| ☐ | Very light | Très léger | Muy ligero | `radar.veryLight` |
| ☐ | Light | Léger | Ligero | `radar.light` |
| ☐ | Moderate | Modéré | Moderado | `radar.moderate` |
| ☐ | Heavy | Fort | Fuerte | `radar.heavy` |
| ☐ | Very heavy | Très fort | Muy fuerte | `radar.veryHeavy` |
| ☐ | Extreme | Extrême | Extremo | `radar.extreme` |
| ☐ | Show direction arrows | Afficher les flèches de direction | Mostrar flechas de dirección | `radar.showDirectionArrows` |
| ☐ | Hide direction arrows | Masquer les flèches de direction | Ocultar flechas de dirección | `radar.hideDirectionArrows` |
| ☐ | now | maintenant | ahora | `radar.timeline.now` |
| ☐ | forecast | prévision | pronóstico | `radar.timeline.forecast` |
| ☐ | +{{min}} min | +{{min}} min | +{{min}} min | `radar.timeline.plusMin` |
| ☐ | −{{min}} min | −{{min}} min | −{{min}} min | `radar.timeline.minusMin` |
| ☐ | Cycle radar animation speed | Changer la vitesse de l'animation radar | Cambiar la velocidad de la animación del radar | `radar.timeline.speedAria` |
| ☐ | Scrub through radar frames | Parcourir les images radar | Recorrer los fotogramas del radar | `radar.timeline.scrubberAria` |
| ☐ | Return to current radar frame | Revenir à l'image radar actuelle | Volver al fotograma actual del radar | `radar.timeline.returnToNowAria` |
| ☐ | Previous frame | Image précédente | Fotograma anterior | `radar.timeline.stepBackAria` |
| ☐ | Next frame | Image suivante | Fotograma siguiente | `radar.timeline.stepForwardAria` |
| ☐ | Play radar animation | Lancer l'animation radar | Iniciar la animación del radar | `radar.timeline.playAria` |
| ☐ | Pause radar animation | Mettre en pause l'animation radar | Pausar la animación del radar | `radar.timeline.pauseAria` |

## Controls / Dock buttons

| Validé | EN | FR | ES | Clé / Contexte |
|--------|----|----|-----|----------------|
| ☐ | Close debug panel | Fermer le panneau de débogage | Cerrar el panel de depuración | `controls.closeDebug` |
| ☐ | Close settings | Fermer les paramètres | Cerrar los ajustes | `controls.closeSettings` |
| ☐ | Close update modal | Fermer la fenêtre de mise à jour | Cerrar la ventana de actualización | `controls.closeUpdate` |
| ☐ | Collapse info panel | Réduire le panneau d'information | Ocultar el panel de información | `controls.collapsePanel` |
| ☐ | Expand info panel | Afficher le panneau d'information | Mostrar el panel de información | `controls.expandPanel` |
| ☐ | Hide location marker | Masquer le marqueur de position | Ocultar el marcador de ubicación | `controls.hideMarker` |
| ☐ | Hide radar legend | Masquer la légende radar | Ocultar leyenda del radar | `controls.hideRadarLegend` |
| ☐ | Hide radar timeline | Masquer la chronologie radar | Ocultar la línea de tiempo del radar | `controls.hideTimeline` |
| ☐ | Open debug panel | Ouvrir le panneau de débogage | Abrir el panel de depuración | `controls.openDebug` |
| ☐ | Open settings | Ouvrir les paramètres | Abrir los ajustes | `controls.openSettings` |
| ☐ | Recenter map on current location | Recentrer la carte sur la position actuelle | Centrar el mapa en la ubicación actual | `controls.resetMapPosition` |
| ☐ | Show location marker | Afficher le marqueur de position | Mostrar el marcador de ubicación | `controls.showMarker` |
| ☐ | Show radar legend | Afficher la légende radar | Mostrar leyenda del radar | `controls.showRadarLegend` |
| ☐ | Show radar timeline | Afficher la chronologie radar | Mostrar la línea de tiempo del radar | `controls.showTimeline` |
| ☐ | Show update modal | Afficher la fenêtre de mise à jour | Mostrar la ventana de actualización | `controls.openUpdate` |
| ☐ | Switch to dark mode | Passer en mode sombre | Cambiar a modo oscuro | `controls.darkMode` |
| ☐ | Switch to light mode | Passer en mode clair | Cambiar a modo claro | `controls.lightMode` |
| ☐ | Update available — connect locally to install | Mise à jour disponible — connectez-vous en local pour installer | Actualización disponible — conéctese en local para instalar | `controls.updateAvailableRemote` |

## Debug panel — chrome (i18n keys)

| Validé | EN | FR | ES | Clé / Contexte |
|--------|----|----|-----|----------------|
| ☐ | DEBUG | DÉBOGAGE | DEPURACIÓN | `debug.title` |
| ☐ | LOADING... | CHARGEMENT... | CARGANDO... | `debug.loading` |
| ☐ | REFRESH | ACTUALISER | ACTUALIZAR | `debug.refresh` |
| ☐ | EXPORT CSV | EXPORTER CSV | EXPORTAR CSV | `debug.exportCsv` |
| ☐ | CHECK FOR UPDATE | VÉRIFIER MAJ | BUSCAR ACTUALIZACIÓN | `debug.checkUpdate` |
| ☐ | CHECKING... | VÉRIFICATION... | VERIFICANDO... | `debug.checking` |

## Debug panel — buckets (v3 inline labels)

| Validé | EN | FR | ES | Clé / Contexte |
|--------|----|----|-----|----------------|
| ☐ | Server | Serveur | Servidor | `inline lbl() (DebugPanel bucket)` |
| ☐ | Client | Client | Cliente | `inline lbl() (DebugPanel bucket)` |
| ☐ | Services | Services | Servicios | `inline lbl() (DebugPanel bucket)` |
| ☐ | Storage | Stockage | Almacén | `inline lbl() (DebugPanel bucket)` |
| ☐ | About | À propos | Acerca de | `inline lbl() (DebugPanel bucket)` |

## Debug panel — section titles (v3 inline lbl)

| Validé | EN | FR | ES | Clé / Contexte |
|--------|----|----|-----|----------------|
| ☐ | About this build | À propos de cette version | Acerca de esta versión | `inline lbl() (DebugPanel)` |
| ☐ | API calls (session) | Appels API (session) | Llamadas API (sesión) | `inline lbl() (DebugPanel)` |
| ☐ | API quotas | Quotas API | Cuotas API | `inline lbl() (DebugPanel)` |
| ☐ | Cache entries | Entrées de cache | Entradas de caché | `inline lbl() (DebugPanel)` |
| ☐ | Cache stats | Statistiques de cache | Estadísticas de caché | `inline lbl() (DebugPanel)` |
| ☐ | Client KPI | KPI client | KPI cliente | `inline lbl() (DebugPanel)` |
| ☐ | Current position | Position actuelle | Posición actual | `inline lbl() (DebugPanel)` |
| ☐ | Network | Réseau | Red | `inline lbl() (DebugPanel)` |
| ☐ | Power status | État alimentation | Estado de alimentación | `inline lbl() (DebugPanel)` |
| ☐ | Provider statuspages | Statut fournisseurs | Estado de proveedores | `inline lbl() (DebugPanel)` |
| ☐ | Radar AI snapshots | Captures radar IA | Capturas radar IA | `inline lbl() (DebugPanel)` |
| ☐ | Recent logs | Journaux récents | Registros recientes | `inline lbl() (DebugPanel)` |
| ☐ | Recent service calls | Appels de service récents | Llamadas de servicio recientes | `inline lbl() (DebugPanel)` |
| ☐ | Remote clients | Clients distants | Clientes remotos | `inline lbl() (DebugPanel)` |
| ☐ | Response times | Temps de réponse | Tiempos de respuesta | `inline lbl() (DebugPanel)` |
| ☐ | Security events | Événements de sécurité | Eventos de seguridad | `inline lbl() (DebugPanel)` |
| ☐ | Server config | Configuration serveur | Configuración servidor | `inline lbl() (DebugPanel)` |
| ☐ | Server KPI | KPI serveur | KPI servidor | `inline lbl() (DebugPanel)` |
| ☐ | Update check | Vérification MAJ | Comprobación actualización | `inline lbl() (DebugPanel)` |
| ☐ | Vulnerability scan | Analyse vulnérabilités | Análisis vulnerabilidades | `inline lbl() (DebugPanel)` |
| ☐ | last fetch | dernière requête | última consulta | `inline lbl() (DebugPanel)` |

## Debug panel — tags / status (v3 inline lbl)

| Validé | EN | FR | ES | Clé / Contexte |
|--------|----|----|-----|----------------|
| ☐ | TRUE | VRAI | VERDADERO | `inline lbl() (DebugPanel boolLabel)` |
| ☐ | FALSE | FAUX | FALSO | `inline lbl() (DebugPanel boolLabel)` |
| ☐ | NONE | AUCUN | NINGUNO | `inline lbl() (DebugPanel indicatorLabel)` |
| ☐ | MINOR | MINEUR | MENOR | `inline lbl() (DebugPanel indicatorLabel)` |
| ☐ | MAJOR | MAJEUR | MAYOR | `inline lbl() (DebugPanel indicatorLabel)` |
| ☐ | CRITICAL | CRITIQUE | CRÍTICO | `inline lbl() (DebugPanel indicatorLabel)` |
| ☐ | MAINTENANCE | MAINTENANCE | MANTENIMIENTO | `inline lbl() (DebugPanel indicatorLabel)` |
| ☐ | BLOCKED | BLOQUÉ | BLOQUEADO | `inline lbl() (DebugPanel security tag)` |
| ☐ | YES | OUI | SÍ | `inline lbl() (DebugPanel update)` |
| ☐ | UP-TO-DATE | À JOUR | AL DÍA | `inline lbl() (DebugPanel update)` |

## Debug panel — empty-state messages (v3 inline lbl)

| Validé | EN | FR | ES | Clé / Contexte |
|--------|----|----|-----|----------------|
| ☐ | Cache is empty. | Cache vide. | Caché vacío. | `inline lbl() (DebugPanel)` |
| ☐ | No logs to show. | Aucun journal à afficher. | Sin registros para mostrar. | `inline lbl() (DebugPanel)` |
| ☐ | No provider status available. | Aucun statut fournisseur disponible. | Estado del proveedor no disponible. | `inline lbl() (DebugPanel)` |
| ☐ | No quota data tracked yet. | Aucune donnée de quota suivie. | Sin datos de cuota rastreados. | `inline lbl() (DebugPanel)` |
| ☐ | No radar snapshots yet. | Aucune capture radar pour l'instant. | Sin capturas radar todavía. | `inline lbl() (DebugPanel)` |
| ☐ | No remote clients tracked yet. | Aucun client distant suivi. | Ningún cliente remoto rastreado. | `inline lbl() (DebugPanel)` |
| ☐ | No security events. | Aucun événement de sécurité. | Ningún evento de seguridad. | `inline lbl() (DebugPanel)` |
| ☐ | No service activity yet. | Aucune activité de service. | Sin actividad de servicio. | `inline lbl() (DebugPanel)` |

## Debug panel — other inline copy

| Validé | EN | FR | ES | Clé / Contexte |
|--------|----|----|-----|----------------|
| ☐ | Vulnerability scanning + automatic security PRs now live on GitHub via Dependabot — see the alerts dashboard for the live source of truth. | L'analyse des vulnérabilités et les PR de sécurité automatiques vivent maintenant sur GitHub via Dependabot — voir le tableau d'alertes pour la source en temps réel. | El análisis de vulnerabilidades y los PR de seguridad automáticos viven ahora en GitHub vía Dependabot — consulta el panel de alertas para la fuente en tiempo real. | `inline lbl() (DebugPanel)` |

## Debug panel — legacy v2 i18n keys (still wired through `t()`)

| Validé | EN | FR | ES | Clé / Contexte |
|--------|----|----|-----|----------------|
| ☐ | AQI SOURCE | SOURCE QUALITÉ AIR | FUENTE CALIDAD AIRE | `debug.aqiSource` |
| ☐ | ALLOW REMOTE | ACCÈS DISTANT | ACCESO REMOTO | `debug.allowRemote` |
| ☐ | API CALLS (session) | APPELS API (session) | LLAMADAS API (sesión) | `debug.apiCallsSession` |
| ☐ | AVG | MOY | PROM | `debug.avgMs` |
| ☐ | CACHE | CACHE | CACHÉ | `debug.cache` |
| ☐ | CACHE HIT RATE | TAUX DE CACHE | TASA DE CACHÉ | `debug.cacheHitRate` |
| ☐ | CLIENT KPIs | KPIs CLIENT | KPIs CLIENTE | `debug.clientKpi` |
| ☐ | COMMENT | COMMENTAIRE | COMENTARIO | `debug.comment` |
| ☐ | COUNT | NOMBRE | CANTIDAD | `debug.count` |
| ☐ | CPU TEMP | TEMP. CPU | TEMP. CPU | `debug.cpuTemp` |
| ☐ | DEBUG MODE | MODE DÉBOGAGE | MODO DEPURACIÓN | `debug.debugMode` |
| ☐ | DESCRIPTION | DESCRIPTION | DESCRIPCIÓN | `debug.description` |
| ☐ | DISABLED | DÉSACTIVÉ | DESACTIVADO | `debug.disabled` |
| ☐ | DPI RATIO | RATIO DPI | RATIO DPI | `debug.pixelRatio` |
| ☐ | ENABLED | ACTIVÉ | ACTIVADO | `debug.enabled` |
| ☐ | ENDPOINT | ENDPOINT | ENDPOINT | `debug.endpoint` |
| ☐ | EXPIRED | EXPIRÉ | EXPIRADO | `debug.expired` |
| ☐ | FAN SPEED | VENTILATEUR | VENTILADOR | `debug.fanSpeed` |
| ☐ | FIRST SEEN | PREMIÈRE CONNEXION | PRIMERA CONEXIÓN | `debug.clientFirstSeen` |
| ☐ | HEAP JS | HEAP JS | HEAP JS | `debug.jsHeap` |
| ☐ | HEAP TOTAL | HEAP TOTAL | HEAP TOTAL | `debug.heapTotal` |
| ☐ | HEAP USED | HEAP UTILISÉ | HEAP USADO | `debug.heapUsed` |
| ☐ | HITS | SUCCÈS | ACIERTOS | `debug.hits` |
| ☐ | INDICATOR | INDICATEUR | INDICADOR | `debug.indicator` |
| ☐ | IP ADDRESS | ADRESSE IP | DIRECCIÓN IP | `debug.clientIp` |
| ☐ | LAST CALL | DERNIER APPEL | ÚLTIMA LLAMADA | `debug.lastCall` |
| ☐ | LAST SEEN | DERNIÈRE CONNEXION | ÚLTIMA CONEXIÓN | `debug.clientLastSeen` |
| ☐ | LOGS (last 100 lines) | JOURNAUX (100 dernières lignes) | REGISTROS (últimas 100 líneas) | `debug.logs` |
| ☐ | MAP COORDS | COORDS CARTE | COORDS MAPA | `debug.mapCoords` |
| ☐ | MAP ZOOM | ZOOM CARTE | ZOOM MAPA | `debug.mapZoom` |
| ☐ | MISSES | MANQUÉS | FALLOS | `debug.misses` |
| ☐ | NODE ENV | ENV NODE | ENV NODE | `debug.nodeEnv` |
| ☐ | NODE VERSION | VERSION NODE | VERSIÓN NODE | `debug.nodeVersion` |
| ☐ | No AI summary has been generated yet | Aucun résumé IA n'a encore été généré | Aún no se ha generado ningún resumen IA | `debug.noRadarSnapshots` |
| ☐ | No API calls recorded | Aucun appel API enregistré | Sin llamadas API registradas | `debug.noApiCalls` |
| ☐ | No blocked requests | Aucune requête bloquée | Sin solicitudes bloqueadas | `debug.noBlockedRequests` |
| ☐ | No entries in cache | Aucune entrée dans le cache | Sin entradas en caché | `debug.noCache` |
| ☐ | No logs available | Aucun journal disponible | Sin registros disponibles | `debug.noLogs` |
| ☐ | No provider status available | Aucun état de fournisseur disponible | Sin estado de proveedor disponible | `debug.noProviderStatus` |
| ☐ | No remote clients connected since last restart | Aucun client distant connecté depuis le dernier redémarrage | Ningún cliente remoto conectado desde el último reinicio | `debug.noRemoteClients` |
| ☐ | No requests recorded yet | Aucune requête enregistrée | Sin solicitudes registradas | `debug.noRequestsYet` |
| ☐ | No service calls recorded yet | Aucun appel de service enregistré | Sin llamadas de servicio registradas | `debug.noServicesYet` |
| ☐ | Not available | Non disponible | No disponible | `debug.notAvailable` |
| ☐ | Not supported by browser | Non supporté par le navigateur | No compatible con el navegador | `debug.notSupported` |
| ☐ | OFFLINE | HORS LIGNE | SIN CONEXIÓN | `debug.offline` |
| ☐ | ONLINE | EN LIGNE | EN LÍNEA | `debug.online` |
| ☐ | PAGE LOAD | CHARGEMENT PAGE | CARGA DE PÁGINA | `debug.pageLoad` |
| ☐ | POWER | ALIMENTATION | ALIMENTACIÓN | `debug.powerStatus` |
| ☐ | PROVIDER | FOURNISSEUR | PROVEEDOR | `debug.provider` |
| ☐ | PROVIDER STATUS | ÉTAT DES FOURNISSEURS | ESTADO DE PROVEEDORES | `debug.providerStatus` |
| ☐ | QUOTA | QUOTA | CUOTA | `debug.quota` |
| ☐ | QUOTAS | QUOTAS | CUOTAS | `debug.quotas` |
| ☐ | RADAR SNAPSHOTS (LAST 10) | INSTANTANÉS RADAR (10 DERNIERS) | INSTANTÁNEAS DE RADAR (ÚLTIMAS 10) | `debug.radarSnapshots` |
| ☐ | Radar text passed to Claude | Texte radar transmis à Claude | Texto del radar enviado a Claude | `debug.radarSnapshotInput` |
| ☐ | REMOTE CLIENTS | CLIENTS DISTANTS | CLIENTES REMOTOS | `debug.remoteClients` |
| ☐ | REQUESTS | REQUÊTES | SOLICITUDES | `debug.clientRequests` |
| ☐ | Resulting summary | Résumé produit | Resumen producido | `debug.radarSnapshotOutput` |
| ☐ | RESPONSE TIMES | TEMPS DE RÉPONSE | TIEMPOS DE RESPUESTA | `debug.responseTimes` |
| ☐ | SCREEN | ÉCRAN | PANTALLA | `debug.screenResolution` |
| ☐ | SECURITY EVENTS | ÉVÉNEMENTS DE SÉCURITÉ | EVENTOS DE SEGURIDAD | `debug.securityEvents` |
| ☐ | SERVER CONFIG | CONFIG SERVEUR | CONFIG SERVIDOR | `debug.serverConfig` |
| ☐ | SERVER KPIs | KPIs SERVEUR | KPIs SERVIDOR | `debug.serverKpi` |
| ☐ | SERVICE | SERVICE | SERVICIO | `debug.service` |
| ☐ | SERVICES | SERVICES | SERVICIOS | `debug.services` |
| ☐ | STATUS | STATUT | ESTADO | `debug.status` |
| ☐ | THIS HOUR | CETTE HEURE | ESTA HORA | `debug.thisHour` |
| ☐ | THIS MONTH | CE MOIS | ESTE MES | `debug.thisMonth` |
| ☐ | TODAY | AUJOURD'HUI | HOY | `debug.today` |
| ☐ | TYPE | TYPE | TIPO | `debug.type` |
| ☐ | UPTIME | DISPONIBILITÉ | TIEMPO ACTIVO | `debug.uptime` |
| ☐ | Under-voltage | Sous-tension | Bajo voltaje | `debug.underVoltage` |
| ☐ | VULNERABILITY SCAN | ANALYSE DES VULNÉRABILITÉS | ANÁLISIS DE VULNERABILIDADES | `debug.vulnerabilityScan` |
| ☐ | Dependency vulnerabilities are scanned and patched automatically by Dependabot on GitHub. The list of open and merged dependency PRs (security + version updates) is publicly visible on the repo: | Les vulnérabilités des dépendances sont scannées et corrigées automatiquement par Dependabot sur GitHub. La liste des PRs de dépendances ouvertes et mergées (sécurité + mises à jour de version) est publiquement visible sur le repo : | Las vulnerabilidades de dependencias son escaneadas y parcheadas automáticamente por Dependabot en GitHub. La lista de PRs de dependencias abiertas y fusionadas (seguridad + actualizaciones de versión) es visible públicamente en el repositorio: | `debug.vulnerabilityScanNotice` |
| ☐ | Copy | Copier | Copiar | `debug.radarSnapshotCopy` |
| ☐ | Copied! | Copié ! | ¡Copiado! | `debug.radarSnapshotCopied` |
| ☐ | Export JSON | Exporter JSON | Exportar JSON | `debug.radarSnapshotExport` |
| ☐ | Download all snapshots as a JSON file | Télécharger tous les instantanés au format JSON | Descargar todas las instantáneas como archivo JSON | `debug.radarSnapshotExportTitle` |
| ☐ | Freq. capped | Fréq. limitée | Frec. limitada | `debug.freqCapped` |
| ☐ | Throttled | Ralenti | Limitado | `debug.throttledStatus` |
| ☐ | Temp. limit | Limite temp. | Límite temp. | `debug.tempLimit` |
| ☐ | since reboot | depuis redémarrage | desde reinicio | `debug.sinceReboot` |
| ☐ | last fetch | dernière récupération | última consulta | `debug.lastFetch` |

## Misc / one-offs

| Validé | EN | FR | ES | Clé / Contexte |
|--------|----|----|-----|----------------|
| ☐ | cccc LLLL d | cccc d LLLL | cccc d 'de' LLLL | `dateFormat` (Luxon pattern; reorders day/month for FR/ES) |

---

## Universal strings (identical across EN/FR/ES — listed for completeness)

These strings are byte-identical in the three locales — translators only need to confirm intent. Source noted where it's not obvious from the key.

| EN = FR = ES | Source |
|---|--------|
| `ON` | `settings.on` |
| `OFF` | `settings.off` |
| `RainViewer` | `settings.radarSourceRainviewer` |
| `Env. Canada` | `settings.radarSourceEccc` |
| `M` | `settings.fontM` |
| `UV` | `metrics.uv`, `badges.uv` |
| `IQA` | `badges.iqa` |
| `RADAR` | `radar.legend` |
| `NowCast` | `badges.aqiKindNowcast` |
| `Internet` | `debug.internet` |
| `OK` | `debug.powerOk` |
| `MIN` | `debug.minMs` |
| `MAX` | `debug.maxMs` |
| `TOTAL` | `debug.total` |
| `RSS` | `debug.rss` |
| `TTL` | `debug.ttl` |
| `LAT` | `debug.lat` |
| `LON` | `debug.lon` |
| `FPS` | `debug.fps` |
| `SYSTEMD` | `debug.systemd` |
| `HOSTNAME` | `debug.hostname` |
| `Deps` | `update.deps` |
| `EPA AirNow` | `badges.aqiSourceAirNow` (also row above) |
| `OpenAQ` | `badges.aqiSourceOpenAq` (also row above) |
| `EN`, `FR`, `ES` | language `Seg` button labels (SettingsPanel) |
| `12h`, `24h` | clock `Seg` button labels (SettingsPanel) |
| `°F`, `°C`, `K` | temp `Seg` button labels (SettingsPanel) |
| `mph`, `m/s`, `kph`, `in`, `mm`, `mi`, `km` | unit `Seg` button labels (SettingsPanel) |
| `Mapbox`, `Tomorrow.io`, `LocationIQ`, `Anthropic` | API key provider names (SettingsPanel) |
| `AUTO` | dark-mode `Seg` button label (SettingsPanel) |
| `Temp`, `Dist.`, `Longitude` | SettingsPanel field labels (no FR/ES variant) |
