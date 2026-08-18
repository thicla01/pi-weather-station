/**
 * System-preferences detection — used to seed sensible defaults at
 * first launch when localStorage is empty. After the first launch,
 * any explicit user choice (made through the Settings panel or via
 * the Metric/Imperial preset button) is persisted to localStorage
 * and wins over the system default forever.
 *
 * We deliberately do NOT re-seed from system on every load — once
 * the seeding-marker key is set, this module's defaults are ignored
 * and the existing localStorage values (or, for missing keys, the
 * hardcoded `useState` defaults) are used. This protects existing
 * installs (e.g. the 7-Pi production fleet) from a surprise unit
 * flip on the next reboot after this code ships.
 */

/**
 * Inspect the browser's locale and return weather-station defaults.
 * Falls back to en-US-style imperial defaults if any of the
 * `Intl` APIs throw (very old browsers / sandboxed contexts).
 *
 * - `tempUnit`     — "f" / "c"
 * - `speedUnit`    — "mph" / "kmh"  (m/s is rare enough that
 *                    nobody's phone says it; users who want it can
 *                    toggle in Settings)
 * - `lengthUnit`   — "in" / "mm"
 * - `distanceUnit` — "mi" / "km"
 * - `pressureUnit` — "hpa" / "inhg"  (kPa — the Environment Canada
 *                    reading convention — is offered in Settings but
 *                    never seeded: hPa is the international default
 *                    everywhere barometers aren't read in inHg)
 * - `clockTime`    — "12" / "24"
 *
 * @returns {{tempUnit: string, speedUnit: string, lengthUnit: string, distanceUnit: string, pressureUnit: string, clockTime: string}}
 *   The six first-launch defaults, all as the short codes the rest of the app
 *   stores in localStorage. US → `f`/`mph`/`in`/`mi`/`inhg`, UK → `c`/`mph`/`mm`/`mi`/`hpa`,
 *   metric → `c`/`kmh`/`mm`/`km`/`hpa`; `clockTime` is `"12"` or `"24"` from the
 *   locale's resolved `hour12`. Never `null` — if `navigator.language` or `Intl`
 *   throws, the US row with `clockTime: "12"` is returned.
 */
export function detectSystemDefaults() {
  // Tri-state system: "us" / "uk" / "metric". The UK is a genuine
  // mixed system (°C and mm for weather, but mph and miles on the
  // road) and `Intl.Locale.measurementSystem` distinguishes it
  // specifically — we honour that distinction rather than collapsing
  // UK into metric.
  let system = "us";
  let hour12 = true;

  try {
    const lang = (typeof navigator !== "undefined" && navigator.language) || "en-US";
    const locale = new Intl.Locale(lang);

    // Chrome 100+, Safari 16+, Firefox 118+ expose
    // `locale.measurementSystem` → "metric" | "ussystem" | "uksystem".
    const ms = locale.measurementSystem;
    if (ms === "ussystem") {
      system = "us";
    } else if (ms === "uksystem") {
      system = "uk";
    } else if (ms === "metric") {
      system = "metric";
    } else {
      // Fallback for older browsers without measurementSystem:
      // only the US, Liberia, and Myanmar use US-customary units
      // as their primary system; the UK is its own mixed bucket;
      // everyone else is metric.
      const region = (locale.region || lang.split("-")[1] || "").toUpperCase();
      if (["US", "LR", "MM"].includes(region)) system = "us";
      else if (region === "GB") system = "uk";
      else system = "metric";
    }

    // 12h / 24h derives from locale's resolved options. en-US → 12,
    // fr-CA → 24, en-GB → 12 (UK uses 12 h colloquially), de-DE → 24.
    try {
      const opts = new Intl.DateTimeFormat(lang, { hour: "numeric" }).resolvedOptions();
      hour12 = opts.hour12 !== false;
    } catch {
      // keep the previously-derived default
    }
  } catch {
    // navigator.language unavailable or Intl.Locale unsupported —
    // fall through with the en-US-style defaults.
  }

  // Per-system mapping. The UK row is the only mixed case: weather
  // metrics in metric (°C, mm) but vehicular speed and distance in
  // imperial (mph, miles).
  const presets = {
    us:     { tempUnit: "f", speedUnit: "mph", lengthUnit: "in", distanceUnit: "mi", pressureUnit: "inhg" },
    uk:     { tempUnit: "c", speedUnit: "mph", lengthUnit: "mm", distanceUnit: "mi", pressureUnit: "hpa" },
    metric: { tempUnit: "c", speedUnit: "kmh", lengthUnit: "mm", distanceUnit: "km", pressureUnit: "hpa" },
  };
  return {
    ...presets[system],
    clockTime: hour12 ? "12" : "24",
  };
}

/**
 * Check whether the user's OS / browser is signalling a preference
 * for reduced motion (Apple's "Reduce Motion" accessibility toggle,
 * Windows's "Show animations" off, Android's "Remove animations").
 * Used to silently disable non-essential transitions and animations
 * without exposing a UI toggle — the user has already expressed
 * their preference at the OS level.
 *
 * Returns false in non-browser contexts (SSR, tests).
 *
 * @returns {boolean} `true` when the `(prefers-reduced-motion: reduce)` media
 *   query matches. `false` when it doesn't, when `window`/`matchMedia` is absent
 *   (SSR, tests), or when `matchMedia` throws — i.e. animations stay on unless
 *   the OS explicitly asks for them off.
 */
export function prefersReducedMotion() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}
