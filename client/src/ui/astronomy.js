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
 * Hemisphere note: the moon glyph is drawn for Northern-Hemisphere
 * viewing (waxing on the right, waning on the left). In the Southern
 * Hemisphere the visual orientation flips. The kiosk's primary
 * audience is Quebec / North America, so we accept the NH convention.
 */

// Reference new moon: 2000-01-06 18:14 UTC. Synodic month: 29.530589
// days. Both values from NASA / JPL ephemerides.
const NEW_MOON_REF_MS = Date.UTC(2000, 0, 6, 18, 14);
const SYNODIC_MONTH_MS = 29.530589 * 86400000;

// i18n key suffixes for the 8 phases — consumers translate via
// `t("astronomy.moonPhase." + key)`. The visual rendering of the
// phase moved off Unicode emoji (🌒🌔🌖 etc.) and onto a custom
// SVG (`MoonGlyph` component, parameterised by `moonLitPath()`
// below) in June 2026. The emoji approach drew the phases
// differently between Apple Color Emoji (macOS, NH convention)
// and Linux Noto Color Emoji (Pi kiosk) — the Pi rendering looked
// "inverted" in night / nightRed modes where the high lit-vs-dark
// contrast made the orientation difference obvious. The SVG locks
// NH orientation in every browser + OS combo and follows the
// palette tokens (--c-moon-lit / --c-moon-dark) so the same code
// works in clair / dusk / nuit / nightRed.
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
 * @param {Date} [date]
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
 * @param {Date} [date]
 * @returns {number} illumination 0..1
 */
export function moonIllumination(date = new Date()) {
  return (1 - Math.cos(2 * Math.PI * moonPhaseFraction(date))) / 2;
}

/**
 * Resolve the current moon phase to (i18nKey, fraction, illumination).
 * Used by TimeBlock / HeroBand / MoonDetailsPopover to label the
 * phase + drive the `MoonGlyph` SVG renderer (which reads
 * `fraction`).
 *
 * The 8-phase bucketing picks the closest of `MOON_PHASE_KEYS`
 * (newMoon → waxingCrescent → firstQuarter → waxingGibbous →
 * fullMoon → waningGibbous → lastQuarter → waningCrescent → ...).
 *
 * @param {Date} [date]
 * @returns {{i18nKey: string, fraction: number, illumination: number}}
 */
export function moonPhase(date = new Date()) {
  const fraction = moonPhaseFraction(date);
  const idx = Math.round(fraction * 8) % 8;
  return {
    i18nKey: MOON_PHASE_KEYS[idx],
    fraction,
    illumination: moonIllumination(date),
  };
}

/**
 * Build an SVG `d` attribute describing the LIT (illuminated) area
 * of the moon's visible face at a given synodic phase.
 *
 * Geometry: the visible disc is a circle of radius `r` at
 * `(cx, cy)`. The terminator — the boundary between lit and dark
 * sides — projects onto the disc as half of an ellipse whose
 * horizontal radius `tx = r × |cos(2π × fraction)|`. At the
 * quarters the ellipse degenerates into a straight vertical line;
 * at new and full it coincides with the disc edge.
 *
 * The returned path is closed (`Z`) and bounded by:
 *   (a) half of the disc's outer circle (the lit-side semicircle)
 *   (b) half of the terminator ellipse (the inner edge)
 *
 * Whether the ellipse arc bulges INTO the lit area (crescent —
 * dark side bites into lit) or OUTWARD (gibbous — lit area
 * bulges past the centre) is determined by `sweep-flag` choice
 * based on the phase quadrant. Hemisphere convention is NH:
 * waxing phases lit on the right, waning on the left.
 *
 * @param {number} fraction - synodic phase 0..1
 * @param {number} cx - disc centre x in SVG coords
 * @param {number} cy - disc centre y in SVG coords
 * @param {number} r  - disc radius in SVG units
 * @returns {string} SVG `d` value, or `""` at new moon
 */
export function moonLitPath(fraction, cx, cy, r) {
  // Defensive: clamp the fraction in case a caller passes an
  // out-of-range value (e.g. NaN from a parser).
  let f = Number.isFinite(fraction) ? fraction : 0;
  f = ((f % 1) + 1) % 1; // wrap to [0, 1)
  const k = (1 - Math.cos(2 * Math.PI * f)) / 2;
  // New moon — nothing to draw (the disc colour shows through).
  if (k < 0.005) return "";
  // Full moon — entire disc lit. Built from two semicircular arcs
  // so the path is a single closed shape that React/SVG paints
  // identically to the background `<circle>` underneath.
  if (k > 0.995) {
    return `M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy} Z`;
  }
  const waxing = f < 0.5;
  const gibbous = k > 0.5;
  // Snap near-zero floating-point noise to exact zero. `cos(π/2)` is
  // ~6.12e-17 in JS, not actually 0 — at first/last quarter the
  // terminator should be a perfectly straight vertical line and we
  // want the resulting SVG `A` command to read `A 0 9 ...` rather
  // than `A 5.5e-16 9 ...` (ugly + occasionally caught by SVG
  // renderers as a non-degenerate ellipse).
  const txRaw = r * Math.abs(Math.cos(2 * Math.PI * f));
  const tx = txRaw < 1e-6 ? 0 : txRaw;
  // Outer arc: along the disc edge on the lit side. `sweep=1`
  // takes the right semicircle (CW from top to bottom in SVG's
  // Y-down coords), `sweep=0` takes the left.
  const outerSweep = waxing ? 1 : 0;
  // Inner arc: the terminator ellipse. For a crescent, the ellipse
  // bulges TOWARD the lit side (dark bites into lit), so its sweep
  // is OPPOSITE the outer. For a gibbous, the ellipse bulges AWAY
  // from the lit side (lit bulges past centre), matching the
  // outer sweep.
  const innerSweep = gibbous ? outerSweep : 1 - outerSweep;
  return `M ${cx} ${cy - r} A ${r} ${r} 0 0 ${outerSweep} ${cx} ${cy + r} A ${tx} ${r} 0 0 ${innerSweep} ${cx} ${cy - r} Z`;
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
 * @param {Date} [now]
 * @param {number} [windowDays]
 * @returns {{event: string, date: Date, daysAway: number}|null}
 */
export function upcomingSolarEvent(now = new Date(), windowDays = 14) {
  const next = sortedFutureEvents(now)[0];
  if (!next || next.daysAway > windowDays) return null;
  return next;
}

/**
 * All future solstices/equinoxes after `now`, soonest first, each
 * with its whole-days countdown. Spans this year + next so at least
 * the next four (one of each type) are always present.
 *
 * @param {Date} [now]
 * @returns {Array<{event: string, date: Date, daysAway: number}>}
 */
function sortedFutureEvents(now) {
  const year = now.getUTCFullYear();
  // This year's events + next year's, so December (approaching the
  // March equinox) and "give me the next four" both resolve.
  const candidates = [];
  for (const event of EVENT_KEYS) {
    candidates.push({ event, date: solarEventDate(year, event) });
    candidates.push({ event, date: solarEventDate(year + 1, event) });
  }
  return candidates
    .filter((c) => c.date.getTime() > now.getTime())
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map((c) => ({
      event: c.event,
      date: c.date,
      daysAway: Math.ceil((c.date.getTime() - now.getTime()) / 86400000),
    }));
}

/**
 * The next `count` solstices/equinoxes after `now`, soonest first.
 * Feeds the "Saisons" popover (v3.1 Phase 2) — the four upcoming
 * seasonal turning points with their dates and day-counts. Unlike
 * `upcomingSolarEvent` there is no window gate: the list is shown on
 * demand (the user taps the date, which is the year-round trigger).
 *
 * @param {Date} [now]
 * @param {number} [count]
 * @returns {Array<{event: string, date: Date, daysAway: number}>}
 */
export function nextSolarEvents(now = new Date(), count = 4) {
  return sortedFutureEvents(now).slice(0, count);
}

/**
 * Collapse a specific solar-event key (`juneSolstice`,
 * `marchEquinox`, …) to its generic type. The countdown copy drops
 * the month ("Solstice de juin" → "Solstice") because, inside the
 * 14-day window, only one event is ever upcoming — the month is
 * redundant (v3.1 Phase 2 C2). Shared by HeroBand and TimeBlock so
 * the `astronomy.solarEventShort.{solstice,equinox}` lookup is
 * derived in exactly one place.
 *
 * @param {string} eventKey one of the `EVENT_KEYS`
 * @returns {"solstice"|"equinox"} the generic event type
 */
export function solarEventType(eventKey) {
  return eventKey.includes("Solstice") ? "solstice" : "equinox";
}
