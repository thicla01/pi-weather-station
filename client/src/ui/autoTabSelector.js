// Auto-select forecast tab — pure hazard-priority router.
//
// Given a snapshot of the signals the app already has (ECCC + NWS gov
// alerts, radar nowcast verdict, Tomorrow.io current + hourly forecast)
// plus the device/UI context (idle stage, touch capability, quiet hours,
// the opt-in pref) and the router's own state (current tab, manual hold,
// last switch), `selectAutoTab` returns the metric tab to switch to —
// or `null` to leave the user's tab alone. It invents no new severity
// opinion: it is a deterministic projection of the EXISTING hazard verdict
// onto the chart's metric index, so the tab can never disagree with the
// banner. See docs/auto-forecast-tab-selection-design.md (the LLD).
//
// MODULE FORMAT: this is CommonJS (not ESM like the rest of client/src/ui)
// on purpose. It encodes empirical thresholds that MUST stay regression-
// tested, exactly like the server-side radar-trend thresholds — and the
// `node --test` runner can only `require()` CJS. Authoring it as CJS lets
// test/autoTabSelector.test.js exercise the REAL module (no verbatim copy
// to drift out of sync). Webpack imports CJS into the ESM client fine, so
// the Phase-1 hook can `import { selectAutoTab } from "~/ui/autoTabSelector"`.

// ── Tabs (map to ChartTabs METRICS = ["temp","wind","precip","grid"]) ──
const TABS = { TEMP: "temp", WIND: "wind", PRECIP: "precip", GRID: "grid" };

// ── Thresholds — NATIVE units only (°C, m/s, mm/h, 0-100 %). The reducer
//    never reads the user's display-unit prefs; conversion happens at
//    render. ENTER/EXIT are the hysteresis bands. km/h / °F equivalents in
//    comments are documentation only. Anchors: ECCC / NWS / Beaufort. ──
const GUST_ENTER_MS = 25.0; // 90 km/h — ECCC wind-warning / severe-Tstorm gust
const GUST_EXIT_MS = 20.8; //  75 km/h
const SUSTAINED_ENTER_MS = 19.4; // 70 km/h — ECCC sustained wind warning
const SUSTAINED_EXIT_MS = 16.7; //  60 km/h
const PRECIP_PROB_ENTER = 70; // % — high-confidence wet window
const PRECIP_PROB_EXIT = 55; // %
const PRECIP_RATE_ENTER_MMH = 7.6; // NWS "heavy" rain rate
const PRECIP_RATE_EXIT_MMH = 4.0;
const HEAT_ENTER_C = 32; // ECCC heat-event territory (feels-like)
const HEAT_EXIT_C = 29;
const COLD_ENTER_C = -25; // ECCC extreme-cold territory (feels-like)
const COLD_EXIT_C = -20;

// ── Timing ──
const HOLD_MS = 20 * 60 * 1000; // manual-tap hold TTL
const DWELL_MS = 10 * 60 * 1000; // min interval between auto switches
const FORECAST_WINDOW_MS = 6 * 60 * 60 * 1000; // "next 6 h" forecast window

// ── Eligibility / severity (mirror client/src/ui/alertLogic.js) ──
const ELIGIBLE_GOV_TIERS = ["red", "orange"];
const SEVERE_SEVERITIES = ["severe", "extreme"];

// ── Gov-alert event → tab keyword families. Matched against
//    `(title_en + " " + eventType)` lowercased, which is English for BOTH
//    NWS (`event`) and ECCC (`alert_name_en`) and ALSO catches ECCC's
//    machine slug (`alert_code`, e.g. "heat" / "wind"). Order matters:
//    TEMP → WIND → PRECIP so "wind chill" → Temp (not Wind) and "freezing
//    rain" → Precip (not Temp). Unmatched → null (no guess). ──
const TEMP_RE = /\b(heat|cold|frost|chill|arctic|flash\s*freeze)\b/;
const WIND_RE = /\b(wind|gale|gust|hurricane|tropical\s+storm)\b/;
const PRECIP_RE =
  /\b(rain|rainfall|snow|snowfall|squall|blizzard|winter|freezing|ice|thunder|thunderstorm|storm|tornado|flood|drizzle|hail|tropical|monsoon)\b/;

/**
 * Is this a hazardous "happening now" Tomorrow.io weather code?
 * 8000 = thunderstorm; 6000-6201 = freezing rain / drizzle.
 *
 * @param {?Number} code Tomorrow.io weatherCode
 * @returns {Boolean} true when the code denotes an immediately hazardous condition
 */
function isHazardousNowCode(code) {
  return code === 8000 || (typeof code === "number" && code >= 6000 && code <= 6201);
}

/**
 * Classify a normalized gov alert to a forecast tab via keyword families.
 * Works identically for NWS and ECCC because it reads the English title +
 * the eventType slug. Returns null when the event maps to no metric
 * (fog, special weather statement, air quality, …).
 *
 * @param {?Object} alert normalized alert ({ title_en, eventType, … })
 * @returns {?String} a TABS value, or null
 */
function classifyAlertTab(alert) {
  if (!alert) return null;
  const hay = `${alert.title_en || ""} ${alert.eventType || ""}`.toLowerCase();
  if (TEMP_RE.test(hay)) return TABS.TEMP;
  if (WIND_RE.test(hay)) return TABS.WIND;
  if (PRECIP_RE.test(hay)) return TABS.PRECIP;
  return null;
}

/**
 * Stable key for a gov alert, used to detect a *newly arrived* alert for
 * the manual-hold puncture. Falls back to a composite when upstream `id`
 * is null (ECCC/NWS ids are occasionally absent).
 *
 * @param {?Object} a normalized alert
 * @returns {String} a stable identity key
 */
function alertKey(a) {
  if (!a) return "";
  return a.id || `${a.source || ""}|${a.eventType || ""}|${a.expiresAt || ""}`;
}

/**
 * Keys of the severe/extreme alerts currently present (for the hook to
 * accumulate into its "known" set each tick).
 *
 * @param {?Array<Object>} govAlerts normalized alert array
 * @returns {Array<String>} keys of severe/extreme alerts
 */
function severeAlertKeys(govAlerts) {
  return (govAlerts || [])
    .filter((a) => a && SEVERE_SEVERITIES.includes(a.severity))
    .map(alertKey);
}

/**
 * The first severe/extreme alert whose key is NOT already known — i.e. a
 * genuinely new warning that should puncture a manual hold / dwell / gate.
 *
 * @param {?Array<Object>} govAlerts normalized alert array
 * @param {?Array<String>} knownKeys keys captured at hold time
 * @returns {?Object} the new severe alert, or null
 */
function firstNewSevereAlert(govAlerts, knownKeys) {
  const known = new Set(knownKeys || []);
  return (
    (govAlerts || []).find(
      (a) => a && SEVERE_SEVERITIES.includes(a.severity) && !known.has(alertKey(a)),
    ) || null
  );
}

/**
 * The top eligible (red/orange) gov alert. The array is already severity-
 * sorted upstream, so the first eligible one is the most urgent.
 *
 * @param {?Array<Object>} govAlerts normalized alert array
 * @returns {?Object} the alert, or null
 */
function topEligibleGovAlert(govAlerts) {
  return (govAlerts || []).find((a) => a && ELIGIBLE_GOV_TIERS.includes(a.tier)) || null;
}

/**
 * Reduce the Tomorrow.io current + hourly payloads to the native-unit
 * scalars the forecast class needs, over the next 6 h. Partial-data-
 * tolerant: any missing field yields null (treated downstream as "that
 * sub-trigger did not fire"), never a crash and never a fabricated 0.
 *
 * NOTE on temperature: `temperatureApparent` (feels-like) is only in
 * CURRENT_FIELDS, not hourly, so the Temp class reads current apparent
 * temp. A forward-looking apparent-temp trigger would need the field
 * added to HOURLY_FIELDS (a server change, out of Phase-0 scope).
 *
 * @param {?Object} current Tomorrow.io current interval (or its `.values`)
 * @param {?Array<Object>} hourly Tomorrow.io hourly intervals
 * @param {Number} now epoch ms (the window anchor)
 * @returns {Object} native-unit forecast summary
 */
function summarizeForecast(current, hourly, now) {
  const cutoff = now + FORECAST_WINDOW_MS;
  const vals = (hourly || [])
    .filter((iv) => {
      const t = iv && iv.startTime != null ? Date.parse(iv.startTime) : NaN;
      return Number.isFinite(t) ? t <= cutoff : true; // no timestamp → include (defensive)
    })
    .map((iv) => (iv && iv.values ? iv.values : iv))
    .filter(Boolean);

  const pick = (key, reducer) => {
    const nums = vals
      .map((v) => v[key])
      .filter((n) => typeof n === "number" && Number.isFinite(n));
    return nums.length ? reducer(nums) : null;
  };
  const max = (key) => pick(key, (ns) => Math.max(...ns));

  const cur = current && current.values ? current.values : current;
  const curNum = (key) =>
    cur && typeof cur[key] === "number" && Number.isFinite(cur[key]) ? cur[key] : null;

  return {
    currentWeatherCode: curNum("weatherCode"),
    currentApparentC: curNum("temperatureApparent"),
    maxGustMs: max("windGust"),
    maxSustainedMs: max("windSpeed"),
    maxPrecipProb: max("precipitationProbability"),
    maxPrecipRateMmH: max("precipitationIntensity"),
  };
}

/**
 * Forecast-class decision (priority Wind → Precip → Temp). Each numeric
 * trigger is hysteresis-gated: it fires at the ENTER band, and once it
 * owns the current tab it stays "warm" down to the EXIT band — so a value
 * hovering at its line can't flap the tab.
 *
 * @param {?Object} fc summary from summarizeForecast
 * @param {?String} currentTab the tab currently shown (for hysteresis)
 * @returns {?{tab: String, reasonKey: String}} or null
 */
function forecastTab(fc, currentTab) {
  if (!fc) return null;
  const hi = (val, enter, exit, tab) =>
    val != null && (val >= enter || (currentTab === tab && val >= exit));
  const lo = (val, enter, exit, tab) =>
    val != null && (val <= enter || (currentTab === tab && val <= exit));

  if (
    hi(fc.maxGustMs, GUST_ENTER_MS, GUST_EXIT_MS, TABS.WIND) ||
    hi(fc.maxSustainedMs, SUSTAINED_ENTER_MS, SUSTAINED_EXIT_MS, TABS.WIND)
  ) {
    return { tab: TABS.WIND, reasonKey: "wind" };
  }
  if (
    hi(fc.maxPrecipProb, PRECIP_PROB_ENTER, PRECIP_PROB_EXIT, TABS.PRECIP) ||
    hi(fc.maxPrecipRateMmH, PRECIP_RATE_ENTER_MMH, PRECIP_RATE_EXIT_MMH, TABS.PRECIP) ||
    isHazardousNowCode(fc.currentWeatherCode)
  ) {
    return { tab: TABS.PRECIP, reasonKey: "precip" };
  }
  if (
    hi(fc.currentApparentC, HEAT_ENTER_C, HEAT_EXIT_C, TABS.TEMP) ||
    lo(fc.currentApparentC, COLD_ENTER_C, COLD_EXIT_C, TABS.TEMP)
  ) {
    return { tab: TABS.TEMP, reasonKey: "temp" };
  }
  return null;
}

/**
 * Build a decision, or null when the chosen tab is already showing (no
 * visible switch needed).
 *
 * @param {String} tab the target tab
 * @param {Object} reason { badge, …trigger detail }
 * @param {?String} currentTab the tab currently shown
 * @returns {?{tab: String, sourceBadge: String, reason: Object}} decision or null
 */
function commit(tab, reason, currentTab) {
  if (!tab || tab === currentTab) return null;
  return { tab, sourceBadge: reason.badge, reason };
}

/**
 * The hazard-priority router. Pure: same inputs → same output. Evaluates
 * the priority ladder (new-severe puncture → active gov alert → radar
 * nowcast → forecast threshold → calm) behind the gates (opt-in, idle
 * stage, manual hold, dwell, quiet hours). Returns the tab to switch to,
 * or null to leave the user's tab untouched (the null-on-calm contract).
 *
 * @param {Object} signals { govAlerts, radarAlertState, forecast, env }
 * @param {Object} state { currentTab, manualHoldAt, lastAutoSwitchAt, knownSevereAlertKeys }
 * @param {Number} now epoch ms
 * @returns {?{tab: String, sourceBadge: String, reason: Object}} decision or null
 */
function selectAutoTab(signals, state, now) {
  const s = signals || {};
  const st = state || {};
  const env = s.env || {};

  if (!env.autoSelectEnabled) return null; // opt-in: off by default

  const currentTab = st.currentTab || null;

  // ── Puncture: a NEW severe/extreme gov alert overrides EVERY gate
  //    (manual hold, dwell, stage-0 inhibit, quiet hours). The one moment
  //    the feature must earn its keep. ──
  const newSevere = firstNewSevereAlert(s.govAlerts, st.knownSevereAlertKeys);
  if (newSevere) {
    const tab = classifyAlertTab(newSevere) || TABS.PRECIP; // severe + unmappable → storm default
    return commit(tab, { badge: newSevere.source, alert: newSevere, puncture: true }, currentTab);
  }

  // ── Gates (non-puncture). Any true → do nothing. ──
  // Stage-0 inhibit applies ONLY to touch-capable devices: a non-touch
  // display (the stable monitor) has no reader to protect, so it must NOT
  // be inhibited — see §6.1 of the LLD.
  if (env.touchCapable && env.sleepStage === 0) return null;
  if (st.manualHoldAt != null && now - st.manualHoldAt < HOLD_MS) return null;
  if (st.lastAutoSwitchAt != null && now - st.lastAutoSwitchAt < DWELL_MS) return null;
  if (env.nightQuiet) return null; // red-tier already handled by the puncture above

  // ── Priority ladder. ──
  // Class 2 — active eligible (red/orange) gov alert.
  const gov = topEligibleGovAlert(s.govAlerts);
  if (gov) {
    const tab = classifyAlertTab(gov);
    if (tab) return commit(tab, { badge: gov.source, alert: gov }, currentTab);
    // red/orange but unmappable (fog, special statement) → fall through (no guess).
  }

  // Class 3 — radar nowcast (getRadarAlertState already gates at maxSev ≥ 2;
  // require ≥ mid confidence). Always → Precip (radar only measures rain).
  const r = s.radarAlertState;
  if (r && (r.confidenceBucket === "mid" || r.confidenceBucket === "high")) {
    return commit(TABS.PRECIP, { badge: "RADAR", radar: r }, currentTab);
  }

  // Class 4 — forecast threshold (Wind → Precip → Temp, hysteresis-gated).
  const fc = forecastTab(s.forecast, currentTab);
  if (fc) return commit(fc.tab, { badge: "FCST", reasonKey: fc.reasonKey }, currentTab);

  // Class 5 — calm: keep the user's tab.
  return null;
}

/**
 * The ungated hazard verdict for the reason chip: what tab the live signals
 * currently justify (gov alert → its tab, radar → Precip, forecast → its
 * tab), ignoring the gates, the dwell floor, the manual hold, the severe
 * puncture, and the same-tab collapse. This is NOT a switch decision — it
 * drives the chip honestly: the chip shows only while the visible tab is
 * still justified by a live hazard, and clears when this returns null
 * (genuine calm) so a stale chip can't outlive the weather that caused it.
 *
 * @param {Object} signals { govAlerts, radarAlertState, forecast }
 * @param {?String} currentTab the active tab (for forecast hysteresis)
 * @returns {?{tab: String, sourceBadge: String}} the live verdict, or null
 */
function hazardTab(signals, currentTab) {
  const s = signals || {};
  const gov = topEligibleGovAlert(s.govAlerts);
  if (gov) {
    const tab = classifyAlertTab(gov);
    if (tab) return { tab, sourceBadge: gov.source };
  }
  const r = s.radarAlertState;
  if (r && (r.confidenceBucket === "mid" || r.confidenceBucket === "high")) {
    return { tab: TABS.PRECIP, sourceBadge: "RADAR" };
  }
  const fc = forecastTab(s.forecast, currentTab);
  if (fc) return { tab: fc.tab, sourceBadge: "FCST" };
  return null;
}

module.exports = {
  selectAutoTab,
  hazardTab,
  // pure helpers (exported for the Phase-1 hook + tests)
  classifyAlertTab,
  summarizeForecast,
  forecastTab,
  alertKey,
  severeAlertKeys,
  firstNewSevereAlert,
  topEligibleGovAlert,
  isHazardousNowCode,
  // constants
  TABS,
  GUST_ENTER_MS,
  GUST_EXIT_MS,
  SUSTAINED_ENTER_MS,
  SUSTAINED_EXIT_MS,
  PRECIP_PROB_ENTER,
  PRECIP_PROB_EXIT,
  PRECIP_RATE_ENTER_MMH,
  PRECIP_RATE_EXIT_MMH,
  HEAT_ENTER_C,
  HEAT_EXIT_C,
  COLD_ENTER_C,
  COLD_EXIT_C,
  HOLD_MS,
  DWELL_MS,
  FORECAST_WINDOW_MS,
  ELIGIBLE_GOV_TIERS,
  SEVERE_SEVERITIES,
};
