import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { fr, es, enUS } from "date-fns/locale";
import styles from "./styles.css";
import { AppContext } from "~/AppContext";
import { useTimeOfDay } from "~/ui/hybrid";

const DATE_FNS_LOCALES = { fr, es, en: enUS };

// Anti-burn-in: in stage 2 a single 4 px dot rides a 5×5 grid, repositioned
// every 5 minutes. The mock distributes cells across an inset region (8 %
// margin from each edge) so the dot never sits flush against the bezel
// where it would fight with the touch frame on the 7" Pi. We pick a fresh
// cell each tick, refusing to repeat the previous one (`lastIdx !== prev`).
const GRID = 5;
const INSET = 0.08;
const ANTI_BURNIN_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Map a Tomorrow.io weather code to a calm Unicode glyph for the screensaver
 * footer. The mock uses ☁ as the reference; this keeps the same monochrome,
 * single-character feel across conditions rather than reaching for emoji
 * (which render inconsistently across systems and clash with the typography).
 *
 * @param {Number} code Tomorrow.io weather code
 * @returns {String} Single-character Unicode glyph
 */
function weatherGlyph(code) {
  if (code === 1000 || code === 1100) return "☀"; // ☀ clear / mostly clear
  if (code === 1101) return "⛅"; // ⛅ partly cloudy
  if (code === 1001 || code === 1102 || code === 2000 || code === 2100) return "☁"; // ☁ cloudy / fog
  if ([4000, 4001, 4200, 4201, 6000, 6001, 6200, 6201].includes(code)) return "☂"; // ☂ rain / freezing rain
  if ([5000, 5001, 5100, 5101, 7000, 7101, 7102].includes(code)) return "❄"; // ❄ snow / ice pellets
  if (code === 8000) return "⚡"; // ⚡ thunderstorm
  return "☁"; // default cloudy
}

/**
 * Map a Tomorrow.io weather code to the matching i18n key for the condition
 * label. Mirrors the mapping in CurrentWeather/index.js but stays local here
 * to avoid pulling in the full icon-loading machinery.
 *
 * @param {Number} code Tomorrow.io weather code
 * @returns {String} i18n key under "weather.*"
 */
function conditionKey(code) {
  switch (code) {
    case 6201: return "weather.heavyFreezingRain";
    case 6001: return "weather.freezingRain";
    case 6200: return "weather.lightFreezingRain";
    case 6000: return "weather.freezingDrizzle";
    case 7101: return "weather.heavyIcePellets";
    case 7000: return "weather.icePellets";
    case 7102: return "weather.lightIcePellets";
    case 5101: return "weather.heavySnow";
    case 5000: return "weather.snow";
    case 5100: return "weather.lightSnow";
    case 5001: return "weather.flurries";
    case 8000: return "weather.thunderStorm";
    case 4201: return "weather.heavyRain";
    case 4001: return "weather.rain";
    case 4200: return "weather.lightRain";
    case 4000: return "weather.drizzle";
    case 2100: return "weather.lightFog";
    case 2000: return "weather.fog";
    case 1001: return "weather.cloudy";
    case 1102: return "weather.mostlyCloudy";
    case 1101: return "weather.partlyCloudy";
    case 1100: return "weather.mostlyClear";
    case 1000: return "weather.clear";
    case 3001: return "weather.wind";
    case 3000: return "weather.lightWind";
    case 3002: return "weather.strongWind";
    default: return "";
  }
}

/**
 * Fullscreen screensaver / sleep-mode overlay.
 *
 * Single DOM tree shared by stages 1 and 2 — class names on the root drive
 * the visual differences (`stage2` hides text via opacity, dot via opacity:1)
 * so the transition between stages is smooth (300 ms ease cross-fade) and
 * matches the design mock at `docs/design-references/sleep-mode.html`.
 *
 * Three colour variants:
 *   - day:         when the app is in light mode
 *   - night-cream: dark mode + sleepNightMode off (cream on anthracite)
 *   - night-red:   dark mode + sleepNightMode on  (red on near-black)
 *
 * @param {object} props
 * @param {number} props.stage 1 (clock visible) or 2 (black with dot)
 * @returns {JSX.Element|null} Overlay, or null when stage = 0
 */
const ScreenSaver = ({ stage }) => {
  const { i18n } = useTranslation();
  const {
    currentWeatherData,
    tempUnit,
    clockTime,
    mapTimezone,
  } = useContext(AppContext);
  // Read the active palette through the same hook that drives Direction
  // C surfaces. This unifies the sleep-palette decision under Phase 5
  // of the v3.0.0 rollout. Today the hook is a `darkMode` +
  // `sleepNightMode` shim, so v2 users see the same screensaver
  // variant they always did; once Phase 5+ wires real solar position,
  // the dusk / night distinction will start to differentiate visually
  // without any further change in this component.
  const tod = useTimeOfDay();

  // Live wall clock — re-renders every 30 s. Aligned to the next minute on
  // first mount so the displayed time flips at the same instant as the
  // wall clock the user might have nearby.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let interval;
    const msToNextMinute = 60_000 - (Date.now() % 60_000);
    const timeout = setTimeout(() => {
      setNow(new Date());
      interval = setInterval(() => setNow(new Date()), 60_000);
    }, msToNextMinute);
    return () => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
    };
  }, []);

  // Anti-burn-in dot position — recomputed every 5 min. Position is a
  // {left, top} pair in CSS pixels relative to the viewport, refusing to
  // repeat the previous cell. We re-shuffle on viewport resize so the
  // 8 % inset always lands inside the new bounds.
  const [dotPos, setDotPos] = useState({ left: 0, top: 0 });
  const lastCellRef = useMemo(() => ({ current: -1 }), []);
  useEffect(() => {
    function placeDot() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      let cell;
      do {
        cell = Math.floor(Math.random() * GRID * GRID);
      } while (cell === lastCellRef.current && GRID * GRID > 1);
      lastCellRef.current = cell;
      const col = cell % GRID;
      const row = Math.floor(cell / GRID);
      const usableW = w * (1 - 2 * INSET);
      const usableH = h * (1 - 2 * INSET);
      const stepX = usableW / (GRID - 1);
      const stepY = usableH / (GRID - 1);
      // Centre the 4 px dot on the grid cell rather than top-left aligning
      // it (otherwise it'd appear shifted up-left by 2 px from the math).
      const x = Math.round(w * INSET + col * stepX) - 2;
      const y = Math.round(h * INSET + row * stepY) - 2;
      setDotPos({ left: x, top: y });
    }
    placeDot();
    const id = setInterval(placeDot, ANTI_BURNIN_INTERVAL_MS);
    window.addEventListener("resize", placeDot);
    return () => {
      clearInterval(id);
      window.removeEventListener("resize", placeDot);
    };
  }, [lastCellRef]);

  // Ghost-click absorption on wake. The chain we need to defeat:
  //   1. user touches the screen → pointerdown
  //   2. window-level idle hook listener fires markActive → setStage(0)
  //   3. React re-renders → <ScreenSaver/> would normally unmount
  //   4. pointerup → synthetic click event fires AFTER unmount
  //   5. click reaches whatever's now at the touch position (the
  //      WeatherMap), which interprets it as click-to-set-new-location
  //
  // Fix: when stage drops from > 0 to 0, keep the overlay mounted as
  // a fully-transparent click-absorber for 350 ms (one frame longer
  // than the fade transition itself, comfortably long enough for the
  // ghost click to land on us instead of the map). During that window
  // the root <div> still has pointer-events: auto (via .fading-out)
  // and an onClick handler that stops propagation, so nothing bubbles
  // through to Leaflet's MapClickHandler.
  const [fadingOut, setFadingOut] = useState(false);
  const prevStageRef = useRef(stage);
  useEffect(() => {
    let timeout;
    if (prevStageRef.current > 0 && stage === 0) {
      setFadingOut(true);
      timeout = setTimeout(() => setFadingOut(false), 350);
    }
    prevStageRef.current = stage;
    return () => {
      if (timeout) clearTimeout(timeout);
    };
  }, [stage]);

  if (stage === 0 && !fadingOut) return null;

  // Variant + stage classes composed onto the root. The mock keeps the
  // base variant active when stage 2 layers on top so the dot picks the
  // correct colour from the still-present variant class.
  //
  // Palette → class mapping:
  //   day      → .day      (cream on warm-grey, default)
  //   dusk     → .dusk     (warm-grey cream-on-anthracite, Direction C)
  //   night    → .dusk     (same as dusk for now; differentiates once
  //                         solar wiring lands in Phase 5+)
  //   nightRed → .nightRed (long-wavelength red, melatonin-friendly)
  let variantClass;
  if (tod === "day") variantClass = styles.day;
  else if (tod === "nightRed") variantClass = styles.nightRed;
  else variantClass = styles.dusk; // "dusk" or "night"
  const stage2Class = stage === 2 ? styles.stage2 : "";

  // Date formatted via date-fns with the locale-specific pattern from i18n
  // (`dateFormat` key — "cccc d LLLL" for fr → "vendredi 1 mai"). Reusing
  // the same key the rest of the app uses keeps the screensaver
  // typographically consistent with the InfoPanel header.
  const lang = (i18n && i18n.language ? i18n.language.slice(0, 2) : "en");
  const locale = DATE_FNS_LOCALES[lang] || enUS;
  let dateStr;
  try {
    const pattern = i18n.t("dateFormat") || "EEEE, MMMM d";
    dateStr = format(now, pattern, { locale });
  } catch {
    dateStr = now.toLocaleDateString();
  }

  // Time format follows the user's Settings preference. Using
  // toLocaleTimeString keeps the AM/PM marker locale-aware in 12 h mode.
  const timeStr = now.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: clockTime === "12",
    timeZone: mapTimezone || undefined,
  });

  // Footer: weather glyph + temperature + condition. Falls back gracefully
  // when no weather payload is loaded yet (cold boot, network blip).
  const values = currentWeatherData?.data?.timelines?.[0]?.intervals?.[0]?.values;
  const tempC = values?.temperature;
  const code = values?.weatherCode;
  let tempPart = "";
  if (typeof tempC === "number") {
    let tempVal = tempC;
    let tempUnitStr = "°C";
    if (tempUnit === "f") {
      tempVal = (tempC * 9) / 5 + 32;
      tempUnitStr = "°F";
    } else if (tempUnit === "k") {
      tempVal = tempC + 273.15;
      tempUnitStr = "K";
    }
    // \u00a0 = non-breaking space, matching the mock's "7\u00a0°C"
    tempPart = `${Math.round(tempVal)}\u00a0${tempUnitStr}`;
  }
  const condKey = code !== undefined ? conditionKey(code) : "";
  const condStr = condKey ? i18n.t(condKey) : "";
  const glyph = code !== undefined ? weatherGlyph(code) : "☁";

  // The fadingOut class is applied when we're holding the overlay
  // mounted in transparent absorber mode. Stops the post-wake ghost
  // click from reaching Leaflet's map handler.
  const fadingClass = fadingOut ? styles.fadingOut : "";
  // Belt-and-braces: also stop propagation on the root onClick. If for
  // any reason the click happens to fire on us (rather than be absorbed
  // by the fade overlay), it's still cancelled here.
  const swallowClick = (e) => {
    e.stopPropagation();
  };

  return (
    <div
      className={`${styles.screenSaver} ${variantClass} ${stage2Class} ${fadingClass}`}
      role="presentation"
      aria-hidden="true"
      onClick={swallowClick}
    >
      <main className={styles.stage}>
        <div className={styles.date}>{dateStr}</div>
        <div className={styles.time}>{timeStr}</div>
        {(tempPart || condStr) ? (
          <div className={styles.footer}>
            <span className={styles.icon}>{glyph}</span>
            {tempPart}
            {tempPart && condStr ? <span className={styles.dotSep}>·</span> : null}
            {condStr}
          </div>
        ) : null}
      </main>
      <div
        className={styles.pixel}
        style={{ left: `${dotPos.left}px`, top: `${dotPos.top}px` }}
      />
    </div>
  );
};

ScreenSaver.propTypes = {
  stage: PropTypes.number.isRequired,
};

export default ScreenSaver;
