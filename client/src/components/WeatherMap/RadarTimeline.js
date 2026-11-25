import React, {
  useContext,
  useRef,
  useCallback,
  useSyncExternalStore,
} from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";

import { AppActionsContext, UiPrefsContext } from "~/AppContext";
import {
  PlayIcon,
  PauseIcon,
  StepBackIcon,
  StepForwardIcon,
  ReturnNowIcon,
} from "./icons";
import styles from "./styles.css";

const RADAR_SPEED_LABELS = { 1: "1×", 2: "2×", 4: "4×" };
const NOW_TICK_INTERVAL_MS = 30_000;
const NOW_TICK_SEC = NOW_TICK_INTERVAL_MS / 1000;

// Wall-clock seconds used to compute the frame's offset labels, read as an
// external store (the clock). The snapshot is floored to the 30 s tick, so
// it only changes on a tick boundary, at most 30 s stale: half the labels'
// minute precision, as with the old 30 s state interval. A per-second
// snapshot would change between a render and React's post-commit snapshot
// check in about one render in thirty (the check runs whenever `subscribe`
// changes, e.g. the overlay shell's `shellLive` flip, or the snapshot did),
// forcing an extra synchronous render in the tap's own task. The change
// signal fires just after each boundary (a timer re-armed to the next one; a
// timer that fires a hair early finds no change and re-arms for the rest).
// Module-level, so the render itself stays pure (no Date.now() in the
// component body).
const readNowSec = () => Math.floor(Date.now() / NOW_TICK_INTERVAL_MS) * NOW_TICK_SEC;
const subscribeNowTick = (onTick) => {
  let id = 0;
  const armForNextBoundary = () => {
    id = setTimeout(() => {
      onTick();
      armForNextBoundary();
    }, NOW_TICK_INTERVAL_MS - (Date.now() % NOW_TICK_INTERVAL_MS));
  };
  armForNextBoundary();
  return () => clearTimeout(id);
};
// The overlay shell keeps the scrubber mounted, hidden and inert
// outside MIN (`shellLive` false): no tick then. The render that makes it
// live (the switch's own commit) reads the clock afresh, so it never
// shows a stale offset, and needs no render of its own.
const NO_UNSUBSCRIBE = () => undefined;
const subscribeNowDormant = () => NO_UNSUBSCRIBE;
// Offsets at or beyond one hour read as hours, floored — the everyday
// "il y a X h" convention (64 min → "1 h", 119 min → "1 h", 120 → "2 h").
// Math.round with a higher threshold made "1 h" unreachable and labelled
// a 90-minute frame "2 h" (review finding).
const HOUR_LABEL_THRESHOLD_MIN = 60;

/**
 * Format a signed frame offset (minutes) as a compact tick label.
 * Locale-neutral by design — "min" and "h" read identically in the
 * app's three locales, matching the chart-axis convention.
 *
 * @param {number} offsetMin Signed offset in minutes (negative = past)
 * @returns {string} e.g. "−2 h", "−45 min", "+30 min"
 */
function formatTickLabel(offsetMin) {
  const sign = offsetMin > 0 ? "+" : "−";
  const abs = Math.abs(offsetMin);
  if (abs >= HOUR_LABEL_THRESHOLD_MIN) {
    return `${sign}${Math.floor(abs / 60)} h`;
  }
  return `${sign}${abs} min`;
}

/**
 * Radar animation timeline — full-width bottom bar over the map
 * (v3.1 Phase 3, Claude Design v2.1). Header row: transport cluster
 * (play/pause, step ±1, speed cycler), the frame timestamp with a
 * "now-tag" chip that never shows a bare relative offset (audit F8),
 * a frame-count sub-line, the conditional return-to-now pill, and a
 * source/freshness chip. Track row: past fill, hatched future
 * (nowcast) zone — scrubbable, the hatching marks extrapolated data —
 * an explicit "Maintenant" marker at the past→nowcast boundary, and
 * runtime-derived tick labels.
 *
 * The scrub surface is still a native <input type="range"> (invisible,
 * full-width) so the field-hardened pointer-capture handling and
 * native keyboard accessibility carry over from the previous design;
 * the visual track/thumb are CSS layers driven by --thumb-frac /
 * --past-frac set inline below. Auto-hides when no frames are loaded.
 *
 * @param {object} props
 * @param {Array} props.frames Combined past+nowcast frame list from RainViewer
 * @param {number} props.currentIdx Resolved index into `frames`
 * @param {(idx: number) => void} props.onScrub Called with a 0-based integer
 *   index into `frames` (already clamped to 0..frames.length-1) whenever the
 *   user scrubs the track, steps ±1 frame, or taps the return-to-now pill
 * @param {string} props.timezone IANA timezone for the time-of-day label
 * @param {boolean} props.dark Dark-palette variant
 * @param {boolean} props.compact Short-screen variant (7" kiosk) — shortens the source chip
 * @param {boolean} props.sourceStale Last frame-list refresh failed — chip flips to the warn tone
 * @param {boolean} [props.shellLive] Overlay shell only: LayoutPi's
 *   overlay shell keeps the scrubber mounted outside MIN: false there,
 *   which makes it inert (hidden by the overlay shell's rules in
 *   styles.css, never by opacity alone: it carries a backdrop blur) and
 *   stops its clock; true in MIN with the scrubber open. Either way it
 *   carries `data-pi-overlay-el`. Undefined everywhere else (mounted only
 *   when shown).
 * @param {boolean} [props.shellEngaged] Overlay shell only: whether the
 *   scrubber's work runs (WeatherMap's `timelineEngaged`, which the shell
 *   turns on once the switch to MIN has settled); mirrored on the bar as
 *   `data-pi-engaged`, a signal only (nothing in the app reads it).
 *   Undefined everywhere else.
 * @param {function(): void} [props.onShellEngage] Overlay shell only: engages
 *   the scrubber's work at once (useShellTiming `engageTimeline`, one
 *   synchronous commit). Called, while `shellEngaged` is false, from the
 *   capture phase of the bar's first pointer or key press, before any
 *   control sees it: the playhead snaps to "now" in that commit, then
 *   the same press acts normally on the engaged bar (play, step, return
 *   to now, a tap on the track, a drag that continues), so a visible
 *   control never ignores an input. The press engages the work at once
 *   rather than waiting, queued, until the work is ready (useShellTiming).
 *   Undefined everywhere else.
 * @param {function(?Element): (function(): void|undefined)} [props.overlayRef]
 *   Overlay shell only: the shell's overlay registry's ref callback
 *   (ui/shellElements.js), attached to the bar, so LayoutPi's shell timing
 *   finds it (its motion, and whether a live scrubber opens the dock band
 *   shield's cut-out) without walking the DOM. Undefined everywhere else.
 * @returns {JSX.Element|null} Timeline overlay
 */
const RadarTimeline = ({
  frames,
  currentIdx,
  onScrub,
  timezone,
  dark,
  compact,
  sourceStale,
  shellLive,
  shellEngaged,
  onShellEngage,
  overlayRef,
}) => {
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

  // Wall-clock seconds used to compute the frame's offset label: an
  // external store, so Date.now() never runs in the render body, and the
  // label flips on a 30 s tick (half its minute precision) — none while
  // the overlay shell holds the scrubber hidden (`shellLive` false).
  const nowSec = useSyncExternalStore(shellLive === false ? subscribeNowDormant : subscribeNowTick, readNowSec);

  const updateFromClientX = useCallback((clientX) => {
    const el = scrubberRef.current;
    if (!el || !frames || frames.length < 2) return;
    const rect = el.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
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

  // Overlay shell: the first press on the bar before its work is engaged
  // engages it first (capture phase, so before the control's own handler);
  // none once engaged, and none off the overlay shell.
  const engageFirst = shellEngaged === false && onShellEngage ? () => onShellEngage() : undefined;

  if (!frames || frames.length === 0) return null;
  const frame = frames[currentIdx];
  if (!frame) return null;

  // Index of the most recent past frame — the playhead's "home"
  // position and the track's past→nowcast boundary.
  const lastPastIdx = frames.reduce(
    (acc, f, i) => (f.kind === "past" ? i : acc),
    -1
  );
  const atNow = currentIdx === lastPastIdx;
  const pastCount = lastPastIdx + 1;
  const futureCount = frames.length - pastCount;

  // Track fractions for the CSS layers. With a single frame the track
  // degenerates — pin to 1 so the bar still renders sane. A list with
  // no past frame at all (lastPastIdx -1, e.g. an all-nowcast refresh)
  // puts "now" at the LEFT edge — the whole track is future.
  const denom = frames.length - 1;
  const thumbFrac = denom > 0 ? currentIdx / denom : 1;
  let pastFrac = 1;
  if (lastPastIdx < 0) {
    pastFrac = 0;
  } else if (denom > 0) {
    pastFrac = lastPastIdx / denom;
  }

  // Frame offset vs wall-clock, in whole minutes (negative = past).
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

  // Now-tag chip — never a bare "−6 min" (audit F8). The forecast state
  // keys off the frame KIND, not the offset sign: a nowcast frame stays
  // extrapolated data even once the wall clock catches up to its
  // timestamp (RainViewer generates +10/+20/+30 from its own run time,
  // which trails the kiosk clock), so it keeps the dashed chip rather
  // than masquerading as an observation. Conversely a past frame with a
  // small positive offset (clock skew) clamps to "now" instead of
  // producing "il y a −2 min".
  const isForecast = frame.kind === "nowcast";
  let chipLabel;
  if (isForecast) {
    chipLabel = t(compact ? "radar.timeline.forecastChipShort" : "radar.timeline.forecastChip", {
      off: formatTickLabel(offsetMin),
    });
  } else if (offsetMin >= -1) {
    chipLabel = t("radar.timeline.now");
  } else if (-offsetMin >= HOUR_LABEL_THRESHOLD_MIN) {
    chipLabel = t("radar.timeline.agoHours", { hours: Math.floor(-offsetMin / 60) });
  } else {
    chipLabel = t("radar.timeline.agoMin", { min: -offsetMin });
  }

  // Tick labels derive from the real frame window — nothing hardcoded.
  // The mid tick sits at the middle of the PAST window, so its label is
  // the offset of that midpoint in time (frames are evenly spaced).
  const startOffsetMin = Math.round((frames[0].time - nowSec) / 60);
  const endOffsetMin = Math.round((frames[frames.length - 1].time - nowSec) / 60);
  const midFrac = pastFrac / 2;
  const midOffsetMin = lastPastIdx >= 0
    ? Math.round(((frames[0].time + frames[lastPastIdx].time) / 2 - nowSec) / 60)
    : 0;

  // Source chip — RainViewer cadence measured from the actual frame
  // spacing (10 min nominally, but derived so an upstream change
  // never leaves a stale hardcode). Shortened on the 7" kiosk and
  // narrow (mobile) layouts.
  const cadenceMin = frames.length > 1
    ? Math.max(1, Math.round((frames[1].time - frames[0].time) / 60))
    : null;
  const sourceLabel = compact || cadenceMin == null
    ? "RainViewer"
    : `RainViewer · ${cadenceMin} min`;

  return (
    <div
      ref={overlayRef}
      className={`${styles.radarTimeline} ${dark ? styles.radarTimelineDark : styles.radarTimelineLight}`}
      data-pi-overlay-el={shellLive === undefined ? undefined : "scrubber"}
      inert={shellLive === false}
      data-pi-engaged={shellEngaged === undefined ? undefined : String(shellEngaged)}
      onPointerDownCapture={engageFirst}
      onKeyDownCapture={engageFirst}
    >
      <div className={styles.rtHeader}>
        <button
          type="button"
          onClick={toggleAnimateWeatherMap}
          className={`${styles.rtCtl} ${styles.rtPlay}`}
          aria-label={t(animateWeatherMap ? "radar.timeline.pauseAria" : "radar.timeline.playAria")}
          title={t(animateWeatherMap ? "radar.timeline.pauseAria" : "radar.timeline.playAria")}
        >
          {animateWeatherMap ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button
          type="button"
          onClick={() => onScrub(Math.max(0, currentIdx - 1))}
          disabled={currentIdx <= 0}
          className={`${styles.rtCtl} ${styles.rtStep}`}
          aria-label={t("radar.timeline.stepBackAria")}
          title={t("radar.timeline.stepBackAria")}
        >
          <StepBackIcon />
        </button>
        <button
          type="button"
          onClick={() => onScrub(Math.min(frames.length - 1, currentIdx + 1))}
          disabled={currentIdx >= frames.length - 1}
          className={`${styles.rtCtl} ${styles.rtStep}`}
          aria-label={t("radar.timeline.stepForwardAria")}
          title={t("radar.timeline.stepForwardAria")}
        >
          <StepForwardIcon />
        </button>
        <button
          type="button"
          onClick={cycleRadarSpeed}
          className={`${styles.rtCtl} ${styles.rtSpeed}`}
          aria-label={t("radar.timeline.speedAria")}
          title={t("radar.timeline.speedAria")}
        >
          {RADAR_SPEED_LABELS[radarSpeed] || `${radarSpeed}×`}
        </button>
        <div className={styles.rtFrameInfo}>
          <div className={styles.rtTs}>
            {timeStr}
            <span className={`${styles.rtNowTag} ${isForecast ? styles.rtNowTagForecast : ""}`}>
              {chipLabel}
            </span>
          </div>
          <div className={styles.rtRel}>
            {/* Compact contexts get the short "13 + 3" form so the
              * header row never overflows on the 7"/mobile widths. */}
            {futureCount > 0
              ? t(compact ? "radar.timeline.frameCountsShort" : "radar.timeline.frameCounts", { past: pastCount, future: futureCount })
              : t("radar.timeline.framesPastOnly", { past: pastCount })}
          </div>
        </div>
        {!atNow && lastPastIdx >= 0 && (
          <button
            type="button"
            onClick={() => onScrub(lastPastIdx)}
            className={styles.rtReturnNow}
            aria-label={t("radar.timeline.returnToNowAria")}
            title={t("radar.timeline.returnToNowAria")}
          >
            <ReturnNowIcon />
            <span className={styles.rtReturnLabel}>{t("radar.timeline.nowMarker")}</span>
          </button>
        )}
        <div
          className={`${styles.rtSourceChip} ${sourceStale ? styles.rtSourceChipStale : ""}`}
          title={sourceStale ? t("radar.timeline.sourceStale") : undefined}
        >
          {sourceLabel}
        </div>
      </div>
      <div
        className={styles.rtTrackWrap}
        style={{ "--thumb-frac": thumbFrac, "--past-frac": pastFrac }}
      >
        <div className={styles.rtTrack}>
          <div className={styles.rtPastFill} />
          {futureCount > 0 && <div className={styles.rtFutureZone} />}
          {futureCount > 0 && thumbFrac > pastFrac && <div className={styles.rtNowcastFill} />}
          {/* Without nowcast frames "now" IS the right edge — the end
            * tick already says it, and a marker there would overflow
            * the bar and duplicate the label (review finding). */}
          {futureCount > 0 && (
            <div className={styles.rtNowMarker}>
              <span className={styles.rtNowMarkerLabel}>{t("radar.timeline.nowMarker")}</span>
            </div>
          )}
          <div className={styles.rtThumb} />
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
            className={styles.rtScrubber}
            aria-label={t("radar.timeline.scrubberAria")}
          />
        </div>
        <div className={styles.rtTicks}>
          <span className={`${styles.rtTick} ${styles.rtTickStart}`} style={{ left: 0 }}>
            {formatTickLabel(startOffsetMin)}
          </span>
          {midFrac > 0.1 && midOffsetMin < 0 && (
            <span className={`${styles.rtTick} ${styles.rtTickMid}`} style={{ left: `${midFrac * 100}%` }}>
              {formatTickLabel(midOffsetMin)}
            </span>
          )}
          <span className={`${styles.rtTick} ${styles.rtTickEnd}`} style={{ left: "100%" }}>
            {futureCount > 0 ? formatTickLabel(endOffsetMin) : t("radar.timeline.nowMarker")}
          </span>
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
  compact: PropTypes.bool,
  sourceStale: PropTypes.bool,
  shellLive: PropTypes.bool,
  shellEngaged: PropTypes.bool,
  onShellEngage: PropTypes.func,
  overlayRef: PropTypes.func,
};

export default RadarTimeline;
