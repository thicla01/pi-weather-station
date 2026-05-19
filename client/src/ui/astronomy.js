/**
 * Astronomy helpers — moon phase + next solstice/equinox.
 *
 * Everything is computed locally. No API call, no token cost, no
 * quota. The phase moves slowly enough that a once-per-day refresh
 * is more than sufficient; the four annual events change once a year.
 *
 * Sources:
 *   - Moon phase: synodic month elapsed since a known new moon
 *     reference, accurate to ±1 hour over a few centuries (the
 *     synodic period drifts < 1 s/century).
 *   - Solstice/equinox: Meeus, *Astronomical Algorithms*, chapter 27
 *     (mean Julian-date polynomial for each of the four events).
 *     Accurate to ~minutes over the year-3000 timespan, which is
 *     orders of magnitude better than the day-resolution display
 *     needs.
 *
 * Hemisphere note: the moon glyphs are drawn for Northern-Hemisphere
 * viewing (waxing on the right, waning on the left). In the Southern
 * Hemisphere the visual orientation flips. The kiosk's primary
 * audience is Quebec / North America, so we accept the NH convention.
 */

// Reference new moon: 2000-01-06 18:14 UTC. Synodic month: 29.530589
// days. Both values from NASA / JPL ephemerides.
const NEW_MOON_REF_MS = Date.UTC(2000, 0, 6, 18, 14);
const SYNODIC_MONTH_MS = 29.530589 * 86400000;

// 8-phase glyphs (Unicode). Index 0 = new moon, 4 = full.
const MOON_GLYPHS = ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"];

// i18n key suffixes for the 8 phases — consumers translate via
// `t("astronomy.moonPhase." + key)`.
const MOON_PHASE_KEYS = [
  "newMoon", "waxingCrescent", "firstQuarter", "waxingGibbous",
  "fullMoon", "waningGibbous", "lastQuarter", "waningCrescent",
];

/**
 * Compute the moon phase fraction at a given moment.
 *
 * Returns a value in [0, 1):
 *   - 0.00 → new moon (no illuminated side facing Earth)
 *   - 0.25 → first quarter (right half lit, waxing)
 *   - 0.50 → full moon
 *   - 0.75 → last quarter (left half lit, waning)
 *
 * @param {Date} [date=new Date()]
 * @returns {number} fraction 0 ≤ f < 1
 */
export function moonPhaseFraction(date = new Date()) {
  const elapsed = date.getTime() - NEW_MOON_REF_MS;
  // Positive modulo so dates before the reference still return [0,1).
  const within = ((elapsed % SYNODIC_MONTH_MS) + SYNODIC_MONTH_MS) % SYNODIC_MONTH_MS;
  return within / SYNODIC_MONTH_MS;
}

/**
 * Illuminated fraction of the lunar disc, 0..1.
 *
 * 0 = new moon, 0.5 = quarter (half lit), 1 = full. Standard
 * astronomy formula `(1 - cos(2π × phase)) / 2` where phase is the
 * synodic position.
 *
 * @param {Date} [date=new Date()]
 * @returns {number} illumination 0..1
 */
export function moonIllumination(date = new Date()) {
  return (1 - Math.cos(2 * Math.PI * moonPhaseFraction(date))) / 2;
}

/**
 * Pick the closest of 8 phase glyphs for the current moment. Used
 * by TimeBlock to render the moon chip alongside sunrise/sunset.
 *
 * @param {Date} [date=new Date()]
 * @returns {{glyph: string, i18nKey: string, fraction: number, illumination: number}}
 */
export function moonPhase(date = new Date()) {
  const fraction = moonPhaseFraction(date);
  const idx = Math.round(fraction * 8) % 8;
  return {
    glyph: MOON_GLYPHS[idx],
    i18nKey: MOON_PHASE_KEYS[idx],
    fraction,
    illumination: moonIllumination(date),
  };
}

/**
 * Find the next time the moon reaches a given target phase fraction.
 *
 * Uses the synodic-month model: the phase advances linearly from 0 →
 * 1 over `SYNODIC_MONTH_MS`. Given the current fraction at `now`, we
 * jump forward the remaining fraction × month. Accurate to ~1 hour
 * over the next decade or so — plenty for a "next full moon: 2026-05-31"
 * display.
 *
 * @param {Date} now
 * @param {number} target  0 for new moon, 0.5 for full moon
 * @returns {Date}
 */
function nextPhaseDate(now, target) {
  const current = moonPhaseFraction(now);
  // Distance forward to the target, always positive (wraps past 1).
  const delta = ((target - current) + 1) % 1;
  // Guard: if we're exactly on the target the modulo gives 0; advance
  // a full synodic month so we return the NEXT occurrence rather than
  // the present moment.
  const fraction = delta === 0 ? 1 : delta;
  return new Date(now.getTime() + fraction * SYNODIC_MONTH_MS);
}

/** Next new moon after `date`. @param {Date} [date=new Date()] @returns {Date} */
export function nextNewMoon(date = new Date()) {
  return nextPhaseDate(date, 0);
}

/** Next full moon after `date`. @param {Date} [date=new Date()] @returns {Date} */
export function nextFullMoon(date = new Date()) {
  return nextPhaseDate(date, 0.5);
}

// Meeus chapter 27 tables — mean Julian-date polynomial coefficients
// for each of the four annual solar events. Y = (year - 2000) / 1000.
const MEEUS_TABLES = {
  marchEquinox:     [2451623.80984, 365242.37404,  0.05169, -0.00411, -0.00057],
  juneSolstice:     [2451716.56767, 365241.62603,  0.00325,  0.00888, -0.00030],
  septemberEquinox: [2451810.21715, 365242.01767, -0.11575,  0.00337,  0.00078],
  decemberSolstice: [2451900.05952, 365242.74049, -0.06223, -0.00823,  0.00032],
};

const EVENT_KEYS = ["marchEquinox", "juneSolstice", "septemberEquinox", "decemberSolstice"];

function julianToDate(jd) {
  // JD epoch: noon UT on 1 January 4713 BC (proleptic Julian
  // calendar). Convert to Unix ms via the standard offset.
  return new Date((jd - 2440587.5) * 86400000);
}

/**
 * Date of the requested solstice/equinox for a given year.
 *
 * @param {number} year e.g. 2026
 * @param {"marchEquinox"|"juneSolstice"|"septemberEquinox"|"decemberSolstice"} event
 * @returns {Date}
 */
export function solarEventDate(year, event) {
  const [a, b, c, d, e] = MEEUS_TABLES[event];
  const Y = (year - 2000) / 1000;
  const Y2 = Y * Y, Y3 = Y2 * Y, Y4 = Y3 * Y;
  const jd = a + b * Y + c * Y2 + d * Y3 + e * Y4;
  return julianToDate(jd);
}

/**
 * Find the next upcoming solstice or equinox after `now`, plus the
 * number of whole days remaining. Returns `null` when the next
 * event is further than `windowDays` away — the consumer is
 * expected to render only when this returns non-null.
 *
 * Defaults to a 14-day window per the roadmap (`displayed only when
 * within ~14 days of it`). The marker stays invisible the rest of
 * the year so it doesn't compete with the always-on sunrise/sunset
 * row for attention.
 *
 * @param {Date} [now=new Date()]
 * @param {number} [windowDays=14]
 * @returns {{event: string, date: Date, daysAway: number}|null}
 */
export function upcomingSolarEvent(now = new Date(), windowDays = 14) {
  const year = now.getUTCFullYear();
  // Try this year's events + next year's January-February in case
  // we're sitting in December approaching the next March equinox.
  const candidates = [];
  for (const event of EVENT_KEYS) {
    candidates.push({ event, date: solarEventDate(year, event) });
    candidates.push({ event, date: solarEventDate(year + 1, event) });
  }
  // Filter to future events, sort by date, pick the closest.
  const future = candidates
    .filter((c) => c.date.getTime() > now.getTime())
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  if (future.length === 0) return null;
  const next = future[0];
  const msAway = next.date.getTime() - now.getTime();
  const daysAway = Math.ceil(msAway / 86400000);
  if (daysAway > windowDays) return null;
  return { event: next.event, date: next.date, daysAway };
}
