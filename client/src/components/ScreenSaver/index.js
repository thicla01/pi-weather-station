import React, { useContext, useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { fr, es, enUS } from "date-fns/locale";
import styles from "./styles.css";
import { AppContext } from "~/AppContext";

const DATE_FNS_LOCALES = { fr, es, en: enUS };

// Anti-burn-in: in stage 2 we render one tiny dot that shifts to a new
// position on a 5×5 grid every 5 minutes. Visiting all 25 cells in a
// pseudo-random order takes ~2 hours, after which we rotate the
// sequence so successive cycles don't repeat the same trail. The grid
// positions are expressed as 0..1 fractions of viewport width / height
// inset by 10 % from each edge so the dot never sits flush against the
// bezel (where it would fight with the touch frame on the 7" Pi).
const ANTI_BURNIN_GRID = (() => {
  const cells = [];
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      cells.push([0.1 + (c / 4) * 0.8, 0.1 + (r / 4) * 0.8]);
    }
  }
  return cells;
})();
const ANTI_BURNIN_INTERVAL_MS = 5 * 60 * 1000; // 5 min between repositions

/**
 * Fullscreen screensaver / sleep-mode overlay.
 *
 * Two stages, driven by the parent (App) via the `stage` prop:
 *   - 1: stylish minimal clock + date + weather, dimmed brightness
 *   - 2: black screen with a single moving dot to prevent LCD burn-in
 *
 * Visuals are intentionally restrained — this is the screensaver scaffold
 * built before the Claude Design HTML mock arrives. Once the mock is in
 * `docs/design-references/sleep-mode.html`, the markup and CSS here will
 * be replaced with a faithful port. The stage transitions, idle detection
 * wiring and dim-brightness logic don't change either way, so the
 * scaffold lets the feature be tested end-to-end now.
 *
 * Colour variants:
 *   - day:         when the app is in light mode
 *   - night-cream: when in dark mode and sleepNightMode is OFF
 *   - night-red:   when in dark mode and sleepNightMode is ON
 *
 * @param {object} props
 * @param {number} props.stage 1 (clock visible) or 2 (black with dot)
 * @returns {JSX.Element|null} Overlay, or null when stage = 0
 */
const ScreenSaver = ({ stage }) => {
  const { i18n } = useTranslation();
  const {
    darkMode,
    sleepNightMode,
    currentWeatherData,
    tempUnit,
    clockTime,
    mapTimezone,
  } = useContext(AppContext);

  // Live wall clock — re-renders every 30 s. Dropping below 30 s would
  // be wasted re-renders since we only display HH:mm; aligning to the
  // top of the next minute would be marginally cleaner but the cost
  // (one setTimeout chain instead of one setInterval) isn't worth it.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30 * 1000);
    return () => clearInterval(id);
  }, []);

  // Anti-burn-in dot position — updates every 5 min in stage 2. The
  // sequence array is built once per mount via Fisher-Yates so each
  // session walks the 25 grid cells in a different order; the index
  // resets when stage 2 ends, so the next entry into stage 2 starts
  // fresh rather than where it left off (which would defeat the
  // anti-burn-in intent if the user wakes and re-enters quickly).
  const [dotIdx, setDotIdx] = useState(0);
  const dotSequence = useMemo(() => {
    const arr = ANTI_BURNIN_GRID.map((_, i) => i);
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }, []);
  useEffect(() => {
    if (stage !== 2) {
      setDotIdx(0);
      return undefined;
    }
    const id = setInterval(() => {
      setDotIdx((i) => (i + 1) % dotSequence.length);
    }, ANTI_BURNIN_INTERVAL_MS);
    return () => clearInterval(id);
  }, [stage, dotSequence.length]);

  if (stage === 0) return null;

  // Stage 2: black screen with a single moving dot. The dot colour mirrors
  // the night-mode preference (red in night-red mode, dim grey otherwise)
  // so the same melatonin-friendly principle applies even with content
  // hidden.
  if (stage === 2) {
    const cell = dotSequence[dotIdx % dotSequence.length];
    const [xFrac, yFrac] = ANTI_BURNIN_GRID[cell];
    const isNightRed = darkMode && sleepNightMode;
    return (
      <div className={styles.stage2} role="presentation" aria-hidden="true">
        <span
          className={`${styles.dot} ${isNightRed ? styles.dotRed : styles.dotGrey}`}
          style={{ left: `${xFrac * 100}vw`, top: `${yFrac * 100}vh` }}
        />
      </div>
    );
  }

  // Stage 1: clock + date + weather. Variant class on the root div drives
  // the colour scheme (day / night-cream / night-red) entirely via CSS.
  let variant;
  if (!darkMode) variant = styles.dayVariant;
  else if (sleepNightMode) variant = styles.nightRedVariant;
  else variant = styles.nightCreamVariant;

  const lang = (i18n && i18n.language ? i18n.language.slice(0, 2) : "en");
  const locale = DATE_FNS_LOCALES[lang] || enUS;
  // dateFormat key in each locale json gives the locale-specific pattern
  // (e.g. "cccc d LLLL" for fr → "vendredi 1 mai"). Reusing the same key
  // the rest of the app uses keeps the screensaver typographically
  // consistent with the InfoPanel header.
  let dateStr;
  try {
    const pattern = i18n.t("dateFormat") || "EEEE, MMMM d";
    dateStr = format(now, pattern, { locale });
  } catch {
    dateStr = now.toLocaleDateString();
  }
  // 24-hour vs 12-hour follows the Settings preference, with a small twist:
  // since the clock here is the centrepiece, leading zeros on the hour
  // (08:14 vs 8:14) feel more deliberate, so we always pad the hour.
  const timeStr = now.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: clockTime === "12",
    timeZone: mapTimezone || undefined,
  });

  // Footer line: temperature. Pulled from the same source the rest of
  // the app uses — no extra fetch. Falls back to nothing if data hasn't
  // loaded yet (cold boot, network blip). Condition wording is added
  // once the design mock is in place; for now the bare temperature line
  // keeps the scaffolding clean.
  const values = currentWeatherData?.data?.timelines?.[0]?.intervals?.[0]?.values;
  const tempC = values?.temperature;
  let footerLine = "";
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
    footerLine = `${Math.round(tempVal)}${tempUnitStr}`;
  }

  return (
    <div className={`${styles.stage1} ${variant}`} role="presentation" aria-hidden="true">
      <div className={styles.date}>{dateStr}</div>
      <div className={styles.time}>{timeStr}</div>
      {footerLine ? <div className={styles.footer}>{footerLine}</div> : null}
    </div>
  );
};

ScreenSaver.propTypes = {
  stage: PropTypes.number.isRequired,
};

export default ScreenSaver;
