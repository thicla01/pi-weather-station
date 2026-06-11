import React, {
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";

import { AppActionsContext, UiPrefsContext } from "~/AppContext";
import styles from "./styles.css";

const RADAR_SPEED_LABELS = { 1: "1×", 2: "2×", 4: "4×" };
const NOW_TICK_INTERVAL_MS = 30_000;

/**
 * Radar animation timeline overlay — bottom-centre of the map. Surfaces
 * the playhead (current frame), a scrubber slider, and a speed cycler
 * (1× / 2× / 4×). The slider track is split into past and nowcast halves
 * via a CSS gradient so the user can see at a glance where the present
 * moment sits inside the available frames. Absolute-positioned over the
 * map; auto-hides when no frames are loaded so it doesn't show up as an
 * empty bar on initial mount or during a network blip.
 *
 * @param {object} props
 * @param {Array} props.frames Combined past+nowcast frame list from RainViewer
 * @param {number} props.currentIdx Resolved index into `frames`
 * @param {Function} props.onScrub Called with the new index when user scrubs
 * @param {String} props.timezone IANA timezone for the time-of-day label
 * @param {Boolean} props.dark
 * @returns {JSX.Element|null} Timeline overlay
 */
const RadarTimeline = ({ frames, currentIdx, onScrub, timezone, dark }) => {
  const { t } = useTranslation();
  const { cycleRadarSpeed, toggleAnimateWeatherMap } = useContext(AppActionsContext);
  const { radarSpeed, animateWeatherMap, clockTime } = useContext(UiPrefsContext);

  // Manual pointer-event handling on the scrubber input. Native
  // <input type="range"> on touch devices is heuristic-driven — Chrome
  // tries to decide whether a touchstart on the thumb is the start of
  // a drag or a tap-on-track, and the heuristic is fragile enough on
  // the Pi kiosk's touchscreen that quick taps often miss. Field
  // observation: holding the finger longer on the thumb makes the
  // success rate jump from ~20 % to ~80 %, which is the smoking gun
  // — Chrome wants more dwell time before committing to drag mode.
  // Override by capturing pointerdown ourselves and updating the
  // value directly from the touch x-coordinate. setPointerCapture
  // ensures subsequent moves stick to this element even when the
  // finger drifts off the input. e.preventDefault() suppresses the
  // native input's own touch handling so the two don't fight.
  // onChange is preserved for keyboard accessibility (arrow keys
  // still tab-navigate and step through frames natively). Mouse
  // works through the same pointer-event path since Chrome unifies
  // mouse and touch into pointer events.
  const scrubberRef = useRef(null);

  // Wall-clock seconds used to compute the frame's "now / +5 min / -15 min"
  // label. Lifted out of render into a state + 30 s interval so calling
  // Date.now() doesn't become a side effect every parent re-render — the
  // label only flips when a real minute passes. 30 s is half the label's
  // minute precision, enough to never miss a boundary without overshooting.
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), NOW_TICK_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const updateFromClientX = useCallback((clientX) => {
    const el = scrubberRef.current;
    if (!el || !frames || frames.length < 2) return;
    const rect = el.getBoundingClientRect();
    const cs = window.getComputedStyle(el);
    const padLeft = parseFloat(cs.paddingLeft) || 0;
    const padRight = parseFloat(cs.paddingRight) || 0;
    const trackable = Math.max(1, rect.width - padLeft - padRight);
    const xRel = clientX - rect.left - padLeft;
    const frac = Math.max(0, Math.min(1, xRel / trackable));
    onScrub(Math.round(frac * (frames.length - 1)));
  }, [frames, onScrub]);
  const handleScrubberPointerDown = useCallback((e) => {
    if (e.button > 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    updateFromClientX(e.clientX);
  }, [updateFromClientX]);
  const handleScrubberPointerMove = useCallback((e) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    updateFromClientX(e.clientX);
  }, [updateFromClientX]);
  const handleScrubberPointerUp = useCallback((e) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  if (!frames || frames.length === 0) return null;
  const frame = frames[currentIdx];
  if (!frame) return null;

  // Index of the most recent past frame — that's the playhead's "home"
  // position (where it sits on initial mount). Used to expose a quick
  // "return to now" affordance when the user has scrubbed elsewhere.
  const lastPastIdx = frames.reduce(
    (acc, f, i) => (f.kind === "past" ? i : acc),
    -1
  );
  const atNow = currentIdx === lastPastIdx;

  // Build the time labels. "Now" is wall-clock at the kiosk; the frame
  // offset compares against it in minutes (negative for past frames,
  // positive for nowcast). Round to the nearest minute so a 9-minute
  // -aged frame doesn't read as -8.97 min. nowSec ticks once per 30 s
  // via the effect at the top of this component.
  const offsetMin = Math.round((frame.time - nowSec) / 60);
  // Honour the user's 12h/24h preference from Settings — toLocaleTimeString
  // would otherwise pick the locale's default, which produced "22:30" on a
  // French-Canadian browser regardless of the kiosk's clock setting.
  const timeStr = new Date(frame.time * 1000).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: clockTime === "12",
    timeZone: timezone || undefined,
  });
  let offsetStr;
  if (Math.abs(offsetMin) < 1)      offsetStr = t("radar.timeline.now");
  else if (offsetMin > 0)           offsetStr = t("radar.timeline.plusMin", { min: offsetMin });
  else                              offsetStr = t("radar.timeline.minusMin", { min: -offsetMin });

  // Past portion of the slider track, expressed as a unitless fraction
  // (0 to 1), so the gradient colour split can be aligned in CSS with
  // the thumb's travel range using a calc() that accounts for the
  // input's horizontal padding (the padding insets the thumb at the
  // extremes so it stays fully within the input's hit area — see
  // styles.css for the full explanation).
  const pastFrac = lastPastIdx >= 0 && frames.length > 1
    ? lastPastIdx / (frames.length - 1)
    : 1;

  const isNowcast = frame.kind === "nowcast";

  return (
    <div className={`${styles.radarTimeline} ${dark ? styles.radarTimelineDark : styles.radarTimelineLight}`}>
      <div className={styles.radarTimelineLabels}>
        <span className={styles.radarTimelineTime}>{timeStr}</span>
        <span className={`${styles.radarTimelineOffset} ${isNowcast ? styles.radarTimelineForecast : ""}`}>
          {isNowcast ? t("radar.timeline.forecast") + " · " : ""}{offsetStr}
        </span>
        {!atNow && lastPastIdx >= 0 && (
          <button
            type="button"
            onClick={() => onScrub(lastPastIdx)}
            className={styles.radarTimelineNow}
            aria-label={t("radar.timeline.returnToNowAria")}
            title={t("radar.timeline.returnToNowAria")}
          >
            ⟲ {t("radar.timeline.now")}
          </button>
        )}
        <button
          type="button"
          onClick={cycleRadarSpeed}
          className={styles.radarTimelineSpeed}
          aria-label={t("radar.timeline.speedAria")}
        >
          {RADAR_SPEED_LABELS[radarSpeed] || `${radarSpeed}×`}
        </button>
      </div>
      <div className={styles.radarTimelineControls}>
        <button
          type="button"
          onClick={() => onScrub(Math.max(0, currentIdx - 1))}
          disabled={currentIdx <= 0}
          className={styles.radarTimelineStep}
          aria-label={t("radar.timeline.stepBackAria")}
          title={t("radar.timeline.stepBackAria")}
        >
          ◀
        </button>
        <button
          type="button"
          onClick={toggleAnimateWeatherMap}
          className={`${styles.radarTimelinePlay} ${animateWeatherMap ? styles.radarTimelinePlayActive : ""}`}
          aria-label={t(animateWeatherMap ? "radar.timeline.pauseAria" : "radar.timeline.playAria")}
          title={t(animateWeatherMap ? "radar.timeline.pauseAria" : "radar.timeline.playAria")}
        >
          {animateWeatherMap ? "⏸" : "▶"}
        </button>
        <button
          type="button"
          onClick={() => onScrub(Math.min(frames.length - 1, currentIdx + 1))}
          disabled={currentIdx >= frames.length - 1}
          className={styles.radarTimelineStep}
          aria-label={t("radar.timeline.stepForwardAria")}
          title={t("radar.timeline.stepForwardAria")}
        >
          ▶
        </button>
        {/* Wrapper around the native range input so we can render the "now"
            tick marks (small vertical hairlines above and below the visible
            track at the past→nowcast boundary) via pseudo-elements. Pseudo-
            elements aren't supported on <input> directly, hence the wrapper.
            CSS variables (--past-frac, --show-now-marker) are set inline here
            so the input inherits them, and the wrapper's ::before/::after use
            them to position the ticks. --show-now-marker hides the ticks
            when there are no nowcast frames (past-frac = 1, nothing past
            "now" to mark). */}
        <div
          className={`${styles.radarTimelineScrubberWrap} ${pastFrac < 1 ? styles.radarTimelineScrubberWrapWithNow : ""}`}
          style={{ "--past-frac": pastFrac }}
        >
          <input
            ref={scrubberRef}
            type="range"
            min="0"
            max={frames.length - 1}
            step="1"
            value={currentIdx}
            onChange={(e) => onScrub(parseInt(e.target.value, 10))}
            onPointerDown={handleScrubberPointerDown}
            onPointerMove={handleScrubberPointerMove}
            onPointerUp={handleScrubberPointerUp}
            onPointerCancel={handleScrubberPointerUp}
            className={styles.radarTimelineScrubber}
            aria-label={t("radar.timeline.scrubberAria")}
          />
        </div>
      </div>
    </div>
  );
};

RadarTimeline.propTypes = {
  frames: PropTypes.array,
  currentIdx: PropTypes.number,
  onScrub: PropTypes.func.isRequired,
  timezone: PropTypes.string,
  dark: PropTypes.bool,
};

export default RadarTimeline;
